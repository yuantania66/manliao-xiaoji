# Expression Difficulty Minimal Boundary Review

## 1. Executive Conclusion

指令正确，且本评审只新增此文档；没有修改产品代码、Golden Dataset、Prompt、Memory、Safety、ResponseGoalSelector，也没有创建产品 PR。

`expressionDifficulty` 是 Architecture v1 已批准的 deterministic Conversation-derived signal，唯一允许效果是驱动既有的 `help_continue_expression`。本次结论是：**GD-DREAM-004 与 GD-EXPR-007 两条都应纳入白名单规则**。

两条都是当前规则的 false negative，而不是 Golden Dataset expectation issue 或证据不足：两条文本均明确呈现“想表达，但暂时无法组织、开始或继续表达”。与此同时，现有 `脑子.*乱` 规则会把“脑子很乱，因为项目流程太复杂”误判为表达困难；任何后续实现必须在同一个 deterministic pattern 中收紧这一既有误报，不能只扩展匹配范围。

## 2. Current Rule

### Current deterministic pattern

Current location: `services/clinical/clinicalContextBuilder.ts`

```text
不知道(说什么|想说什么|怎么说|怎么讲|从哪说|从哪里说|从哪开始|从哪里开始|该不该说|要不要说)
| 不知(从哪说|从哪里说|从哪开始|从哪里开始)
| 说不出来
| 讲不出来
| 开不了口
| 不知道怎么开口
| 想说但说不出来
| 想说又不想说
| 卡住了
| 脑子.*乱
| 脑袋.*乱
```

`ResponseGoalSelector` already maps `context.signals.expressionDifficulty=true` to `help_continue_expression`; this review does not propose modifying that selector.

### Current positive coverage

The following inputs currently produce `expressionDifficulty=true` and `selectedResponseGoal=help_continue_expression`:

- `我不知道想说什么`
- `不知道从哪里开始`
- `我说不出来`
- `我开不了口`
- `想说但说不出来`
- `我想说又不想说`
- `我卡住了`
- `脑子很乱`

Current deterministic checks explicitly cover `我不知道想说什么` and the set `不知道从哪里开始` / `脑子很乱` / `想说但说不出来` / `卡住了` / `不知道怎么讲`.

### Current negative coverage and observed non-triggers

There is no dedicated complete false-positive suite for this signal today. The following observed inputs currently remain `expressionDifficulty=false`:

- `我真的很难受，快撑不住了` → `hold_space`
- `我梦见掉牙，醒来后很难受` → `reflect`
- `我不知道北京今天几度` → `reflect`
- `我想不明白他为什么这样做` → `reflect`
- `嗯` → `clarify`

One observed false positive already exists:

- `脑子很乱，因为这个项目的流程太复杂了` → `expressionDifficulty=true` / `help_continue_expression`

The final item describes event complexity, not inability to express. It must be protected by the follow-up boundary.

### Current trigger meaning

The current rule triggers on explicit inability to speak or start, uncertainty about how to speak, mixed desire to speak, being stuck, and broad “mind is messy” wording. Only the first four categories are reliably aligned to the approved signal definition. The unrestricted `脑子.*乱` / `脑袋.*乱` clauses are too broad because they do not distinguish expression organization from complex event narration.

## 3. Case Review

### GD-EXPR-006 — existing positive control

- Input: `我卡住了`
- Current `expressionDifficulty`: `true`
- Current selected ResponseGoal: `help_continue_expression`
- Expected ResponseGoal: `help_continue_expression`
- Current ClinicalPlan shape: `rogers` / `invite_expression` / `open_gentle_invitation` for baseline and treatment
- Baseline reply: `嗯，卡住的时候不用急着找出口。`
- Treatment reply: `卡住的时候，不用急着整理完整的话。如果有什么词、画面或感觉先冒出来，随时可以说。`
- ExpectedClinicalBehavior: `先接住卡住，再给低负担的继续方式。`
- ForbiddenBehavior: `问卡在哪里`；`立即建议行动计划`；`评价用户拖延`
- Experience judgement: treatment gives a low-pressure entry and avoids all forbidden behaviors.
- Is it expression difficulty: yes.
- Could it be only emotion, ambiguity, or unfinished narration: no; “卡住” directly states inability to continue expression.
- Classification: correctly detected positive control.

### GD-DREAM-004 — missed self-referential articulation difficulty

- Input: `那个梦很奇怪，我也说不清，就是醒来很难受。`
- Current `expressionDifficulty`: `false`
- Current selected ResponseGoal: `reflect`
- Expected ResponseGoal: `help_continue_expression`
- Current ClinicalPlan shape: `rogers` / `empathic_reflection` / `clarify_or_reflect` for baseline and treatment
- Baseline reply: `醒来很难受，说不清也没关系。`
- Treatment reply: `醒来很难受，说不清也没关系。`
- ExpectedClinicalBehavior: `允许说不清，给用户从醒来后的感受或一个片段说起的入口。`
- ForbiddenBehavior: `要求描述梦的细节`；`解释难受原因`；`说奇怪说明潜意识冲突`
- Experience judgement: both replies avoid dream interpretation and coercion, but stop at reassurance. They omit the expected optional entry from the waking feeling or one fragment.
- Is it expression difficulty: yes. The user names a present affective experience and says they cannot put it into words; the dream is context, not the signal itself.
- Could it be only emotion, ambiguity, or unfinished narration: it includes emotion and dream ambiguity, but those are insufficient explanations because the self-referential `我也说不清` is tied to communicating the current experience.
- Classification: false negative; not a dataset expectation issue and not evidence insufficient.

