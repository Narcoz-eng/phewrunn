import { createAuthClient } from "better-auth/react";
import { useState, useEffect, useCallback, createContext, useContext, createElement } from "react";
import type { ReactNode } from "react";

// Get the backend URL
const getBaseUrl = () => {
  const envBackendUrl = import.meta.env.VITE_BACKEND_URL?.trim();
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

    // Prefer same-origin in deployed environments so a committed preview URL
    // does not send auth/session traffic to a different backend.
    if (isKnownDeployedHost || (!isLocalhost && protocol === "https:")) {
      return origin;
    }
  }
  if (envBackendUrl) {
    return envBackendUrl;
  }
  return "http://localhost:3000";
};

const baseURL = getBaseUrl();
console.log("[Auth] Using backend URL:", baseURL);

// Create the Better Auth client
// Better Auth expects baseURL to be the server root, it appends /api/auth/* itself
export const authClient = createAuthClient({
  baseURL,
  basePath: "/api/auth", // Explicitly set the auth path
  fetchOptions: {
    credentials: "include",
  },
});

console.log("[Auth] Better Auth client initialized with baseURL:", baseURL);

// Export auth functions from client
export const { signIn, signUp, signOut } = authClient;

// Auth user interface
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  isVerified?: boolean;
}

// Session state
interface SessionState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

// Auth context
interface AuthContextType extends SessionState {
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Fetch session from backend using /api/me endpoint
// This endpoint uses our custom middleware that supports Bearer tokens
async function fetchSession(): Promise<AuthUser | null> {
  try {
    // Get token from localStorage as fallback for cross-origin issues
    const token = localStorage.getItem("auth-token");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Use /api/me which supports Bearer token auth via our middleware
    const response = await fetch(`${baseURL}/api/me`, {
      credentials: "include",
      headers,
    });

    if (!response.ok) {
      console.log("[Auth] Session response not ok:", response.status);
      // Clear invalid token
      if (response.status === 401) {
        localStorage.removeItem("auth-token");
      }
      return null;
    }

    const text = await response.text();
    console.log("[Auth] Session response text:", text);

    // Handle null or empty responses
    if (!text || text === "null" || text === "undefined") {
      return null;
    }

    try {
      const data = JSON.parse(text);

      // /api/me returns user data directly wrapped in { data: user }
      const user = data.data || data;
      if (user && user.id) {
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          isVerified: user.isVerified,
        };
      }
    } catch (parseError) {
      console.log("[Auth] Failed to parse session response:", parseError);
    }

    return null;
  } catch (error) {
    console.error("[Auth] Failed to fetch session:", error);
    return null;
  }
}

// Auth Provider component
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const refetch = useCallback(async () => {
    try {
      const user = await fetchSession();
      setState({
        user,
        isLoading: false,
        isAuthenticated: !!user,
      });
    } catch {
      setState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut();
      // Clear stored token
      localStorage.removeItem("auth-token");
      setState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });
    } catch (error) {
      console.error("[Auth] Logout error:", error);
      // Still clear local state on error
      localStorage.removeItem("auth-token");
      setState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });
    }
  }, []);

  // Initial session check
  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      const user = await fetchSession();
      if (mounted) {
        setState({
          user,
          isLoading: false,
          isAuthenticated: !!user,
        });
      }
    };

    checkSession();

    return () => {
      mounted = false;
    };
  }, []);

  return createElement(
    AuthContext.Provider,
    { value: { ...state, refetch, logout } },
    children
  );
}

// Hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return {
    user: context.user,
    isAuthenticated: context.isAuthenticated,
    isReady: !context.isLoading,
    isPending: context.isLoading,
    signOut: context.logout,
    refetch: context.refetch,
  };
}

// Session hook for ProtectedRoute/GuestRoute compatibility
export function useSession() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useSession must be used within AuthProvider");
  }

  return {
    data: context.user ? { user: context.user } : null,
    isPending: context.isLoading,
  };
}

// Legacy compatibility
export function usePrivyAuth() {
  const auth = useAuth();
  return {
    user: auth.user
      ? {
          id: auth.user.id,
          email: auth.user.email,
          walletAddress: null,
          linkedAccounts: [],
        }
      : null,
    isAuthenticated: auth.isAuthenticated,
    isReady: auth.isReady,
    login: () => console.warn("login() - use form-based login"),
    logout: auth.signOut,
  };
}

