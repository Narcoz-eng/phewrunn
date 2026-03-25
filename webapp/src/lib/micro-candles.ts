export type MicroChartSample = {
  timestamp: number;
  value: number;
  volume?: number | null;
};

export type MicroChartCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function appendMicroChartSample(
  samples: MicroChartSample[],
  next: MicroChartSample,
  maxSamples = 360
): MicroChartSample[] {
  if (!Number.isFinite(next.timestamp) || !Number.isFinite(next.value) || next.value <= 0) {
    return samples;
  }

  const sanitizedNext: MicroChartSample = {
    timestamp: Math.round(next.timestamp),
    value: Number(next.value),
    volume: typeof next.volume === "number" && Number.isFinite(next.volume) ? next.volume : 0,
  };

  const previous = samples[samples.length - 1];
  if (
    previous &&
    sanitizedNext.timestamp <= previous.timestamp &&
    sanitizedNext.value === previous.value &&
    (sanitizedNext.volume ?? 0) === (previous.volume ?? 0)
  ) {
    return samples;
  }

  const merged =
    previous &&
    sanitizedNext.timestamp === previous.timestamp
      ? [...samples.slice(0, -1), sanitizedNext]
      : [...samples, sanitizedNext];

  return merged.length > maxSamples ? merged.slice(merged.length - maxSamples) : merged;
}

export function buildMicroChartCandles(
  samples: MicroChartSample[],
  bucketMs: number
): MicroChartCandle[] {
  if (!Number.isFinite(bucketMs) || bucketMs < 250) {
    return [];
  }

  const sortedSamples = [...samples]
    .filter((sample) => Number.isFinite(sample.timestamp) && Number.isFinite(sample.value) && sample.value > 0)
    .sort((left, right) => left.timestamp - right.timestamp);

  if (sortedSamples.length === 0) {
    return [];
  }

  const candles: MicroChartCandle[] = [];

  for (const sample of sortedSamples) {
    const bucketTimestamp = Math.floor(sample.timestamp / bucketMs) * bucketMs;
    const existing = candles[candles.length - 1];
    if (!existing || existing.timestamp !== bucketTimestamp) {
      candles.push({
        timestamp: bucketTimestamp,
        open: sample.value,
        high: sample.value,
        low: sample.value,
        close: sample.value,
        volume: Math.max(0, sample.volume ?? 0),
      });
      continue;
    }

    existing.high = Math.max(existing.high, sample.value);
    existing.low = Math.min(existing.low, sample.value);
    existing.close = sample.value;
    existing.volume += Math.max(0, sample.volume ?? 0);
  }

  return candles;
}
