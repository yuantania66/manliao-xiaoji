# EXP-BL-012A / Issue #19 Eval Review

## 1. Decision

```text
needs revised eval; no variant is authorized for a product PR
```

Issue #19 successfully compared A0/A1/A2/A3 through the official `createChatReply()` entrypoint, but no treatment satisfies the double product contract:

```text
unsupportedMeaning = false
conversationMovement = true
```

The product default remains unchanged.

## 2. Product Standard

Decision Owner principle:

> 看用户期待的是什么，慢慢帮用户挖掘出来需求。

Behavioral acceptance standard:

> 不猜、不封口、不逼解释，同时让用户仍然愿意继续。

## 3. Run Provenance

- Date: 2026-07-12
- Environment: `local_development`
- Provider: `qwen`
- Model: `qwen3.7-max`
- Official entrypoint: `createChatReply()`
- Repeats: 3 per variant
- Completed turns: 24 per variant, 96 total
- Source fingerprint: `sha256:9b9a0799a57be38342b6e49b4ff31ccabfe4291eff60254728b4e8a002d1d549`
- A0: canonical Prompt + canonical history
- A1: eval-only positive unknown-token Prompt contract
- A2: A1 + eval-only cross-turn unconfirmed-claim contract
- A3: canonical Prompt + eval-only removal of assistant semantic guesses while preserving procedural frames

Raw real-model reports are local evidence and are intentionally excluded from Git:

- `docs/evals/conversation-trajectory-exp-bl-012a-a0.local.md`
- `docs/evals/conversation-trajectory-exp-bl-012a-a1.local.md`
- `docs/evals/conversation-trajectory-exp-bl-012a-a2.local.md`
- `docs/evals/conversation-trajectory-exp-bl-012a-a3.local.md`

## 4. Scenario Coverage

Every variant ran:

1. one free unestablished number;
2. a consecutive free `1 → 2 → 3` trajectory;
3. an explicit `1–10` scale;
4. an explicit numbered choice;
5. an explicit count;
6. a numeric turn after an earlier assistant-only unsupported interpretation.

The sixth scenario is an additional protection beyond the four minimum numeric-context classes.

## 5. Human Review by Variant

### A0 — canonical

- Groundedness: improved from the original screenshot's high-severity `松口气` invention, but not stable. Replies still assigned unsupported frames such as `你想怎么用它` and `接着数`.
- Conversation movement: failed. Frequent outputs were mechanical acknowledgement or closure, including variants of `看到这个 1`, `2 也在这里`, and `嗯，三次`.
- Established meaning: passed for scale, numbered choice, and explicit count.
- Template behavior: failed. Cross-run locators found repeated observation and acknowledgement openings.
- Result: baseline failure; not a product candidate.

### A1 — positive unknown-token contract

- Groundedness: failed. Unsupported purpose language such as `你想怎么用它` remained, and assistant-history cases introduced `这个节奏` or counting language.
- Conversation movement: failed. Mechanical acknowledgement and parking remained dominant.
- Established meaning: regressed. Two of three explicit-scale runs stopped using the established rating meaning and returned only acknowledgement such as `我记下了` or `收到了`.
- Template behavior: failed. Surface substitutions did not produce additional understanding or movement.
- Result: rejected. A Prompt-only positive contract is not sufficient in this form.

### A2 — cross-turn unconfirmed-claim contract

- Groundedness: failed. The old `松口气` claim did not carry over, but the treatment repeatedly invented a counting frame (`我跟着你数`).
- Conversation movement: failed. Parking language such as `先放在这儿` and `也在这儿了` became more common.
- Established meaning: regressed materially. All explicit-scale runs failed to use the established scale; one explicit-count run asked what the already explicit count meant.
- Template behavior: failed. Cross-run locators found repeated observation, acknowledgement, and numeric openings.
- Result: rejected. Adding a stronger cross-turn Prompt contract worsened legitimate-context use.

### A3 — history construction control

- Groundedness: partially useful but insufficient. It removed the earlier assistant-only `松口气` claim and did not carry it forward, yet free-number replies still assigned purpose through `你想怎么用它`.
- Conversation movement: failed. The same observation/parking templates remained.
- Established meaning: passed for scale, numbered choice, and explicit count.
- Template behavior: failed. Cross-run locators found repeated `<observe><token>`, `又看到一个#`, and acknowledgement openings.
- Result: rejected as a complete fix. History isolation protects contamination but does not solve response quality.

## 6. Five Runtime Gates

| Runtime gate transferred from `PR18_REVIEW` §7 | A0 | A1 | A2 | A3 | Overall |
| --- | --- | --- | --- | --- | --- |
| All free-number treatment cases avoid unsupported meaning. | Fail | Fail | Fail | Fail | Fail |
| All free-number treatment cases preserve conversation movement. | Fail | Fail | Fail | Fail | Fail |
| Established numeric contexts preserve their meaning. | Pass | Fail | Fail | Pass | No treatment winner |
| Locator catches repeated/synonymous templates. | Pass | Pass | Pass | Pass | Pass |
| No synonym substitution masquerades as improvement. | Pass | Pass | Pass | Pass | Pass |

The final two rows describe evaluator integrity: the locator and human review correctly rejected synonym-only changes. They do not make any treatment eligible for product use.

## 7. Root-cause Decision

No single primary root cause is selected.

Evidence supports these narrower conclusions:

- Recent assistant history can carry unsupported meaning, but removing it alone does not restore conversation movement.
- The A1/A2 Prompt contracts are not reliable enough and can suppress legitimate established meaning.
- The remaining failure is not only unsupported meaning. It is the coupled rendering problem of token echo, mechanical acknowledgement, and conversational closure.

Selecting Prompt or history as the sole product root cause would overstate the evidence.

## 8. Scope and Safety Confirmation

- No production Prompt default changed.
- No Selector, ClinicalPlan, Strategy, signal, schema, Memory, Safety, or provider behavior changed.
- Eval adapters are accepted only for conversation IDs beginning with `trajectory-eval-`.
- A0 remains the canonical product path.
- Real-model reports are not committed as canonical deterministic fixtures.
- The experiment scripts are not included in `check:launch`.

## 9. Distance to the Desired Product Effect

- Diagnosis and reproducible measurement: complete.
- A0/A1/A2/A3 hypothesis comparison: complete.
- Stable primary-root-cause selection: incomplete.
- Product implementation: not started.
- User-visible verification in `/chat`: not started.

Engineering evidence is approximately 75% of the way to an authorized fix. User-visible improvement is still 0% because changing product behavior was intentionally outside Issue #19.

## 10. Next Decision

Do not promote A1, A2, or A3 into a product PR.

The next action requires a new, separately reviewed experiment hypothesis that addresses both groundedness and conversation movement without weakening established numeric contexts. That hypothesis must be authorized before implementation; Issue #19 results do not authorize an unregistered A4 or a production change.