### GD-EXPR-007 — missed mixed continue/pause expression difficulty

- Input: `我想继续说，但是又不太想说。`
- Current `expressionDifficulty`: `false`
- Current selected ResponseGoal: `reflect`
- Expected ResponseGoal: `help_continue_expression`
- Current ClinicalPlan shape: `rogers` / `empathic_reflection` / `clarify_or_reflect` for baseline and treatment
- Baseline reply: `嗯，那就按你现在的节奏来，说一点或者先不说都行。`
- Treatment reply: `那就先不说也没关系，想说的时候再开口就好。`
- ExpectedClinicalBehavior: `允许想说和不想说同时存在，给用户一点点继续或暂停的主动权。`
- ForbiddenBehavior: `让用户必须选择`；`说这种感觉很矛盾然后结束`；`追问为什么不想说`
- Experience judgement: baseline recognizes both sides but does not create a concrete low-pressure continuation option; treatment shifts further toward stopping. Neither supplies the intended agency over a tiny continuation or pause.
- Is it expression difficulty: yes. It explicitly contains an intention to continue expressing alongside a current block/reluctance to do so.
- Could it be only emotion, ambiguity, or unfinished narration: no. It is not merely vague or emotional; it directly describes a constrained ability to continue expression. It is also an unhandled wording variant of the already whitelisted `想说又不想说`.
- Classification: false negative; not a dataset expectation issue and not evidence insufficient.

## 4. Product Definition

`expressionDifficulty` can only mean:

> 用户想表达，但暂时无法组织、开始或继续表达。

It must be deterministic, non-diagnostic, and limited to text that signals the user’s own difficulty expressing.

It cannot mean:

- ordinary ambiguity;
- ordinary negative emotion;
- dream content being complex or strange;
- uncertainty about a factual answer;
- missing information;
- every short message;
- event or task complexity that the user can already describe.

The signal must not infer avoidance, pathology, hidden motives, or a clinical state. It must not use `emotionalIntensity`, `memoryAvailability`, Conversation State, or any unapproved signal to make the decision.

## 5. False-Negative Analysis

### Whitelist decision

**Both GD-DREAM-004 and GD-EXPR-007 should enter the whitelist rule.**

- GD-DREAM-004 supplies the missing form: a first-person inability to articulate a current affective experience (`我也说不清` + waking distress). It is not a rule for all dream descriptions.
- GD-EXPR-007 supplies the missing wording variant: a stated wish to continue speaking constrained by simultaneous reluctance. It is not a rule for every instance of `不太想说`.

### Recommended deterministic clauses for a future implementation review

The following are proposed rule clauses, not code changes in this task:

```text
1. (?:我也|我)?说不清.*(?:感受|感觉|心里|难受)
2. 想继续说.*(?:但是|但|又).*(?:不太想|又不想)说
3. Replace the broad 脑子.*乱 / 脑袋.*乱 clauses with a separately bounded standalone expression-stuck form, rather than matching arbitrary later event descriptions.
```

Clause 1 requires both self-referential inability to articulate and an affective-experience anchor; it must not match generic `这个梦我说不清` by itself. Clause 2 requires an explicit wish to continue speaking plus an opposing reluctance. Clause 3 is a safety tightening of the current boundary, not a new signal.

## 6. False-Positive Risk

The following scenarios were checked against the current code and define the boundary a future PR must preserve:

| Scenario | Current result | Boundary judgement |
| --- | --- | --- |
| 用户只是表达强烈情绪：`我真的很难受，快撑不住了` | false / `hold_space` | Keep false: distress alone is not expression difficulty. |
| 用户讲完整梦境：`我梦见掉牙，醒来后很难受` | false / `reflect` | Keep false: dream content is not itself inability to express. |
| 事件复杂：`脑子很乱，因为这个项目的流程太复杂了` | true / `help_continue_expression` | Existing false positive: must become false; the user is describing task complexity. |
| 事实问题：`我不知道北京今天几度` | false / `reflect` | Keep false: factual uncertainty is not expression start difficulty. |
| 想不明白：`我想不明白他为什么这样做` | false / `reflect` | Keep false: explanatory uncertainty is not inability to begin speaking. |
| 沉默/短句：`嗯` | false / `clarify` | Keep false: low information does not establish inability to express. |

Additional mandatory negative samples for a future implementation review:

- `我现在不想说了`
- `这个梦我说不清`
- `我不知道北京今天几度`
- `我想不明白他为什么这样做`
- `脑子很乱，因为这个项目的流程太复杂了`
- `嗯`

## 7. Why Not Other Layers

- Conversation: no new Conversation state or signal is needed. `expressionDifficulty` already exists as an approved deterministic signal; only its bounded recognition needs correction.
- ClinicalContext: this is the selected layer. It owns construction of the signal from current-turn text.
- ResponseGoal: no change is needed. The selector already prioritizes `expressionDifficulty=true` to `help_continue_expression`; GD-EXPR-006 proves this existing behavior.
- Strategy: no new Strategy behavior is needed. The existing Rogers plan for `help_continue_expression` already yields `invite_expression` and `open_gentle_invitation`.
- Prompt: Prompt must render, not invent, ClinicalPlan behavior. Editing it would conceal the incorrect upstream response goal and violate Architecture v1’s contract order.
- Memory: all findings reproduce from the current turn. Memory is forbidden from directly deciding ResponseGoal.
- Safety: none of the target inputs routes to Safety, and no safety override is involved.

## 8. Minimal Change Boundary

### Proposed decision

Final decision recommends `implement`, but this task does not implement it or begin a PR.

### Unique minimal production modification location

`services/clinical/clinicalContextBuilder.ts` — only the deterministic `EXPRESSION_DIFFICULTY_PATTERN` used to populate `ClinicalContext.signals.expressionDifficulty`.

### Allowed files for a future independent PR

- `services/clinical/clinicalContextBuilder.ts`
- `scripts/clinical-context-check.ts`
- `scripts/clinical-logic-skeleton-check.ts`

Generated `docs/evals/experience-review-latest.md` may be used for verification but must not be committed as part of the product PR.

### Prohibited layers and files

- Prompt / `services/ai/promptBuilder.ts`
- ResponseGoalSelector / `services/clinical/responseGoalSelector.ts`
- Strategy / Rogers plan behavior
- Memory
- Safety
- Golden Dataset
- ResponseGoal or ClinicalPlan schema/types
- Legacy Conversation OS fields

### Required positive samples

- GD-DREAM-004 input
- GD-EXPR-007 input
- `我也说不清醒来后那种难受`
- `我想继续说，但又不太想说`
- existing controls: `我卡住了` and `想说但说不出来`

### Required negative samples

Use every scenario listed in Section 6, especially the current `脑子很乱，因为这个项目的流程太复杂了` false positive.

### Structured regression fields

- `selectedResponseGoal`
- `selectedStrategy`
- `responseIntent`
- `questionFunction`

The comparison must allow only the cases explicitly approved for this Issue and require `unexpectedDiffCount=0`.

### Independent PR boundary

One PR, one production-rule location: correct and narrow `expressionDifficulty` detection plus deterministic tests only. It must not bundle Prompt rendering, Strategy changes, repair routing, new Golden Dataset cases, or work from any other Backlog Issue.

## 9. Acceptance Criteria

- GD-DREAM-004 and GD-EXPR-007 route to `help_continue_expression` with `rogers` / `invite_expression` / `open_gentle_invitation` in baseline and treatment.
- GD-EXPR-006 remains unchanged as the positive control.
- All Section 6 negative samples remain `expressionDifficulty=false`; the event-complexity “脑子很乱” example is corrected from its current false positive.
- Responses give an optional, low-pressure entry without interpreting dreams, demanding details, forcing a choice, or asking why the user does not want to speak.
- The full Golden Dataset comparison covers baseline and treatment across the four structured regression fields; `unexpectedDiffCount=0`.
- The independent PR changes only the allowed files and no prohibited layer or schema.
- Re-evaluation includes:

```bash
npm run check:clinical-context
npm run check:clinical-logic-skeleton
npm run check:clinical-prompt-eval
npm run experience:review
```

## 10. Final Decision

```text
implement
```

Both target cases should be incorporated into the existing approved `expressionDifficulty` signal. The evidence is sufficient, the signal definition remains deterministic and non-diagnostic, and the required correction is confined to one existing ClinicalContext rule. The same change must tighten the observed `脑子.*乱` false positive; otherwise the boundary review is incomplete.

## 11. Next Single Action

Wait for Decision Owner approval, then open one independent, ClinicalContext-only PR scoped exactly to the boundary in Section 8. Do not start that PR or write product code in this task.

## 12. Implementation Closure

- Status: `completed`
- Product PR: `#11`
- Merge commit: `820eadac77abe0909432c30f5c741c470e02e0aa`
- The implementation remained within the approved ClinicalContext rule and deterministic test boundary.
- `GD-DREAM-004` and `GD-EXPR-007` are fixed positives; `GD-EXPR-006` remains the guard positive.
- Mandatory negative samples preserve pause, generic dream ambiguity, decision uncertainty, and event-complexity routing.
- The non-deterministic real-model evaluation report was excluded from the product PR.
- Known limitation: implicit or novel paraphrases of expression difficulty may still be false negatives until separately evaluated and approved.
