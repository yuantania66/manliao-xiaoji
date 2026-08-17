-- CreateEnum
CREATE TYPE "AssistantPublicationStatus" AS ENUM ('reserved', 'streaming', 'committed', 'failed_retryable', 'failed_terminal');

-- CreateTable
CREATE TABLE "AssistantPublication" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "clientTurnId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'assistant',
    "status" "AssistantPublicationStatus" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "draftContent" TEXT NOT NULL DEFAULT '',
    "finalContent" TEXT,
    "failureCode" TEXT,
    "linkedConversationMessageId" TEXT,
    "provisionalMarkedTemporary" BOOLEAN NOT NULL DEFAULT true,
    "tombstoneUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantPublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantPublication_sessionId_status_idx" ON "AssistantPublication"("sessionId", "status");

-- CreateIndex
CREATE INDEX "AssistantPublication_leaseExpiresAt_idx" ON "AssistantPublication"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AssistantPublication_tombstoneUntil_idx" ON "AssistantPublication"("tombstoneUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantPublication_sessionId_clientTurnId_role_key" ON "AssistantPublication"("sessionId", "clientTurnId", "role");
