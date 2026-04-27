import { Hono } from "hono";
import { prisma } from "../prisma.js";

export const webhooksRouter = new Hono();

const HELIUS_WEBHOOK_SECRET = process.env.HELIUS_WEBHOOK_SECRET?.trim() || "";
const HELIUS_WHALE_THRESHOLD_USD = Number(process.env.HELIUS_WHALE_THRESHOLD_USD ?? "25000");

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
      eventType: {
        in: ["whale_buy", "whale_sell", "whale_transfer_in", "whale_transfer_out", "whale_accumulation", "whale_distribution"],
      },
      metadata: {
        path: ["signature"],
        equals: signature,
      },
    },
    select: { id: true },
    take: 1,
  });
  return rows.length > 0;
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

function explorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

webhooksRouter.post("/helius", async (c) => {
  if (HELIUS_WEBHOOK_SECRET) {
    const provided =
      c.req.header("x-webhook-secret") ??
      c.req.header("x-helius-webhook-secret") ??
      c.req.query("secret");
    if (provided !== HELIUS_WEBHOOK_SECRET) {
      return c.json({ error: { message: "Invalid webhook secret", code: "FORBIDDEN" } }, 403);
    }
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
      if (!tokenAddress || valueUsd === null || valueUsd < HELIUS_WHALE_THRESHOLD_USD) {
        skipped += 1;
        continue;
      }

      const token = await prisma.token.upsert({
        where: { chainType_address: { chainType: "solana", address: tokenAddress } },
        update: {},
        create: {
          chainType: "solana",
          address: tokenAddress,
          symbol: safeString(transfer.symbol),
          name: safeString(transfer.name),
        },
        select: { id: true },
      });

      const wallet =
        safeString(transfer.fromUserAccount) ??
        safeString(transfer.toUserAccount) ??
        safeString(transfer.owner);
      const amount = finite(transfer.tokenAmount ?? transfer.amount);
      const eventType = classifyWhaleEvent(event, transfer);

      await prisma.tokenEvent.create({
        data: {
          tokenId: token.id,
          eventType,
          timestamp,
          volume: valueUsd,
          metadata: {
            source: "helius",
            signature,
            wallet,
            tokenAddress,
            amount,
            valueUsd,
            direction: eventType.replace(/^whale_/, "").replaceAll("_", " "),
            transactionType: safeString(event.type ?? event.transactionType),
            explorerUrl: explorerUrl(signature),
          },
        },
      });
      ingested += 1;
    }
  }

  return c.json({ data: { ingested, skipped, source: "helius" } });
});
