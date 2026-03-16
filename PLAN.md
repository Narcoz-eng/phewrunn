# Invite & Access Code System — Implementation Plan

## Overview

- New users **must enter a valid invite code** to register (hard gate)
- Users **earn invite slots by leveling up** — 1 slot at level 0, up to 6 at level 5+
- Admins create **one-time or multi-use** codes in the dashboard, with optional notes/expiry
- Every redemption **records the referral chain** (who invited whom)

---

## 1. Database Schema
**File:** `backend/prisma/schema.prisma`

### New model: `InviteCode`

```prisma
model InviteCode {
  id          String    @id @default(cuid())
  code        String    @unique        // 8-char uppercase alphanumeric e.g. PHEW7K3X
  type        String                   // "admin" | "user"

  // Creator — null for system/bulk codes not tied to a user
  createdById String?
  createdBy   User?     @relation("InviteCodesCreated", fields: [createdById], references: [id])
  note        String?                  // Admin label e.g. "influencer batch Mar 2026"

  // Admin-only multi-use support
  maxUses     Int       @default(1)   // 1 = single-use; >1 = multi-use (admin only)
  useCount    Int       @default(0)

  // Tracks which user redeemed this code (for single-use or last use)
  usedById    String?   @unique
  usedBy      User?     @relation("InviteCodeUsed", fields: [usedById], references: [id])
  usedAt      DateTime?

  expiresAt   DateTime?
  isRevoked   Boolean   @default(false)
  createdAt   DateTime  @default(now())

  @@index([code])
  @@index([createdById])
  @@index([isRevoked, useCount, maxUses])
  @@index([createdAt])
}
```

### Additions to `User` model

```prisma
  // Invite relations
  invitedById        String?
  invitedBy          User?        @relation("UserInviter", fields: [invitedById], references: [id])
  invitedUsers       User[]       @relation("UserInviter")
  inviteCodesCreated InviteCode[] @relation("InviteCodesCreated")
  inviteCodeUsed     InviteCode?  @relation("InviteCodeUsed")
```

---

## 2. Shared Types
**File:** `backend/src/types.ts`

Add:

```typescript
// How many invite slots a user has at a given level
export function getInviteSlotsForLevel(level: number): number {
  return level < 0 ? 0 : Math.min(level + 1, 6);
}

export const InviteCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  type: z.enum(["admin", "user"]),
  note: z.string().nullable(),
  maxUses: z.number(),
  useCount: z.number(),
  usedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  isRevoked: z.boolean(),
  createdAt: z.string(),
  createdBy: z.object({ id: z.string(), username: z.string().nullable(), name: z.string() }).nullable(),
  usedBy: z.object({ id: z.string(), username: z.string().nullable(), name: z.string() }).nullable(),
});

export const AdminInviteCodeCreateSchema = z.object({
  count: z.number().int().min(1).max(50).default(1),   // batch size
  note: z.string().max(200).optional(),
  maxUses: z.number().int().min(1).max(999).default(1),
  expiresAt: z.string().datetime().optional(),          // ISO string
});

export const AdminInviteCodeUpdateSchema = z.object({
  note: z.string().max(200).optional(),
  isRevoked: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  maxUses: z.number().int().min(1).max(999).optional(),
});

export const InviteCodeListQuerySchema = z.object({
  page: z.preprocess(v => (v ? parseInt(v as string) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess(v => (v ? parseInt(v as string) : 20), z.number().int().min(1).max(100).default(20)),
  type: z.enum(["admin", "user"]).optional(),
  status: z.enum(["pending", "used", "revoked", "expired"]).optional(),
  search: z.string().max(100).optional(),
});
```

---

## 3. Invite Code Service
**New file:** `backend/src/services/invite-codes.ts`

```typescript
export function generateCode(): string
// Returns random 8-char uppercase alphanumeric e.g. "K7PX3RWQ"

export function getInviteSlotsForLevel(level: number): number
// level < 0 → 0, level 0 → 1, level 5+ → 6 (cap)

export async function countUserGeneratedCodes(userId: string): Promise<number>
// SELECT COUNT(*) FROM InviteCode WHERE createdById = userId AND type = "user"

export async function validateInviteCode(
  code: string
): Promise<{ valid: true; codeId: string; createdById: string | null } | { valid: false; reason: string }>
// Check: exists, not revoked, not expired, useCount < maxUses

export async function redeemInviteCode(
  codeId: string,
  usedById: string,
  invitedById: string | null
): Promise<void>
// Atomic: increment useCount, set usedById + usedAt if single-use, update user.invitedById
```

---

## 4. User-Facing Invite Routes
**New file:** `backend/src/routes/invite-codes.ts`
**Mounted at:** `/api/invite-codes`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/validate/:code` | Public | Returns `{ valid, createdByHandle? }` — used during registration |
| `GET` | `/mine` | Required | Returns `{ slots, slotsUsed, slotsAvailable, codes[] }` |
| `POST` | `/generate` | Required | Creates a new user-type code; returns the code; errors if no slots left |

**Slot formula:** `slotsAvailable = getInviteSlotsForLevel(user.level) - codesCreated`
If `slotsAvailable <= 0` → `429 { code: "NO_INVITE_SLOTS", message: "Level up to earn more invite slots" }`

---

## 5. Admin Invite Code Routes
**File:** `backend/src/routes/admin.ts`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/invite-codes` | Paginated list; filter by type, status, search query |
| `POST` | `/api/admin/invite-codes` | Create 1–50 codes; set note, maxUses, expiresAt |
| `PATCH` | `/api/admin/invite-codes/:id` | Update note / revoke / change maxUses or expiry |
| `DELETE` | `/api/admin/invite-codes/:id` | Delete only if unused (useCount === 0) |

