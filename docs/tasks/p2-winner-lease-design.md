# P2 Winner / Lease / Streaming Publication Design

Status: design accepted; §14 frozen; Skeleton + Bypass done; **P2 Implementation (DB+Service+Flagged API)** landed on branch `codex/p2-publication-impl` from `890a030` (flag default OFF; production V1 writer unchanged).

Date: 2026-08-16

Authority: follows the frozen target semantics in `docs/HOT_COLD_PATH_V1_CONTRACT.md`. This document does not implement P2, does not switch the production writer, and does not authorize P3.

## 1. Goal

P2 turns the Hot/Cold V1 single-winner contract into an implementable publication boundary:

```text
client turn
  -> idempotent ingress
  -> reserve exactly one Assistant publication row
  -> stream only Safety-accepted provisional segments
  -> commit exactly one final Assistant winner
```

P2 is intentionally model-agnostic. It proves that retry, reconnect, lease expiry, takeover and commit failure cannot create a second user-visible Assistant winner.

## 2. Non-goals

- Do not implement P2 in this slice.
- Do not modify runtime code, Prisma schema, API routes or writer logic.
- Do not switch production from the current V1 writer.
- Do not resume Day 2, produce BUDGET, enter P3, or run new Qwen collection.
- Do not introduce persistent handoff, relationship or conversation lifecycle state.
- Do not make ordinary chat quality a fail-closed publication gate.

The publication state described below is execution/transport authority only. It must not be read as conversational lifecycle state.

## 3. Current V1 Boundary

Current logged-in production flow:

```text
app/api/chat/sessions/[sessionId]/messages/route.ts
  -> createReviewedChatReply()
  -> createChatReply()
  -> saveGeneration()
  -> saveJudgeResult()
  -> commitValidatedAssistantMessage()
  -> raw memory / experience side effects
```

Observed implementation references:

- `services/ai/chatReplyService.ts:createReviewedChatReply`
- `services/ai/chatReplyService.ts:commitValidatedAssistantMessage`
- `app/api/chat/sessions/[sessionId]/messages/route.ts`
- `lib/client-turn-id.ts`
- `lib/chat-turn-result-authority.ts`

P2 should sit in front of the committed Assistant writer, but this design does not replace it. The first implementation slice should create a skeleton around ingress, reservation and retry without model generation, then fault-inject it.

## 4. Conceptual Stores

No migration is authorized here. These are target concepts for later implementation review.

### Conversation Log

Authoritative user and committed Assistant messages. This remains the source of visible conversation truth.

### Assistant Publication

Execution record for one client turn. It owns stream identity, lease, retry and final publication status.

Conceptual unique constraints:

```text
unique(sessionId, clientTurnId, role)
unique(assistantPublicationId)
```

For the normal two-row turn, the effective single-winner lock is:

```text
unique(sessionId, clientTurnId, role = "assistant")
```

If partial unique indexes are unavailable in the target DB, use a role column plus a normal compound unique key and enforce the role value through application code and tests.

### Content-Free Tombstone

After source deletion, keep only the minimum idempotency marker needed to prevent regeneration for the same `sessionId + clientTurnId`. It must not retain draft or final text.

## 5. Publication State

The Assistant publication row has exactly five persisted states:

```text
reserved | streaming | committed | failed_retryable | failed_terminal
```

Required fields:

| Field | Purpose |
|---|---|
| `sessionId` | session scope for idempotency |
| `clientTurnId` | client-generated turn identity |
| `role` | fixed to `assistant` for the winner row |
| `status` | one of the five states |
| `attempt` | monotonic attempt counter |
| `leaseOwner` | current worker identity, nullable after terminal states |
| `leaseExpiresAt` | 30-second lease deadline; expiry is derived, not a state |
| `draftContent` | only Safety-accepted provisional segments |
| `finalContent` | committed final Assistant text |
| `failureCode` | low-cardinality terminal or retryable reason |
| `linkedConversationMessageId` | final committed Assistant message id, nullable before commit |
| `createdAt` / `updatedAt` | operational timestamps |

`leaseExpiresAt` must not create a sixth state. A row is still `reserved` or `streaming`; it is merely take-over eligible when the lease is expired.

## 6. Ingress

Ingress must be idempotent before any model or stream work starts.

