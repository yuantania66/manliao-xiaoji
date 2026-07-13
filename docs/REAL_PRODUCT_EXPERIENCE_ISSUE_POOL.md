# Real-product Experience Issue Pool

## Pool Status

- Status: collecting and diagnosing
- Confirmed cases: 6
- Product changes authorized: none
- Golden Dataset changes authorized: none
- Next collection target: additional Decision Owner screenshots or official-entrypoint reproductions

## REP-001 — Unsupported emotion invented for a free number

- status: `diagnosed`
- provenance: `screenshot_confirmed`
- capturedAt: `2026-07-12`
- captureEnvironment: `local_development`
- context: no numeric meaning was established in the captured trajectory
- user: `1`
- assistant: `1。像是还在刚才那个松口气的瞬间里。`
- whyItFeelsWrong: The assistant behaves as if the user supplied a relief experience that does not appear in the user input.
- observedHarm: unsupported meaning; trust damage
- layerReview:
  - Conversation: no prior user-confirmed relief meaning is present in the canonical trajectory evidence.
  - ClinicalContext: low-information ambiguity is already detected.
  - ResponseGoal: `clarify` is compatible with leaving meaning unknown.
  - Strategy: `rogers` does not require inventing an emotion.
  - Prompt: the generated surface violates the groundedness boundary despite a compatible structure.
  - Memory: no long-term memory evidence is needed to reproduce the failure class.
  - Safety: not involved.
- primaryRootCause: `Prompt`
- confidence: `high`
- reviewerNotes: This classification diagnoses model-facing rendering/compliance, not a specific Prompt sentence and not a fix.

## REP-002 — Assistant invention promoted into shared history

- status: `diagnosed`
- provenance: `screenshot_confirmed`
- capturedAt: `2026-07-12`
- captureEnvironment: `local_development`
- context:
  - user previously sent `1`
  - assistant invented `松口气`
  - user then sent `2` without confirming that interpretation
- user: `2`
- assistant: `好，那就先在这个松口气的感觉里待一会儿。`
- whyItFeelsWrong: The assistant treats its own earlier guess as mutually established fact and deepens it.
- observedHarm: cross-turn contamination; unsupported meaning; trust damage
- layerReview:
  - Conversation: assistant-originated text is available to the next turn as if it were shared context.
  - ClinicalContext: numeric ambiguity remains detectable.
  - ResponseGoal: `clarify` does not authorize preserving an unconfirmed emotion.
  - Strategy: the strategy does not require adopting the invented claim.
  - Prompt: the surface repeats the claim, but the defining failure is its promotion across turns.
  - Memory: this is recent conversation history, not long-term memory retrieval.
  - Safety: not involved.
- primaryRootCause: `Conversation`
- confidence: `high`
- reviewerNotes: The first invention is REP-001; this case isolates the later carry-over mechanism.

## REP-003 — Partial withdrawal still assigns conversational purpose

- status: `diagnosed`
- provenance: `screenshot_confirmed`
- capturedAt: `2026-07-12`
- captureEnvironment: `local_development`
- context: consecutive free numeric input after two unsupported assistant interpretations
- user: `3`
- assistant: `3在这里，我不急着定义它。想顺着这个数字说点什么可以，先不说也没关系。`
- whyItFeelsWrong: The assistant says it will not define the number, then immediately treats the number as a possible path for expression.
- observedHarm: unsupported conversational purpose; pseudo-restraint
- layerReview:
  - Conversation: prior contamination exists, but this reply explicitly withdraws certainty rather than repeating the earlier emotion.
  - ClinicalContext: ambiguity is already represented.
  - ResponseGoal: `clarify` is compatible with leaving the token unknown.
  - Strategy: no strategy requirement makes the number an expression path.
  - Prompt: the rendered reply converts an abstract invitation requirement into unsupported purpose.
  - Memory: not involved.
  - Safety: not involved.
- primaryRootCause: `Prompt`
- confidence: `medium`
- reviewerNotes: The case is distinct from REP-002 because the old emotion is not carried verbatim; the failure is the new purpose frame.

