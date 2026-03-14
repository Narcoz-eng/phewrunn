import { getStoredBackendSessionToken } from "./backend-session-token";

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
      hostname.endsWith(".phew.run") ||
      hostname.endsWith(".vercel.app");

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

// Default timeout for requests (8 seconds — backend has its own 4-5s query
// timeouts, so 12s was letting stale connections hang too long)
const DEFAULT_TIMEOUT = 8000;
const AUTH_MUTATION_401_RETRY_DELAY_MS = 450;

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

function shouldRetryUnauthorizedMutation(
  method: string | null | undefined,
  status: number,
  hasRetriedUnauthorizedMutation: boolean
): boolean {
  if (hasRetriedUnauthorizedMutation || status !== 401) {
    return false;
  }

  const normalizedMethod = (method ?? "GET").toUpperCase();
  return (
    normalizedMethod === "POST" ||
    normalizedMethod === "PUT" ||
    normalizedMethod === "PATCH" ||
    normalizedMethod === "DELETE"
  );
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {},
  hasRetriedUnauthorizedMutation = false
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options;
  const method = (fetchOptions.method ?? "GET").toUpperCase();

  const headers = new Headers(fetchOptions.headers);
  headers.set("Content-Type", "application/json");
  const storedAuthToken = getStoredBackendSessionToken();
  if (storedAuthToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${storedAuthToken}`);
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
    if (shouldRetryUnauthorizedMutation(method, response.status, hasRetriedUnauthorizedMutation)) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, AUTH_MUTATION_401_RETRY_DELAY_MS);
      });
      return request<T>(endpoint, options, true);
    }

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

  const headers = new Headers(fetchOptions.headers);
  const storedAuthToken = getStoredBackendSessionToken();
  if (storedAuthToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${storedAuthToken}`);
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
    return await fetch(url, { ...config, signal: controller.signal });
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
