-- CreateEnum
CREATE TYPE "AiMessageFeedbackSignal" AS ENUM ('HELPFUL', 'UNHELPFUL', 'OFF_TARGET', 'TOO_MECHANICAL', 'OVER_ANALYZED', 'UNSAFE');

-- CreateTable
CREATE TABLE "AiMessageFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "aiGenerationId" TEXT,
    "signal" "AiMessageFeedbackSignal" NOT NULL,
    "tags" JSONB,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessageFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiMessageFeedback_userId_createdAt_idx" ON "AiMessageFeedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiMessageFeedback_messageId_idx" ON "AiMessageFeedback"("messageId");

-- CreateIndex
CREATE INDEX "AiMessageFeedback_aiGenerationId_idx" ON "AiMessageFeedback"("aiGenerationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiMessageFeedback_userId_messageId_signal_key" ON "AiMessageFeedback"("userId", "messageId", "signal");

-- AddForeignKey
ALTER TABLE "AiMessageFeedback" ADD CONSTRAINT "AiMessageFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessageFeedback" ADD CONSTRAINT "AiMessageFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
