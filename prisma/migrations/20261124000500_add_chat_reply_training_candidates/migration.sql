BEGIN;

CREATE TABLE "ChatReplyTrainingConsent" (
    "userId" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatReplyTrainingConsent_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "ChatReplyTrainingConsent_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ChatReplyTrainingCandidate" (
    "assistantMessageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "evidenceVersion" TEXT NOT NULL,
    "evaluationVersion" TEXT NOT NULL,
    "material" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatReplyTrainingCandidate_pkey" PRIMARY KEY ("assistantMessageId"),
    CONSTRAINT "ChatReplyTrainingCandidate_assistantMessageId_fkey" FOREIGN KEY ("assistantMessageId")
        REFERENCES "ChatReplyEvaluationJob"("assistantMessageId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatReplyTrainingCandidate_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "ChatReplyTrainingConsent"("userId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ChatReplyTrainingCandidate_userId_idx" ON "ChatReplyTrainingCandidate"("userId");

CREATE FUNCTION discard_training_candidate_after_job_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM "ChatReplyTrainingCandidate" WHERE "assistantMessageId" = NEW."assistantMessageId";
    RETURN NULL;
END;
$$;

CREATE TRIGGER discard_training_candidate_after_job_change
AFTER UPDATE OF "revision", "evidenceVersion", "evaluationVersion", "packet", "completedAt"
ON "ChatReplyEvaluationJob"
FOR EACH ROW
WHEN (ROW(OLD."revision", OLD."evidenceVersion", OLD."evaluationVersion", OLD."packet", OLD."completedAt")
      IS DISTINCT FROM
      ROW(NEW."revision", NEW."evidenceVersion", NEW."evaluationVersion", NEW."packet", NEW."completedAt"))
EXECUTE FUNCTION discard_training_candidate_after_job_change();

CREATE FUNCTION discard_training_candidate_after_review_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        IF TG_OP = 'DELETE' OR
           ROW(OLD."assistantMessageId", OLD."evidenceVersion", OLD."evaluationVersion", OLD."decision")
           IS DISTINCT FROM
           ROW(NEW."assistantMessageId", NEW."evidenceVersion", NEW."evaluationVersion", NEW."decision") THEN
            DELETE FROM "ChatReplyTrainingCandidate"
            WHERE "assistantMessageId" = OLD."assistantMessageId"
              AND "evidenceVersion" = OLD."evidenceVersion"
              AND "evaluationVersion" = OLD."evaluationVersion";
        END IF;
    END IF;

    IF TG_OP <> 'DELETE' AND NEW."decision" = 'REJECTED' THEN
        DELETE FROM "ChatReplyTrainingCandidate"
        WHERE "assistantMessageId" = NEW."assistantMessageId"
          AND "evidenceVersion" = NEW."evidenceVersion"
          AND "evaluationVersion" = NEW."evaluationVersion";
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER discard_training_candidate_after_review_change
AFTER INSERT OR DELETE OR UPDATE OF "assistantMessageId", "evidenceVersion", "evaluationVersion", "decision"
ON "ChatReplyEvaluationReview"
FOR EACH ROW EXECUTE FUNCTION discard_training_candidate_after_review_change();

CREATE FUNCTION discard_training_candidates_after_raw_chat_privacy_event() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    source_message_id TEXT;
    target_id TEXT;
BEGIN
    SELECT raw."sourceId" INTO source_message_id
    FROM "RawMemory" AS raw
    WHERE raw."id" = NEW."rawMemoryId"
      AND raw."userId" = NEW."userId"
      AND raw."sourceType" = 'CHAT_MESSAGE'
      AND NOT EXISTS (
          SELECT 1 FROM "RawMemory" AS newer
          WHERE newer."userId" = raw."userId"
            AND newer."sourceType" = raw."sourceType"
            AND newer."sourceId" = raw."sourceId"
            AND newer."sourceRevision" > raw."sourceRevision"
      )
      AND NOT EXISTS (
          SELECT 1 FROM "RawMemoryEvent" AS newer
          WHERE newer."userId" = NEW."userId"
            AND newer."rawMemoryId" = NEW."rawMemoryId"
            AND newer."eventType" IN ('TOMBSTONE', 'REDACTION_REQUESTED', 'REDACTION', 'RESTORED')
            AND ROW(newer."createdAt", newer."id") > ROW(NEW."createdAt", NEW."id")
      );
    IF source_message_id IS NULL THEN RETURN NULL; END IF;

    -- Lock each job even when no candidate exists yet. Collection rechecks
    -- the raw lifecycle after taking the same lock in ReadCommitted.
    FOR target_id IN
        SELECT job."assistantMessageId"
        FROM "ChatReplyEvaluationJob" AS job
        WHERE job."assistantMessageId" IN (
            SELECT message."id" FROM "ChatMessage" AS message
            WHERE message."userId" = NEW."userId"
              AND (message."id" = source_message_id OR message."replyToMessageId" = source_message_id)
            UNION
            SELECT feedback."messageId" FROM "AiMessageFeedback" AS feedback
            WHERE feedback."userId" = NEW."userId" AND feedback."sourceMessageId" = source_message_id
        )
        ORDER BY job."assistantMessageId"
        FOR UPDATE OF job
    LOOP
        DELETE FROM "ChatReplyTrainingCandidate"
        WHERE "assistantMessageId" = target_id AND "userId" = NEW."userId";
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE TRIGGER discard_training_candidates_after_raw_chat_privacy_event
AFTER INSERT ON "RawMemoryEvent"
FOR EACH ROW
WHEN (NEW."eventType" IN ('TOMBSTONE', 'REDACTION_REQUESTED', 'REDACTION'))
EXECUTE FUNCTION discard_training_candidates_after_raw_chat_privacy_event();

COMMIT;
