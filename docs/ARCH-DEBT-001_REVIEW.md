# ARCH-DEBT-001 Review

## Title

Clinical user correction predicate deduplication

## Problem

`services/clinical/responseGoalSelector.ts` and `services/clinical/rogersStrategy.ts` both defined the same deterministic `USER_CORRECTION_PATTERN`.

This duplicated predicate created an architecture debt before EXP-BL-004:

- ResponseGoal selection could be updated without the Rogers repair mapping.
- Rogers repair mapping could be updated without ResponseGoal selection.
- A future product fix could appear to route a turn to `clarify` while still failing to enter the `repair` plan path.

## Scope

This is an Architecture Debt PR.

It is not:

- a product experience PR
- an EXP-BL-004 behavior fix
- a Prompt PR
- a Safety PR
- a Memory PR
- a Strategy expansion

## Allowed Change

Extract the duplicated clinical predicate into:

```text
services/clinical/userCorrectionSignal.ts
```

The helper exports one deterministic function:

```ts
export const isUserCorrection = (text: string): boolean => {
  // deterministic predicate
};
```

Both clinical files now consume the same helper:

- `services/clinical/responseGoalSelector.ts`
- `services/clinical/rogersStrategy.ts`

## Explicit Non-Goals

This PR does not expand the correction pattern.

This PR does not make the following EXP-BL-004 cases pass:

- `其实不是因为这个。`
- `我刚刚是不是没表达清楚？`

Those require a later product PR with explicit EXP-BL-004 acceptance.

## Legacy Boundary

`services/ai/aiService.ts` still contains its own legacy `USER_CORRECTION_PATTERN`.

It must remain untouched in this PR because:

- it serves a legacy fallback path
- it has broader semantics, including template dissatisfaction and anti-fabrication feedback
- it is not equivalent to "the user is correcting AI understanding"
- it is protected by Architecture v1 legacy freeze boundaries

## Behavior Expectation

No user-visible behavior should change.

The helper preserves the exact original clinical pattern:

```text
不是这个意思
不是这意思
你没懂
你没理解
你理解错
你说错
你是不是.*(没懂|没理解)
```

## Acceptance Criteria

- `responseGoalSelector.ts` imports `isUserCorrection`.
- `rogersStrategy.ts` imports `isUserCorrection`.
- Neither clinical file defines `USER_CORRECTION_PATTERN` locally.
- `services/ai/aiService.ts` remains unchanged.
- Existing clinical checks pass.
- Launch checks and build pass.

## Future Work

EXP-BL-004 may later expand `isUserCorrection()` or introduce a separate reviewed signal so indirect repair inputs can enter:

```text
clarify -> repair
```

That product change is intentionally outside this architecture debt PR.
