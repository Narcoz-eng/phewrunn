import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  MessageSquare,
  RadioTower,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { FeedV2PostCard } from "@/components/feed/FeedV2PostCard";
import { PostCardSkeleton } from "@/components/feed/PostCardSkeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { findCachedPost } from "@/lib/post-query-cache";
import { buildProfilePath } from "@/lib/profile-path";
import { getAvatarUrl, type Comment, type Post } from "@/types";

function compact(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function timeAgo(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function postKindLabel(post: Post): string {
  if (post.walletTradeSnapshot) return "Whale alert";
  if (post.postType === "alpha") return "Trade call";
  if (post.postType === "poll") return "Poll";
  if (post.postType === "raid") return "Raid post";
  if (post.postType === "chart") return "Chart setup";
  if (post.postType === "news") return "News";
  return "Discussion";
}

function applyPollVote(post: Post, optionId: string): Post {
  if (!post.poll) return post;
  const previousVote = post.poll.viewerOptionId;
  if (previousVote === optionId) return post;
  const options = post.poll.options.map((option) => {
    let votes = option.votes;
    if (option.id === previousVote) votes = Math.max(0, votes - 1);
    if (option.id === optionId) votes += 1;
    return { ...option, votes };
  });
  const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);
  return {
    ...post,
    poll: {
      totalVotes,
      viewerOptionId: optionId,
      options: options.map((option) => ({
        ...option,
        percentage: totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0,
      })),
    },
  };
}

function ThreadComment({
  comment,
  currentUserId,
  onDelete,
  isDeleting,
}: {
  comment: Comment;
  currentUserId?: string;
  onDelete: (commentId: string) => void;
  isDeleting: boolean;
}) {
  const authorPath = buildProfilePath(comment.author.id, comment.author.username);
  const canDelete = currentUserId === comment.authorId;

  return (
    <article className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,13,18,0.94),rgba(4,8,12,0.98))] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <Link to={authorPath} className="shrink-0">
            <Avatar className="h-10 w-10 border border-white/10">
              <AvatarImage src={getAvatarUrl(comment.author.id, comment.author.image)} />
              <AvatarFallback className="bg-white/[0.06] text-white/70">
                {(comment.author.username || comment.author.name || "?").charAt(0)}
              </AvatarFallback>
            </Avatar>
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={authorPath} className="text-sm font-semibold text-white hover:text-lime-200">
                {comment.author.username || comment.author.name}
              </Link>
              {comment.author.isVerified ? <ShieldCheck className="h-3.5 w-3.5 text-cyan-300" /> : null}
              <span className="text-xs text-white/34">{timeAgo(comment.createdAt)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/66">{comment.content}</p>
          </div>
        </div>
        {canDelete ? (
          <button
            type="button"
            onClick={() => onDelete(comment.id)}
            disabled={isDeleting}
            className="rounded-[10px] border border-white/8 bg-white/[0.03] p-2 text-white/34 transition hover:border-rose-300/20 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Delete comment"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export default function PostDetail() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session, canPerformAuthenticatedWrites } = useSession();
  const [replyText, setReplyText] = useState("");
  const cachedPost = useMemo(() => findCachedPost(queryClient, postId), [postId, queryClient]);
  const postQueryKey = ["post", postId] as const;
  const commentsQueryKey = ["post-comments", postId] as const;

  const postQuery = useQuery({
    queryKey: postQueryKey,
    queryFn: async () => {
      if (!postId) throw new Error("Post ID is required");
      return api.get<Post>(`/api/posts/${postId}`);
    },
    enabled: !!postId,
    initialData: cachedPost ?? undefined,
    initialDataUpdatedAt: cachedPost ? Date.now() : undefined,
    staleTime: 30_000,
    retry: 1,
  });

  const commentsQuery = useQuery({
    queryKey: commentsQueryKey,
    queryFn: async () => {
      if (!postId) throw new Error("Post ID is required");
      return api.get<Comment[]>(`/api/posts/${postId}/comments`);
    },
    enabled: !!postId,
    staleTime: 15_000,
  });

  const updatePostCache = (updater: (post: Post) => Post) => {
    queryClient.setQueryData<Post>(postQueryKey, (current) => (current ? updater(current) : current));
  };

  const requireWrite = () => {
    if (!session?.user || !canPerformAuthenticatedWrites) {
      toast.info("Sign in to interact with this thread.");
      return false;
    }
    return true;
  };

  const likeMutation = useMutation({
    mutationFn: async () => {
      if (!postQuery.data) return;
      if (postQuery.data.isLiked) await api.delete(`/api/posts/${postQuery.data.id}/like`);
      else await api.post(`/api/posts/${postQuery.data.id}/like`);
    },
    onMutate: () => {
      updatePostCache((post) => ({
        ...post,
        isLiked: !post.isLiked,
        _count: {
          ...post._count,
          likes: Math.max(0, post._count.likes + (post.isLiked ? -1 : 1)),
        },
      }));
    },
    onError: () => {
      toast.error("Could not update like");
      void queryClient.invalidateQueries({ queryKey: postQueryKey });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: postQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["posts"], refetchType: "active" });
    },
  });

  const repostMutation = useMutation({
    mutationFn: async () => {
      if (!postQuery.data) return;
      if (postQuery.data.isReposted) await api.delete(`/api/posts/${postQuery.data.id}/repost`);
      else await api.post(`/api/posts/${postQuery.data.id}/repost`);
    },
    onMutate: () => {
      updatePostCache((post) => ({
        ...post,
        isReposted: !post.isReposted,
        _count: {
          ...post._count,
          reposts: Math.max(0, post._count.reposts + (post.isReposted ? -1 : 1)),
        },
      }));
    },
    onError: () => {
      toast.error("Could not update repost");
      void queryClient.invalidateQueries({ queryKey: postQueryKey });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: postQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["posts"], refetchType: "active" });
    },
  });

  const pollVoteMutation = useMutation({
    mutationFn: async (optionId: string) => {
      if (!postQuery.data) return;
      await api.post(`/api/posts/${postQuery.data.id}/poll-vote`, { optionId });
    },
    onMutate: (optionId) => {
      updatePostCache((post) => applyPollVote(post, optionId));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not submit vote");
      void queryClient.invalidateQueries({ queryKey: postQueryKey });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: postQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["posts"], refetchType: "active" });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!postId) throw new Error("Post ID is required");
      return api.post<Comment>(`/api/posts/${postId}/comments`, { content });
    },
    onSuccess: (comment) => {
      setReplyText("");
      queryClient.setQueryData<Comment[]>(commentsQueryKey, (current = []) => [comment, ...current]);
      updatePostCache((post) => ({
        ...post,
        _count: { ...post._count, comments: post._count.comments + 1 },
        threadCount: (post.threadCount ?? post._count.comments) + 1,
      }));
      void queryClient.invalidateQueries({ queryKey: ["posts"], refetchType: "active" });
      toast.success("Reply posted");
    },
    onError: (error) => {
      toast.error(error instanceof ApiError || error instanceof Error ? error.message : "Could not post reply");
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      if (!postId) throw new Error("Post ID is required");
      await api.delete(`/api/posts/${postId}/comments/${commentId}`);
      return commentId;
    },
    onSuccess: (commentId) => {
      queryClient.setQueryData<Comment[]>(commentsQueryKey, (current = []) =>
        current.filter((comment) => comment.id !== commentId)
      );
      updatePostCache((post) => ({
        ...post,
        _count: { ...post._count, comments: Math.max(0, post._count.comments - 1) },
        threadCount: Math.max(0, (post.threadCount ?? post._count.comments) - 1),
      }));
      void queryClient.invalidateQueries({ queryKey: ["posts"], refetchType: "active" });
      toast.success("Reply deleted");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not delete reply");
    },
  });

  const post = postQuery.data;
  const comments = commentsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.97),rgba(3,7,10,0.99))] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
              className="h-10 w-10 rounded-[12px] border border-white/10 bg-white/[0.035] text-white/70 hover:bg-white/[0.07] hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-[24px] font-semibold tracking-tight text-white">POST THREAD</h1>
              <p className="mt-1 text-[13px] leading-5 text-white/54">
                Typed post, persisted replies, and live engagement state.
              </p>
            </div>
          </div>
          {post ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/44">
              <span className="rounded-full border border-lime-300/16 bg-lime-300/8 px-3 py-1 text-lime-200">
                {postKindLabel(post)}
              </span>
              <span>{timeAgo(post.createdAt)}</span>
            </div>
          ) : null}
        </div>
      </section>

      <main className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <section className="space-y-4">
          {postQuery.isLoading ? (
            <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,12,0.99))] p-4">
              <PostCardSkeleton />
            </div>
          ) : postQuery.error ? (
            <div className="flex min-h-[420px] items-center justify-center rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,12,0.99))] px-6 text-center">
              <div>
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-rose-300/18 bg-rose-300/8">
                  <AlertCircle className="h-7 w-7 text-rose-300" />
                </div>
                <h2 className="mt-5 text-xl font-semibold text-white">Post unavailable</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/50">
                  This post may have been deleted or you may no longer have access.
                </p>
                <Button type="button" onClick={() => navigate("/")} className="mt-5 rounded-[14px]">
                  Go to Feed
                </Button>
              </div>
            </div>
          ) : post ? (
            <>
              <FeedV2PostCard
                post={post}
                currentUserId={session?.user?.id}
                onLike={() => {
                  if (requireWrite()) likeMutation.mutate();
                }}
                onRepost={() => {
                  if (requireWrite()) repostMutation.mutate();
                }}
                onPollVote={(_, optionId) => {
                  if (requireWrite()) pollVoteMutation.mutate(optionId);
                }}
              />

              <section className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,12,0.99))] p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Thread</div>
                    <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-white">
                      {compact(post._count.comments)} replies
                    </h2>
                  </div>
                  <MessageSquare className="h-5 w-5 text-lime-300" />
                </div>

                <div className="mt-5 rounded-[18px] border border-white/8 bg-black/20 p-3">
                  <Textarea
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    placeholder="Add a real reply to this thread..."
                    className="min-h-[92px] resize-none rounded-[14px] border-white/8 bg-white/[0.03] text-white placeholder:text-white/30"
                    maxLength={500}
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-white/38">{replyText.length}/500</span>
                    <Button
                      type="button"
                      onClick={() => {
                        if (!requireWrite()) return;
                        const content = replyText.trim();
                        if (!content) {
                          toast.error("Reply cannot be empty");
                          return;
                        }
                        commentMutation.mutate(content);
                      }}
                      disabled={!replyText.trim() || commentMutation.isPending}
                      className="h-10 rounded-[13px] px-4 text-slate-950"
                    >
                      {commentMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      Reply
                    </Button>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {commentsQuery.isLoading ? (
                    <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-6 text-sm text-white/50">
                      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                      Loading replies...
                    </div>
                  ) : commentsQuery.error ? (
                    <div className="rounded-[18px] border border-rose-300/16 bg-rose-300/8 px-4 py-6 text-sm text-rose-100">
                      Could not load replies. Refresh the thread to retry.
                    </div>
                  ) : comments.length ? (
                    comments.map((comment) => (
                      <ThreadComment
                        key={comment.id}
                        comment={comment}
                        currentUserId={session?.user?.id}
                        onDelete={(commentId) => deleteCommentMutation.mutate(commentId)}
                        isDeleting={deleteCommentMutation.variables === comment.id && deleteCommentMutation.isPending}
                      />
                    ))
                  ) : (
                    <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-8 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-lime-300/18 bg-lime-300/8">
                        <MessageSquare className="h-5 w-5 text-lime-300" />
                      </div>
                      <h3 className="mt-3 text-sm font-semibold text-white">No replies yet</h3>
                      <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-white/46">
                        Start the thread with a real comment. Replies persist and update the post everywhere.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </>
          ) : null}
        </section>

        <aside className="space-y-4">
          <section className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,12,0.99))] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Post Context</div>
            {post ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-[16px] border border-white/8 bg-black/20 px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Type</div>
                  <div className="mt-1 text-sm font-semibold text-white">{postKindLabel(post)}</div>
                </div>
                <div className="rounded-[16px] border border-white/8 bg-black/20 px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Engagement</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-sm font-semibold text-white">{compact(post._count.likes)}</div>
                      <div className="text-[10px] text-white/36">Likes</div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">{compact(post._count.comments)}</div>
                      <div className="text-[10px] text-white/36">Replies</div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">{compact(post._count.reposts)}</div>
                      <div className="text-[10px] text-white/36">Reposts</div>
                    </div>
                  </div>
                </div>
                {post.contractAddress ? (
                  <Link
                    to={`/token/${post.contractAddress}`}
                    className="block rounded-[16px] border border-lime-300/14 bg-lime-300/[0.055] px-3 py-3 transition hover:border-lime-300/28 hover:bg-lime-300/[0.08]"
                  >
                    <div className="flex items-center gap-3">
                      {post.tokenImage ? <img src={post.tokenImage} alt="" className="h-10 w-10 rounded-full object-cover" /> : null}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{post.tokenSymbol ? `$${post.tokenSymbol}` : "Token terminal"}</div>
                        <div className="truncate text-xs text-white/44">{post.contractAddress}</div>
                      </div>
                    </div>
                  </Link>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 rounded-[16px] border border-white/8 bg-white/[0.03] px-3 py-5 text-sm text-white/48">
                Context loads with the post.
              </div>
            )}
          </section>

          {post?.postType === "raid" || post?.content.toLowerCase().includes("raid") ? (
            <section className="rounded-[22px] border border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.1),transparent_28%),linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,12,0.99))] p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
                <RadioTower className="h-4 w-4 text-lime-300" />
                Raid Link
              </div>
              <p className="mt-3 text-sm leading-6 text-white/54">
                Raid-room CTAs only appear when this post is backed by a persisted raid campaign. This post has no linked campaign ID in the post payload.
              </p>
            </section>
          ) : null}
        </aside>
      </main>
    </div>
  );
}
