import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";

import { evaluateChatReply } from "./chatReplyEvaluation";
import { evaluationVersionOf } from "./chatReplyEvaluationReview";
import { readReplyFeedbackSnapshot } from "./chatReplyFeedback";
import { createChatReplyReviewPacket } from "./chatReplyReviewPacket";
import type { AiModelMessage } from "./types";

type Evaluate = (messages: AiModelMessage[]) => Promise<string>;
type Job = { assistantMessageId: string; revision: number };
type Claim = Job & { leaseToken: string };
type Outcome = "completed" | "failed" | "superseded" | "skipped";

const claimNext = async (cutoff: Date): Promise<Claim | null> => {
  const leaseToken = randomUUID();
  const [job] = await prisma.$queryRaw<Job[]>`
    UPDATE "ChatReplyEvaluationJob" AS job
    SET "leaseToken" = ${leaseToken},
        "leaseUntil" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '2 minutes'
    FROM (
      SELECT "assistantMessageId"
      FROM "ChatReplyEvaluationJob"
      WHERE "packet" IS NULL AND "availableAt" <= (${cutoff.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        AND ("leaseUntil" IS NULL OR "leaseUntil" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
      ORDER BY "availableAt", "assistantMessageId"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ) AS candidate
    WHERE job."assistantMessageId" = candidate."assistantMessageId"
    RETURNING job."assistantMessageId", job."revision"
  `;
  return job ? { ...job, leaseToken } : null;
};

const processClaim = async (claim: Claim, evaluate: Evaluate, cutoff: Date): Promise<Outcome> => {
  const { assistantMessageId } = claim;
  try {
    const leased = await prisma.chatReplyEvaluationJob.findFirst({
      where: claim,
      select: { assistantMessage: { select: { userId: true } } },
    });
    if (!leased) return "superseded";

    const target = { assistantMessageId, userId: leased.assistantMessage.userId };
    const snapshot = await readReplyFeedbackSnapshot(target);
    if (!snapshot) {
      const { count } = await prisma.chatReplyEvaluationJob.deleteMany({ where: claim });
      return count ? "skipped" : "superseded";
    }

    const evaluation = await evaluateChatReply(snapshot, evaluate);
    const packet = await createChatReplyReviewPacket({ ...target, evaluation });
    // Changes to the evidence replace the revision and clear the old lease in the same transaction.
    const { count } = await prisma.chatReplyEvaluationJob.updateMany({
      where: claim,
      data: {
        packet,
        evidenceVersion: snapshot.version,
        evaluationVersion: evaluationVersionOf(evaluation),
        completedAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
      },
    });
    return count ? "completed" : "superseded";
  } catch {
    const { count } = await prisma.chatReplyEvaluationJob.updateMany({
      where: claim,
      data: {
        availableAt: new Date(Math.max(Date.now(), cutoff.getTime() + 1)),
        leaseToken: null,
        leaseUntil: null,
      },
    });
    return count ? "failed" : "superseded";
  }
};

export const runChatReplyEvaluationBatch = async ({ evaluate, limit, cutoff = new Date() }: {
  evaluate: Evaluate;
  limit: number;
  cutoff?: Date;
}): Promise<Record<Outcome, number>> => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("Chat reply evaluation batch limit must be between 1 and 1000");
  }
  const cutoffTime = cutoff.getTime();
  if (!Number.isFinite(new Date(cutoffTime + 1).getTime())) {
    throw new RangeError("Chat reply evaluation batch cutoff must be a valid date");
  }

  const batchCutoff = new Date(cutoffTime);
  const outcomes = { completed: 0, failed: 0, superseded: 0, skipped: 0 };
  for (let index = 0; index < limit; index++) {
    const claim = await claimNext(batchCutoff);
    if (!claim) break;
    outcomes[await processClaim(claim, evaluate, batchCutoff)]++;
  }
  return outcomes;
};
