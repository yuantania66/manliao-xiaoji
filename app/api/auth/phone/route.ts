import { UserStatus, VerificationScene } from "@prisma/client";

import { failFromError, ok } from "@/lib/api-response";
import { createSession, hashVerificationCode, serializeUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isValidPhone } from "@/lib/validation";

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!isValidPhone(phone)) {
      throw new AppError("VALIDATION_ERROR", "请输入 11 位手机号码", 400, { field: "phone" });
    }

    if (!/^\d{6}$/.test(code)) {
      throw new AppError("VALIDATION_ERROR", "验证码必须是 6 位数字", 400, { field: "code" });
    }

    const latestCode = await prisma.verificationCode.findFirst({
      where: {
        phone,
        scene: VerificationScene.LOGIN,
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
      scene: VerificationScene.LOGIN,
      code,
    });

    if (latestCode.codeHash !== expectedHash) {
      throw new AppError("CODE_INVALID", "验证码不正确", 422);
    }

    const user = await prisma.$transaction(async (tx) => {
      await tx.verificationCode.update({
        where: { id: latestCode.id },
        data: { consumedAt: new Date() },
      });

      return tx.user.upsert({
        where: { phone },
        create: {
          phone,
          status: UserStatus.ACTIVE,
        },
        update: {
          status: UserStatus.ACTIVE,
        },
      });
    });

    const session = await createSession(user.id);

    return ok({
      user: serializeUser(user),
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (error) {
    return failFromError(error);
  }
}
