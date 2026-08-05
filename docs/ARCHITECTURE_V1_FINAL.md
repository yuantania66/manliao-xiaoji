# Architecture v1 Final

## 1. Final decision

This document is the current Architecture v1 baseline for SlowTalk Notes. The
2026-07-23 Conversation OS control-closure decision supersedes the former
runtime rule that made Clinical Logic the default owner of every ordinary
reply. The 2026-07-31 approved Hill contract keeps that control closure while
assigning Hill applicability, reaction, readiness, goal, intention and skill to
Clinical Logic / Helping Logic before final plan assembly. It does not add a
sixth product layer.

Architecture v1 has exactly five product layers:

1. Application Layer
2. Conversation Layer
3. Clinical Logic Layer
4. Memory & Mental Model Layer
5. Safety & Governance Layer

The ordinary non-safety final plan writer remains singular:

```text
decisionOwner = conversation_os.response_planner
```

This means one final `ResponsePlan`, not ownership of every domain decision.
Helping Logic owns the Hill domain; Response Planner owns ordinary conversation
actions and final assembly. Neither may replace the other.

`ResponsePlan`, `DialogueState`, `ClinicalContext`, `ClinicalStrategyAdvice`,
Prompt, validator and trace are runtime contracts, not product layers.

Migration status after the Batch 1.5-E frozen gate closed on 2026-08-04:

- the target architecture in this document is approved;
- current runtime retains the pre-Hill optional Rogers advice path as the only
  user-visible compatibility behavior;
- typed Hill input, decision validation and a feature-flagged Shadow call run
  after Safety and before the final Planner when `HILL_HELPING_SHADOW=true`;
- the Shadow result is trace-only and is absent from `ResponsePlan`, Surface input
  and committed conversation state;
- the Batch 1.5 candidate may pass only a deterministic `uncertain` applicability
  boundary into the ordinary Planner when `HILL_HELPING_ORDINARY_HANDOFF=true`;
  the Planner then selects an ordinary action and keeps
  `behaviorSource=ordinary_conversation`;
- the Batch 1.5 flag remains off by default and does not enable the full Hill
  provider, a Hill goal/skill, or committed Helping state;
- the earlier human blind candidate and preservation candidates 1—6 remain
  historical failed evidence; the later Planner, Surface-boundary and Validator
  repairs passed the Batch 1.5-E frozen gate at 60/60 Functional and Machine
  Validator pass, 0 constraint failures and 5/60 regeneration;
- Batch 1.5-E is the authoritative stable user-visible baseline and its repair
  scope is closed;
- Batch 2 is approved only as an infrastructure slice for cross-turn association,
  serialization/loading, Shadow reaction trace and atomic commit boundaries;
  Batch 2A has frozen the v1 formal Helping metadata schema, strict parser and
  formal/Shadow isolation; Batch 2B has passed fixture-only bounded loading,
  explicit older-target inclusion and target-bound semantic association without
  production integration; Batch 2C is now the authoritative Reaction Assessment
  Contract Gate under `B2-Reaction-Shadow`, frozen as reaction-only, Shadow-only
  and fixture-only with zero downstream integration. Batch 2C-A now implements
  the isolated fixture evaluator and regression gate; production runtime,
  formal reaction state, formal production writes, DB-backed loading and Atomic
  Boundary remain unimplemented. User-visible Hill behavior remains reserved
  for a separately accepted Batch 3;
- Conversation OS Interaction Move Handoff Contract v1 is frozen as the target
  contract, and its committed-envelope foundation, PHM-A Context/relation
  projection and PHM-B Planner transition are implemented. PHM-B includes
  fail-closed activation, multiple-candidate compatibility, positive
  reciprocal-contact planning and detached exact-preflight authority. It defines
  proactive greeting completion through immutable
  committed-event relations, a target-bound User relation, one Planner-selected
  positive function and validated atomic commit. The stable envelope and
  Guest/authenticated round-trip foundation, strict adjacent active target and
  current-turn User relation projection, Planner handoff tuple, detached
  preflight authority, PHM-C Surface projection and same-plan semantic
  validation are implemented; completion edges remain pending.

