# AI services

All AI calls must be routed through this directory.

Route handlers must not call model providers directly. They should call service
functions that use:

- `aiService.ts` for primary AI generation
- `promptBuilder.ts` for the minimal product prompt, history sanitization, and versioning
- `modelProvider.ts` for provider-specific API calls
- `debugTrace.ts` for engineering trace output

The production chat route is controlled by Conversation OS:

- `chatOrchestrationService.ts` performs Context Assembly, relational Turn
  Interpretation, Interaction/Dialogue State reduction, one ResponsePlan, Surface Realization,
  same-plan Output Validation, and State Update;
- `aiService.ts` is only the Surface Realization adapter and requires the
  finalized ResponsePlan;
- `turnInterpretationAdapter.ts` may call the model only for ambiguous
  pragmatics. It returns multiple response-relation candidates and may not
  write a reply or plan. Its internal trace records whether a call was
  attempted/used, the justification, exact synthetic Prompt messages, model,
  latency, token counts, raw output, and provider failure without projecting
  any of those fields into Surface;
- legacy intent/scenario labels are evidence-only. Response Planner selects
  actions from `currentActivity`, `activeThread`, three-state common ground,
  scoped obligations, `initiativeOwner`, `lastCommittedAssistantMove`, and
  `repairState`;
- Memory, Assistant Grounding and Clinical Logic are bounded providers;
- Assistant Grounding has one source of truth. `availableFacts` supplies
  internal background truth, but ordinary Surface Realization does not receive
  the complete block. The Response Planner projects only turn-scoped,
  obligation-relevant `requiredDisclosure`, and `prohibitedClaims` remains a
  truth constraint rather than a disclaimer checklist;
- proactive greetings use the canonical Grounding formatter and a separate
  greeting-only action contract. A local selector chooses `simple_greeting`,
  `open_statement`, or `light_question`; questions are optional and may occur at
  most once in a three-greeting window. Simple greeting and opening statement
  are generation preferences under the same non-question validation boundary.
  Server timezone/time is not projected into the greeting Prompt because it is
  not evidence of the user's location or local day phase. The last three greeting texts remain
  internal validation evidence for duplicate and topic-reuse detection and are
  not projected into the external Prompt. Only system-defined move/topic labels
  may be projected for first-pass variation. When the next user turn follows a
  proactive greeting, the ordinary Response Planner creates a PHM-B
  `interactionMoveHandoffPlan`. For valid target-bound v1 input, it selects the
  required function, completion intent and question policy without using
  `promptVersion` as decision authority. If the greeting was a question, the user's
  immediate response retains the no-second-interview rule. A specific follow-up
  is optional only after a non-question greeting. For this handoff, Surface
  history begins at the latest proactive greeting; earlier committed events
  remain available to internal Context but are not projected unless the current
  user turn explicitly resumes them, including referential continuations such
  as `继续刚才那个` that do not repeat the old topic text. Bare echo, empty
  acknowledgement, generic approval, topic-switching for the sake of another
  answer, and closing phrases are rejected. Conventional metaphors remain
  governed by Grounding;
- PHM-C projects the complete preflight-valid interaction-move handoff tuple to
  Surface and validates every candidate through an independent structured
  same-plan semantic provider. One deep-cloned, recursively frozen execution
  plan is shared by first generation, bounded regeneration and validation;
  missing, malformed, mismatched or uncertain verdicts fail closed. This layer
  accepts or rejects candidates but does not write committed completion edges;
- Prompt History no longer deletes committed events by text, old Prompt
  version, low-information form, or template heuristics. It keeps a bounded
  recent raw window, filters only non-conversation/blocked events, and preserves
  explicit reply linkage through window cropping;
- corrections target an adjacent assistant turn and rejected proposition,
  suppress that proposition, and then resume any still-open user intent;
- assistant hypotheses remain in `commonGround.hypothesized` until user
  evidence confirms them; a user rejection moves the targeted proposition to
  `commonGround.rejected`;
- legacy Clinical advice is invoked only when Response Planner requests an
  emotional or action-support compatibility strategy;
