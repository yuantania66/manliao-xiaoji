# Conversation OS Interaction Move Handoff Contract v1

Status: **frozen architecture contract; committed-envelope, PHM-A relation, PHM-B Planner and PHM-C Surface/same-plan semantic validation implemented; committed completion edges pending**

Freeze date: 2026-08-04

PHM-B freeze date: 2026-08-05

Authority: Conversation OS

## 1. Purpose

This contract defines how a committed proactive greeting is handed off to the
ordinary Conversation OS after the user's next turn. It closes the architectural
gap in which the system can detect greeting provenance but cannot prove that the
greeting interaction has been completed.

The contract freezes seven boundaries:

1. the committed Assistant move envelope;
2. the target-bound user relation projection;
3. proactive greeting required functions;
4. handoff completion criteria;
5. Response Planner transition rules;
6. Output Validator acceptance rules;
7. Guest and authenticated-path consistency.

This is an event-and-contract design. It does not add a persistent interaction
lifecycle state machine.

## 2. Frozen scope and prohibitions

The original contract-freeze slice was documentation-only and authorized no
runtime behavior, storage schema, migration or deployment. Subsequent,
separately authorized implementation slices have implemented the
committed-envelope foundation and the PHM-A Context/relation projection
described in section 13.

The following are explicitly prohibited by this contract:

- a persistent `greeting_pending`, `handoff_active`, `handoff_completed`,
  `handoff_expired` or equivalent lifecycle field, record or aggregate;
- Memory reads or writes for opening, restoring, completing or classifying a
  proactive greeting handoff;
- changes to Batch 2 Helping metadata, parsers, serializers, association,
  Reaction Assessment or downstream Batch 2 decisions;
- User Model input, output or state derived from greeting handoff events;
- keyword, phrase-list, regex or case-specific rules for determining the user's
  relation to an Assistant move or proving handoff completion;
- runtime, Prompt, Surface, Validator, API, client, persistence or schema changes
  under the completed docs-only freeze itself.

Safety remains the existing explicit override. This contract does not create a
second Safety policy.

## 3. Architectural model

The handoff lifecycle is represented by immutable relations between committed
conversation events:

```text
committed proactive greeting envelope (opens)
  -> current User event
  -> target-bound user relation projection
  -> one Planner-selected required function
  -> Surface realization
  -> same-plan semantic validation
  -> committed Assistant envelope (fulfills or safety supersedes)
```

`open` and `fulfilled` are query results over committed events. They are not
stored lifecycle states. Failed, rejected, unsent and retry-loser candidates do
not participate in the event graph.

## 4. Committed Assistant move envelope

### 4.1 Logical contract

```ts
type ProactiveGreetingCommittedMove =
  Omit<CommittedAssistantMove, "sourceTurnId"> & {
    // A proactive event has no triggering User turn; no synthetic id is allowed.
    sourceTurnId: null
  }

type ProactiveGreetingHandoffFunction =
  | "complete_reciprocal_contact"
  | "continue_from_user_answer"
  | "continue_user_introduced_content"
  | "answer_current_obligation"
  | "withdraw_or_repair_targeted_move"
  | "respect_user_boundary"

type CommittedAssistantMoveEnvelopeV1 = {
  schemaVersion: 1

  // Stable identity of the committed Assistant conversation event.
  assistantMoveId: string

  origin:
    | {
        kind: "proactive_greeting"
        generationId: string
      }
    | {
        kind: "response_plan"
        planId: string
        sourceUserTurnId: string
      }
    | {
        kind: "safety_override"
        safetyTraceId: string
        sourceUserTurnId: string
      }

  // Ordinary replies reuse the existing contract. Proactive greetings use the
  // logical null-source projection and do not change the Batch 2 schema.
  committedMove: CommittedAssistantMove | ProactiveGreetingCommittedMove

  handoff:
    | {
        kind: "proactive_greeting"
        edge: "opens"
        greetingFunction: ProactiveGreetingRequiredFunction
      }
    | {
        kind: "proactive_greeting"
        edge: "fulfills"
        sourceAssistantMoveId: string
        realizedFunction: ProactiveGreetingHandoffFunction
      }
    | {
        kind: "proactive_greeting"
        edge: "supersedes"
        sourceAssistantMoveId: string
        reason: "safety_override"
      }
    | null
}
```

This is a logical Conversation OS event envelope. This freeze does not select a
physical database layout.

