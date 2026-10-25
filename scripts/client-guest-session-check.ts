import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { loadGuestGreetingAfterHistoryReady, reconcileGuestGreetingMessages } from "../lib/guest-chat-bootstrap";

const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const source = readFileSync(new URL("../lib/client-guest-session.ts", import.meta.url), "utf8");
const authSource = readFileSync(new URL("../lib/client-auth.ts", import.meta.url), "utf8");
const chatSource = readFileSync(new URL("../app/chat/chat-client.tsx", import.meta.url), "utf8");
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); }, data };
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const success = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));
const failure = (status: number, reason: string) => new Response(JSON.stringify({ ok: false,
  error: { code: "SYNTHETIC_ERROR", message: "合成错误", details: { reason } } }), { status });
const START = Date.parse("2026-10-13T00:00:00Z");
const session = (id = "A") => ({ ownerId: `synthetic-owner-${id}`, conversationId: `synthetic-cid-${id}`,
  expiresAt: new Date(START + 60_000).toISOString() });
const harness = () => {
  let now = START;
  const localStorage = memory(), sessionStorage = memory();
  const calls: Array<{ path: string; body: Record<string, unknown>; method: string; credentials: string; headers: unknown }> = [];
  let response: (path: string) => Promise<Response> = async (path) =>
    path.endsWith("/session") ? success(session()) : success({ status: "committed", guestAttempt: 1 });
  const listeners = new Map<string, Array<(event: { key: string | null }) => void>>();
  const document = { cookie: "" };
  const sandbox = vm.createContext({ exports: {}, Response, console,
    Date: class extends Date { static now() { return now; } },
    window: { localStorage, sessionStorage, addEventListener: (name: string, fn: (event: { key: string | null }) => void) => listeners.set(name, [...(listeners.get(name) ?? []), fn]) }, document,
    fetch: async (path: string, options: { body: string; method: string; credentials: string; headers: unknown }) => {
      calls.push({ path, body: JSON.parse(options.body), method: options.method, credentials: options.credentials, headers: options.headers });
      return response(path);
    },
  });
  vm.runInContext(compile(source), sandbox);
  const guest = sandbox.exports as typeof import("../lib/client-guest-session");
  const authSandbox = vm.createContext({ exports: {}, window: sandbox.window, document,
    require: (name: string) => { assert.equal(name, "./client-guest-session"); return guest; } });
  vm.runInContext(compile(authSource), authSandbox);
  return { guest, auth: authSandbox.exports as typeof import("../lib/client-auth"), calls, localStorage, sessionStorage, document,
    setResponse: (next: typeof response) => { response = next; }, advance: () => { now += 60_001; },
    denyStorage: () => { Object.defineProperty(sandbox.window, "localStorage", { get() { throw new Error("synthetic storage denied"); } }); },
    storageEvent: (key: string | null) => listeners.get("storage")?.forEach((listener) => listener({ key })) };
};
const body = { turnId: "synthetic-turn", content: "合成内容", recentMessages: [] };
const run = async () => {
  {
    const h = harness(), pending = deferred<Response>();
    h.setResponse(async (path) => path.endsWith("/session") ? pending.promise : success({ guestAttempt: 1 }));
    const firstAuthority = h.guest.captureGuestAuthority(), secondAuthority = h.guest.captureGuestAuthority();
    const first = h.guest.requestGuest("/api/chat/guest", body, firstAuthority);
    const second = h.guest.requestGuest("/api/chat/guest/greeting", { turnId: "synthetic-greeting" }, secondAuthority);
    assert.equal(h.calls.length, 1, "bootstrap is single-flight");
    pending.resolve(success({ ...session(), credential: "synthetic-unexpected-secret" }));
    await Promise.all([first, second]);
    assert.equal(h.calls.filter((call) => call.path.endsWith("/session")).length, 1);
    assert.equal(firstAuthority.conversationId, session().conversationId);
    assert(h.calls.slice(1).every((call) => call.body.conversationId === session().conversationId));
    assert(h.calls.every((call) => call.credentials === "same-origin" && !("Authorization" in (call.headers as object))));
    assert(![...h.sessionStorage.data.values()].join().includes("secret"), "Web stores only non-secret fields");
    assert.equal(h.localStorage.data.size, 0);
  }
  {
    const h = harness(), pending = deferred<Response>();
    h.setResponse(async () => pending.promise);
    const authority = h.guest.captureGuestAuthority();
    const rejection = assert.rejects(h.guest.requestGuest("/api/chat/guest", body, authority));
    h.guest.revokeGuestSession();
    pending.resolve(success(session()));
    await rejection;
    assert.equal(h.calls.length, 1, "late bootstrap cannot start generation");
    assert.equal(h.sessionStorage.data.size, 0);
    assert.equal(h.guest.isGuestAuthorityCurrent(authority), false);
  }
  for (const transition of ["login", "clear-auth", "storage", "cookie-login", "storage-unavailable", "storage-getter-denied", "malformed-cookie", "expiry"] as const) {
    const h = harness();
    await h.guest.requestGuest("/api/chat/guest", body, h.guest.captureGuestAuthority());
    h.sessionStorage.setItem("xinqingGuestChatCache:v2", "synthetic-local-history");
    const pending = deferred<Response>(), authority = h.guest.captureGuestAuthority();
    h.setResponse(async (path) => path.endsWith("/session") ? success({}) : pending.promise);
    const rejection = assert.rejects(h.guest.requestGuest("/api/chat/guest", body, authority));
    await Promise.resolve();
    if (transition === "login") h.auth.saveAuth({ token: "synthetic-auth" });
    if (transition === "clear-auth") h.auth.clearAuth();
    if (transition === "storage") h.storageEvent("xinqingGuestEpoch:v1");
    if (transition === "cookie-login") h.document.cookie = "xinqingAuthToken=synthetic-cookie-auth";
    if (transition === "storage-unavailable") {
      h.document.cookie = "xinqingAuthToken=synthetic-cookie-auth";
      h.localStorage.getItem = () => { throw new Error("synthetic storage denied"); };
    }
    if (transition === "storage-getter-denied") {
      h.document.cookie = "xinqingAuthToken=synthetic-cookie-auth";
      h.denyStorage();
    }
    if (transition === "malformed-cookie") h.document.cookie = "xinqingAuthToken=%invalid";
    if (transition === "expiry") h.advance();
    pending.resolve(success({ guestAttempt: 1 }));
    await rejection;
    assert.equal(h.guest.isGuestAuthorityCurrent(authority), false, transition);
    assert.equal(h.sessionStorage.getItem("xinqingGuestChatCache:v2"), "synthetic-local-history", `${transition} preserves Guest history`);
    if (["login", "clear-auth", "storage"].includes(transition)) {
      const revoke = h.calls.find((call) => call.method === "DELETE")!;
      assert.equal(revoke.body.ownerId, session().ownerId);
      assert.equal(revoke.body.conversationId, session().conversationId);
      assert.equal(revoke.body.scope, "owner");
    }
  }
  {
    const h = harness();
    await h.guest.requestGuest("/api/chat/guest", body, h.guest.captureGuestAuthority());
    h.guest.revokeGuestSession("conversation");
    assert.equal(h.localStorage.data.size, 0, "tab conversation cleanup does not revoke other tabs by broadcast");
    assert.equal(h.calls.at(-1)!.body.scope, "conversation");
  }
  {
    const h = harness();
    h.document.cookie = "xinqingAuthToken=synthetic-cookie-auth";
    await assert.rejects(h.guest.requestGuest("/api/chat/guest", body, h.guest.captureGuestAuthority()));
    assert.equal(h.calls.length, 0, "cookie-only Auth cannot bootstrap Guest");
  }
  for (const kind of ["recover", "twice", "network", "unknown"] as const) {
    const h = harness(); let bootstraps = 0, generations = 0;
    h.setResponse(async (path) => {
      if (path.endsWith("/session")) return success(session(String(++bootstraps)));
      generations += 1;
      if (kind === "network") throw new Error("synthetic transport failure");
      if (kind === "unknown") return failure(409, "GUEST_EXECUTION_UNKNOWN");
      return generations === 1 || kind === "twice" ? failure(401, "GUEST_SESSION_INVALID") : success({ guestAttempt: 1 });
    });
    const old = h.guest.captureGuestAuthority(), authority = h.guest.captureGuestAuthority();
    const result = h.guest.requestGuest("/api/chat/guest", body, authority);
    if (kind === "recover") await result; else await assert.rejects(result);
    assert.equal(generations, ["recover", "twice"].includes(kind) ? 2 : 1, kind);
    assert.equal(bootstraps, ["recover", "twice"].includes(kind) ? 2 : 1, kind);
    if (kind === "recover") assert.equal(h.guest.isGuestAuthorityCurrent(old), false, "null-cid capture loses old epoch on replacement");
  }
  {
    const h = harness(), authority = h.guest.captureGuestAuthority();
    await h.guest.requestGuest("/api/chat/guest", body, authority);
    await h.guest.requestGuest("/api/chat/guest", body, authority, 1);
    assert.equal(h.calls.at(-1)!.body.retryOfAttempt, 1);
    assert.equal(h.calls.at(-1)!.body.turnId, body.turnId);
    const count = h.calls.length;
    h.advance();
    await assert.rejects(h.guest.requestGuest("/api/chat/guest", body, authority, 1));
    assert.equal(h.calls.length, count, "expired explicit retry cannot bootstrap or replay");
    const next = h.guest.captureGuestAuthority();
    assert.notEqual(next.epoch, authority.epoch);
  }
  // Execute real greeting helpers, including their early storage writes, with synthetic transport.
  const greetingStart = chatSource.indexOf("const createGuestGreetingMessage = async");
  const greetingEnd = chatSource.indexOf("const getTodayKey =", greetingStart);
  const loadStart = chatSource.indexOf("      if (!storedAuth?.token || isLocalDemoAuth) {");
  const loadEnd = chatSource.indexOf("      setIsGuestMode(false);", loadStart);
  for (const transition of ["current", "cancelled"] as const) {
    const h = harness(), writes: string[] = [];
    let bootstraps = 0, generations = 0, fakeModels = 0;
    let visible: Array<{ id: string }> = [];
    const context = vm.createContext({ ...h.guest, cancelled: false, storedAuth: null, isLocalDemoAuth: false, currentGuestMode: true,
      chatAuthRef: { current: null }, pageGenerationRef: { current: 0 }, pageGeneration: 0,
      GUEST_SESSION_ID: "guest-session", shouldAutoScrollToBottomRef: { current: false },
      setIsGuestMode: () => {}, setSessionId: () => {},
      setMessages: (value: Array<{ id: string }> | ((current: Array<{ id: string }>) => Array<{ id: string }>)) => {
        visible = typeof value === "function" ? value(visible) : value;
      }, setHasMoreOlderMessages: () => {}, setOlderMessagesCursor: () => {}, setIsLoadingMessages: () => {}, setErrorMessage: () => {},
      loadGuestGreetingAfterHistoryReady, reconcileGuestGreetingMessages,
      readGuestRecentGreetings: () => [], createClientTurnId: () => "synthetic-recovered-greeting",
      rememberGuestGreeting: () => writes.push("recent"), readGuestMessages: () => [],
      reserveGuestOpenGreeting: () => true, releaseGuestOpenGreeting: () => writes.push("release"),
      isProactiveGreetingPromptVersion: () => false, guestProactiveGreetingKind: () => "initial",
      writeGuestMessages: () => writes.push("history"),
    });
    h.setResponse(async (path) => {
      if (path.endsWith("/session")) return success(session(String(++bootstraps)));
      generations++;
      if (generations === 1) return failure(401, "GUEST_SESSION_INVALID");
      fakeModels++;
      if (transition === "cancelled") context.cancelled = true;
      return success({ guestAttempt: 1, assistantMessage: { id: "synthetic-recovered-greeting", content: "合成问候" } });
    });
    vm.runInContext(compile(chatSource.slice(greetingStart, greetingEnd) +
      "\nglobalThis.run = async () => {" + chatSource.slice(loadStart, loadEnd) + "};"), context);
    await context.run();
    assert.equal(bootstraps, 2);
    assert.equal(generations, 2);
    assert.equal(fakeModels, 1, "the first rejection occurs before fake model generation");
    assert.deepEqual(writes, transition === "current" ? ["recent", "history"] : [],
      "actual load/helpers must retain recovered greeting authority while respecting page cancellation");
    assert.equal(visible.some((item) => item.id === "synthetic-recovered-greeting"), transition === "current");
  }
  for (const transition of ["current", "cancelled", "login", "transport"] as const) {
    let current = true, identity = true;
    const pending = deferred<{ assistantMessage: { id: string; content: string } }>(), writes: string[] = [];
    let requests = 0;
    const context = vm.createContext({
      captureGuestAuthority: () => ({}), isGuestAuthorityCurrent: () => identity,
      readGuestRecentGreetings: () => [], createClientTurnId: () => "synthetic-greeting",
      requestGuest: () => { requests++; return pending.promise; }, rememberGuestGreeting: () => writes.push("recent"),
      readGuestMessages: () => [], reserveGuestOpenGreeting: () => true, releaseGuestOpenGreeting: () => writes.push("release"),
      isProactiveGreetingPromptVersion: () => false, guestProactiveGreetingKind: () => "initial",
      writeGuestMessages: () => writes.push("history"),
    });
    vm.runInContext(compile(chatSource.slice(greetingStart, greetingEnd) + "\nglobalThis.run = readOrSeedGuestMessages;"), context);
    const result = context.run(() => current && identity, {}) as Promise<unknown>;
    if (transition === "cancelled") current = false;
    if (transition === "login") identity = false;
    if (transition === "transport") pending.reject(new Error("synthetic unknown"));
    else pending.resolve({ assistantMessage: { id: "synthetic-reply", content: "合成问候" } });
    await result;
    assert.equal(requests, 1, "greeting unknown failure must not create another model attempt");
    assert.deepEqual(writes, transition === "current" ? ["recent", "history"] : transition === "transport" ? ["release"] : [], transition);
  }
  // Actual Guest submit source: late success and failure cannot touch quota, UI or storage.
  const submitStart = chatSource.indexOf("  const handleSubmit = async");
  const guestStart = chatSource.indexOf("    if (isGuestMode) {", submitStart);
  const guestEnd = chatSource.indexOf("\n    try {", guestStart);
  for (const outcome of ["committed", "failed", "transport"] as const) {
    let current = true;
    const pending = deferred<unknown>(), writes: string[] = [];
    const context = vm.createContext({ isGuestMode: true, guestAuthority: {}, resultAuthority: {},
      pendingAssistantId: "synthetic-pending", optimisticId: "synthetic-user", text: "合成正文", messages: [], showAiDebugTrace: false,
      isCurrentSessionResult: () => current, getGuestAiRemaining: () => 3, requestGuest: () => pending.promise,
      incrementGuestAiUsage: () => writes.push("quota"), setMessages: () => writes.push("UI"),
      setTypingMessageIds: () => writes.push("typing"), setExecutionStatus: () => writes.push("status"),
      writeGuestMessages: () => writes.push("history"), revealAssistantReply: () => writes.push("animation"),
      applyTurnCompletionResult: () => writes.push("completion"), getErrorMessage: () => "synthetic-error",
    });
    vm.runInContext(compile("globalThis.run = async () => {" + chatSource.slice(guestStart, guestEnd) + "};"), context);
    const result = context.run() as Promise<void>;
    current = false;
    if (outcome === "transport") pending.reject(new Error("synthetic unknown"));
    else pending.resolve({ status: outcome, guestAttempt: 1, assistantMessage: { id: "synthetic-reply", content: "合成回复" } });
    await result;
    assert.deepEqual(writes, [], `${outcome} stale Guest submit`);
  }
  const retryStart = chatSource.indexOf("    const pending = executionStatus;");
  const retryEnd = chatSource.indexOf("\n  const loginForDebug", retryStart);
  const retrySource = chatSource.slice(retryStart, retryEnd);
  assert(retrySource.includes('request.body, request.authority, request.attempt'));
  assert(!retrySource.includes("recentMessages:"), "retry cannot reconstruct generation input from changed UI");
  for (const transition of ["current", "cancelled"] as const) {
    for (const outcome of ["committed", "failed", "transport"] as const) {
      let current = true, requests = 0;
      const pending = deferred<unknown>(), writes: string[] = [];
      const originalBody = { ...body, recentMessages: [{ id: "synthetic-original-history" }], debugTrace: false };
      const executionStatus = { retryable: true, turnId: body.turnId, inputText: body.content, isGuest: true, authority: {},
        guestRequest: { body: originalBody, authority: {}, attempt: 1 } };
      const guestRetryInFlightRef: { current: unknown } = { current: undefined };
      const context = vm.createContext({ executionStatus, sessionId: "guest-session", guestRetryInFlightRef,
        retryScopeRef: { current: 0 }, authRetryInFlightRef: { current: null },
        sessionContextRef: { current: { authority: {} } }, isGuestAuthorityCurrent: () => current,
        canApplyChatSessionResult: () => current, canApplyChatTurnResult: () => current,
        messages: [{ id: "synthetic-changed-UI-must-not-be-retried" }], showAiDebugTrace: false,
        setExecutionStatus: () => writes.push("status"), setErrorMessage: () => writes.push("error"),
        requestGuest: (_path: string, actualBody: unknown, authority: unknown, attempt: number) => {
          requests++; assert.equal(actualBody, originalBody); assert.equal(authority, executionStatus.guestRequest.authority);
          assert.equal(attempt, 1); return pending.promise;
        }, incrementGuestAiUsage: () => writes.push("quota"),
        setMessages: (updater: (items: unknown[]) => unknown[]) => { writes.push("UI"); updater([]); },
        writeGuestMessages: () => writes.push("history"), revealAssistantReply: async () => { writes.push("animation"); },
        applyTurnCompletionResult: (_path: string, _authority: unknown, completion: { executionStatus: typeof executionStatus | null }) => {
          writes.push("completion");
          if (outcome === "failed") assert.equal(completion.executionStatus?.guestRequest.attempt, 2);
        }, getErrorMessage: () => "synthetic-error",
      });
      vm.runInContext(compile("globalThis.run = async () => {\n" + retrySource), context);
      const first = context.run() as Promise<void>;
      await context.run(); // Same rendered retry handler invoked twice must only issue one request.
      assert.equal(requests, 1);
      writes.length = 0;
      if (transition === "cancelled") current = false;
      if (outcome === "transport") pending.reject(new Error("synthetic transport"));
      else pending.resolve({ status: outcome, guestAttempt: 2,
        ...(outcome === "committed" ? { assistantMessage: { id: "synthetic-retry-reply", content: "合成重试回复" } } : {}),
      });
      await first;
      assert.equal(guestRetryInFlightRef.current, undefined);
      if (transition === "cancelled") assert.deepEqual(writes, [], `late retry ${outcome}`);
      else assert(writes.includes("completion"), `current retry ${outcome} still visible`);
    }
  }
  assert(!chatSource.slice(chatSource.indexOf("const loginForDebug")).includes("clearAuth();"), "failed debug login preserves Guest");
  // The actual animation must stop both later ticks and its final cleanup after cancellation.
  const animationStart = chatSource.indexOf("  const revealAssistantReply =");
  const animationEnd = chatSource.indexOf("  const handleSubmit =", animationStart);
  {
    let current = true;
    const wait = deferred<void>(), writes: string[] = [];
    const context = vm.createContext({ typingCancelledRef: { current: false },
      setTypingMessageIds: () => writes.push("typing"), setMessages: () => writes.push("UI"),
      getNextTypingIndex: (_: string, index: number) => index + 1, getTypingDelay: () => 1, sleep: () => wait.promise });
    vm.runInContext(compile(chatSource.slice(animationStart, animationEnd) + "globalThis.run = revealAssistantReply;"), context);
    const result = context.run("synthetic-reply", "合成回复", () => current) as Promise<void>;
    assert(writes.length > 0);
    current = false; writes.length = 0; wait.resolve(); await result;
    assert.deepEqual(writes, [], "cancelled animation has no tick/finally mutation");
  }
  console.log("client Guest session check passed: real modules/Guest branches, synthetic handles/fetch/clock, no network/DB/models");
};
run().catch((error) => { console.error(error); process.exitCode = 1; });
