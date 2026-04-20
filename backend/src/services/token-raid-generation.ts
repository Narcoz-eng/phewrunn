import { createHash } from "node:crypto";
import { z } from "zod";
import { COMMUNITY_ASSET_KIND_VALUES, type CommunityAssetKind } from "./community-asset-storage.js";

export const TOKEN_RAID_TEMPLATE_IDS = [
  "chart-rat",
  "breaking-news",
  "courtroom",
  "group-chat",
  "night-shift",
  "brain-rot-board",
  "mascot-poster",
  "reference-remix",
  "market-flex",
] as const;

const TOKEN_RAID_COPY_STYLE_IDS = [
  "deadpan-flex",
  "chaos-wire",
  "receipt-thread",
  "conspiracy-desk",
  "stadium-call",
  "floor-trader",
  "group-chat-spiral",
  "victory-liturgy",
] as const;

type TokenRaidTemplateId = (typeof TOKEN_RAID_TEMPLATE_IDS)[number];
type TokenRaidCopyStyleId = (typeof TOKEN_RAID_COPY_STYLE_IDS)[number];

const AssetDescriptorSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(COMMUNITY_ASSET_KIND_VALUES),
});

export const TokenRaidMemeOptionSchema = z.object({
  id: z.string().min(1).max(80),
  templateId: z.enum(TOKEN_RAID_TEMPLATE_IDS),
  title: z.string().min(1).max(48),
  angle: z.string().min(1).max(80),
  topText: z.string().min(1).max(140),
  bottomText: z.string().min(1).max(140),
  kicker: z.string().max(96).nullable().optional(),
  footer: z.string().max(96).nullable().optional(),
  toneLabel: z.string().min(1).max(36).optional().default("Fresh angle"),
  bestFor: z.string().min(1).max(72).optional().default("Room momentum"),
  socialTag: z.string().min(1).max(28).optional().default("Fresh angle"),
  assetIdsUsed: z.array(z.string().min(1).max(80)).max(5).optional().default([]),
});

export const TokenRaidCopyOptionSchema = z.object({
  id: z.string().min(1).max(80),
  style: z.enum(TOKEN_RAID_COPY_STYLE_IDS),
  label: z.string().min(1).max(40),
  angle: z.string().min(1).max(80),
  text: z.string().min(1).max(280),
  voiceLabel: z.string().min(1).max(36).optional().default("Room signal"),
  bestFor: z.string().min(1).max(72).optional().default("Fast raid post"),
  socialTag: z.string().min(1).max(28).optional().default("Fresh angle"),
});

export const TokenRaidGenerationResultSchema = z.object({
  memeOptions: z.array(TokenRaidMemeOptionSchema).length(3),
  copyOptions: z.array(TokenRaidCopyOptionSchema).length(3),
});

export type TokenRaidMemeOption = z.infer<typeof TokenRaidMemeOptionSchema>;
export type TokenRaidCopyOption = z.infer<typeof TokenRaidCopyOptionSchema>;
export type TokenRaidGenerationResult = z.infer<typeof TokenRaidGenerationResultSchema>;

export type TokenRaidGenerationInput = {
  token: {
    id: string;
    symbol: string | null;
    name: string | null;
    chainType: string;
    holderCount: number | null;
    sentimentScore: number | null;
    confidenceScore: number | null;
    hotAlphaScore: number | null;
    earlyRunnerScore: number | null;
    highConvictionScore: number | null;
  };
  objective: string;
  profile?: {
    headline?: string | null;
    xCashtag?: string | null;
    voiceHints?: string[] | null;
    insideJokes?: string[] | null;
    preferredTemplateIds?: string[] | null;
    vibeTags?: string[] | null;
    mascotName?: string | null;
    assets?: Array<z.infer<typeof AssetDescriptorSchema>> | null;
  } | null;
  recentThreads: Array<{
    title?: string | null;
    content: string;
    authorName?: string | null;
    authorUsername?: string | null;
    createdAt?: string | Date | null;
  }>;
  recentRaidHistory: Array<{
    objective?: string | null;
    memeOptions?: unknown;
    copyOptions?: unknown;
  }>;
  generationSalt?: string | null;
};

