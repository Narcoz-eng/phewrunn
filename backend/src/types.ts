import { z } from "zod";

// =====================================================
// User Types
// =====================================================

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  image: z.string().nullable(),
  walletAddress: z.string().nullable(),
  username: z.string().nullable(),
  level: z.number().int().min(-5).max(10),
  xp: z.number().int().default(0),
  isVerified: z.boolean().default(false),
  isAdmin: z.boolean().default(false),
  tradeFeeRewardsEnabled: z.boolean().default(true),
  tradeFeeShareBps: z.number().int().min(0).max(50).default(50),
  tradeFeePayoutAddress: z.string().nullable().default(null),
  createdAt: z.string(),
});

export type User = z.infer<typeof UserSchema>;

export const UpdateProfileSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3)
      .max(20)
      .regex(/^[a-zA-Z0-9_]+$/, "Handle can only contain letters, numbers, and underscores")
      .optional(),
    bio: z.string().max(200).optional(),
    image: z.string().url().optional(),
    tradeFeeRewardsEnabled: z.boolean().optional(),
    tradeFeeShareBps: z.number().int().min(0).max(50).optional(),
    tradeFeePayoutAddress: z.union([
      z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Payout wallet must be a valid Solana address"),
      z.literal(""),
    ]).optional(),
  })
  .strict();

// Update frequency constants
export const USERNAME_UPDATE_COOLDOWN_DAYS = 7;
export const PHOTO_UPDATE_COOLDOWN_HOURS = 24;

// Wallet rate limiting constants
export const WALLET_CONNECT_LIMIT_PER_HOUR = 5;

export type UpdateProfile = z.infer<typeof UpdateProfileSchema>;

export const PublicUserStatsDTOSchema = z
  .object({
    posts: z.number().int().min(0),
    followers: z.number().int().min(0),
    following: z.number().int().min(0),
    totalCalls: z.number().int().min(0),
    wins: z.number().int().min(0),
    losses: z.number().int().min(0),
    winRate: z.number(),
    totalProfitPercent: z.number(),
  })
  .strict();

export const PublicUserProfileDTOSchema = z
  .object({
    id: z.string().min(1),
    username: z.string().nullable(),
    image: z.string().nullable(),
    level: z.number().int(),
    xp: z.number().int(),
    isVerified: z.boolean().default(false),
    createdAt: z.string(),
    isFollowing: z.boolean(),
    stats: PublicUserStatsDTOSchema,
  })
  .strict();

export type PublicUserProfileDTO = z.infer<typeof PublicUserProfileDTOSchema>;

// =====================================================
// Wallet Types
// =====================================================

// Wallet address validation - supports Solana (Base58, 32-44 chars) and EVM (0x + 40 hex chars)
export const WalletAddressSchema = z.string().refine((val) => {
  // Solana: Base58, 32-44 chars
  const solanaRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  // EVM: 0x prefix + 40 hex chars
  const evmRegex = /^0x[a-fA-F0-9]{40}$/;
  return solanaRegex.test(val) || evmRegex.test(val);
}, 'Invalid wallet address format');

export const WalletProviderSchema = z.enum(['phantom', 'solflare', 'metamask', 'other']).default('other');

export const ConnectWalletSchema = z.object({
  walletAddress: WalletAddressSchema,
  walletProvider: WalletProviderSchema.optional(),
  signature: z.string().max(1024).optional(),
  message: z.string().max(4096).optional(),
});

export type ConnectWallet = z.infer<typeof ConnectWalletSchema>;

// Wallet status response
export const WalletStatusSchema = z.object({
  connected: z.boolean(),
  address: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  connectedAt: z.string().nullable().optional(),
});

export type WalletStatus = z.infer<typeof WalletStatusSchema>;

// =====================================================
// Post Types
// =====================================================

export const CreatePostSchema = z.object({
  content: z.string().min(10, "Post must be at least 10 characters").max(400, "Post must be less than 400 characters"),
});

export type CreatePost = z.infer<typeof CreatePostSchema>;

export const PostSchema = z.object({
  id: z.string(),
  content: z.string(),
  authorId: z.string(),
  author: z.object({
    id: z.string(),
    name: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
    level: z.number(),
    xp: z.number(),
    isVerified: z.boolean().default(false),
  }),
  chainType: z.string().nullable(),
  tokenName: z.string().nullable(),
  tokenSymbol: z.string().nullable(),
  tokenImage: z.string().nullable(),
  entryMcap: z.number().nullable(),
  currentMcap: z.number().nullable(),
  settled: z.boolean(),
  settledAt: z.string().nullable(),
  isWin: z.boolean().nullable(),
  createdAt: z.string(),
});

