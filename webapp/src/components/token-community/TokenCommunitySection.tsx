import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  ExternalLink,
  ImageDown,
  Laugh,
  Link2,
  Loader2,
  Megaphone,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  formatTimeAgo,
  getAvatarUrl,
  type TokenActiveRaidResponse,
  type TokenCommunityProfile,
  type TokenCommunityReply,
  type TokenCommunityThread,
  type TokenRaidCampaign,
  type TokenRaidMemeOption,
} from "@/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buildRaidMemeDataUrl, renderRaidMemePngBlob } from "./raidMemeRenderer";

type ViewerState = {
  id: string;
  username?: string | null;
  name?: string | null;
  image?: string | null;
  level?: number;
  isAdmin?: boolean;
} | null;

type Props = {
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  viewer: ViewerState;
  canPerformAuthenticatedWrites: boolean;
};

type ThreadPage = {
  items: TokenCommunityThread[];
  hasMore: boolean;
  nextCursor: string | null;
};

function buildTokenLabel(tokenSymbol: string | null, tokenName: string | null): string {
  if (tokenSymbol) return `$${tokenSymbol}`;
  return tokenName || "this token";
}

function communityTag(
  profile: TokenCommunityProfile | undefined,
  tokenSymbol: string | null,
  tokenName: string | null,
) {
  return profile?.xCashtag || buildTokenLabel(tokenSymbol, tokenName);
}