## 2. Runtime control loop

Normal chat uses this one traceable loop:

```text
Context Assembly
  -> Turn Interpretation
  -> Dialogue State
  -> Helping Logic / HillHelpingDecision
  -> Response Planner
  -> one ResponsePlan
  -> Surface Realization
  -> Output Validation
  -> State Update
```

Safety is a higher-priority cross-cutting gate. When it blocks normal chat it
must expose an explicit override reason and skip the ordinary planner/surface
path.

### 2.1 Context Assembly

Context Assembly may provide only the context required for the current turn:

- current user message;
- bounded adjacent turns;
- semantic evidence and the immediately active answer frame;
- interaction evidence;
- current repair signal and, when present, the targeted assistant turn,
  challenged proposition and still-open user intent;
- bounded committed Helping move candidates from the current session, including
  an explicitly targeted older move when the user replies to it;
- selected user-confirmed memory, if relevant;
- Assistant Grounding;
- confirmed facts and explicitly separated hypotheses;
- safety signal.

It must not dump complete history, databases, unrelated memory or raw internal
trace into the model Prompt.

Prompt History contains a bounded recent window of committed conversation
events. It never removes committed text because of wording, Prompt version,
low-information form, or template heuristics. BLOCKED and non-conversation
events remain internal, while explicit reply linkage preserves answered-turn
structure through window cropping.

### 2.2 Turn Interpretation

Turn Interpretation is an evidence-producing step, not a reply planner. It can
combine `contentMeaning`, multiple `responseRelation` candidates with separate
confidence values, and a proposed `stateUpdate`. Direct questions, engagement,
initiative, affect evidence, stop evidence, repair evidence and Grounding
references remain evidence inputs. The legacy `primaryDialogueAct` and
`secondarySignals` fields remain trace-compatible evidence only; neither
Dialogue State nor Response Planner may use them to select strategy.

A meta-conversational correction may quote question-shaped text. Once Context
Assembly targets that text as a challenged proposition, it is not reopened as
a new direct question or Grounding obligation.

Stable product/capability boundaries may use deterministic classification.
Ambiguous pragmatics may use the configured LLM through a structured adapter.
The adapter may not write a reply, create a ResponsePlan, or override a
deterministically established direct question or stop request.

Conversation State is the sole extractor for current-turn affect and
relational-impact evidence. It retains source offsets and original text plus a
normalized category, intensity and object. Turn Interpretation consumes those
same spans, and Response Planner may only add the current turn id when it
projects them into `positiveFunctionContract`; it must not run an independent
phrase matcher. Execution preflight verifies the projected turn and source
slice before Surface is called.

### 2.3 Interaction / Dialogue State

The state reducer carries:

- `currentActivity`, including concurrent relational activities;
- `activeThread`;
- `commonGround.confirmed / hypothesized / rejected`, with subject, speaker,
  source turn, evidence and epistemic status on every proposition;
- turn-scoped `openObligations`;
- `initiativeOwner`;
- `lastCommittedAssistantMove` (purpose, claims, assumptions,
  question/request, expected user contribution, burden, source turn);
- bounded `CommittedHelpingMove` candidates once the Hill path is active;
- structured `repairState`.

This state is derived from committed conversation events and committed Assistant
move metadata. It is reconstructible and cannot replace the bounded recent raw
conversation window supplied to planning and Surface Realization.

Interaction Move Handoff v1 uses the same reconstructible event boundary but is
not a new field in Interaction State. A committed Assistant envelope supplies a
stable Assistant move id and an immutable `opens`, `fulfills` or Safety
`supersedes` relation. Whether a greeting is active, fulfilled or superseded is
derived by querying those committed events; no persistent lifecycle status,
session aggregate, Memory record or User Model field may mirror that result.

An explicit user question becomes a must-answer obligation. Empathy,
clarification and Clinical advice cannot remove it.

