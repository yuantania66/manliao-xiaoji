import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isValidDateOnly, parsePagination, requireNonEmptyString } from "@/lib/validation";
import { createRawMemoryFromNote } from "@/services/memory/rawMemoryService";
import { tokenMatches, uploadIdFromUrl } from "@/app/api/uploads/notes/storage";

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

const parseContent = (value: unknown) => {
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_ERROR", "content 必须是字符串", 400, { field: "content" });
  }
  const content = value.trim();
  if (content.length > 500) {
    throw new AppError("VALIDATION_ERROR", "content 不能超过 500 个字符", 400, { field: "content", maxLength: 500 });
  }
  return content;
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
    const content = parseContent(body.content);
    const clientRequestId = requireNonEmptyString(body.clientRequestId, "clientRequestId", 128);
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

    if (!content && (!mediaUrls || mediaUrls.length === 0)) {
      throw new AppError("VALIDATION_ERROR", "文字和图片至少需要一项", 400);
    }

    const uploadIds = (mediaUrls ?? []).map(uploadIdFromUrl);
    if (uploadIds.some((id) => !id) || new Set(uploadIds).size !== uploadIds.length) {
      throw new AppError("VALIDATION_ERROR", "mediaUrls 包含无效或重复的上传地址", 400, { field: "mediaUrls" });
    }
    const requestOrigin = new URL(request.url).origin;
    if ((mediaUrls ?? []).some((value) => new URL(value, requestOrigin).origin !== requestOrigin)) {
      throw new AppError("VALIDATION_ERROR", "mediaUrls 必须来自当前服务", 400, { field: "mediaUrls" });
    }

    const requestHash = createHash("sha256").update(JSON.stringify({
      content,
      recordDate: recordDate.toISOString(),
      moodName,
      moodIcon,
      mediaUrls: mediaUrls ?? [],
      coreEventIds: coreEventIds ?? [],
      emotionSliceIds: emotionSliceIds ?? [],
      generatedFromChatIds: generatedFromChatIds ?? [],
      isDraft,
    })).digest("hex");

    const existing = await prisma.note.findUnique({
      where: { userId_clientRequestId: { userId: user.id, clientRequestId } },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError("CONFLICT", "该保存请求已用于另一份小记", 409);
      }
      return ok(serializeNote(existing));
    }

    let note;
    try {
      note = await prisma.$transaction(async (tx) => {
        if (uploadIds.length) {
          const ownedUploads = await tx.noteUpload.findMany({
            where: { id: { in: uploadIds as string[] }, userId: user.id, noteId: null },
            select: { id: true, accessTokenHash: true },
          });
          const uploadById = new Map(ownedUploads.map((upload) => [upload.id, upload]));
          const tokensMatch = (mediaUrls ?? []).every((url, index) => {
            const token = new URL(url, requestOrigin).searchParams.get("token") ?? "";
            const upload = uploadById.get(uploadIds[index] as string);
            return Boolean(upload && tokenMatches(token, upload.accessTokenHash));
          });
          if (ownedUploads.length !== uploadIds.length || !tokensMatch) {
            throw new AppError("VALIDATION_ERROR", "图片不存在、已被使用或不属于当前用户", 400, { field: "mediaUrls" });
          }
        }
        const created = await tx.note.create({
          data: { userId: user.id, clientRequestId, requestHash, content, recordDate, moodName, moodIcon, mediaUrls, coreEventIds, emotionSliceIds, generatedFromChatIds, isDraft },
        });
        if (uploadIds.length) {
          const bound = await tx.noteUpload.updateMany({
            where: { id: { in: uploadIds as string[] }, userId: user.id, noteId: null },
            data: { noteId: created.id },
          });
          if (bound.count !== uploadIds.length) throw new AppError("CONFLICT", "图片已被其他保存请求使用", 409);
        }
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const replay = await prisma.note.findUnique({ where: { userId_clientRequestId: { userId: user.id, clientRequestId } } });
        if (replay?.requestHash === requestHash) return ok(serializeNote(replay));
        throw new AppError("CONFLICT", "该保存请求已用于另一份小记", 409);
      }
      throw error;
    }

    if (!note.isDraft && note.content.trim()) {
      await createRawMemoryFromNote({
        noteId: note.id,
        metadata: { source: "notes_api_post" },
      }).catch((error) => {
        console.error("raw memory note write failed", error);
      });
    }

    return ok(serializeNote(note), 201);
  } catch (error) {
    return failFromError(error);
  }
}
