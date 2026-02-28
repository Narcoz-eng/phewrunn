import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

type WindowVirtualListProps<T> = {
  items: T[];
  getItemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  estimateItemHeight: number;
  overscanPx?: number;
  className?: string;
  itemClassName?: string;
  emptyState?: ReactNode;
  minItemsToVirtualize?: number;
};

type ViewportState = {
  scrollTop: number;
  height: number;
  containerTop: number;
};

function getPinnedItemKeyFromDocument(): string | null {
  if (typeof document === "undefined") return null;
  const value = document.body?.dataset?.phewPinnedItemKey?.trim();
  return value ? value : null;
}

function getWindowScrollTop(): number {
  if (typeof window === "undefined") return 0;
  return window.scrollY || window.pageYOffset || 0;
}

function isDocumentScrollLocked(): boolean {
  if (typeof document === "undefined") return false;
  if (
    document.body.classList.contains("overflow-hidden") ||
    document.documentElement.classList.contains("overflow-hidden") ||
    document.body.classList.contains("wallet-adapter-modal-open") ||
    document.body.classList.contains("phew-overlay-open")
  ) {
    return true;
  }
  return document.body.style.overflow === "hidden" || document.documentElement.style.overflow === "hidden";
}

export function WindowVirtualList<T>({
  items,
  getItemKey,
  renderItem,
  estimateItemHeight,
  overscanPx = 800,
  className,
  itemClassName,
  emptyState = null,
  minItemsToVirtualize = 32,
}: WindowVirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemHeightsRef = useRef(new Map<string, number>());
  const [measureVersion, setMeasureVersion] = useState(0);
  const [viewport, setViewport] = useState<ViewportState>({
    scrollTop: getWindowScrollTop(),
    height: typeof window !== "undefined" ? window.innerHeight : 0,
    containerTop: 0,
  });
  const [pinnedItemKey, setPinnedItemKey] = useState<string | null>(() => getPinnedItemKeyFromDocument());
  const lastUnlockedViewportRef = useRef<ViewportState>(viewport);

  useEffect(() => {
    const validKeys = new Set(items.map((item, index) => getItemKey(item, index)));
    let changed = false;
    for (const key of itemHeightsRef.current.keys()) {
      if (!validKeys.has(key)) {
        itemHeightsRef.current.delete(key);
        changed = true;
      }
    }
    if (changed) {
      setMeasureVersion((v) => v + 1);
    }
  }, [getItemKey, items]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let rafId = 0;
    const measureViewport = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        if (isDocumentScrollLocked()) {
          const frozen = lastUnlockedViewportRef.current;
          setViewport((prev) => {
            if (
              prev.scrollTop === frozen.scrollTop &&
              prev.height === frozen.height &&
              prev.containerTop === frozen.containerTop
            ) {
              return prev;
            }
            return frozen;
          });
          return;
        }
        const node = containerRef.current;
        const rect = node?.getBoundingClientRect();
        const nextViewport = {
          scrollTop: getWindowScrollTop(),
          height: window.innerHeight,
          containerTop: rect ? rect.top + getWindowScrollTop() : 0,
        };
        lastUnlockedViewportRef.current = nextViewport;
        setViewport(nextViewport);
      });
    };

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => measureViewport())
        : null;

    if (containerRef.current && resizeObserver) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener("scroll", measureViewport, { passive: true });
    window.addEventListener("resize", measureViewport);
    measureViewport();

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", measureViewport);
      window.removeEventListener("resize", measureViewport);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const syncPinnedItem = () => {
      const next = getPinnedItemKeyFromDocument();
      setPinnedItemKey((prev) => (prev === next ? prev : next));
    };

    syncPinnedItem();

    const observer = new MutationObserver(() => {
      syncPinnedItem();
    });
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["data-phew-pinned-item-key"],
      });
    }

    const onVisibilityChange = () => syncPinnedItem();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const layout = useMemo(() => {
    // Version tick is intentionally used to recompute layout after row height measurements.
    void measureVersion;
    if (items.length === 0) {
      return {
        totalHeight: 0,
        startIndex: 0,
        endIndex: -1,
        offsets: [] as number[],
        heights: [] as number[],
      };
    }

    const offsets: number[] = new Array(items.length);
    const heights: number[] = new Array(items.length);
    let running = 0;

    for (let i = 0; i < items.length; i += 1) {
      const key = getItemKey(items[i], i);
      const measured = itemHeightsRef.current.get(key);
      const size = measured && measured > 0 ? measured : estimateItemHeight;
      offsets[i] = running;
      heights[i] = size;
      running += size;
    }

    const relativeViewportTop = viewport.scrollTop - viewport.containerTop;
    const visibleTop = Math.max(0, relativeViewportTop - overscanPx);
    const visibleBottom = Math.max(
      visibleTop,
      relativeViewportTop + viewport.height + overscanPx
    );

    let startIndex = 0;
    while (
      startIndex < items.length &&
      offsets[startIndex] + heights[startIndex] < visibleTop
    ) {
      startIndex += 1;
    }

    if (startIndex >= items.length) {
      startIndex = items.length - 1;
    }

    let endIndex = Math.max(startIndex, 0);
    while (endIndex < items.length && offsets[endIndex] < visibleBottom) {
      endIndex += 1;
    }
    endIndex = Math.min(items.length - 1, Math.max(startIndex, endIndex));

    if (pinnedItemKey) {
      for (let i = 0; i < items.length; i += 1) {
        if (getItemKey(items[i], i) === pinnedItemKey) {
          startIndex = Math.min(startIndex, i);
          endIndex = Math.max(endIndex, i);
          break;
        }
      }
    }

    return {
      totalHeight: running,
      startIndex,
      endIndex,
      offsets,
      heights,
    };
  }, [
    estimateItemHeight,
    getItemKey,
    items,
    measureVersion,
    overscanPx,
    pinnedItemKey,
    viewport.containerTop,
    viewport.height,
    viewport.scrollTop,
  ]);

  const setMeasuredNode = (key: string) => (node: HTMLDivElement | null) => {
    if (!node) return;
    const nextHeight = Math.ceil(node.getBoundingClientRect().height);
    if (nextHeight <= 0) return;
    const prevHeight = itemHeightsRef.current.get(key);
    if (prevHeight !== nextHeight) {
      itemHeightsRef.current.set(key, nextHeight);
      setMeasureVersion((v) => v + 1);
    }
  };

  if (items.length === 0) {
    return <>{emptyState}</>;
  }

  if (items.length < minItemsToVirtualize) {
    return (
      <div ref={containerRef} className={className} style={{ position: "relative" }}>
        {items.map((item, index) => {
          const key = getItemKey(item, index);
          return (
            <div key={key} className={itemClassName}>
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    );
  }

  const topSpacer = layout.startIndex > 0 ? layout.offsets[layout.startIndex] : 0;
  const bottomSpacer =
    layout.endIndex >= 0
      ? Math.max(
          0,
          layout.totalHeight -
            (layout.offsets[layout.endIndex] + layout.heights[layout.endIndex])
        )
      : 0;

  const wrapperStyle: CSSProperties = { position: "relative" };
  const itemOptimizationStyle = (height: number) =>
    ({
      contentVisibility: "auto",
      containIntrinsicSize: `${height}px`,
    }) as CSSProperties;

  return (
    <div ref={containerRef} className={className} style={wrapperStyle}>
      {topSpacer > 0 ? <div style={{ height: topSpacer }} aria-hidden="true" /> : null}

      {items.slice(layout.startIndex, layout.endIndex + 1).map((item, localIndex) => {
        const index = layout.startIndex + localIndex;
        const key = getItemKey(item, index);
        return (
          <div
            key={key}
            ref={setMeasuredNode(key)}
            className={itemClassName}
            style={itemOptimizationStyle(estimateItemHeight)}
          >
            {renderItem(item, index)}
          </div>
        );
      })}

      {bottomSpacer > 0 ? <div style={{ height: bottomSpacer }} aria-hidden="true" /> : null}
    </div>
  );
}

export default WindowVirtualList;
