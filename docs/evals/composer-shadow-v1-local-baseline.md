# Composer Shadow V1 Local Baseline

Status: local/eval-only implementation baseline. No production integration.

The local authority `frozen_v1_observation_snapshot_authority_v1` is now the sole input to Composer evaluation. It binds one uniquely identified case to the complete sample-set hash, canonical Grounding facts/version/hash, the turn-local Purpose contract/version/hash, an explicitly owned V1 execution fixture, five proven local isolation boundaries and two production-integration boundaries that remain pending. Callers cannot replace Grounding or Purpose fields.

Before Snapshot composition, `v1_execution_outcome_integrity_authority_v1` independently validates and freezes the V1 outcome. A committed outcome requires a winner hash with no failure and no retry authority. A failed outcome requires no winner or committed edge, an explicit retryable boolean, and one frozen existing P0 failure category: `SAFETY_BLOCKED`, `PLAN_INVALID`, `GENERATION_NONCONFORMANT`, `PROVIDER_ERROR`, `PERSISTENCE_ERROR`, or `TIMEOUT`. Snapshot stores the authority definition, input and result hashes and does not invent missing metric defaults.

## Frozen boundary

- Synthetic `BaselineCaseV1` snapshots are versioned, recursively frozen and hashed.
- Safety-owned cases are recorded as `ineligible`; they never call the Composer.
- The Shadow core has injected provider, monotonic clock and append-only in-memory observation sink interfaces. It has no production route, database, writer, retry-authority or UI dependency.
- Local feature-flag and concurrency-budget rejection paths produce explicit `not_invoked` reasons. Production background scheduling, dedicated low-privilege telemetry credentials and production resource separation remain `pending`, because P1 has no production integration.
- Strict output parsing rejects extra/missing keys and invalid turn, Grounding, Episode or event references. One structural repair is allowed; the hard maximum is two calls.
- Default observations contain hashes, counts, enums and timings only. They contain no User or Assistant plaintext.
- Timeout, cancellation, malformed output and provider failure affect only the Shadow observation and leave the frozen V1 result snapshot unchanged.

## Local checks

Run the local synthetic check directly with the repository TypeScript runner. The real-Qwen script is inert unless it is explicitly passed `--allow-synthetic-qwen`, receives explicit credentials/base URL, and `COMPOSER_SHADOW_SYNTHETIC_ONLY=true`. It contains synthetic text only. That CLI deliberately uses `stream:false`; its request timing is **not** incremental decoder timing evidence.

## Time gate

The P1 exit gate remains **pending**. This baseline does not claim the required 200 successful first-attempt Hot observations across three separate calendar days (minimum 50/day and all Context bands), three-run behavior stability, paired blind human review, bootstrap confidence interval, or a `[BUDGET-CANDIDATE]`. Those observations cannot be replaced by generated timestamps or synthetic counts.
