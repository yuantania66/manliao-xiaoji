import { Prisma, UserStatus } from "@prisma/client";

import { failFromError, ok } from "@/lib/api-response";
import { createSession, serializeUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireNonEmptyString } from "@/lib/validation";
import { getWechatOpenId, getWechatPhoneNumber } from "@/lib/wechat-auth";

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

const bindWechatPhone = async (wechatOpenid: string, phone: string) => {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`wechat:${wechatOpenid}`}, 0))) AS "wechat_lock"`;
      await tx.$queryRaw`SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`phone:${phone}`}, 0))) AS "phone_lock"`;

      const [wechatUser, phoneUser] = await Promise.all([
        tx.user.findUnique({ where: { wechatOpenid } }),
        tx.user.findUnique({ where: { phone } }),
      ]);

      if (wechatUser && phoneUser && wechatUser.id !== phoneUser.id) {
        throw new AppError("CONFLICT", "该微信与手机号已分别绑定其他账号，请联系客服处理", 409);
      }
      if (wechatUser?.phone && wechatUser.phone !== phone) {
        throw new AppError("CONFLICT", "该微信已绑定其他手机号", 409);
      }
      if (phoneUser?.wechatOpenid && phoneUser.wechatOpenid !== wechatOpenid) {
        throw new AppError("CONFLICT", "该手机号已绑定其他微信账号", 409);
      }

      const existing = wechatUser ?? phoneUser;
      if (existing) {
        return tx.user.update({
          where: { id: existing.id },
          data: { wechatOpenid, phone, status: UserStatus.ACTIVE },
        });
      }

      return tx.user.create({
        data: { wechatOpenid, phone, isProvisional: true, status: UserStatus.ACTIVE },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "微信或手机号已绑定其他账号，请重试", 409);
    }
    throw error;
  }
};

export async function POST(request: Request) {
  try {
    const value = await readJson(request);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AppError("VALIDATION_ERROR", "请求体无效", 400);
    }
    const body = value as Record<string, unknown>;
    const wechatCode = requireNonEmptyString(body.wechatCode, "wechatCode", 200);
    const phoneCode = requireNonEmptyString(body.phoneCode, "phoneCode", 500);
    const [wechatOpenid, phone] = await Promise.all([
      getWechatOpenId(wechatCode),
      getWechatPhoneNumber(phoneCode),
    ]);
    const user = await bindWechatPhone(wechatOpenid, phone);
    const session = await createSession(user.id);

    return ok({
      user: serializeUser(user),
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      provider: "wechat_phone",
    });
  } catch (error) {
    return failFromError(error);
  }
}
