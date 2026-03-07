import { Hono } from "hono";
import { prisma, withPrismaRetry } from "../prisma.js";
import { type AuthVariables, requireAuth } from "../auth.js";
import { type Announcement } from "../types.js";
import { cacheGetJson, cacheSetJson } from "../lib/redis.js";

// Public announcement routes for feed display and view tracking
export const announcementsRouter = new Hono<{ Variables: AuthVariables }>();

type CachedAnnouncement = Omit<Announcement, "isViewed">;

const ANNOUNCEMENTS_CACHE_TTL_MS =
  process.env.NODE_ENV === "production" ? 60_000 : 10_000;
const ANNOUNCEMENTS_CACHE_KEY = "announcements:pinned:v1";
let announcementsCache:
  | {
      data: CachedAnnouncement[];
      expiresAtMs: number;
    }
  | null = null;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "";
}

function isPrismaClientError(error: unknown): boolean {
  const name =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "";

  return name.startsWith("PrismaClient");
}

function readAnnouncementsCacheLocal(): CachedAnnouncement[] | null {
  if (!announcementsCache) return null;
  if (announcementsCache.expiresAtMs <= Date.now()) {
    announcementsCache = null;
    return null;
  }
  return announcementsCache.data;
}

function writeAnnouncementsCache(data: CachedAnnouncement[]): void {
  announcementsCache = {
    data,
    expiresAtMs: Date.now() + ANNOUNCEMENTS_CACHE_TTL_MS,
  };
  void cacheSetJson(ANNOUNCEMENTS_CACHE_KEY, data, ANNOUNCEMENTS_CACHE_TTL_MS);
}

async function readAnnouncementsCache(): Promise<CachedAnnouncement[] | null> {
  const local = readAnnouncementsCacheLocal();
  if (local) return local;

  const redisCached = await cacheGetJson<CachedAnnouncement[]>(ANNOUNCEMENTS_CACHE_KEY);
  if (!Array.isArray(redisCached)) {
    return null;
  }

  announcementsCache = {
    data: redisCached,
    expiresAtMs: Date.now() + ANNOUNCEMENTS_CACHE_TTL_MS,
  };
  return redisCached;
}

function toCachedAnnouncement(input: {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  authorId: string;
  author: Announcement["author"];
  _count: { views: number };
}): CachedAnnouncement {
  return {
    id: input.id,
    title: input.title,
    content: input.content,
    isPinned: input.isPinned,
    priority: input.priority,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString(),
    authorId: input.authorId,
    author: input.author,
    viewCount: input._count.views,
  };
}

/**
 * GET /api/announcements - Get pinned announcements for feed (public)
 * Returns pinned announcements ordered by priority, with view status for authenticated users
 */
announcementsRouter.get("/", async (c) => {
  const user = c.get("user");

  let announcements = await readAnnouncementsCache();
  if (!announcements) {
    try {
      const rows = await withPrismaRetry(
        () => prisma.announcement.findMany({
          where: { isPinned: true },
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
          take: 10,
          include: {
            author: {
              select: {
                id: true,
                name: true,
                username: true,
                image: true,
              },
            },
            _count: {
              select: {
                views: true,
              },
            },
          },
        }),
        { label: "announcements:list" }
      );
      announcements = rows.map(toCachedAnnouncement);
      writeAnnouncementsCache(announcements);
    } catch (error) {
      console.warn("[announcements/list] announcement lookup unavailable; serving empty state", {
        message: getErrorMessage(error),
        recoverable: isPrismaClientError(error),
      });
      announcements = [];
      writeAnnouncementsCache(announcements);
    }
  }

  // If user is authenticated, get their viewed announcements
  let viewedIds: Set<string> = new Set();
  if (user && announcements.length > 0) {
    try {
      const views = await prisma.announcementView.findMany({
        where: {
          userId: user.id,
          announcementId: { in: announcements.map((a) => a.id) },
        },
        select: { announcementId: true },
      });
      viewedIds = new Set(views.map((v) => v.announcementId));
    } catch (error) {
      console.warn("[announcements/list] view-state lookup unavailable; continuing without viewed markers", {
        message: getErrorMessage(error),
      });
    }
  }

  const response: Announcement[] = announcements.map((a) => ({
    id: a.id,
    title: a.title,
    content: a.content,
    isPinned: a.isPinned,
    priority: a.priority,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    authorId: a.authorId,
    author: a.author,
    viewCount: a.viewCount,
    isViewed: viewedIds.has(a.id),
  }));

  return c.json({ data: response });
});

