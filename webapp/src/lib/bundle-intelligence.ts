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

function normalizeBundleRiskLabel(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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

  if (hasPositiveFiniteNumber(input.estimatedBundledSupplyPct)) {
    return true;
  }

  const normalizedLabel = normalizeBundleRiskLabel(input.bundleRiskLabel);
  return normalizedLabel.length > 0 && normalizedLabel !== "clean" && normalizedLabel !== "unknown";
}

export function isBundlePlaceholderState(input: BundleSignalLike): boolean {
  return !hasResolvedBundleEvidence(input);
}
