# Conversation State Design v1

## 1. Purpose

Conversation State v1 defines where the current conversation is in its interaction arc.

It exists because Clinical Logic should not decide `ResponseGoal` from the latest user message alone.
The same message can need a different response depending on where the conversation currently is.

Example:

```text
User: 不知道怎么说
```

In an opening state, this likely needs `help_continue_expression`.

After a long exploration, it may mean the user is tired or stuck and may need `hold_space` or a brief `summarize`.

Conversation State gives Clinical Logic a structured context signal, but it does not make clinical decisions itself.

## 2. Layer Ownership

Conversation State belongs to the Conversation Layer.

It is:

- maintained by Conversation Layer,
- exposed through `ClinicalContext.conversation.state` in the future,
- consumed by Clinical Logic,
- not modified by Clinical Logic,
- not stored as long-term Memory,
- not a new architecture layer.

Clinical Logic can consume Conversation State when selecting:

- `ResponseGoal`,
- strategy,
- question function,
- intervention boundary.

Clinical Logic must not update Conversation State.

## 3. Minimal State Machine

Conversation State v1 has five states:

```ts
type ConversationState =
  | "opening"
  | "exploring"
  | "deepening"
  | "action"
  | "closing";
```

These states are not labels for the user.
They describe the current conversation arc.

## 4. Flow

Future target flow:

```text
Conversation State
  +
Clinical Context
  ↓
Response Goal
  ↓
Strategy
  ↓
Clinical Plan
```

The important boundary:

```text
Conversation Layer decides conversation.state.
Clinical Logic consumes conversation.state.
```

## 5. State Definitions

### 5.1 opening

#### Definition

The conversation has just started, restarted, or has not yet formed a shared direction.

The system should help the user enter the conversation with low pressure.

#### Entering Conditions

- First user message in a session.
- User returns after a long gap and no active topic is clear.
- Proactive greeting has just happened.
- User gives low-information input before any shared topic exists.
- Previous conversation ended or was cleared.

#### Exiting Conditions

- User begins describing an event, emotion, relationship, body sensation, dream, or question.
- User accepts an invitation to continue expression.
- User clearly asks for advice or action help.
- User explicitly wants to stop or pause.

#### Allowed Response Goals

- `help_continue_expression`
- `clarify`
- `reflect` only when the user clearly expresses an experience

#### Forbidden Behavior

- `support_action` unless the user explicitly asks for help.
- Long summary of history.
- Heavy clinical interpretation.
- Large advice blocks.
- Persona or memory-based claims.
- Treating a short input as a stable user pattern.

#### Notes

Opening should feel easy to enter.
The system should not make the user prove they have something important to say.

### 5.2 exploring

#### Definition

The user has introduced a topic, but the shared understanding is still forming.

The system should stay close to what the user has actually said and help the conversation continue without forcing depth.

#### Entering Conditions

- User gives an event, feeling, uncertainty, or relationship concern.
- User begins describing something but the meaning is still unclear.
- User is trying to find words.
- The conversation has a topic but no clear deeper pattern yet.

#### Exiting Conditions

- User repeatedly returns to the same meaning, conflict, value, or relationship pattern.
- User asks for a summary or wants to see the structure.
- User asks for concrete help or action.
- User withdraws, pauses, or ends.

#### Allowed Response Goals

- `reflect`
- `clarify`
- `help_continue_expression`
- `hold_space` when the user slows down or becomes overwhelmed

#### Forbidden Behavior

- Premature summary.
- Premature insight.
- Diagnosing the user's pattern.
- Treating one message as enough evidence.
- Moving to advice before the user asks for it.
- Asking multiple information-gathering questions.

#### Notes

Exploring is where most early conversation should live.
The system should tolerate unknowns.

### 5.3 deepening

#### Definition

The conversation has enough shared material that the system can help reflect or organize a deeper current understanding.

This does not mean the AI has discovered the truth.
It means the user and AI have enough shared context to hold a more layered understanding draft.

#### Entering Conditions