// Sign up function - use direct fetch for reliability
export async function signUpWithEmail(email: string, password: string, name: string) {
  console.log("[Auth] Attempting sign up for:", email);
  try {
    const response = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, name }),
    });

    // Try to parse JSON, but handle empty responses
    let data: { message?: string; code?: string; token?: string; [key: string]: unknown } | null = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        console.log("[Auth] Response is not JSON:", text);
      }
    }
    console.log("[Auth] Sign up response:", response.status, data);

    if (!response.ok) {
      return { error: { message: data?.message || data?.code || "Failed to create account" } };
    }

    // Store token in localStorage for cross-origin auth
    if (data?.token) {
      localStorage.setItem("auth-token", data.token);
    }

    return { data: data || { success: true } };
  } catch (error) {
    console.error("[Auth] Sign up error:", error);
    return { error: { message: error instanceof Error ? error.message : "Sign up failed" } };
  }
}

// Sign in function - use direct fetch for reliability
export async function signInWithEmail(email: string, password: string) {
  console.log("[Auth] Attempting sign in for:", email);
  try {
    const response = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });

    // Try to parse JSON, but handle empty responses
    let data: { message?: string; code?: string; token?: string; [key: string]: unknown } | null = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        console.log("[Auth] Response is not JSON:", text);
      }
    }
    console.log("[Auth] Sign in response:", response.status, data);

    if (!response.ok) {
      return { error: { message: data?.message || data?.code || "Invalid email or password" } };
    }

    // Store token in localStorage for cross-origin auth
    if (data?.token) {
      localStorage.setItem("auth-token", data.token);
    }

    return { data: data || { success: true } };
  } catch (error) {
    console.error("[Auth] Sign in error:", error);
    return { error: { message: error instanceof Error ? error.message : "Sign in failed" } };
  }
}

// Sign in with Google - use direct redirect
export async function signInWithGoogle() {
  console.log("[Auth] Redirecting to Google sign in");
  // Redirect to Google OAuth
  const callbackURL = encodeURIComponent(window.location.origin);
  window.location.href = `${baseURL}/api/auth/sign-in/social?provider=google&callbackURL=${callbackURL}`;
}

// Forgot password - request password reset email
export async function forgotPassword(email: string) {
  console.log("[Auth] Requesting password reset for:", email);
  try {
    const response = await fetch(`${baseURL}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email,
        redirectTo: "/reset-password",
      }),
    });

    let data: { message?: string; code?: string; [key: string]: unknown } | null = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        console.log("[Auth] Response is not JSON:", text);
      }
    }
    console.log("[Auth] Forgot password response:", response.status, data);

    if (!response.ok) {
      return { error: { message: data?.message || data?.code || "Failed to send reset email" } };
    }

    return { data: data || { success: true } };
  } catch (error) {
    console.error("[Auth] Forgot password error:", error);
    return { error: { message: error instanceof Error ? error.message : "Failed to send reset email" } };
  }
}

// Reset password with token
export async function resetPassword(newPassword: string, token: string) {
  console.log("[Auth] Resetting password with token");
  try {
    const response = await fetch(`${baseURL}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ newPassword, token }),
    });

    let data: { message?: string; code?: string; [key: string]: unknown } | null = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        console.log("[Auth] Response is not JSON:", text);
      }
    }
    console.log("[Auth] Reset password response:", response.status, data);

    if (!response.ok) {
      return { error: { message: data?.message || data?.code || "Failed to reset password" } };
    }

    return { data: data || { success: true } };
  } catch (error) {
    console.error("[Auth] Reset password error:", error);
    return { error: { message: error instanceof Error ? error.message : "Failed to reset password" } };
  }
}

// Sync a Privy-authenticated user to our backend, getting back a Better Auth session token
export async function syncPrivySession(
  privyUserId: string,
  email?: string,
  name?: string,
  privyIdToken?: string
): Promise<{ token: string; user: AuthUser } | null> {
  try {
    const response = await fetch(`${baseURL}/api/auth/privy-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ privyUserId, email, name, privyIdToken }),
    });

    const text = await response.text();
    if (!text) return null;

    let data: { token?: string; user?: AuthUser; error?: { message?: string } } | null = null;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("[Auth] Failed to parse privy-sync response:", text);
      return null;
    }

    if (!response.ok || !data?.token || !data?.user) {
      console.error("[Auth] privy-sync failed:", data?.error?.message ?? "unknown error");
      return null;
    }

    // Store the session token for Bearer auth
    localStorage.setItem("auth-token", data.token);
    return { token: data.token, user: data.user };
  } catch (error) {
    console.error("[Auth] syncPrivySession error:", error);
    return null;
  }
}

// Check if running in an iframe
export function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
