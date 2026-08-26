import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

console.log("chat turn result authority check passed");
