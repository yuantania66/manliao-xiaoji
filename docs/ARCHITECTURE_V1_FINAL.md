# Architecture v1 Final

## 1. Executive Summary

This document finalizes Architecture v1 for SlowTalk Notes.

It only consolidates concepts that already exist in the PRD, prior reviews, design documents, and current implementation. It freezes naming, boundaries, and architecture rules. It does not introduce a new product layer, a new component, or a new business capability.

Terms such as `ClinicalContext`, `ResponseGoal`, `Strategy`, `ClinicalPlan`, and `Projection Framework` are unified archival names for existing concepts. They do not represent new implementation in this finalization pass.

Architecture v1 has exactly five product layers:

1. Application Layer
2. Conversation Layer
3. Clinical Logic Layer
4. Memory & Mental Model Layer
5. Safety & Governance Layer

Runtime objects and runtime flow must not be described as independent product architecture layers.

Final Architecture v1 decision:

- Product architecture remains five-layer.
- Safety & Governance is a cross-cutting guardrail, not a normal linear pipeline step.
- Conversation Layer may output facts and approved deterministic signals.
- Clinical Logic owns `ResponseGoal`, `Strategy`, and `ClinicalPlan`.
- Memory owns long-term understanding and projection internals.
- Legacy Conversation OS strategy fields are frozen and must not be expanded.
- Only approved Conversation-derived signals may influence `ResponseGoal`.

## 2. Five-Layer Product Architecture

Architecture v1 consists of:

```text
Application Layer
Conversation Layer
Clinical Logic Layer
Memory & Mental Model Layer
Safety & Governance Layer
```

No other product layer exists in Architecture v1.

The following are not architecture layers:

- `ClinicalContext`
- `ResponseGoal`
- `Strategy`
- `ClinicalPlan`
- `Prompt`
- `Projection Framework`
- `Conversation State`
- `Golden Dataset`
- `Trace`

These may be runtime contracts, internal objects, evaluation assets, or engineering mechanisms, but they must not be promoted into product-layer terminology.

## 3. Runtime Data Flow

The runtime data flow for normal non-safety chat is:

```text
Conversation outputs
  -> ClinicalContext
  -> ResponseGoal
  -> Strategy
  -> ClinicalPlan
  -> Prompt construction
  -> LLM generation
  -> Post-processing / trace / save
```

This is runtime data flow, not product architecture layering.

Boundary definitions:

- `ClinicalContext` is a cross-layer data contract consumed by Clinical Logic.
- `ResponseGoal` is the first decision inside Clinical Logic.
- `Strategy` is the method used to fulfill a `ResponseGoal`.
- `ClinicalPlan` is the traceable output of Clinical Logic.
- Prompt construction belongs to the reply generation flow. It is not a sixth product layer.
- LLM generation is an execution mechanism, not a product architecture layer.
- Projection Framework is an internal Memory & Mental Model Layer engineering mechanism.

The runtime data flow may change internally as implementation evolves, but it must continue to respect the five-layer product architecture.

## 4. Safety as Cross-Cutting Governance

Safety & Governance is not a normal step in a straight-line pipeline.

It is a cross-cutting guardrail that can apply at multiple gates, including at least:

- Message / input gate
- ClinicalPlan / output gate
- Prompt / generation gate
- Final response gate

If any Safety gate denies or reroutes the flow:

- Ordinary Clinical Logic must not continue to take effect.
- Ordinary `ClinicalPlan` must not override the Safety decision.
- Prompt instructions must not weaken or bypass Safety.
- Final generated output must not bypass Safety.

Safety always has higher priority than:

- Clinical Logic
- `ResponseGoal`
- Strategy
- `ClinicalPlan`
- Prompt
- LLM generation result
- Memory context

Safety must not be simplified as merely "a step before ResponseGoal" or "a step before Prompt".

## 5. Layer Responsibilities

### Application Layer

Responsibilities:

- User interface.
- API endpoints.
- Debug display and product interaction.
- Login, session, settings, privacy, export, delete, and feedback flows.
- Displaying user-visible conversation and understanding artifacts.

Does not own:

- Memory Projection.
- Clinical Strategy.
- Safety risk judgement.
- Long-term understanding generation.

### Conversation Layer

Responsibilities:

- Receive user input.
- Observe / Understand / Update for the current conversation.
- Maintain realtime conversation mechanics.
- Output conversation facts and deterministic signals.
- Assemble trace-relevant conversation context.
- Call Clinical Logic.
- Pass data into reply generation.

Does not own:

- `ResponseGoal` decision.
- Psychological method selection.
- Long-term memory writes.
- User diagnosis.
- Response strategy expansion through legacy Conversation OS fields.

Conversation Layer may output facts and deterministic signals, but it must not convert them into Clinical conclusions.

### Clinical Logic Layer

Responsibilities:

- Consume `ClinicalContext`.
- Make the first ordinary response decision: `ResponseGoal`.
- Select a Strategy to fulfill the `ResponseGoal`.
- Output `ClinicalPlan`.
- Define question function, tone constraints, intervention boundaries, and safety notes.

