type BundleClusterLike = {
  estimatedSupplyPct?: number | null;
};

export type BundleSignalLike = {
  bundleRiskLabel?: string | null;
  bundleScanCompletedAt?: string | null;
  bundledWalletCount?: number | null;
  estimatedBundledSupplyPct?: number | null;
  bundleClusters?: BundleClusterLike[] | null;
};

function hasPositiveFiniteNumber(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundBundleMetric(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function normalizeBundleRiskLabel(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function deriveBundledSupplyPctFromClusters(
  bundleClusters: BundleClusterLike[] | null | undefined
): number | null {
  if (!Array.isArray(bundleClusters) || bundleClusters.length === 0) {
    return null;
  }

  const total = bundleClusters.reduce((sum, cluster) => {
    return sum + (hasPositiveFiniteNumber(cluster.estimatedSupplyPct) ? cluster.estimatedSupplyPct : 0);
  }, 0);

  return total > 0 ? roundBundleMetric(total) : null;
}

export function resolveEstimatedBundledSupplyPct(input: BundleSignalLike): number | null {
  const directMetric = roundBundleMetric(input.estimatedBundledSupplyPct);
  const derivedMetric = deriveBundledSupplyPctFromClusters(input.bundleClusters);

  if (derivedMetric !== null) {
    return derivedMetric;
  }

  return directMetric;
}

export function hasResolvedBundleEvidence(input: BundleSignalLike): boolean {
  if (typeof input.bundleScanCompletedAt === "string" && input.bundleScanCompletedAt.trim().length > 0) {
    return true;
  }

  if (
    Array.isArray(input.bundleClusters) &&
    input.bundleClusters.some((cluster) => hasPositiveFiniteNumber(cluster.estimatedSupplyPct))
  ) {
    return true;
  }

  if (hasPositiveFiniteNumber(input.bundledWalletCount)) {
    return true;
  }

  if (hasPositiveFiniteNumber(resolveEstimatedBundledSupplyPct(input))) {
    return true;
  }

  const normalizedLabel = normalizeBundleRiskLabel(input.bundleRiskLabel);
  return normalizedLabel.length > 0 && normalizedLabel !== "unknown";
}

export function isBundlePlaceholderState(input: BundleSignalLike): boolean {
  return !hasResolvedBundleEvidence(input);
}
