function canUsePerformanceApi(): boolean {
  return typeof window !== "undefined" && typeof window.performance !== "undefined";
}

export function startPerfMeasure(name: string): () => void {
  if (!canUsePerformanceApi()) {
    return () => undefined;
  }

  const startMark = `${name}:start:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const endMark = `${name}:end:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  try {
    window.performance.mark(startMark);
  } catch {
    return () => undefined;
  }

  return () => {
    try {
      window.performance.mark(endMark);
      window.performance.measure(name, startMark, endMark);
      window.performance.clearMarks(startMark);
      window.performance.clearMarks(endMark);
    } catch {
      // Ignore browser support quirks.
    }
  };
}
