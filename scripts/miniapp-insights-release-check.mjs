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

const authorizeUser = (userId) => {
  storage.set("xinqingAuth", makeAuth(userId));
  storage.set("xinqingInsightsAuthorization:v1", {
    userId,
    consentToken: `signed-${userId}-consent`,
    expiresAt: "2999-01-01T00:00:00.000Z"
  });
};

const rangeRequests = [];
insightsApi.getInsights = async (days, consentToken) => {
  rangeRequests.push({ days, consentToken });
  return { words: [{ word: "散步", count: 3 }], sourceCounts: { notes: 2, userMessages: 4 } };
};
authorizeUser("user-a");
const rangePage = loadPage();
rangePage.onLoad();
await tick();
for (const key of ["7d", "90d", "30d"]) {
  rangePage.changeRange({ currentTarget: { dataset: { key } } });
  await tick();
}
assert.deepEqual(rangeRequests.map((request) => request.days), [30, 7, 90, 30]);
assert(rangeRequests.every((request) => request.consentToken === "signed-user-a-consent"));
assert.deepEqual(rangePage.data.words, [{ word: "散步", count: 3, countText: "3 次" }]);
assert.deepEqual(rangePage.data.sourceCounts, { notes: 2, userMessages: 4 });
assert.equal(rangePage.data.isLoading, false);

insightsApi.getInsights = async () => ({ words: [], sourceCounts: { notes: 0, userMessages: 0 } });
authorizeUser("user-a");
const emptyPage = loadPage();
emptyPage.onLoad();
await tick();
assert.deepEqual(emptyPage.data.words, []);
assert.equal(emptyPage.data.errorText, "");
assert.equal(emptyPage.data.isLoading, false);
assert.equal(emptyPage.data.authorized, true);

let guestCalls = 0;
insightsApi.getInsights = async () => { guestCalls += 1; return { words: [] }; };
insightsApi.authorizeInsights = async () => { guestCalls += 1; return {}; };
auth.enterGuest();
const guestPage = loadPage();
guestPage.onLoad();
guestPage.authorize();
await tick();
assert.equal(guestCalls, 0);
assert.equal(guestPage.data.authorized, false);
assert.equal(guestPage.data.isAuthenticated, false);
assert.match(guestPage.data.errorText, /请先登录/);

let networkFailures = 1;
insightsApi.getInsights = async () => {
  if (networkFailures > 0) {
    networkFailures -= 1;
    throw new Error("网络暂时不可用");
  }
  return { words: [{ word: "晚饭", count: 2 }], sourceCounts: { notes: 1, userMessages: 1 } };
};
authorizeUser("user-a");
const retryPage = loadPage();
retryPage.onLoad();
await tick();
assert.equal(retryPage.data.errorText, "网络暂时不可用");
assert.equal(retryPage.data.isLoading, false);
assert.equal(retryPage.data.authorized, true);
assert.equal(storage.has("xinqingInsightsAuthorization:v1"), true);
retryPage.changeRange({ currentTarget: { dataset: { key: retryPage.data.range } } });
await tick();
assert.equal(retryPage.data.errorText, "");
assert.equal(retryPage.data.words[0].word, "晚饭");

let consentRejected = true;
let reauthorizedCalls = 0;
insightsApi.getInsights = async (days, consentToken) => {
  if (consentRejected) {
    const error = new Error("请先授权慢聊小记观察");
    error.statusCode = 403;
    throw error;
  }
  reauthorizedCalls += 1;
  assert.equal(consentToken, "fresh-user-a-consent");
  return { words: [{ word: "散步", count: 2 }], sourceCounts: { notes: 1, userMessages: 1 } };
};
insightsApi.authorizeInsights = async () => ({ consentToken: "fresh-user-a-consent", expiresAt: "2999-01-01T00:00:00.000Z" });
authorizeUser("user-a");
const rejectedPage = loadPage();
rejectedPage.onLoad();
await tick();
assert.equal(storage.has("xinqingInsightsAuthorization:v1"), false);
assert.equal(rejectedPage.data.authorized, false);
assert.equal(rejectedPage.data.isLoading, false);
consentRejected = false;
rejectedPage.authorize();
await tick();
assert.equal(reauthorizedCalls, 1);
assert.equal(rejectedPage.data.authorized, true);
assert.equal(rejectedPage.data.isLoading, false);
assert.equal(rejectedPage.data.words[0].word, "散步");

const expireLogin = () => {
  auth.clearAuth();
  const error = new Error("登录状态已过期，请重新登录");
  error.statusCode = 401;
  throw error;
};
insightsApi.getInsights = async () => expireLogin();
authorizeUser("user-a");
const expiredLoadPage = loadPage();
expiredLoadPage.onLoad();
await tick();
assert.equal(storage.has("xinqingAuth"), false);
assert.equal(storage.has("xinqingInsightsAuthorization:v1"), false);
assert.equal(expiredLoadPage.data.authorized, false);
assert.equal(expiredLoadPage.data.isAuthenticated, false);
assert.equal(expiredLoadPage.data.isLoading, false);
assert.deepEqual(expiredLoadPage.data.words, []);
assert.equal(expiredLoadPage.data.errorText, "登录状态已过期，请重新登录");

insightsApi.authorizeInsights = async () => expireLogin();
storage.set("xinqingAuth", makeAuth("user-a"));
const expiredAuthorizePage = loadPage();
expiredAuthorizePage.onLoad();
expiredAuthorizePage.authorize();
await tick();
assert.equal(expiredAuthorizePage.data.isAuthenticated, false);
assert.equal(expiredAuthorizePage.data.authorized, false);
assert.equal(expiredAuthorizePage.authorizationPending, false);
assert.equal(expiredAuthorizePage.data.errorText, "登录状态已过期，请重新登录");

let resolveBeforeRevoke;
let callsAfterRevoke = 0;
insightsApi.getInsights = () => new Promise((resolve) => { resolveBeforeRevoke = resolve; });
authorizeUser("user-a");
const revokePage = loadPage();
revokePage.onLoad();
revokePage.revokeAuthorization();
assert.equal(storage.has("xinqingInsightsAuthorization:v1"), false);
assert.equal(storage.has("xinqingAuth"), true);
assert.equal(revokePage.data.authorized, false);
assert.equal(revokePage.data.isAuthenticated, true);
assert.equal(revokePage.data.isLoading, false);
resolveBeforeRevoke({ words: [{ word: "revoked-private-word", count: 5 }], sourceCounts: { notes: 5, userMessages: 5 } });
await tick();
assert.deepEqual(revokePage.data.words, []);
assert.deepEqual(revokePage.data.sourceCounts, { notes: 0, userMessages: 0 });
insightsApi.getInsights = async () => { callsAfterRevoke += 1; return { words: [] }; };
const reopenedAfterRevoke = loadPage();
reopenedAfterRevoke.onLoad();
reopenedAfterRevoke.onShow();
await tick();
assert.equal(callsAfterRevoke, 0);
assert.equal(reopenedAfterRevoke.data.authorized, false);

console.log("Miniapp insights release check passed.");