- ordinary relationship repair excludes concurrent emotional/action support
  and does not invoke legacy Clinical advice. It may resume an already-open
  ordinary thread only when Interaction State still assigns that initiative;
- `offer_emotional_support` and `repair_previous_wording` require a
  Planner-owned `positiveFunctionContract` before Surface runs. Emotional
  support consumes the same Conversation State evidence spans used by Turn
  Interpretation and records each current-turn source offset, original text,
  normalized category, intensity and object, plus exactly one of
  expression-burden, focus-control, amount-control, or current
  relational-impact functions. Repair records the adjacent target
  and selects factual replacement, proposition withdrawal, or interaction-move
  withdrawal. Interaction-move repair also records one adjacent-evidence subtype:
  unsolicited advice, pressure question, generic listening, moralizing, or topic
  switch. Execution preflight verifies the evidence turn, source-text
  offsets and normalized metadata, and rejects missing, mismatched, or
  evidence-free contracts instead of allowing Surface or Validator to choose
  the function;
- ordinary `acknowledge_without_psychologizing` now also requires a frozen
  positive-function contract, bound to the exact current turn and the Planner's
  existing idle decision. Existing identity, support and repair contracts retain
  priority. The ordinary contract preserves useful confirmation, direct optional
  invitation, proportionate contextual affect and brief idle receipts; it rejects
  unsupported psychology, empty paraphrase and peripheral investigation without
  a current purpose. Ordinary semantic verification checks contextual purpose,
  the candidate's actual contribution, then independent boundaries; accepting a
  feeling or avoiding violations alone is not proof of completion. A useful reply
  need not ask, progress, advise or add facts; refusal and idle boundaries remain.
  It does not choose another posture or grant question permission.
  Its semantic context shares Surface's plan-scoped, sanitized history. Missing,
  mismatched, uncertain or malformed verdicts fail closed, using the existing one
  regeneration limit. Failed drafts remain internal diagnostics and cannot enter
  the Assistant commit transaction. Local fixed-provider checks establish these
  control-flow properties only. The 2026-10-20 focused live check rejected the
  saved paraphrase and accepted two permission/refusal controls (one call each);
  this does not establish generation quality or general judge reliability. A
  subsequent full createChatReply check accepted a newly generated paraphrase
  unchanged and skipped regeneration; final-response acceptance therefore failed.
  The prompt-only candidate repair is not an established overall fix. The next
  local repair requires ordinaryUseObservation in that same judge response and
  code ANDs its assessment with the existing verdict: reported repetition with
  no purpose, inconsistent labels, non-idle receipts, missing purpose evidence,
  and uncertainty cannot be overridden by satisfied. Purpose quotes must match
  exact UTF-16 slices of the current User text or an actual User-role entry in
  supplied sanitized history; Assistant sources and guessed offsets fail. Old
  raw verdicts remain unchanged and cannot be auto-filled into success. Other
  action schemas and the one-regeneration limit stay unchanged. Fixed-provider
  regressions establish code enforcement only: misreporting repetition as an
  otherwise useful response can still pass, so model observation accuracy and
  final reply quality remain unverified. The structural repair itself was local.
  Its subsequent authorized real check still labelled the saved paraphrase as
  other_response, with a wrong User quote end (29 versus 33 UTF-16 units).
  Evidence validation failed and the attempted schema repair was blocked before
  dispatch; no regeneration ran. An explicitly local offset-only diagnostic copy
  then passed, confirming the remaining observation-misclassification risk. This
  check did not establish a product fix (one request, CNY 0.034668). A subsequent
  reduced recognition task distinguished the saved repetition and a permission
  control once each; that does not establish full-judge reliability or identify
  a causal clause. The latest local candidate moves ordinaryUseObservation after
  binding and before status in the same ordinary output example, aligning its
  display with the existing observation-first instruction. System rules, field
  values, parser, gate and call count are unchanged; other actions are unchanged.
  Actual prompt capture verifies the sole ordinary schema-order change. JSON key
  order does not establish model reasoning order. The subsequent authorized
  full-judge pair correctly recognized and rejected saved repetition A for lack
  of purpose. B was labelled other_response/satisfied but its User-source quote
  end was 25 instead of 33, so evidence validation failed and a schema repair
  request was blocked before dispatch. Both labels matched once, but the full
  pair did not pass and no final generation was tested (two calls, CNY 0.067044).
  The following local fix reuses the existing exact unique-text normalizer for
  purpose quotes, only within the declared current User or indexed User-history
  source. It derives UTF-16 offsets without changing raw responses; ambiguous,
  missing, wrong-source or Assistant-history quotes still fail. The existing
  strict source checks and semantic AND remain. Both default-provider paths
  receive actual history; custom providers retain strict raw-offset validation.
  Saved real A/B responses replay locally with no schema repair: A remains
  rejected for repetition and B passes after unique location. No prompt, schema,
  classification, field-order or call-count change is made by this location fix;
  this replay is not verification of a newly generated final reply. The following
  live one-regeneration check still produced repetition, which the judge correctly
  rejected (two calls, CNY 0.056784). Inspection confirmed that regeneration got
  generic failure codes but neither the rejected draft nor its parsed observation.
  The next local bridge passes same-plan ordinary quality-rejection feedback
  through the existing callback to generation: rejected candidate, two observation
  enums and code assessment only, copied/frozen. It is a distinct low-privilege JSON
  data message, never a developer instruction or saved history; the current User
  remains last. No raw judge reason is forwarded. First drafts, different plans,
  other actions and technical failures get no feedback. Plans, quality rules and
  one-regeneration limits stay unchanged. Production-entry local checks prove
  transport only. The authorized live check then generated another paraphrase,
  correctly rejected as repeats_or_normalizes_only / none / not_satisfied (two
  calls, CNY 0.057912, no commit or retry). Independent request review confirms
  exact rejected-draft feedback reached generation; no further definite transport
  omission was found. Final reply quality remains unresolved; this is not evidence
  for a particular prompt clause or model setting as the sole cause;