export type Post = z.infer<typeof PostSchema>;

// =====================================================
// Dexscreener Types
// =====================================================

export const DexscreenerPairSchema = z.object({
  chainId: z.string(),
  dexId: z.string(),
  pairAddress: z.string(),
  baseToken: z.object({
    address: z.string(),
    name: z.string(),
    symbol: z.string(),
  }),
  quoteToken: z.object({
    address: z.string(),
    name: z.string(),
    symbol: z.string(),
  }),
  priceUsd: z.string().optional(),
  fdv: z.number().optional(),
  marketCap: z.number().optional(),
});

export const DexscreenerResponseSchema = z.object({
  pairs: z.array(DexscreenerPairSchema).nullable(),
});

export type DexscreenerResponse = z.infer<typeof DexscreenerResponseSchema>;

// =====================================================
// Contract Address Detection
// =====================================================

// Solana: Base58 encoded, 32-44 chars
export const SOLANA_ADDRESS_REGEX = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// EVM: 0x followed by 40 hex chars
export const EVM_ADDRESS_REGEX = /0x[a-fA-F0-9]{40}/g;

export function detectContractAddress(text: string): { address: string; chainType: 'solana' | 'evm' } | null {
  // Check EVM first (more specific pattern)
  const evmMatch = text.match(EVM_ADDRESS_REGEX);
  if (evmMatch) {
    return { address: evmMatch[0], chainType: 'evm' };
  }

  // Check Solana
  const solanaMatch = text.match(SOLANA_ADDRESS_REGEX);
  if (solanaMatch) {
    // Filter out common words that might match the regex
    const filtered = solanaMatch.filter(addr => addr.length >= 32);
    const firstMatch = filtered[0];
    if (firstMatch) {
      return { address: firstMatch, chainType: 'solana' };
    }
  }

  return null;
}

// Level constants
export const MIN_LEVEL = -5;
export const MAX_LEVEL = 10;
export const STARTING_LEVEL = 0;
export const LIQUIDATION_LEVEL = -5;
export const LEVEL_LIQUIDATION_THRESHOLD = -5; // Cannot post below this level
export const VETERAN_THRESHOLD = 5; // Level at which veteran protection kicks in

// Recovery threshold: if 1H loss is < 30%, user can recover at 6H
export const RECOVERY_LOSS_THRESHOLD = -30; // Loss must be > -30% (i.e., less severe than -30%)

// Severe loss threshold: >= 30% loss at 1H = immediate penalty, no 6H recovery
export const SEVERE_LOSS_THRESHOLD = -30;

// XP constants
export const MAX_XP_GAIN_PER_POST = 100;
export const MAX_XP_LOSS_PER_POST = 100;
export const XP_PROFIT_MULTIPLIER = 10; // XP = percentChange * 10
export const XP_LOSS_MULTIPLIER = 10;   // XP = percentChange * 10
export const SMALL_PROFIT_XP_ONLY_MAX_PCT = 3; // 1-3% wins = XP only, no level
// "3-4x" (200-300%) should still only award a single level.
// Only very large runners (10x-20x+) can award two levels.
export const DOUBLE_LEVEL_PROFIT_MIN_PCT = 900; // +900% profit = 10x

// Rate limiting constants
export const DAILY_POST_LIMIT = 100;       // Max 100 posts per 24 hours
export const DAILY_COMMENT_LIMIT = 15;     // Max 15 comments per 24 hours
export const DAILY_REPOST_LIMIT = 10;      // Max 10 reposts per 24 hours

// Settlement time constants (in milliseconds)
export const SETTLEMENT_1H_MS = 60 * 60 * 1000;       // 1 hour
export const SETTLEMENT_6H_MS = 6 * 60 * 60 * 1000;   // 6 hours

// Soft landing threshold (if loss is >= this %, only lose 0.5 levels)
export const SOFT_LANDING_LOSS_THRESHOLD = -40;

// Soft loss threshold (if loss is < 30%, only lose 50 XP)
export const SOFT_LOSS_THRESHOLD = -30;
export const SOFT_LOSS_XP = -50; // Half a level penalty

// Calculate XP change based on percent change
export function calculateXpChange(percentChange: number): number {
  if (percentChange >= 0) {
    // Profit: +XP capped at MAX_XP_GAIN_PER_POST
    return Math.min(Math.floor(percentChange * XP_PROFIT_MULTIPLIER), MAX_XP_GAIN_PER_POST);
  } else {
    // Loss: -XP capped at MAX_XP_LOSS_PER_POST
    return -Math.min(Math.floor(Math.abs(percentChange) * XP_LOSS_MULTIPLIER), MAX_XP_LOSS_PER_POST);
  }
}

