# Real-product Experience Issue Pool Specification

## 1. Purpose

This pool records replies that a Decision Owner actually experienced as foolish, mechanical, ungrounded, or trust-damaging in the product.

It complements the Golden Dataset. It is not itself a Golden Dataset, an automated eval input, a product backlog, or an implementation authorization.

The first pass exists only to answer:

```text
What failed, and which single product layer most likely owns the failure?
```

It must not answer how to fix the failure.

## 2. Evidence Classes

Every case must use exactly one provenance class:

- `screenshot_confirmed`: user and assistant text can be transcribed directly from a supplied product screenshot.
- `official_entrypoint_reproduced`: the exact exchange was reproduced through the current official reply entrypoint with runtime metadata.
- `user_reported_probe`: the user reported the exchange, but the exact output has not been independently reproduced or screenshot-confirmed.
- `candidate`: a useful hypothesis without enough evidence to become a diagnosis case.

Evidence classes must not be silently upgraded. A reported probe becomes confirmed only after a screenshot or official-entrypoint reproduction is attached.

## 3. Required Case Shape

Each case records:

- `caseId`
- `status`: `diagnosed`, `primary_root_cause_pending`, or `needs_reproduction`
- `provenance`
- capture date and environment when known
- minimum context required to understand the failure
- exact user input
- exact assistant reply
- why the reply feels wrong
- observed harm type
- layer-by-layer exclusion notes
- one `primaryRootCause`, or `pending` when evidence cannot support one
- confidence and reviewer notes

No solution, Prompt wording, code diff, experiment variant, or implementation plan belongs in a case.

## 4. Allowed Root-cause Layers

When evidence is sufficient, `primaryRootCause` must be exactly one of:

- `Conversation`
- `ClinicalContext`
- `ResponseGoal`
- `Strategy`
- `Prompt`
- `Memory`
- `Safety`

Definitions:

- `Conversation`: current-turn/history construction, cross-turn contamination, or conversational state assembly.
- `ClinicalContext`: deterministic signals or context facts are missing or wrong.
- `ResponseGoal`: the selected final response goal is wrong for the user need.
- `Strategy`: the selected interaction strategy is wrong even if the goal is appropriate.
- `Prompt`: the structure is compatible with the need, but model-facing rendering or compliance produces the bad reply.
- `Memory`: retrieved long-term/user memory introduces, omits, or distorts relevant meaning.
- `Safety`: safety detection or safety rendering incorrectly dominates or fails to dominate the response.

`pending` is required when the available evidence cannot distinguish two or more layers. It is better than false certainty.

## 5. Diagnosis Discipline

For each case:

1. Preserve the smallest sufficient context.
2. Describe the failure in user-experience language before naming a layer.
3. Check each plausible upstream layer against available deterministic or runtime evidence.
4. Select one primary layer only when the evidence excludes the alternatives.
5. Keep secondary symptoms in reviewer notes; do not turn them into multiple root causes.
6. Do not propose a fix.

A repeated phrase is not automatically a Prompt root cause. A wrong reply after a correct route is stronger Prompt evidence; a wrong route is stronger ResponseGoal or Strategy evidence; assistant text promoted into later fact is stronger Conversation evidence.

## 6. Relationship to Other Artifacts

- Golden Dataset cases are stable, reviewed regression contracts.
- Conversation trajectories measure cross-turn behavior.
- This issue pool preserves product pain and diagnosis provenance.
- Backlog Issues authorize scoped work only after a repeated failure cluster is supported by evidence.

Moving a case from this pool into another artifact requires an explicit review. No automatic promotion is allowed.

## 7. First-pass Boundary

The initial pool may include only screenshot-confirmed cases already supplied by the Decision Owner.

It must not:

- add A4/A5/A6;
- modify product code or Prompt text;
- modify Selector, ClinicalPlan, Strategy, Memory, or Safety;
- add cases to the Golden Dataset;
- add checks to CI;
- create a product Backlog Issue;
- infer exact text from a verbal summary.

## 8. Cluster Gate

After at least 20 confirmed or officially reproduced cases exist, a separate review may group them by failure mechanism.

A cluster may justify a diagnosis Issue only when:

- at least three independent cases show the same failure mechanism;
- provenance is explicit;
- one primary layer is supported or the missing evidence is named;
- the cluster describes user harm rather than a preferred implementation;
- no solution is preselected.

The number 20 is a collection target, not an evidence threshold that automatically authorizes work.
