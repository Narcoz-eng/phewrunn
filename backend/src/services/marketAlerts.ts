/**
 * Market Alert Scanner
 *
 * Monitors all active (unsettled) posts for liquidity and volume spikes.
 * When a spike is detected, broadcasts a notification to ALL users.
 *
 * Thresholds:
 *   - Liquidity spike: current >= previous × 1.5  (+50%)
 *   - Volume spike:    current >= previous × 3.0  (+200%)
 *
 * Cooldown: 4 hours per contract per spike type — prevents repeat spam.
 * Snapshots refreshed every maintenance cycle (~5 min).
 */

import { prisma } from "../prisma.js";
import { redisGetString, redisSetString } from "../lib/redis.js";
import { invalidateNotificationsCache } from "../routes/notifications.js";
import { getCachedMarketCapSnapshot } from "./marketcap.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const LIQUIDITY_SPIKE_MULTIPLIER = 1.5; // +50%
const VOLUME_SPIKE_MULTIPLIER = 3.0;    // +200%
const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_CONTRACTS_PER_RUN = 40;        // cap DexScreener calls per cycle
const NOTIFICATION_BATCH_SIZE = 500;     // users per createMany call

// ─── Redis key builders ───────────────────────────────────────────────────────

function snapKey(type: "liq" | "vol", address: string): string {
  return `market-alert:snap:${type}:${address.toLowerCase()}`;
}

function cooldownKey(type: "liq" | "vol", address: string): string {
  return `market-alert:cooldown:${type}:${address.toLowerCase()}`;
}

// ─── Snapshot helpers ─────────────────────────────────────────────────────────