type RaidGenerationContext = {
  seed: number;
  tokenLabel: string;
  cashtag: string;
  tokenName: string;
  objective: string;
  shortObjective: string;
  headline: string;
  insideJoke: string;
  secondInsideJoke: string;
  voiceHint: string;
  secondVoiceHint: string;
  threadTopic: string;
  secondThreadTopic: string;
  heatLabel: string;
  crowdLabel: string;
  vibeTag: string;
  secondaryVibeTag: string;
  mascotName: string | null;
  logoAssetId: string | null;
  bannerAssetId: string | null;
  mascotAssetId: string | null;
  referenceAssetIds: string[];
  recentSignatures: string[];
};

const DEFAULT_VOICE_HINTS = [
  "dry confidence",
  "internet-native and sharp",
  "chaotic but annoyingly documented",
  "desk-bantery with receipts",
  "fast, funny, and a little sleep-deprived",
] as const;

const DEFAULT_INSIDE_JOKES = [
  "receipts age better than cope",
  "the chart keeps leaving fingerprints",
  "someone always hears the boss music first",
  "the room does not outsource timing",
  "group chat confidence with actual timestamps",
] as const;

const DEFAULT_VIBE_TAGS = [
  "late-night desk",
  "receipt room",
  "cult of timing",
  "chaos but organized",
  "internet courtroom",
] as const;

const STOP_WORDS = new Set([
  "about", "after", "again", "alpha", "because", "before", "being", "board", "calls",
  "chart", "charts", "community", "contract", "copy", "could", "feels", "have", "into",
  "just", "like", "made", "make", "more", "need", "only", "people", "raid", "room",
  "same", "some", "still", "that", "their", "there", "these", "they", "this", "those",
  "thread", "threads", "token", "tokens", "what", "when", "with", "would", "your",
]);

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function clampText(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 3) return ".".repeat(Math.max(0, maxLength));
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeSignature(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[$#@]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashString(value: string): number {
  const digest = createHash("sha256").update(value).digest("hex");
  return Number.parseInt(digest.slice(0, 8), 16);
}

function splitHints(input: string[] | null | undefined, defaults: readonly string[]): string[] {
  const normalized = (input ?? [])
    .map((value) => normalizeWhitespace(value))
    .filter((value) => value.length > 0);
  return normalized.length > 0 ? normalized.slice(0, 8) : [...defaults];
}

function pickSeeded<T>(items: readonly T[], seed: number, offset = 0): T {
  return items[Math.abs(hashString(`${seed}:${offset}:${items.length}`)) % items.length] as T;
}

function tokenSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function isTooSimilar(candidate: string, recent: string[]): boolean {
  const normalized = normalizeSignature(candidate);
  return recent.some((entry) => tokenSimilarity(normalized, entry) >= 0.74);
}

function buildRecentSignatures(history: TokenRaidGenerationInput["recentRaidHistory"]): string[] {
  const signatures = new Set<string>();
  for (const raid of history) {
    const objective = typeof raid.objective === "string" ? normalizeSignature(raid.objective) : "";
    if (objective) signatures.add(objective);

    const parsedMemes = z.array(TokenRaidMemeOptionSchema).safeParse(raid.memeOptions);
    if (parsedMemes.success) {
      for (const option of parsedMemes.data) {
        signatures.add(normalizeSignature(`${option.title} ${option.angle} ${option.topText} ${option.bottomText}`));
      }
    }

    const parsedCopy = z.array(TokenRaidCopyOptionSchema).safeParse(raid.copyOptions);
    if (parsedCopy.success) {
      for (const option of parsedCopy.data) {
        signatures.add(normalizeSignature(`${option.label} ${option.angle} ${option.text}`));
      }
    }
  }
  return [...signatures];
}

function extractTopics(texts: string[]): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const words = normalizeSignature(text)
      .split(" ")
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
    for (const word of words) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word)
    .slice(0, 10);
}

