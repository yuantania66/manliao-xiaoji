import { AssistantPublicationStatus, MessageRole, MessageStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const P4_RAW_RECENT_TOKEN_BUDGET = 4096 as const;
export const P4_RAW_RECENT_MESSAGE_LIMIT = 24 as const;
export const P4_TRUNCATION_MARKER = "[TRUNCATED]" as const;
export const estimateP4Tokens = (text: string) => Buffer.byteLength(text, "utf8");

const truncateToBudget = (content: string, budget: number) => {
  const markerTokens = estimateP4Tokens(P4_TRUNCATION_MARKER);
  if (budget <= markerTokens) return P4_TRUNCATION_MARKER.slice(0, budget);
  let used = 0, prefix = "";
  for (const codePoint of content) {
    const tokens = estimateP4Tokens(codePoint);
    if (used + tokens > budget - markerTokens) break;
    prefix += codePoint; used += tokens;
  }
  return `${prefix}${P4_TRUNCATION_MARKER}`;
};

export const buildP4BoundedContext = async ({
  userId,
  sessionId,
  currentMessageId,
  optionalMemories = [],
}: {
  userId: string;
  sessionId: string;
  currentMessageId: string;
  optionalMemories?: ReadonlyArray<{ id: string; content: string }>;
}) => {
  const messages = await prisma.chatMessage.findMany({
    where: { userId, sessionId, status: MessageStatus.SAVED },
    include: { committedPublication: { select: { status: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const committed = messages.filter((message) =>
    message.role === MessageRole.USER ||
    (message.role === MessageRole.ASSISTANT && message.committedPublication?.status === AssistantPublicationStatus.committed)
  );
  const currentIndex = committed.findIndex((message) => message.id === currentMessageId && message.role === MessageRole.USER);
  if (currentIndex < 0) return { rawRecent: [], optionalMemories: [], tokenCount: 0 };
  const protectedIds = new Set([
    committed[currentIndex - 1]?.id,
    committed[currentIndex]?.id,
    committed[currentIndex + 1]?.id,
  ].filter((id): id is string => Boolean(id)));
  const newestFirst = [...committed].reverse();
  const ordered = [
    ...newestFirst.filter((message) => protectedIds.has(message.id)),
    ...newestFirst.filter((message) => !protectedIds.has(message.id)),
  ].slice(0, P4_RAW_RECENT_MESSAGE_LIMIT);
  const selected: Array<{ id: string; content: string; createdAt: Date; role: MessageRole; truncated: boolean }> = [];
  let remaining = P4_RAW_RECENT_TOKEN_BUDGET;
  for (const [index, message] of ordered.entries()) {
    if (remaining <= 0) break;
    const tokens = estimateP4Tokens(message.content);
    if (tokens <= remaining) {
      selected.push({ id: message.id, content: message.content, createdAt: message.createdAt, role: message.role, truncated: false });
      remaining -= tokens;
    } else if (protectedIds.has(message.id)) {
      const reserved = ordered.slice(index + 1).filter((candidate) => protectedIds.has(candidate.id)).length * estimateP4Tokens(P4_TRUNCATION_MARKER);
      const content = truncateToBudget(message.content, Math.max(0, remaining - reserved));
      selected.push({ id: message.id, content, createdAt: message.createdAt, role: message.role, truncated: true });
      remaining -= estimateP4Tokens(content);
    }
  }
  const optional: Array<{ id: string; content: string; truncated: boolean }> = [];
  for (const memory of optionalMemories) {
    if (remaining <= 0) break;
    const content = estimateP4Tokens(memory.content) <= remaining ? memory.content : truncateToBudget(memory.content, remaining);
    optional.push({ ...memory, content, truncated: content !== memory.content });
    remaining -= estimateP4Tokens(content);
  }
  return {
    rawRecent: selected.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id)),
    optionalMemories: optional,
    tokenCount: P4_RAW_RECENT_TOKEN_BUDGET - remaining,
  };
};