- The subsequent authorized thinking A/B run did not establish final quality:
  the identical rejected paraphrase was accepted as `other_response`, while the
  thinking arm added a follow-up that independent review did not establish useful.
  Ordinary source quotes prove provenance, not accomplishment. The local gate now
  consumes `useComparison` for `other_response`: a brief source-meaning/candidate-act
  comparison bound to existing candidate evidence indices. Reported re-expression
  or no supported act fails independently of `satisfied`; uncertainty or a missing
  comparison in a non-idle legacy verdict remains uncertain, not malformed.
  Supported comparisons still require valid User source and candidate bindings.
  Useful repetition and trusted idle retain their existing rules. Two original
  provider responses are preserved byte-for-byte in the comparison regression;
  fully parsed human-labelled comparisons test code consumption separately from
  legacy missing-field coverage. A model can still misreport a supported comparison:
  local checks do not establish semantic accuracy or final-generation improvement.
  No generator changes or additional judge stages/calls are introduced.
- The existing same-plan regeneration formatter now accepts its already validated
  feedback. Only a confirmed ordinary repeat/none quality failure replaces the
  generic ordinary repair paragraph: respond anew within the same plan rather than
  polish the rejected draft. Plan/kind/candidate/assessment guards are required;
  all other formatter outputs remain unchanged. No candidate or raw judge reason
  is promoted into instructions, and no target, mandatory question, output field
  or extra call is added. The semantic gate is unchanged. Offline baseline and
  actual-request regression verifies routing only: the fixed rejected output stays
  rejected, and real generation improvement has not been demonstrated.
- Helping Logic runs after Safety and before final plan assembly. Batch 1 full
  Shadow is independently controlled by `HILL_HELPING_SHADOW`. The Batch 1.5
  candidate uses the separate default-off
  `HILL_HELPING_ORDINARY_HANDOFF` flag: only a deterministic `uncertain`
  applicability boundary may reach Response Planner, which selects an ordinary
  action with `behaviorSource=ordinary_conversation`. This handoff does not
  select a Hill goal/skill, write committed Helping state, or enable the full
  Hill provider;
- execution records `PLANNED`, `GENERATED`, `VALIDATED`, `REJECTED`,
  `RETRYING`, `COMMITTED`, and `FAILED`. Only the `VALIDATED → COMMITTED`
  transition creates an Assistant `ChatMessage`, conversational raw memory,
  obligation closure, or `lastCommittedAssistantMove`;
