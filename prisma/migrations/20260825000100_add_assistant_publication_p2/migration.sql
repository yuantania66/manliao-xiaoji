CREATE TYPE "AssistantPublicationStatus" AS ENUM (
  'reserved',
  'streaming',
  'committed',
  'failed_retryable',
  'failed_terminal'
);

CREATE TYPE "AssistantPublicationFailureCode" AS ENUM (
  'PLAN_INVALID', 'GENERATION_NONCONFORMANT', 'SAFETY_BLOCKED',
  'PROVIDER_ERROR', 'TIMEOUT', 'PERSISTENCE_ERROR'
);

CREATE UNIQUE INDEX "ChatSession_id_userId_key" ON "ChatSession"("id", "userId");

CREATE TABLE "AssistantPublication" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientTurnId" TEXT NOT NULL,
  "userMessageId" TEXT,
  "committedMessageId" TEXT,
  "status" "AssistantPublicationStatus" NOT NULL DEFAULT 'reserved',
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "draftVersion" INTEGER NOT NULL DEFAULT 0,
  "draftContent" TEXT NOT NULL DEFAULT '',
  "finalContent" TEXT,
  "failureCode" "AssistantPublicationFailureCode",
  "contentDeletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AssistantPublication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssistantPublication_sessionId_clientTurnId_key"
  ON "AssistantPublication"("sessionId", "clientTurnId");
CREATE UNIQUE INDEX "AssistantPublication_userMessageId_key"
  ON "AssistantPublication"("userMessageId");
CREATE UNIQUE INDEX "AssistantPublication_committedMessageId_key"
  ON "AssistantPublication"("committedMessageId");
CREATE INDEX "AssistantPublication_sessionId_status_idx"
  ON "AssistantPublication"("sessionId", "status");
CREATE INDEX "AssistantPublication_leaseExpiresAt_idx"
  ON "AssistantPublication"("leaseExpiresAt");

ALTER TABLE "AssistantPublication"
  ADD CONSTRAINT "AssistantPublication_userMessageId_fkey"
  FOREIGN KEY ("userMessageId") REFERENCES "ChatMessage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssistantPublication"
  ADD CONSTRAINT "AssistantPublication_sessionId_userId_fkey"
  FOREIGN KEY ("sessionId", "userId") REFERENCES "ChatSession"("id", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantPublication"
  ADD CONSTRAINT "AssistantPublication_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantPublication"
  ADD CONSTRAINT "AssistantPublication_committedMessageId_fkey"
  FOREIGN KEY ("committedMessageId") REFERENCES "ChatMessage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Authorized by local-only delivery authorization 48217 (§2/§4/§7).
-- Preserve the content-free publication identity while ensuring publication
-- text cannot outlive either linked Conversation message.
CREATE FUNCTION "tombstone_assistant_publication_content"() RETURNS trigger AS $$
BEGIN
  UPDATE "AssistantPublication"
  SET "draftContent" = '',
      "finalContent" = NULL,
      "contentDeletedAt" = CURRENT_TIMESTAMP,
      "leaseOwner" = NULL,
      "leaseExpiresAt" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "userMessageId" = OLD."id" OR "committedMessageId" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ChatMessage_tombstone_assistant_publication_content"
BEFORE DELETE ON "ChatMessage"
FOR EACH ROW EXECUTE FUNCTION "tombstone_assistant_publication_content"();
