process.env.NODE_ENV ||= "development";
process.env.INTELLIGENCE_PRIORITY_LOOP_ENABLED ||= "false";
process.env.PRISMA_ENABLE_COMPAT_GUARDRAILS ||= "false";
process.env.LOAD_SIM_INTERNAL_AUTH_SECRET ||= "load-sim-local";
process.env.AUTH_DISABLE_SESSION_MAINTENANCE ||= "true";
process.env.PRIVY_APP_ID ||= "load-sim-privy-app";
process.env.PRIVY_APP_SECRET ||= "load-sim-privy-secret";
process.env.AUTH_SESSION_TOKEN_SECRET ||= "load-sim-auth-session-secret-0123456789";

type AppModule = {
  app: {
    fetch: (request: Request) => Promise<Response> | Response;
  };
};

type PrismaModule = {
  ensurePrismaReady: () => Promise<void>;
  prisma: {
    user: {
      findMany: (args: Record<string, unknown>) => Promise<Array<{ id: string; username: string | null }>>;
    };
    post: {
      findMany: (args: Record<string, unknown>) => Promise<Array<{
        id: string;
        authorId: string;
        contractAddress: string | null;
        author: { username: string | null } | null;
      }>>;
    };
  };
};

type AuthMode = "internal" | "cookie" | "bearer" | "none";
type AuthContext =
  | { mode: "internal"; userId: string }
  | { mode: "cookie"; cookie: string }
  | { mode: "bearer"; token: string }
  | null;

type SeedPost = {
  id: string;
  authorId: string | null;
  contractAddress: string | null;
};

type SeedState = {
  posts: SeedPost[];
  tokenAddresses: string[];
  userIdentifiers: string[];
};

type RequestTemplate = {
  label: string;
  method: string;
  path: string;
  body?: string;
  contentType?: string;
};

type SimulationConfig = {
  virtualUsers: number;
  durationMs: number;
  maxInFlight: number;
  authRatio: number;
  minThinkMs: number;
  maxThinkMs: number;
  enableCreatePosts: boolean;
  authMode: AuthMode;
  authPoolSize: number;
};

type RouteStats = {
  count: number;
  degradedCount: number;
  latenciesMs: number[];
  statusCounts: Map<number, number>;
  errorCodes: Map<string, number>;
};

const BASE_URL = "https://www.phew.run";
const runtimeArgv =
  typeof Bun !== "undefined" && Array.isArray(Bun.argv) ? Bun.argv : process.argv;
