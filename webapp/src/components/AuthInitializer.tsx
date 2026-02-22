import React from "react";

interface AuthInitializerProps {
  children: React.ReactNode;
}

/**
 * Auth Initializer for Better Auth
 *
 * Better Auth uses HTTP-only cookies for session management,
 * so we don't need to manually sync tokens or user state.
 * The session is automatically included in all requests via credentials: "include".
 *
 * This component is kept for backwards compatibility but is now a simple passthrough.
 */
export function AuthInitializer({ children }: AuthInitializerProps) {
  return <>{children}</>;
}
