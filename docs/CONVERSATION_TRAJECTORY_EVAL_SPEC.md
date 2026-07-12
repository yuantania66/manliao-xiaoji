# Conversation Trajectory Eval Specification v1

## 1. Purpose

Conversation Trajectory Eval v1 evaluates failures whose meaning depends on several turns. It complements, and does not replace, `clinical-evals/golden-dataset-v1.json` or the existing Experience Review workflow.

The first consumers are EXP-BL-012A, EXP-BL-012B, and EXP-BL-012C:

- unsupported meaning carried across low-information turns;
- emotional-response template rut;
- meta-repair after the user audits the assistant's understanding.

This document specifies data and runner behavior only. It does not create the dataset, implement a runner, modify product prompts, or authorize a product fix.

## 2. Proposed Canonical Data File

```text
clinical-evals/conversation-trajectories-v1.json
```

The file must contain complete ordered trajectories. A turn that depends on earlier context must not be copied into the single-turn Golden Dataset as an independent case.

## 3. Proposed Schema

```json
{
  "schemaVersion": 1,
  "datasetVersion": "conversation-trajectories-v1",
  "trajectories": [
    {
      "id": "TRJ-GROUND-001",
      "category": "groundedness",
      "source": {
        "kind": "local_product_self_test",
        "capturedAt": "2026-07-12",
        "evidence": ["screenshot"]
      },
      "purpose": "Prevent unsupported meaning from being assigned and carried across numeric turns.",
      "initialMessages": [],
      "turns": [
        {
          "turnId": "t1",
          "user": "1",
          "observedAssistant": "1。像是还在刚才那个松口气的瞬间里。",
          "expectedStructure": {
            "responseGoal": "clarify",
            "responseIntent": "clarify",
            "questionFunction": "clarify_meaning"
          },
          "allowedFacts": ["The user sent the token 1."],
          "forbiddenClaims": ["The user felt relief.", "The token is a score or trend."],
          "machineChecks": ["structure_matches", "no_numeric_scale_inference_terms"],
          "reviewerFields": ["unsupportedMeaning", "groundedUnderstanding", "reviewerNotes"]
        }
      ],
      "trajectoryMachineChecks": ["no_unconfirmed_assistant_claim_carryover"],
      "trajectoryReviewerFields": ["crossTurnContamination", "overallTrustImpact", "reviewerNotes"]
    }
  ]
}
```

This is an illustrative schema. Exact field names must be validated against runner ergonomics before the canonical JSON file is created.

## 4. Required Top-level Metadata

- `schemaVersion`
- `datasetVersion`
- `trajectories`

Every trajectory requires:

- stable `id`;
- `category`;
- evidence `source`;
- human-readable `purpose`;
- ordered `initialMessages` and `turns`;
- trajectory-level machine checks;
- trajectory-level reviewer fields.

Every generated report requires:

- dataset version;
- runner version;
- source code commit;
- Prompt version;
- provider and model;
- generation settings relevant to reproducibility;
- generation timestamp;
- run mode (`real`, `mock`, or deterministic replay);
- freshness status.

## 5. Turn Execution

For real-model evaluation, the runner must use the official reply entrypoint for every assistant turn and carry the resulting user and assistant messages into the next turn.

```text
createChatReply()
  -> Safety
  -> ClinicalContext
  -> ResponseGoal
  -> Strategy
  -> ClinicalPlan
  -> Prompt
  -> model reply
  -> append to trajectory history
  -> next user turn
```

The runner must not replace product replies with handcrafted templates. Deterministic replay mode may use captured replies only to validate report structure and machine-check logic; replay is not evidence of current model quality.

## 6. Check Taxonomy

### 6.1 Deterministic machine checks

Allowed merge-gating checks include:

- selected `ResponseGoal`, Strategy, response intent, and question function match the expected structure when specified;
- Safety routing and reply source are visible;
- exact forbidden phrases or bounded regex patterns are absent;
- a bounded sentence-opening pattern does not repeat above a declared count;
- explicit unsupported numeric scale/trend terms are absent when no scale was established;
- an assistant reply does not directly copy a declared prior user span above a bounded similarity rule;
- run metadata and freshness metadata are complete.

Machine checks may establish that a known literal regression occurred. They must not claim that a reply is empathetic, insightful, grounded, natural, or better overall.

### 6.2 Heuristic machine signals

Heuristics may flag candidates for review but cannot independently fail a merge:

- normalized sentence-skeleton similarity;
- repeated opening or closing structures after slot substitution;
- lexical overlap with a prior user message;
- new emotion/event/entity terms not found in allowed facts;
- suspected carry-over of an earlier assistant-only claim.