Does not own:

- RawMemory access.
- Memory writes.
- Safety override.
- Prompt text as a product layer.
- Diagnosis, assessment, treatment plan, or clinical report.

Clinical Logic may consume approved Conversation-derived signals, but it cannot modify them.

### Memory & Mental Model Layer

Responsibilities:

- Store and evolve long-term understanding.
- Maintain Evidence.
- Maintain Timeline.
- Maintain Relationship.
- Maintain Understanding Continuity.
- Maintain SemanticMemory and other memory-derived context.
- Provide structured memory context into `ClinicalContext`.

Does not own:

- Current-turn `ResponseGoal`.
- Clinical Strategy.
- Safety decision.
- Prompt construction.

Memory data may support Clinical Logic through `ClinicalContext`, but Memory itself must not directly decide `ResponseGoal`.

### Safety & Governance Layer

Responsibilities:

- Cross-cutting safety gates.
- Product boundary enforcement.
- Crisis / high-risk handling.
- Privacy and data governance.
- Access control and audit constraints.
- Delete / forget rights.
- Training-data isolation.

Does not yield priority to:

- Clinical Logic.
- Strategy.
- `ClinicalPlan`.
- Prompt.
- LLM output.

Safety decisions must not be bypassed by ordinary chat behavior.

## 6. Approved Conversation Signal Whitelist

Architecture v1 allows only the following Conversation-derived inputs to affect `ResponseGoal`.

### 6.1 `expressionDifficulty`

Type:

- approved decision signal

Allowed effect:

- may drive `help_continue_expression`

Constraints:

- Must remain deterministic.
- Must remain non-diagnostic.
- Must indicate expression-start difficulty, not psychological avoidance.
- Must not imply user pathology.
- Has passed real-model experience evaluation for the current scope.

### 6.2 `explicitAdviceRequest`

Type:

- approved decision signal

Allowed effect:

- may drive `support_action`

Constraints:

- Must only represent an explicit user request for advice, choice support, wording, action, or next step.
- Must not be inferred from vague distress alone.
- Must not transform ordinary emotional expression into an advice request.
- Must preserve user agency.

### 6.3 `messageLength`

Type:

- supporting feature only

Allowed effect:

- may support a decision only when combined with other approved signals or explicit text conditions.

Constraints:

- Must not independently decide any `ResponseGoal`.
- Must not create rules such as "short message always means clarify".
- Must not interpret low-information input as emotion, avoidance, testing, or resistance by itself.

## 7. Prohibited State/Signal Inputs

The following must not influence formal `ResponseGoal` in Architecture v1:

- `conversationState`
- `opening`
- `exploring`
- `deepening`
- `action`
- `closing`
- `relationshipStage`
- `expressionMode`
- `rhythm`
- `presenceMode`
- `continuity`
- `sustainedTopic`
- `sustained_topic`
- `pauseOrEndIntent`
- `pause_or_end_intent`
- `memoryAvailability`
- `emotionalIntensity`

These prohibited inputs may appear in trace, dry-run observation, debug output, or review documents. They may not enter formal `ResponseGoal` decision logic.

Conversation Layer may output facts and deterministic signals. Clinical Logic may consume only approved signals for `ResponseGoal`. Clinical Logic must not modify Conversation-derived facts or signals.

To add any new signal to the whitelist, all of the following are required:

1. Conversation Layer boundary review.
2. Deterministic definition.
3. Golden Dataset regression.
4. Real-model experience evaluation.
5. Architecture rule update.

Safety is not part of the signal whitelist system. Safety remains a higher-priority cross-cutting guardrail.

## 8. Legacy Freeze Definition

Legacy Conversation OS freeze does not mean all code is impossible to modify.

It means old strategy-carrier fields must not continue expanding as the future response strategy system.

Strictly prohibited:

- Adding new `EngageMode` dimensions or enum values.
- Adding new `ExperienceGoal` / compatibility `ResponseGoal` fields.
- Adding new `QuestionStyle` types.
- Adding new `VoiceConstraints` strategy fields.
- Adding `relationshipStage`.
- Adding `rhythm`, `presenceMode`, `continuity`, or similar strategy dimensions.
- Letting old Conversation OS strategy fields take on new Response Strategy responsibility.
- Adding Prompt decisions that depend on legacy strategy fields.

Allowed:

- Bug fixes.
- Misclassification tightening.
- Type and null-safety fixes.
- Wording adjustments that do not change strategy meaning.
- Compatibility adapters that migrate behavior toward `ClinicalPlan`.
- Removing confirmed dead code after independent review.

Future response strategy must be expressed through Clinical Logic and `ClinicalPlan`.

## 9. Memory and Projection Boundary

Architecture v1 freezes responsibility boundaries, not final internal implementation granularity.

Memory & Mental Model Layer owns:

