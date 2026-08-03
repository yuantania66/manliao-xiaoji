ALTER TABLE "ChatMessage"
ADD COLUMN "replyToMessageId" TEXT,
ADD COLUMN "interactionMetadata" JSONB;

ALTER TABLE "AiGeneration"
ADD COLUMN "requestId" TEXT,
ADD COLUMN "turnId" TEXT,
ADD COLUMN "attemptId" TEXT,
ADD COLUMN "executionTrace" JSONB;

CREATE UNIQUE INDEX "ChatMessage_replyToMessageId_key"
ON "ChatMessage"("replyToMessageId");

CREATE UNIQUE INDEX "AiGeneration_attemptId_key"
ON "AiGeneration"("attemptId");

CREATE INDEX "AiGeneration_requestId_idx"
ON "AiGeneration"("requestId");

CREATE INDEX "AiGeneration_turnId_idx"
ON "AiGeneration"("turnId");

ALTER TABLE "ChatMessage"
ADD CONSTRAINT "ChatMessage_replyToMessageId_fkey"
FOREIGN KEY ("replyToMessageId") REFERENCES "ChatMessage"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "ChatMessage"
SET "status" = 'BLOCKED'
WHERE "role" = 'ASSISTANT'
  AND "content" = '本轮回复未通过既定回复计划约束，暂时无法安全生成。这不是对你内容的新解释。';
