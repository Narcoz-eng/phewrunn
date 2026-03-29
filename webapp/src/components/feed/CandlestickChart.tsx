import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type CandlestickChartPoint = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isBullish: boolean;
  label: string;
  fullLabel: string;
};

type CandlestickChartProps = {
  data: CandlestickChartPoint[];
  visibleStartIndex: number;
  visibleEndIndex: number;
  futureSlotCount?: number;
  showVolume: boolean;
  showCandles: boolean;
  stroke: string;
  fill: string;
  entryPrice?: number | null;
  entryPoint?: { ts: number; close: number } | null;
  onHoverIndexChange?: (index: number | null) => void;
  onOverviewSelect?: (index: number) => void;
  formatPrice: (value: number) => string;
  formatTick: (timestampMs: number) => string;
  resetHoverKey?: string | number | boolean | null;
  className?: string;
};

const RIGHT_AXIS_WIDTH = 72;
const PRICE_TICK_COUNT = 5;
const X_TICK_COUNT = 5;
const OVERVIEW_HEIGHT = 34;
const X_AXIS_HEIGHT = 22;
const MAIN_PADDING_TOP = 10;
const MAIN_PADDING_LEFT = 8;
const MAIN_PADDING_BOTTOM = 8;
const SECTION_GAP = 10;
const MIN_CANDLE_BODY_WIDTH = 3;
const MAX_CANDLE_BODY_WIDTH = 14;
const INITIAL_HOVER_LOCK_MS = 220;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildLinePath(
  points: Array<{ x: number; y: number }>
): string {
  if (points.length === 0) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

export const CandlestickChart = memo(function CandlestickChart({
  data,
  visibleStartIndex,
  visibleEndIndex,
  futureSlotCount = 0,
  showVolume,
  showCandles,
  stroke,
  fill,
  entryPrice = null,
  entryPoint = null,
  onHoverIndexChange,
  onOverviewSelect,
  formatPrice,
  formatTick,
  resetHoverKey = null,
  className,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overviewPointerActiveRef = useRef(false);
  const suppressHoverUntilRef = useRef(0);
  const hoverRafRef = useRef<number>(0);
  const latestCandleSignatureRef = useRef<string | null>(null);
  const latestCandleTimestampRef = useRef<number | null>(null);
  const pulseClearTimeoutRef = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredVisibleIndex, setHoveredVisibleIndex] = useState<number | null>(null);
  const [latestCandlePulseKey, setLatestCandlePulseKey] = useState(0);
  const [latestCandlePulseActive, setLatestCandlePulseActive] = useState(false);
  const [latestCandlePulseMode, setLatestCandlePulseMode] = useState<"update" | "new-candle" | null>(null);
  const chartInstanceId = useId().replace(/[:]/g, "");
  const lineFillId = `${chartInstanceId}-candlestick-line-fill`;
  const sparkleFilterId = `${chartInstanceId}-sparkle-glow`;

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const rect = entry?.contentRect;
      if (!rect) return;
      setSize({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      });
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePointerRelease = () => {
      overviewPointerActiveRef.current = false;
    };
    window.addEventListener("mouseup", handlePointerRelease);
    window.addEventListener("touchend", handlePointerRelease);
    window.addEventListener("touchcancel", handlePointerRelease);
    return () => {
      window.removeEventListener("mouseup", handlePointerRelease);
      window.removeEventListener("touchend", handlePointerRelease);
      window.removeEventListener("touchcancel", handlePointerRelease);
    };
  }, []);

  const safeWindow = useMemo(() => {
    if (data.length === 0) {
      return { startIndex: 0, endIndex: -1 };
    }
    const startIndex = clamp(Math.floor(visibleStartIndex), 0, data.length - 1);
    const endIndex = clamp(Math.floor(visibleEndIndex), startIndex, data.length - 1);
    return { startIndex, endIndex };
  }, [data.length, visibleEndIndex, visibleStartIndex]);

  const visibleData = useMemo(
    () => data.slice(safeWindow.startIndex, safeWindow.endIndex + 1),
    [data, safeWindow.endIndex, safeWindow.startIndex]
  );
  const isShowingLatestEdge = safeWindow.endIndex >= data.length - 1;
  const effectiveFutureSlotCount = isShowingLatestEdge ? Math.max(0, futureSlotCount) : 0;

  const activeVisibleIndex =
    hoveredVisibleIndex !== null && hoveredVisibleIndex >= 0 && hoveredVisibleIndex < visibleData.length
      ? hoveredVisibleIndex
      : null;
  const activePoint = activeVisibleIndex !== null ? visibleData[activeVisibleIndex] ?? null : null;

  useEffect(() => {
    if (!onHoverIndexChange) return;
    if (hoveredVisibleIndex === null) {
      onHoverIndexChange(null);
      return;
    }
    onHoverIndexChange(safeWindow.startIndex + hoveredVisibleIndex);
  }, [hoveredVisibleIndex, onHoverIndexChange, safeWindow.startIndex]);

  useEffect(() => {
    if (hoveredVisibleIndex === null) return;
    if (hoveredVisibleIndex < visibleData.length) return;
    setHoveredVisibleIndex(visibleData.length > 0 ? visibleData.length - 1 : null);
  }, [hoveredVisibleIndex, visibleData.length]);

  useEffect(() => {
    setHoveredVisibleIndex(null);
    suppressHoverUntilRef.current =
      typeof performance !== "undefined" ? performance.now() + INITIAL_HOVER_LOCK_MS : 0;
  }, [resetHoverKey]);

  useEffect(() => {
    const latestPoint = data[data.length - 1];
    if (!latestPoint) return;

    const nextSignature = [
      latestPoint.ts,
      latestPoint.open,
      latestPoint.high,
      latestPoint.low,
      latestPoint.close,
      latestPoint.volume,
    ].join(":");

    if (latestCandleSignatureRef.current && latestCandleSignatureRef.current !== nextSignature) {
      const nextPulseMode =
        latestCandleTimestampRef.current !== null && latestCandleTimestampRef.current !== latestPoint.ts
          ? "new-candle"
          : "update";
      setLatestCandlePulseMode(nextPulseMode);
      setLatestCandlePulseKey((current) => current + 1);
      setLatestCandlePulseActive(true);
      if (typeof window !== "undefined") {
        if (pulseClearTimeoutRef.current !== null) {
          window.clearTimeout(pulseClearTimeoutRef.current);
        }
        pulseClearTimeoutRef.current = window.setTimeout(() => {
          setLatestCandlePulseActive(false);
          setLatestCandlePulseMode(null);
        }, nextPulseMode === "new-candle" ? 820 : 340);
      }
    }

    latestCandleSignatureRef.current = nextSignature;
    latestCandleTimestampRef.current = latestPoint.ts;

    return () => {
      if (typeof window !== "undefined" && pulseClearTimeoutRef.current !== null) {
        window.clearTimeout(pulseClearTimeoutRef.current);
        pulseClearTimeoutRef.current = null;
      }
    };
  }, [data]);

  const width = size.width;
  const height = size.height;
  const chartWidth = Math.max(1, width - RIGHT_AXIS_WIDTH - MAIN_PADDING_LEFT);
  const mainContentBottom = Math.max(
    MAIN_PADDING_TOP + 60,
    height - OVERVIEW_HEIGHT - X_AXIS_HEIGHT - MAIN_PADDING_BOTTOM
  );
  const volumeHeight = showVolume ? Math.max(46, Math.min(86, Math.round(height * 0.16))) : 0;
  const volumeBottom = mainContentBottom;
  const volumeTop = showVolume ? Math.max(MAIN_PADDING_TOP + 26, volumeBottom - volumeHeight) : volumeBottom;
  const priceBottom = showVolume ? Math.max(MAIN_PADDING_TOP + 22, volumeTop - SECTION_GAP) : volumeBottom;
  const priceTop = MAIN_PADDING_TOP;
  const priceHeight = Math.max(40, priceBottom - priceTop);
  const overviewTop = Math.max(mainContentBottom + X_AXIS_HEIGHT, height - OVERVIEW_HEIGHT);
  const overviewBottom = Math.max(overviewTop + 10, height - 6);
  const overviewHeight = Math.max(12, overviewBottom - overviewTop);

  const priceStats = useMemo(() => {
    if (visibleData.length === 0) {
      return {
        min: 0,
        max: 1,
        maxVolume: 0,
      };
    }
    const min = Math.min(...visibleData.map((point) => point.low));
    const max = Math.max(...visibleData.map((point) => point.high));
    const maxVolume = Math.max(...visibleData.map((point) => point.volume));
    const rawRange = max - min;
    const paddedRange = rawRange > 0 ? rawRange * 0.12 : Math.max(Math.abs(max) * 0.08, 0.000001);
    const domainMin = Math.max(0, min - paddedRange);
    const domainMax = max + paddedRange;

    return {
      min: domainMin,
      max: domainMax > domainMin ? domainMax : domainMin + 1,
      maxVolume: Number.isFinite(maxVolume) ? maxVolume : 0,
    };
  }, [visibleData]);

  const overviewStats = useMemo(() => {
    if (data.length === 0) {
      return { min: 0, max: 1 };
    }
    const min = Math.min(...data.map((point) => point.close));
    const max = Math.max(...data.map((point) => point.close));
    const range = max - min;
    const pad = range > 0 ? range * 0.08 : Math.max(Math.abs(max) * 0.05, 0.000001);
    return {
      min: Math.max(0, min - pad),
      max: max + pad,
    };
  }, [data]);

  const xForVisibleIndex = useCallback((index: number) => {
    const visibleSlotCount = Math.max(1, visibleData.length + effectiveFutureSlotCount);
    if (visibleSlotCount <= 1) return MAIN_PADDING_LEFT + chartWidth / 2;
    return MAIN_PADDING_LEFT + (index / (visibleSlotCount - 1)) * chartWidth;
  }, [chartWidth, effectiveFutureSlotCount, visibleData.length]);

  const xForGlobalIndex = useCallback((index: number) => {
    if (data.length <= 1) return MAIN_PADDING_LEFT + chartWidth / 2;
    return MAIN_PADDING_LEFT + (index / (data.length - 1)) * chartWidth;
  }, [chartWidth, data.length]);

  const yForPrice = useCallback((price: number) => {
    const ratio = (price - priceStats.min) / Math.max(0.0000001, priceStats.max - priceStats.min);
    return priceBottom - ratio * priceHeight;
  }, [priceBottom, priceHeight, priceStats.max, priceStats.min]);

  const yForOverviewPrice = useCallback((price: number) => {
    const ratio = (price - overviewStats.min) / Math.max(0.0000001, overviewStats.max - overviewStats.min);
    return overviewBottom - ratio * overviewHeight;
  }, [overviewBottom, overviewHeight, overviewStats.max, overviewStats.min]);

  const visibleLinePoints = useMemo(
    () => visibleData.map((point, index) => ({ x: xForVisibleIndex(index), y: yForPrice(point.close) })),
    [visibleData, xForVisibleIndex, yForPrice]
  );
  const visibleLinePath = useMemo(() => buildLinePath(visibleLinePoints), [visibleLinePoints]);
  const overviewLinePath = useMemo(
    () =>
      buildLinePath(
        data.map((point, index) => ({
          x: xForGlobalIndex(index),
          y: yForOverviewPrice(point.close),
        }))
      ),
    [data, xForGlobalIndex, yForOverviewPrice]
  );

  const xTicks = useMemo(() => {
    if (visibleData.length === 0) return [];
    const lastIndex = visibleData.length - 1;
    if (lastIndex === 0) {
      const onlyPoint = visibleData[0];
      return onlyPoint
        ? [{ x: xForVisibleIndex(0), label: formatTick(onlyPoint.ts), anchor: "end" as const }]
        : [];
    }

    const longestLabelLength = visibleData.reduce((maxLength, point) => {
      const nextLabelLength = formatTick(point.ts).length;
      return Math.max(maxLength, nextLabelLength);
    }, 0);
    const minTickGapPx = Math.max(72, Math.min(132, longestLabelLength * 7.4));
    const maxTickCount = clamp(
      Math.floor(chartWidth / Math.max(1, minTickGapPx)) + 1,
      2,
      Math.min(X_TICK_COUNT, visibleData.length)
    );
    const ticks: Array<{ index: number; x: number; label: string; anchor: "start" | "middle" | "end" }> = [];

    const pushTick = (index: number, anchor: "start" | "middle" | "end") => {
      const point = visibleData[index];
      if (!point) return;
      const label = formatTick(point.ts);
      const x = xForVisibleIndex(index);
      const existingIndex = ticks.findIndex((tick) => tick.index === index);
      if (existingIndex >= 0) {
        ticks[existingIndex] = { index, x, label, anchor };
        return;
      }
      if (ticks.some((tick) => tick.label === label && Math.abs(tick.x - x) < minTickGapPx * 0.5)) {
        return;
      }
      ticks.push({ index, x, label, anchor });
    };

    pushTick(0, "start");
    for (let slot = 1; slot < maxTickCount - 1; slot += 1) {
      const ratio = slot / Math.max(1, maxTickCount - 1);
      const index = clamp(Math.round(ratio * lastIndex), 1, Math.max(1, lastIndex - 1));
      if (index <= 0 || index >= lastIndex) continue;
      pushTick(index, "middle");
    }
    pushTick(lastIndex, "end");

    const sortedTicks = ticks.sort((left, right) => left.index - right.index);
    const filteredTicks: typeof sortedTicks = [];

    for (const tick of sortedTicks) {
      const priorTick = filteredTicks[filteredTicks.length - 1];
      if (!priorTick) {
        filteredTicks.push(tick);
        continue;
      }

      const requiredGapPx = tick.anchor === "end" ? minTickGapPx * 0.72 : minTickGapPx;
      if (tick.x - priorTick.x >= requiredGapPx) {
        filteredTicks.push(tick);
        continue;
      }

      if (tick.anchor === "end") {
        while (filteredTicks.length > 1) {
          const candidatePrior = filteredTicks[filteredTicks.length - 1];
          if (tick.x - candidatePrior.x >= minTickGapPx * 0.72) break;
          filteredTicks.pop();
        }
        filteredTicks.push(tick);
      }
    }

    return filteredTicks;
  }, [chartWidth, formatTick, visibleData, xForVisibleIndex]);

  const yTicks = useMemo(() => {
    const ticks: Array<{ y: number; value: number }> = [];
    for (let step = 0; step < PRICE_TICK_COUNT; step += 1) {
      const ratio = step / Math.max(1, PRICE_TICK_COUNT - 1);
      const value = priceStats.max - ratio * (priceStats.max - priceStats.min);
      ticks.push({
        y: priceTop + ratio * priceHeight,
        value,
      });
    }
    return ticks;
  }, [priceHeight, priceStats.max, priceStats.min, priceTop]);

  const candleBodyWidth = clamp(
    visibleData.length > 0 ? chartWidth / Math.max(visibleData.length, 1) * 0.62 : MIN_CANDLE_BODY_WIDTH,
    MIN_CANDLE_BODY_WIDTH,
    MAX_CANDLE_BODY_WIDTH
  );

  const handleHover = (clientX: number) => {
    if (hoverRafRef.current) cancelAnimationFrame(hoverRafRef.current);
    hoverRafRef.current = requestAnimationFrame(() => {
      const node = containerRef.current;
      if (!node || visibleData.length === 0) {
        setHoveredVisibleIndex(null);
        return;
      }
      if (
        suppressHoverUntilRef.current > 0 &&
        typeof performance !== "undefined" &&
        performance.now() < suppressHoverUntilRef.current
      ) {
        return;
      }
      const rect = node.getBoundingClientRect();
      const relativeX = clamp(clientX - rect.left - MAIN_PADDING_LEFT, 0, chartWidth);
      const ratio = chartWidth <= 0 ? 0 : relativeX / chartWidth;
      const nextIndex = clamp(Math.round(ratio * Math.max(visibleData.length - 1, 0)), 0, visibleData.length - 1);
      setHoveredVisibleIndex(nextIndex);
    });
  };

  const resolveOverviewIndex = (clientX: number) => {
    const node = containerRef.current;
    if (!node || data.length === 0 || !onOverviewSelect) return;
    const rect = node.getBoundingClientRect();
    const relativeX = clamp(clientX - rect.left - MAIN_PADDING_LEFT, 0, chartWidth);
    const ratio = chartWidth <= 0 ? 0 : relativeX / chartWidth;
    const nextIndex = clamp(Math.round(ratio * Math.max(data.length - 1, 0)), 0, data.length - 1);
    onOverviewSelect(nextIndex);
  };

  const activeCrosshairX =
    activeVisibleIndex !== null && visibleData[activeVisibleIndex]
      ? xForVisibleIndex(activeVisibleIndex)
      : null;
  const activeCrosshairY = activePoint ? yForPrice(activePoint.close) : null;
  const activeEntryX =
    entryPoint
      ? (() => {
          const entryIndex = visibleData.findIndex((point) => point.ts === entryPoint.ts);
          return entryIndex >= 0 ? xForVisibleIndex(entryIndex) : null;
        })()
      : null;
  const latestVisibleIndex = isShowingLatestEdge && visibleData.length > 0 ? visibleData.length - 1 : null;
  const priceGridStroke = "hsl(var(--foreground) / 0.09)";
  const axisLabelColor = "hsl(var(--muted-foreground) / 0.85)";
  const axisBoundaryLabelColor = "hsl(var(--foreground) / 0.66)";
  const overviewBackground = "hsl(var(--foreground) / 0.035)";
  const overviewStroke = "hsl(var(--foreground) / 0.08)";
  const overviewWindowFill = "hsl(var(--foreground) / 0.065)";
  const overviewWindowStroke = "hsl(var(--foreground) / 0.24)";
  const crosshairVerticalStroke = "hsl(var(--foreground) / 0.18)";
  const crosshairHorizontalStroke = "hsl(var(--foreground) / 0.12)";
  const entryPointStroke = "hsl(var(--background) / 0.96)";
  const tooltipWidth = 168;
  const tooltipHeight = showVolume ? 144 : 124;
  const tooltipStyle =
    activeCrosshairX !== null && activeCrosshairY !== null
      ? {
          left:
            activeCrosshairX >= width - tooltipWidth - 20
              ? Math.max(8, activeCrosshairX - tooltipWidth - 12)
              : Math.min(
                  Math.max(8, width - tooltipWidth - 8),
                  activeCrosshairX + 12
                ),
          top: Math.max(
            8,
            Math.min(
              Math.max(8, mainContentBottom - tooltipHeight - 4),
              activeCrosshairY - tooltipHeight * 0.55
            )
          ),
        }
      : { left: 8, top: 8 };

  return (
    <div
      ref={containerRef}
      className={cn("chart-container relative h-full w-full", className)}
      onMouseMove={(event) => handleHover(event.clientX)}
      onMouseLeave={() => setHoveredVisibleIndex(null)}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={lineFillId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.24" />
            <stop offset="100%" stopColor={fill} stopOpacity="0.04" />
          </linearGradient>
          <filter id={sparkleFilterId} x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="1.8" />
          </filter>
        </defs>

        {yTicks.map((tick, index) => (
          <g key={`price-grid-${index}`}>
            <line
              x1={MAIN_PADDING_LEFT}
              x2={MAIN_PADDING_LEFT + chartWidth}
              y1={tick.y}
              y2={tick.y}
              stroke={priceGridStroke}
              strokeDasharray={index === PRICE_TICK_COUNT - 1 ? "0" : "3 4"}
            />
            <text
              x={MAIN_PADDING_LEFT + chartWidth + 8}
              y={tick.y + 4}
              fill={axisLabelColor}
              fontSize="10"
            >
              {formatPrice(tick.value).replace("$", "")}
            </text>
          </g>
        ))}

        {entryPrice !== null ? (
          <>
            <line
              x1={MAIN_PADDING_LEFT}
              x2={MAIN_PADDING_LEFT + chartWidth}
              y1={yForPrice(entryPrice)}
              y2={yForPrice(entryPrice)}
              stroke="rgba(96,165,250,0.65)"
              strokeDasharray="4 4"
            />
            <text
              x={MAIN_PADDING_LEFT + 4}
              y={yForPrice(entryPrice) - 6}
              fill="rgba(147,197,253,0.95)"
              fontSize="10"
            >
              Entry
            </text>
          </>
        ) : null}

        {showVolume && priceStats.maxVolume > 0
          ? visibleData.map((point, index) => {
              const x = xForVisibleIndex(index);
              const barHeight =
                priceStats.maxVolume <= 0 ? 0 : (point.volume / priceStats.maxVolume) * Math.max(1, volumeBottom - volumeTop);
              return (
                <rect
                  key={`volume-${point.ts}`}
                  x={x - Math.max(1, candleBodyWidth / 2)}
                  y={volumeBottom - barHeight}
                  width={Math.max(2, candleBodyWidth)}
                  height={Math.max(1, barHeight)}
                  rx="1"
                  fill={point.isBullish ? "rgba(34,197,94,0.28)" : "rgba(239,68,68,0.22)"}
                  style={{ transition: "all 240ms ease-out" }}
                />
              );
            })
          : null}

        {showCandles ? (
          visibleData.map((point, index) => {
            const x = xForVisibleIndex(index);
            const highY = yForPrice(point.high);
            const lowY = yForPrice(point.low);
            const openY = yForPrice(point.open);
            const closeY = yForPrice(point.close);
            const top = Math.min(openY, closeY);
            const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
            const bodyColor = point.isBullish ? "#22c55e" : "#ef4444";
            const isLatestVisiblePoint = latestVisibleIndex === index;
            const shouldPulse = isLatestVisiblePoint && latestCandlePulseActive;
            const isNewCandlePulse = shouldPulse && latestCandlePulseMode === "new-candle";
            const isTradeUpdatePulse = shouldPulse && latestCandlePulseMode === "update";
            const centerY = top + bodyHeight / 2;

            return (
              <g key={`candle-${point.ts}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={highY}
                  y2={lowY}
                  stroke={bodyColor}
                  strokeWidth={isLatestVisiblePoint ? 1.5 : 1.25}
                  strokeLinecap="round"
                  opacity={isLatestVisiblePoint ? 0.98 : 0.88}
                  style={{ transition: "all 240ms ease-out" }}
                />
                <rect
                  x={x - candleBodyWidth / 2}
                  y={top}
                  width={candleBodyWidth}
                  height={bodyHeight}
                  rx="1"
                  fill={bodyColor}
                  fillOpacity={isLatestVisiblePoint ? 0.98 : 0.92}
                  stroke={isLatestVisiblePoint ? "rgba(255,255,255,0.2)" : "transparent"}
                  strokeWidth={isLatestVisiblePoint ? 0.8 : 0}
                  style={{ transition: "all 240ms ease-out" }}
                />
                {isTradeUpdatePulse ? (
                  <g key={`update-pulse-${latestCandlePulseKey}`} pointerEvents="none">
                    <circle cx={x} cy={closeY} r={Math.max(4, candleBodyWidth * 0.55)} fill="none" stroke={bodyColor} strokeWidth="1.1">
                      <animate attributeName="r" values={`${Math.max(4, candleBodyWidth * 0.55)};${Math.max(10, candleBodyWidth * 1.6)}`} dur="0.34s" />
                      <animate attributeName="opacity" values="0.42;0" dur="0.34s" />
                    </circle>
                  </g>
                ) : null}
                {isNewCandlePulse ? (
                  <g key={`spark-${latestCandlePulseKey}`} pointerEvents="none">
                    <circle cx={x + candleBodyWidth * 0.95} cy={highY - 6} r="1.4" fill="#f8fafc" filter={`url(#${sparkleFilterId})`}>
                      <animate attributeName="cy" values={`${highY - 6};${highY - 11}`} dur="0.62s" />
                      <animate attributeName="opacity" values="0;0.95;0" dur="0.62s" />
                    </circle>
                    <circle cx={x - candleBodyWidth * 1.05} cy={top + 6} r="1.1" fill={bodyColor} filter={`url(#${sparkleFilterId})`}>
                      <animate attributeName="cx" values={`${x - candleBodyWidth * 1.05};${x - candleBodyWidth * 1.65}`} dur="0.66s" />
                      <animate attributeName="cy" values={`${top + 6};${top + 1}`} dur="0.66s" />
                      <animate attributeName="opacity" values="0;0.9;0" dur="0.66s" />
                    </circle>
                    <circle cx={x} cy={centerY} r={Math.max(3.5, candleBodyWidth * 0.5)} fill="none" stroke={bodyColor} strokeWidth="1">
                      <animate attributeName="r" values={`${Math.max(3.5, candleBodyWidth * 0.5)};${Math.max(8, candleBodyWidth * 1.1)}`} dur="0.54s" />
                      <animate attributeName="opacity" values="0.3;0" dur="0.54s" />
                    </circle>
                  </g>
                ) : null}
              </g>
            );
          })
        ) : (
          <>
            <path
              d={`${visibleLinePath} L ${visibleLinePoints[visibleLinePoints.length - 1]?.x ?? MAIN_PADDING_LEFT} ${priceBottom} L ${visibleLinePoints[0]?.x ?? MAIN_PADDING_LEFT} ${priceBottom} Z`}
              fill={`url(#${lineFillId})`}
            />
            <path
              d={visibleLinePath}
              fill="none"
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}

        {activeEntryX !== null && entryPoint ? (
          <>
            <line
              x1={activeEntryX}
              x2={activeEntryX}
              y1={priceTop}
              y2={priceBottom}
              stroke="rgba(96,165,250,0.38)"
              strokeDasharray="3 4"
            />
            <circle
              cx={activeEntryX}
              cy={yForPrice(entryPoint.close)}
              r="4"
              fill="#60a5fa"
              stroke={entryPointStroke}
              strokeWidth="1.4"
            />
          </>
        ) : null}

        {activeCrosshairX !== null && activeCrosshairY !== null ? (
          <>
            <line
              x1={activeCrosshairX}
              x2={activeCrosshairX}
              y1={priceTop}
              y2={showVolume ? volumeBottom : priceBottom}
              stroke={crosshairVerticalStroke}
              strokeDasharray="3 5"
            />
            <line
              x1={MAIN_PADDING_LEFT}
              x2={MAIN_PADDING_LEFT + chartWidth}
              y1={activeCrosshairY}
              y2={activeCrosshairY}
              stroke={crosshairHorizontalStroke}
              strokeDasharray="3 5"
            />
            <circle cx={activeCrosshairX} cy={activeCrosshairY} r="3.2" fill={stroke} />
          </>
        ) : null}

        {xTicks.map((tick, index) => (
          <text
            key={`x-tick-${index}`}
            x={tick.x}
            y={mainContentBottom + 16}
            textAnchor={tick.anchor}
            fill={tick.anchor === "end" && isShowingLatestEdge ? axisBoundaryLabelColor : axisLabelColor}
            fontSize="10"
            fontWeight={tick.anchor === "end" && isShowingLatestEdge ? 600 : 500}
          >
            {tick.label}
          </text>
        ))}

        <rect
          x={MAIN_PADDING_LEFT}
          y={overviewTop}
          width={chartWidth}
          height={overviewHeight}
          rx="8"
          fill={overviewBackground}
          stroke={overviewStroke}
        />
        <path
          d={overviewLinePath}
          fill="none"
          stroke={stroke}
          strokeOpacity="0.52"
          strokeWidth="1.25"
        />
        {data.length > 0 ? (
          <rect
            x={xForGlobalIndex(safeWindow.startIndex) - 3}
            y={overviewTop + 2}
            width={Math.max(10, xForGlobalIndex(safeWindow.endIndex) - xForGlobalIndex(safeWindow.startIndex) + 6)}
            height={Math.max(10, overviewHeight - 4)}
            rx="7"
            fill={overviewWindowFill}
            stroke={overviewWindowStroke}
          />
        ) : null}
      </svg>

      <div
        className="absolute inset-x-0 bottom-0 h-[34px]"
        onMouseDown={(event) => {
          overviewPointerActiveRef.current = true;
          resolveOverviewIndex(event.clientX);
        }}
        onMouseMove={(event) => {
          if (!overviewPointerActiveRef.current || event.buttons === 0) return;
          resolveOverviewIndex(event.clientX);
        }}
        onMouseUp={() => {
          overviewPointerActiveRef.current = false;
        }}
        onMouseLeave={() => {
          overviewPointerActiveRef.current = false;
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (!touch) return;
          resolveOverviewIndex(touch.clientX);
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0];
          if (!touch) return;
          resolveOverviewIndex(touch.clientX);
        }}
      />

      {activePoint ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[156px] rounded-xl border border-[hsl(var(--foreground)/0.08)] bg-[linear-gradient(180deg,hsl(var(--background)/0.96),hsl(var(--background)/0.86))] px-3 py-2.5 text-[10px] text-[hsl(var(--foreground)/0.82)] shadow-[0_24px_54px_-34px_hsl(var(--foreground)/0.55)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(8,13,22,0.96),rgba(5,9,16,0.94))] dark:text-white/82 dark:shadow-[0_28px_70px_-40px_rgba(0,0,0,0.9)]"
          style={tooltipStyle}
        >
          <div className="mb-1.5 text-[10px] font-semibold text-[hsl(var(--foreground)/0.56)]">{activePoint.fullLabel}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <span className="text-[hsl(var(--foreground)/0.42)]">Open</span>
            <span className="text-right font-medium">{formatPrice(activePoint.open)}</span>
            <span className="text-[hsl(var(--foreground)/0.42)]">High</span>
            <span className="text-right font-medium">{formatPrice(activePoint.high)}</span>
            <span className="text-[hsl(var(--foreground)/0.42)]">Low</span>
            <span className="text-right font-medium">{formatPrice(activePoint.low)}</span>
            <span className="text-[hsl(var(--foreground)/0.42)]">Close</span>
            <span className="text-right font-medium">{formatPrice(activePoint.close)}</span>
            {showVolume ? (
              <>
                <span className="text-[hsl(var(--foreground)/0.42)]">Volume</span>
                <span className="text-right font-medium">{activePoint.volume.toLocaleString()}</span>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
