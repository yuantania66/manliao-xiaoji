## Problem

The current output path collapses two different questions into one Boolean:

1. Is this candidate safe, factually grounded, bound to the frozen turn/plan, structurally valid, and eligible to cross the commit boundary?
2. Is this candidate natural, chatty, well-punctuated, non-formulaic, and a strong realization of the intended conversational posture?

`enforceResponsePlan` unions deterministic and semantic failure reasons. Any first-candidate reason causes one same-plan regeneration; any second-candidate reason produces `constraint_failure`, which orchestration exposes as retryable `GENERATION_NONCONFORMANT`. Consequently, a punctuation mark, closure phrase, ordinary acknowledgement judgment, topic-entry wording, or subjective semantic-chatability verdict can prevent an otherwise safe candidate from becoming an Assistant winner and push repair work onto the user.

The required boundary is narrower: hard failures must still fail closed; advisory chat-quality failures should produce one internal same-plan rewrite, but an advisory-only second result must remain commit-eligible and must not ask the user to regenerate. This changes neither Planner ownership nor persistent lifecycle state.

## Evidence

Safety is an independent hard pre-gate. `CRISIS_PATTERN` currently matches these alternatives exactly: `自杀`, `轻生`, `不想活`, `不想活了`, `结束生命`, `伤害自己`, `伤害我自己`, `割腕`, `寻死`, `去死`, `杀了自己`, `消失.*没人.*在意`, `没人.*在意.*消失`, `杀人`, `杀了他`, `杀了她`, `砍人`, `捅人`, `报复社会`, `同归于尽`, `控制不住.*动手`, `找.*算账.*动手`, `可能会动手`, `打了我`, `打我了`, `刚刚打我`, `被打`, `家暴`, `躲在厕所`, `吃了.*很多药`, `吃.*很多药.*晕`, `吞药`, `药物过量`, `药.*吃多`. A match is excluded when any of these holds:

- media/news context: `电影|电视剧|小说|新闻|报道|视频|游戏|剧情|角色|演员|纪录片`;
- first-person negation followed within 0–8 characters by a listed self/other-harm term: `我(不会|不會|没有|沒|没|并不)...`;
- explicit past abuse/overdose context followed by a current-safe phrase: `(以前|过去|小时候|之前|曾经|当时)...(被打|打我|家暴|吃多.*药|药.*吃多|吞药)...(现在想起来|现在已经|已经没事|现在没事|没有危险|现在安全|过去了)`.

On a non-excluded match, ordinary Context, Interpretation, Clinical/Helping, Planner, Surface, and ordinary validators are skipped. The fixed response is:

`我不是心理医生，也不能提供现实中的紧急援助。这件事先别一个人扛。请马上联系身边可信的人；如果有现实危险，立刻拨打当地紧急电话或去最近的急诊。`

The first sentence is omitted only if Assistant Grounding says the assistant is a clinician. The Safety execution is marked `VALIDATED` because this code-owned response has passed the Safety-owned boundary, not because ordinary chat quality was judged.

`PLAN_INVALID` is also unrelated to wording quality. It means the single Planner's `ResponsePlan` failed detached preflight against the frozen authority snapshot. No Surface/model call occurs, no generation attempt or Assistant event is created, open obligations and Interaction State remain unchanged, and a retryable execution failure is returned. This is the guard against Planner drift, mismatched obligations/provenance, or a handoff plan that is not exactly the authorized one.

Current deterministic quality failures include:

- punctuation/count: `question_not_allowed_by_plan`, `too_many_follow_up_questions`;
- closure lexicon: `premature_closure`;
- topic-entry lexicon: `missing_light_topic_initiative`, `initiative_returned_to_user`, `topic_initiative:reassurance_or_pause_preface`, `topic_initiative:positive_or_healing_frame`;
- ordinary acknowledgement: `ordinary_acknowledgement:generic_causal_mechanism`, `ordinary_acknowledgement:unsupported_evaluation:<term>` where the terms are `热闹`, `棒`, `挺好`, `很好`, `不错`, `难得`, `珍贵`, `舒服`, `放松`, `开心`, `有趣`, `好玩`, `投入`;
- ordinary handoff: `ordinary_handoff:no_new_conversation_function`, `ordinary_handoff:calibration_requires_one_question`, `ordinary_handoff:calibration_demands_explanation`, `ordinary_handoff:calibration_suggests_unproved_meaning`, `ordinary_handoff:question_forbidden_for_selected_move`;
- legacy proactive-response quality: `proactive_greeting_response:empty_acknowledgement`, `generic_closure`, `generic_approval`, `unsupported_evaluation:<term>`, `bare_echo`, and `generic_follow_up`.