- for an ordinary Interaction Move Handoff, that same final commit boundary
  carries PHM-C's exact frozen plan and may atomically add a target-bound
  `fulfills` edge; `handoffCompleted` remains a pure committed-envelope query,
  not persisted lifecycle state;
- a validated Safety winner supersedes only the strict adjacent unresolved
  proactive `opens` target; superseded/resolved/active checks remain pure
  committed-event queries, and Safety without a target keeps a null envelope;
- Output Validation may accept, reject, or request one regeneration against the
  exact same plan. Regeneration preserves the internal failure code but adds a
  human-readable correction instruction for the failed constraint; it cannot
  re-plan, add a question forbidden by the plan, or author a fallback. A second
  failure keeps both candidates in internal
  `AiGeneration(status=FAILED)` trace and returns a separate system status;
- emotional-support validation requires both same-intensity grounding and the
  Planner-selected positive function. Function completion is compositional:
  user control, the selected function object, and the permitted action scope
  must all be present; equivalent natural word order is allowed. It also rejects formulaic
  presence/contact, generic normalization or reassurance, unsolicited
  regulation/pause advice, default cause/detail questions, and affect
  intensification unsupported by the current user turn. Repair validation
  checks the selected target type: a user-confirmed replacement fact, explicit
  withdrawal of a rejected proposition, or functional disavowal of the exact
  rejected interaction-move subtype without requiring a fixed withdrawal word.
  Reply-side affect equivalence is derived through the same canonical
  Conversation State evidence extractor as planning, including natural
  modifier and nominal forms; Validator does not maintain a second affect
  taxonomy. Current-focus control independently rejects unspecified unrelated
  content, unsupported additional causes/events, light-topic distraction, and
  mood-changing moves even when the selected positive function is otherwise
  present. Surface receives a single bounded current-focus construction and is
  explicitly prohibited from manufacturing an A-or-B choice with an unevidenced
  second branch. Interaction-move repair composes ownership, adjacent target evidence,
  and functional disavowal; no candidate sentence or internal subtype token is
  required. Pressure-question repair cannot concurrently start a light topic and
  is rejected if it continues with another question; other repairs preserve the
  previously approved initiative-resumption boundary;
- plan, generation, provider, timeout and persistence failures are execution
  events, never Assistant dialogue. Retry keeps the original conversation/turn
  identity and receives a new attempt identity; `replyToMessageId` enforces one
  committed reply per user turn;
- Prompt History reads committed message statuses only and preserves explicit
  reply-linked interaction units through filtering and window cropping;
- the same Response Planner selects `minimal`, `standard`, or `deep` planning
  depth from Interaction State complexity. Ordinary Surface Realization receives
  the bounded committed raw window and a depth-scoped plan projection plus
  truth/safety constraints. Relevance provenance remains in the internal plan
  and trace; Surface does not receive classifier traces, plan debug evidence,
  action-specific sample wording or repair templates;
- ordinary fallback chat copy and `guard_rewrite` are not production success
  paths (`guard_rewrite` remains readable for historical trace compatibility);
- Safety may bypass ordinary planning and records an explicit override reason.

Legacy Engage, Voice and ClinicalPlan helpers remain importable for compatibility
checks. Do not call them from production Surface Realization or orchestration.

Supported providers are selected with `AI_PROVIDER`:

- `openai` uses `OPENAI_API_KEY` and the OpenAI Responses API.
- `deepseek` uses `DEEPSEEK_API_KEY` and an OpenAI-compatible chat completions API.
- `qwen` uses `QWEN_API_KEY` and DashScope's OpenAI-compatible chat completions API.
- `zhipu` uses `ZHIPU_API_KEY` and an OpenAI-compatible chat completions API.
- `mock` or a missing provider key returns a local safe fallback for development.


### 2026-10-21: ordinary emotional confirmation and optional follow-up (local only)

The current ordinary contract permits natural, evidence-grounded emotional confirmation,
even when its meaning overlaps the User's words. It may stand alone or, when the
existing question policy permits, be followed by one open, relevant question about
the current experience. Neither asking nor progression is mandatory. No new Planner
goal, response action, classifier, validation stage or retry is introduced.

