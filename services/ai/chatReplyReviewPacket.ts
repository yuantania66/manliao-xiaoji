import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { Prisma, type ChatReplyReviewDecision } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

import type { ChatReplyEvaluation } from "./chatReplyEvaluation";
import { evaluationVersionOf, hasApprovedChatReplyEvaluation, recordChatReplyEvaluationReview } from "./chatReplyEvaluationReview";
import { readReplyFeedbackSnapshot, readReplyFeedbackSnapshotInTransaction } from "./chatReplyFeedback";

type ReviewDraft = {
  userId: string;
  assistantMessageId: string;
  evaluation: ChatReplyEvaluation;
};

const maxPacketLength = 128_000;
const invalidPacket = () => new AppError("VALIDATION_ERROR", "评价包无效，请使用后台生成的评价包", 400);

const reviewKey = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret?.trim() || Buffer.byteLength(secret) < 32 || secret === "replace-with-a-long-random-secret") {
    throw new AppError("INTERNAL_ERROR", "评价包服务未配置", 500);
  }
  return createHmac("sha256", secret).update("xinqing:chat-reply-review:v1").digest();
};

const assertCurrentEvidence = async ({ userId, assistantMessageId, evaluation }: ReviewDraft, tx?: Prisma.TransactionClient) => {
  const target = { userId, assistantMessageId };
  const snapshot = tx ? await readReplyFeedbackSnapshotInTransaction(tx, target) : await readReplyFeedbackSnapshot(target);
  if (!snapshot) throw new AppError("NOT_FOUND", "评价对应的回复已不可用", 404);
  if (snapshot.version !== evaluation.evidenceVersion) {
    throw new AppError("VALIDATION_ERROR", "评价证据已更新，请使用新评价包", 409);
  }
  return snapshot;
};

// Called by the internal evaluator after validating the draft. The packet
// travels separately from the decision and does not copy chat text to a new table.
export const createChatReplyReviewPacket = async (input: ReviewDraft) => {
  const { userId, assistantMessageId, evaluation } = structuredClone(input);
  if (evaluation.reviewStatus !== "pending_human_review") throw invalidPacket();
  await assertCurrentEvidence({ userId, assistantMessageId, evaluation });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", reviewKey(), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ userId, assistantMessageId, evaluation }), "utf8"),
    cipher.final(),
  ]);
  const packet = ["v1", nonce.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  if (packet.length > maxPacketLength) throw invalidPacket();
  return packet;
};

const openReviewPacket = (packet: string): ReviewDraft => {
  if (packet.length > maxPacketLength || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(packet)) {
    throw invalidPacket();
  }
  const [nonce, ciphertext, tag] = packet.split(".").slice(1).map((part) => {
    const bytes = Buffer.from(part, "base64url");
    if (bytes.toString("base64url") !== part) throw invalidPacket();
    return bytes;
  });
  if (nonce.length !== 12 || tag.length !== 16) throw invalidPacket();
  const key = reviewKey();
  let draft: ReviewDraft;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    draft = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
  } catch {
    throw invalidPacket();
  }
  if (!draft?.userId || !draft.assistantMessageId || draft.evaluation?.reviewStatus !== "pending_human_review") {
    throw invalidPacket();
  }
  return draft;
};

export const matchesChatReplyReviewPacket = (packet: string, expected: {
  assistantMessageId: string;
  evidenceVersion: string;
  evaluationVersion: string;
}) => {
  try {
    const draft = openReviewPacket(packet);
    return draft.assistantMessageId === expected.assistantMessageId &&
      draft.evaluation.evidenceVersion === expected.evidenceVersion &&
      evaluationVersionOf(draft.evaluation) === expected.evaluationVersion;
  } catch (error) {
    if (error instanceof AppError) return false;
    throw error;
  }
};

export const previewChatReplyReviewPacket = async (packet: string, tx?: Prisma.TransactionClient) => {
  const draft = openReviewPacket(packet);
  const { assistantMessage, userMessage, feedback } = await assertCurrentEvidence(draft, tx);
  return {
    assistantMessageId: draft.assistantMessageId,
    evaluation: draft.evaluation,
    evidence: {
      assistantMessage,
      userMessage,
      feedback: feedback.map(({ signal, comment, sourceMessage }) => ({ signal, comment, sourceMessage })),
    },
  };
};

export const decideChatReplyReviewPacket = ({ packet, reviewerId, decision, pendingTransaction }: {
  packet: string;
  reviewerId: string;
  decision: ChatReplyReviewDecision;
  pendingTransaction?: Prisma.TransactionClient;
}) => recordChatReplyEvaluationReview({ ...openReviewPacket(packet), reviewerId, decision }, pendingTransaction);

type SourceText = { id: string; content: string };

