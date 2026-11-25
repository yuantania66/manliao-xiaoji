/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS substitution isolates the real route handlers. */
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

for (const key of ["APP_ENV", "STAGING_MODEL_BUDGET_MODE", "STAGING_OWNER_ACCESS_MODE", "STAGING_ALLOWED_WECHAT_OPENID_SHA256"]) {
  delete process.env[key];
}
assert.notEqual(process.env.NODE_ENV, "production");
process.env.SESSION_SECRET = "synthetic-owner-access-test-only";
global.fetch = () => { throw new Error("Offline auth check attempted a real transport"); };

const ownerId = "synthetic-wechat-owner";
const otherId = "synthetic-new-owner";
const phoneNumber = "13800000000";
const owner = {
  id: "synthetic-owner",
  wechatOpenid: ownerId,
  status: "ACTIVE",
  phone: phoneNumber,
  createdAt: new Date(),
  profileCompletedAt: null,
};
let persistedUser = owner;
let session = { user: owner, expiresAt: new Date(Date.now() + 60_000) };
let identity = ownerId;
let latestCode = null;
let reads = 0;
let writes = 0;
let openidExchanges = 0;
let phoneExchanges = 0;
let sms = 0;
let mediaReads = 0;
const feedbackAuthors = [];
let upload;
const db = {
  user: {
    findUnique: async () => { reads++; return persistedUser; },
    upsert: async () => { writes++; return persistedUser; },
    update: async () => { writes++; return persistedUser; },
  },
  verificationCode: {
    findFirst: async () => { reads++; return latestCode; },
    create: async () => { writes++; return { id: "synthetic-code" }; },
    update: async () => { writes++; },
  },
  session: {
    findUnique: async () => { reads++; return session; },
    create: async () => { writes++; },
    deleteMany: async () => { writes++; },
  },
  noteUpload: { findUnique: async () => { mediaReads++; return upload; } },
  feedback: {
    create: async ({ data }) => {
      writes++;
      feedbackAuthors.push(data.userId);
      return { id: "synthetic-feedback", type: data.type, createdAt: new Date() };
    },
  },
  $queryRaw: async () => [{ locked: 1 }],
  $transaction: async (callback) => callback(db),
};
global.prisma = db;
const substitute = (file, exports) => {
  const modulePath = require.resolve(file);
  require(modulePath);
  require.cache[modulePath].exports = exports;
};
const realWechat = require("../lib/wechat-auth.ts");
substitute("../lib/wechat-auth.ts", {
  getWechatOpenId: async () => { openidExchanges++; return identity; },
  getWechatPhoneNumber: async () => { phoneExchanges++; return phoneNumber; },
});
substitute("../services/sms/smsService.ts", {
  sendVerificationSms: async () => { sms++; return { provider: "synthetic" }; },
});

