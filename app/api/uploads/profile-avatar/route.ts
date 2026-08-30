import { randomBytes, randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import sharp from "sharp";

import { failFromError, ok } from "@/lib/api-response";
import { requireAuthenticatedUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { drainAccountCancellationFiles } from "@/services/auth/accountCancellationService";
import { getNoteUploadRoot, hashUploadToken } from "@/app/api/uploads/notes/storage";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size <= 0 || file.size > 5 * 1024 * 1024) {
      throw new AppError("VALIDATION_ERROR", "请选择不超过 5MB 的头像图片", 400);
    }
    const source = Buffer.from(await file.arrayBuffer());
    const image = sharp(source, { animated: true, limitInputPixels: 16_000_000 });
    const metadata = await image.metadata().catch(() => null);
    const declaredFormat = new Map([
      ["image/jpeg", "jpeg"], ["image/png", "png"], ["image/webp", "webp"],
    ]).get(file.type);
    if (
      !metadata ||
      !declaredFormat || metadata.format !== declaredFormat ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 4096 ||
      metadata.height > 4096 ||
      metadata.width * metadata.height > 16_000_000 ||
      (metadata.pages ?? 1) !== 1 ||
      !["jpeg", "png", "webp"].includes(metadata.format ?? "")
    ) {
      throw new AppError("VALIDATION_ERROR", "头像图片无效或尺寸过大", 400);
    }
    const output = await image
      .rotate()
      .resize(512, 512, { fit: "cover" })
      .webp({ quality: 86 })
      .toBuffer();
    const id = randomUUID();
    const storageKey = `${user.id}/profile/${id}.webp`;
    const root = getNoteUploadRoot();
    await mkdir(path.dirname(path.join(root, storageKey)), { recursive: true });
    await writeFile(path.join(root, storageKey), output, { flag: "wx" });
    try {
      await prisma.noteUpload.create({
        data: {
          id,
          userId: user.id,
          storageKey,
          mimeType: "image/webp",
          size: output.length,
          accessTokenHash: hashUploadToken(randomBytes(32).toString("base64url")),
          purpose: "PROFILE_AVATAR",
        },
      });
    } catch (error) {
      await unlink(path.join(root, storageKey)).catch(() => undefined);
      throw error;
    }
    return ok({ uploadId: id });
  } catch (error) {
    return failFromError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await request.json().catch(() => null) as { uploadId?: unknown } | null;
    if (!body || typeof body.uploadId !== "string" || !/^[0-9a-f-]{36}$/u.test(body.uploadId)) {
      throw new AppError("VALIDATION_ERROR", "头像上传无效", 400);
    }
    const taskId = await prisma.$transaction(async (tx) => {
      const upload = await tx.noteUpload.findFirst({
        where: {
          id: body.uploadId as string,
          userId: user.id,
          purpose: "PROFILE_AVATAR",
          boundAt: null,
          noteId: null,
        },
      });
      if (!upload) throw new AppError("NOT_FOUND", "头像上传不存在", 404);
      const task = await tx.accountCancellationFileDeletion.upsert({
        where: { storageKey: upload.storageKey },
        create: { storageKey: upload.storageKey },
        update: {},
        select: { id: true },
      });
      await tx.noteUpload.delete({ where: { id: upload.id } });
      return task.id;
    });
    const pending = await drainAccountCancellationFiles([taskId]);
    return ok({ discarded: true, fileCleanup: pending > 0 ? "pending" : "complete" });
  } catch (error) {
    return failFromError(error);
  }
}
