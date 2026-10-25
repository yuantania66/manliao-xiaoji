## Problem

The chat UI can show `这次回复没能生成，请重试。` below a later successful
Assistant reply when two User turns are submitted before the first request finishes.
The banner then appears to describe the visible successful reply even though it belongs
to an older failed turn.

## Evidence

- Session `cmsebsoi90006jbva9kbz29ok` persisted User turn
  `turn-f3140b82-9e18-43ce-ac9b-ea505d918a83` (`小时很多啊`) at
  17:24:43 CST.
- That turn completed at 17:25:06 with two rejected Surface candidates and final code
  `GENERATION_NONCONFORMANT`.
- User turn `turn-81450ec8-eb43-4632-9117-f402b259842c` (`小事很多啊`) was
  submitted at 17:24:58 while the first request was still running. It committed
  Assistant message `cmsk64d9x0088jbvlre7jltrh` at 17:25:20.
- `handleSubmit` clears the single global `executionStatus` only when a new submission
  starts. Any earlier request may later set that global status. The successful branch
  does not remove a status installed by an older in-flight request.
- The failed server plan used `continue_user_introduced_content`, not
  `complete_reciprocal_contact`; this screenshot is not the open PHM-C reciprocal
  Validator false positive.

## Root Cause

Client result authority is not bound to a User turn. Concurrent request completions
race to update one global `executionStatus`, so an older failure can become visible
after a newer turn has already been submitted and can remain after that newer turn
commits successfully.

The older server request also has a separate Surface realization failure, but that
failure is validly fail-closed and does not justify attaching its banner to a later
successful turn.

## Proposed Solution

Track the latest submitted User turn in the client and apply execution-status/error
results only when the completing request still owns that latest-turn authority.
Use the same rule for authenticated submissions, Guest submissions, and retries.
When the authoritative turn succeeds, explicitly leave its execution status clear.

Do not serialize message submission, hide a current-turn failure, relax Validator, or
change Interpreter, Planner, Surface, persistence, lifecycle state, or retry semantics.

## Files To Change

- `app/chat/chat-client.tsx`
- one small pure client turn-result authority helper
- one focused regression check and its package script registration
- current delivery/evidence documentation

## Risks

- An old success must not erase a newer turn's valid failure banner.
- The latest failure must remain retryable.
- A retry must retain authority for its original turn unless a newer turn is submitted.
- Guest and authenticated paths must behave identically.
- Existing client-turn-id changes in the dirty worktree must be preserved.

## Implemented greeting-retry isolation (2026-10-13)

The authenticated greeting retry was a separate asynchronous branch that bypassed
the existing session authority. It could replace messages or errors after a session
switch, and `writeChatCache` selected the currently logged-in account at completion.
The branch now captures the existing session/generation and current auth token/user,
then checks both before success or error writes. Layout cleanup advances the same
authority on unmount; a later mount or an A-to-B-to-A switch does not restore an old
request's authority. Normal same-session success and failure remain visible.

The direct transport error path also needed a narrow correction: `client-api.ts`
now clears auth on 401 only when the request carried the still-current token. A
late 401 from an older login, or an unauthenticated request, cannot clear a new login.
This matches the existing Mini Program request guard and adds no identity scheme.

`check:chat-turn-result-authority` executes the actual greeting, layout cleanup and
cache functions with deferred responses and synthetic storage, plus the actual API
wrapper with mock 401 responses. It covers normal completion, session switch/back,
logout, account change, renewed login, unmount and Strict Mode setup/cleanup/setup.
These are offline source execution checks, not browser, model or database evidence.

## Local anonymous Guest session slice (2026-10-13)

Guest remains available before registration. The previous authenticated-only
proposal was withdrawn. The user confirmed the app is currently local-only;
historical deployment records are not evidence of current running processes.

The two Guest generation routes now validate a server-issued opaque capability
and a server-issued conversation bound to its owner. Web holds the secret only in
an HttpOnly, SameSite=Strict cookie; Mini uses separate storage and dedicated
headers. Web JSON never exposes the secret. Client IDs and request digests are
idempotency inputs, not identity. JSON/Origin checks protect the Web endpoints;
mixed Web/Mini credentials are rejected. POST bootstrap and DELETE revocation
perform no model or database work. DELETE targets the captured old owner/cid and
does not send Set-Cookie, so its late response cannot erase a newer cookie.

The process-local registry shares reply and greeting admission. A request binds
owner/cid/endpoint/turnId to normalized generation inputs. Concurrent duplicate
requests share one pending execution; changed inputs conflict. Successful and
ordinary failed payloads expire after completion; their tombstones prevent a
second implicit generation. Only an explicitly retryable failure can advance via
`retryOfAttempt`; replaying that number reuses the same next attempt, even if it
also failed. Unknown outcomes never trigger automatic replay. Only a definite
pre-model invalid-session response permits one bounded bootstrap recovery.

Admission reserves quota before generation, including debug requests. Reservations
are refunded only if generation never started. Revocation/expiry actively removes
payloads and indexes, while an independent pending lease remains counted until
the work settles. An already-started result arriving after expiry/revocation
returns an unknown-outcome error, never the pre-model 401 recovery signal.

Defaults are explicit in `GUEST_SESSION_DEFAULTS` and are local trial settings:

| Setting | Default |
| --- | --- |
| Owner/conversation absolute lifetime | 24 hours; no sliding refresh |
| Completed payload lifetime | 10 minutes, capped by owner expiry |
| IP executions / owner greetings per Beijing day | 20 / 3; greetings consume both |
| IP owner issuances per Beijing day | 60 |
| Owners / conversations / conversations per owner | 1,000 / 4,000 / 16 |
| Attempts total / per conversation | 10,000 / 128 |
| Pending total / per owner | 32 / 4, including revoked in-flight work |
| Cached payload count / each / total | 1,000 / 128 KiB / 16 MiB |
| Normalized generation input / rate keys | 128 KiB / 4,000 |