### 4.2 Envelope invariants

- `assistantMoveId` equals the real committed Assistant message/event id.
- The existing `CommittedAssistantMove.sourceTurnId` cannot substitute for
  `assistantMoveId`; an ordinary reply uses the triggering User turn as its
  source, while a proactive greeting has no triggering User turn.
- A proactive greeting uses the logical `ProactiveGreetingCommittedMove` payload
  with `sourceTurnId=null`. It must not fabricate a User turn id. This logical
  projection does not change the current runtime or Batch 2 metadata schema.
- A proactive greeting has `origin.kind=proactive_greeting` and exactly one
  `handoff.edge=opens` function selected before generation.
- A planned handoff reply has `origin.kind=response_plan` and may write
  `fulfills` only for the target frozen in that same plan.
- A Safety response has `origin.kind=safety_override` and may write only the
  `supersedes` edge for the open greeting target handled by that override.
- Cross-field combinations are exhaustive: proactive origin requires the
  null-source proactive payload plus `opens`; response-plan origin requires the
  ordinary payload plus `fulfills` or `null`; Safety origin requires the
  ordinary payload plus `supersedes`. All other origin/payload/edge combinations
  are invalid.
- Envelope and Assistant message become visible at the same commit boundary.
- Once committed, the envelope and its relation edge are immutable.
- Model generation, validation success without commit, rejected candidates,
  retries that lose and failed sends create no committed envelope or completion
  edge.
- `promptVersion` remains generation provenance only. It is not a move identity,
  greeting function, Planner transition input or completion proof.

### 4.3 Batch 2 namespace isolation

The existing Batch 2 `CommittedAssistantMoveMetadata` exact-key contract is not
changed. The handoff relation is a sibling Conversation OS event-metadata
namespace, or part of a logical read projection composed outside that Batch 2
payload. It must not be inserted into the Batch 2 `helping` namespace or made a
Helping decision input.

## 5. Proactive greeting required function

```ts
type ProactiveGreetingRequiredFunction =
  | "initiate_reciprocal_contact"
  | "offer_self_contained_conversation_entry"
  | "ask_one_bounded_low_burden_question"
```

| Selected greeting move | Required function | `questionOrRequest` | Expected User contribution | Maximum burden |
|---|---|---|---|---|
| `simple_greeting` | `initiate_reciprocal_contact` | `null` | `none` | `none` |
| `open_statement` | `offer_self_contained_conversation_entry` | `null` | `none` | `none` |
| `light_question` | `ask_one_bounded_low_burden_question` | one question | `answer` | `low` |

The required function comes from the greeting move selected before Surface
generation. It must not be reconstructed from punctuation, final wording or a
text classifier.

A `light_question` opens an answer opportunity, not a requirement that the user
cooperate. Declining, redirecting, asking another question or requesting a pause
are all legitimate user relations that the ordinary Planner must handle.

## 6. User relation projection

### 6.1 Turn-scoped contract

```ts
type UserRelationEvidenceSpan = {
  source: "current_user_turn"
  sourceUserTurnId: string
  start: number
  end: number
  text: string
}

type UserMoveRelationProjection = {
  sourceUserTurnId: string
  targetAssistantMoveId: string
  targetFunction: string

  candidates: Array<{
    kind:
      | "reciprocates_move"
      | "answers_move"
      | "continues_from_move"
      | "opens_or_redirects_thread"
      | "challenges_move_fit"
      | "rejects_or_declines_move"
      | "sets_boundary_or_pause"
      | "unclear"
    confidence: number
    evidence: UserRelationEvidenceSpan[]
  }>

  ambiguous: boolean
}
```

This projection is reconstructed for the current turn and is not persisted as a
lifecycle record.

### 6.2 Projection rules

- `targetAssistantMoveId` must identify a real committed Assistant event.
- The normal greeting-handoff target is the immediately preceding committed
  Assistant event with `handoff.edge=opens`.
- Evidence describes the semantic relation between the current User event and
  that target. The Assistant wording may locate the target but cannot prove User
  intent.
- Evidence must retain current-User-event provenance and source spans. A free
  explanatory label or model self-report without a matching source span cannot
  establish a relation.
- Multiple relation candidates may survive when the turn is ambiguous. Turn
  Interpretation supplies evidence and ambiguity; it does not choose the reply.
- A direct question, new content, redirect, boundary or rejection is not reduced
  to a generic active-thread continuation merely because it follows a greeting.
