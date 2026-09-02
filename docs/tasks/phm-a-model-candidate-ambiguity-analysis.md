## Problem

In session `cmsebsoi90006jbva9kbz29ok`, User turn
`turn-4e9848c5-d6be-4d8c-9d6a-f395dcbebd79` says `你好` immediately after the
committed proactive Assistant move `把想说的话慢慢打出来就好。`, whose function is
`offer_self_contained_conversation_entry`. The persisted plan records
`selectedRelation=reciprocates_move` but pairs it with
`requiredFunction=defer_handoff_completion`, `completionIntent=defer`, and
`questionPolicy=none`. Both Surface candidates are then rejected and the client shows
`这次回复没能生成，请重试。`

Contract section 14.3 requires `reciprocates_move` after either non-question greeting
function to produce `complete_reciprocal_contact / fulfill /
optional_after_completion`. The investigation therefore stops before Surface and
Validator: the plan is already wrong at PHM-A candidate reconciliation. No Validator,
Surface, Planner-contract, wording, keyword, regular-expression, or lifecycle-state
change is proposed.

Subsequent full-chain evidence after the adjacency-fallback repair invalidates that
freeze as a complete acceptance result. The repaired merge removes the synthetic
fallback, but real Qwen adds `opens_new_thread` for the same generic greeting despite
explicitly noting that the turn contains no topic. PHM-A then projects a valid
`reciprocates_move + opens_or_redirects_thread` set, and Planner correctly selects
`continue_user_introduced_content / fulfill / optional_after_completion` under section
14.4. Because there is no User-introduced content to continue, both Surface attempts
fail the unchanged semantic Validator and the user-visible generation failure remains.

## Evidence

Observation:

- The persisted failed execution is preflight-valid, reaches two Surface attempts, and
  rejects both with
  `interaction_move_handoff_semantic:function_or_policy_not_satisfied`. Both attempts
  consume the same already-deferred handoff plan; Validator is reporting the upstream
  plan/realization mismatch rather than creating it.
- A no-persistence reproduction under the real configuration yields
  `semanticEvidence.status=sufficient` and these deterministic response-relation
  candidates for the exact active Assistant target:
  - `shares_initiative`, confidence `0.82`;
  - `continues_active_thread`, confidence `0.68`, with the sole evidence
    `Current user turn follows an adjacent assistant turn.`
- `buildResponseRelations` in `conversation-os/control/turnInterpreter.ts` creates the
  first candidate from structured `interaction.initiativeDirection=shared`. It also
  unconditionally appends the second candidate to every non-stop turn with an adjacent
  Assistant. The latter is the deterministic adjacency fallback identified by its
  exact relation, confidence, and evidence fingerprint.
- `mergeModelInterpretation` currently retires that fallback only when an accepted
  model candidate is non-`continues_active_thread`, explicitly targets the active
  Assistant move, and clears the existing model threshold. It does not consider an
  already accepted exact-target deterministic candidate such as `shares_initiative`.
  Consequently provider failure, malformed/low-confidence model output, or output
  without an eligible exact-target non-continues model candidate preserves both
  deterministic candidates.
- `projectUserMoveRelation` accepts both because both bind the exact active target. It
  maps `shares_initiative` to `reciprocates_move` and, because semantic evidence is
  sufficient, maps the adjacency fallback `continues_active_thread` to
  `continues_from_move`. It preserves both distinct projected kinds, producing
  `[reciprocates_move, continues_from_move]` with a confidence gap of `0.14`.
- Contract section 14.4 does not define
  `reciprocates_move + continues_from_move` as a compatible set unless
  `opens_or_redirects_thread` also survives. `tupleForCandidates` therefore correctly
  returns the defer tuple. `highestConfidence` keeps `reciprocates_move` only as trace
  focus, which explains the apparently contradictory persisted tuple.
- Existing PHM-A tests cover suppression when an exact-target model candidate exists,
  and they cover `insufficient` semantic evidence where the fallback projects to
  `unclear`. They do not cover the pure deterministic `sufficient` case where an
  exact-target non-fallback candidate and the adjacency fallback coexist. Existing
  Planner tests correctly preserve and defer true model-supplied ambiguity.
- The previous slice accepted the broad rule that provider-unavailable execution must
  preserve the adjacency fallback. The new user-visible failure invalidates that rule
  when stated without qualification: provider availability is irrelevant once an
  accepted exact-target deterministic concrete candidate already exists. The narrower
  fail-closed rule remains valid when no such concrete candidate exists.

Subsequent full-chain observation:

