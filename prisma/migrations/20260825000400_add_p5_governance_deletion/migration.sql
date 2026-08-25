CREATE TYPE "GovernanceDeletionStatus" AS ENUM ('VISIBILITY_REVOKED','DERIVATIVES_INVALIDATED','RECOMPUTE_MARKED','PHYSICAL_DELETE_PENDING','COMPLETED','FAILED_RETRYABLE','FAILED_TERMINAL');
CREATE TYPE "GovernanceDerivativeKind" AS ENUM ('MEMORY','INDEX','PROFILE','RELATIONSHIP','GROWTH','REPLAY','SHADOW');
CREATE TYPE "GovernanceDeletionPhase" AS ENUM ('VISIBILITY','DERIVATIVES','RECOMPUTE','PHYSICAL_DELETE');
CREATE TYPE "GovernanceAuditResult" AS ENUM ('APPLIED','REPLAYED','FAILED');

ALTER TABLE "ChatMessage" ADD COLUMN "contentDeletedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "ChatMessage_id_userId_sessionId_key" ON "ChatMessage"("id","userId","sessionId");

CREATE TABLE "GovernanceDeletionRequest" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "sessionId" TEXT NOT NULL,
  "sourceMessageId" TEXT, "sourceMessageIdHash" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
  "status" "GovernanceDeletionStatus" NOT NULL DEFAULT 'VISIBILITY_REVOKED',
  "requestedAt" TIMESTAMP(3) NOT NULL, "visibilityRevokedAt" TIMESTAMP(3) NOT NULL,
  "derivativesInvalidatedAt" TIMESTAMP(3), "recomputeMarkedAt" TIMESTAMP(3),
  "replayPurgedAt" TIMESTAMP(3), "physicalDeletedAt" TIMESTAMP(3),
  "leaseOwner" TEXT, "leaseExpiresAt" TIMESTAMP(3), "attempt" INTEGER NOT NULL DEFAULT 0,
  "failureCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GovernanceDeletionRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GovernanceDeletionRequest_sourceMessageId_key" ON "GovernanceDeletionRequest"("sourceMessageId");
CREATE UNIQUE INDEX "GovernanceDeletionRequest_sourceMessageId_userId_sessionId_key" ON "GovernanceDeletionRequest"("sourceMessageId","userId","sessionId");
CREATE UNIQUE INDEX "GovernanceDeletionRequest_userId_requestKey_key" ON "GovernanceDeletionRequest"("userId","requestKey");
CREATE UNIQUE INDEX "GovernanceDeletionRequest_id_userId_key" ON "GovernanceDeletionRequest"("id","userId");
CREATE UNIQUE INDEX "GovernanceDeletionRequest_id_userId_sessionId_sourceMessageId_key" ON "GovernanceDeletionRequest"("id","userId","sessionId","sourceMessageId");
CREATE INDEX "GovernanceDeletionRequest_status_leaseExpiresAt_idx" ON "GovernanceDeletionRequest"("status","leaseExpiresAt");

CREATE TABLE "GovernanceSourceEdge" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "sessionId" TEXT NOT NULL,
  "sourceMessageId" TEXT NOT NULL, "requestId" TEXT, "targetKind" "GovernanceDerivativeKind" NOT NULL,
  "targetIdHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invalidatedAt" TIMESTAMP(3), CONSTRAINT "GovernanceSourceEdge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GovernanceSourceEdge_sourceMessageId_targetKind_targetIdHash_key" ON "GovernanceSourceEdge"("sourceMessageId","targetKind","targetIdHash");
CREATE INDEX "GovernanceSourceEdge_userId_sourceMessageId_idx" ON "GovernanceSourceEdge"("userId","sourceMessageId");

CREATE TABLE "GovernanceDeletionAudit" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "requestIdHash" TEXT NOT NULL,
  "phase" "GovernanceDeletionPhase" NOT NULL, "result" "GovernanceAuditResult" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL, "durationMs" INTEGER NOT NULL, "effectCount" INTEGER NOT NULL,
  "attempt" INTEGER NOT NULL, CONSTRAINT "GovernanceDeletionAudit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GovernanceDeletionAudit_requestId_phase_key" ON "GovernanceDeletionAudit"("requestId","phase");
