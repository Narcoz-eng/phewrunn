import React from "react";

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * Simple Auth Provider wrapper for Better Auth
 * Better Auth handles session management via cookies automatically,
 * so this is mainly a placeholder for any auth-related context if needed.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  return <>{children}</>;
}

// Keep the old export name for backwards compatibility during migration
export { AuthProvider as PrivyProvider };
