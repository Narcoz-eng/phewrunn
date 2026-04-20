import { createHash } from "node:crypto";
import { z } from "zod";

export const TOKEN_RAID_TEMPLATE_IDS = [
  "chart-rat",
  "breaking-news",
  "courtroom",
  "group-chat",
  "night-shift",
  "brain-rot-board",
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

export const TokenRaidMemeOptionSchema = z.object({
  id: z.string().min(1).max(80),
  templateId: z.enum(TOKEN_RAID_TEMPLATE_IDS),
  title: z.string().min(1).max(48),
  angle: z.string().min(1).max(80),
  topText: z.string().min(1).max(140),
  bottomText: z.string().min(1).max(140),
  kicker: z.string().max(96).nullable().optional(),
  footer: z.string().max(96).nullable().optional(),
});

export const TokenRaidCopyOptionSchema = z.object({
  id: z.string().min(1).max(80),
  style: z.enum(TOKEN_RAID_COPY_STYLE_IDS),
  label: z.string().min(1).max(40),
  angle: z.string().min(1).max(80),
  text: z.string().min(1).max(280),
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
  tokenLabel: string;
  tokenName: string;
  symbol: string;
  cashtag: string;
  objective: string;
  shortObjective: string;
  communityHandle: string;
  headline: string;
  insideJoke: string;
  secondInsideJoke: string;
  voiceHint: string;
  secondVoiceHint: string;
  threadTopic: string;
  secondThreadTopic: string;
  marketMood: string;
  crowdSize: string;
  heatLabel: string;
  recentSignatures: string[];
  preferredTemplateIds: TokenRaidTemplateId[];
  seed: number;
};

type MemeStyleBuilder = {
  id: string;
  templateId: TokenRaidTemplateId;
  build: (ctx: RaidGenerationContext) => Omit<TokenRaidMemeOption, "id" | "templateId">;
};

type CopyStyleBuilder = {
  id: TokenRaidCopyStyleId;
  build: (ctx: RaidGenerationContext) => Omit<TokenRaidCopyOption, "id" | "style">;
};

const STOP_WORDS = new Set([
  "about", "after", "again", "alpha", "bag", "bags", "been", "being", "because", "before", "below",
  "between", "board", "call", "calls", "chart", "charts", "coin", "coins", "could", "community",
  "contract", "copy", "degen", "even", "feel", "from", "have", "just", "like", "more", "most", "need",
  "only", "over", "people", "raid", "raids", "really", "said", "same", "some", "still", "that",
  "their", "there", "these", "they", "this", "thread", "threads", "token", "tokens", "very", "what",
  "when", "with", "would", "your",
]);

const DEFAULT_VOICE_HINTS = [
  "dry confidence",
  "internet gremlin discipline",
  "group-chat chaos with receipts",
  "smug but not forced",
  "fast, punchy, and a little sleep-deprived",
] as const;

const DEFAULT_INSIDE_JOKES = [
  "the chart only respects stubborn people",
  "every dip gets treated like an internship",
  "someone always calls the bottom one candle early",
  "the group chat hears boss music before everyone else",
  "receipts first, victory laps second",
] as const;

const HEAT_LABELS = [
  "quietly radioactive",
  "group-chat combustible",
  "midnight desk-lamp bullish",
  "receipt-printer adjacent",
  "alarm-clock unfriendly",
] as const;

function clampText(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 3) return ".".repeat(Math.max(0, maxLength));
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
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

function seedPick<T>(items: readonly T[], seed: number): T {
  return items[Math.abs(seed) % items.length] as T;
}

function seedVariant<T>(items: readonly T[], seed: number, offset = 0): T {
  return seedPick(items, hashString(`${seed}:${offset}:${items.length}`));
}

function sanitizeTemplateIds(input: string[] | null | undefined): TokenRaidTemplateId[] {
  const valid = new Set<TokenRaidTemplateId>();
  for (const candidate of input ?? []) {
    if ((TOKEN_RAID_TEMPLATE_IDS as readonly string[]).includes(candidate)) {
      valid.add(candidate as TokenRaidTemplateId);
    }
  }
  return [...valid];
}

function splitHints(input: string[] | null | undefined, defaults: readonly string[]): string[] {
  const normalized = (input ?? [])
    .map((value) => normalizeWhitespace(value))
    .filter((value) => value.length > 0);
  if (normalized.length > 0) {
    return normalized.slice(0, 8);
  }
  return [...defaults];
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

function toCrowdSize(holderCount: number | null | undefined): string {
  if (typeof holderCount !== "number" || !Number.isFinite(holderCount) || holderCount <= 0) {
    return "the whole back row";
  }
  if (holderCount >= 20_000) return "half the timeline";
  if (holderCount >= 5_000) return "the loud side of crypto Twitter";
  if (holderCount >= 1_000) return "the main group chat";
  if (holderCount >= 250) return "the committed sickos";
  return "the early table";
}

function toMarketMood(input: TokenRaidGenerationInput["token"]): string {
  const highestSignal = Math.max(
    input.sentimentScore ?? 0,
    input.confidenceScore ?? 0,
    input.hotAlphaScore ?? 0,
    input.earlyRunnerScore ?? 0,
    input.highConvictionScore ?? 0,
  );
  if (highestSignal >= 82) return "the chart is acting like it knows a secret";
  if (highestSignal >= 68) return "the tape looks suspiciously alive";
  if (highestSignal >= 54) return "the candles keep refusing to be normal";
  return "the room smells an opportunity and bad sleep";
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

function buildContext(input: TokenRaidGenerationInput): RaidGenerationContext {
  const profile = input.profile ?? null;
  const voiceHints = splitHints(profile?.voiceHints, DEFAULT_VOICE_HINTS);
  const insideJokes = splitHints(profile?.insideJokes, DEFAULT_INSIDE_JOKES);
  const threadTopics = extractTopics(
    input.recentThreads.flatMap((thread) => [thread.title ?? "", thread.content]),
  );
  const symbol = normalizeWhitespace(input.token.symbol || "").toUpperCase() || "TOKEN";
  const tokenName = normalizeWhitespace(input.token.name || "") || symbol;
  const cashtagSource = normalizeWhitespace(profile?.xCashtag || "");
  const cashtag = cashtagSource
    ? cashtagSource.startsWith("$")
      ? cashtagSource.toUpperCase()
      : `$${cashtagSource.toUpperCase()}`
    : `$${symbol}`;
  const tokenLabel = tokenName === symbol ? cashtag : `${tokenName} ${cashtag}`;
  const seed = hashString(
    JSON.stringify({
      tokenId: input.token.id,
      objective: input.objective,
      salt: input.generationSalt ?? "",
      topics: threadTopics.slice(0, 4),
      jokes: insideJokes.slice(0, 3),
      hints: voiceHints.slice(0, 3),
    }),
  );

  return {
    tokenLabel,
    tokenName,
    symbol,
    cashtag,
    objective: normalizeWhitespace(input.objective),
    shortObjective: clampText(input.objective, 72),
    communityHandle: profile?.xCashtag ? cashtag : cashtag,
    headline: clampText(profile?.headline || `${cashtag} has a community with receipts and no indoor voice.`, 96),
    insideJoke: seedPick(insideJokes, seed + 11),
    secondInsideJoke: seedPick(insideJokes, seed + 17),
    voiceHint: seedPick(voiceHints, seed + 23),
    secondVoiceHint: seedPick(voiceHints, seed + 29),
    threadTopic: threadTopics[0] ?? "liquidity",
    secondThreadTopic: threadTopics[1] ?? "conviction",
    marketMood: toMarketMood(input.token),
    crowdSize: toCrowdSize(input.token.holderCount),
    heatLabel: seedPick(HEAT_LABELS, seed + 31),
    recentSignatures: buildRecentSignatures(input.recentRaidHistory),
    preferredTemplateIds: sanitizeTemplateIds(profile?.preferredTemplateIds),
    seed,
  };
}

function buildOptionId(prefix: string, seed: number, variant: string): string {
  return `${prefix}-${variant}-${Math.abs(seed % 100_000)}`;
}

function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared += 1;
  }
  return shared / Math.max(aTokens.size, bTokens.size);
}

function isTooSimilar(candidate: string, existing: string[]): boolean {
  const normalized = normalizeSignature(candidate);
  return existing.some((entry) => tokenSimilarity(normalized, entry) >= 0.74);
}

const MEME_BUILDERS: readonly MemeStyleBuilder[] = [
  {
    id: "victory-lap",
    templateId: "chart-rat",
    build: (ctx) => {
      const topText = seedVariant(
        [
          `${ctx.cashtag} room when the chart fakes weakness for one candle`,
          `${ctx.cashtag} holders when the dip tries a cheap jump scare`,
          `when ${ctx.cashtag} gives the room one red candle and suddenly everyone becomes a forensic analyst`,
          `${ctx.cashtag} chat watching the chart cosplay as weak for exactly four minutes`,
        ],
        ctx.seed,
        101,
      );
      const bottomText = seedVariant(
        [
          `five minutes later and ${ctx.crowdSize} are posting receipts like court exhibits`,
          `next thing you know the doubters are getting ratioed by screenshots and bad timing`,
          `then the receipt folder opens and the whole timeline starts acting like it was early`,
          `meanwhile the community is logging evidence like this was always going to end badly for the skeptics`,
        ],
        ctx.seed,
        102,
      );
      return {
        title: "Receipt Rat",
        angle: "Smug chart-room flex",
        topText: clampText(topText, 120),
        bottomText: clampText(bottomText, 120),
        kicker: clampText(ctx.marketMood, 84),
        footer: clampText(ctx.voiceHint, 72),
      };
    },
  },
  {
    id: "breaking",
    templateId: "breaking-news",
    build: (ctx) => {
      const topText = seedVariant(
        [
          `BREAKING: ${ctx.tokenLabel} just made the boring people nervous`,
          `LATE DESK BULLETIN: ${ctx.cashtag} has officially interrupted normal posting behavior`,
          `NEWSROOM PANIC: ${ctx.tokenLabel} is back on the timeline with suspicious momentum`,
          `MARKET UPDATE: ${ctx.cashtag} just forced the serious accounts to start subtweeting`,
        ],
        ctx.seed,
        111,
      );
      const bottomText = seedVariant(
        [
          `analysts cite ${ctx.threadTopic}, bad sleep, and a community with suspicious timing`,
          `sources blame ${ctx.secondThreadTopic}, desk coffee, and a chat that refuses to be subtle`,
          `reporters confirm the move was powered by receipts, insomnia, and unnervingly good timing`,
          `commentators mention ${ctx.threadTopic}, timeline confusion, and holders behaving far too prepared`,
        ],
        ctx.seed,
        112,
      );
      return {
        title: "Desk Alert",
        angle: "Fake newsroom bulletin",
        topText: clampText(topText, 118),
        bottomText: clampText(bottomText, 122),
        kicker: clampText(ctx.shortObjective, 84),
        footer: clampText(ctx.insideJoke, 88),
      };
    },
  },
  {
    id: "courtroom",
    templateId: "courtroom",
    build: (ctx) => {
      const topText = seedVariant(
        [
          `judge: why is ${ctx.cashtag} trending in every group chat at 2am`,
          `court clerk: please explain why ${ctx.cashtag} keeps appearing in every receipt folder`,
          `judge: who authorized ${ctx.cashtag} to embarrass the doubters before breakfast`,
          `prosecution: is it true ${ctx.cashtag} turned the timeline into evidence night`,
        ],
        ctx.seed,
        121,
      );
      const bottomText = seedVariant(
        [
          `defense: because the chart keeps leaving fingerprints and the community brought receipts`,
          `defense: because the tape looks guilty and the group chat came prepared`,
          `defense: because ${ctx.threadTopic} was loud, the candles got weird, and the room logged everything`,
          `defense: because the skeptics keep showing up late to a case that was already documented`,
        ],
        ctx.seed,
        122,
      );
      return {
        title: "The People vs Doubt",
        angle: "Courtroom cross-exam",
        topText: clampText(topText, 118),
        bottomText: clampText(bottomText, 126),
        kicker: clampText(ctx.secondVoiceHint, 84),
        footer: clampText(ctx.secondInsideJoke, 88),
      };
    },
  },
  {
    id: "group-chat",
    templateId: "group-chat",
    build: (ctx) => {
      const topText = seedVariant(
        [
          `when one ${ctx.cashtag} candle lands and suddenly nobody is typing like a civilian`,
          `the ${ctx.cashtag} group chat the second the chart does something disrespectfully bullish`,
          `one ${ctx.cashtag} move later and the chat has fully abandoned indoor behavior`,
          `when ${ctx.cashtag} wakes up and the group chat starts posting like it has legal immunity`,
        ],
        ctx.seed,
        131,
      );
      const bottomText = seedVariant(
        [
          `next thing you know the chat is arguing over ${ctx.secondThreadTopic} with main-character confidence`,
          `three screenshots later everyone is suddenly a specialist in ${ctx.threadTopic}`,
          `nobody agrees on tone but everyone agrees the receipts are absurdly good`,
          `by minute six the room has split into jokers, prophets, and people annotating candles`,
        ],
        ctx.seed,
        132,
      );
      return {
        title: "Unread Messages",
        angle: "Private group chat spiral",
        topText: clampText(topText, 122),
        bottomText: clampText(bottomText, 126),
        kicker: clampText(ctx.marketMood, 84),
        footer: clampText(ctx.voiceHint, 72),
      };
    },
  },
  {
    id: "night-shift",
    templateId: "night-shift",
    build: (ctx) => {
      const topText = seedVariant(
        [
          `${ctx.cashtag} on the night shift while the rest of the timeline pretends to be responsible`,
          `${ctx.cashtag} at 1:47am when the serious traders are offline and the sickos are still charting`,
          `night desk update: ${ctx.cashtag} has the late shift acting way too confident`,
          `the ${ctx.cashtag} overnight crew when the candles start whispering reckless ideas`,
        ],
        ctx.seed,
        141,
      );
      const bottomText = seedVariant(
        [
          `coffee is optional, receipts are mandatory, and ${ctx.threadTopic} keeps getting louder`,
          `sleep is cancelled, the evidence pile is growing, and the chart is being weird on purpose`,
          `${ctx.secondThreadTopic} is back on the desk, the coffee tastes hostile, and the room is still early`,
          `everyone looks exhausted but the conviction is somehow getting dressed for a second shift`,
        ],
        ctx.seed,
        142,
      );
      return {
        title: "Night Desk",
        angle: "Sleep-deprived trader shift",
        topText: clampText(topText, 124),
        bottomText: clampText(bottomText, 122),
        kicker: clampText(ctx.heatLabel, 72),
        footer: clampText(ctx.insideJoke, 88),
      };
    },
  },
  {
    id: "brain-rot",
    templateId: "brain-rot-board",
    build: (ctx) => {
      const topText = seedVariant(
        [
          `me connecting ${ctx.cashtag}, ${ctx.threadTopic}, and one disrespectfully bullish candle`,
          `my evidence board after linking ${ctx.cashtag}, bad sleep, and a very suspicious chart`,
          `explaining how ${ctx.cashtag}, ${ctx.secondThreadTopic}, and one loud candle are obviously related`,
          `me drawing red string between ${ctx.cashtag}, the group chat, and a candle with no manners`,
        ],
        ctx.seed,
        151,
      );
      const bottomText = seedVariant(
        [
          `the conclusion is still the same: the chart knows the community is awake`,
          `every clue points back to the same thing: the room spotted it before the timeline did`,
          `I ran the numbers, ignored sleep, and arrived at the usual conclusion: receipts win again`,
          `the board is messy but the verdict is clean: the chat had the read before the crowd had the cope`,
        ],
        ctx.seed,
        152,
      );
      return {
        title: "Evidence Board",
        angle: "Conspiracy wall with receipts",
        topText: clampText(topText, 120),
        bottomText: clampText(bottomText, 112),
        kicker: clampText(ctx.shortObjective, 84),
        footer: clampText(ctx.secondVoiceHint, 72),
      };
    },
  },
] as const;

const COPY_BUILDERS: readonly CopyStyleBuilder[] = [
  {
    id: "deadpan-flex",
    build: (ctx) => ({
      label: "Deadpan flex",
      angle: "Calm, smug, and clipped",
      text: clampText(
        `${ctx.cashtag} is doing that thing again where the chart acts innocent while ${ctx.crowdSize} quietly stack receipts. ${ctx.shortObjective}.`,
        278,
      ),
    }),
  },
  {
    id: "chaos-wire",
    build: (ctx) => ({
      label: "Chaos wire",
      angle: "Fast bulletin energy",
      text: clampText(
        `Desk update: ${ctx.tokenLabel} just turned the room into a siren factory. ${ctx.marketMood}. ${ctx.shortObjective}.`,
        278,
      ),
    }),
  },
  {
    id: "receipt-thread",
    build: (ctx) => ({
      label: "Receipt thread",
      angle: "Receipts-first swagger",
      text: clampText(
        `${ctx.cashtag} community does not do vague optimism. We do receipts, stubborn timing, and jokes that age well on the next candle. ${ctx.shortObjective}.`,
        278,
      ),
    }),
  },
  {
    id: "conspiracy-desk",
    build: (ctx) => ({
      label: "Conspiracy desk",
      angle: "Internet detective bit",
      text: clampText(
        `I have connected the dots between ${ctx.threadTopic}, a suspiciously alive tape, and a chat full of people who clearly enjoy being right at inconvenient hours. ${ctx.shortObjective}.`,
        278,
      ),
    }),
  },
  {
    id: "stadium-call",
    build: (ctx) => ({
      label: "Stadium call",
      angle: "Big-energy announcer voice",
      text: clampText(
        `${ctx.cashtag} just stepped onto the field like it owns the noise. Crowd is up, excuses are down, and the timeline is about to get very familiar with these receipts. ${ctx.shortObjective}.`,
        278,
      ),
    }),
  },
  {
    id: "floor-trader",
    build: (ctx) => ({
      label: "Floor trader",
      angle: "Fast, sharp, market-floor banter",
      text: clampText(
        `${ctx.cashtag} looks like pure desk-confusion for people who missed the tell. ${ctx.marketMood}. The community is early, loud, and annoyingly documented. ${ctx.shortObjective}.`,
        278,
      ),
    }),
  },
  {
    id: "group-chat-spiral",
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
    id: "victory-liturgy",
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

function orderedMemeBuilders(ctx: RaidGenerationContext): MemeStyleBuilder[] {
  const templatePriority = new Map<TokenRaidTemplateId, number>();
  ctx.preferredTemplateIds.forEach((id, index) => templatePriority.set(id, index));
  return [...MEME_BUILDERS].sort((a, b) => {
    const aPreferred = templatePriority.has(a.templateId) ? 0 : 1;
    const bPreferred = templatePriority.has(b.templateId) ? 0 : 1;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    const aRank = templatePriority.get(a.templateId) ?? Number.MAX_SAFE_INTEGER;
    const bRank = templatePriority.get(b.templateId) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return (hashString(`${ctx.seed}:${a.id}`) % 1000) - (hashString(`${ctx.seed}:${b.id}`) % 1000);
  });
}

function orderedCopyBuilders(ctx: RaidGenerationContext): CopyStyleBuilder[] {
  return [...COPY_BUILDERS].sort(
    (a, b) => (hashString(`${ctx.seed}:${a.id}`) % 1000) - (hashString(`${ctx.seed}:${b.id}`) % 1000),
  );
}

function buildFallbackMemeOption(ctx: RaidGenerationContext, index: number): TokenRaidMemeOption {
  const templateId =
    TOKEN_RAID_TEMPLATE_IDS[index % TOKEN_RAID_TEMPLATE_IDS.length] ?? TOKEN_RAID_TEMPLATE_IDS[0];
  return {
    id: buildOptionId("meme", ctx.seed + index * 13, `fallback-${index}`),
    templateId,
    title: ["Receipt Season", "Desk Noise", "Community Alarm"][index] ?? "Desk Noise",
    angle: ["Crisp smugness", "Fast bulletin", "Sleepless confidence"][index] ?? "Sleepless confidence",
    topText: clampText(`${ctx.cashtag} when the room realizes the jokes came with receipts`, 120),
    bottomText: clampText(`${ctx.shortObjective}. ${ctx.marketMood}.`, 120),
    kicker: clampText(ctx.insideJoke, 84),
    footer: clampText(ctx.voiceHint, 72),
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
    id: buildOptionId("copy", ctx.seed + index * 19, `fallback-${index}`),
    style,
    label: ["Receipt mode", "Desk whisper", "Clean flex"][index] ?? "Clean flex",
    angle: ["Receipt-first", "Quietly loud", "Smug timing"][index] ?? "Smug timing",
    text: clampText(lines[index] ?? lines[0] ?? `${ctx.cashtag} has receipts. ${ctx.shortObjective}.`, 278),
  };
}

function finalizeGeneration(
  memes: TokenRaidMemeOption[],
  copies: TokenRaidCopyOption[],
): TokenRaidGenerationResult {
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
  const memeOptions: TokenRaidMemeOption[] = [];
  const copyOptions: TokenRaidCopyOption[] = [];
  const seenMeme = [...ctx.recentSignatures];
  const seenCopy = [...ctx.recentSignatures];
  const usedTemplates = new Set<TokenRaidTemplateId>();

  for (const builder of orderedMemeBuilders(ctx)) {
    const built = builder.build(ctx);
    const signature = normalizeSignature(`${built.title} ${built.angle} ${built.topText} ${built.bottomText}`);
    if (usedTemplates.has(builder.templateId)) continue;
    if (isTooSimilar(signature, seenMeme)) continue;
    const option: TokenRaidMemeOption = {
      id: buildOptionId("meme", ctx.seed + memeOptions.length * 7, builder.id),
      templateId: builder.templateId,
      ...built,
    };
    memeOptions.push(TokenRaidMemeOptionSchema.parse(option));
    usedTemplates.add(builder.templateId);
    seenMeme.push(signature);
    if (memeOptions.length === 3) break;
  }

  for (let index = memeOptions.length; index < 3; index += 1) {
    const fallback = TokenRaidMemeOptionSchema.parse(buildFallbackMemeOption(ctx, index));
    const signature = normalizeSignature(`${fallback.title} ${fallback.angle} ${fallback.topText} ${fallback.bottomText}`);
    if (!isTooSimilar(signature, seenMeme)) {
      memeOptions.push(fallback);
      seenMeme.push(signature);
    }
  }

  for (const builder of orderedCopyBuilders(ctx)) {
    const built = builder.build(ctx);
    const signature = normalizeSignature(`${built.label} ${built.angle} ${built.text}`);
    if (isTooSimilar(signature, seenCopy)) continue;
    const option: TokenRaidCopyOption = {
      id: buildOptionId("copy", ctx.seed + copyOptions.length * 11, builder.id),
      style: builder.id,
      ...built,
    };
    copyOptions.push(TokenRaidCopyOptionSchema.parse(option));
    seenCopy.push(signature);
    if (copyOptions.length === 3) break;
  }

  for (let index = copyOptions.length; index < 3; index += 1) {
    const fallback = TokenRaidCopyOptionSchema.parse(buildFallbackCopyOption(ctx, index));
    const signature = normalizeSignature(`${fallback.label} ${fallback.angle} ${fallback.text}`);
    if (!isTooSimilar(signature, seenCopy)) {
      copyOptions.push(fallback);
      seenCopy.push(signature);
    }
  }

  while (memeOptions.length < 3) {
    memeOptions.push(TokenRaidMemeOptionSchema.parse(buildFallbackMemeOption(ctx, memeOptions.length + 1)));
  }
  while (copyOptions.length < 3) {
    copyOptions.push(TokenRaidCopyOptionSchema.parse(buildFallbackCopyOption(ctx, copyOptions.length + 1)));
  }

  return finalizeGeneration(memeOptions, copyOptions);
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
