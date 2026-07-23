# AI services

All AI calls must be routed through this directory.

Route handlers must not call model providers directly. They should call service
functions that use:

- `aiService.ts` for primary AI generation
- `promptBuilder.ts` for the minimal product prompt, history sanitization, and versioning
- `modelProvider.ts` for provider-specific API calls
- `debugTrace.ts` for engineering trace output

The production chat route is controlled by Conversation OS:

- `chatOrchestrationService.ts` performs Context Assembly, structured Turn
  Interpretation, Dialogue State, one ResponsePlan, Surface Realization,
  same-plan Output Validation, and State Update;
- `aiService.ts` is only the Surface Realization adapter and requires the
  finalized ResponsePlan;
- `turnInterpretationAdapter.ts` may call the model only for ambiguous
  pragmatics and may not write a reply or plan;
- Memory, Assistant Grounding and Clinical Logic are bounded providers;
- Clinical Logic is invoked only when Response Planner requests an emotional
  or action-support strategy;
- Output Validation may accept, reject, or request one regeneration against the
  exact same plan; a second failure returns `constraint_failure` system status;
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
