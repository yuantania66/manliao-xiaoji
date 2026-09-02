> Superseded decision (2026-08-24): product authority now permits a pure reciprocal `responseActions=[]` plan to ask at most one low-pressure topic-choice question after reciprocal completion. Earlier no-question language below remains historical evidence, not current implementation authority.

## Problem

A new real full-chain run now reaches an unambiguous PHM-A projection and the correct
Planner tuple for a pure reciprocal User greeting:

- `selectedRelation=reciprocates_move`;
- `requiredFunction=complete_reciprocal_contact`;
- `completionIntent=fulfill`;
- `questionPolicy=optional_after_completion`.

Surface nevertheless produces `你好，我在。` on both same-plan attempts. The unchanged
semantic Validator correctly rejects both because a second greeting plus Assistant
presence statement does not realize `complete_reciprocal_contact`, and execution ends
as `GENERATION_NONCONFORMANT`.

The first causal question is whether Surface merely chose bad wording or whether its
single decision authority gave it conflicting requirements. Contract sections
14.3–14.5 allow the handoff function to stand alone. An ordinary continuation is
optional and requires independent current-turn support; the Planner must not invent a
second greeting, receipt, echo, presence statement, or generic open door.

After the Planner composition repair produces the intended
`responseActions=[]`, a new real full-chain run still fails twice. Surface returns a
second greeting plus an availability/open-door realization, ending with
`你好呀，随时可以跟我聊聊。`; the unchanged Validator correctly rejects both attempts.
This invalidates the Planner-only repair as final acceptance evidence and moves the
first remaining causal boundary to the Surface Prompt itself.

## Evidence

Observation:

- `actionsForState` in `conversation-os/control/responsePlanner.ts` always inserts a
  fallback action when no substantive ordinary action was selected. Outside the
  legacy proactive-greeting path, that fallback is
  `acknowledge_without_psychologizing`.
- `createResponsePlan` calls `actionsForState` before composing the v1 handoff plan.
  When `hasAnyV1HandoffInput` is true it removes only the legacy
  `respond_to_proactive_greeting` action and has special action composition for
  boundary, repair, and direct-answer handoff functions. It has no composition rule
  for `complete_reciprocal_contact`.
- Therefore a pure reciprocal handoff with no independently selected ordinary action
  leaves `responseActions=[acknowledge_without_psychologizing]` even though the handoff
  function is already the complete positive response obligation.
- The base Surface Prompt requires the model to complete every `responseAction`. The
  action-specific constraint for `acknowledge_without_psychologizing` tells it to
  acknowledge only content explicit in the current User turn. For a pure greeting,
  the only explicit content available to acknowledge is the greeting itself.
- The handoff constraints simultaneously require Surface to accept the reciprocal
  contact as sufficient and explicitly forbid replacing that function with another
  greeting, receipt, echo, Assistant-presence confirmation, availability statement,
  or generic open door. Thus the plan asks Surface both to acknowledge the only
  available greeting content and not to realize that acknowledgment in any of the
  greeting/receipt/presence forms naturally produced for it.
- Both real attempts converge on `你好，我在。`, directly reflecting the conflicting
  action and handoff constraints. Surface is not authorized to delete the Planner
  action or reinterpret the handoff, so retrying the same plan cannot reliably repair
  the contradiction.
- `ResponsePlan.responseActions` is typed as `ResponseAction[]`, not a non-empty tuple.
  `formatResponsePlanForPrompt` explicitly formats an empty array as
  `responseActions: none`.
- `preflightResponsePlan` has no general non-empty action requirement. For
  `complete_reciprocal_contact` it only forbids the legacy proactive-greeting action;
  it does not require an ordinary action. Its action-provenance loop is vacuously
  valid for an empty array.
- Detached preflight authority binds the exact handoff plan, current/target sources,
  answer obligations, and canonical handoff/obligation provenance. It does not require
  or snapshot a default ordinary action. Removing the Planner-created fallback before
  final plan assembly does not weaken handoff identity or authority comparison.
- Existing PHM-C Surface/Validator fixtures already construct valid handoff
  `ResponsePlan` values with `responseActions=[]`; `fullTuplePlan` uses that shape for
  `complete_reciprocal_contact`. The tests also prove that an optional question without
  an independently supporting ordinary action is rejected, while an explicitly
  supported continuation remains eligible only after the positive function.