Each obligation is scoped by its source `conversationId + turnId`, records the
triggering act and target proposition, and transitions from `open` to
`answered` or `expired` in State Update. It is not implicitly reused by a later
turn. A correction additionally carries its target turn and rejected
proposition. Rejected propositions are withdrawn from confirmed/hypothesized
common ground and may not be explained again.

The state reducer may consume legacy classifiers only as evidence. A single
intent, content-availability label, or affect label cannot itself become a
ResponseAction. Multiple response relations can survive into concurrent
activities.

### 2.4 Helping Logic

Every ordinary non-safety turn produces exactly one traceable
`HillHelpingDecision` before final plan assembly. A successful decision may be
`not_applicable`; that routes to ordinary conversation without forcing helping
language.

Helping Logic owns:

- applicability;
- reaction to a relevant committed Helping move;
- readiness and counter-evidence;
- exploration, insight or action goal;
- intention and skill;
- relationship-repair priority;
- prohibited moves and Helper Self Check.

It cannot erase direct obligations, write final Chinese, read Raw Memory,
override Safety, or assemble a second ResponsePlan.

During Batch 1-2 Hill Shadow operation, the Hill result is trace-only. The
Batch 1.5 candidate is the narrow exception for an `uncertain` applicability
boundary: under its separate default-off flag, the boundary may inform an
ordinary Planner action, but no Hill goal or skill crosses the boundary and the
behavior source remains ordinary conversation. A full Shadow result cannot
affect the `ResponsePlan` or create committed Helping state.

Batch 2C freezes only the contract for a fixture-produced Reaction Assessment
Shadow trace. `reactionEvidenceKnown` describes whether the current user turn
contains enough target-bound evidence to classify a reaction; `impactKnown`
additionally requires explicit user evidence about the move's fit, experience or
result. Neither value proves objective causality or technique success. No Batch
2C assessment may enter `HillHelpingPlan`, Response Planner, Initiative, Memory,
User Model, `ChatMessage.interactionMetadata` or formal persistence.

Batch 2C-A implements that contract only in
`services/helping/reactionAssessmentFixture.ts`. The module is not exported from
the production Helping barrel and is consumed only by frozen fixtures. Its gate
strictly parses candidate/evidence objects, binds them to one Batch 2B-loaded
`formal_v1` target and the current user turn, validates evidence provenance,
derives both known flags, and emits fail-closed Shadow envelopes. It has no
production writer, persistence or user-visible execution path.

### 2.5 Response Planner

Response Planner is the only writer of the final ordinary `ResponsePlan`. It
owns ordinary conversation actions and assembles, without rewriting, a valid
Hill decision when Helping is the active behavior source. It creates exactly
one `ResponsePlan` containing:

- answer obligations;
- disclosure scope and structured correction evidence;
- concrete response actions;
- Assistant Grounding facts;
- exactly one behavior source;
- a Hill plan projection when `behaviorSource=hill_helping`;
- legacy Clinical advice only on an explicitly selected compatibility path;
- question and closure policies;
- tone, stance and length guidance;
- prohibited claims and safety constraints;
- relevance provenance for every planned action, obligation, disclosure and
  Grounding fact;
- plan evidence.

The Planner reads Interaction State and scoped obligations for ordinary action
selection. It does not read `primaryDialogueAct`, `secondarySignals`,
`activeInteractionNeeds`, `stillOpenUserIntent`, or scenario classifier labels
as strategy decisions. It may accept or reject a Hill contract but cannot
invent, replace or silently omit its goal, intention or skill.

For a proactive greeting handoff, the Planner additionally consumes the
turn-scoped envelope and target-bound User relation projection frozen in
`CONVERSATION_OS_INTERACTION_MOVE_HANDOFF_CONTRACT_V1.md`. It alone selects the
required handoff function, completion intent and question policy. Greeting
provenance such as `promptVersion` cannot replace the committed move target or
prove completion.

