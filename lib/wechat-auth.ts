import { createHash } from "crypto";

import { AppError } from "./errors";

const mockOpenIdFromCode = (code: string) =>
  `mock_${createHash("sha256").update(code).digest("hex").slice(0, 28)}`;

export const getWechatOpenId = async (code: string) => {
  const appId = process.env.WECHAT_APP_ID?.trim();
  const appSecret = process.env.WECHAT_APP_SECRET?.trim();
  const allowMock =
    process.env.APP_ENV !== "production" ||
    (process.env.ALLOW_WEB_MOCK_LOGIN === "true" && code.startsWith("web_mock_"));

  if (!appId || !appSecret) {
    if (allowMock) return mockOpenIdFromCode(code);
    throw new AppError("INTERNAL_ERROR", "微信登录配置未完成", 500);
  }
  if (allowMock) return mockOpenIdFromCode(code);

  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", appSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");
  const response = await fetch(url);
  const data = (await response.json().catch(() => null)) as
    | { openid?: string; errcode?: number }
    | null;
  if (!response.ok || !data?.openid || data.errcode) {
    throw new AppError("VALIDATION_ERROR", "微信身份验证失败，请重新操作", 400, {
      errcode: data?.errcode,
    });
  }
  return data.openid;
};
