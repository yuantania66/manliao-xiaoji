# EXP-BL-004 Review

## Issue Header

- Issue ID: EXP-BL-004
- Golden Dataset cases:
  - GD-REL-006
  - GD-REL-007
  - GD-AMB-006
- Priority: P0
- Decision owner: Product / Architecture owner

## 1. User Problem

Users give direct or indirect feedback that the AI may have misunderstood them, but the system does not consistently route those turns into a repair-oriented path.

The user experience problem is not only the final wording. In repair moments, the user needs to feel:

```text
The AI will take responsibility for possibly missing me, and I can correct it without having to carry the repair work.
```

Current failure:

```text
Some correction or self-checking inputs still select ordinary reflection, so the ClinicalPlan does not reliably encode repair.
```

This is especially risky because repair moments decide whether users feel safe correcting the AI. A lucky model reply is not enough; the trace needs to show the system has entered the repair path.

## 2. Evidence

Source report:

- `docs/evals/experience-review-latest.md`

### GD-REL-006

- Input: `你是不是根本没懂我？`
- Selected ResponseGoal: `clarify`
- Selected Strategy: `rogers`
- Baseline reply: `是我没跟上，你刚刚想说的不是这个。`
- Treatment reply: `是我没跟上，刚刚理解偏了。`
- Expected ResponseGoal: `clarify`
- Expected Clinical Behavior: `承认可能没跟上，给用户安全纠正 AI 的空间。`
- ClinicalPlan:
  - responseIntent: `repair`
  - questionFunction: `repair_understanding`
- Result: This case is already correctly routed.

### GD-REL-007

- Input: `其实不是因为这个。`
- Selected ResponseGoal: `reflect`
- Selected Strategy: `rogers`
- Baseline reply: `那我可能理解偏了，你愿意的话可以帮我纠正一下。`
- Treatment reply: `嗯，是我刚才理解岔了。`
- Expected ResponseGoal: `clarify`
- Expected Clinical Behavior: `承认自己可能接偏，撤回旧理解，给用户修正空间。`
- ClinicalPlan:
  - responseIntent: `empathic_reflection`
  - questionFunction: `clarify_or_reflect`
- Problem:
  - The treatment reply happens to be acceptable in this run.
  - The selected ResponseGoal is still wrong.
  - The ClinicalPlan does not encode repair, so future outputs can easily drift back into reflection or ask the user to fix the AI.

### GD-AMB-006

- Input: `我刚刚是不是没表达清楚？`
- Selected ResponseGoal: `reflect`
- Selected Strategy: `rogers`
- Baseline reply: `是我还没跟上，你按自己的节奏说就好。`
- Treatment reply: `是我没跟上，你按自己的节奏说就好。`
- Expected ResponseGoal: `clarify`
- Expected Clinical Behavior: `AI 先承担可能没跟上，不让用户为表达不清负责。`
- ClinicalPlan:
  - responseIntent: `empathic_reflection`
  - questionFunction: `clarify_or_reflect`
- Problem:
  - The wording partially avoids blame, but the trace still treats the turn as ordinary reflection.
  - The system does not formally recognize that the user is checking whether the AI understood them.
  - This creates regression risk in the exact moment where the user needs safe correction.

## 3. True Root Cause

Selected Root Cause:

```text
ResponseGoal
```

Primary code location:

```text
services/clinical/responseGoalSelector.ts
```

More specifically:

```text
USER_CORRECTION_PATTERN
```

The current correction pattern catches direct AI-targeted feedback such as:

```text
不是这个意思
你没懂
你是不是没理解
```

It does not catch adjacent repair cases such as:

```text
其实不是因为这个
我刚刚是不是没表达清楚
```

Those messages are not ordinary reflections. They are correction / repair turns:

- `其实不是因为这个` means the previous understanding needs to be withdrawn.
- `我刚刚是不是没表达清楚` means the user is checking whether the misunderstanding is their fault; the AI should avoid pushing responsibility back to the user.

Because these inputs do not enter the `clarify` path, RogersStrategy receives `responseGoal=reflect` and produces ordinary reflection:

```text
responseIntent = empathic_reflection
questionFunction = clarify_or_reflect
```

The correct contract should route them into the same repair-oriented clarify path as GD-REL-006.

