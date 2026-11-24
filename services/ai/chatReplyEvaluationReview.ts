import { createHash } from "node:crypto";
import { ChatReplyReviewDecision, Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

import type { ChatReplyEvaluation } from "./chatReplyEvaluation";
import { readReplyFeedbackSnapshot, readReplyFeedbackSnapshotInTransaction } from "./chatReplyFeedback";

type ReviewTarget = {
  userId: string;
  assistantMessageId: string;
  evaluation: ChatReplyEvaluation;
};

export const evaluationVersionOf = (evaluation: ChatReplyEvaluation) => {
  const canonical = JSON.stringify(evaluation, (_key, value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
    );
  });
  return createHash("sha256").update(canonical).digest("hex");
};

type ReviewInput = ReviewTarget & {
  reviewerId: string;
  decision: ChatReplyReviewDecision;
};

// The reviewer ID must come from the trusted review caller.
export const recordChatReplyEvaluationReview = async (
  input: ReviewInput,
  pendingTransaction?: Prisma.TransactionClient,
) => {
  const { evaluation, userId, assistantMessageId, decision } = input;
  const reviewerId = input.reviewerId.trim();
  if (!reviewerId || !Object.values(ChatReplyReviewDecision).includes(decision)) {
    throw new AppError("VALIDATION_ERROR", "缺少有效的人工审核信息", 400);
  }

  const evidenceVersion = evaluation.evidenceVersion;
  const evaluationVersion = evaluationVersionOf(evaluation);
  const target = { userId, assistantMessageId };
  const snapshot = pendingTransaction
    ? await readReplyFeedbackSnapshotInTransaction(pendingTransaction, target)
    : await readReplyFeedbackSnapshot(target);
  if (!snapshot) throw new AppError("NOT_FOUND", "AI 消息不存在", 404);
  if (snapshot.version !== evidenceVersion) {
    throw new AppError("VALIDATION_ERROR", "评价证据已更新，请复核新版本", 409);
  }

  const data = { assistantMessageId, evidenceVersion: snapshot.version, evaluationVersion, reviewerId, decision };
  const select = { evidenceVersion: true, evaluationVersion: true, decision: true, reviewedAt: true } as const;
  if (pendingTransaction) {
    try {
      return await pendingTransaction.chatReplyEvaluationReview.create({ data, select });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("CONFLICT", "这份评价已经复核，请刷新待审核列表", 409);
      }
      throw error;
    }
  }
  return prisma.chatReplyEvaluationReview.upsert({
    where: { assistantMessageId_evaluationVersion: { assistantMessageId, evaluationVersion } },
    create: data,
    update: { reviewerId, decision },
    select,
  });
};

export const hasApprovedChatReplyEvaluation = async (
  tx: Prisma.TransactionClient,
  { assistantMessageId, evidenceVersion, evaluationVersion }: {
    assistantMessageId: string;
    evidenceVersion: string;
    evaluationVersion: string;
  },
) => {
  const approval = await tx.chatReplyEvaluationReview.findUnique({
    where: { assistantMessageId_evaluationVersion: { assistantMessageId, evaluationVersion } },
    select: { evidenceVersion: true, decision: true },
  });
  return approval?.evidenceVersion === evidenceVersion && approval.decision === ChatReplyReviewDecision.APPROVED;
};

export const readApprovedChatReplyAdvice = ({ evaluation, userId, assistantMessageId }: ReviewTarget) => {
  const evidenceVersion = evaluation.evidenceVersion;
  const evaluationVersion = evaluationVersionOf(evaluation);
  const advice = evaluation.weaknesses.map(({ dimension, nextAction }) => ({ dimension, nextAction }));

  return prisma.$transaction(async (tx) => {
    const snapshot = await readReplyFeedbackSnapshotInTransaction(tx, { userId, assistantMessageId });
    if (!snapshot || snapshot.version !== evidenceVersion) return null;
    if (!await hasApprovedChatReplyEvaluation(tx, { assistantMessageId, evidenceVersion, evaluationVersion })) return null;
    return { evidenceVersion, evaluationVersion, advice };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
};