const ALLOWED_ORIGIN = "https://www.phew.run";

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }

    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
    return () => this.release();
  }

  current(): number {
    return this.active;
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

function readNumberArg(name: string, fallback: number): number {
  const envKey = name.replace(/^--/, "").replace(/-/g, "_").toUpperCase();
  const argIndex = runtimeArgv.indexOf(name);
  const raw = argIndex >= 0 ? runtimeArgv[argIndex + 1] : process.env[`LOAD_SIM_${envKey}`];
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBooleanArg(name: string, fallback: boolean): boolean {
  const envKey = name.replace(/^--/, "").replace(/-/g, "_").toUpperCase();
  const argIndex = runtimeArgv.indexOf(name);
  const raw = argIndex >= 0 ? runtimeArgv[argIndex + 1] : process.env[`LOAD_SIM_${envKey}`];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function readAuthMode(): AuthMode {
  const argIndex = runtimeArgv.indexOf("--auth-mode");
  const raw = (argIndex >= 0 ? runtimeArgv[argIndex + 1] : process.env.LOAD_SIM_AUTH_MODE)?.trim().toLowerCase();
  if (raw === "internal" || raw === "cookie" || raw === "bearer" || raw === "none") {
    return raw;
  }
  if (process.env.LOAD_SIM_SESSION_COOKIES?.trim()) return "cookie";
  if (process.env.LOAD_SIM_BEARER_TOKENS?.trim()) return "bearer";
  return "internal";
}

function randomInt(minInclusive: number, maxInclusive: number): number {
  return Math.floor(Math.random() * (maxInclusive - minInclusive + 1)) + minInclusive;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function incrementCount(map: Map<number, number>, key: number): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function incrementStringCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function upsertSeedPost(state: SeedState, post: SeedPost): void {
  if (!post.id) return;
  const existingIndex = state.posts.findIndex((entry) => entry.id === post.id);
  if (existingIndex >= 0) {
    state.posts[existingIndex] = {
      id: post.id,
      authorId: post.authorId ?? state.posts[existingIndex]?.authorId ?? null,
      contractAddress: post.contractAddress ?? state.posts[existingIndex]?.contractAddress ?? null,
    };
  } else {
    state.posts.push(post);
  }
  if (state.posts.length > 500) {
    state.posts.splice(0, state.posts.length - 500);
  }

  if (post.contractAddress && !state.tokenAddresses.includes(post.contractAddress)) {
    state.tokenAddresses.push(post.contractAddress);
    if (state.tokenAddresses.length > 400) {
      state.tokenAddresses.splice(0, state.tokenAddresses.length - 400);
    }
  }
}

function upsertUserIdentifier(state: SeedState, identifier: string | null | undefined): void {
  const normalized = identifier?.trim();
  if (!normalized) return;
  if (!state.userIdentifiers.includes(normalized)) {
    state.userIdentifiers.push(normalized);
    if (state.userIdentifiers.length > 300) {
      state.userIdentifiers.splice(0, state.userIdentifiers.length - 300);
    }
  }
}

function collectSeedsFromPayload(state: SeedState, payload: unknown): void {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const root = payload as { data?: unknown };
  const data = root.data;
  const items =
    Array.isArray(data)
      ? data
      : data && typeof data === "object" && Array.isArray((data as { items?: unknown[] }).items)
        ? (data as { items: unknown[] }).items
        : [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as {
      id?: unknown;
      contractAddress?: unknown;
      authorId?: unknown;
      author?: { id?: unknown; username?: unknown } | null;
      username?: unknown;
    };

    const authorId =
      typeof record.authorId === "string"
        ? record.authorId
        : typeof record.author?.id === "string"
          ? record.author.id
          : null;
    const username =
      typeof record.author?.username === "string"
        ? record.author.username
        : typeof record.username === "string"
          ? record.username
          : null;
    const contractAddress = typeof record.contractAddress === "string" ? record.contractAddress : null;
    const postId = typeof record.id === "string" ? record.id : null;

    if (postId) {
      upsertSeedPost(state, {
        id: postId,
        authorId,
        contractAddress,
      });
    }

    upsertUserIdentifier(state, username);
    upsertUserIdentifier(state, authorId);
  }
}

function headersForRequest(vuIndex: number, auth: AuthContext, method: string, contentType?: string): Headers {
  const headers = new Headers();
  headers.set("x-forwarded-for", `198.18.${Math.floor(vuIndex / 255)}.${(vuIndex % 255) + 1}`);
  headers.set("user-agent", `phew-load-sim/${vuIndex + 1}`);
  headers.set("origin", ALLOWED_ORIGIN);
  headers.set("referer", `${ALLOWED_ORIGIN}/`);
  if (contentType) {
    headers.set("content-type", contentType);
  }
  if (auth?.mode === "internal") {
    headers.set("x-load-sim-secret", process.env.LOAD_SIM_INTERNAL_AUTH_SECRET ?? "load-sim-local");
    headers.set("x-load-sim-user-id", auth.userId);
  } else if (auth?.mode === "cookie") {
    headers.set("cookie", auth.cookie);
  } else if (auth?.mode === "bearer") {
    headers.set("authorization", `Bearer ${auth.token}`);
  }
  if (method !== "GET" && method !== "HEAD") {
    headers.set("x-requested-with", "phew-load-sim");
  }
  return headers;
}

function buildCreatePostContent(tokenAddress: string): string {
  return `Load sim alpha watch ${tokenAddress} momentum looks active`;
}

function weightedPick<T>(items: Array<{ weight: number; value: T }>): T {
  const total = items.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.random() * total;
  for (const entry of items) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.value;
    }
  }
  return items[items.length - 1]!.value;
}

function chooseRequestTemplate(
  auth: AuthContext,
  state: SeedState,
  config: SimulationConfig
): RequestTemplate | null {
  const tokenAddress = pickRandom(state.tokenAddresses);
  const identifier = pickRandom(state.userIdentifiers);
  const seedPostPool =
    auth?.mode === "internal"
      ? state.posts.filter((post) => post.authorId !== auth.userId)
      : state.posts;
  const post = pickRandom(seedPostPool);

  const publicChoices: Array<{ weight: number; value: RequestTemplate | null }> = [
    { weight: 20, value: { label: "GET /api/feed/latest", method: "GET", path: "/api/feed/latest?limit=20" } },
    { weight: 12, value: { label: "GET /api/feed/hot-alpha", method: "GET", path: "/api/feed/hot-alpha?limit=10" } },
    { weight: 8, value: { label: "GET /api/feed/early-runners", method: "GET", path: "/api/feed/early-runners?limit=10" } },
    { weight: 8, value: { label: "GET /api/posts/trending", method: "GET", path: "/api/posts/trending" } },
    { weight: 6, value: { label: "GET /api/announcements", method: "GET", path: "/api/announcements" } },
    { weight: 8, value: { label: "GET /api/leaderboards/daily", method: "GET", path: "/api/leaderboards/daily" } },
    { weight: 6, value: { label: "GET /api/leaderboard/stats", method: "GET", path: "/api/leaderboard/stats" } },
    {
      weight: tokenAddress ? 12 : 0,
      value: tokenAddress
        ? { label: "GET /api/tokens/:tokenAddress/live", method: "GET", path: `/api/tokens/${tokenAddress}/live` }
        : null,
    },
    {
      weight: tokenAddress ? 8 : 0,
      value: tokenAddress
        ? { label: "GET /api/tokens/:tokenAddress", method: "GET", path: `/api/tokens/${tokenAddress}` }
        : null,
    },
    {
      weight: identifier ? 7 : 0,
      value: identifier
        ? { label: "GET /api/users/:identifier", method: "GET", path: `/api/users/${identifier}` }
        : null,
    },
    {
      weight: identifier ? 5 : 0,
      value: identifier
        ? { label: "GET /api/users/:identifier/posts", method: "GET", path: `/api/users/${identifier}/posts` }
        : null,
    },
  ];

  if (!auth) {
    return weightedPick(publicChoices);
  }

  const authChoices: Array<{ weight: number; value: RequestTemplate | null }> = [
    { weight: 10, value: { label: "GET /api/me", method: "GET", path: "/api/me" } },
    { weight: 8, value: { label: "GET /api/notifications/unread-count", method: "GET", path: "/api/notifications/unread-count" } },
    { weight: 5, value: { label: "GET /api/notifications", method: "GET", path: "/api/notifications" } },
    { weight: 4, value: { label: "GET /api/users/me/wallet", method: "GET", path: "/api/users/me/wallet" } },
    { weight: 3, value: { label: "GET /api/users/me/fee-settings", method: "GET", path: "/api/users/me/fee-settings" } },
    ...publicChoices,
    {
      weight: post ? 4 : 0,
      value: post
        ? { label: "POST /api/posts/:id/like", method: "POST", path: `/api/posts/${post.id}/like` }
        : null,
    },
    {
      weight: post ? 3 : 0,
      value: post
        ? {
            label: "POST /api/posts/:id/comments",
            method: "POST",
            path: `/api/posts/${post.id}/comments`,
            body: JSON.stringify({ content: `load sim comment ${randomInt(1000, 9999)}` }),
            contentType: "application/json",
          }
        : null,
    },
    {
      weight: post ? 2 : 0,
      value: post
        ? { label: "POST /api/posts/:id/repost", method: "POST", path: `/api/posts/${post.id}/repost` }
        : null,
    },
    {
      weight: config.enableCreatePosts && tokenAddress ? 2 : 0,
      value:
        config.enableCreatePosts && tokenAddress
          ? {
              label: "POST /api/posts",
              method: "POST",
              path: "/api/posts",
              body: JSON.stringify({ content: buildCreatePostContent(tokenAddress) }),
              contentType: "application/json",
            }
          : null,
    },
  ];

  return weightedPick(authChoices);
}

async function primeSeedState(
  app: AppModule["app"],
  state: SeedState
): Promise<void> {
  const seedPaths = [
    "/api/feed/latest?limit=20",
    "/api/feed/hot-alpha?limit=10",
    "/api/posts/trending",
    "/api/leaderboards/daily",
  ];

  for (const path of seedPaths) {
    const response = await app.fetch(
      new Request(`${BASE_URL}${path}`, {
        headers: headersForRequest(0, null, "GET"),
      })
    );
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      continue;
    }
    try {
      collectSeedsFromPayload(state, await response.json());
    } catch {
      // Ignore malformed seed responses.
    }
  }
}

async function buildAuthPool(
  prisma: PrismaModule["prisma"],
  config: SimulationConfig
): Promise<AuthContext[]> {
  if (config.authMode === "none") {
    return [];
  }

  if (config.authMode === "cookie") {
    return (process.env.LOAD_SIM_SESSION_COOKIES ?? "")
      .split("||")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((cookie) => ({ mode: "cookie", cookie } satisfies NonNullable<AuthContext>));
  }

  if (config.authMode === "bearer") {
    return (process.env.LOAD_SIM_BEARER_TOKENS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((token) => ({ mode: "bearer", token } satisfies NonNullable<AuthContext>));
  }

  try {
    const users = await prisma.user.findMany({
      where: { isBanned: false },
      orderBy: { createdAt: "desc" },
      take: config.authPoolSize,
      select: {
        id: true,
        username: true,
      },
    });
    return users.map((user) => ({ mode: "internal", userId: user.id } satisfies NonNullable<AuthContext>));
  } catch (error) {
    console.warn("[load-sim] failed to build internal auth pool; continuing with anonymous traffic", {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function backfillSeedsFromDatabase(prisma: PrismaModule["prisma"], state: SeedState): Promise<void> {
  if (state.posts.length >= 25 && state.userIdentifiers.length >= 10 && state.tokenAddresses.length >= 10) {
    return;
  }

  try {
    const [posts, users] = await Promise.all([
      prisma.post.findMany({
        take: 100,
        orderBy: { createdAt: "desc" },
        where: { contractAddress: { not: null } },
        select: {
          id: true,
          authorId: true,
          contractAddress: true,
          author: {
            select: { username: true },
          },
        },
      }),
      prisma.user.findMany({
        take: 100,
        orderBy: { createdAt: "desc" },
        where: { isBanned: false },
        select: {
          id: true,
          username: true,
        },
      }),
    ]);

    for (const post of posts) {
      upsertSeedPost(state, {
        id: post.id,
        authorId: post.authorId,
        contractAddress: post.contractAddress,
      });
      upsertUserIdentifier(state, post.author?.username ?? post.authorId);
    }

    for (const user of users) {
      upsertUserIdentifier(state, user.username ?? user.id);
    }
  } catch (error) {
    console.warn("[load-sim] database seed backfill unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function warmApplication(app: AppModule["app"]): Promise<void> {
  const warmupPaths = [
    "/api/feed/latest",
    "/api/posts/trending",
    "/api/announcements",
    "/api/leaderboard/stats",
  ];

  for (const path of warmupPaths) {
    try {
      await app.fetch(
        new Request(`${BASE_URL}${path}`, {
          method: "GET",
          headers: headersForRequest(0, null, "GET"),
        })
      );
    } catch {
      // Warmup should not block the simulation; failures will show up in measured traffic.
    }
  }
}

function summarizeRouteStats(label: string, stats: RouteStats): string {
  const latencies = [...stats.latenciesMs].sort((left, right) => left - right);
  const statusSummary = [...stats.statusCounts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([status, count]) => `${status}:${count}`)
    .join(" ");
  const errorSummary = [...stats.errorCodes.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([code, count]) => `${code}:${count}`)
    .join(" ");

  return [
    `${label}`,
    `count=${stats.count}`,
    `p50=${percentile(latencies, 50).toFixed(1)}ms`,
    `p95=${percentile(latencies, 95).toFixed(1)}ms`,
    `p99=${percentile(latencies, 99).toFixed(1)}ms`,
    `degraded=${stats.degradedCount}`,
    `statuses=[${statusSummary}]`,
    errorSummary ? `errors=[${errorSummary}]` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

const config: SimulationConfig = {
  virtualUsers: readNumberArg("--users", 1000),
  durationMs: readNumberArg("--duration-ms", 60_000),
  maxInFlight: readNumberArg("--max-in-flight", 150),
  authRatio: Math.min(1, readNumberArg("--auth-ratio", 0.35)),
  minThinkMs: readNumberArg("--min-think-ms", 150),
  maxThinkMs: readNumberArg("--max-think-ms", 900),
  enableCreatePosts: readBooleanArg("--enable-create-posts", true),
  authMode: readAuthMode(),
  authPoolSize: readNumberArg("--auth-pool-size", 32),
};

console.log("[load-sim] config", config);

const runtimeModuleExtension = typeof Bun !== "undefined" ? "ts" : "js";
const [appModule, prismaModule] = await Promise.all([
  import(`../src/index.${runtimeModuleExtension}`),
  import(`../src/prisma.${runtimeModuleExtension}`),
]);
const app = (appModule as AppModule).app;
const prismaRuntime = prismaModule as unknown as PrismaModule;
const prisma = prismaRuntime.prisma;

console.log("[load-sim] waiting for Prisma readiness");
await prismaRuntime.ensurePrismaReady();
await warmApplication(app);

const authPool = await buildAuthPool(prisma, config);
const state: SeedState = {
  posts: [],
  tokenAddresses: [],
  userIdentifiers: [],
};

await primeSeedState(app, state);
await backfillSeedsFromDatabase(prisma, state);

console.log("[load-sim] seed-state", {
  posts: state.posts.length,
  tokenAddresses: state.tokenAddresses.length,
  userIdentifiers: state.userIdentifiers.length,
  authPool: authPool.length,
});

const routeStats = new Map<string, RouteStats>();
let peakInFlight = 0;
let totalRequests = 0;
let totalFailures = 0;
const startedAt = Date.now();
const endsAt = startedAt + config.durationMs;
const semaphore = new Semaphore(config.maxInFlight);

async function executeRequest(vuIndex: number, auth: AuthContext): Promise<void> {
  const template = chooseRequestTemplate(auth, state, config);
  if (!template) {
    await sleep(25);
    return;
  }

  const release = await semaphore.acquire();
  peakInFlight = Math.max(peakInFlight, semaphore.current());

  try {
    const requestStartedAt = performance.now();
    const response = await app.fetch(
      new Request(`${BASE_URL}${template.path}`, {
        method: template.method,
        headers: headersForRequest(vuIndex, auth, template.method, template.contentType),
        body: template.body,
      })
    );
    const elapsedMs = performance.now() - requestStartedAt;
    totalRequests += 1;

    const stats = routeStats.get(template.label) ?? {
      count: 0,
      degradedCount: 0,
      latenciesMs: [],
      statusCounts: new Map<number, number>(),
      errorCodes: new Map<string, number>(),
    };
    stats.count += 1;
    stats.latenciesMs.push(elapsedMs);
    incrementCount(stats.statusCounts, response.status);

    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      totalFailures += 1;
    }

    if (contentType.includes("application/json") && text) {
      try {
        const payload = JSON.parse(text) as { data?: unknown; error?: { code?: string; message?: string } };
        collectSeedsFromPayload(state, payload);
        if (payload?.data && typeof payload.data === "object" && (payload.data as { degraded?: unknown }).degraded === true) {
          stats.degradedCount += 1;
        }
        if (payload?.error?.code) {
          incrementStringCount(stats.errorCodes, payload.error.code);
        } else if (!response.ok && payload?.error?.message) {
          incrementStringCount(stats.errorCodes, payload.error.message);
        }
      } catch {
        if (!response.ok) {
          incrementStringCount(stats.errorCodes, "non_json_error");
        }
      }
    } else if (!response.ok) {
      incrementStringCount(stats.errorCodes, `status_${response.status}`);
    }

    routeStats.set(template.label, stats);
  } catch (error) {
    totalRequests += 1;
    totalFailures += 1;
    const stats = routeStats.get(template.label) ?? {
      count: 0,
      degradedCount: 0,
      latenciesMs: [],
      statusCounts: new Map<number, number>(),
      errorCodes: new Map<string, number>(),
    };
    stats.count += 1;
    incrementStringCount(stats.errorCodes, error instanceof Error ? error.message : String(error));
    routeStats.set(template.label, stats);
  } finally {
    release();
  }
}

const authUserCount = authPool.length > 0 ? Math.floor(config.virtualUsers * config.authRatio) : 0;
const virtualUsers = Array.from({ length: config.virtualUsers }, (_, index) => {
  const auth =
    index < authUserCount && authPool.length > 0
      ? authPool[index % authPool.length] ?? null
      : null;
  return { index, auth };
});

await Promise.all(
  virtualUsers.map(async (vu) => {
    while (Date.now() < endsAt) {
      await executeRequest(vu.index, vu.auth);
      await sleep(randomInt(config.minThinkMs, config.maxThinkMs));
    }
  })
);

const durationSec = Math.max(1, (Date.now() - startedAt) / 1000);
const orderedRoutes = [...routeStats.entries()].sort((left, right) => right[1].count - left[1].count);

console.log("");
console.log("[load-sim] summary");
console.log(`requests=${totalRequests} failures=${totalFailures} req_per_sec=${(totalRequests / durationSec).toFixed(2)} peak_in_flight=${peakInFlight}`);
console.log("");
console.log("[load-sim] hottest routes");
for (const [label, stats] of orderedRoutes.slice(0, 12)) {
  console.log(summarizeRouteStats(label, stats));
}

console.log("");
console.log("[load-sim] slow/error candidates");
for (const [label, stats] of orderedRoutes) {
  const latencies = [...stats.latenciesMs].sort((left, right) => left - right);
  const p95 = percentile(latencies, 95);
  const non2xx =
    [...stats.statusCounts.entries()]
      .filter(([status]) => status < 200 || status >= 300)
      .reduce((sum, [, count]) => sum + count, 0);
  const errorRate = stats.count > 0 ? non2xx / stats.count : 0;
  if (p95 >= 1200 || errorRate >= 0.02 || stats.degradedCount > 0) {
    console.log(
      `${label} | p95=${p95.toFixed(1)}ms | error_rate=${(errorRate * 100).toFixed(1)}% | degraded=${stats.degradedCount}`
    );
  }
}

process.exit(0);
