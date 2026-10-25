/* eslint-disable @typescript-eslint/no-require-imports -- Actual Mini modules run in an offline VM. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(process.argv[2] || path.join(__dirname, "../miniprogram-project"));
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve(); };
const rows = [];
async function check(name, run) {
  try { await run(); rows.push({ name, status: "PASS" }); }
  catch (error) { rows.push({ name, status: "FAIL", error: error.message }); }
}
function environment(pagePath = "pages/auth/auth.js") {
  let now = Date.parse("2026-10-13T00:00:00Z"), definition, failedKey;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const identity = (id = "a") => ({ token: `synthetic-token-${id}`, expiresAt: new Clock(now + 60000).toISOString(),
    user: { id: `synthetic-user-${id}`, nickname: "合成新资料", avatarUrl: "/synthetic-avatar" } });
  const storage = new Map([["xinqingAuth", identity()]]), calls = [], uploads = [], logins = [], modals = [], downloads = [], choices = [];
  const writes = [], toasts = [], navigations = [], timers = new Map(); let timerId = 0;
  const wx = {
    getStorageSync: (key) => clone(storage.get(key)),
    setStorageSync: (key, value) => { if (failedKey === key) throw Error("synthetic storage failure"); storage.set(key, clone(value)); },
    removeStorageSync: (key) => { if (failedKey === key) throw Error("synthetic storage failure"); storage.delete(key); },
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    request: (call) => calls.push(call), uploadFile: (call) => uploads.push(call), downloadFile: (call) => downloads.push(call),
    login: (call) => logins.push(call), showModal: (call) => modals.push(call), chooseImage: (call) => choices.push(call),
    showToast: (value) => toasts.push(value), redirectTo: (value) => navigations.push(value), reLaunch: (value) => navigations.push(value)
  };
  const modules = new Map(), app = { globalData: {} };
  const allowed = ["utils/auth.js", "utils/guest-session.js", "utils/request.js", "utils/local-data.js", "api/auth.js", "api/uploads.js",
    "utils/wechat-login.js", "utils/wechat-phone-login.js", "utils/generated-identity.js"];
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const vmModule = { exports: {} }; modules.set(filename, vmModule);
    const localRequire = (name) => {
      if (name.endsWith("config/api")) return { API_TIMEOUT: 50, getApiBaseUrl: () => "https://synthetic.invalid" };
      if (name.endsWith("utils/layout")) return { getSafeLayout: () => ({ pageTop: 0, backTop: 0 }) };
      if (name.endsWith("utils/wechat-privacy")) return { requireWechatPrivacyAuthorization: () => Promise.resolve(), openWechatPrivacyContract() {} };
      if (name.endsWith("utils/login-time-background")) return { getLoginBackground: () => "", getLoginBackgroundTopColor: () => "#aabbcc", getLoginBackgroundInsetTop: () => 0 };
      const next = path.relative(root, path.resolve(path.dirname(filename), name + ".js"));
      if (!allowed.includes(next)) throw Error(`Unexpected import: ${name}`);
      return load(next);
    };
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module: vmModule, exports: vmModule.exports, require: localRequire,
      wx, getApp: () => app, Page: (value) => { definition = value; }, Date: Clock,
      Math: Object.assign(Object.create(Math), { random: () => 0.125 }), console,
      setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; }, clearTimeout: (id) => timers.delete(id),
      setInterval: (callback) => { timers.set(++timerId, callback); return timerId; }, clearInterval: (id) => timers.delete(id)
    }, { filename });
    return vmModule.exports;
  }
  const auth = load("utils/auth.js"); load(pagePath);
  const page = { ...definition, data: clone(definition.data), setData(values, callback) { Object.assign(this.data, values); writes.push(clone(values)); if (callback) callback(); } };
  const matching = (suffix, method = "GET") => calls.filter((call) => call.url.endsWith(suffix) && call.method === method);
  const success = (call, data) => call.success({ statusCode: 200, data: { ok: true, data } });
  const clearEffects = () => { writes.length = 0; toasts.length = 0; navigations.length = 0; };
  const noEffects = () => { assert.equal(writes.length, 0); assert.equal(toasts.length, 0); assert.equal(navigations.length, 0); };
  const renew = () => auth.saveAuth(identity());
  return { auth, load, page, wx, storage, calls, uploads, downloads, logins, modals, choices, writes, toasts, navigations, matching, success,
    identity, renew, clearEffects, noEffects, failStorage: (key) => { failedKey = key; }, expire: () => { now += 60001; },
    flushTimers: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((callback) => callback()); } };
}
async function pendingLogin(e) {
  e.auth.clearAuth(); e.auth.enterGuest(); e.page.data.privacyConfirmed = true;
  e.page.loginWechat(); await settle(); e.logins[0].success({ code: "synthetic-wechat-code" }); await settle();
  return e.matching("/api/auth/wechat", "POST")[0];
}
async function pendingCancel(e) {
  e.page.onLoad(); e.page.performCancel(); e.logins[0].success({ code: "synthetic-reverify" }); await settle();
  return e.matching("/api/auth/cancel", "POST")[0];
}
(async () => {
  for (const outcome of ["success", "failure"]) {
    await check(`Guest login ABA late ${outcome} has no identity/UI effects`, async () => {
      const e = environment(), call = await pendingLogin(e);
      e.auth.saveAuth(e.identity("b")); e.auth.clearAuth(); e.auth.enterGuest(); e.clearEffects();
      if (outcome === "success") e.success(call, e.identity()); else call.fail(); await settle();
      assert.equal(e.auth.getDataMode(), "guest"); e.noEffects();
      if (outcome === "success") assert.equal(e.matching("/api/auth/profile-abandon", "POST")[0].header.Authorization, "Bearer synthetic-token-a");
    });
  }
  for (const stop of ["unload", "cancel"]) {
    await check(`login ${stop} rejects late returned credential`, async () => {
      const e = environment(), call = await pendingLogin(e);
      if (stop === "unload") e.page.onUnload(); else e.page.backToChoice(); e.clearEffects();
      e.success(call, e.identity()); await settle(); assert.equal(e.auth.getDataMode(), "guest"); e.noEffects();
    });
  }
  await check("current login success publishes once and current failure preserves Guest", async () => {
    const e = environment(), call = await pendingLogin(e); e.success(call, e.identity()); await settle();
    assert.equal(e.auth.getAuth().user.id, "synthetic-user-a"); assert.equal(e.page.data.stage, "profile"); assert.equal(e.page.data.busy, false);
    const failed = environment(), failedCall = await pendingLogin(failed); failedCall.fail(); await settle();
    assert.equal(failed.auth.getDataMode(), "guest"); assert.equal(failed.page.data.busy, false); assert(failed.page.data.error);
  });
  await check("failed auth storage commit preserves existing identity", async () => {
    const e = environment(), call = await pendingLogin(e); e.failStorage("xinqingAuth"); e.success(call, e.identity()); await settle();
    assert.equal(e.auth.getDataMode(), "guest"); assert.equal(e.page.data.busy, false); assert(e.page.data.error);
  });
  for (const source of ["pages/auth/auth.js", "pages/me/me.js"]) {
    for (const outcome of ["success", "failure"]) {
      await check(`${source} profile same-token renewal blocks late ${outcome}/finally`, async () => {
        const e = environment(source); e.page.data.profileNickname = "合成旧资料"; e.page.data.originalProfileNickname = "合成原资料";
        e.page.saveProfile(); await settle(); const call = e.matching("/api/auth/me", "PATCH")[0]; assert(call);
        e.renew(); e.clearEffects(); if (outcome === "success") e.success(call, { user: { ...e.identity().user, nickname: "合成旧资料" } }); else call.fail();
        await settle(); assert.equal(e.auth.getAuth().user.nickname, "合成新资料"); e.noEffects();
      });
    }
    await check(`${source} current profile keeps token and commits cache`, async () => {
      const e = environment(source); e.page.data.profileNickname = "合成更新"; e.page.data.originalProfileNickname = "合成原资料";
      e.page.saveProfile(); await settle(); e.success(e.matching("/api/auth/me", "PATCH")[0], { user: { id: "synthetic-user-a", nickname: "合成更新" } }); await settle();
      assert.equal(e.auth.getAuth().user.nickname, "合成更新"); assert.equal(e.auth.getAuth().token, "synthetic-token-a");
      assert.equal(source.includes("/auth/") ? e.page.data.busy : e.page.data.isSavingProfile, false);
    });
  }
  await check("Me refresh A-B-A cannot publish cache/error/finally", async () => {
    const e = environment("pages/me/me.js"); e.page.reconcileAuth(); const call = e.matching("/api/auth/me")[0];
    e.auth.saveAuth(e.identity("b")); e.renew(); e.clearEffects(); e.success(call, { user: { ...e.identity().user, nickname: "合成旧资料" } }); await settle();
    assert.equal(e.auth.getAuth().user.nickname, "合成新资料"); e.noEffects();
  });
  await check("Me current refresh and failure remain visible", async () => {
    const e = environment("pages/me/me.js"); e.page.reconcileAuth(); e.success(e.matching("/api/auth/me")[0], { user: { ...e.identity().user, nickname: "合成同步" } }); await settle();
    assert.equal(e.auth.getAuth().user.nickname, "合成同步"); assert.equal(e.page.data.isCheckingAuth, false);
    e.page.reconcileAuth(); e.matching("/api/auth/me")[1].fail(); await settle(); assert(e.page.data.loginError); assert.equal(e.page.data.isCheckingAuth, false);
  });
  await check("Me unload suppresses late avatar and refresh", async () => {
    const e = environment("pages/me/me.js"); e.page.onShow(); e.page.onUnload(); e.clearEffects();
    e.success(e.matching("/api/auth/me")[0], { user: e.identity().user });
    e.downloads[0].success({ statusCode: 200, tempFilePath: "synthetic-file" }); await settle(); e.noEffects();
  });
  for (const stop of ["switch-before-start", "modal", "wx-login", "http", "unload", "expiry"]) {
    await check(`cancel owner guard at ${stop}`, async () => {
      const e = environment("pages/cancel/cancel.js"); e.page.onLoad();
      if (stop === "switch-before-start") { e.auth.saveAuth(e.identity("b")); e.page.performCancel(); assert.equal(e.logins.length, 0); }
      else if (stop === "modal") { e.page.cancelAccount(); e.auth.saveAuth(e.identity("b")); e.modals[0].success({ confirm: true }); assert.equal(e.logins.length, 0); }
      else {
        e.page.performCancel();
        if (stop === "http") { e.logins[0].success({ code: "synthetic-reverify" }); await settle(); }
        if (stop === "unload") e.page.onUnload?.(); else if (stop === "expiry") e.expire(); else e.auth.saveAuth(e.identity("b"));
        e.clearEffects();
        if (stop === "http") e.success(e.matching("/api/auth/cancel", "POST")[0], { cancelled: true });
        else e.logins[0].success({ code: "synthetic-reverify" }); await settle(); e.noEffects();
      }
      if (stop !== "http") assert.equal(e.matching("/api/auth/cancel", "POST").length, 0);
      if (!["unload", "expiry"].includes(stop)) assert.equal(e.auth.getAuth().user.id, "synthetic-user-b");
    });
  }
  await check("current cancel failure preserves account and shows error", async () => {
    const e = environment("pages/cancel/cancel.js"), call = await pendingCancel(e); call.fail(); await settle();
    assert(e.auth.getAuth()); assert(e.page.data.statusText); assert.equal(e.page.data.isCancelling, false);
  });
  for (const replace of [false, true]) {
    await check(`cloud-completed cleanup retry ${replace ? "cannot clear newer login" : "stays local"}`, async () => {
      const e = environment("pages/cancel/cancel.js"), key = "xinqingMiniChatMessages:synthetic-user-a";
      e.storage.set(key, ["synthetic-history"]); const call = await pendingCancel(e); e.failStorage(key);
      e.success(call, { cancelled: true, mediaCleanup: "pending" }); await settle();
      assert.equal(e.page.data.cloudCancelled, true); assert.equal(e.page.data.isCancelling, false); assert.equal(e.auth.getAuth(), null);
      e.failStorage(null); if (replace) e.auth.saveAuth(e.identity("b")); e.clearEffects(); e.page.cancelAccount(); await settle();
      assert.equal(e.matching("/api/auth/cancel", "POST").length, 1);
      if (replace) { assert.equal(e.auth.getAuth().user.id, "synthetic-user-b"); e.noEffects(); }
      else { assert.equal(e.storage.has(key), false); assert.equal(e.page.data.cloudCancelled, false); }
    });
  }
  await check("completed cancel navigation cannot affect a later login", async () => {
    const e = environment("pages/cancel/cancel.js"), call = await pendingCancel(e); e.success(call, { cancelled: true }); await settle();
    assert.equal(e.auth.getAuth(), null); e.auth.saveAuth(e.identity("b")); e.clearEffects(); e.flushTimers(); e.noEffects();
  });
  for (const entry of ["refresh", "cancel", "auth-profile", "me-profile"]) {
    for (const replace of [false, true]) {
      await check(`current401 ${entry} ${replace ? "cannot finish after new login" : "shows error and finishes"}`, async () => {
        const e = environment(entry === "cancel" ? "pages/cancel/cancel.js" : entry === "auth-profile" ? "pages/auth/auth.js" : "pages/me/me.js");
        let call;
        if (entry === "cancel") call = await pendingCancel(e);
        else if (entry === "refresh") { e.page.reconcileAuth(); call = e.matching("/api/auth/me")[0]; }
        else {
          e.page.data.profileNickname = "合成更新"; e.page.data.originalProfileNickname = "合成原资料";
          e.page.saveProfile(); await settle(); call = e.matching("/api/auth/me", "PATCH")[0];
        }
        call.success({ statusCode: 401, data: { ok: false } }); assert.equal(e.auth.getAuth(), null);
        if (replace) { e.auth.saveAuth(e.identity("b")); e.clearEffects(); }
        await settle();
        if (replace) { assert.equal(e.auth.getAuth().user.id, "synthetic-user-b"); e.noEffects(); }
        else {
          const busy = entry === "cancel" ? "isCancelling" : entry === "refresh" ? "isCheckingAuth" : entry === "auth-profile" ? "busy" : "isSavingProfile";
          const error = entry === "cancel" ? "statusText" : entry === "auth-profile" ? "error" : "loginError";
          assert.equal(e.page.data[busy], false); assert.match(e.page.data[error], /登录|失效|过期/);
        }
      });
    }
  }
  for (const replace of ["other", "same", "current"]) {
    await check(`upload401 ${replace} identity boundary`, async () => {
      const e = environment(), pending = e.load("api/uploads.js").uploadNoteImage("synthetic-file");
      if (replace === "other") e.auth.saveAuth(e.identity("b")); else if (replace === "same") e.renew();
      e.uploads[0].success({ statusCode: 401, data: { ok: false } }); await assert.rejects(pending);
      assert.equal(Boolean(e.auth.getAuth()), replace !== "current");
    });
  }
  const failed = rows.filter((row) => row.status === "FAIL");
  console.log(JSON.stringify({ source: root, passed: rows.length - failed.length, failed: failed.length, cases: rows,
    evidence: "actual Mini modules and Pages with synthetic transport/storage/clock; no live account operations", networkCalls: 0, modelCalls: 0, databaseCalls: 0 }, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