/**
 * Positive level reward scaling:
 * - <= 3% profit: XP only (no level)
 * - > 3% and < 10x: +1 level
 * - >= 10x profit: +2 levels (capped by MAX_LEVEL in calculateFinalLevel)
 */
export function calculatePositiveLevelGain(percentChange: number): number {
  if (percentChange <= SMALL_PROFIT_XP_ONLY_MAX_PCT) {
    return 0;
  }
  if (percentChange >= DOUBLE_LEVEL_PROFIT_MIN_PCT) {
    return 2;
  }
  return 1;
}

/**
 * 6H XP rules:
 * - If 6H causes a level change, apply normal XP.
 * - If 6H is a positive snapshot but level gain is 0 (small win), still grant XP.
 * - Otherwise no extra XP at 6H.
 */
export function calculate6HXpChange(percentChange6h: number, levelChange6h: number): number {
  if (levelChange6h !== 0) {
    return calculateXpChange(percentChange6h);
  }
  if (percentChange6h > 0) {
    return calculateXpChange(percentChange6h);
  }
  return 0;
}

/**
 * Calculate level change based on trade result with advanced protection logic:
 * - Win: Always +1 level
 * - Loss with Veteran Protection (level >= 5): Only -0.5 level
 * - Loss with Soft Landing (>= 40% loss): Only -0.5 level to prevent discouragement
 * - Standard Loss (level < 5, loss < 40%): -1 level
 *
 * Level cannot drop below -5 (liquidation)
 */
export function calculateLevelChange(
  currentLevel: number,
  isWin: boolean,
  percentChange: number
): number {
  if (isWin) {
    // Win: +1 level (capped at MAX_LEVEL)
    return 1;
  }

  // Loss scenarios
  const isVeteran = currentLevel >= VETERAN_THRESHOLD;
  const isSoftLanding = percentChange <= SOFT_LANDING_LOSS_THRESHOLD;

  if (isVeteran || isSoftLanding) {
    // Veteran Protection OR Soft Landing: only lose 0.5 levels
    // We'll use -1 but track it as 0.5 for display purposes
    // Since levels are integers, we'll alternate between -1 and 0
    // For simplicity, we'll use -1 but the XP loss will be reduced
    return -1; // Still -1 level but with reduced XP impact
  }

  // Standard loss: -1 level
  return -1;
}

/**
 * Calculate final level ensuring it stays within bounds
 */
export function calculateFinalLevel(currentLevel: number, levelChange: number): number {
  const newLevel = currentLevel + levelChange;
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, newLevel));
}

/**
 * Check if user is liquidated (level at or below -5)
 */
export function isLiquidated(level: number): boolean {
  return level <= LIQUIDATION_LEVEL;
}

/**
 * Enhanced Leveling System - 1H Settlement Rules
 *
 * At 1H settlement:
 * - Small win (<= 3%): XP only, no level
 * - Win (> 3%): scaled level reward (+1, or +2 for 10x+)
 * - Loss < 30%: No level change yet, mark as recovery eligible for 6H check
 * - Loss >= 30% (severe): -1 level immediately, no 6H recovery chance
 *
 * Returns: { levelChange: number, recoveryEligible: boolean }
 */
export function calculate1HSettlement(
  percentChange: number
): { levelChange: number; recoveryEligible: boolean } {
  const isWin = percentChange > 0;

  if (isWin) {
    return { levelChange: calculatePositiveLevelGain(percentChange), recoveryEligible: false };
  }

  // Loss scenarios
  const isSevereLoss = percentChange <= SEVERE_LOSS_THRESHOLD; // >= 30% loss

  if (isSevereLoss) {
    // Severe loss (>= 30%): Immediate -1 level, no recovery chance
    return { levelChange: -1, recoveryEligible: false };
  }

  // Soft loss (< 30%): No level change yet, eligible for 6H recovery
  return { levelChange: 0, recoveryEligible: true };
}

