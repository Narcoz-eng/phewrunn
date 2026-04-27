import { FeedV2PostCard } from "@/components/feed/FeedV2PostCard";
import type { FeedCoverage, Post } from "@/types";

const liveCoverage: FeedCoverage = {
  state: "live",
  source: "dev-card-lab",
  unavailableReason: null,
};

const unavailableCoverage: FeedCoverage = {
  state: "unavailable",
  source: "dev-card-lab",
  unavailableReason: "Fixture intentionally omits verified market coverage.",
};

function basePost(id: string, content: string, postType: NonNullable<Post["postType"]>): Post {
  return {
    id,
    content,
    itemType: "post",
    postType,
    payload: undefined,
    communityId: null,
    community: null,
    pollExpiresAt: null,
    poll: null,
    authorId: "dev-user",
    author: {
      id: "dev-user",
      name: "CardLab",
      username: "cardlab",
      image: null,
      isVerified: true,
      reputationTier: "fixture",
      level: 1,
      xp: 0,
    },
    contractAddress: null,
    chainType: null,
    tokenName: null,
    tokenSymbol: null,
    tokenImage: null,
    entryMcap: null,
    currentMcap: null,
    mcap1h: null,
    mcap6h: null,
    settled: false,
    settledAt: null,
    isWin: null,
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    _count: { likes: 12, comments: 3, reposts: 2 },
    isLiked: false,
    isReposted: false,
    viewCount: 430,
    engagement: { likes: 12, comments: 3, reposts: 2, reactions: 0, views: 430, velocity: 0 },
    coverage: { signal: unavailableCoverage, candles: unavailableCoverage },
    feedScore: 0,
    feedReasons: ["Fixture layout only"],
    scoreReasons: ["Fixture layout only"],
    tokenContext: null,
  } as Post;
}

const posts: Post[] = [
  {
    ...basePost("call", "$PHEW LONG", "alpha"),
    coverage: { signal: liveCoverage, candles: unavailableCoverage },
    payload: {
      call: {
        title: "$PHEW LONG",
        thesis: "Strong call payload with verified signal coverage and no chart preview.",
        direction: "LONG",
        token: {
          address: "0x1234567890abcdef1234567890abcdef12345678",
          symbol: "PHEW",
          name: "Phew",
          logo: null,
          chain: "ethereum",
          dexscreenerUrl: null,
        },
        metrics: [
          { label: "Entry mcap", value: 124000, unit: "usd" },
          { label: "Live move", value: 21.4, unit: "pct" },
          { label: "Conviction", value: 82, unit: "score" },
        ],
        signalScore: 82,
        signalLabel: "High conviction",
        chartPreview: {
          state: "unavailable",
          source: "dev-card-lab",
          unavailableReason: "No validated candle series in this fixture.",
          candles: null,
        },
      },
      chart: null,
      poll: null,
      raid: null,
      news: null,
      whale: null,
      discussion: null,
    },
  },
  {
    ...basePost("chart", "$PHEW Technical Setup", "chart"),
    payload: {
      call: null,
      chart: {
        title: "$PHEW Technical Setup",
        thesis: "Chart payload stays compact until backend supplies a valid chartPreview.",
        token: null,
        timeframe: "1h",
        chartPreview: {
          state: "unavailable",
          source: "dev-card-lab",
          unavailableReason: "Insufficient candles.",
          candles: null,
        },
      },
      poll: null,
      raid: null,
      news: null,
      whale: null,
      discussion: null,
    },
  },
  {
    ...basePost("poll", "Where does $PHEW close today?", "poll"),
    payload: {
      call: null,
      chart: null,
      poll: {
        totalVotes: 93,
        viewerOptionId: null,
        options: [
          { id: "up", label: "Above resistance", votes: 61, percentage: 65.6 },
          { id: "flat", label: "Range-bound", votes: 22, percentage: 23.7 },
          { id: "down", label: "Below support", votes: 10, percentage: 10.7 },
        ],
      },
      raid: null,
      news: null,
      whale: null,
      discussion: null,
    },
  },
  {
    ...basePost("raid", "Raid room update", "raid"),
    payload: {
      call: null,
      chart: null,
      poll: null,
      raid: {
        status: "unavailable",
        unavailableReason: "No linked raid campaign payload.",
        raidId: null,
        token: null,
        participants: null,
        posts: null,
        progressPct: null,
        openedAt: null,
        closesAt: null,
        ctaRoute: null,
        objective: null,
      },
      news: null,
      whale: null,
      discussion: null,
    },
  },
  {
    ...basePost("news", "Protocol partnership announced", "news"),
    payload: {
      call: null,
      chart: null,
      poll: null,
      raid: null,
      news: {
        headline: "Protocol partnership announced",
        sourceUrl: "https://example.com",
        summary: "News payload uses headline, summary, and source only.",
        publishedAt: new Date().toISOString(),
        relatedToken: null,
      },
      whale: null,
      discussion: null,
    },
  },
  {
    ...basePost("whale", "Tracked wallet flow", "discussion"),
    itemType: "whale",
    payload: {
      call: null,
      chart: null,
      poll: null,
      raid: null,
      news: null,
      whale: { status: "unavailable", unavailableReason: "No verified transfer attached." },
      discussion: null,
    },
  },
  {
    ...basePost("discussion", "Text-first discussion about liquidity rotation.", "discussion"),
    payload: {
      call: null,
      chart: null,
      poll: null,
      raid: null,
      news: null,
      whale: null,
      discussion: { body: "Text-first discussion about liquidity rotation." },
    },
  },
];

export default function FeedCardLab() {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="rounded-[16px] border border-white/10 bg-white/[0.035] p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-lime-200/70">Dev fixture</div>
        <h1 className="mt-1 text-xl font-semibold text-white">Feed Card Lab</h1>
        <p className="mt-1 text-sm text-white/52">
          Local typed payload fixtures for layout QA only. This route is not registered in production builds.
        </p>
      </div>
      {posts.map((post) => (
        <FeedV2PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}
