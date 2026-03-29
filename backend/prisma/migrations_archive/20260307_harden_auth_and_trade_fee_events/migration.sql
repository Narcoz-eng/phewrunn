ALTER TABLE "User"
ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

UPDATE "User"
SET "role" = 'admin'
WHERE "isAdmin" = true;

CREATE INDEX "User_role_idx" ON "User"("role");

ALTER TABLE "TradeFeeEvent"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "confirmedAt" TIMESTAMP(3),
ADD COLUMN "verificationError" TEXT;

UPDATE "TradeFeeEvent"
SET
  "status" = CASE
    WHEN "txSignature" IS NOT NULL THEN 'confirmed'
    ELSE 'pending'
  END,
  "confirmedAt" = CASE
    WHEN "txSignature" IS NOT NULL THEN "updatedAt"
    ELSE NULL
  END;

CREATE INDEX "TradeFeeEvent_status_createdAt_idx" ON "TradeFeeEvent"("status", "createdAt");