These are currently OR-ed with hard failures. The same is true of planned-function semantic results: malformed output, wrong binding, wrong evidence, provider failure, target/function failure, and semantic question/chatability judgment all contribute to one failed result.

Identity, facts, and adjacent-claim authority are materially different. `unanswered_obligation:<id>:<kind>` binds the visible answer to a current-turn obligation. `assistant_identity:missing_positive_function_contract`, `missing_canonical_display_name`, `product_name_used_as_assistant_name`, `canonical_identity_withheld`, and `missing_product_assistant_disambiguation` protect the canonical Assistant/product identity. `repeated_rejected_grounding_proposition:<id>`, `assistant_grounding:embodiment_claim`, `clinician_claim`, `human_claim`, `unsupported_perception_or_contact`, and the reasons returned by `collectUnsupportedMeaningFailureReasons` protect committed or available facts. Emotional-support failures that identify invented affect, intensity, event, time, cause, or unknown content also protect factual scope. Repair failures bind withdrawal/replacement to the exact rejected proposition or adjacent move. These are not style preferences.

The planned-function semantic parser is intentionally strict: exact JSON keys and types, exact `planId`, exact handoff/positive-function binding, exact nullable branches, and exact UTF-16 evidence slices. `planned_function_semantic:missing_context`, `handoff_missing_context`, `provider_failure`, `malformed_verdict`, `binding_mismatch`, and `evidence_mismatch` are technical trust failures. A bound handoff/identity/emotional-support/repair branch must address its exact target, realize its exact function/action, and contain no contradictory move. Those properties enforce the frozen plan rather than choosing a new plan.

Proactive generation can reject every candidate in several ways. Structured intent generation tries twice and then fails if both outputs are malformed/invalid or use the reserved first-contact intent in the wrong context. For a frozen intent, each of two Surface candidates can be rejected for empty/over-160 text, missing first-contact `小慢`, using `慢聊小记` as the Assistant name, text similarity at or above `0.72`, malformed or misbound semantic-verdict JSON/evidence, or a negative semantic verdict. If both candidates are rejected, `generateProactiveGreeting` throws `AI_GENERATION_FAILED`; Guest/Auth outer delivery may invoke the whole generator once more, so the eventual user-visible failure can follow four Surface candidates. There is no fixed welcome fallback.

`VALIDATED` exists as the commit eligibility boundary. It means the final execution is tied to the current turn and frozen plan and has cleared every hard gate; it does not mean the Assistant message has been persisted. Auth commit accepts only `VALIDATED`, requires `execution.turnId === replyToMessageId`, and then uses one transaction to create or reuse the single Assistant reply, update the session, construct the move envelope, and write the `COMMITTED` trace/envelope back to the accepted generation. In plain terms: either the message, session pointer, and structured receipt agree, or no Assistant winner is returned. Generation/judge audit rows written before that transaction may remain after a persistence error.

The envelope is that structured receipt: who produced the move, which turn/plan it belongs to, what it claimed/requested, and whether it `opens`, `fulfills`, or Safety-`supersedes` a proactive handoff. A handoff is not a prose-quality score; it is an immutable edge between exact committed event IDs. `activeHandoff` is true only for the unique immediately adjacent proactive Assistant `opens` event, the current unique User event, and no later exact `fulfills`/`supersedes` edge. Lifecycle is derived by strict read-only parsing of committed envelopes; there is no mutable persistent “handoff active” state to add or update.

## Root Cause

The primary cause is the shape of `ResponseValidationResult` and `enforceResponsePlan`: all validator reasons share `passed`, and both attempts require `failureReasons.length === 0`. Orchestration therefore cannot distinguish “unsafe/unbound/uncommittable” from “safe but conversationally weak.” The second advisory failure is promoted to the same `GENERATION_NONCONFORMANT` used for hard plan violations.

The same conflation exists inside proactive validation. `proactiveGreetingVerdictAccepted` ANDs intent fidelity, Grounding, burden/contradiction, semantic clarity, anchored point, self-containment, reveal timing, and topic distinctness into one Boolean. `evaluateProactiveGreetingCandidate` then reduces every valid negative verdict to `verdict:negative`, so the caller has no basis for a hard/advisory decision after its same-intent repair.

