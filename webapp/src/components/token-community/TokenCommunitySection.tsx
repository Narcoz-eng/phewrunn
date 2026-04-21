import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Copy,
  ExternalLink,
  Flame,
  ImageDown,
  ImagePlus,
  Loader2,
  Megaphone,
  MessageSquare,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  Users,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  formatTimeAgo,
  getAvatarUrl,
  type TokenActiveRaidResponse,
  type TokenCommunityAsset,
  type TokenCommunityAssetStorageHealth,
  type TokenCommunityAssetImportRequest,
  type TokenCommunityAssetPresignResponse,
  type TokenCommunityProfile,
  type TokenCommunityReactionSummary,
  type TokenCommunityReply,
  type TokenCommunityRoom,
  type TokenCommunityThread,
  type TokenRaidCampaign,
  type TokenRaidCopyOption,
  type TokenRaidMemeOption,
} from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  buildRaidMemeDataUrl,
  renderRaidMemePngBlob,
  type RaidMemeAssetContext,
} from "./raidMemeRenderer";
import { RAID_MEME_TEMPLATE_LIBRARY } from "./raidMemeTemplates";

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
  entryIntent?: "create-community" | null;
  entryIntentToken?: number;
};

type ThreadPage = {
  items: TokenCommunityThread[];
  hasMore: boolean;
  nextCursor: string | null;
  sort?: "latest" | "trending";
};

type DraftAssets = {
  logo: TokenCommunityAsset | null;
  banner: TokenCommunityAsset | null;
  mascot: TokenCommunityAsset | null;
  referenceMemes: TokenCommunityAsset[];
};

type AssetLinkDraft = {
  logo: string;
  banner: string;
  mascot: string;
  reference_meme: string;
};

type EditorMode = "create" | "edit" | null;

type EditorDraft = {
  headline: string;
  whyLine: string;
  welcomePrompt: string;
  xCashtag: string;
  mascotName: string;
  vibeTags: string;
  voiceHints: string;
  insideJokes: string;
  assets: DraftAssets;
};

const REACTION_EMOJIS = ["🔥", "👀", "😂", "🫡"] as const;

function buildTokenLabel(tokenSymbol: string | null, tokenName: string | null): string {
  if (tokenSymbol) return `$${tokenSymbol}`;
  return tokenName || "this token";
}

function communityTag(
  profile: Pick<TokenCommunityProfile, "xCashtag"> | Pick<TokenCommunityRoom, "xCashtag"> | null | undefined,
  tokenSymbol: string | null,
  tokenName: string | null,
) {
  return profile?.xCashtag || buildTokenLabel(tokenSymbol, tokenName);
}

function splitTagInput(value: string, maxItems = 6): string[] {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: value >= 1_000 ? "compact" : "standard" }).format(value);
}

function emptyAssets(): DraftAssets {
  return {
    logo: null,
    banner: null,
    mascot: null,
    referenceMemes: [],
  };
}

function emptyAssetLinks(): AssetLinkDraft {
  return {
    logo: "",
    banner: "",
    mascot: "",
    reference_meme: "",
  };
}

function getAssetActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    if (error.message === "Asset storage is not configured") {
      return "Brand-kit storage is not configured yet. Only logo, banner, mascot, and 1-5 reference memes are stored. Generated raid memes are never stored.";
    }
    return error.message;
  }
  return fallback;
}

function getAssetStorageIssueCopy(health: TokenCommunityAssetStorageHealth | null | undefined): string | null {
  if (!health) return null;
  if (health.issues.includes("partial_storage_config")) {
    return "Community brand-kit storage is only partially configured. Add the missing R2 bucket, key, secret, region, and public asset URL before uploading.";
  }
  if (
    health.issues.includes("public_base_uses_storage_api_host") ||
    health.issues.includes("public_base_points_at_r2_api_endpoint")
  ) {
    return "The asset public URL is pointing at the R2 API host instead of a browser-loadable public domain. Set COMMUNITY_ASSET_PUBLIC_BASE_URL to the public bucket or CDN URL.";
  }
  if (health.issues.includes("missing_public_base_url")) {
    return "Asset storage can sign uploads, but no public asset base URL is configured yet. Set COMMUNITY_ASSET_PUBLIC_BASE_URL before using community uploads.";
  }
  return null;
}

function draftAssetIds(assets: DraftAssets): string[] {
  return [
    assets.logo?.id,
    assets.banner?.id,
    assets.mascot?.id,
    ...assets.referenceMemes.map((asset) => asset.id),
  ].filter((value): value is string => Boolean(value));
}

function canPublishAssets(assets: DraftAssets): boolean {
  return Boolean(assets.logo && assets.banner && assets.referenceMemes.length >= 1 && assets.referenceMemes.length <= 5);
}

function buildInitialDraft(
  tokenSymbol: string | null,
  tokenName: string | null,
  room?: TokenCommunityRoom | null,
  profile?: TokenCommunityProfile | null,
): EditorDraft {
  const tokenLabel = buildTokenLabel(tokenSymbol, tokenName);
  const roomAssets = room?.assets;
  return {
    headline:
      profile?.headline ||
      room?.headline ||
      `${tokenLabel} has a sharp community that trades jokes, receipts, and timing together.`,
    whyLine: profile?.whyLine || room?.whyLine || `${tokenLabel} is where the room keeps the timing sharp and the copium outside.`,
    welcomePrompt:
      profile?.welcomePrompt ||
      room?.welcomePrompt ||
      "Introduce yourself, drop your first take, or jump straight into the current raid.",
    xCashtag: profile?.xCashtag || room?.xCashtag || tokenLabel,
    mascotName: profile?.mascotName || room?.mascotName || "",
    vibeTags: (profile?.vibeTags || room?.vibeTags || []).join(", "),
    voiceHints: (profile?.voiceHints || []).join(", "),
    insideJokes: (profile?.insideJokes || []).join(", "),
    assets: {
      logo: roomAssets?.logo ?? null,
      banner: roomAssets?.banner ?? null,
      mascot: roomAssets?.mascot ?? null,
      referenceMemes: roomAssets?.referenceMemes ?? [],
    },
  };
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

async function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Failed to inspect image"));
    });
    return { width: image.width, height: image.height };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function roomBadgeTone(badge: string): string {
  if (badge === "elite") return "border-amber-300/40 bg-amber-400/10 text-amber-700 dark:text-amber-300";
  if (badge === "trusted") return "border-sky-300/40 bg-sky-400/10 text-sky-700 dark:text-sky-300";
  return "border-border/60 bg-secondary text-muted-foreground";
}

function MetricChip({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[20px] border px-3 py-2",
        accent ? "border-primary/25 bg-primary/10 text-primary" : "border-border/60 bg-secondary/80",
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-sm font-semibold", accent ? "text-primary" : "text-foreground")}>{value}</div>
    </div>
  );
}

function AssetPreview({
  asset,
  label,
  className,
}: {
  asset: TokenCommunityAsset | null;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[20px] border border-border/60 bg-secondary/70 p-3", className)}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      {asset ? (
        <img
          src={asset.renderUrl}
          alt={label}
          className="h-28 w-full rounded-[16px] object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-28 items-center justify-center rounded-[16px] border border-dashed border-border/60 bg-background/50 text-xs text-muted-foreground">
          Upload {label.toLowerCase()}
        </div>
      )}
    </div>
  );
}