- After the proposed fallback reconciliation is applied, a real Qwen interpretation
  returns these exact-target candidates:
  - `acknowledges_previous_move`, confidence `0.85`;
  - `opens_new_thread`, confidence `0.60`.
  Qwen's notes and free-form evidence describe the current turn as a generic greeting
  with no topic. The deterministic concrete candidate remains `shares_initiative`,
  confidence `0.82`; the fingerprinted adjacency fallback is no longer present.
- Projection correctly deduplicates `acknowledges_previous_move` and
  `shares_initiative` into `reciprocates_move`, and separately maps the accepted
  `opens_new_thread` to `opens_or_redirects_thread`. The result is therefore
  `[reciprocates_move, opens_or_redirects_thread]`.
- Section 14.4 explicitly makes that set compatible and lets current User content win.
  Planner consequently produces `continue_user_introduced_content / fulfill /
  optional_after_completion`; this is contract-conformant for its input and must not
  be patched.
- Surface generates two variants of `你好，想聊点什么…`. The unchanged Validator
  rejects both with `function_or_policy_not_satisfied`, and execution ends as
  `GENERATION_NONCONFORMANT`. The Validator is correctly detecting that no concrete
  User-introduced content exists for the selected function.
- `buildInterpretationMessages` names the allowed relation enums and asks the model to
  preserve multiple plausible relations, but it does not define the content-bearing
  precondition that distinguishes `opens_new_thread` or `continues_active_thread`
  from a phatic acknowledgment. It therefore permits Qwen to emit `opens_new_thread`
  as a generic low-confidence hedge even while its own semantic description says
  there is no topic.
- Production code must not inspect Qwen's notes or evidence strings to reverse that
  candidate. Those strings are explanatory model output, not a typed decision
  authority, and matching them would become a wording-dependent second classifier.

Interpretation:

- The extra candidate is not created by Planner, Surface, or Validator. It is the
  deterministic adjacency-only `continues_active_thread` fallback from
  `buildResponseRelations`.
- It enters the handoff projection because the merge treats it as independently
  supported semantic evidence even though the same deterministic pass has already
  produced a concrete exact-target non-continues relation.
- Real Qwen output is not a stable reproduction boundary: the model may return
  different ranked alternatives. The defect is proven without relying on any
  particular Qwen sample because the deterministic candidate pair alone reproduces
  the deferred plan.

Conclusion:

- Planner and Validator are enforcing their frozen contracts. The first causal defect
  is the too-narrow adjacency-fallback retirement predicate inside
  `mergeModelInterpretation`.
- The prior provider-unavailable acceptance must therefore be revised, not discarded:
  preserve the fallback only when neither deterministic nor accepted model evidence
  supplies an exact-target concrete non-continues candidate.
- The repaired fallback predicate closes the first reproduced defect but does not close
  the user-visible slice. With the new full-chain evidence, the next and now first
  failing causal boundary is the semantic contract presented by
  `turnInterpretationAdapter`: it lacks a concrete-current-turn-content requirement
  for `opens_new_thread` and `continues_active_thread`. Planner, Surface, and Validator
  are downstream and contract-conformant.

## Root Cause

The adjacency candidate has two roles but the merge distinguishes them only on one
side of the merge:

1. `continues_active_thread / 0.68 / exact adjacency evidence` is generated as a
   fail-closed fallback when no more specific response relation is available;
2. after deterministic and model candidates are combined, the same fallback is kept
   as if it were a concrete competing interpretation unless an eligible model
   candidate supersedes it.

That model-only supersession rule omits concrete deterministic evidence. Here,
`shares_initiative` already supplies an accepted, exact-target, non-continues relation,
but cannot retire the fallback. Projection then promotes the fallback from generic
adjacency into a second PHM-A kind, and Planner must treat the resulting set as
incompatible. The root cause is therefore asymmetric fallback reconciliation, not the
relation mapping or Planner's fail-closed compatibility table.

After that defect is repaired, the remaining root cause is under-specified model
classification semantics in `services/ai/turnInterpretationAdapter.ts`. The Prompt
provides enum names but does not define their necessary semantic evidence:

1. `opens_new_thread` is not constrained to concrete content in the current User turn
   that establishes or redirects to a topic which can be continued without first
   eliciting that content;
2. `continues_active_thread` is not constrained to concrete content that extends an
   already established topic, proposition, answer frame, or activity;
3. the model is asked to preserve multiple plausible relations without being told
   that generic adjacency or phatic contact is not an independent content-bearing
   reading.

