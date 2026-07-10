# Conversation Layer Boundary Review

## 1. Executive Conclusion

Conclusion: split the candidate five-state design into `state + signals`; do not land `opening / exploring / deepening / action / closing` as formal Conversation State.

The current candidate five states mix several different concepts:

- objective conversation facts,
- real-time expression signals,
- user intent signals,
- clinical interpretation,
- response-goal constraints.

This violates the Product Architecture v1 boundary that Conversation Layer should handle real-time conversation mechanics, while Clinical Logic owns response goal and strategy selection.

Final decision:

- Do not continue expanding `opening / exploring / deepening / action / closing` as formal Conversation State.
- Keep any current dry-run state inert until this review is accepted and a separate state-sensitive evaluation is approved.
- Reframe Conversation Layer output as:
  - minimal objective conversation state,
  - deterministic conversation-derived signals.
- Clinical Logic may consume these outputs, but must not modify them.
- ResponseGoalSelector must not use these outputs until a separate approved eval exists.

## 2. PRD Boundary Check

SlowTalk Notes Product Architecture v1 defines:

```text
Application Layer
Conversation Layer
Clinical Logic Layer
Memory & Mental Model Layer
Governance & Safety Layer
```

Conversation Layer responsibilities:

- receive user input,
- form current-turn basic understanding,
- call Clinical Logic,
- assemble LLM context,
- output trace,
- receive next-turn feedback and update current understanding.

Conversation Layer must not become:

- a clinical stage engine,
- a response strategy selector,
- a user-readiness evaluator,
- a memory interpretation engine,
- a second Clinical Logic layer.

Therefore Conversation Layer can output objective runtime facts and deterministic signals, such as:

- whether this is the first turn,
- whether a user is explicitly asking for advice,
- whether the user explicitly signals pause/end,
- whether the session contains sustained same-topic disclosure.

Conversation Layer should not output interpretations such as:

- the user is ready to deepen,
- this is clinically a deepening phase,
- this should now move to action,
- the user is psychologically closing.

Those belong either to Clinical Logic or should remain unclaimed.

## 3. Five-State Review

### opening

Classification:

- partly objective conversation fact,
- partly response-goal framing.

What is valid:

- "first turn",
- "new session",
- "no established topic yet",
- "proactive greeting just happened".

What is not valid as Conversation State:

- "the user should be helped to enter with low pressure",
- "support_action should be forbidden",
- "this should use help_continue_expression".

Those are Clinical Logic / Response Goal consequences, not Conversation Layer state.

Boundary decision:

- Do not keep `opening` as formal Conversation State.
- If needed, replace with objective signal: `isSessionStart` or state value `session_start`.

### exploring

Classification:

- partly real-time understanding signal,
- partly vague clinical phase.

What is valid:

- "topic has started",
- "meaning is not yet stable",
- "conversation has active topic material".

What is not valid:

- "the conversation is clinically exploring",
- "system should tolerate unknowns" as a state-owned policy.

Boundary decision:

- Do not keep `exploring` as formal Conversation State.
- If needed, represent as objective state `active_topic` or signal `hasActiveTopic`.

### deepening

Classification:

- high risk of Clinical Interpretation.

Key question:

Does `deepening` only mean "same topic continues across turns", or does it imply "the user is ready to go deeper"?

Answer:

The word `deepening` strongly implies readiness, psychological depth, or clinical movement. Even if the implementation only detects sustained same-topic disclosure, the name itself smuggles in clinical interpretation.

Valid objective version:

- "same topic appears to continue",
- "multiple user turns contain connected disclosure",
- "there is sustained in-session material".

Invalid clinical implication:

- "the user is ready for deeper work",
- "the AI may summarize deeper meaning",
- "the conversation should move into insight."

Boundary decision:

- Do not keep `deepening` as formal Conversation State.
- Replace with signal `sustainedTopic` or `sameTopicContinuation`.
- Clinical Logic may later decide whether sustained topic supports `summarize` or `reflect`, but Conversation Layer should not call it deepening.

### action

Classification:

- user intent signal,
- not Conversation State.

Valid objective version:

- "user explicitly asked for advice",
- "user asked what to do next",
- "user asked for wording, choice, or plan."

Invalid as state:

- "the conversation is in action phase."

`action` is a response orientation, not a state of the conversation. A user can ask for advice on the first turn. That does not mean the conversation has entered an action stage; it means the current user turn contains an action/advice intent.

Boundary decision:

- Do not keep `action` as formal Conversation State.
- Replace with signal `explicitAdviceRequest` or `actionIntent`.
- Clinical Logic can consume it to select `support_action`.

### closing

Classification:

- user intent signal,
- sometimes objective conversation fact,
- not a broad Clinical phase.

Valid objective version:

- "user explicitly says they want to stop",
- "user says later / next time / today ends here",
- "user thanks and gives no new topic."

Invalid clinical implication:

- "the relationship is closing",
- "the user is withdrawing",
- "the conversation should be closed by the AI."

Boundary decision:

