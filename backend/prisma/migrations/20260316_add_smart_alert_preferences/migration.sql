-- Add smart notification preference fields to AlertPreference
ALTER TABLE "AlertPreference"
  ADD COLUMN IF NOT EXISTS "notifyLiquiditySurge" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notifyHolderGrowth" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notifyMomentum" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notifyWhaleAccumulating" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notifySmartMoney" BOOLEAN NOT NULL DEFAULT true;
