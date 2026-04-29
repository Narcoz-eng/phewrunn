import { Hono, type Context } from "hono";
import { prisma } from "../prisma.js";
import { readCachedMarketCapSnapshotOnly } from "../services/marketcap.js";

export const webhooksRouter = new Hono();

const HELIUS_WEBHOOK_SECRET = process.env.HELIUS_WEBHOOK_SECRET?.trim() || "";
const ALCHEMY_WEBHOOK_SECRET = process.env.ALCHEMY_WEBHOOK_SECRET?.trim() || "";
const INFURA_WEBHOOK_SECRET = process.env.INFURA_WEBHOOK_SECRET?.trim() || "";
const WHALE_THRESHOLD_USD_MIN = Number(process.env.WHALE_THRESHOLD_USD_MIN ?? process.env.HELIUS_WHALE_THRESHOLD_USD ?? "25000");
const WHALE_LIQUIDITY_BPS = Number(process.env.WHALE_LIQUIDITY_BPS ?? "150");
const WHALE_MARKET_CAP_BPS = Number(process.env.WHALE_MARKET_CAP_BPS ?? "10");
const WHALE_EVENT_TYPES = ["whale_buy", "whale_sell", "whale_transfer_in", "whale_transfer_out", "whale_accumulation", "whale_distribution"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function eventTimestamp(record: Record<string, unknown>): Date {
  const raw = finite(record.timestamp ?? record.blockTime);
  if (raw && raw > 0) {
    return new Date(raw > 10_000_000_000 ? raw : raw * 1000);
  }
  return new Date();
}

async function signatureAlreadyIngested(signature: string): Promise<boolean> {
  const rows = await prisma.tokenEvent.findMany({
    where: {
      eventType: { in: WHALE_EVENT_TYPES },
      metadata: {
        path: ["txHash"],
        equals: signature,
      },
    },
    select: { id: true },
    take: 1,
  });
  return rows.length > 0;
}

function requireWebhookSecret(c: Context, secret: string): boolean {
  if (!secret) return true;
  const provided =
    c.req.header("x-webhook-secret") ??
    c.req.header("x-helius-webhook-secret") ??
    c.req.header("x-alchemy-signature") ??
    c.req.header("x-infura-secret") ??
    c.req.query("secret");
  return provided === secret;
}

function canUseWebhookTestRoute(c: Context): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const user = c.get("user" as never) as { isAdmin?: boolean } | undefined;
  return user?.isAdmin === true;
}

async function dynamicWhaleThreshold(tokenAddress: string, chainType: string): Promise<{
  thresholdUsd: number;
  marketCap: number | null;
  liquidity: number | null;
  source: string;
}> {
  const snapshot = await readCachedMarketCapSnapshotOnly(tokenAddress, chainType).catch(() => null);
  const liquidity = snapshot?.liquidityUsd ?? null;
  const marketCap = snapshot?.mcap ?? null;
  const liquidityThreshold =
    typeof liquidity === "number" && Number.isFinite(liquidity) && liquidity > 0
      ? liquidity * (WHALE_LIQUIDITY_BPS / 10_000)
      : 0;
  const marketCapThreshold =
    typeof marketCap === "number" && Number.isFinite(marketCap) && marketCap > 0
      ? marketCap * (WHALE_MARKET_CAP_BPS / 10_000)
      : 0;
  return {
    thresholdUsd: Math.max(WHALE_THRESHOLD_USD_MIN, liquidityThreshold, marketCapThreshold),
    marketCap,
    liquidity,
    source: snapshot?.source ?? "unavailable",
  };
}

function classifyWhaleEvent(record: Record<string, unknown>, transfer: Record<string, unknown>): string {
  const type = String(record.type ?? record.transactionType ?? "").toLowerCase();
  const direction = String(transfer.direction ?? "").toLowerCase();
  if (type.includes("swap") && direction.includes("out")) return "whale_sell";
  if (type.includes("swap") && direction.includes("in")) return "whale_buy";
  if (direction.includes("out")) return "whale_transfer_out";
  if (direction.includes("in")) return "whale_transfer_in";
  return "whale_transfer_in";
}

function explorerUrl(chainType: string, signature: string): string {
  return chainType === "ethereum" ? `https://etherscan.io/tx/${signature}` : `https://solscan.io/tx/${signature}`;
}

