import type { TerminalCandle } from "@/components/token/pro-terminal/types";
import type {
  DiscoveryFeedSidebarResponse,
  DiscoverySidebarCall,
  DiscoverySidebarMover,
  Post,
} from "@/types";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isValidMarketStats(stats: DiscoveryFeedSidebarResponse["marketStats"] | null | undefined): boolean {
  if (!stats) return false;
  const hasMarketCap = finite(stats.marketCap) && stats.marketCap > 0 && stats.coverage?.marketCap !== "unavailable";
  const hasVolume = finite(stats.volume24h) && stats.volume24h > 0 && stats.coverage?.volume24h !== "unavailable";
  return hasMarketCap || hasVolume;
}

export function isValidGainer(item: DiscoverySidebarMover | null | undefined): item is DiscoverySidebarMover {
  if (!item) return false;
  return (
    typeof item.address === "string" &&
    item.address.trim().length > 0 &&
    finite(item.change24hPct) &&
    Math.abs(item.change24hPct) >= 0.01 &&
    item.changeSource !== "unavailable" &&
    ((finite(item.marketCap) && item.marketCap > 0) ||
      (finite(item.liquidity) && item.liquidity > 0) ||
      (finite(item.volume24h) && item.volume24h > 0))
  );
}

export function isValidCandleSeries(candles: TerminalCandle[] | null | undefined): candles is TerminalCandle[] {
  if (!Array.isArray(candles) || candles.length < 8) return false;
  const valid = candles.filter(
    (candle) =>
      finite(candle.timestamp) &&
      finite(candle.open) &&
      finite(candle.high) &&
      finite(candle.low) &&
      finite(candle.close) &&
      candle.open > 0 &&
      candle.high > 0 &&
      candle.low > 0 &&
      candle.close > 0 &&
      candle.high >= candle.low
  );
  if (valid.length < 8) return false;

  const minLow = Math.min(...valid.map((candle) => candle.low));
  const maxHigh = Math.max(...valid.map((candle) => candle.high));
  const firstOpen = valid[0]?.open ?? 0;
  const lastClose = valid[valid.length - 1]?.close ?? 0;
  const rangePct = minLow > 0 ? ((maxHigh - minLow) / minLow) * 100 : 0;
  const movePct = firstOpen > 0 ? Math.abs(((lastClose - firstOpen) / firstOpen) * 100) : 0;
  const bodyCount = valid.filter((candle) => Math.abs(candle.close - candle.open) > candle.open * 0.0005).length;

  return rangePct >= 0.05 && (movePct >= 0.03 || bodyCount >= Math.ceil(valid.length * 0.25));
}

export function isValidSignalScore(value: number | null | undefined, coverageState?: string | null): value is number {
  return finite(value) && value > 0 && value <= 100 && coverageState !== "unavailable";
}

export function isValidSmartMoney(post: Post): boolean {
  return (
    isValidSignalScore(post.signal?.smartMoneyScore, post.signal?.aiScoreCoverage.state) ||
    (finite(post.trustedTraderCount) && post.trustedTraderCount > 0)
  );
}

export function isValidRiskLabel(label: string | null | undefined, score?: number | null): boolean {
  const normalized = label?.trim().toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "clean" || normalized === "neutral") return false;
  if (normalized.includes("pending") || normalized.includes("unavailable")) return false;
  if (normalized === "lower" || normalized === "low") {
    return finite(score) && score > 0;
  }
  return true;
}

export function isValidTrendingCall(item: DiscoverySidebarCall | null | undefined): item is DiscoverySidebarCall {
  if (!item) return false;
  const hasToken = Boolean(item.contractAddress || item.tokenSymbol || item.tokenName);
  const hasScore = finite(item.trendScore) && item.trendScore >= 20;
  const hasSignal =
    (finite(item.conviction) && item.conviction >= 40) ||
    (finite(item.confidence) && item.confidence >= 40) ||
    (finite(item.roiCurrentPct) && Math.abs(item.roiCurrentPct) >= 0.1);
  return hasToken && hasScore && hasSignal;
}
