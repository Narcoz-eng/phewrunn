import { Component, createContext, useContext, type ReactNode, type ErrorInfo } from "react";
import { PrivyProvider } from "@privy-io/react-auth";

interface PrivyWalletProviderProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

// Context to signal whether Privy is available
export const PrivyAvailableContext = createContext<boolean>(false);

export function usePrivyAvailable() {
  return useContext(PrivyAvailableContext);
}

class PrivyErrorBoundary extends Component<PrivyWalletProviderProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[PrivyWalletProvider] Privy init error:", error.message, info);
  }

  render() {
    if (this.state.hasError) {
      console.warn("[PrivyWalletProvider] Privy failed to initialize, falling back to non-Privy mode");
      // Render children but signal Privy is NOT available
      return (
        <PrivyAvailableContext.Provider value={false}>
          {this.props.children}
        </PrivyAvailableContext.Provider>
      );
    }
    return this.props.children;
  }
}

function PrivyProviderInner({ children }: PrivyWalletProviderProps) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

  if (!appId) {
    console.warn("[PrivyWalletProvider] Missing VITE_PRIVY_APP_ID — Privy login disabled");
    return (
      <PrivyAvailableContext.Provider value={false}>
        {children}
      </PrivyAvailableContext.Provider>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "dark",
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
      }}
    >
      <PrivyAvailableContext.Provider value={true}>
        {children}
      </PrivyAvailableContext.Provider>
    </PrivyProvider>
  );
}

export function PrivyWalletProvider({ children }: PrivyWalletProviderProps) {
  return (
    <PrivyErrorBoundary>
      <PrivyProviderInner>{children}</PrivyProviderInner>
    </PrivyErrorBoundary>
  );
}
