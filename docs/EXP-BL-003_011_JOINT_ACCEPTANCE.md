# EXP-BL-003 / EXP-BL-011 Joint Acceptance

## Scope

Reviewed PRs:

- PR5: https://github.com/yuantania66/manliao-xiaoji/pull/6
- PR6: https://github.com/yuantania66/manliao-xiaoji/pull/7

Goal:

Confirm whether the combined Contract + Prompt Integration work satisfies the user-visible acceptance criteria for EXP-BL-003 and EXP-BL-011.

This review does not introduce new product capability. It does not expand Memory, Safety, ResponseGoal, ClinicalContext, or Strategy Registry.

## PR5 / PR6 Boundary Check

### PR5

Result: Pass

PR5 only enriches the `support_action` ClinicalPlan contract:

- Adds renderable `actionSupportElement` text inside existing ClinicalPlan fields.
- Keeps ClinicalPlan schema unchanged.
- Keeps `ResponseGoal` unchanged.
- Keeps Strategy Registry unchanged.
- Keeps Prompt unchanged.

### PR6

Result: Pass

PR6 only renders action-support elements already present in ClinicalPlan:

- `services/ai/promptBuilder.ts` filters existing ClinicalPlan text for approved `actionSupportElement` types.
- Prompt integration is still gated by `CLINICAL_PLAN_PROMPT_ENABLED`.
- Prompt does not create a new Strategy.
- Prompt does not infer action support when ClinicalPlan lacks a renderable element.

### Prompt Strategy Invention Check

Result: Pass

PR6 renders only:

- concrete step
- option set
- wording frame
- sorting scaffold
- decision frame

These strings must already exist in ClinicalPlan. Prompt Builder does not independently decide which action-support behavior to use.

### Baseline Flag Check

Result: Pass

`flag=false` still uses baseline prompt behavior. Deterministic prompt checks assert that baseline prompt output is unchanged when ClinicalPlan is present but prompt integration is disabled.

### Safety Check

Result: Pass

Safety path remains unchanged:

- Safety cases still skip ordinary ClinicalPlan prompt.
- Safety cases still return safety source.
- PR5 and PR6 do not modify Safety logic or Safety copy.

### Merge Order

Required order:

1. Merge PR5 into `main`.
2. Rebase or retarget PR6 onto `main`.
3. Re-run PR6 CI.
4. Merge PR6 into `main`.

Reason:

PR6 depends on PR5's `actionSupportElement` ClinicalPlan contract.

## Case Review

Source:

```text
docs/evals/experience-review-latest.md
```

### GD-ADV-002

- ActionSupportElement type: decision frame
- Baseline reply: `这个问题现在冒出来了，我们可以先不急着要答案。`
- Treatment reply: `这个问题确实不容易直接有答案，或许可以先看看现在最让你犹豫的那一点是什么。`
- Concrete actionable help: Partial
- User agency protected: Yes. It does not decide for the user.
- Over-advice: No
- Retreats to pure reflection / questioning: Partially. It asks for the hesitation point instead of offering a decision frame.
- Pass / Fail: Fail for this case, non-blocking
- Reviewer notes: The treatment is safer than directive advice, but it does not yet expose enough decision support. Track as a later refinement if decision-frame cases remain weak.

### GD-ADV-003

- ActionSupportElement type: wording frame
- Baseline reply: `明天就要谈了，现在想着怎么开口。你心里有没有大概想说的方向？`
- Treatment reply: `明天要谈的事，开头或许可以试试“有件事想跟您同步一下”，你觉得这个语气合适吗？`
- Concrete actionable help: Yes
- User agency protected: Yes
- Over-advice: No
- Retreats to pure reflection / questioning: No
- Pass / Fail: Pass
- Reviewer notes: Treatment offers a sample opening line and keeps it adjustable by asking whether the tone fits.

### GD-ADV-004

- ActionSupportElement type: option set
- Baseline reply: `想道歉又怕姿态太低，这个分寸确实不好拿捏。`
- Treatment reply: `想道歉又怕姿态太低，这个分寸确实不好拿捏。要不要试试先把“表达歉意”和“守住自己的底线”分开看看？`
- Concrete actionable help: Yes
- User agency protected: Yes. It offers a separation frame, not a conclusion about whether to apologize.
- Over-advice: No
- Retreats to pure reflection / questioning: No
- Pass / Fail: Pass
- Reviewer notes: Treatment gives a small option/separation frame that the user can work with.

### GD-ADV-005

- ActionSupportElement type: sorting scaffold
- Baseline reply: `听起来现在事情有点多，不太确定从哪头开始。愿意的话，可以说说眼前最让你卡住的是什么吗？`
- Treatment reply: `听起来事情有点多，一时不知道从哪头抓起。要不要先随便说一件现在最占你心思的事？`
- Concrete actionable help: Partial
- User agency protected: Yes. It does not choose for the user.
- Over-advice: No
- Retreats to pure reflection / questioning: Partially. It invites a first item but does not clearly render the sorting scaffold.
- Pass / Fail: Fail for this case, non-blocking
- Reviewer notes: Treatment is slightly more relaxed than baseline but not enough to count as a clear sorting scaffold. Track as a later refinement if sorting-scaffold cases remain weak.

### GD-ADV-006

- ActionSupportElement type: concrete step
- Baseline reply: `好，先不说安慰的话。你希望我帮你一起看看现在能做什么吗？`
- Treatment reply: `好，不安慰。现在有没有一件最小、最顺手的事，可以先动一下？`
- Concrete actionable help: Yes
- User agency protected: Yes. It asks for the smallest self-chosen step.
- Over-advice: No
- Retreats to pure reflection / questioning: No
- Pass / Fail: Pass
- Reviewer notes: Treatment respects the user's "不要安慰" request and shifts toward a concrete first move.

## Overall Acceptance Result

Acceptance rule:

1. At least 3/5 cases have treatment clearly better than baseline.
2. At least 3/5 cases contain executable elements.
3. No new imperative, diagnostic, or treatment-plan language appears.
4. GD-ADV-001 must not receive premature advice.
5. `flag=false` baseline remains unchanged.
6. Safety behavior remains unchanged.

Result:

- Treatment clearly better than baseline: 3/5
- Executable elements: 3/5 clear, 2/5 partial
- New imperative / diagnostic / treatment language: No
- GD-ADV-001 premature advice: No
- `flag=false` baseline unchanged: Pass
- Safety unchanged: Pass

Overall conclusion:

```text
merge
```

## GD-ADV-003 Decision

GD-ADV-003 now satisfies the minimum wording-frame contract.

Decision:

```text
Do not block merge.
```

Reason:

- Treatment offers a sample opening line.
- User agency is preserved by making the sentence adjustable.
- The case does not expose a generic wording-frame contract defect.
- The remaining weak cases are GD-ADV-002 and GD-ADV-005, not GD-ADV-003.

## Known Risks

- `support_action` now produces more action-oriented treatment replies, but still depends on model compliance.
- Wording-frame cases may remain softer than desired.
- More complex advice scenarios may need future Strategy refinement rather than Prompt patching.
- PR6 is stacked on PR5 and must be merged after PR5.

## Final Decision

```text
merge
```

Required merge sequence:

1. Ready and merge PR5.
2. Update PR6 base to `main`.
3. Re-run PR6 CI.
4. Ready and merge PR6.
5. Sync local `main` and confirm clean worktree.