function buildContext(input: TokenRaidGenerationInput): RaidGenerationContext {
  const profile = input.profile ?? null;
  const voiceHints = splitHints(profile?.voiceHints, DEFAULT_VOICE_HINTS);
  const insideJokes = splitHints(profile?.insideJokes, DEFAULT_INSIDE_JOKES);
  const vibeTags = splitHints(profile?.vibeTags, DEFAULT_VIBE_TAGS);
  const threadTopics = extractTopics(
    input.recentThreads.flatMap((thread) => [thread.title ?? "", thread.content]),
  );
  const parsedAssets = z.array(AssetDescriptorSchema).safeParse(profile?.assets ?? []);
  const assets = parsedAssets.success ? parsedAssets.data : [];
  const logoAssetId = assets.find((asset) => asset.kind === "logo")?.id ?? null;
  const bannerAssetId = assets.find((asset) => asset.kind === "banner")?.id ?? null;
  const mascotAssetId = assets.find((asset) => asset.kind === "mascot")?.id ?? null;
  const referenceAssetIds = assets.filter((asset) => asset.kind === "reference_meme").map((asset) => asset.id).slice(0, 5);

  const symbol = normalizeWhitespace(input.token.symbol || "").toUpperCase() || "TOKEN";
  const tokenName = normalizeWhitespace(input.token.name || "") || symbol;
  const cashtagSource = normalizeWhitespace(profile?.xCashtag || "");
  const cashtag = cashtagSource
    ? (cashtagSource.startsWith("$") ? cashtagSource.toUpperCase() : `$${cashtagSource.toUpperCase()}`)
    : `$${symbol}`;
  const tokenLabel = tokenName === symbol ? cashtag : `${tokenName} ${cashtag}`;
  const seed = hashString(
    JSON.stringify({
      tokenId: input.token.id,
      objective: input.objective,
      salt: input.generationSalt ?? "",
      assets: assets.map((asset) => asset.id),
      topics: threadTopics.slice(0, 4),
      jokes: insideJokes.slice(0, 3),
      hints: voiceHints.slice(0, 3),
    }),
  );

  return {
    seed,
    tokenLabel,
    cashtag,
    tokenName,
    objective: normalizeWhitespace(input.objective),
    shortObjective: clampText(input.objective, 82),
    headline: clampText(profile?.headline || `${cashtag} is the room with receipts, timing, and no indoor voice.`, 110),
    insideJoke: pickSeeded(insideJokes, seed, 11),
    secondInsideJoke: pickSeeded(insideJokes, seed, 12),
    voiceHint: pickSeeded(voiceHints, seed, 13),
    secondVoiceHint: pickSeeded(voiceHints, seed, 14),
    threadTopic: threadTopics[0] ?? "timing",
    secondThreadTopic: threadTopics[1] ?? "conviction",
    heatLabel: pickSeeded(
      [
        "Most picked by raiders",
        "Fresh angle",
        "Chaos mode",
        "Cleaner flex",
      ],
      seed,
      15,
    ),
    crowdLabel: typeof input.token.holderCount === "number" && input.token.holderCount >= 5000
      ? "half the timeline"
      : typeof input.token.holderCount === "number" && input.token.holderCount >= 1000
        ? "the loud side of the feed"
        : "the early table",
    vibeTag: pickSeeded(vibeTags, seed, 16),
    secondaryVibeTag: pickSeeded(vibeTags, seed, 17),
    mascotName: normalizeWhitespace(profile?.mascotName || "") || null,
    logoAssetId,
    bannerAssetId,
    mascotAssetId,
    referenceAssetIds,
    recentSignatures: buildRecentSignatures(input.recentRaidHistory),
  };
}

function buildOptionId(prefix: string, seed: number, variant: string): string {
  return `${prefix}-${variant}-${Math.abs(seed % 100_000)}`;
}

