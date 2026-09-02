import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const storage = new Map();
const app = { globalData: { user: null, token: "" } };
let runtimeEnvVersion = "develop";
global.getApp = () => app;
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: runtimeEnvVersion } }),
  login: () => {},
  getPrivacySetting: ({ success }) => success({ needAuthorization: false }),
  requirePrivacyAuthorize: ({ success }) => success(),
  openPrivacyContract: ({ success }) => success && success(),
  chooseImage: () => {},
  redirectTo: () => {},
  showToast: () => {},
  getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, right: 360 }),
  getSystemInfoSync: () => ({
    statusBarHeight: 20,
    windowWidth: 390,
    screenHeight: 844,
    safeArea: { bottom: 810 }
  }),
  getWindowInfo: () => ({ screenHeight: 844, safeArea: { bottom: 810 } })
};

const authPath = require.resolve("../miniprogram-project/utils/auth.js");
const apiPath = require.resolve("../miniprogram-project/api/auth.js");
const homePath = require.resolve("../miniprogram-project/pages/home/home.js");
const mePath = require.resolve("../miniprogram-project/pages/me/me.js");
const homeWxml = readFileSync(new URL("../miniprogram-project/pages/home/home.wxml", import.meta.url), "utf8");
const homeWxss = readFileSync(new URL("../miniprogram-project/pages/home/home.wxss", import.meta.url), "utf8");
const meWxml = readFileSync(new URL("../miniprogram-project/pages/me/me.wxml", import.meta.url), "utf8");
const settingsWxml = readFileSync(new URL("../miniprogram-project/pages/settings/settings.wxml", import.meta.url), "utf8");
const privacyWxml = readFileSync(new URL("../miniprogram-project/pages/privacy/privacy.wxml", import.meta.url), "utf8");
for (const label of ["微信登录", "手机号登录"]) {
  assert.match(homeWxml, new RegExp(label));
  assert.match(meWxml, new RegExp(label));
}
assert.match(homeWxml, /游客模式/);
assert.match(homeWxml, /class="entry-background"[^>]*src="{{entryBackground}}"[^>]*mode="aspectFill"/);
assert.match(homeWxss, /\.entry-mask[\s\S]*?background:\s*rgba\(0,\s*0,\s*0,\s*0\.18\)/);
for (const markup of [homeWxml, meWxml]) {
  assert.match(markup, /创建或登录慢聊小记账号/);
  assert.match(markup, /继续后将打开微信手机号授权界面。只有你主动选择并允许后，我们才会通过微信取得并处理该手机号，用于创建或登录账号。/);
  assert.match(markup, /open-type="getPhoneNumber"[\s\S]*?>{{isLoggingIn \? "登录中\.\.\." : "继续"}}<\/button>/);
  assert.match(markup, /bindtap="cancelPhoneLogin"[\s\S]*?>取消<\/button>/);
}
assert.match(privacyWxml, /选择微信登录.*登录凭证和对应的账号标识/);
assert.match(privacyWxml, /微信登录不会自动获取你的手机号、头像或昵称/);
assert.match(privacyWxml, /选择微信绑定手机号码登录.*微信界面中确认的绑定号码.*当前版本暂不开放其他手机号短信验证码登录/);
assert.doesNotMatch(meWxml, /profile-editor-mask/);
assert.match(meWxml, /头像和昵称是可选资料，可以随时修改/);
assert.doesNotMatch(meWxml, /bindtap="exitRequiredProfile"/);
assert.match(meWxml, /bindtap="skipProfile"[^>]*>取消<\/button>/);
assert.doesNotMatch(meWxml, /type="nickname"/);
assert.match(meWxml, /wx:if="\{\{!isLoggedIn\}\}"[^>]*url="\/pages\/auth\/auth\?mode=login"[^>]*>登录或注册/u);
assert.match(settingsWxml, /wx:if="\{\{dataMode === 'guest'\}\}"[^>]*url="\/pages\/auth\/auth\?mode=login"[^>]*>登录或注册/u);
assert.match(privacyWxml, /头像和昵称属于可选个人资料/);
assert.match(privacyWxml, /头像不要求是真人照片/);
assert.match(privacyWxml, /不会在你操作前自动读取这些资料/);
assert.match(privacyWxml, /不会提供给 AI，也不会用于人脸识别/);
const auth = require(authPath);
const local = require("../miniprogram-project/utils/local-data.js");
const {
  getLoginBackground,
  getLoginBackgroundInsetTop,
  getLoginBackgroundTopColor,
  getLoginTimeSlot
} = require("../miniprogram-project/utils/login-time-background.js");
for (const [hour, slot] of [[4, "night"], [5, "dawn"], [8, "dawn"], [9, "day"], [16, "day"], [17, "dusk"], [19, "dusk"], [20, "night"], [23, "night"]]) {
  assert.equal(getLoginTimeSlot(hour), slot);
  assert.equal(getLoginBackground(hour), `/assets/login-times/login-${slot}.jpg`);
  assert.match(getLoginBackgroundTopColor(hour), /^#[0-9a-f]{6}$/u);
}
assert.notEqual(getLoginBackgroundTopColor(18), getLoginBackgroundTopColor(12));
for (const device of [
  { system: { windowWidth: 375, statusBarHeight: 20 }, menu: { bottom: 56 } },
  { system: { windowWidth: 390, statusBarHeight: 47 }, menu: { bottom: 88 } },
  { system: { windowWidth: 430, statusBarHeight: 59 }, menu: { bottom: 100 } }
]) {
  const inset = getLoginBackgroundInsetTop(device.system, device.menu);
  const archTop = inset + device.system.windowWidth * 56 / 750;
  assert.ok(archTop >= device.menu.bottom + 8, "background arch must clear the capsule on every device");
}
const future = new Date(Date.now() + 60_000).toISOString();
const validAuth = {
  token: "valid-token",
  expiresAt: future,
  user: { id: "user-a", phone: "13800000000", nickname: null, avatarUrl: null, createdAt: new Date().toISOString() }
};
const completeAuth = {
  ...validAuth,
  token: "complete-token",
  user: { ...validAuth.user, id: "complete-user", nickname: "完整用户", avatarUrl: "/avatar/complete", profileCompletedAt: future }
};

assert.equal(auth.isUsableAuth(validAuth), true);
for (const invalid of [
  null,
  {},
  [],
  { token: "x" },
  { token: "local_demo_x", expiresAt: future },
  { token: "x", expiresAt: "bad" },
  { token: "x", expiresAt: new Date(0).toISOString() },
  { token: "x", expiresAt: future },
  { token: "x", expiresAt: future, user: null },
  { token: "x", expiresAt: future, user: [] },
  { token: "x", expiresAt: future, user: { id: "" } },
  { token: "x", expiresAt: future, user: { id: "   " } }
]) {
  assert.equal(auth.isUsableAuth(invalid), false);
}

const legacyDraft = { content: "旧草稿", mediaItems: [], selectedMood: null, clientRequestId: "legacy-owner-freeze" };
storage.clear();
auth.enterGuest();
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
auth.saveAuth({ ...validAuth, token: "guest-to-b", user: { ...validAuth.user, id: "user-b" } });
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "guest");
assert.equal(local.readNoteDraft("authenticated:user-b"), null, "B must not claim unopened guest A v1");
auth.enterGuest();
assert.deepEqual(local.readNoteDraft("guest"), { ...legacyDraft, owner: "guest" }, "guest A must recover and migrate its v1");

