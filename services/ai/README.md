# AI services

All AI calls must be routed through this directory.

Route handlers must not call model providers directly. They should call service
functions that use:

- `aiService.ts` for primary AI generation
- `aiJudgeService.ts` for structured reply review
- `rewriteService.ts` for one-pass rewrites
- `promptBuilder.ts` for prompt construction and versioning
- `modelProvider.ts` for provider-specific API calls

Supported providers are selected with `AI_PROVIDER`:

- `openai` uses `OPENAI_API_KEY` and the OpenAI Responses API.
- `deepseek` uses `DEEPSEEK_API_KEY` and an OpenAI-compatible chat completions API.
- `zhipu` uses `ZHIPU_API_KEY` and an OpenAI-compatible chat completions API.
- `mock` or a missing provider key returns a local safe fallback for development.
