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

function fresh(value: string | null | undefined, maxAgeMs: number | null | undefined): boolean {
  if (!value || !maxAgeMs || maxAgeMs <= 0) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && Date.now() - time <= maxAgeMs;
}

export function isValidMarketStats(stats: DiscoveryFeedSidebarResponse["marketStats"] | null | undefined): boolean {
  if (!stats) return false;
  if (stats.source === "unavailable" || !fresh(stats.asOf, stats.maxAgeMs)) return false;
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
    fresh(item.fetchedAt, item.maxAgeMs) &&
    ((finite(item.marketCap) && item.marketCap > 0) ||
      (finite(item.liquidity) && item.liquidity > 0) ||
      (finite(item.volume24h) && item.volume24h > 0))
  );
}

export function isValidCandleSeries(candles: TerminalCandle[] | null | undefined): candles is TerminalCandle[] {
  if (!Array.isArray(candles) || candles.length < 12) return false;
  const valid = candles.filter(
    (candle) => {
      if (
        !finite(candle.timestamp) ||
        !finite(candle.open) ||
        !finite(candle.high) ||
        !finite(candle.low) ||
        !finite(candle.close) ||
        candle.open <= 0 ||
        candle.high <= 0 ||
        candle.low <= 0 ||
        candle.close <= 0 ||
        candle.high < Math.max(candle.open, candle.close) ||
        candle.low > Math.min(candle.open, candle.close)
      ) {
        return false;
      }
      const body = Math.abs(candle.close - candle.open);
      const range = candle.high - candle.low;
      if (range <= 0) return false;
      const basis = Math.max(candle.open, candle.close, candle.low);
      const rangeRatio = basis > 0 ? range / basis : 0;
      if (rangeRatio > 0.95) return false;
      if (body > 0 && range / body > 28 && rangeRatio > 0.18) return false;
      if (body === 0 && rangeRatio > 0.08) return false;
      return true;
    }
  );
  if (valid.length < Math.max(12, Math.ceil(candles.length * 0.9))) return false;

  const minLow = Math.min(...valid.map((candle) => candle.low));
  const maxHigh = Math.max(...valid.map((candle) => candle.high));
  const firstOpen = valid[0]?.open ?? 0;
  const lastClose = valid[valid.length - 1]?.close ?? 0;
  const rangePct = minLow > 0 ? ((maxHigh - minLow) / minLow) * 100 : 0;
  const movePct = firstOpen > 0 ? Math.abs(((lastClose - firstOpen) / firstOpen) * 100) : 0;
  const bodyCount = valid.filter((candle) => Math.abs(candle.close - candle.open) > candle.open * 0.0005).length;
  const returns = valid.slice(1).map((candle, index) => {
    const previous = valid[index]?.close ?? candle.open;
    return previous > 0 ? Math.abs((candle.close - previous) / previous) : 0;
  });
  const extremeSingleBar = returns.some((value, index) => {
    const current = valid[index + 1];
    if (!current || value < 0.65) return false;
    const previousValues = returns.slice(Math.max(0, index - 5), index);
    const nextValues = returns.slice(index + 1, index + 6);
    const neighborMax = Math.max(0, ...previousValues, ...nextValues);
    return neighborMax < value / 8;
  });

  return !extremeSingleBar && rangePct >= 0.05 && rangePct <= 950 && (movePct >= 0.03 || bodyCount >= Math.ceil(valid.length * 0.25));
}

export function isValidSignalScore(value: number | null | undefined, coverageState?: string | null): value is number {
  return finite(value) && value > 0 && value <= 100 && coverageState !== "unavailable";
}

export function isValidSmartMoney(post: Post): boolean {
  if (finite(post.trustedTraderCount) && post.trustedTraderCount > 0) return true;
  const reasons = post.signal?.scoreReasons ?? [];
  const hasExplicitReason = reasons.some((reason) => /smart money|trusted trader|wallet flow|whale/i.test(reason));
  return hasExplicitReason && isValidSignalScore(post.signal?.smartMoneyScore, post.signal?.aiScoreCoverage.state);
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
  const asOfFresh = fresh(item.asOf, 5 * 60 * 1000);
  const hasSignal =
    (finite(item.conviction) && item.conviction >= 40) ||
    (finite(item.confidence) && item.confidence >= 40) ||
    (finite(item.roiCurrentPct) && Math.abs(item.roiCurrentPct) >= 0.1);
  return hasToken && hasScore && asOfFresh && item.source !== "unavailable" && hasSignal;
}
