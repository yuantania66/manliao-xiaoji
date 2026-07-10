# Response Strategy Engine

## Status

Design draft for architecture review.

This document does not implement code. It redesigns the input to Response Strategy Engine after review feedback.

Key correction:

> Response Strategy must not start by choosing a counseling technique.
>
> It must start by resolving the user's current need.

## North Star

慢聊小记不是先决定“我要用 Reflection / Repair / Summary”。

慢聊小记先回答：

> 这一轮，用户此刻真正需要什么？

Only after that should the system choose a helping technique.

## Core Distinction

There are two different layers:

```text
Need Resolution
  ↓
Technique Selection
```

Need Resolution answers:

> What does the user need from the AI in this turn?

Technique Selection answers:

> Which helping technique can best serve that need?

The previous draft made a mistake: it treated techniques as the system's primary decision object.

That is too textbook-driven.

Conversation OS should be user-need-driven.

## Target Pipeline

```text
Observe
  ↓
Understand
  ↓
Need Resolution
  ↓
Response Strategy
  ↓
Voice
  ↓
LLM
  ↓
Update
```

This is not adding a decorative layer.

It separates:

- the user's need
- the helping technique
- the language surface

## Theoretical Grounding

Need Resolution is product-level, but it is informed by established helping traditions:

- Rogers / Person-Centered Therapy:
  - accurate empathy
  - unconditional positive regard
  - congruence
  - user owns meaning
- Egan / The Skilled Helper:
  - exploration
  - understanding
  - preferred possibilities
  - action
- Motivational Interviewing:
  - partnership
  - acceptance
  - compassion
  - evocation
  - OARS: open questions, affirmations, reflections, summaries

Useful references:

- Rogers core conditions: accurate empathy, congruence, unconditional positive regard. NCBI StatPearls: https://www.ncbi.nlm.nih.gov/books/NBK589708/
- MI OARS: open questions, affirmations, reflective listening, summaries. Homeless Hub overview: https://homelesshub.ca/resource/motivational-interviewing-open-questions-affirmation-reflective-listening-and-summary-reflections-oars/
- Egan's Skilled Helper: exploration, understanding, action. Primary book reference: Gerard Egan, *The Skilled Helper*.

## Need Resolution

Need Resolution is the missing layer above Response Strategy.

It does not ask:

- What technique should AI use?
- What mode is this?
- What prompt should we add?

It asks:

- What does the user need to experience right now?
- What would harm that experience?
- What must the AI not do in this turn?

## Proposed Need Types

```ts
type ResolvedUserNeed =
  | "need_to_be_received"
  | "need_to_not_be_analyzed"
  | "need_to_not_be_pressured"
  | "need_permission_to_remain_unclear"
  | "need_permission_to_pause"
  | "need_misunderstanding_repaired"
  | "need_safe_correction_of_ai"
  | "need_not_to_carry_ai_mistake"
  | "need_less_aloneness"
  | "need_gentle_exploration"
  | "need_shared_clarity"
  | "need_focus"
  | "need_action_support"
```

These are not final labels shown to users.

They are internal need hypotheses.

They must remain tentative.

## Need Definition Interface

```ts
interface NeedResolutionDefinition {
  name: ResolvedUserNeed
  user_need: string
  when_to_detect: string[]
  when_not_to_detect: string[]
  risk_if_missed: string
  harmful_moves: string[]
  preferred_strategy_families: ResponseTechnique[]
  expected_user_experience: string[]
}
```

Important:

- A user turn can have multiple needs.
- One primary need must be selected for the turn.
- Secondary needs constrain the response but should not create extra content.
- Need Resolution is a hypothesis, not a truth about the user.

## Need Definitions

### need_to_be_received

User need:

The user needs their expression to land somewhere before anything else happens.

When to detect:

- User expresses a clear experience: "今天好累", "我好烦", "我有点撑不住".
- User offers one simple emotional or bodily statement.
- User does not ask for analysis or advice.

When not to detect:

- User explicitly asks for action.
- User is correcting AI.
- User is asking for structured reflection.

Risk if missed:

The AI may ask too quickly, analyze too early, or make the user feel processed instead of met.

Harmful moves:

- Asking a scale-like or binary question.
- Saying "确实", "一定", or otherwise confirming intensity.
- Turning the expression into a concept.

Preferred strategy families:

