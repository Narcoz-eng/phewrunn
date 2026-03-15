import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/lib/auth-client";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { GuestRoute } from "@/components/GuestRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { PrivyWalletProvider } from "@/components/PrivyWalletProvider";
import { SolanaWalletProvider } from "@/components/SolanaWalletProvider";
import { AuthInitializer } from "@/components/AuthInitializer";
import { isPossiblePublicProfileSegment } from "@/lib/profile-path";
import { importWithRecovery } from "@/lib/lazy-with-recovery";

const lazyPage = <T extends { default: ComponentType<any> }>(
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
const Terms = lazyPage(() => import("./pages/Terms"), "route:terms");
const Privacy = lazyPage(() => import("./pages/Privacy"), "route:privacy");
const Docs = lazyPage(() => import("./pages/Docs"), "route:docs");
const NotFound = lazyPage(() => import("./pages/NotFound"), "route:not-found");

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <SolanaWalletProvider>
        <PrivyWalletProvider>
          <AuthProvider>
            <AuthInitializer>
              <TooltipProvider>
                <Toaster />
                <Sonner />
                <BrowserRouter>
                  <Suspense fallback={<PageSkeleton />}>
                    <MissingHandleGate>
                      <Routes>
                  <Route
                    path="/"
                    element={
                      <ProtectedRoute>
                        <Feed />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/profile"
                    element={
                      <ProtectedRoute>
                        <Profile />
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
                    element={<UserProfile />}
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
                        <Notifications />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/leaderboard"
                    element={
                      <ProtectedRoute>
                        <Leaderboard />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/post/:postId"
                    element={
                      <ProtectedRoute>
                        <PostDetail />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/token/:tokenAddress"
                    element={
                      <ProtectedRoute>
                        <TokenPage />
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
                  <Route path="/:userId" element={<PublicHandleProfileRoute />} />
                  <Route path="*" element={<NotFound />} />
                      </Routes>
                    </MissingHandleGate>
                  </Suspense>
                </BrowserRouter>
              </TooltipProvider>
            </AuthInitializer>
          </AuthProvider>
        </PrivyWalletProvider>
      </SolanaWalletProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
