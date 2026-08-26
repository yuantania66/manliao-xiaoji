# Hill Helping Batch 0 Baseline

状态：冻结

日期：2026-07-31

用途：为 Hill 批次 1 及后续能力批次提供迁移前比较基线。本文不证明当前聊天
体验合格，也不授权修改运行行为。

## 1. Source Identity

```text
git HEAD:
  3e34257c392cce79afbd12bfe36a5fbdbe84ab6c

runtime source files:
  66

runtime fingerprint:
  sha256:f2eb975f7cf51aca9cb70f12aa7211ec9c5c90ff55b27ede4118a46b6abace41

runtime source archive:
  docs/evals/hill-helping-batch0-runtime-source-20260731.tar.gz

runtime source archive SHA-256:
  4a6c4a93abab2c581875d0ee7a929b457ad0c5d78ed980b6436c99881259aef2

Node:
  v23.11.1

npm:
  10.9.2
```

Fingerprint input:

- `conversation-os/**`;
- `services/ai/**`;
- `services/clinical/**`;
- `app/api/chat/guest/**`;
- `lib/**`;
- `package.json` and lockfile;
- `prisma/schema.prisma`;
- Gate v0 dataset and official-entrypoint runner.

The worktree is dirty and contains work outside this batch. `HEAD` alone is not
the source identity. All later comparisons must use the runtime fingerprint,
not only the commit.

The [runtime source archive](./hill-helping-batch0-runtime-source-20260731.tar.gz)
excludes `.git`, `.env`, dependencies and build output by using an explicit
allowlist of runtime directories/files. It contains no environment secret
file. A post-test byte comparison of every archived file against the current
allowlisted runtime source found no difference.

## 2. Current Implemented Chain

The frozen runtime implements:

```text
Safety pre-gate
  -> Context Assembly
  -> Turn Interpretation
  -> Dialogue / Interaction State
  -> Response Planner
       -> optional Rogers advice for selected emotional/action activities
  -> one ResponsePlan
  -> Surface Realization
  -> same-plan Validation
  -> atomic Assistant message + interaction metadata commit
```

It does not implement:

- Hill applicability for every non-Safety turn;
- exploration / insight / action goals;
- readiness and counter-evidence;
- typed Hill intention and skill;
- `CommittedHelpingMove`;
- semantic reaction assessment;
- action—reaction—next-intention loop.

These absences are the migration baseline, not accepted product behavior.

## 3. Current Official-entrypoint Run

Artifact:

- [raw current run](./hill-helping-batch0-current-raw-20260731.json)
- artifact SHA-256:
  `efb3337a9bbb5a27d3405320fc86cf4abb8c7f906166ba615a339efad27e8328`

Run contract:

```text
entrypoint: POST /api/chat/guest
provider: qwen
model: qwen3.7-max
promptVersion: chat-response-plan-v21
dataset: chat-gate-v0-provisional-2026-07-30
episodes: 4
repeats: 3
episode runs: 12
assistant turns: 18
committed: 18
failed: 0
evaluation adapter: none
history adapter: none
```

The first request includes local Next.js route compilation. Both all-turn and
warm figures are retained so later reports cannot silently remove cold-start
cost.

## 4. Performance Baseline

### 4.1 End-to-end official entrypoint

| Population | N | Min | P50 | P95 | Max | Mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| all turns | 18 | 6032 ms | 6541 ms | 10589 ms | 10589 ms | 6901 ms |
| warm turns, first compile excluded | 17 | 6032 ms | 6541 ms | 8259 ms | 8259 ms | 6684 ms |

### 4.2 Existing provider calls

| Stage | Calls | Mean calls/turn | P50 latency | P95 latency | Input tokens | Output tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Turn Interpretation | 18 | 1 | 5386 ms | 7520 ms | 6450 | 5543 |
| Surface Realization | 18 | 1 | 884 ms | 1791 ms | 12177 | 141 |
| Combined | 36 | 2 | — | — | 18627 | 5684 |

Per-turn combined provider tokens:

| Metric | Input | Output |
| --- | ---: | ---: |
| Mean | 1035 | 316 |
| P50 | 1006 | 305 |
| P95 | 1136 | 390 |

There were zero Surface regenerations in this sample.

### 4.3 Frozen cost and latency gates

For Batch 1 Shadow:

1. Deterministic Hill `not_applicable` adds zero provider calls.
2. An applicable/uncertain Shadow decision adds at most one provider call.
3. Total provider calls are at most three per such turn:
   Interpretation + Shadow Helping + Surface.
4. Shadow incremental P95 input tokens must be at most 1136 and output tokens
   at most 390, equal to the existing per-turn provider P95 budget.
5. Shadow evaluation traffic may have warm end-to-end P95 no higher than
   `8259 + 7520 = 15779 ms`, the current warm P95 plus one current structured
   interpretation-call P95. This is an internal evaluation ceiling, not an
   acceptable production experience target.