- reflective_listening
- accepting_presence

Expected user experience:

- "它接住了我刚刚说的。"
- "它没有马上分析。"
- "我不用证明我真的累。"

### need_to_not_be_analyzed

User need:

The user needs the AI not to interpret, diagnose, or explain them.

When to detect:

- User gives a short vulnerable statement.
- User says something emotionally loaded but not yet developed.
- User appears tired, uncertain, or not ready to elaborate.

When not to detect:

- User explicitly asks "帮我分析一下".
- User asks for a pattern, summary, or review.

Risk if missed:

The AI sounds clever but invasive.

Harmful moves:

- "这说明你..."
- "其实你是..."
- "真正原因..."
- Psychological labeling.

Preferred strategy families:

- reflective_listening
- accepting_presence

Expected user experience:

- "它没有急着定义我。"
- "它愿意先停在我说出来的部分。"

### need_to_not_be_pressured

User need:

The user needs not to be pushed into explaining, continuing, or choosing.

When to detect:

- User says "不知道", "说不清", "不想说", "嗯", "……".
- User gives ambiguous or low-information input.
- User shows ambivalence about continuing.

When not to detect:

- User asks a direct question and expects help.
- User explicitly invites exploration.

Risk if missed:

The AI becomes an interviewer.

Harmful moves:

- "什么意思？"
- "方便说说吗？"
- "能详细一点吗？"
- Repeated questions.

Preferred strategy families:

- accepting_presence
- supportive_silence

Expected user experience:

- "我不用马上解释。"
- "它没有逼我说更多。"

### need_permission_to_remain_unclear

User need:

The user needs permission for their current experience to remain unfinished, vague, or contradictory.

When to detect:

- User says "我不知道我现在是什么感觉".
- User says "我想继续说，但是又不太想说".
- User expresses ambivalence or confusion.

When not to detect:

- User asks for a clear decision or action.
- User is in immediate crisis and needs grounding or safety support.

Risk if missed:

The AI tries to resolve ambiguity too soon.

Harmful moves:

- Forcing a category.
- Asking the user to choose between two options.
- Summarizing ambiguity as a fixed state.

Preferred strategy families:

- accepting_presence
- open_exploration
- focusing, only if user wants help organizing

Expected user experience:

- "我可以还没想清楚。"
- "矛盾也可以先存在。"

### need_permission_to_pause

User need:

The user needs permission to stop or pause without losing connection.

When to detect:

- User says "算了，先不说了", "不说了", "先这样".
- User withdraws after AI may have missed them.

When not to detect:

- User asks for help.
- User is correcting AI and still engaged.

Risk if missed:

The AI either chases the user or closes the door.

Harmful moves:

- Pushing for explanation.
- Treating pause as rejection.
- Ending coldly.

Preferred strategy families:

- supportive_silence
- congruent_repair, if AI likely missed them

Expected user experience:

- "我可以停。"
- "它没逼我，也没把门关上。"

### need_misunderstanding_repaired

User need:

The user needs AI's misunderstanding to be acknowledged and withdrawn.

When to detect:

- User says "不是这个意思", "不是这样", "你理解错了".
- User points out AI's framing is wrong.

When not to detect:

- User says "我是不是..." about themselves or another person.
- User is expressing self-doubt, not correcting AI.

Risk if missed:

The user feels AI is defending its own interpretation.

Harmful moves:

- Explaining why AI said that.
- Asking the user to do the repair work.
- Continuing the old frame.

Preferred strategy families:

- congruent_repair

Expected user experience:

- "它承认刚刚没跟上。"
- "它把错的理解收回去了。"

### need_safe_correction_of_ai

User need:

The user needs to feel safe correcting the AI without being punished, argued with, or made responsible.

When to detect:

- User challenges AI: "你是不是没懂我？"
- User expresses frustration with AI.
- User compares AI to people who failed to understand them.

When not to detect:

- User is only asking whether another person dislikes them.

Risk if missed:

The relationship becomes brittle; user learns correction is unsafe.

Harmful moves:

- Defensiveness.
- Over-apology that shifts focus to AI.
- "Tell me exactly where I was wrong."

Preferred strategy families:

- congruent_repair
- accepting_presence

Expected user experience:

- "我可以纠正它。"
- "它不会跟我争。"

### need_not_to_carry_ai_mistake