The existing repetition-purpose observation gains `emotional_acknowledgment`; the
same gate requires matching User-source evidence, a supported use comparison bound
to candidate spans, and an independently satisfied remaining-requirements verdict.
An enum label, generic consolation, summary, or question is not completion by itself.
No-supported-act, reexpression-only, uncertain/missing comparison, source mismatch,
unsupported facts/psychology and forbidden questions still fail. Current refusal,
Safety, scope, immutable plan and one-regeneration limits remain unchanged. Historical
selected-purpose replays retain their stricter goal-specific contract.

The user-preferred confirmation-plus-question is a regression reference only, never
a runtime example or fixed answer. Four saved rejected replies and raw provider
records remain unchanged. `ordinary-emotion-confirmation-check.ts` checks the actual
prompt and local human-labelled observations, including false rejection and false
acceptance boundaries. These tests establish code consumption and contract alignment,
not the model's semantic accuracy or a resolution of live reply quality. External
model calls remain paused.


### 2026-10-22: optional continuation preference and separate reference-effect review

The last approved first reply passed basic validity but did not reach the user's
reference effect. Its raw reply, raw judgment and prior PASS remain unchanged.
This slice changes only ordinary Surface realization: when the bounded history
shows voluntary elaboration, prefer concise grounded acknowledgment and a specific,
open, optional route for the User to unfold their experience rather than ending
with repeated abstract explanations. This is not consent to repeated questions.

The preference is emitted only for a sole ordinary natural action with no selected
purpose or answer obligation, non-idle status and optional-question permission.
Refusal, expression burden, tasks, selected goals and no-question/idle boundaries
exclude it. If no relevant low-burden opening is available, acknowledgment alone
remains valid. No Planner selection, semantic schema/gate, new goal, classifier or
retry changes. Other Surface branches retain their old guidance.

Independent evaluation reports basic validity and reference effect separately.
For this fixed voluntarily expanded account, the reference effect requires grounded
confirmation and an open, specific, low-pressure route for the User's further
expression; it does not require the reference wording, a question mark or a fixed
question. Generic re-invitation, peripheral investigation and guessed psychology
do not qualify. A basic PASS ending only in an abstract distinction can therefore
be reference-effect FAIL without becoming a global runtime error. Never infer the
reference effect from semantic PASS or automatically add calls after effect failure.
Local tests establish preference scope and reporting only, not actual reply quality.


### 2026-10-22: evidence-supported ordinary invitation selection and completion

This supersedes the Surface-only continuation preference above. Planner now uses
existing source-bound continuation evidence after an actual sharing invitation,
an already expressed personal concern, current-source content and available
initiative/question boundaries to select ordinary `invite_optional_sharing`.
Bare adjacency fallback, role references, compatibility continuity labels and old
free-text posture suggestions cannot authorize it. Refusal, expression burden,
Safety, tasks, existing question answers, idle and shared/paused initiative retain
priority. Preflight independently recomputes eligibility and rejects unsupported
selection or a downgrade that evades a supported selected function.

The selected function requires grounded confirmation followed by a specific,
open, low-pressure expression entry. The User need not respond; an invitation
statement can fulfill the entry without a question mark. Confirmation alone,
generic re-invitation, re-asking known content, self-analysis demands, pressure
and peripheral/leading requests cannot complete it. Other ordinary functions
still permit confirmation alone and no progression. `requiredContribution`
remains null; the old scope-of-acknowledgment task is not restored.

Surface, regeneration and the same semantic gate consume that selected contract.
Only this ordinary function adds `ordinaryInvitationObservation`, with separate
candidate evidence indices for confirmation and entry; code ANDs its assessment
with existing use, factual/psychological, Safety and question checks. A satisfied
overall model label cannot override missing/failed/uncertain completion evidence.
No new classifier, model stage, retry or session commit is introduced. Other
functions retain their schemas and rules. The previous soft preference is removed.

`ordinary-selected-invitation-check.ts` checks existing raw rejected samples,
complete-schema false acceptance, natural-ending compatibility, source and
boundary counterexamples, and actual rendered prompts. Local observations are
human-authored contract tests, not proof of model accuracy or live reply quality.
Original provider replies/judgments remain unchanged. External calls remain paused.


