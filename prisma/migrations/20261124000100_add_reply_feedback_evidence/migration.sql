BEGIN;

ALTER TABLE "AiMessageFeedback"
ADD COLUMN "sourceMessageId" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "AiMessageFeedback" SET "updatedAt" = "createdAt";

ALTER TABLE "AiMessageFeedback"
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE INDEX "AiMessageFeedback_updatedAt_id_idx"
ON "AiMessageFeedback"("updatedAt", "id");

CREATE INDEX "AiMessageFeedback_sourceMessageId_idx"
ON "AiMessageFeedback"("sourceMessageId");

ALTER TABLE "AiMessageFeedback"
ADD CONSTRAINT "AiMessageFeedback_sourceMessageId_fkey"
FOREIGN KEY ("sourceMessageId") REFERENCES "ChatMessage"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
