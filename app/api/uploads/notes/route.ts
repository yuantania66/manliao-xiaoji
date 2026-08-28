import { randomBytes, randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

import { getNoteUploadRoot, hashUploadToken, removeNoteUploadFile, uploadIdFromUrl } from "./storage";

export const runtime = "nodejs";

const DEFAULT_MAX_IMAGE_SIZE_MB = 10;
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

const getMaxImageSizeBytes = () => {
  const value = Number(process.env.MAX_NOTE_IMAGE_SIZE_MB ?? DEFAULT_MAX_IMAGE_SIZE_MB);
  const sizeMb = Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_IMAGE_SIZE_MB;
  return sizeMb * 1024 * 1024;
};

const parseFile = async (request: NextRequest) => {
  const formData = await request.formData().catch(() => {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 multipart/form-data", 400);
  });
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new AppError("VALIDATION_ERROR", "请上传图片文件", 400, { field: "file" });
  }

  return file;
};

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);

    const file = await parseFile(request);
    const extension = ALLOWED_IMAGE_TYPES.get(file.type);
    if (!extension) {
      throw new AppError("VALIDATION_ERROR", "仅支持 jpg、png、webp 或 gif 图片", 400, {
        field: "file",
      });
    }

    const maxSize = getMaxImageSizeBytes();
    if (file.size <= 0 || file.size > maxSize) {
      throw new AppError("VALIDATION_ERROR", "图片大小不符合要求", 400, {
        field: "file",
        maxSize,
      });
    }

    const id = randomUUID();
    const accessToken = randomBytes(32).toString("base64url");
    const directory = path.join(getNoteUploadRoot(), user.id);
    await mkdir(directory, { recursive: true });

    const storageKey = `${user.id}/${id}.${extension}`;
    const filePath = path.join(getNoteUploadRoot(), storageKey);
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, bytes, { flag: "wx" });

    try {
      await prisma.noteUpload.create({
        data: { id, userId: user.id, storageKey, mimeType: file.type, size: file.size, accessTokenHash: hashUploadToken(accessToken) },
      });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }

    const url = `${new URL(request.url).origin}/api/uploads/notes/${id}?token=${accessToken}`;
    return ok({
      items: [
        {
          url,
          type: "image",
          size: file.size,
        },
      ],
    });
  } catch (error) {
    return failFromError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await request.json().catch(() => null) as { urls?: unknown } | null;
    if (!body || !Array.isArray(body.urls) || body.urls.length > 9) {
      throw new AppError("VALIDATION_ERROR", "urls 必须是最多 9 项的数组", 400);
    }
    const ids = body.urls.map((value) => typeof value === "string" ? uploadIdFromUrl(value) : null);
    if (ids.some((id) => !id)) throw new AppError("VALIDATION_ERROR", "urls 包含无效上传地址", 400);
    const uploads = await prisma.noteUpload.findMany({
      where: { id: { in: ids as string[] }, userId: user.id, noteId: null, purpose: "NOTE_MEDIA" },
    });
    if (uploads.length !== new Set(ids).size) throw new AppError("NOT_FOUND", "上传文件不存在或不可清理", 404);
    await Promise.all(uploads.map((upload) => removeNoteUploadFile(upload.storageKey)));
    await prisma.noteUpload.deleteMany({
      where: { id: { in: ids as string[] }, userId: user.id, noteId: null, purpose: "NOTE_MEDIA" },
    });
    return ok({ deleted: uploads.length });
  } catch (error) {
    return failFromError(error);
  }
}