async function tryWriteImageToClipboard(blob: Blob): Promise<boolean> {
  if (!("clipboard" in navigator) || typeof ClipboardItem === "undefined") {
    return false;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
}

function splitTagInput(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function ThreadCard({
  thread,
  tokenAddress,
  viewer,
  canWrite,
  onDeleteThread,
  onReplyCreated,
  onDeleteReply,
}: {
  thread: TokenCommunityThread;
  tokenAddress: string;
  viewer: ViewerState;
  canWrite: boolean;
  onDeleteThread: (threadId: string) => void;
  onReplyCreated: () => void;
  onDeleteReply: (replyId: string) => void;
}) {
  const [expanded, setExpanded] = useState(thread.isPinned);
  const [replyText, setReplyText] = useState("");
  const repliesQuery = useQuery({
    queryKey: ["token-community-replies", tokenAddress, thread.id],
    enabled: expanded,
    queryFn: async () =>
      api.get<TokenCommunityReply[]>(
        `/api/tokens/${tokenAddress}/community/threads/${thread.id}/replies`,
      ),
  });

  const replyMutation = useMutation({
    mutationFn: async () =>
      api.post<TokenCommunityReply>(
        `/api/tokens/${tokenAddress}/community/threads/${thread.id}/replies`,
        { content: replyText.trim() },
      ),
    onSuccess: () => {
      setReplyText("");
      void repliesQuery.refetch();
      onReplyCreated();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to reply");
    },
  });

  const isOwner = viewer?.id === thread.author.id || viewer?.isAdmin;

  return (
    <div className="rounded-[22px] border border-border/60 bg-white/70 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.42)] dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10 border border-border">
            <AvatarImage src={getAvatarUrl(thread.author.id, thread.author.image)} />
            <AvatarFallback>{(thread.author.username || thread.author.name || "?").charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {thread.author.username || thread.author.name}
              </span>
              <span className="rounded-full border border-border/60 bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                lvl {thread.author.level}
              </span>
              {thread.isPinned ? (
                <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                  Pinned
                </span>
              ) : null}
              {thread.kind === "raid" ? (
                <span className="rounded-full border border-amber-300/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-300">
                  Raid
                </span>
              ) : null}
            </div>
            {thread.title ? <div className="mt-1 text-base font-semibold text-foreground">{thread.title}</div> : null}
            <p className="mt-2 text-sm leading-6 text-foreground/90">{thread.content}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium text-foreground transition-opacity hover:opacity-80"
                onClick={() => setExpanded((current) => !current)}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {expanded ? "Hide replies" : `${thread.replyCount} replies`}
              </button>
              <span>{formatTimeAgo(thread.createdAt)}</span>
            </div>
          </div>
        </div>

        {isOwner ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => onDeleteThread(thread.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
          {canWrite ? (
            <div className="space-y-2">
              <Textarea
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
                placeholder="Add a reply..."
                className="min-h-[90px] rounded-[18px] border-border/60 bg-background/60"
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => replyMutation.mutate()}
                  disabled={!replyText.trim() || replyMutation.isPending}
                  className="rounded-full"
                >
                  {replyMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Reply
                </Button>
              </div>
            </div>
          ) : null}

          {repliesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading replies...
            </div>
          ) : repliesQuery.data && repliesQuery.data.length > 0 ? (
            repliesQuery.data.map((reply) => {
              const canDeleteReply = viewer?.id === reply.author.id || viewer?.isAdmin;
              return (
                <div
                  key={reply.id}
                  className="rounded-[18px] border border-border/60 bg-secondary/55 p-3"
                  style={{ marginLeft: `${Math.min(reply.depth, 3) * 12}px` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <Avatar className="h-8 w-8 border border-border">
                        <AvatarImage src={getAvatarUrl(reply.author.id, reply.author.image)} />
                        <AvatarFallback>{(reply.author.username || reply.author.name || "?").charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {reply.author.username || reply.author.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{formatTimeAgo(reply.createdAt)}</span>
                        </div>
                        <p className="mt-1 text-sm text-foreground/90">{reply.content}</p>
                      </div>
                    </div>
                    {canDeleteReply ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={() => onDeleteReply(reply.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-[16px] border border-dashed border-border/60 bg-secondary/40 p-3 text-sm text-muted-foreground">
              No replies yet.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function TokenCommunitySection({
  tokenAddress,
  tokenSymbol,
  tokenName,
  viewer,
  canPerformAuthenticatedWrites,
}: Props) {
  const queryClient = useQueryClient();
  const [threadCursor, setThreadCursor] = useState<string | null>(null);
  const [threads, setThreads] = useState<TokenCommunityThread[]>([]);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [nextThreadCursor, setNextThreadCursor] = useState<string | null>(null);
  const [threadTitle, setThreadTitle] = useState("");
  const [threadContent, setThreadContent] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);
  const [headlineInput, setHeadlineInput] = useState("");
  const [voiceHintsInput, setVoiceHintsInput] = useState("");
  const [insideJokesInput, setInsideJokesInput] = useState("");
  const [xCashtagInput, setXCashtagInput] = useState("");
  const [raidObjective, setRaidObjective] = useState("");
  const [selectedMemeId, setSelectedMemeId] = useState<string | null>(null);
  const [selectedCopyId, setSelectedCopyId] = useState<string | null>(null);
  const [xPostUrlInput, setXPostUrlInput] = useState("");
  const [boostOffset, setBoostOffset] = useState(0);

  const viewerLevel = viewer?.level ?? 0;
  const tokenLabel = buildTokenLabel(tokenSymbol, tokenName);

  const profileQuery = useQuery({
    queryKey: ["token-community-profile", tokenAddress],
    enabled: Boolean(viewer?.id),
    queryFn: async () =>
      api.get<TokenCommunityProfile>(`/api/tokens/${tokenAddress}/community/profile`),
  });

  const threadsQuery = useQuery({
    queryKey: ["token-community-threads", tokenAddress, threadCursor],
    enabled: Boolean(viewer?.id),
    queryFn: async () => {
      const suffix = threadCursor ? `?cursor=${encodeURIComponent(threadCursor)}` : "";
      return api.get<ThreadPage>(`/api/tokens/${tokenAddress}/community/threads${suffix}`);
    },
  });

  const activeRaidQuery = useQuery({
    queryKey: ["token-community-active-raid", tokenAddress],
    enabled: Boolean(viewer?.id),
    queryFn: async () =>
      api.get<TokenActiveRaidResponse>(`/api/tokens/${tokenAddress}/community/raids/active`),
  });

  useEffect(() => {
    if (!threadsQuery.data) return;
    if (!threadCursor) {
      setThreads(threadsQuery.data.items);
    } else {
      setThreads((current) => [
        ...current,
        ...threadsQuery.data.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
    }
    setHasMoreThreads(threadsQuery.data.hasMore);
    setNextThreadCursor(threadsQuery.data.nextCursor);
  }, [threadCursor, threadsQuery.data]);

  useEffect(() => {
    if (!profileQuery.data) return;
    setHeadlineInput(profileQuery.data.headline);
    setXCashtagInput(profileQuery.data.xCashtag ?? "");
    setVoiceHintsInput(profileQuery.data.voiceHints.join(", "));
    setInsideJokesInput(profileQuery.data.insideJokes.join(", "));
  }, [profileQuery.data]);

  useEffect(() => {
    const campaign = activeRaidQuery.data?.campaign;
    if (!campaign) {
      setSelectedMemeId(null);
      setSelectedCopyId(null);
      setXPostUrlInput("");
      return;
    }
    setSelectedMemeId(activeRaidQuery.data?.mySubmission?.memeOptionId ?? campaign.memeOptions[0]?.id ?? null);
    setSelectedCopyId(activeRaidQuery.data?.mySubmission?.copyOptionId ?? campaign.copyOptions[0]?.id ?? null);
    setXPostUrlInput(activeRaidQuery.data?.mySubmission?.xPostUrl ?? "");
    setRaidObjective(campaign.objective);
    setBoostOffset(0);
  }, [activeRaidQuery.data]);

  const canLeadRaid = Boolean(viewer && viewerLevel >= (profileQuery.data?.raidLeadMinLevel ?? 3));
  const selectedCampaign: TokenRaidCampaign | null = activeRaidQuery.data?.campaign ?? null;
  const selectedMeme =
    selectedCampaign?.memeOptions.find((option) => option.id === selectedMemeId) ??
    selectedCampaign?.memeOptions[0] ??
    null;
  const selectedCopy =
    selectedCampaign?.copyOptions.find((option) => option.id === selectedCopyId) ??
    selectedCampaign?.copyOptions[0] ??
    null;

  const reloadThreads = async () => {
    setThreadCursor(null);
    await queryClient.invalidateQueries({ queryKey: ["token-community-threads", tokenAddress] });
  };

  const createThreadMutation = useMutation({
    mutationFn: async () =>
      api.post<TokenCommunityThread>(`/api/tokens/${tokenAddress}/community/threads`, {
        title: threadTitle.trim() || undefined,
        content: threadContent.trim(),
      }),
    onSuccess: async () => {
      setThreadTitle("");
      setThreadContent("");
      await reloadThreads();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create thread");
    },
  });

  const saveProfileMutation = useMutation({
    mutationFn: async () =>
      api.patch<TokenCommunityProfile>(`/api/tokens/${tokenAddress}/community/profile`, {
        headline: headlineInput.trim(),
        xCashtag: xCashtagInput.trim() || null,
        voiceHints: splitTagInput(voiceHintsInput),
        insideJokes: splitTagInput(insideJokesInput),
      }),
    onSuccess: async () => {
      setEditingProfile(false);
      await profileQuery.refetch();
      toast.success("Community profile updated");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update community profile");
    },
  });

  const createRaidMutation = useMutation({
    mutationFn: async (replaceActive: boolean) =>
      api.post<{ campaign: TokenRaidCampaign }>(`/api/tokens/${tokenAddress}/community/raids`, {
        objective: raidObjective.trim() || undefined,
        replaceActive,
      }),
    onSuccess: async () => {
      await activeRaidQuery.refetch();
      await reloadThreads();
      toast.success("Raid ready");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start raid");
    },
  });

  const regenerateRaidMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCampaign) throw new Error("No active raid");
      return api.post<{ campaign: TokenRaidCampaign }>(
        `/api/tokens/${tokenAddress}/community/raids/${selectedCampaign.id}/regenerate`,
      );
    },
    onSuccess: async () => {
      await activeRaidQuery.refetch();
      toast.success("Fresh raid options ready");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to regenerate raid");
    },
  });

  const deleteThreadMutation = useMutation({
    mutationFn: async (threadId: string) =>
      api.delete(`/api/tokens/${tokenAddress}/community/threads/${threadId}`),
    onSuccess: async () => {
      await reloadThreads();
    },
  });

  const deleteReplyMutation = useMutation({
    mutationFn: async (replyId: string) =>
      api.delete(`/api/tokens/${tokenAddress}/community/replies/${replyId}`),
    onSuccess: async () => {
      await reloadThreads();
    },
  });

  const saveUrlMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCampaign) throw new Error("No active raid");
      return api.patch(
        `/api/tokens/${tokenAddress}/community/raids/${selectedCampaign.id}/submission`,
        { xPostUrl: xPostUrlInput.trim() },
      );
    },
    onSuccess: async () => {
      await activeRaidQuery.refetch();
      toast.success("Raid post linked");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save X post URL");
    },
  });

  const launchRaidMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCampaign || !selectedMeme || !selectedCopy) {
        throw new Error("Choose a meme and copy first");
      }
      return api.post(
        `/api/tokens/${tokenAddress}/community/raids/${selectedCampaign.id}/launch`,
        {
          memeOptionId: selectedMeme.id,
          copyOptionId: selectedCopy.id,
          renderPayloadJson: selectedMeme,
          composerText: selectedCopy.text,
        },
      );
    },
    onSuccess: async () => {
      if (!selectedMeme || !selectedCopy) return;
      try {
        await navigator.clipboard.writeText(selectedCopy.text);
      } catch {
        toast.error("Could not copy text automatically");
      }

      const blob = await renderRaidMemePngBlob(selectedMeme, {
        tokenLabel,
        communityTag: communityTag(profileQuery.data, tokenSymbol, tokenName),
      });
      const copiedImage = await tryWriteImageToClipboard(blob);
      downloadBlob(
        blob,
        `raid-${(tokenSymbol || tokenName || "token").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
      );
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(selectedCopy.text)}`,
        "_blank",
        "noopener,noreferrer",
      );
      await activeRaidQuery.refetch();
      toast.success(
        copiedImage ? "Raid assets copied and opened on X" : "Raid asset downloaded and opened on X",
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to launch raid");
    },
  });

  const boostBatch = () => {
    const submissions = activeRaidQuery.data?.submissions ?? [];
    const batch = submissions.slice(boostOffset, boostOffset + 5);
    for (const submission of batch) {
      if (submission.xPostUrl) {
        window.open(submission.xPostUrl, "_blank", "noopener,noreferrer");
      }
    }
    setBoostOffset((current) => Math.min(current + 5, submissions.length));
  };

  if (!viewer?.id) {
    return (
      <section className="app-surface p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparing community access...
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Community</h3>
        </div>
        <span className="rounded-full border border-border/60 bg-secondary px-3 py-1 text-xs text-muted-foreground">
          {communityTag(profileQuery.data, tokenSymbol, tokenName)}
        </span>
      </div>

      <Tabs defaultValue="board" className="space-y-5">
        <TabsList className="grid w-full grid-cols-2 rounded-[18px] border border-border/60 bg-secondary/70 p-1">
          <TabsTrigger value="board" className="rounded-[14px]">Board</TabsTrigger>
          <TabsTrigger value="raid" className="rounded-[14px]">Raid</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="space-y-4">
          <div className="rounded-[24px] border border-border/60 bg-white/70 p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.42)] dark:bg-white/[0.03]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">Community tone</div>
                  <p className="mt-1 text-sm text-muted-foreground">{profileQuery.data?.headline}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(profileQuery.data?.voiceHints ?? []).map((hint) => (
                    <span key={hint} className="rounded-full border border-border/60 bg-secondary px-3 py-1 text-[11px] text-muted-foreground">
                      {hint}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(profileQuery.data?.insideJokes ?? []).map((joke) => (
                    <span key={joke} className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] text-primary/90">
                      {joke}
                    </span>
                  ))}
                </div>
              </div>

              {canLeadRaid ? (
                <Button type="button" variant="outline" className="rounded-full" onClick={() => setEditingProfile((value) => !value)}>
                  {editingProfile ? "Close Editor" : "Edit Tone"}
                </Button>
              ) : null}
            </div>

            {editingProfile ? (
              <div className="mt-4 grid gap-3 border-t border-border/50 pt-4 md:grid-cols-2">
                <Input value={headlineInput} onChange={(event) => setHeadlineInput(event.target.value)} placeholder="Headline" />
                <Input value={xCashtagInput} onChange={(event) => setXCashtagInput(event.target.value)} placeholder="$TOKEN" />
                <Textarea value={voiceHintsInput} onChange={(event) => setVoiceHintsInput(event.target.value)} placeholder="Voice hints, comma separated" className="min-h-[92px]" />
                <Textarea value={insideJokesInput} onChange={(event) => setInsideJokesInput(event.target.value)} placeholder="Inside jokes, comma separated" className="min-h-[92px]" />
                <div className="md:col-span-2 flex justify-end">
                  <Button type="button" onClick={() => saveProfileMutation.mutate()} disabled={saveProfileMutation.isPending}>
                    {saveProfileMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save Profile
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {canPerformAuthenticatedWrites ? (
            <div className="rounded-[24px] border border-border/60 bg-white/70 p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.42)] dark:bg-white/[0.03]">
              <div className="text-sm font-semibold text-foreground">Start a thread</div>
              <div className="mt-3 grid gap-3">
                <Input value={threadTitle} onChange={(event) => setThreadTitle(event.target.value)} placeholder="Optional title" />
                <Textarea value={threadContent} onChange={(event) => setThreadContent(event.target.value)} placeholder={`What is the ${tokenLabel} room seeing right now?`} className="min-h-[120px]" />
                <div className="flex justify-end">
                  <Button type="button" onClick={() => createThreadMutation.mutate()} disabled={!threadContent.trim() || createThreadMutation.isPending}>
                    {createThreadMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Post Thread
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            {threadsQuery.isLoading && threads.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading community board...
              </div>
            ) : threads.length > 0 ? (
              threads.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  tokenAddress={tokenAddress}
                  viewer={viewer}
                  canWrite={canPerformAuthenticatedWrites}
                  onDeleteThread={(threadId) => deleteThreadMutation.mutate(threadId)}
                  onReplyCreated={() => {
                    void activeRaidQuery.refetch();
                    void reloadThreads();
                  }}
                  onDeleteReply={(replyId) => deleteReplyMutation.mutate(replyId)}
                />
              ))
            ) : (
              <div className="rounded-[22px] border border-dashed border-border/60 bg-secondary/50 p-5 text-sm text-muted-foreground">
                No community threads yet. Start the room.
              </div>
            )}

            {hasMoreThreads && nextThreadCursor ? (
              <div className="flex justify-center">
                <Button type="button" variant="outline" className="rounded-full" onClick={() => setThreadCursor(nextThreadCursor)}>
                  Load More
                </Button>
              </div>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="raid" className="space-y-4">
          <div className="rounded-[24px] border border-border/60 bg-white/70 p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.42)] dark:bg-white/[0.03]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-primary" />
                  <div className="text-sm font-semibold text-foreground">Shared raid campaign</div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {selectedCampaign
                    ? selectedCampaign.objective
                    : `Create a coordinated push for ${tokenLabel}. Everyone gets exactly 3 memes and 3 copy options.`}
                </p>
              </div>
              {selectedCampaign && canLeadRaid ? (
                <Button type="button" variant="outline" className="rounded-full" onClick={() => regenerateRaidMutation.mutate()} disabled={regenerateRaidMutation.isPending}>
                  {regenerateRaidMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Regenerate
                </Button>
              ) : null}
            </div>

            {!selectedCampaign ? (
              canLeadRaid ? (
                <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
                  <Textarea value={raidObjective} onChange={(event) => setRaidObjective(event.target.value)} placeholder={`Make ${tokenLabel} impossible to ignore without sounding desperate.`} className="min-h-[110px]" />
                  <div className="flex justify-end">
                    <Button type="button" onClick={() => createRaidMutation.mutate(false)} disabled={createRaidMutation.isPending}>
                      {createRaidMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Start Raid
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-[18px] border border-dashed border-border/60 bg-secondary/50 p-4 text-sm text-muted-foreground">
                  A trusted member can start the first raid for this token.
                </div>
              )
            ) : null}
          </div>

          {selectedCampaign ? (
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <div className="rounded-[24px] border border-border/60 bg-white/70 p-5 dark:bg-white/[0.03]">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Laugh className="h-4 w-4 text-primary" />
                    Meme options
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {selectedCampaign.memeOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setSelectedMemeId(option.id)}
                        className={cn(
                          "overflow-hidden rounded-[20px] border text-left transition-all",
                          selectedMeme?.id === option.id
                            ? "border-primary shadow-[0_18px_32px_-24px_hsl(var(--primary)/0.8)]"
                            : "border-border/60 hover:border-primary/30",
                        )}
                      >
                        <img
                          src={buildRaidMemeDataUrl(option, {
                            tokenLabel,
                            communityTag: communityTag(profileQuery.data, tokenSymbol, tokenName),
                          })}
                          alt={option.title}
                          className="aspect-square w-full object-cover"
                        />
                        <div className="space-y-1 p-3">
                          <div className="text-sm font-semibold text-foreground">{option.title}</div>
                          <div className="text-xs text-muted-foreground">{option.angle}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-border/60 bg-white/70 p-5 dark:bg-white/[0.03]">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    Copy options
                  </div>
                  <div className="mt-4 space-y-3">
                    {selectedCampaign.copyOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setSelectedCopyId(option.id)}
                        className={cn(
                          "w-full rounded-[18px] border p-4 text-left transition-all",
                          selectedCopy?.id === option.id
                            ? "border-primary bg-primary/8"
                            : "border-border/60 bg-secondary/50 hover:border-primary/30",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-foreground">{option.label}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{option.angle}</div>
                          </div>
                          <Copy className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <p className="mt-3 text-sm leading-6 text-foreground/90">{option.text}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[24px] border border-border/60 bg-white/70 p-5 dark:bg-white/[0.03]">
                  <div className="text-sm font-semibold text-foreground">Selected preview</div>
                  {selectedMeme ? (
                    <img
                      src={buildRaidMemeDataUrl(selectedMeme, {
                        tokenLabel,
                        communityTag: communityTag(profileQuery.data, tokenSymbol, tokenName),
                      })}
                      alt={selectedMeme.title}
                      className="mt-4 aspect-square w-full rounded-[20px] border border-border/60 object-cover"
                    />
                  ) : null}
                  {selectedCopy ? (
                    <div className="mt-4 rounded-[18px] border border-border/60 bg-secondary/55 p-4 text-sm leading-6 text-foreground/90">
                      {selectedCopy.text}
                    </div>
                  ) : null}
                  <div className="mt-4 grid gap-2">
                    <Button type="button" onClick={() => launchRaidMutation.mutate()} disabled={!selectedMeme || !selectedCopy || launchRaidMutation.isPending}>
                      {launchRaidMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Copy + Download + Open X
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant="outline" onClick={async () => {
                        if (!selectedCopy) return;
                        try {
                          await navigator.clipboard.writeText(selectedCopy.text);
                          toast.success("Copy text copied");
                        } catch {
                          toast.error("Could not copy text");
                        }
                      }}>
                        <Copy className="mr-2 h-4 w-4" />
                        Copy Text
                      </Button>
                      <Button type="button" variant="outline" onClick={async () => {
                        if (!selectedMeme) return;
                        try {
                          const blob = await renderRaidMemePngBlob(selectedMeme, {
                            tokenLabel,
                            communityTag: communityTag(profileQuery.data, tokenSymbol, tokenName),
                          });
                          downloadBlob(blob, `raid-${(tokenSymbol || tokenName || "token").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`);
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Failed to download meme");
                        }
                      }}>
                        <ImageDown className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-border/60 bg-white/70 p-5 dark:bg-white/[0.03]">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Link2 className="h-4 w-4 text-primary" />
                    Post link
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    After posting on X, paste your post URL here so the community can boost it.
                  </p>
                  <div className="mt-4 flex gap-2">
                    <Input value={xPostUrlInput} onChange={(event) => setXPostUrlInput(event.target.value)} placeholder="https://x.com/.../status/..." />
                    <Button type="button" onClick={() => saveUrlMutation.mutate()} disabled={!xPostUrlInput.trim() || saveUrlMutation.isPending}>
                      {saveUrlMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                    </Button>
                  </div>
                </div>

                <div className="rounded-[24px] border border-border/60 bg-white/70 p-5 dark:bg-white/[0.03]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Boost board</div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Open raid posts in batches of 5 tabs so the room can like and reply fast.
                      </p>
                    </div>
                    <Button type="button" variant="outline" className="rounded-full" onClick={boostBatch} disabled={(activeRaidQuery.data?.submissions.length ?? 0) === 0 || boostOffset >= (activeRaidQuery.data?.submissions.length ?? 0)}>
                      Open Next 5
                    </Button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {(activeRaidQuery.data?.submissions ?? []).length > 0 ? (
                      activeRaidQuery.data?.submissions.map((submission) => (
                        <a
                          key={submission.id}
                          href={submission.xPostUrl || "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between rounded-[18px] border border-border/60 bg-secondary/55 px-4 py-3 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-foreground">{submission.user.username || submission.user.name}</div>
                            <div className="truncate text-xs text-muted-foreground">{submission.xPostUrl}</div>
                          </div>
                          <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </a>
                      ))
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-border/60 bg-secondary/45 p-4 text-sm text-muted-foreground">
                        No raid posts linked yet.
                      </div>
                    )}
                  </div>

                  {canLeadRaid ? (
                    <div className="mt-4 border-t border-border/50 pt-4">
                      <div className="text-sm font-semibold text-foreground">Replace active raid</div>
                      <div className="mt-3 flex gap-2">
                        <Input value={raidObjective} onChange={(event) => setRaidObjective(event.target.value)} placeholder="Fresh objective for the next push" />
                        <Button type="button" variant="outline" onClick={() => createRaidMutation.mutate(true)} disabled={createRaidMutation.isPending}>
                          Replace
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  );
}