function buildBrandMeme(ctx: RaidGenerationContext): TokenRaidMemeOption {
  const assetIdsUsed = [ctx.mascotAssetId, ctx.logoAssetId, ctx.bannerAssetId].filter(Boolean) as string[];
  const mascotLabel = ctx.mascotName || `${ctx.tokenName} mascot`;
  const topText = pickSeeded(
    [
      `${mascotLabel} watching ${ctx.cashtag} turn one candle into a full-room signal`,
      `the ${ctx.cashtag} room mascot the second the tape starts acting guilty`,
      `${ctx.cashtag} when the room sees the setup before the excuses arrive`,
    ],
    ctx.seed,
    101,
  );
  const bottomText = pickSeeded(
    [
      `${ctx.crowdLabel} is already passing around receipts and nobody in the room is pretending to be subtle`,
      `everybody suddenly remembers the thesis, the screenshots, and the exact minute the chart slipped`,
      `the room is loud, the banner looks dangerous, and the doubters are once again late to the evidence`,
    ],
    ctx.seed,
    102,
  );

  return {
    id: buildOptionId("meme", ctx.seed + 1, "brand"),
    templateId: assetIdsUsed.length > 0 ? "mascot-poster" : "courtroom",
    title: "Room Mascot",
    angle: "Brand-first room energy",
    topText: clampText(topText, 132),
    bottomText: clampText(bottomText, 132),
    kicker: clampText(ctx.headline, 84),
    footer: clampText(ctx.voiceHint, 76),
    toneLabel: "Most picked by raiders",
    bestFor: "Making the community feel like a real crew",
    socialTag: "Most picked by raiders",
    assetIdsUsed,
  };
}

function buildReferenceMeme(ctx: RaidGenerationContext): TokenRaidMemeOption {
  const referenceId = ctx.referenceAssetIds[0] ?? ctx.logoAssetId;
  const assetIdsUsed = [referenceId, ctx.logoAssetId].filter(Boolean) as string[];
  const topText = pickSeeded(
    [
      `me remixing one ${ctx.cashtag} screenshot, two room jokes, and a suspiciously strong candle`,
      `the community reference folder the second ${ctx.cashtag} gives us a fresh excuse to be annoying`,
      `me turning one room joke and one old meme into a new ${ctx.cashtag} receipt`,
    ],
    ctx.seed,
    201,
  );
  const bottomText = pickSeeded(
    [
      `same community DNA, different punchline, and somehow the chart still walks into the trap every time`,
      `the remix lands because the room already knows the bit, the timing, and the exact face the doubters will make`,
      `every reference still points to the same ending: the room got there before the timeline found the tone`,
    ],
    ctx.seed,
    202,
  );

  return {
    id: buildOptionId("meme", ctx.seed + 2, "reference"),
    templateId: referenceId ? "reference-remix" : "group-chat",
    title: "Reference Remix",
    angle: "Callback meme with room DNA",
    topText: clampText(topText, 132),
    bottomText: clampText(bottomText, 132),
    kicker: clampText(ctx.insideJoke, 84),
    footer: clampText(ctx.secondaryVibeTag, 76),
    toneLabel: "Fresh angle",
    bestFor: "Room jokes that feel native, not generated",
    socialTag: "Fresh angle",
    assetIdsUsed,
  };
}

function buildFlexMeme(ctx: RaidGenerationContext): TokenRaidMemeOption {
  const assetIdsUsed = [ctx.bannerAssetId, ctx.logoAssetId].filter(Boolean) as string[];
  const topText = pickSeeded(
    [
      `${ctx.cashtag} room when the chart tries to act casual after leaving that many fingerprints`,
      `the ${ctx.cashtag} room watching the move get cleaner while the timeline gets louder`,
      `${ctx.cashtag} when the room already had the posture and the chart finally caught up`,
    ],
    ctx.seed,
    301,
  );
  const bottomText = pickSeeded(
    [
      `this is the cleaner flex version: less panic, more timing, and enough receipts to make the cope look understaffed`,
      `the whole post reads calmer than it should because the room already did the shouting in private`,
      `no screaming required when the room has the banner, the read, and the screenshots already lined up`,
    ],
    ctx.seed,
    302,
  );

  return {
    id: buildOptionId("meme", ctx.seed + 3, "flex"),
    templateId: assetIdsUsed.length > 0 ? "market-flex" : "breaking-news",
    title: "Cleaner Flex",
    angle: "Polished market-room flex",
    topText: clampText(topText, 132),
    bottomText: clampText(bottomText, 132),
    kicker: clampText(ctx.shortObjective, 84),
    footer: clampText(ctx.secondVoiceHint, 76),
    toneLabel: "Cleaner flex",
    bestFor: "A sharper public-facing flex",
    socialTag: "Cleaner flex",
    assetIdsUsed,
  };
}

