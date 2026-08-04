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
