import { formatMarketCap } from "@/types";
import { CandlestickChart, type CandlestickChartPoint } from "@/components/feed/CandlestickChart";
import {
  Area,
  AreaChart,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TokenTelemetryPoint = {
  ts: number;
  marketCap: number | null;
  confidenceScore: number | null;
};

type TokenTelemetryChartsProps = {
  hasLiveChartTelemetry: boolean;
  hasChartTelemetry: boolean;
  displayLiveChartData: CandlestickChartPoint[];
  liveChartWindow: { startIndex: number; endIndex: number };
  liveChartFutureSlotCount: number;
  chartData: TokenTelemetryPoint[];
  chartDataPointCount: number;
  formatTokenPrice: (value: number) => string;
  formatLiveTick: (timestampMs: number) => string;
  formatTimelineTick: (timestampMs: number) => string;
  formatTimelineTooltip: (timestampMs: number) => string;
};

export default function TokenTelemetryCharts({
  hasLiveChartTelemetry,
  hasChartTelemetry,
  displayLiveChartData,
  liveChartWindow,
  liveChartFutureSlotCount,
  chartData,
  chartDataPointCount,
  formatTokenPrice,
  formatLiveTick,
  formatTimelineTick,
  formatTimelineTooltip,
}: TokenTelemetryChartsProps) {
  return (
    <>
      <div className="h-[340px] w-full">
        {hasLiveChartTelemetry ? (
          <div className="h-full rounded-[24px] border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] p-3 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.01))]">
            <CandlestickChart
              data={displayLiveChartData}
              visibleStartIndex={liveChartWindow.startIndex}
              visibleEndIndex={liveChartWindow.endIndex}
              futureSlotCount={liveChartFutureSlotCount}
              showVolume
              showCandles
              stroke="hsl(var(--primary))"
              fill="hsla(var(--primary), 0.22)"
              formatPrice={formatTokenPrice}
              formatTick={formatLiveTick}
              className="h-full"
            />
          </div>
        ) : hasChartTelemetry ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="tokenChartFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tick={{ fontSize: 11 }}
                minTickGap={24}
                tickFormatter={formatTimelineTick}
              />
              <YAxis
                yAxisId="marketCap"
                tickFormatter={(value) => formatMarketCap(Number(value))}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                yAxisId="confidence"
                orientation="right"
                domain={[0, 100]}
                tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                labelFormatter={(value) => formatTimelineTooltip(Number(value))}
                formatter={(value: number | null, name: string) => {
                  if (name === "marketCap") return [formatMarketCap(value), "Market Cap"];
                  if (name === "confidenceScore") {
                    return [`${Number(value ?? 0).toFixed(0)}%`, "Confidence"];
                  }
                  return [value ?? "N/A", name];
                }}
              />
              <Area
                yAxisId="marketCap"
                type="monotone"
                dataKey="marketCap"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#tokenChartFill)"
              />
              <Line
                yAxisId="confidence"
                type="monotone"
                dataKey="confidenceScore"
                stroke="hsl(var(--accent))"
                strokeWidth={1.6}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : null}
      </div>

      {hasChartTelemetry ? (
        <div className="rounded-[24px] border border-border/60 bg-white/50 p-4 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.68)] dark:bg-white/[0.03] dark:shadow-none">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">
                Confidence + market cap timeline
              </div>
              <div className="text-xs text-muted-foreground">
                Snapshot intelligence history for conviction and market structure.
              </div>
            </div>
            <div className="rounded-full border border-border/60 bg-secondary px-3 py-1 text-[11px] text-muted-foreground">
              {chartDataPointCount} points
            </div>
          </div>
          <div className="h-[168px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <defs>
                  <linearGradient id="tokenChartFillSecondary" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.26} />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tick={{ fontSize: 10 }}
                  minTickGap={24}
                  tickFormatter={formatTimelineTick}
                />
                <YAxis
                  yAxisId="marketCap"
                  tickFormatter={(value) => formatMarketCap(Number(value))}
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  yAxisId="confidence"
                  orientation="right"
                  domain={[0, 100]}
                  tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip
                  labelFormatter={(value) => formatTimelineTooltip(Number(value))}
                  formatter={(value: number | null, name: string) => {
                    if (name === "marketCap") return [formatMarketCap(value), "Market Cap"];
                    if (name === "confidenceScore") {
                      return [`${Number(value ?? 0).toFixed(0)}%`, "Confidence"];
                    }
                    return [value ?? "N/A", name];
                  }}
                />
                <Area
                  yAxisId="marketCap"
                  type="monotone"
                  dataKey="marketCap"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#tokenChartFillSecondary)"
                />
                <Line
                  yAxisId="confidence"
                  type="monotone"
                  dataKey="confidenceScore"
                  stroke="hsl(var(--accent))"
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                />
                <Brush
                  dataKey="ts"
                  height={18}
                  stroke="hsl(var(--primary))"
                  travellerWidth={10}
                  tickFormatter={formatTimelineTick}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
    </>
  );
}
