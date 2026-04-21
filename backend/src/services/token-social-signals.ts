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
    message: "External X signals are not configured yet. Set SOCIAL_SIGNALS_PROVIDER and SOCIAL_SIGNALS_BASE_URL.",
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
  const id = safeString(row.id) ?? safeString(row.postId) ?? safeString(row.url);
  const authorHandle = safeString(row.authorHandle) ?? safeString(row.handle) ?? safeString(row.username);
  const text = safeString(row.text) ?? safeString(row.content);
  const createdAt = safeString(row.createdAt);
  if (!id || !authorHandle || !text || !createdAt) return null;

  return {
    id,
    url: safeString(row.url),
    text,
    authorHandle: authorHandle.replace(/^@/, ""),
    authorDisplayName: safeString(row.authorDisplayName) ?? safeString(row.authorName) ?? safeString(row.name),
    authorAvatarUrl: safeString(row.authorAvatarUrl) ?? safeString(row.authorImage),
    createdAt,
    likeCount: Math.max(0, Math.round(safeNumber(row.likeCount) ?? 0)),
    repostCount: Math.max(0, Math.round(safeNumber(row.repostCount) ?? safeNumber(row.retweetCount) ?? 0)),
    replyCount: Math.max(0, Math.round(safeNumber(row.replyCount) ?? 0)),
    matchedBy: normalizeMatchedBy(row.matchedBy),
    isCall: safeBoolean(row.isCall),
  };
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
  return Boolean(
    safeString(process.env.SOCIAL_SIGNALS_PROVIDER) &&
      safeString(process.env.SOCIAL_SIGNALS_BASE_URL),
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

  const provider = safeString(process.env.SOCIAL_SIGNALS_PROVIDER) ?? "generic";
  const baseUrl = safeString(process.env.SOCIAL_SIGNALS_BASE_URL)!;
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
      latestPosts: posts
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .slice(0, 12),
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
