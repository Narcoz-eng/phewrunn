import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { TerminalCandle, TerminalTimeframe } from "./types";

type ProCandlestickChartProps = {
  candles: TerminalCandle[];
  timeframe: TerminalTimeframe;
  symbol: string;
  priceFormatter: (value: number | null | undefined) => string;
  unavailableReason?: string | null;
};

function toChartTime(timestamp: number): UTCTimestamp {
  const seconds = timestamp > 1_000_000_000_000 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
  return seconds as UTCTimestamp;
}

export const ProCandlestickChart = memo(function ProCandlestickChart({
  candles,
  timeframe,
  symbol,
  priceFormatter,
  unavailableReason,
}: ProCandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [hoverText, setHoverText] = useState<string | null>(null);

  const candleData = useMemo(
    () =>
      candles
        .filter((candle) =>
          [candle.open, candle.high, candle.low, candle.close].every(
            (value) => typeof value === "number" && Number.isFinite(value) && value > 0
          )
        )
        .map((candle) => ({
          time: toChartTime(candle.timestamp),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        })),
    [candles]
  );

  const volumeData = useMemo(
    () =>
      candles
        .filter((candle) => typeof candle.volume === "number" && Number.isFinite(candle.volume))
        .map((candle) => ({
          time: toChartTime(candle.timestamp),
          value: Math.max(0, candle.volume),
          color: candle.close >= candle.open ? "rgba(132, 204, 22, 0.35)" : "rgba(248, 113, 113, 0.32)",
        })),
    [candles]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "rgba(2, 8, 11, 0)" },
        textColor: "rgba(255,255,255,0.56)",
        fontFamily: "Inter, ui-sans-serif, system-ui",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.045)" },
        horzLines: { color: "rgba(255,255,255,0.045)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.08)",
        scaleMargins: { top: 0.1, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: timeframe !== "1D",
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "rgba(169,255,52,0.38)", labelBackgroundColor: "#1f2937" },
        horzLine: { color: "rgba(169,255,52,0.38)", labelBackgroundColor: "#1f2937" },
      },
      localization: {
        priceFormatter: (value: number) => priceFormatter(value),
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#84cc16",
      downColor: "#ef4444",
      borderUpColor: "#a3e635",
      borderDownColor: "#fb7185",
      wickUpColor: "#a3e635",
      wickDownColor: "#fb7185",
      priceLineColor: "#a3e635",
      lastValueVisible: true,
      priceLineVisible: true,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chart.subscribeCrosshairMove((param) => {
      const candle = param.seriesData.get(candleSeries) as
        | { open?: number; high?: number; low?: number; close?: number }
        | undefined;
      if (!candle || typeof candle.close !== "number") {
        setHoverText(null);
        return;
      }
      setHoverText(
        `O ${priceFormatter(candle.open)} H ${priceFormatter(candle.high)} L ${priceFormatter(candle.low)} C ${priceFormatter(candle.close)}`
      );
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [priceFormatter, timeframe]);

  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !chartRef.current) return;
    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    if (candleData.length > 0) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candleData, volumeData]);

  if (candleData.length < 2) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-[18px] border border-dashed border-white/12 bg-black/20 px-6 text-center">
        <div className="max-w-md">
          <div className="text-sm font-semibold text-white">Candles unavailable from source</div>
          <div className="mt-2 text-xs leading-5 text-white/48">
            {unavailableReason ?? "The configured market provider did not return enough OHLCV candles for this pair."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(3,10,13,0.96),rgba(1,5,8,0.98))]">
      <div className="absolute left-4 top-4 z-10 rounded-xl border border-white/8 bg-black/55 px-3 py-2 backdrop-blur">
        <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">{symbol} / USDT</div>
        <div className="mt-1 text-xs text-white/62">{hoverText ?? `${timeframe} candles with volume`}</div>
      </div>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
});