The PHM-B implementation makes this boundary total and fail closed. A v1 handoff plan is
created only when the active committed target, current User turn, target
function and exact PHM-A evidence spans agree. It maps the frozen relation set
to one required function or `defer`, preserves higher-priority direct
obligations and boundaries, and resolves multiple candidates only through the
compatibility rules in the authoritative handoff contract. It performs no text
matching and does not reconstruct decisions from `promptVersion`. Before plan
assembly, production creates a detached, recursively frozen authority snapshot;
execution preflight exactly compares the nullable handoff tuple, obligations and
canonical provenance against it.

No module after this point may reinterpret the user, choose a new response
goal, or select another strategy.

### 2.6 Surface Realization

Surface Realization receives the finalized ResponsePlan and bounded chat
history. It only writes natural language for that plan. Production surface
generation must not run legacy Engage, Voice or Clinical ResponseGoal planning.
It receives no complete Assistant Grounding `availableFacts` block. Relevant
truth is projected through the current turn's `requiredDisclosure`, while
`prohibitedClaims` remains a constraint. The Surface projection contains only
minimal actions, scoped obligations/disclosure, relevant Grounding/Clinical
facts, question/closure policy, concise tone/length guidance, truth/safety
constraints and relevance provenance. Classifier traces, plan debug evidence,
action-specific sample wording and repair templates are not Surface inputs.
The relevance projection exposes the planned element, its source and turn, plus
only the current user-message evidence needed to realize that element. Full
classifier/state evidence remains in the internal trace. Action-level surface
constraints may rule out unsupported evaluation, generic causal explanation,
positive reframing or an interview follow-up; they constrain meaning and do
not prescribe sample wording.

### 2.7 Output Validation

Output Validation is a constraint provider. It may:

- accept the realization;
- reject an unanswered direct obligation;
- reject a grounding, closure, question or semantic-evidence violation;
- request at most one regeneration against the exact same `planId`, with the
  internal failure code translated into a human-readable correction instruction
  that cannot alter the plan;
- return a non-chat `constraint_failure` system status after a second failure.

It may not create a ResponsePlan, select a ResponseGoal, choose a Clinical
strategy, or author an ordinary fallback/comfort reply.

For Interaction Move Handoff v1, validation must positively verify that the
candidate realizes the Planner-selected function against the same target and
User relation. Avoiding a list of disallowed phrases, or Surface self-reporting
a function id, is not completion evidence. Validation failure may only trigger
the existing bounded same-plan regeneration; only the final committed Assistant
event may write a `fulfills` edge.

### 2.8 State Update

State Update records fulfilled obligations and remaining open loops. Only a
successfully sent `hill_helping` reply may atomically add its
`CommittedHelpingMove`; Shadow, legacy, rejected, failed or unsent replies may
not. State Update does not re-plan the current reply.

## 3. Five-layer responsibilities

### 3.1 Application Layer

Owns UI, API, session, persistence, settings, privacy, export/delete and debug
display. It does not decide ordinary reply actions or Clinical strategy.

### 3.2 Conversation Layer

Owns the ordinary control loop and its single Response Planner. It assembles
the current context, interprets the turn, maintains dialogue state, invokes
Helping Logic before final planning, finalizes one ResponsePlan and records
state update.

It does not diagnose, write long-term Memory, or implement a Clinical method.

### 3.3 Clinical Logic Layer

For SlowTalk chat, Clinical Logic exposes the Helping Logic capability defined
by the approved Hill v1 product contract. Every ordinary non-safety turn reaches
its applicability boundary; applicable turns receive an evidence-bound Hill
plan before final ResponsePlan assembly.

Clinical Logic owns Hill applicability, reaction assessment, readiness, goal,
intention and skill. It does not own ordinary facts or direct obligations,
cannot write final chat text, and cannot override Safety. The legacy Rogers
advice, `ClinicalPlan`, `ResponseGoalSelector` and Need Resolution draft are
compatibility/evaluation contracts only and must not become a second decision
owner.

### 3.4 Memory & Mental Model Layer

Memory owns long-term evidence, semantic memory, timeline, relationship and
understanding continuity. It may provide a bounded selected fact or hypothesis
to Context Assembly. It does not own current-turn response actions and cannot
bypass the Response Planner to enter the surface Prompt.

