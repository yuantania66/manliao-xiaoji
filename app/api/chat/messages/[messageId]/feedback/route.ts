import { AiMessageFeedbackSignal } from "@prisma/client";
import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { recordChatReplyFeedback } from "@/services/ai/chatReplyFeedback";

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

const parseSignal = (value: unknown) => {
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_ERROR", "signal 必须是字符串", 400, { field: "signal" });
  }
  const normalized = value.trim().toUpperCase();
  if (!Object.values(AiMessageFeedbackSignal).includes(normalized as AiMessageFeedbackSignal)) {
    throw new AppError("VALIDATION_ERROR", "signal 不支持", 400, {
      field: "signal",
      allowed: Object.values(AiMessageFeedbackSignal),
    });
  }
  return normalized as AiMessageFeedbackSignal;
};

const parseTags = (value: unknown) => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new AppError("VALIDATION_ERROR", "tags 必须是数组", 400, { field: "tags" });
  }
  const tags = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  return tags.length > 0 ? tags : null;
};

const parseComment = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_ERROR", "comment 必须是字符串", 400, { field: "comment" });
  }
  const comment = value.trim();
  if (comment.length > 240) {
    throw new AppError("VALIDATION_ERROR", "comment 不能超过 240 个字符", 400, {
      field: "comment",
      maxLength: 240,
    });
  }
  return comment || null;
};

const parseSourceMessageId = (value: unknown) => {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 160) {
    throw new AppError("VALIDATION_ERROR", "sourceMessageId 必须是有效的消息 ID", 400, {
      field: "sourceMessageId",
    });
  }
  return value.trim();
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ messageId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { messageId } = await context.params;
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AppError("VALIDATION_ERROR", "请求体必须是对象", 400);
    }
    const signal = parseSignal(body.signal);
    const tags = parseTags(body.tags);
    const comment = parseComment(body.comment);

    const feedback = await recordChatReplyFeedback({
      userId: user.id,
      assistantMessageId: messageId,
      signal,
      tags,
      comment,
      sourceMessageId: parseSourceMessageId(body.sourceMessageId),
    });

    return ok(
      {
        id: feedback.id,
        signal: feedback.signal.toLowerCase(),
        createdAt: feedback.createdAt.toISOString(),
        updatedAt: feedback.updatedAt.toISOString(),
      },
      201
    );
  } catch (error) {
    return failFromError(error);
  }
}