### 2026-10-23: contextual invitation usefulness and acknowledgement-only requests

Emotional-support `invite_optional_sharing` now reuses the existing source-bound
`ordinaryUseObservation` and comparison. Orchestration supplies the same bounded,
sanitized Surface history to this verdict. The model compares the previous
invitation and the User's added content; repeating generic permission without a
contextual use is not completion merely because it is gentle and within scope.
Code ANDs the comparison with the existing overall, scope, affect and question
checks. Legacy judgments without it remain parseable but unproven; rejecting an
old format is not evidence of semantic repair. Useful confirmation can stand
alone, and a specific entry is not required for all support functions. The
selected ordinary invitation's separate completion requirements are unchanged.

Ordinary `respond_naturally` may fulfill an explicit acknowledgement-only User
request with a brief acknowledgement. The existing `other_response` comparison
must bind this act to the actual User request and candidate evidence. Brevity or
a resolved event alone does not authorize it; an ungrounded `receipt_only` still
fails when `allowIdle=false`. No Planner idle flag, closure authority, new goal,
classifier, model stage or retry is introduced. Selected obligations, refusal,
expression burden, factual grounding and Safety remain independent. Surface and
judge wording recognize the same limited exception.

`contextual-response-completion-check.ts` preserves the two original provider
reply/judgment payloads and boundary controls with hashes, and checks full-schema
negative/positive human-labelled observations, exact User-source evidence,
question/contradiction boundaries and rendered requests with network blocked.
These tests prove parsing and code consumption, not model observation accuracy
or successful real generation. Original provider records are never rewritten;
external validation remains paused.


### 2026-10-23: invitation's own contextual use is independently consumed

The two-call follow-up still labelled the saved friend reply as useful by combining
its accurate confirmation with an optional invitation. Its original provider
payload is preserved unchanged in `invitation-use-regression-fixture.json`.
The old runtime rejection after quote location was an inconsistent relation/purpose
pair, not successful recognition of repeated generic permission.

Only emotional-support `invite_optional_sharing` now reports an additional
`invitationUseObservation` in the same verdict. It separately classifies the
invitation as useful in context, repeated prior permission without use, another
unsupported use, not applicable, or uncertain. Candidate evidence indices identify
the invitation itself; a relevant prior Assistant invitation is quoted with an
exact bounded-history message index and UTF-16 span. Assistant history is validated
as Assistant evidence here, not repurposed as User purpose evidence.

Code ANDs the invitation-use assessment with whole-reply use, scope, affect,
factual and question requirements. Overall satisfied or useful confirmation cannot
override failed/uncertain invitation use. With no invitation, not_applicable, empty
candidate indices and null prior invitation retain standalone confirmation. A
first related invitation need not offer a specific entry; repetition is not always
wrong when actual context supports its use. No Planner selection, generation
logic, universal entry requirement, idle permission, classifier, extra model call
or retry is introduced. Existing ordinary invitation completion remains separate.

Local `invitation-use-check.ts` replays the real false acceptance and tests a
separate human-labelled copy with exact source locations and consistent old fields.
The full-schema negative fails on invitation use alone while whole-reply use passes;
first invitation, standalone confirmation, acknowledgement-only, refusal and burden
controls retain their expected results. Missing new fields count only as unproven.
Transport fixture helpers supply artificial observations, not model-quality evidence.

Model observation accuracy remains unverified. Code validates reported observations
and their quoted sources; it cannot prove from indices alone that an invitation is
useful, or that null priorInvitation correctly means no relevant prior invitation.
Future real verification must independently inspect those semantic claims as well
as the entire reply, not treat schema or gate PASS as proof of repair.


### 2026-10-23: release test contract alignment

The saved three-turn ordinary regression follows the evidence-supported invitation
selection above, rather than requiring `respond_naturally` for every accompany
proposal. It checks source-bound continuation, current initiative, no restored
legacy contribution, missing-invitation/refusal/burden/adjacency-only exclusions,
and preflight rejection of an unsupported downgrade. This does not establish live
reply quality or waive the recorded repetition/invitation quality limitation.

