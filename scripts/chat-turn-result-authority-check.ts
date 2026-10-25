import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { apiRequest, ClientApiError } from "../lib/client-api";
import { getAuthToken } from "../lib/client-auth";
import {
  advanceChatSessionAuthority,
  canApplyChatSessionResult,
  createChatTurnAuthorityState,
  resolveChatTurnResult,
  submitChatTurnAuthority,
  type ChatTurnAuthorityState,
  type ChatTurnResultAuthority,
} from "../lib/chat-turn-result-authority";

type VisibleResult = Readonly<{
  status: string | null;
  error: string;
}>;

const submit = (
  current: ChatTurnAuthorityState,
  turnId: string
): { state: ChatTurnAuthorityState; result: ChatTurnResultAuthority } =>
  submitChatTurnAuthority(current, turnId);

const resolve = (
  current: ChatTurnAuthorityState,
  result: ChatTurnResultAuthority,
  visible: VisibleResult,
  next: VisibleResult
) => resolveChatTurnResult({ current, result, previousValue: visible, nextValue: next });

let authenticated = createChatTurnAuthorityState("authenticated-session");
const oldAuthenticated = submit(authenticated, "auth-old");
authenticated = oldAuthenticated.state;
const latestAuthenticated = submit(authenticated, "auth-latest");
authenticated = latestAuthenticated.state;

let visible: VisibleResult = { status: null, error: "" };
visible = resolve(authenticated, oldAuthenticated.result, visible, {
  status: "old failure",
  error: "",
});
assert.deepEqual(visible, { status: null, error: "" }, "old Auth failure must be ignored");

visible = resolve(authenticated, latestAuthenticated.result, visible, {
  status: "latest failure",
  error: "",
});
assert.equal(visible.status, "latest failure", "latest Auth failure must remain visible");

visible = resolve(authenticated, oldAuthenticated.result, visible, {
  status: null,
  error: "",
});
assert.equal(visible.status, "latest failure", "old Auth success must not clear latest failure");

visible = resolve(authenticated, latestAuthenticated.result, visible, {
  status: "retry failure",
  error: "",
});
assert.equal(visible.status, "retry failure", "same-turn retry may update its failure");
visible = resolve(authenticated, latestAuthenticated.result, visible, {
  status: null,
  error: "",
});
assert.equal(visible.status, null, "same-turn retry success may clear its failure");

visible = resolve(authenticated, latestAuthenticated.result, visible, {
  status: null,
  error: "latest transport failure",
});
assert.equal(visible.error, "latest transport failure", "latest transport failure must be shown");
visible = resolve(authenticated, oldAuthenticated.result, visible, {
  status: null,
  error: "old transport failure",
});
assert.equal(
  visible.error,
  "latest transport failure",
  "old transport failure must not replace the latest error"
);

const afterRetry = submit(authenticated, "auth-after-retry");
authenticated = afterRetry.state;
visible = { status: null, error: "" };
visible = resolve(authenticated, latestAuthenticated.result, visible, {
  status: "stale retry failure",
  error: "",
});
assert.equal(visible.status, null, "retry loses authority after a newer submit");
visible = resolve(authenticated, afterRetry.result, { status: "old status", error: "" }, {
  status: null,
  error: "",
});
assert.equal(visible.status, null, "latest Auth success clears old status");

let guest = createChatTurnAuthorityState("guest-session");
const oldGuest = submit(guest, "guest-old");
guest = oldGuest.state;
const latestGuest = submit(guest, "guest-latest");
guest = latestGuest.state;
visible = resolve(guest, oldGuest.result, { status: null, error: "" }, {
  status: "old Guest failure",
  error: "",
});
assert.equal(visible.status, null, "old Guest failure must be ignored");
visible = resolve(guest, latestGuest.result, visible, {
  status: "latest Guest failure",
  error: "",
});
assert.equal(visible.status, "latest Guest failure", "latest Guest failure remains retryable");
visible = resolve(guest, latestGuest.result, visible, { status: null, error: "" });
assert.equal(visible.status, null, "latest Guest retry success clears its failure");

const beforeSwitch = submit(authenticated, "before-switch");
authenticated = beforeSwitch.state;
authenticated = advanceChatSessionAuthority(authenticated, "other-session");
assert.equal(
  canApplyChatSessionResult({ current: authenticated, result: beforeSwitch.result }),
  false,
  "old session completion must not update visible messages"
);
visible = resolve(authenticated, beforeSwitch.result, { status: null, error: "" }, {
  status: "old session failure",
  error: "",
});
assert.equal(visible.status, null, "old session failure must not become visible");
authenticated = advanceChatSessionAuthority(authenticated, "authenticated-session");
visible = resolve(authenticated, beforeSwitch.result, visible, {
  status: "restored stale failure",
  error: "",
});
assert.equal(visible.status, null, "switching back must not restore old completion authority");

