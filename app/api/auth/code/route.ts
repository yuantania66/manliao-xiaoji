import { VerificationScene } from "@prisma/client";

import { failFromError, ok } from "@/lib/api-response";
import { hashVerificationCode } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isValidPhone } from "@/lib/validation";

const CODE_TTL_SECONDS = 300;

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

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const scene = parseScene(body.scene);

    if (!isValidPhone(phone)) {
      throw new AppError("VALIDATION_ERROR", "请输入 11 位手机号码", 400, { field: "phone" });
    }

    const code = createCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000);
    const user = await prisma.user.findUnique({ where: { phone } });

    await prisma.verificationCode.create({
      data: {
        phone,
        scene,
        codeHash: hashVerificationCode({ phone, scene, code }),
        expiresAt,
        userId: user?.id,
      },
    });

    return ok({
      expiresIn: CODE_TTL_SECONDS,
      ...(process.env.APP_ENV === "production" ? {} : { devCode: code }),
    });
  } catch (error) {
    return failFromError(error);
  }
}