type CopyBuilder = {
  id: TokenRaidCopyStyleId;
  voiceLabel: string;
  bestFor: string;
  socialTag: string;
  build: (ctx: RaidGenerationContext) => Omit<TokenRaidCopyOption, "id" | "style" | "voiceLabel" | "bestFor" | "socialTag">;
};

const COPY_BUILDERS: readonly CopyBuilder[] = [
  {
    id: "chaos-wire",
    voiceLabel: "Bulletin",
    bestFor: "Fast-moving raid pushes",
    socialTag: "Chaos mode",
    build: (ctx) => ({
      label: "Chaos wire",
      angle: "Fast bulletin energy",
      text: clampText(
        `Desk update: ${ctx.tokenLabel} just turned the room into a siren factory. ${ctx.shortObjective}. Receipts are already circulating faster than excuses.`,
        278,
      ),
    }),
  },
  {
    id: "receipt-thread",
    voiceLabel: "Receipt stack",
    bestFor: "A cleaner thread opener",
    socialTag: "Most picked by raiders",
    build: (ctx) => ({
      label: "Receipt thread",
      angle: "Receipts-first swagger",
      text: clampText(
        `${ctx.cashtag} community does not do vague optimism. We do timestamps, screenshots, and jokes that still look good one candle later. ${ctx.shortObjective}.`,
        278,
      ),
    }),
  },
  {
    id: "floor-trader",
    voiceLabel: "Desk banter",
    bestFor: "Shorter punchier raid posts",
    socialTag: "Cleaner flex",
    build: (ctx) => ({
      label: "Floor trader",
      angle: "Fast, sharp, market-floor banter",
      text: clampText(
        `${ctx.cashtag} looks like pure desk-confusion for people who missed the tell. The room is early, loud, and annoyingly documented. ${ctx.shortObjective}.`,
        278,
      ),
    }),
  },
  {
    id: "deadpan-flex",
    voiceLabel: "Deadpan",
    bestFor: "Smug calm flex",
    socialTag: "Fresh angle",
    build: (ctx) => ({
      label: "Deadpan flex",
      angle: "Calm, smug, and clipped",
      text: clampText(
        `${ctx.cashtag} is doing that thing again where the chart acts innocent while the room quietly collects evidence. ${ctx.shortObjective}.`,
        278,
      ),
    }),
  },
  {
    id: "group-chat-spiral",
    voiceLabel: "Leak from the chat",
    bestFor: "Funniest public-facing option",
    socialTag: "Chaos mode",
    build: (ctx) => ({
      label: "Group chat spiral",
      angle: "Private-chat chaos leaking into public",
      text: clampText(
        `The ${ctx.cashtag} group chat has reached that dangerous phase where every message is either a joke or a receipt and somehow both are bullish. ${ctx.shortObjective}.`,
        278,
      ),
    }),
  },
  {
    id: "conspiracy-desk",
    voiceLabel: "Evidence wall",
    bestFor: "More internet-native humor",
    socialTag: "Fresh angle",
    build: (ctx) => ({
      label: "Conspiracy desk",
      angle: "Internet detective bit",
      text: clampText(
        `I have connected the dots between ${ctx.threadTopic}, one suspiciously alive tape, and a room full of people who enjoy being right at inconvenient hours. ${ctx.shortObjective}.`,
        278,
      ),
    }),
  },
  {
    id: "stadium-call",
    voiceLabel: "Announcer",
    bestFor: "Higher-energy timeline pushes",
    socialTag: "Most picked by raiders",
    build: (ctx) => ({
      label: "Stadium call",
      angle: "Big-energy announcer voice",
      text: clampText(
        `${ctx.cashtag} just stepped onto the field like it owns the noise. Crowd is up, excuses are down, and the room already has the receipts ready. ${ctx.shortObjective}.`,
        278,
      ),
    }),
  },
  {
    id: "victory-liturgy",
    voiceLabel: "Victory lap",
    bestFor: "A slightly more theatrical flex",
    socialTag: "Cleaner flex",
    build: (ctx) => ({
      label: "Victory liturgy",
      angle: "Half sermon, half victory lap",
      text: clampText(
        `Blessed are the stubborn, because ${ctx.cashtag} keeps rewarding people who can read a room, read a chart, and laugh while the rest of the timeline catches up. ${ctx.shortObjective}.`,
        278,
      ),
    }),
  },
] as const;