- `challenges_move_fit` covers rejection of an interaction move as unnecessary,
  repetitive, pressuring or mismatched. It does not require rejection of a
  concrete factual proposition.
- The relation is determined contextually. Text form, message length, punctuation
  and phrase membership cannot independently establish it.

If an earlier handoff reply has already committed, the next User turn targets
that latest Assistant move. A challenge to that reply must not be redirected to
the original proactive greeting.

## 7. Planner handoff contract

### 7.1 Plan-time projection

```ts
type InteractionMoveHandoffPlan = {
  sourceAssistantMoveId: string
  sourceGreetingFunction: ProactiveGreetingRequiredFunction
  sourceUserTurnId: string
  selectedRelation: UserMoveRelationProjection["candidates"][number]["kind"]

  requiredFunction:
    | ProactiveGreetingHandoffFunction
    | "defer_handoff_completion"

  completionIntent: "fulfill" | "defer"
  questionPolicy: "none" | "optional_after_completion"
  evidence: UserRelationEvidenceSpan[]
}
```

This plan-time object is not a persistent lifecycle state. `completionIntent` is
a Planner instruction, not proof that completion occurred.

Planner evidence is a projection of the selected relation's existing current-turn
source spans. The Planner may reference those spans but cannot create new
relation evidence or run an independent text matcher.

`defer_handoff_completion` is not a realized handoff function and can never be
written on a `fulfills` edge. A Safety `supersedes` edge carries its explicit
reason and does not carry `realizedFunction`.

### 7.2 Transition priority

The Response Planner remains the sole non-safety decision owner and applies this
priority:

| Priority | Current evidence | Required function | Completion effect |
|---:|---|---|---|
| 1 | Safety override | existing Safety response | immutable `supersedes` edge |
| 2 | pause, stop or explicit boundary | `respect_user_boundary` | fulfill by respecting the boundary |
| 3 | challenge or rejection of the target Assistant move | `withdraw_or_repair_targeted_move` | fulfill by targeted interaction-move repair |
| 4 | current direct question or answer obligation | `answer_current_obligation` | answer first and fulfill the greeting handoff |
| 5 | User introduces or redirects to content | `continue_user_introduced_content` | enter the User-selected ordinary thread |
| 6 | User answers a `light_question` | `continue_from_user_answer` | receive the answer without re-interviewing |
| 7 | User reciprocates a non-question greeting | `complete_reciprocal_contact` | complete and release the greeting exchange |
| 8 | incompatible ambiguous candidates | `defer_handoff_completion` | no completion edge |

Additional rules:

- Planner consumes the committed envelope projection, not `promptVersion`.
- Current User content, questions and boundaries outrank completion of a greeting
  ritual and may fulfill the handoff in the same response.
- `complete_reciprocal_contact` completes the mutual contact once and releases
  the greeting exchange. It is not another greeting-only move, a receipt notice,
  an Assistant availability/presence statement or a request for the user to keep
  responding.
- A new topic or question is not required to complete reciprocal contact. If the
  Planner separately selects an ordinary continuation, that function must obey
  the existing burden and question policy.
- After the user answers a proactive `light_question`, the default question
  policy is `none`; another interview question cannot be used to prove handoff
  completion.
- When surviving relation candidates require incompatible functions, the Planner
  may choose only a function valid across the candidates. Otherwise it must
  preserve uncertainty and use `defer`, which cannot produce a `fulfills` edge.
- Once a handoff response commits, the next User turn is interpreted against that
  latest Assistant move under ordinary interaction rules.

## 8. Handoff completion criteria

```ts
handoffCompleted(sourceAssistantMoveId, committedEvents) =
  committedEvents.some(event =>
    event.handoff?.edge === "fulfills" &&
    event.handoff.sourceAssistantMoveId === sourceAssistantMoveId
  )

handoffSuperseded(sourceAssistantMoveId, committedEvents) =
  committedEvents.some(event =>
    event.handoff?.edge === "supersedes" &&
    event.handoff.sourceAssistantMoveId === sourceAssistantMoveId
  )

handoffResolved(sourceAssistantMoveId, committedEvents) =
  handoffCompleted(sourceAssistantMoveId, committedEvents) ||
  handoffSuperseded(sourceAssistantMoveId, committedEvents)

activeHandoff(sourceAssistantMoveId, currentUserTurnId, committedEvents) =
  hasCommittedOpenEdge(sourceAssistantMoveId, committedEvents) &&
  immediatelyPrecedes(sourceAssistantMoveId, currentUserTurnId, committedEvents) &&
  !handoffResolved(sourceAssistantMoveId, committedEvents)
```