Stats summary endpoint (for dashboard strip):
`GET /api/admin/invite-codes/stats` → `{ total, used, pending, revoked }`

---

## 6. Auth Gate — New User Registration
**File:** `backend/src/index.ts`

**Schema change** — add to `PrivySyncRequestSchema`:
```typescript
inviteCode: z.string().trim().min(1).max(32).optional(),
```

**Logic change** in `handleVerifiedPrivySyncRequest`, in the `if (!user)` branch (new user creation):

```
1. Extract inviteCode from parsed.data
2. If missing → 403 { code: "INVITE_REQUIRED", message: "An invite code is required to join" }
3. Validate code → if invalid/expired/revoked → 403 { code: "INVITE_INVALID", message: "..." }
4. upsertAuthUserByEmail(...) — create the user as normal
5. redeemInviteCode(codeId, newUser.id, code.createdById) — atomic, right after user creation
```

Existing users (re-logging in) are **not affected** — the code check only runs when `!user`.

---

## 7. Frontend — Login Page
**File:** `webapp/src/pages/Login.tsx`

Changes:
- Read `?code=` from URL search params on mount → pre-fill invite code field
- Show an **"Enter invite code"** input step above the Privy login buttons
- "Validate" button calls `GET /api/invite-codes/validate/:code`
  - If invalid → show inline error, block login buttons
  - If valid → store code in `localStorage` under `phew.pending-invite-code`
- Privy login buttons only become active once a valid code is confirmed
- On successful validation, the input locks (shows green confirmation + creator handle if it's a user invite)

---

## 8. Frontend — Auth Client
**File:** `webapp/src/lib/auth-client.ts`

In the `syncWithServer` function (around line 3488), add the pending invite code to the request body:

```typescript
const pendingInviteCode = localStorage.getItem("phew.pending-invite-code");

body: JSON.stringify({
  ...(normalizedPrivyIdToken ? { privyIdToken: normalizedPrivyIdToken } : {}),
  ...(name ? { name } : {}),
  ...(pendingInviteCode ? { inviteCode: pendingInviteCode } : {}),
})
```

After successful sync → `localStorage.removeItem("phew.pending-invite-code")`.
Also clear it if the server returns `INVITE_INVALID` or `INVITE_REQUIRED` (force re-entry).

---

## 9. Frontend — User "My Invites" UI
**File:** `webapp/src/pages/Profile.tsx` (or Settings tab within it)

Add an **"Invites"** section:
- Header: "Invite Friends" with slot counter chip — e.g. `3 / 4 slots used`
- Level hint: "Level up to earn more invite slots"
- List of generated codes:
  - Code pill (monospace), status badge (Pending / Used by @handle), created date
  - Copy code button & copy link button (`phewrunn.io/join?code=XXXX`)
- "Generate Invite" button — disabled when `slotsAvailable === 0`
  - On click → `POST /api/invite-codes/generate` → adds to list

---

## 10. Frontend — Admin Dashboard "Codes" Tab
**File:** `webapp/src/pages/Admin.tsx`

Add a new **Codes** tab (between Users and Posts, or after Announcements):

**Stats strip** (4 cards):
`Total Issued` | `Used` | `Pending` | `Revoked`

**Create panel:**
- Count spinner (1–50)
- Note input (optional label)
- Max uses input (default 1; >1 for multi-use event codes)
- Expiry date picker (optional)
- "Generate Codes" button → shows newly created codes in a copiable list

**Codes table:**
| Column | Notes |
|--------|-------|
| Code | Monospace, copyable |
| Type | Admin / User badge |
| Creator | Username or "Admin" |
| Used By | Username or "—" |
| Created | Relative date |
| Status | Pending / Used / Revoked / Expired |
| Actions | Revoke (if pending), Delete (if unused) |

**Filters:** All / Admin / User / Pending / Used / Revoked / Expired
**Search:** by code or creator username

---

## File Change Summary

| File | Type | Change |
|------|------|--------|
| `backend/prisma/schema.prisma` | Edit | Add `InviteCode` model + User invite relations |
| `backend/src/services/invite-codes.ts` | New | Code generation, validation, redemption logic |
| `backend/src/routes/invite-codes.ts` | New | User-facing invite API (`/api/invite-codes/*`) |
| `backend/src/routes/admin.ts` | Edit | Admin invite code CRUD (`/api/admin/invite-codes/*`) |
| `backend/src/index.ts` | Edit | `PrivySyncRequestSchema` + registration gate in `handleVerifiedPrivySyncRequest` |
| `backend/src/types.ts` | Edit | Add `InviteCodeSchema`, `AdminInviteCodeCreateSchema`, etc. |
| `webapp/src/lib/auth-client.ts` | Edit | Pass pending invite code in `syncWithServer` body + clear on success |
| `webapp/src/pages/Login.tsx` | Edit | Invite code entry step + validation before Privy buttons unlock |
| `webapp/src/pages/Profile.tsx` | Edit | "My Invites" section with slot counter + code list + generate button |
| `webapp/src/pages/Admin.tsx` | Edit | "Codes" tab with stats, create form, and codes table |

---

## Invite Slot Formula

| Level | Slots |
|-------|-------|
| < 0 | 0 |
| 0 | 1 |
| 1 | 2 |
| 2 | 3 |
| 3 | 4 |
| 4 | 5 |
| 5+ | 6 (cap) |

Formula: `level < 0 ? 0 : Math.min(level + 1, 6)`
