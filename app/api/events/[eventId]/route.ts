import { EventStatus } from "@prisma/client";
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

const optionalString = (value: unknown, field: string, maxLength: number) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_ERROR", `${field} 必须是字符串`, 400, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new AppError("VALIDATION_ERROR", `${field} 不能超过 ${maxLength} 个字符`, 400, {
      field,
    });
  }
  return trimmed || null;
};

const optionalRequiredString = (value: unknown, field: string, maxLength: number) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("VALIDATION_ERROR", `${field} 不能为空`, 400, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new AppError("VALIDATION_ERROR", `${field} 不能超过 ${maxLength} 个字符`, 400, {
      field,
    });
  }
  return trimmed;
};

const optionalNumber = (value: unknown, field: string, min: number, max: number) => {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new AppError("VALIDATION_ERROR", `${field} 必须是 ${min} 到 ${max} 的数字`, 400, {
      field,
    });
  }
  return number;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { eventId } = await context.params;
    const body = await readJson(request);

    const title = optionalRequiredString(body.title, "title", 80);
    const description = optionalString(body.description, "description", 500);
    const category = optionalString(body.category, "category", 40);
    const importanceScore = optionalNumber(body.importanceScore, "importanceScore", 0, 1);
    const isCoreEvent =
      body.isCoreEvent === undefined
        ? undefined
        : typeof body.isCoreEvent === "boolean"
          ? body.isCoreEvent
          : (() => {
              throw new AppError("VALIDATION_ERROR", "isCoreEvent 必须是布尔值", 400, {
                field: "isCoreEvent",
              });
            })();
    const status =
      body.status === undefined
        ? undefined
        : typeof body.status === "string" && body.status.toUpperCase() in EventStatus
          ? (body.status.toUpperCase() as EventStatus)
          : (() => {
              throw new AppError("VALIDATION_ERROR", "status 无效", 400, { field: "status" });
            })();

    const ownedEvent = await prisma.event.findFirst({
      where: { id: eventId, userId: user.id },
      select: { id: true },
    });
    if (!ownedEvent) throw new AppError("NOT_FOUND", "事件不存在", 404);

    const event = await prisma.event.update({
      where: { id: ownedEvent.id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(importanceScore !== undefined ? { importanceScore } : {}),
        ...(isCoreEvent !== undefined ? { isCoreEvent } : {}),
        ...(status !== undefined ? { status } : {}),
      },
      select: {
        id: true,
        title: true,
        description: true,
        eventDate: true,
        category: true,
        importanceScore: true,
        isCoreEvent: true,
        status: true,
        updatedAt: true,
      },
    });

    return ok({
      ...event,
      eventDate: event.eventDate.toISOString().slice(0, 10),
      status: event.status.toLowerCase(),
      updatedAt: event.updatedAt.toISOString(),
    });
  } catch (error) {
    return failFromError(error);
  }
}
