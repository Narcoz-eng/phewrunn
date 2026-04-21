type TokenSocialSignalKol = {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  followerCountEstimate: number | null;
  matchedPostCount: number;
  engagementScore: number;
  url: string | null;
};

type TokenSocialSignalPost = {
  id: string;
  url: string | null;
  text: string;
  authorHandle: string;
  authorDisplayName: string | null;
  authorAvatarUrl: string | null;
  createdAt: string;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  matchedBy: "ca" | "symbol" | "name";
  isCall: boolean;
};

export type TokenSocialSignalsPayload = {
  configured: boolean;
  available: boolean;
  stale: boolean;
  source: string | null;
  matchedQueries: string[];
  topKols: TokenSocialSignalKol[];
  latestPosts: TokenSocialSignalPost[];
  callCount24h: number;
  uniqueAuthors24h: number;
  fetchedAt: string | null;
  message: string | null;
};

type SocialSignalsProviderResponse = {
  source?: unknown;
  matchedQueries?: unknown;
  topKols?: unknown;
  latestPosts?: unknown;
  tweets?: unknown;
  next_cursor?: unknown;
  message?: unknown;
  status?: unknown;
};

const SOCIAL_SIGNALS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 90_000 : 20_000;
const SOCIAL_SIGNALS_REQUEST_TIMEOUT_MS = Number(process.env.SOCIAL_SIGNALS_REQUEST_TIMEOUT_MS ?? "2500");
const socialSignalsCache = new Map<
  string,
  {
    expiresAtMs: number;
    payload: TokenSocialSignalsPayload;
  }
>();

function emptySignals(
  overrides?: Partial<TokenSocialSignalsPayload>,
): TokenSocialSignalsPayload {
  return {
    configured: false,
    available: false,
    stale: false,
    source: null,
    matchedQueries: [],
    topKols: [],
    latestPosts: [],
    callCount24h: 0,
    uniqueAuthors24h: 0,
    fetchedAt: null,
    message:
      "External X signals are not configured yet. Set SOCIAL_SIGNALS_PROVIDER plus SOCIAL_SIGNALS_BASE_URL, or use SOCIAL_SIGNALS_PROVIDER=socialdata with SOCIAL_SIGNALS_API_KEY.",
    ...overrides,
  };
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeMatchedBy(value: unknown): "ca" | "symbol" | "name" {
  return value === "symbol" || value === "name" ? value : "ca";
}

function normalizeKol(value: unknown): TokenSocialSignalKol | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const handle =
    safeString((value as Record<string, unknown>).handle) ??
    safeString((value as Record<string, unknown>).username);
  if (!handle) return null;

  return {
    handle: handle.replace(/^@/, ""),
    displayName: safeString((value as Record<string, unknown>).displayName) ?? safeString((value as Record<string, unknown>).name),
    avatarUrl: safeString((value as Record<string, unknown>).avatarUrl) ?? safeString((value as Record<string, unknown>).image),
    followerCountEstimate:
      safeNumber((value as Record<string, unknown>).followerCountEstimate) ??
      safeNumber((value as Record<string, unknown>).followers),
    matchedPostCount: Math.max(0, Math.round(safeNumber((value as Record<string, unknown>).matchedPostCount) ?? 0)),
    engagementScore: Math.max(0, safeNumber((value as Record<string, unknown>).engagementScore) ?? 0),
    url: safeString((value as Record<string, unknown>).url),
  };
}

