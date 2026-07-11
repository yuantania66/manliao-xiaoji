# EXP-BL-003 Survivor Analysis

## Source

This analysis was produced after PR #4 was merged into `main` and the latest full Experience Review was regenerated:

```text
npm run experience:review
```

Input report:

```text
docs/evals/experience-review-latest.md
```

Scope:

- Only `advice` category cases were reviewed.
- No code was changed for this analysis.
- Machine checks were not used as experience judgement.

## Executive Decision

EXP-BL-002 fixed the primary ClinicalContext issue: all advice cases now select `support_action` in both baseline and treatment branches.

However, 5 advice cases still show a user-facing problem after `support_action` is selected: the reply asks for more context or reflects the request, but does not provide enough practical action support.

Decision:

```text
Keep EXP-BL-003 as P0.
Do not write Strategy code yet.
Next allowed action: create docs/EXP-BL-003_REVIEW.md.
```

This follows decision rule B:

```text
If still-problematic support_action cases >= 3, keep EXP-BL-003 as P0.
```

## Advice Case Review

### GD-ADV-001

- Input: `你能给我点建议吗？`
- Selected ResponseGoal: `support_action`
- Baseline reply: `可以，只是我还不太清楚你想聊哪方面。`
- Treatment reply: `可以，不过我想先听听你大概想聊哪方面的事。`
- Still has experience problem: Partial / not counted as clear survivor
- Current Root Cause candidate: Strategy
- Why not ClinicalContext: The case is correctly routed to `support_action`. The remaining issue is that the request is under-specified, so asking for a topic boundary is reasonable, but the reply could still offer a clearer shape of help.

### GD-ADV-002

- Input: `我该不该辞职？`
- Selected ResponseGoal: `support_action`
- Baseline reply: `这个问题现在冒出来了，我们可以先在这儿待一下。`
- Treatment reply: `这个问题现在冒出来了，我们可以先不急着要答案。`
- Still has experience problem: Yes
- Current Root Cause candidate: Strategy
- Why not ClinicalContext: `support_action` is already selected. The failure is that the answer stays in reflection and does not offer even a minimal decision-support frame.

### GD-ADV-003

- Input: `我明天要跟领导谈，怎么开口比较好？`
- Selected ResponseGoal: `support_action`
- Baseline reply: `明天要谈这件事，现在是不是还在想怎么起头？`
- Treatment reply: `明天要谈这件事，现在是不是还在琢磨怎么起头？`
- Still has experience problem: Yes
- Current Root Cause candidate: Strategy
- Why not ClinicalContext: `support_action` is already selected. The user asks for an opening line, but the reply only reflects that the user is thinking about the opening.

### GD-ADV-004

- Input: `我想道歉，但又怕显得我太卑微，怎么办？`
- Selected ResponseGoal: `support_action`
- Baseline reply: `想道歉又怕显得卑微，这个分寸确实不好拿捏。是不是担心道歉的方式会让对方误解你的姿态？`
- Treatment reply: `想道歉又怕显得卑微，这两件事放在一起确实让人犹豫。你心里对“不卑微”有没有一个大概的样子？`
- Still has experience problem: Yes
- Current Root Cause candidate: Strategy
- Why not ClinicalContext: `support_action` is already selected. The remaining problem is that the reply explores the concern but does not provide a small usable way to approach the apology.

### GD-ADV-005

- Input: `能不能帮我理一下，我现在到底该先做什么？`
- Selected ResponseGoal: `support_action`
- Baseline reply: `听起来现在事情有点多，不太确定从哪头开始。要是愿意的话，可以说说眼前最让你卡住的是哪一件？`
- Treatment reply: `听起来现在事情有点多，不太确定从哪头开始。如果愿意的话，我们可以一起看看眼前最让你挂心的是哪一件。`
- Still has experience problem: Yes
- Current Root Cause candidate: Strategy
- Why not ClinicalContext: `support_action` is already selected. The user asks for help deciding the first step; the reply asks the user to identify the stuck point instead of offering a minimal sorting method.

### GD-ADV-006

- Input: `你先别安慰我，帮我看看现在能做什么。`
- Selected ResponseGoal: `support_action`
- Baseline reply: `好，不安慰。你希望我先帮你看看哪方面的事？`
- Treatment reply: `好，不安慰。你希望我先帮你看看哪方面的事？`
- Still has experience problem: Yes
- Current Root Cause candidate: Strategy
- Why not ClinicalContext: `support_action` is already selected. The user explicitly says not to comfort and asks for action; the reply still asks for scope and gives no immediate action scaffold.

## Survivor Count

Clear surviving cases:

```text
5
```

Cases:

- GD-ADV-002
- GD-ADV-003
- GD-ADV-004
- GD-ADV-005
- GD-ADV-006

GD-ADV-001 remains weak but is not counted as a clear survivor because the user did not provide an action domain.

## EXP-BL-003 Final Status

```text
P0 retained.
```

Reason:

- EXP-BL-002 solved the detection problem.
- The remaining problem occurs after `support_action` is selected.
- The current likely root cause is Strategy, not ClinicalContext.
- The next step must be a focused review of what minimum `support_action` means before any code change.

## Next Single Action

Create:

```text
docs/EXP-BL-003_REVIEW.md
```

Do not implement PR #5 until that review confirms:

- the exact action-support behavior expected,
- what Strategy is allowed to do,
- what Strategy must not do,
- how to avoid turning support into premature advice.