### 3.5 Safety & Governance Layer

Safety owns crisis/high-risk blocking, privacy, access control, audit, deletion
and data-governance boundaries. It may override the ordinary loop, but its
trace must identify the reason. Safety must not transform an ordinary reply
into a generic comfort template.

## 4. Evidence and interaction contracts

### 4.1 Semantic evidence

`semanticEvidence` answers only whether current content may be interpreted.
It considers the current message and an explicit compatible answer frame in
the active adjacent context.

- A short or atomic message is not meaningful merely because it has a format.
- A compatible answer to an immediately preceding age, count, scale, choice,
  yes/no or other supported frame is grounded in that frame.
- Typed numeric frames take precedence over a generic yes/no shape in the same
  sentence (for example `How old are you?` -> `34`).
- An assistant hypothesis is not confirmed user evidence.

### 4.2 Interaction evidence

Content availability, engagement, initiative, affect and stop evidence are
independent:

- low information is not low engagement;
- `no_topic` is not stop intent;
- unknown affect is not negative affect;
- replying to the assistant is evidence of continued interaction;
- silence/pause/closure requires explicit current evidence or a reliable active
  pause context;
- `no_topic + engaged/open + no stop` transfers light initiative to the
  assistant rather than selecting silent companionship.

### 4.3 Approved deterministic boundaries

Deterministic rules are limited to stable, reviewable evidence such as explicit
stop/reopen language, explicit capability/identity questions, active answer
frame compatibility and the approved interaction fields. Complex pragmatics
must remain contextual and may use the structured interpretation adapter.

### 4.4 Interaction Move Handoff v1

`docs/CONVERSATION_OS_INTERACTION_MOVE_HANDOFF_CONTRACT_V1.md` is the
authoritative proactive greeting completion contract. It freezes:

- a logical committed Assistant move envelope with a stable Assistant event id;
- an immutable greeting `opens` edge and validated-commit `fulfills` edge;
- a current-turn User relation projection bound to that Assistant move;
- preselected required functions for `simple_greeting`, `open_statement` and
  `light_question`;
- completion only when the selected positive function passes same-plan semantic
  validation and the final Assistant event commits;
- Planner transition priority and Validator non-planning boundaries;
- one logical envelope and projection contract for Guest and authenticated chat.

Interaction-move rejection is not limited to rejection of a factual
proposition. Turn Interpretation may identify a contextual challenge to the fit
of the immediately preceding Assistant move, while the Response Planner alone
decides whether targeted interaction-move withdrawal is required.

The envelope and handoff edges are Conversation OS event metadata, isolated from
the Batch 2 Helping/Reaction namespace. The implemented foundation serializes
the logical envelope as a sibling key in the existing authenticated generation
trace and as client-scoped Guest event metadata. PHM-A retains a strictly
validated adjacent `opens` target in Context and derives the target-bound
current-turn User relation candidates with exact source spans, preserving
ambiguity without selecting a reply function. These slices add no persistent
lifecycle state, schema migration, Memory or User Model input. Planner handoff,
its detached exact-preflight authority, PHM-C same-plan semantic validation and
PHM-D ordinary committed `fulfills` plus pure completion lookup are implemented;
Safety `supersedes` and resolved/active lookup remain pending.

PHM-B implements the Planner transition from that projection. The total mapping
includes direct-obligation and boundary priority,
typed fail-closed source/relation pairs, compatible multiple-candidate collapse,
incompatible-candidate defer and the positive meaning of
`complete_reciprocal_contact`: accept reciprocal contact as sufficient and
release the greeting ritual without another greeting, receipt or Assistant
presence claim. PHM-C Surface realization and positive-function validation are
implemented; PHM-D owns the separate validated commit-edge projection and pure
completion lookup.

## 5. Assistant Grounding

`conversation-os/control/assistantGrounding.ts` is the single source for
assistant identity and capabilities. It separates three responsibilities:

- `availableFacts` is the complete background truth available inside Context
  and planning. It is not sent wholesale to ordinary Surface Realization and is
  not a disclosure checklist.