let commitSafe = createChatTurnAuthorityState("visible-session");
const visibleTurn = submit(commitSafe, "visible-turn");
commitSafe = visibleTurn.state;
const uncommittedSessionId = "rendered-but-not-committed-session";
visible = resolve(commitSafe, visibleTurn.result, { status: null, error: "" }, {
  status: "still-visible failure",
  error: "",
});
assert.equal(
  visible.status,
  "still-visible failure",
  "an aborted render must not suppress the committed session's latest result"
);
commitSafe = advanceChatSessionAuthority(commitSafe, uncommittedSessionId);
visible = resolve(commitSafe, visibleTurn.result, { status: null, error: "" }, {
  status: "post-commit stale failure",
  error: "",
});
assert.equal(visible.status, null, "the old result loses authority after session commit");

const clientSource = readFileSync(new URL("../app/chat/chat-client.tsx", import.meta.url), "utf8");
assert(clientSource.includes("useLayoutEffect(() =>"));
assert(clientSource.includes("advanceChatSessionAuthority("));
assert(clientSource.includes("submitChatTurnAuthority("));
assert(clientSource.includes("resolveChatTurnResult({"));
assert(!clientSource.includes("latestSubmittedTurnRef"));

const expectedCompletionPaths = [
  "auth-retry-failure",
  "auth-retry-success",
  "auth-retry-transport",
  "auth-submit-failure",
  "auth-submit-success",
  "auth-submit-transport",
  "guest-retry-failure",
  "guest-retry-success",
  "guest-retry-transport",
  "guest-submit-failure",
  "guest-submit-success",
  "guest-submit-transport",
];
const readBoundCompletionPaths = (source: string) =>
  Array.from(source.matchAll(/applyTurnCompletionResult\(\s*"([^"]+)"/g), (match) =>
    match[1]
  ).sort();
const boundCompletionPaths = readBoundCompletionPaths(clientSource);
assert.deepEqual(
  boundCompletionPaths,
  expectedCompletionPaths,
  "every async completion branch must bind exactly once to the shared result writer"
);
const guestFailureBinding = 'applyTurnCompletionResult("guest-submit-failure"';
assert(clientSource.includes(guestFailureBinding));
const directGuestFailureMutation = clientSource.replace(
  guestFailureBinding,
  "setExecutionStatus("
);
assert.notDeepEqual(
  readBoundCompletionPaths(directGuestFailureMutation),
  expectedCompletionPaths,
  "a direct Guest failure status write must break the wiring contract"
);

const writerStart = clientSource.indexOf("const applyTurnCompletionResult = useCallback(");
const writerEnd = clientSource.indexOf("\n\n  useEffect", writerStart);
assert(writerStart >= 0 && writerEnd > writerStart, "shared result writer must remain identifiable");
const writerSource = clientSource.slice(writerStart, writerEnd);
assert.equal(
  writerSource.match(/resolveChatTurnResult\(\{/g)?.length,
  2,
  "shared writer must authority-scope both status and error updates"
);
assert(writerSource.includes("setExecutionStatus((current) =>"));
assert(writerSource.includes("setErrorMessage((current) =>"));

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    entries: () => [...values.entries()],
  };
};

const greetingStart = clientSource.indexOf("  const handleExecutionRetry = async () => {");
const greetingEnd = clientSource.indexOf("    const pending = executionStatus;", greetingStart);
const layoutStart = clientSource.indexOf("  useLayoutEffect(() => {");
const layoutEnd = clientSource.indexOf("  const applyTurnCompletionResult", layoutStart);
const cacheStart = clientSource.indexOf("const readChatCache =");
const cacheEnd = clientSource.indexOf("const getInitialGuestMode =", cacheStart);
assert(greetingStart >= 0 && greetingEnd > greetingStart);
assert(layoutStart >= 0 && layoutEnd > layoutStart);
assert(cacheStart >= 0 && cacheEnd > cacheStart);
const greetingHarness = ts.transpileModule(
  clientSource.slice(cacheStart, cacheEnd) + clientSource.slice(layoutStart, layoutEnd) +
  clientSource.slice(greetingStart, greetingEnd) + "};\nglobalThis.retryGreeting = handleExecutionRetry;",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
).outputText;

