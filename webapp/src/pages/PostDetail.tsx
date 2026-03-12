import { useParams, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Post } from "@/types";
import { PostCard } from "@/components/feed/PostCard";
import { PostCardSkeleton } from "@/components/feed/PostCardSkeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { findCachedPost } from "@/lib/post-query-cache";

export default function PostDetail() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session, canPerformAuthenticatedWrites } = useSession();
  const cachedPost = useMemo(
    () => findCachedPost(queryClient, postId),
    [postId, queryClient]
  );

  const {
    data: post,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["post", postId],
    queryFn: async () => {
      if (!postId) throw new Error("Post ID is required");
      const data = await api.get<Post>(`/api/posts/${postId}`);
      return data;
    },
    enabled: !!postId,
    initialData: cachedPost ?? undefined,
    initialDataUpdatedAt: cachedPost ? Date.now() : undefined,
    staleTime: 30000,
    retry: 1,
  });

  const handleBack = () => {
    // Check if there's history to go back to
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  const guardPostInteraction = () => {
    if (!session?.user) {
      toast.info("Sign in to interact with posts.");
      return false;
    }

    if (!canPerformAuthenticatedWrites) {
      toast.info("Signing you in...");
      return false;
    }

    return true;
  };

  return (
      <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="app-topbar">
        <div className="mx-auto flex h-[4.4rem] max-w-[780px] items-center gap-3 px-4 sm:px-5">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-2xl border border-border/60 bg-white/60 shadow-[0_18px_34px_-28px_hsl(var(--foreground)/0.18)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
            onClick={handleBack}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-semibold text-lg">Post</h1>
        </div>
      </header>

      <main className="app-page-shell pt-5">
        <div className="app-surface min-h-[calc(100vh-4rem)] overflow-hidden">
          {isLoading ? (
            <PostCardSkeleton />
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-4">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-lg">
                  Post not found
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  This post may have been deleted or doesn't exist.
                </p>
              </div>
              <Button variant="outline" onClick={() => navigate("/")}>
                Go to Feed
              </Button>
            </div>
          ) : post ? (
            <PostCard
              post={post}
              currentUserId={canPerformAuthenticatedWrites ? session?.user?.id : undefined}
              enableRealtimePricePolling
              onLike={async (postId) => {
                if (!guardPostInteraction()) return;
                try {
                  if (post.isLiked) {
                    await api.delete(`/api/posts/${postId}/like`);
                  } else {
                    await api.post(`/api/posts/${postId}/like`);
                  }
                } catch (e) {
                  console.error("Like failed:", e);
                }
              }}
              onRepost={async (postId) => {
                if (!guardPostInteraction()) return;
                try {
                  if (post.isReposted) {
                    await api.delete(`/api/posts/${postId}/repost`);
                  } else {
                    await api.post(`/api/posts/${postId}/repost`);
                  }
                } catch (e) {
                  console.error("Repost failed:", e);
                }
              }}
              onComment={async (postId, content) => {
                if (!guardPostInteraction()) return;
                try {
                  await api.post(`/api/posts/${postId}/comments`, { content });
                } catch (e) {
                  console.error("Comment failed:", e);
                }
              }}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}
