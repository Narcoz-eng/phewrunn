import { describe, expect, test } from "bun:test";
import {
  buildMaintenanceJobInputs,
  buildSettlementJobInput,
} from "./routes/posts.js";
import { buildLeaderboardRefreshJobInput } from "./routes/leaderboard.js";
import { buildIntelligenceRefreshJobInput } from "./services/intelligence/engine.js";

describe("maintenance job builders", () => {
  test("builds a stable settlement job input", () => {
    const input = buildSettlementJobInput({
      reason: "manual_settlement_endpoint",
      nowMs: 8_001,
    });

    expect(input.jobName).toBe("settlement");
    expect(input.idempotencyKey.startsWith("settlement:")).toBe(true);
    expect(input.payload).toEqual({
      reason: "manual_settlement_endpoint",
    });
  });

  test("builds the full maintenance job set without adding new flow types", () => {
    const inputs = buildMaintenanceJobInputs({
      reason: "manual_maintenance_endpoint",
      prewarmLeaderboard: true,
      nowMs: 8_001,
    });

    expect(inputs.map((input) => input.jobName)).toEqual([
      "settlement",
      "market_refresh",
      "intelligence_refresh",
      "leaderboard_refresh",
    ]);
    expect(
      inputs.every((input) => typeof input.idempotencyKey === "string" && input.idempotencyKey.length > 0)
    ).toBe(true);
    expect(inputs.every((input) => input.payload.reason === "manual_maintenance_endpoint")).toBe(true);
    expect(inputs[2]).toEqual(
      buildIntelligenceRefreshJobInput({
        reason: "manual_maintenance_endpoint",
        nowMs: 8_001,
        intervalMs: 5_000,
        scope: "maintenance",
      })
    );
  });

  test("builds a dedicated leaderboard refresh job input", () => {
    const input = buildLeaderboardRefreshJobInput({
      reason: "/api/leaderboard/stats",
      requestId: "req_123",
      nowMs: 12_345,
    });

    expect(input.jobName).toBe("leaderboard_refresh");
    expect(input.idempotencyKey.startsWith("leaderboard-refresh:")).toBe(true);
    expect(input.traceId).toBe("req_123");
    expect(input.payload).toEqual({
      reason: "/api/leaderboard/stats",
    });
  });

  test("builds a stable intelligence refresh job input for the priority loop", () => {
    const input = buildIntelligenceRefreshJobInput({
      reason: "intelligence_priority_loop",
      nowMs: 600_000,
    });

    expect(input.jobName).toBe("intelligence_refresh");
    expect(input.idempotencyKey).toBe("intelligence-refresh:priority-loop:1");
    expect(input.payload).toEqual({
      reason: "intelligence_priority_loop",
    });
  });
});