- long-term understanding,
- Evidence,
- Timeline,
- Relationship,
- Understanding Continuity,
- SemanticMemory,
- memory-derived context for `ClinicalContext`.

Projection Framework is the current internal engineering implementation for deriving Memory V2 projections.

Projection Framework is:

- not a product capability,
- not a product architecture layer,
- not part of Clinical Logic,
- not a direct ResponseGoal decision system.

Current V1/V2 compatibility paths, Repository / Service granularity, and partially unified legacy paths do not create new layers.

As long as implementation does not cross responsibility boundaries, incomplete internal consolidation does not violate Architecture v1.

Memory can provide structured context into `ClinicalContext`. Memory itself must not directly decide `ResponseGoal`.

## 10. Accepted Architecture Rules

### R1: Reviewed Signal Whitelist Rule

Unreviewed Conversation-derived state or signals must not influence `ResponseGoal`.

Only signals listed in the Approved Conversation Signal Whitelist may influence `ResponseGoal`.

### R2: Safety Priority Rule

Safety & Governance overrides Clinical Logic, Prompt, Memory context, and LLM output.

If Safety denies or reroutes, ordinary Clinical Logic must not take effect.

### R3: Product Layer Rule

Architecture v1 has exactly five product layers.

Runtime contracts, internal objects, prompt construction, projection internals, and eval assets must not be described as product layers.

### R4: Clinical Logic Ownership Rule

Clinical Logic owns ordinary `ResponseGoal`, Strategy, and `ClinicalPlan`.

Conversation Layer may provide facts and approved signals, but it does not decide `ResponseGoal`.

### R5: Memory Boundary Rule

Memory owns long-term understanding and may provide structured context. It must not directly decide ordinary `ResponseGoal`.

### R6: Legacy Freeze Rule

Legacy Conversation OS strategy fields are frozen. They can be maintained for compatibility, bugfixes, and migration, but not expanded for future strategy work.

### R7: Prompt Boundary Rule

Prompt construction is part of reply generation flow, not an architecture layer. Prompt must not become the owner of strategy decisions.

### R8: Feature Flag Rule

Feature flags that affect response behavior must default off unless explicitly approved for local or online rollout.

Unfinished gray-box or dry-run capabilities must remain trace-only until accepted.

## 11. Known Technical Debt

Known Architecture v1 debt:

- Candidate Conversation State vocabulary (`opening / exploring / deepening / action / closing`) exists in dry-run form but is not accepted as formal state.
- `relationshipStage.opening` remains a known vocabulary debt and must not be mixed with candidate Conversation `opening`.
- Legacy Conversation OS fields still exist for compatibility and trace continuity.
- Some V1/V2 Memory paths remain compatible rather than fully unified.
- Projection Framework internals are still implementation-oriented and may need further repository/service cleanup.
- `memoryAvailability` and `emotionalIntensity` may appear in trace but are prohibited from influencing `ResponseGoal`.
- `messageLength` is a supporting feature only and needs guardrails against becoming an independent decision rule.

This debt does not block Architecture v1 finalization as long as the rules above are enforced.

## 12. Allowed and Frozen Development Scope

Allowed under Architecture v1:

- Golden Dataset and experience evaluation.
- Approved `ResponseGoal` rule correction.
- `ClinicalContext` contract correction.
- Safety bugfixes.
- Compatibility-layer bugfixes.
- Trace and observability.
- Small reviewed experience experiments for already approved abilities.
- Dead-code removal after independent review.

Frozen / not allowed without a new review:

- New Conversation State model.
- Any unapproved signal influencing `ResponseGoal`.
- Legacy Conversation OS strategy expansion.
- New CBT / ACT / MI strategy implementation.
- Memory schema deepening.
- Graph-ready implementation.
- Report / Assessment / Diagnosis / Treatment Plan.
- Default-enabling feature flags without completed gray release validation.

## 13. Architecture v1 Final Decision

Architecture v1 is finalized as a five-layer product architecture with a separate runtime data flow.

The final product architecture is:

```text
Application Layer
Conversation Layer
Clinical Logic Layer
Memory & Mental Model Layer
Safety & Governance Layer
```

The final ordinary runtime data flow is:

```text
Conversation outputs
  -> ClinicalContext
  -> ResponseGoal
  -> Strategy
  -> ClinicalPlan
  -> Prompt construction
  -> LLM generation
```

Safety & Governance remains cross-cutting and higher priority than the ordinary flow.

Architecture v1 does not accept `opening / exploring / deepening / action / closing` as formal Conversation State.

Architecture v1 does accept a reviewed whitelist of deterministic Conversation-derived signals that may influence `ResponseGoal`:

- `expressionDifficulty`
- `explicitAdviceRequest`
- `messageLength` only as a supporting feature

All other state/signal inputs are prohibited from influencing `ResponseGoal` until they pass independent boundary review, Golden Dataset regression, real-model experience evaluation, and Architecture rule update.

This document is the final Architecture v1 constraint source unless superseded by a later approved architecture review.

