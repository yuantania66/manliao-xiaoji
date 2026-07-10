-- CreateEnum
CREATE TYPE "UnderstandingSourceType" AS ENUM ('CHAT', 'NOTE');

-- CreateEnum
CREATE TYPE "HypothesisCategory" AS ENUM ('ATTACHMENT', 'WORK', 'FAMILY', 'SELF', 'RELATIONSHIP', 'RECOVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "HypothesisStatus" AS ENUM ('ACTIVE', 'WEAKENED', 'REJECTED', 'MERGED');

-- CreateEnum
CREATE TYPE "UnderstandingGraphNodeType" AS ENUM ('PERSON', 'EVENT', 'EMOTION', 'TOPIC', 'HYPOTHESIS', 'VALUE', 'COPING_METHOD');

-- CreateEnum
CREATE TYPE "UnderstandingGraphEdgeType" AS ENUM ('TRIGGERED', 'RELIEVED_BY', 'RELATED_TO', 'CONTRADICTS', 'SUPPORTS', 'REPEATED_IN', 'BELONGS_TO_TIMELINE');

-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" "UnderstandingSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "eventText" TEXT NOT NULL,
    "people" JSONB,
    "location" TEXT,
    "topics" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperienceSlice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" "UnderstandingSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "eventId" TEXT,
    "emotion" TEXT,
    "emotionIntensity" INTEGER,
    "bodySignal" TEXT,
    "behavior" TEXT,
    "duration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperienceSlice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interpretation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "interpretationText" TEXT NOT NULL,
    "evidenceText" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interpretation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hypothesis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hypothesisText" TEXT NOT NULL,
    "category" "HypothesisCategory" NOT NULL DEFAULT 'OTHER',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "supportingEvidenceIds" JSONB,
    "counterEvidenceIds" JSONB,
    "status" "HypothesisStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnderstandingGraphNode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "UnderstandingGraphNodeType" NOT NULL,
    "label" TEXT NOT NULL,
    "refId" TEXT,
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnderstandingGraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnderstandingGraphEdge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "type" "UnderstandingGraphEdgeType" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnderstandingGraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fact_userId_occurredAt_idx" ON "Fact"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "Fact_userId_sourceType_sourceId_idx" ON "Fact"("userId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Fact_userId_createdAt_idx" ON "Fact"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ExperienceSlice_userId_createdAt_idx" ON "ExperienceSlice"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ExperienceSlice_userId_emotion_idx" ON "ExperienceSlice"("userId", "emotion");

-- CreateIndex
CREATE INDEX "ExperienceSlice_eventId_idx" ON "ExperienceSlice"("eventId");

-- CreateIndex
CREATE INDEX "ExperienceSlice_userId_sourceType_sourceId_idx" ON "ExperienceSlice"("userId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Interpretation_userId_createdAt_idx" ON "Interpretation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Interpretation_eventId_idx" ON "Interpretation"("eventId");

-- CreateIndex
CREATE INDEX "Hypothesis_userId_status_idx" ON "Hypothesis"("userId", "status");

-- CreateIndex
CREATE INDEX "Hypothesis_userId_category_idx" ON "Hypothesis"("userId", "category");

-- CreateIndex
CREATE INDEX "Hypothesis_userId_updatedAt_idx" ON "Hypothesis"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "UnderstandingGraphNode_userId_type_idx" ON "UnderstandingGraphNode"("userId", "type");

-- CreateIndex
CREATE INDEX "UnderstandingGraphNode_userId_refId_idx" ON "UnderstandingGraphNode"("userId", "refId");

-- CreateIndex
CREATE INDEX "UnderstandingGraphEdge_userId_type_idx" ON "UnderstandingGraphEdge"("userId", "type");

-- CreateIndex
CREATE INDEX "UnderstandingGraphEdge_fromNodeId_idx" ON "UnderstandingGraphEdge"("fromNodeId");

-- CreateIndex
CREATE INDEX "UnderstandingGraphEdge_toNodeId_idx" ON "UnderstandingGraphEdge"("toNodeId");

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceSlice" ADD CONSTRAINT "ExperienceSlice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceSlice" ADD CONSTRAINT "ExperienceSlice_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Fact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interpretation" ADD CONSTRAINT "Interpretation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interpretation" ADD CONSTRAINT "Interpretation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hypothesis" ADD CONSTRAINT "Hypothesis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnderstandingGraphNode" ADD CONSTRAINT "UnderstandingGraphNode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnderstandingGraphEdge" ADD CONSTRAINT "UnderstandingGraphEdge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnderstandingGraphEdge" ADD CONSTRAINT "UnderstandingGraphEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "UnderstandingGraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnderstandingGraphEdge" ADD CONSTRAINT "UnderstandingGraphEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "UnderstandingGraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
