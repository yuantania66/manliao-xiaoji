BEGIN;

CREATE TABLE "ChatReplyEvaluationJob" (
    "assistantMessageId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "evidenceVersion" TEXT,
    "packet" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ChatReplyEvaluationJob_pkey" PRIMARY KEY ("assistantMessageId")
);

CREATE INDEX "ChatReplyEvaluationJob_ready_idx"
ON "ChatReplyEvaluationJob"("availableAt", "assistantMessageId")
WHERE "packet" IS NULL;

ALTER TABLE "ChatReplyEvaluationJob"
ADD CONSTRAINT "ChatReplyEvaluationJob_assistantMessageId_fkey"
FOREIGN KEY ("assistantMessageId") REFERENCES "ChatMessage"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION refresh_chat_reply_evaluation_job(target_id TEXT) RETURNS VOID
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
        "packet" = NULL,
        "completedAt" = NULL;

    IF NOT FOUND THEN
        DELETE FROM "ChatReplyEvaluationJob" WHERE "assistantMessageId" = target_id;
    END IF;
END;
$$;

CREATE FUNCTION refresh_evaluations_from_chat_message() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    target_id TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."role" = 'ASSISTANT' AND NEW."status" IN ('SAVED', 'FALLBACK', 'REWRITTEN') THEN
            PERFORM refresh_chat_reply_evaluation_job(NEW."id");
        END IF;
        RETURN NEW;
    END IF;

    IF ROW(OLD."id", OLD."role", OLD."status", OLD."userId", OLD."sessionId", OLD."createdAt", OLD."content", OLD."replyToMessageId")
       IS NOT DISTINCT FROM
       ROW(NEW."id", NEW."role", NEW."status", NEW."userId", NEW."sessionId", NEW."createdAt", NEW."content", NEW."replyToMessageId") THEN
        RETURN NEW;
    END IF;

    IF OLD."role" = 'ASSISTANT' OR NEW."role" = 'ASSISTANT' THEN
        PERFORM refresh_chat_reply_evaluation_job(NEW."id");
    END IF;

    IF (OLD."role" = 'USER' OR NEW."role" = 'USER') AND
        ROW(OLD."id", OLD."role", OLD."status", OLD."userId", OLD."sessionId", OLD."createdAt", OLD."content")
        IS DISTINCT FROM
        ROW(NEW."id", NEW."role", NEW."status", NEW."userId", NEW."sessionId", NEW."createdAt", NEW."content") THEN
        FOR target_id IN
            SELECT "id" FROM "ChatMessage" WHERE "replyToMessageId" IN (OLD."id", NEW."id")
            UNION
            SELECT "messageId" FROM "AiMessageFeedback" WHERE "sourceMessageId" IN (OLD."id", NEW."id")
            ORDER BY 1
        LOOP
            PERFORM refresh_chat_reply_evaluation_job(target_id);
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER refresh_evaluations_from_chat_message
AFTER INSERT OR UPDATE OF "id", "role", "status", "userId", "sessionId", "createdAt", "content", "replyToMessageId"
ON "ChatMessage"
FOR EACH ROW EXECUTE FUNCTION refresh_evaluations_from_chat_message();

CREATE FUNCTION refresh_evaluations_from_reply_feedback() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM refresh_chat_reply_evaluation_job(OLD."messageId");
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF ROW(OLD."id", OLD."userId", OLD."messageId", OLD."sourceMessageId", OLD."signal", OLD."tags", OLD."comment")
           IS NOT DISTINCT FROM
           ROW(NEW."id", NEW."userId", NEW."messageId", NEW."sourceMessageId", NEW."signal", NEW."tags", NEW."comment") THEN
            RETURN NEW;
        END IF;
        IF OLD."messageId" <> NEW."messageId" THEN
            PERFORM refresh_chat_reply_evaluation_job(OLD."messageId");
        END IF;
    END IF;

    PERFORM refresh_chat_reply_evaluation_job(NEW."messageId");
    RETURN NEW;
END;
$$;

CREATE TRIGGER refresh_evaluations_from_reply_feedback
AFTER INSERT OR DELETE OR UPDATE OF "id", "userId", "messageId", "sourceMessageId", "signal", "tags", "comment"
ON "AiMessageFeedback"
FOR EACH ROW EXECUTE FUNCTION refresh_evaluations_from_reply_feedback();

COMMIT;