storage.clear();
auth.saveAuth(validAuth);
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
auth.enterGuest();
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "authenticated:user-a");
assert.equal(local.readNoteDraft("guest"), null, "guest must not claim unopened account A v1");
auth.saveAuth(validAuth);
assert.deepEqual(local.readNoteDraft("authenticated:user-a"), { ...legacyDraft, owner: "authenticated:user-a" }, "account A must recover its v1");

storage.clear();
auth.saveAuth(validAuth);
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
auth.clearAuth();
assert.equal(auth.getDataOwner(), "none");
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "authenticated:user-a", "logout must freeze the departing account owner");

storage.clear();
auth.enterGuest();
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
storage.set("xinqingMiniNoteDraft:v1:owner", "authenticated:prior-owner");
auth.saveAuth({ ...validAuth, token: "different-claim", user: { ...validAuth.user, id: "user-b" } });
assert.equal(auth.getDataOwner(), "authenticated:user-b");
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "authenticated:prior-owner", "a different existing claim must not be overwritten");
assert.equal(local.readNoteDraft("authenticated:user-b"), null);

storage.clear();
auth.saveAuth(validAuth);
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
storage.set("xinqingAuth", {
  ...validAuth,
  token: "expired-a-token",
  expiresAt: new Date(0).toISOString()
});
assert.equal(auth.getAuth(), null, "expired A must not restore a usable login");
assert.equal(auth.getDataOwner(), "none");
assert.equal(storage.has("xinqingAuth"), false, "expired A auth is discarded only after claim");
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "authenticated:user-a", "expired A must freeze the unopened v1 claim");
auth.saveAuth({ ...validAuth, token: "user-b-after-expired-a", user: { ...validAuth.user, id: "user-b" } });
assert.equal(local.readNoteDraft("authenticated:user-b"), null, "B must not claim expired A's unopened v1");
assert.deepEqual(storage.get("xinqingMiniNoteDraft:v1"), legacyDraft);
auth.saveAuth(validAuth);
assert.deepEqual(
  local.readNoteDraft("authenticated:user-a"),
  { ...legacyDraft, owner: "authenticated:user-a" },
  "A must still recover the draft after re-login"
);

storage.clear();
auth.saveAuth(validAuth);
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
storage.set("xinqingAuth", {
  ...validAuth,
  token: "expired-a-direct-switch",
  expiresAt: new Date(0).toISOString()
});
auth.saveAuth({ ...validAuth, token: "user-b-direct-after-expired", user: { ...validAuth.user, id: "user-b" } });
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "authenticated:user-a", "direct B login must still freeze expired A from raw auth");
assert.equal(local.readNoteDraft("authenticated:user-b"), null);

storage.clear();
auth.saveAuth(validAuth);
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
storage.set("xinqingAuth", {
  ...validAuth,
  token: "expired-a-claim-fail",
  expiresAt: new Date(0).toISOString()
});
const expiredClaimSet = wx.setStorageSync;
wx.setStorageSync = (key, value) => {
  if (key === "xinqingMiniNoteDraft:v1:owner") throw new Error("claim unavailable");
  return expiredClaimSet(key, value);
};
assert.equal(auth.getAuth(), null, "failed claim must not restore expired login");
assert.equal(storage.has("xinqingAuth"), true, "failed claim must keep the expired identity record for retry");
assert.equal(storage.has("xinqingMiniNoteDraft:v1:owner"), false);
wx.setStorageSync = expiredClaimSet;
assert.equal(auth.getAuth(), null);
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "authenticated:user-a", "retry after claim storage recovers must freeze A");
assert.equal(storage.has("xinqingAuth"), false);

storage.clear();
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
storage.set("xinqingAuth", { user: { id: "user-a" } });
auth.saveAuth({ ...validAuth, token: "user-b-after-malformed-a", user: { ...validAuth.user, id: "user-b" } });
assert.equal(local.readNoteDraft("authenticated:user-b"), null, "malformed raw auth must not let B observe unclaimed v1");
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "sealed:invalid-auth");
assert.notEqual(storage.get("xinqingMiniNoteDraft:v1:owner"), "authenticated:user-a");
assert.deepEqual(storage.get("xinqingMiniNoteDraft:v1"), legacyDraft);

storage.clear();
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
storage.set("xinqingAuth", { user: { id: "user-b" } });
auth.saveAuth({ ...validAuth, token: "user-b-after-forged-b", user: { ...validAuth.user, id: "user-b" } });
assert.equal(
  local.readNoteDraft("authenticated:user-b"),
  null,
  "forged user-only residue matching B must not mint a claim B can read"
);
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "sealed:invalid-auth");