User need:

The user needs not to shoulder the burden of clarifying AI's wrong interpretation.

When to detect:

- User says "我刚刚是不是没表达清楚？"
- User blames themselves after AI failed to understand.

When not to detect:

- User explicitly asks for help rewriting or organizing their words.

Risk if missed:

The AI accidentally reinforces self-blame.

Harmful moves:

- "你可以再说清楚一点."
- "你想怎么调整都可以."
- Asking for the corrected version immediately.

Preferred strategy families:

- congruent_repair
- affirmation, if user is making effort to clarify

Expected user experience:

- "不是我表达失败，是它愿意重新听。"

### need_less_aloneness

User need:

The user needs to feel they are not alone with the burden of what they just said.

When to detect:

- User expresses tiredness, worry, fear, shame, or loneliness.
- User's sentence carries a burden but does not ask for advice.

When not to detect:

- User asks for concrete next steps.
- User wants pause rather than accompaniment.

Risk if missed:

The AI becomes emotionally thin.

Harmful moves:

- "我在" as a generic line.
- Making the AI the center.
- Telling the user to stop, rest, or pause without invitation.

Preferred strategy families:

- reflective_listening
- accepting_presence

Expected user experience:

- "这句话没有掉在空处。"
- "我不是只能一个人撑着。"

### need_gentle_exploration

User need:

The user may benefit from continuing, but only with low pressure and user control.

When to detect:

- User expresses curiosity or ambivalence.
- User says they want to continue but hesitate.
- User gives enough content for a small opening.

When not to detect:

- User says they do not want to talk.
- User gives only minimal input.
- User is correcting AI.

Risk if missed:

The AI either shuts down too quickly or interrogates.

Harmful moves:

- Only giving the option to stop.
- Only pushing continuation.
- Asking a heavy question.

Preferred strategy families:

- open_exploration
- accepting_presence

Expected user experience:

- "我可以说一点点。"
- "也可以先不说。"
- "主动权在我。"

### need_shared_clarity

User need:

The user needs help seeing the current shape of what has been said.

When to detect:

- User asks to summarize, sort out, review, or reflect.
- Conversation contains multiple pieces and user asks for help organizing.

When not to detect:

- User has given only a single short emotional statement.
- User is correcting AI.

Risk if missed:

The AI keeps chatting when the user wants structure.

Harmful moves:

- Long analysis.
- Final-sounding conclusions.
- User profiling.

Preferred strategy families:

- summary_reflection
- focusing

Expected user experience:

- "我们目前先整理到这里。"
- "这只是草稿，可以改。"

### need_focus

User need:

The user needs help choosing a manageable focus.

When to detect:

- User has many threads at once.
- User says they are confused or scattered.
- User asks where to start.

When not to detect:

- User has only one clear concern.
- User has not consented to narrowing.

Risk if missed:

The conversation stays diffuse and tiring.

Harmful moves:

- AI choosing the priority without consent.
- Over-structuring.

Preferred strategy families:

- focusing
- open_exploration

Expected user experience:

- "可以先从一个小地方开始。"
- "重点不是 AI 替我定的。"

### need_action_support

User need:

The user wants help deciding or doing something.

When to detect:

- User asks "怎么办", "我该怎么做", "帮我想个办法".
- User explicitly requests advice or action.

When not to detect:

- User only wants to be heard.
- User is emotionally overwhelmed and not ready for planning.

Risk if missed:

The AI stays empathic when the user asked for useful help.

Harmful moves:

- Advice before understanding.
- Telling user what to do.
- Too many steps.

Preferred strategy families:

- collaborative_next_step
- summary_reflection before planning if needed

Expected user experience:

- "我能得到一点可执行的帮助。"
- "决定权还在我。"

## Response Techniques

Techniques are not the primary decision object.

They are selected after Need Resolution.

```ts
type ResponseTechnique =
  | "reflective_listening"
  | "accepting_presence"
  | "open_question"
  | "affirmation"
  | "summary_reflection"
  | "focusing"
  | "congruent_repair"
  | "supportive_silence"
  | "collaborative_planning"
```

These techniques come from Rogers, Egan, MI, and counseling microskills.

They must always be justified by the resolved need.

## Technique Definitions

### reflective_listening

Use when:

- The resolved need is `need_to_be_received`, `need_to_not_be_analyzed`, or `need_less_aloneness`.

