import { readFile } from "node:fs/promises";

const envFile = process.env.PROD_ENV_FILE || ".env";
const failures = [];
const warnings = [];

const parseEnvFile = async (path) => {
  const text = await readFile(path, "utf8").catch(() => "");
  const values = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    values[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
  }

  return values;
};

const fileEnv = await parseEnvFile(envFile);
const env = { ...fileEnv, ...process.env };

const value = (key) => (env[key] || "").trim();
const isPlaceholder = (item) =>
  !item ||
  /^(replace|changeme|todo|xxx|your-|USER:PASSWORD|postgresql:\/\/USER:PASSWORD)/i.test(item);

const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);

const requireSet = (key, label = key) => {
  if (isPlaceholder(value(key))) fail(`${label} is missing or still looks like a placeholder`);
};

if (value("APP_ENV") !== "production") fail("APP_ENV must be production");
requireSet("DATABASE_URL");
requireSet("SESSION_SECRET");
if (value("SESSION_SECRET").length > 0 && value("SESSION_SECRET").length < 32) {
  fail("SESSION_SECRET should be at least 32 characters");
}

requireSet("WECHAT_APP_ID");
requireSet("WECHAT_APP_SECRET");

if (value("ALLOW_WEB_MOCK_LOGIN") === "true") {
  fail("ALLOW_WEB_MOCK_LOGIN must not be true in production");
}

const provider = value("AI_PROVIDER").toLowerCase();
if (!["openai", "deepseek", "zhipu"].includes(provider)) {
  fail("AI_PROVIDER must be openai, deepseek, or zhipu in production");
}
if (provider === "openai") requireSet("OPENAI_API_KEY");
if (provider === "deepseek") requireSet("DEEPSEEK_API_KEY");
if (provider === "zhipu") requireSet("ZHIPU_API_KEY");

if (value("AI_JUDGE_MODE") === "local") {
  warn("AI_JUDGE_MODE is local; this is acceptable for launch only if intentionally using local safety rules");
}

requireSet("UPLOAD_DIR");
if (value("UPLOAD_DIR").startsWith("./") || value("UPLOAD_DIR").includes("/public/uploads")) {
  warn("UPLOAD_DIR looks like a local app directory; production should use a persistent shared directory");
}

requireSet("UPLOAD_PUBLIC_BASE_URL");
if (!value("UPLOAD_PUBLIC_BASE_URL").startsWith("https://")) {
  fail("UPLOAD_PUBLIC_BASE_URL must be https in production");
}

const smsKeys = [
  "TENCENTCLOUD_SECRET_ID",
  "TENCENTCLOUD_SECRET_KEY",
  "TENCENT_SMS_SDK_APP_ID",
  "TENCENT_SMS_SIGN_NAME",
];
const missingSms = smsKeys.filter((key) => isPlaceholder(value(key)));
if (missingSms.length > 0) {
  warn(`SMS production config is incomplete: ${missingSms.join(", ")}`);
}

const numericKeys = ["SESSION_EXPIRES_DAYS", "AI_TIMEOUT_MS", "GUEST_AI_IP_DAILY_LIMIT", "MAX_NOTE_IMAGE_SIZE_MB"];
for (const key of numericKeys) {
  const current = value(key);
  if (current && (!Number.isFinite(Number(current)) || Number(current) <= 0)) {
    fail(`${key} must be a positive number when set`);
  }
}

if (warnings.length > 0) {
  console.warn("Production env audit warnings:");
  for (const item of warnings) console.warn(`WARN ${item}`);
}

if (failures.length > 0) {
  console.error(`Production env audit failed for ${envFile}:`);
  for (const item of failures) console.error(`FAIL ${item}`);
  process.exit(1);
}

console.log(`Production env audit passed for ${envFile}.`);