- Do not keep `closing` as broad formal Conversation State.
- Replace with signal `endingIntent` or `pauseIntent`.
- If a state value is needed, use objective `session_wrap_up`, not `closing`.

## 4. Existing Conversation OS Comparison

Reviewed terms:

- `relationshipStage`
- `expressionMode`
- `rhythm`
- `presenceMode`
- `continuity`

Current repository check:

- `rhythm` exists as part of legacy VoiceConstraints.
- `relationshipStage`, `expressionMode`, `presenceMode`, and `continuity` are not currently visible as stable runtime source-of-truth fields in code.
- Memory docs contain continuity-related concepts, but those belong to Memory & Mental Model Layer, not Conversation State.

Boundary risk:

If the five-state model is expanded as `conversation.state`, it may create a second state system alongside existing or future Conversation OS concepts:

```text
conversation.state = opening / exploring / deepening / action / closing
relationshipStage = opening / ...
expressionMode = ...
presenceMode = ...
continuity = ...
```

This would create ambiguity:

- Which state drives runtime behavior?
- Which state is debug truth?
- Which state can Clinical Logic consume?
- Which state is user-facing or memory-facing?

Source-of-truth decision:

- Runtime source of truth should be a minimal Conversation Layer object containing objective session facts and deterministic signals.
- `relationshipStage`, if introduced or already present in a future branch, should describe the user-AI relationship trajectory, not the current turn's response stage.
- `expressionMode`, `presenceMode`, `rhythm`, and `continuity` should be treated as signals or presentation constraints unless they are explicitly promoted by architecture review.
- No second Conversation State system should be created.

## 5. Vocabulary Conflict

Conflict:

- Candidate Conversation State uses `opening`.
- Existing/planned `relationshipStage` may also use `opening`.

The two meanings are different:

- Candidate Conversation `opening`: session or topic has just begun.
- `relationshipStage.opening`: relationship between user and AI is early, tentative, or trust-building.

These should not share the same word.

Which name must change:

- Candidate Conversation State name must change.

Reason:

- Relationship stage vocabulary is naturally longitudinal and relationship-centered.
- Conversation runtime vocabulary should be objective and session-centered.
- Keeping `opening` in both places would make debug and trace ambiguous.

Unique naming recommendation:

- Replace candidate `opening` with `session_start` if it becomes a formal state.
- Replace candidate `closing` with `session_wrap_up` if it becomes a formal state.
- Replace candidate `deepening` with signal `sustained_topic`, not a state.
- Replace candidate `action` with signal `explicit_action_request`, not a state.
- Replace candidate `exploring` with `active_topic` if a formal state is still needed.

Do not perform a project-wide vocabulary refactor now.
Only block further use of `opening / exploring / deepening / action / closing` as formal Conversation State names.

## 6. Must Change

Before Conversation-derived state can influence ResponseGoal, the following must change:

1. The candidate five-state vocabulary must be retired as formal Conversation State.
2. Conversation Layer output must be split into:
   - objective state,
   - deterministic signals.
3. `deepening` must be renamed and downgraded to a signal such as `sustained_topic`.
4. `action` must be renamed and downgraded to `explicit_action_request`.
5. `closing` must be renamed and downgraded to `pause_or_end_intent`, unless it becomes objective `session_wrap_up`.
6. `opening` must be renamed to avoid conflict with relationship-stage vocabulary.
7. Clinical Logic must continue to consume but not modify Conversation Layer outputs.
8. A state-sensitive Golden Dataset must be approved before ResponseGoalSelector uses these outputs.

## 7. Can Defer

The following can be deferred:

- Full relationshipStage design.
- Full expressionMode design.
- Full presenceMode design.
- Whether `rhythm` remains Voice-only or becomes a Conversation signal.
- Whether continuity belongs in Conversation Layer or Memory & Mental Model Layer.
- Whether `active_topic` needs a formal state machine.
- Whether same-topic detection should use semantic matching.

These are not required to resolve the current boundary conflict.

## 8. Architecture Rule

Conversation-derived state or signals must not influence ResponseGoal until this review is accepted and a separate state-sensitive evaluation is approved.

Additional rules:

- Conversation Layer may produce objective runtime state and deterministic signals.
- Clinical Logic may consume them.
- Clinical Logic must not modify them.
- Memory must not own current Conversation State.
- Safety remains higher priority than all state or signal logic.
- Any future state-sensitive ResponseGoal behavior must pass Golden Dataset cases where the same user input appears under different conversation states or signals.

## 9. Next Single Action

Next single action:

Revise `docs/CONVERSATION_STATE_DESIGN.md` to replace the five-state model with a split design:

```text
Conversation Runtime State:
  - session_start
  - active_topic
  - session_wrap_up

Conversation-derived Signals:
  - explicit_advice_request
  - explicit_action_request
  - pause_or_end_intent
  - sustained_topic
  - low_information_input
  - has_previous_assistant_reply
```

Do not change code yet.
Do not allow state or signals to influence ResponseGoal yet.

