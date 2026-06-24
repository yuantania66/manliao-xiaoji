import { NextRequest } from "next/server";
import { VerificationScene } from "@prisma/client";

import { failFromError, ok } from "@/lib/api-response";
import { hashVerificationCode, requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

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

    if (!user.phone && body.confirm !== true) {
      throw new AppError("VALIDATION_ERROR", "请确认注销账号", 400, { field: "confirm" });
    }

    await prisma.$transaction(async (tx) => {
      if (cancelCodeId) {
        await tx.verificationCode.update({
          where: { id: cancelCodeId },
          data: { consumedAt: new Date() },
        });
      }

      await tx.feedback.updateMany({
        where: { userId: user.id },
        data: { userId: null },
      });
      await tx.aiJudgeResult.deleteMany({ where: { userId: user.id } });
      await tx.aiGeneration.deleteMany({ where: { userId: user.id } });
      await tx.chatSession.deleteMany({ where: { userId: user.id } });
      await tx.note.deleteMany({ where: { userId: user.id } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.verificationCode.deleteMany({
        where: {
          OR: [
            { userId: user.id },
            ...(user.phone ? [{ phone: user.phone }] : []),
          ],
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: {
          phone: null,
          wechatOpenid: null,
          nickname: null,
          avatarUrl: null,
          status: "CANCELLED",
        },
      });
    });

    return ok({ cancelled: true });
  } catch (error) {
    return failFromError(error);
  }
}