A proactive greeting handoff is complete only when all of the following are
true:

1. the source id identifies the committed proactive greeting envelope;
2. the User relation and Planner target identify that same move;
3. the Planner selects a required function compatible with the relation;
4. Surface realizes that function without exceeding obligations, grounding,
   question, boundary or burden constraints;
5. Output Validation accepts the candidate against the unchanged plan;
6. the final Assistant message and envelope commit successfully;
7. the committed envelope writes `edge=fulfills`, the same source id and the
   validated realized function.

The following are not completion:

- text generation or a Surface-declared function id;
- an empty acknowledgement, bare echo, second greeting-only move, pure receipt
  or pure Assistant presence/availability confirmation;
- a generic open-door statement with no selected positive function;
- an unrelated topic or new question used to conceal an unfulfilled handoff;
- a rejected candidate, retry loser, failed send or failed atomic commit;
- an edge targeting a stale, uncommitted or different Assistant move;
- `completionIntent=defer`.

A deferred reply leaves the historical greeting unfulfilled, but after that
reply commits the greeting is no longer the immediately preceding Assistant
move and therefore is not an active handoff target for a later User turn. The
later turn targets the latest committed Assistant move under ordinary relation
rules; the system must not reopen the stale greeting.

Safety may supersede an open handoff through the explicit immutable Safety edge.
That resolves but does not complete the greeting handoff. The distinction is a
query over immutable events and does not create a greeting lifecycle state.

## 9. Output Validator acceptance contract

The Validator remains a same-plan semantic verifier. It may accept, reject and
request the existing bounded same-plan regeneration. It cannot reinterpret the
User, select another relation, choose another function, change the completion
target or author a fallback reply.

### 9.1 Required acceptance evidence

The candidate is accepted only when:

- the checked `planId`, source Assistant move, User turn, selected relation,
  required function and completion intent match the frozen plan;
- the candidate semantically realizes the selected positive function;
- the realization responds to the selected User relation and correct target;
- direct obligations and explicit User boundaries are satisfied first;
- a `light_question` answer is received without opening a second interview;
- User-introduced content is actually continued rather than ignored or replaced;
- challenge/rejection causes the targeted interaction move to be withdrawn or
  repaired rather than repeated, defended or explained again;
- pause/stop does not result in further conversation pressure;
- pre-greeting history is not restored unless the current User turn explicitly
  resumes it;
- no unsupported claim, evaluation, affect, intent or historical topic is added;
- question count and User burden stay inside the plan.

### 9.2 Required rejection boundaries

The Validator rejects a candidate that:

- merely avoids prohibited wording without fulfilling the positive function;
- performs only receipt, presence confirmation, echo, another greeting or a
  functionless generic opening;
- changes the target move or contradicts the selected relation;
- asks another interview question after an answer;
- repeats or rationalizes a challenged interaction move;
- resumes stale content without current-turn evidence;
- claims completion when the plan says `defer`.

The check must use semantic realization evidence independent of Surface
self-report. The implementation mechanism is deliberately not frozen here, but
it may not degrade into a keyword list, regex collection, fixed phrase whitelist
or trajectory-specific patch.

Validation success alone does not complete the handoff. Only the final committed
Assistant envelope may write the completion edge.

## 10. Guest and authenticated consistency

Both delivery paths are governed by the same logical envelope, relation,
planning and completion contracts.

### Authenticated path

- the Assistant message and envelope share one atomic commit boundary;
- subsequent Context/Dialogue projection receives the committed envelope;
- only the committed winner may create a `fulfills` edge.

### Guest path

- the server returns the same logical envelope with the accepted Assistant
  message;
- the client adds it to client-scoped committed history only after accepting the
  response;
- the next request returns the envelope unchanged with the corresponding
  conversation event;
- the server reconstructs the same relation and handoff projection as the
  authenticated path;
- no database lifecycle state is required.

Neither path may fall back to `promptVersion`, punctuation or reply wording as
the normal handoff signal. Historical messages without an envelope may use an
explicitly marked legacy compatibility projection, but they do not receive the
v1 completion guarantee.

## 11. Acceptance trajectories

