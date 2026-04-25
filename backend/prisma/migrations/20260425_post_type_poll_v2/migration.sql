DO $$ DECLARE
  post_type_existed BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Post'
      AND column_name = 'postType'
  ) INTO post_type_existed;

  IF NOT post_type_existed THEN
    ALTER TABLE "Post"
      ADD COLUMN "postType" TEXT NOT NULL DEFAULT 'alpha';

    UPDATE "Post"
    SET "postType" = CASE
      WHEN lower("content") LIKE '[poll]%' THEN 'poll'
      WHEN lower("content") LIKE '[raid]%' THEN 'raid'
      WHEN lower("content") LIKE '[news]%' THEN 'news'
      WHEN lower("content") LIKE '[discussion]%' THEN 'discussion'
      WHEN lower("content") LIKE '[chart]%' THEN 'chart'
      WHEN lower("content") LIKE '[alpha]%' THEN 'alpha'
      WHEN "contractAddress" IS NOT NULL THEN 'alpha'
      ELSE 'discussion'
    END;
  END IF;
END $$;

ALTER TABLE "Post"
  ADD COLUMN IF NOT EXISTS "pollExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Post_postType_createdAt_idx" ON "Post"("postType", "createdAt");

CREATE TABLE IF NOT EXISTS "PostPollOption" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostPollOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PostPollVote" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostPollVote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PostPollOption_postId_sortOrder_idx" ON "PostPollOption"("postId", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "PostPollVote_postId_userId_key" ON "PostPollVote"("postId", "userId");
CREATE INDEX IF NOT EXISTS "PostPollVote_optionId_idx" ON "PostPollVote"("optionId");
CREATE INDEX IF NOT EXISTS "PostPollVote_userId_createdAt_idx" ON "PostPollVote"("userId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "PostPollOption"
    ADD CONSTRAINT "PostPollOption_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PostPollVote"
    ADD CONSTRAINT "PostPollVote_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PostPollVote"
    ADD CONSTRAINT "PostPollVote_optionId_fkey"
    FOREIGN KEY ("optionId") REFERENCES "PostPollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PostPollVote"
    ADD CONSTRAINT "PostPollVote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
