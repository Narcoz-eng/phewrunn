-- Canonical community distribution for posts.
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "communityId" TEXT;

CREATE INDEX IF NOT EXISTS "Post_communityId_createdAt_idx" ON "Post"("communityId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Post_communityId_fkey'
  ) THEN
    ALTER TABLE "Post"
      ADD CONSTRAINT "Post_communityId_fkey"
      FOREIGN KEY ("communityId")
      REFERENCES "TokenCommunityProfile"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
