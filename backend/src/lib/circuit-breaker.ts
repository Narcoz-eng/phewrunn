/**
 * Circuit Breaker
 *
 * Protects against cascading failures from flaky external APIs.
 * When an API fails repeatedly, the circuit OPENS and requests fail
 * immediately (no waiting for a timeout), then automatically retries
 * after a cooldown.
 *
 * States:
 *   CLOSED   → Normal operation, requests go through
 *   OPEN     → Requests fail immediately (no HTTP call), saves timeout latency
 *   HALF-OPEN → One test request allowed through after cooldown
 */

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number; // Consecutive/windowed failures before opening (default: 3)
  windowMs?: number;         // Window to count failures in (default: 60_000)
  openDurationMs?: number;   // How long to stay OPEN before testing (default: 30_000)
}

interface CircuitStats {
  state: CircuitState;
  failures: number;
  openedAt: number | null;
  totalTripped: number;
}

class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private lastFailureAt = 0;
  private openedAt: number | null = null;
  private totalTripped = 0;

  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly openDurationMs: number;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.windowMs = options.windowMs ?? 60_000;
    this.openDurationMs = options.openDurationMs ?? 30_000;
  }

  /** Returns true if requests should be blocked right now */
  isOpen(): boolean {
    this.maybeTransitionHalfOpen();
    return this.state === "open";
  }

  /** Call after a successful HTTP response */
  recordSuccess(): void {
    if (this.state === "half-open") {
      console.log(`[CircuitBreaker:${this.name}] Closed — service recovered`);
      this.state = "closed";
      this.failures = 0;
      this.openedAt = null;
    } else if (this.state === "closed") {
      // Reset failure count on success within window
      this.failures = 0;
    }
  }

  /**
   * Call after a real HTTP failure (5xx, network error, timeout).
   * Do NOT call for 404 (no data) or 429 (rate limit).
   */
  recordFailure(): void {
    const now = Date.now();

    // Reset window if last failure was outside the tracking window
    if (this.lastFailureAt > 0 && now - this.lastFailureAt > this.windowMs) {
      this.failures = 0;
    }

    this.failures++;
    this.lastFailureAt = now;

    if (
      this.state === "half-open" ||
      (this.state === "closed" && this.failures >= this.failureThreshold)
    ) {
      this.state = "open";
      this.openedAt = now;
      this.totalTripped++;
      console.warn(
        `[CircuitBreaker:${this.name}] OPENED after ${this.failures} failures (trip #${this.totalTripped}) — blocking requests for ${this.openDurationMs / 1000}s`
      );
    }
  }

  getStats(): CircuitStats {
    this.maybeTransitionHalfOpen();
    return {
      state: this.state,
      failures: this.failures,
      openedAt: this.openedAt,
      totalTripped: this.totalTripped,
    };
  }

  private maybeTransitionHalfOpen(): void {
    if (this.state === "open" && this.openedAt !== null) {
      if (Date.now() - this.openedAt >= this.openDurationMs) {
        this.state = "half-open";
        console.log(`[CircuitBreaker:${this.name}] HALF-OPEN — sending test request`);
      }
    }
  }
}

// One instance per external service, shared across all calls in this process
export const dexscreenerCircuit = new CircuitBreaker({
  name: "dexscreener",
  failureThreshold: 3,
  windowMs: 60_000,
  openDurationMs: 30_000,
});

export const heliusCircuit = new CircuitBreaker({
  name: "helius",
  failureThreshold: 4,   // Slightly more lenient — Helius can have transient blips
  windowMs: 60_000,
  openDurationMs: 30_000,
});

export const solscanCircuit = new CircuitBreaker({
  name: "solscan",
  failureThreshold: 3,
  windowMs: 60_000,
  openDurationMs: 30_000,
});
