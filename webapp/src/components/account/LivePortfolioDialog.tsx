import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, Loader2, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PortfolioPanel, { type PortfolioPosition } from "@/components/feed/PortfolioPanel";

const LIVE_PORTFOLIO_REFRESH_MS = 10_000;

type PortfolioPayload = {
  positions: PortfolioPosition[];
  totalUnrealizedPnl: number | null;
};

type LivePortfolioDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletAddress?: string | null;
  title?: string;
  description?: string;
};

function truncateAddress(value: string): string {
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function LivePortfolioDialog({
  open,
  onOpenChange,
  walletAddress,
  title = "Live portfolio",
  description = "Track live positions, unrealized PnL, and jump straight into the trade panel for exits or management.",
}: LivePortfolioDialogProps) {
  const navigate = useNavigate();
  const portfolioQuery = useQuery({
    queryKey: ["livePortfolio", walletAddress ?? "no-wallet"],
    enabled: open && Boolean(walletAddress),
    staleTime: 5_000,
    gcTime: 5 * 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    refetchInterval: open && walletAddress ? LIVE_PORTFOLIO_REFRESH_MS : false,
    retry: 1,
    queryFn: async (): Promise<PortfolioPayload> => {
      if (!walletAddress) {
        return { positions: [], totalUnrealizedPnl: null };
      }

      const response = await api.raw("/api/posts/portfolio", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          tokenMints: [],
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message || "Failed to load live portfolio");
      }

      const payload = (await response.json().catch(() => null)) as
        | { data?: PortfolioPayload | null }
        | null;
      const data = payload?.data;
      return {
        positions: Array.isArray(data?.positions) ? data.positions : [],
        totalUnrealizedPnl:
          typeof data?.totalUnrealizedPnl === "number" && Number.isFinite(data.totalUnrealizedPnl)
            ? data.totalUnrealizedPnl
            : null,
      };
    },
  });

  const positions = useMemo(
    () => portfolioQuery.data?.positions ?? [],
    [portfolioQuery.data?.positions]
  );
  const totalUnrealizedPnl = portfolioQuery.data?.totalUnrealizedPnl ?? null;
  const totalExposure = useMemo(
    () =>
      positions.reduce((sum, position) => {
        const currentValue =
          typeof position.currentPrice === "number" && Number.isFinite(position.currentPrice)
            ? position.currentPrice * position.balance
            : 0;
        return sum + currentValue;
      }, 0),
    [positions]
  );

  const handleManagePosition = (mint: string) => {
    onOpenChange(false);
    navigate(`/token/${mint}?trade=1`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px] border-border/60 bg-background/95 p-0 backdrop-blur-xl">
        <DialogHeader className="border-b border-border/60 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-left text-xl">
            <Activity className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-left">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          {walletAddress ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[18px] border border-border/60 bg-secondary px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Wallet</div>
                <div className="mt-2 font-mono text-sm text-foreground">{truncateAddress(walletAddress)}</div>
              </div>
              <div className="rounded-[18px] border border-border/60 bg-secondary px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Open positions</div>
                <div className="mt-2 text-lg font-semibold text-foreground">{positions.length}</div>
              </div>
              <div className="rounded-[18px] border border-border/60 bg-secondary px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Live exposure</div>
                <div className="mt-2 text-lg font-semibold text-foreground">{formatUsd(totalExposure)}</div>
              </div>
            </div>
          ) : (
            <div className="rounded-[20px] border border-dashed border-border/60 bg-secondary/60 px-5 py-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-background/60">
                <Wallet className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="mt-3 text-base font-semibold text-foreground">Link a wallet to open live portfolio</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Once a wallet is linked, this panel will update positions and unrealized PnL in real time.
              </p>
            </div>
          )}

          <PortfolioPanel
            positions={positions}
            isLoading={portfolioQuery.isLoading || (portfolioQuery.isFetching && portfolioQuery.data === undefined)}
            totalUnrealizedPnl={totalUnrealizedPnl}
            walletConnected={Boolean(walletAddress)}
            actionMode="always"
            actionLabel="Manage"
            actionTone="neutral"
            onQuickSell={handleManagePosition}
          />

          {walletAddress ? (
            <div className="flex flex-col gap-3 rounded-[18px] border border-border/60 bg-secondary/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">Live PnL refresh</div>
                <div className="text-xs text-muted-foreground">
                  Refreshes every {Math.round(LIVE_PORTFOLIO_REFRESH_MS / 1000)} seconds while open.
                </div>
              </div>
              <div className="flex items-center gap-2">
                {portfolioQuery.isFetching ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Syncing
                  </span>
                ) : null}
                <Button variant="outline" onClick={() => void portfolioQuery.refetch()}>
                  Refresh now
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