Required sequence:

```text
1. receive sessionId + clientTurnId + user text
2. create-or-find User conversation row for unique(sessionId, clientTurnId, role="user")
3. create-or-find Assistant publication row for unique(sessionId, clientTurnId, role="assistant")
4. if Assistant row already exists, route by existing state
5. only then allow Safety / Context / Composer work
```

If ingress cannot create or find the User row and Assistant reservation atomically enough to protect idempotency, the turn fails before user-visible generation. The client may safely retry with the same `clientTurnId`.

Recommended landing points for a future implementation:

- `app/api/chat/sessions/[sessionId]/messages/route.ts`: ingress and retry routing.
- `services/ai/chatReplyService.ts`: bridge from validated reply to final commit.
- A new publication service module, for example `services/chat/assistantPublicationService.ts`.
- A future Prisma model, for example `AssistantPublication`, only after product authorizes migration.

## 7. Streaming Publication

Raw provider tokens are never user-visible.

Publication rule:

```text
provider tokens
  -> structured decoder
  -> complete candidate sentence/segment
  -> output Safety + Hard Guard
  -> append to draftContent
  -> emit as provisional segment
```

Only segments that pass output Safety may leave the server. A segment is provisional until the same Assistant row reaches `committed`.

Lease handling during stream:

- Start with 30-second lease at `reserved`.
- Move to `streaming` when the first generation attempt starts.
- Renew lease after each accepted provisional segment and on safe keepalive checkpoints.
- If the worker dies, another worker can take over only after `leaseExpiresAt`.
- A takeover must use the same Assistant publication row and increment `attempt`.

The client must treat provisional segments as replaceable. Refresh or reconnect attaches to the same row; it never creates a second Assistant response.

## 8. Commit

Final commit has one success condition:

```text
final output Safety + Hard Guard pass
  AND final Assistant Conversation Log record commits
  AND Assistant publication row moves to committed
```

If final Conversation Log commit fails, the server must not report success, even if provisional segments were already shown. The publication row remains recoverable or terminal according to the classified failure.

Commit rules:

- `committed` returns the stored `finalContent`.
- `draftContent` can be replayed only while the linked Conversation record is retained.
- After message deletion, clear `draftContent` and `finalContent`.
- A content-free tombstone may remain for idempotency, but it cannot replay deleted text.

## 9. Retry And Takeover Table

For the same `sessionId + clientTurnId`:

| Existing Assistant row | Required behavior |
|---|---|
| none | create `reserved`; continue normal ingress |
| `reserved` with live lease | attach or wait; no second row |
| `reserved` with expired lease | acquire same row, set new `leaseOwner`, increment `attempt`, continue |
| `streaming` with live lease | attach to current stream or replay safe `draftContent` |
| `streaming` with expired lease | acquire same row, invalidate stale provisional UI, increment `attempt`, resume or restart |
| `committed` | return exact stored final content; never regenerate |
| `committed` but linked Conversation record deleted | return `deleted` with no body; never regenerate |
| `failed_retryable` | acquire same row and retry with incremented `attempt` |
| `failed_terminal` | return same terminal failure category; never regenerate |

Retry must never create a new Assistant row for the same `sessionId + clientTurnId`.

## 10. Failure Classification

`failed_retryable` examples:

- provider timeout before final commit;
- worker crash with expired lease;
- transient database connection failure before final state is known;
- output Safety infrastructure timeout where no unsafe content was emitted.

`failed_terminal` examples:

- input validation failure;
- input Safety-owned non-ordinary turn where no ordinary winner should be generated;
- output Safety or Hard Guard final rejection;
- maximum attempt count reached;
- source User row deleted before completion.

Frozen default (§14): max attempt = `3`.

## 11. Safety Boundary

Input Safety remains before Composer. If input Safety owns the turn:

- no ordinary Composer call;
- no ordinary Shadow call;
- publication may commit a Safety-owned Assistant final only if the product-authorized Safety path says it is user-visible;
- otherwise the row moves to an appropriate failure state and returns a safe status.

Output Safety and Hard Guard are the only gates that can permit provisional text to leave the server. Ordinary chat quality checks may advise or repair before publication, but they cannot be a fail-closed production publication gate.

## 12. Relationship To Memory And Cold Path

