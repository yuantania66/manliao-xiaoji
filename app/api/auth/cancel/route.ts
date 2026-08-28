import { NextRequest } from "next/server";
import { VerificationScene } from "@prisma/client";

import { failFromError, ok } from "@/lib/api-response";
import { hashVerificationCode, requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getWechatOpenId } from "@/lib/wechat-auth";
import {
  cancelAccountData,
  drainAccountCancellationFiles,
} from "@/services/auth/accountCancellationService";

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

const parseCode = (value: unknown) => {
  const code = typeof value === "string" ? value.trim() : "";
  if (!/^\d{6}$/.test(code)) {
    throw new AppError("VALIDATION_ERROR", "验证码必须是 6 位数字", 400, { field: "code" });
  }
  return code;
};

const verifyCancelCode = async ({
  phone,
  code,
}: {
  phone: string;
  code: string;
}) => {
  const latestCode = await prisma.verificationCode.findFirst({
    where: {
      phone,
      scene: VerificationScene.CANCEL_ACCOUNT,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!latestCode || latestCode.consumedAt) {
    throw new AppError("CODE_INVALID", "验证码不正确", 422);
  }

  if (latestCode.expiresAt <= new Date()) {
    throw new AppError("CODE_EXPIRED", "验证码已过期", 422);
  }

  const expectedHash = hashVerificationCode({
    phone,
    scene: VerificationScene.CANCEL_ACCOUNT,
    code,
  });

  if (latestCode.codeHash !== expectedHash) {
    throw new AppError("CODE_INVALID", "验证码不正确", 422);
  }

  return latestCode.id;
};

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);
    const cancelCodeId = user.phone
      ? await verifyCancelCode({ phone: user.phone, code: parseCode(body.code) })
      : null;
    if (!user.phone) {
      const wechatCode = typeof body.wechatCode === "string" ? body.wechatCode.trim() : "";
      if (!wechatCode) {
        throw new AppError("VALIDATION_ERROR", "请在微信小程序中重新验证身份后注销", 400, { field: "wechatCode" });
      }
      const verifiedOpenid = await getWechatOpenId(wechatCode);
      if (!user.wechatOpenid || verifiedOpenid !== user.wechatOpenid) {
        throw new AppError("FORBIDDEN", "微信身份与当前账号不一致", 403);
      }
    }

    const cleanupTaskIds = await cancelAccountData({
      userId: user.id,
      phone: user.phone,
      cancelCodeId,
    });

    const fileCleanupPending = await drainAccountCancellationFiles(cleanupTaskIds);

    return ok({
      cancelled: true,
      mediaCleanup: fileCleanupPending > 0 ? "pending" : "complete",
      fileCleanupPending,
    });
  } catch (error) {
    return failFromError(error);
  }
}