| Greeting / prior move | Current User relation | Required result |
|---|---|---|
| `simple_greeting` | reciprocates greeting | complete reciprocal contact; no presence confirmation loop |
| `simple_greeting` | introduces a topic | User content wins and fulfills the handoff |
| `open_statement` | minimal or ambiguous response | preserve uncertainty; do not invent meaning or falsely mark completion |
| `light_question` | answers | receive supported answer content; no second interview question |
| `light_question` | redirects or asks a direct question | follow redirect or answer the current obligation |
| any greeting | challenges or rejects the greeting | targeted interaction-move repair |
| any greeting | requests pause or stop | respect the boundary and stop advancing |
| any greeting | answers and introduces content | retain both relations in evidence; produce one compatible plan |
| failed handoff reply | challenges the reply | target the latest Assistant reply, not the original greeting |
| multiple generation candidates | any | only the committed winner can fulfill |
| stale historical greeting | later unrelated turns exist | never reopen it as the active handoff target |
| Guest round-trip | next User turn | same envelope projection and completion result as authenticated |

## 12. Freeze acceptance gates

The v1 architecture contract is satisfied only when a separately authorized
implementation proves all of these gates:

1. stable committed Assistant move identity and immutable event edges;
2. no persistent interaction lifecycle state;
3. no Planner dependence on `promptVersion` in the v1 path;
4. complete proactive greeting function mapping;
5. target-bound, contextual User relation projection;
6. interaction-move rejection independent of proposition rejection;
7. exactly one non-safety Planner decision owner;
8. completion only at validated commit;
9. positive-function semantic validation without case rules;
10. Guest/authenticated envelope and projection parity;
11. zero Memory, Batch 2 or User Model integration;
12. no schema claim from the docs-only freeze or the envelope-foundation slice.

## 13. Authority and implementation status

This document is the authoritative Conversation OS contract for proactive
greeting handoff completion. It complements `ARCHITECTURE_V1_FINAL.md` and
clarifies that `CONVERSATION_STATE_DESIGN.md` conversation phases are not
interaction-move lifecycle states.

The committed-envelope foundation now implements:

- stable `assistantMoveId` identity equal to the committed Assistant event id;
- strict v1 envelope parsing and the `interactionMoveEnvelope` sibling metadata
  namespace;
- proactive greeting `opens` envelopes derived from the move selected before
  generation;
- ordinary validated response-plan envelopes with `handoff=null`;
- atomic authenticated message/envelope commit through the existing generation
  trace, with no schema migration;
- Guest return, cache and next-request round-trip of the same logical envelope;
- zero envelope for rejected candidates, generation failure, retry losers and
  rolled-back persistence attempts.

PHM-A now additionally implements:

- retention of a strictly validated committed Assistant envelope in Conversation
  OS Context;
- an active target only when the immediately preceding Assistant event is the
  same committed move and its proactive greeting envelope has `handoff.edge`
  equal to `opens`;
- a current-turn, target-bound User relation projection containing the frozen
  eight candidate kinds, confidence and exact source spans from the current User
  text;
- preservation of compatible multiple candidates and ambiguity without Turn
  Interpretation selecting a reply function;
- fail-closed handling for malformed, stale, uncommitted or mismatched targets,
  provenance-only `promptVersion`, and a greeting displaced by a newer Assistant
  reply;
- the same logical projection for equivalent Guest and authenticated inputs,
  without persistent lifecycle state, Memory, Batch 2 or User Model integration.

The current runtime implements the PHM-B Planner transition, detached preflight
authority and PHM-C Surface/same-plan semantic validation, but has not
implemented `fulfills`, Safety `supersedes` or completion lookup. Safety
responses intentionally emit no handoff envelope because a valid `supersedes`
edge requires the target selected by the later migration; they are not
mislabeled as `response_plan`. For a valid PHM-A projection, the Planner maps
the target-bound relation to one nullable v1 handoff plan without reading
`promptVersion` or matching reply text. A separately marked no-envelope legacy
compatibility path remains temporarily active. Production behavior therefore
does not yet claim full v1 conformance.

## 14. PHM-B Planner transition contract freeze

### 14.1 Slice status and boundary

PHM-B freezes the Planner-owned transition from the PHM-A projection to one
`InteractionMoveHandoffPlan`. This section refines section 7 into an executable
planning contract. A later, separately authorized runtime slice implemented
this transition without changing the original docs-only freeze boundary.