- Existing PHM-B Planner tests prove the reciprocal tuple and preflight success, but
  assert only that the legacy `respond_to_proactive_greeting` action is absent. They do
  not assert that the unsupported default acknowledgment is absent.

Subsequent evidence after the Planner repair:

- The real plan now has the correct reciprocal tuple and `responseActions=[]`; the
  acknowledgment-specific Surface constraints are absent. This rules out ordinary
  action composition as the cause of the remaining failure.
- Both real Surface attempts still produce another greeting followed by Assistant
  availability or a generic open door; the final candidate is
  `你好呀，随时可以跟我聊聊。` Strict semantic validation rejects the candidates for
  `function_or_policy_not_satisfied`.
- `RESPONSE_PLAN_PRODUCT_PROMPT` tells Surface to realize the plan, avoid unsupported
  facts, and use concise natural Chinese. It does not define how a stand-alone handoff
  function becomes a visible conversational move when no ordinary action exists.
- `handoffSurfaceConstraintsFor` gives `complete_reciprocal_contact` one abstract
  positive instruction—accept reciprocal contact as sufficient and release the
  greeting ritual—followed by a detailed prohibition list. It does not provide an
  executable semantic sequence for moving from already-established mutual contact to
  a natural no-question settled reply.
- The Validator contract is more operationally explicit: satisfaction requires
  treating reciprocal contact as already sufficient and releasing the ritual into a
  natural transition or continuation. It independently rejects a second greeting,
  receipt/echo, presence/availability statement, or generic open door. This is
  contract-reference evidence only; Validator must remain independent and unchanged.
- Existing Surface/Validator tests assert the abstract accept/release instruction and
  repeated-greeting prohibition, but do not prove that real Surface can positively
  realize the stand-alone function for either non-question greeting source.

Interpretation:

- The Validator is enforcing section 14.5 correctly, and the real outputs show that
  Surface is following one side of an internally inconsistent plan rather than freely
  choosing unrelated wording.
- The first causal boundary is Planner ordinary-action composition, specifically the
  survival of the default `acknowledge_without_psychologizing` fallback after
  `complete_reciprocal_contact` has become the positive handoff function.
- Surface wording is the symptom. A wording template would hide the conflicting
  Planner contract, and relaxing Validator would accept exactly the second-greeting
  and presence behavior section 14.5 prohibits.
- Once `responseActions=[]` removes that conflict, the repeated real output is no
  longer explained by Planner composition. Surface has mostly prohibitions plus an
  abstract function name, but lacks sufficiently executable positive realization
  semantics. The first remaining causal boundary is therefore the Surface Prompt,
  not Interpreter, Planner, Validator, parser, or model threshold.

## Root Cause

`actionsForState` assumes that every ordinary turn needs at least one ordinary
`responseAction`. PHM-B/PHM-C introduced a separately typed handoff function that can
itself be the complete response obligation, but `hasAnyV1HandoffInput` composition was
not extended for that case.

For a pure reciprocal turn, the execution contract is consequently composed from two
authorities with different semantics:

1. the handoff plan says mutual contact is already sufficient and the greeting ritual
   must be released;
2. the ordinary fallback action says the current User content still requires an
   acknowledgment.

Because no independent topic, obligation, repair, boundary, affect-support, or
action-support action exists, the fallback acknowledgment is not an optional ordinary
continuation supported by separate current-turn evidence. It is merely the default
used to prevent an empty action array. That assumption conflicts with section 14.3's
explicit stand-alone handoff rule.

The Planner repair exposes a second, final root cause. The Surface Prompt defines
`complete_reciprocal_contact` asymmetrically:

1. the positive side says only “accept” and “release,” which are evaluation outcomes
   rather than executable conversational steps;
2. the negative side enumerates the most likely model realizations—greeting, receipt,
   echo, presence, availability, and open door;
3. with `responseActions=none`, no other positive action tells Surface what the visible
   reply should do after avoiding those forms.

Qwen therefore falls back to the familiar greet-and-offer-availability pattern while
violating the abstract postcondition. Same-plan retry repeats the failure because the
missing positive realization structure is unchanged. This is Prompt
under-specification, not stochastic wording alone.

