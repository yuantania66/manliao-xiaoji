import assert from "node:assert/strict";
import { createRequire } from "node:module";

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
  getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, right: 360 }),
  getWindowInfo: () => ({ screenHeight: 844, safeArea: { bottom: 810 } })
};

const authPath = require.resolve("../miniprogram-project/utils/auth.js");
const apiPath = require.resolve("../miniprogram-project/api/auth.js");
const homePath = require.resolve("../miniprogram-project/pages/home/home.js");
const mePath = require.resolve("../miniprogram-project/pages/me/me.js");
const auth = require(authPath);
const future = new Date(Date.now() + 60_000).toISOString();
const validAuth = { token: "valid-token", expiresAt: future, user: { createdAt: new Date().toISOString() } };

assert.equal(auth.isUsableAuth(validAuth), true);
for (const invalid of [null, {}, [], { token: "x" }, { token: "local_demo_x", expiresAt: future }, { token: "x", expiresAt: "bad" }, { token: "x", expiresAt: new Date(0).toISOString() }]) {
  assert.equal(auth.isUsableAuth(invalid), false);
}
storage.set("xinqingAuth", { token: "expired", expiresAt: new Date(0).toISOString() });
assert.equal(auth.getAuth(), null);
assert.equal(storage.has("xinqingAuth"), false);
assert.throws(() => auth.saveAuth({ token: "bad" }), /登录响应无效/);
for (const key of ["xinqingMiniGuestChatMessages", "xinqingMiniGuestNotes"]) storage.set(key, "private-guest-data");
const preservedDraft = { content: "待恢复", mediaItems: [], clientRequestId: "request-preserved" };
storage.set("xinqingMiniNoteDraft:v1", preservedDraft);
auth.saveAuth(validAuth);
for (const key of ["xinqingMiniGuestChatMessages", "xinqingMiniGuestNotes"]) assert.equal(storage.has(key), false);
assert.deepEqual(storage.get("xinqingMiniNoteDraft:v1"), preservedDraft);

storage.set("xinqing_api_env", "local");
storage.set("xinqing_api_base_url", "http://attacker.invalid");
delete require.cache[require.resolve("../miniprogram-project/config/api.js")];
const apiConfig = require("../miniprogram-project/config/api.js");
for (const envVersion of ["release", "trial", "unknown"]) {
  runtimeEnvVersion = envVersion;
  assert.equal(apiConfig.getApiBaseUrl(), "https://manliaoxiaoji.com");
}
wx.getAccountInfoSync = () => { throw new Error("unavailable"); };
assert.equal(apiConfig.getApiBaseUrl(), "https://manliaoxiaoji.com");
wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: runtimeEnvVersion } });
runtimeEnvVersion = "develop";
assert.equal(apiConfig.getApiBaseUrl(), "http://attacker.invalid");

let getMeImpl = () => Promise.resolve({ user: validAuth.user });
let loginImpl = () => Promise.resolve(validAuth);
const api = require(apiPath);
api.getMe = () => getMeImpl();
api.loginWithWechat = (code) => loginImpl(code);

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

storage.clear();
storage.set("xinqingAuth", validAuth);
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
assert.equal(home.data.showEntry, false);

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
const emptyCodeHome = loadPage(homePath);
emptyCodeHome.data.privacyConfirmed = true;
let loginCalls = 0;
loginImpl = () => { loginCalls += 1; return Promise.resolve(validAuth); };
wx.login = ({ success }) => success({ code: "" });
emptyCodeHome.handleLogin();
await tick();
assert.equal(loginCalls, 0);
assert.match(emptyCodeHome.data.entryError, /有效登录凭证/);

const unconfirmedHome = loadPage(homePath);
let wxLoginCalls = 0;
wx.login = () => { wxLoginCalls += 1; };
unconfirmedHome.handleLogin();
assert.equal(wxLoginCalls, 0);
assert.match(unconfirmedHome.data.entryError, /隐私政策/);

storage.clear();
const me = loadPage(mePath);
me.data.privacyConfirmed = true;
wx.login = ({ success }) => success({ code: "real-code" });
loginImpl = () => Promise.reject(new Error("登录失败"));
me.login();
await tick();
await tick();
assert.equal(storage.get("xinqingGuestMode"), undefined);
assert.equal(me.data.isLoggedIn, false);
assert.match(me.data.loginError, /登录失败/);

console.log("Miniapp login release check passed.");
