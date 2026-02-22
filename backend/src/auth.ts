/**
 * Auth module - Better Auth server-side authentication
 *
 * This module re-exports the Better Auth authentication utilities
 * for use throughout the backend.
 */

export {
  betterAuthMiddleware,
  requireAuth,
  auth,
  type AuthUser,
  type SimpleUser,
  type AuthVariables,
} from "./middleware/auth";