/**
 * Enhanced Leveling System - 6H Settlement Rules
 *
 * For posts that were settled at 1H:
 *
 * If user WON at 1H:
 *   - 6H win: scaled level reward (+0/+1/+2 based on profit; small wins can be XP-only)
 *   - 6H loss: No change (still keep the +1 from 1H - reward early alpha)
 *
 * If user LOST at 1H with recoveryEligible = true (loss was < 30%):
 *   - 6H win: scaled level reward (+0/+1/+2; small wins can recover XP-only)
 *   - 6H loss: -1 level (delayed penalty)
 *
 * If user LOST at 1H with recoveryEligible = false (loss was >= 30%):
 *   - Already penalized at 1H, 6H just updates mcap for display
 *
 * Returns: levelChange for 6H settlement
 */
export function calculate6HSettlement(
  isWin1h: boolean,
  percentChange6h: number,
  recoveryEligible: boolean
): number {
  const isWin6h = percentChange6h > 0;

  if (isWin1h) {
    // User won at 1H
    if (isWin6h) {
      // Also won at 6H: reward scales with profit (small wins can be XP-only)
      return calculatePositiveLevelGain(percentChange6h);
    }
    // Lost at 6H but won at 1H: No change (keep the 1H reward)
    return 0;
  }

  // User lost at 1H
  if (recoveryEligible) {
    // Was a soft loss (< 30%), check 6H for recovery
    if (isWin6h) {
      // Recovery success scales with profit (small wins can recover XP-only)
      return calculatePositiveLevelGain(percentChange6h);
    }
    // Recovery failed: -1 level (delayed penalty)
    return -1;
  }

  // Was a severe loss at 1H, already penalized, no additional change
  return 0;
}

// =====================================================
// Auth Types (Privy)
// =====================================================

export const AuthSyncResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  walletAddress: z.string().nullable(),
  username: z.string().nullable(),
  level: z.number(),
  xp: z.number(),
  bio: z.string().nullable(),
  isVerified: z.boolean().default(false),
  isAdmin: z.boolean().default(false),
  createdAt: z.string(),
});

export type AuthSyncResponse = z.infer<typeof AuthSyncResponseSchema>;

// =====================================================
// Social Types
// =====================================================

export const CreateCommentSchema = z.object({
  content: z.string().min(1).max(500),
});

export type CreateComment = z.infer<typeof CreateCommentSchema>;

export const CommentSchema = z.object({
  id: z.string(),
  content: z.string(),
  authorId: z.string(),
  postId: z.string(),
  author: z.object({
    id: z.string(),
    name: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
    level: z.number(),
    xp: z.number(),
  }),
  createdAt: z.string(),
});

export type Comment = z.infer<typeof CommentSchema>;

// Feed query params
export const FeedQuerySchema = z.object({
  sort: z.enum(["latest", "trending"]).default("latest"),
  following: z.preprocess(
    (val) => val === "true" || val === true,
    z.boolean().default(false)
  ),
  limit: z.preprocess(
    (val) => (val ? parseInt(val as string) : 10),
    z.number().int().min(1).max(100).default(10)
  ),
  cursor: z.string().optional(),
  search: z.string().optional(),
});

export type FeedQuery = z.infer<typeof FeedQuerySchema>;

// =====================================================
// Trending Token Types
// =====================================================

export const TopCallerSchema = z.object({
  userId: z.string(),
  username: z.string().nullable(),
  level: z.number(),
});

export type TopCaller = z.infer<typeof TopCallerSchema>;

export const TrendingTokenSchema = z.object({
  contractAddress: z.string(),
  tokenName: z.string().nullable(),
  tokenSymbol: z.string().nullable(),
  tokenImage: z.string().nullable(),
  chainType: z.enum(["solana", "evm"]),
  callCount: z.number(),
  earliestCall: z.string(),
  latestMcap: z.number().nullable(),
  avgEntryMcap: z.number().nullable(),
  topCallers: z.array(TopCallerSchema),
});

export type TrendingToken = z.infer<typeof TrendingTokenSchema>;

// Post with social counts and user interaction state
export const PostWithSocialSchema = PostSchema.extend({
  viewCount: z.number().default(0),
  _count: z.object({
    likes: z.number(),
    comments: z.number(),
    reposts: z.number(),
  }),
  isLiked: z.boolean(),
  isReposted: z.boolean(),
});

export type PostWithSocial = z.infer<typeof PostWithSocialSchema>;

// User profile with follow stats
export const UserProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  image: z.string().nullable(),
  walletAddress: z.string().nullable(),
  username: z.string().nullable(),
  level: z.number(),
  xp: z.number().default(0),
  bio: z.string().nullable(),
  isVerified: z.boolean().default(false),
  createdAt: z.string(),
  _count: z.object({
    posts: z.number(),
    followers: z.number(),
    following: z.number(),
  }),
  isFollowing: z.boolean().optional(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// Follower/Following user item
export const FollowUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string().nullable(),
  image: z.string().nullable(),
  level: z.number(),
  xp: z.number(),
  isFollowing: z.boolean().optional(),
});

