import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate as settle } from "node:timers/promises";

const require = createRequire(import.meta.url);
const storage = new Map();
const requests = [];
const app = { globalData: {} };
global.getApp = () => app;
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  getSystemInfoSync: () => ({ screenHeight: 844, safeArea: { bottom: 810 }, statusBarHeight: 24 }),
  getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, right: 360 }),
  request: (options) => requests.push(options)
};

const auth = require("../miniprogram-project/utils/auth.js");
let definition;
global.Page = (value) => { definition = value; };
require("../miniprogram-project/pages/insights/insights.js");

const expiry = "2999-01-01T00:00:00.000Z";
const account = (id) => ({ token: "token-" + id, expiresAt: expiry, user: { id } });
const key = "xinqingInsightsAuthorization:v1";
const mount = () => {
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(values) { Object.assign(this.data, values); }
  };
  page.onLoad();
  page.onShow();
  return page;
};
const take = (method, suffix, user, proof) => {
  const request = requests.shift();
  assert(request, "Expected " + method + " " + suffix);
  assert.equal(request.method, method);
  assert(request.url.endsWith(suffix));
  assert.equal(request.header.Authorization, "Bearer " + user.token);
  assert.equal(request.header["x-insights-consent"], proof);
  return request;
};
const succeed = (request, data) => request.success({ statusCode: 200, data: { ok: true, data } });
const report = (request, rangeDays, words = []) => succeed(request, {
  rangeDays,
  words,
  sourceCounts: { notes: 1, userMessages: 1 }
});
const change = (page, range) => page.changeRange({ currentTarget: { dataset: { key: range } } });
const clear = (page) => {
  assert.equal(page.data.authorized, false);
  assert.equal(page.data.range, "30d");
  assert.equal(page.data.isLoading, false);
  assert.deepEqual(page.data.words, []);
  assert.deepEqual(page.data.sourceCounts, { notes: 0, userMessages: 0 });
};

async function authorize(page, user, proof) {
  page.authorize();
  succeed(take("POST", "/api/insights", user), { consentToken: proof, expiresAt: expiry });
  await settle();
  return take("GET", "/api/insights?days=30", user, proof);
}

const anonymous = mount();
anonymous.authorize();
change(anonymous, "7d");
clear(anonymous);
assert.equal(requests.length, 0);

const userA = account("user-a");
const userB = account("user-b");
auth.saveAuth(userA);
storage.set(key, { userId: userA.user.id, consentToken: "old-device-proof", expiresAt: expiry });
const page = mount();
clear(page);
assert.equal(requests.length, 0, "Stored proof does not authorize a new view");

page.authorize();
succeed(take("POST", "/api/insights", userA), { consentToken: "expired", expiresAt: "2001-01-01" });
await settle();
assert.equal(page.data.authorized, false);
assert.equal(page.data.isAuthorizing, false);
assert(page.data.errorText);
assert.equal(requests.length, 0);

report(await authorize(page, userA, "proof-a"), 30, [{ word: "散步", count: 2, quote: "extra field" }]);
await settle();
assert.equal(storage.get(key).consentToken, "old-device-proof", "The view does not persist its signed proof");
assert.deepEqual(page.data.words, [{ word: "散步", countText: "2 次" }]);
assert.deepEqual(page.data.sourceCounts, { notes: 1, userMessages: 1 });

change(page, "7d");
const oldRange = take("GET", "/api/insights?days=7", userA, "proof-a");
change(page, "90d");
report(take("GET", "/api/insights?days=90", userA, "proof-a"), 90, [{ word: "最新范围", count: 3 }]);
report(oldRange, 7, [{ word: "旧范围", count: 9 }]);
await settle();
assert.equal(page.data.range, "90d");
assert.deepEqual(page.data.words, [{ word: "最新范围", countText: "3 次" }]);

change(page, "7d");
take("GET", "/api/insights?days=7", userA, "proof-a").fail();
await settle();
assert(page.data.errorText);
assert.equal(page.data.authorized, true);
assert.deepEqual(page.data.sourceCounts, { notes: 0, userMessages: 0 });
change(page, "7d");
const withdrawnRequest = take("GET", "/api/insights?days=7", userA, "proof-a");
storage.set("example-source-note", "Keep the original");
page.withdraw();
clear(page);
assert.equal(storage.get("example-source-note"), "Keep the original");
change(page, "90d");
assert.equal(requests.length, 0);
report(await authorize(page, userA, "proof-reauthorized"), 30, [{ word: "重新授权", count: 5 }]);
report(withdrawnRequest, 7, [{ word: "撤回前", count: 4 }]);
await settle();
assert.deepEqual(page.data.words, [{ word: "重新授权", countText: "5 次" }]);

change(page, "7d");
const oldUnauthorized = take("GET", "/api/insights?days=7", userA, "proof-reauthorized");
auth.clearAuth();
auth.saveAuth(userB);
page.onShow();
clear(page);
report(await authorize(page, userB, "proof-b"), 30, [{ word: "第二个账号", count: 6 }]);
oldUnauthorized.success({ statusCode: 401, data: {} });
await settle();
assert.equal(auth.getAuth().token, userB.token);
assert.deepEqual(page.data.words, [{ word: "第二个账号", countText: "6 次" }]);

change(page, "7d");
take("GET", "/api/insights?days=7", userB, "proof-b").success({
  statusCode: 403,
  data: { ok: false, error: { message: "请先授权慢聊小记观察" } }
});
await settle();
clear(page);
assert.equal(page.data.errorText, "请先授权慢聊小记观察");

page.authorize();
const leaving = take("POST", "/api/insights", userB);
page.onHide();
succeed(leaving, { consentToken: "late-proof", expiresAt: expiry });
await settle();
clear(page);
assert.equal(requests.length, 0);
page.onShow();
report(await authorize(page, userB, "proof-b-fresh"), 30);
await settle();
assert.equal(page.data.authorized, true);
assert.deepEqual(page.data.words, [], "A valid empty result has no sample words");

change(page, "7d");
const unloaded = take("GET", "/api/insights?days=7", userB, "proof-b-fresh");
page.onUnload();
report(unloaded, 7, [{ word: "卸载后", count: 3 }]);
await settle();
clear(page);
assert.equal(requests.length, 0);

console.log("Miniapp insights release check passed.");
