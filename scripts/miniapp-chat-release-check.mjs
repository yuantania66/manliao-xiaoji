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

global.wx = { showToast: () => undefined };

const localData = require("../miniprogram-project/utils/local-data.js");
localData.readChatMessages = () => storedMessages.map((message) => ({ ...message }));
localData.writeChatMessages = (messages) => {
  storedMessages = messages.map((message) => ({ ...message }));
};
localData.nowIso = () => "2026-08-27T00:00:00.000Z";

const auth = require("../miniprogram-project/utils/auth.js");
let dataMode = "guest";
auth.getDataMode = () => dataMode;
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
api.getGuestGreeting = (input) => {
  greetingCalls += 1;
  assert.deepEqual(input, {
    kind: "initial",
    recentMessages: [],
    recentGreetings: []
  });
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

dataMode = "authenticated";
let createdSessions = 0;
listSessionsImpl = async () => ({ items: [] });
createSessionImpl = async () => {
  createdSessions += 1;
  return { id: "session-new" };
};
listMessagesImpl = async () => ({
  items: [{
    id: "auth-greeting",
    role: "assistant",
    content: "欢迎回来",
    createdAt: "2026-08-27T00:00:00.000Z"
  }]
});
const authLoadPage = createPage();
authLoadPage.loadMessages();
authLoadPage.loadMessages();
assert.equal(authLoadPage.data.isGreetingLoading, true);
await tick();
await tick();
assert.equal(createdSessions, 1);
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
resolveFailedSend({
  status: "failed",
  userMessage: {
    id: "server-user-1",
    content: "你好",
    createdAt: "2026-08-27T00:00:01.000Z"
  },
  systemStatus: { message: "回复服务暂时不可用，请重试。" },
  systemMessage: {
    id: "system-status:server-user-1",
    role: "system",
    content: "回复服务暂时不可用，请重试。",
    createdAt: "2026-08-27T00:00:02.000Z"
  }
});
await tick();
await tick();
assert.deepEqual(failedSendPage.data.messages.map((item) => item.id), [
  "server-user-1",
  "system-status:server-user-1"
]);
assert.equal(failedSendPage.data.messages[1].role, "system");
assert.equal(failedSendPage.data.isTyping, false);
assert.equal(failedSendPage.data.replyStatusText, "");

listSessionsImpl = async () => ({ items: [{ id: "session-auth" }] });
listMessagesImpl = async () => ({
  items: [{
    id: "server-user-1",
    role: "user",
    content: "你好",
    createdAt: "2026-08-27T00:00:01.000Z"
  }, {
    id: "system-status:server-user-1",
    role: "system",
    content: "回复服务暂时不可用，请重试。",
    createdAt: "2026-08-27T00:00:02.000Z"
  }]
});
const failedReloadPage = createPage();
failedReloadPage.loadMessages();
await tick();
await tick();
assert.deepEqual(
  failedReloadPage.data.messages.map((item) => [item.id, item.role, item.text]),
  failedSendPage.data.messages.map((item) => [item.id, item.role, item.text])
);

sendMessageImpl = async (sessionId, content) => ({
  status: "committed",
  userMessage: {
    id: "server-user-2",
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

sendMessageImpl = async () => { throw new Error("undefined is not an object (evaluating t.assistantMessage.id)"); };
const transportFailurePage = createPage();
transportFailurePage.data.sessionId = "session-auth";
transportFailurePage.sendRemoteMessage("测试");
await tick();
await tick();
assert.doesNotMatch(transportFailurePage.data.replyStatusText, /undefined|assistantMessage/);
assert.equal(transportFailurePage.data.statusText, "");

const chatWxml = readFileSync("miniprogram-project/pages/chat/chat.wxml", "utf8");
assert.match(chatWxml, /show-scrollbar="\{\{messages\.length > 0\}\}"/);
assert.match(chatWxml, /wx:if="\{\{isGreetingLoading\}\}"/);
assert.match(chatWxml, /wx:if="\{\{replyStatusText\}\}"/);

console.log("Miniapp guest chat release check passed.");
