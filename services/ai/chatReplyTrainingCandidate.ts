import type { Prisma } from "@prisma/client";

import { chatReplyTrainingNoticeVersion } from "@/lib/chat-reply-training-consent";
import { AppError } from "@/lib/errors";

import { previewChatReplyReviewPacket, rawSourcesAreCurrent } from "./chatReplyReviewPacket";

type Preview = Awaited<ReturnType<typeof previewChatReplyReviewPacket>>;

const dimensions = ["understanding", "responsiveness", "boundaries", "expression"] as const;
const unavailable = () => new AppError("CONFLICT", "这条评价目前无法选为训练候选，仍可单独复核", 409);

const authorizedTrainingSource = async (tx: Prisma.TransactionClient, preview: Preview, lock = false) => {
  const { userMessage: original, assistantMessage, feedback } = preview.evidence;
  if (!original) return null;
  const target = await tx.chatMessage.findUnique({
    where: { id: preview.assistantMessageId, contentDeletedAt: null, user: { status: "ACTIVE" } },
    select: {
      userId: true,
      createdAt: true,
      replyToMessage: { select: { id: true, createdAt: true } },
    },
  });
  if (target?.replyToMessage?.id !== original.id) return null;

  const userId = target.userId;
  const consent = lock
    ? (await tx.$queryRaw<Array<{ grantedAt: Date }>>`
        SELECT "grantedAt" FROM "ChatReplyTrainingConsent"
        WHERE "userId" = ${userId} AND "noticeVersion" = ${chatReplyTrainingNoticeVersion}
        FOR KEY SHARE
      `)[0]
    : await tx.chatReplyTrainingConsent.findUnique({
      where: { userId, noticeVersion: chatReplyTrainingNoticeVersion },
      select: { grantedAt: true },
    });
  if (!consent || target.replyToMessage.createdAt < consent.grantedAt || target.createdAt < consent.grantedAt) return null;
  const sources = [assistantMessage, original, ...feedback.flatMap(({ sourceMessage }) => sourceMessage ? [sourceMessage] : [])];
  return await rawSourcesAreCurrent(tx, userId, sources) ? userId : null;
};

export const canSelectChatReplyTrainingCandidate = async (tx: Prisma.TransactionClient, preview: Preview) =>
  Boolean(await authorizedTrainingSource(tx, preview));

export const prepareChatReplyTrainingCandidate = async (tx: Prisma.TransactionClient, packet: string) => {
  const preview = await previewChatReplyReviewPacket(packet, tx);
  const userId = await authorizedTrainingSource(tx, preview, true);
  if (!userId) throw unavailable();

  const { scores, strengths, weaknesses } = preview.evaluation;
  if (dimensions.some((dimension) => {
    const score = scores?.[dimension]?.score;
    return !Number.isInteger(score) || score < 1 || score > 5;
  }) || !Array.isArray(strengths) || !Array.isArray(weaknesses)) throw unavailable();

  // Only finite rubric dimensions and numeric ratings become candidate material.
  // Source IDs and review versions stay in the internal deletion record.
  return {
    userId,
    material: {
      scores: Object.fromEntries(dimensions.map((dimension) => [dimension, scores[dimension].score])),
      strengths: dimensions.filter((dimension) => strengths.some((item) => item?.dimension === dimension)),
      weaknesses: dimensions.filter((dimension) => weaknesses.some((item) => item?.dimension === dimension)),
    },
  };
};