The PHM-B runtime implementation changes only the plan-time boundary, detached
plan preflight authority and dedicated verification needed to prove this
contract. Prompt and Surface projection, positive-function Output Validation, committed
`fulfills`, Safety `supersedes`, completion lookup, API/client changes,
persistence, schema migration, Memory, User Model and Batch 2 remain separate,
unauthorized slices.

The Planner slice alone does not claim that generated production wording or
committed handoff completion behavior has changed.

### 14.2 Activation and fail-closed input

The v1 Planner branch is active only when all of these values agree:

1. Context contains the strictly adjacent committed proactive `opens` target;
2. Turn Interpretation contains a non-empty `userMoveRelation`;
3. the relation source User turn equals the current plan source User turn;
4. the relation target Assistant id equals the active target Assistant id;
5. the relation target function equals the active target greeting function;
6. every evidence span of every surviving relation candidate is an exact span
   of the current User turn.

If any condition fails, the Planner produces no v1 handoff plan. It must not
repair identity, target, function or evidence from message text,
`promptVersion`, punctuation or a second classifier. A separately marked legacy
no-envelope compatibility path may remain temporarily, but it is not v1 and
cannot create v1 completion intent or completion edges.

### 14.3 Total transition mapping

Existing Safety routing remains above the ordinary Planner. Within the ordinary
Planner, an already established current direct-answer obligation and an
explicit boundary remain higher priority than greeting ritual. The Planner
projects the following complete tuple without reinterpreting the User text:

| Frozen input | Required function | Completion intent | Handoff question policy | Ordinary-plan composition |
|---|---|---|---|---|
| explicit pause, stop or boundary | `respect_user_boundary` | `fulfill` | `none` | require the existing boundary-respecting action; no continuation action |
| `challenges_move_fit` or `rejects_or_declines_move` | `withdraw_or_repair_targeted_move` | `fulfill` | `none` | require targeted interaction-move repair; do not defend or repeat the greeting |
| current direct question or answer obligation | `answer_current_obligation` | `fulfill` | `none` | require the existing direct-answer action before any optional continuation |
| `opens_or_redirects_thread` | `continue_user_introduced_content` | `fulfill` | `optional_after_completion` | preserve the User-selected content action; do not add a greeting-only action |
| `answers_move` with `ask_one_bounded_low_burden_question` | `continue_from_user_answer` | `fulfill` | `none` | receive and continue from the answer; no second interview question |
| `continues_from_move` with `ask_one_bounded_low_burden_question` | `continue_from_user_answer` | `fulfill` | `none` | continue only from answer content supported by the current turn |
| `continues_from_move` with either non-question greeting function | `continue_user_introduced_content` | `fulfill` | `optional_after_completion` | continue only current-turn content supported by the relation evidence |
| `reciprocates_move` with either non-question greeting function | `complete_reciprocal_contact` | `fulfill` | `optional_after_completion` | the handoff function may stand alone; an ordinary continuation is optional and requires independent current-turn support |
| `unclear`, or a relation/source-function pair not listed above | `defer_handoff_completion` | `defer` | `none` | preserve ordinary low-burden handling; no action may claim completion |

`reciprocates_move` after a question greeting and `answers_move` after a
non-question greeting are unsupported pairs and therefore defer. This is a
typed fail-closed boundary, not a wording rule.

`questionPolicy=optional_after_completion` means that a question is permitted
only after the selected positive function has been realized and only when an
existing ordinary-plan action independently supports it. It never requires a
question and cannot be used to manufacture conversation content.

### 14.4 Multiple-candidate compatibility

PHM-A remains the authority for the full ordered candidate set and ambiguity.
The Planner does not discard or rewrite that projection.

- An established direct-answer obligation or explicit boundary applies its
  higher-priority tuple without erasing the underlying relation candidates. For
  a direct-answer override, `selectedRelation` records the highest-confidence
  surviving candidate bound to the current User turn; that relation label is
  trace focus only, while the existing scoped answer obligation and its evidence
  remain the authority for `answer_current_obligation`. For a boundary override,
  the highest-confidence `sets_boundary_or_pause` candidate is selected; absence
  of that candidate is an input inconsistency and fails closed.
- `challenges_move_fit` and `rejects_or_declines_move` are compatible with each
  other and collapse to `withdraw_or_repair_targeted_move`.
- For a question greeting, `answers_move` and `continues_from_move` are
  compatible and collapse to `continue_from_user_answer`.
