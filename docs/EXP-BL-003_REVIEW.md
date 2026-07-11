# EXP-BL-003 Review

## Issue Header

- Issue ID: EXP-BL-003
- Golden Dataset cases:
  - GD-ADV-002
  - GD-ADV-003
  - GD-ADV-004
  - GD-ADV-005
  - GD-ADV-006
- Priority: P0
- Decision owner: Product / Architecture owner

## 1. User Problem

Users explicitly ask for practical help, but the system often stays at reflection, reassurance, or another question.

The user experience problem is not that the AI fails to notice an advice request. EXP-BL-002 fixed that: the relevant advice cases now select `support_action`.

The remaining problem is that `support_action` does not yet guarantee even a small amount of action support.

Current user-facing failure:

```text
The AI recognizes "I need help doing / deciding something" but responds as if the safest move is still to reflect or ask for more context.
```

## 2. Evidence

Source reports:

- `docs/EXP-BL-003_SURVIVOR_ANALYSIS.md`
- `docs/evals/experience-review-latest.md`

Shared trace pattern across all five survivor cases:

- Selected ResponseGoal: `support_action`
- Selected Strategy: `rogers`
- ClinicalPlan responseIntent: `support_action`
- ClinicalPlan questionFunction: `support_user_agency`
- Final reply source: `llm`

### GD-ADV-002

- Input: `我该不该辞职？`
- Selected ResponseGoal: `support_action`
- Selected Strategy: `rogers`
- Baseline reply: `这个问题现在冒出来了，我们可以先在这儿待一下。`
- Treatment reply: `这个问题现在冒出来了，我们可以先不急着要答案。`
- Current ClinicalPlan:
  - responseGoal: `support_action`
  - primaryStrategy: `rogers`
  - responseIntent: `support_action`
  - questionFunction: `support_user_agency`
- Why still not actionable: It does not offer a decision-support frame, such as factors to compare, a reversible first check, or a way to separate urgency from values.
- Missing content type: decision support.
- User agency: Protected, but overprotected. The reply avoids deciding for the user, yet gives no useful structure.
- Baseline vs treatment: Treatment is not meaningfully better; both avoid the decision.

### GD-ADV-003

- Input: `我明天要跟领导谈，怎么开口比较好？`
- Selected ResponseGoal: `support_action`
- Selected Strategy: `rogers`
- Baseline reply: `明天要谈这件事，现在是不是还在想怎么起头？`
- Treatment reply: `明天要谈这件事，现在是不是还在琢磨怎么起头？`
- Current ClinicalPlan:
  - responseGoal: `support_action`
  - primaryStrategy: `rogers`
  - responseIntent: `support_action`
  - questionFunction: `support_user_agency`
- Why still not actionable: The user asks for an opening line, but the reply only mirrors the difficulty of starting.
- Missing content type: concrete small step / sample opening.
- User agency: Protected in theory, but the user receives no adjustable wording.
- Baseline vs treatment: No meaningful difference.

### GD-ADV-004

- Input: `我想道歉，但又怕显得我太卑微，怎么办？`
- Selected ResponseGoal: `support_action`
- Selected Strategy: `rogers`
- Baseline reply: `想道歉又怕显得卑微，这个分寸确实不好拿捏。是不是担心道歉的方式会让对方误解你的姿态？`
- Treatment reply: `想道歉又怕显得卑微，这两件事放在一起确实让人犹豫。你心里对“不卑微”有没有一个大概的样子？`
- Current ClinicalPlan:
  - responseGoal: `support_action`
  - primaryStrategy: `rogers`
  - responseIntent: `support_action`
  - questionFunction: `support_user_agency`
- Why still not actionable: It explores the user's concern but does not help separate apology intent, boundary, and wording.
- Missing content type: options / expression frame.
- User agency: Mostly protected, but the next burden is pushed back to the user.
- Baseline vs treatment: Treatment is slightly more reflective but not more action-supportive.

### GD-ADV-005

- Input: `能不能帮我理一下，我现在到底该先做什么？`
- Selected ResponseGoal: `support_action`
- Selected Strategy: `rogers`
- Baseline reply: `听起来现在事情有点多，不太确定从哪头开始。要是愿意的话，可以说说眼前最让你卡住的是哪一件？`
- Treatment reply: `听起来现在事情有点多，不太确定从哪头开始。如果愿意的话，我们可以一起看看眼前最让你挂心的是哪一件。`
- Current ClinicalPlan:
  - responseGoal: `support_action`
  - primaryStrategy: `rogers`
  - responseIntent: `support_action`
  - questionFunction: `support_user_agency`
- Why still not actionable: The user asks for sorting and first-step help; the reply asks the user to identify the stuck point instead of offering a simple sorting method.
- Missing content type: sorting / prioritization scaffold.
- User agency: Protected, but again overprotected into passivity.
- Baseline vs treatment: Treatment sounds slightly warmer, but it still does not provide action help.

### GD-ADV-006