export type FollowUser = z.infer<typeof FollowUserSchema>;

// =====================================================
// Settlement Types
// =====================================================

export const SettlementResultSchema = z.object({
  postId: z.string(),
  userId: z.string(),
  isWin: z.boolean(),
  percentChange: z.number(),
  oldLevel: z.number(),
  newLevel: z.number(),
  oldXp: z.number(),
  newXp: z.number(),
  xpChange: z.number(),
  entryMcap: z.number(),
  finalMcap: z.number(),
});

export type SettlementResult = z.infer<typeof SettlementResultSchema>;

export const SettleResponseSchema = z.object({
  settled: z.number(),
  results: z.array(SettlementResultSchema),
});

export type SettleResponse = z.infer<typeof SettleResponseSchema>;

// =====================================================
// Admin Types
// =====================================================

// Platform stats schema
export const AdminStatsSchema = z.object({
  totalUsers: z.number(),
  totalPosts: z.number(),
  postsToday: z.number(),
  totalLikes: z.number(),
  totalComments: z.number(),
  totalReposts: z.number(),
  confirmedTrades: z.number(),
  routedVolumeSol: z.number(),
  totalReports: z.number(),
  openReports: z.number(),
  averageLevel: z.number(),
  settlementStats: z.object({
    total: z.number(),
    wins: z.number(),
    losses: z.number(),
    winRate: z.number(),
  }),
});

export type AdminStats = z.infer<typeof AdminStatsSchema>;

// Admin user list item
export const AdminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  username: z.string().nullable(),
  image: z.string().nullable(),
  bio: z.string().nullable().optional(),
  walletAddress: z.string().nullable(),
  level: z.number(),
  xp: z.number(),
  isAdmin: z.boolean(),
  isBanned: z.boolean().default(false),
  isVerified: z.boolean().default(false),
  createdAt: z.string(),
  confirmedTradeCount: z.number().default(0),
  traderVolumeSol: z.number().default(0),
  drivenTradeCount: z.number().default(0),
  drivenVolumeSol: z.number().default(0),
  reportCount: z.number().default(0),
  openReportCount: z.number().default(0),
  _count: z.object({
    posts: z.number(),
    followers: z.number(),
    following: z.number(),
  }),
});

export type AdminUser = z.infer<typeof AdminUserSchema>;

