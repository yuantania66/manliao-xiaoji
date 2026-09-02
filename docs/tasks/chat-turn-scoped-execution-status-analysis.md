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
