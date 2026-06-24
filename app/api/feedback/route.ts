import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const FEEDBACK_TYPES = new Set(["使用问题", "功能建议", "其他"]);

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

const parseOptionalString = (value: unknown, field: string, maxLength: number) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_ERROR", `${field} 必须是字符串`, 400, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new AppError("VALIDATION_ERROR", `${field} 不能超过 ${maxLength} 个字符`, 400, {
      field,
      maxLength,
    });
  }
  return trimmed || null;
};

const parseFeedbackType = (value: unknown) => {
  if (typeof value !== "string" || !FEEDBACK_TYPES.has(value)) {
    throw new AppError("VALIDATION_ERROR", "反馈类型不支持", 400, {
      field: "type",
      allowed: [...FEEDBACK_TYPES],
    });
  }
  return value;
};

const parseContent = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("VALIDATION_ERROR", "请先写一点反馈", 400, { field: "content" });
  }
  const content = value.trim();
  if (content.length > 300) {
    throw new AppError("VALIDATION_ERROR", "反馈内容不能超过 300 个字符", 400, {
      field: "content",
      maxLength: 300,
    });
  }
  return content;
};

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    const body = await readJson(request);
    const type = parseFeedbackType(body.type);
    const content = parseContent(body.content);
    const contact = parseOptionalString(body.contact, "contact", 100);
    const userAgent = parseOptionalString(request.headers.get("user-agent"), "userAgent", 300);

    const feedback = await prisma.feedback.create({
      data: {
        userId: user?.id,
        type,
        content,
        contact,
        userAgent,
      },
      select: {
        id: true,
        type: true,
        createdAt: true,
      },
    });

    return ok({
      id: feedback.id,
      type: feedback.type,
      createdAt: feedback.createdAt.toISOString(),
    }, 201);
  } catch (error) {
    return failFromError(error);
  }
}
