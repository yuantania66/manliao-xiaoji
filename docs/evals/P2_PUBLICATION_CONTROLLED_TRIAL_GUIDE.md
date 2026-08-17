# P2 Publication — Controlled Trial Guide（eval / opt-in only）

Status: **PM-authorized controlled trial** (not full-site traffic).  
Baseline worktree: `/private/tmp/xinqing-p2-publication-impl` · branch `codex/p2-publication-impl` · base `890a030`.

## Hard constraints

| Rule | Detail |
|---|---|
| Default writer | Still **V1** (`createReviewedChatReply`). Do **not** set `P2_PUBLICATION_ENABLED` as a site-wide default. |
| Trial surface | `/api/chat/p2-publication/eval` (flagged). Messages route only if flag ON **and** `useP2Publication=true`. |
| Store | Prefer `P2_PUBLICATION_STORE=file` (writes under `.data/`, gitignored). Optional isolated test DB + prisma **only** if PM separately authorizes migration on that DB. |
| Non-goals | Production DB migration · full traffic · Day2 BUDGET · site-wide default ON without new PM decision |

> Client provisional UI: see `docs/evals/P2_PUBLICATION_CLIENT_UI_GUIDE.md` (PM-authorized follow-on).


## 1. Start (local, file store)

```bash
cd /private/tmp/xinqing-p2-publication-impl

# Narrow automation (no server required)
npm run check:p2-publication
npm run check:p2-publication-trial

# Opt-in server process (does NOT change default for other processes)
export P2_PUBLICATION_ENABLED=1
export P2_PUBLICATION_STORE=file
export P2_PUBLICATION_FILE_PATH="$(pwd)/.data/p2-trial-publications.json"
npm run dev
```

Confirm flag is off for any process that should stay on V1: unset `P2_PUBLICATION_ENABLED` (or set `0`).

## 2. Smoke the eval API

```bash
# Status (safe; no mutation). When flag off: enabled=false, productionWriter=v1
curl -sS http://localhost:3000/api/chat/p2-publication/eval | jq .

# Ingress (requires flag ON)
curl -sS -X POST http://localhost:3000/api/chat/p2-publication/eval \
  -H 'content-type: application/json' \
  -d '{"op":"ingress","sessionId":"trial-s1","clientTurnId":"trial-turn-0001","content":"你好","workerId":"w1"}' | jq .

# Provisional segment
curl -sS -X POST http://localhost:3000/api/chat/p2-publication/eval \
  -H 'content-type: application/json' \
  -d '{"op":"start_streaming","sessionId":"trial-s1","clientTurnId":"trial-turn-0001","workerId":"w1"}' | jq .

curl -sS -X POST http://localhost:3000/api/chat/p2-publication/eval \
  -H 'content-type: application/json' \
  -d '{"op":"append_provisional","sessionId":"trial-s1","clientTurnId":"trial-turn-0001","workerId":"w1","segment":"我在。","safetyAccepted":true}' | jq .

# Commit (Conversation Log commit simulated via conversationCommitOk)
curl -sS -X POST http://localhost:3000/api/chat/p2-publication/eval \
  -H 'content-type: application/json' \
  -d '{"op":"commit","sessionId":"trial-s1","clientTurnId":"trial-turn-0001","workerId":"w1","finalContent":"我在。","conversationCommitOk":true}' | jq .
```

When `P2_PUBLICATION_ENABLED` is unset/off, POST returns **404** (`P2 publication entry is disabled`).

## 3. What to verify

### A. Same turn → no second winner

Repeat the same `sessionId` + `clientTurnId` ingress with a different `workerId` while lease is live.

Expect:

- second call `action: "attached"` (not a second create)
- single publication id
- `store.countAssistantPublications` / JSON snapshot under `.data/` shows **one** assistant publication for that turn

### B. provisional → commit

After `append_provisional`:

- response has `provisional: true` and `provisionalMarkedTemporary: true`
- after successful `commit`: `publication.status === "committed"`, API `provisional: false`, `success: true` (authority is status, not the historical marker field)

If `conversationCommitOk: false`, expect `success: false` (must not report success).

### C. Lease takeover

Simulate expired lease (automation uses `expireLease` in dry-check), then ingress with `workerId: "w2"`.

Expect:

- same publication row id
- attempt incremented / lease renewed
- no live zombie `reserved|streaming` left for that turn

## 4. Write isolation (production authority path)

| Path | Writes |
|---|---|
| Default messages POST (flag off **or** no `useP2Publication`) | V1 `createReviewedChatReply` + existing Prisma `ChatMessage` authority |
| Eval / opt-in with `P2_PUBLICATION_STORE=file` | **Only** `.data/*.json` (or `P2_PUBLICATION_FILE_PATH`) — does **not** mutate production session ChatMessage rows |
| `P2_PUBLICATION_STORE=prisma` | Requires migrated `AssistantPublication` table — **do not** point at shared prod DB without PM approval |

Evidence command:

```bash
npm run check:p2-publication-trial
# asserts: flag default off, file-store path under .data/, no ChatMessage import in fileStore,
# messages route gated by flag && useP2Publication, eval route 404-when-off contract in source
```

## 5. STOP gate

After trial evidence is reviewed:

- **Do not** flip site-wide `P2_PUBLICATION_ENABLED` default.
- Client provisional UI (PM-authorized): `docs/evals/P2_PUBLICATION_CLIENT_UI_GUIDE.md` — STOP for visual acceptance before cohort expansion.

- Next product decision: keep eval-only · authorize client UI · or expand flag to a controlled cohort.


## Controlled cohort (after P3 exit)

Still **default OFF**. Requires:

```bash
export P2_PUBLICATION_ENABLED=1
export P2_PUBLICATION_COHORT=1
export P2_PUBLICATION_COHORT_ALLOWLIST=userId1,userId2
```

Preview `/chat/p2-preview` remains the operator opt-in path when flag is ON.
Cohort does **not** flip the default production writer away from V1.