The proactive structured-commit test obtains real process-local Guest credentials
through the existing session route and sends conversation/turn IDs. Independent
scenarios use independent owners without changing production quotas. Missing and
cross-owner credentials, missing turn IDs and replay without generation remain
checked alongside the original generation, rejection and transaction assertions.
The provider is a loopback stub only; no external model or deployment is involved.


### 2026-10-23: remaining release test alignment

Release checks distinguish deterministic prechecks from mandatory semantic
validation for source-bound ordinary plans. Original candidate text, labels,
thresholds and frozen preservation datasets remain unchanged. Legacy word-guard
negatives run against an explicitly unbound legacy plan; current bound-plan
prechecks are recorded separately, with the existing acknowledgement enforcement
suite required as a companion. A fixed complete-schema semantic rejection checks
that a deterministic pass cannot bypass semantic enforcement. A malformed-evidence
control is separate and cannot count as that semantic proof. These authored local
observations test transport and enforcement, not actual model response quality.

Historical prompt comparisons normalize only named, uniquely matched approved
contract migrations in comparison copies, retaining the original frozen bytes and
whole-message comparisons for unrelated content. Test fixtures use source-bound
contracts, bounded history (including explicit empty history) and the current
verdict wire format. Typing fixes preserve malformed-input and cross-branch
controls rather than weakening runtime types.

Proactive greeting checks follow the existing guest-session helper's single retry
for an explicit pre-model authentication failure; unknown/network failures remain
non-replayable. Local API smoke supplies required note idempotency IDs and checks
missing IDs, same-payload replay and conflicting-payload rejection alongside owner
and upload boundaries. All database checks use a dedicated isolated test database;
providers are in-memory fixtures or loopback stubs. No runtime, interface, judge
rule, original snapshot or dataset label is changed by this test alignment.


Observation smoke obtains the existing server-issued consent through POST
`/api/insights`, verifies missing consent and cross-user token reuse are rejected,
and supplies valid consent before testing range validation. The original word,
draft, role, future-date and owner isolation assertions remain intact.

The full API smoke still requires an actual committed Assistant response. With
`AI_PROVIDER=mock` and no configured semantic safety provider, the current route
correctly returns `SAFETY_BLOCKED`; that is an environment prerequisite failure,
not a successful chat smoke. Non-chat smoke may be run separately with the
existing notes-only switch, but must not be reported as full API acceptance.
This test alignment does not bypass safety or replace successful chat acceptance
with an expected failure. The dedicated local provider fixture below now covers this offline success path;
the unconfigured-provider failure above remains valid and must not be bypassed.


### 2026-10-23: offline full API provider fixture

Run `node --import tsx scripts/local-api-smoke-provider-fixture.ts` with an explicit
local dedicated test `DATABASE_URL`, a built app, a test session secret and
`ALLOW_WEB_MOCK_LOGIN` permitted in the local development configuration. The
runner supplies synthetic credentials and a process-local Qwen-compatible HTTP
stub on an OS-assigned 127.0.0.1 port. Its child environment is allowlisted and its
temporary transport guard rejects non-loopback connections. No real provider key,
external network service or runtime change is needed.

This executes the original full API smoke and adds a fixed nonretryable safety
provider error. Success requires HTTP 201, status committed, exact current-turn
Assistant/owner/session/generation links, one validated attempt with no hard or
advisory failure and COMMITTED trace. Safety error requires status failed,
SAFETY_BLOCKED, no new Assistant message, a persisted SYSTEM status and the existing
empty-output FAILED safety audit. The stage ledger checks one safe triage, one
failed triage, one surface generation and one semantic verdict, with no surface or
semantic request during the safety-failure interval. Fixed greeting, extraction
and episode-summary responses cover the actual supporting calls. Unknown models,
inputs or request types fail the runner even when runtime error handling catches
them; no format repair or regeneration is accepted as a fixture pass.

All verdicts and replies are authored fixtures that establish transport, current
contracts and persistence behavior. They do not validate genuine model safety
accuracy, semantic judgment or conversational quality, and do not replace real
model, device or deployment acceptance.