P2 publication cannot synchronously depend on Memory, relationship, growth, action candidates or episode promotion. These may run only after `committed`, and failure cannot alter the already committed winner.

Deletion cascade still applies:

```text
delete Conversation message
  -> remove visible text
  -> clear linked publication draft/final content
  -> retain only content-free idempotency tombstone if needed
  -> invalidate derived projections asynchronously
```

## 13. Fault Injection Gate For Future P2 Implementation

The P2 implementation slice should pass these tests before any P3 work:

| Case | Expected result |
|---|---|
| duplicate client retry before generation | one User row, one Assistant publication row |
| duplicate retry during live stream | attaches/replays; no second winner |
| worker crash before first segment | expired lease takeover on same row |
| worker crash after provisional segment | safe draft replay or restart under same row |
| commit failure after provisional stream | no success response; row recoverable or terminal |
| output Safety rejects final | no commit; no final success |
| committed retry | exact final content returned, no provider call |
| deleted committed retry | `deleted` status, no body, no provider call |
| failed_retryable retry | same row, incremented attempt |
| failed_terminal retry | same failure category returned |

Exit gate: no second winner, no lost User row, no zombie `reserved/streaming` row after lease expiry, and no success when commit failed.

## 14. Frozen Product Defaults (PM-accepted 2026-08-16)

Product Manager accepted the P2 design and froze the following defaults. Delivery Lead must not reopen these without a new PM decision:

1. **Safety publication shape** — Safety-owned replies use the **same** Assistant publication row (`role=assistant`, same five states). No narrower Safety-only publication path in P2.
2. **Provisional client marking** — Provisional segments **must** be marked temporary / unconfirmed in the client until the row reaches `committed`.
3. **Maximum attempts** — `max attempt = 3`. Reaching the limit moves the same row to `failed_terminal` with `failureCode=max_attempt`.
4. **User-facing copy** — Short reconnect / takeover / terminal / deleted drafts are allowed; see Appendix A.
5. **Retention** — Content-free idempotency **tombstone = 30 days**. `draftContent` / `finalContent` retention follows the linked Conversation record (cleared on source deletion).

Implementation mount (this slice): Prisma model + migration, publication service, flagged eval/messages entry (`P2_PUBLICATION_ENABLED`, default off).

Still require a later PM-authorized slice:

- Controlled cohort expansion (still not full production traffic) — only after PM UI acceptance of true-model stream feel
- Deeper streaming Output Safety beyond Hard Guard
- Final polished client copy localization beyond Appendix A

Client provisional UI + real Qwen streaming (opt-in `/chat/p2-preview`, `op=generate_stream`): landed on `codex/p2-publication-impl`; see `docs/evals/P2_PUBLICATION_CLIENT_UI_GUIDE.md`. Safety depth: Hard Guard only until PM authorizes more.

## 15. Completion Statement

This design maps Hot/Cold V1 single-winner semantics into an implementation boundary for P2. It preserves current production V1 writer authority, keeps publication state separate from conversation lifecycle state, and leaves schema/API/runtime production mount for a separately authorized slice.

Isolation proof for the Publication Skeleton (no model):

```text
npx tsx scripts/p2-publication-skeleton-check.ts
```

Bypass mount (loopback UI / `--dry-check`, shared store, no production writers):

```text
npx tsx scripts/p2-bypass-publication-mount.ts --dry-check
# optional UI: npx tsx scripts/p2-bypass-publication-mount.ts --serve
```

See `docs/evals/P2_BYPASS_PUBLICATION_MOUNT_GUIDE.md`.

Exit gate evidence required: no second winner, no lost User row, no zombie `reserved/streaming` after lease takeover, and no success when commit failed. §13 fault cases must all PASS. Bypass mount must also show provisional→committed marking and same-row lease takeover.

## Appendix A — Short user copy draft (optional, non-binding polish)

| Situation | Draft copy (zh) |
|---|---|
| Reconnect / attach live stream | 连接恢复中，正在同步未确认回复… |
| Lease takeover after stall | 回复中断，正在重新接上（仍是同一条回复）… |
| Provisional marker | 临时内容，确认后才会保留 |
| Terminal failure | 这次回复没能完成，请稍后再试 |
| Deleted committed replay | 这条回复已被删除 |
