/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS module-cache mocking is required before loading Mini Program production modules. */
const assert = require("node:assert/strict");

const future = new Date(Date.now() + 60_000).toISOString();
const storage = new Map([
  ["xinqingAuth", { token: "token", expiresAt: future, user: { id: "current-user" } }],
  ["xinqingMiniChatMessages:current-user", ["current"]],
  ["xinqingMiniChatMessages:other-user", ["other"]],
  ["xinqingMiniGuestChatMessages", ["guest"]]
]);
let failKey = "xinqingMiniChatMessages:current-user";
let cancelCalls = 0;
const cancelBodies = [];
let pageDefinition;

global.getApp = () => ({ globalData: {} });
global.wx = {
  getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 390, screenHeight: 844, safeArea: { bottom: 810 } }),
  getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, left: 300 }),
  getStorageSync: (key) => storage.get(key) || "",
  removeStorageSync: (key) => {
    if (key === failKey) throw new Error("injected mini storage failure");
    storage.delete(key);
  },
  getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
  login: ({ success }) => success({ code: "fresh-code" }),
  showToast: () => undefined,
  reLaunch: () => undefined,
  showModal: () => undefined
};
global.Page = (definition) => { pageDefinition = definition; };

const authApiPath = require.resolve("../miniprogram-project/api/auth");
require.cache[authApiPath] = { exports: {
  sendCode: () => Promise.resolve(),
  cancelAccount: (body) => { cancelCalls += 1; cancelBodies.push(body); return Promise.resolve({ cancelled: true, mediaCleanup: "pending" }); }
} };
require("../miniprogram-project/pages/cancel/cancel");

const makePage = () => ({
  ...pageDefinition,
  data: { ...pageDefinition.data },
  setData(values) { Object.assign(this.data, values); }
});
storage.set("xinqingAuth", { token: "token", expiresAt: future, user: { id: "linked-user", phone: "13800000000", wechatOpenid: "wx-linked" } });
const linkedIdentityPage = makePage();
linkedIdentityPage.onLoad();
assert.equal(linkedIdentityPage.data.needsCode, false, "an account with WeChat identity must reverify through WeChat even when a phone is bound");

storage.set("xinqingAuth", { token: "token", expiresAt: future, user: { id: "phone-only", phone: "13800000001", wechatOpenid: null } });
const phoneIdentityPage = makePage();
phoneIdentityPage.onLoad();
assert.equal(phoneIdentityPage.data.needsCode, true, "a true phone-only account must retain SMS cancellation");

storage.set("xinqingAuth", { token: "token", expiresAt: future, user: { id: "current-user", phone: "13800000000", wechatOpenid: "wx-current" } });
const page = makePage();
page.onLoad();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

(async () => {
  page.performCancel();
  await settle();
  assert.equal(cancelCalls, 1);
  assert.deepEqual(cancelBodies[0], { wechatCode: "fresh-code" });
  assert.equal(page.data.cloudCancelled, true);
  assert.equal(page.data.statusText, "云端账号已注销但本机清理未完成");

  failKey = null;
  page.cancelAccount();
  await settle();
  assert.equal(cancelCalls, 1, "local retry must not call cancel API again");
  assert.equal(storage.has("xinqingMiniChatMessages:current-user"), false);
  assert.equal(storage.get("xinqingMiniChatMessages:other-user")[0], "other");
  assert.equal(storage.get("xinqingMiniGuestChatMessages")[0], "guest");
  assert.equal(page.data.mediaCleanupPending, true);
  assert.equal(page.data.statusText, "账号已注销，媒体清理待完成");
  page.cancelAccount();
  await settle();
  assert.equal(cancelCalls, 1, "pending terminal state must not call cancel API again");

  storage.set("xinqingAuth", { token: "token", expiresAt: future, user: { id: "phone-only", phone: "13800000001", wechatOpenid: null } });
  const phoneOnly = makePage();
  phoneOnly.onLoad();
  phoneOnly.setData({ code: "123456", codeSent: true });
  phoneOnly.performCancel();
  await settle();
  assert.equal(cancelCalls, 2);
  assert.deepEqual(cancelBodies[1], { code: "123456" });
  console.log("Miniapp account cancellation client checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
