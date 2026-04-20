// Types for the SocialFi platform

export interface User {
  id: string;
  name: string;
  email: string;
  image: string | null;
  walletAddress: string | null;
  username: string | null;
  level: number;
  xp: number;
  bio: string | null;
  isAdmin: boolean;
  isVerified?: boolean;
  bannerImage?: string | null;
  tradeFeeRewardsEnabled?: boolean;
  tradeFeeShareBps?: number;
  tradeFeePayoutAddress?: string | null;
  createdAt: string;
}

export interface PostAuthor {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  level: number;
  xp: number;
  isVerified?: boolean;
  tradeFeeRewardsEnabled?: boolean;
  tradeFeeShareBps?: number;
  trustScore?: number | null;
  reputationTier?: string | null;
  winRate30d?: number | null;
  avgRoi30d?: number | null;
  firstCallCount?: number;
}

// Reposter type returned from /api/posts/:id/reposters
export interface Reposter {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  level: number;
  xp: number;
}

export interface Comment {
  id: string;
  content: string;
  authorId: string;
  author: PostAuthor;
  postId: string;
  parentId?: string | null;
  rootId?: string | null;
  depth?: number;
  kind?: string | null;
  replyCount?: number;
  deletedAt?: string | null;
  createdAt: string;
}

export type ReactionType = "alpha" | "based" | "printed" | "rug";

export interface ReactionCounts {
  alpha: number;
  based: number;
  printed: number;
  rug: number;
}

export interface TokenBundleCluster {
  id?: string;
  clusterLabel: string;
  walletCount: number;
  estimatedSupplyPct: number;
  evidenceJson?: unknown;
}

export interface Post {
  id: string;
  content: string;
  authorId: string;
  author: PostAuthor;
  contractAddress: string | null;
  chainType: string | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImage: string | null;
  entryMcap: number | null;
  currentMcap: number | null;
  mcap1h: number | null;     // 1H mcap snapshot (official settlement)
  mcap6h: number | null;     // 6H mcap snapshot (extended benchmark)
  settled: boolean;
  settledAt: string | null;
  isWin: boolean | null;
  lastMcapUpdate?: string | null;
  lastIntelligenceAt?: string | null;
  trackingMode?: string | null;
  createdAt: string;
  // Social features
  _count: {
    likes: number;
    comments: number;
    reposts: number;
  };
  isLiked: boolean;
  isReposted: boolean;
  isFollowingAuthor?: boolean; // Whether current user is following the post author
  viewCount: number;
  dexscreenerUrl: string | null;
  confidenceScore?: number | null;
  hotAlphaScore?: number | null;
  earlyRunnerScore?: number | null;
  highConvictionScore?: number | null;
  marketHealthScore?: number | null;
  setupQualityScore?: number | null;
  opportunityScore?: number | null;
  dataReliabilityScore?: number | null;
  activityStatus?: string | null;
  activityStatusLabel?: string | null;
  isTradable?: boolean;
  bullishSignalsSuppressed?: boolean;
  timingTier?: string | null;
  firstCallerRank?: number | null;
  roiPeakPct?: number | null;
  roiCurrentPct?: number | null;
  trustedTraderCount?: number;
  entryQualityScore?: number | null;
  bundlePenaltyScore?: number | null;
  sentimentScore?: number | null;
  tokenRiskScore?: number | null;
  bundleRiskLabel?: string | null;
  bundleScanCompletedAt?: string | null;
  liquidity?: number | null;
  volume24h?: number | null;
  holderCount?: number | null;
  largestHolderPct?: number | null;
  top10HolderPct?: number | null;
  bundledWalletCount?: number | null;
  estimatedBundledSupplyPct?: number | null;
  bundleClusters?: TokenBundleCluster[];
  reactionCounts?: ReactionCounts;
  currentReactionType?: ReactionType | null;
  threadCount?: number;
  radarReasons?: string[];
  // Shared by others (reposters)
  sharedBy?: PostAuthor[];
  // Shared Alpha - users who posted same CA within 48h
  sharedAlphaCount?: number;
  walletTradeSnapshot?: {
    source?: string | null;
    totalPnlUsd?: number | null;
    realizedPnlUsd?: number | null;
    unrealizedPnlUsd?: number | null;
    boughtUsd?: number | null;
    soldUsd?: number | null;
    holdingUsd?: number | null;
    holdingAmount?: number | null;
    boughtAmount?: number | null;
    soldAmount?: number | null;
    netAmount?: number | null;
  } | null;
}