function normalizePost(value: unknown): TokenSocialSignalPost | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const user = (row.user && typeof row.user === "object" && !Array.isArray(row.user))
    ? (row.user as Record<string, unknown>)
    : null;
  const id =
    safeString(row.id) ??
    safeString(row.id_str) ??
    safeString(row.postId) ??
    safeString(row.url);
  const authorHandle =
    safeString(row.authorHandle) ??
    safeString(row.handle) ??
    safeString(row.username) ??
    safeString(user?.screen_name);
  const text =
    safeString(row.text) ??
    safeString(row.full_text) ??
    safeString(row.content);
  const createdAt =
    safeString(row.createdAt) ??
    safeString(row.tweet_created_at);
  if (!id || !authorHandle || !text || !createdAt) return null;

  return {
    id,
    url: safeString(row.url),
    text,
    authorHandle: authorHandle.replace(/^@/, ""),
    authorDisplayName:
      safeString(row.authorDisplayName) ??
      safeString(row.authorName) ??
      safeString(row.name) ??
      safeString(user?.name),
    authorAvatarUrl:
      safeString(row.authorAvatarUrl) ??
      safeString(row.authorImage) ??
      safeString(user?.profile_image_url_https),
    createdAt: new Date(createdAt).toISOString(),
    likeCount: Math.max(0, Math.round(safeNumber(row.likeCount) ?? safeNumber(row.favorite_count) ?? 0)),
    repostCount: Math.max(0, Math.round(safeNumber(row.repostCount) ?? safeNumber(row.retweetCount) ?? safeNumber(row.retweet_count) ?? 0)),
    replyCount: Math.max(0, Math.round(safeNumber(row.replyCount) ?? safeNumber(row.reply_count) ?? 0)),
    matchedBy: normalizeMatchedBy(row.matchedBy),
    isCall: safeBoolean(row.isCall),
  };
}

function classifyMatchedBy(query: string, tokenAddress: string, symbol: string | null): "ca" | "symbol" | "name" {
  const normalized = query.trim().toLowerCase();
  if (normalized === tokenAddress.trim().toLowerCase()) return "ca";
  if (symbol && normalized === `$${symbol.trim().replace(/^\$/, "").toLowerCase()}`) return "symbol";
  return "name";
}

function looksLikeCall(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "ca:",
    "contract:",
    "entry",
    "ape",
    "send",
    "moon",
    "runner",
    "breakout",
    "bid",
    "buy",
  ].some((needle) => normalized.includes(needle));
}

function derivePostUrl(row: Record<string, unknown>, authorHandle: string): string | null {
  const direct = safeString(row.url);
  if (direct) return direct;
  const id = safeString(row.id) ?? safeString(row.id_str) ?? safeString(row.postId);
  return id ? `https://x.com/${authorHandle.replace(/^@/, "")}/status/${id}` : null;
}

function aggregateKols(posts: TokenSocialSignalPost[]): TokenSocialSignalKol[] {
  const byHandle = new Map<string, TokenSocialSignalKol>();
  for (const post of posts) {
    const key = post.authorHandle.toLowerCase();
    const current = byHandle.get(key);
    const engagement = getPostEngagementScore(post);
    if (current) {
      current.matchedPostCount += 1;
      current.engagementScore += engagement;
      if (!current.displayName && post.authorDisplayName) current.displayName = post.authorDisplayName;
      if (!current.avatarUrl && post.authorAvatarUrl) current.avatarUrl = post.authorAvatarUrl;
      if (!current.url && post.url) current.url = `https://x.com/${post.authorHandle}`;
      continue;
    }
    byHandle.set(key, {
      handle: post.authorHandle,
      displayName: post.authorDisplayName,
      avatarUrl: post.authorAvatarUrl,
      followerCountEstimate: null,
      matchedPostCount: 1,
      engagementScore: engagement,
      url: `https://x.com/${post.authorHandle}`,
    });
  }
  return [...byHandle.values()]
    .sort((left, right) => right.engagementScore - left.engagementScore || right.matchedPostCount - left.matchedPostCount)
    .slice(0, 6);
}

function getPostEngagementScore(post: TokenSocialSignalPost): number {
  return post.likeCount + post.repostCount * 2 + post.replyCount * 1.5 + (post.isCall ? 8 : 0);
}

function rankTopPosts(posts: TokenSocialSignalPost[]): TokenSocialSignalPost[] {
  return [...posts]
    .sort((left, right) =>
      getPostEngagementScore(right) - getPostEngagementScore(left) ||
      Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )
    .slice(0, 12);
}

function isSocialDataProvider(provider: string | null, baseUrl: string | null): boolean {
  if (provider?.toLowerCase() === "socialdata") return true;
  if (!provider && safeString(process.env.SOCIAL_SIGNALS_API_KEY) && !baseUrl) return true;
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).host.includes("socialdata.tools");
  } catch {
    return false;
  }
}

