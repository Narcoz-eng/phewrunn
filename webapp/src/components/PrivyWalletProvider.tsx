import { Component, createContext, useContext, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";

interface PrivyWalletProviderProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

const SHOULD_LOG_PRIVY_PROVIDER = import.meta.env.DEV;

export const PrivyAvailableContext = createContext<boolean>(false);
export const PrivyProviderInstanceContext = createContext<string | null>(null);

export function usePrivyAvailable() {
  return useContext(PrivyAvailableContext);
}

export function usePrivyProviderInstanceId() {
  return useContext(PrivyProviderInstanceContext);
}

function createPrivyProviderInstanceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `privy_provider_${Math.random().toString(36).slice(2, 12)}_${Date.now().toString(36)}`;
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
      return (
        <PrivyProviderInstanceContext.Provider value={null}>
          <PrivyAvailableContext.Provider value={false}>
            {this.props.children}
          </PrivyAvailableContext.Provider>
        </PrivyProviderInstanceContext.Provider>
      );
    }
    return this.props.children;
  }
}

function PrivyProviderInner({ children }: PrivyWalletProviderProps) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;
  const clientId = import.meta.env.VITE_PRIVY_CLIENT_ID as string | undefined;
  const providerInstanceIdRef = useRef<string>(createPrivyProviderInstanceId());
  const providerInstanceId = providerInstanceIdRef.current;

  useEffect(() => {
    if (!appId || !SHOULD_LOG_PRIVY_PROVIDER) {
      return;
    }

    console.info("[PrivyWalletProvider] mounted", {
      providerInstanceId,
      appId,
      href: typeof window !== "undefined" ? window.location.href : null,
    });

    return () => {
      console.info("[PrivyWalletProvider] unmounted", {
        providerInstanceId,
      });
    };
  }, [appId, providerInstanceId]);

  if (!appId) {
    console.warn("[PrivyWalletProvider] Missing VITE_PRIVY_APP_ID - Privy login disabled");
    return (
      <PrivyProviderInstanceContext.Provider value={null}>
        <PrivyAvailableContext.Provider value={false}>
          {children}
        </PrivyAvailableContext.Provider>
      </PrivyProviderInstanceContext.Provider>
    );
  }

  return (
    <PrivyProviderInstanceContext.Provider value={providerInstanceId}>
      <PrivyProvider
        appId={appId}
        clientId={clientId}
        config={{
          appearance: {
            theme: "dark",
          },
          loginMethods: ["email", "twitter"],
          embeddedWallets: {
            showWalletUIs: false,
            ethereum: { createOnLogin: "off" },
            solana: { createOnLogin: "off" },
          },
        }}
      >
        <PrivyAvailableContext.Provider value={true}>
          {children}
        </PrivyAvailableContext.Provider>
      </PrivyProvider>
    </PrivyProviderInstanceContext.Provider>
  );
}

export function PrivyWalletProvider({ children }: PrivyWalletProviderProps) {
  return (
    <PrivyErrorBoundary>
      <PrivyProviderInner>{children}</PrivyProviderInner>
    </PrivyErrorBoundary>
  );
}
