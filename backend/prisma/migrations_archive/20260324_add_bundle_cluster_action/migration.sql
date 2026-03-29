-- Add currentAction to TokenBundleCluster to track bundle wallet activity
ALTER TABLE "TokenBundleCluster"
  ADD COLUMN IF NOT EXISTS "currentAction" TEXT;