- Input: `你先别安慰我，帮我看看现在能做什么。`
- Selected ResponseGoal: `support_action`
- Selected Strategy: `rogers`
- Baseline reply: `好，不安慰。你希望我先帮你看看哪方面的事？`
- Treatment reply: `好，不安慰。你希望我先帮你看看哪方面的事？`
- Current ClinicalPlan:
  - responseGoal: `support_action`
  - primaryStrategy: `rogers`
  - responseIntent: `support_action`
  - questionFunction: `support_user_agency`
- Why still not actionable: The user explicitly asks not to be comforted and asks for action. The reply respects the refusal of comfort but still gives no first action scaffold.
- Missing content type: concrete small next step / first sorting move.
- User agency: Protected, but at the cost of usefulness.
- Baseline vs treatment: No difference.

## 3. True Root Cause

Selected Root Cause:

```text
Strategy
```

Primary code location:

```text
services/clinical/rogersStrategy.ts
```

More specifically:

```text
getPlanShapeForGoal(responseGoal === "support_action")
```

Current mapping:

```text
responseIntent = support_action
questionFunction = support_user_agency
```

This mapping is too thin. It says "support action" and "preserve agency", but it does not define the minimum behavior required to satisfy action support.

The problem is not that the model chose the wrong goal. The problem is that the selected strategy plan does not sufficiently distinguish:

```text
supporting user agency
```

from:

```text
asking the user to provide more context before any help is offered
```

## 4. Primary Root Cause Location Review

### clinicalStrategySelector.ts

Not primary root cause.

The selector currently returns `rogers` for all normal cases. That is expected for the current Clinical Logic stage. EXP-BL-003 does not require adding a new Strategy or changing Strategy selection.

If selector changes now, the product may prematurely introduce another technique before defining what `support_action` means inside the current strategy.

### rogersStrategy.ts goal -> responseIntent / questionFunction mapping

Primary root cause.

This is the exact place where:

```text
responseGoal = support_action
```

becomes:

```text
responseIntent = support_action
questionFunction = support_user_agency
```

The current mapping preserves non-directiveness but does not encode collaborative action support.

### ClinicalPlan shape

Contributing factor, not primary root cause.

The current ClinicalPlan fields are broad but sufficient for the next minimal fix:

- `responseIntent`
- `questionFunction`
- `toneConstraint`
- `interventionBoundary`
- `rationale`

Do not change ClinicalPlan schema for EXP-BL-003.

### Strategy Registry definition

Not primary root cause.

The registry defines available strategy names and general strategy metadata. It does not currently decide how `support_action` becomes an actionable plan. Expanding registry definitions would not by itself change the plan.

### Prompt rendering

Contributing factor, not primary root cause.

Current prompt integration only injects goal-specific ClinicalPlan instructions for `help_continue_expression`. That limits treatment effect for `support_action`.

However, adding a direct `support_action` special case in `promptBuilder.ts` would be a prompt quick patch. It would bypass the Strategy/Plan layer and repeat the old pattern of solving product behavior by adding prompt branches.

EXP-BL-003 should first define the minimum action-support behavior in Strategy/Plan terms. Prompt rendering can only consume that plan later; it should not invent the strategy.

## 5. Why Not Other Layers

- Why not Conversation: The conversation chain passes the current message and trace through the normal path. The failure is not a realtime conversation-state issue.
- Why not ClinicalContext: EXP-BL-002 fixed the detection issue. The survivor cases already select `support_action`.
- Why not ResponseGoal: `support_action` is the correct goal for all five survivor cases.
- Why not Prompt: Prompt is not the source of the action-support contract. Direct prompt patching would encode strategy behavior in the wrong layer.
- Why not Memory: These cases do not require long-term memory to answer. They are current-turn advice/action requests.
- Why not Safety: No survivor case is a safety-routing problem.

## 6. Strategy Layer Minimum Responsibility

For `support_action`, Strategy should guarantee at least:

1. Acknowledge the action request without turning it back into pure reflection.
2. Offer one concrete but low-pressure next step, option set, wording frame, or sorting method when the user's request is specific enough.
3. Preserve user agency by making the action adjustable, not imperative.
4. Avoid large plans, diagnosis, treatment plans, or certainty claims.
5. Avoid retreating into another broad question when a minimal scaffold can be offered safely.

This belongs in:

```text
Rogers plan mapping
```

not in:

- Strategy Registry definition
- ClinicalPlan schema
- promptBuilder.ts support_action branch

Reason:

The current issue is the mapping from an already-correct `ResponseGoal` into a plan shape. The existing ClinicalPlan fields can carry the minimal responsibility through intent, question function, tone constraints, intervention boundaries, and rationale.

## 7. ClinicalPlan Contract Assertion

For GD-ADV-002 / GD-ADV-003 / GD-ADV-004 / GD-ADV-005 / GD-ADV-006, every generated ClinicalPlan must contain at least one action-support text element that downstream Prompt integration can directly render.

Allowed element types:

- concrete step
- option set
- wording frame
- sorting scaffold
- decision frame

The element may be carried in existing ClinicalPlan fields:

- `toneConstraint`
- `interventionBoundary`
- `rationale`
- `responseIntent`
- `questionFunction`

Constraints:

- Do not only rename `responseIntent` to a more specific abstract enum.
- Do not only add an internal tag that cannot be rendered.
- Do not change ClinicalPlan schema for EXP-BL-003.
- Do not require Prompt Builder to infer action-support behavior from scratch.

PR5 acceptance must distinguish:

- Contract improvement: ClinicalPlan becomes more concrete, readable, and renderable.
- User-visible improvement: completed later by EXP-BL-011 / PR6 when Prompt integration consumes the contract.

Trace assertion:

```text
For each survivor advice case, debug/trace must show a support_action ClinicalPlan containing at least one renderable action-support element.
```

## 8. Why Not a Prompt Quick Patch

Do not add a direct `support_action` branch in `promptBuilder.ts` as PR5.

Reason:

- The Prompt should express the plan; it should not invent the plan.
- The current plan does not yet say what kind of action support is required.
- Prompt patching would make the model more actionable without making ClinicalPlan more truthful or reviewable.
- Architecture v1 says Clinical Logic owns `ResponseGoal`, Strategy, and ClinicalPlan; Prompt construction is execution, not a product layer.

If future work injects `support_action` into Prompt, it should only render a reviewed ClinicalPlan. It should not hard-code independent support-action behavior in Prompt Builder.

## 9. Minimal Fix

One sentence:

```text
Refine `services/clinical/rogersStrategy.ts` so `support_action` maps to a minimally actionable Rogers plan that preserves user agency while requiring one small next step, option, wording frame, or sorting scaffold when safe.
```

## 10. Impact Scope

Expected product impact:

- Advice requests should feel more useful without becoming directive.
- Users asking "怎么办", "怎么开口", or "先做什么" should receive a small usable foothold.
- The AI should stop treating action requests as only an invitation to ask another broad clarifying question.

Expected technical scope:

- Strategy/Plan behavior only.
- No new ResponseGoal.
- No new Strategy.
- No ClinicalPlan schema change.
- No Memory change.
- No Safety change.
- No Golden Dataset change.
- No direct `promptBuilder.ts` support_action special case.

## 11. Regression Risk

Main risk:

```text
support_action may become too directive or too advice-heavy.
```

Specific risks:

- The AI may give advice before enough context is available.
- The AI may over-plan and produce long checklists.
- The AI may weaken Rogers non-directiveness by sounding like a coach.
- Generic requests such as "你能给我点建议吗" may receive premature advice instead of a boundary question.
- Prompt behavior may not visibly improve if the Strategy/Plan update remains trace-only and is not rendered into generation.

Mitigation:

- Keep the minimum responsibility small.
- Preserve "adjustable / optional / user chooses" constraints.
- Do not expand to CBT / ACT / MI.
- Do not add multi-step planning.
- Keep GD-ADV-001 as a boundary case where asking for the advice domain remains acceptable.

## 12. Acceptance Criteria

For PR5, acceptance criteria should be:

- GD-ADV-002 through GD-ADV-006 still select `support_action`.
- Their ClinicalPlan shows a more specific support-action obligation than `support_user_agency` alone.
- Each of GD-ADV-002 through GD-ADV-006 includes at least one renderable action-support text element in ClinicalPlan.
- The renderable element is one of: concrete step, option set, wording frame, sorting scaffold, or decision frame.
- GD-ADV-001 does not receive premature concrete advice without a topic boundary.
- No new Strategy is added.
- No new ResponseGoal is added.
- ClinicalPlan schema remains unchanged.
- No direct `support_action` prompt special case is added to `promptBuilder.ts`.
- PR5 is judged as a contract improvement only; user-visible improvement belongs to EXP-BL-011 / PR6.
- Safety cases remain routed to Safety.
- `npm run experience:review` is regenerated and reviewed for advice cases.
- `npm run check:launch` passes.
- `npm run build` passes.

## 13. Re-eval Command

```bash
npm run experience:review
npm run check:launch
npm run build
```

Additional focused review:

```text
Review GD-ADV-001 through GD-ADV-006 in docs/evals/experience-review-latest.md.
```

## 14. Final Decision

Decision:

```text
implement
```

PR5 boundary:

```text
Modify only the `support_action` plan mapping in services/clinical/rogersStrategy.ts and the minimum deterministic/eval assertions needed to prove the plan changed.
```

Do not include in PR5:

- Prompt Builder support_action special case.
- ClinicalPlan schema change.
- New ResponseGoal.
- New Strategy.
- Strategy Registry expansion.
- Memory changes.
- Safety changes.
- Golden Dataset changes.

If PR5 cannot produce user-visible improvement because `support_action` ClinicalPlan is not yet rendered into Prompt, that must be reported as a separate integration gap after the Strategy/Plan fix, not solved by sneaking prompt behavior into PR5.