// Shared Alpha user type
export interface SharedAlphaUser {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  level: number;
  xp: number;
  postId: string;
  postedAt: string;
}

export interface TokenCommunityProfile {
  id: string | null;
  headline: string;
  xCashtag: string | null;
  voiceHints: string[];
  insideJokes: string[];
  preferredTemplateIds: string[];
  raidLeadMinLevel: number;
  whyLine: string | null;
  welcomePrompt: string | null;
  vibeTags: string[];
  mascotName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TokenCommunityAuthor {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  level: number;
  isVerified?: boolean;
}

export interface TokenCommunityReactionSummary {
  emoji: string;
  count: number;
  reactedByViewer: boolean;
}

export interface TokenCommunityAsset {
  id: string;
  kind: "logo" | "banner" | "mascot" | "reference_meme" | string;
  status: string;
  url: string;
  renderUrl: string;
  objectKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  sortOrder: number;
  createdAt: string;
}

export interface TokenCommunityContributor {
  user: TokenCommunityAuthor;
  contributionScore: number;
  currentRaidStreak: number;
  bestRaidStreak: number;
  badge: "elite" | "trusted" | "room-regular" | string;
}

export interface TokenCommunityRecentMember {
  joinedAt: string;
  user: TokenCommunityAuthor;
}

export interface TokenCommunitySuggestedThread {
  id: string;
  title: string | null;
  content: string;
  createdAt: string;
  author: TokenCommunityAuthor;
}

export interface TokenCommunityRecentWin {
  id: string;
  xPostUrl: string | null;
  postedAt: string | null;
  boostCount: number;
  user: TokenCommunityAuthor;
}

export interface TokenCommunityViewerState {
  joined: boolean;
  joinedAt: string | null;
  hasPosted: boolean;
  hasReplied: boolean;
  hasRaided: boolean;
  showWelcomeBanner: boolean;
  suggestedAction: "create-community" | "wait-community" | "join-community" | "join-raid" | "reply-thread" | "introduce" | string;
  currentRaidStreak: number;
  bestRaidStreak: number;
}

export interface TokenCommunityRoom {
  exists: boolean;
  canCreate: boolean;
  canJoin: boolean;
  joined: boolean;
  joinedAt: string | null;
  memberCount: number;
  onlineNowEstimate: number;
  activeThreadCount: number;
  currentRaidPulse: {
    label: string;
    participantCount: number;
    postedCount: number;
  } | null;
  topContributors: TokenCommunityContributor[];
  recentMembers: TokenCommunityRecentMember[];
  whyLine: string | null;
  welcomePrompt: string | null;
  suggestedThread: TokenCommunitySuggestedThread | null;
  activeRaidSummary: {
    id: string;
    objective: string;
    openedAt: string;
    threadId: string | null;
    joinedCount: number;
    postedCount: number;
    createdBy: TokenCommunityAuthor;
  } | null;
  recentWins: TokenCommunityRecentWin[];
  headline: string | null;
  xCashtag: string | null;
  vibeTags: string[];
  mascotName: string | null;
  assets: {
    logo: TokenCommunityAsset | null;
    banner: TokenCommunityAsset | null;
    mascot: TokenCommunityAsset | null;
    referenceMemes: TokenCommunityAsset[];
  };
  viewer: TokenCommunityViewerState;
}

export interface TokenCommunityThread {
  id: string;
  title: string | null;
  content: string;
  kind: "general" | "raid" | string;
  raidCampaignId: string | null;
  replyCount: number;
  isPinned: boolean;
  lastActivityAt: string;
  deletedAt: string | null;
  createdAt: string;
  author: TokenCommunityAuthor;
  reactionSummary: TokenCommunityReactionSummary[];
}

export interface TokenCommunityReply {
  id: string;
  content: string;
  parentId: string | null;
  rootId: string | null;
  depth: number;
  deletedAt: string | null;
  createdAt: string;
  author: TokenCommunityAuthor;
}

export interface TokenRaidMemeOption {
  id: string;
  templateId: string;
  title: string;
  angle: string;
  topText: string;
  bottomText: string;
  kicker?: string | null;
  footer?: string | null;
  toneLabel: string;
  bestFor: string;
  socialTag: string;
  assetIdsUsed: string[];
}

export interface TokenRaidCopyOption {
  id: string;
  style: string;
  label: string;
  angle: string;
  text: string;
  voiceLabel: string;
  bestFor: string;
  socialTag: string;
}

export interface TokenRaidParticipant {
  id: string;
  status: "joined" | "launched" | "posted" | string;
  currentStep: "meme" | "copy" | "preview" | "launch" | "complete" | string;
  joinedAt: string;
  launchedAt: string | null;
  postedAt: string | null;
}

export interface TokenRaidSubmission {
  id: string;
  memeOptionId: string;
  copyOptionId: string;
  renderPayloadJson: Record<string, unknown>;
  composerText: string;
  xPostUrl: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
  boostCount: number;
  isBoostedByViewer: boolean;
  user: TokenCommunityAuthor;
}

export interface TokenRaidCampaign {
  id: string;
  status: "active" | "closed" | string;
  objective: string;
  memeOptions: TokenRaidMemeOption[];
  copyOptions: TokenRaidCopyOption[];
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  threadId?: string | null;
  participantCount: number;
  postedCount: number;
  memeChoiceCounts: Record<string, number>;
  copyChoiceCounts: Record<string, number>;
  createdBy: TokenCommunityAuthor;
}

export interface TokenActiveRaidResponse {
  campaign: TokenRaidCampaign | null;
  submissions: TokenRaidSubmission[];
  mySubmission: TokenRaidSubmission | null;
  myParticipant: TokenRaidParticipant | null;
  communityAssets: {
    logo: TokenCommunityAsset | null;
    banner: TokenCommunityAsset | null;
    mascot: TokenCommunityAsset | null;
    referenceMemes: TokenCommunityAsset[];
  };
}

export interface TokenCommunityAssetUpload {
  method: string;
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export interface TokenCommunityAssetPresignResponse {
  asset: TokenCommunityAsset;
  upload: TokenCommunityAssetUpload;
}

export interface TokenCommunityAssetImportRequest {
  kind: "logo" | "banner" | "mascot" | "reference_meme" | string;
  sourceUrl: string;
}

// Level constants
export const MIN_LEVEL = -5;
export const MAX_LEVEL = 10;
export const STARTING_LEVEL = 0;
export const LIQUIDATION_LEVEL = -5;
export const VETERAN_THRESHOLD = 5;

// Contract Address Detection (client-side preview)
export const SOLANA_ADDRESS_REGEX = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
export const EVM_ADDRESS_REGEX = /0x[a-fA-F0-9]{40}/g;

export function detectContractAddress(text: string): { address: string; chainType: 'solana' | 'evm' } | null {
  const evmMatch = text.match(EVM_ADDRESS_REGEX);
  if (evmMatch) {
    return { address: evmMatch[0], chainType: 'evm' };
  }

  const solanaMatch = text.match(SOLANA_ADDRESS_REGEX);
  if (solanaMatch) {
    const filtered = solanaMatch.filter(addr => addr.length >= 32);
    if (filtered.length > 0) {
      return { address: filtered[0], chainType: 'solana' };
    }
  }

  return null;
}

// Strip contract address from post content for cleaner display
export function stripContractAddress(content: string): string {
  // Remove EVM addresses (0x followed by 40 hex chars)
  let cleaned = content.replace(/0x[a-fA-F0-9]{40}/gi, '');

  // Remove Solana addresses (Base58, 32-44 chars)
  // Be more careful here to avoid removing regular words
  cleaned = cleaned.replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, '');

