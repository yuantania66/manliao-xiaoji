# Experience Orchestration Baseline (post TA-009)

Comparison freeze after TA-009: guard no longer authors chat copy.

## Run Meta

- outputPath: `docs/evals/experience-orchestration-baseline-post-ta009.json`
- comparedAgainst: `docs/evals/experience-orchestration-baseline-latest.json`
- entrypoint: `createChatReply` / single-turn empty history
- clinicalPlanPromptEnabled: `unset(false)`
- model: `qwen:qwen3.7-max`
- chatPromptVersion: `chat-base-product-v11`

## Summary

- totalCases: 100
- completedOk: 100
- completedError: 0
- emptyReplies: 0
- finalReplySource: `{"llm":100}`
- guardHitCount / regenerate / constraint_failure: 0
- semanticEvidenceStatus: `{"insufficient":22,"sufficient":78}` (unchanged vs pre)
- responseGoal distribution: unchanged vs pre

## Comparison Notes

- This 100-case set still does not exercise the regenerate path (same limitation as the frozen baseline).
- Reply text differences vs pre-freeze are expected LLM non-determinism; structural sources and plan signals are the regression gates for TA-009 on this set.
- Directed regenerate / `constraint_failure` coverage lives in `npm run check:semantic-evidence`.

Per-case detail: `docs/evals/experience-orchestration-baseline-post-ta009.json`.
