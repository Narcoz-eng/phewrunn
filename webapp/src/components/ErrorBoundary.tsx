import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

function isChunkLoadError(error: Error | undefined): boolean {
  const message = error ? `${error.name}: ${error.message}` : "";
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("ChunkLoadError") ||
    message.includes("error loading dynamically imported module")
  );
}

function reloadWithCacheBust() {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("__phew_chunk_recover", String(Date.now()));
  void Promise.allSettled([
    navigator.serviceWorker?.getRegistrations?.()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)))),
    typeof window.caches !== "undefined"
      ? window.caches.keys().then((keys) => Promise.all(keys.map((key) => window.caches.delete(key))))
      : Promise.resolve(),
  ]).finally(() => {
    window.location.replace(nextUrl.toString());
  });
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error.message, error.stack, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      const chunkLoadError = isChunkLoadError(this.state.error);
      return this.props.fallback || (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#09090b', color: '#fafafa' }}>
          <div style={{ textAlign: 'center', padding: '2rem', maxWidth: '500px' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              {chunkLoadError ? 'App update required' : 'Something went wrong'}
            </h1>
            <p style={{ color: '#a1a1aa', marginBottom: '1rem', fontSize: '0.875rem' }}>
              {chunkLoadError
                ? 'A new app version is available. Reload to fetch the latest files.'
                : this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={chunkLoadError ? reloadWithCacheBust : () => window.location.reload()}
              style={{ padding: '0.5rem 1rem', background: '#3b82f6', color: 'white', borderRadius: '0.375rem', border: 'none', cursor: 'pointer' }}
            >
              {chunkLoadError ? 'Reload app' : 'Refresh Page'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