async function persistWhaleEvent(args: {
  source: string;
  chainType: "solana" | "ethereum";
  tokenAddress: string;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  txHash: string;
  wallet: string | null;
  amount: number | null;
  valueUsd: number;
  direction: string;
  eventType: string;
  transactionType: string | null;
  timestamp: Date;
}): Promise<boolean> {
  if (await signatureAlreadyIngested(args.txHash)) return false;
  const threshold = await dynamicWhaleThreshold(args.tokenAddress, args.chainType);
  if (args.valueUsd < threshold.thresholdUsd) return false;

  const token = await prisma.token.upsert({
    where: { chainType_address: { chainType: args.chainType, address: args.tokenAddress } },
    update: {
      ...(args.tokenSymbol ? { symbol: args.tokenSymbol } : {}),
      ...(args.tokenName ? { name: args.tokenName } : {}),
    },
    create: {
      chainType: args.chainType,
      address: args.tokenAddress,
      symbol: args.tokenSymbol ?? null,
      name: args.tokenName ?? null,
    },
    select: { id: true },
  });

  await prisma.tokenEvent.create({
    data: {
      tokenId: token.id,
      eventType: args.eventType,
      timestamp: args.timestamp,
      volume: args.valueUsd,
      metadata: {
        source: args.source,
        chainType: args.chainType,
        signature: args.txHash,
        txHash: args.txHash,
        wallet: args.wallet,
        tokenAddress: args.tokenAddress,
        amount: args.amount,
        valueUsd: args.valueUsd,
        thresholdUsd: threshold.thresholdUsd,
        thresholdSource: threshold.source,
        liquidityUsd: threshold.liquidity,
        marketCap: threshold.marketCap,
        direction: args.direction,
        transactionType: args.transactionType,
        explorerUrl: explorerUrl(args.chainType, args.txHash),
      },
    },
  });
  return true;
}