Every heuristic result must expose the matched text and rule. It must not be rendered as a semantic fact.

### 6.3 Human reviewer fields

Required reviewer fields include:

- `unsupportedMeaning`: did the assistant introduce an emotion, event, cause, relationship, or state not supported by the user?
- `groundedUnderstanding`: did the reply add useful understanding while remaining within supplied evidence?
- `templateRut`: did replies across the trajectory feel like the same sentence with slots replaced?
- `metaRepairQuality`: after a challenge, did the assistant make its current understanding, uncertainty, and withdrawn assumptions visible?
- `crossTurnContamination`: did an unsupported assistant claim become assumed context later?
- `conversationMovement`: did the reply support continued conversation without forcing disclosure or closing prematurely?
- `reviewerNotes`

An LLM judge may prefill suggestions with model and Prompt version recorded. A human reviewer must confirm any semantic field used for an acceptance decision.

## 7. Known Literal Regression Patterns

Initial patterns may include bounded variants of:

- `听到你说 ...`
- `让这句话在这里`
- `我接住了`
- `是你刚刚说 ... 这件事`
- numeric trend or scale inference without an established scale

These patterns are regression locators, not a complete definition of quality. A reply does not pass merely by replacing them with synonyms.

## 8. Experiment Support

The runner must support named variants without changing canonical product defaults:

- Prompt text/version override scoped to the eval process;
- history construction/filtering variant;
- feature-flag variant already supported by the official chain;
- repeated real-model runs per variant;
- side-by-side structural trace and reply comparison.

Variant sets are child-specific:

- 012A variants test low-information groundedness and history contamination;
- 012B variants test removal of concrete recorder-style examples and addition of a semantic-value contract;
- 012C variants test repair rendering and, only after separate approval, a possible ClinicalPlan contract change.

The runner must not mix product changes for multiple child issues into a single treatment branch.

## 9. Proposed Output

```text
docs/evals/conversation-trajectory-review-latest.md
```

The report must show:

- exact ordered inputs and model replies;
- structural trace per turn;
- machine-check evidence;
- heuristic flags with matched text;
- blank or explicitly unreviewed human fields;
- variant comparison;
- run and freshness metadata.

Mock output must be clearly marked and is not valid evidence of real model experience.

## 10. Freshness and Stale Governance

Real-model evaluation must remain outside `check:launch` because it is non-deterministic, credentialed, slow, and potentially costly.

Deterministic CI may validate freshness metadata without calling a model.

The generated report must record:

```text
evaluatedCommit: <sha>
relevantSourceFingerprint: <deterministic fingerprint>
freshness: current | stale
staleReason: <required when stale>
```

Relevant sources initially include:

- `services/clinical/**/*.ts`
- `services/ai/promptBuilder.ts`
- official chat orchestration/history construction used by the runner;
- the trajectory dataset;
- the trajectory runner.

When a relevant fingerprint differs, the report must either be regenerated and reviewed or explicitly marked stale. A stale report must not present itself as current evidence. CI may enforce metadata consistency and the presence of a stale reason; it must not force real-model execution.

The existing `docs/evals/experience-review-latest.md` requires its own follow-up stale-governance decision. This specification does not silently redefine or rewrite that workflow.

## 11. Relationship to Existing Evaluation Assets

- `golden-dataset-v1.json`: retain single-turn cases and structural expectations.
- Experience Review: retain baseline/treatment human review for individual cases.
- existing direct probes: inventory and reuse before creating duplicate checks.
- trajectory eval: own ordered multi-turn state, cross-turn contamination, template rut, and meta-repair.

No existing dataset or runner is modified by this specification task.

## 12. Runner Acceptance Criteria

- Uses the official reply entrypoint for real runs.
- Preserves exact ordered history across turns.
- Separates deterministic checks, heuristics, and human review fields in code and report output.
- Supports deterministic replay for runner tests without treating replay as product-quality evidence.
- Records all reproducibility and freshness metadata.
- Supports child-specific named experiment variants.
- Does not enter `check:launch` with real-model calls.
- Includes deterministic unit checks for schema validation, report generation, check evidence, and stale metadata.

## 13. Implementation Boundary

The next task may implement only:

- the canonical trajectory schema after review;
- a runner and deterministic runner checks;
- initial captured/reproduced trajectory fixtures;
- report and freshness metadata generation.

It must not modify product Prompt, Selector, Strategy, ClinicalPlan, Safety, Memory, model provider configuration, or the single-turn Golden Dataset.

## Next Unique Action

Review this schema and runner contract. If approved, open one independent eval-infrastructure issue to implement the harness before any EXP-BL-012 child product fix.
