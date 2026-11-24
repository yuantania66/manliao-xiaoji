import { Prisma, type ChatReplyReviewDecision } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

import { decideChatReplyReviewPacket, matchesChatReplyReviewPacket, previewChatReplyReviewPacket } from "./chatReplyReviewPacket";
import { canSelectChatReplyTrainingCandidate, prepareChatReplyTrainingCandidate } from "./chatReplyTrainingCandidate";

type QueueReference = { assistantMessageId: string; reviewVersion: string };
type QueueItem = QueueReference & { completedAt: Date };

const pageSize = 20;
const changed = () => new AppError("CONFLICT", "这份评价已更新或已复核，请刷新待审核列表", 409);

export const listPendingChatReplyReviews = async () => {
  const items = await prisma.$queryRaw<QueueItem[]>`
    SELECT job."assistantMessageId", job."completedAt",
           job."revision"::text || ':' || job."evaluationVersion" AS "reviewVersion"
    FROM "ChatReplyEvaluationJob" job
    JOIN "ChatMessage" message ON message.id = job."assistantMessageId"
    JOIN "User" account ON account.id = message."userId" AND account.status = 'ACTIVE'
    JOIN "ChatSession" session ON session.id = message."sessionId" AND session."userId" = message."userId"
    WHERE job.packet IS NOT NULL AND job."evaluationVersion" IS NOT NULL AND job."completedAt" IS NOT NULL
      AND message."contentDeletedAt" IS NULL
      AND message.role = 'ASSISTANT' AND message.status IN ('SAVED', 'FALLBACK', 'REWRITTEN')
      AND NOT EXISTS (
        SELECT 1 FROM "ChatReplyEvaluationReview" review
        WHERE review."assistantMessageId" = job."assistantMessageId"
          AND review."evaluationVersion" = job."evaluationVersion"
          AND review."evidenceVersion" = job."evidenceVersion"
      )
    ORDER BY job."completedAt", job."assistantMessageId"
    LIMIT ${pageSize + 1}
  `;
  return { items: items.slice(0, pageSize), hasMore: items.length > pageSize };
};

const readPendingPacket = async (tx: Prisma.TransactionClient, { assistantMessageId, reviewVersion }: QueueReference) => {
  const job = await tx.chatReplyEvaluationJob.findUnique({
    where: { assistantMessageId, assistantMessage: { contentDeletedAt: null } },
    select: { packet: true, revision: true, evidenceVersion: true, evaluationVersion: true, completedAt: true },
  });
  if (!job) throw new AppError("NOT_FOUND", "这份评价已不可用", 404);
  if (!job.packet || !job.completedAt || !job.evidenceVersion || !job.evaluationVersion ||
      `${job.revision}:${job.evaluationVersion}` !== reviewVersion ||
      !matchesChatReplyReviewPacket(job.packet, {
        assistantMessageId, evidenceVersion: job.evidenceVersion, evaluationVersion: job.evaluationVersion,
      })) throw changed();

  const decision = await tx.chatReplyEvaluationReview.findUnique({
    where: { assistantMessageId_evaluationVersion: { assistantMessageId, evaluationVersion: job.evaluationVersion } },
    select: { decision: true },
  });
  if (decision) throw changed();
  return job.packet;
};

export const previewPendingChatReplyReview = (reference: QueueReference) =>
  prisma.$transaction(async (tx) => {
    const preview = await previewChatReplyReviewPacket(await readPendingPacket(tx, reference), tx);
    return { ...preview, trainingCandidateEligible: await canSelectChatReplyTrainingCandidate(tx, preview) };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });

export const decidePendingChatReplyReview = (
  reference: QueueReference,
  reviewerId: string,
  decision: ChatReplyReviewDecision,
  selectTrainingCandidate = false,
) =>
  prisma.$transaction(async (tx) => {
    if (selectTrainingCandidate) {
      await tx.$queryRaw`SELECT owner.id FROM "User" owner JOIN "ChatMessage" message ON message."userId" = owner.id
        WHERE message.id = ${reference.assistantMessageId} FOR KEY SHARE OF owner`;
    }
    // Match the deletion path's lock order. Holding the job keeps source edits
    // from invalidating the revision while the reviewer records this decision.
    await tx.$queryRaw`SELECT id FROM "ChatMessage" WHERE id = ${reference.assistantMessageId} FOR KEY SHARE`;
    await tx.$queryRaw`SELECT "assistantMessageId" FROM "ChatReplyEvaluationJob"
      WHERE "assistantMessageId" = ${reference.assistantMessageId} FOR UPDATE`;
    const packet = await readPendingPacket(tx, reference);
    const candidate = selectTrainingCandidate && decision === "APPROVED"
      ? await prepareChatReplyTrainingCandidate(tx, packet) : null;
    const review = await decideChatReplyReviewPacket({ packet, reviewerId, decision, pendingTransaction: tx });
    if (!candidate) return review;
    await tx.chatReplyTrainingCandidate.create({
      data: {
        assistantMessageId: reference.assistantMessageId,
        evidenceVersion: review.evidenceVersion,
        evaluationVersion: review.evaluationVersion,
        ...candidate,
      },
    });
    return { ...review, trainingCandidateSelected: true as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