async function fetchSocialDataSignals(params: {
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  matchedQueries: string[];
}): Promise<TokenSocialSignalsPayload> {
  const apiKey = safeString(process.env.SOCIAL_SIGNALS_API_KEY);
  if (!apiKey) {
    return emptySignals({
      configured: false,
      matchedQueries: params.matchedQueries,
      message: "SocialData is selected, but SOCIAL_SIGNALS_API_KEY is missing.",
    });
  }

  const configuredBaseUrl =
    safeString(process.env.SOCIAL_SIGNALS_BASE_URL) ??
    "https://api.socialdata.tools/twitter/search";
  const baseUrl = new URL(configuredBaseUrl);
  const requests = params.matchedQueries.slice(0, 3).map(async (query) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(3_500, SOCIAL_SIGNALS_REQUEST_TIMEOUT_MS));
    try {
      const url = new URL(baseUrl.toString());
      url.searchParams.set("query", query);
      url.searchParams.set("type", "Top");
      const response = await fetch(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(bodyText || `SocialData request failed (${response.status})`);
      }
      const raw = (await response.json()) as SocialSignalsProviderResponse;
      const tweets = Array.isArray(raw.tweets) ? raw.tweets : [];
      const matchedBy = classifyMatchedBy(query, params.tokenAddress, params.symbol);
      return tweets
        .map((tweet) => normalizePost({
          ...((tweet && typeof tweet === "object" && !Array.isArray(tweet)) ? tweet as Record<string, unknown> : {}),
          matchedBy,
          isCall:
            safeBoolean((tweet as Record<string, unknown> | undefined)?.isCall) ||
            looksLikeCall(
              safeString((tweet as Record<string, unknown> | undefined)?.full_text) ??
              safeString((tweet as Record<string, unknown> | undefined)?.text) ??
              "",
            ),
          url: derivePostUrl(
            ((tweet && typeof tweet === "object" && !Array.isArray(tweet)) ? tweet as Record<string, unknown> : {}),
            safeString(((tweet as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined)?.screen_name) ?? "",
          ),
        }))
        .filter((item): item is TokenSocialSignalPost => Boolean(item));
    } finally {
      clearTimeout(timeout);
    }
  });

  const settled = await Promise.allSettled(requests);
  const collected = new Map<string, TokenSocialSignalPost>();
  const errors = settled
    .filter((item): item is PromiseRejectedResult => item.status === "rejected")
    .map((item) => item.reason instanceof Error ? item.reason.message : String(item.reason));

  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const post of result.value) {
      const existing = collected.get(post.id);
      if (!existing || Date.parse(post.createdAt) > Date.parse(existing.createdAt)) {
        collected.set(post.id, post);
      }
    }
  }

  const posts = rankTopPosts([...collected.values()]);
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const posts24h = posts.filter((post) => {
    const timestamp = Date.parse(post.createdAt);
    return Number.isFinite(timestamp) && timestamp >= cutoffMs;
  });

  if (posts.length === 0 && errors.length > 0) {
    throw new Error(errors[0]!);
  }

  return emptySignals({
    configured: true,
    available: true,
    stale: false,
    source: "socialdata",
    matchedQueries: params.matchedQueries,
    topKols: aggregateKols(posts),
    latestPosts: posts,
    callCount24h: posts24h.filter((post) => post.isCall).length,
    uniqueAuthors24h: new Set(posts24h.map((post) => post.authorHandle.toLowerCase())).size,
    fetchedAt: new Date().toISOString(),
    message: posts.length > 0 ? null : "No recent X posts matched this token yet.",
  });
}

function buildCacheKey(tokenAddress: string): string {
  return tokenAddress.trim().toLowerCase();
}

function buildMatchedQueries(tokenAddress: string, symbol: string | null, name: string | null): string[] {
  const queries = [tokenAddress.trim()];
  if (symbol?.trim()) queries.push(`$${symbol.trim().replace(/^\$/, "")}`);
  if (name?.trim()) queries.push(name.trim());
  return [...new Set(queries)];
}

function isProviderConfigured(): boolean {
  const provider = safeString(process.env.SOCIAL_SIGNALS_PROVIDER);
  const baseUrl = safeString(process.env.SOCIAL_SIGNALS_BASE_URL);
  if (isSocialDataProvider(provider, baseUrl)) {
    return Boolean(safeString(process.env.SOCIAL_SIGNALS_API_KEY));
  }
  return Boolean(
    provider &&
      baseUrl,
  );
}