## 4. Why Not Other Layers

- Why not Conversation:
  - The issue is visible in single-turn Golden Dataset cases and does not require conversation state, rhythm, presence, or relationship-stage interpretation.
  - The missing behavior is not a runtime conversation-state transition; it is a current-turn goal selection miss.

- Why not ClinicalContext:
  - ClinicalContext already carries the current user message and deterministic signals into Clinical Logic.
  - No new memory or context field is required to identify these repair forms.

- Why not Strategy:
  - When the input is routed to `clarify` and recognized as correction, as in GD-REL-006, RogersStrategy already emits `responseIntent=repair` and `questionFunction=repair_understanding`.
  - The failing cases do not reach that path because ResponseGoal selection remains `reflect`.
  - Strategy wording can be improved later, but it is not the primary miss here.

- Why not Prompt:
  - Prompt should not infer repair from raw text when the ClinicalPlan says ordinary reflection.
  - Fixing this in Prompt would recreate the old problem of using prompt branches to override upstream strategy decisions.

- Why not Memory:
  - These cases do not need long-term user memory. They are immediate repair turns.

- Why not Safety:
  - No safety risk or crisis routing is involved.

## 5. Minimal Fix

Expand ResponseGoal repair/correction detection so correction-like and self-blame-about-expression turns select `clarify` and enter the repair-oriented plan path.

## 6. Impact Scope

Fixing this improves moments where users correct the AI, challenge whether it understood, or blame themselves for not expressing clearly.

Expected user-visible improvement:

```text
The AI more consistently takes responsibility for possible misunderstanding instead of treating repair as ordinary reflection.
```

This should primarily affect:

- direct misunderstanding feedback
- indirect correction
- user self-checking about whether they expressed clearly

It should not affect:

- ordinary relationship worry
- ordinary ambiguous short input
- advice requests
- safety routing
- memory retrieval

## 7. Regression Risk

Main risk:

```text
Over-routing ordinary negation into repair.
```

Examples to protect:

- `不是很想去`
- `其实不是今天发生的`
- `我不是很确定`
- `他不是这个意思吧`

These should not automatically become AI repair unless the wording points to:

- AI misunderstanding
- correction of the AI's prior understanding
- user concern that they did not express clearly to the AI

Secondary risk:

```text
Overusing repair when the user is simply clarifying a story fact.
```

The fix should be narrow and anchored to correction / understanding language, not general negation.

## 8. Acceptance Criteria

- GD-REL-006 remains:
  - selected ResponseGoal: `clarify`
  - responseIntent: `repair`
  - questionFunction: `repair_understanding`
- GD-REL-007 changes to:
  - selected ResponseGoal: `clarify`
  - responseIntent: `repair`
  - questionFunction: `repair_understanding`
- GD-AMB-006 changes to:
  - selected ResponseGoal: `clarify`
  - responseIntent: `repair`
  - questionFunction: `repair_understanding`
- Negative samples do not route to repair:
  - `不是很想去`
  - `其实不是今天发生的`
  - `我不是很确定`
  - `他不是这个意思吧`
- No changes to:
  - Prompt structure
  - Memory
  - Safety
  - ResponseGoal enum
  - ClinicalPlan schema
  - Strategy Registry

## 9. Re-eval Command

```bash
npm run experience:review
```

Required deterministic checks:

```bash
npm run check:clinical-logic-skeleton
npm run check:clinical-prompt-eval
npm run check:launch
npm run build
```

## 10. Final Decision

Decision:

```text
implement
```

Next PR boundary:

```text
Only update repair/correction detection for ResponseGoal selection and the matching repair-plan assertion needed to keep the clarify -> repair contract consistent.
```

Allowed files for the next PR should be limited to:

- `services/clinical/responseGoalSelector.ts`
- the minimal corresponding clinical checks / eval assertions

If implementation reveals that `rogersStrategy.ts` duplicates the same correction predicate and prevents `clarify` from becoming `repair`, the PR must either:

1. extract a shared repair/correction predicate used by both selector and Rogers plan mapping, or
2. stop and document that the primary root cause needs to be reclassified from `ResponseGoal` to `Strategy`.

Do not patch `promptBuilder.ts` for this issue.

Do not add a new ResponseGoal.

Do not start EXP-BL-005 in the same PR.
