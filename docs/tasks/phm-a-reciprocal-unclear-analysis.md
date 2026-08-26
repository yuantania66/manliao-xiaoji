## Problem

A committed non-question proactive greeting (`嗨，又见面了。`) is followed by the bare reciprocal User turn `嗨`, but the persisted execution trace records `selectedRelation=reciprocates_move` together with `requiredFunction=defer_handoff_completion` and `completionIntent=defer`. The result does not satisfy the section 14.5 reciprocal-contact postcondition even though PHM-A found reciprocal evidence.

This analysis stops at the first causal boundary before Planner selection. The Planner rule remains unchanged: a genuinely ambiguous candidate set containing `unclear` must defer. No greeting text rule, keyword list, regular expression, or lifecycle state is proposed.

## Evidence

Observation:

- The provided persisted trace records a valid committed proactive-greeting envelope, `selectedRelation=reciprocates_move`, and the defer tuple.
- Contract section 14.4 says an incompatible set records its highest-confidence candidate as `selectedRelation` for traceability while still producing `defer_handoff_completion`; it also requires an ambiguous set containing `unclear` to defer.
- `buildResponseRelations` in `conversation-os/control/turnInterpreter.ts` adds `continues_active_thread` with confidence `0.68` to every non-stop User turn that has an adjacent Assistant turn. Its evidence is adjacency only: `Current user turn follows an adjacent assistant turn.`
- Bare non-boundary turns have deterministic confidence `0.72`, so `services/ai/turnInterpretationAdapter.ts` requests model interpretation. On provider failure it correctly returns the unchanged deterministic interpretation.
- `mergeModelInterpretation` unconditionally unions every deterministic candidate with every valid model candidate before deduplication. It does not distinguish a generic adjacency fallback from substantive deterministic evidence.
- `relationKindFor` in `conversation-os/control/interactionMoveHandoff.ts` maps `continues_active_thread` to `unclear` whenever `semanticEvidence.status` is `insufficient`; it maps model `acknowledges_previous_move` to `reciprocates_move`.
- `projectUserMoveRelation` preserves both distinct projected kinds and their exact current-turn spans. Existing PHM-A tests explicitly prove `continues_active_thread + insufficient semantic evidence -> unclear` and that multiple projected candidates are preserved.
- Existing Planner tests prove that a multi-candidate input containing `unclear` defers and that a deferred incompatible plan may retain a different highest-confidence `selectedRelation` as trace focus.

Interpretation:

- For the reported bare `嗨`, the trace tuple and the inspected merge/projection path are consistent with a model `acknowledges_previous_move` candidate becoming `reciprocates_move` while the automatic deterministic `continues_active_thread` candidate becomes `unclear`. The generic fallback is therefore treated as competing semantic evidence even after the model call succeeds.
- The exact pre-Plan candidate array was not included in the supplied trace excerpt. The regression must first assert that the reproduction is `[reciprocates_move, unclear]` (order by confidence) rather than silently assuming it.

Conclusion:

- Planner is behaving according to sections 14.3-14.4. The first causal boundary is PHM-A candidate reconciliation inside `mergeModelInterpretation`, before `projectUserMoveRelation` and before Planner.

## Root Cause

`continues_active_thread` has two incompatible roles in the current pipeline:

1. before model enrichment, it is a fail-closed adjacency fallback for a low-confidence turn;
2. after successful model enrichment, the merge treats that same fallback as an independently supported semantic candidate.

Because the merge is append-only, successful model resolution cannot supersede only this synthetic fallback. With insufficient semantic evidence, projection turns it into `unclear`; the Planner then correctly interprets the full set as unresolved and defers. The defect is not the mapping of `continues_active_thread` to `unclear`, nor the Planner's ambiguity rule. It is failure to retire a superseded fallback at the PHM-A merge boundary.

## Proposed Solution

Change only PHM-A merge reconciliation:

