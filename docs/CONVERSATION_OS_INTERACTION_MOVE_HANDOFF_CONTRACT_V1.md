# Conversation OS Interaction Move Handoff Contract v1

Status: **frozen architecture contract; committed-envelope foundation implemented; Planner handoff pending**

Freeze date: 2026-08-04

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
runtime behavior, storage schema, migration or deployment. A subsequent,
separately authorized implementation slice has now implemented only the
committed-envelope foundation described in section 13.

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

The current runtime has not implemented target-bound User relation projection,
Planner handoff transition, `fulfills`, Safety `supersedes`, positive-function
validation or completion lookup. Safety responses intentionally emit no
handoff envelope in this foundation slice because a valid `supersedes` edge
requires the target selected by the later migration; they are not mislabeled as
`response_plan`. The existing Planner `promptVersion` compatibility path remains
temporarily active and is not used to create, identify or validate the new
envelope. Production behavior therefore does not yet claim full v1 conformance.
