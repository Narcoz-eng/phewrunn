import http from "k6/http";
import exec from "k6/execution";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

function readInt(name, fallback) {
  const raw = (__ENV[name] || "").trim();
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function splitList(raw, separator) {
  return (raw || "")
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function getOrigin(baseUrl) {
  const match = baseUrl.match(/^https?:\/\/[^/]+/i);
  if (!match) {
    throw new Error(`BASE_URL must include protocol and host: ${baseUrl}`);
  }
  return match[0];
}

function makeScenario(execName, rate, timeUnit, duration) {
  if (rate <= 0) {
    return null;
  }

  return {
    executor: "constant-arrival-rate",
    exec: execName,
    rate,
    timeUnit,
    duration,
    preAllocatedVUs: Math.max(4, rate * 4),
    maxVUs: Math.max(16, rate * 10),
    gracefulStop: "30s",
  };
}

const FEED_RATE = readInt("P0_FEED_RATE", 6);
const ME_RATE = readInt("P0_ME_RATE", 2);
const NOTIFICATIONS_RATE = readInt("P0_NOTIFICATIONS_RATE", 1);
const LEADERBOARD_RATE = readInt("P0_LEADERBOARD_RATE", 1);
const AUTH_SYNC_RATE_PER_MIN = readInt("P0_AUTH_SYNC_RATE_PER_MIN", 1);
const POST_CREATE_RATE_PER_MIN = readInt("P0_POST_CREATE_RATE_PER_MIN", 6);
const ABUSE_ME_RATE = readInt("P0_ABUSE_ME_RATE", 0);
const DURATION = (__ENV.P0_DURATION || "15m").trim() || "15m";
const ABUSE_DURATION = (__ENV.P0_ABUSE_DURATION || DURATION).trim() || DURATION;

const scenarios = {};

for (const [name, scenario] of [
  ["feed_latest", makeScenario("feedLatest", FEED_RATE, "1s", DURATION)],
  ["me_read", makeScenario("meRead", ME_RATE, "1s", DURATION)],
  ["notifications_read", makeScenario("notificationsRead", NOTIFICATIONS_RATE, "1s", DURATION)],
  ["leaderboard_stats", makeScenario("leaderboardStats", LEADERBOARD_RATE, "1s", DURATION)],
  ["auth_privy_sync", makeScenario("authPrivySync", AUTH_SYNC_RATE_PER_MIN, "1m", DURATION)],
  ["post_create", makeScenario("postCreate", POST_CREATE_RATE_PER_MIN, "1m", DURATION)],
  ["abuse_me", makeScenario("abuseMe", ABUSE_ME_RATE, "1s", ABUSE_DURATION)],
]) {
  if (scenario) {
    scenarios[name] = scenario;
  }
}

const authSyncLatency = new Trend("auth_privy_sync_latency", true);
const authSyncUnexpected = new Rate("auth_privy_sync_unexpected");
const authSyncCookieIssued = new Rate("auth_privy_sync_cookie_issued");

const meLatency = new Trend("me_latency", true);
const meUnexpected = new Rate("me_unexpected");

const notificationsLatency = new Trend("notifications_latency", true);
const notificationsUnexpected = new Rate("notifications_unexpected");

const feedLatency = new Trend("feed_latency", true);
const feedUnexpected = new Rate("feed_unexpected");
const feedDegraded = new Counter("feed_degraded_responses");

const leaderboardLatency = new Trend("leaderboard_latency", true);
const leaderboardUnexpected = new Rate("leaderboard_unexpected");
const leaderboardDegraded = new Counter("leaderboard_degraded_responses");

const postCreateLatency = new Trend("post_create_latency", true);
const postCreateUnexpected = new Rate("post_create_unexpected");

const abuseMeLatency = new Trend("abuse_me_latency", true);
const abuseMeUnexpected = new Rate("abuse_me_unexpected");
const abuseMeRateLimited = new Rate("abuse_me_rate_limited");

export const options = {
  discardResponseBodies: false,
  scenarios,
  thresholds: {
    auth_privy_sync_latency: ["p(95)<500", "p(99)<1200"],
    auth_privy_sync_unexpected: ["rate<0.01"],
    auth_privy_sync_cookie_issued: ["rate>0.99"],
    me_latency: ["p(95)<150", "p(99)<400"],
    me_unexpected: ["rate<0.01"],
    notifications_latency: ["p(95)<300", "p(99)<800"],
    notifications_unexpected: ["rate<0.01"],
    feed_latency: ["p(95)<400", "p(99)<900"],
    feed_unexpected: ["rate<0.01"],
    leaderboard_latency: ["p(95)<300", "p(99)<800"],
    leaderboard_unexpected: ["rate<0.01"],
    post_create_latency: ["p(95)<400", "p(99)<900"],
    post_create_unexpected: ["rate<0.01"],
    abuse_me_unexpected: ["rate<0.01"],
    abuse_me_rate_limited: ["rate>0"],
  },
};

function buildPublicHeaders(origin) {
  return {
    Origin: origin,
    Referer: `${origin}/`,
    "User-Agent": "p0-k6-gate/1.0",
  };
}

function buildAuthHeaders(origin, authContext) {
  const headers = buildPublicHeaders(origin);
  if (!authContext) {
    return headers;
  }

  if (authContext.mode === "cookie") {
    headers.Cookie = authContext.cookie;
    return headers;
  }

  headers["x-load-sim-secret"] = authContext.secret;
  headers["x-load-sim-user-id"] = authContext.userId;
  headers["x-requested-with"] = "p0-k6-gate";
  return headers;
}

function normalizeCookieHeader(cookieHeader) {
  return cookieHeader.toLowerCase().startsWith("cookie:")
    ? cookieHeader.slice("cookie:".length).trim()
    : cookieHeader;
}

function buildAuthPool() {
  const cookiePool = splitList(__ENV.P0_SESSION_COOKIES, "||").map((cookie) => ({
    mode: "cookie",
    cookie: normalizeCookieHeader(cookie),
  }));

  if (cookiePool.length > 0) {
    return cookiePool;
  }

  const secret = (__ENV.P0_INTERNAL_AUTH_SECRET || "").trim();
  const userIds = splitList(__ENV.P0_INTERNAL_AUTH_USER_IDS, ",");
  if (!secret || userIds.length === 0) {
    return [];
  }

  return userIds.map((userId) => ({
    mode: "internal",
    userId,
    secret,
  }));
}

function parseJson(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

function collectFeedSeeds(seedState, payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const data = payload.data;
  const items = Array.isArray(data)
    ? data
    : data && Array.isArray(data.items)
      ? data.items
      : [];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const postId = typeof item.id === "string" ? item.id : null;
    const tokenAddress =
      typeof item.contractAddress === "string"
        ? item.contractAddress
        : typeof item.tokenAddress === "string"
          ? item.tokenAddress
          : null;

    if (postId) {
      seedState.postIds.push(postId);
    }

    if (tokenAddress) {
      seedState.tokenAddresses.push(tokenAddress);
    }
  }
}

function recordResponse(response, allowedStatuses, latencyMetric, unexpectedMetric, degradedMetric) {
  latencyMetric.add(response.timings.duration);
  const expected = allowedStatuses.includes(response.status);
  unexpectedMetric.add(!expected);
  check(response, {
    [`status is one of ${allowedStatuses.join(",")}`]: () => expected,
  });

  if (degradedMetric) {
    const payload = parseJson(response);
    if (payload && payload.data && payload.data.degraded === true) {
      degradedMetric.add(1);
    }
  }

  return expected;
}

function pickAuthContext(authPool, sticky = false) {
  if (!Array.isArray(authPool) || authPool.length === 0) {
    return null;
  }

  if (sticky) {
    const stickyIndex = (exec.vu.idInTest - 1) % authPool.length;
    return authPool[stickyIndex] || authPool[0] || null;
  }

  const index = Math.floor(Math.random() * authPool.length);
  return authPool[index] || null;
}

function pickTokenAddress(seedState) {
  const tokens = seedState.tokenAddresses || [];
  if (tokens.length === 0) {
    return null;
  }

  const index = (exec.vu.idInTest + exec.scenario.iterationInTest) % tokens.length;
  return tokens[index] || tokens[0] || null;
}

export function setup() {
  const baseUrl = trimTrailingSlash((__ENV.BASE_URL || "").trim());
  if (!baseUrl) {
    throw new Error("BASE_URL is required");
  }

  const origin = getOrigin(baseUrl);
  const authPool = buildAuthPool();
  const needsAuthPool =
    ME_RATE > 0 ||
    NOTIFICATIONS_RATE > 0 ||
    POST_CREATE_RATE_PER_MIN > 0 ||
    ABUSE_ME_RATE > 0;

  if (needsAuthPool && authPool.length === 0) {
    throw new Error(
      "Authenticated scenarios require P0_SESSION_COOKIES or P0_INTERNAL_AUTH_SECRET + P0_INTERNAL_AUTH_USER_IDS"
    );
  }

  if (AUTH_SYNC_RATE_PER_MIN > 0 && !(__ENV.P0_PRIVY_ID_TOKEN || "").trim()) {
    throw new Error("P0_PRIVY_ID_TOKEN is required when P0_AUTH_SYNC_RATE_PER_MIN is enabled");
  }

  const seedState = {
    tokenAddresses: unique(splitList(__ENV.P0_TOKEN_ADDRESSES, ",")),
    postIds: [],
  };

  for (const path of ["/api/feed/latest?limit=20", "/api/feed/hot-alpha?limit=10"]) {
    const response = http.get(`${baseUrl}${path}`, {
      headers: buildPublicHeaders(origin),
      tags: { phase: "setup" },
    });
    if (response.status >= 200 && response.status < 300) {
      collectFeedSeeds(seedState, parseJson(response));
    }
  }

  seedState.tokenAddresses = unique(seedState.tokenAddresses);
  seedState.postIds = unique(seedState.postIds);

  if (POST_CREATE_RATE_PER_MIN > 0 && seedState.tokenAddresses.length === 0) {
    throw new Error("POST /api/posts load scenario requires P0_TOKEN_ADDRESSES or discoverable feed token addresses");
  }

  return {
    baseUrl,
    origin,
    authPool,
    seedState,
  };
}

export function authPrivySync(data) {
  const body = JSON.stringify({
    privyIdToken: (__ENV.P0_PRIVY_ID_TOKEN || "").trim(),
    ...( (__ENV.P0_PRIVY_NAME || "").trim() ? { name: (__ENV.P0_PRIVY_NAME || "").trim() } : {}),
    ...( (__ENV.P0_INVITE_CODE || "").trim() ? { code: (__ENV.P0_INVITE_CODE || "").trim() } : {}),
  });

  const response = http.post(`${data.baseUrl}/api/auth/privy-sync`, body, {
    headers: {
      ...buildPublicHeaders(data.origin),
      "Content-Type": "application/json",
    },
    tags: { endpoint: "auth_privy_sync" },
  });

  recordResponse(response, [200], authSyncLatency, authSyncUnexpected);
  authSyncCookieIssued.add(Boolean(response.cookies["phew.session_token"]?.length));
}

export function meRead(data) {
  const authContext = pickAuthContext(data.authPool);
  const response = http.get(`${data.baseUrl}/api/me`, {
    headers: buildAuthHeaders(data.origin, authContext),
    tags: { endpoint: "me" },
  });

  recordResponse(response, [200], meLatency, meUnexpected);
}

export function notificationsRead(data) {
  const authContext = pickAuthContext(data.authPool);
  const response = http.get(`${data.baseUrl}/api/notifications`, {
    headers: buildAuthHeaders(data.origin, authContext),
    tags: { endpoint: "notifications" },
  });

  recordResponse(response, [200], notificationsLatency, notificationsUnexpected);
}

export function feedLatest(data) {
  const response = http.get(`${data.baseUrl}/api/feed/latest?limit=20`, {
    headers: buildPublicHeaders(data.origin),
    tags: { endpoint: "feed_latest" },
  });

  recordResponse(response, [200], feedLatency, feedUnexpected, feedDegraded);
}

export function leaderboardStats(data) {
  const response = http.get(`${data.baseUrl}/api/leaderboard/stats`, {
    headers: buildPublicHeaders(data.origin),
    tags: { endpoint: "leaderboard_stats" },
  });

  recordResponse(response, [200], leaderboardLatency, leaderboardUnexpected, leaderboardDegraded);
}

export function postCreate(data) {
  const authContext = pickAuthContext(data.authPool);
  const tokenAddress = pickTokenAddress(data.seedState);
  const iterationId = `${exec.vu.idInTest}-${exec.scenario.iterationInTest}`;
  const response = http.post(
    `${data.baseUrl}/api/posts`,
    JSON.stringify({
      content: `P0 load gate ${tokenAddress} momentum watch ${iterationId}`,
    }),
    {
      headers: {
        ...buildAuthHeaders(data.origin, authContext),
        "Content-Type": "application/json",
      },
      tags: { endpoint: "post_create" },
    }
  );

  recordResponse(response, [200], postCreateLatency, postCreateUnexpected);
}

export function abuseMe(data) {
  const authContext = pickAuthContext(data.authPool, true);
  const response = http.get(`${data.baseUrl}/api/me`, {
    headers: buildAuthHeaders(data.origin, authContext),
    tags: { endpoint: "abuse_me" },
  });

  abuseMeLatency.add(response.timings.duration);
  abuseMeRateLimited.add(response.status === 429);
  const expected = response.status === 200 || response.status === 429;
  abuseMeUnexpected.add(!expected);
  check(response, {
    "abuse status is 200 or 429": () => expected,
  });
}
