import { Database } from "bun:sqlite";
import { prisma } from "../src/prisma";
import { resolve } from "node:path";

type Row = Record<string, any>;

type TableSpec = {
  name: string;
  dateFields?: string[];
  booleanFields?: string[];
  insert: (rows: Row[]) => Promise<void>;
};

const SQLITE_PATH = resolve(process.cwd(), "prisma/dev.db");
const SHOULD_RESET = process.argv.includes("--reset");
const CHUNK_SIZE = 250;

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const asNumber = Number(trimmed);
    if (!Number.isNaN(asNumber) && /^\d+$/.test(trimmed)) return new Date(asNumber);
    return new Date(trimmed);
  }
  throw new Error(`Unsupported date value: ${String(value)}`);
}

function toBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (["1", "true", "t", "yes", "y"].includes(lower)) return true;
    if (["0", "false", "f", "no", "n"].includes(lower)) return false;
  }
  return Boolean(value);
}

function normalizeRows(rows: Row[], spec: TableSpec): Row[] {
  const dateFields = new Set(spec.dateFields ?? []);
  const booleanFields = new Set(spec.booleanFields ?? []);

  return rows.map((row) => {
    const normalized: Row = { ...row };
    for (const key of Object.keys(normalized)) {
      if (dateFields.has(key)) normalized[key] = toDate(normalized[key]);
      else if (booleanFields.has(key)) normalized[key] = toBoolean(normalized[key]);
    }
    return normalized;
  });
}

function readRows(db: Database, tableName: string): Row[] {
  return db.query(`SELECT * FROM "${tableName}"`).all() as Row[];
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function createManyInChunks(label: string, rows: Row[], write: (rows: Row[]) => Promise<void>) {
  if (rows.length === 0) {
    console.log(`[migrate] ${label}: 0 rows (skipped)`);
    return;
  }
  const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);
  for (const [index, chunk] of chunks(rows, CHUNK_SIZE).entries()) {
    await write(chunk);
    console.log(`[migrate] ${label}: inserted chunk ${index + 1}/${totalChunks} (${chunk.length} rows)`);
  }
}

async function countTargetRows(tableName: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
    `SELECT COUNT(*)::bigint AS count FROM "${tableName}"`
  );
  const raw = rows[0]?.count ?? 0;
  return Number(raw);
}

async function main() {
  console.log(`[migrate] Source SQLite DB: ${SQLITE_PATH}`);
  console.log(`[migrate] Reset target before import: ${SHOULD_RESET}`);

  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  const specs: TableSpec[] = [
    {
      name: "User",
      dateFields: ["createdAt", "updatedAt", "walletConnectedAt", "lastUsernameUpdate", "lastPhotoUpdate"],
      booleanFields: ["emailVerified", "isAdmin", "isBanned", "isVerified"],
      insert: async (rows) => { await prisma.user.createMany({ data: rows as any[] }); },
    },
    {
      name: "Verification",
      dateFields: ["expiresAt", "createdAt", "updatedAt"],
      insert: async (rows) => { await prisma.verification.createMany({ data: rows as any[] }); },
    },
    {
      name: "Session",
      dateFields: ["expiresAt", "createdAt", "updatedAt"],
      insert: async (rows) => { await prisma.session.createMany({ data: rows as any[] }); },
    },
    {
      name: "Account",
      dateFields: ["accessTokenExpiresAt", "refreshTokenExpiresAt", "createdAt", "updatedAt"],
      insert: async (rows) => { await prisma.account.createMany({ data: rows as any[] }); },
    },
    {
      name: "Follow",
      dateFields: ["createdAt"],
      insert: async (rows) => { await prisma.follow.createMany({ data: rows as any[] }); },
    },
    {
      name: "Post",
      dateFields: ["lastMcapUpdate", "settledAt", "createdAt", "updatedAt"],
      booleanFields: ["settled", "isWin", "isWin1h", "isWin6h", "recoveryEligible", "settled6h"],
      insert: async (rows) => { await prisma.post.createMany({ data: rows as any[] }); },
    },
    {
      name: "Like",
      dateFields: ["createdAt"],
      insert: async (rows) => { await prisma.like.createMany({ data: rows as any[] }); },
    },
    {
      name: "Comment",
      dateFields: ["createdAt", "updatedAt"],
      insert: async (rows) => { await prisma.comment.createMany({ data: rows as any[] }); },
    },
    {
      name: "Repost",
      dateFields: ["createdAt"],
      insert: async (rows) => { await prisma.repost.createMany({ data: rows as any[] }); },
    },
    {
      name: "Notification",
      dateFields: ["clickedAt", "createdAt"],
      booleanFields: ["read", "dismissed"],
      insert: async (rows) => { await prisma.notification.createMany({ data: rows as any[] }); },
    },
    {
      name: "Announcement",
      dateFields: ["createdAt", "updatedAt"],
      booleanFields: ["isPinned"],
      insert: async (rows) => { await prisma.announcement.createMany({ data: rows as any[] }); },
    },
    {
      name: "AnnouncementView",
      dateFields: ["viewedAt"],
      insert: async (rows) => { await prisma.announcementView.createMany({ data: rows as any[] }); },
    },
  ];

  try {
    if (SHOULD_RESET) {
      console.log('[migrate] Truncating target tables...');
      await prisma.$executeRawUnsafe(`
        TRUNCATE TABLE
          "AnnouncementView",
          "Notification",
          "Repost",
          "Comment",
          "Like",
          "Follow",
          "Session",
          "Account",
          "Verification",
          "Announcement",
          "Post",
          "User"
        CASCADE;
      `);
    }

    for (const spec of specs) {
      const sourceRows = readRows(sqlite, spec.name);
      const normalized = normalizeRows(sourceRows, spec);
      console.log(`[migrate] ${spec.name}: source rows = ${sourceRows.length}`);
      await createManyInChunks(spec.name, normalized, spec.insert);
      const targetCount = await countTargetRows(spec.name);
      console.log(`[migrate] ${spec.name}: target rows = ${targetCount}`);
      if (targetCount !== sourceRows.length) {
        throw new Error(`[migrate] Count mismatch for ${spec.name}: source=${sourceRows.length}, target=${targetCount}`);
      }
    }

    console.log('[migrate] SQLite -> Supabase migration completed successfully.');
  } finally {
    sqlite.close();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error('[migrate] Failed:', error);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