Do not use when:

- The user is correcting AI.
- Reflection would add intensity or interpretation.

Source:

- Rogers: accurate empathic understanding.
- MI: reflections.

### accepting_presence

Use when:

- The resolved need is `need_permission_to_remain_unclear`, `need_to_not_be_pressured`, or `need_less_aloneness`.

Do not use when:

- The user is asking for action.
- The user needs repair.

Source:

- Rogers: unconditional positive regard.
- MI spirit: acceptance.

### open_question

Use when:

- The resolved need is `need_gentle_exploration`, `need_focus`, or `need_shared_clarity`.

Do not use when:

- The user needs not to be pressured.
- The question is mainly for AI's information hunger.
- The user is correcting AI.

Source:

- MI: open questions.
- Egan: exploration.

### affirmation

Use when:

- The resolved need includes recognition of effort, courage, agency, or values.

Do not use when:

- It would sound like praise.
- The user has not shown effort or agency.

Source:

- MI: affirmations.
- Rogers: unconditional positive regard.

### summary_reflection

Use when:

- The resolved need is `need_shared_clarity`.

Do not use when:

- The user gave a single short expression.
- The user is correcting AI.

Source:

- MI: summaries.
- Egan: clarifying the current picture.

### focusing

Use when:

- The resolved need is `need_focus`.

Do not use when:

- The AI would choose the user's priority without consent.

Source:

- MI: focusing.
- Egan: moving from exploration to useful understanding.

### congruent_repair

Use when:

- The resolved need is `need_misunderstanding_repaired`, `need_safe_correction_of_ai`, or `need_not_to_carry_ai_mistake`.

Do not use when:

- "是不是" refers to user's self-doubt or another person's attitude, not AI's understanding.

Source:

- Rogers: congruence / genuineness.
- Person-centered meaning ownership.
- Therapeutic alliance repair tradition.

### supportive_silence

Use when:

- The resolved need is `need_permission_to_pause` or `need_to_not_be_pressured`.

Do not use when:

- It would feel like abandonment.

Source:

- Rogers: acceptance and non-directiveness.
- Counseling microskills: therapeutic silence.

### collaborative_planning

Use when:

- The resolved need is `need_action_support`.

Do not use when:

- The user has not asked for help or is still too emotionally activated.

Source:

- Egan: action stage.
- MI: planning.

## Decision Object

The engine should output a need-first decision:

```ts
type ResponseStrategyPlan = {
  primaryNeed: ResolvedUserNeed
  secondaryNeeds: ResolvedUserNeed[]
  selectedTechnique: ResponseTechnique
  secondaryTechniques: ResponseTechnique[]
  needReason: string
  techniqueReason: string
  harmfulMoves: string[]
  expectedExperience: string[]
}
```

Rules:

- `primaryNeed` drives the turn.
- `selectedTechnique` must be justified by `primaryNeed`.
- `secondaryNeeds` constrain the turn but do not add extra content.
- `harmfulMoves` are more important than examples.
- The plan is not user-visible.

## Examples

### Example 1

User:

> 今天好累

Need Resolution:

```ts
primaryNeed = "need_to_be_received"
secondaryNeeds = ["need_to_not_be_analyzed", "need_less_aloneness"]
```

Technique Selection:

```ts
selectedTechnique = "reflective_listening"
```

Why:

The user likely needs the expression to land before being explored.

Harmful moves:

- Asking "身体上的还是心理上的?"
- Saying "确实很累"
- Advising rest

### Example 2

User:

> 不是这个意思

Need Resolution:

```ts
primaryNeed = "need_misunderstanding_repaired"
secondaryNeeds = ["need_safe_correction_of_ai", "need_not_to_carry_ai_mistake"]
```

Technique Selection:

```ts
selectedTechnique = "congruent_repair"
```

Why:

The user is correcting AI, not asking for exploration.

Harmful moves:

- Asking the user to explain the correction in full.
- Defending the previous interpretation.
- Continuing the old frame.

### Example 3

User:

> 我想继续说，但是又不太想说

Need Resolution:

```ts
primaryNeed = "need_permission_to_remain_unclear"
secondaryNeeds = ["need_to_not_be_pressured", "need_gentle_exploration"]
```

Technique Selection:

```ts
selectedTechnique = "accepting_presence"
secondaryTechniques = ["open_question"]
```