storage.clear();
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
storage.set("xinqingAuth", { token: "x", expiresAt: "bad", user: { id: "user-a" } });
auth.saveAuth({ ...validAuth, token: "user-b-after-bad-expiry", user: { ...validAuth.user, id: "user-b" } });
assert.equal(local.readNoteDraft("authenticated:user-b"), null, "bad expiresAt must not mint an owner claim");
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "sealed:invalid-auth");

storage.clear();
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
storage.set("xinqingAuth", { token: "", expiresAt: future, user: { id: "user-a" } });
auth.saveAuth({ ...validAuth, token: "user-b-after-empty-token", user: { ...validAuth.user, id: "user-b" } });
assert.equal(local.readNoteDraft("authenticated:user-b"), null, "empty token must not mint an owner claim");
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "sealed:invalid-auth");

storage.clear();
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
storage.set("xinqingAuth", { token: "local_demo_x", expiresAt: new Date(0).toISOString(), user: { id: "user-a" } });
auth.saveAuth({ ...validAuth, token: "user-b-after-demo-token", user: { ...validAuth.user, id: "user-b" } });
assert.equal(local.readNoteDraft("authenticated:user-b"), null, "demo token residue must not mint an owner claim");
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "sealed:invalid-auth");

storage.clear();
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
storage.set("xinqingAuth", { user: { id: "user-a" } });
const malformedSealSet = wx.setStorageSync;
wx.setStorageSync = (key, value) => {
  if (key === "xinqingMiniNoteDraft:v1:owner") throw new Error("seal unavailable");
  return malformedSealSet(key, value);
};
assert.equal(auth.getAuth(), null, "failed seal must not restore malformed login");
assert.equal(storage.has("xinqingAuth"), true, "failed seal must keep malformed residue for retry");
assert.equal(storage.has("xinqingMiniNoteDraft:v1:owner"), false);
wx.setStorageSync = malformedSealSet;
assert.equal(auth.getAuth(), null);
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "sealed:invalid-auth", "retry after seal storage recovers must seal v1");
assert.equal(storage.has("xinqingAuth"), false);

storage.clear();
storage.set("xinqingMiniNoteDraft:v1", { ...legacyDraft, content: "synthetic-original", clientRequestId: "legacy-persistent-seal" });
storage.set("xinqingAuth", { user: { id: "user-a" } });
const persistentSealFail = wx.setStorageSync;
wx.setStorageSync = (key, value) => {
  if (key === "xinqingMiniNoteDraft:v1:owner") throw new Error("seal unavailable");
  return persistentSealFail(key, value);
};
assert.equal(auth.getAuth(), null, "persistent seal failure must not restore malformed login");
assert.equal(storage.has("xinqingAuth"), true, "malformed residue waits for seal retry");
assert.throws(
  () => auth.saveAuth({ ...validAuth, token: "b-while-seal-down", user: { ...validAuth.user, id: "user-b" } }),
  /草稿归属暂时无法确认/,
  "saveAuth must not overwrite a residue that still needs sealing"
);
assert.deepEqual(storage.get("xinqingAuth"), { user: { id: "user-a" } }, "malformed raw auth must stay until seal succeeds");
assert.equal(storage.has("xinqingMiniNoteDraft:v1:owner"), false);
assert.equal(storage.get("xinqingMiniNoteDraft:v1").content, "synthetic-original");
assert.equal(auth.getDataOwner(), "none");
assert.throws(() => auth.enterGuest(), /草稿归属暂时无法确认/, "enterGuest must not run while seal is pending");
assert.equal(storage.get("xinqingGuestMode"), undefined);
assert.deepEqual(storage.get("xinqingAuth"), { user: { id: "user-a" } });
assert.throws(() => auth.clearAuth(), /草稿归属暂时无法确认/, "clearAuth must not drop a residue waiting to seal");
assert.deepEqual(storage.get("xinqingAuth"), { user: { id: "user-a" } });
assert.equal(storage.get("xinqingMiniNoteDraft:v1").content, "synthetic-original");
wx.setStorageSync = persistentSealFail;
auth.saveAuth({ ...validAuth, token: "b-after-seal-recovered", user: { ...validAuth.user, id: "user-b" } });
assert.equal(auth.getDataOwner(), "authenticated:user-b");
assert.equal(local.readNoteDraft("authenticated:user-b"), null, "after seal recovers, B still must not observe the sealed draft");
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "sealed:invalid-auth");
assert.equal(storage.get("xinqingMiniNoteDraft:v1").content, "synthetic-original");

storage.clear();
auth.enterGuest();
storage.set("xinqingMiniNoteDraft:v1", { content: 1, mediaItems: "bad" });
auth.saveAuth({ ...validAuth, token: "corrupt-v1", user: { ...validAuth.user, id: "user-b" } });
assert.equal(auth.getDataOwner(), "authenticated:user-b", "corrupt v1 may be ignored without blocking the switch");
assert.equal(storage.has("xinqingMiniNoteDraft:v1:owner"), false);

storage.clear();
auth.enterGuest();
storage.set("xinqingMiniNoteDraft:v1", legacyDraft);
const freezeSetStorageSync = wx.setStorageSync;
wx.setStorageSync = (key, value) => {
  if (key === "xinqingMiniNoteDraft:v1:owner") throw new Error("claim unavailable");
  return freezeSetStorageSync(key, value);
};
assert.throws(() => auth.saveAuth({ ...validAuth, token: "must-not-switch", user: { ...validAuth.user, id: "user-b" } }), /草稿归属暂时无法确认/);
assert.equal(auth.getDataOwner(), "guest", "claim write failure must preserve the guest identity");
assert.deepEqual(storage.get("xinqingMiniNoteDraft:v1"), legacyDraft);
assert.equal(storage.has("xinqingAuth"), false);
wx.setStorageSync = freezeSetStorageSync;

const freezeGetStorageSync = wx.getStorageSync;
wx.getStorageSync = (key) => {
  if (key === "xinqingMiniNoteDraft:v1:owner") throw new Error("claim unreadable");
  return freezeGetStorageSync(key);
};
assert.throws(() => auth.saveAuth({ ...validAuth, token: "must-not-switch-read", user: { ...validAuth.user, id: "user-b" } }), /草稿归属暂时无法确认/);
wx.getStorageSync = freezeGetStorageSync;
assert.equal(auth.getDataOwner(), "guest", "claim read failure must preserve the guest identity");

