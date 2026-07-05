-- CreateEnum
CREATE TYPE "EventSourceType" AS ENUM ('CHAT', 'NOTE', 'MANUAL');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('ACTIVE', 'ENDED', 'UNCLEAR');

-- CreateEnum
CREATE TYPE "EventRelationType" AS ENUM ('TRIGGER', 'RECOVERY', 'AMPLIFY', 'CONFLICT', 'UNRELATED');

-- AlterTable
ALTER TABLE "Note" ADD COLUMN "coreEventIds" JSONB,
ADD COLUMN "emotionSliceIds" JSONB,
ADD COLUMN "generatedFromChatIds" JSONB,
ADD COLUMN "isDraft" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "eventDate" DATE NOT NULL,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "sourceType" "EventSourceType" NOT NULL DEFAULT 'CHAT',
    "sourceMessageIds" JSONB,
    "participants" JSONB,
    "location" TEXT,
    "category" TEXT,
    "importanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isCoreEvent" BOOLEAN NOT NULL DEFAULT false,
    "status" "EventStatus" NOT NULL DEFAULT 'UNCLEAR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmotionSlice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT,
    "date" DATE NOT NULL,
    "time" TIMESTAMP(3),
    "emotionType" TEXT NOT NULL,
    "intensity" INTEGER,
    "valence" DOUBLE PRECISION,
    "arousal" DOUBLE PRECISION,
    "delta" INTEGER,
    "evidenceText" TEXT,
    "sourceMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmotionSlice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRelation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromEventId" TEXT NOT NULL,
    "toEventId" TEXT NOT NULL,
    "relationType" "EventRelationType" NOT NULL,
    "emotionType" TEXT,
    "strength" DOUBLE PRECISION,
    "evidenceText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Event_userId_eventDate_idx" ON "Event"("userId", "eventDate");

-- CreateIndex
CREATE INDEX "Event_userId_isCoreEvent_idx" ON "Event"("userId", "isCoreEvent");

-- CreateIndex
CREATE INDEX "Event_userId_createdAt_idx" ON "Event"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmotionSlice_userId_date_idx" ON "EmotionSlice"("userId", "date");

-- CreateIndex
CREATE INDEX "EmotionSlice_eventId_idx" ON "EmotionSlice"("eventId");

-- CreateIndex
CREATE INDEX "EmotionSlice_sourceMessageId_idx" ON "EmotionSlice"("sourceMessageId");

-- CreateIndex
CREATE INDEX "EventRelation_userId_createdAt_idx" ON "EventRelation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EventRelation_fromEventId_idx" ON "EventRelation"("fromEventId");

-- CreateIndex
CREATE INDEX "EventRelation_toEventId_idx" ON "EventRelation"("toEventId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmotionSlice" ADD CONSTRAINT "EmotionSlice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmotionSlice" ADD CONSTRAINT "EmotionSlice_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmotionSlice" ADD CONSTRAINT "EmotionSlice_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRelation" ADD CONSTRAINT "EventRelation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRelation" ADD CONSTRAINT "EventRelation_fromEventId_fkey" FOREIGN KEY ("fromEventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRelation" ADD CONSTRAINT "EventRelation_toEventId_fkey" FOREIGN KEY ("toEventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