- `requiredDisclosure` is projected by the existing Response Planner from the
  current direct-answer obligation. Only facts directly relevant to the
  current identity, modality, embodiment or capability question are included.
- `prohibitedClaims` constrains false claims in every turn. It must not be
  converted into a user-facing disclaimer list.

Plain identity, AI/human identity and clinician identity are separate
obligations. A plain “你是谁” therefore requires the product name and AI
assistant identity, while the professional boundary is required only when the
user asks about it or Safety needs it.

Conventional relational or spatial metaphors remain allowed when they do not
claim literal embodiment. If the user follows up on an adjacent metaphor, Turn
Interpretation marks the relationship to the preceding assistant turn and the
same Response Planner requires both the truthful physical boundary and a brief
acknowledgement that the earlier wording was figurative.

The proactive greeting consumes the canonical Grounding formatter but remains
outside the ordinary user-turn planner. Its greeting-only action contract
selects among a simple greeting, a non-question opening statement, and an
occasional concrete low-burden question. A question may appear at most once in
the current three-greeting window; it is not the default shape of a greeting.
Simple greeting and opening statement are preferences within one non-question
validation boundary. Server timezone/time is excluded from the external
greeting Prompt and cannot be used as evidence of user location or local day
phase.
The contract rejects permission-to-speak, passive waiting, generic interview
openings and near-duplicates. The last three greeting texts remain internal
validation evidence; the external model sees only system-defined move/topic
labels, not their raw text. Validation rejects both lexical near-duplicates
and reuse of a recent topic category.

The first User turn after a proactive greeting is owned by the ordinary
Response Planner. The current runtime's `respond_to_proactive_greeting` action
and `promptVersion` provenance are compatibility behavior, not the frozen v1
completion criterion. Under the v1 target, a committed greeting envelope, a
current User relation bound to that move and one Planner-selected required
function replace provenance-only detection.

When the greeting is a question, the adjacent User response retains the
ordinary no-second-interview rule. Current User content, a direct question,
redirect, interaction-move challenge or pause takes priority over greeting
ritual and may fulfill the handoff in the same response. Pre-greeting committed
events remain internal Context and are not projected to Surface unless the
current User turn explicitly resumes them.

Output Validation must prove the selected positive function. Pure receipt,
Assistant presence confirmation, echo, a second greeting-only move, a generic
open door or an unrelated question does not fulfill the contract merely because
it avoids a prohibited phrase. The Validator cannot create a plan, change the
target or relation, broaden disclosure or rewrite the reply. Completion exists
only after the accepted Assistant message and its `fulfills` edge commit.

## 6. Legacy migration

| Previous component | Current authority |
|---|---|
| `semanticEvidence` / Active Answer Frame | evidence provider |
| Conversation State interaction fields | evidence provider |
| legacy Engage pipeline | retained for compatibility tests; no production surface authority |
| `responseGoalSelector` / `clinicalPlanService` | compatibility and Clinical evaluation only; no production decision authority |
| Rogers strategy / current `clinicalStrategy` | temporary `legacy_compat` path; must not run with Hill on the same turn and exits in Batch 6 |
| Need Resolution draft | historical UX-boundary inventory; not a decision engine |
| Hill Helping Logic | Batch 1 Shadow remains trace-only; Batch 1.5 may pass only a deterministic `uncertain` applicability boundary to the ordinary Planner under a separate default-off flag |
| legacy Voice Layer | compatibility only; no production surface authority |
| `semanticEvidenceReplyGuard` | compatibility constraint tests only; no production output path |
| ordinary fallback reply | deauthorized from production orchestration |
| ResponsePlan validator | same-plan validator; no planning authority |
| Safety | explicit high-priority override with reason |

`guard_rewrite` remains readable only for historical traces. A normal success
path may emit `llm` or `llm_regenerate`; repeated validation failure emits
`constraint_failure`.

## 7. Architecture invariants

The target implementation must continuously verify:

