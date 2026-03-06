// In production/custom domains, use same-origin API calls.
// In local development, use localhost:3000.
const API_BASE_URL = (() => {
  const envBackendUrl = import.meta.env.VITE_BACKEND_URL?.trim();

  // Auto-detect deployed environments and custom domains (e.g. phew.run)
  if (typeof window !== "undefined") {
    const { hostname, origin, protocol } = window.location;
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname === "0.0.0.0";

    const isKnownDeployedHost =
      hostname.endsWith(".vibecode.run") ||
      hostname.endsWith(".vibecodeapp.com") ||
      hostname === "phew.run" ||
      hostname === "www.phew.run" ||
      hostname.endsWith(".phew.run");

    // Prefer same-origin in deployed environments so a committed dev preview URL
    // doesn't accidentally send production traffic to an outdated backend.
    if (isKnownDeployedHost || (!isLocalhost && protocol === "https:")) {
      return origin;
    }
  }

  // Use explicit backend override for local/dev setups
  if (envBackendUrl) {
    return envBackendUrl;
  }
  // Default to localhost for development
  return "http://localhost:3000";
})();

// Default timeout for requests (12 seconds)
const DEFAULT_TIMEOUT = 12000;
const AUTH_BEARER_TOKEN_MAX_LENGTH = 3500;

export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class TimeoutError extends Error {
  constructor(message: string = "Request timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

// Response envelope type - all app routes return { data: T }
interface ApiResponse<T> {
  data: T;
}

// Extended request options with timeout
interface RequestOptions extends RequestInit {
  timeout?: number;
}

// Token getter - will be set by the auth provider
let getAuthToken: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(getter: () => Promise<string | null>) {
  getAuthToken = getter;
}

function clearStoredAuthTokenFallback(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("auth-token");
  } catch {
    // ignore localStorage clear failures
  }
}

function normalizeAuthTokenForHeader(
  token: string | null | undefined,
  source: "getter" | "fallback"
): string | null {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (trimmed.length > AUTH_BEARER_TOKEN_MAX_LENGTH) {
    console.warn(`[API] Ignoring oversized auth token from ${source} (${trimmed.length} chars)`);
    clearStoredAuthTokenFallback();
    return null;
  }
  return trimmed;
}

function getStoredAuthTokenFallback(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem("auth-token");
    const normalized = normalizeAuthTokenForHeader(stored, "fallback");
    if (!normalized && stored) {
      localStorage.removeItem("auth-token");
    }
    return normalized;
  } catch (error) {
    console.warn("[API] localStorage auth token unavailable; using cookie auth only", error);
    return null;
  }
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options;

  // Get auth token - try getter first, then localStorage fallback
  let token = getAuthToken ? await getAuthToken() : null;
  if (!token) {
    token = getStoredAuthTokenFallback();
  }
  token = normalizeAuthTokenForHeader(token, "getter");

  const headers = new Headers(fetchOptions.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    headers.delete("Authorization");
    headers.delete("authorization");
  }

  const config: RequestInit = {
    ...fetchOptions,
    headers,
    credentials: "include",
  };

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(url, { ...config, signal: controller.signal });
    if (response.status === 494 && token) {
      console.warn(`[API] ${endpoint} returned 494 with bearer token; retrying without Authorization`);
      clearStoredAuthTokenFallback();
      headers.delete("Authorization");
      headers.delete("authorization");
      response = await fetch(url, { ...config, headers, signal: controller.signal });
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new TimeoutError(`Request to ${endpoint} timed out after ${timeout}ms`);
      }
      throw new NetworkError(`Network error: ${error.message}`);
    }
    throw new NetworkError("An unknown network error occurred");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw new ApiError(
      // Try app-route format first, fallback to generic message (Better Auth uses this)
      json?.error?.message || json?.message || `Request failed with status ${response.status}`,
      response.status,
      json?.error || json
    );
  }

  // 1. Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  // 2. JSON responses: parse and unwrap { data }
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    const json: ApiResponse<T> = await response.json();
    return json.data;
  }

  // 3. Non-JSON: return undefined (caller should use api.raw() for these)
  return undefined as T;
}

// Raw request for non-JSON endpoints (uploads, downloads, streams)
async function rawRequest(endpoint: string, options: RequestOptions = {}): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options;

  // Get auth token - try getter first, then localStorage fallback
  let token = getAuthToken ? await getAuthToken() : null;
  if (!token) {
    token = getStoredAuthTokenFallback();
  }
  token = normalizeAuthTokenForHeader(token, "getter");

  const headers = new Headers(fetchOptions.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    headers.delete("Authorization");
    headers.delete("authorization");
  }

  const config: RequestInit = {
    ...fetchOptions,
    headers,
    credentials: "include",
  };

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    let response = await fetch(url, { ...config, signal: controller.signal });
    if (response.status === 494 && token) {
      console.warn(`[API] ${endpoint} returned 494 with bearer token; retrying without Authorization`);
      clearStoredAuthTokenFallback();
      headers.delete("Authorization");
      headers.delete("authorization");
      response = await fetch(url, { ...config, headers, signal: controller.signal });
    }
    return response;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new TimeoutError(`Request to ${endpoint} timed out after ${timeout}ms`);
      }
      throw new NetworkError(`Network error: ${error.message}`);
    }
    throw new NetworkError("An unknown network error occurred");
  } finally {
    clearTimeout(timeoutId);
  }
}

export const api = {
  get: <T>(endpoint: string, options?: RequestInit) =>
    request<T>(endpoint, { ...options, method: "GET" }),

  post: <T>(endpoint: string, data?: unknown, options?: RequestInit) =>
    request<T>(endpoint, {
      ...options,
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T>(endpoint: string, data?: unknown, options?: RequestInit) =>
    request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T>(endpoint: string, data?: unknown, options?: RequestInit) =>
    request<T>(endpoint, {
      ...options,
      method: "PATCH",
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T>(endpoint: string, options?: RequestInit) =>
    request<T>(endpoint, { ...options, method: "DELETE" }),

  // Escape hatch for non-JSON endpoints
  raw: rawRequest,
};

// Sample endpoint types (extend as needed)
export interface SampleResponse {
  message: string;
  timestamp: string;
}

// Sample API functions
export const sampleApi = {
  getSample: () => api.get<SampleResponse>("/api/sample"),
};