- If `opens_or_redirects_thread` survives with `answers_move`,
  `continues_from_move` or `reciprocates_move`, current User content wins and the
  shared function is `continue_user_introduced_content`.
- Other multi-candidate combinations, and any ambiguous set containing
  `unclear`, are incompatible and must defer.

Except for the explicit priority-override rule above, a compatible set records
the highest-confidence candidate that directly supports the selected function
as `selectedRelation`. For an incompatible set, `selectedRelation` records the
highest-confidence surviving candidate for traceability only;
`requiredFunction=defer_handoff_completion` and
`completionIntent=defer` explicitly prevent that trace focus from becoming an
intent claim. Ties retain PHM-A candidate order. Planner evidence remains the
unchanged source spans of the recorded candidate; scoped answer-obligation
evidence stays in the existing `ResponsePlan.answerObligations` contract and is
not copied into or invented as relation evidence.

### 14.5 Positive reciprocal-contact postcondition

`complete_reciprocal_contact` positively means that the plan accepts the User's
reciprocal greeting as sufficient mutual contact, requires no additional proof
of presence or engagement, and releases the greeting ritual after this reply.
It does not require the User to introduce a topic, answer a question or continue
the conversation.

The plan may add an independently grounded ordinary continuation after that
postcondition, but lack of a new topic is not a planning failure. A second
greeting-only move, receipt, echo, Assistant availability statement or generic
open door does not realize this positive function. PHM-B freezes this semantic
postcondition but leaves its Surface realization and same-plan positive
validation to separately authorized slices; it freezes no sample wording,
keyword list or case rule.

### 14.6 PHM-B implementation acceptance

The implemented PHM-B runtime slice proves:

1. the sole Response Planner owns the transition and produces one nullable
   handoff plan inside the existing `ResponsePlan`;
2. equivalent Guest and authenticated PHM-A inputs produce the same logical
   plan tuple;
3. the v1 branch never uses `promptVersion` or text matching to select target,
   relation, function, completion intent or question policy;
4. target, source-turn, greeting-function and exact-span mismatches fail closed;
5. every single and multiple-candidate mapping in sections 14.3-14.4 is covered;
6. reciprocal greeting plans select `complete_reciprocal_contact` and never
   select a presence-confirmation or second-greeting action;
7. direct obligations, User content, repair and boundaries retain their frozen
   priority over greeting ritual;
8. `defer` never produces a completion claim or edge;
9. no persistent lifecycle state, Memory, User Model, Batch 2 or schema change
   is introduced;
10. Prompt/Surface realization, semantic Validator proof and committed event
    edges are not falsely claimed by the Planner-only slice.

### 14.7 Detached preflight authority

Before `ResponsePlan` assembly, production creates one normalized authority
snapshot from Context, Turn Interpretation and Dialogue State. The snapshot is
deep-cloned and recursively frozen, so the plan and its inputs share no mutable
object or array with the preflight authority.

Execution preflight compares the nullable handoff plan, complete answer
obligations and projected canonical provenance exactly against that snapshot.
Missing authority for a non-null handoff, extra or conflicting canonical
provenance, and coordinated plan/provenance mutation fail closed. The Planner
and the authority snapshot share the same pure handoff projector and canonical
provenance builder; preflight does not create a second decision owner or derive
authority from the plan it is validating.

This snapshot is turn-local execution data. It is not persisted lifecycle
state, Memory, User Model input or Batch 2 metadata.

## 15. PHM-C Surface and same-plan semantic validation implementation

PHM-C projects the complete preflight-valid handoff tuple and its current-turn
relation evidence into Surface. V1 history is bounded by the committed
`sourceAssistantMoveId`, except when the existing explicit-resumption boundary
admits older history; `promptVersion` is not the v1 target authority.

Before first generation, execution deep-clones and recursively freezes one
ResponsePlan snapshot. Surface, the optional same-plan regeneration and both
deterministic and semantic validation read that same snapshot. The semantic
provider is a structured non-writer, binds its verdict to the exact plan tuple,
uses exact candidate evidence spans and fails closed for provider, parse,
binding, evidence or uncertainty failures. Its external prompt passes the
existing inspection boundary. No keyword list, regex completion rule, Surface
self-report or fixed reply whitelist proves the positive function.

PHM-C accepts or rejects candidates only. It creates no `fulfills` or
`supersedes` edge, and validation success is not committed completion.
