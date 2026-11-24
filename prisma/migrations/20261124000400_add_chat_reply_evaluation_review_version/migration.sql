BEGIN;

ALTER TABLE "ChatReplyEvaluationJob" ADD COLUMN "evaluationVersion" TEXT;

UPDATE "ChatReplyEvaluationJob"
SET "revision" = "revision" + 1,
    "availableAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
    "leaseToken" = NULL,
    "leaseUntil" = NULL,
    "evidenceVersion" = NULL,
    "packet" = NULL,
    "completedAt" = NULL
WHERE "evaluationVersion" IS NULL
  AND ("packet" IS NOT NULL OR "completedAt" IS NOT NULL);

CREATE INDEX "ChatReplyEvaluationJob_ready_review_idx"
ON "ChatReplyEvaluationJob"("completedAt", "assistantMessageId")
WHERE "packet" IS NOT NULL AND "evaluationVersion" IS NOT NULL AND "completedAt" IS NOT NULL;

CREATE OR REPLACE FUNCTION refresh_chat_reply_evaluation_job(target_id TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "ChatReplyEvaluationJob" ("assistantMessageId", "availableAt")
    SELECT message."id", CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
    FROM "ChatMessage" AS message
    JOIN "User" AS owner ON owner."id" = message."userId"
    JOIN "ChatSession" AS session ON session."id" = message."sessionId"
    WHERE message."id" = target_id
      AND message."role" = 'ASSISTANT'
      AND message."status" IN ('SAVED', 'FALLBACK', 'REWRITTEN')
      AND owner."status" = 'ACTIVE'
      AND session."userId" = message."userId"
    FOR SHARE OF message
    ON CONFLICT ("assistantMessageId") DO UPDATE
    SET "revision" = "ChatReplyEvaluationJob"."revision" + 1,
        "availableAt" = EXCLUDED."availableAt",
        "leaseToken" = NULL,
        "leaseUntil" = NULL,
        "evidenceVersion" = NULL,
        "evaluationVersion" = NULL,
        "packet" = NULL,
        "completedAt" = NULL;

    IF NOT FOUND THEN
        DELETE FROM "ChatReplyEvaluationJob" WHERE "assistantMessageId" = target_id;
    END IF;
END;
$$;

COMMIT;
