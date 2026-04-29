import {
  Component,
  lazy,
  Suspense,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/lib/auth-client";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { GuestRoute } from "@/components/GuestRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthInitializer } from "@/components/AuthInitializer";
import { V2AppShell } from "@/components/layout/V2AppShell";
import { PrivyWalletProvider } from "@/components/PrivyWalletProvider";
import { isPossiblePublicProfileSegment } from "@/lib/profile-path";
import { importWithRecovery } from "@/lib/lazy-with-recovery";

const lazyPage = <T extends { default: ComponentType<unknown> }>(
  loader: () => Promise<T>,
  scope: string
) => lazy(() => importWithRecovery(loader, scope));

// Lazy load page components
const Feed = lazyPage(() => import("./pages/Feed"), "route:feed");
const Profile = lazyPage(() => import("./pages/Profile"), "route:profile");
const UserProfile = lazyPage(() => import("./pages/UserProfile"), "route:user-profile");
const Notifications = lazyPage(() => import("./pages/Notifications"), "route:notifications");
const Leaderboard = lazyPage(() => import("./pages/Leaderboard"), "route:leaderboard");
const Admin = lazyPage(() => import("./pages/Admin"), "route:admin");
const HandleOnboarding = lazyPage(() => import("./pages/HandleOnboarding"), "route:welcome");
const Login = lazyPage(() => import("./pages/Login"), "route:login");
const PostDetail = lazyPage(() => import("./pages/PostDetail"), "route:post-detail");
const TokenPage = lazyPage(() => import("./pages/TokenPage"), "route:token-page");
const Terminal = lazyPage(() => import("./pages/Terminal"), "route:terminal");
const BundleChecker = lazyPage(() => import("./pages/BundleChecker"), "route:bundle-checker");
const CommunitiesIndexPage = lazyPage(() => import("./pages/CommunitiesIndexPage"), "route:communities-index");
const CommunityPage = lazyPage(() => import("./pages/CommunityPage"), "route:community-page");
const RaidsIndexPage = lazyPage(() => import("./pages/RaidsIndexPage"), "route:raids-index");
const RaidPage = lazyPage(() => import("./pages/RaidPage"), "route:raid-page");
const Terms = lazyPage(() => import("./pages/Terms"), "route:terms");
const Privacy = lazyPage(() => import("./pages/Privacy"), "route:privacy");
const Docs = lazyPage(() => import("./pages/Docs"), "route:docs");
const NotFound = lazyPage(() => import("./pages/NotFound"), "route:not-found");
const AccessCodeEntry = lazyPage(() => import("./pages/AccessCodeEntry"), "route:access-code");
const FeedCardLab = import.meta.env.DEV
  ? lazyPage(() => import("./pages/dev/FeedCardLab"), "route:dev-feed-card-lab")
  : null;

// Loading fallback component
function PageSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="app-page-shell space-y-4">
        <Skeleton className="h-16 w-full rounded-[28px]" />
        <Skeleton className="h-64 w-full rounded-[28px]" />
        <Skeleton className="h-32 w-full rounded-[28px]" />
        <Skeleton className="h-32 w-full rounded-[28px]" />
      </div>
    </div>
  );
}

function PublicHandleProfileRoute() {
  const { userId } = useParams<{ userId: string }>();

  if (!isPossiblePublicProfileSegment(userId)) {
    return <NotFound />;
  }

  return <UserProfile />;
}

function ProductContentSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-[18px] bg-white/[0.05]" />
        <Skeleton className="h-32 w-full rounded-[18px] bg-white/[0.05]" />
        <Skeleton className="h-56 w-full rounded-[18px] bg-white/[0.05]" />
      </div>
      <div className="hidden space-y-3 lg:block">
        <Skeleton className="h-28 w-full rounded-[18px] bg-white/[0.05]" />
        <Skeleton className="h-44 w-full rounded-[18px] bg-white/[0.05]" />
      </div>
    </div>
  );
}

class AppRouteErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string | null }
> {
  state = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Route failed to render.",
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[AppRouteErrorBoundary] route render failed", error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-white">
        <div className="max-w-md rounded-[24px] border border-white/10 bg-white/[0.04] p-6 text-center shadow-2xl">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-lime-300/80">
            App runtime recovered
          </div>
          <h1 className="mt-3 text-2xl font-bold">This route failed to load.</h1>
          <p className="mt-2 text-sm leading-6 text-white/60">
            {this.state.message ?? "Reload the app to request a fresh route chunk."}
          </p>
          <button
            type="button"
            className="mt-5 rounded-[14px] border border-lime-300/30 bg-lime-300/15 px-4 py-2 text-sm font-semibold text-lime-100"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

const WithSolanaRuntime = lazy(() =>
  import("@/components/SolanaRouteProvider").then((mod) => ({
    default: mod.default,
  }))
);

function WithProductShell({ children }: { children: ReactNode }) {
  return (
    <V2AppShell>
      <Suspense fallback={<ProductContentSkeleton />}>{children}</Suspense>
    </V2AppShell>
  );
}

function hasCompletedHandle(username: string | null | undefined): boolean {
  return typeof username === "string" && username.trim().length > 0;
}

function MissingHandleGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user, isAuthenticated, isReady } = useAuth();

  if (!isReady || !isAuthenticated || !user || hasCompletedHandle(user.username)) {
    return <>{children}</>;
  }

  if (location.pathname === "/welcome") {
    return <>{children}</>;
  }

  return (
    <Navigate
      to="/welcome"
      replace
      state={{ from: `${location.pathname}${location.search}${location.hash}` }}
    />
  );
}

function AuthAwareNotFoundRoute() {
  const location = useLocation();
  const { isAuthenticated, hasLiveSession, isReady } = useAuth();

  if (!isReady) {
    return <PageSkeleton />;
  }

  if (!isAuthenticated || !hasLiveSession) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  return <NotFound />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        const maybeStatus =
          typeof error === "object" && error !== null && "status" in error
            ? Number((error as { status?: unknown }).status)
            : null;

        if (maybeStatus === 401 || maybeStatus === 403 || maybeStatus === 404) {
          return false;
        }
        if (maybeStatus === 429) {
          return failureCount < 1;
        }
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
      staleTime: 15_000,
      gcTime: 5 * 60 * 1000,
    },
  },
});

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
};

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        {...pageTransition}
        style={{ minHeight: "100vh" }}
      >
        <Routes location={location}>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <WithSolanaRuntime>
                    <Feed />
                  </WithSolanaRuntime>
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <WithSolanaRuntime>
                    <Profile />
                  </WithSolanaRuntime>
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/welcome"
            element={
              <ProtectedRoute allowMissingUsername>
                <HandleOnboarding />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile/:userId"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <WithSolanaRuntime>
                    <UserProfile />
                  </WithSolanaRuntime>
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <Admin />
              </ProtectedRoute>
            }
          />
          <Route
            path="/notifications"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <Notifications />
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/leaderboard"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <Leaderboard />
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/post/:postId"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <WithSolanaRuntime>
                    <PostDetail />
                  </WithSolanaRuntime>
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/token/:tokenAddress"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <WithSolanaRuntime>
                    <TokenPage />
                  </WithSolanaRuntime>
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/terminal"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <WithSolanaRuntime>
                    <Terminal />
                  </WithSolanaRuntime>
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/bundle-checker"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <BundleChecker />
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/communities"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <CommunitiesIndexPage />
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/communities/:tokenAddress"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <CommunityPage />
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/raids"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <RaidsIndexPage />
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/raids/:tokenAddress/:raidId"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <RaidPage />
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/login"
            element={
              <GuestRoute>
                <Login />
              </GuestRoute>
            }
          />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/access-code" element={<AccessCodeEntry />} />
          {FeedCardLab ? (
            <Route
              path="/dev/feed-cards"
              element={
                <WithProductShell>
                  <FeedCardLab />
                </WithProductShell>
              }
            />
          ) : null}
          <Route
            path="/:userId"
            element={
              <ProtectedRoute>
                <WithProductShell>
                  <WithSolanaRuntime>
                    <PublicHandleProfileRoute />
                  </WithSolanaRuntime>
                </WithProductShell>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<AuthAwareNotFoundRoute />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <PrivyWalletProvider>
        <AuthProvider>
          <AuthInitializer>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <AppRouteErrorBoundary>
                  <Suspense fallback={<PageSkeleton />}>
                    <MissingHandleGate>
                      <AnimatedRoutes />
                    </MissingHandleGate>
                  </Suspense>
                </AppRouteErrorBoundary>
              </BrowserRouter>
            </TooltipProvider>
          </AuthInitializer>
        </AuthProvider>
      </PrivyWalletProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
