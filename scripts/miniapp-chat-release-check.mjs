import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
let storedMessages = [];
let greetingCalls = 0;
let greetingImpl = () => Promise.resolve({
  assistantMessage: {
    id: "guest-greeting-1",
    role: "assistant",
    content: "今天想随便聊聊，还是从此刻在意的事说起？",
    createdAt: "2026-08-27T00:00:00.000Z",
    promptVersion: "proactive-greeting-v1",
    interactionMoveEnvelope: { schemaVersion: "assistant_interaction_move_v1" }
  }
});

const storage = new Map();
const app = { globalData: {} };
global.getApp = () => app;
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
  showToast: () => undefined
};

const localData = require("../miniprogram-project/utils/local-data.js");
localData.readChatMessages = () => storedMessages.map((message) => ({ ...message }));
localData.writeChatMessages = (messages) => {
  storedMessages = messages.map((message) => ({ ...message }));
};
localData.nowIso = () => "2026-08-27T00:00:00.000Z";

const auth = require("../miniprogram-project/utils/auth.js");
const { isCurrentGuestAuthority } = require("../miniprogram-project/utils/guest-session.js");
auth.enterGuest();
const layout = require("../miniprogram-project/utils/layout.js");
layout.getSafeLayout = () => ({
  pageTop: 0,
  backTop: 0,
  titleTop: 0,
  actionTop: 0,
  actionRight: 0,
  panelTop: 0,
  bottomSafe: 0
});
const api = require("../miniprogram-project/api/chat.js");
let listSessionsImpl = async () => ({ items: [] });
let createSessionImpl = async () => ({ id: "session-created" });
let listMessagesImpl = async () => ({ items: [] });
let sendMessageImpl = async () => { throw new Error("not configured"); };
let sendGuestMessageImpl = async () => { throw new Error("not configured"); };
api.listSessions = (...args) => listSessionsImpl(...args);
api.createSession = (...args) => createSessionImpl(...args);
api.listMessages = (...args) => listMessagesImpl(...args);
api.sendMessage = (...args) => sendMessageImpl(...args);
api.sendGuestMessage = (...args) => sendGuestMessageImpl(...args);
api.getGuestGreeting = ({ authority, isCurrent, ...input }) => {
  greetingCalls += 1;
  assert.deepEqual(input, {
    kind: "initial",
    recentMessages: [],
    recentGreetings: []
  });
  assert.equal(isCurrentGuestAuthority(authority), true);
  assert.equal(isCurrent(), true);
  return greetingImpl();
};

let definition;
global.Page = (value) => { definition = value; };
const chatPath = require.resolve("../miniprogram-project/pages/chat/chat.js");
delete require.cache[chatPath];
require(chatPath);