As a result, an explanatory model judgment of “generic greeting / no topic” can still
produce the typed `opens_new_thread` candidate. The parser and threshold correctly
accept that well-formed exact-target candidate, PHM-A correctly projects it, and
Planner correctly gives it section 14.4 priority. No later layer can repair the absent
semantic precondition without reclassification or contract drift.

## Proposed Solution

Change only PHM-A merge reconciliation:

- Keep the exact fingerprint that identifies the merge-owned deterministic adjacency
  fallback: relation `continues_active_thread`, confidence `0.68`, and the sole
  adjacency evidence constant.
- Build the concrete-candidate check from both existing deterministic candidates and
  accepted model candidates.
- Retire only that fingerprinted fallback when at least one other candidate is:
  - non-`continues_active_thread`;
  - explicitly bound to the exact active handoff target; and
  - already accepted by its existing source path (including the existing model
    confidence threshold).
- Preserve every other deterministic and model candidate unchanged. In particular,
  do not remove a model-supplied `continues_active_thread`, a continues-only result, a
  targetless or wrong-target candidate, or any substantive multi-relation candidate.
  Targetless and wrong-target candidates must not independently retire the fallback.
- Do not inspect User or Assistant text, change confidence thresholds, rewrite
  candidate targets, change relation projection, alter Planner compatibility, or
  weaken Validator fail-closed behavior.

Required focused regressions:

1. Pure deterministic positive case: sufficient semantic evidence plus exact-target
   `shares_initiative` and the adjacency fallback must retire only the fallback,
   project only `reciprocates_move`, and plan
   `complete_reciprocal_contact / fulfill / optional_after_completion` for both
   non-question greeting functions.
2. Model-independent stability: provider failure, malformed output, and random Qwen
   alternative lists must not be required for the positive case; the deterministic
   reproduction is the acceptance authority.
3. True ambiguity fail-closed: an exact-target model-supplied
   `continues_active_thread` alongside reciprocal evidence is not the fingerprinted
   fallback and must survive; the incompatible set continues to defer. The same is
   true for an accepted exact-target `answers_previous_move` plus reciprocal evidence
   after a non-question greeting.
4. No concrete candidate: adjacency fallback alone or a model continues-only result
   remains fail closed. Targetless, wrong-target, or below-threshold non-continues
   model candidates cannot by themselves suppress it.
5. Compatible multi-candidate preservation: `opens_or_redirects_thread` with
   reciprocal/continuation remains governed by section 14.4 and must not be collapsed
   to reciprocal completion.
6. Typed boundaries: question greetings, direct-answer obligations, explicit
   boundaries, challenge/rejection, repair, exact spans, and Guest/authenticated
   parity retain their existing behavior.

The fallback reconciliation above remains necessary, but the newly exposed defect
requires one additional, separately testable calibration at the existing model
interpretation boundary:

- Define `opens_new_thread` in the Turn Interpretation Prompt as requiring concrete
  current-turn content that independently introduces or redirects to something the
  next reply can continue. A greeting, phatic acknowledgment, receipt, lack of topic,
  or generic willingness to chat is not by itself an opening/redirect relation.
- Define `continues_active_thread` as requiring concrete current-turn content that
  extends an established topic, proposition, answer frame, or activity. Mere
  adjacency, reciprocal contact, or a generic greeting is not sufficient.
- Define `acknowledges_previous_move` as the appropriate response relation when the
  current turn only acknowledges or reciprocates the targeted move and contributes no
  independent topic content.
- Require multiple candidates only for distinct semantic readings that each satisfy
  their own typed preconditions. Do not add `opens_new_thread` or
  `continues_active_thread` merely as a generic hedge alongside acknowledgment.
- Keep these rules entirely inside the interpretation Prompt. Do not add a User-text
  matcher, greeting list, regex, candidate-evidence-string inspection, post-model
  override, confidence-threshold change, or Planner/Validator/Surface exception.

Prompt calibration plus a real-Qwen regression is the minimal reliable production
change under the frozen architecture, but a single happy-path Qwen call is not enough.
The gate must exercise the real configured model through the complete interpretation
merge, PHM-A projection, and Planner tuple, and must preserve these counterexamples:

1. Generic reciprocal greeting with no independent content: no accepted
   `opens_new_thread` or `continues_active_thread`; reciprocal completion wins.
2. Concrete redirect: a current turn that actually introduces a new topic must retain
   `opens_new_thread` and plan `continue_user_introduced_content`.
3. Mixed greeting plus topic: `acknowledges_previous_move + opens_new_thread` remains a
   valid compatible set; User content wins under section 14.4.
