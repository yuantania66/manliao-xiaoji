# Chat v1.1 Phase 0 Manifest

Status: failed acceptance; do not proceed to the next phase

Frozen at: 2026-07-30T17:38:00+08:00

## Scope

Phase 0 builds evidence and evaluation infrastructure only. It does not change
chat behavior, product workflow, notes, long-term memory, or user isolation.

## Frozen candidates

### A-production

- status: unresolved
- configured public entrypoint: `https://manliaoxiaoji.com`
- health verification on 2026-07-30: unavailable
- deployment-to-commit evidence: none found in the repository or GitHub
  deployment records
- acceptance use: forbidden until its source identity is proven

### A-repo

- role: reproducible fallback baseline, not a claim about production
- commit:
  `3e34257c392cce79afbd12bfe36a5fbdbe84ab6c`
- source archive:
  `/private/tmp/xinqing-v1.1-phase0/A-repo-3e34257-source.tar.gz`
- archive SHA-256:
  `101037b40a475238a4ca69e101a3212ac4571912b5a085ad240606a15f8c158f`

### B0

- role: candidate state before Phase 0 infrastructure edits
- base commit:
  `3e34257c392cce79afbd12bfe36a5fbdbe84ab6c`
- source state: 43 modified tracked files plus the untracked files present at
  freeze time
- tracked diff against base: 3,587 insertions and 606 deletions
- source archive:
  `/private/tmp/xinqing-v1.1-phase0/B0-20260730T-current-source.tar.gz`
- archive SHA-256:
  `1f7c08785416d2766b478bdd20d561b02556a3afcd2d4d4967788d893e9c0cca`
- excluded from archive: `.git`, `.env*`, `node_modules`, `.next`, coverage and
  `.DS_Store`

The archive exclusion check found no secret, dependency, build, or Git metadata
paths.

## Runtime contract

- official evaluation entrypoint: `POST /api/chat/guest`
- provider: `qwen`
- model: `qwen3.7-max`
- each side uses the same local environment and model configuration
- each episode is replayed three times
- raw HTTP response, Assistant text, prompt version, debug trace, latency,
  source identity and archive hash must be preserved
- evaluation adapters, hidden history rewriting and eval-only chat behavior are
  forbidden

The guest API is selected for Phase 0 because it is a real user-visible API
entrypoint and can replay current-session adjacent history without importing
long-term memory or requiring a test account. This does not prove that the
logged-in and Mini Program entrypoints are unified; that remains a later v1.1
phase.

## Dataset evidence

The provisional contract is
`clinical-evals/chat-gate-v0.json`.

- independent captured episodes: 4
- episode runs per side: 12
- total A/B episode runs: 24
- generated Assistant turns per side: 18
- held-out real episodes: 0
- non-target real episodes: 0
- repair episodes with complete preceding context: 0

The four episodes are sufficient to run a limited real-regression comparison.
They are not sufficient to claim the full v1.1 non-target regression gate has
passed.

## Phase 0 acceptance

Phase 0 may pass only when:

1. A-production is identified or the Decision Owner explicitly accepts
   A-repo as the comparison baseline;
2. both frozen sources build;
3. the official-entrypoint runner completes all 24 episode runs against the
   same provider/model;
4. raw artifacts and a label-blind review package are complete;
5. all Gate v0 thresholds that have evidence are met;
6. the missing non-target/held-out evidence is supplied or explicitly accepted
   as a Phase 0 limitation.

Until those conditions are met, the correct status is `failed acceptance`, not
passed.

## Executed evidence

Both frozen sources completed a production build with Node `23.11.1` and Next
`15.5.19`.

The first official-entrypoint run completed:

- A-repo: 12 episode runs, 18 committed turns, 0 execution failures
- B0: 12 episode runs, 18 committed turns, 0 execution failures
- provider/model: `qwen:qwen3.7-max` on both sides
- evaluation/history adapters: none

The first batch was reviewed blind before its key was read. The adjudication
file was frozen at SHA-256
`f26449dbff998db60bf135a03c828c847ff8289048b2aee83fe45f6443aa6b32`.

After unblinding:

- A-repo was label X
- B0 was label Y
- B0 absolute passes: 3/12
- B0 appropriate outcomes: 3/12
- B0 critical failures: 0
- B0 clearly worse than A-repo: 9/12
- pair preference: B0 2/12; A-repo 10/12

Per episode, B0 scored:

- numeric multi-turn: 0/3
- emotional statement: 3/3
- evidence-limited repair: 0/3
- numeric single-turn: 0/3

All applicable quality thresholds except the critical-failure maximum failed.
The full gate also remains non-evaluable because A-production, held-out real
evidence and non-target real evidence are unavailable.

The initial production-mode API run did not return debug trace. Those raw
quality artifacts were retained. The runner was then hardened to reject any
committed turn without trace, and both frozen sources were rerun with only
`AI_DEBUG_TRACE=true` added to the server environment. The trace rerun again
completed 18/18 committed turns per side.

## Acceptance decision

Phase 0 infrastructure is reproducible and passed its engineering checks, but
Phase 0 as a product gate did not pass. B0 is materially worse than A-repo and
does not meet absolute quality thresholds. The next v1.1 phase must not start
from B0 as if it were accepted.