## Proposed Solution

Change only Planner v1 action composition:

- After `interactionMoveHandoffPlan` is created, when its required function is
  `complete_reciprocal_contact`, remove
  `acknowledge_without_psychologizing` from `actions`.
- Keep the change narrow to that default action and that handoff function. In the
  current `actionsForState` design, the fallback acknowledgment is added only when the
  action list was otherwise empty, so removing it yields `responseActions=[]` only for
  a pure reciprocal handoff.
- Do not blanket-clear the action list. Independently selected actions such as a
  current direct answer, boundary, repair, affect support, action support, or a valid
  ordinary handoff action retain their existing composition and relevance provenance.
  Higher-priority handoff functions already own their explicit action rules.
- Keep `questionPolicy=optional_after_completion` on the handoff tuple. With no
  supporting ordinary action, the existing Surface constraint and Validator require
  zero questions. If a separately supported ordinary action survives, the existing
  contract still permits at most one question after the reciprocal function is fully
  realized.
- Leave `positiveFunctionContract` unchanged. The reciprocal positive function is
  carried by `interactionMoveHandoffPlan`, not by an ordinary action-level positive
  contract.
- Do not add a fixed Chinese reply, phrase list, regex, special greeting matcher, or
  Surface postprocessor. Do not relax Validator, change Interpreter output or model
  thresholds, or add lifecycle state.

Required regressions:

1. Pure reciprocal after each non-question greeting function produces the frozen
   reciprocal tuple and `responseActions=[]`.
2. The resulting plan passes detached preflight with unchanged canonical handoff
   authority and formats `responseActions: none` while retaining the full
   `complete_reciprocal_contact` Surface constraints.
3. The acknowledgment-specific Surface constraints are absent when the default action
   is removed; no wording template is added.
4. A real or production-equivalent Surface run must realize the unchanged reciprocal
   contract and pass the strict Validator without a second greeting, receipt, echo,
   presence/availability statement, generic open door, or unsupported question.
5. A reciprocal handoff with an independently supported ordinary action preserves
   that action and its provenance; an optional question is accepted only after the
   positive handoff function.
6. Direct-answer, boundary, repair, question-greeting, redirect/continuation, defer,
   Safety, Guest/authenticated parity, and immutable preflight-authority cases remain
   unchanged.

The Planner repair remains required, but the final authorized repair is a Surface
Prompt calibration only:

- Add an explicit semantic realization sequence for
  `complete_reciprocal_contact`:
  1. treat mutual contact as already established by the Assistant opening and User
     reciprocal move; do not greet again or prove Assistant presence;
  2. make the visible reply move beyond the greeting ritual, presupposing that contact
     is complete rather than requesting or offering contact again;
  3. when `responseActions=none`, let that transition settle naturally and end without
     a question, invitation, availability offer, or demand for a topic;
  4. when an independently supported ordinary action exists, realize the reciprocal
     transition first and only then continue that supported content.
- State that these are semantic composition steps, not wording to quote. Surface must
  not copy, translate, mechanically paraphrase, or expose the Prompt explanation.
  Provide no fixed Chinese final reply and no phrase or keyword whitelist.
- Keep the existing negative categories, but pair them with the positive sequence so
  the model has an executable alternative.
- Do not add a postprocessor, fallback reply, greeting detector, regex, Surface
  self-verification label, or Validator exception. Strict same-plan validation remains
  the acceptance authority.

Required real-Qwen Surface/full-chain matrix:

1. Positive simple-greeting source: `initiate_reciprocal_contact`, pure reciprocal User
   move, and `responseActions=[]` must generate a candidate accepted by the unchanged
   Validator.
2. Positive open-statement source: `offer_self_contained_conversation_entry`, pure
   reciprocal User move, and `responseActions=[]` must pass the same full chain.
3. A second greeting-only candidate remains rejected.
4. Presence confirmation, availability offer, and generic open door remain rejected,
   including mixed forms appended after a greeting.
5. With no independently supported ordinary action, any semantic request for another
   User response remains rejected even without question punctuation.
6. When the User both reciprocates and supplies a concrete topic, the existing
   `continue_user_introduced_content` and supported ordinary continuation path remains
   intact; calibration must not force a stand-alone settled reply or discard content.