function buildFallbackMemeOption(ctx: RaidGenerationContext, index: number): TokenRaidMemeOption {
  const templateId =
    ["mascot-poster", "reference-remix", "market-flex"][index] as TokenRaidTemplateId | undefined;
  return {
    id: buildOptionId("meme", ctx.seed + 80 + index, `fallback-${index}`),
    templateId: templateId ?? "courtroom",
    title: ["Room Mascot", "Reference Remix", "Cleaner Flex"][index] ?? "Room Signal",
    angle: ["Brand-first room energy", "Callback meme with room DNA", "Polished market-room flex"][index] ?? "Room signal",
    topText: clampText(`${ctx.cashtag} room when the chart leaves fingerprints and the receipts are already loaded`, 132),
    bottomText: clampText(`${ctx.shortObjective}. The room is loud, documented, and very uninterested in vague optimism.`, 132),
    kicker: clampText(ctx.headline, 84),
    footer: clampText(ctx.voiceHint, 76),
    toneLabel: ["Most picked by raiders", "Fresh angle", "Cleaner flex"][index] ?? "Fresh angle",
    bestFor: "Safe fallback that still feels like the room",
    socialTag: ["Most picked by raiders", "Fresh angle", "Cleaner flex"][index] ?? "Fresh angle",
    assetIdsUsed: [],
  };
}

function buildFallbackCopyOption(ctx: RaidGenerationContext, index: number): TokenRaidCopyOption {
  const style =
    TOKEN_RAID_COPY_STYLE_IDS[index % TOKEN_RAID_COPY_STYLE_IDS.length] ?? TOKEN_RAID_COPY_STYLE_IDS[0];
  const lines = [
    `${ctx.cashtag} keeps turning private conviction into public receipts. ${ctx.shortObjective}.`,
    `${ctx.tokenLabel} is moving like it already heard tomorrow's gossip. ${ctx.shortObjective}.`,
    `${ctx.cashtag} is the kind of chart that makes doubters type slower. ${ctx.shortObjective}.`,
  ];
  return {
    id: buildOptionId("copy", ctx.seed + 90 + index, `fallback-${index}`),
    style,
    label: ["Receipt mode", "Desk whisper", "Clean flex"][index] ?? "Clean flex",
    angle: ["Receipts-first", "Quietly loud", "Smug timing"][index] ?? "Smug timing",
    text: clampText(lines[index] ?? lines[0] ?? `${ctx.cashtag} has receipts. ${ctx.shortObjective}.`, 278),
    voiceLabel: ["Receipt stack", "Bulletin", "Deadpan"][index] ?? "Room signal",
    bestFor: "Fallback copy that still reads native",
    socialTag: ["Most picked by raiders", "Chaos mode", "Cleaner flex"][index] ?? "Fresh angle",
  };
}

function finalizeGeneration(memes: TokenRaidMemeOption[], copies: TokenRaidCopyOption[]): TokenRaidGenerationResult {
  const result = TokenRaidGenerationResultSchema.safeParse({
    memeOptions: memes.slice(0, 3),
    copyOptions: copies.slice(0, 3),
  });
  if (!result.success) {
    throw new Error("Generated raid options failed schema validation");
  }
  return result.data;
}

