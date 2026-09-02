import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { extractObservationWords } from "../services/insights/observationService";
import { assertInsightsConsent, createInsightsConsent } from "../services/insights/consentAuthority";

const require = createRequire(import.meta.url);
const { createNoteSlip } = require("../miniprogram-project/utils/note-slip.js");

const read = (path: string) => readFileSync(path, "utf8");

const noteJs = read("miniprogram-project/pages/note/note.js");
const noteWxml = read("miniprogram-project/pages/note/note.wxml");
const noteWxss = read("miniprogram-project/pages/note/note.wxss");
const reflectiveSlip = createNoteSlip("我也不知道我为什么要这样对你，我也不想继续这样。", 0);
assert.equal(reflectiveSlip.quote, "先不用急着找到答案。");
assert.match(reflectiveSlip.caption, /不想继续.*希望接下来/);
assert.equal(reflectiveSlip.quote.includes("我也不知道"), false);
const imageSlip = createNoteSlip("", 2);
assert.match(imageSlip.quote, /这些画面/);
assert.match(imageSlip.quote, /细节/);
assert.match(noteJs, /createNoteSlip/);
assert.match(noteJs, /换个版式/);
assert.doesNotMatch(noteWxml, /分享给朋友/);
assert.match(noteWxml, /scroll-view scroll-y class="slip-sheet"/);
assert.match(noteWxss, /safe-area-inset-bottom/);
assert.match(noteWxss, /width:\s*calc\(100% - 72rpx\)/);
const noteHistoryWxml = read("miniprogram-project/pages/note-history/note-history.wxml");
assert.match(noteHistoryWxml, /top: \{\{actionTop\}\}px; right: \{\{actionRight\}\}px/);

const appJson = JSON.parse(read("miniprogram-project/app.json"));
assert.equal(appJson.__usePrivacyCheck__, true);
const privacy = read("miniprogram-project/utils/wechat-privacy.js");
for (const api of ["getPrivacySetting", "requirePrivacyAuthorize", "openPrivacyContract"]) {
  assert(privacy.includes(`wx.${api}`), api);
}
const homeSource = read("miniprogram-project/pages/home/home.js");
const meSource = read("miniprogram-project/pages/me/me.js");
const authSource = read("miniprogram-project/pages/auth/auth.js");
assert.match(homeSource, /redirectTo\(\{ url: "\/pages\/auth\/auth" \}\)/);
assert.match(meSource, /redirectTo\(\{ url: "\/pages\/auth\/auth" \}\)/);
assert.match(authSource, /requireWechatPrivacyAuthorization\(\)/);
const wechatLoginFlow = authSource.slice(authSource.indexOf("loginWechat()"), authSource.indexOf("handleWechatPhone"));
assert(wechatLoginFlow.indexOf("requireWechatPrivacyAuthorization()") < wechatLoginFlow.indexOf("authenticateWithWechat()"));
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
const lowInformationWords = extractObservationWords([
  "你好，好吧，我也不知道为什么。",
  "你好，我也不想说，不知道。",
  "你是小慢吗？好吧。",
]);
for (const word of ["你好", "好吧", "我也", "不知道", "不想", "你是", "为什么"]) {
  assert.equal(lowInformationWords.some((item) => item.word === word), false, word);
}
const meaningfulWords = extractObservationWords([
  "周末去公园散步，上班以后也想去公园。",
  "这个周末继续散步，上班以后去公园。",
  "一次性的项目进度。",
]);
assert.equal(meaningfulWords.find((item) => item.word === "公园")?.count, 3);
assert.equal(meaningfulWords.find((item) => item.word === "上班")?.count, 2);
assert.equal(meaningfulWords.some((item) => item.word === "项目进度"), false);

console.log("Miniapp real-device release check passed.");
