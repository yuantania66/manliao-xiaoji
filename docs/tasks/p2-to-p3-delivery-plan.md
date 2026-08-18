# Delivery Plan — P2 quality → P3 Safety trunk (PM-authorized)

**Authorized by PM:** 2026-08-17 — complete remaining items through **P3 done**, self-accept each step.  
**Workspace:** `/private/tmp/xinqing-p2-publication-impl` · `codex/p2-publication-impl` · base `890a030`  
**Main repo:** do **not** smash dirty `codex/planner-handoff-migration` tree.

## Definition of Done (P3) — achieved in isolation

Per `docs/HOT_COLD_PATH_V1_CONTRACT.md` §12:

- Input gate on V2 publication stream ✅
- Streaming output Safety Guard (deterministic v1) ✅
- Hard facts + Memory untrusted labeling ✅
- Safety/adversarial suite PASS (`check:p2-publication-stream`, `check:p2-publication-p3`) ✅
- INV-1 / INV-2 executable ✅
- Controlled cohort **gate** (default OFF; allowlist) ✅ — not site-wide ON
- `[SLO-FIRST-SAFE]` — **not frozen** (insufficient timed samples); provisional note only

## Steps

| Step | Status |
|---|---|
| S1 Intent on preview | **PASS** |
| S2 Streaming Output Safety | **PASS** |
| S3 Hard facts + Memory isolation | **PASS** |
| S4 Controlled cohort gate | **PASS** (defaults OFF) |
| S5 P3 exit package | **PASS** (`npm run check:p2-publication-p3`) |
| S6 Merge prep | commit isolation branch; do not auto-merge dirty main |

## Non-goals (still)

- Site-wide `P2_PUBLICATION_ENABLED` default ON
- Day2 formal BUDGET as first-safe SLO substitute
- LLM Safety judge
- Forced shared prod DB migration