export function generateTokenRaidOptions(input: TokenRaidGenerationInput): TokenRaidGenerationResult {
  const ctx = buildContext(input);
  const memes = [buildBrandMeme(ctx), buildReferenceMeme(ctx), buildFlexMeme(ctx)];
  const recentMemeSignatures = [...ctx.recentSignatures];
  const finalMemes: TokenRaidMemeOption[] = [];
  for (const meme of memes) {
    const signature = normalizeSignature(`${meme.title} ${meme.angle} ${meme.topText} ${meme.bottomText}`);
    if (isTooSimilar(signature, recentMemeSignatures)) continue;
    finalMemes.push(TokenRaidMemeOptionSchema.parse(meme));
    recentMemeSignatures.push(signature);
  }
  for (let index = finalMemes.length; index < 3; index += 1) {
    const fallback = TokenRaidMemeOptionSchema.parse(buildFallbackMemeOption(ctx, index));
    const signature = normalizeSignature(`${fallback.title} ${fallback.angle} ${fallback.topText} ${fallback.bottomText}`);
    if (!isTooSimilar(signature, recentMemeSignatures)) {
      finalMemes.push(fallback);
      recentMemeSignatures.push(signature);
    }
  }

  const copyBuilders = [...COPY_BUILDERS].sort(
    (a, b) => (hashString(`${ctx.seed}:${a.id}`) % 1000) - (hashString(`${ctx.seed}:${b.id}`) % 1000),
  );
  const recentCopySignatures = [...ctx.recentSignatures];
  const finalCopies: TokenRaidCopyOption[] = [];
  for (const builder of copyBuilders) {
    const built = builder.build(ctx);
    const option: TokenRaidCopyOption = {
      id: buildOptionId("copy", ctx.seed + finalCopies.length * 11, builder.id),
      style: builder.id,
      voiceLabel: builder.voiceLabel,
      bestFor: builder.bestFor,
      socialTag: builder.socialTag,
      ...built,
    };
    const signature = normalizeSignature(`${option.label} ${option.angle} ${option.text}`);
    if (isTooSimilar(signature, recentCopySignatures)) continue;
    finalCopies.push(TokenRaidCopyOptionSchema.parse(option));
    recentCopySignatures.push(signature);
    if (finalCopies.length === 3) break;
  }
  for (let index = finalCopies.length; index < 3; index += 1) {
    const fallback = TokenRaidCopyOptionSchema.parse(buildFallbackCopyOption(ctx, index));
    const signature = normalizeSignature(`${fallback.label} ${fallback.angle} ${fallback.text}`);
    if (!isTooSimilar(signature, recentCopySignatures)) {
      finalCopies.push(fallback);
      recentCopySignatures.push(signature);
    }
  }

  while (finalMemes.length < 3) {
    finalMemes.push(TokenRaidMemeOptionSchema.parse(buildFallbackMemeOption(ctx, finalMemes.length)));
  }
  while (finalCopies.length < 3) {
    finalCopies.push(TokenRaidCopyOptionSchema.parse(buildFallbackCopyOption(ctx, finalCopies.length)));
  }

  return finalizeGeneration(finalMemes, finalCopies);
}

export function safeGenerateTokenRaidOptions(input: TokenRaidGenerationInput): TokenRaidGenerationResult {
  try {
    return generateTokenRaidOptions(input);
  } catch (error) {
    console.warn("[token-raid-generation] primary generation failed, using safe fallback", {
      tokenId: input.token.id,
      message: error instanceof Error ? error.message : String(error),
    });
    const ctx = buildContext({
      ...input,
      generationSalt: `${input.generationSalt ?? "fallback"}:safe`,
    });
    return finalizeGeneration(
      [0, 1, 2].map((index) => TokenRaidMemeOptionSchema.parse(buildFallbackMemeOption(ctx, index))),
      [0, 1, 2].map((index) => TokenRaidCopyOptionSchema.parse(buildFallbackCopyOption(ctx, index))),
    );
  }
}