export async function loadTokenSocialSignals(params: {
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
}): Promise<TokenSocialSignalsPayload> {
  const cacheKey = buildCacheKey(params.tokenAddress);
  const cached = socialSignalsCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.payload;
  }

  const matchedQueries = buildMatchedQueries(params.tokenAddress, params.symbol, params.name);
  if (!isProviderConfigured()) {
    return emptySignals({
      matchedQueries,
    });
  }

  const provider =
    safeString(process.env.SOCIAL_SIGNALS_PROVIDER) ??
    (isSocialDataProvider(null, safeString(process.env.SOCIAL_SIGNALS_BASE_URL)) ? "socialdata" : "generic");
  const baseUrl = safeString(process.env.SOCIAL_SIGNALS_BASE_URL)!;
  if (isSocialDataProvider(provider, baseUrl)) {
    try {
      const payload = await fetchSocialDataSignals({
        tokenAddress: params.tokenAddress,
        symbol: params.symbol,
        name: params.name,
        matchedQueries,
      });
      socialSignalsCache.set(cacheKey, {
        expiresAtMs: Date.now() + SOCIAL_SIGNALS_CACHE_TTL_MS,
        payload,
      });
      return payload;
    } catch (error) {
      console.warn("[token-social-signals] socialdata request failed", {
        tokenAddress: params.tokenAddress,
        message: error instanceof Error ? error.message : String(error),
      });
      const payload = emptySignals({
        configured: true,
        available: false,
        stale: false,
        source: "socialdata",
        matchedQueries,
        message: "SocialData could not return X results right now.",
      });
      socialSignalsCache.set(cacheKey, {
        expiresAtMs: Date.now() + Math.min(SOCIAL_SIGNALS_CACHE_TTL_MS, 15_000),
        payload,
      });
      return payload;
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOCIAL_SIGNALS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(safeString(process.env.SOCIAL_SIGNALS_API_KEY)
          ? {
              authorization: `Bearer ${process.env.SOCIAL_SIGNALS_API_KEY}`,
              "x-api-key": process.env.SOCIAL_SIGNALS_API_KEY!,
            }
          : {}),
      },
      body: JSON.stringify({
        tokenAddress: params.tokenAddress,
        symbol: params.symbol,
        name: params.name,
        queries: matchedQueries,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Provider request failed (${response.status})`);
    }

    const raw = (await response.json()) as SocialSignalsProviderResponse;
    const posts = Array.isArray(raw.latestPosts)
      ? raw.latestPosts.map(normalizePost).filter((item): item is TokenSocialSignalPost => Boolean(item))
      : [];
    const topKols = Array.isArray(raw.topKols)
      ? raw.topKols.map(normalizeKol).filter((item): item is TokenSocialSignalKol => Boolean(item))
      : [];

    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const posts24h = posts.filter((post) => {
      const timestamp = Date.parse(post.createdAt);
      return Number.isFinite(timestamp) && timestamp >= cutoffMs;
    });

    const payload = emptySignals({
      configured: true,
      available: true,
      stale: false,
      source: safeString(raw.source) ?? provider,
      matchedQueries:
        Array.isArray(raw.matchedQueries)
          ? raw.matchedQueries
              .map((value) => safeString(value))
              .filter((value): value is string => Boolean(value))
          : matchedQueries,
      topKols: topKols
        .sort((left, right) => right.engagementScore - left.engagementScore || right.matchedPostCount - left.matchedPostCount)
        .slice(0, 6),
      latestPosts: rankTopPosts(posts),
      callCount24h: posts24h.filter((post) => post.isCall).length,
      uniqueAuthors24h: new Set(posts24h.map((post) => post.authorHandle.toLowerCase())).size,
      fetchedAt: new Date().toISOString(),
      message: null,
    });

    socialSignalsCache.set(cacheKey, {
      expiresAtMs: Date.now() + SOCIAL_SIGNALS_CACHE_TTL_MS,
      payload,
    });
    return payload;
  } catch (error) {
    console.warn("[token-social-signals] provider request failed", {
      tokenAddress: params.tokenAddress,
      provider,
      message: error instanceof Error ? error.message : String(error),
    });

    const payload = emptySignals({
      configured: true,
      available: false,
      stale: false,
      source: provider,
      matchedQueries,
      message: "External X signals are temporarily unavailable.",
    });
    socialSignalsCache.set(cacheKey, {
      expiresAtMs: Date.now() + Math.min(SOCIAL_SIGNALS_CACHE_TTL_MS, 15_000),
      payload,
    });
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}