  // Remove common CA prefixes
  cleaned = cleaned.replace(/\b(CA|Contract|Address|Token)\s*[:=]?\s*/gi, '');

  // Clean up extra whitespace and newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/  +/g, ' ');
  cleaned = cleaned.trim();

  return cleaned;
}

// Helper to format market cap
export function formatMarketCap(mcap: number | null): string {
  if (mcap === null) return "N/A";

  if (mcap >= 1_000_000_000) {
    return `$${(mcap / 1_000_000_000).toFixed(2)}B`;
  }
  if (mcap >= 1_000_000) {
    return `$${(mcap / 1_000_000).toFixed(2)}M`;
  }
  if (mcap >= 1_000) {
    return `$${(mcap / 1_000).toFixed(2)}K`;
  }
  return `$${mcap.toFixed(2)}`;
}

// Calculate percentage change
export function calculatePercentChange(entry: number | null, current: number | null): number | null {
  if (entry === null || current === null || entry === 0) return null;
  return ((current - entry) / entry) * 100;
}

// Format multiplier/percentage display based on rules:
// Below 2x → show exact percentage: "+47.3%" or "-11.25%"
// 2x and above → show exact one decimal multiplier: "2.2x", "4.5x", "10.3x", "100.5x"
export interface MultiplierDisplay {
  text: string;
  isNegative: boolean;
  isPositive: boolean;
  tier: 'negative' | 'low' | 'medium' | 'high' | 'mega'; // for styling
}

export function formatMultiplier(entry: number | null, current: number | null): MultiplierDisplay | null {
  if (entry === null || current === null || entry === 0) return null;

  const multiplier = current / entry;
  const percentChange = ((current - entry) / entry) * 100;

  // Negative (loss)
  if (multiplier < 1) {
    return {
      text: `${percentChange.toFixed(2)}%`,
      isNegative: true,
      isPositive: false,
      tier: 'negative'
    };
  }

  // Below 2x - show exact percentage
  if (multiplier < 2) {
    return {
      text: `+${percentChange.toFixed(2)}%`,
      isNegative: false,
      isPositive: true,
      tier: 'low'
    };
  }

  // 2x to 9.9x - medium tier, show one decimal
  if (multiplier < 10) {
    return {
      text: `${multiplier.toFixed(1)}x`,
      isNegative: false,
      isPositive: true,
      tier: 'medium'
    };
  }

  // 10x to 99.9x - high tier (yellow/gold), show one decimal
  if (multiplier < 100) {
    return {
      text: `${multiplier.toFixed(1)}x`,
      isNegative: false,
      isPositive: true,
      tier: 'high'
    };
  }

  // 100x+ - mega tier (gold with glow), show one decimal
  return {
    text: `${multiplier.toFixed(1)}x`,
    isNegative: false,
    isPositive: true,
    tier: 'mega'
  };
}

// Format time ago
export function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// Get DiceBear avatar URL
export function getAvatarUrl(userId: string, image: string | null): string {
  if (image) return image;
  return `https://api.dicebear.com/7.x/identicon/svg?seed=${userId}&backgroundColor=0a0a0f`;
}

// Notification types
export interface Notification {
  id: string;
  userId: string;
  type: string;
  message: string;
  read: boolean;
  entityType?: string | null;
  entityId?: string | null;
  reasonCode?: string | null;
  payload?: Record<string, unknown> | null;
  postId: string | null;
  fromUserId: string | null;
  fromUser: {
    id: string;
    name: string;
    username: string | null;
    image: string | null;
    level: number;
  } | null;
  post: {
    id: string;
    content: string;
    contractAddress: string | null;
  } | null;
  createdAt: string;
  mergedCount?: number;
  mergedIds?: string[];
  mergedItems?: Notification[];
}