const auth = require("../lib/auth.ts");
const login = require("../app/api/auth/wechat/route.ts");
const binding = require("../app/api/auth/wechat-phone/route.ts");
const phone = require("../app/api/auth/phone/route.ts");
const code = require("../app/api/auth/code/route.ts");
const logout = require("../app/api/auth/logout/route.ts");
const feedback = require("../app/api/feedback/route.ts");
const media = require("../app/api/uploads/notes/[uploadId]/route.ts");
const { hashUploadToken } = require("../app/api/uploads/notes/storage.ts");
const req = (body = {}, token) => new Request("https://synthetic.invalid/api", {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const wechatBody = { code: "synthetic-code", wechatCode: "synthetic-code", phoneCode: "synthetic-phone-code" };
const loginCode = { phone: phoneNumber };
const feedbackBody = { type: "使用问题", content: "合成测试反馈" };
const denied = { code: "FORBIDDEN", status: 403 };

async function main() {
  delete process.env.WECHAT_APP_ID;
  delete process.env.WECHAT_APP_SECRET;
  assert.match(await realWechat.getWechatOpenId("web_mock_test"), /^mock_/u, "development mock sign-in stays available");
  process.env.APP_ENV = "staging";
  await assert.rejects(realWechat.getWechatOpenId("web_mock_test"), /微信登录配置未完成/u);
  assert.equal((await feedback.POST(req(feedbackBody))).status, 401);
  assert.equal((await login.POST(req(wechatBody))).status, 403);
  assert.equal((await binding.POST(req(wechatBody))).status, 403);
  assert.deepEqual({ openidExchanges, phoneExchanges, reads, writes }, {
    openidExchanges: 0, phoneExchanges: 0, reads: 0, writes: 0,
  }, "missing configuration blocks before either identity exchange or database access");

  process.env.STAGING_ALLOWED_WECHAT_OPENID_SHA256 = createHash("sha256").update(ownerId).digest("hex");
  identity = otherId;
  assert.equal((await login.POST(req(wechatBody))).status, 403);
  assert.equal((await binding.POST(req(wechatBody))).status, 403);
  assert.equal(openidExchanges, 2);
  assert.equal(phoneExchanges, 0, "non-owner must not consume the WeChat phone code");
  assert.equal(writes, 0);
  assert.equal((await code.POST(req(loginCode))).status, 403);
  assert.equal((await phone.POST(req({ ...loginCode, code: "123456" }))).status, 403);
  assert.equal(reads, 0);
  assert.equal(sms, 0);

  persistedUser = { ...owner, wechatOpenid: otherId };
  session = { ...session, user: persistedUser };
  await assert.rejects(auth.createSession(owner.id), denied);
  await assert.rejects(auth.requireUser(req({}, "synthetic-token")), denied);
  assert.equal((await logout.POST(req({}, "synthetic-token"))).status, 403);
  assert.equal((await code.POST(req({ ...loginCode, scene: "cancel_account" }, "synthetic-token"))).status, 403);
  session = { user: owner, expiresAt: new Date(0) };
  assert.equal((await logout.POST(req({}, "synthetic-token"))).status, 401);
  assert.equal(writes, 0, "all denied paths leave database state alone");

  identity = ownerId;
  persistedUser = owner;
  session = { user: owner, expiresAt: new Date(Date.now() + 60_000) };
  assert.equal((await login.POST(req(wechatBody))).status, 200, "owner profile remains optional");
  assert.equal((await binding.POST(req(wechatBody))).status, 200);
  assert.equal((await feedback.POST(req(feedbackBody, "synthetic-token"))).status, 201);
  assert.deepEqual(feedbackAuthors, [owner.id]);
  assert.equal((await logout.POST(req({}, "synthetic-token"))).status, 200);
  assert.equal(phoneExchanges, 1);

  delete process.env.STAGING_ALLOWED_WECHAT_OPENID_SHA256;
  process.env.APP_ENV = "production";
  identity = otherId;
  persistedUser = { ...owner, wechatOpenid: otherId };
  session = { ...session, user: persistedUser };
  assert.equal((await auth.requireUser(req({}, "synthetic-token"))).wechatOpenid, otherId);
  const beforeProduction = reads;
  assert.equal((await login.POST(req(wechatBody))).status, 200);
  assert.equal(reads, beforeProduction, "ordinary login does not add a staging-only lookup");
  assert.equal((await code.POST(req(loginCode))).status, 200);
  assert.equal(sms, 1);
  latestCode = {
    id: "synthetic-code",
    codeHash: auth.hashVerificationCode({ phone: phoneNumber, scene: "LOGIN", code: "123456" }),
    expiresAt: new Date(Date.now() + 60_000),
  };
  assert.equal((await phone.POST(req({ ...loginCode, code: "123456" }))).status, 200);
  session = null;
  assert.equal((await logout.POST(req({}, "synthetic-token"))).status, 200, "ordinary logout stays idempotent");
  assert.equal((await feedback.POST(req(feedbackBody))).status, 201, "ordinary feedback remains anonymous");
  assert.deepEqual(feedbackAuthors, [owner.id, undefined]);

  const tempMedia = mkdtempSync(path.join(tmpdir(), "staging-owner-test-"));
  try {
    process.env.UPLOAD_DIR = tempMedia;
    const mediaToken = "synthetic-test-token";
    upload = {
      userId: owner.id,
      noteId: "synthetic-note",
      storageKey: "synthetic-note.webp",
      accessTokenHash: hashUploadToken(mediaToken),
      mimeType: "image/webp",
    };
    writeFileSync(path.join(tempMedia, upload.storageKey), "synthetic-image");
    const mediaContext = { params: Promise.resolve({ uploadId: "synthetic-upload" }) };
    const mediaUrl = `https://synthetic.invalid/api?token=${mediaToken}`;
    const withoutSession = new Request(mediaUrl);
    const withSession = new Request(mediaUrl, { headers: { Authorization: "Bearer synthetic-token" } });

    process.env.APP_ENV = "staging";
    process.env.STAGING_ALLOWED_WECHAT_OPENID_SHA256 = createHash("sha256").update(ownerId).digest("hex");
    const unauthorizedMedia = await media.GET(withoutSession, mediaContext);
    assert.equal(unauthorizedMedia.status, 401, "even a valid signed URL still requires a staging owner session");
    assert.equal(unauthorizedMedia.headers.get("cache-control"), "private, no-store");
    assert.equal(mediaReads, 0, "media metadata is only read after the staging owner check");
    session = { user: owner, expiresAt: new Date(Date.now() + 60_000) };
    upload.userId = "synthetic-other-account";
    assert.equal((await media.GET(withSession, mediaContext)).status, 404, "a signed URL cannot override account ownership");
    upload.userId = owner.id;
    const ownerMedia = await media.GET(withSession, mediaContext);
    assert.equal(ownerMedia.status, 200);
    assert.equal(ownerMedia.headers.get("cache-control"), "private, no-store");
    assert.equal(ownerMedia.headers.get("content-type"), "image/webp");
    assert.equal(await ownerMedia.text(), "synthetic-image");

    delete process.env.STAGING_ALLOWED_WECHAT_OPENID_SHA256;
    process.env.APP_ENV = "production";
    const signedMedia = await media.GET(withoutSession, mediaContext);
    assert.equal(signedMedia.status, 200, "ordinary signed URLs work without a bearer");
    assert.equal(signedMedia.headers.get("cache-control"), "private, max-age=31536000, immutable");
    assert.equal(signedMedia.headers.get("content-type"), "image/webp");
    assert.equal(await signedMedia.text(), "synthetic-image");
    assert.equal((await media.GET(new Request("https://synthetic.invalid/api"), mediaContext)).status, 404);
  } finally {
    delete process.env.UPLOAD_DIR;
    rmSync(tempMedia, { recursive: true, force: true });
  }
  console.log("PASS staging owner auth and media: configuration, early identity gate, old sessions, SMS denial, private media and ordinary auth/signed URLs");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