1. exactly one production `createResponsePlan` call per ordinary turn;
2. exactly one ordinary `decisionOwner`;
3. every non-safety turn has one Hill decision or an explicit Hill failure once
   Batch 1 is active;
4. deterministic ordinary boundaries may return `not_applicable` without a
   model call, but may not ignore an active Helping topic;
5. Surface Realization receives the finalized ResponsePlan;
6. validator cannot create or mutate the plan;
7. ordinary fallback does not create a second goal;
8. Safety skips the ordinary loop and records a reason;
9. direct obligations survive mixed emotional and capability turns;
10. state update records, but does not reinterpret, the result;
11. when a committed Assistant question expects an answer, the answering turn
    does not open another interview question by default;
12. one turn cannot execute both `legacy_compat` and `hill_helping`;
13. Shadow results do not change ResponsePlan, Surface input, user-visible text
    or committed Helping state;
14. only an executed, validated, sent and atomically committed Hill reply
    creates `CommittedHelpingMove`;
15. formal Helping failure cannot be converted to `not_applicable` or an
    ordinary comfort reply.
16. Batch 2C Reaction Assessment remains `mode=shadow`, `source=fixture` and has
    zero consumers in Planner, Prompt, Surface, Validator, Initiative, Memory,
    User Model or formal persistence.
17. each v1 handoff target uses the stable id of a committed Assistant event;
    `sourceTurnId`, `planId` and `promptVersion` cannot substitute for it;
18. a proactive greeting handoff is fulfilled only by a semantically validated
    final Assistant response whose immutable edge commits against the same
    source move;
19. Turn Interpretation supplies target-bound relation evidence, Response
    Planner alone selects the required function, and Validator cannot change
    either decision;
20. Guest and authenticated chat must project the same logical committed
    envelope, User relation and completion result before v1 can claim runtime
    conformance;
21. handoff completion creates no persistent lifecycle state and has zero
    integration with Memory, Batch 2 or User Model.

Batch 0 keeps the existing source assertions as a pre-Hill baseline. Items 3-4
and 12-15 become executable gates in their assigned migration batches. Item 16
is executable for the Batch 2C-A fixture evaluator, but does not claim a
production Reaction Assessment runtime or authorize downstream integration.
Item 17, the Turn Interpretation/relation portion of Item 19, and the
envelope-and-relation portion of Item 20 now have executable coverage. Planner
function selection, detached exact-preflight authority, Surface projection and
same-plan semantic validation now have executable coverage. Item 18, completion
parity in Item 20, and completion semantics in Item 21 remain target gates for
later Planner Handoff Migration runtime slices.

The primary structural checks are:

```bash
npm run check:conversation-os-control
npm run check:conversation-os-architecture
npm run check:ai-orchestration
npm run check:architecture-v1
```

## 8. Current limitations

- Deterministic stable-boundary patterns remain language-specific and require
  counterexample review when expanded.
- The optional model interpretation is best-effort; deterministic obligations
  and stop evidence remain authoritative when it is unavailable.
- Legacy modules are still importable for compatibility/eval tests, but static
  checks prevent them from regaining production decision or override authority.
- Batch 0 runtime still invokes optional Rogers advice for a narrow set of
  Planner-selected activities; it does not yet implement the target Hill
  applicability or cross-turn reaction loop.
- Interaction Move Handoff v1 has stable proactive and ordinary committed-event
  envelopes with Guest/authenticated logical round-trip, strict adjacent active
  target projection, a target-bound current-turn User relation, a PHM-B plan
  projection and detached exact-preflight authority. A separately marked
  no-envelope legacy `promptVersion` compatibility path remains. PHM-C Surface
  projection and same-plan semantic validation plus PHM-D exact frozen-plan
  committed `fulfills` and `handoffCompleted` lookup are implemented. Safety
  `supersedes` and resolved/active lookup are absent, so the runtime does not yet
  claim full v1 conformance.
- Real-model post-migration A/B output comparison requires a separately scoped
  external-prompt authorization; local architecture and regression tests do not
  substitute for that naturalness evidence.
