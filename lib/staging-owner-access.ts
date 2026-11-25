import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";

import { AppError } from "./errors";

// Path detection cannot be disabled by an environment toggle. Presence of either
// staging setting also fails closed, including empty or misspelled mode values.
export const stagingOwnerAccessEnabled = () =>
  path.resolve(process.cwd()).startsWith("/var/www/manliaoxiaoji-staging/releases/") ||
  process.env.APP_ENV === "staging" ||
  process.env.STAGING_MODEL_BUDGET_MODE !== undefined ||
  process.env.STAGING_OWNER_ACCESS_MODE !== undefined ||
  process.env.STAGING_ALLOWED_WECHAT_OPENID_SHA256 !== undefined;

const denied = () => new AppError(
  "FORBIDDEN",
  "测试环境仅限本人微信账号使用，请使用获准的微信账号登录；暂不开放游客模式。",
  403,
  { reason: "STAGING_OWNER_ONLY" },
);

export const assertStagingOwnerConfiguration = () => {
  if (!stagingOwnerAccessEnabled()) return;
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.STAGING_ALLOWED_WECHAT_OPENID_SHA256 ?? "")) {
    throw denied();
  }
};

export const assertStagingOwnerIdentity = (openid: string | null | undefined) => {
  if (!stagingOwnerAccessEnabled()) return;
  assertStagingOwnerConfiguration();
  if (!openid || openid.startsWith("mock_")) throw denied();
  const actual = createHash("sha256").update(openid).digest();
  const allowed = Buffer.from(process.env.STAGING_ALLOWED_WECHAT_OPENID_SHA256!, "hex");
  if (!timingSafeEqual(actual, allowed)) throw denied();
};

export const assertStagingPublicAccessAllowed = () => {
  if (stagingOwnerAccessEnabled()) throw denied();
};