wx.setStorageSync = (key, value) => key === "xinqingMiniNoteDraft:v1:owner" ? undefined : freezeSetStorageSync(key, value);
assert.throws(() => auth.saveAuth({ ...validAuth, token: "must-not-switch-verify", user: { ...validAuth.user, id: "user-b" } }), /草稿归属暂时无法确认/);
assert.equal(auth.getDataOwner(), "guest", "claim verification failure must preserve the guest identity");
assert.deepEqual(storage.get("xinqingMiniNoteDraft:v1"), legacyDraft);
wx.setStorageSync = freezeSetStorageSync;

storage.set("xinqingAuth", { token: "expired", expiresAt: new Date(0).toISOString() });
assert.equal(auth.getAuth(), null);
assert.equal(storage.has("xinqingAuth"), false);
assert.throws(() => auth.saveAuth({ token: "bad" }), /登录响应无效/);
for (const key of ["xinqingMiniGuestChatMessages", "xinqingMiniGuestNotes", "xinqingMiniChatMessages", "xinqingMiniNotes"]) storage.set(key, "private-guest-data");
storage.set("xinqingGuestMode", true);
auth.saveAuth(validAuth);
for (const key of ["xinqingMiniGuestChatMessages", "xinqingMiniGuestNotes", "xinqingMiniChatMessages", "xinqingMiniNotes"]) assert.equal(storage.get(key), "private-guest-data");
assert.equal(storage.has("xinqingGuestMode"), false);
assert.equal(auth.getDataOwner(), "authenticated:user-a");

const refreshedAuth = { ...validAuth, token: "refreshed-token" };
auth.saveAuth(refreshedAuth);
assert.equal(auth.getDataOwner(), "authenticated:user-a", "token refresh must keep the same stable owner");
auth.clearAuth();
for (const key of ["xinqingMiniGuestChatMessages", "xinqingMiniGuestNotes", "xinqingMiniChatMessages", "xinqingMiniNotes"]) assert.equal(storage.get(key), "private-guest-data", "logout must preserve guest-owned content");

storage.clear();
storage.set("xinqingGuestMode", true);
storage.set("xinqingMiniGuestNotes", "guest-note-before-failed-login");
const originalSetStorageSync = wx.setStorageSync;
wx.setStorageSync = (key, value) => {
  if (key === "xinqingAuth") throw new Error("storage unavailable");
  return originalSetStorageSync(key, value);
};
assert.throws(() => auth.saveAuth(validAuth), /storage unavailable/);
assert.equal(storage.has("xinqingAuth"), false, "failed auth write must not switch identity");
assert.equal(storage.get("xinqingGuestMode"), true);
assert.equal(storage.get("xinqingMiniGuestNotes"), "guest-note-before-failed-login");
wx.setStorageSync = originalSetStorageSync;

storage.clear();
auth.saveAuth(validAuth);
wx.setStorageSync = (key, value) => {
  if (key === "xinqingGuestMode") throw new Error("guest marker unavailable");
  return originalSetStorageSync(key, value);
};
assert.throws(() => auth.enterGuest(), /guest marker unavailable/);
assert.equal(auth.getAuth().token, validAuth.token, "failed guest marker write must preserve the account");
assert.equal(auth.isGuest(), false);
assert.equal(app.globalData.token, validAuth.token);
wx.setStorageSync = originalSetStorageSync;

const originalRemoveStorageSync = wx.removeStorageSync;
wx.removeStorageSync = (key) => {
  if (key === "xinqingAuth") throw new Error("auth removal unavailable");
  return originalRemoveStorageSync(key);
};
assert.throws(() => auth.enterGuest(), /auth removal unavailable/);
assert.equal(auth.getAuth().token, validAuth.token, "failed auth removal must roll back to the account");
assert.equal(auth.isGuest(), false, "failed auth removal must remove the staged guest marker");
assert.equal(app.globalData.token, validAuth.token);
wx.removeStorageSync = originalRemoveStorageSync;

delete require.cache[require.resolve("../miniprogram-project/config/api.js")];
const apiConfig = require("../miniprogram-project/config/api.js");
runtimeEnvVersion = "develop";
assert.equal(
  apiConfig.getApiBaseUrl(),
  "https://manliaoxiaoji.com",
  "a fresh preview must use the production HTTPS API by default",
);

storage.set("xinqing_api_env", "local");
storage.set("xinqing_api_base_url", "http://attacker.invalid");
for (const envVersion of ["release", "trial", "unknown"]) {
  runtimeEnvVersion = envVersion;
  assert.equal(apiConfig.getApiBaseUrl(), "https://manliaoxiaoji.com");
}
wx.getAccountInfoSync = () => { throw new Error("unavailable"); };
assert.equal(apiConfig.getApiBaseUrl(), "https://manliaoxiaoji.com");
wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: runtimeEnvVersion } });
runtimeEnvVersion = "develop";
assert.equal(apiConfig.getApiBaseUrl(), "http://attacker.invalid");

const { request } = require("../miniprogram-project/utils/request.js");
let pendingRequest;
wx.request = (options) => { pendingRequest = options; };
const userBAuth = { ...validAuth, token: "user-b-token", user: { ...validAuth.user, id: "user-b" } };

storage.clear();
auth.saveAuth(validAuth);
const stale401 = request({ url: "/test" }).catch((error) => error);
auth.saveAuth(userBAuth);
pendingRequest.success({ statusCode: 401 });
assert.match((await stale401).message, /登录状态已过期/);
assert.equal(auth.getAuth().token, "user-b-token", "late 401 from user A must not clear user B");

storage.clear();
auth.saveAuth(validAuth);
const guest401 = request({ url: "/test" }).catch((error) => error);
auth.enterGuest();
pendingRequest.success({ statusCode: 401 });
await guest401;
assert.equal(auth.getAuth(), null);
assert.equal(auth.isGuest(), true, "late 401 must not clear guest mode");

