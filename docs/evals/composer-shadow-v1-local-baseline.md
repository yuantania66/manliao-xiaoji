# Composer Shadow V1 Local Baseline

Status: local/eval-only implementation baseline. No production integration.

The local authority `frozen_v1_observation_snapshot_authority_v1` is now the sole input to Composer evaluation. It binds one uniquely identified case to the complete sample-set hash, canonical Grounding facts/version/hash, the turn-local Purpose contract/version/hash, an explicitly owned V1 execution fixture, five proven local isolation boundaries and two production-integration boundaries that remain pending. Callers cannot replace Grounding or Purpose fields.

Before Snapshot composition, `v1_execution_outcome_integrity_authority_v1` independently validates and freezes the V1 outcome. A committed outcome requires a winner hash with no failure and no retry authority. A failed outcome requires no winner or committed edge, an explicit retryable boolean, and one frozen existing P0 failure category: `SAFETY_BLOCKED`, `PLAN_INVALID`, `GENERATION_NONCONFORMANT`, `PROVIDER_ERROR`, `PERSISTENCE_ERROR`, or `TIMEOUT`. Snapshot stores the authority definition, input and result hashes and does not invent missing metric defaults.

`composer_observation_ledger_authority_v1` validates an entire hash/count-only observation ledger before the paired report can consume it. Its result carries the complete ordered hash/count observations, so assertion revalidates every row and recomputes the observation commitments, entries hash, coverage and ledger hash against the authoritative 14-case sample-set hash. It enforces one run-config hash plus mechanically derived observation ids and unique case/slot bindings, and requires Safety provider-zero rows with every output/reference field empty. Field-specific frozen literals, enums and SHA-256 fields keep free text out of both the ledger and blind artifact. Local event non-publication accepts no caller source content: it reads the exact Composer owner file and compares it with a pre-frozen content digest and aggregate descriptor before running the writer/publisher scan. A real terminated-child harness separately proves no post-termination ledger append. Three explicit synthetic slots prove only the mechanism: behavior stability remains pending until authorized real three-run evidence exists. Human ratings, production background isolation, three calendar days, Hot/context-band counts and bootstrap confidence evidence also remain pending.

`composer_p1_exit_evidence_evaluator_v1` is the sole deterministic local evaluator for the nine §9 exit gates and its public authority accepts only a strict-valid Ledger result. Caller-supplied human, behavior or latency claims cannot enter the result or upgrade a gate. Ledger coverage, traceability, and the frozen Safety/Episode hit-and-miss coverage pass; all-seven isolation, Shadow on/off V1 equality, behavior stability, paired human review, adaptive latency, and budget selection remain `pending` until separate trusted authorities exist. Human blind binding, three-run identifiers and the frozen seed `1729` / 1,000-replicate bootstrap remain mechanism-only checks whose outputs state `mechanismPassed` separately from the permanently false `evidencePassed`; they never create dates, ratings, Qwen observations or exit evidence.

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

The frozen `composer_real_qwen_12x3_runner_mechanism_v1` covers the authoritative 12 ordinary cases with three separately identified runs per case and one `runConfigHash`. Each of its 36 structured rows contains hashes, counts, request-level timings and provider token counts when returned. A provider repair remains a call within one run and never substitutes for an independent run. Run its no-network mechanism gate with `node --import tsx scripts/composer-shadow-qwen-local.ts --check-mechanism`. The mock result is permanently labeled `mechanism_only_not_evidence`; it cannot satisfy behavior stability. The explicit real-Qwen mode may only produce `candidate_requires_ledger_authority_validation`, because only a subsequent strict Ledger Authority result can establish exit evidence. The script writes JSON to stdout only and has no production, database or real-data path.

## Time gate

The P1 exit gate remains **pending**. This baseline does not claim the required 200 successful first-attempt Hot observations across three separate calendar days (minimum 50/day and all Context bands), three-run behavior stability, paired blind human review, bootstrap confidence interval, or a `[BUDGET-CANDIDATE]`. Those observations cannot be replaced by generated timestamps or synthetic counts.
