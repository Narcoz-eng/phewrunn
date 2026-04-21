import type {
  ComponentProps,
  MouseEventHandler,
  RefObject,
  TouchEventHandler,
  WheelEventHandler,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CandlestickChart } from "./CandlestickChart";
import { TradeTransactionsFeed } from "./TradeTransactionsFeed";
import { TradePanelLiveBadge } from "./TradePanelLiveBadge";
import { TradingPanel } from "./TradingPanel";
import PortfolioPanel from "./PortfolioPanel";
import { TradeTerminalLayout } from "./TradeTerminalLayout";
import { Coins, ExternalLink, Loader2, Minus, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { PhewChartIcon, PhewFollowIcon, PhewTradeIcon } from "@/components/icons/PhewIcons";

type TradingPanelProps = ComponentProps<typeof TradingPanel>;
type TradeTransactionsFeedProps = ComponentProps<typeof TradeTransactionsFeed>;
type CandlestickChartProps = ComponentProps<typeof CandlestickChart>;
type PortfolioPanelProps = ComponentProps<typeof PortfolioPanel>;

type ChartIntervalOption = {
  value: string;
  label: string;
};

type TradeDialogChartContent = {
  interactionRef: RefObject<HTMLDivElement | null>;
  isMousePanning: boolean;
  onWheel: WheelEventHandler<HTMLDivElement>;
  onTouchStart: TouchEventHandler<HTMLDivElement>;
  onTouchMove: TouchEventHandler<HTMLDivElement>;
  onTouchEnd: TouchEventHandler<HTMLDivElement>;
  onTouchCancel: TouchEventHandler<HTMLDivElement>;
  onMouseDown: MouseEventHandler<HTMLDivElement>;
  onMouseMove: MouseEventHandler<HTMLDivElement>;
  onMouseUp: MouseEventHandler<HTMLDivElement>;
  onMouseLeave: MouseEventHandler<HTMLDivElement>;
  hasProfessionalChartData: boolean;
  candlestickProps: CandlestickChartProps | null;
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
};

type TradeDialogProps = {
  surfaceClassName: string;
  headerClassName: string;
  bodyClassName: string;
  footerClassName: string;
  token: {
    image: string | null;
    imageError: boolean;
    onImageError: () => void;
    label: string;
    chainType: string | null | undefined;
    contractAddress: string | null | undefined;
  };
  status: {
    label: string;
    toneClassName: string;
    isRefreshing: boolean;
    isSolanaTradeSupported: boolean;
    onClose: () => void;
  };
  chartPanel: {
    panelClassName: string;
    dividerClassName: string;
    dividerFillClassName: string;
    mutedTextClassName: string;
    mutedSubtleTextClassName: string;
    strongTextClassName: string;
    inactiveButtonClassName: string;
    inactiveToggleButtonClassName: string;
    canvasClassName: string;
    intervalOptions: readonly ChartIntervalOption[];
    selectedInterval: string;
    onSelectInterval: (value: string) => void;
    infoVisible: boolean;
    onToggleInfo: () => void;
    tradesVisible: boolean;
    onToggleTrades: () => void;
    entryMcapLabel: string;
    currentMcapLabel: string | null;
    priceLabel: string;
    deltaLabel: string | null;
    deltaToneClassName: string;
    settlementLabel: string;
    settlementToneClassName: string;
    visibleRangeLabel: string;
    rangeDetailLabel: string | null;
    onPanLeft: () => void;
    onPanRight: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onReset: () => void;
    onCenterEntry: () => void;
    canPanLeft: boolean;
    canPanRight: boolean;
    canZoomIn: boolean;
    canZoomOut: boolean;
    canCenterEntry: boolean;
    isEntryInCurrentView: boolean;
    isLikelyMobileDevice: boolean;
    controlButtonClassName: string;
    liveBadge: {
      lastEventAtMs: number;
      usingFallbackPolling: boolean;
      mode: "stream" | "fallback" | "unavailable";
    };
    quoteFreshnessLabel: string | null;
    isUsingStaleQuote: boolean;
    content: TradeDialogChartContent;
    footer: {
      feedLabel: string;
      intervalLabel: string;
      liquidityUsd: number | null;
      volume24hUsd: number | null;
      dexId: string | null;
      lastTimestampMs: number | null;
    };
  };
  transactionsProps: TradeTransactionsFeedProps;
  tradingPanelProps: TradingPanelProps;
  portfolioProps: PortfolioPanelProps;
  footer: {
    dexscreenerUrl: string | null;
    onClose: () => void;
    onAction: () => void;
    isActionDisabled: boolean;
    isExecuting: boolean;
    hasWalletSigner: boolean;
    connectWalletCtaLabel: string;
    tradeSide: "buy" | "sell";
  };
};

export function PostCardTradeDialog({
  surfaceClassName,
  headerClassName,
  bodyClassName,
  footerClassName,
  token,
  status,
  chartPanel,
  transactionsProps,
  tradingPanelProps,
  portfolioProps,
  footer,
}: TradeDialogProps) {
  const chartLastTimeLabel =
    chartPanel.footer.lastTimestampMs !== null
      ? new Date(chartPanel.footer.lastTimestampMs).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  return (
    <DialogContent
      className={surfaceClassName}
      onInteractOutside={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => event.preventDefault()}
      onEscapeKeyDown={(event) => event.preventDefault()}
    >
      <DialogHeader className={headerClassName}>
        <div className="flex items-center justify-between gap-3">
          <DialogTitle className="flex items-center gap-2.5 text-sm font-semibold text-slate-900 dark:text-white sm:text-base">
            {token.image && !token.imageError ? (
              <img
                src={token.image}
                alt={token.label}
                className="h-6 w-6 rounded-full ring-1 ring-slate-900/10 dark:ring-white/[0.1]"
                onError={token.onImageError}
              />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/[0.04] ring-1 ring-slate-900/10 dark:bg-white/[0.06] dark:ring-white/[0.1]">
                <Coins className="h-3 w-3 text-slate-500 dark:text-white/40" />
              </div>
            )}
            <span className="truncate">{token.label}</span>
            {token.chainType ? (
              <span className="rounded-md bg-slate-900/[0.04] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest text-slate-500 dark:bg-white/[0.05] dark:text-white/35">
                {token.chainType}
              </span>
            ) : null}
          </DialogTitle>
          <div className="flex items-center gap-2 shrink-0">
            <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-medium tracking-wide", status.toneClassName)}>
              {status.label}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={status.onClose}
              className="h-7 w-7 rounded-lg bg-slate-900/[0.04] p-0 text-slate-500 hover:bg-slate-900/[0.08] hover:text-slate-700 dark:bg-white/[0.04] dark:text-white/40 dark:hover:bg-white/[0.08] dark:hover:text-white/60"
            >
              <Plus className="h-3.5 w-3.5 rotate-45" />
            </Button>
          </div>
        </div>
        <DialogDescription className="sr-only">
          {status.isSolanaTradeSupported
            ? "Trade panel with live chart"
            : "Chart view - trading available for Solana posts only"}
        </DialogDescription>
      </DialogHeader>

      <div className={bodyClassName}>
        <div className="flex items-center gap-2 flex-wrap px-1">
          {token.contractAddress ? (
            <span className="max-w-[200px] truncate rounded-md bg-slate-900/[0.04] px-2 py-1 font-mono text-[10px] text-slate-500 dark:bg-white/[0.04] dark:text-white/30">
              {token.contractAddress}
            </span>
          ) : null}
          {status.isRefreshing ? (
            <span className="animate-pulse text-[10px] text-slate-400 dark:text-white/25">
              Refreshing...
            </span>
          ) : null}
        </div>

        {!status.isSolanaTradeSupported ? (
          <div className="rounded-xl border border-slate-900/[0.08] bg-white/65 p-3 text-xs text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-white/40 dark:shadow-none">
            Trading is available for Solana posts only. Chart navigation remains available.
          </div>
        ) : null}

        <TradeTerminalLayout
          left={
            <>
            <div className={chartPanel.panelClassName}>
              <div className={cn("flex items-center justify-between gap-2 border-b px-4 py-2.5", chartPanel.dividerClassName)}>
                <div className="flex items-center gap-1.5">
                  {chartPanel.intervalOptions.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => chartPanel.onSelectInterval(preset.value)}
                      className={cn(
                        "rounded-md px-2 py-1 text-[11px] font-medium transition-all duration-150",
                        chartPanel.selectedInterval === preset.value
                          ? "bg-slate-900/[0.06] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:bg-white/[0.1] dark:text-white"
                          : chartPanel.inactiveButtonClassName
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={chartPanel.onToggleInfo}
                    className={cn(
                      "rounded-md px-2 py-1 text-[10px] font-medium transition-all duration-150",
                      chartPanel.infoVisible
                        ? "bg-blue-500/10 text-blue-400"
                        : chartPanel.inactiveToggleButtonClassName
                    )}
                  >
                    Vol
                  </button>
                  <button
                    type="button"
                    onClick={chartPanel.onToggleTrades}
                    className={cn(
                      "rounded-md px-2 py-1 text-[10px] font-medium transition-all duration-150",
                      chartPanel.tradesVisible
                        ? "bg-emerald-500/10 text-emerald-400"
                        : chartPanel.inactiveToggleButtonClassName
                    )}
                  >
                    OHLC
                  </button>
                </div>
              </div>

              <div className={cn("flex items-center gap-3 overflow-x-auto border-b px-4 py-2 text-[11px]", chartPanel.dividerClassName)}>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={chartPanel.mutedTextClassName}>MCap</span>
                  <span className={cn("font-medium", chartPanel.strongTextClassName)}>
                    {chartPanel.entryMcapLabel}
                  </span>
                  {chartPanel.currentMcapLabel ? (
                    <>
                      <span className={chartPanel.mutedSubtleTextClassName}>&rarr;</span>
                      <span className={cn("font-medium", chartPanel.strongTextClassName)}>
                        {chartPanel.currentMcapLabel}
                      </span>
                    </>
                  ) : null}
                </div>
                <div className={cn("h-3 w-px shrink-0", chartPanel.dividerFillClassName)} />
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={chartPanel.mutedTextClassName}>Price</span>
                  <span className={cn("font-medium", chartPanel.strongTextClassName)}>
                    {chartPanel.priceLabel}
                  </span>
                </div>
                <div className={cn("h-3 w-px shrink-0", chartPanel.dividerFillClassName)} />
                <span className={cn("font-semibold shrink-0", chartPanel.deltaToneClassName)}>
                  {chartPanel.deltaLabel ?? "--"}
                </span>
                <div className={cn("h-3 w-px shrink-0", chartPanel.dividerFillClassName)} />
                <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium shrink-0", chartPanel.settlementToneClassName)}>
                  {chartPanel.settlementLabel}
                </span>
              </div>

              <div className={cn("flex items-center justify-between gap-2 border-b px-4 py-2", chartPanel.dividerClassName)}>
                <div className={cn("min-w-0 truncate text-[10px]", chartPanel.mutedTextClassName)}>
                  {chartPanel.visibleRangeLabel}
                  {chartPanel.rangeDetailLabel ? (
                    <span className={cn("ml-1.5", chartPanel.mutedSubtleTextClassName)}>
                      {chartPanel.rangeDetailLabel}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={chartPanel.onPanLeft}
                    disabled={!chartPanel.content.hasProfessionalChartData || !chartPanel.canPanLeft}
                    className={cn("h-7 w-7 sm:h-6 sm:w-6", chartPanel.controlButtonClassName)}
                  >
                    <ChevronLeft className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={chartPanel.onPanRight}
                    disabled={!chartPanel.content.hasProfessionalChartData || !chartPanel.canPanRight}
                    className={cn("h-7 w-7 sm:h-6 sm:w-6", chartPanel.controlButtonClassName)}
                  >
                    <ChevronRight className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                  </Button>
                  <div className={cn("mx-0.5 h-3 w-px", chartPanel.dividerFillClassName)} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={chartPanel.onZoomIn}
                    disabled={!chartPanel.content.hasProfessionalChartData || !chartPanel.canZoomIn}
                    className={cn("h-7 w-7 sm:h-6 sm:w-6", chartPanel.controlButtonClassName)}
                  >
                    <Plus className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={chartPanel.onZoomOut}
                    disabled={!chartPanel.content.hasProfessionalChartData || !chartPanel.canZoomOut}
                    className={cn("h-7 w-7 sm:h-6 sm:w-6", chartPanel.controlButtonClassName)}
                  >
                    <Minus className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                  </Button>
                  <div className={cn("mx-0.5 h-3 w-px", chartPanel.dividerFillClassName)} />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={chartPanel.onReset}
                    disabled={!chartPanel.content.hasProfessionalChartData}
                    className={cn("h-7 px-2 text-[10px] sm:h-6 sm:px-1.5", chartPanel.controlButtonClassName)}
                  >
                    Reset
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={chartPanel.onCenterEntry}
                    disabled={!chartPanel.content.hasProfessionalChartData || !chartPanel.canCenterEntry}
                    className={cn(
                      "h-7 px-2 text-[10px] sm:h-6 sm:px-1.5 hover:bg-slate-900/[0.05] dark:hover:bg-white/[0.06] disabled:opacity-30",
                      chartPanel.isEntryInCurrentView
                        ? "text-blue-400"
                        : "text-slate-500 hover:text-slate-800 dark:text-white/30 dark:hover:text-white/60"
                    )}
                  >
                    Entry
                  </Button>
                </div>
              </div>

              {chartPanel.isLikelyMobileDevice ? (
                <div className="mt-1 text-[10px] text-slate-400 dark:text-white/28">
                  Pinch to zoom. Drag sideways to pan.
                </div>
              ) : null}

              <div
                ref={chartPanel.content.interactionRef}
                className={cn(
                  chartPanel.canvasClassName,
                  chartPanel.content.hasProfessionalChartData
                    ? chartPanel.content.isMousePanning
                      ? "cursor-grabbing"
                      : "cursor-grab"
                    : "cursor-default"
                )}
                onWheel={chartPanel.content.onWheel}
                onTouchStart={chartPanel.content.onTouchStart}
                onTouchMove={chartPanel.content.onTouchMove}
                onTouchEnd={chartPanel.content.onTouchEnd}
                onTouchCancel={chartPanel.content.onTouchCancel}
                onMouseDown={chartPanel.content.onMouseDown}
                onMouseMove={chartPanel.content.onMouseMove}
                onMouseUp={chartPanel.content.onMouseUp}
                onMouseLeave={chartPanel.content.onMouseLeave}
                style={{
                  touchAction: chartPanel.content.hasProfessionalChartData ? "none" : "auto",
                  userSelect: chartPanel.content.isMousePanning ? "none" : "auto",
                  willChange: chartPanel.content.hasProfessionalChartData ? "transform" : "auto",
                }}
              >
                <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-1.5">
                  <TradePanelLiveBadge
                    lastEventAtMs={chartPanel.liveBadge.lastEventAtMs}
                    usingFallbackPolling={chartPanel.liveBadge.usingFallbackPolling}
                    mode={chartPanel.liveBadge.mode}
                  />
                  {chartPanel.isUsingStaleQuote && chartPanel.quoteFreshnessLabel ? (
                    <span className="inline-flex items-center rounded-full bg-slate-900/[0.05] px-1.5 py-0.5 text-[9px] font-medium text-slate-500 dark:bg-white/[0.06] dark:text-white/42">
                      {chartPanel.quoteFreshnessLabel}
                    </span>
                  ) : null}
                </div>
                {chartPanel.content.hasProfessionalChartData && chartPanel.content.candlestickProps ? (
                  <CandlestickChart {...chartPanel.content.candlestickProps} />
                ) : chartPanel.content.isLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-white/20" />
                      <span className="text-[11px] text-slate-500 dark:text-white/25">
                        Loading chart data...
                      </span>
                    </div>
                  </div>
                ) : chartPanel.content.hasError ? (
                  <div className="flex h-full items-center justify-center p-6 text-center">
                    <div className="space-y-2">
                      <PhewChartIcon className="mx-auto h-6 w-6 text-slate-400 dark:text-white/15" />
                      <p className="text-[11px] text-slate-500 dark:text-white/25">
                        Chart feed unavailable. Try a different interval.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={chartPanel.content.onRetry}
                        className="h-7 border-slate-900/10 bg-white/70 px-3 text-[10px] text-slate-700 hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:text-white/70 dark:hover:bg-white/[0.06]"
                      >
                        Retry
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-center">
                    <div className="space-y-2">
                      <PhewChartIcon className="mx-auto h-6 w-6 text-slate-400 dark:text-white/15" />
                      <p className="text-[11px] text-slate-500 dark:text-white/25">
                        Candle data not yet available for this token.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className={cn("flex items-center justify-between border-t px-4 py-2 text-[10px] text-slate-500 dark:text-white/25", chartPanel.dividerClassName)}>
                <div className="flex items-center gap-3">
                  {chartPanel.content.hasProfessionalChartData ? (
                    <span>
                      {chartPanel.footer.feedLabel} {chartPanel.footer.intervalLabel}
                    </span>
                  ) : null}
                  {chartPanel.footer.liquidityUsd != null ? (
                    <span>Liq ${chartPanel.footer.liquidityUsd.toLocaleString()}</span>
                  ) : null}
                  {chartPanel.footer.volume24hUsd != null ? (
                    <span>24h Vol ${chartPanel.footer.volume24hUsd.toLocaleString()}</span>
                  ) : null}
                  {chartPanel.footer.dexId ? <span>{chartPanel.footer.dexId}</span> : null}
                </div>
                {chartLastTimeLabel ? <span>{chartLastTimeLabel}</span> : null}
              </div>
            </div>

            <TradeTransactionsFeed {...transactionsProps} />
            </>
          }
          right={
            <>
              <TradingPanel {...tradingPanelProps} />
              <PortfolioPanel {...portfolioProps} />
            </>
          }
        />
      </div>

      <DialogFooter className={footerClassName}>
        <div className="flex items-center gap-2">
          {footer.dexscreenerUrl ? (
            <a
              href={footer.dexscreenerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-slate-500 transition-colors hover:text-slate-700 dark:text-white/25 dark:hover:text-white/50"
            >
              DexScreener
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={footer.onClose}
            className="h-8 px-3 text-[11px] text-slate-500 hover:bg-slate-900/[0.04] hover:text-slate-700 dark:text-white/40 dark:hover:bg-white/[0.04] dark:hover:text-white/60"
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={footer.onAction}
            disabled={footer.isActionDisabled}
            className={cn(
              "h-8 px-4 text-[11px] font-semibold rounded-lg transition-all duration-200",
              footer.hasWalletSigner
                ? footer.tradeSide === "buy"
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                  : "bg-rose-600 hover:bg-rose-500 text-white"
                : "bg-white/[0.08] hover:bg-white/[0.12] text-white"
            )}
          >
            {footer.isExecuting ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : footer.hasWalletSigner ? (
              <PhewTradeIcon className="mr-1.5 h-3 w-3" />
            ) : (
              <PhewFollowIcon className="mr-1.5 h-3 w-3" />
            )}
            {footer.hasWalletSigner
              ? footer.tradeSide === "buy"
                ? "Buy"
                : "Sell"
              : footer.connectWalletCtaLabel}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
