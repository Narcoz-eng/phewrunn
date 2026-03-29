export type LiveTradeSample = {
  timestamp: number;
  priceUsd: number;
  volume24hUsd?: number | null;
  tradeCount24h?: number | null;
};

export type StreamingChartCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundCents(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

export function getChartBucketMs(
  timeframe: "minute" | "hour" | "day",
  aggregate: number
): number {
  const normalizedAggregate = Math.max(1, Math.round(aggregate));
  if (timeframe === "day") {
    return normalizedAggregate * 86_400_000;
  }
  if (timeframe === "hour") {
    return normalizedAggregate * 3_600_000;
  }
  return normalizedAggregate * 60_000;
}

export function appendLiveTradeSample(
  samples: LiveTradeSample[],
  next: LiveTradeSample,
  maxSamples = 720
): LiveTradeSample[] {
  if (!isFiniteNumber(next.timestamp) || !isFiniteNumber(next.priceUsd) || next.priceUsd <= 0) {
    return samples;
  }

  const sanitized: LiveTradeSample = {
    timestamp: Math.round(next.timestamp),
    priceUsd: roundCents(next.priceUsd),
    volume24hUsd: isFiniteNumber(next.volume24hUsd) ? Math.max(0, next.volume24hUsd) : null,
    tradeCount24h: isFiniteNumber(next.tradeCount24h) ? Math.max(0, next.tradeCount24h) : null,
  };

  const previous = samples[samples.length - 1];
  if (
    previous &&
    sanitized.timestamp <= previous.timestamp &&
    sanitized.priceUsd === previous.priceUsd &&
    (sanitized.volume24hUsd ?? null) === (previous.volume24hUsd ?? null) &&
    (sanitized.tradeCount24h ?? null) === (previous.tradeCount24h ?? null)
  ) {
    return samples;
  }

  const merged =
    previous && sanitized.timestamp === previous.timestamp
      ? [...samples.slice(0, -1), sanitized]
      : [...samples, sanitized];

  return merged.length > maxSamples ? merged.slice(merged.length - maxSamples) : merged;
}

function normalizeCandleTimestamp(timestamp: number): number {
  return timestamp > 10_000_000_000 ? Math.round(timestamp) : Math.round(timestamp * 1000);
}

function computeVolumeDelta(
  current: LiveTradeSample,
  previous: LiveTradeSample | null
): number {
  const currentVolume = isFiniteNumber(current.volume24hUsd) ? current.volume24hUsd : null;
  const previousVolume = previous && isFiniteNumber(previous.volume24hUsd) ? previous.volume24hUsd : null;
  if (currentVolume === null || previousVolume === null) {
    return 0;
  }

  const delta = currentVolume - previousVolume;
  return delta > 0 ? delta : 0;
}

export function mergeLiveSamplesIntoCandles(
  candles: StreamingChartCandle[],
  samples: LiveTradeSample[],
  bucketMs: number
): StreamingChartCandle[] {
  if (!isFiniteNumber(bucketMs) || bucketMs < 1_000) {
    return candles;
  }

  const normalizedCandles = [...candles]
    .map((candle) => ({
      ...candle,
      timestamp: normalizeCandleTimestamp(candle.timestamp),
      open: roundCents(candle.open),
      high: roundCents(candle.high),
      low: roundCents(candle.low),
      close: roundCents(candle.close),
      volume: isFiniteNumber(candle.volume) ? Math.max(0, candle.volume) : 0,
    }))
    .sort((left, right) => left.timestamp - right.timestamp);

  if (samples.length === 0) {
    return normalizedCandles;
  }

  const candlesByTimestamp = new Map<number, StreamingChartCandle>();
  for (const candle of normalizedCandles) {
    candlesByTimestamp.set(candle.timestamp, { ...candle });
  }

  const orderedSamples = [...samples]
    .filter((sample) => isFiniteNumber(sample.timestamp) && isFiniteNumber(sample.priceUsd) && sample.priceUsd > 0)
    .sort((left, right) => left.timestamp - right.timestamp);

  let previousSample: LiveTradeSample | null = null;
  for (const sample of orderedSamples) {
    const bucketTimestamp = Math.floor(sample.timestamp / bucketMs) * bucketMs;
    const existing = candlesByTimestamp.get(bucketTimestamp);
    const previousCandle = normalizedCandles[normalizedCandles.length - 1] ?? null;
    const volumeDelta = computeVolumeDelta(sample, previousSample);

    if (existing) {
      existing.high = roundCents(Math.max(existing.high, sample.priceUsd));
      existing.low = roundCents(Math.min(existing.low, sample.priceUsd));
      existing.close = roundCents(sample.priceUsd);
      existing.volume = roundCents(existing.volume + volumeDelta);
    } else {
      const referenceClose =
        normalizedCandles[normalizedCandles.length - 1]?.close ??
        previousSample?.priceUsd ??
        sample.priceUsd;
      const created: StreamingChartCandle = {
        timestamp: bucketTimestamp,
        open: roundCents(referenceClose),
        high: roundCents(Math.max(referenceClose, sample.priceUsd)),
        low: roundCents(Math.min(referenceClose, sample.priceUsd)),
        close: roundCents(sample.priceUsd),
        volume: roundCents(volumeDelta),
      };
      normalizedCandles.push(created);
      normalizedCandles.sort((left, right) => left.timestamp - right.timestamp);
      candlesByTimestamp.set(bucketTimestamp, created);
    }

    if (
      previousCandle &&
      bucketTimestamp === previousCandle.timestamp &&
      volumeDelta > 0 &&
      previousCandle.volume < volumeDelta
    ) {
      previousCandle.volume = roundCents(volumeDelta);
    }

    previousSample = sample;
  }

  return normalizedCandles.sort((left, right) => left.timestamp - right.timestamp);
}
