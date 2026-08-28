/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS module-cache mocking is required before loading Mini Program production modules. */
const assert = require("node:assert/strict");

const storage = new Map([
  ["xinqingAuth", { token: "token", user: { id: "current-user" } }],
  ["xinqingMiniChatMessages:current-user", ["current"]],
  ["xinqingMiniChatMessages:other-user", ["other"]],
  ["xinqingMiniGuestChatMessages", ["guest"]]
]);
let failKey = "xinqingMiniChatMessages:current-user";
let cancelCalls = 0;
let pageDefinition;

global.getApp = () => ({ globalData: {} });
global.wx = {
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
  cancelAccount: () => { cancelCalls += 1; return Promise.resolve({ cancelled: true, mediaCleanup: "pending" }); }
} };
require("../miniprogram-project/pages/cancel/cancel");

const page = {
  ...pageDefinition,
  data: { ...pageDefinition.data, userId: "current-user", needsCode: false },
  setData(values) { Object.assign(this.data, values); }
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

(async () => {
  page.performCancel();
  await settle();
  assert.equal(cancelCalls, 1);
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
  console.log("Miniapp account cancellation client checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
