import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Post } from "@/types";
import { PostCard } from "@/components/feed/PostCard";
import { PostCardSkeleton } from "@/components/feed/PostCardSkeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { useSession } from "@/lib/auth-client";

export default function PostDetail() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const { data: session } = useSession();

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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={handleBack}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-semibold text-lg">Post</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto">
        <div className="bg-card border-x border-border min-h-[calc(100vh-3.5rem)]">
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
              currentUserId={session?.user?.id}
              onLike={async (postId) => {
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