Why:

The user is ambivalent. The AI should preserve both possibilities: continue a little, or not continue.

Harmful moves:

- Only telling user to stop.
- Only pushing user to continue.
- Naming the ambivalence as a fixed state.

### Example 4

User:

> 领导没回我消息，我是不是被讨厌了？

Need Resolution:

```ts
primaryNeed = "need_to_be_received"
secondaryNeeds = ["need_gentle_exploration", "need_less_aloneness"]
```

Technique Selection:

```ts
selectedTechnique = "reflective_listening"
secondaryTechniques = ["open_question"]
```

Why:

The user is not correcting AI. They are bringing a relational worry.

Harmful moves:

- Treating "是不是" as repair.
- Reassuring "不一定是被讨厌".
- Challenging the thought too early.

## Re-evaluating Existing Concepts

### EngageMode

Recommendation:

Delete as a core concept.

Reason:

It is a product-invented mode layer. It mixes needs and techniques.

Migration:

- `acknowledge` -> Need Resolution determines whether this is `need_to_be_received`, `need_to_not_be_pressured`, or `need_permission_to_remain_unclear`.
- `reflect` -> usually `need_to_be_received` + `reflective_listening`.
- `repair_with_invitation` -> `need_misunderstanding_repaired` + `congruent_repair`.
- `repair_with_low_pressure_exit` -> `need_permission_to_pause` + `supportive_silence`, with repair if AI caused rupture.
- `stay` -> `need_permission_to_pause` or `need_to_not_be_pressured`.
- `invite` -> `need_gentle_exploration` + `open_question`.

### ExperienceGoal

Recommendation:

Keep the idea, delete the standalone layer.

Reason:

It belongs inside `NeedResolutionDefinition.expected_user_experience`.

Experience is the consequence of meeting a need, not an independent decision layer.

### QuestionStyle

Recommendation:

Delete as a standalone layer.

Reason:

Questions are techniques, not a universal policy object.

Question rules should live under:

- `open_question`
- `focusing`
- `summary_reflection`
- `congruent_repair`

### Voice

Recommendation:

Keep, but narrow.

Voice receives:

- selected need
- selected technique
- harmful moves
- expected experience

Voice does not decide:

- user need
- helping technique
- whether to ask
- whether to repair

## Proposed Conversation Decision

```ts
type ConversationDecision = {
  observations: Notice
  understanding: UnderstandingState
  strategyPlan: ResponseStrategyPlan
  voiceConstraints: VoiceConstraints
}
```

The LLM should receive one coherent decision:

```text
Need:
  need_to_be_received

Technique:
  reflective_listening

Harmful moves:
  - do not analyze
  - do not ask binary question
  - do not confirm intensity

Expected experience:
  - user feels received
  - user does not feel pressured
```

It should not receive competing layers:

```text
engageMode + experienceGoal + questionStyle + voice directives
```

## Trace Requirements

Future debug trace should show:

```text
userInput
observations
understanding
primaryNeed
secondaryNeeds
selectedTechnique
secondaryTechniques
needReason
techniqueReason
harmfulMoves
expectedExperience
rawLLMOutput
finalReplySource
```

This makes it possible to inspect whether the system is user-need-driven or technique-driven.

## Non-Goals

Need Resolution and Response Strategy must not:

- Generate final reply text.
- Become templates.
- Become a keyword routing table.
- Build persona.
- Diagnose the user.
- Replace safety handling.
- Turn the user into a case formulation.

## Acceptance Criteria

This architecture passes review only if:

1. The system can explain the user's need before naming a technique.
2. Every technique is justified by a need.
3. Harmful moves are explicit.
4. `EngageMode`, `ExperienceGoal`, and `QuestionStyle` can be removed or folded into the need-first plan.
5. Voice is downstream and cannot make strategy decisions.
6. Trace proves the system did not simply choose a counseling technique from message form.

## Recommendation

Do not implement Response Strategy as:

```text
User input -> Technique
```

Implement it as:

```text
User input
  ↓
Need Resolution
  ↓
Technique Selection
  ↓
Voice
```

The next implementation task should not be "add Strategy enum".

The next implementation task should be:

> Build Need Resolution as the input to Strategy.

Only then should the system choose Reflection, Repair, Open Question, Summary, or Planning.
