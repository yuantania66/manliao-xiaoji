# Stage B Ready-Preview Delivery Slice

Status: FROZEN
Frozen on: 2026-08-20 Asia/Shanghai
Product approval phrase: `计划通过`

## Outcome

Produce an internal-preview, regression-ready, PR-ready release candidate. The P2 flag remains off by default and V1 remains the site-wide writer. This is not a production deployment, public release, real-user trial, or production traffic switch.

## Baseline

- Git commit: `3aaaced3b1982dfe7c0f4aebf49de780ad59518d`
- Git tree: `e55167d789da4fa54df32a51707c56a08fb8637b`
- RC branch: `codex/ready-preview-3aaaced`
- Source workspace dirty inventory at freeze time: 62 tracked paths and 41 untracked files (103 total), inventory SHA-256 `270173c882a34088cd97f264a0d55272bbcadb6fce239e6af85ecda52f34c4f2`.
- The dirty source workspace is inventory-only. `excluded_from_rc_and_pr=true`; none of those changes may be merged wholesale.

## Frozen Product Narrowings

1. The model-free channel is an evaluation fixture only. It is default-off, requires an explicit evaluation environment, is physically isolated from production and the V1 writer, and must remain visibly labeled in the UI as a simulated evaluation stream rather than real Qwen. Isolation failure is a hard stop.
2. The ordinary greeting regression uses the clean baseline and excludes the unsealed Safety Semantic Triage. `你好` must remain ordinary. Explicit self-harm, overdose, and violence must remain Safety-owned with zero ordinary generation calls. This slice does not claim covert-expression or full-recall Safety coverage.
3. The fixture proves only the provisional-to-committed UI/state-machine path. Real-model conversation quality is explicitly untested and is not a ready-preview gate.
4. The source workspace dirty inventory is recorded but not merged. The RC and PR must contain only files directly authorized by this slice.

## Acceptance

- One client turn produces no second assistant winner.
- Content that has not passed the existing output Safety/Hard Guard is not externally published.
- Commit failure is never reported as success.
- The isolated phone preview visibly transitions from temporary/unconfirmed to confirmed while retaining its simulated-source label.
- Core phone flows cover success, retry/reattach, commit failure, and rollback.
- `你好` is not falsely Safety-blocked; explicit self-harm, overdose, and violence remain Safety-owned with zero ordinary generation calls.
- Deletion uses synthetic isolated data and removes assistant text while retaining only content-free tombstone metadata. Any memory/forgetting claim is limited to the exact isolated store exercised.
- P2 remains off when unset or false; V1 remains the default writer.
- P2/P3 narrow gates, build, launch checks, and independent QA pass without high-risk Safety regression.
- Final PR scope contains no unreviewed source-workspace dirty changes, production migration, production configuration, secret, model call, or rollout.

## Allowed Scope

- Isolated RC source, tests, and documentation.
- Evaluation-only, server-gated, default-off model-free fixture transport.
- Preview-only UI source labeling.
- Deterministic ordinary/Safety, P2/P3, deletion, rollback, and mobile-flow regression evidence.
- Branch, commits, and a PR after all gates pass.

## Non-goals

- Production deployment, public traffic, real-user traffic, production plaintext, or production database migration.
- Site-wide P2 enablement or changing the V1 default writer.
- `enforce`, LLM Observer publication integration, S3b-R canary, or any new real-model call.
- Prompt/model policy changes, Semantic Triage, covert-risk/full-recall claims, or real-Qwen experience validation.
- Persistent lifecycle state or unrelated refactoring.

## Stop Conditions

Stop on any product-philosophy change, privacy/Safety incident, required hard-boundary violation, production/real-user operation, new model-call budget, physical-isolation failure, or a frozen gate that still fails after two evidence-driven repair passes.

## Milestones and Calendar

- M0: clean RC and frozen evidence.
- M1: ordinary greeting false-block closure with explicit-risk counterexamples.
- M2: physically isolated, visibly labeled model-free preview fixture.
- M3: P2/P3, Safety, deletion, and rollback contract regressions.
- M4: core phone provisional-to-committed and failure-recovery validation.
- M5: full gates, independent QA, evidence package, and PR-ready handoff.

Calendar estimate from approval: optimistic 3, baseline 5, pessimistic 9 natural days.

## Parallel Research Boundary

S3b-R is parallel research and not a ready-preview hard gate. The current `schemaVersion` adjustment remains zero-call configuration work only. No canary is authorized by this slice.