storage.clear();
auth.saveAuth(validAuth);
const current401 = request({ url: "/test" }).catch((error) => error);
pendingRequest.success({ statusCode: 401 });
await current401;
assert.equal(auth.getAuth(), null, "401 for the current token must clear auth");

storage.clear();
auth.saveAuth(validAuth);
const public401 = request({ url: "/auth/login", auth: false }).catch((error) => error);
pendingRequest.success({ statusCode: 401 });
await public401;
assert.equal(auth.getAuth().token, validAuth.token, "401 from an unauthenticated request must not clear auth");

let getMeImpl = () => Promise.resolve({ user: validAuth.user });
let phoneLoginImpl = () => Promise.resolve(validAuth);
let wechatLoginImpl = () => Promise.resolve(validAuth);
let phoneApiCalls = 0;
const api = require(apiPath);
runtimeEnvVersion = "release";
let sessionRequestUrls = [];
wx.request = (options) => {
  sessionRequestUrls.push(options.url);
  options.success(sessionRequestUrls.length === 1
    ? { statusCode: 404, data: { message: "not found" } }
    : { statusCode: 200, data: { ok: true, data: { loggedOut: true } } });
};
await api.abandonProfileSession("legacy-profile-token");
assert.deepEqual(sessionRequestUrls.map((url) => new URL(url).pathname), [
  "/api/auth/profile-abandon",
  "/api/auth/logout"
]);
sessionRequestUrls = [];
wx.request = (options) => {
  sessionRequestUrls.push(options.url);
  options.success(sessionRequestUrls.length === 1
    ? { statusCode: 404, data: { message: "not found" } }
    : { statusCode: 401, data: { message: "expired" } });
};
await api.abandonProfileSession("expired-profile-token");
assert.equal(sessionRequestUrls.length, 2, "an expired server session must not trap the user on required profile");
sessionRequestUrls = [];
wx.request = (options) => {
  sessionRequestUrls.push(options.url);
  options.success({ statusCode: 500, data: { message: "cleanup failed" } });
};
await assert.rejects(api.abandonProfileSession("candidate-profile-token"), /cleanup failed/);
assert.equal(sessionRequestUrls.length, 1, "server failures must not be hidden by logout fallback");
api.getMe = () => getMeImpl();
api.loginWithWechatPhone = (codes) => {
  phoneApiCalls += 1;
  return phoneLoginImpl(codes);
};
api.loginWithWechat = (code) => wechatLoginImpl(code);

