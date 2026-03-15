import { Loader2, Radar } from "lucide-react";
import { cn } from "@/lib/utils";

type BundleClusterLike = {
  estimatedSupplyPct?: number | null;
};

type BundleScanInput = {
  bundleRiskLabel?: string | null;
  tokenRiskScore?: number | null;
  bundledWalletCount?: number | null;
  estimatedBundledSupplyPct?: number | null;
  bundleClusters?: BundleClusterLike[] | null;
};

interface BundleScanLoopProps {
  title?: string;
  hint?: string;
  className?: string;
}

function hasPositiveFiniteNumber(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isBundleScanPending(input: BundleScanInput): boolean {
  if (typeof input.bundleRiskLabel === "string" && input.bundleRiskLabel.trim().length > 0) {
    return false;
  }

  if (hasPositiveFiniteNumber(input.tokenRiskScore)) {
    return false;
  }

  if (hasPositiveFiniteNumber(input.bundledWalletCount)) {
    return false;
  }

  if (hasPositiveFiniteNumber(input.estimatedBundledSupplyPct)) {
    return false;
  }

  if (Array.isArray(input.bundleClusters) && input.bundleClusters.length > 0) {
    return false;
  }

  return true;
}

export function BundleScanLoop({
  title = "Bundle scan live",
  hint = "Loading bundled supply and linked clusters.",
  className,
}: BundleScanLoopProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-[16px] border border-primary/20 bg-primary/8 px-3 py-2 text-left",
        className
      )}
    >
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/12">
        <span className="absolute inset-0 rounded-full border border-primary/25 animate-ping" />
        <Radar className="h-3.5 w-3.5 animate-[spin_4.8s_linear_infinite] text-primary" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>{title}</span>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