The technical commit gates are not the cause. Strict parsers, exact binding, immutable edges, `VALIDATED`, and the Auth transaction correctly prevent corrupt or cross-turn commits. Weakening them would treat metadata or persistence inconsistency as if it were ordinary prose quality.

## Proposed Solution

Introduce an internal two-severity validation result without changing Planner output or persistent lifecycle:

- `hardFailureReasons: string[]` controls `passed` and commit eligibility.
- `advisoryFailureReasons: string[]` controls one same-plan/Same-intent rewrite and trace diagnostics only.
- Preserve the existing combined `failureReasons` in traces if compatibility requires it, but calculate `passed` from `hardFailureReasons.length === 0` after the rewrite opportunity.

Exact ordinary classification:

- Advisory: `question_not_allowed_by_plan`, `too_many_follow_up_questions`, `premature_closure`, `missing_light_topic_initiative`, `initiative_returned_to_user`, every `ordinary_acknowledgement:*`, every `ordinary_handoff:*`, every `topic_initiative:*`, and legacy proactive-response `empty_acknowledgement`, `generic_closure`, `generic_approval`, `unsupported_evaluation:*`, `bare_echo`, `generic_follow_up`.
- Hard: every `unanswered_obligation:*`; every `assistant_identity:*`; every `repeated_rejected_grounding_proposition:*`; every `assistant_grounding:*`; all unsupported-meaning reasons; `proactive_greeting_response:stale_pre_greeting_content`; all repair contract failures; and emotional-support reasons that represent missing bound contracts/functions, contradictory moves, or invented affect/intensity/event/time/cause/content.

Exact planned-function semantic classification:

- Hard unchanged: `planned_function_semantic:missing_context`, `handoff_missing_context`, `provider_failure`, `malformed_verdict`, `binding_mismatch`, and `evidence_mismatch`.
- Context-sensitive handoff function: `handoff_uncertain` and `handoff_not_satisfied` remain hard for `answer_current_obligation`, `withdraw_or_repair_targeted_move`, and `respect_user_boundary`; they are advisory for ordinary conversational functions `complete_reciprocal_contact`, `continue_from_user_answer`, and `continue_user_introduced_content`.
- Positive function remains hard in this slice: `positive_function_uncertain` and `positive_function_not_satisfied`. Identity, repair, and the bound emotional-support contract are not reclassified while their factual and contradictory-move subcauses are still combined in one code.
- Advisory: `planned_function_semantic:question_policy_not_satisfied`. This code currently combines count and handoff ordering. Split it before classification into `planned_function_semantic:question_count_quality` (advisory) and `planned_function_semantic:handoff_question_order_not_satisfied` (hard), so relaxing question count cannot relax exact handoff-function ordering.

Exact proactive classification should retain strict parsing and expose granular reasons instead of `verdict:negative`:

- Hard: `surface:invalid_length`; `surface:missing_first_contact_identity`; `surface:product_name_used_as_assistant_name`; every `verdict:*` parse/binding/evidence/type error; and valid-verdict failures of `intentFaithfullyRealized`, `propositionDelivered`, `createsUserObligation`, `groundingObeyed`, or `contradictoryMove`.
- Advisory: `surface:duplicate_text` and valid-verdict failures of `semanticClarity`, `anchoredCommunicativePoint`, `selfContained`, `requiresSecondAssistantReveal`, or `topicDistinct`.

Retry algorithm for ordinary replies:

1. Generate candidate 1 and collect both severities.
2. If neither severity exists, validate normally.
3. If either severity exists, perform exactly one internal rewrite with the same recursively frozen `ResponsePlan` and include all concrete failure feedback.
4. If candidate 2 has any hard failure, keep current fail-closed `GENERATION_NONCONFORMANT`; do not commit it and do not create a fallback plan/message.
5. If candidate 2 has only advisory failures, mark the execution `VALIDATED`, select candidate 2 as the winner, record unresolved advisories in trace/debug evidence, and do not return a retryable user status.

When the unresolved advisory is an ordinary handoff function, commit the reply without a `fulfills` edge. The immutable envelope must never claim completion that the semantic validator did not establish. This is a truthful `handoff=null` commit, not mutable lifecycle state and not a fallback plan.

Use the same rule for proactive Surface candidates: the second same-intent candidate may be accepted with advisory-only findings; any remaining hard failure still rejects the generator invocation and preserves the existing outer recovery/failure behavior. Strict intent generation and verdict parsing remain fail closed.

