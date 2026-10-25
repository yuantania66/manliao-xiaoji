/* eslint-disable @typescript-eslint/no-require-imports -- Execute actual Mini modules with offline transport. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../miniprogram-project");
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve(); };
const rows = [];
async function check(name, callback) {
  try { await callback(); rows.push({ name, status: "PASS" }); }
  catch (error) { rows.push({ name, status: "FAIL", error: error.message }); }
}
function environment() {
  let now = Date.parse("2026-10-13T00:00:00Z"), definition, failStorageKey, delayCallbacks = false;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const identity = (label = "a", token = `synthetic-token-${label}`) => ({ token, expiresAt: new Clock(now + 60000).toISOString(), user: { id: `synthetic-user-${label}` } });
  const storage = new Map([["xinqingAuth", identity()]]), calls = [], writes = [], toasts = [], timers = new Map(), callbacks = [];
  let timerId = 0;
  const app = { globalData: {} };
  const wx = {
    getStorageSync: (key) => clone(storage.get(key)),
    setStorageSync: (key, value) => { if (key === failStorageKey) throw Error("synthetic storage failure"); storage.set(key, clone(value)); },
    removeStorageSync: (key) => { if (key === failStorageKey) throw Error("synthetic storage failure"); storage.delete(key); },
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    request: (call) => calls.push(call), showToast: (value) => toasts.push(value), nextTick: (callback) => callback(),
    createSelectorQuery: () => { const query = { in: () => query, select: () => query, boundingClientRect: () => query,
      exec: (callback) => callback([{ top: 0, height: 100 }, { top: 0, height: 200 }, { top: 50 }]) }; return query; }
  };
  const modules = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const vmModule = { exports: {} }; modules.set(filename, vmModule);
    const localRequire = (name) => {
      if (name.endsWith("config/api")) return { API_TIMEOUT: 50, getApiBaseUrl: () => "https://synthetic.invalid" };
      if (name.endsWith("utils/layout")) return { getSafeLayout: () => ({ pageTop: 0, titleTop: 0, bottomSafe: 0 }) };
      const relativePath = path.relative(root, path.resolve(path.dirname(filename), name + ".js"));
      if (!["utils/guest-session.js", "utils/auth.js", "utils/request.js", "utils/local-data.js", "api/chat.js"].includes(relativePath)) throw Error(`Unexpected module: ${name}`);
      return load(relativePath);
    };
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module: vmModule, exports: vmModule.exports, require: localRequire,
      wx, getApp: () => app, Page: (value) => { definition = value; }, Date: Clock, console,
      Math: Object.assign(Object.create(Math), { random: () => 0.125 }),
      setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; }, clearTimeout: (id) => timers.delete(id)
    }, { filename });
    return vmModule.exports;
  }
  const auth = load("utils/auth.js"), request = load("utils/request.js").request;
  load("pages/chat/chat.js");
  const page = { ...definition, data: { ...clone(definition.data), dataMode: "authenticated" }, typingTimers: [],
    setData(data, callback) { Object.assign(this.data, data); writes.push(clone(data)); if (callback) { if (delayCallbacks) callbacks.push(callback); else callback(); } } };
  const matching = (suffix, method = "GET") => calls.filter((call) => call.url.endsWith(suffix) && call.method === method);
  const success = (call, data) => call.success({ statusCode: 200, data: { ok: true, data } });
  const flushTimers = () => { for (let i = 0; timers.size && i < 20; i += 1) { const batch = [...timers.values()]; timers.clear(); batch.forEach((callback) => callback()); } };
  const clearEffects = () => { writes.length = 0; toasts.length = 0; };
  function transition(kind) {
    if (kind === "guest") auth.enterGuest();
    else if (kind === "logout") auth.clearAuth();
    else if (kind === "cancel") auth.clearCancelledAccount("synthetic-user-a");
    else if (kind === "roundtrip") { auth.saveAuth(identity("b")); auth.saveAuth(identity("a")); }
    else if (kind === "renew") auth.saveAuth(identity("a"));
    else if (kind === "same-token-other-user") auth.saveAuth(identity("b", "synthetic-token-a"));
    else if (kind === "expiry") now += 60001;
    else if (kind === "unload") page.onUnload();
    else throw Error(`Unknown transition ${kind}`);
  }
  const startSend = async () => { page.data.sessionId = "synthetic-session-a"; page.sendRemoteMessage("合成发送"); await settle(); return matching("/synthetic-session-a/messages", "POST")[0]; };
  return { auth, request, page, storage, calls, writes, toasts, matching, success, flushTimers, clearEffects, transition, startSend, identity,
    failStorage: (key) => { failStorageKey = key; }, delayCallbacks: () => { delayCallbacks = true; },
    flushCallbacks: () => { delayCallbacks = false; while (callbacks.length) callbacks.shift()(); } };
}
const reply = { status: "committed", userMessage: { id: "synthetic-user-message", content: "合成发送", createdAt: "2026-10-13T00:00:00Z" },
  assistantMessage: { id: "synthetic-assistant", content: "合成回复用于离线验收", createdAt: "2026-10-13T00:00:01Z" } };
(async () => {
  await check("bootstrap list late result cannot start create after Guest", async () => {
    const e = environment(); e.page.loadMessages(); const call = e.matching("/sessions?pageSize=20")[0];
    e.transition("guest"); e.clearEffects(); e.success(call, { items: [] }); await settle(); e.flushTimers();
    assert.equal(e.matching("/sessions", "POST").length, 0); assert.equal(e.writes.length, 0); assert.equal(e.toasts.length, 0);
  });
  await check("bootstrap create late result cannot bind or start history after logout", async () => {
    const e = environment(); e.page.loadMessages(); e.success(e.matching("/sessions?pageSize=20")[0], { items: [] }); await settle();
    const call = e.matching("/sessions", "POST")[0]; e.transition("logout"); e.clearEffects(); e.success(call, { id: "synthetic-created" }); await settle();
    assert.equal(e.calls.some((call) => call.url.endsWith("/synthetic-created/messages?pageSize=50")), false);
    assert.equal(e.writes.length, 0); assert.equal(e.toasts.length, 0);
  });
  for (const outcome of ["success", "error"]) {
    await check(`history late ${outcome} after Guest cannot affect page`, async () => {
      const e = environment(); e.page.data.targetSessionId = "synthetic-session-a"; e.page.loadMessages(); await settle();
      const call = e.matching("/synthetic-session-a/messages?pageSize=50")[0]; e.transition("guest"); e.clearEffects();
      if (outcome === "success") e.success(call, { items: [reply.assistantMessage] }); else call.fail(); await settle(); e.flushTimers();
      assert.equal(e.writes.length, 0); assert.equal(e.toasts.length, 0);
    });
  }
  for (const kind of ["guest", "logout", "cancel", "roundtrip", "renew", "same-token-other-user", "expiry", "unload"]) {
    for (const outcome of ["success", "error"]) {
      await check(`send late ${outcome} after ${kind} has no effects`, async () => {
        const e = environment(); const call = await e.startSend(); e.transition(kind); e.clearEffects();
        if (outcome === "success") e.success(call, reply); else call.fail(); await settle(); e.flushTimers();
        assert.equal(e.writes.length, 0); assert.equal(e.toasts.length, 0);
      });
    }
  }
  await check("resolved session cannot start post after identity switch microtask", async () => {
    const e = environment(); e.page.data.sessionId = "synthetic-session-a"; e.page.sendRemoteMessage("合成发送"); e.transition("guest");
    e.clearEffects(); await settle(); assert.equal(e.matching("/synthetic-session-a/messages", "POST").length, 0); assert.equal(e.writes.length, 0);
  });
  await check("shared bootstrap old finally cannot erase new pending", async () => {
    const e = environment(); e.page.loadMessages(); const old = e.matching("/sessions?pageSize=20")[0];
    e.auth.saveAuth(e.identity("b")); e.page.onShow(); const current = e.matching("/sessions?pageSize=20").at(-1);
    assert.notEqual(current, old); const pending = e.page.sessionBootstrapPromise;
    e.success(old, { items: [{ id: "synthetic-old" }] }); await settle(); assert.equal(e.page.sessionBootstrapPromise, pending);
    assert.equal(e.calls.some((call) => call.url.includes("/synthetic-old/messages")), false);
    e.success(current, { items: [{ id: "synthetic-current" }] }); await settle();
    assert.equal(e.matching("/synthetic-current/messages?pageSize=50").length, 1);
  });
  await check("session switch and switch back invalidate earlier history", async () => {
    const e = environment(); e.page.data.targetSessionId = "synthetic-session-a"; e.page.loadMessages(); await settle();
    const old = e.matching("/synthetic-session-a/messages?pageSize=50")[0];
    e.page.data.targetSessionId = "synthetic-session-b"; e.page.loadMessages(); await settle();
    e.page.data.targetSessionId = "synthetic-session-a"; e.page.loadMessages(); await settle(); e.clearEffects();
    e.success(old, { items: [reply.assistantMessage] }); await settle(); assert.equal(e.writes.length, 0);
  });
  await check("delayed setData callback cannot start stale animation", async () => {
    const e = environment(); const call = await e.startSend(); e.flushTimers(); e.delayCallbacks(); e.success(call, reply); await settle();
    e.transition("renew"); e.clearEffects(); e.flushCallbacks(); e.flushTimers(); assert.equal(e.writes.length, 0);
  });
  await check("queued animation scroll and refocus stop after unload", async () => {
    const e = environment(); const call = await e.startSend(); e.success(call, reply); await settle();
    e.page.scrollTo("msg-synthetic-assistant"); e.page.scrollTargetToPosition("msg-synthetic-assistant"); e.transition("unload");
    e.clearEffects(); e.flushTimers(); assert.equal(e.writes.length, 0);
  });
  for (const kind of ["roundtrip", "renew", "same-token-other-user"]) {
    await check(`old 401 cannot clear login after ${kind}`, async () => {
      const e = environment(); const pending = e.request({ url: "/synthetic" }); e.transition(kind);
      e.matching("/synthetic")[0].success({ statusCode: 401 }); await assert.rejects(pending);
      assert(e.auth.getAuth(), "new identity must survive old 401");
    });
  }
  await check("current 401 clears identity and never writes stale page errors", async () => {
    const e = environment(); const call = await e.startSend(); e.clearEffects(); call.success({ statusCode: 401 }); await settle();
    assert.equal(e.auth.getAuth(), null); assert.equal(e.writes.length, 0); assert.equal(e.toasts.length, 0);
  });
  await check("unauthenticated 401 does not clear current login", async () => {
    const e = environment(); const pending = e.request({ url: "/synthetic", auth: false }); e.matching("/synthetic")[0].success({ statusCode: 401 });
    await assert.rejects(pending); assert(e.auth.getAuth());
  });
  await check("normal bootstrap singleflight and history preserved", async () => {
    const e = environment(); e.page.loadMessages(); e.page.loadMessages(); assert.equal(e.matching("/sessions?pageSize=20").length, 1);
    e.success(e.matching("/sessions?pageSize=20")[0], { items: [] }); await settle(); assert.equal(e.matching("/sessions", "POST").length, 1);
    e.success(e.matching("/sessions", "POST")[0], { id: "synthetic-created" }); await settle();
    for (const call of e.matching("/synthetic-created/messages?pageSize=50")) e.success(call, { items: [reply.assistantMessage] }); await settle();
    assert.equal(e.page.data.messages[0].id, "synthetic-assistant"); assert.equal(e.page.data.isGreetingLoading, false);
  });
  for (const outcome of ["success", "system-failure", "error"]) {
    await check(`normal send ${outcome} remains visible`, async () => {
      const e = environment(); const call = await e.startSend();
      if (outcome === "error") call.fail();
      else e.success(call, outcome === "success" ? reply : { ...reply, status: "failed", assistantMessage: undefined,
        systemMessage: { id: "synthetic-system", content: "合成服务不可用" } });
      await settle(); e.flushTimers(); assert.equal(e.page.data.isSending, false); assert.equal(e.page.data.isTyping, false);
      if (outcome === "error") assert.match(e.page.data.replyStatusText, /无法确认/);
      else assert.equal(e.page.data.messages.at(-1).id, outcome === "success" ? "synthetic-assistant" : "synthetic-system");
    });
  }
  await check("failed login and profile-only update preserve current reply", async () => {
    const e = environment(); const call = await e.startSend(); e.failStorage("xinqingAuth"); assert.throws(() => e.auth.saveAuth(e.identity("b")));
    e.failStorage(null); e.auth.updateCachedUser("synthetic-user-a", { id: "synthetic-user-a", nickname: "合成昵称" });
    e.success(call, reply); await settle(); e.flushTimers(); assert.equal(e.page.data.messages.at(-1).id, "synthetic-assistant");
  });
  const failed = rows.filter((row) => row.status === "FAIL").length;
  console.log(JSON.stringify({ kind: "actual Mini auth/request/api/Page with deterministic synthetic transport, clock and timers", passed: rows.length - failed, failed, rows,
    networkCalls: 0, modelCalls: 0, databaseCalls: 0 }, null, 2));
  if (failed) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