Configuration uses `GUEST_SESSION_` plus each camelCase setting converted to
UPPER_SNAKE_CASE; IP execution quota retains `GUEST_AI_IP_DAILY_LIMIT`.
`GUEST_TRUST_PROXY=true` is the only opt-in to forwarded IP headers. Without it,
requests share the local `unknown` rate key; IP never establishes ownership.
Retention can only be reduced by environment overrides. Other positive integer
limits are capped at 100 times their default. Web's existing local three-chat
daily counter is unchanged and is not imposed on Mini. New limits require trial
review; they are not approved deployment behavior.

The Web helper stores non-secret handles and invalidates request epochs on
identity changes, cross-tab auth events and expiry. Mini stores its capability
separately and freezes retry inputs in a bounded in-memory map (64 requests,
cleared on invalidation; expired records are discarded before adding requests).
Both clients protect Guest-origin results, errors, cache writes, animations and
pending-state changes. Successful login/exit revokes the captured old capability;
cancelled or failed login preserves Guest. Histories remain in the existing local
keys and are not uploaded or imported into Auth. Revocation is best effort when
offline; the server's absolute expiry remains the final bound.

`check:guest-session` covers actual modules/routes and Web/Mini source execution
with deterministic synthetic capabilities, clocks and model stubs. It is not a
browser or device test. Local HTTP development uses `manliao-guest`; NODE_ENV
production uses the Secure `__Host-manliao-guest` cookie and needs compatible
HTTPS/cookie behavior verified before any local production-mode browser trial.
The registry assumes one Node process. Restarted/other processes reject old
capabilities; this does not provide cross-process/restart exactly-once billing.
No running-process topology, real model, database or deployment was verified.

The Guest-origin slice left Mini Auth bootstrap, history and send completion
outside its scope. The following separately authorized slice closes those local
Mini checks; it does not change the Guest protocol or the earlier acceptance.

## Mini authenticated result isolation (2026-10-13)

Auth requests now capture the existing authentication token/user/expiry plus a
process-local generation. Successful identity changes advance that generation;
failed login persistence and profile-only updates preserve the current request.
The request wrapper clears auth on 401 only while that captured authority remains
current, including renewed login with the same token and A-to-B-to-A transitions.

The Mini chat page adds page/session epochs around authenticated bootstrap,
history and sending. Checks run before follow-up requests as well as success,
failure, delayed setData callbacks and animation writes. A shared bootstrap is
bound to its captured identity/page/session; an old finally cannot clear a newer
flight. Page re-show/unload invalidates earlier callbacks. This does not cancel
already-started server work or prove whether an interrupted send committed.

`check:mini-chat-auth-authority` executes the real Mini modules with synthetic wx
storage/transport/time: the same 35 cases go from 6 passing / 29 failing to 35
passing. A separate fixed 24-case source execution probe goes from 6 passing /
18 failing to 24 passing. Current success, network and durable system failures,
current 401 cleanup, failed login and profile updates remain covered. The legacy
chat check retains its behavior assertions and only updates authority mocks.
These are offline checks, not WeChat, database or real-generation evidence.

Remaining: a finite Web audit executes the actual Auth load, older-page, submit
and ordinary retry branches and reproduces old-account responses writing into a
new account's UI; load and older-page also select the new account's cache key at
completion. Those branches lack captured Auth identity authority. The existing
greeting-retry and Guest checks do not cover them. A separate same-token restored
login counterexample also bypasses Web's token-only 401 guard; the cross-account
UI/cache failures do not depend on that token-reuse premise. Web repair is outside
the Mini slice and remains a release blocker. Real device, DB/model and complete
release gates remain open.

## Unified Web/Mini chat and identity isolation (2026-10-13)

The subsequent authorized slice covers the Web Auth gaps above together with
their direct identity publishers. Web captures token/user/expiry, a local
generation and a non-secret storage revision. Same-token login and cross-tab
identity changes invalidate old work; delayed duplicate storage notifications
do not invalidate an already current request. Profile-only updates preserve its
authority. Identity ownership is separate from expiry so a current request's
401 can clear its own expired login and finish its visible failure state.

Server chat preload now carries the already validated owner id. Client initial
state is empty until ownership is checked; old ownerless caches are misses.
History/bootstrap/fallback, pagination, sending and retry retain their captured
identity through follow-up requests, functional state updaters, cache writes and
animation ticks. Existing session/turn authority remains responsible for chat
ordering; no global state framework or new retry policy is introduced.

Home/me/debug login, profile, logout and cancellation share the identity rule.
Page/panel cleanup and replacement attempts invalidate prior publication. A
cancel request must match the account displayed by its page before transport.
Cloud-completed local cleanup remains retryable without another cloud request;
only the cleanup's own partial removals can transfer its continuation, and a
later login invalidates it even if its storage revision could not be written.

Mini reuses its existing identity generation for Guest/None login starts,
profile refresh and cancellation. Upload 401 now checks its original identity.
The two deferred layout callbacks retain their original view guard, and Guest
bootstrap/recovery checks the calling page before starting generation while
preserving the shared capability for another page. A request's own 401 clear
can transfer authority only to the same operation's failure/finally handling;
it cannot authorize a successful result or another request, and later login
invalidates that transfer.

Acceptance and the final source-execution evidence are maintained in
`docs/evals/launch-candidate-20260927.md` and the artifact directory
`/Users/yuanyuanyuan/Documents/Codex/2026-10-13/task-2/manliao-web-auth-isolation/`.
These guards do not retract already dispatched server work or establish real
browser, WeChat, DB, model or full release acceptance.
