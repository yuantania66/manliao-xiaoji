import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const storage = new Map();
const app = { globalData: { user: null, token: "" } };
global.getApp = () => app;
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  getSystemInfoSync: () => ({ screenHeight: 844, safeArea: { bottom: 810 }, statusBarHeight: 24 }),
  getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, right: 360 }),
  getWindowInfo: () => ({ screenHeight: 844, safeArea: { bottom: 810 } })
};

const auth = require("../miniprogram-project/utils/auth.js");
const insightsApi = require("../miniprogram-project/api/insights.js");
let insightCalls = 0;
insightsApi.getInsights = async () => {
  insightCalls += 1;
  return { words: [{ word: "散步", count: 2 }], sourceCounts: { notes: 1, userMessages: 1 } };
};

const loadPage = () => {
  let definition;
  global.Page = (value) => { definition = value; };
  const path = require.resolve("../miniprogram-project/pages/insights/insights.js");
  delete require.cache[path];
  require(path);
  definition.data = { ...definition.data };
  definition.setData = (next) => Object.assign(definition.data, next);
  return definition;
};

const makeAuth = (userId) => ({
  token: `token-${userId}`,
  expiresAt: "2999-01-01T00:00:00.000Z",
  user: { id: userId }
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

storage.set("xinqingAuth", makeAuth("user-a"));
storage.set("xinqingInsightsAuthorization:v1", {
  userId: "user-a",
  consentToken: "signed-user-a-consent",
  expiresAt: "2999-01-01T00:00:00.000Z"
});
const userAPage = loadPage();
userAPage.onLoad();
assert.equal(insightCalls, 1);
assert.equal(userAPage.data.authorized, true);

auth.clearAuth();
assert.equal(storage.has("xinqingInsightsAuthorization:v1"), false);
auth.saveAuth(makeAuth("user-b"));
const callsBeforeUserB = insightCalls;
const userBPage = loadPage();
userBPage.onLoad();
assert.equal(insightCalls, callsBeforeUserB);
assert.equal(userBPage.data.authorized, false);

storage.set("xinqingInsightsAuthorization:v1", {
  userId: "user-a",
  consentToken: "signed-user-a-consent",
  expiresAt: "2999-01-01T00:00:00.000Z"
});
const mismatchedPage = loadPage();
mismatchedPage.onLoad();
assert.equal(insightCalls, callsBeforeUserB);
assert.equal(mismatchedPage.data.authorized, false);

storage.set("xinqingInsightsAuthorization:v1", {
  userId: "user-b",
  consentToken: "signed-user-b-consent",
  expiresAt: "not-a-date"
});
const malformedPage = loadPage();
malformedPage.onLoad();
assert.equal(insightCalls, callsBeforeUserB);
assert.equal(malformedPage.data.authorized, false);

let resolveUserA;
insightsApi.getInsights = () => new Promise((resolve) => { resolveUserA = resolve; });
storage.set("xinqingAuth", makeAuth("user-a"));
storage.set("xinqingInsightsAuthorization:v1", {
  userId: "user-a",
  consentToken: "signed-user-a-consent",
  expiresAt: "2999-01-01T00:00:00.000Z"
});
const inFlightPage = loadPage();
inFlightPage.onLoad();
auth.clearAuth();
auth.saveAuth(makeAuth("user-b"));
inFlightPage.onShow();
resolveUserA({ words: [{ word: "user-a-private-word", count: 9 }], sourceCounts: { notes: 9, userMessages: 9 } });
await tick();
assert.deepEqual(inFlightPage.data.words, []);
assert.deepEqual(inFlightPage.data.sourceCounts, { notes: 0, userMessages: 0 });
assert.equal(inFlightPage.data.authorized, false);

let resolveUserAAuthorization;
let getCallsAfterAuthorizationRace = 0;
insightsApi.authorizeInsights = () => new Promise((resolve) => { resolveUserAAuthorization = resolve; });
insightsApi.getInsights = async () => {
  getCallsAfterAuthorizationRace += 1;
  return { words: [], sourceCounts: { notes: 0, userMessages: 0 } };
};
storage.set("xinqingAuth", makeAuth("user-a"));
storage.delete("xinqingInsightsAuthorization:v1");
const authorizationRacePage = loadPage();
authorizationRacePage.onLoad();
authorizationRacePage.authorize();
auth.clearAuth();
auth.saveAuth(makeAuth("user-b"));
authorizationRacePage.onShow();
resolveUserAAuthorization({ consentToken: "late-user-a-consent", expiresAt: "2999-01-01T00:00:00.000Z" });
await tick();
assert.equal(storage.has("xinqingInsightsAuthorization:v1"), false);
assert.equal(authorizationRacePage.data.authorized, false);
assert.equal(authorizationRacePage.data.isAuthenticated, true);
assert.equal(authorizationRacePage.authorizationPending, false);
assert.equal(getCallsAfterAuthorizationRace, 0);

console.log("Miniapp insights release check passed.");
