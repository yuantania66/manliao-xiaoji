# Chat v1.1 Phase 0 Root Cause

Status: evidence complete for the two reproduced failure families; no behavior
change authorized by this document.

## Evidence boundary

This diagnosis uses:

- the frozen A-repo and B0 source archives in
  `docs/evals/chat-v1.1-phase0-manifest.md`;
- the blind result in `docs/evals/chat-gate-v0-result-20260730.json`;
- the immutable trace reruns:
  - A-repo SHA-256:
    `d290822ea458266d7afee57f38663ba0d84b77909d6a59e359ee6ee0abac445b`
  - B0 SHA-256:
    `f69a439b10f8b8c6b1be2a86251eecd34d449f4271aca77000975da38bceb849`

The trace reruns are diagnostic evidence, not replacements for the already
frozen blind adjudication.

## Failure family 1: low-information numeric turns

### Observation

Across all nine turns of B0's three-run numeric trajectory:

- Context correctly records `semanticEvidence.status=insufficient`;
- Interpretation retains ambiguity and does not invent emotion or meaning;
- Dialogue State selects `currentActivity=developing_thread`;
- Response Planner selects only
  `acknowledge_without_psychologizing`;
- `questionPolicy=none`;
- `closurePolicy=forbid_closure`;
- Qwen returns exactly `收到。`;
- Validator passes the candidate with no failure reason.

The independent single-turn numeric episode produces the same result in all
three B0 runs.

Code inspection confirms:

- the Planner falls back to `acknowledge_without_psychologizing` when no other
  action is selected;
- shared initiative forces `questionPolicy=none`;
- the ResponsePlan Surface prompt constrains unsupported additions but supplies
  no positive conversational-movement requirement for this action;
- the ordinary acknowledgement validator rejects unsupported evaluation and
  generic causal mechanisms, but its empty-acknowledgement check applies only
  to `respond_to_proactive_greeting`;
- `closurePolicy=forbid_closure` recognizes a short list of explicit pause
  phrases and does not reject `收到。`.

### Interpretation

The earliest failure is in Response Planning: for an open but semantically
insufficient turn, the plan authorizes only acknowledgement and forbids a
clarifying question. Surface then chooses the smallest legal realization.

There is a second, downstream enforcement gap: the resulting empty receipt
satisfies the current ordinary acknowledgement validator despite violating the
plan's non-closure intent.

This is not a Memory, Clinical, Safety, provider-exception, post-processing or
history-contamination failure. Raw model output equals final output, and all
three layers consistently permit the result.

### Conclusion

A prompt-only wording tweak cannot fully repair this family because the current
plan does not authorize the needed conversational move. The first isolated
experiment must be owned by Response Planner and must state what an open,
unknown low-information turn is trying to accomplish. Validator coverage for
empty receipts is a separate follow-up experiment, not bundled into the
Planner change.

## Failure family 2: direct challenge to understanding

### Observation

For `你一点都不懂我`, all three B0 traces show:

- no adjacent Assistant turn in the captured fixture;
- relations `opens_new_thread` and `shares_distress`;
- `repairState.status=none`;
- activity `supporting_emotion`;
- action `offer_emotional_support`;
- the same generated reply beginning
  `抱歉让你有这种感觉`;
- Validator passes with no failure reason.

A-repo instead deterministically identifies
`primaryDialogueAct=challenge_contradiction` and produces a direct
responsibility-taking reply in all three runs.

The fixture still lacks the preceding conversation, so it cannot prove what
specific earlier proposition should be repaired.

### Interpretation

The earliest B0 failure is Turn Interpretation / Dialogue State. A direct
meta-challenge to the Assistant is treated as the user's emotional topic
because no adjacent Assistant proposition is available to target. Planner and
Surface then consistently realize the resulting emotional-support route.

This is not primarily a Surface wording problem: the reframe appears after the
control path has already selected emotion support instead of meta-repair.

### Conclusion

The repair family requires its own isolated Interpretation/State experiment:
recognize a direct challenge to the Assistant's understanding as a meta-repair
need while keeping the rejected proposition unknown when earlier context is
missing. It must not invent the missing misunderstanding.

## Preserved behavior

The emotional-statement episode passed 3/3 for B0 and A-repo in the frozen
blind review. Any later experiment must keep this episode as an explicit
non-regression check even though the current real pool does not yet contain a
formally held-out non-target case.

## Phase decision

B0 failed the applicable Gate v0 thresholds. Phase 0 therefore does not
authorize entrypoint rollout, provider change, or a combined multi-layer
repair. The evidence supports two separate, ordered experiments:

1. low-information Response Planner contract;
2. direct meta-challenge Interpretation/State.

Each experiment must be rerun against the same four episodes, with at least 20
new synthetic/adversarial counterexamples and a fresh blind A/B package before
the next product phase is considered.
