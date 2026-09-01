import { createHash } from "crypto";

import { AppError } from "./errors";
import { isValidPhone } from "./validation";

const mockOpenIdFromCode = (code: string) =>
  `mock_${createHash("sha256").update(code).digest("hex").slice(0, 28)}`;

let cachedAccessToken: { appId: string; token: string; expiresAt: number } | null = null;

const getWechatCredentials = () => {
  const appId = process.env.WECHAT_APP_ID?.trim();
  const appSecret = process.env.WECHAT_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new AppError("INTERNAL_ERROR", "微信登录配置未完成", 500);
  }
  return { appId, appSecret };
};

const getWechatAccessToken = async () => {
  const { appId, appSecret } = getWechatCredentials();
  if (cachedAccessToken?.appId === appId && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }

  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", appSecret);
  const response = await fetch(url);
  const data = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; errcode?: number }
    | null;
  if (!response.ok || !data?.access_token || data.errcode) {
    throw new AppError("INTERNAL_ERROR", "微信手机号服务暂时不可用", 502, {
      errcode: data?.errcode,
    });
  }

  cachedAccessToken = {
    appId,
    token: data.access_token,
    expiresAt: Date.now() + Math.max((data.expires_in ?? 7200) - 60, 60) * 1000,
  };
  return data.access_token;
};

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
    console.error("wechat upstream rejected", {
      operation: "jscode2session",
      httpStatus: response.status,
      errcode: typeof data?.errcode === "number" ? data.errcode : null,
    });
    throw new AppError("VALIDATION_ERROR", "微信身份验证失败，请重新操作", 400, {
      errcode: data?.errcode,
    });
  }
  return data.openid;
};

export const getWechatPhoneNumber = async (code: string) => {
  const accessToken = await getWechatAccessToken();
  const url = new URL("https://api.weixin.qq.com/wxa/business/getuserphonenumber");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = (await response.json().catch(() => null)) as
    | {
        errcode?: number;
        phone_info?: {
          purePhoneNumber?: string;
          countryCode?: string;
        };
      }
    | null;
  const phone = data?.phone_info?.purePhoneNumber?.trim() ?? "";
  if (!response.ok || data?.errcode || data?.phone_info?.countryCode !== "86" || !isValidPhone(phone)) {
    throw new AppError("VALIDATION_ERROR", "微信手机号验证失败，请重新选择", 400, {
      errcode: data?.errcode,
    });
  }
  return phone;
};