- Compute valid model relation candidates separately from deterministic candidates.
- Treat the deterministic `continues_active_thread` candidate created solely from adjacency as a fallback, not as substantive counter-evidence.
- Suppress that deterministic fallback only when the model returned at least one valid candidate eligible for the active handoff target and at least one such model candidate is not `continues_active_thread`.
- Preserve every model candidate unchanged, including a model-supplied `continues_active_thread`. Preserve every other deterministic candidate unchanged. If the model itself supplies multiple distinct plausible relations, keep all of them; Planner continues to defer any genuinely ambiguous set containing projected `unclear`.
- If the provider fails, output is invalid, candidates are below the existing acceptance threshold, candidates target a different Assistant move, or the model supplies only `continues_active_thread`, keep the deterministic fallback so the result remains fail-closed.
- Do not inspect User wording and do not change confidence thresholds, relation-to-PHM-A mappings, evidence spans, Planner compatibility rules, or the section 14.5 postcondition.

Required focused regressions:

1. Positive — bare reciprocal: non-question committed greeting + insufficient semantic evidence + deterministic adjacency fallback + one valid same-target model `acknowledges_previous_move` candidate must project only `reciprocates_move`; the downstream tuple must be `complete_reciprocal_contact / fulfill / optional_after_completion`.
2. Negative — model unavailable or unusable: the same turn with provider failure, malformed output, no accepted candidate, or wrong-target candidates must retain deterministic `unclear` and defer.
3. Negative — genuine unclear: if the model itself supplies `continues_active_thread`, or supplies it alongside `acknowledges_previous_move`, all model candidates must remain; projected `unclear` remains and the Planner defers when ambiguity is genuine.
4. Normal — topic redirect: a valid same-target `opens_new_thread` model candidate must not be contaminated by the generic deterministic fallback; `opens_or_redirects_thread` remains authoritative. If the model also supplies a reciprocal candidate, preserve both and let the existing compatible-set rule select User content.
5. Typed adversarial — question greeting: a bare reciprocal after `ask_one_bounded_low_burden_question` must still defer as an unsupported relation/function pair even after fallback retirement. A genuine answer candidate must retain the existing `continue_from_user_answer` path.
6. Context/adversarial — direct question, stop/boundary, repair, and multi-relation model output must keep their deterministic authority and all genuine candidates; no fallback suppression may erase them or manufacture reciprocal completion.
7. Structural — exact full-turn evidence, target binding, Guest/authenticated parity, absence of text matching, and the Planner's existing `unclear` defer regression must continue to pass.

## Files To Change

- `conversation-os/control/turnInterpreter.ts` — make the narrow fallback-versus-model reconciliation explicit inside `mergeModelInterpretation`; do not change deterministic boundary generation or Planner semantics.
- `scripts/interaction-move-handoff-check.ts` — add PHM-A candidate-reconciliation tests for bare reciprocal, provider-equivalent unusable model output, wrong target, genuine model ambiguity, topic redirect, and exact evidence preservation.
- `scripts/interaction-move-handoff-planner-check.ts` — add the smallest end-to-end plan assertions for non-question bare reciprocal completion, model-unavailable/genuine-unclear defer, topic redirect, and question-greeting typed behavior.
- `services/ai/turnInterpretationAdapter.ts` — no production change expected; only include it if a focused adapter test is needed to prove the existing provider-failure path returns deterministic fallback unchanged.
- `conversation-os/control/interactionMoveHandoff.ts` — no production change expected; its `continues_active_thread + insufficient -> unclear` fail-closed mapping must remain unchanged.

## Risks

- Over-broad suppression could turn a weak or wrong model guess into a false completion. Limit suppression to the single deterministic adjacency fallback and retain the existing model candidate validation, target eligibility, and confidence threshold.
- Treating every `continues_active_thread` as disposable would erase genuine model ambiguity. Suppress only the deterministic instance; never remove a model-supplied candidate.
- A wrong-target model candidate must not suppress the current-target fallback, or identity binding would fail open.
- Multiple model candidates may collapse to the same PHM-A kind. This is acceptable because existing projection deduplicates by kind; distinct projected kinds must remain available to Planner.
- Changing Planner compatibility or the `relationKindFor` mapping would mask the source defect and weaken fail-closed behavior; both are explicitly out of scope.
- A text-based special case for `嗨` would not cover other reciprocal realizations and would violate the frozen no-keyword boundary.
