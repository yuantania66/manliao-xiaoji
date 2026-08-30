/* eslint-disable @typescript-eslint/no-require-imports -- Mini Program production modules use CommonJS. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const wxml = readFileSync(require.resolve("../miniprogram-project/pages/auth/auth.wxml"), "utf8");
for (const label of ["微信登录", "手机号登录", "游客模式", "微信号码登录", "验证码登录", "使用其他号码", "返回登录方式"]) assert.ok(wxml.includes(label));
assert.match(wxml, /open-type="getPhoneNumber"[^>]*bindgetphonenumber="handleWechatPhone"/u);
assert.match(wxml, /open-type="chooseAvatar"[^>]*bindchooseavatar="chooseWechatAvatar"/u);
assert.match(wxml, /type="nickname"[^>]*maxlength="12"/u);
assert.match(wxml, /bindtap="chooseAlbum"/u);
assert.match(wxml, /bindtap="takePhoto"/u);

const future = new Date(Date.now() + 60000).toISOString();
let storedAuth = null;
let guest = false;
let guestProfile = null;
let pageDefinition;
let redirected = "";
let sendCalls = 0;
let loginCalls = 0;
let uploadCalls = 0;
let updateBody = null;
let nextAuth = null;
let updateCalls = 0;
let abandonCalls = 0;

global.getApp = () => ({ globalData: {} });
global.wx = { navigateTo: () => undefined, redirectTo: ({ url }) => { redirected = url; }, chooseImage: () => undefined };
global.Page = (definition) => { pageDefinition = definition; };
require.cache[require.resolve("../miniprogram-project/api/auth.js")] = { exports: {
  abandonProfileSession: (token) => { abandonCalls += 1; assert.ok(token); return Promise.resolve({ accountRemoved: true }); },
  loginWithPhone: ({ phone }) => { loginCalls += 1; assert.equal(phone, "13800000000"); return Promise.resolve(nextAuth); },
  sendCode: ({ phone }) => { sendCalls += 1; assert.equal(phone, "13800000000"); return Promise.resolve(); },
  uploadProfileAvatar: () => { uploadCalls += 1; return Promise.resolve({ uploadId: "00000000-0000-4000-8000-000000000001" }); },
  updateMe: (body) => { updateCalls += 1; updateBody = body; return Promise.resolve({ user: { id: "new", nickname: body.nickname, avatarUrl: "/avatar" } }); },
  discardProfileAvatar: () => Promise.resolve(),
  downloadProfileAvatar: () => Promise.resolve("wxfile://downloaded-avatar.jpg")
} };
require.cache[require.resolve("../miniprogram-project/utils/auth.js")] = { exports: {
  clearAuth: () => { storedAuth = null; }, enterGuest: () => { guest = true; }, getAuth: () => storedAuth, saveAuth: (auth) => { storedAuth = auth; },
  isGuest: () => guest, setGuestProfile: (profile) => { guestProfile = profile; }, updateCachedUser: (_id, user) => { storedAuth = { ...storedAuth, user }; }
} };
require.cache[require.resolve("../miniprogram-project/utils/wechat-login.js")] = { exports: { authenticateWithWechat: () => Promise.resolve(nextAuth) } };
require.cache[require.resolve("../miniprogram-project/utils/wechat-phone-login.js")] = { exports: { authenticateWithWechatPhone: () => Promise.resolve(nextAuth), getWechatPhoneCode: (detail) => { if (!detail?.code) throw new Error("没有取得手机号"); return detail.code; } } };
require.cache[require.resolve("../miniprogram-project/utils/wechat-privacy.js")] = { exports: { requireWechatPrivacyAuthorization: () => Promise.resolve(), openWechatPrivacyContract: () => undefined } };
require.cache[require.resolve("../miniprogram-project/utils/login-time-background.js")] = { exports: { getLoginBackground: () => "/assets/login-times/login-day.jpg" } };
require("../miniprogram-project/pages/auth/auth.js");
const makePage = () => ({ ...pageDefinition, data: { ...pageDefinition.data }, setData(values) { Object.assign(this.data, values); } });
const settle = async () => { for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

(async () => {
  const page = makePage(); page.onLoad({}); page.showPhoneMethods(); assert.equal(page.data.stage, "choice"); assert.match(page.data.error, /同意/u);
  page.togglePrivacy({ detail: { value: ["confirmed"] } }); page.showPhoneMethods(); page.showSms(); assert.equal(page.data.stage, "sms");
  page.inputPhone({ detail: { value: "13800000000" } }); page.sendSmsCode(); await settle(); assert.equal(sendCalls, 1);
  page.onUnload();
  page.inputCode({ detail: { value: "123456" } }); nextAuth = { token: "new", expiresAt: future, user: { id: "new", nickname: null, avatarUrl: null } };
  page.loginSms(); await settle(); assert.equal(loginCalls, 1); assert.equal(page.data.stage, "profile"); assert.equal(redirected, "");
  page.saveProfile(); assert.equal(updateCalls, 0); assert.match(page.data.error, /昵称/u);
  page.inputNickname({ detail: { value: "小满" } }); page.saveProfile(); assert.equal(updateCalls, 0); assert.match(page.data.error, /头像/u);
  page.inputNickname({ detail: { value: "" } }); page.chooseWechatAvatar({ detail: { avatarUrl: "wxfile://avatar.jpg" } }); page.saveProfile(); assert.equal(updateCalls, 0); assert.match(page.data.error, /昵称/u);
  page.inputNickname({ detail: { value: "小满" } }); assert.equal(uploadCalls, 0);
  page.saveProfile(); await settle(); assert.equal(uploadCalls, 1); assert.deepEqual(updateBody, { nickname: "小满", avatarUploadId: "00000000-0000-4000-8000-000000000001" }); assert.equal(redirected, "/pages/me/me");

  storedAuth = { token: "abandon", expiresAt: future, user: { id: "abandon", nickname: null, avatarUrl: null, profileCompletedAt: null } };
  redirected = ""; const abandoner = makePage(); abandoner.onLoad({}); assert.equal(abandoner.data.stage, "profile"); abandoner.abandonProfile(); await settle();
  assert.equal(abandonCalls, 1); assert.equal(storedAuth, null); assert.equal(abandoner.data.stage, "choice");

  const stale = makePage(); const staleAttempt = stale.beginAttempt(); stale.invalidateAttempts(); stale.acceptAuth(staleAttempt, { token: "stale", expiresAt: future, user: { id: "stale", nickname: null, avatarUrl: null, profileCompletedAt: null } }); await settle();
  assert.equal(abandonCalls, 2, "a discarded login result must revoke its server session"); assert.equal(storedAuth, null);

  storedAuth = null; redirected = ""; const visitor = makePage(); visitor.showGuestWarning(); visitor.showGuestIdentity(); visitor.randomizeGuest(); visitor.startGuest();
  assert.equal(guest, true); assert.ok(guestProfile.nickname); assert.equal(redirected, "/pages/me/me");
  redirected = ""; const returningGuest = makePage(); returningGuest.onLoad({}); assert.equal(redirected, "/pages/me/me");
  console.log("Unified auth-flow checks passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
