import { createMiddleware } from "hono/factory";
import { auth } from "../lib/auth.js";

// Define the user type that will be available in context
// This matches the Better Auth user structure
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  // SocialFi fields
  walletAddress: string | null;
  walletProvider: string | null;
  walletConnectedAt: Date | null;
  username: string | null;
  level: number;
  xp: number;
  bio: string | null;
  isAdmin: boolean;
  isBanned: boolean;
  isVerified: boolean;
  lastUsernameUpdate: Date | null;
  lastPhotoUpdate: Date | null;
}

// Simplified user type for routes (backwards compatible with old PrivyUser)
export interface SimpleUser {
  id: string;
  email: string | null;
  walletAddress: string | null;
}

// Type for the Hono context variables
export type AuthVariables = {
  user: SimpleUser | null;
  session: Awaited<ReturnType<typeof auth.api.getSession>> | null;
};

/**
 * Auth middleware that verifies Better Auth sessions
 * Supports both cookie-based sessions and Bearer token auth
 * Sets user to null if no session or invalid session
 * Does NOT block requests - use requireAuth for protected routes
 */
export const betterAuthMiddleware = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;

    // First try cookie-based session.
    try {
      session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });
    } catch (error) {
      console.error("Failed to resolve cookie session:", error);
    }

    // If no cookie session, try Bearer token. Keep this separate so cookie lookup
    // failures do not automatically skip bearer auth.
    if (!session?.user) {
      try {
        const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
        if (authHeader && /^bearer\s+/i.test(authHeader)) {
          const token = authHeader.replace(/^bearer\s+/i, "").trim();
          const bearerSession = await auth.api.getSessionByToken(token);
          if (bearerSession?.user) {
            session = bearerSession as Awaited<ReturnType<typeof auth.api.getSession>>;
          }
        }
      } catch (error) {
        console.error("Failed to resolve bearer session:", error);
      }
    }

    if (session?.user) {
      // Create simplified user object for backwards compatibility
      const user: SimpleUser = {
        id: session.user.id,
        email: session.user.email || null,
        walletAddress: (session.user as AuthUser).walletAddress || null,
      };

      c.set("user", user);
      c.set("session", session);
    } else {
      c.set("user", null);
      c.set("session", null);
    }

    return next();
  }
);

/**
 * Middleware that requires authentication
 * Returns 401 if no valid session
 */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const user = c.get("user");

    if (!user) {
      return c.json(
        { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
        401
      );
    }

    return next();
  }
);

// Export the Better Auth instance for use in routes
export { auth };
