import { Hono } from "hono";
import { prisma } from "../prisma.js";
import type { AuthVariables } from "../auth.js";

const invitesRouter = new Hono<{ Variables: AuthVariables }>();

invitesRouter.get("/me", async (c) => {
  const session = c.get("session");
  if (!session?.user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const userId = session.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      inviteQuota: true,
      invitees: {
        select: { id: true, username: true, image: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  const quotaUsed = user.invitees.length;
  const quotaRemaining = Math.max(0, user.inviteQuota - quotaUsed);
  const inviteCode = `USR-${userId.slice(-8).toUpperCase()}`;
  const baseUrl = process.env.FRONTEND_URL || "https://phew.run";
  const inviteLink = `${baseUrl}/login?code=${inviteCode}`;

  return c.json({
    data: {
      inviteCode,
      inviteLink,
      quotaTotal: user.inviteQuota,
      quotaUsed,
      quotaRemaining,
      invitees: user.invitees.map((inv) => ({
        id: inv.id,
        username: inv.username,
        image: inv.image,
        createdAt: inv.createdAt.toISOString(),
      })),
    },
  });
});

export { invitesRouter };
