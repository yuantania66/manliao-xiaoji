import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isValidDateOnly, parsePagination, requireNonEmptyString } from "@/lib/validation";

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

const getTodayInShanghai = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const parseRecordDate = (value: unknown) => {
  const dateText = value === undefined || value === null ? getTodayInShanghai() : value;
  if (typeof dateText !== "string" || !isValidDateOnly(dateText)) {
    throw new AppError("VALIDATION_ERROR", "recordDate 必须是 YYYY-MM-DD", 400, {
      field: "recordDate",
    });
  }
  return new Date(`${dateText}T00:00:00.000Z`);
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

const parseMediaUrls = (value: unknown) => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new AppError("VALIDATION_ERROR", "mediaUrls 必须是数组", 400, { field: "mediaUrls" });
  }

  const items = value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new AppError("VALIDATION_ERROR", "mediaUrls 只能包含非空字符串", 400, {
        field: `mediaUrls.${index}`,
      });
    }
    return item.trim();
  });

  if (items.length > 9) {
    throw new AppError("VALIDATION_ERROR", "mediaUrls 不能超过 9 个", 400, { field: "mediaUrls" });
  }

  return items;
};

const parseStringArrayJson = (value: unknown, field: string) => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new AppError("VALIDATION_ERROR", `${field} 必须是数组`, 400, { field });
  }
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
};

const serializeNote = (note: {
  id: string;
  content: string;
  moodName: string | null;
  moodIcon: string | null;
  mediaUrls: unknown;
  recordDate: Date;
  coreEventIds?: unknown;
  emotionSliceIds?: unknown;
  generatedFromChatIds?: unknown;
  isDraft?: boolean;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: note.id,
  content: note.content,
  moodName: note.moodName,
  moodIcon: note.moodIcon,
  mediaUrls: Array.isArray(note.mediaUrls) ? note.mediaUrls : [],
  recordDate: note.recordDate.toISOString().slice(0, 10),
  coreEventIds: Array.isArray(note.coreEventIds) ? note.coreEventIds : [],
  emotionSliceIds: Array.isArray(note.emotionSliceIds) ? note.emotionSliceIds : [],
  generatedFromChatIds: Array.isArray(note.generatedFromChatIds) ? note.generatedFromChatIds : [],
  isDraft: Boolean(note.isDraft),
  createdAt: note.createdAt.toISOString(),
  updatedAt: note.updatedAt.toISOString(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const pagination = parsePagination(searchParams);
    const date = searchParams.get("date");

    if (date && !isValidDateOnly(date)) {
      throw new AppError("VALIDATION_ERROR", "date 必须是 YYYY-MM-DD", 400, { field: "date" });
    }

    const where = {
      userId: user.id,
      ...(date ? { recordDate: new Date(`${date}T00:00:00.000Z`) } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.note.findMany({
        where,
        orderBy: [{ recordDate: "desc" }, { createdAt: "desc" }],
        skip: pagination.skip,
        take: pagination.take,
        select: {
          id: true,
          content: true,
          moodName: true,
          moodIcon: true,
          mediaUrls: true,
          recordDate: true,
          coreEventIds: true,
          emotionSliceIds: true,
          generatedFromChatIds: true,
          isDraft: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.note.count({ where }),
    ]);

    return ok({
      items: items.map(serializeNote),
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
    });
  } catch (error) {
    return failFromError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);
    const content = requireNonEmptyString(body.content, "content", 500);
    const recordDate = parseRecordDate(body.recordDate);
    const moodName = parseOptionalString(body.moodName, "moodName", 20);
    const moodIcon = parseOptionalString(body.moodIcon, "moodIcon", 20);
    const mediaUrls = parseMediaUrls(body.mediaUrls);
    const coreEventIds = parseStringArrayJson(body.coreEventIds, "coreEventIds");
    const emotionSliceIds = parseStringArrayJson(body.emotionSliceIds, "emotionSliceIds");
    const generatedFromChatIds = parseStringArrayJson(body.generatedFromChatIds, "generatedFromChatIds");
    const isDraft =
      body.isDraft === undefined
        ? false
        : typeof body.isDraft === "boolean"
          ? body.isDraft
          : (() => {
              throw new AppError("VALIDATION_ERROR", "isDraft 必须是布尔值", 400, {
                field: "isDraft",
              });
            })();

    const note = await prisma.note.create({
      data: {
        userId: user.id,
        content,
        recordDate,
        moodName,
        moodIcon,
        mediaUrls,
        coreEventIds,
        emotionSliceIds,
        generatedFromChatIds,
        isDraft,
      },
      select: {
        id: true,
        content: true,
        moodName: true,
        moodIcon: true,
        mediaUrls: true,
        recordDate: true,
        coreEventIds: true,
        emotionSliceIds: true,
        generatedFromChatIds: true,
        isDraft: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return ok(serializeNote(note), 201);
  } catch (error) {
    return failFromError(error);
  }
}