const checkGreetingRetry = async (transition: string, outcome: "success" | "failure") => {
  let auth: { token: string; user: { id: string } } | null = {
    token: "synthetic-token-A", user: { id: "synthetic-user-A" },
  };
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const storage = memoryStorage();
  const local = memoryStorage();
  const authModule = vm.createContext({ exports: {},
    window: { localStorage: local, addEventListener() {} }, document: { cookie: "" },
    require: () => ({ revokeGuestSession() {} }),
  });
  vm.runInContext(ts.transpileModule(readFileSync(new URL("../lib/client-auth.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, authModule);
  const authClient = authModule.exports as typeof import("../lib/client-auth");
  const publish = () => auth ? authClient.saveAuth(auth as import("../lib/client-auth").StoredAuth) : authClient.clearAuth();
  publish();
  const writes: string[] = [];
  const effects: Array<() => void | (() => void)> = [];
  const record = (field: string) => () => { writes.push(field); };
  const sandbox = vm.createContext({
    CHAT_CACHE_PREFIX: "synthetic-chat-cache",
    window: { sessionStorage: storage }, ...authClient,
    chatAuthRef: { current: authClient.captureAuthAuthority() }, authRetryInFlightRef: { current: null },
    retryScopeRef: { current: 0 }, olderRequestRef: { current: null }, isLoadingOlderMessagesRef: { current: false },
    prependScrollRef: { current: null }, pageGenerationRef: { current: 0 },
    debugLoginScope: { current: authClient.createAuthRequestScope() }, hydratedFromCacheRef: { current: false },
    requestedSessionId: null,
    setSessionId: record("session"), setAuthRevision: record("authRevision"),
    setIsLoadingOlderMessages: record("loadingOlder"), setTypingMessageIds: record("typing"),
    sessionId: "session-A", sessionContextKey: "A", greetingStatus: { retryable: true },
    isGuestMode: false,
    sessionContextRef: { current: { key: "A", authority: createChatTurnAuthorityState("session-A") } },
    advanceChatSessionAuthority, canApplyChatSessionResult,
    useLayoutEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
    setExecutionStatus: record("execution"), setGreetingStatus: record("greeting"),
    setErrorMessage: record("error"), setMessages: record("messages"),
    setHasMoreOlderMessages: record("hasMore"), setOlderMessagesCursor: record("cursor"),
    toMessages: (items: unknown) => items, apiRequest: () => pending,
    getErrorMessage: (error: Error) => error.message,
  });
  vm.runInContext(greetingHarness, sandbox);
  let cleanups = effects.map((effect) => effect());
  if (transition === "strict-mode-current") {
    cleanups.forEach((cleanup) => cleanup?.());
    cleanups = effects.map((effect) => effect());
  }
  const run = sandbox.retryGreeting() as Promise<void>;
  const switchSession = (id: string) => {
    sandbox.sessionId = id;
    sandbox.sessionContextKey = id;
    effects[0](); // Actual committed layout effect, including generation advancement.
  };
  if (transition === "switch") switchSession("session-B");
  if (transition === "switch-back") { switchSession("session-B"); switchSession("session-A"); }
  if (transition === "logout") auth = null;
  if (transition === "account-switch") auth = { token: "synthetic-token-B", user: { id: "synthetic-user-B" } };
  if (transition === "new-login-same-user") auth = { token: "synthetic-new-token-A", user: { id: "synthetic-user-A" } };
  if (["logout", "account-switch", "new-login-same-user"].includes(transition)) publish();
  if (transition === "unmount") cleanups.forEach((cleanup) => cleanup?.());
  writes.length = 0;
  if (outcome === "success") resolve({ items: [{ id: "synthetic-A-reply" }], hasMore: false, nextCursor: null });
  else reject(new Error("synthetic request error"));
  await run;
  const current = transition === "current" || transition === "strict-mode-current";
  if (current) {
    assert(writes.includes(outcome === "success" ? "messages" : "error"), `${transition}/${outcome} remains visible`);
    assert.equal(storage.entries().length, outcome === "success" ? 1 : 0);
  } else {
    assert.deepEqual(writes, [], `${transition}/${outcome} must not mutate current UI`);
    assert.deepEqual(storage.entries(), [], `${transition}/${outcome} must not write any account cache`);
  }
};

const checkUnauthorizedResult = async (kind: "old-token" | "current-token" | "guest" | "logged-out") => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  const storage = memoryStorage();
  storage.setItem("xinqingAuthToken", "synthetic-token-A");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage, addEventListener() {} } });
  try {
    let resolve!: (response: Response) => void;
    globalThis.fetch = async () => new Promise<Response>((yes) => { resolve = yes; });
    const request = apiRequest("/synthetic-only", { auth: kind !== "guest" });
    const rejected = assert.rejects(request, (error) => error instanceof ClientApiError && error.status === 401);
    if (kind === "old-token") storage.setItem("xinqingAuthToken", "synthetic-token-B");
    if (kind === "logged-out") storage.removeItem("xinqingAuthToken");
    resolve(new Response(JSON.stringify({ ok: false, error: { message: "synthetic unauthorized" } }), { status: 401 }));
    await rejected;
    assert.equal(getAuthToken(), kind === "old-token" ? "synthetic-token-B" : kind === "guest" ? "synthetic-token-A" : null,
      `${kind} 401 must only clear its own authenticated token`);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
};

const checkAsyncIsolation = async () => {
  const failures: string[] = [];
  for (const transition of ["current", "strict-mode-current", "switch", "switch-back", "logout", "account-switch", "new-login-same-user", "unmount"]) {
    for (const outcome of ["success", "failure"] as const) {
      try { await checkGreetingRetry(transition, outcome); }
      catch { failures.push(`greeting:${transition}/${outcome}`); }
    }
  }
  for (const kind of ["old-token", "current-token", "guest", "logged-out"] as const) {
    try { await checkUnauthorizedResult(kind); }
    catch { failures.push(`api-401:${kind}`); }
  }
  assert.deepEqual(failures, [], "actual client branch/API isolation scenarios must pass");
  console.log("chat turn result authority check passed (actual greeting/layout/cache source + mocked API 401; no network/DB)");
};
checkAsyncIsolation().catch((error) => { console.error(error); process.exitCode = 1; });