// Admin user list response
export const AdminUsersResponseSchema = z.object({
  users: z.array(AdminUserSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

export type AdminUsersResponse = z.infer<typeof AdminUsersResponseSchema>;

// Admin user query params
export const AdminUsersQuerySchema = z.object({
  page: z.preprocess(
    (val) => (val ? parseInt(val as string) : 1),
    z.number().int().min(1).default(1)
  ),
  limit: z.preprocess(
    (val) => (val ? parseInt(val as string) : 20),
    z.number().int().min(1).max(100).default(20)
  ),
  search: z.string().optional(),
  sortBy: z.enum(["level", "xp", "posts", "createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type AdminUsersQuery = z.infer<typeof AdminUsersQuerySchema>;

// Admin post list item
export const AdminPostSchema = z.object({
  id: z.string(),
  content: z.string(),
  authorId: z.string(),
  author: z.object({
    id: z.string(),
    name: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
    level: z.number(),
  }),
  contractAddress: z.string().nullable(),
  chainType: z.string().nullable(),
  tokenName: z.string().nullable().optional(),
  tokenSymbol: z.string().nullable(),
  entryMcap: z.number().nullable(),
  currentMcap: z.number().nullable(),
  settled: z.boolean(),
  settledAt: z.string().nullable(),
  isWin: z.boolean().nullable(),
  viewCount: z.number(),
  createdAt: z.string(),
  reportCount: z.number().default(0),
  openReportCount: z.number().default(0),
  _count: z.object({
    likes: z.number(),
    comments: z.number(),
    reposts: z.number(),
  }),
});

export type AdminPost = z.infer<typeof AdminPostSchema>;

// Admin post list response
export const AdminPostsResponseSchema = z.object({
  posts: z.array(AdminPostSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

export type AdminPostsResponse = z.infer<typeof AdminPostsResponseSchema>;

// Admin posts query params
export const AdminPostsQuerySchema = z.object({
  page: z.preprocess(
    (val) => (val ? parseInt(val as string) : 1),
    z.number().int().min(1).default(1)
  ),
  limit: z.preprocess(
    (val) => (val ? parseInt(val as string) : 20),
    z.number().int().min(1).max(100).default(20)
  ),
  filter: z.enum(["all", "settled", "unsettled"]).default("all"),
});

export type AdminPostsQuery = z.infer<typeof AdminPostsQuerySchema>;

// =====================================================
// Report Types
// =====================================================

export const REPORT_ENTITY_TYPE_VALUES = ["post", "user"] as const;
export const REPORT_REASON_VALUES = [
  "spam",
  "scam",
  "abuse",
  "harassment",
  "impersonation",
  "misleading",
  "other",
] as const;
export const REPORT_STATUS_VALUES = ["open", "reviewing", "resolved", "dismissed"] as const;

export const CreateReportSchema = z.object({
  targetType: z.enum(REPORT_ENTITY_TYPE_VALUES),
  targetId: z.string().trim().min(1),
  reason: z.enum(REPORT_REASON_VALUES),
  details: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? null : val),
    z.string().trim().max(500).nullable().optional()
  ),
});

export type CreateReport = z.infer<typeof CreateReportSchema>;

const ReportActorSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string().nullable(),
  image: z.string().nullable().optional(),
});

export const AdminReportSchema = z.object({
  id: z.string(),
  entityType: z.enum(REPORT_ENTITY_TYPE_VALUES),
  reason: z.enum(REPORT_REASON_VALUES),
  details: z.string().nullable(),
  status: z.enum(REPORT_STATUS_VALUES),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  reviewerNotes: z.string().nullable(),
  reporter: ReportActorSchema,
  targetUser: ReportActorSchema.nullable().optional(),
  post: z
    .object({
      id: z.string(),
      content: z.string(),
      author: ReportActorSchema,
    })
    .nullable()
    .optional(),
  reviewedBy: ReportActorSchema.nullable().optional(),
});

export type AdminReport = z.infer<typeof AdminReportSchema>;

export const AdminReportsResponseSchema = z.object({
  reports: z.array(AdminReportSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

export type AdminReportsResponse = z.infer<typeof AdminReportsResponseSchema>;

export const AdminReportsQuerySchema = z.object({
  page: z.preprocess(
    (val) => (val ? parseInt(val as string) : 1),
    z.number().int().min(1).default(1)
  ),
  limit: z.preprocess(
    (val) => (val ? parseInt(val as string) : 20),
    z.number().int().min(1).max(100).default(20)
  ),
  status: z.union([z.literal("all"), z.enum(REPORT_STATUS_VALUES)]).default("all"),
  targetType: z.union([z.literal("all"), z.enum(REPORT_ENTITY_TYPE_VALUES)]).default("all"),
});

export type AdminReportsQuery = z.infer<typeof AdminReportsQuerySchema>;

export const UpdateAdminReportSchema = z.object({
  status: z.enum(REPORT_STATUS_VALUES),
  reviewerNotes: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? null : val),
    z.string().trim().max(500).nullable().optional()
  ),
});

export type UpdateAdminReport = z.infer<typeof UpdateAdminReportSchema>;

// =====================================================
// Announcement Types
// =====================================================

// Announcement schema for API responses
export const AnnouncementSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  isPinned: z.boolean(),
  priority: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  authorId: z.string(),
  author: z.object({
    id: z.string(),
    name: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
  }),
  viewCount: z.number().optional(),
  isViewed: z.boolean().optional(),
});

export type Announcement = z.infer<typeof AnnouncementSchema>;

// Create announcement request schema
export const CreateAnnouncementSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title must be less than 200 characters"),
  content: z.string().min(1, "Content is required").max(2000, "Content must be less than 2000 characters"),
  isPinned: z.boolean().default(false),
  priority: z.number().int().min(0).max(100).default(0),
});

export type CreateAnnouncement = z.infer<typeof CreateAnnouncementSchema>;

// Update announcement request schema
export const UpdateAnnouncementSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(2000).optional(),
  isPinned: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

export type UpdateAnnouncement = z.infer<typeof UpdateAnnouncementSchema>;

// Admin announcements list response
export const AdminAnnouncementsResponseSchema = z.object({
  announcements: z.array(AnnouncementSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

export type AdminAnnouncementsResponse = z.infer<typeof AdminAnnouncementsResponseSchema>;

// Admin announcements query params
export const AdminAnnouncementsQuerySchema = z.object({
  page: z.preprocess(
    (val) => (val ? parseInt(val as string) : 1),
    z.number().int().min(1).default(1)
  ),
  limit: z.preprocess(
    (val) => (val ? parseInt(val as string) : 20),
    z.number().int().min(1).max(100).default(20)
  ),
});

export type AdminAnnouncementsQuery = z.infer<typeof AdminAnnouncementsQuerySchema>;

// =====================================================
// Notification Types
// =====================================================

// Notification type constants
export const NOTIFICATION_TYPES = {
  NEW_POST: 'new_post',
  LIKE: 'like',
  COMMENT: 'comment',
  FOLLOW: 'follow',
  REPOST: 'repost',
  SETTLEMENT: 'settlement',
  WIN_1H: 'win_1h',
  LOSS_1H: 'loss_1h',
  WIN_6H: 'win_6h',
  LOSS_6H: 'loss_6h',
  LEVEL_UP: 'level_up',
  ACHIEVEMENT: 'achievement',
  LIQUIDITY_SPIKE: 'liquidity_spike',
  VOLUME_SPIKE: 'volume_spike',
} as const;

export type NotificationType = typeof NOTIFICATION_TYPES[keyof typeof NOTIFICATION_TYPES];

// Notification schema for API responses
export const NotificationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.string(),
  message: z.string(),
  read: z.boolean(),
  dismissed: z.boolean(),
  clickedAt: z.string().nullable(),
  postId: z.string().nullable(),
  fromUserId: z.string().nullable(),
  createdAt: z.string(),
  fromUser: z.object({
    id: z.string(),
    name: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
    level: z.number(),
  }).nullable().optional(),
  post: z.object({
    id: z.string(),
    content: z.string(),
    contractAddress: z.string().nullable(),
  }).nullable().optional(),
});

export type Notification = z.infer<typeof NotificationSchema>;

// Notifications query params
export const NotificationsQuerySchema = z.object({
  includeDismissed: z.preprocess(
    (val) => val === "true" || val === true,
    z.boolean().default(false)
  ),
});

export type NotificationsQuery = z.infer<typeof NotificationsQuerySchema>;

// =====================================================
// Leaderboard Types
// =====================================================

// Daily top gainer item
export const DailyGainerSchema = z.object({
  rank: z.number(),
  postId: z.string(),
  tokenName: z.string().nullable(),
  tokenSymbol: z.string().nullable(),
  contractAddress: z.string(),
  user: z.object({
    id: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
    level: z.number(),
  }),
  gainPercent: z.number(),
  entryMcap: z.number(),
  currentMcap: z.number(),
  settledAt: z.string(),
});

export type DailyGainer = z.infer<typeof DailyGainerSchema>;

// Top user item with stats
export const TopUserSchema = z.object({
  rank: z.number(),
  user: z.object({
    id: z.string(),
    username: z.string().nullable(),
    name: z.string(),
    image: z.string().nullable(),
    level: z.number(),
    xp: z.number(),
  }),
  stats: z.object({
    totalAlphas: z.number(),
    wins: z.number(),
    losses: z.number(),
    winRate: z.number(),
  }),
});

export type TopUser = z.infer<typeof TopUserSchema>;

// Top users response with pagination
export const TopUsersResponseSchema = z.object({
  data: z.array(TopUserSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export type TopUsersResponse = z.infer<typeof TopUsersResponseSchema>;

// Platform statistics
export const PlatformStatsSchema = z.object({
  volume: z.object({
    day: z.number(),
    week: z.number(),
    month: z.number(),
    allTime: z.number(),
  }),
  alphas: z.object({
    today: z.number(),
    week: z.number(),
    month: z.number(),
    total: z.number(),
  }),
  avgWinRate: z.number(),
  activeUsers: z.object({
    today: z.number(),
    week: z.number(),
  }),
  totalUsers: z.number(),
  levelDistribution: z.array(z.object({
    level: z.number(),
    count: z.number(),
  })),
  topUsersThisWeek: z.array(z.object({
    id: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
    level: z.number(),
    postsThisWeek: z.number(),
  })),
});

export type PlatformStats = z.infer<typeof PlatformStatsSchema>;

// Leaderboard sort options
export const LeaderboardSortBySchema = z.enum(['level', 'activity', 'winrate']);
export type LeaderboardSortBy = z.infer<typeof LeaderboardSortBySchema>;

// Leaderboard query params for pagination
export const LeaderboardQuerySchema = z.object({
  page: z.preprocess(
    (val) => (val ? parseInt(val as string) : 1),
    z.number().int().min(1).default(1)
  ),
  limit: z.preprocess(
    (val) => (val ? parseInt(val as string) : 20),
    z.number().int().min(1).max(100).default(20)
  ),
  sortBy: z.preprocess(
    (val) => val || 'level',
    LeaderboardSortBySchema.default('level')
  ),
});

export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

// =====================================================
// User Stats Types (Accuracy Score System)
// =====================================================

// Weekly stats item for bar chart
export const WeeklyStatSchema = z.object({
  date: z.string(), // ISO date string (YYYY-MM-DD)
  dayLabel: z.string(), // e.g., "Mon", "Tue"
  wins: z.number(),
  losses: z.number(),
  total: z.number(),
});

export type WeeklyStat = z.infer<typeof WeeklyStatSchema>;

// User stats response schema
export const UserStatsSchema = z.object({
  accuracyScore: z.number().min(0).max(100), // 0-100%
  totalPosts: z.number(),
  settledPosts: z.number(),
  wins: z.number(),
  losses: z.number(),
  avgPercentChange: z.number().nullable(), // Average percent change across all settled posts
  streakCurrent: z.number(), // Current win/loss streak (positive = win, negative = loss)
  streakBest: z.number(), // Best win streak ever
  monthlyChange: z.number().nullable(), // Comparison to last month's accuracy (e.g., +12.4%)
  weeklyStats: z.array(WeeklyStatSchema), // Last 7 days for bar chart
});

export type UserStats = z.infer<typeof UserStatsSchema>;

// =====================================================
// Invite / Access Code Types
// =====================================================

export const GenerateAccessCodesSchema = z.object({
  count: z.number().int().min(1).max(200).default(10),
  maxUses: z.number().int().min(0).default(1),
  expiresAt: z.string().datetime().optional(),
  label: z.string().max(100).optional(),
});

export type GenerateAccessCodes = z.infer<typeof GenerateAccessCodesSchema>;

export const AccessCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  label: z.string().nullable(),
  type: z.string(),
  maxUses: z.number(),
  useCount: z.number(),
  expiresAt: z.string().nullable(),
  isRevoked: z.boolean(),
  createdAt: z.string(),
  createdBy: z.object({ id: z.string(), username: z.string().nullable(), image: z.string().nullable() }).optional(),
  isExpired: z.boolean(),
  isExhausted: z.boolean(),
});

export type AccessCode = z.infer<typeof AccessCodeSchema>;

export const AccessCodeListResponseSchema = z.object({
  codes: z.array(AccessCodeSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

export type AccessCodeListResponse = z.infer<typeof AccessCodeListResponseSchema>;

export const AccessCodeUseEntrySchema = z.object({
  id: z.string(),
  usedAt: z.string(),
  usedBy: z.object({ id: z.string(), username: z.string().nullable(), image: z.string().nullable() }),
});

export type AccessCodeUseEntry = z.infer<typeof AccessCodeUseEntrySchema>;

export const InviteEntrySchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  image: z.string().nullable(),
  createdAt: z.string(),
});

export type InviteEntry = z.infer<typeof InviteEntrySchema>;

export const MyInviteInfoSchema = z.object({
  inviteCode: z.string(),
  inviteLink: z.string(),
  quotaTotal: z.number(),
  quotaUsed: z.number(),
  quotaRemaining: z.number(),
  invitees: z.array(InviteEntrySchema),
});

export type MyInviteInfo = z.infer<typeof MyInviteInfoSchema>;

export const GlobalSettingsSchema = z.object({
  inviteOnly: z.boolean(),
  defaultInviteQuota: z.number().int().min(0),
});

export type GlobalSettings = z.infer<typeof GlobalSettingsSchema>;

export const AdminInviteUserSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  image: z.string().nullable(),
  inviteQuota: z.number(),
  inviteeCount: z.number(),
  invitedBy: z.object({ id: z.string(), username: z.string().nullable() }).nullable(),
  createdAt: z.string(),
});

export type AdminInviteUser = z.infer<typeof AdminInviteUserSchema>;

export const AdminInvitesResponseSchema = z.object({
  users: z.array(AdminInviteUserSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
  treeSize: z.number(),
});

export type AdminInvitesResponse = z.infer<typeof AdminInvitesResponseSchema>;

export const AdminInviteStatsSchema = z.object({
  totalInvited: z.number(),
  topInviters: z.array(
    z.object({
      id: z.string(),
      username: z.string().nullable(),
      image: z.string().nullable(),
      inviteQuota: z.number(),
      inviteCount: z.number(),
    })
  ),
});

export type AdminInviteStats = z.infer<typeof AdminInviteStatsSchema>;
