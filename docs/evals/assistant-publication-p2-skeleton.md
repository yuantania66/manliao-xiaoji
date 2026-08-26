# Assistant Publication P2 Winner Skeleton

Status: local/database skeleton only. No production route, model, Safety, Memory, event, Guest, streaming UI, deployment or rollout integration.

Authority: `docs/HOT_COLD_PATH_V1_CONTRACT.md` §5 and §12. Baseline: `f6268ab`.

## Frozen ownership

`services/chat/assistantPublicationService.ts` is the sole P2 publication-state owner. `ChatMessage` remains the authoritative Conversation Log and receives an Assistant row only in the final publication transaction. `AiGeneration`, execution phases, Interaction Move envelopes and `opens / fulfills / supersedes` are not publication state.

The durable identity is `unique(sessionId, clientTurnId)`. Every public service entry also requires the authentication-derived `userId` and exact `sessionId`; the database binds `(sessionId, userId)` to the owned `ChatSession`. Ingress writes or verifies the User `ChatMessage` and reserves that one publication in the same serializable transaction. The existing unique `ChatMessage.replyToMessageId` remains the final database backstop against a second committed Assistant winner.

## Five persisted states

```text
reserved | streaming | committed | failed_retryable | failed_terminal
```

Lease expiry is derived from `leaseExpiresAt`; it is not a state. A mutation fence is `(publicationId, leaseOwner, attempt)`. Lease acquisition re-reads tenant-owned state and retries a failed CAS at most six times, then fails with `lease_concurrency_exhausted`. Draft append additionally requires `(expectedDraftVersion, expectedDraftHash)`. A takeover after expiry or retryable failure keeps the publication id, increments `attempt`, invalidates the prior draft and returns to `reserved`.

Allowed transitions:

```text
new -> reserved
reserved -> streaming | committed | failed_retryable | failed_terminal
streaming -> streaming | committed | failed_retryable | failed_terminal
failed_retryable -> reserved
committed -> committed replay only
failed_terminal -> failed_terminal replay only
```

`commitAssistantPublication` creates the Assistant message, promotes the same publication and updates the session preview in one transaction. A lost HTTP response after this transaction is represented by the local fault point `after_commit`; retry returns the exact stored winner and never regenerates. A committed request with different final content fails closed.

## Frozen degradation and fault evidence

The local PostgreSQL check covers:

- concurrent identical reservation converging to one User row and one publication;
- conflicting content under the same turn identity;
- rollback after User write and after reservation write;
- live-lease attach and expired-lease takeover;
- stale owner/attempt rejection;
- idempotent safe-draft append and draft-version conflict;
- retryable failure reacquisition and immutable terminal failure replay;
- rollback after Assistant creation but before publication commit;
- concurrent final commit converging to one Assistant winner;
- committed response loss replay and conflicting final payload rejection.
- cross-user and cross-session reservation, replay and mutation rejection;
- deletion of either linked Conversation message atomically clearing draft/final content while retaining a content-free no-regeneration identity;
- database-enforced low-cardinality failure codes and User/Session cascade behavior.

The check uses synthetic fixture content in an isolated local database and calls no Qwen provider.

## Authorized deletion boundary

Authorization `48217` §2/§4/§7 explicitly permits the isolated P2 schema/migration and local P5 deletion-cascade instrumentation. The migration therefore installs one local database trigger: deleting either linked User or committed Assistant `ChatMessage` clears `draftContent` and `finalContent`, records `contentDeletedAt`, removes the live lease and lets the foreign keys detach the deleted message. The five-state enum is unchanged. Replay returns `deleted` without a body, every mutation fails closed, and a repeated turn cannot create a second publication identity.

This trigger is part of the isolated candidate only. It does not integrate a production deletion worker, retention scheduler, UI route or production database.

## Explicit remaining boundary

P2 does not emit provisional UI, classify content Safety, generate text, publish event edges or replace the current production writer. P3 may append only complete output-Safety-accepted segments. P5 still owns retention schedules, immediate visibility filtering, asynchronous index/Memory invalidation and 60-second/24-hour cascade SLAs; this P2 slice owns only the publication-content tombstone invariant required to prevent orphaned plaintext.
