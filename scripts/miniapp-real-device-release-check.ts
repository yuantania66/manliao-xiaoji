import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { extractObservationWords } from "../services/insights/observationService";
import { assertInsightsConsent, createInsightsConsent } from "../services/insights/consentAuthority";

const read = (path: string) => readFileSync(path, "utf8");

const noteJs = read("miniprogram-project/pages/note/note.js");
const noteWxml = read("miniprogram-project/pages/note/note.wxml");
const noteWxss = read("miniprogram-project/pages/note/note.wxss");
for (const inventedCopy of [
  "有些话先放这里。",
  "不急着整理，它已经被温柔地留下。",
  "你不必一直撑着。",
  "今天已经够努力了",
]) {
  assert(!noteJs.includes(inventedCopy), inventedCopy);
}
assert.match(noteJs, /来自你刚刚写下的原话/);
assert.match(noteJs, /换个版式/);
assert.doesNotMatch(noteWxml, /分享给朋友/);
assert.match(noteWxml, /scroll-view scroll-y class="slip-sheet"/);
assert.match(noteWxss, /safe-area-inset-bottom/);

const appJson = JSON.parse(read("miniprogram-project/app.json"));
assert.equal(appJson.__usePrivacyCheck__, true);
const privacy = read("miniprogram-project/utils/wechat-privacy.js");
for (const api of ["getPrivacySetting", "requirePrivacyAuthorize", "openPrivacyContract"]) {
  assert(privacy.includes(`wx.${api}`), api);
}
for (const page of ["home", "me"]) {
  const source = read(`miniprogram-project/pages/${page}/${page}.js`);
  assert.match(source, /requireWechatPrivacyAuthorization\(\)/);
  assert(source.indexOf("requireWechatPrivacyAuthorization()") < source.indexOf("wx.login({"));
}
assert.match(read("miniprogram-project/pages/me/me.js"), /微信账号已连接 · 云端同步已开启/);

const settingsWxml = read("miniprogram-project/pages/settings/settings.wxml");
assert.match(settingsWxml, /wx:if="\{\{isAuthenticated\}\}" url="\/pages\/cancel\/cancel"/);
assert.match(settingsWxml, /wx:if="\{\{isAuthenticated\}\}" class="logout"/);
assert.match(read("miniprogram-project/pages/cancel/cancel.wxml"), /!accountAvailable/);

const miniappChatApi = read("miniprogram-project/api/chat.js");
const miniappChatPage = read("miniprogram-project/pages/chat/chat.js");
assert.match(miniappChatApi, /\/api\/chat\/guest\/greeting/);
assert.match(miniappChatPage, /if \(messages\.length === 0\) this\.loadInitialGuestGreeting\(\)/);
assert.match(miniappChatPage, /this\.guestGreetingPending \|\| readChatMessages\(\)\.length > 0/);
assert.match(miniappChatPage, /interactionMoveEnvelope: assistant\.interactionMoveEnvelope \|\| null/);
assert.match(miniappChatPage, /promptVersion: message\.promptVersion \|\| null/);

const insightSource = read("miniprogram-project/pages/insights/insights.js");
assert.doesNotMatch(insightSource, /wordsByRange|工作.*6 次|疲惫.*5 次/);
assert.match(insightSource, /getInsights/);
const insightRoute = read("app/api/insights/route.ts");
assert.match(insightRoute, /requireUser\(request\)/);
assert.match(insightRoute, /assertInsightsConsent/);
const consentNow = new Date("2026-08-27T00:00:00.000Z");
const consent = createInsightsConsent({ userId: "user-a", now: consentNow });
assert.doesNotThrow(() => assertInsightsConsent({ token: consent.consentToken, userId: "user-a", now: consentNow }));
for (const rejected of [
  () => assertInsightsConsent({ token: null, userId: "user-a", now: consentNow }),
  () => assertInsightsConsent({ token: consent.consentToken, userId: "user-b", now: consentNow }),
  () => assertInsightsConsent({ token: `${consent.consentToken}tampered`, userId: "user-a", now: consentNow }),
  () => assertInsightsConsent({ token: consent.consentToken, userId: "user-a", now: new Date("2026-09-27T00:00:00.001Z") })
]) {
  assert.throws(rejected, /请先授权慢聊小记观察/);
}
const words = extractObservationWords(["工作 工作 周末散步", "周末散步让我放松"]);
assert.equal(words.find((item) => item.word === "工作")?.count, 2);
assert(words.some((item) => item.word.includes("周末") || item.word.includes("散步")));

console.log("Miniapp real-device release check passed.");
