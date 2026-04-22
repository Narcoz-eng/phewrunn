import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ShieldAlert, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { V2PageHeader } from "@/components/layout/V2PageHeader";
import { V2EmptyState } from "@/components/ui/v2/V2EmptyState";
import { V2MetricCard } from "@/components/ui/v2/V2MetricCard";
import { V2SectionHeader } from "@/components/ui/v2/V2SectionHeader";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { V2Surface } from "@/components/ui/v2/V2Surface";

type BundleCheckerToken = {
  address: string;
  symbol: string | null;
  name: string | null;
  tokenRiskScore: number | null;
  bundleRiskLabel: string | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  holderCount: number | null;
  top10HolderPct: number | null;
  largestHolderPct: number | null;
  bundleClusters: Array<{
    id?: string;
    clusterLabel: string;
    walletCount: number;
    estimatedSupplyPct: number;
  }>;
  topHolders: Array<{
    address: string;
    valueUsd: number | null;
    supplyPct: number;
    label: string | null;
  }>;
};

function formatUsd(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatCompact(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export default function BundleChecker() {
  const [address, setAddress] = useState("");
  const [submittedAddress, setSubmittedAddress] = useState("");

  const tokenQuery = useQuery<BundleCheckerToken>({
    queryKey: ["bundle-checker", submittedAddress],
    enabled: submittedAddress.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<BundleCheckerToken>(`/api/tokens/${submittedAddress}`),
  });

  const token = tokenQuery.data ?? null;
  const metrics = useMemo(
    () =>
      token
        ? [
            { label: "Risk Score", value: token.tokenRiskScore?.toFixed(0) ?? "--", hint: token.bundleRiskLabel || "Pending" },
            { label: "Bundled Wallets", value: formatCompact(token.bundledWalletCount), hint: "Detected overlap cluster" },
            { label: "Bundled Supply", value: formatPct(token.estimatedBundledSupplyPct), hint: "Estimated concentration" },
            { label: "Holders", value: formatCompact(token.holderCount), hint: `Top 10 hold ${formatPct(token.top10HolderPct)}` },
          ]
        : [],
    [token]
  );

  return (
    <div className="space-y-5">
      <V2PageHeader
        title="Bundle Checker"
        description="Wallet overlap and cluster concentration surface built on the existing token intelligence payload. Search a token address to inspect bundle pressure, holder concentration, and linked wallet clusters."
        badge={<V2StatusPill tone="risk">Risk Intel</V2StatusPill>}
        action={
          <div className="flex min-w-[280px] items-center gap-2 rounded-[20px] border border-white/10 bg-white/[0.04] p-2">
            <Input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Paste token address"
              className="border-0 bg-transparent text-white placeholder:text-white/30 focus-visible:ring-0"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setSubmittedAddress(address.trim());
                }
              }}
            />
            <Button type="button" size="sm" onClick={() => setSubmittedAddress(address.trim())}>
              <Search className="mr-2 h-4 w-4" />
              Check
            </Button>
          </div>
        }
      />

      {!submittedAddress ? (
        <V2EmptyState
          icon={<ShieldAlert className="h-7 w-7" />}
          title="Start with a token address"
          description="The current implementation derives bundle intelligence from the existing token API instead of adding a new backend contract up front."
        />
      ) : tokenQuery.isLoading ? (
        <V2Surface className="p-8">
          <div className="text-sm text-white/56">Loading bundle intelligence...</div>
        </V2Surface>
      ) : tokenQuery.isError || !token ? (
        <V2EmptyState
          icon={<ShieldAlert className="h-7 w-7" />}
          title="No bundle data found"
          description="This token could not be resolved from the current token endpoint. Verify the address and try again."
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <V2MetricCard key={metric.label} label={metric.label} value={metric.value} hint={metric.hint} />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
            <V2Surface className="p-5 sm:p-6">
              <V2SectionHeader
                eyebrow="Cluster Map"
                title={`${token.symbol ? `$${token.symbol}` : token.name || "Token"} bundle clusters`}
                description="Current cluster groups are rendered from the token bundle cluster payload already returned by the backend."
              />
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {token.bundleClusters.length > 0 ? (
                  token.bundleClusters.map((cluster) => (
                    <div
                      key={cluster.id || cluster.clusterLabel}
                      className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4"
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/42">
                        {cluster.clusterLabel}
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white">{cluster.walletCount} wallets</div>
                      <div className="mt-1 text-sm text-white/50">
                        Estimated supply overlap {formatPct(cluster.estimatedSupplyPct)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-dashed border-white/10 px-4 py-10 text-center text-sm text-white/46 sm:col-span-2">
                    No explicit bundle clusters were returned for this token yet.
                  </div>
                )}
              </div>
            </V2Surface>

            <div className="space-y-4">
              <V2Surface className="p-5">
                <V2SectionHeader
                  eyebrow="Holder Pressure"
                  title="Largest positions"
                  description={`Largest holder owns ${formatPct(token.largestHolderPct)} of supply.`}
                />
                <div className="mt-4 space-y-3">
                  {token.topHolders.slice(0, 6).map((holder) => (
                    <div
                      key={holder.address}
                      className="flex items-center justify-between gap-4 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/8 bg-white/[0.04]">
                          <Wallet className="h-4 w-4 text-white/58" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">
                            {holder.label || `${holder.address.slice(0, 4)}...${holder.address.slice(-4)}`}
                          </div>
                          <div className="text-xs text-white/42">{formatPct(holder.supplyPct)} of supply</div>
                        </div>
                      </div>
                      <div className="text-right text-sm font-medium text-white/74">
                        {formatUsd(holder.valueUsd)}
                      </div>
                    </div>
                  ))}
                </div>
              </V2Surface>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
