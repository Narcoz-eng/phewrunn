import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { AuthVariables } from "../auth.js";
import {
  GenerateAccessCodesSchema,
} from "../types.js";

const adminInvitesRouter = new Hono<{ Variables: AuthVariables }>();

// ---- Helper: generate a unique code string ----
function generateCodeString(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `PHEW-${suffix}`;
}

async function generateUniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = generateCodeString();
    const existing = await prisma.accessCode.findUnique({ where: { code: candidate } });
    if (!existing) return candidate;
  }
  throw new Error("Could not generate unique code after 20 attempts");
}

async function getGlobalSettingBool(key: string): Promise<boolean> {
  const row = await prisma.globalSetting.findUnique({ where: { key } });
  return row ? JSON.parse(row.value) === true : false;
}

async function getGlobalSettingInt(key: string, defaultValue: number): Promise<number> {
  const row = await prisma.globalSetting.findUnique({ where: { key } });
  if (!row) return defaultValue;
  const parsed = parseInt(row.value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function toCodeDto(code: {
  id: string;
  code: string;
  label: string | null;
  type: string;
  maxUses: number;
  useCount: number;
  expiresAt: Date | null;
  isRevoked: boolean;
  createdAt: Date;
  createdBy?: { id: string; username: string | null; image: string | null } | null;
}) {
  const now = new Date();
  const isExpired = code.expiresAt != null && code.expiresAt < now;
  const isExhausted = code.maxUses > 0 && code.useCount >= code.maxUses;
  return {
    id: code.id,
    code: code.code,
    label: code.label,
    type: code.type,
    maxUses: code.maxUses,
    useCount: code.useCount,
    expiresAt: code.expiresAt ? code.expiresAt.toISOString() : null,
    isRevoked: code.isRevoked,
    createdAt: code.createdAt.toISOString(),
    createdBy: code.createdBy ?? undefined,
    isExpired,
    isExhausted,
  };
}

// ---- Access Codes ----

adminInvitesRouter.post(
  "/access-codes/generate",
  zValidator("json", GenerateAccessCodesSchema),
  async (c) => {
    const session = c.get("session");
    const adminId = session!.user.id;
    const { count, maxUses, expiresAt, label } = c.req.valid("json");

    const codes = await Promise.all(
      Array.from({ length: count }).map(async () => {
        const code = await generateUniqueCode();
        return prisma.accessCode.create({
          data: {
            code,
            label: label ?? null,
            type: "admin",
            maxUses,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            createdById: adminId,
          },
        });
      })
    );

    return c.json({ data: codes.map(toCodeDto) });
  }
);

adminInvitesRouter.get(
  "/access-codes",
  zValidator("query", z.object({
    page: z.preprocess((v) => parseInt(v as string) || 1, z.number().int().min(1).default(1)),
    limit: z.preprocess((v) => parseInt(v as string) || 20, z.number().int().min(1).max(100).default(20)),
    status: z.enum(["all", "active", "exhausted", "expired", "revoked"]).default("all"),
    type: z.enum(["all", "admin", "user"]).default("all"),
  })),
  async (c) => {
    const { page, limit, status, type } = c.req.valid("query");
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (type !== "all") where.type = type;
    if (status === "revoked") where.isRevoked = true;
    else if (status === "active") {
      where.isRevoked = false;
    }

    const [rawCodes, total] = await Promise.all([
      prisma.accessCode.findMany({
        where,
        include: { createdBy: { select: { id: true, username: true, image: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.accessCode.count({ where }),
    ]);

    let codes = rawCodes.map(toCodeDto);

    // Apply client-side status filter for exhausted/expired (requires computed fields)
    if (status === "exhausted") codes = codes.filter((c) => c.isExhausted && !c.isRevoked);
    else if (status === "expired") codes = codes.filter((c) => c.isExpired && !c.isRevoked);
    else if (status === "active") codes = codes.filter((c) => !c.isExpired && !c.isExhausted && !c.isRevoked);

    return c.json({
      data: {
        codes,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  }
);

adminInvitesRouter.get("/access-codes/:id/uses", async (c) => {
  const { id } = c.req.param();
  const uses = await prisma.accessCodeUse.findMany({
    where: { codeId: id },
    include: { usedBy: { select: { id: true, username: true, image: true } } },
    orderBy: { usedAt: "desc" },
  });
  return c.json({
    data: uses.map((u) => ({
      id: u.id,
      usedAt: u.usedAt.toISOString(),
      usedBy: u.usedBy,
    })),
  });
});

adminInvitesRouter.patch("/access-codes/:id/revoke", async (c) => {
  const { id } = c.req.param();
  const code = await prisma.accessCode.update({
    where: { id },
    data: { isRevoked: true },
  });
  return c.json({ data: toCodeDto(code) });
});

// ---- Invite Tree ----

adminInvitesRouter.get(
  "/invites",
  zValidator("query", z.object({
    page: z.preprocess((v) => parseInt(v as string) || 1, z.number().int().min(1).default(1)),
    limit: z.preprocess((v) => parseInt(v as string) || 20, z.number().int().min(1).max(100).default(20)),
    search: z.string().optional(),
  })),
  async (c) => {
    const { page, limit, search } = c.req.valid("query");
    const skip = (page - 1) * limit;

    const where = search
      ? { username: { contains: search, mode: "insensitive" as const } }
      : {};

    const [users, total, treeSize] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          image: true,
          inviteQuota: true,
          invitedBy: { select: { id: true, username: true } },
          _count: { select: { invitees: true } },
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
      prisma.user.count({ where: { invitedById: { not: null } } }),
    ]);

    return c.json({
      data: {
        users: users.map((u) => ({
          id: u.id,
          username: u.username,
          image: u.image,
          inviteQuota: u.inviteQuota,
          inviteeCount: u._count.invitees,
          invitedBy: u.invitedBy,
          createdAt: u.createdAt.toISOString(),
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        treeSize,
      },
    });
  }
);

adminInvitesRouter.patch(
  "/invites/:userId/quota",
  zValidator("json", z.object({ quota: z.number().int().min(0).max(9999) })),
  async (c) => {
    const { userId } = c.req.param();
    const { quota } = c.req.valid("json");
    const user = await prisma.user.update({
      where: { id: userId },
      data: { inviteQuota: quota },
      select: { id: true, username: true, inviteQuota: true },
    });
    return c.json({ data: user });
  }
);

// ---- Global Settings ----

adminInvitesRouter.get("/settings/invites", async (c) => {
  const [inviteOnly, defaultInviteQuota] = await Promise.all([
    getGlobalSettingBool("inviteOnly"),
    getGlobalSettingInt("defaultInviteQuota", 2),
  ]);
  return c.json({ data: { inviteOnly, defaultInviteQuota } });
});

adminInvitesRouter.patch(
  "/settings/invites",
  zValidator("json", z.object({
    inviteOnly: z.boolean().optional(),
    defaultInviteQuota: z.number().int().min(0).max(9999).optional(),
  })),
  async (c) => {
    const body = c.req.valid("json");
    const ops: Promise<unknown>[] = [];

    if (body.inviteOnly !== undefined) {
      ops.push(
        prisma.globalSetting.upsert({
          where: { key: "inviteOnly" },
          update: { value: JSON.stringify(body.inviteOnly) },
          create: { key: "inviteOnly", value: JSON.stringify(body.inviteOnly) },
        })
      );
    }

    if (body.defaultInviteQuota !== undefined) {
      ops.push(
        prisma.globalSetting.upsert({
          where: { key: "defaultInviteQuota" },
          update: { value: JSON.stringify(body.defaultInviteQuota) },
          create: { key: "defaultInviteQuota", value: JSON.stringify(body.defaultInviteQuota) },
        })
      );
    }

    await Promise.all(ops);

    const [inviteOnly, defaultInviteQuota] = await Promise.all([
      getGlobalSettingBool("inviteOnly"),
      getGlobalSettingInt("defaultInviteQuota", 2),
    ]);

    return c.json({ data: { inviteOnly, defaultInviteQuota } });
  }
);

export { adminInvitesRouter, getGlobalSettingBool };
