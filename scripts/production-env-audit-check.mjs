import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(path.join(os.tmpdir(), "xinqing-prod-env-audit-"));
const envFile = path.join(directory, ".env");
const auditScript = path.resolve("scripts/production-env-audit.mjs");
const smsKeys = [
  "TENCENTCLOUD_SECRET_ID",
  "TENCENTCLOUD_SECRET_KEY",
  "TENCENT_SMS_SDK_APP_ID",
  "TENCENT_SMS_SIGN_NAME",
  "TENCENT_SMS_TEMPLATE_ID",
  "TENCENT_SMS_TEMPLATE_ID_LOGIN",
  "TENCENT_SMS_TEMPLATE_ID_CANCEL",
];
const baseEnv = [
  "APP_ENV=production",
  "DATABASE_URL=postgresql://test:test@localhost:5432/audit_test",
  "SESSION_SECRET=synthetic-session-secret-at-least-32-characters",
  "ACCOUNT_CANCELLATION_CLEANUP_SECRET=synthetic-cleanup-secret-at-least-32-characters",
  "WECHAT_APP_ID=synthetic-wechat-app-id",
  "WECHAT_APP_SECRET=synthetic-wechat-app-secret",
  "AI_PROVIDER=qwen",
  "QWEN_API_KEY=synthetic-qwen-key",
  "UPLOAD_DIR=/var/lib/manliaoxiaoji/uploads",
  "UPLOAD_PUBLIC_BASE_URL=https://example.invalid/uploads",
];
const cleanProcessEnv = { ...process.env };
for (const key of smsKeys) delete cleanProcessEnv[key];

const runAudit = async (extra = []) => {
  await writeFile(envFile, [...baseEnv, ...extra, ""].join("\n"));
  return spawnSync(process.execPath, [auditScript], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...cleanProcessEnv,
      PROD_ENV_FILE: envFile,
    },
  });
};

try {
  const deferred = await runAudit();
  assert.equal(deferred.status, 0, deferred.stderr);
  assert.match(deferred.stderr, /SMS login is deferred for this release/u);

  const partial = await runAudit(["TENCENTCLOUD_SECRET_ID=synthetic-secret-id"]);
  assert.equal(partial.status, 1);
  assert.match(partial.stderr, /SMS production config is incomplete/u);

  const complete = await runAudit([
    "TENCENTCLOUD_SECRET_ID=synthetic-secret-id",
    "TENCENTCLOUD_SECRET_KEY=synthetic-secret-key",
    "TENCENT_SMS_SDK_APP_ID=synthetic-sdk-app-id",
    "TENCENT_SMS_SIGN_NAME=synthetic-sign-name",
    "TENCENT_SMS_TEMPLATE_ID=synthetic-template-id",
  ]);
  assert.equal(complete.status, 0, complete.stderr);
  console.log("Production environment audit checks passed.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
