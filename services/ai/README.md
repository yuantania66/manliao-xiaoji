# AI services

All AI calls must be routed through this directory.

Route handlers must not call model providers directly. They should call service
functions that use:

- `aiService.ts` for primary AI generation
- `promptBuilder.ts` for the minimal product prompt, history sanitization, and versioning
- `modelProvider.ts` for provider-specific API calls
- `debugTrace.ts` for engineering trace output

The chat route is intentionally in base-model mode:

- product baseline prompt + recent sanitized history + current user input
- no local conversation-understanding layer
- no slow-chat state machine
- no response-policy planner
- no RAG guidance injection
- no low-information deterministic shortcut
- no judge/rewrite loop

The old understanding/planning/review modules were removed from this directory.
Do not reintroduce them into the chat request path without first changing the
base-chat regression checks.

Supported providers are selected with `AI_PROVIDER`:

- `openai` uses `OPENAI_API_KEY` and the OpenAI Responses API.
- `deepseek` uses `DEEPSEEK_API_KEY` and an OpenAI-compatible chat completions API.
- `zhipu` uses `ZHIPU_API_KEY` and an OpenAI-compatible chat completions API.
- `mock` or a missing provider key returns a local safe fallback for development.
