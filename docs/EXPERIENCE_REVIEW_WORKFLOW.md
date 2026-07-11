# Experience Review Workflow

## 1. Purpose

Experience Review v1 turns the Golden Dataset into a human review package.

It does not change product behavior. It does not add `ResponseGoal`, Strategy, Prompt, Memory, Safety, or default feature flags.

The review question is:

> Does the current official chain make the user feel that AI is sincerely trying to understand them?

The package is built for human review, not automatic scoring.

## 2. Input

Canonical dataset:

```text
clinical-evals/golden-dataset-v1.json
```

The runner must not modify the dataset.

Each case contains:

- `id`
- `category`
- `input`
- `expectedResponseGoal`
- `forbiddenBehavior`
- `expectedClinicalBehavior`
- `notes`

## 3. Runtime Chain Under Review

For every case, the runner calls the current official reply entrypoint:

```text
createChatReply()
  -> Safety
  -> ClinicalContext
  -> approved signals
  -> ResponseGoal
  -> Strategy
  -> ClinicalPlan
  -> Prompt
  -> LLM reply
```

The runner must not reimplement clinical selection or produce template replies.

## 4. Baseline vs Treatment

Each case is run twice:

```text
baseline:
CLINICAL_PLAN_PROMPT_ENABLED=false

treatment:
CLINICAL_PLAN_PROMPT_ENABLED=true
```

The flag is set only inside the eval process and restored after each branch.

The flag remains default-off in product runtime.

## 5. Output

Generated report:

```text
docs/evals/experience-review-latest.md
```

Each case includes:

- id
- category
- input
- selected ResponseGoal
- selected Strategy
- baseline reply
- treatment reply
- expected ResponseGoal
- expectedClinicalBehavior
- forbiddenBehavior
- machineCheck
- reviewer fields

Reviewer fields:

- `goalCorrect`
- `treatmentBetter`
- `mechanicalEmpathy`
- `overQuestioning`
- `prematureAdvice`
- `overInterpretation`
- `conversationClosedTooEarly`
- `reviewerNotes`

These fields are intentionally blank. They are for human review.

## 6. Machine Checks

Machine checks are structural facts only.

Allowed automatic checks:

- selected `ResponseGoal` equals `expectedResponseGoal`
- Safety cases route to Safety
- ordinary cases do not unexpectedly route to Safety
- diagnosis / treatment-plan fixed terms are absent
- final reply source is visible (`llm`, `mock`, `fallback`, `safety`)

Machine checks must not decide whether the treatment reply is better.

## 7. Mock Handling

If the AI provider is not configured, the product chain returns `mock` model output.

The report must show:

```text
finalReplySource=mock
```

Mock output is useful for verifying runner structure, but it is not valid evidence of real model quality.

## 8. Human Review Process

1. Run:

   ```bash
   npm run experience:review
   ```

2. Open:

   ```text
   docs/evals/experience-review-latest.md
   ```

3. For each case, compare baseline and treatment.

4. Fill reviewer fields manually.

5. Summarize patterns:

   - Does treatment better support expression?
   - Does it become more mechanical?
   - Does it ask too many questions?
   - Does it give advice too early?
   - Does it over-interpret?
   - Does it close conversation too early?

6. Use the review to propose the next Experience Iteration.

## 9. Backlog Issue Diagnosis Gate

Starting with the next Backlog issue, implementation must not begin until a diagnosis document has been completed with:

```text
docs/BACKLOG_ISSUE_TEMPLATE.md
```

The diagnosis must identify exactly one Root Cause:

- Conversation
- ClinicalContext
- ResponseGoal
- Strategy
- Prompt
- Memory
- Safety

Rules:

- Root Cause must be confirmed before code starts.
- The review must explain why the issue is not caused by other plausible layers.
- The review must end in one final decision:
  - `implement`
  - `reclassify`
  - `downgrade`
  - `close`
  - `needs more eval`
- A review cannot stop at "reviewed".
- If the decision is not `implement`, no product code should be changed for that issue.

This gate exists to prevent fixing the wrong layer, especially confusing:

- ClinicalContext detection bugs with Strategy behavior gaps.
- Strategy gaps with Prompt language problems.
- Safety routing gaps with ordinary response-quality issues.

## 10. Boundary

This workflow must not be added to `check:launch`.

Reason:

- It can call real models.
- It can be slow and costly.
- It is a human-review artifact, not deterministic CI.

## 11. Risks

- Running all cases with a real provider makes 108 model calls.
- Mock output can be mistaken for real model behavior if reviewers ignore `finalReplySource`.
- Machine checks can find structural mismatches, but they cannot judge felt understanding.
- Safety gaps found here should be fixed in independent Safety work, not inside Experience Review runner.