/**
 * GET /api/announcements/:id - Get a single announcement
 */
announcementsRouter.get("/:id", async (c) => {
  const announcementId = c.req.param("id");
  const user = c.get("user");

  let announcement:
    | {
        id: string;
        title: string;
        content: string;
        isPinned: boolean;
        priority: number;
        createdAt: Date;
        updatedAt: Date;
        authorId: string;
        author: Announcement["author"];
        _count: { views: number };
      }
    | null = null;

  try {
    announcement = await prisma.announcement.findUnique({
      where: { id: announcementId },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            image: true,
          },
        },
        _count: {
          select: {
            views: true,
          },
        },
      },
    });
  } catch (error) {
    const cachedAnnouncements = await readAnnouncementsCache();
    const cached = cachedAnnouncements?.find((item) => item.id === announcementId) ?? null;
    if (!cached) {
      console.warn("[announcements/detail] detail lookup unavailable", {
        announcementId,
        message: getErrorMessage(error),
      });
      return c.json(
        { error: { message: "Announcement is temporarily unavailable", code: "ANNOUNCEMENT_UNAVAILABLE" } },
        503
      );
    }

    return c.json({
      data: {
        ...cached,
        isViewed: false,
      },
    });
  }

  if (!announcement) {
    return c.json(
      { error: { message: "Announcement not found", code: "NOT_FOUND" } },
      404
    );
  }

  // Check if user has viewed this announcement
  let isViewed = false;
  if (user) {
    try {
      const view = await prisma.announcementView.findUnique({
        where: {
          userId_announcementId: {
            userId: user.id,
            announcementId: announcement.id,
          },
        },
      });
      isViewed = !!view;
    } catch (error) {
      console.warn("[announcements/detail] view-state lookup unavailable; continuing", {
        announcementId,
        message: getErrorMessage(error),
      });
    }
  }

  const response: Announcement = {
    id: announcement.id,
    title: announcement.title,
    content: announcement.content,
    isPinned: announcement.isPinned,
    priority: announcement.priority,
    createdAt: announcement.createdAt.toISOString(),
    updatedAt: announcement.updatedAt.toISOString(),
    authorId: announcement.authorId,
    author: announcement.author,
    viewCount: announcement._count.views,
    isViewed,
  };

  return c.json({ data: response });
});

/**
 * POST /api/announcements/:id/view - Mark announcement as viewed by current user
 */
announcementsRouter.post("/:id/view", requireAuth, async (c) => {
  const user = c.get("user");
  const announcementId = c.req.param("id");

  if (!user) {
    return c.json(
      { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
      401
    );
  }

  // Check if announcement exists
  let announcement: { id: string } | null = null;
  try {
    announcement = await prisma.announcement.findUnique({
      where: { id: announcementId },
      select: { id: true },
    });
  } catch (error) {
    console.warn("[announcements/view] existence lookup unavailable; soft-skipping view mark", {
      announcementId,
      message: getErrorMessage(error),
    });
    return c.json({
      data: {
        viewed: false,
        skipped: true,
      },
    }, 202);
  }

  if (!announcement) {
    return c.json(
      { error: { message: "Announcement not found", code: "NOT_FOUND" } },
      404
    );
  }

  // Check if already viewed
  let existingView:
    | {
        viewedAt: Date;
      }
    | null = null;
  try {
    existingView = await prisma.announcementView.findUnique({
      where: {
        userId_announcementId: {
          userId: user.id,
          announcementId,
        },
      },
      select: {
        viewedAt: true,
      },
    });
  } catch (error) {
    console.warn("[announcements/view] existing-view lookup unavailable; soft-skipping view mark", {
      announcementId,
      message: getErrorMessage(error),
    });
    return c.json({
      data: {
        viewed: false,
        skipped: true,
      },
    }, 202);
  }

  if (existingView) {
    // Already viewed, just return success
    return c.json({
      data: {
        viewed: true,
        viewedAt: existingView.viewedAt.toISOString(),
      },
    });
  }

  // Create view record
  try {
    const view = await prisma.announcementView.create({
      data: {
        userId: user.id,
        announcementId,
      },
    });

    return c.json({
      data: {
        viewed: true,
        viewedAt: view.viewedAt.toISOString(),
      },
    });
  } catch (error) {
    console.warn("[announcements/view] create-view failed; soft-skipping", {
      announcementId,
      message: getErrorMessage(error),
    });
    return c.json({
      data: {
        viewed: false,
        skipped: true,
      },
    }, 202);
  }
});
