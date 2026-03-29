import { createMiddleware } from "hono/factory";
import { prisma } from "../prisma.js";
import type { AuthVariables } from "../auth.js";

export const requireAdmin = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const user = c.get("user");

    if (!user) {
      return c.json(
        { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
        401
      );
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true },
    });

    if (dbUser?.role !== "admin") {
      return c.json(
        { error: { message: "Forbidden - Admin access is restricted", code: "FORBIDDEN" } },
        403
      );
    }

    return next();
  }
);