const createPage = () => {
  const page = {
    ...definition,
    data: { ...definition.data },
    guestGreetingPending: false,
    guestGreetingRequestId: 0
  };
  page.setData = (next, callback) => {
    Object.assign(page.data, next);
    if (callback) callback();
  };
  page.scrollToInitialTarget = () => {};
  page.scrollTo = () => {};
  page.refocusInput = () => {};
  page.animateAssistantMessage = (message) => {
    page.data.messages = page.prepareMessagesForView(page.data.messages.map((item) =>
      item.id === message.id ? { ...item, text: message.text } : item
    ));
    page.data.isSending = false;
    page.data.isTyping = false;
  };
  return page;
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

const page = createPage();
page.loadLocalMessages();
page.loadLocalMessages();
assert.equal(greetingCalls, 1);
await tick();
await tick();
assert.equal(storedMessages.length, 1);
assert.equal(storedMessages[0].promptVersion, "proactive-greeting-v1");
assert.deepEqual(storedMessages[0].interactionMoveEnvelope, {
  schemaVersion: "assistant_interaction_move_v1"
});
page.loadLocalMessages();
assert.equal(greetingCalls, 1);

storedMessages = [];
let resolveGreeting;
greetingImpl = () => new Promise((resolve) => { resolveGreeting = resolve; });
const racingPage = createPage();
racingPage.loadLocalMessages();
assert.equal(greetingCalls, 2);
storedMessages = [{
  id: "u-race",
  role: "user",
  text: "你好",
  createdAt: "2026-08-27T00:00:01.000Z"
}];
resolveGreeting({
  assistantMessage: {
    id: "late-greeting",
    content: "迟到的问候",
    createdAt: "2026-08-27T00:00:02.000Z"
  }
});
await tick();
await tick();
assert.deepEqual(storedMessages.map((message) => message.id), ["u-race"]);

storedMessages = [];
greetingImpl = () => Promise.reject(new Error("synthetic provider failure"));
const degradedPage = createPage();
degradedPage.loadLocalMessages();
await tick();
await tick();
assert.deepEqual(storedMessages, []);
assert.equal(degradedPage.guestGreetingPending, false);
assert.match(degradedPage.data.replyStatusText, /可以直接发消息/);

storedMessages = [];
sendGuestMessageImpl = async () => ({
  status: "failed",
  systemStatus: { message: "回复服务暂时不可用，请重试。" }
});
const guestFailurePage = createPage();
guestFailurePage.sendLocalMessage("嗯？");
await tick();
await tick();
assert.deepEqual(storedMessages.map((message) => message.role), ["user", "system"]);
assert.match(storedMessages[1].text, /回复服务暂时不可用/);
const guestReloadPage = createPage();
guestReloadPage.loadLocalMessages();
assert.deepEqual(
  guestReloadPage.data.messages.map((message) => message.id),
  storedMessages.map((message) => message.id)
);

auth.saveAuth({ token: "fixture-auth", user: { id: "fixture-user" }, expiresAt: "2999-01-01T00:00:00.000Z" });
let createdSessions = 0;
const initialHistoryReads = [];
listSessionsImpl = async () => ({ items: [] });
createSessionImpl = async () => {
  createdSessions += 1;
  return { id: "session-new" };
};
listMessagesImpl = async (sessionId, options) => {
  assert.equal(sessionId, "session-new");
  initialHistoryReads.push(options);
  return {
    items: [{
      id: "auth-greeting",
      role: "assistant",
      content: "欢迎回来",
      createdAt: "2026-08-27T00:00:00.000Z"
    }]
  };
};
const authLoadPage = createPage();
authLoadPage.loadMessages();
authLoadPage.loadMessages();
assert.equal(authLoadPage.data.isGreetingLoading, true);
await tick();
await tick();
assert.equal(createdSessions, 1);
assert.deepEqual(initialHistoryReads, [{ historyOnly: true }, undefined]);
assert.deepEqual(authLoadPage.data.messages.map((item) => item.id), ["auth-greeting"]);
assert.equal(authLoadPage.data.isGreetingLoading, false);

let resolveFailedSend;
let capturedTurnId = "";
sendMessageImpl = (sessionId, content, turnId) => {
  assert.equal(sessionId, "session-auth");
  assert.equal(content, "你好");
  capturedTurnId = turnId;
  return new Promise((resolve) => { resolveFailedSend = resolve; });
};
const failedSendPage = createPage();
failedSendPage.data.sessionId = "session-auth";
failedSendPage.sendRemoteMessage("你好");
assert.equal(failedSendPage.data.messages.length, 1);
assert.equal(failedSendPage.data.messages[0].role, "user");
assert.equal(failedSendPage.data.messages[0].text, "你好");
assert.equal(failedSendPage.data.isTyping, true);
await tick();
assert.match(capturedTurnId, /^mini-auth-/);
const failedUserMessage = {
  id: capturedTurnId,
  role: "user",
  content: "你好",
  createdAt: "2026-08-27T00:00:01.000Z"
};
const failedSystemMessage = {
  id: `system-status:${capturedTurnId}`,
  role: "system",
  content: "回复服务暂时不可用，请重试。",
  createdAt: "2026-08-27T00:00:02.000Z"
};
resolveFailedSend({
  status: "failed",
  userMessage: failedUserMessage,
  systemStatus: { message: "回复服务暂时不可用，请重试。" },
  systemMessage: failedSystemMessage
});
await tick();
await tick();
assert.deepEqual(failedSendPage.data.messages.map((item) => item.id), [
  failedUserMessage.id,
  failedSystemMessage.id
]);
assert.equal(failedSendPage.data.messages[1].role, "system");
assert.equal(failedSendPage.data.isTyping, false);
assert.equal(failedSendPage.data.replyStatusText, "");

listSessionsImpl = async () => ({ items: [{ id: "session-auth" }] });
listMessagesImpl = async () => ({ items: [failedUserMessage, failedSystemMessage] });
const failedReloadPage = createPage();
failedReloadPage.loadMessages();
await tick();
await tick();
assert.deepEqual(
  failedReloadPage.data.messages.map((item) => [item.id, item.role, item.text]),
  failedSendPage.data.messages.map((item) => [item.id, item.role, item.text])
);

sendMessageImpl = async (sessionId, content, turnId) => ({
  status: "committed",
  userMessage: {
    id: turnId,
    content,
    createdAt: "2026-08-27T00:00:02.000Z"
  },
  assistantMessage: {
    id: "server-assistant-2",
    content: "想随便聊聊，还是从此刻在意的事说起？",
    createdAt: "2026-08-27T00:00:03.000Z"
  }
});
const committedPage = createPage();
committedPage.data.sessionId = "session-auth";
committedPage.sendRemoteMessage("你好");
await tick();
await tick();
assert.equal(committedPage.data.messages.filter((item) => item.role === "user").length, 1);
assert.equal(committedPage.data.messages.filter((item) => item.role === "assistant").length, 1);
assert.equal(committedPage.data.replyStatusText, "");

let unresolvedTurnId;
let unresolvedSendCount = 0;
sendMessageImpl = async (_sessionId, _content, turnId) => {
  unresolvedTurnId = turnId;
  unresolvedSendCount += 1;
  throw new Error("undefined is not an object (evaluating t.assistantMessage.id)");
};
const transportFailurePage = createPage();
transportFailurePage.data.sessionId = "session-auth";
transportFailurePage.sendRemoteMessage("测试");
await tick();
await tick();
transportFailurePage.stopPendingPolling();
assert.doesNotMatch(transportFailurePage.data.replyStatusText, /undefined|assistantMessage/);
assert.equal(transportFailurePage.data.statusText, "");
assert.match(transportFailurePage.data.replyStatusText, /发送状态暂时无法确认/);
assert.equal(transportFailurePage.data.hasPendingTurn, true);

// Simulate the terminal GET envelope to validate the client without calling a server.
listMessagesImpl = async (sessionId, options) => {
  assert.equal(sessionId, "session-auth");
  assert.deepEqual(options, { historyOnly: true, turnId: unresolvedTurnId });
  return {
    items: [], turnResult: {
      turnId: unresolvedTurnId, status: "committed",
      userMessage: { id: unresolvedTurnId, role: "user", content: "测试", createdAt: "2026-08-27T00:00:02.000Z" },
      assistantMessage: { id: "recovered-reply", role: "assistant", content: "收到。", createdAt: "2026-08-27T00:00:03.000Z" }
    }
  };
};
await transportFailurePage.reconcilePendingTurn();
assert.equal(unresolvedSendCount, 1, "The recovery path must not resend the user's message");
assert.equal(transportFailurePage.data.hasPendingTurn, false);
assert.deepEqual(transportFailurePage.data.messages.map(({ id }) => id), [unresolvedTurnId, "recovered-reply"]);

const chatWxml = readFileSync("miniprogram-project/pages/chat/chat.wxml", "utf8");
assert.match(chatWxml, /show-scrollbar="\{\{messages\.length > 0\}\}"/);
assert.match(chatWxml, /wx:if="\{\{isGreetingLoading\}\}"/);
assert.match(chatWxml, /wx:if="\{\{replyStatusText\}\}"/);

console.log("Miniapp guest chat release check passed.");
