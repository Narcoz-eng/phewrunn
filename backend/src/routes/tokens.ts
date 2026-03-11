import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables, requireAuth, requireNotBanned } from "../auth.js";
import { prisma } from "../prisma.js";
import {
  getTokenOverviewByAddress,
  invalidateViewerSocialCaches,
  listTokenCallsByAddress,
} from "../services/intelligence/engine.js";

export const tokensRouter = new Hono<{ Variables: AuthVariables }>();

function applyTokenReadCacheHeaders(c: Context, viewerId: string | null): void {
  c.header("Vary", "Cookie");
  c.header(
    "Cache-Control",
    viewerId
      ? "private, no-store"
      : "public, max-age=20, stale-while-revalidate=60"
  );
}

const TokenAddressParamSchema = z.object({
  tokenAddress: z.string().trim().min(1),
});

tokensRouter.get("/:tokenAddress", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const viewer = c.get("user");
  const overview = await getTokenOverviewByAddress(tokenAddress, viewer?.id ?? null);

  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  applyTokenReadCacheHeaders(c, viewer?.id ?? null);
  return c.json({ data: overview.token });
});

tokensRouter.get("/:tokenAddress/chart", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const viewer = c.get("user");
  const overview = await getTokenOverviewByAddress(tokenAddress, viewer?.id ?? null);

  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  applyTokenReadCacheHeaders(c, viewer?.id ?? null);
  return c.json({ data: overview.token.chart });
});

tokensRouter.get("/:tokenAddress/timeline", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const viewer = c.get("user");
  const overview = await getTokenOverviewByAddress(tokenAddress, viewer?.id ?? null);

  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  applyTokenReadCacheHeaders(c, viewer?.id ?? null);
  return c.json({ data: overview.token.timeline });
});

tokensRouter.get("/:tokenAddress/calls", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const viewer = c.get("user");
  const calls = await listTokenCallsByAddress(tokenAddress, viewer?.id ?? null);
  applyTokenReadCacheHeaders(c, viewer?.id ?? null);
  return c.json({ data: calls });
});

tokensRouter.get("/:tokenAddress/risk", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const viewer = c.get("user");
  const overview = await getTokenOverviewByAddress(tokenAddress, viewer?.id ?? null);

  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  applyTokenReadCacheHeaders(c, viewer?.id ?? null);
  return c.json({ data: overview.token.risk });
});

tokensRouter.get("/:tokenAddress/sentiment", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const viewer = c.get("user");
  const overview = await getTokenOverviewByAddress(tokenAddress, viewer?.id ?? null);

  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  applyTokenReadCacheHeaders(c, viewer?.id ?? null);
  return c.json({ data: overview.token.sentiment });
});

tokensRouter.post("/:tokenAddress/follow", requireNotBanned, zValidator("param", TokenAddressParamSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { tokenAddress } = c.req.valid("param");
  const overview = await getTokenOverviewByAddress(tokenAddress, user.id);
  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  await prisma.tokenFollow.upsert({
    where: {
      userId_tokenId: {
        userId: user.id,
        tokenId: overview.token.id,
      },
    },
    create: {
      userId: user.id,
      tokenId: overview.token.id,
    },
    update: {},
  });
  invalidateViewerSocialCaches(user.id);

  return c.json({ data: { following: true, tokenId: overview.token.id } });
});

tokensRouter.delete("/:tokenAddress/follow", requireAuth, zValidator("param", TokenAddressParamSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { tokenAddress } = c.req.valid("param");
  const overview = await getTokenOverviewByAddress(tokenAddress, user.id);
  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  await prisma.tokenFollow.delete({
    where: {
      userId_tokenId: {
        userId: user.id,
        tokenId: overview.token.id,
      },
    },
  }).catch(() => undefined);
  invalidateViewerSocialCaches(user.id);

  return c.json({ data: { following: false, tokenId: overview.token.id } });
});