export const rawSourcesAreCurrent = async (tx: Prisma.TransactionClient, userId: string, sources: SourceText[]) => {
  const contentById = new Map(sources.map(({ id, content }) => [id, content]));
  const latestRaw = await tx.rawMemory.findMany({
    where: { userId, sourceType: "CHAT_MESSAGE", sourceId: { in: [...contentById.keys()] } },
    orderBy: [{ sourceId: "asc" }, { sourceRevision: "desc" }],
    distinct: ["sourceId"],
    select: {
      sourceId: true,
      content: true,
      events: {
        where: { userId, eventType: { in: ["TOMBSTONE", "REDACTION", "REDACTION_REQUESTED", "RESTORED"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { eventType: true },
      },
    },
  });
  return latestRaw.every(({ sourceId, content, events }) =>
    contentById.get(sourceId) === content && (!events[0] || events[0].eventType === "RESTORED"));
};

const normalizedCopyText = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");

const safeNextAction = (value: string, identifiers: string[], sourceContent: string[], quotes: string[]) => {
  const exampleStart = value.search(/(?:^|[，,。；;：:（(\s])(?:例如|比如)/u);
  const action = (exampleStart < 0 ? value : value.slice(0, exampleStart + (value[exampleStart] === "。" ? 1 : 0))).trim();
  const shape = action.normalize("NFKC");
  if (!action || [...action].length > 120 || !/\p{L}/u.test(action) ||
      /[\p{C}\p{Zl}\p{Zp}`<>\[\]{}\\#*|"'“”‘’「」『』《》〈〉【】〔〕〖〗]/u.test(shape) ||
      /(?:例如|比如|https?:\/\/|www\.)|(?:^|[\s。；;])(?:system|assistant|developer|user|tool|系统|开发者|助手|用户)\s*[:：]|^(?:[-+]|\d+[.)、])\s/iu.test(shape)) return null;

  const normalized = normalizedCopyText(action);
  if (identifiers.some((id) => id && shape.toLowerCase().includes(id.normalize("NFKC").toLowerCase())) ||
      quotes.some((quote) => {
        const normalizedQuote = normalizedCopyText(quote);
        return normalizedQuote && normalized.includes(normalizedQuote);
      })) return null;

  // Omit unmarked verbatim excerpts as well as whole messages and cited quotes.
  const characters = [...normalized];
  const excerptLength = 10;
  const excerpts = characters.slice(excerptLength - 1).map((_, index) => characters.slice(index, index + excerptLength).join(""));
  if (sourceContent.some((content) => {
    const source = normalizedCopyText(content);
    return source && (normalized.includes(source) || excerpts.some((excerpt) => source.includes(excerpt)));
  })) return null;

  return action;
};

export const readApprovedChatReplyAdviceForSource = async ({ userId, sourceTurnId, text }: {
  userId: string;
  sourceTurnId: string;
  text: string;
}): Promise<string | null> => {
  if (!userId || !sourceTurnId || !text.trim()) return null;
  return prisma.$transaction(async (tx) => {
    const target = await tx.chatMessage.findUnique({
      where: { replyToMessageId: sourceTurnId, userId, role: "ASSISTANT", contentDeletedAt: null, user: { status: "ACTIVE" }, session: { userId } },
      select: {
        id: true,
        evaluationJob: { select: { packet: true, evidenceVersion: true, evaluationVersion: true, completedAt: true } },
        feedbacks: { where: { userId, sourceMessageId: { not: null } }, select: { id: true } },
      },
    });
    const completed = target?.evaluationJob;
    if (!target || !completed?.packet || !completed.completedAt || !completed.evidenceVersion || !completed.evaluationVersion) return null;

    let draft: ReviewDraft;
    try {
      draft = openReviewPacket(completed.packet);
    } catch (error) {
      if (error instanceof AppError) return null;
      throw error;
    }
    const { evaluation } = draft;
    const { evidenceVersion, evaluationVersion } = completed;
    const assistantMessageId = target.id;
    if (draft.userId !== userId || draft.assistantMessageId !== assistantMessageId ||
        evaluation.evidenceVersion !== evidenceVersion || evaluationVersionOf(evaluation) !== evaluationVersion) return null;
    if (!await hasApprovedChatReplyEvaluation(tx, { assistantMessageId, evidenceVersion, evaluationVersion })) return null;

    const snapshot = await readReplyFeedbackSnapshotInTransaction(tx, { userId, assistantMessageId });
    if (!snapshot || snapshot.version !== evidenceVersion ||
        snapshot.userMessage?.id !== sourceTurnId || snapshot.userMessage.content !== text) return null;
    const linkedFeedback = snapshot.feedback.flatMap(({ sourceMessage }) => sourceMessage ? [sourceMessage] : []);
    if (linkedFeedback.length !== target.feedbacks.length) return null;
    const sources = [snapshot.userMessage, snapshot.assistantMessage, ...linkedFeedback];
    if (!await rawSourcesAreCurrent(tx, userId, sources)) return null;

    if (!Array.isArray(evaluation.weaknesses) || !evaluation.weaknesses.length ||
        !Array.isArray(evaluation.strengths) || !evaluation.scores || !evaluation.reportedImpact) return null;
    const comments = snapshot.feedback.map(({ id, comment }) => ({ id: `feedback:${id}`, content: comment ?? "" }));
    const evidenceSources = new Map([...sources, ...comments].map(({ id, content }) => [id, content]));
    const validQuote = (reference: { sourceId: string; quote: string } | null) =>
      typeof reference?.quote === "string" && reference.quote.trim() && evidenceSources.get(reference.sourceId)?.includes(reference.quote);
    const cited = [...Object.values(evaluation.scores), ...evaluation.strengths, ...evaluation.weaknesses];
    if (cited.some((item) => !Array.isArray(item?.evidence) || !item.evidence.length ||
        !item.evidence.every(validQuote))) return null;
    const identifiers = [userId, ...evidenceSources.keys(), ...snapshot.feedback.map(({ id }) => id)];
    const sourceContent = [...evidenceSources.values()];
    const quotes = cited.flatMap(({ evidence }) => evidence.map(({ quote }) => quote));
    if (evaluation.reportedImpact.status === "user_reported") {
      if (!validQuote(evaluation.reportedImpact)) return null;
      quotes.push(evaluation.reportedImpact.quote);
    } else if (evaluation.reportedImpact.status !== "unknown") return null;

    for (const { evidence, nextAction } of evaluation.weaknesses) {
      if (typeof nextAction !== "string" || !evidence.some(({ sourceId }) => sourceId === sourceTurnId)) continue;
      const action = safeNextAction(nextAction, identifiers, sourceContent, quotes);
      if (action) return action;
    }
    return null;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
};