4. Concrete continuation ambiguity: a substantively supported
   `continues_active_thread` candidate must survive. If it forms a genuinely
   incompatible set with reciprocal evidence and no redirect, Planner must continue
   to defer.
5. Question-greeting answer and unsupported reciprocal/question pairs retain their
   existing typed mappings.

The real-model matrix must assert candidate kinds and the downstream plan tuple, not
Qwen's natural-language notes/evidence wording. An offline Prompt assertion and
injected-candidate regressions should accompany it so provider unavailability does
not make the local structural gate meaningless. No parser, model threshold, Planner,
Surface, or Validator change is needed.

## Files To Change

- `conversation-os/control/turnInterpreter.ts` — broaden only the exact adjacency
  fallback supersession check from eligible model candidates to all accepted
  exact-target concrete candidates; keep all other candidate merging unchanged.
- `scripts/interaction-move-handoff-check.ts` — add the pure deterministic sufficient
  semantic-evidence reproduction and structural counterexamples for exact fingerprint,
  target binding, continues-only, model-supplied continues, and compatible
  multi-candidate preservation.
- `scripts/interaction-move-handoff-planner-check.ts` — add the minimal end-to-end
  reciprocal completion assertion plus true-ambiguity, unsupported-pair, and no-valid-
  concrete-candidate defer assertions.
- `conversation-os/control/interactionMoveHandoff.ts` — no production change expected;
  its target filtering and relation mapping remain verification dependencies.
- `conversation-os/control/interactionMoveHandoffPlanner.ts` — no production change
  expected; its section 14.4 compatibility and defer behavior remain verification
  dependencies.
- `services/ai/turnInterpretationAdapter.ts` — calibrate only the semantic definitions
  of `opens_new_thread`, `continues_active_thread`, acknowledgment, and legitimate
  multiple-candidate output; keep parsing, provider selection, thresholds, target
  binding, and merge mechanics unchanged.
- `scripts/natural-chat-control-check.ts` — assert that the external interpretation
  Prompt retains the content-bearing relation contract without introducing wording
  matchers or response-planning instructions.
- `scripts/interaction-move-handoff-check.ts` and
  `scripts/interaction-move-handoff-planner-check.ts` — retain deterministic injected-
  candidate preservation cases for concrete redirect, mixed greeting plus topic, and
  true continuation ambiguity.
- `scripts/interaction-move-handoff-turn-interpretation-qwen-eval.ts` (new) and the
  minimal package gate registration — run the dedicated real-Qwen interpretation
  matrix through merge, PHM-A projection, and Planner. Do not reuse the PHM-C
  structured-output Validator eval because it owns a different model call and
  acceptance boundary.

## Risks

- An over-broad filter could erase true ambiguity. Removal must match only the exact
  deterministic adjacency fallback fingerprint; model-supplied or substantively
  evidenced `continues_active_thread` candidates must survive.
- Allowing targetless, wrong-target, or below-threshold candidates to trigger
  suppression would weaken section 14.2 identity binding. Only an accepted candidate
  with an explicit exact active-target id may retire the fallback.
- Treating every deterministic relation as authoritative could create false
  completion. The proposal does not change relation acceptance or mapping; it only
  prevents a generic fallback from competing after any concrete exact-target relation
  already exists.
- Confidence-only identification would be brittle and could delete unrelated
  candidates at `0.68`. The relation, confidence, and sole evidence constant must all
  match.
- Changing Planner compatibility or teaching Validator to accept defer realizations
  would hide the upstream defect and violate the frozen contract.
- A greeting-text special case would fail on other reciprocal realizations and breach
  the no-wording-rule boundary; no text rule is permitted.
- Over-calibrating the Prompt to make acknowledgment exclusive would erase valid mixed
  greeting-plus-topic turns. The rule must be content-bearing, not “greetings are
  always reciprocal only.”
- Suppressing all `opens_new_thread` candidates paired with reciprocal evidence would
  violate section 14.4 and lose concrete redirects. The correction belongs before
  merge, in the model's typed semantic contract.
- Suppressing all `continues_active_thread` candidates would hide true continuation
  ambiguity and weaken fail-closed behavior. Concrete continuation evidence must
  remain eligible.
- One successful real-Qwen sample can pass by chance. Acceptance must use the frozen
  adversarial matrix and assert structured candidate/plan outcomes while keeping
  provider failures classified separately from semantic regressions.
- Adding a deterministic post-model check over `notes`, `evidence`, greeting words, or
  topic keywords would create a second untyped classifier and couple correctness to
  model prose. That is explicitly outside the minimal reliable solution.
