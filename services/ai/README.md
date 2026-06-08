# AI services

All AI calls must be routed through this directory.

Route handlers must not call model providers directly. They should call service
functions that use:

- `aiService.ts` for primary AI generation
- `aiJudgeService.ts` for structured reply review
- `rewriteService.ts` for one-pass rewrites
- `promptBuilder.ts` for prompt construction and versioning
- `modelProvider.ts` for provider-specific API calls

This placeholder is part of the backend foundation module. The actual AI
implementation will be added in a later module.
