import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/lib/auth-client";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { GuestRoute } from "@/components/GuestRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { PrivyWalletProvider } from "@/components/PrivyWalletProvider";
import { SolanaWalletProvider } from "@/components/SolanaWalletProvider";
import { AuthInitializer } from "@/components/AuthInitializer";
import { isPossiblePublicProfileSegment } from "@/lib/profile-path";
import { RealtimeProvider } from "@/lib/realtime/provider";

// Lazy load page components
const Feed = lazy(() => import("./pages/Feed"));
const Profile = lazy(() => import("./pages/Profile"));
const UserProfile = lazy(() => import("./pages/UserProfile"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Admin = lazy(() => import("./pages/Admin"));
const HandleOnboarding = lazy(() => import("./pages/HandleOnboarding"));
const Login = lazy(() => import("./pages/Login"));
const PostDetail = lazy(() => import("./pages/PostDetail"));
const TokenPage = lazy(() => import("./pages/TokenPage"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Docs = lazy(() => import("./pages/Docs"));
const NotFound = lazy(() => import("./pages/NotFound"));

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
            <RealtimeProvider>
              <AuthInitializer>
                <TooltipProvider>
                  <Toaster />
                  <Sonner />
                  <BrowserRouter>
                    <Suspense fallback={<PageSkeleton />}>
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
                    </Suspense>
                  </BrowserRouter>
                </TooltipProvider>
              </AuthInitializer>
            </RealtimeProvider>
          </AuthProvider>
        </PrivyWalletProvider>
      </SolanaWalletProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