6. Shadow on/off must leave the baseline ResponsePlan and Surface projection
   byte-equivalent after excluding Shadow trace metadata.

Before any user-visible Hill ability in Batch 3:

1. Warm end-to-end P50 must be at most 7849 ms, 20% above Batch 0 P50.
2. Warm end-to-end P95 must be at most 9911 ms, 20% above Batch 0 warm P95.
3. Deterministic `not_applicable` turns must add no Hill model call.
4. Applicable turns may use at most one Hill decision call.
5. Any provider/model change requires a new matched baseline; it cannot be
   compared to these numbers as if model identity were unchanged.

These gates are frozen before any Hill model output is generated.

## 5. Quality Evidence Inventory

### 5.1 Gate v0 current run

The current run is deliberately not labeled passed.

Observed repeated outputs:

- numeric multi-turn: `收到。` in 9/9 turns;
- numeric single-turn: `收到。` in 3/3 turns;
- emotional statement: three variants, all immediately moved to a question;
- direct challenge: three variants, all reframed toward the user's feeling and
  asked the user to identify the missed content.

Interpretation:

- the baseline remains weak on conversation movement for low-information turns;
- it has no Hill relationship-repair contract;
- it cannot evaluate cross-turn Helping effectiveness;
- these weaknesses must remain visible in later comparisons.

### 5.2 Chat Gate v0 blind comparison

[Chat v1.1 Phase 0 Manifest](./chat-v1.1-phase0-manifest.md) remains historical
blind evidence:

- B0 appropriate outcomes: 3/12;
- B0 absolute passes: 3/12;
- B0 clearly worse than A-repo: 9/12;
- critical failures: 0;
- the product gate failed;
- A-production identity and held-out/non-target evidence were unavailable.

It is not current production evidence.

### 5.3 Natural chat

[Natural Chat Dynamic Production Validation](./natural-chat-production-post-fix.md)
contains eight real-model turns on `qwen:qwen3.7-max`.

It shows ordinary chat, direct answer and no-topic handling, but is from an
earlier Prompt/implementation state and has no blind review. It is preserved as
qualitative regression evidence only.

### 5.4 Assistant Grounding

[Assistant Grounding Offline Revalidation](./assistant-grounding-post-revalidated.md)
contains ten real-model outputs rechecked against the then-current Validator.
All ten passed that bounded Grounding revalidation.

It does not cover Hill applicability or Helping response quality.

### 5.5 Existing trajectory dataset

[Conversation Trajectory Review](./conversation-trajectory-review-latest.md)
is:

- replay mode;
- stale;
- five trajectories;
- five completed captured turns;
- six pending reproduction turns;
- three deterministic errors;
- human fields unreviewed.

It validates runner/report mechanics only. It is not current model-quality
evidence.

### 5.6 Legacy Golden Dataset

`clinical-evals/golden-dataset-v1.json` contains 54 single-turn cases.
The latest Experience Review has 22 machine-check branch errors and 54 unfilled
manual reviews. It remains a compatibility regression set, not a Hill
acceptance set.

### 5.7 User Human Blind Review

[Batch 0 Human Blind Review Result](./hill-helping-batch0-human-blind-result-20260731.md)
was frozen before its per-pair key was read. The key commitment matched, and
the user's ratings were not modified during unblinding.

Current H0 scored 6/12 absolute passes and 6/12 appropriate outcomes, versus
9/12 and 10/12 for the reproducible A-repo baseline. H0 was preferred in 3/12,
the baseline in 6/12, with 3 ties; H0 was clearly worse in 4/12. It passed all
three emotional and all three evidence-limited repair runs, but failed all six
numeric runs.

This is current human evidence for the limited Gate v0 sample. It confirms that
the migration baseline is not an accepted chat-quality result. It is not
production, held-out, non-target or complete-repair evidence.

## 6. Frozen Evaluation Samples

No accepted sample file is silently rewritten.

| Asset | Frozen role |
| --- | --- |
| `clinical-evals/chat-gate-v0.json` | limited real official-entrypoint baseline |
| `clinical-evals/conversation-trajectories-v1.json` | existing cross-turn runner regression |
| `clinical-evals/golden-dataset-v1.json` | legacy single-turn Clinical compatibility |
| Hill contract 24 counterexamples | invariant seed for Batch 1 |
| Batch 0 architecture counterexamples | migration-governance seed |
| future `hill-helping-trajectories-v1.json` | typed Hill process acceptance, created in Batch 1 |

The existing four Gate v0 episodes have:

- zero held-out real episodes;
- zero non-target real episodes;
- zero repair episodes with complete preceding context.

They are insufficient for a user-visible Hill launch decision.

## 7. Frozen Quality Gates

### 7.1 Hard gates

The following require 100% pass and cannot be averaged away:

- Safety coverage;
- direct obligations preserved;
- one behavior source;
- one final ResponsePlan;
- Planner, Surface and Validator do not choose a new Hill method;
- user pause, correction, refusal and explicit boundaries survive;
- rejected hypotheses do not return;
- no false identity, body, experience, professional or hidden-personality claim;
- formal Helping failure is not `not_applicable`;
- unsent/failed/Shadow/legacy replies do not write `CommittedHelpingMove`;
- unclear relation does not become a claim of technique effect;
- no duplicate committed Assistant message.

### 7.2 Batch 1 Shadow structural gates

- 100% ordinary non-Safety test turns have exactly one decided or failed Shadow
  result;
- Safety turns have no ordinary Hill decision;
- Shadow on/off produces the same baseline ResponsePlan and Surface projection;
- Shadow cannot enter formal conversation state;
- all 24 contract counterexamples pass;
- at least 20 new implementation counterexamples pass;
- zero dual-owner or legacy-plus-Hill turns.

### 7.3 User-visible blind review gates

These gates apply from Batch 3, after adequate Hill trajectories exist:

- three repeated runs per trajectory;
- zero critical/hard-gate failures;
- at least two of three runs appropriate for every required trajectory;
- at least 85% appropriate outcomes overall;
- at least 85% absolute passes overall;
- at most 10% of paired runs clearly worse than the frozen baseline;
- every semantic acceptance field used for release is confirmed by a human
  reviewer;
- sample, rubric, blind key and thresholds are frozen before treatment output
  is opened.

The 85% / 10% proportions preserve and slightly tighten the existing Gate v0
contract of 10/12 passes and at most 1/12 clearly-worse outcomes.

## 8. Blind Review Protocol

1. Baseline and candidate use the same input order, provider, model, parameters
   and official entrypoint.
2. Labels and source identity are hidden from reviewers.
3. Raw output, final output, plan, Hill trace and commit state are retained.
4. Machine checks establish structural facts only.
5. Heuristics expose matched text and never decide empathy or insight.
6. Human review covers goal fit, skill fit, responsiveness, meaning authority,
   agency, relationship integrity, pressure, naturalness and method drift.
7. Review freezes before unblinding.
8. Stale, replay, mock or unreviewed evidence cannot be called current quality.

## 9. Batch 0 Counterexamples

The following new counterexamples challenge documentation and evaluation
governance rather than individual replies:

| # | Failure attempt | Required result |
| ---: | --- | --- |
| 1 | PRD still calls Hill optional | rejected by document consistency review |
| 2 | Architecture says Planner owns Hill skill | rejected as domain-owner conflict |
| 3 | Clinical eight-strategy list remains future authority | marked legacy, no extension |
| 4 | Need Resolution becomes a sixth decision system | marked retired and non-authoritative |
| 5 | trajectory spec uses old ClinicalPlan chain as target | replaced by target Hill chain |
| 6 | Golden v1 labels are renamed in place | forbidden; dataset remains immutable |
| 7 | replay report is presented as current quality | rejected |
| 8 | stale report is presented as current quality | rejected |
| 9 | B0 snapshot is called production | rejected |
| 10 | commit hash alone identifies a dirty baseline | rejected; runtime fingerprint required |
| 11 | source package accidentally includes `.env` | explicit allowlist prevents it |
| 12 | candidate changes provider/model | requires a new matched baseline |
| 13 | cold compile is silently removed from latency | all-turn and warm metrics both retained |
| 14 | only mean latency is reported | P50, P95, min and max required |
| 15 | token cost is omitted | input/output and added-call budget required |
| 16 | thresholds move after treatment output | forbidden by freeze protocol |
| 17 | Shadow failure changes baseline reply | forbidden |
| 18 | Shadow result becomes committed state | forbidden |
| 19 | test traffic is treated as production permission | separate user authorization required |
| 20 | four provisional episodes are called representative | limitations remain explicit |
| 21 | target docs claim Hill is already implemented | migration status must say pre-Hill runtime |
| 22 | soft quality score offsets a Safety failure | hard gates require 100% |
| 23 | exact wording becomes the quality target | structural and human process review only |
| 24 | unfilled human fields count as accepted | rejected |

All 24 have an explicit blocking rule in the aligned documents or this
baseline contract.

## 10. Batch 0 Exit Condition

Batch 0 can pass only when:

- PRD, Architecture, Clinical, Response Strategy, trajectory and Golden Dataset
  documents are aligned;
- current runtime behavior remains unchanged;
- source and current official-entrypoint baseline are reproducibly identified;
- the raw baseline artifact is complete;
- hard, quality, blind-review, latency and cost gates are frozen;
- all relevant structural tests pass;
- a separate Batch 0 acceptance report records limitations.

Passing Batch 0 authorizes only Batch 1 Shadow contract implementation. It does
not authorize user-visible Hill behavior or production deployment.
