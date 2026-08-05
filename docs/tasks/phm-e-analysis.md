# PHM-E — Safety Supersession and Pure Resolved/Active Queries

## Problem

PHM-D only projects ordinary validated completion as an immutable committed
`fulfills` edge and exposes `handoffCompleted`. A Safety-owned response that
handles the User turn immediately following an open proactive greeting still
commits without an Interaction Move envelope. Consequently the event graph
cannot distinguish a handoff resolved by Safety from one with no resolving
edge, and the frozen `handoffSuperseded`, `handoffResolved`, and
`activeHandoff` queries are absent.

Frozen PHM-E outcome: when the Safety pre-gate owns the current User turn and
that turn has an active proactive-greeting handoff target, the winning committed
Assistant event writes exactly one target-bound `supersedes` edge. Expose strict,
pure superseded/resolved/active queries over the caller-supplied committed event
projection. Continue to prohibit persistent lifecycle status or aggregates.

## Evidence

- `docs/CONVERSATION_OS_INTERACTION_MOVE_HANDOFF_CONTRACT_V1.md` §§3, 4.2 and
  8 define lifecycle as immutable committed-event relations. Safety may write
  only `origin.kind=safety_override` plus `handoff.edge=supersedes`, targeting
  the open greeting handled by the override. `resolved = completed ||
  superseded`; active additionally requires a committed open edge, immediate
  precedence to the current User turn, and not resolved.
- The same contract §16 and `.project-team/DECISIONS.md` record PHM-D as
  deliberately limited to ordinary `fulfills` plus `handoffCompleted`; Safety
  supersession and resolved/active lookup were deferred as one later boundary.
- `conversation-os/interactionMoveEnvelope.ts` already contains the strict v1
  Safety envelope type and parser invariants, including exact origin/handoff
  keys, non-empty `safetyTraceId`, ordinary source-turn binding,
  `reason=safety_override`, and self-target rejection. It has no Safety builder
  and only implements `handoffCompleted`.
- `services/ai/chatOrchestrationService.ts` selects Safety before ordinary
  Context Assembly and Planner, returns `finalSource="safety"`, and produces a
  validated execution with request, turn, and Safety provenance. Therefore a
  PHM-B/C plan is neither available nor authoritative for the supersession
  target.
- `services/ai/chatReplyService.ts` passes `envelopeOrigin=null` for Safety;
  `commitValidatedAssistantMessage` consequently attaches no envelope inside
  the winning database transaction. `app/api/chat/guest/route.ts` independently
  assigns `interactionMoveEnvelope=null` for Safety. These are the first write
  boundaries where the already validated Safety result becomes a committed
  event.
- `conversation-os/control/interactionMoveHandoff.ts` already proves the
  non-Safety adjacency rule: only the immediately preceding committed Assistant
  message with a strict proactive `opens` envelope is an active target. The
  PHM-E query should reuse the same event facts, not infer a target from crisis
  text, `promptVersion`, or a response plan.
- `scripts/interaction-move-envelope-check.ts` is the focused strict-envelope
  and pure-query gate. `scripts/chat-execution-lifecycle-check.ts` is the
  database commit/retry/rollback gate and currently asserts that Safety stores
  no envelope; that assertion is the direct PHM-E regression boundary.

No documentation/implementation conflict was found. The implementation is an
explicitly deferred portion of the already frozen v1 contract.

## Root Cause

The primary cause is at the delivery projection boundary, not Safety detection
or Planner semantics. The Safety branch exits before Context Assembly, while
both final delivery paths special-case `finalSource="safety"` to suppress the
envelope. Although the parser can validate a Safety supersession envelope, no
constructor binds the validated Safety execution, current User turn, committed
Assistant id, and the adjacent open greeting target at commit time.

The missing resolved/active behavior is a second, local omission in the same
event-envelope module: PHM-D added only the `fulfills` predicate. Adding stored
flags would duplicate reconstructible event truth and violate the authoritative
architecture.

## Proposed Solution

Implement one minimal event-projection path:

1. In `interactionMoveEnvelope.ts`, add a strict
   `buildSafetyAssistantMoveEnvelope` constructor. Its inputs are the real
   committed Assistant id, the validated Safety execution/request trace id,
   exact current User turn id, the already-built committed move, and the active
   source greeting id. It emits only `origin.kind=safety_override` and
   `handoff={kind:proactive_greeting, edge:supersedes,
   sourceAssistantMoveId, reason:safety_override}` and passes the result through
   the existing strict parser. It must not accept or inspect a response plan or
   reply text.
2. In the same module add pure `handoffSuperseded`, `handoffResolved`, and
   `activeHandoff` queries. Every envelope candidate must pass the existing
   strict v1 parser. Exact source-id matching is mandatory. `activeHandoff`
   additionally evaluates the caller-supplied committed message/event order:
   the exact proactive `opens` source must immediately precede the identified
   current User event and no valid `fulfills` or `supersedes` edge may resolve
   it. Empty ids, malformed envelopes, mismatched message/envelope ids,
   blocked/uncommitted inputs, stale/non-adjacent sources, and self/mistargeted
   edges fail closed. The functions return booleans and perform no writes.
