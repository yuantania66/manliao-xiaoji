import { NextRequest } from "next/server";
import { VerificationScene } from "@prisma/client";

import { failFromError, ok } from "@/lib/api-response";
import { hashVerificationCode, requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isValidPhone } from "@/lib/validation";
import { sendVerificationSms } from "@/services/sms/smsService";

const CODE_TTL_SECONDS = 300;
const CODE_RESEND_COOLDOWN_SECONDS = 60;

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

const parseScene = (value: unknown) => {
  if (value === undefined || value === null || value === "login") {
    return VerificationScene.LOGIN;
  }
  if (value === "cancel_account") {
    return VerificationScene.CANCEL_ACCOUNT;
  }
  throw new AppError("VALIDATION_ERROR", "scene 不支持", 400, {
    allowed: ["login", "cancel_account"],
  });
};

const createCode = () => String(Math.floor(100000 + Math.random() * 900000));

const assertCanSendCode = async (phone: string, scene: VerificationScene) => {
  const latestCode = await prisma.verificationCode.findFirst({
    where: { phone, scene },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (!latestCode) return;

  const retryAt = latestCode.createdAt.getTime() + CODE_RESEND_COOLDOWN_SECONDS * 1000;
  const retryAfter = Math.ceil((retryAt - Date.now()) / 1000);
  if (retryAfter > 0) {
    throw new AppError("RATE_LIMITED", "验证码发送太频繁，请稍后再试", 429, {
      retryAfter,
    });
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const scene = parseScene(body.scene);

    if (!isValidPhone(phone)) {
      throw new AppError("VALIDATION_ERROR", "请输入 11 位手机号码", 400, { field: "phone" });
    }

    if (scene === VerificationScene.CANCEL_ACCOUNT) {
      const currentUser = await requireUser(request);
      if (!currentUser.phone || currentUser.phone !== phone) {
        throw new AppError("FORBIDDEN", "只能向当前账号绑定手机号发送注销验证码", 403);
      }
    }

    await assertCanSendCode(phone, scene);

    const code = createCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000);
    const user = await prisma.user.findUnique({ where: { phone } });

    const verificationCode = await prisma.verificationCode.create({
      data: {
        phone,
        scene,
        codeHash: hashVerificationCode({ phone, scene, code }),
        expiresAt,
        userId: user?.id,
      },
    });

    try {
      await sendVerificationSms({ phone, scene, code });
    } catch (error) {
      await prisma.verificationCode.delete({ where: { id: verificationCode.id } }).catch(() => null);
      throw error;
    }

    return ok({
      expiresIn: CODE_TTL_SECONDS,
      ...(process.env.APP_ENV === "production" ? {} : { devCode: code }),
    });
  } catch (error) {
    return failFromError(error);
  }
}
