-- CreateEnum
CREATE TYPE "RawMemoryKind" AS ENUM ('CONVERSATION_MESSAGE', 'NOTE', 'METADATA');

-- CreateEnum
CREATE TYPE "RawMemorySourceType" AS ENUM ('CHAT_MESSAGE', 'NOTE', 'SESSION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "RawMemoryEventType" AS ENUM ('CREATED', 'TOMBSTONE', 'REDACTION_REQUESTED', 'REDACTION', 'EXPORT_REQUESTED', 'RESTORED');

-- CreateEnum
CREATE TYPE "MemoryActor" AS ENUM ('SYSTEM', 'USER');

-- CreateEnum
CREATE TYPE "EvidenceSourceKind" AS ENUM ('RAW_MEMORY', 'TIMELINE_EVENT', 'RELATIONSHIP', 'SEMANTIC_MEMORY', 'UNDERSTANDING');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('ACTIVE', 'INVALIDATED', 'SUPERSEDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "EvidenceTargetType" AS ENUM ('SEMANTIC_MEMORY', 'SEMANTIC_MEMORY_VERSION', 'UNDERSTANDING', 'UNDERSTANDING_VERSION', 'TIMELINE_EVENT', 'TIMELINE_EVENT_VERSION', 'RELATIONSHIP', 'RELATIONSHIP_VERSION', 'VERSION_HISTORY', 'REPORT', 'ASSESSMENT');

-- CreateEnum
CREATE TYPE "EvidenceRole" AS ENUM ('SUPPORTING', 'COUNTER', 'SOURCE', 'CORRECTION');

-- CreateEnum
CREATE TYPE "SemanticMemoryKind" AS ENUM ('TOPIC', 'INTEREST', 'PREFERENCE', 'VALUE', 'LONG_TERM_GOAL', 'BEHAVIOR_PATTERN', 'COPING_METHOD', 'IMPORTANT_RELATIONSHIP', 'IMPORTANT_EVENT', 'ASSESSMENT');

-- CreateEnum
CREATE TYPE "SemanticMemoryStatus" AS ENUM ('ACTIVE', 'WEAKENED', 'REJECTED', 'MERGED', 'USER_CORRECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UnderstandingStatus" AS ENUM ('OPEN', 'PAUSED', 'DEEPENING', 'USER_CORRECTED', 'CLOSED', 'REJECTED', 'MERGED');

-- CreateEnum
CREATE TYPE "TimelineEventEndStatus" AS ENUM ('ONGOING', 'ENDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TimelineEventStatus" AS ENUM ('ACTIVE', 'USER_CORRECTED', 'ARCHIVED', 'MERGED');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('FAMILY', 'FRIEND', 'ROMANTIC', 'COLLEAGUE', 'PET', 'OTHER');

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('ACTIVE', 'WEAKENED', 'USER_CORRECTED', 'ARCHIVED', 'MERGED');

-- CreateEnum
CREATE TYPE "VersionTargetType" AS ENUM ('SEMANTIC_MEMORY', 'UNDERSTANDING', 'TIMELINE_EVENT', 'RELATIONSHIP', 'EVIDENCE', 'ASSESSMENT', 'REPORT');

-- CreateEnum
CREATE TYPE "VersionChangeType" AS ENUM ('CREATED', 'UPDATED', 'CORRECTED', 'WEAKENED', 'REJECTED', 'MERGED', 'SPLIT', 'ARCHIVED', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "RefinementStep" AS ENUM ('SEGMENTATION', 'EXTRACTION', 'EVIDENCE', 'SEMANTIC_MEMORY', 'TIMELINE', 'RELATIONSHIP', 'UNDERSTANDING', 'INDEX');

-- CreateEnum
CREATE TYPE "RefinementStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'RETRYING');

-- CreateTable
CREATE TABLE "RawMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "RawMemoryKind" NOT NULL,
    "sourceType" "RawMemorySourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRevision" INTEGER NOT NULL DEFAULT 1,
    "revisionOfRawMemoryId" TEXT,
    "sessionId" TEXT,
    "conversationId" TEXT,
    "messageSequence" INTEGER,
    "role" "MessageRole",
    "content" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "appendOnlyHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawMemoryEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rawMemoryId" TEXT NOT NULL,
    "eventType" "RawMemoryEventType" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdBy" "MemoryActor" NOT NULL DEFAULT 'SYSTEM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawMemoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceKind" "EvidenceSourceKind" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "rawMemoryId" TEXT,
    "evidenceText" TEXT,
    "occurredAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryEvidenceLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "targetType" "EvidenceTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "role" "EvidenceRole" NOT NULL DEFAULT 'SUPPORTING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryEvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "SemanticMemoryKind" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "currentVersionId" TEXT,
    "status" "SemanticMemoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SemanticMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticMemoryVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "semanticMemoryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "SemanticMemoryKind" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source" TEXT NOT NULL,
    "status" "SemanticMemoryStatus" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeType" "VersionChangeType" NOT NULL,
    "reason" TEXT,
    "operationId" TEXT NOT NULL,
    "createdBy" "MemoryActor" NOT NULL DEFAULT 'SYSTEM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SemanticMemoryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Understanding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "understanding" TEXT NOT NULL,
    "category" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "alternativeHypotheses" JSONB,
    "unknowns" JSONB,
    "relatedTimelineEventIds" JSONB,
    "relatedRelationshipIds" JSONB,
    "relatedSemanticMemoryIds" JSONB,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "currentVersionId" TEXT,
    "status" "UnderstandingStatus" NOT NULL DEFAULT 'OPEN',
    "lastTouchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Understanding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnderstandingVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "understandingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "understanding" TEXT NOT NULL,
    "category" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "alternativeHypotheses" JSONB,
    "unknowns" JSONB,
    "relatedTimelineEventIds" JSONB,
    "relatedRelationshipIds" JSONB,
    "relatedSemanticMemoryIds" JSONB,
    "status" "UnderstandingStatus" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeType" "VersionChangeType" NOT NULL,
    "reason" TEXT,
    "operationId" TEXT NOT NULL,
    "createdBy" "MemoryActor" NOT NULL DEFAULT 'SYSTEM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnderstandingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "durationText" TEXT,
    "endStatus" "TimelineEventEndStatus" NOT NULL DEFAULT 'UNKNOWN',
    "people" JSONB,
    "emotions" JSONB,
    "topics" JSONB,
    "conversationIds" JSONB,
    "parentEventId" TEXT,
    "mergedIntoEventId" TEXT,
    "splitFromEventId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "importanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "currentVersionId" TEXT,
    "status" "TimelineEventStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEventVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timelineEventId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "durationText" TEXT,
    "endStatus" "TimelineEventEndStatus" NOT NULL,
    "people" JSONB,
    "emotions" JSONB,
    "topics" JSONB,
    "conversationIds" JSONB,
    "parentEventId" TEXT,
    "mergedIntoEventId" TEXT,
    "splitFromEventId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "importanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "TimelineEventStatus" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeType" "VersionChangeType" NOT NULL,
    "reason" TEXT,
    "operationId" TEXT NOT NULL,
    "createdBy" "MemoryActor" NOT NULL DEFAULT 'SYSTEM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineEventVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "relationshipType" "RelationshipType" NOT NULL DEFAULT 'OTHER',
    "identityLabel" TEXT,
    "interactionFrequency" TEXT,
    "supportSignals" JSONB,
    "conflictSignals" JSONB,
    "influenceSummary" TEXT,
    "relatedTimelineEventIds" JSONB,
    "relatedSemanticMemoryIds" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "currentVersionId" TEXT,
    "status" "RelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "relationshipType" "RelationshipType" NOT NULL,
    "identityLabel" TEXT,
    "interactionFrequency" TEXT,
    "supportSignals" JSONB,
    "conflictSignals" JSONB,
    "influenceSummary" TEXT,
    "relatedTimelineEventIds" JSONB,
    "relatedSemanticMemoryIds" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" "RelationshipStatus" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeType" "VersionChangeType" NOT NULL,
    "reason" TEXT,
    "operationId" TEXT NOT NULL,
    "createdBy" "MemoryActor" NOT NULL DEFAULT 'SYSTEM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationshipVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" "VersionTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changeType" "VersionChangeType" NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "operationId" TEXT NOT NULL,
    "createdBy" "MemoryActor" NOT NULL DEFAULT 'SYSTEM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VersionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefinementJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rawMemoryId" TEXT NOT NULL,
    "parentJobId" TEXT,
    "segmentKey" TEXT NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "step" "RefinementStep" NOT NULL,
    "status" "RefinementStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "operationId" TEXT NOT NULL,
    "inputSnapshot" JSONB,
    "outputSnapshot" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefinementJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawMemory_userId_occurredAt_idx" ON "RawMemory"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "RawMemory_userId_kind_idx" ON "RawMemory"("userId", "kind");

-- CreateIndex
CREATE INDEX "RawMemory_sessionId_messageSequence_idx" ON "RawMemory"("sessionId", "messageSequence");

-- CreateIndex
CREATE INDEX "RawMemory_revisionOfRawMemoryId_idx" ON "RawMemory"("revisionOfRawMemoryId");

-- CreateIndex
CREATE UNIQUE INDEX "RawMemory_userId_sourceType_sourceId_sourceRevision_key" ON "RawMemory"("userId", "sourceType", "sourceId", "sourceRevision");

-- CreateIndex
CREATE INDEX "RawMemoryEvent_userId_rawMemoryId_createdAt_idx" ON "RawMemoryEvent"("userId", "rawMemoryId", "createdAt");

-- CreateIndex
CREATE INDEX "RawMemoryEvent_userId_eventType_idx" ON "RawMemoryEvent"("userId", "eventType");

-- CreateIndex
CREATE INDEX "RawMemoryEvent_rawMemoryId_createdAt_idx" ON "RawMemoryEvent"("rawMemoryId", "createdAt");

-- CreateIndex
CREATE INDEX "RawMemoryEvent_rawMemoryId_eventType_createdAt_idx" ON "RawMemoryEvent"("rawMemoryId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "Evidence_userId_sourceKind_sourceId_idx" ON "Evidence"("userId", "sourceKind", "sourceId");

-- CreateIndex
CREATE INDEX "Evidence_userId_rawMemoryId_idx" ON "Evidence"("userId", "rawMemoryId");

-- CreateIndex
CREATE INDEX "Evidence_userId_status_idx" ON "Evidence"("userId", "status");

-- CreateIndex
CREATE INDEX "Evidence_userId_occurredAt_idx" ON "Evidence"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "Evidence_userId_status_occurredAt_idx" ON "Evidence"("userId", "status", "occurredAt");

-- CreateIndex
CREATE INDEX "MemoryEvidenceLink_userId_targetType_targetId_idx" ON "MemoryEvidenceLink"("userId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "MemoryEvidenceLink_userId_evidenceId_idx" ON "MemoryEvidenceLink"("userId", "evidenceId");

-- CreateIndex
CREATE INDEX "MemoryEvidenceLink_targetType_targetId_idx" ON "MemoryEvidenceLink"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "MemoryEvidenceLink_targetType_targetId_role_idx" ON "MemoryEvidenceLink"("targetType", "targetId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryEvidenceLink_evidenceId_targetType_targetId_role_key" ON "MemoryEvidenceLink"("evidenceId", "targetType", "targetId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "SemanticMemory_currentVersionId_key" ON "SemanticMemory"("currentVersionId");

-- CreateIndex
CREATE INDEX "SemanticMemory_userId_kind_idx" ON "SemanticMemory"("userId", "kind");

-- CreateIndex
CREATE INDEX "SemanticMemory_userId_status_idx" ON "SemanticMemory"("userId", "status");

-- CreateIndex
CREATE INDEX "SemanticMemory_userId_lastUpdatedAt_idx" ON "SemanticMemory"("userId", "lastUpdatedAt");

-- CreateIndex
CREATE INDEX "SemanticMemory_userId_status_lastUpdatedAt_idx" ON "SemanticMemory"("userId", "status", "lastUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SemanticMemoryVersion_operationId_key" ON "SemanticMemoryVersion"("operationId");

-- CreateIndex
CREATE INDEX "SemanticMemoryVersion_userId_createdAt_idx" ON "SemanticMemoryVersion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SemanticMemoryVersion_userId_semanticMemoryId_idx" ON "SemanticMemoryVersion"("userId", "semanticMemoryId");

-- CreateIndex
CREATE UNIQUE INDEX "SemanticMemoryVersion_semanticMemoryId_version_key" ON "SemanticMemoryVersion"("semanticMemoryId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Understanding_currentVersionId_key" ON "Understanding"("currentVersionId");

-- CreateIndex
CREATE INDEX "Understanding_userId_status_idx" ON "Understanding"("userId", "status");

-- CreateIndex
CREATE INDEX "Understanding_userId_category_idx" ON "Understanding"("userId", "category");

-- CreateIndex
CREATE INDEX "Understanding_userId_lastTouchedAt_idx" ON "Understanding"("userId", "lastTouchedAt");

-- CreateIndex
CREATE INDEX "Understanding_userId_status_lastTouchedAt_idx" ON "Understanding"("userId", "status", "lastTouchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnderstandingVersion_operationId_key" ON "UnderstandingVersion"("operationId");

-- CreateIndex
CREATE INDEX "UnderstandingVersion_userId_createdAt_idx" ON "UnderstandingVersion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UnderstandingVersion_userId_understandingId_idx" ON "UnderstandingVersion"("userId", "understandingId");

-- CreateIndex
CREATE UNIQUE INDEX "UnderstandingVersion_understandingId_version_key" ON "UnderstandingVersion"("understandingId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TimelineEvent_currentVersionId_key" ON "TimelineEvent"("currentVersionId");

-- CreateIndex
CREATE INDEX "TimelineEvent_userId_startDate_idx" ON "TimelineEvent"("userId", "startDate");

-- CreateIndex
CREATE INDEX "TimelineEvent_userId_status_idx" ON "TimelineEvent"("userId", "status");

-- CreateIndex
CREATE INDEX "TimelineEvent_userId_importanceScore_idx" ON "TimelineEvent"("userId", "importanceScore");

-- CreateIndex
CREATE INDEX "TimelineEvent_userId_status_importanceScore_idx" ON "TimelineEvent"("userId", "status", "importanceScore");

-- CreateIndex
CREATE INDEX "TimelineEvent_userId_status_startDate_idx" ON "TimelineEvent"("userId", "status", "startDate");

-- CreateIndex
CREATE INDEX "TimelineEvent_parentEventId_idx" ON "TimelineEvent"("parentEventId");

-- CreateIndex
CREATE INDEX "TimelineEvent_mergedIntoEventId_idx" ON "TimelineEvent"("mergedIntoEventId");

-- CreateIndex
CREATE INDEX "TimelineEvent_splitFromEventId_idx" ON "TimelineEvent"("splitFromEventId");

-- CreateIndex
CREATE UNIQUE INDEX "TimelineEventVersion_operationId_key" ON "TimelineEventVersion"("operationId");

-- CreateIndex
CREATE INDEX "TimelineEventVersion_userId_createdAt_idx" ON "TimelineEventVersion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TimelineEventVersion_userId_timelineEventId_idx" ON "TimelineEventVersion"("userId", "timelineEventId");

-- CreateIndex
CREATE UNIQUE INDEX "TimelineEventVersion_timelineEventId_version_key" ON "TimelineEventVersion"("timelineEventId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Relationship_currentVersionId_key" ON "Relationship"("currentVersionId");

-- CreateIndex
CREATE INDEX "Relationship_userId_displayName_idx" ON "Relationship"("userId", "displayName");

-- CreateIndex
CREATE INDEX "Relationship_userId_relationshipType_idx" ON "Relationship"("userId", "relationshipType");

-- CreateIndex
CREATE INDEX "Relationship_userId_status_idx" ON "Relationship"("userId", "status");

-- CreateIndex
CREATE INDEX "Relationship_userId_displayName_status_idx" ON "Relationship"("userId", "displayName", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipVersion_operationId_key" ON "RelationshipVersion"("operationId");

-- CreateIndex
CREATE INDEX "RelationshipVersion_userId_createdAt_idx" ON "RelationshipVersion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RelationshipVersion_userId_relationshipId_idx" ON "RelationshipVersion"("userId", "relationshipId");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipVersion_relationshipId_version_key" ON "RelationshipVersion"("relationshipId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "VersionHistory_operationId_key" ON "VersionHistory"("operationId");

-- CreateIndex
CREATE INDEX "VersionHistory_userId_targetType_targetId_idx" ON "VersionHistory"("userId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "VersionHistory_userId_createdAt_idx" ON "VersionHistory"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VersionHistory_targetType_targetId_version_key" ON "VersionHistory"("targetType", "targetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RefinementJob_operationId_key" ON "RefinementJob"("operationId");

-- CreateIndex
CREATE INDEX "RefinementJob_userId_status_idx" ON "RefinementJob"("userId", "status");

-- CreateIndex
CREATE INDEX "RefinementJob_rawMemoryId_step_idx" ON "RefinementJob"("rawMemoryId", "step");

-- CreateIndex
CREATE INDEX "RefinementJob_parentJobId_idx" ON "RefinementJob"("parentJobId");

-- CreateIndex
CREATE INDEX "RefinementJob_userId_createdAt_idx" ON "RefinementJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RefinementJob_status_createdAt_idx" ON "RefinementJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RefinementJob_step_status_createdAt_idx" ON "RefinementJob"("step", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "RawMemory" ADD CONSTRAINT "RawMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMemory" ADD CONSTRAINT "RawMemory_revisionOfRawMemoryId_fkey" FOREIGN KEY ("revisionOfRawMemoryId") REFERENCES "RawMemory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMemoryEvent" ADD CONSTRAINT "RawMemoryEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMemoryEvent" ADD CONSTRAINT "RawMemoryEvent_rawMemoryId_fkey" FOREIGN KEY ("rawMemoryId") REFERENCES "RawMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_rawMemoryId_fkey" FOREIGN KEY ("rawMemoryId") REFERENCES "RawMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEvidenceLink" ADD CONSTRAINT "MemoryEvidenceLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEvidenceLink" ADD CONSTRAINT "MemoryEvidenceLink_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticMemory" ADD CONSTRAINT "SemanticMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticMemory" ADD CONSTRAINT "SemanticMemory_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "SemanticMemoryVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticMemoryVersion" ADD CONSTRAINT "SemanticMemoryVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticMemoryVersion" ADD CONSTRAINT "SemanticMemoryVersion_semanticMemoryId_fkey" FOREIGN KEY ("semanticMemoryId") REFERENCES "SemanticMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Understanding" ADD CONSTRAINT "Understanding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Understanding" ADD CONSTRAINT "Understanding_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "UnderstandingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnderstandingVersion" ADD CONSTRAINT "UnderstandingVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnderstandingVersion" ADD CONSTRAINT "UnderstandingVersion_understandingId_fkey" FOREIGN KEY ("understandingId") REFERENCES "Understanding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_parentEventId_fkey" FOREIGN KEY ("parentEventId") REFERENCES "TimelineEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_mergedIntoEventId_fkey" FOREIGN KEY ("mergedIntoEventId") REFERENCES "TimelineEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_splitFromEventId_fkey" FOREIGN KEY ("splitFromEventId") REFERENCES "TimelineEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "TimelineEventVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEventVersion" ADD CONSTRAINT "TimelineEventVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEventVersion" ADD CONSTRAINT "TimelineEventVersion_timelineEventId_fkey" FOREIGN KEY ("timelineEventId") REFERENCES "TimelineEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "RelationshipVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipVersion" ADD CONSTRAINT "RelationshipVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipVersion" ADD CONSTRAINT "RelationshipVersion_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionHistory" ADD CONSTRAINT "VersionHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefinementJob" ADD CONSTRAINT "RefinementJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefinementJob" ADD CONSTRAINT "RefinementJob_rawMemoryId_fkey" FOREIGN KEY ("rawMemoryId") REFERENCES "RawMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefinementJob" ADD CONSTRAINT "RefinementJob_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "RefinementJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