function ReactionStrip({
  reactions,
  disabled,
  onToggle,
}: {
  reactions: TokenCommunityReactionSummary[];
  disabled: boolean;
  onToggle: (reaction: TokenCommunityReactionSummary) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {REACTION_EMOJIS.map((emoji) => {
        const entry = reactions.find((reaction) => reaction.emoji === emoji) ?? {
          emoji,
          count: 0,
          reactedByViewer: false,
        };
        return (
          <button
            key={emoji}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(entry)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              entry.reactedByViewer
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/60 bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{emoji}</span>
            <span>{entry.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function ThreadCard({
  thread,
  tokenAddress,
  viewer,
  canWrite,
  onDeleteThread,
  onReplyCreated,
  onDeleteReply,
  onReactionSummaryChange,
}: {
  thread: TokenCommunityThread;
  tokenAddress: string;
  viewer: ViewerState;
  canWrite: boolean;
  onDeleteThread: (threadId: string) => void;
  onReplyCreated: () => void;
  onDeleteReply: (replyId: string) => void;
  onReactionSummaryChange: (threadId: string, summary: TokenCommunityReactionSummary[]) => void;
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
    onSuccess: async () => {
      setReplyText("");
      await repliesQuery.refetch();
      onReplyCreated();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to reply");
    },
  });

  const reactionMutation = useMutation({
    mutationFn: async (reaction: TokenCommunityReactionSummary) => {
      if (reaction.reactedByViewer) {
        return api.delete<TokenCommunityReactionSummary[]>(
          `/api/tokens/${tokenAddress}/community/threads/${thread.id}/reactions/${encodeURIComponent(reaction.emoji)}`,
        );
      }
      return api.post<TokenCommunityReactionSummary[]>(
        `/api/tokens/${tokenAddress}/community/threads/${thread.id}/reactions`,
        { emoji: reaction.emoji },
      );
    },
    onSuccess: (summary, reaction) => {
      onReactionSummaryChange(thread.id, summary);
      if (!reaction.reactedByViewer) {
        toast.success("Reaction added");
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update reaction");
    },
  });

  const isOwner = viewer?.id === thread.author.id || viewer?.isAdmin;

  return (
    <div className="rounded-[26px] border border-border/60 bg-white/75 p-4 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.42)] dark:bg-white/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10 border border-border">
            <AvatarImage src={getAvatarUrl(thread.author.id, thread.author.image)} />
            <AvatarFallback>{(thread.author.username || thread.author.name || "?").charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{thread.author.username || thread.author.name}</span>
              <span className="rounded-full border border-border/60 bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                lvl {thread.author.level}
              </span>
              {thread.isPinned ? (
                <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                  Pinned
                </span>
              ) : null}
              {thread.kind === "raid" ? (
                <span className="rounded-full border border-amber-300/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">
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

      <div className="mt-3 border-t border-border/50 pt-3">
        <ReactionStrip
          reactions={thread.reactionSummary}
          disabled={!canWrite || reactionMutation.isPending}
          onToggle={(reaction) => reactionMutation.mutate(reaction)}
        />
      </div>

      {expanded ? (
        <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
          {canWrite ? (
            <div className="space-y-2">
              <Textarea
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
                placeholder="Reply with a take, a joke, or a receipt..."
                className="min-h-[96px] rounded-[18px] border-border/60 bg-background/60"
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
  entryIntent = null,
  entryIntentToken = 0,
}: Props) {
  const queryClient = useQueryClient();
  const viewerLevel = viewer?.level ?? 0;
  const viewerScope = viewer?.id ?? "anonymous";
  const tokenLabel = buildTokenLabel(tokenSymbol, tokenName);
  const viewerCanCreateByRole = Boolean(viewer && (viewer.isAdmin || viewerLevel >= 3));
  const [activeTab, setActiveTab] = useState<"board" | "raid">("board");
  const [threadSort, setThreadSort] = useState<"latest" | "trending">("latest");
  const [threadCursor, setThreadCursor] = useState<string | null>(null);
  const [threads, setThreads] = useState<TokenCommunityThread[]>([]);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [nextThreadCursor, setNextThreadCursor] = useState<string | null>(null);
  const [threadTitle, setThreadTitle] = useState("");
  const [threadContent, setThreadContent] = useState("");
  const [raidObjective, setRaidObjective] = useState("");
  const [selectedMemeId, setSelectedMemeId] = useState<string | null>(null);
  const [selectedCopyId, setSelectedCopyId] = useState<string | null>(null);
  const [raidStep, setRaidStep] = useState<1 | 2 | 3 | 4>(1);
  const [previewUnlocked, setPreviewUnlocked] = useState(false);
  const [xPostUrlInput, setXPostUrlInput] = useState("");
  const [boostOffset, setBoostOffset] = useState(0);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [editorStep, setEditorStep] = useState<1 | 2 | 3>(1);
  const [editorDraft, setEditorDraft] = useState<EditorDraft>(() => buildInitialDraft(tokenSymbol, tokenName));
  const [assetLinks, setAssetLinks] = useState<AssetLinkDraft>(() => emptyAssetLinks());
  const [uploadingKind, setUploadingKind] = useState<"logo" | "banner" | "mascot" | "reference_meme" | null>(null);
  const entryIntentRef = useRef<number>(0);
  const hasAutoOpenedCreateRef = useRef(false);

  const tokenQueryKey = ["token-page", viewerScope, tokenAddress] as const;

  const roomQuery = useQuery({
    queryKey: ["token-community-room", tokenAddress],
    enabled: Boolean(viewer?.id),
    queryFn: async () => api.get<TokenCommunityRoom>(`/api/tokens/${tokenAddress}/community/room`),
  });

  const assetHealthQuery = useQuery({
    queryKey: ["token-community-asset-health", tokenAddress],
    enabled: Boolean(viewer?.id),
    staleTime: 30_000,
    queryFn: async () =>
      api.get<TokenCommunityAssetStorageHealth>(`/api/tokens/${tokenAddress}/community/assets/health`),
  });

  const profileQuery = useQuery({
    queryKey: ["token-community-profile", tokenAddress],
    enabled: Boolean(viewer?.id && (roomQuery.data?.exists || editorMode === "edit")),
    queryFn: async () => api.get<TokenCommunityProfile>(`/api/tokens/${tokenAddress}/community/profile`),
  });

  const threadsQuery = useQuery({
    queryKey: ["token-community-threads", tokenAddress, threadSort, threadCursor],
    enabled: Boolean(viewer?.id && roomQuery.data?.exists),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("sort", threadSort);
      if (threadCursor) params.set("cursor", threadCursor);
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      return api.get<ThreadPage>(`/api/tokens/${tokenAddress}/community/threads${suffix}`);
    },
  });

  const activeRaidQuery = useQuery({
    queryKey: ["token-community-active-raid", tokenAddress],
    enabled: Boolean(viewer?.id && roomQuery.data?.exists),
    queryFn: async () =>
      api.get<TokenActiveRaidResponse>(`/api/tokens/${tokenAddress}/community/raids/active`),
  });

  const room =
    roomQuery.data ??
    ({
      exists: false,
      canCreate: viewerCanCreateByRole,
      canJoin: false,
      joined: false,
      joinedAt: null,
      memberCount: 0,
      onlineNowEstimate: 0,
      activeThreadCount: 0,
      currentRaidPulse: null,
      topContributors: [],
      recentMembers: [],
      whyLine: null,
      welcomePrompt: null,
      suggestedThread: null,
      activeRaidSummary: null,
      recentWins: [],
      headline: null,
      xCashtag: null,
      vibeTags: [],
      mascotName: null,
      assets: {
        logo: null,
        banner: null,
        mascot: null,
        referenceMemes: [],
      },
      viewer: {
        joined: false,
        joinedAt: null,
        hasPosted: false,
        hasReplied: false,
        hasRaided: false,
        showWelcomeBanner: false,
        suggestedAction: viewerCanCreateByRole ? "create-community" : "wait-community",
        currentRaidStreak: 0,
        bestRaidStreak: 0,
      },
    } satisfies TokenCommunityRoom);
  const profile = profileQuery.data;
  const activeRaid = activeRaidQuery.data;
  const canManageCommunity = Boolean(
    viewer && (viewer.isAdmin || viewerLevel >= Math.max(profile?.raidLeadMinLevel ?? 3, 3)),
  );
  const canLeadRaid = canManageCommunity;
  const canCreateCommunity = Boolean(room.canCreate || viewerCanCreateByRole);
  const canJoinCommunity = Boolean(room.exists && !room.joined);
  const canWriteInRoom = Boolean(room.exists && room.joined && viewer?.id && canPerformAuthenticatedWrites);
  const campaign: TokenRaidCampaign | null = activeRaid?.campaign ?? null;
  const selectedMeme =
    campaign?.memeOptions.find((option) => option.id === selectedMemeId) ?? null;
  const selectedCopy =
    campaign?.copyOptions.find((option) => option.id === selectedCopyId) ?? null;

  const raidAssets: RaidMemeAssetContext = useMemo(() => {
    if (activeRaid?.communityAssets) return activeRaid.communityAssets;
    if (room?.assets) return room.assets;
    return {
      logo: null,
      banner: null,
      mascot: null,
      referenceMemes: [],
    };
  }, [activeRaid?.communityAssets, room?.assets]);

  const raidTokenContext = useMemo(
    () => ({
      tokenLabel,
      communityTag: communityTag(room ?? profile, tokenSymbol, tokenName),
      roomHeadline: room?.headline || profile?.headline || null,
    }),
    [profile, room, tokenLabel, tokenName, tokenSymbol],
  );

  const activeStepProgress = raidStep === 1 ? 25 : raidStep === 2 ? 50 : raidStep === 3 ? 75 : 100;
  const roomHydrating = roomQuery.isLoading && !roomQuery.data;
  const roomLoadError = roomQuery.error instanceof Error ? roomQuery.error : null;
  const assetStorageHealth = assetHealthQuery.data ?? null;
  const assetStorageIssueCopy = getAssetStorageIssueCopy(assetStorageHealth);

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
    setThreadCursor(null);
    setThreads([]);
    setHasMoreThreads(false);
    setNextThreadCursor(null);
  }, [threadSort]);

  useEffect(() => {
    if (!room || entryIntentRef.current === entryIntentToken) return;
    if (entryIntent === "create-community" && !room.exists) {
      setActiveTab("board");
      setEditorMode("create");
      setEditorStep(1);
      setEditorDraft(buildInitialDraft(tokenSymbol, tokenName, room, profile ?? null));
      setAssetLinks(emptyAssetLinks());
      entryIntentRef.current = entryIntentToken;
    }
  }, [entryIntent, entryIntentToken, profile, room, tokenName, tokenSymbol]);

  useEffect(() => {
    if (room && !room.exists && canCreateCommunity && !editorMode && !hasAutoOpenedCreateRef.current) {
      setEditorMode("create");
      setEditorStep(1);
      setEditorDraft(buildInitialDraft(tokenSymbol, tokenName, room, profile ?? null));
      setAssetLinks(emptyAssetLinks());
      hasAutoOpenedCreateRef.current = true;
    }
  }, [canCreateCommunity, editorMode, profile, room, tokenName, tokenSymbol]);

  useEffect(() => {
    if (!campaign) {
      setSelectedMemeId(null);
      setSelectedCopyId(null);
      setRaidStep(1);
      setPreviewUnlocked(false);
      setXPostUrlInput("");
      setBoostOffset(0);
      return;
    }

    setRaidObjective(campaign.objective);
    setXPostUrlInput(activeRaid?.mySubmission?.xPostUrl ?? "");
    setBoostOffset(0);

    if (activeRaid?.mySubmission?.memeOptionId) {
      setSelectedMemeId(activeRaid.mySubmission.memeOptionId);
    } else if (!campaign.memeOptions.some((option) => option.id === selectedMemeId)) {
      setSelectedMemeId(null);
    }

    if (activeRaid?.mySubmission?.copyOptionId) {
      setSelectedCopyId(activeRaid.mySubmission.copyOptionId);
    } else if (!campaign.copyOptions.some((option) => option.id === selectedCopyId)) {
      setSelectedCopyId(null);
    }

    if (activeRaid?.mySubmission) {
      setPreviewUnlocked(true);
      setRaidStep(4);
      return;
    }

    if (selectedMemeId && selectedCopyId && previewUnlocked) {
      setRaidStep(4);
    } else if (selectedMemeId && selectedCopyId) {
      setRaidStep(3);
    } else if (selectedMemeId) {
      setRaidStep(2);
    } else {
      setRaidStep(1);
      setPreviewUnlocked(false);
    }
  }, [
    activeRaid?.mySubmission,
    campaign,
    previewUnlocked,
    selectedCopyId,
    selectedMemeId,
  ]);

  useEffect(() => {
    if (!profile && editorMode === "edit" && room) {
      setEditorDraft(buildInitialDraft(tokenSymbol, tokenName, room, null));
    }
  }, [editorMode, profile, room, tokenName, tokenSymbol]);

  const invalidateCommunityQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["token-community-room", tokenAddress] }),
      queryClient.invalidateQueries({ queryKey: ["token-community-profile", tokenAddress] }),
      queryClient.invalidateQueries({ queryKey: ["token-community-active-raid", tokenAddress] }),
      queryClient.invalidateQueries({ queryKey: ["token-community-threads", tokenAddress] }),
      queryClient.invalidateQueries({ queryKey: tokenQueryKey }),
    ]);
  };

  const updateThreadReactionSummary = (threadId: string, summary: TokenCommunityReactionSummary[]) => {
    setThreads((current) =>
      current.map((thread) => (thread.id === threadId ? { ...thread, reactionSummary: summary } : thread)),
    );
  };

  const resetThreadFeed = async () => {
    setThreadCursor(null);
    await queryClient.invalidateQueries({ queryKey: ["token-community-threads", tokenAddress] });
  };

  const openEditor = (mode: Exclude<EditorMode, null>) => {
    setEditorMode(mode);
    setEditorStep(1);
    setEditorDraft(buildInitialDraft(tokenSymbol, tokenName, room ?? null, profile ?? null));
    setAssetLinks(emptyAssetLinks());
  };

  const joinCommunityMutation = useMutation({
    mutationFn: async () => api.post<{ following: boolean }>(`/api/tokens/${tokenAddress}/follow`),
    onSuccess: async () => {
      toast.success("You joined the community");
      await invalidateCommunityQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to join community");
    },
  });

  const saveCommunityMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        headline: editorDraft.headline.trim(),
        whyLine: editorDraft.whyLine.trim(),
        welcomePrompt: editorDraft.welcomePrompt.trim(),
        xCashtag: editorDraft.xCashtag.trim() || null,
        mascotName: editorDraft.mascotName.trim() || null,
        vibeTags: splitTagInput(editorDraft.vibeTags, 6),
        voiceHints: splitTagInput(editorDraft.voiceHints, 6),
        insideJokes: splitTagInput(editorDraft.insideJokes, 6),
        assetIds: draftAssetIds(editorDraft.assets),
      };

      if (!canPublishAssets(editorDraft.assets)) {
        throw new Error("Community needs a logo, a banner, and 1-5 reference memes");
      }

      if (editorMode === "create") {
        return api.post<TokenCommunityRoom>(`/api/tokens/${tokenAddress}/community`, payload);
      }
      return api.patch<TokenCommunityProfile>(`/api/tokens/${tokenAddress}/community/profile`, payload);
    },
    onSuccess: async () => {
      toast.success(editorMode === "create" ? "Community created" : "Community updated");
      setEditorMode(null);
      await invalidateCommunityQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save community");
    },
  });

  const createThreadMutation = useMutation({
    mutationFn: async () =>
      api.post<TokenCommunityThread>(`/api/tokens/${tokenAddress}/community/threads`, {
        title: threadTitle.trim() || undefined,
        content: threadContent.trim(),
      }),
    onSuccess: async () => {
      setThreadTitle("");
      setThreadContent("");
      await resetThreadFeed();
      await queryClient.invalidateQueries({ queryKey: ["token-community-room", tokenAddress] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create thread");
    },
  });

  const deleteThreadMutation = useMutation({
    mutationFn: async (threadId: string) =>
      api.delete<{ deleted: boolean }>(`/api/tokens/${tokenAddress}/community/threads/${threadId}`),
    onSuccess: async () => {
      await resetThreadFeed();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete thread");
    },
  });

  const deleteReplyMutation = useMutation({
    mutationFn: async (replyId: string) =>
      api.delete<{ deleted: boolean }>(`/api/tokens/${tokenAddress}/community/replies/${replyId}`),
    onSuccess: async () => {
      await resetThreadFeed();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete reply");
    },
  });

  const startRaidMutation = useMutation({
    mutationFn: async () =>
      api.post<TokenActiveRaidResponse>(`/api/tokens/${tokenAddress}/community/raids`, {
        objective: raidObjective.trim() || undefined,
      }),
    onSuccess: async () => {
      toast.success("Raid campaign started");
      setActiveTab("raid");
      setRaidStep(1);
      setPreviewUnlocked(false);
      await invalidateCommunityQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start raid campaign");
    },
  });

  const joinRaidMutation = useMutation({
    mutationFn: async () => {
      if (!campaign) throw new Error("No active raid campaign");
      return api.post(`/api/tokens/${tokenAddress}/community/raids/${campaign.id}/join`);
    },
    onSuccess: async () => {
      toast.success("Joined raid campaign");
      setRaidStep(1);
      await invalidateCommunityQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to join raid");
    },
  });

  const regenerateRaidMutation = useMutation({
    mutationFn: async () => {
      if (!campaign) throw new Error("No active raid campaign");
      return api.post<TokenActiveRaidResponse>(
        `/api/tokens/${tokenAddress}/community/raids/${campaign.id}/regenerate`,
      );
    },
    onSuccess: async () => {
      setSelectedMemeId(null);
      setSelectedCopyId(null);
      setRaidStep(1);
      setPreviewUnlocked(false);
      toast.success("Fresh raid options loaded");
      await invalidateCommunityQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to regenerate raid options");
    },
  });

  const launchRaidMutation = useMutation({
    mutationFn: async () => {
      if (!campaign || !selectedMeme || !selectedCopy) {
        throw new Error("Choose a meme and a text first");
      }

      const submission = await api.post(
        `/api/tokens/${tokenAddress}/community/raids/${campaign.id}/launch`,
        {
          memeOptionId: selectedMeme.id,
          copyOptionId: selectedCopy.id,
          renderPayloadJson: {
            templateId: selectedMeme.templateId,
            title: selectedMeme.title,
            toneLabel: selectedMeme.toneLabel,
            socialTag: selectedCopy.socialTag,
            assetIdsUsed: selectedMeme.assetIdsUsed,
          },
          composerText: selectedCopy.text,
        },
      );

      await navigator.clipboard.writeText(selectedCopy.text).catch(() => undefined);
      const blob = await renderRaidMemePngBlob(selectedMeme, raidTokenContext, raidAssets);
      const copiedImage = await tryWriteImageToClipboard(blob);
      downloadBlob(blob, `${(tokenSymbol || tokenName || "community").replace(/\s+/g, "-").toLowerCase()}-raid.png`);

      const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(selectedCopy.text)}`;
      window.open(intentUrl, "_blank", "noopener,noreferrer");

      toast.success(copiedImage ? "Raid kit copied and opened on X" : "Raid kit downloaded and opened on X");
      return submission;
    },
    onSuccess: async () => {
      setPreviewUnlocked(true);
      setRaidStep(4);
      await invalidateCommunityQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to launch raid");
    },
  });

  const saveXPostMutation = useMutation({
    mutationFn: async () => {
      if (!campaign) throw new Error("No active raid campaign");
      return api.patch(
        `/api/tokens/${tokenAddress}/community/raids/${campaign.id}/submission`,
        { xPostUrl: xPostUrlInput.trim() },
      );
    },
    onSuccess: async () => {
      toast.success("Raid post linked back to the room");
      await invalidateCommunityQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save X post link");
    },
  });

  const boostMutation = useMutation({
    mutationFn: async (submissionId: string) => {
      if (!campaign) throw new Error("No active raid campaign");
      return api.post<{ boosted: boolean; boostCount: number }>(
        `/api/tokens/${tokenAddress}/community/raids/${campaign.id}/submissions/${submissionId}/boosts`,
      );
    },
    onSuccess: async () => {
      await invalidateCommunityQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to boost raid post");
    },
  });

  const uploadCommunityAsset = async (kind: "logo" | "banner" | "mascot" | "reference_meme", file: File) => {
    const dimensions = await getImageDimensions(file);
    const presigned = await api.post<TokenCommunityAssetPresignResponse>(
      `/api/tokens/${tokenAddress}/community/assets/presign`,
      {
        kind,
        fileName: file.name,
        contentType: file.type || "image/png",
        sizeBytes: file.size,
        width: dimensions?.width,
        height: dimensions?.height,
      },
    );
    try {
      const response = await fetch(presigned.upload.url, {
        method: presigned.upload.method,
        headers: presigned.upload.headers,
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Upload blocked by storage policy (${response.status})`);
      }

      return api.post<TokenCommunityAsset>(
        `/api/tokens/${tokenAddress}/community/assets/${presigned.asset.id}/complete`,
      );
    } catch (error) {
      await api.delete(`/api/tokens/${tokenAddress}/community/assets/${presigned.asset.id}`).catch(() => undefined);
      const healthHint = getAssetStorageIssueCopy(assetStorageHealth);
      if (healthHint) {
        throw new Error(healthHint);
      }
      if (error instanceof Error && /failed to fetch/i.test(error.message)) {
        throw new Error("Upload could not reach asset storage. Check the R2 bucket CORS policy and public asset domain.");
      }
      throw error;
    }
  };

  const importCommunityAsset = async (
    kind: "logo" | "banner" | "mascot" | "reference_meme",
    sourceUrl: string,
  ) => {
    const payload: TokenCommunityAssetImportRequest = {
      kind,
      sourceUrl: sourceUrl.trim(),
    };
    return api.post<TokenCommunityAsset>(
      `/api/tokens/${tokenAddress}/community/assets/import`,
      payload,
    );
  };

  const handleSingleAssetUpload = async (kind: "logo" | "banner" | "mascot", file: File | null) => {
    if (!file) return;
    try {
      setUploadingKind(kind);
      const asset = await uploadCommunityAsset(kind, file);
      setEditorDraft((current) => ({
        ...current,
        assets: {
          ...current.assets,
          [kind]: asset,
        },
      }));
      toast.success(`${kind[0].toUpperCase()}${kind.slice(1)} uploaded`);
    } catch (error) {
      toast.error(getAssetActionErrorMessage(error, "Upload failed"));
    } finally {
      setUploadingKind(null);
    }
  };

  const handleReferenceUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileList = Array.from(files).slice(0, Math.max(0, 5 - editorDraft.assets.referenceMemes.length));
    try {
      setUploadingKind("reference_meme");
      const uploaded: TokenCommunityAsset[] = [];
      for (const file of fileList) {
        uploaded.push(await uploadCommunityAsset("reference_meme", file));
      }
      setEditorDraft((current) => ({
        ...current,
        assets: {
          ...current.assets,
          referenceMemes: [...current.assets.referenceMemes, ...uploaded].slice(0, 5),
        },
      }));
      toast.success(`${uploaded.length} reference meme${uploaded.length === 1 ? "" : "s"} uploaded`);
    } catch (error) {
      toast.error(getAssetActionErrorMessage(error, "Upload failed"));
    } finally {
      setUploadingKind(null);
    }
  };

  const handleSingleAssetImport = async (kind: "logo" | "banner" | "mascot") => {
    const sourceUrl = assetLinks[kind].trim();
    if (!sourceUrl) return;
    try {
      setUploadingKind(kind);
      const asset = await importCommunityAsset(kind, sourceUrl);
      setEditorDraft((current) => ({
        ...current,
        assets: {
          ...current.assets,
          [kind]: asset,
        },
      }));
      setAssetLinks((current) => ({ ...current, [kind]: "" }));
      toast.success(`${kind[0].toUpperCase()}${kind.slice(1)} imported`);
    } catch (error) {
      toast.error(getAssetActionErrorMessage(error, "Import failed"));
    } finally {
      setUploadingKind(null);
    }
  };

  const handleReferenceImport = async () => {
    const sourceUrl = assetLinks.reference_meme.trim();
    if (!sourceUrl) return;
    if (editorDraft.assets.referenceMemes.length >= 5) {
      toast.error("You already have 5 reference memes");
      return;
    }
    try {
      setUploadingKind("reference_meme");
      const asset = await importCommunityAsset("reference_meme", sourceUrl);
      setEditorDraft((current) => ({
        ...current,
        assets: {
          ...current.assets,
          referenceMemes: [...current.assets.referenceMemes, asset].slice(0, 5),
        },
      }));
      setAssetLinks((current) => ({ ...current, reference_meme: "" }));
      toast.success("Reference meme imported");
    } catch (error) {
      toast.error(getAssetActionErrorMessage(error, "Import failed"));
    } finally {
      setUploadingKind(null);
    }
  };

  const handleOpenBoostBatch = async () => {
    const submissions = activeRaid?.submissions ?? [];
    if (submissions.length === 0) {
      toast.info("No linked raid posts yet");
      return;
    }
    const batch = submissions.slice(boostOffset, boostOffset + 5);
    for (const submission of batch) {
      if (!submission.xPostUrl) continue;
      window.open(submission.xPostUrl, "_blank", "noopener,noreferrer");
      if (!submission.isBoostedByViewer) {
        await boostMutation.mutateAsync(submission.id).catch(() => undefined);
      }
    }
    setBoostOffset((current) => {
      const next = current + 5;
      return next >= submissions.length ? 0 : next;
    });
  };

  if (!viewer?.id) {
    return (
      <section id="token-community-room" className="app-surface p-6">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Users className="h-4 w-4 text-primary" />
          Token community
        </div>
        <div className="mt-4 rounded-[26px] border border-dashed border-border/60 bg-secondary/60 p-6">
          <h3 className="text-lg font-semibold text-foreground">Sign in to enter this community room</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Community threads, raid campaigns, meme selection, and the live boost wall are all account-linked so your room
            state and raid streaks follow you.
          </p>
        </div>
      </section>
    );
  }

  const activeRaidLabel =
    room.currentRaidPulse?.label ||
    (room.activeRaidSummary ? `${room.activeRaidSummary.joinedCount} joined raid campaign` : "No live raid yet");
  const suggestedBundleLabel =
    selectedMeme && selectedCopy
      ? `You picked the ${selectedMeme.title.toLowerCase()} meme + ${selectedCopy.label.toLowerCase()} copy`
      : "Pick a meme first, then lock the copy angle.";

  return (
    <section id="token-community-room" className="space-y-5">
      {roomHydrating ? (
        <div className="app-surface p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading community room...
          </div>
        </div>
      ) : null}

      {roomLoadError ? (
        <div className="rounded-[24px] border border-amber-300/40 bg-amber-400/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          <div className="font-semibold">Community room is still warming up</div>
          <p className="mt-1 leading-6">
            {roomLoadError.message || "We could not load the full room yet."}
          </p>
          <div className="mt-3">
            <Button variant="outline" className="rounded-full" onClick={() => void roomQuery.refetch()}>
              Retry room load
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[30px] border border-border/60 bg-card shadow-[0_24px_70px_-45px_rgba(15,23,42,0.55)]">
        <div
          className="relative overflow-hidden px-5 pb-5 pt-6 sm:px-6"
          style={
            room.assets.banner
              ? {
                  backgroundImage: `linear-gradient(135deg, rgba(6,10,20,0.86), rgba(16,24,40,0.54)), url(${room.assets.banner.renderUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : {
                  backgroundImage:
                    "linear-gradient(135deg, rgba(8,15,27,0.98), rgba(30,64,175,0.72) 45%, rgba(34,197,94,0.58))",
                }
          }
        >
          <div className="relative z-10">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[22px] border border-white/15 bg-white/10 shadow-[0_14px_32px_-18px_rgba(0,0,0,0.6)]">
                        {room.assets.logo ? (
                          <img src={room.assets.logo.renderUrl} alt="Community logo" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xl font-black text-white">{communityTag(room, tokenSymbol, tokenName).slice(0, 3)}</span>
                        )}
                      </div>
                      {room.assets.mascot ? (
                        <img
                          src={room.assets.mascot.renderUrl}
                          alt="Community mascot"
                          className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full border-2 border-slate-950 object-cover shadow-lg"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
                          Live room
                        </span>
                        <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                          {room.joined ? "In Community" : room.exists ? "Room Open" : "Not Created"}
                        </span>
                      </div>
                      <h2 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl">
                        {room.headline || `${communityTag(room, tokenSymbol, tokenName)} community room`}
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-white/78">
                        {room.whyLine || `${communityTag(room, tokenSymbol, tokenName)} is building a room for fast takes, receipts, and coordinated raids.`}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {(room.vibeTags.length > 0 ? room.vibeTags : ["late-night desk", "receipt room", "raid signal"]).slice(0, 5).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/84"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid min-w-[280px] grid-cols-2 gap-2 sm:min-w-[340px]">
                <MetricChip label="Members" value={formatCount(room.memberCount)} accent />
                <MetricChip label="Online now" value={formatCount(room.onlineNowEstimate)} />
                <MetricChip label="Threads" value={formatCount(room.activeThreadCount)} />
                <MetricChip label="Raid pulse" value={activeRaidLabel} />
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex -space-x-2">
                  {room.recentMembers.slice(0, 5).map((member) => (
                    <Avatar key={member.user.id} className="h-9 w-9 border-2 border-slate-950 shadow-sm">
                      <AvatarImage src={getAvatarUrl(member.user.id, member.user.image)} />
                      <AvatarFallback>{(member.user.username || member.user.name || "?").charAt(0)}</AvatarFallback>
                    </Avatar>
                  ))}
                </div>
                <div className="text-sm text-white/78">
                  {room.recentMembers.length > 0
                    ? `Recent arrivals include ${room.recentMembers
                        .slice(0, 3)
                        .map((member) => member.user.username || member.user.name)
                        .join(", ")}`
                    : "Start this room with the first wave of members."}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!room.exists && canCreateCommunity ? (
                  <Button className="rounded-full bg-white text-slate-950 hover:bg-white/90" onClick={() => openEditor("create")}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Create Community
                  </Button>
                ) : null}
                {room.exists && !room.joined ? (
                  <Button
                    className="rounded-full bg-white text-slate-950 hover:bg-white/90"
                    onClick={() => joinCommunityMutation.mutate()}
                    disabled={joinCommunityMutation.isPending}
                  >
                    {joinCommunityMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                    Join Community
                  </Button>
                ) : null}
                {room.exists && room.joined && canManageCommunity ? (
                  <Button variant="outline" className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white/15" onClick={() => openEditor("edit")}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit Room
                  </Button>
                ) : null}
                {room.activeRaidSummary ? (
                  <Button
                    variant="outline"
                    className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white/15"
                    onClick={() => setActiveTab("raid")}
                  >
                    <Megaphone className="mr-2 h-4 w-4" />
                    View Raid
                  </Button>
                ) : null}
              </div>
            </div>

            {room.joined && room.viewer.showWelcomeBanner ? (
              <div className="mt-5 rounded-[24px] border border-white/15 bg-white/10 p-4 text-white backdrop-blur">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-semibold">Welcome to the room</div>
                    <p className="mt-1 text-sm leading-6 text-white/78">
                      {room.welcomePrompt || "Drop your first take, reply to a thread, or join the current raid campaign."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {room.activeRaidSummary ? (
                      <Button className="rounded-full bg-white text-slate-950 hover:bg-white/90" onClick={() => setActiveTab("raid")}>
                        Join raid
                      </Button>
                    ) : null}
                    {room.suggestedThread ? (
                      <Button variant="outline" className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white/15" onClick={() => setActiveTab("board")}>
                        Reply to thread
                      </Button>
                    ) : (
                      <Button variant="outline" className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white/15" onClick={() => setActiveTab("board")}>
                        Drop your first take
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 border-t border-border/60 bg-background/70 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[22px] border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Flame className="h-4 w-4 text-primary" />
              Raid streak
            </div>
            <div className="mt-3 text-2xl font-black text-foreground">{room.viewer.currentRaidStreak}</div>
            <div className="mt-1 text-xs text-muted-foreground">Best streak: {room.viewer.bestRaidStreak}</div>
          </div>

          <div className="rounded-[22px] border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Trophy className="h-4 w-4 text-primary" />
              Top contributors
            </div>
            <div className="mt-3 space-y-2">
              {room.topContributors.slice(0, 3).map((entry) => (
                <div key={entry.user.id} className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar className="h-7 w-7 border border-border">
                      <AvatarImage src={getAvatarUrl(entry.user.id, entry.user.image)} />
                      <AvatarFallback>{(entry.user.username || entry.user.name || "?").charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{entry.user.username || entry.user.name}</div>
                    </div>
                  </div>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]", roomBadgeTone(entry.badge))}>
                    {entry.badge.replace("-", " ")}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[22px] border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              Recent wins
            </div>
            <div className="mt-3 space-y-2">
              {room.recentWins.length > 0 ? (
                room.recentWins.slice(0, 3).map((win) => (
                  <a
                    key={win.id}
                    href={win.xPostUrl || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-[16px] border border-border/60 bg-secondary/70 p-3 transition-colors hover:border-primary/30"
                  >
                    <div className="text-sm font-medium text-foreground">{win.user.username || win.user.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {win.postedAt ? formatTimeAgo(win.postedAt) : "just now"} · {win.boostCount} boosts
                    </div>
                  </a>
                ))
              ) : (
                <div className="rounded-[16px] border border-dashed border-border/60 bg-secondary/50 p-3 text-sm text-muted-foreground">
                  Linked raid posts will show up here as the room starts posting.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[22px] border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Users className="h-4 w-4 text-primary" />
              Rank progression
            </div>
            <div className="mt-3 text-sm leading-6 text-muted-foreground">
              You are level {viewerLevel}. Trusted-member room actions unlock from level {profile?.raidLeadMinLevel ?? 3}, and
              every thread, reply, boost, and posted raid keeps this room feeling alive.
            </div>
          </div>
        </div>
      </div>

      {editorMode ? (
        <div className="rounded-[28px] border border-border/60 bg-card p-5 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.42)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <WandSparkles className="h-4 w-4 text-primary" />
                {editorMode === "create" ? "Create community" : "Manage room"}
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {editorMode === "create"
                  ? "Build the room identity first, then lock the banner, logo, mascot, and 1-5 reference memes before publishing."
                  : "Update the room tone and brand kit without breaking the current community flow."}
              </p>
            </div>
            <Button variant="ghost" className="rounded-full" onClick={() => setEditorMode(null)}>
              Close
            </Button>
          </div>

          <div className="mt-4">
            <Progress value={editorStep === 1 ? 34 : editorStep === 2 ? 67 : 100} className="h-2.5 bg-secondary/80" />
            <div className="mt-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <span>Step 1 Identity</span>
              <span>Step 2 Brand kit</span>
              <span>Step 3 Preview</span>
            </div>
          </div>

          {editorStep === 1 ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground">Headline</div>
                <Textarea
                  value={editorDraft.headline}
                  onChange={(event) => setEditorDraft((current) => ({ ...current, headline: event.target.value }))}
                  className="min-h-[96px] rounded-[18px] border-border/60 bg-background/70"
                />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground">Why this room exists</div>
                <Textarea
                  value={editorDraft.whyLine}
                  onChange={(event) => setEditorDraft((current) => ({ ...current, whyLine: event.target.value }))}
                  className="min-h-[96px] rounded-[18px] border-border/60 bg-background/70"
                />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground">Welcome prompt</div>
                <Textarea
                  value={editorDraft.welcomePrompt}
                  onChange={(event) => setEditorDraft((current) => ({ ...current, welcomePrompt: event.target.value }))}
                  className="min-h-[96px] rounded-[18px] border-border/60 bg-background/70"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-foreground">Community tag</div>
                  <Input
                    value={editorDraft.xCashtag}
                    onChange={(event) => setEditorDraft((current) => ({ ...current, xCashtag: event.target.value }))}
                    className="rounded-[16px] border-border/60 bg-background/70"
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-foreground">Mascot name</div>
                  <Input
                    value={editorDraft.mascotName}
                    onChange={(event) => setEditorDraft((current) => ({ ...current, mascotName: event.target.value }))}
                    className="rounded-[16px] border-border/60 bg-background/70"
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <div className="text-sm font-semibold text-foreground">Vibe tags</div>
                  <Input
                    value={editorDraft.vibeTags}
                    onChange={(event) => setEditorDraft((current) => ({ ...current, vibeTags: event.target.value }))}
                    className="rounded-[16px] border-border/60 bg-background/70"
                    placeholder="late-night desk, receipt room, internet courtroom"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <div className="text-sm font-semibold text-foreground">Voice hints</div>
                  <Input
                    value={editorDraft.voiceHints}
                    onChange={(event) => setEditorDraft((current) => ({ ...current, voiceHints: event.target.value }))}
                    className="rounded-[16px] border-border/60 bg-background/70"
                    placeholder="dry confidence, internet-native and sharp"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <div className="text-sm font-semibold text-foreground">Inside jokes</div>
                  <Input
                    value={editorDraft.insideJokes}
                    onChange={(event) => setEditorDraft((current) => ({ ...current, insideJokes: event.target.value }))}
                    className="rounded-[16px] border-border/60 bg-background/70"
                    placeholder="receipts age better than cope"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {editorStep === 2 ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-3 rounded-[24px] border border-border/60 bg-secondary/55 p-4">
                  <AssetPreview asset={editorDraft.assets.logo} label="Logo" />
                  <label className="block">
                    <span className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Upload className="h-4 w-4 text-primary" />
                      Upload logo
                    </span>
                    <Input
                      type="file"
                      accept="image/*"
                      className="rounded-[16px] border-border/60 bg-background/70"
                      onChange={(event) => void handleSingleAssetUpload("logo", event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <div className="space-y-2">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ExternalLink className="h-4 w-4 text-primary" />
                      Import logo from link
                    </span>
                    <div className="flex gap-2">
                      <Input
                        value={assetLinks.logo}
                        onChange={(event) => setAssetLinks((current) => ({ ...current, logo: event.target.value }))}
                        className="rounded-[16px] border-border/60 bg-background/70"
                        placeholder="https://..."
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-full"
                        disabled={!assetLinks.logo.trim() || uploadingKind !== null}
                        onClick={() => void handleSingleAssetImport("logo")}
                      >
                        Import
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="space-y-3 rounded-[24px] border border-border/60 bg-secondary/55 p-4">
                  <AssetPreview asset={editorDraft.assets.banner} label="Banner" />
                  <label className="block">
                    <span className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Upload className="h-4 w-4 text-primary" />
                      Upload banner
                    </span>
                    <Input
                      type="file"
                      accept="image/*"
                      className="rounded-[16px] border-border/60 bg-background/70"
                      onChange={(event) => void handleSingleAssetUpload("banner", event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <div className="space-y-2">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ExternalLink className="h-4 w-4 text-primary" />
                      Import banner from link
                    </span>
                    <div className="flex gap-2">
                      <Input
                        value={assetLinks.banner}
                        onChange={(event) => setAssetLinks((current) => ({ ...current, banner: event.target.value }))}
                        className="rounded-[16px] border-border/60 bg-background/70"
                        placeholder="https://..."
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-full"
                        disabled={!assetLinks.banner.trim() || uploadingKind !== null}
                        onClick={() => void handleSingleAssetImport("banner")}
                      >
                        Import
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="space-y-3 rounded-[24px] border border-border/60 bg-secondary/55 p-4">
                  <AssetPreview asset={editorDraft.assets.mascot} label="Mascot" />
                  <label className="block">
                    <span className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ImagePlus className="h-4 w-4 text-primary" />
                      Upload mascot
                    </span>
                    <Input
                      type="file"
                      accept="image/*"
                      className="rounded-[16px] border-border/60 bg-background/70"
                      onChange={(event) => void handleSingleAssetUpload("mascot", event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <div className="space-y-2">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ExternalLink className="h-4 w-4 text-primary" />
                      Import mascot from link
                    </span>
                    <div className="flex gap-2">
                      <Input
                        value={assetLinks.mascot}
                        onChange={(event) => setAssetLinks((current) => ({ ...current, mascot: event.target.value }))}
                        className="rounded-[16px] border-border/60 bg-background/70"
                        placeholder="https://..."
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-full"
                        disabled={!assetLinks.mascot.trim() || uploadingKind !== null}
                        onClick={() => void handleSingleAssetImport("mascot")}
                      >
                        Import
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-border/60 bg-secondary/55 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Reference memes</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Upload or import 1-5 memes the room already loves so the raid generator has real community texture to work with.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border/60 bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary/30">
                      <Upload className="h-4 w-4 text-primary" />
                      Add reference memes
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(event) => void handleReferenceUpload(event.target.files)}
                      />
                    </label>
                    <div className="flex min-w-[280px] flex-1 gap-2">
                      <Input
                        value={assetLinks.reference_meme}
                        onChange={(event) =>
                          setAssetLinks((current) => ({ ...current, reference_meme: event.target.value }))
                        }
                        className="rounded-[16px] border-border/60 bg-background/70"
                        placeholder="Paste meme image URL"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-full"
                        disabled={
                          !assetLinks.reference_meme.trim() ||
                          uploadingKind !== null ||
                          editorDraft.assets.referenceMemes.length >= 5
                        }
                        onClick={() => void handleReferenceImport()}
                      >
                        Import link
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-[18px] border border-sky-300/35 bg-sky-500/8 p-4 text-sm leading-6 text-sky-900 dark:text-sky-100">
                  <div className="font-semibold">Minimal storage model</div>
                  <p className="mt-1">
                    Only the community brand kit persists here: logo, banner, mascot, and 1-5 reference memes. Generated raid memes stay client-side only for copy, download, and posting.
                  </p>
                </div>

                {assetStorageIssueCopy ? (
                  <div className="mt-4 rounded-[18px] border border-amber-300/35 bg-amber-500/10 p-4 text-sm leading-6 text-amber-900 dark:text-amber-100">
                    <div className="font-semibold">Asset storage needs attention</div>
                    <p className="mt-1">{assetStorageIssueCopy}</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 rounded-full"
                      onClick={() => void assetHealthQuery.refetch()}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Recheck storage
                    </Button>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {editorDraft.assets.referenceMemes.map((asset) => (
                    <AssetPreview key={asset.id} asset={asset} label="Reference meme" className="p-2" />
                  ))}
                  {editorDraft.assets.referenceMemes.length === 0 ? (
                    <div className="col-span-full rounded-[18px] border border-dashed border-border/60 bg-background/50 p-4 text-sm text-muted-foreground">
                      No reference memes yet.
                    </div>
                  ) : null}
                </div>
              </div>

              {uploadingKind ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading {uploadingKind.replace("_", " ")}...
                </div>
              ) : null}
            </div>
          ) : null}

          {editorStep === 3 ? (
            <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
              <div className="rounded-[26px] border border-border/60 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.08),transparent_44%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_32%)] p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Room preview</div>
                <h3 className="mt-3 text-2xl font-black tracking-tight text-foreground">{editorDraft.headline}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{editorDraft.whyLine}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {splitTagInput(editorDraft.vibeTags, 6).map((tag) => (
                    <span key={tag} className="rounded-full border border-border/60 bg-secondary px-3 py-1 text-xs text-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <AssetPreview asset={editorDraft.assets.logo} label="Logo" />
                  <AssetPreview asset={editorDraft.assets.banner} label="Banner" />
                </div>
              </div>

              <div className="rounded-[26px] border border-border/60 bg-card p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Publish checklist</div>
                <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                  <div className={cn("rounded-[18px] border px-4 py-3", editorDraft.assets.logo ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border/60 bg-secondary/60")}>
                    1 logo selected
                  </div>
                  <div className={cn("rounded-[18px] border px-4 py-3", editorDraft.assets.banner ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border/60 bg-secondary/60")}>
                    1 banner selected
                  </div>
                  <div className={cn("rounded-[18px] border px-4 py-3", editorDraft.assets.referenceMemes.length >= 1 && editorDraft.assets.referenceMemes.length <= 5 ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border/60 bg-secondary/60")}>
                    {editorDraft.assets.referenceMemes.length} / 5 reference memes selected
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
            <Button variant="outline" className="rounded-full" onClick={() => setEditorStep((current) => Math.max(1, current - 1) as 1 | 2 | 3)} disabled={editorStep === 1 || saveCommunityMutation.isPending}>
              Back
            </Button>
            <div className="flex flex-wrap gap-2">
              {editorStep < 3 ? (
                <Button
                  className="rounded-full"
                  onClick={() => setEditorStep((current) => Math.min(3, current + 1) as 1 | 2 | 3)}
                  disabled={
                    (editorStep === 1 &&
                      (!editorDraft.headline.trim() || !editorDraft.whyLine.trim() || !editorDraft.welcomePrompt.trim())) ||
                    (editorStep === 2 && !canPublishAssets(editorDraft.assets))
                  }
                >
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button
                  className="rounded-full"
                  onClick={() => saveCommunityMutation.mutate()}
                  disabled={saveCommunityMutation.isPending || !canPublishAssets(editorDraft.assets)}
                >
                  {saveCommunityMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {editorMode === "create" ? "Publish community" : "Save room updates"}
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "board" | "raid")} className="space-y-4">
        <TabsList className="grid h-auto grid-cols-2 rounded-[22px] border border-border/60 bg-card p-1">
          <TabsTrigger value="board" className="rounded-[18px] py-2 text-sm font-semibold">Board</TabsTrigger>
          <TabsTrigger value="raid" className="rounded-[18px] py-2 text-sm font-semibold">Raid</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="space-y-4">
          {!room.exists ? (
            <div className="rounded-[28px] border border-border/60 bg-card p-6">
              <h3 className="text-xl font-black tracking-tight text-foreground">This token does not have a community yet</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                The room opens only after a trusted member creates the community identity, uploads the brand kit, and seeds the first memes.
              </p>
              <div className="mt-5">
                {canCreateCommunity ? (
                  <Button className="rounded-full" onClick={() => openEditor("create")}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Create Community
                  </Button>
                ) : (
                  <div className="rounded-[18px] border border-dashed border-border/60 bg-secondary/60 p-4 text-sm text-muted-foreground">
                    Community Not Open Yet. Trusted members at level 3+ can create the first room for this token.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
              <div className="space-y-4">
                {room.suggestedThread ? (
                  <div className="rounded-[26px] border border-border/60 bg-card p-5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <MessageSquare className="h-4 w-4 text-primary" />
                      Suggested first thread
                    </div>
                    <div className="mt-3 rounded-[20px] border border-border/60 bg-secondary/65 p-4">
                      <div className="text-base font-semibold text-foreground">
                        {room.suggestedThread.title || "Live room thread"}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{room.suggestedThread.content}</p>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-[26px] border border-border/60 bg-card p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <MessageSquare className="h-4 w-4 text-primary" />
                      Community board
                    </div>
                    <div className="inline-flex rounded-full border border-border/60 bg-secondary/70 p-1">
                      {(["latest", "trending"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setThreadSort(value)}
                          className={cn(
                            "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                            threadSort === value
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {value === "latest" ? "Latest" : "Trending"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {canWriteInRoom ? (
                    <div className="mt-4 space-y-3">
                      <Input
                        value={threadTitle}
                        onChange={(event) => setThreadTitle(event.target.value)}
                        className="rounded-[18px] border-border/60 bg-background/70"
                        placeholder="Optional title"
                      />
                      <Textarea
                        value={threadContent}
                        onChange={(event) => setThreadContent(event.target.value)}
                        className="min-h-[120px] rounded-[20px] border-border/60 bg-background/70"
                        placeholder={room.viewer.showWelcomeBanner ? "Introduce yourself or drop your first take..." : "Start a thread for the room..."}
                      />
                      <div className="flex justify-end">
                        <Button
                          className="rounded-full"
                          onClick={() => createThreadMutation.mutate()}
                          disabled={!threadContent.trim() || createThreadMutation.isPending}
                        >
                          {createThreadMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Post to room
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-[18px] border border-dashed border-border/60 bg-secondary/60 p-4 text-sm text-muted-foreground">
                      {room.joined
                        ? "You can read the board, but write access is still warming up."
                        : "Join the community to post threads and replies in the room."}
                    </div>
                  )}

                  <div className="mt-5 space-y-4">
                    {threads.map((thread) => (
                      <ThreadCard
                        key={thread.id}
                        thread={thread}
                        tokenAddress={tokenAddress}
                        viewer={viewer}
                        canWrite={canWriteInRoom}
                        onDeleteThread={(threadId) => deleteThreadMutation.mutate(threadId)}
                        onReplyCreated={async () => {
                          await resetThreadFeed();
                          await queryClient.invalidateQueries({ queryKey: ["token-community-room", tokenAddress] });
                        }}
                        onDeleteReply={(replyId) => deleteReplyMutation.mutate(replyId)}
                        onReactionSummaryChange={updateThreadReactionSummary}
                      />
                    ))}
                    {threads.length === 0 ? (
                      <div className="rounded-[20px] border border-dashed border-border/60 bg-secondary/55 p-4 text-sm text-muted-foreground">
                        No threads yet. This is the moment to set the tone of the room.
                      </div>
                    ) : null}
                  </div>

                  {hasMoreThreads ? (
                    <div className="mt-4 flex justify-center">
                      <Button variant="outline" className="rounded-full" onClick={() => setThreadCursor(nextThreadCursor)}>
                        Load more
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[26px] border border-border/60 bg-card p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Flame className="h-4 w-4 text-primary" />
                    Live room pulse
                  </div>
                  <div className="mt-4 rounded-[20px] border border-border/60 bg-secondary/60 p-4">
                    <div className="text-sm font-semibold text-foreground">{activeRaidLabel}</div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {room.activeRaidSummary
                        ? `${room.activeRaidSummary.postedCount} linked posts, ${room.activeRaidSummary.joinedCount} raiders joined, started by ${room.activeRaidSummary.createdBy.username || room.activeRaidSummary.createdBy.name}.`
                        : "No live raid campaign at the moment. The room is warming up on threads and takes."}
                    </p>
                  </div>
                </div>

                <div className="rounded-[26px] border border-border/60 bg-card p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Users className="h-4 w-4 text-primary" />
                    Top raiders
                  </div>
                  <div className="mt-4 space-y-3">
                    {room.topContributors.length > 0 ? (
                      room.topContributors.map((entry, index) => (
                        <div key={entry.user.id} className="flex items-center justify-between gap-3 rounded-[18px] border border-border/60 bg-secondary/55 p-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/15 bg-white/60 text-xs font-bold text-primary dark:bg-white/[0.05]">
                              {index + 1}
                            </div>
                            <Avatar className="h-9 w-9 border border-border">
                              <AvatarImage src={getAvatarUrl(entry.user.id, entry.user.image)} />
                              <AvatarFallback>{(entry.user.username || entry.user.name || "?").charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="text-sm font-semibold text-foreground">{entry.user.username || entry.user.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {entry.contributionScore} score · streak {entry.currentRaidStreak}
                              </div>
                            </div>
                          </div>
                          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]", roomBadgeTone(entry.badge))}>
                            {entry.badge.replace("-", " ")}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-border/60 bg-secondary/55 p-4 text-sm text-muted-foreground">
                        Top contributors will appear as the room starts moving.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="raid" className="space-y-4">
          {!room.exists ? (
            <div className="rounded-[26px] border border-border/60 bg-card p-6 text-sm text-muted-foreground">
              Raid campaigns unlock after the community exists.
            </div>
          ) : !room.joined ? (
            <div className="rounded-[26px] border border-border/60 bg-card p-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Megaphone className="h-4 w-4 text-primary" />
                Join the room before you join the raid
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                Community membership is explicit first, then raid participation is explicit second. Join the room and the raid wizard unlocks.
              </p>
              <Button className="mt-4 rounded-full" onClick={() => joinCommunityMutation.mutate()} disabled={joinCommunityMutation.isPending}>
                {joinCommunityMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                Join Community
              </Button>
            </div>
          ) : !campaign ? (
            <div className="rounded-[26px] border border-border/60 bg-card p-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Megaphone className="h-4 w-4 text-primary" />
                No live raid campaign
              </div>
              {canLeadRaid ? (
                <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
                  <div className="rounded-[22px] border border-border/60 bg-secondary/60 p-4">
                    <div className="text-sm font-semibold text-foreground">Start Raid Campaign</div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Kick off a coordinated campaign for the room. The generator will still guarantee exactly 3 meme options and 3 text options.
                    </p>
                    <Textarea
                      value={raidObjective}
                      onChange={(event) => setRaidObjective(event.target.value)}
                      className="mt-4 min-h-[112px] rounded-[18px] border-border/60 bg-background/70"
                      placeholder={`Make ${communityTag(room, tokenSymbol, tokenName)} impossible to scroll past without sounding desperate.`}
                    />
                    <Button className="mt-4 rounded-full" onClick={() => startRaidMutation.mutate()} disabled={startRaidMutation.isPending}>
                      {startRaidMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Megaphone className="mr-2 h-4 w-4" />}
                      Start Raid Campaign
                    </Button>
                  </div>
                  <div className="rounded-[22px] border border-border/60 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.12),transparent_44%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.1),transparent_34%)] p-4">
                    <div className="text-sm font-semibold text-foreground">What starts moving after launch</div>
                    <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                      <div className="rounded-[18px] border border-border/60 bg-card/70 p-3">The room joins the campaign explicitly before the wizard unlocks.</div>
                      <div className="rounded-[18px] border border-border/60 bg-card/70 p-3">Each raider gets 3 meme cards first, then 3 distinct copy cards, then a final bundle preview.</div>
                      <div className="rounded-[18px] border border-border/60 bg-card/70 p-3">Linked X posts feed the live boost wall so the room has something to do after posting.</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-[18px] border border-dashed border-border/60 bg-secondary/60 p-4 text-sm text-muted-foreground">
                  Trusted members at level {profile?.raidLeadMinLevel ?? 3}+ can start the next raid campaign.
                </div>
              )}
            </div>
          ) : !activeRaid?.myParticipant ? (
            <div className="rounded-[26px] border border-border/60 bg-card p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Megaphone className="h-4 w-4 text-primary" />
                    Raid campaign live
                  </div>
                  <h3 className="mt-3 text-xl font-black tracking-tight text-foreground">{campaign.objective}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {campaign.participantCount} raiders joined, {campaign.postedCount} linked posts already visible in the room.
                  </p>
                </div>
                <Button className="rounded-full" onClick={() => joinRaidMutation.mutate()} disabled={joinRaidMutation.isPending}>
                  {joinRaidMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Megaphone className="mr-2 h-4 w-4" />}
                  Join Raid Campaign
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-[28px] border border-border/60 bg-card p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Megaphone className="h-4 w-4 text-primary" />
                      Guided raid builder
                    </div>
                    <h3 className="mt-2 text-xl font-black tracking-tight text-foreground">{campaign.objective}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{suggestedBundleLabel}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canLeadRaid ? (
                      <Button
                        variant="outline"
                        className="rounded-full"
                        onClick={() => regenerateRaidMutation.mutate()}
                        disabled={regenerateRaidMutation.isPending}
                      >
                        {regenerateRaidMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Regenerate
                      </Button>
                    ) : null}
                    <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/8 px-3 py-1 text-xs font-semibold text-primary">
                      Joined Raid
                    </span>
                  </div>
                </div>

                <div className="mt-5">
                  <Progress value={activeStepProgress} className="h-2.5 bg-secondary/80" />
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    {[
                      { index: 1, label: "Choose meme", unlocked: true },
                      { index: 2, label: "Choose text", unlocked: Boolean(selectedMemeId) },
                      { index: 3, label: "Preview bundle", unlocked: Boolean(selectedMemeId && selectedCopyId) },
                      { index: 4, label: "Launch + paste back", unlocked: Boolean(previewUnlocked || activeRaid.mySubmission || (selectedMemeId && selectedCopyId)) },
                    ].map((step) => (
                      <button
                        key={step.index}
                        type="button"
                        disabled={!step.unlocked}
                        onClick={() => setRaidStep(step.index as 1 | 2 | 3 | 4)}
                        className={cn(
                          "rounded-[18px] border px-3 py-3 text-left transition-colors",
                          raidStep === step.index
                            ? "border-primary/30 bg-primary/10"
                            : step.unlocked
                              ? "border-border/60 bg-secondary/60 hover:border-primary/25"
                              : "border-border/40 bg-secondary/40 opacity-55",
                        )}
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Step {step.index}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-foreground">{step.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {raidStep === 1 ? (
                <div className="rounded-[28px] border border-border/60 bg-card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Step 1: Choose 1 of 3 memes</div>
                      <p className="mt-1 text-sm text-muted-foreground">Pick the visual angle first. This stays separate from text on purpose.</p>
                    </div>
                  </div>

                  <div className="mt-5">
                    <Carousel opts={{ align: "start", loop: false }}>
                      <CarouselContent>
                        {campaign.memeOptions.map((option) => {
                          const count = campaign.memeChoiceCounts[option.id] ?? 0;
                          const isTopPick = count > 0 && count === Math.max(...Object.values(campaign.memeChoiceCounts));
                          return (
                            <CarouselItem key={option.id} className="md:basis-1/2 xl:basis-1/3">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedMemeId(option.id);
                                  setSelectedCopyId(null);
                                  setPreviewUnlocked(false);
                                }}
                                className={cn(
                                  "group flex h-full w-full flex-col rounded-[26px] border p-4 text-left transition-all",
                                  selectedMemeId === option.id
                                    ? "border-primary/35 bg-primary/8 shadow-[0_20px_44px_-28px_hsl(var(--primary)/0.55)]"
                                    : "border-border/60 bg-secondary/45 hover:border-primary/25 hover:bg-secondary/70",
                                )}
                              >
                                <div className="aspect-square overflow-hidden rounded-[22px] border border-border/50 bg-slate-950/95 shadow-inner">
                                  <img
                                    src={buildRaidMemeDataUrl(option, raidTokenContext, raidAssets)}
                                    alt={option.title}
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                  />
                                </div>
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                                    {option.toneLabel}
                                  </span>
                                  <span className="rounded-full border border-border/60 bg-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    {isTopPick ? "Most picked by raiders" : option.socialTag}
                                  </span>
                                </div>
                                <div className="mt-3 text-lg font-black tracking-tight text-foreground">{option.title}</div>
                                <div className="mt-1 text-sm font-medium text-foreground/90">{option.angle}</div>
                                <p className="mt-2 text-sm leading-6 text-muted-foreground">{option.bestFor}</p>
                              </button>
                            </CarouselItem>
                          );
                        })}
                      </CarouselContent>
                      <CarouselPrevious className="hidden xl:flex" />
                      <CarouselNext className="hidden xl:flex" />
                    </Carousel>
                  </div>

                  <div className="mt-5 flex justify-end">
                    <Button
                      className="rounded-full"
                      disabled={!selectedMemeId}
                      onClick={() => setRaidStep(2)}
                    >
                      Continue to text
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}

              {raidStep === 2 ? (
                <div className="rounded-[28px] border border-border/60 bg-card p-5">
                  <div className="text-sm font-semibold text-foreground">Step 2: Choose 1 of 3 raid texts</div>
                  <p className="mt-1 text-sm text-muted-foreground">Now choose the voice. Keep it punchy and specific.</p>
                  <div className="mt-5 grid gap-4 xl:grid-cols-3">
                    {campaign.copyOptions.map((option) => {
                      const count = campaign.copyChoiceCounts[option.id] ?? 0;
                      const isTopPick = count > 0 && count === Math.max(...Object.values(campaign.copyChoiceCounts));
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setSelectedCopyId(option.id);
                            setPreviewUnlocked(false);
                          }}
                          className={cn(
                            "rounded-[24px] border p-4 text-left transition-all",
                            selectedCopyId === option.id
                              ? "border-primary/35 bg-primary/8 shadow-[0_20px_44px_-28px_hsl(var(--primary)/0.55)]"
                              : "border-border/60 bg-secondary/45 hover:border-primary/25 hover:bg-secondary/70",
                          )}
                        >
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                              {option.voiceLabel}
                            </span>
                            <span className="rounded-full border border-border/60 bg-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              {isTopPick ? "Most picked by raiders" : option.socialTag}
                            </span>
                          </div>
                          <div className="mt-3 text-lg font-black tracking-tight text-foreground">{option.label}</div>
                          <div className="mt-1 text-sm font-medium text-foreground/90">{option.angle}</div>
                          <p className="mt-3 text-sm leading-6 text-foreground/90">{option.text}</p>
                          <div className="mt-4 text-xs text-muted-foreground">{option.bestFor}</div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-5 flex justify-between gap-3">
                    <Button variant="outline" className="rounded-full" onClick={() => setRaidStep(1)}>
                      Back
                    </Button>
                    <Button className="rounded-full" disabled={!selectedCopyId} onClick={() => setRaidStep(3)}>
                      Review bundle
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}

              {raidStep === 3 ? (
                <div className="rounded-[28px] border border-border/60 bg-card p-5">
                  <div className="text-sm font-semibold text-foreground">Step 3: Preview final post bundle</div>
                  <p className="mt-1 text-sm text-muted-foreground">{suggestedBundleLabel}</p>
                  {selectedMeme && selectedCopy ? (
                    <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr,1.1fr]">
                      <div className="overflow-hidden rounded-[26px] border border-border/60 bg-slate-950/95">
                        <img
                          src={buildRaidMemeDataUrl(selectedMeme, raidTokenContext, raidAssets)}
                          alt={selectedMeme.title}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="rounded-[26px] border border-border/60 bg-secondary/50 p-5">
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                            {selectedMeme.toneLabel}
                          </span>
                          <span className="rounded-full border border-border/60 bg-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {selectedCopy.voiceLabel}
                          </span>
                        </div>
                        <div className="mt-4 text-lg font-black tracking-tight text-foreground">{selectedMeme.title}</div>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedCopy.text}</p>
                        <div className="mt-5 rounded-[20px] border border-border/60 bg-card p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Bundle summary</div>
                          <div className="mt-2 text-sm font-semibold text-foreground">{suggestedBundleLabel}</div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-5 flex justify-between gap-3">
                    <Button variant="outline" className="rounded-full" onClick={() => setRaidStep(2)}>
                      Back
                    </Button>
                    <Button
                      className="rounded-full"
                      disabled={!selectedMeme || !selectedCopy}
                      onClick={() => {
                        setPreviewUnlocked(true);
                        setRaidStep(4);
                      }}
                    >
                      Continue to launch
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}

              {raidStep === 4 ? (
                <div className="grid gap-4 xl:grid-cols-[1fr,0.9fr]">
                  <div className="rounded-[28px] border border-border/60 bg-card p-5">
                    <div className="text-sm font-semibold text-foreground">Step 4: Copy, download, open X, then paste back the post link</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The room uses X web intent, so the final step is explicit: launch the bundle, publish, then paste the live URL back here.
                    </p>

                    <div className="mt-5 grid gap-5 lg:grid-cols-[0.92fr,1.08fr]">
                      {selectedMeme ? (
                        <div className="overflow-hidden rounded-[24px] border border-border/60 bg-slate-950/95">
                          <img
                            src={buildRaidMemeDataUrl(selectedMeme, raidTokenContext, raidAssets)}
                            alt={selectedMeme.title}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ) : null}

                      <div className="space-y-4">
                        <div className="rounded-[22px] border border-border/60 bg-secondary/50 p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Selected copy</div>
                          <p className="mt-3 text-sm leading-6 text-foreground/90">{selectedCopy?.text || "Choose a copy option first."}</p>
                        </div>

                        <Button
                          className="w-full rounded-full"
                          disabled={!selectedMeme || !selectedCopy || launchRaidMutation.isPending}
                          onClick={() => launchRaidMutation.mutate()}
                        >
                          {launchRaidMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageDown className="mr-2 h-4 w-4" />}
                          Copy + Download + Open X
                        </Button>

                        <div className="rounded-[22px] border border-border/60 bg-card p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Paste back your X post</div>
                          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                            <Input
                              value={xPostUrlInput}
                              onChange={(event) => setXPostUrlInput(event.target.value)}
                              className="rounded-[16px] border-border/60 bg-background/70"
                              placeholder="https://x.com/handle/status/..."
                            />
                            <Button
                              className="rounded-full"
                              onClick={() => saveXPostMutation.mutate()}
                              disabled={!xPostUrlInput.trim() || saveXPostMutation.isPending}
                            >
                              {saveXPostMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
                              Save link
                            </Button>
                          </div>
                          {activeRaid.mySubmission?.xPostUrl ? (
                            <a
                              href={activeRaid.mySubmission.xPostUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary"
                            >
                              View linked post
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-border/60 bg-card p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">Live boost wall</div>
                        <p className="mt-1 text-sm text-muted-foreground">Open the next five room posts in fresh tabs and keep the campaign moving.</p>
                      </div>
                      <Button variant="outline" className="rounded-full" onClick={() => void handleOpenBoostBatch()}>
                        Boost next 5
                      </Button>
                    </div>
                    <div className="mt-4 space-y-3">
                      {activeRaid.submissions.length > 0 ? (
                        activeRaid.submissions.map((submission) => (
                          <div key={submission.id} className="rounded-[18px] border border-border/60 bg-secondary/55 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-8 w-8 border border-border">
                                    <AvatarImage src={getAvatarUrl(submission.user.id, submission.user.image)} />
                                    <AvatarFallback>{(submission.user.username || submission.user.name || "?").charAt(0)}</AvatarFallback>
                                  </Avatar>
                                  <div>
                                    <div className="text-sm font-semibold text-foreground">
                                      {submission.user.username || submission.user.name}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {submission.postedAt ? formatTimeAgo(submission.postedAt) : "just linked"} · {submission.boostCount} boosts
                                    </div>
                                  </div>
                                </div>
                                <p className="mt-3 line-clamp-3 text-sm leading-6 text-foreground/90">{submission.composerText}</p>
                              </div>
                              <div className="flex shrink-0 flex-col gap-2">
                                <Button
                                  variant="outline"
                                  className="rounded-full"
                                  onClick={() => {
                                    if (submission.xPostUrl) {
                                      window.open(submission.xPostUrl, "_blank", "noopener,noreferrer");
                                    }
                                    if (!submission.isBoostedByViewer) {
                                      boostMutation.mutate(submission.id);
                                    }
                                  }}
                                >
                                  Open post
                                </Button>
                                {submission.isBoostedByViewer ? (
                                  <span className="text-center text-xs font-medium text-primary">Boosted</span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-[18px] border border-dashed border-border/60 bg-secondary/55 p-4 text-sm text-muted-foreground">
                          Linked raid posts will appear here as soon as room members paste them back in.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
