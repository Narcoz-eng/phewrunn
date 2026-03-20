/**
 * Market Alert Scanner
 *
 * Monitors active posts for liquidity and volume spikes.
 * Notifications are sent ONLY to users who:
 *   1. Follow the token OR follow the trader who called it
 *   2. Have the matching alert preference enabled (default: true)
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
import { sendPushToUsers } from "./webPush.js";

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

/**
 * Resolve the target user IDs for a market alert notification.
 * Returns only users who:
 *   - Follow the token OR follow the trader who posted the call
 *   - Are not banned
 *   - Have the relevant alert preference enabled (defaults to true when no record exists)
 */
async function resolveTargetUsers(
  type: "liquidity_spike" | "volume_spike",
  address: string,
  authorId: string | null,
): Promise<string[]> {
  // 1. Find token record by contract address
  const token = await prisma.token.findFirst({
    where: { address: { equals: address.toLowerCase() } },
    select: { id: true },
  }).catch(() => null);

  // 2. Collect followers in parallel
  const [tokenFollows, traderFollows] = await Promise.all([
    token
      ? prisma.tokenFollow.findMany({
          where: { tokenId: token.id },
          select: { userId: true },
        }).catch(() => [])
      : Promise.resolve([]),
    authorId
      ? prisma.follow.findMany({
          where: { followingId: authorId },
          select: { followerId: true },
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const candidateIds = [
    ...new Set([
      ...tokenFollows.map((f) => f.userId),
      ...traderFollows.map((f) => f.followerId),
    ]),
  ];

  if (candidateIds.length === 0) return [];

  // 3. Filter by alert preferences (default true when no record)
  const [prefs, activeUsers] = await Promise.all([
    prisma.alertPreference.findMany({
      where: { userId: { in: candidateIds } },
      select: { userId: true, notifyLiquiditySurge: true, notifyMomentum: true },
    }).catch(() => []),
    prisma.user.findMany({
      where: { id: { in: candidateIds }, isBanned: false },
      select: { id: true },
    }).catch(() => []),
  ]);

  const prefMap = new Map(prefs.map((p) => [p.userId, p]));
  const activeSet = new Set(activeUsers.map((u) => u.id));

  return candidateIds.filter((id) => {
    if (!activeSet.has(id)) return false;
    const pref = prefMap.get(id);
    if (!pref) return true; // default: all toggles enabled
    return type === "liquidity_spike" ? pref.notifyLiquiditySurge : pref.notifyMomentum;
  });
}

async function notifyTargetedUsers(
  type: "liquidity_spike" | "volume_spike",
  message: string,
  address: string,
  postId: string | null,
  authorId: string | null,
): Promise<void> {
  const targetUserIds = await resolveTargetUsers(type, address, authorId);
  if (targetUserIds.length === 0) return;

  const pushPayload = {
    title: type === "liquidity_spike" ? "Liquidity Spike" : "Volume Spike",
    body: message,
    icon: "/phew-mark.svg",
    badge: "/phew-mark.svg",
    url: postId ? `/posts/${postId}` : "/notifications",
    tag: type,
  };

  for (let i = 0; i < targetUserIds.length; i += NOTIFICATION_BATCH_SIZE) {
    const batch = targetUserIds.slice(i, i + NOTIFICATION_BATCH_SIZE);
    const notifications = batch.map((userId) => ({
      userId,
      type,
      message,
      dedupeKey: buildDedupeKey(type, address, userId),
      postId: postId ?? undefined,
    }));
    try {
      await prisma.notification.createMany({ data: notifications, skipDuplicates: true });
      for (const userId of batch) {
        invalidateNotificationsCache(userId);
      }
      void sendPushToUsers(batch, pushPayload).catch(() => {});
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
  authorId: string | null;
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
          const msg = `🌊 $${symbol} liquidity surged +${pct}% — a token you follow is heating up`;
          await notifyTargetedUsers("liquidity_spike", msg, entry.address, entry.postId, entry.authorId);
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
          const msg = `🔥 $${symbol} volume spiked ${mult}x in 24h — high-activity token you follow`;
          await notifyTargetedUsers("volume_spike", msg, entry.address, entry.postId, entry.authorId);
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

  // Get unique contract addresses from the last 400 posts
  // One representative postId per contract (for notification deep link)
  const rows = await prisma.post.findMany({
    where: {
      contractAddress: { not: null },
    },
    select: {
      id: true,
      contractAddress: true,
      chainType: true,
      tokenSymbol: true,
      authorId: true,
    },
    orderBy: { createdAt: "desc" },
    take: 400,
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
      authorId: row.authorId,
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