async function readSnapshot(key: string): Promise<number | null> {
  const raw = await redisGetString(key);
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function writeSnapshot(key: string, value: number): Promise<void> {
  // Store for 48 hours — long enough to span maintenance gaps
  await redisSetString(key, String(value), 48 * 60 * 60 * 1000);
}

async function isCoolingDown(key: string): Promise<boolean> {
  const val = await redisGetString(key);
  return val !== null;
}

async function setCooldown(key: string): Promise<void> {
  await redisSetString(key, "1", COOLDOWN_MS);
}

// ─── Notification helpers ─────────────────────────────────────────────────────

function buildDedupeKey(type: "liquidity_spike" | "volume_spike", address: string, userId: string): string {
  const bucket = Math.floor(Date.now() / COOLDOWN_MS);
  return `${type}:${address.toLowerCase().slice(0, 20)}:${userId}:${bucket}`;
}

async function broadcastToAllUsers(
  type: "liquidity_spike" | "volume_spike",
  message: string,
  address: string,
  postId: string | null,
): Promise<void> {
  // Fetch all active user IDs (non-banned)
  const users = await prisma.user.findMany({
    where: { isBanned: false },
    select: { id: true },
  });

  if (users.length === 0) return;

  const notifications = users.map((u) => ({
    userId: u.id,
    type,
    message,
    dedupeKey: buildDedupeKey(type, address, u.id),
    postId: postId ?? undefined,
  }));

  // Batch insert to avoid giant single query
  for (let i = 0; i < notifications.length; i += NOTIFICATION_BATCH_SIZE) {
    const batch = notifications.slice(i, i + NOTIFICATION_BATCH_SIZE);
    try {
      await prisma.notification.createMany({ data: batch, skipDuplicates: true });
      const userIds = new Set(batch.map((n) => n.userId));
      for (const userId of userIds) {
        invalidateNotificationsCache(userId);
      }
    } catch (err) {
      console.warn("[market-alerts] batch notification insert failed", {
        batchIndex: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ─── Per-contract check ───────────────────────────────────────────────────────

type ContractEntry = {
  address: string;
  chainType: string | null;
  tokenSymbol: string | null;
  postId: string;
};

async function checkContract(entry: ContractEntry): Promise<{ liq: boolean; vol: boolean }> {
  const result = { liq: false, vol: false };

  let mcapData: Awaited<ReturnType<typeof getCachedMarketCapSnapshot>>;
  try {
    mcapData = await getCachedMarketCapSnapshot(entry.address, entry.chainType ?? undefined);
  } catch {
    return result;
  }

  const currentLiq = mcapData.liquidityUsd ?? null;
  const currentVol = mcapData.volume24hUsd ?? null;
  const symbol = mcapData.tokenSymbol ?? entry.tokenSymbol ?? entry.address.slice(0, 6).toUpperCase();

  // ── Liquidity spike ────────────────────────────────────────────────────────
  if (currentLiq !== null && currentLiq > 0) {
    const prevLiqKey = snapKey("liq", entry.address);
    const prevLiq = await readSnapshot(prevLiqKey);

    if (prevLiq !== null) {
      const ratio = currentLiq / prevLiq;
      if (ratio >= LIQUIDITY_SPIKE_MULTIPLIER) {
        const coolKey = cooldownKey("liq", entry.address);
        const cooling = await isCoolingDown(coolKey);
        if (!cooling) {
          const pct = Math.round((ratio - 1) * 100);
          const msg = `🌊 $${symbol} liquidity surged +${pct}% — a called token is heating up`;
          await broadcastToAllUsers("liquidity_spike", msg, entry.address, entry.postId);
          await setCooldown(coolKey);
          result.liq = true;
          console.log(`[market-alerts] liquidity spike: ${symbol} +${pct}% (${prevLiq} → ${currentLiq})`);
        }
      }
    }
    // Always refresh snapshot with latest value
    await writeSnapshot(prevLiqKey, currentLiq);
  }

  // ── Volume spike ───────────────────────────────────────────────────────────
  if (currentVol !== null && currentVol > 0) {
    const prevVolKey = snapKey("vol", entry.address);
    const prevVol = await readSnapshot(prevVolKey);

    if (prevVol !== null) {
      const ratio = currentVol / prevVol;
      if (ratio >= VOLUME_SPIKE_MULTIPLIER) {
        const coolKey = cooldownKey("vol", entry.address);
        const cooling = await isCoolingDown(coolKey);
        if (!cooling) {
          const mult = ratio.toFixed(1);
          const msg = `🔥 $${symbol} volume spiked ${mult}x in 24h — high-activity called token`;
          await broadcastToAllUsers("volume_spike", msg, entry.address, entry.postId);
          await setCooldown(coolKey);
          result.vol = true;
          console.log(`[market-alerts] volume spike: ${symbol} ${mult}x (${prevVol} → ${currentVol})`);
        }
      }
    }
    await writeSnapshot(prevVolKey, currentVol);
  }

  return result;
}

// ─── Main scan entry point ────────────────────────────────────────────────────

export type MarketAlertScanResult = {
  contractsChecked: number;
  liquiditySpikes: number;
  volumeSpikes: number;
  durationMs: number;
  errors: number;
};

export async function runMarketAlertScan(): Promise<MarketAlertScanResult> {
  const startedAt = Date.now();
  const result: MarketAlertScanResult = {
    contractsChecked: 0,
    liquiditySpikes: 0,
    volumeSpikes: 0,
    durationMs: 0,
    errors: 0,
  };

  // Get unique contract addresses from all unsettled posts
  // One representative postId per contract (for notification deep link)
  const rows = await prisma.post.findMany({
    where: {
      settled: false,
      contractAddress: { not: null },
    },
    select: {
      id: true,
      contractAddress: true,
      chainType: true,
      tokenSymbol: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200, // source pool before deduplication
  });

  // Deduplicate by contractAddress — keep the most recent post per contract
  const seen = new Set<string>();
  const contracts: ContractEntry[] = [];
  for (const row of rows) {
    if (!row.contractAddress) continue;
    const lower = row.contractAddress.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    contracts.push({
      address: row.contractAddress,
      chainType: row.chainType,
      tokenSymbol: row.tokenSymbol,
      postId: row.id,
    });
    if (contracts.length >= MAX_CONTRACTS_PER_RUN) break;
  }

  for (const contract of contracts) {
    try {
      const r = await checkContract(contract);
      result.contractsChecked++;
      if (r.liq) result.liquiditySpikes++;
      if (r.vol) result.volumeSpikes++;
    } catch (err) {
      result.errors++;
      console.warn("[market-alerts] contract check failed", {
        address: contract.address,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}
