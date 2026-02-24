import { useState, useCallback, useEffect, useRef } from "react";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useSession, useAuth } from "@/lib/auth-client";
import { api, ApiError } from "@/lib/api";
import { Post, User } from "@/types";
import { PostCard } from "@/components/feed/PostCard";
import { PostCardSkeleton, ProfileCardSkeleton } from "@/components/feed/PostCardSkeleton";
import { CreatePost } from "@/components/feed/CreatePost";
import { LevelBar } from "@/components/feed/LevelBar";
import { FeedHeader, FeedTab } from "@/components/feed/FeedHeader";
import { AnnouncementBanner } from "@/components/feed/AnnouncementBanner";
import { TrendingSection } from "@/components/feed/TrendingSection";
import { SearchBar } from "@/components/feed/SearchBar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, Trophy, TrendingUp, AlertCircle } from "lucide-react";
import { getAvatarUrl } from "@/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface FeedPage {
  items: Post[];
  hasMore: boolean;
  nextCursor: string | null;
}

// Error Boundary Component for Feed
function FeedError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertCircle className="h-10 w-10 text-destructive" />
      </div>
      <div>
        <p className="font-semibold text-foreground text-lg">Failed to load posts</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          {error.message || "Something went wrong. Please try again."}
        </p>
      </div>
      <Button onClick={onRetry} variant="outline" className="mt-2">
        <RefreshCw className="h-4 w-4 mr-2" />
        Try Again
      </Button>
    </div>
  );
}