## REP-004 — Recorder-style reflection with no added understanding

- status: `diagnosed`
- provenance: `screenshot_confirmed`
- capturedAt: `2026-07-12`
- captureEnvironment: `local_development`
- context: single emotional statement
- user: `我今天有点不太高兴`
- assistant: `听到你说今天有点不太高兴，就先让这句话在这里。`
- whyItFeelsWrong: The reply repeats the user's words and parks them instead of showing understanding or helping the conversation move.
- observedHarm: mechanical repetition; conversational closure; recorder tone
- layerReview:
  - Conversation: sufficient current-turn content is present.
  - ClinicalContext: the emotional statement is available to the response pipeline.
  - ResponseGoal: `reflect` is structurally compatible with the input.
  - Strategy: `rogers` is compatible with meaningful reflection.
  - Prompt: the surface collapses reflection into a recorder-like template.
  - Memory: not required for this turn.
  - Safety: not involved.
- primaryRootCause: `Prompt`
- confidence: `high`
- reviewerNotes: This case diagnoses the single reply. A cross-turn template-rut claim requires additional independently confirmed replies.

## REP-005 — Responsibility-taking without explicit repair

- status: `primary_root_cause_pending`
- provenance: `screenshot_confirmed`
- capturedAt: `2026-07-12`
- captureEnvironment: `local_development`
- context: user directly challenges the assistant's understanding
- user: `你一点都不懂我`
- assistant: `是我没跟上，让你觉得没被懂。`
- whyItFeelsWrong: The assistant accepts blame but reframes a direct criticism as the user's feeling and does not state what it misunderstood, what it now understands, or what remains unknown.
- observedHarm: shallow repair; possible reframing of user criticism
- layerReview:
  - Conversation: the screenshot alone does not preserve enough earlier context to judge what understanding should be repaired.
  - ClinicalContext: the correction signal may be available, but the screenshot is not a runtime trace.
  - ResponseGoal: repair-compatible routing has been observed in related deterministic checks, but not proven for this exact captured turn.
  - Strategy: repair behavior may be underspecified.
  - Prompt: rendering may be too shallow even under a compatible repair route.
  - Memory: insufficient evidence.
  - Safety: not involved.
- primaryRootCause: `pending`
- confidence: `insufficient_evidence`
- reviewerNotes: Requires official-entrypoint reproduction with the minimum preceding context before choosing between Conversation, Strategy, and Prompt.

## REP-006 — Grounded acknowledgement that closes the conversation

- status: `diagnosed`
- provenance: `screenshot_confirmed`
- capturedAt: `2026-07-12`
- captureEnvironment: `local_development`
- context: no meaning established for the numeric token
- user: `1`
- assistant: `看到你发了1，先停在这里。`
- whyItFeelsWrong: The reply avoids inventing meaning but mechanically echoes the token and decides to stop without evidence that the user wants a pause.
- observedHarm: mechanical acknowledgement; unrequested closure; no conversation movement
- layerReview:
  - Conversation: the available context does not establish a pause request.
  - ClinicalContext: ambiguity is correctly detectable.
  - ResponseGoal: `clarify` is compatible with remaining open.
  - Strategy: the existing strategy does not require stopping.
  - Prompt: the generated surface satisfies restraint by parking the token and loses the movement half of the product contract.
  - Memory: not involved.
  - Safety: not involved.
- primaryRootCause: `Prompt`
- confidence: `high`
- reviewerNotes: This is the clearest evidence that `unsupportedMeaning=false` alone is not product success.

## Current Distribution

| Primary root cause | Confirmed diagnosis count | Pending count |
| --- | ---: | ---: |
| Prompt | 4 | 0 |
| Conversation | 1 | 0 |
| Pending | 0 | 1 |

This distribution is descriptive only. Six cases are too few to authorize a product change or declare Prompt the global product root cause.

## Next Collection Action

Collect the next Decision Owner screenshot or reproduce a reported probe through the official entrypoint. Add it as a new case without proposing a solution.