- User has shared multiple connected turns on the same topic.
- User corrects or refines the AI's understanding and continues.
- A repeated conflict, need, meaning, or relationship concern becomes visible in-session.
- User asks to understand why something feels this way.
- User asks to summarize, organize, or reflect back.

#### Exiting Conditions

- User asks for concrete next steps.
- User becomes overwhelmed and needs lower pressure.
- User pauses or wants to stop.
- The topic shifts to a new, early-stage topic.

#### Allowed Response Goals

- `reflect`
- `summarize`
- `clarify` when the user corrects the understanding
- `hold_space` when the user becomes overloaded

#### Forbidden Behavior

- Converting the shared understanding draft into a conclusion.
- Turning insight into a user label.
- Writing a report, assessment, diagnosis, or treatment plan.
- Using memory to override what the user is saying now.
- Giving advice when the user is still trying to understand.

#### Notes

Deepening should feel like the understanding is becoming more precise, not like the AI is taking control of the meaning.

### 5.4 action

#### Definition

The user is asking for practical help, decision support, wording, planning, or a next step.

The system should provide useful action support while preserving the user's authority and avoiding treatment plans.

#### Entering Conditions

- User explicitly asks for advice.
- User asks what to do next.
- User asks for wording or a plan for a real conversation.
- User says they do not want comfort and wants help acting.
- User asks to prioritize or choose between options.

#### Exiting Conditions

- User returns to emotional processing.
- User rejects advice and wants to be understood instead.
- User pauses or ends.
- Action support produces a small next step and the conversation returns to exploration.

#### Allowed Response Goals

- `support_action`
- `summarize` when brief organization is needed before action
- `clarify` only to define the decision boundary

#### Forbidden Behavior

- Only empathic reflection when the user clearly asks for help.
- Taking over the decision.
- Giving a large plan when the user asks for a small next step.
- Giving diagnosis or treatment plan.
- Using psychological techniques instead of answering the practical request.

#### Notes

Action state is not anti-Rogers.
It still respects user agency.
It simply recognizes that the user has asked for help doing something.

### 5.5 closing

#### Definition

The user is ending, pausing, thanking, withdrawing, or asking to wrap up.

The system should help the conversation end safely and gently, without forcing more expression.

#### Entering Conditions

- User says they want to stop or pause.
- User says "算了", "先不说了", "就这样吧", or similar.
- User thanks the AI and does not introduce a new topic.
- User asks to summarize before leaving.
- The conversation naturally reaches a resting point.

#### Exiting Conditions

- User reopens the topic.
- User asks a new question.
- User asks for action support before leaving.
- User introduces a new emotion, event, dream, body signal, or relationship concern.

#### Allowed Response Goals

- `hold_space`
- `summarize`
- `support_action` only if the user explicitly wants a final next step
- `reflect` for a brief natural acknowledgement

#### Forbidden Behavior

- Forcing the user to continue.
- Asking multiple follow-up questions.
- Treating withdrawal as failure.
- Producing a long summary unless requested.
- Closing the relationship coldly.
- Making the user comfort the AI.

#### Notes

Closing should preserve continuity.
The user should feel they can stop without losing the relationship.

## 6. State and Response Goal Matrix

| State | Primary Allowed Goals | Conditional Goals | Disallowed By Default |
| --- | --- | --- | --- |
| `opening` | `help_continue_expression`, `clarify` | `reflect` | `support_action`, long `summarize` |
| `exploring` | `reflect`, `clarify`, `help_continue_expression` | `hold_space` | premature `summarize`, unsolicited `support_action` |
| `deepening` | `reflect`, `summarize` | `clarify`, `hold_space` | unsolicited `support_action`, diagnosis |
| `action` | `support_action` | `summarize`, `clarify` | pure reflection only, treatment plan |
| `closing` | `hold_space`, `summarize` | `support_action`, `reflect` | forced continuation, long probing |

This matrix is a guide, not a template.
Safety still overrides all states.

## 7. Relationship With ClinicalContext

Future `ClinicalContext` should expose:

```ts
interface ClinicalConversationContext {
  currentUserMessage: string
  previousAssistantMessage?: string | null
  turnCount: number
  state: ConversationState
}
```

Clinical Logic can read `conversation.state` while selecting `ResponseGoal`.

It must not write:

```ts
context.conversation.state = ...
```

Clinical Logic can include state in trace:

```ts
ClinicalTrace.conversationState = "exploring"
```

But trace is observational, not ownership.

## 8. Relationship With Existing Signals

Current `ClinicalContext.signals` includes deterministic signals such as:

- message length,
- expression difficulty,
- explicit advice request,
- emotional intensity,
- previous assistant presence,
- conversation stage,
- memory availability.

Conversation State is higher-level than these signals.

Signals are local features.
State is the current conversation arc.

Example:

```text
messageLength = SHORT
conversation.state = opening
```

may suggest `clarify` or `help_continue_expression`.

```text
messageLength = SHORT
conversation.state = closing
```

may suggest `hold_space`.

This is why ResponseGoalSelector should not rely on message alone.

## 9. State Ownership Rules

Conversation Layer may:

- infer initial state,
- update state after a turn,
- expose state to ClinicalContext,
- include state in debug trace.

Clinical Logic may:

- consume state,
- choose ResponseGoal accordingly,
- explain in trace how state influenced a plan.

Clinical Logic may not:

- create state,
- overwrite state,
- persist state as memory,
- treat state as user identity,
- treat state as diagnosis.

Memory Layer may:

- provide supporting context that helps Conversation Layer in future versions.

Memory Layer may not:

- own current conversation state,
- force state based on old memories.

## 10. Migration Plan

### Phase 1: Documentation Only

Current sprint.

No code change.
No Prompt change.
No Memory change.
No Clinical strategy change.

### Phase 2: Add Conversation State To Conversation Context

Add `conversation.state` to the Conversation Layer's runtime context.

Initial deterministic rules may use:

- turn count,
- previous assistant reply,
- user pause/end signals,
- explicit advice request,
- summary request,
- whether current topic has been established.

This must remain deterministic and traceable.

### Phase 3: Expose State To ClinicalContext

Extend `ClinicalContext.conversation`:

```ts
conversation: {
  currentUserMessage: string
  previousAssistantMessage?: string | null
  turnCount: number
  state: ConversationState
}
```

Do not remove existing fields.
Do not let Clinical Logic compute state.

### Phase 4: ResponseGoalSelector Consumes State

Change `ResponseGoalSelector` from:

```text
current message
  -> signals
  -> responseGoal
```

to:

```text
conversation.state
  + signals
  + current message when necessary
  -> responseGoal
```

Example future behavior:

- `state=opening` + short ambiguous input -> `clarify` or `help_continue_expression`
- `state=exploring` + emotional expression -> `reflect`
- `state=deepening` + repeated thread -> `summarize` or `reflect`
- `state=action` + explicit practical request -> `support_action`
- `state=closing` + pause signal -> `hold_space`

### Phase 5: Add Golden Dataset Coverage

Add cases where identical input appears in different states.

Examples:

```text
Input: 嗯
State: opening
Expected: clarify / help_continue_expression

Input: 嗯
State: closing
Expected: hold_space
```

This verifies that state, not only message text, affects response goal.

## 11. Non-Goals

Conversation State v1 does not:

- add a new architecture layer,
- implement a state machine in code,
- change Prompt,
- change Memory,
- change Safety,
- add ResponseGoals,
- add Clinical Strategies,
- generate language,
- persist user identity or persona,
- diagnose user stage or readiness.

## 12. Acceptance Criteria For Future Implementation

When implemented, Conversation State v1 is acceptable only if:

- State is produced by Conversation Layer.
- Clinical Logic only consumes state.
- Safety still overrides all ordinary state logic.
- Existing ResponseGoal behavior does not regress unless explicitly approved.
- Debug trace shows current state and reason.
- Golden Dataset includes state-sensitive cases.
- No Prompt wording changes are required just to introduce state.