const loadPage = (path) => {
  let definition;
  global.Page = (value) => { definition = value; };
  delete require.cache[path];
  require(path);
  definition.data = { ...definition.data };
  definition.setData = (next) => Object.assign(definition.data, next);
  return definition;
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

const timeAwareHome = loadPage(homePath);
for (const [hour, asset] of [[5, "login-dawn.jpg"], [9, "login-day.jpg"], [17, "login-dusk.jpg"], [20, "login-night.jpg"]]) {
  timeAwareHome.updateEntryBackground(hour);
  assert.match(timeAwareHome.data.entryBackground, new RegExp(`${asset}$`));
}
assert.match(timeAwareHome.onShow.toString(), /updateEntryBackground/);

storage.clear();
storage.set("xinqingAuth", validAuth);
let redirectedTo = "";
wx.redirectTo = ({ url }) => { redirectedTo = url; };
const home = loadPage(homePath);
let resolveCheck;
let checks = 0;
getMeImpl = () => {
  checks += 1;
  return new Promise((resolve) => { resolveCheck = resolve; });
};
home.reconcileAuth();
home.reconcileAuth();
assert.equal(checks, 1);
resolveCheck({ user: validAuth.user });
await tick();
assert.equal(home.data.showEntry, false, "optional profile must not hide home functions");
assert.equal(redirectedTo, "");

storage.clear();
auth.saveAuth(completeAuth);
redirectedTo = "";
getMeImpl = () => Promise.resolve({ user: completeAuth.user });
const completeHome = loadPage(homePath);
completeHome.reconcileAuth();
await tick();
assert.equal(completeHome.data.showEntry, false);
assert.equal(redirectedTo, "", "complete restored account must stay on home");

storage.clear();
auth.saveAuth(validAuth);
redirectedTo = "";
let resolveStaleHomeCheck;
getMeImpl = () => new Promise((resolve) => { resolveStaleHomeCheck = resolve; });
const staleAccountHome = loadPage(homePath);
staleAccountHome.reconcileAuth();
auth.saveAuth(completeAuth);
resolveStaleHomeCheck({ user: validAuth.user });
await tick();
assert.equal(auth.getAuth().user.id, completeAuth.user.id);
assert.equal(redirectedTo, "", "late incomplete user A check must not redirect complete user B");

storage.clear();
auth.saveAuth(validAuth);
getMeImpl = () => Promise.reject(new Error("网络暂时不可用"));
home.reconcileAuth();
await tick();
assert.equal(auth.getAuth().token, validAuth.token);
assert.equal(home.data.showEntry, true);
assert.match(home.data.entryError, /无法验证/);

storage.set("xinqingAuth", validAuth);
getMeImpl = () => {
  auth.clearAuth();
  return Promise.reject(new Error("登录状态已过期，请重新登录"));
};
home.reconcileAuth();
await tick();
assert.equal(auth.getAuth(), null);
assert.equal(home.data.showEntry, true);
assert.match(home.data.entryError, /已失效/);

storage.set("xinqingAuth", validAuth);
let lateResolve;
getMeImpl = () => new Promise((resolve) => { lateResolve = resolve; });
home.reconcileAuth();
home.enterGuest();
lateResolve({ user: validAuth.user });
await tick();
assert.equal(home.data.showEntry, false);
assert.equal(storage.get("xinqingGuestMode"), true);

storage.clear();
const unconfirmedHome = loadPage(homePath);
let wxLoginCalls = 0;
wx.login = () => { wxLoginCalls += 1; };
unconfirmedHome.preparePhoneLogin();
assert.equal(wxLoginCalls, 0);
assert.equal(unconfirmedHome.data.phoneLoginReady, false);
assert.match(unconfirmedHome.data.entryError, /隐私政策/);

unconfirmedHome.loginWithWechatAccount();
assert.equal(wxLoginCalls, 0, "unconfirmed WeChat login must not call wx.login");
assert.match(unconfirmedHome.data.entryError, /隐私政策/);

const preparedHome = loadPage(homePath);
preparedHome.data.privacyConfirmed = true;
preparedHome.preparePhoneLogin();
await tick();
assert.equal(preparedHome.data.phoneLoginReady, true);
assert.equal(wxLoginCalls, 0, "preparing privacy must not request a phone or login code");
assert.equal(phoneApiCalls, 0, "showing phone confirmation must not call phone login API");
assert.equal(auth.getAuth(), null);

storage.clear();
const cancelledPhoneHome = loadPage(homePath);
cancelledPhoneHome.data.privacyConfirmed = true;
wx.getPrivacySetting = ({ success }) => success({ needAuthorization: false });
cancelledPhoneHome.preparePhoneLogin();
await tick();
assert.equal(cancelledPhoneHome.data.phoneLoginReady, true);
cancelledPhoneHome.cancelPhoneLogin();
assert.equal(cancelledPhoneHome.data.phoneLoginReady, false);
assert.equal(cancelledPhoneHome.data.isLoggingIn, false);
assert.equal(auth.getAuth(), null);
assert.equal(auth.isGuest(), false);
assert.equal(wxLoginCalls, 0, "cancelling phone confirmation must not call wx.login");
assert.equal(phoneApiCalls, 0, "cancelling phone confirmation must not call phone login API");

storage.clear();
const staleWechatPrivacyHome = loadPage(homePath);
staleWechatPrivacyHome.data.privacyConfirmed = true;
let resolveWechatPrivacy;
wx.getPrivacySetting = ({ success }) => { resolveWechatPrivacy = success; };
wxLoginCalls = 0;
wx.login = () => { wxLoginCalls += 1; };
let staleWechatApiCalls = 0;
wechatLoginImpl = () => { staleWechatApiCalls += 1; return Promise.resolve(validAuth); };
staleWechatPrivacyHome.loginWithWechatAccount();
staleWechatPrivacyHome.enterGuest();
resolveWechatPrivacy({ needAuthorization: false });
await tick();
assert.equal(wxLoginCalls, 0, "stale privacy resolution must not call wx.login");
assert.equal(staleWechatApiCalls, 0, "stale privacy resolution must not call login API");
assert.equal(auth.isGuest(), true);

storage.clear();
const cancelledWechatPrivacyMe = loadPage(mePath);
cancelledWechatPrivacyMe.data.privacyConfirmed = true;
wx.getPrivacySetting = ({ success }) => { resolveWechatPrivacy = success; };
wxLoginCalls = 0;
wx.login = () => { wxLoginCalls += 1; };
staleWechatApiCalls = 0;
cancelledWechatPrivacyMe.loginWithWechatAccount();
cancelledWechatPrivacyMe.togglePrivacy({ detail: { value: [] } });
resolveWechatPrivacy({ needAuthorization: false });
await tick();
assert.equal(wxLoginCalls, 0, "revoked privacy confirmation must not call wx.login");
assert.equal(staleWechatApiCalls, 0, "revoked privacy confirmation must not call login API");
assert.equal(cancelledWechatPrivacyMe.data.isLoggingIn, false);

storage.clear();
redirectedTo = "";
wx.redirectTo = ({ url }) => { redirectedTo = url; };
const wechatHome = loadPage(homePath);
wechatHome.data.privacyConfirmed = true;
let wechatApiCalls = 0;
const wechatLoginOrder = [];
wechatLoginImpl = (code) => {
  wechatLoginOrder.push("api");
  wechatApiCalls += 1;
  assert.equal(code, "wechat-account-code");
  return Promise.resolve({ ...validAuth, user: { ...validAuth.user, phone: null } });
};
wx.getPrivacySetting = ({ success }) => {
  wechatLoginOrder.push("privacy");
  success({ needAuthorization: false });
};
wx.login = ({ success }) => {
  wechatLoginOrder.push("wx.login");
  success({ code: "wechat-account-code" });
};
wechatHome.loginWithWechatAccount();
await tick();
await tick();
assert.equal(wechatApiCalls, 1);
assert.deepEqual(wechatLoginOrder, ["privacy", "wx.login", "api"]);
assert.equal(auth.getAuth().user.phone, null, "WeChat login must not request or invent a phone");
assert.equal(redirectedTo, "/pages/auth/auth");

storage.clear();
const emptyWechatHome = loadPage(homePath);
emptyWechatHome.data.privacyConfirmed = true;
wechatApiCalls = 0;
wx.login = ({ success }) => success({ code: "" });
emptyWechatHome.loginWithWechatAccount();
await tick();
assert.equal(wechatApiCalls, 0);
assert.match(emptyWechatHome.data.entryError, /有效登录凭证/);
assert.equal(auth.getAuth(), null);
assert.equal(auth.isGuest(), false);
assert.equal(emptyWechatHome.data.isLoggingIn, false);

storage.clear();
const failedWxHome = loadPage(homePath);
failedWxHome.data.privacyConfirmed = true;
wx.login = ({ fail }) => fail(new Error("private wx detail"));
failedWxHome.loginWithWechatAccount();
await tick();
assert.equal(auth.getAuth(), null);
assert.equal(auth.isGuest(), false);
assert.equal(failedWxHome.data.isLoggingIn, false);
assert.match(failedWxHome.data.entryError, /微信登录失败/);

storage.clear();
const rejectedWechatHome = loadPage(homePath);
rejectedWechatHome.data.privacyConfirmed = true;
wx.login = ({ success }) => success({ code: "rejected-wechat-code" });
wechatLoginImpl = () => Promise.reject(new Error("登录服务拒绝"));
rejectedWechatHome.loginWithWechatAccount();
await tick();
await tick();
assert.equal(auth.getAuth(), null);
assert.equal(auth.isGuest(), false);
assert.equal(rejectedWechatHome.data.isLoggingIn, false);
assert.match(rejectedWechatHome.data.entryError, /登录服务拒绝/);

storage.clear();
const invalidWechatHome = loadPage(homePath);
invalidWechatHome.data.privacyConfirmed = true;
wechatLoginImpl = () => Promise.resolve({ token: "malformed-token", expiresAt: future });
invalidWechatHome.loginWithWechatAccount();
await tick();
await tick();
assert.equal(auth.getAuth(), null);
assert.equal(auth.isGuest(), false);
assert.equal(invalidWechatHome.data.isLoggingIn, false);
assert.match(invalidWechatHome.data.entryError, /登录响应无效/);

storage.clear();
const guestDuringWechatHome = loadPage(homePath);
guestDuringWechatHome.data.privacyConfirmed = true;
let resolveGuestWechatLogin;
wechatLoginImpl = () => new Promise((resolve) => { resolveGuestWechatLogin = resolve; });
wx.login = ({ success }) => success({ code: "guest-late-wechat-code" });
guestDuringWechatHome.loginWithWechatAccount();
await tick();
guestDuringWechatHome.enterGuest();
resolveGuestWechatLogin(validAuth);
await tick();
assert.equal(auth.getAuth(), null);
assert.equal(auth.isGuest(), true);
assert.equal(guestDuringWechatHome.data.isLoggingIn, false);

storage.clear();
const staleWechatHome = loadPage(homePath);
staleWechatHome.data.privacyConfirmed = true;
let resolveWechatLogin;
wechatLoginImpl = () => new Promise((resolve) => { resolveWechatLogin = resolve; });
wx.login = ({ success }) => success({ code: "late-wechat-code" });
staleWechatHome.loginWithWechatAccount();
await tick();
const switchedAuth = { ...validAuth, token: "user-b-token", user: { ...validAuth.user, id: "user-b" } };
auth.saveAuth(switchedAuth);
resolveWechatLogin(validAuth);
await tick();
assert.equal(auth.getAuth().user.id, "user-b", "late WeChat response must not overwrite a switched account");

storage.clear();
auth.saveAuth(switchedAuth);
let loggedPrepareWxCalls = 0;
wx.login = () => { loggedPrepareWxCalls += 1; };
const phoneCallsBeforeLoggedPrepare = phoneApiCalls;
for (const loggedPage of [loadPage(homePath), loadPage(mePath)]) {
  loggedPage.data.privacyConfirmed = true;
  loggedPage.preparePhoneLogin();
  assert.equal(loggedPage.data.phoneLoginReady, false);
}
assert.equal(loggedPrepareWxCalls, 0);
assert.equal(phoneApiCalls, phoneCallsBeforeLoggedPrepare);
assert.equal(auth.getAuth().user.id, "user-b");

storage.clear();
let phoneLoginCalls = 0;
phoneLoginImpl = () => { phoneLoginCalls += 1; return Promise.resolve(validAuth); };
preparedHome.handlePhoneNumber({ detail: { errMsg: "getPhoneNumber:fail user cancel" } });
assert.equal(phoneLoginCalls, 0);
assert.match(preparedHome.data.entryError, /取消手机号授权/);

const phoneApiCallsBeforeFailures = phoneApiCalls;
let phoneFailureWxLoginCalls = 0;
wx.login = () => { phoneFailureWxLoginCalls += 1; };
preparedHome.handlePhoneNumber({ detail: { errMsg: "getPhoneNumber:fail user deny" } });
assert.match(preparedHome.data.entryError, /取消手机号授权/);
preparedHome.handlePhoneNumber({ detail: { errMsg: "getPhoneNumber:ok", encryptedData: "legacy", iv: "legacy-iv" } });
assert.match(preparedHome.data.entryError, /版本.*不支持|旧版/u);
preparedHome.handlePhoneNumber({ detail: { errMsg: "getPhoneNumber:fail no permission" } });
assert.match(preparedHome.data.entryError, /尚未开通微信手机号授权/u);
preparedHome.handlePhoneNumber({ detail: { errMsg: "getPhoneNumber:fail", errno: 1400001 } });
assert.match(preparedHome.data.entryError, /授权额度不足/u);
for (const detail of [null, [], {}]) {
  preparedHome.handlePhoneNumber({ detail });
  assert.match(preparedHome.data.entryError, /暂未提供手机号凭证/u);
}
assert.equal(phoneFailureWxLoginCalls, 0);
assert.equal(phoneApiCalls, phoneApiCallsBeforeFailures);
assert.equal(auth.getAuth(), null);

redirectedTo = "";
wx.login = ({ success }) => success({ code: "wechat-login-code" });
preparedHome.handlePhoneNumber({ detail: { code: "phone-code" } });
await tick();
await tick();
assert.equal(phoneLoginCalls, 1);
assert.equal(auth.getAuth().user.phone, "13800000000");
assert.equal(redirectedTo, "/pages/auth/auth");

storage.clear();
const emptyCodeHome = loadPage(homePath);
emptyCodeHome.data.phoneLoginReady = true;
emptyCodeHome.data.privacyConfirmed = true;
emptyCodeHome.loginAttemptId = 1;
emptyCodeHome.phoneLoginAttemptId = 1;
emptyCodeHome.phoneLoginStartingUserId = "";
phoneLoginCalls = 0;
wx.login = ({ success }) => success({ code: "" });
emptyCodeHome.handlePhoneNumber({ detail: { code: "phone-code" } });
await tick();
assert.equal(phoneLoginCalls, 0);
assert.match(emptyCodeHome.data.entryError, /有效登录凭证/);

storage.clear();
const switchedDuringPhoneHome = loadPage(homePath);
switchedDuringPhoneHome.data.privacyConfirmed = true;
wx.getPrivacySetting = ({ success }) => success({ needAuthorization: false });
switchedDuringPhoneHome.preparePhoneLogin();
await tick();
const phoneCallsBeforeHomeSwitch = phoneApiCalls;
let wxCallsAfterHomeSwitch = 0;
wx.login = () => { wxCallsAfterHomeSwitch += 1; };
auth.saveAuth(switchedAuth);
switchedDuringPhoneHome.handlePhoneNumber({ detail: { code: "stale-home-phone-code" } });
assert.equal(wxCallsAfterHomeSwitch, 0);
assert.equal(phoneApiCalls, phoneCallsBeforeHomeSwitch);
assert.equal(auth.getAuth().user.id, "user-b");

storage.clear();
const stalePrivacyHome = loadPage(homePath);
stalePrivacyHome.data.privacyConfirmed = true;
let resolvePrivacySetting;
wx.getPrivacySetting = ({ success }) => { resolvePrivacySetting = success; };
stalePrivacyHome.preparePhoneLogin();
stalePrivacyHome.enterGuest();
resolvePrivacySetting({ needAuthorization: false });
await tick();
assert.equal(stalePrivacyHome.data.phoneLoginReady, false);
assert.equal(stalePrivacyHome.data.isLoggingIn, false);
wx.getPrivacySetting = ({ success }) => success({ needAuthorization: false });

storage.clear();
const staleHome = loadPage(homePath);
staleHome.data.phoneLoginReady = true;
staleHome.data.privacyConfirmed = true;
staleHome.loginAttemptId = 1;
staleHome.phoneLoginAttemptId = 1;
staleHome.phoneLoginStartingUserId = "";
let resolvePhoneLogin;
phoneLoginImpl = () => new Promise((resolve) => { resolvePhoneLogin = resolve; });
wx.login = ({ success }) => success({ code: "wechat-login-code" });
staleHome.handlePhoneNumber({ detail: { code: "phone-code" } });
staleHome.enterGuest();
resolvePhoneLogin(validAuth);
await tick();
assert.equal(auth.getAuth(), null);
assert.equal(auth.isGuest(), true);
assert.equal(staleHome.data.isLoggingIn, false);

storage.clear();
const me = loadPage(mePath);
me.data.privacyConfirmed = true;
let mePrepareWxLoginCalls = 0;
wx.login = () => { mePrepareWxLoginCalls += 1; };
const phoneApiCallsBeforeMePrepare = phoneApiCalls;
me.preparePhoneLogin();
await tick();
assert.equal(me.data.phoneLoginReady, true);
assert.equal(mePrepareWxLoginCalls, 0);
assert.equal(phoneApiCalls, phoneApiCallsBeforeMePrepare);
assert.equal(auth.getAuth(), null);
me.cancelPhoneLogin();
assert.equal(me.data.phoneLoginReady, false);
assert.equal(me.data.isLoggingIn, false);
assert.equal(mePrepareWxLoginCalls, 0);
assert.equal(phoneApiCalls, phoneApiCallsBeforeMePrepare);
assert.equal(auth.getAuth(), null);

const switchedDuringPhoneMe = loadPage(mePath);
switchedDuringPhoneMe.data.privacyConfirmed = true;
switchedDuringPhoneMe.preparePhoneLogin();
await tick();
const phoneCallsBeforeMeSwitch = phoneApiCalls;
let wxCallsAfterMeSwitch = 0;
wx.login = () => { wxCallsAfterMeSwitch += 1; };
auth.saveAuth(switchedAuth);
switchedDuringPhoneMe.handlePhoneNumber({ detail: { code: "stale-me-phone-code" } });
assert.equal(wxCallsAfterMeSwitch, 0);
assert.equal(phoneApiCalls, phoneCallsBeforeMeSwitch);
assert.equal(auth.getAuth().user.id, "user-b");
storage.clear();

me.preparePhoneLogin();
await tick();
assert.equal(me.data.phoneLoginReady, true);
phoneLoginImpl = () => Promise.reject(new Error("登录失败"));
wx.login = ({ success }) => success({ code: "wechat-login-code" });
me.handlePhoneNumber({ detail: { code: "phone-code" } });
await tick();
assert.equal(storage.get("xinqingGuestMode"), undefined);
assert.equal(me.data.isLoggedIn, false);
assert.match(me.data.loginError, /登录失败/);

phoneLoginImpl = () => Promise.resolve(validAuth);
me.handlePhoneNumber({ detail: { code: "phone-code-2" } });
await tick();
await tick();
assert.equal(me.data.isLoggedIn, true);
assert.equal(me.data.profileEditing, false, "phone login must enter without a profile gate");
assert.equal(me.data.profileRequired, false);
assert.ok(me.data.profileNickname, "a registered account without a nickname must receive a stable visible suggestion");
assert.match(me.data.guestAvatarStyle, /linear-gradient/u);

storage.clear();
const wechatMe = loadPage(mePath);
wechatMe.data.privacyConfirmed = true;
wechatLoginImpl = () => Promise.resolve({ ...validAuth, user: { ...validAuth.user, phone: null } });
wx.login = ({ success }) => success({ code: "me-wechat-code" });
wechatMe.loginWithWechatAccount();
await tick();
await tick();
assert.equal(wechatMe.data.isLoggedIn, true);
assert.equal(wechatMe.data.profileEditing, false, "WeChat login must enter without a profile gate");
assert.equal(wechatMe.data.profileRequired, false);

storage.clear();
const markerIncompleteAuth = {
  ...completeAuth,
  token: "marker-incomplete-token",
  user: { ...completeAuth.user, id: "marker-incomplete-user", profileCompletedAt: null }
};
auth.saveAuth(markerIncompleteAuth);
redirectedTo = "";
const markerIncompleteMe = loadPage(mePath);
markerIncompleteMe.onShow();
await tick();
assert.equal(redirectedTo, "");
assert.equal(markerIncompleteMe.data.isLoggedIn, true, "profile completeness must not hide the registered account");

storage.clear();
auth.saveAuth(completeAuth);
getMeImpl = () => Promise.resolve({ user: completeAuth.user });
const completeMe = loadPage(mePath);
completeMe.onShow();
await tick();
assert.equal(completeMe.data.profileRequired, false);
assert.equal(completeMe.data.profileEditing, false);
completeMe.editProfile();
assert.equal(completeMe.data.profileRequired, false);
completeMe.skipProfile();
assert.equal(completeMe.data.profileEditing, false, "complete profile editing must remain cancellable");

console.log("Miniapp login release check passed.");
