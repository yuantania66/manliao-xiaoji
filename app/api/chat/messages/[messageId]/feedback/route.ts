import { AiMessageFeedbackSignal, Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

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

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ messageId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { messageId } = await context.params;
    const body = await readJson(request);
    const signal = parseSignal(body.signal);
    const tags = parseTags(body.tags);
    const comment = parseComment(body.comment);

    const message = await prisma.chatMessage.findFirst({
      where: {
        id: messageId,
        userId: user.id,
        role: "ASSISTANT",
      },
      select: {
        id: true,
        aiGenerationId: true,
      },
    });

    if (!message) {
      throw new AppError("NOT_FOUND", "AI 消息不存在", 404);
    }

    const feedback = await prisma.aiMessageFeedback.upsert({
      where: {
        userId_messageId_signal: {
          userId: user.id,
          messageId: message.id,
          signal,
        },
      },
      update: {
        tags: tags ?? Prisma.JsonNull,
        comment,
      },
      create: {
        userId: user.id,
        messageId: message.id,
        aiGenerationId: message.aiGenerationId,
        signal,
        tags: tags ?? Prisma.JsonNull,
        comment,
      },
      select: {
        id: true,
        signal: true,
        createdAt: true,
      },
    });

    return ok(
      {
        id: feedback.id,
        signal: feedback.signal.toLowerCase(),
        createdAt: feedback.createdAt.toISOString(),
      },
      201
    );
  } catch (error) {
    return failFromError(error);
  }
}