The gate must exercise actual Surface generation followed by the unchanged strict
Validator, assert the frozen plan does not change between attempts, and classify model
or network infrastructure failure separately from semantic failure. Offline Prompt
assertions should verify the semantic sequence and absence of fixed final-reply
templates; deterministic Validator fixtures remain supporting negative evidence.

## Files To Change

- `conversation-os/control/responsePlanner.ts` — add the narrow
  `complete_reciprocal_contact` composition rule that removes only the unsupported
  default `acknowledge_without_psychologizing` action.
- `scripts/interaction-move-handoff-planner-check.ts` — assert the empty pure-reciprocal
  action list, detached-preflight success, both non-question greeting functions, and
  preservation of independently supported ordinary actions/provenance.
- `scripts/interaction-move-handoff-surface-validator-check.ts` — assert
  `responseActions: none`, presence of the unchanged reciprocal handoff constraints,
  absence of acknowledgment-specific constraints, strict rejection of forbidden
  realizations, and preservation of supported optional continuation behavior.
- `services/ai/promptBuilder.ts` — no production change expected; its existing handoff
  constraints and empty-action formatting are verification dependencies.
- `services/ai/chatExecutionLifecycle.ts` and
  `conversation-os/control/responsePlanPreflightAuthority.ts` — no production change
  expected; their existing empty-action legality and detached handoff authority are
  verification dependencies.
- `services/ai/promptBuilder.ts` — add only the positive semantic realization sequence
  and no-copy/no-template instruction for `complete_reciprocal_contact`; keep the base
  Prompt, history scope, other handoff functions, and existing negative constraints
  unchanged.
- `scripts/interaction-move-handoff-surface-validator-check.ts` — assert the calibrated
  sequence is projected only for reciprocal completion, contains no fixed Chinese
  reply template, and preserves all strict positive and negative Validator fixtures.
- `scripts/interaction-move-handoff-surface-qwen-eval.ts` (new) plus minimal package
  gate registration — run both non-question-source positive cases, repeated greeting,
  presence/availability/open-door, unsupported-question negatives, and mixed
  concrete-topic preservation through real Surface and the unchanged Validator.
- `conversation-os/control/responsePlanner.ts` — no additional production change; the
  already authorized empty-action composition is the frozen input to this calibration.
- `services/ai/interactionMoveHandoffOutputValidator.ts` — no production change; its
  strict positive and negative semantics remain the independent acceptance authority.

## Risks

- Clearing every action for every reciprocal candidate would erase independently
  supported obligations or continuations. Remove only the default acknowledgment and
  only under `complete_reciprocal_contact`.
- Treating `responseActions=[]` as “no plan” would be incorrect: the typed handoff plan
  remains the required semantic function, and existing Prompt, preflight, and
  Validator contracts already support the empty ordinary-action array.
- Adding a canned reciprocal line could pass one fixture while violating the no-wording
  contract and failing across other natural realizations.
- Weakening Validator to accept `你好，我在。` would reverse the frozen positive
  postcondition and reintroduce the exact repeated-greeting/presence failure the PHM-C
  calibration sealed.
- Removing the handoff constraints because actions are empty would leave Surface
  without the positive function. The handoff tuple and constraints must remain
  unchanged and authoritative.
- An optional question must not become implicit merely because the handoff policy says
  `optional_after_completion`; without an independently selected ordinary action it
  remains unsupported and must be rejected.
- Adding only more prohibitions is unlikely to help: the real failure already occurs
  under the current prohibition list. The repair must add a positive semantic path.
- A fixed Chinese answer, few-shot phrase to imitate, or keyword whitelist may pass one
  greeting but would turn a semantic contract into a brittle wording template. The
  Prompt must describe structure and explicitly forbid copying its explanation.
- Overstating “settle and end” could suppress valid mixed greeting-plus-topic turns.
  The settled form applies only when no independently supported ordinary action exists;
  supported content continues after the reciprocal transition.
- Reusing Validator verdict wording as a Surface self-report would compromise
  independence. Surface may share the frozen semantics but must never emit function
  labels, plan claims, or validation language.
- One successful Qwen sample is insufficient after repeated real failures. The frozen
  full-chain matrix must cover both non-question greeting functions and all named
  negative/preservation categories without changing Validator strictness.