`VALIDATED` should therefore mean “hard-gate valid and commit-eligible.” It must not be renamed or bypassed. `chatReplyService`, envelope builders/parsers, exact active-handoff queries, and the Auth transaction remain unchanged. Do not add a database column, aggregate handoff status, fallback reply, extra Planner pass, or additional user-triggered retry.

## Files To Change

Implementation:

- `services/ai/responsePlanValidator.ts`: classify deterministic/semantic reasons, preserve one frozen-plan rewrite, and accept advisory-only second candidates.
- `services/ai/plannedFunctionSemanticValidator.ts`: split semantic question count from hard handoff ordering and return severity-aware reasons while preserving exact parser/binding/evidence failures.
- `services/ai/proactiveGreeting.ts`: return granular hard/advisory verdict reasons and accept advisory-only output after one same-intent repair.
- `services/ai/chatOrchestrationService.ts`: compute `GENERATION_NONCONFORMANT` only from remaining hard failures and retain advisories in diagnostics without changing lifecycle phases.
- `conversation-os/interactionMoveEnvelope.ts`: when the selected winner retains an advisory ordinary-handoff non-satisfaction, do not write a false `fulfills` edge; preserve strict parsing and immutable event semantics.
- The shared `ResponseValidationResult` type owner, only if needed to carry `hardFailureReasons`/`advisoryFailureReasons`; keep serialization backward compatible.
- `docs/CONVERSATION_OS_CONTROL_CLOSURE.md`: document that Validator quality feedback causes one internal rewrite while hard eligibility alone governs the final commit boundary.

Explicitly no runtime change: `services/ai/chatSafety.ts` and `services/ai/chatReplyService.ts`.

Focused tests:

- `scripts/natural-chat-control-check.ts`: open greeting, `想聊什么`, natural evaluation, reasonable closure, acknowledgement/handoff lexicon, advisory-only second candidate, and hard+advisory mixtures.
- `scripts/planned-function-semantic-validator-check.ts`: strict malformed/binding/evidence/provider failures remain hard; question-count quality is advisory; exact handoff ordering and bound function/target remain hard.
- `scripts/proactive-greeting-control-check.ts`: all-reject hard scenarios still fail; advisory-only second candidate succeeds; first-contact identity/Grounding/intent failures remain hard.
- `scripts/chat-execution-lifecycle-check.ts`: advisory-only winner reaches `VALIDATED`; remaining hard failure remains `GENERATION_NONCONFORMANT`; no extra retry or state transition.
- `scripts/interaction-move-envelope-check.ts` and `scripts/proactive-move-structured-commit-check.ts`: strict envelope parsing, exact immutable edges, adjacency, and commit binding are unchanged.

Representative counterexamples must include real crisis terms versus excluded media/negated/past-safe text; product-name impersonation and false body/clinician/human/perception claims; wrong plan/turn/evidence binding; stale pre-greeting history; malformed verdict JSON; a natural statement with question punctuation; `想聊什么` inside an otherwise usable entry; a natural unsupported-evaluation phrase; a contextually reasonable closing; and a proactive candidate that is intent-faithful but judged stylistically weak.

## Risks

- A broad prefix-based classifier can accidentally downgrade a future hard reason. Use an exhaustive mapping with an unknown-code default of hard, plus a test that new/unclassified reasons fail closed.
- `planned_function_semantic:question_policy_not_satisfied` currently merges two concepts. Marking it advisory without first splitting handoff ordering would relax a true same-plan binding.
- Some emotional-support rules mix factual invention with subjective style. Classify by the exact reason, not the `emotional_support:*` prefix; invented affect/event/cause and missing bound function remain hard.
- Accepting an advisory-only second candidate can expose mediocre wording. The bounded tradeoff is intentional: one internal rewrite is still required, but chat-quality uncertainty no longer deletes a safe reply or transfers repair to the user.
- Proactive `verdict:negative` currently discards diagnostic detail. Granular reasons must come from the already strictly parsed verdict, not from a second judge or new heuristic.
- Trace/type changes can break existing checks or persisted readers. Keep old `failureReasons` readable, add severity fields compatibly, and avoid rewriting historical records.
- Any change to `VALIDATED`, envelope construction, adjacency queries, or the Auth transaction would exceed this slice and could permit cross-turn or partially committed winners; those surfaces should be regression-tested, not edited.
