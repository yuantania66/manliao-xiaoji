import { createHash } from "crypto";
import { UserStatus } from "@prisma/client";

import { failFromError, ok } from "@/lib/api-response";
import { createSession, serializeUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireNonEmptyString } from "@/lib/validation";

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

const mockOpenIdFromCode = (code: string) =>
  `mock_${createHash("sha256").update(code).digest("hex").slice(0, 28)}`;

const getWechatOpenId = async (code: string) => {
  const appId = process.env.WECHAT_APP_ID?.trim();
  const appSecret = process.env.WECHAT_APP_SECRET?.trim();
  const allowMock = process.env.APP_ENV !== "production";

  if (!appId || !appSecret) {
    if (allowMock) return mockOpenIdFromCode(code);
    throw new AppError("INTERNAL_ERROR", "微信登录配置未完成", 500);
  }

  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", appSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const response = await fetch(url);
  const data = (await response.json().catch(() => null)) as
    | { openid?: string; errcode?: number; errmsg?: string }
    | null;

  if (!response.ok || !data || !data.openid || data.errcode) {
    throw new AppError("VALIDATION_ERROR", "微信登录失败，请稍后再试", 400, {
      errcode: data?.errcode,
    });
  }

  return data.openid;
};

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const code = requireNonEmptyString(body.code, "code", 200);
    const wechatOpenid = await getWechatOpenId(code);

    const user = await prisma.user.upsert({
      where: { wechatOpenid },
      create: {
        wechatOpenid,
        status: UserStatus.ACTIVE,
      },
      update: {
        status: UserStatus.ACTIVE,
      },
    });

    const session = await createSession(user.id);

    return ok({
      user: serializeUser(user),
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      provider: wechatOpenid.startsWith("mock_") ? "wechat_mock" : "wechat",
    });
  } catch (error) {
    return failFromError(error);
  }
}
