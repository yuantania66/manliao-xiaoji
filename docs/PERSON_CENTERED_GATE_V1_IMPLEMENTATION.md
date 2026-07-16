# Person-Centered Intervention Gate V1

Status: implemented behind a default-off feature flag.

This document describes the runtime contract implemented by this change. It does not claim that free-text reply quality has improved. That question requires a separate flag-on human review after this change is reviewed.

## Runtime owner and order

`services/ai/chatOrchestrationService.ts:createChatReply()` is the only production owner of the Gate evaluator. The ordinary chat path is:

```text
Safety
-> ClinicalContext
-> Person-Centered Gate (once)
-> gated Professional RAG projection
-> ResponseGoal
-> Strategy
-> ClinicalPlan
-> Prompt
-> LLM
-> existing semantic-evidence contract
```

Safety remains a short circuit. A Safety hit does not construct `ClinicalContext`, evaluate this Gate, create an ordinary `ClinicalPlan`, project Professional RAG, build the ordinary Prompt, or invoke the ordinary model path.

Logged-in and Guest entry points continue to call the same `createChatReply()` owner. The Gate derives evidence only from the current user input and visible history. Retrieved Professional RAG candidates cannot change consent, readiness, goal policy, or the Plan Gate snapshot.

## Feature flag

The only supported flag is:

```text
PERSON_CENTERED_GATE_V1_ENABLED=false
```

Only the exact string `true` enables V1. Unset, `false`, `TRUE`, `1`, and whitespace-padded values remain disabled. `createChatReply()` reads the flag once per request.

When disabled:

- `ClinicalContext.personCenteredEvidence` is absent;
- `ClinicalPlan.personCenteredGate` is absent;
- Gate trace fields are absent;
- raw Structured RAG follows the legacy prompt path;
- Prompt message count, order, and content remain on the legacy path.

## Gate contract

The Gate receives `PersonCenteredGateEvidence` and returns one `PersonCenteredGateDecision`. Downstream selectors and projections consume this decision mechanically and do not recalculate consent or readiness.

Priority:

1. unresolved correction, refusal, hesitation, or pause revokes intervention eligibility;
2. an explicit, narrow, low-risk action request permits only `low_risk_action_support` at low intensity;
3. aligned understanding plus exact scoped consent permits only that scope;
4. an explicit judgment, interpretation, or high-impact request without aligned facts permits clarification but no intervention family;
5. no or ambiguous scoped consent defaults to no intervention family.

The legacy ResponseGoal selector remains intact. With a Gate decision, the selected goal follows the decision's preferred/allowed/fallback policy. The Gate does not generate reply text.

V1 does not infer structured intervention alignment from the wording of a previous assistant reply. A prose sentence that resembles an offer, a capability statement, or a quoted example cannot create readiness. The evaluator retains the `aligned` decision branch for already-structured evidence, but the current chat evidence derivation remains fail-closed for interpretive, judgment, and other non-low-risk requests.

## Professional RAG boundary

Retrieval may still occur before `createChatReply()`, but retrieval means relevance, not authorization. In the flag-on path, `projectPromptEligibleContext()` is the only route from raw `StructuredRagContext` to the Prompt.

- intervention guidance requires an allowed family and sufficient allowed intensity;
- baseline-boundary guidance contributes only negative `avoid` constraints;
- safety guidance is withheld from the ordinary Prompt;
- missing or invalid Gate metadata fails closed;
- `activeHypotheses` requires `case_formulation`;
- `counterEvidence` requires `cbt` or `case_formulation`;
- any `kind=hypothesis` item in other Structured RAG arrays also requires `case_formulation`;
- projection does not mutate raw retrieval results.

The flag-on Prompt input is branded as `GatedStructuredRagContext`. The projection deep-freezes the prompt-eligible context and binds it to both the exact Gate decision object and an immutable authorization snapshot. The Prompt Builder rejects raw Structured RAG in Gate mode and verifies the Plan snapshot against that decision's readiness, intensity, families, and ResponseGoal allowlist. Copying or mutating a branded object, mutating the authorizing decision after projection, or reusing a permissive projection with another decision fails closed.

## Prompt carrier

The Gate boundary is the final developer message before sanitized history and the current user message. It is emitted independently of `CLINICAL_PLAN_PROMPT_ENABLED` and contains only:

- readiness;
- maximum intervention intensity;
- allowed intervention families;
- allowed ResponseGoals;
- the selected ResponseGoal.

It does not contain the interaction stage, reason codes, blocked families, withheld IDs, or a fixed user-visible reply.

## Frozen trace expectations

| Case | Stage | Consent | Readiness | Allowed families | Goal |
| --- | --- | --- | --- | --- | --- |
| 015 | repair_or_pause | revoked | blocked | none | hold_space |
| 022 | expression | none | blocked | none | clarify |
| 027 | expression | none | blocked | none | reflect |
| 029 | expression | ambiguous | blocked | none | reflect |
| 033 | expression | none | blocked | none | reflect |
| 034 | expression | ambiguous | blocked | none | reflect |
| 042 | expression | ambiguous | blocked | none | reflect |
| 053 | expression | none | blocked | none | reflect |
| 057 | exploration | ambiguous | blocked | none | reflect |
| 077 | intervention_requested | explicit_scoped | limited | none | clarify |
| 082 | intervention_requested | explicit_scoped | limited | low_risk_action_support | support_action |
| 083 | intervention_requested | explicit_scoped | limited | low_risk_action_support | support_action |

For 042, 057, and 083, relevant case-formulation or CBT cards may be retrieved, but remain withheld unless their exact family and intensity are allowed. In particular, 083's low-risk action authorization does not authorize case formulation.

## Limits

The deterministic suite freezes 12 requested traces, the 32 design counterexamples (including the Safety short circuit), and 191 additional adversarial probes covering boundary/correction/hesitation priority, intervention refusal, quoted/reported content, temporal overrides, high-impact and high-uncertainty precedence, natural low-risk requests, prose-offer rejection, and scoped consent. Decision/judgment requests remain fail-closed to clarification in V1 because visible offer acceptance does not prove that relevant facts are sufficient. A separate declared action or a named procedure followed by a request for a first/next/small action is treated as high-impact/unknown rather than taking the low-risk fast path.

V1 establishes an internal eligibility boundary and closes the Professional RAG bypass. It does not add a deterministic rewrite, fixed response template, new Safety behavior, Memory persistence, or a new clinical technique. The flag remains off by default. Human review of actual flag-on replies is required before any enablement decision.
