BEGIN;

CREATE TYPE "ChatReplyReviewDecision" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE "ChatReplyEvaluationReview" (
    "id" TEXT NOT NULL,
    "assistantMessageId" TEXT NOT NULL,
    "evidenceVersion" TEXT NOT NULL,
    "evaluationVersion" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "ChatReplyReviewDecision" NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatReplyEvaluationReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatReplyEvaluationReview_message_evaluation_key"
ON "ChatReplyEvaluationReview"("assistantMessageId", "evaluationVersion");

ALTER TABLE "ChatReplyEvaluationReview"
ADD CONSTRAINT "ChatReplyEvaluationReview_assistantMessageId_fkey"
FOREIGN KEY ("assistantMessageId") REFERENCES "ChatMessage"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