webhooksRouter.post("/helius", async (c) => {
  if (!requireWebhookSecret(c, HELIUS_WEBHOOK_SECRET)) {
    return c.json({ error: { message: "Invalid webhook secret", code: "FORBIDDEN" } }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid webhook payload", code: "INVALID_JSON" } }, 400);
  }

  const events = Array.isArray(body) ? body : [body];
  let ingested = 0;
  let skipped = 0;

  for (const rawEvent of events) {
    const event = asRecord(rawEvent);
    if (!event) {
      skipped += 1;
      continue;
    }

    const signature = safeString(event.signature ?? event.transactionSignature);
    if (!signature || await signatureAlreadyIngested(signature)) {
      skipped += 1;
      continue;
    }

    const timestamp = eventTimestamp(event);
    const transfers = asArray(event.tokenTransfers)
      .map(asRecord)
      .filter((transfer): transfer is Record<string, unknown> => Boolean(transfer));

    for (const transfer of transfers) {
      const tokenAddress = safeString(transfer.mint ?? transfer.tokenAddress);
      const valueUsd = finite(transfer.valueUsd ?? transfer.usdValue ?? transfer.value_usd);
      if (!tokenAddress || valueUsd === null) {
        skipped += 1;
        continue;
      }

      const wallet =
        safeString(transfer.fromUserAccount) ??
        safeString(transfer.toUserAccount) ??
        safeString(transfer.owner);
      const amount = finite(transfer.tokenAmount ?? transfer.amount);
      const eventType = classifyWhaleEvent(event, transfer);

      const saved = await persistWhaleEvent({
        source: "helius",
        chainType: "solana",
        tokenAddress,
        tokenSymbol: safeString(transfer.symbol),
        tokenName: safeString(transfer.name),
        txHash: signature,
        wallet,
        amount,
        valueUsd,
        eventType,
        direction: eventType.replace(/^whale_/, "").replaceAll("_", " "),
        transactionType: safeString(event.type ?? event.transactionType),
        timestamp,
      });
      if (saved) ingested += 1;
      else skipped += 1;
    }
  }

  return c.json({ data: { ingested, skipped, source: "helius" } });
});

function parseAlchemyTransferEvents(body: unknown): Record<string, unknown>[] {
  const root = asRecord(body);
  const event = asRecord(root?.event);
  const activity = asArray(event?.activity);
  const logs = asArray(event?.logs);
  return [...activity, ...logs].map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
}

function parseEvmEvent(raw: Record<string, unknown>): {
  tokenAddress: string | null;
  wallet: string | null;
  amount: number | null;
  valueUsd: number | null;
  txHash: string | null;
  direction: string;
  eventType: string;
  timestamp: Date;
} {
  const tokenAddress = safeString(raw.rawContract ? asRecord(raw.rawContract)?.address : null) ?? safeString(raw.assetAddress ?? raw.contractAddress ?? raw.address);
  const valueUsd = finite(raw.valueUsd ?? raw.usdValue ?? raw.value_usd);
  const amount = finite(raw.value ?? raw.amount ?? raw.tokenAmount);
  const txHash = safeString(raw.hash ?? raw.transactionHash ?? raw.txHash);
  const from = safeString(raw.fromAddress ?? raw.from);
  const to = safeString(raw.toAddress ?? raw.to);
  const category = String(raw.category ?? raw.type ?? "").toLowerCase();
  const direction = category.includes("swap")
    ? "swap"
    : from
      ? "transfer out"
      : to
        ? "transfer in"
        : "transfer";
  const eventType = category.includes("swap")
    ? "whale_buy"
    : direction === "transfer out"
      ? "whale_transfer_out"
      : "whale_transfer_in";
  return {
    tokenAddress,
    wallet: from ?? to,
    amount,
    valueUsd,
    txHash,
    direction,
    eventType,
    timestamp: eventTimestamp(raw),
  };
}

webhooksRouter.post("/alchemy/ethereum", async (c) => {
  if (!requireWebhookSecret(c, ALCHEMY_WEBHOOK_SECRET)) {
    return c.json({ error: { message: "Invalid webhook secret", code: "FORBIDDEN" } }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid webhook payload", code: "INVALID_JSON" } }, 400);
  }

  const result = await ingestEvmWhaleEvents(body, "alchemy");
  return c.json({ data: result });
});

async function ingestEvmWhaleEvents(body: unknown, source: "alchemy" | "infura"): Promise<{ ingested: number; skipped: number; source: string }> {
  let ingested = 0;
  let skipped = 0;
  for (const raw of parseAlchemyTransferEvents(body)) {
    const event = parseEvmEvent(raw);
    if (!event.tokenAddress || !event.txHash || event.valueUsd === null) {
      skipped += 1;
      continue;
    }
    const saved = await persistWhaleEvent({
      source,
      chainType: "ethereum",
      tokenAddress: event.tokenAddress,
      txHash: event.txHash,
      wallet: event.wallet,
      amount: event.amount,
      valueUsd: event.valueUsd,
      direction: event.direction,
      eventType: event.eventType,
      transactionType: "erc20_transfer_or_swap",
      timestamp: event.timestamp,
    });
    if (saved) ingested += 1;
    else skipped += 1;
  }

  return { ingested, skipped, source };
}

webhooksRouter.post("/infura/ethereum", async (c) => {
  if (!requireWebhookSecret(c, INFURA_WEBHOOK_SECRET)) {
    return c.json({ error: { message: "Invalid webhook secret", code: "FORBIDDEN" } }, 403);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid webhook payload", code: "INVALID_JSON" } }, 400);
  }
  const result = await ingestEvmWhaleEvents(body, "infura");
  return c.json({ data: result });
});

webhooksRouter.post("/test/whale", async (c) => {
  if (!canUseWebhookTestRoute(c)) {
    return c.json({ error: { message: "Webhook test route is unavailable.", code: "NOT_FOUND" } }, 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid webhook payload", code: "INVALID_JSON" } }, 400);
  }

  const payload = asRecord(body);
  if (!payload) {
    return c.json({ error: { message: "Expected a JSON object.", code: "INVALID_PAYLOAD" } }, 400);
  }

  const tokenAddress = safeString(payload.tokenAddress);
  const txHash = safeString(payload.txHash) ?? `test-${Date.now()}`;
  const valueUsd = finite(payload.valueUsd);
  const chainType = safeString(payload.chainType) === "ethereum" ? "ethereum" : "solana";
  if (!tokenAddress || valueUsd === null) {
    return c.json({ error: { message: "tokenAddress and valueUsd are required.", code: "INVALID_PAYLOAD" } }, 400);
  }

  const saved = await persistWhaleEvent({
    source: chainType === "ethereum" ? "test-ethereum" : "test-helius",
    chainType,
    tokenAddress,
    tokenSymbol: safeString(payload.tokenSymbol),
    tokenName: safeString(payload.tokenName),
    txHash,
    wallet: safeString(payload.wallet),
    amount: finite(payload.amount),
    valueUsd,
    direction: safeString(payload.direction) ?? "transfer in",
    eventType: safeString(payload.eventType) ?? "whale_transfer_in",
    transactionType: safeString(payload.transactionType) ?? "test_whale_event",
    timestamp: new Date(),
  });

  return c.json({ data: { ingested: saved ? 1 : 0, skipped: saved ? 0 : 1, txHash, source: "test" } });
});