export default function Feed() {
  const { data: session } = useSession();
  const { signOut } = useAuth();
  const { logout: privyLogout } = usePrivy();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<FeedTab>("latest");
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Update URL when search changes
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (value) {
      setSearchParams({ search: value });
    } else {
      setSearchParams({});
    }
  }, [setSearchParams]);

  // Fetch current user with React Query
  const {
    data: user,
    isLoading: isLoadingUser,
    error: userError,
    refetch: refetchUser,
  } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      const data = await api.get<User>("/api/me");
      return data;
    },
    enabled: !!session?.user,
    retry: 2,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: false,
  });

  // Fetch posts with React Query
  const {
    data: postsPages,
    isLoading: isLoadingPosts,
    error: postsError,
    refetch: refetchPosts,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ["posts", activeTab, searchQuery],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      let endpoint = "/api/posts";
      const params = new URLSearchParams();

      if (activeTab === "latest") {
        params.set("sort", "latest");
      } else if (activeTab === "trending") {
        params.set("sort", "trending");
      } else if (activeTab === "following") {
        params.set("following", "true");
      }

      // Add search query if present
      if (searchQuery && searchQuery.length >= 3) {
        params.set("search", searchQuery);
      }
      params.set("limit", "20");
      if (pageParam) {
        params.set("cursor", pageParam);
      }

      if (params.toString()) {
        endpoint += `?${params.toString()}`;
      }

      const response = await api.raw(endpoint);
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new ApiError(
          json?.error?.message || `Request failed with status ${response.status}`,
          response.status,
          json?.error || json
        );
      }

      const json = await response.json().catch(() => ({}));
      const items = Array.isArray(json?.data) ? (json.data as Post[]) : [];
      const nextCursor = typeof json?.nextCursor === "string" ? json.nextCursor : null;

      return {
        items,
        nextCursor,
        hasMore: Boolean(json?.hasMore && nextCursor),
      } satisfies FeedPage;
    },
    getNextPageParam: (lastPage) => (lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined),
    enabled: !!session?.user,
    retry: 2,
    staleTime: 15000, // 15 seconds
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  const posts = postsPages?.pages.flatMap((page) => page.items) ?? [];
  const isRefreshing = isFetching && !isFetchingNextPage;

  const updateInfinitePosts = useCallback((updater: (post: Post) => Post) => {
    queryClient.setQueryData<InfiniteData<FeedPage>>(
      ["posts", activeTab, searchQuery],
      (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            items: page.items.map(updater),
          })),
        };
      }
    );
  }, [activeTab, queryClient, searchQuery]);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const node = loadMoreRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          void fetchNextPage();
        }
      },
      {
        root: null,
        rootMargin: "800px 0px",
        threshold: 0,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Create post mutation
  const createPostMutation = useMutation({
    mutationFn: async (content: string) => {
      const newPost = await api.post<Post>("/api/posts", { content });
      return newPost;
    },
    onSuccess: (newPost) => {
      // Add new post to the beginning of the first loaded page (if present)
      queryClient.setQueryData<InfiniteData<FeedPage>>(["posts", activeTab, searchQuery], (oldData) => {
        if (!oldData || oldData.pages.length === 0) {
          return oldData;
        }
        const [firstPage, ...restPages] = oldData.pages;
        if (!firstPage) return oldData;

        return {
          ...oldData,
          pages: [
            {
              ...firstPage,
              items: [newPost, ...firstPage.items],
            },
            ...restPages,
          ],
        };
      });
      toast.success("Alpha posted!");
      // Refresh user data in case level changed
      refetchUser();
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : "Failed to post";
      toast.error(message);
    },
  });

  // Like mutation
  const likeMutation = useMutation({
    mutationFn: async ({ postId, isLiked }: { postId: string; isLiked: boolean }) => {
      if (isLiked) {
        await api.delete(`/api/posts/${postId}/like`);
      } else {
        await api.post(`/api/posts/${postId}/like`);
      }
      return { postId, isLiked };
    },
    onSuccess: ({ postId, isLiked }) => {
      updateInfinitePosts((post) =>
        post.id === postId
          ? {
              ...post,
              isLiked: !isLiked,
              _count: {
                ...post._count,
                likes: post._count.likes + (isLiked ? -1 : 1),
              },
            }
          : post
      );
    },
  });

  // Repost mutation
  const repostMutation = useMutation({
    mutationFn: async ({ postId, isReposted }: { postId: string; isReposted: boolean }) => {
      if (isReposted) {
        await api.delete(`/api/posts/${postId}/repost`);
      } else {
        await api.post(`/api/posts/${postId}/repost`);
      }
      return { postId, isReposted };
    },
    onSuccess: ({ postId, isReposted }) => {
      updateInfinitePosts((post) =>
        post.id === postId
          ? {
              ...post,
              isReposted: !isReposted,
              _count: {
                ...post._count,
                reposts: post._count.reposts + (isReposted ? -1 : 1),
              },
            }
          : post
      );
    },
  });

  // Comment mutation
  const commentMutation = useMutation({
    mutationFn: async ({ postId, content }: { postId: string; content: string }) => {
      await api.post(`/api/posts/${postId}/comments`, { content });
      return { postId };
    },
    onSuccess: ({ postId }) => {
      toast.success("Comment added!");
      // Update comment count
      updateInfinitePosts((post) =>
        post.id === postId
          ? {
              ...post,
              _count: {
                ...post._count,
                comments: post._count.comments + 1,
              },
            }
          : post
      );
    },
    onError: () => {
      toast.error("Failed to add comment");
    },
  });

  // Handlers
  const handleCreatePost = async (content: string) => {
    await createPostMutation.mutateAsync(content);
  };

  const handleSignOut = async () => {
    await signOut();
    try {
      await privyLogout();
    } catch (error) {
      console.error("[Feed] Privy logout failed:", error);
    }
  };

  const handleLike = async (postId: string) => {
    const post = posts.find((p) => p.id === postId);
    if (post) {
      likeMutation.mutate({ postId, isLiked: post.isLiked });
    }
  };

  const handleRepost = async (postId: string) => {
    const post = posts.find((p) => p.id === postId);
    if (post) {
      repostMutation.mutate({ postId, isReposted: post.isReposted });
    }
  };

  const handleComment = async (postId: string, content: string) => {
    commentMutation.mutate({ postId, content });
  };

  const handleTabChange = (tab: FeedTab) => {
    setActiveTab(tab);
  };

  const handleRefresh = () => {
    refetchPosts();
  };

  const autoLoadEnabled = Boolean(hasNextPage);
  const showLoadMoreControls = Boolean(hasNextPage);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <FeedHeader
        user={user ?? null}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onLogout={handleSignOut}
      />

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* 1. Pinned Announcements (at very top) */}
        <AnnouncementBanner />

        {/* 2. Trending Now Section */}
        <TrendingSection />

        {/* 3. Search Bar (prominent, always visible) */}
        <SearchBar
          value={searchQuery}
          onChange={handleSearchChange}
          isLoading={isRefreshing && searchQuery.length >= 3}
        />

        {/* User Profile Card */}
        {isLoadingUser ? (
          <ProfileCardSkeleton className="mb-6" />
        ) : user ? (
          <div className="mb-6 p-5 bg-card border border-border rounded-xl shadow-sm">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 border-2 border-primary/30 ring-2 ring-background">
                <AvatarImage src={getAvatarUrl(user.id, user.image)} />
                <AvatarFallback className="bg-muted text-muted-foreground text-xl">
                  {user.name?.charAt(0) || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-lg truncate">{user.username || user.name}</h2>
                  <Trophy className="h-4 w-4 text-primary" />
                </div>
                <p className="text-muted-foreground truncate text-xs font-thin">{user.email}</p>
                {/* XP Display */}
                <p className="text-primary font-medium mt-3 text-lg">
                  {user.xp?.toLocaleString() || 0} XP
                </p>
              </div>
            </div>
            {/* Large Level Bar */}
            <div className="mt-5">
              <LevelBar level={user.level} size="xl" />
            </div>
          </div>
        ) : userError ? (
          <div className="mb-6 p-5 bg-card border border-destructive/30 rounded-xl">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm">Failed to load profile</span>
              <Button variant="ghost" size="sm" onClick={() => refetchUser()} className="ml-auto">
                Retry
              </Button>
            </div>
          </div>
        ) : null}

        {/* Create Post */}
        <div className="mb-6">
          <CreatePost
            user={user ?? null}
            onSubmit={handleCreatePost}
            isSubmitting={createPostMutation.isPending}
          />
        </div>

        {/* 4. Refresh Button and Tab Label */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-muted-foreground">
            {searchQuery.length >= 3 ? (
              `Search results for "${searchQuery}"`
            ) : (
              <>
                {activeTab === "latest" && "Latest Posts"}
                {activeTab === "trending" && "Trending Posts"}
                {activeTab === "following" && "Following"}
              </>
            )}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-8 px-3 gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
            <span className="text-xs">Refresh</span>
          </Button>
        </div>

        {/* Feed */}
        <div className="space-y-4">
          {isLoadingPosts ? (
            // Loading Skeletons
            <>
              {[0, 1, 2].map((i) => (
                <PostCardSkeleton
                  key={i}
                  showMarketData={i < 2}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${i * 0.1}s` }}
                />
              ))}
            </>
          ) : postsError ? (
            <FeedError
              error={postsError as Error}
              onRetry={() => refetchPosts()}
            />
          ) : posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
                {activeTab === "trending" ? (
                  <TrendingUp className="h-10 w-10 text-muted-foreground" />
                ) : (
                  <Sparkles className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <div>
                <p className="font-semibold text-foreground text-lg">
                  {searchQuery.length >= 3
                    ? "No results found"
                    : activeTab === "following"
                    ? "No posts from people you follow"
                    : "No alpha yet"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {searchQuery.length >= 3
                    ? `Try a different search term`
                    : activeTab === "following"
                    ? "Follow some traders to see their calls here"
                    : "Be the first to drop a call!"}
                </p>
              </div>
            </div>
          ) : (
            <>
              {posts.map((post, index) => (
                <div
                  key={post.id}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  <PostCard
                    post={post}
                    currentUserId={user?.id}
                    onLike={handleLike}
                    onRepost={handleRepost}
                    onComment={handleComment}
                  />
                </div>
              ))}

              {showLoadMoreControls ? (
                <div className="pt-2">
                  {autoLoadEnabled ? <div ref={loadMoreRef} className="h-1 w-full" aria-hidden="true" /> : null}

                  <div className="flex flex-col items-center gap-3 py-2">
                    {isFetchingNextPage ? (
                      <>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Loading more posts...
                        </div>
                        <PostCardSkeleton showMarketData={false} />
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void fetchNextPage()}
                        className="px-4"
                      >
                        Show more
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
