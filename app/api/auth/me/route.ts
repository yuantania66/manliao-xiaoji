import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { hasCompleteProfile, requireAuthenticatedUser, serializeUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { drainAccountCancellationFiles } from "@/services/auth/accountCancellationService";

const AVATAR_URL_PATTERN = /^\/api\/uploads\/profile-avatar\/([0-9a-f-]{36})$/u;
const FORBIDDEN_NICKNAME_CHARACTERS = /[\p{Cc}\p{Cf}\u202a-\u202e\u2066-\u2069]/u;

const parseProfilePatch = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("VALIDATION_ERROR", "请求体无效", 400);
  }
  const body = value as Record<string, unknown>;
  const allowedKeys = new Set(["nickname", "avatarUploadId"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new AppError("VALIDATION_ERROR", "资料字段无效", 400);
  }
  const hasNickname = Object.hasOwn(body, "nickname");
  const hasAvatar = Object.hasOwn(body, "avatarUploadId");
  if (!hasNickname && !hasAvatar) {
    throw new AppError("VALIDATION_ERROR", "请提供需要更新的资料", 400);
  }

  let nickname: string | null | undefined;
  if (hasNickname) {
    if (body.nickname === null) {
      nickname = null;
    } else if (typeof body.nickname === "string") {
      nickname = body.nickname.trim();
      const length = Array.from(nickname).length;
      if (length < 2 || length > 12 || FORBIDDEN_NICKNAME_CHARACTERS.test(nickname)) {
        throw new AppError("VALIDATION_ERROR", "昵称须为 2 至 12 个有效字符", 400);
      }
    } else {
      throw new AppError("VALIDATION_ERROR", "昵称无效", 400);
    }
  }

  let avatarUploadId: string | null | undefined;
  if (hasAvatar) {
    if (body.avatarUploadId === null) {
      avatarUploadId = null;
    } else if (typeof body.avatarUploadId === "string" && /^[0-9a-f-]{36}$/u.test(body.avatarUploadId)) {
      avatarUploadId = body.avatarUploadId;
    } else {
      throw new AppError("VALIDATION_ERROR", "头像上传无效", 400);
    }
  }
  return { hasNickname, hasAvatar, nickname, avatarUploadId };
};

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    return ok({ user: serializeUser(user) });
  } catch (error) {
    return failFromError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const patch = parseProfilePatch(await request.json().catch(() => null));
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      let nextAvatarUrl = current.avatarUrl;
      let nextUploadId: string | null = null;

      if (patch.hasAvatar && patch.avatarUploadId) {
        const upload = await tx.noteUpload.findFirst({
          where: {
            id: patch.avatarUploadId,
            userId: user.id,
            purpose: "PROFILE_AVATAR",
            boundAt: null,
            noteId: null,
          },
        });
        if (!upload) throw new AppError("NOT_FOUND", "头像上传不存在", 404);
        nextUploadId = upload.id;
        nextAvatarUrl = `/api/uploads/profile-avatar/${upload.id}`;
      } else if (patch.hasAvatar) {
        nextAvatarUrl = null;
      }

      const cleanupTaskIds: string[] = [];
      const oldId = current.avatarUrl?.match(AVATAR_URL_PATTERN)?.[1];
      if (patch.hasAvatar && oldId && oldId !== nextUploadId) {
        const old = await tx.noteUpload.findFirst({
          where: { id: oldId, userId: user.id, purpose: "PROFILE_AVATAR", boundAt: { not: null } },
        });
        if (old) {
          const task = await tx.accountCancellationFileDeletion.upsert({
            where: { storageKey: old.storageKey }, create: { storageKey: old.storageKey }, update: {},
            select: { id: true },
          });
          cleanupTaskIds.push(task.id);
          await tx.noteUpload.delete({ where: { id: old.id } });
        }
      }

      if (nextUploadId) {
        const bound = await tx.noteUpload.updateMany({
          where: { id: nextUploadId, userId: user.id, purpose: "PROFILE_AVATAR", boundAt: null, noteId: null },
          data: { boundAt: new Date() },
        });
        if (bound.count !== 1) throw new AppError("NOT_FOUND", "头像上传不存在", 404);
      }

      if (
        process.env.APP_ENV !== "production" &&
        process.env.PROFILE_AVATAR_TEST_FAIL_TRANSACTION_ONCE === "1"
      ) {
        delete process.env.PROFILE_AVATAR_TEST_FAIL_TRANSACTION_ONCE;
        throw new Error("profile_avatar_test_transaction_failure");
      }

      const nextNickname = patch.hasNickname ? patch.nickname ?? null : current.nickname;
      const profileCompletedAt = hasCompleteProfile({
        nickname: nextNickname,
        avatarUrl: nextAvatarUrl,
        profileCompletedAt: current.profileCompletedAt ?? new Date(),
      }) ? current.profileCompletedAt ?? new Date() : null;
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          ...(patch.hasNickname ? { nickname: patch.nickname } : {}),
          ...(patch.hasAvatar ? { avatarUrl: nextAvatarUrl } : {}),
          profileCompletedAt,
          ...(profileCompletedAt ? { isProvisional: false } : {}),
        },
      });
      return { updated, cleanupTaskIds };
    });

    const pendingCleanup = result.cleanupTaskIds.length > 0
      ? await drainAccountCancellationFiles(result.cleanupTaskIds)
      : 0;
    return ok({ user: serializeUser(result.updated), fileCleanup: pendingCleanup > 0 ? "pending" : "complete" });
  } catch (error) {
    return failFromError(error);
  }
}
