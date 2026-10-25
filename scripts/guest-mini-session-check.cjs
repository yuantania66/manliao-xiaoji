/* eslint-disable @typescript-eslint/no-require-imports -- Run actual Mini CommonJS modules in an offline VM. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../miniprogram-project");
const settle = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve(); };
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const rows = [];
const run = async (name, test) => { await test(); rows.push(name); };
function environment() {
  let now = Date.parse("2026-10-13T00:00:00Z");
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const storage = new Map([["xinqingGuestMode", true]]), calls = [], timers = new Map(), writes = [], toasts = [];
  let timerId = 0, definition, failedStorageKey = null, delayCallbacks = false;
  const callbacks = [];
  const app = { globalData: {} };
  const wx = {
    getStorageSync: (key) => clone(storage.get(key)),
    setStorageSync: (key, value) => { if (key === failedStorageKey) throw Error("synthetic storage failure"); storage.set(key, clone(value)); },
    removeStorageSync: (key) => { if (key === failedStorageKey) throw Error("synthetic storage failure"); storage.delete(key); },
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    request: (options) => { calls.push(options); },
    showToast: (value) => toasts.push(value), nextTick: (fn) => fn(),
    createSelectorQuery: () => { const query = { in: () => query, select: () => query,
      boundingClientRect: () => query, exec: (fn) => fn([{ top: 0, height: 100 }, { top: 0, height: 200 }, { top: 30 }]) }; return query; }
  };
  const modules = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const vmModule = { exports: {} }; modules.set(filename, vmModule);
    const localRequire = (name) => {
      if (name.endsWith("config/api")) return { API_TIMEOUT: 50, getApiBaseUrl: () => "https://synthetic.invalid" };
      if (name.endsWith("utils/layout")) return { getSafeLayout: () => ({ bottomSafe: 23, pageTop: 92, titleTop: 128 }) };
      if (name.endsWith("utils/request")) return { request: () => { throw Error("Authenticated transport forbidden in this probe"); } };
      const target = path.resolve(path.dirname(filename), name + ".js");
      const allowed = ["utils/guest-session.js", "utils/auth.js", "utils/local-data.js", "api/chat.js"];
      if (!allowed.includes(path.relative(root, target))) throw Error(`Unexpected module: ${name}`);
      return load(path.relative(root, target));
    };
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module: vmModule, exports: vmModule.exports, require: localRequire,
      wx, getApp: () => app, Page: (value) => { definition = value; }, Date: Clock,
      Math: Object.assign(Object.create(Math), { random: () => 0.125 }), console,
      setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id)
    }, { filename });
    return vmModule.exports;
  }
  const guest = load("utils/guest-session.js"), auth = load("utils/auth.js"), local = load("utils/local-data.js"), api = load("api/chat.js");
  load("pages/chat/chat.js");
  const page = { ...definition, data: clone(definition.data), typingTimers: [],
    setData(data, callback) { Object.assign(this.data, data); writes.push(clone(data)); if (callback) { if (delayCallbacks) callbacks.push(callback); else callback(); } } };
  page.data.dataMode = "guest";
  const requests = (part, method = "POST") => calls.filter((call) => call.url.endsWith(part) && call.method === method);
  const success = (call, data) => call.success({ statusCode: 200, data: { ok: true, data } });
  const issue = (call, label = "a") => success(call, { ownerId: `synthetic-owner-${label}`, conversationId: `synthetic-conversation-${label}`,
    credential: `synthetic-unusable-credential-${label}`, expiresAt: new Clock(now + 86400000).toISOString() });
  const bootstrap = async () => { const pending = guest.ensureGuestSession(); issue(requests("/session").at(-1)); await pending; };
  const identity = { token: "synthetic-auth", expiresAt: "2099-01-01T00:00:00Z", user: { id: "synthetic-user" } };
  return { guest, auth, local, api, page, storage, calls, writes, toasts, requests, success, issue, bootstrap, identity,
    advance: (ms) => { now += ms; }, failStorage: (key) => { failedStorageKey = key; },
    delayCallbacks: () => { delayCallbacks = true; },
    flushCallbacks: () => { delayCallbacks = false; while (callbacks.length) callbacks.shift()(); },
    flushTimers: () => { for (let limit = 0; timers.size && limit < 20; limit += 1) { const batch = [...timers.values()]; timers.clear(); batch.forEach((fn) => fn()); } }
  };
}
const input = { content: "合成正文", turnId: "synthetic-turn", recentMessages: [] };
const committed = { status: "committed", guestAttempt: 1, assistantMessage: { id: "synthetic-reply", content: "合成回复，仅用于离线验收。" } };
(async () => {
  await run("singleflight + server-issued binding + separate storage", async () => {
    const e = environment(), a = e.guest.captureGuestAuthority(), b = e.guest.captureGuestAuthority();
    const pa = e.guest.ensureGuestSession(a), pb = e.guest.ensureGuestSession(b);
    assert.equal(e.requests("/session").length, 1); e.issue(e.requests("/session")[0]); await Promise.all([pa, pb]);
    assert.equal(a.conversationId, "synthetic-conversation-a"); assert.equal(a.conversationId, b.conversationId);
    const pending = e.api.sendGuestMessage({ ...input, authority: a }); await settle();
    const call = e.requests("/api/chat/guest")[0]; assert.equal(call.data.conversationId, a.conversationId);
    assert.equal(call.header["x-guest-transport"], "mini"); assert.equal(call.header.Authorization, undefined);
    assert.equal(call.header["x-guest-credential"], "synthetic-unusable-credential-a");
    e.success(call, committed); assert.equal((await pending).guestAttempt, 1);
    assert.equal(e.storage.has("xinqingAuth"), false);
    assert.notEqual(e.guest.createGuestTurnId(), e.guest.createGuestTurnId());
  });
  await run("frozen retry payload, explicit attempt, tampering rejected", async () => {
    const e = environment(); await e.bootstrap();
    const data = { ...input, recentMessages: [{ role: "user", content: "合成历史" }] };
    const first = e.api.sendGuestMessage(data); data.recentMessages[0].content = "changed after dispatch"; await settle();
    const initial = e.requests("/api/chat/guest")[0]; assert.equal(initial.data.recentMessages[0].content, "合成历史");
    e.success(initial, { status: "failed", guestAttempt: 1, systemStatus: { retryable: true } }); await first;
    const retry = e.api.sendGuestMessage({ ...input, recentMessages: [{ role: "user", content: "合成历史" }], retryOfAttempt: 1 }); await settle();
    const next = e.requests("/api/chat/guest")[1]; assert.equal(next.data.retryOfAttempt, 1);
    assert.equal(next.data.conversationId, initial.data.conversationId);
    e.success(next, { ...committed, guestAttempt: 2 }); await retry;
    await assert.rejects(e.api.sendGuestMessage({ ...data, retryOfAttempt: 2 }), (error) => error.details.reason === "GUEST_REQUEST_CONFLICT");
    assert.equal(e.requests("/api/chat/guest").length, 2);
  });
  await run("unknown network failure and expired retry never replay", async () => {
    const e = environment(); await e.bootstrap(); const pending = e.api.sendGuestMessage(input); await settle();
    e.requests("/api/chat/guest")[0].fail(); await assert.rejects(pending, (error) => error.details.reason === "GUEST_EXECUTION_UNKNOWN");
    assert.equal(e.requests("/api/chat/guest").length, 1); e.advance(86400001);
    await assert.rejects(e.api.sendGuestMessage({ ...input, retryOfAttempt: 1 }));
    assert.equal(e.requests("/session").length, 1);
  });
  await run("one pre-model invalid-session recovery only", async () => {
    const e = environment(); await e.bootstrap(); const pending = e.api.sendGuestMessage(input); await settle();
    const invalid = { statusCode: 401, data: { ok: false, error: { code: "UNAUTHORIZED", details: { reason: "GUEST_SESSION_INVALID" } } } };
    e.requests("/api/chat/guest")[0].success(invalid); await settle(); e.issue(e.requests("/session")[1], "b"); await settle();
    e.requests("/api/chat/guest")[1].success(invalid); await assert.rejects(pending);
    assert.equal(e.requests("/session").length, 2); assert.equal(e.requests("/api/chat/guest").length, 2);
  });
  await run("late bootstrap cleaned without restoring secret", async () => {
    const e = environment(); const pending = e.guest.ensureGuestSession(); e.auth.saveAuth(e.identity);
    e.issue(e.requests("/session")[0]); await assert.rejects(pending);
    assert.equal(e.storage.has("xinqingMiniGuestSession:v1"), false);
    const revoke = e.requests("/session", "DELETE")[0]; assert.equal(revoke.data.ownerId, "synthetic-owner-a");
  });
  await run("login storage failure preserves guest and no revoke", async () => {
    const e = environment(); await e.bootstrap(); const authority = e.guest.captureGuestAuthority(); await e.guest.ensureGuestSession(authority);
    e.failStorage("xinqingAuth"); assert.throws(() => e.auth.saveAuth(e.identity));
    assert.equal(e.auth.getDataMode(), "guest"); assert.equal(e.guest.isCurrentGuestAuthority(authority), true);
    assert.equal(e.requests("/session", "DELETE").length, 0);
  });
  await run("identity switch during resolved bootstrap never starts generation", async () => {
    const e = environment(); await e.bootstrap(); const pending = e.api.sendGuestMessage(input);
    e.auth.saveAuth(e.identity); await assert.rejects(pending);
    assert.equal(e.requests("/api/chat/guest").length, 0);
  });
  await run("new bootstrap storage failure revokes only unpersisted capability", async () => {
    const e = environment(); e.failStorage("xinqingMiniGuestSession:v1");
    const pending = e.guest.ensureGuestSession(); e.issue(e.requests("/session")[0]); await assert.rejects(pending);
    assert.equal(e.requests("/session", "DELETE")[0].data.ownerId, "synthetic-owner-a");
    assert.equal(e.requests("/api/chat/guest").length, 0); assert.equal(e.auth.getDataMode(), "guest");
  });
  await run("success login revokes old capability and preserves local history", async () => {
    const e = environment(); await e.bootstrap(); e.local.writeChatMessages([{ id: "history", role: "user", text: "合成旧记录" }]);
    const authority = e.guest.captureGuestAuthority(); await e.guest.ensureGuestSession(authority); e.auth.saveAuth(e.identity);
    assert.equal(e.local.readChatMessages().length, 0); assert.equal(e.storage.get("xinqingMiniGuestChatMessages").length, 1);
    const revoke = e.requests("/session", "DELETE")[0]; assert.equal(revoke.header["x-guest-credential"], "synthetic-unusable-credential-a");
    e.auth.enterGuest(); assert.equal(e.local.readChatMessages().length, 1); assert.equal(e.guest.isCurrentGuestAuthority(authority), false);
  });
  await run("expiry rotates epoch and old timers cannot affect new guest", async () => {
    const e = environment(); await e.bootstrap(); const old = e.guest.captureGuestAuthority();
    e.page.data.messages = [{ id: "synthetic-visible" }]; e.page.scrollTo("chat-bottom"); e.advance(86400001);
    const fresh = e.guest.captureGuestAuthority(); assert.notEqual(fresh.epoch, old.epoch);
    const pending = e.guest.ensureGuestSession(fresh); e.issue(e.requests("/session")[1], "b"); await pending;
    e.writes.length = 0; e.flushTimers(); assert.equal(e.writes.length, 0);
    assert.equal(e.guest.isCurrentGuestAuthority(old), false); assert.equal(e.guest.isCurrentGuestAuthority(fresh), true);
  });
  await run("failed identity switch does not revoke before rollback", async () => {
    const e = environment(); await e.bootstrap(); const old = e.guest.captureGuestAuthority();
    e.storage.set("xinqingAuth", e.identity); e.failStorage("xinqingAuth");
    assert.throws(() => e.auth.enterGuest()); assert.equal(e.requests("/session", "DELETE").length, 0);
    assert.equal(e.guest.isCurrentGuestAuthority(old), true);
  });
  for (const action of ["clearAuth", "clearCancelledAccount"]) {
    await run(`${action} invalidates capability without deleting guest history`, async () => {
      const e = environment(); await e.bootstrap(); const old = e.guest.captureGuestAuthority();
      e.local.writeChatMessages([{ id: "history", role: "user", text: "合成旧记录" }]);
      e.auth[action]("synthetic-user"); assert.equal(e.guest.isCurrentGuestAuthority(old), false);
      assert.equal(e.storage.get("xinqingMiniGuestChatMessages").length, 1);
      assert.equal(e.requests("/session", "DELETE").length, 1);
    });
  }
  await run("normal Page animation finishes without changing content", async () => {
    const e = environment(); await e.bootstrap(); e.page.sendLocalMessage("合成发送"); await settle();
    e.success(e.requests("/api/chat/guest")[0], committed); await settle(); e.flushTimers();
    assert.equal(e.page.data.isSending, false); assert.equal(e.page.data.isTyping, false);
    assert.equal(e.page.data.messages.find((m) => m.id === "synthetic-reply").text, committed.assistantMessage.content);
  });
  for (const outcome of ["success", "failure", "system-failure"]) {
    for (const switchKind of ["login", "roundtrip", "unload"]) {
      await run(`real Page late ${outcome} after ${switchKind}`, async () => {
        const e = environment(); await e.bootstrap(); e.page.sendLocalMessage("合成发送"); await settle();
        const call = e.requests("/api/chat/guest")[0];
        if (switchKind === "unload") e.page.onUnload(); else { e.auth.saveAuth(e.identity); if (switchKind === "roundtrip") e.auth.enterGuest(); }
        e.writes.length = 0; e.toasts.length = 0;
        if (outcome === "failure") call.fail(); else e.success(call, outcome === "success" ? committed : { status: "failed", systemStatus: { message: "合成失败" } });
        await settle(); e.flushTimers(); assert.equal(e.writes.length, 0); assert.equal(e.toasts.length, 0);
        assert.equal(e.storage.get("xinqingMiniGuestChatMessages").some((m) => m.id === "synthetic-reply" || m.role === "system"), false);
      });
    }
  }
  await run("real Page normal completion and queued animation/scroll/refocus guard", async () => {
    const e = environment(); await e.bootstrap(); e.page.sendLocalMessage("合成发送"); await settle();
    e.success(e.requests("/api/chat/guest")[0], committed); await settle();
    assert(e.storage.get("xinqingMiniGuestChatMessages").some((m) => m.id === "synthetic-reply"));
    e.page.scrollTo("msg-synthetic-reply"); e.page.scrollTargetToPosition("msg-synthetic-reply");
    e.auth.saveAuth(e.identity); e.auth.enterGuest(); e.writes.length = 0; e.flushTimers(); assert.equal(e.writes.length, 0);
  });
  for (const failure of [false, true]) {
    await run(`real greeting ${failure ? "error" : "success"}/finally cannot clobber reentry`, async () => {
      const e = environment(); await e.bootstrap(); e.page.loadInitialGuestGreeting(); await settle();
      const call = e.requests("/api/chat/guest/greeting")[0]; e.auth.saveAuth(e.identity); e.auth.enterGuest();
      e.page.guestGreetingPending = true; e.writes.length = 0;
      if (failure) call.fail(); else e.success(call, committed); await settle(); e.flushTimers();
      assert.equal(e.writes.length, 0); assert.equal(e.page.guestGreetingPending, true);
      assert.equal(e.storage.has("xinqingMiniGuestChatMessages"), false);
    });
  }
  await run("normal greeting persists and finishes", async () => {
    const e = environment(); await e.bootstrap(); e.page.loadInitialGuestGreeting(); await settle();
    e.success(e.requests("/api/chat/guest/greeting")[0], committed); await settle();
    assert.equal(e.page.guestGreetingPending, false); assert.equal(e.local.readChatMessages()[0].id, "synthetic-reply");
  });
  for (const entry of ["keyboard", "local-history"]) {
    await run(`deferred ${entry} layout retains original page guard`, async () => {
      const e = environment(); await e.bootstrap();
      e.local.writeChatMessages([{ id: "synthetic-history", role: "user", text: "合成历史", createdAt: "2026-10-13T00:00:00Z" }]);
      e.delayCallbacks();
      if (entry === "keyboard") e.page.onKeyboardHeightChange({ detail: { height: 200 } }); else e.page.loadLocalMessages();
      e.page.onUnload(); e.writes.length = 0; e.flushCallbacks(); e.flushTimers(); assert.equal(e.writes.length, 0);
    });
  }
  for (const greeting of [false, true]) {
    await run(`page unload during ${greeting ? "greeting" : "send"} bootstrap prevents generation`, async () => {
      const e = environment();
      if (greeting) e.page.loadInitialGuestGreeting(); else e.page.sendLocalMessage("合成发送");
      e.page.onUnload(); e.writes.length = 0; e.issue(e.requests("/session")[0]); await settle();
      assert.equal(e.requests(greeting ? "/api/chat/guest/greeting" : "/api/chat/guest").length, 0);
      assert.equal(e.writes.length, 0); assert(e.storage.has("xinqingMiniGuestSession:v1"), "page cancellation keeps shared Guest capability");
    });
  }
  await run("page unload during explicit invalid-session recovery prevents second generation", async () => {
    const e = environment(); await e.bootstrap(); e.page.sendLocalMessage("合成发送"); await settle();
    e.requests("/api/chat/guest")[0].success({ statusCode: 401, data: { ok: false, error: { details: { reason: "GUEST_SESSION_INVALID" } } } }); await settle();
    e.page.onUnload(); e.writes.length = 0; e.issue(e.requests("/session")[1], "b"); await settle();
    assert.equal(e.requests("/api/chat/guest").length, 1); assert.equal(e.writes.length, 0);
    const current = e.api.sendGuestMessage({ ...input, turnId: "synthetic-new-page" }); await settle();
    assert.equal(e.requests("/session").length, 2); e.success(e.requests("/api/chat/guest")[1], committed); await current;
  });
  console.log(JSON.stringify({ passed: rows.length, cases: rows, evidence: "actual Mini modules + Page with synthetic transport/storage/clock/timers", networkCalls: 0, modelCalls: 0, databaseCalls: 0 }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
