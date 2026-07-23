# Architecture v1 Final

## 1. Final decision

This document is the current Architecture v1 baseline for SlowTalk Notes. The
2026-07-23 Conversation OS control-closure decision supersedes the former
runtime rule that made Clinical Logic the default owner of every ordinary
reply. It does not add a sixth product layer.

Architecture v1 has exactly five product layers:

1. Application Layer
2. Conversation Layer
3. Clinical Logic Layer
4. Memory & Mental Model Layer
5. Safety & Governance Layer

The ordinary non-safety decision owner is now singular:

```text
decisionOwner = conversation_os.response_planner
```

`ResponsePlan`, `DialogueState`, `ClinicalContext`, `ClinicalStrategyAdvice`,
Prompt, validator and trace are runtime contracts, not product layers.

## 2. Runtime control loop

Normal chat uses this one traceable loop:

```text
Context Assembly
  -> Turn Interpretation
  -> Dialogue State
  -> Response Planner
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
- current repair signal;
- selected user-confirmed memory, if relevant;
- Assistant Grounding;
- confirmed facts and explicitly separated hypotheses;
- safety signal.

It must not dump complete history, databases, unrelated memory or raw internal
trace into the model Prompt.

### 2.2 Turn Interpretation

Turn Interpretation is an evidence-producing step, not a reply planner. It can
combine a primary dialogue act, secondary signals, direct questions,
engagement, initiative, affect evidence, stop evidence, repair evidence and a
grounding reference.

Stable product/capability boundaries may use deterministic classification.
Ambiguous pragmatics may use the configured LLM through a structured adapter.
The adapter may not write a reply, create a ResponsePlan, or override a
deterministically established direct question or stop request.

### 2.3 Dialogue State

Dialogue State carries:

- `openLoops`;
- `answerObligations`;
- `currentInitiative`;
- `repairState`;
- `conversationContinuity`;
- `confirmedFacts`;
- `unconfirmedHypotheses`;
- composable `activeInteractionNeeds`.

An explicit user question becomes a must-answer obligation. Empathy,
clarification and Clinical advice cannot remove it.

### 2.4 Response Planner

Response Planner is the only ordinary writer of response intent and action. It
creates exactly one `ResponsePlan` containing:

- answer obligations;
- concrete response actions;
- Assistant Grounding facts;
- optional Clinical strategy advice;
- question and closure policies;
- tone, stance and length guidance;
- prohibited claims and safety constraints;
- plan evidence.

No module after this point may reinterpret the user, choose a new response
goal, or select another strategy.

### 2.5 Surface Realization

Surface Realization receives the finalized ResponsePlan and bounded chat
history. It only writes natural language for that plan. Production surface
generation must not run legacy Engage, Voice or Clinical ResponseGoal planning.

### 2.6 Output Validation

Output Validation is a constraint provider. It may:

- accept the realization;
- reject an unanswered direct obligation;
- reject a grounding, closure, question or semantic-evidence violation;
- request at most one regeneration against the exact same `planId`;
- return a non-chat `constraint_failure` system status after a second failure.

It may not create a ResponsePlan, select a ResponseGoal, choose a Clinical
strategy, or author an ordinary fallback/comfort reply.

### 2.7 State Update

State Update records fulfilled obligations and remaining open loops. It does
not re-plan the current reply.

## 3. Five-layer responsibilities

### 3.1 Application Layer

Owns UI, API, session, persistence, settings, privacy, export/delete and debug
display. It does not decide ordinary reply actions or Clinical strategy.

### 3.2 Conversation Layer

Owns the ordinary control loop and its single Response Planner. It assembles
the current context, interprets the turn, maintains dialogue state, requests
optional providers, finalizes one ResponsePlan and records state update.

It does not diagnose, write long-term Memory, or implement a Clinical method.

### 3.3 Clinical Logic Layer

Clinical Logic is an on-demand policy provider. The Response Planner may ask it
for strategy advice when evidence supports emotional support, relationship or
feeling exploration, action support, or another approved professional method.

Clinical Logic does not own the production ResponseGoal, cannot erase direct
answer obligations, cannot write final chat text, and cannot override Safety.
The legacy `ClinicalPlan` and `ResponseGoalSelector` remain compatibility and
unit-evaluation contracts only; production orchestration does not call them as
a second decision owner.

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

## 5. Assistant Grounding

`conversation-os/control/assistantGrounding.ts` is the single source for
assistant identity and capabilities:

- name: 慢聊小记;
- identity: AI聊天助手, not a human, psychologist or therapist;
- current modality: text input and text output;
- no current voice input/output, vision or hearing;
- no body and no literal ability to sit, hug, touch or be physically present;
- no current time unless supplied by system context;
- memory is limited to adjacent turns and explicitly selected memory context.

Warm relational language is allowed only when it does not contradict these
facts. If a user asks about a bodily metaphor or earlier wording, the plan must
answer directly and repair the wording.

## 6. Legacy migration

| Previous component | Current authority |
|---|---|
| `semanticEvidence` / Active Answer Frame | evidence provider |
| Conversation State interaction fields | evidence provider |
| legacy Engage pipeline | retained for compatibility tests; no production surface authority |
| `responseGoalSelector` / `clinicalPlanService` | compatibility and Clinical evaluation only; no production decision authority |
| Rogers strategy | optional Clinical policy provider |
| legacy Voice Layer | compatibility only; no production surface authority |
| `semanticEvidenceReplyGuard` | compatibility constraint tests only; no production output path |
| ordinary fallback reply | deauthorized from production orchestration |
| ResponsePlan validator | same-plan validator; no planning authority |
| Safety | explicit high-priority override with reason |

`guard_rewrite` remains readable only for historical traces. A normal success
path may emit `llm` or `llm_regenerate`; repeated validation failure emits
`constraint_failure`.

## 7. Architecture invariants

The implementation must continuously verify:

1. exactly one production `createResponsePlan` call per ordinary turn;
2. exactly one ordinary `decisionOwner`;
3. no production `createClinicalPlan`/`selectResponseGoal` call;
4. Clinical advice is invoked only for an active supported need;
5. Surface Realization receives the finalized ResponsePlan;
6. validator cannot create or mutate the plan;
7. ordinary fallback does not create a second goal;
8. Safety skips the ordinary loop and records a reason;
9. direct obligations survive mixed emotional and capability turns;
10. state update records, but does not reinterpret, the result.

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
- Real-model post-migration A/B output comparison requires a separately scoped
  external-prompt authorization; local architecture and regression tests do not
  substitute for that naturalness evidence.
