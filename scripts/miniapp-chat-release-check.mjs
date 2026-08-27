import assert from "node:assert/strict";
import { createRequire } from "node:module";

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

global.wx = {};

const localData = require("../miniprogram-project/utils/local-data.js");
localData.readChatMessages = () => storedMessages.map((message) => ({ ...message }));
localData.writeChatMessages = (messages) => {
  storedMessages = messages.map((message) => ({ ...message }));
};
localData.nowIso = () => "2026-08-27T00:00:00.000Z";

const auth = require("../miniprogram-project/utils/auth.js");
auth.getDataMode = () => "guest";
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
assert.match(degradedPage.data.statusText, /可以直接发消息/);

console.log("Miniapp guest chat release check passed.");