3. Export the builder and queries from `conversation-os/index.ts`.
4. At Auth and Guest delivery, derive the candidate source solely from the
   strict immediately preceding proactive `opens` event and confirm it through
   `activeHandoff` against the current User turn. If `finalSource="safety"` and
   a target is active, construct the Safety envelope only at the existing
   successful winner commit boundary. If there is no active target, preserve
   the existing no-envelope Safety behavior. Use the validated execution
   request identity as `safetyTraceId`; do not invent a Planner plan id.
5. Auth attaches the envelope inside the existing message transaction and
   generation execution trace exactly as PHM-D does. Guest returns the same
   logical envelope after validation for its client-scoped committed event.
   Retry losers, failed/rejected execution, and transaction rollback create no
   edge.

This is the unique minimal solution because the envelope/parser and atomic
delivery mechanisms already exist. Moving target selection into Safety text
detection, Planner, schema, Memory, or a session aggregate would cross an
architectural ownership boundary.

## Files To Change

Production and contract source (exclusive minimal set):

- `conversation-os/interactionMoveEnvelope.ts` — Safety constructor and strict
  pure superseded/resolved/active queries.
- `conversation-os/index.ts` — public exports only.
- `services/ai/chatReplyService.ts` — authenticated winner-only atomic Safety
  projection using committed history/current turn evidence.
- `app/api/chat/guest/route.ts` — equivalent Guest post-validation projection.

Verification source:

- `scripts/interaction-move-envelope-check.ts` — exact Safety shape, parser
  failures, query truth table, stale/ambiguous/adversarial event order, and
  mutation-free assertions.
- `scripts/chat-execution-lifecycle-check.ts` — replace the historical
  Safety-no-envelope expectation with active-target supersession; retain and
  extend no-target, retry-winner, failed commit, and rollback isolation.

Direct status documentation after gates pass:

- `docs/CONVERSATION_OS_INTERACTION_MOVE_HANDOFF_CONTRACT_V1.md`
- `docs/ARCHITECTURE_V1_FINAL.md`
- `docs/CONVERSATION_STATE_DESIGN.md`
- `services/ai/README.md`
- `PROJECT_TEAM.md`
- `.project-team/ACTIVE_SLICE.md`
- `.project-team/DECISIONS.md`
- `.project-team/EVIDENCE.md`
- `.project-team/REMAINING.md`

No other runtime, test, product, schema, migration, Memory, User Model, Batch 2,
Planner, Surface, or Validator file is authorized.

Acceptance gates, narrowest first:

1. `npm run check:interaction-move-envelope`
2. `npm run check:chat-execution-lifecycle`
3. `npm run check:interaction-move-handoff`
4. `npm run check:ai-orchestration`
5. TypeScript no-emit and focused ESLint for the four production and two test
   files
6. independent read-only adversarial review
7. `npm run check:launch`

The focused counterexample set must cover: Safety after an adjacent open
greeting; ordinary Safety with no open greeting; already fulfilled and already
superseded targets; stale/non-adjacent greeting; malformed/unknown-key envelopes;
wrong source/current-turn/message ids; response-plan origin carrying
`supersedes`; Safety origin carrying null/`fulfills`; retry loser; rejected or
failed execution; duplicate request winner; and transaction rollback.

Proof of no lifecycle persistence is required from both change inventory and
executable evidence: `git diff --name-only` contains no `prisma/schema.prisma`,
`prisma/migrations/**`, model/repository/session-state/Memory/User Model path;
repository diff contains no new lifecycle column/field/write such as
`handoffStatus`, `activeHandoff`, `handoffResolved`, or `superseded` outside the
pure query API/tests/docs; Prisma migration count remains unchanged; database
regression reconstructs all answers from committed message envelopes and shows
rollback leaves no edge. The full launch gate must still report the existing
migration set as current.

## Risks

- **Wrong Safety target:** because Safety bypasses Context Assembly, deriving a
  source from plan/control trace would be invalid. Only strict adjacent
  committed `opens` evidence may authorize the edge.
- **Untrusted Guest history:** Guest-provided envelopes and ids must be parsed
  and cross-bound; malformed, mismatched, blocked, or non-adjacent history must
  produce no supersession.
- **Validation mistaken for commit:** building before the Auth transaction or
  before Guest acceptance would create phantom resolution. The edge must remain
  winner-only at the final delivery boundary.
- **Resolving stale greetings:** `activeHandoff` must enforce immediate
  precedence and resolution checks; historical `opens` alone is insufficient.
- **Query/parser drift:** hand-written partial checks could accept invalid
  cross-field combinations. All queries must reuse the strict v1 parser.
- **Accidental lifecycle persistence:** naming a query result does not authorize
  storing it in interaction/session state, metadata aggregates, Memory, User
  Model, schema, or migrations.
- **Safety provenance ambiguity:** there is no separate stored `safetyTraceId`
  today. The validated execution request id is the existing immutable trace
  identity available to both delivery paths; introducing a new persistent
  Safety record is outside scope.
