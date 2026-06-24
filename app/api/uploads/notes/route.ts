import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";

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

const getUploadRoot = () =>
  process.env.UPLOAD_DIR?.trim() || path.join(process.cwd(), "public", "uploads");

const getPublicBaseUrl = (request: NextRequest) => {
  const configured = process.env.UPLOAD_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return `${new URL(request.url).origin}/uploads`;
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
    await requireUser(request);

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

    const directory = path.join(getUploadRoot(), "notes");
    await mkdir(directory, { recursive: true });

    const filename = `${randomUUID()}.${extension}`;
    const filePath = path.join(directory, filename);
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, bytes, { flag: "wx" });

    const url = `${getPublicBaseUrl(request)}/notes/${filename}`;
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