CREATE INDEX "GovernanceDeletionAudit_occurredAt_idx" ON "GovernanceDeletionAudit"("occurredAt");

ALTER TABLE "GovernanceDeletionRequest" ADD CONSTRAINT "GovernanceDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GovernanceDeletionRequest" ADD CONSTRAINT "GovernanceDeletionRequest_sessionId_userId_fkey" FOREIGN KEY ("sessionId","userId") REFERENCES "ChatSession"("id","userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GovernanceDeletionRequest" ADD CONSTRAINT "GovernanceDeletionRequest_sourceMessageId_userId_sessionId_fkey" FOREIGN KEY ("sourceMessageId","userId","sessionId") REFERENCES "ChatMessage"("id","userId","sessionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GovernanceSourceEdge" ADD CONSTRAINT "GovernanceSourceEdge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GovernanceSourceEdge" ADD CONSTRAINT "GovernanceSourceEdge_sourceMessageId_userId_sessionId_fkey" FOREIGN KEY ("sourceMessageId","userId","sessionId") REFERENCES "ChatMessage"("id","userId","sessionId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GovernanceSourceEdge" ADD CONSTRAINT "GovernanceSourceEdge_request_source_fkey" FOREIGN KEY ("requestId","userId","sessionId","sourceMessageId") REFERENCES "GovernanceDeletionRequest"("id","userId","sessionId","sourceMessageId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GovernanceDeletionAudit" ADD CONSTRAINT "GovernanceDeletionAudit_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "GovernanceDeletionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "prevent_chat_message_tombstone_revival"() RETURNS trigger AS $$
BEGIN
  IF OLD."contentDeletedAt" IS NOT NULL AND
     (NEW."contentDeletedAt" IS NULL OR NEW."content" <> '' OR NEW."status" = 'SAVED' OR NEW."interactionMetadata" IS NOT NULL) THEN
    RAISE EXCEPTION 'chat_message_tombstone_is_irreversible';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ChatMessage_prevent_tombstone_revival"
BEFORE UPDATE ON "ChatMessage" FOR EACH ROW
EXECUTE FUNCTION "prevent_chat_message_tombstone_revival"();

CREATE FUNCTION "prevent_assistant_publication_tombstone_revival"() RETURNS trigger AS $$
BEGIN
  IF OLD."contentDeletedAt" IS NOT NULL AND
     (NEW."contentDeletedAt" IS NULL OR NEW."draftContent" <> '' OR NEW."finalContent" IS NOT NULL OR
      NEW."leaseOwner" IS NOT NULL OR NEW."leaseExpiresAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'assistant_publication_tombstone_is_irreversible';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AssistantPublication_prevent_tombstone_revival"
BEFORE UPDATE ON "AssistantPublication" FOR EACH ROW
EXECUTE FUNCTION "prevent_assistant_publication_tombstone_revival"();

CREATE FUNCTION "prevent_governance_source_edge_identity_update"() RETURNS trigger AS $$
BEGIN
  IF NEW."userId" <> OLD."userId" OR NEW."sessionId" <> OLD."sessionId" OR
     NEW."sourceMessageId" <> OLD."sourceMessageId" OR NEW."targetKind" <> OLD."targetKind" OR
     NEW."targetIdHash" <> OLD."targetIdHash" OR NEW."createdAt" <> OLD."createdAt" OR
     (OLD."requestId" IS NOT NULL AND NEW."requestId" IS DISTINCT FROM OLD."requestId") THEN
    RAISE EXCEPTION 'governance_source_edge_identity_is_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "GovernanceSourceEdge_prevent_identity_update"
BEFORE UPDATE ON "GovernanceSourceEdge" FOR EACH ROW
EXECUTE FUNCTION "prevent_governance_source_edge_identity_update"();
