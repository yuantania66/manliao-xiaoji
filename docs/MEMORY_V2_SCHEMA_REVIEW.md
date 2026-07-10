# Memory V2 Schema Review

Review target: `prisma/schema.prisma`

Scope:

- Correctness and migration risk only.
- No service-code or pipeline review.
- Existing V1 models are assumed to remain in place.

Validation status:

- `npx prisma validate` passes.
- Passing validation means Prisma accepts the model graph. It does not guarantee append-only semantics, no-overwrite writes, or safe user deletion behavior.

## 1. Findings

### P0. User deletion will be blocked by V2 `onDelete: Restrict`

Location:

- `RawMemory.user`
- `RawMemoryEvent.user`
- `Evidence.user`
- `MemoryEvidenceLink.user`
- V2 projection/version models
- `RefinementJob.user`

Issue:

Most V2 models reference `User` with `onDelete: Restrict`. This is aligned with “do not silently delete RawMemory,” but it changes current product deletion behavior. Existing V1 models mostly use `onDelete: Cascade`, so account deletion or cleanup flows that currently rely on cascading deletes will fail once V2 rows exist.

Risk:

- User account deletion can fail at the database layer.
- Privacy flows may become inconsistent: V1 data may be deleted while V2 raw/memory data remains and blocks the transaction.
- This is especially important because the PRD requires delete/export/revoke rights.

Required before migration:

- Define an explicit account deletion flow for V2:
  - append `RawMemoryEvent(TOMBSTONED|REDACTED)` for relevant raw records
  - invalidate Evidence
  - archive/weaken V2 projections
  - then either retain non-plaintext audit rows or perform a controlled physical deletion/anonymization
- Do not rely on existing `User` cascade behavior once these tables are live.

### P0. Current-version pointer model is valid, but creates a required two-step write path

Location:

- `SemanticMemory.currentVersionId -> SemanticMemoryVersion`
- `Understanding.currentVersionId -> UnderstandingVersion`
- `TimelineEvent.currentVersionId -> TimelineEventVersion`
- `Relationship.currentVersionId -> RelationshipVersion`
- each Version model also has required FK back to its parent projection

Assessment:

This does not create a Prisma validation cycle because `currentVersionId` is optional and the version-to-parent FK is required. The schema can be migrated and Prisma accepts it.

Operational constraint:

Creation must happen in this order:

1. Create projection row with `currentVersionId = null`.
2. Create version row referencing the projection.
3. Update projection `currentVersionId` and `currentVersion`.

Risk:

- If service code tries to create projection and current version in one nested create, it may hit cyclic write limitations.
- If step 3 fails, projection exists without a current-version pointer.
- The database does not guarantee that `currentVersion` equals `currentVersionRecord.version`.
- The database does not guarantee that `currentVersionRecord` belongs to the same parent projection unless service code enforces it.

Required before services:

- All projection/version writes must be wrapped in one transaction.
- Add tests that assert:
  - projection has a current version after creation
  - `projection.currentVersion == currentVersionRecord.version`
  - `currentVersionRecord.<parentId> == projection.id`
  - `currentVersionRecord.userId == projection.userId`

### P1. Version tables are structurally no-overwrite, but schema cannot prevent updates

Location:

- `SemanticMemoryVersion`
- `UnderstandingVersion`
- `TimelineEventVersion`
- `RelationshipVersion`
- `VersionHistory`

What works:

- No `updatedAt` field on version rows.
- `@@unique([parentId, version])` prevents duplicate version numbers per parent.
- `operationId @unique` supports idempotent retries.
- Version rows store full snapshots.

Remaining risk:

- Prisma schema cannot prevent `update` or `delete` calls against version tables.
- Projection rows are mutable by design, so no-overwrite depends on write discipline.
- `VersionHistory` is generic and independent from typed version tables; it can drift unless both are written in the same transaction.

Required before services:

- Create version rows only through a dedicated versioning write API.
- Never update/delete version rows in service code.
- Projection updates must be transactionally coupled with:
  - typed version row creation
  - generic `VersionHistory` creation, if retained
  - `MemoryEvidenceLink` for the version/history row when evidence is involved

Optional schema hardening:

- Add a small `versionCreatedAt` naming convention or comments in future migration docs, but the current schema is acceptable for a first pass.

### P1. `VersionHistory` duplicates typed version tables and may drift

Location:

- `VersionHistory`
- typed version tables

Issue:

The schema now has both generic `VersionHistory` and typed version tables. This is workable, but the relationship between them is not modeled.

Risk:

- A `SemanticMemoryVersion` can exist without a corresponding `VersionHistory`.
- A `VersionHistory` can point to a target/version that does not exist.
- `operationId` can link records conceptually, but there is no schema relation.

Required decision:

- Treat typed version tables as the source of truth for no-overwrite state.
- Treat `VersionHistory` as cross-object audit/index.
- Require same `operationId` across the typed version row and `VersionHistory` row created in the same write operation.

### P1. RawMemory append-only is modeled, but not enforceable at DB level

Location:

- `RawMemory`
- `RawMemoryEvent`

What works:

- `RawMemory` has no `updatedAt`.
- `RawMemory` has no mutable `status`.
- tombstone/redaction is represented by `RawMemoryEvent`.
- `sourceRevision` supports Note edits.
- `onDelete: Restrict` prevents accidental cascade deletion.

Remaining risk:

- Prisma can still update or delete RawMemory rows unless service policy prevents it.
- `RawMemoryEvent(CREATED)` is not enforced by schema.
- `appendOnlyHash` is optional, so integrity checking is not guaranteed.
- `RawMemoryEvent` itself has no hash or chain pointer.

Required before services:

- Only create RawMemory through a single append API.
- On every RawMemory insert, create a `RawMemoryEvent(CREATED)` in the same transaction.
- Do not implement RawMemory update/delete service methods.
- Treat `appendOnlyHash` as required at service level or make it required in a future migration once hashing is implemented.

### P1. Tombstone/redaction can be represented, but visible-state lookup needs an index

Location:

- `RawMemoryEvent`

Current indexes:

- `[userId, rawMemoryId, createdAt]`
- `[userId, eventType]`

Issue:

To determine current visibility, services need the latest event per raw memory. The existing `[userId, rawMemoryId, createdAt]` index is usable, but common queries will likely filter by `rawMemoryId` alone after joining from Evidence.

Migration risk:

- At small scale this is fine.
- At larger scale, Evidence invalidation or retrieval may do many per-record latest-event lookups.

Recommended index before scale:

- `@@index([rawMemoryId, createdAt])`
- optionally `@@index([rawMemoryId, eventType, createdAt])`

This is not blocking for first migration, but should be planned before production volume.

### P1. Evidence link supports unified references, but target integrity is service-enforced only

Location:

- `Evidence`
- `MemoryEvidenceLink`
- `EvidenceTargetType`

What works:

- Evidence is a first-class object.
- Long-term objects can all be linked through `MemoryEvidenceLink`.
- `role` supports supporting/counter/source/correction evidence.
- `@@unique([evidenceId, targetType, targetId, role])` prevents duplicate same-role links.

Remaining risk:

- `targetId` is polymorphic; there are no FKs to `SemanticMemory`, `Understanding`, `TimelineEvent`, `Relationship`, or version tables.
- Database cannot prevent links to nonexistent targets.
- Database cannot prevent target/user mismatch.
- Database cannot cascade or restrict target deletes through `MemoryEvidenceLink`.

Required before services:

- All Evidence links must be created by typed helper functions:
  - `linkEvidenceToSemanticMemory`
  - `linkEvidenceToUnderstanding`
  - `linkEvidenceToTimelineEvent`
  - `linkEvidenceToRelationship`
- Each helper must verify target existence and matching `userId`.
- Deletion/invalidation must resolve by `targetType`.

Assessment:

This is acceptable for a polymorphic evidence system, but it is not DB-enforced correctness.

### P1. Evidence source semantics are ambiguous for migrated V1 records

Location:

- `Evidence.sourceKind`
- `Evidence.sourceId`
- `Evidence.rawMemoryId`

Issue:

`EvidenceSourceKind` does not include V1 types such as `FACT`, `EVENT`, `NOTE`, or `HYPOTHESIS`. That matches the plan if every V1 object can be mapped back to RawMemory first. Some historical V1 rows may not have a clean RawMemory source after backfill.

Risk:

- Migration scripts may be forced to create `Evidence(sourceKind=RAW_MEMORY)` without a valid `rawMemoryId`, or use `sourceId` inconsistently.
- Evidence created from old `Fact`/`Event` rows may not be traceable enough for the PRD.

Required migration rule:

- Backfill RawMemory for historical `ChatMessage` and `Note` before migrating `Fact`, `ExperienceSlice`, `Hypothesis`, `Event`, or `EmotionSlice`.
- Only create V2 Evidence from a V1 object when it can resolve to a RawMemory revision.
- If a V1 row cannot resolve to RawMemory, mark it as legacy fallback and do not promote it into V2 Evidence.

### P1. Retrieval indexes are mostly adequate for MVP, but several hot queries need composite indexes

Current useful indexes:

- `SemanticMemory`: `[userId, kind]`, `[userId, status]`, `[userId, lastUpdatedAt]`
- `Understanding`: `[userId, status]`, `[userId, category]`, `[userId, lastTouchedAt]`
- `TimelineEvent`: `[userId, startDate]`, `[userId, status]`, `[userId, importanceScore]`
- `Relationship`: `[userId, displayName]`, `[userId, relationshipType]`, `[userId, status]`
- `Evidence`: `[userId, rawMemoryId]`, `[userId, status]`, `[userId, occurredAt]`
- `MemoryEvidenceLink`: `[userId, targetType, targetId]`, `[userId, evidenceId]`

Gaps:

- Recent active semantic memories: needs `[userId, status, lastUpdatedAt]`.
- Active/open understandings by recency: needs `[userId, status, lastTouchedAt]`.
- Core timeline retrieval: needs `[userId, status, importanceScore]` or `[userId, status, startDate]`.
- Relationship retrieval by person name/status: needs `[userId, displayName, status]`.
- Refinement job workers: may need `[status, createdAt]` or `[step, status, createdAt]` for polling queues.

Recommendation:

- Not blocking for schema validation.
- Add these before implementing retrieval/worker production paths.

### P1. `RawMemory` lacks direct nullable relations to ChatMessage/Note

Location:

- `RawMemory.sourceType`
- `RawMemory.sourceId`

Assessment:

Using polymorphic `sourceType/sourceId` is consistent with the plan and keeps `RawMemory` unified. It also avoids adding multiple nullable FKs.

Migration risk:

- DB cannot enforce that a `CHAT_MESSAGE` sourceId exists in `ChatMessage`.
- DB cannot enforce that a `NOTE` sourceId exists in `Note`.

Required migration rule:

- Backfill scripts must validate source existence.
- Add unique source revision checks already present:
  - `@@unique([userId, sourceType, sourceId, sourceRevision])`

This is acceptable for first pass.

### P1. `sourceRevision` supports Note edits but not concurrent revision allocation

Location:

- `RawMemory.sourceRevision`
- `@@unique([userId, sourceType, sourceId, sourceRevision])`

What works:

- The unique constraint prevents duplicate revisions.

Risk:

- Concurrent Note edits could race when calculating next revision number.

Required before services:

- Allocate `sourceRevision` in a transaction.
- On unique conflict, retry by reading max revision again.

### P2. Timeline relationship fields are still Json and service-enforced

Location:

- `TimelineEvent.people`
- `TimelineEvent.emotions`
- `TimelineEvent.topics`
- `TimelineEvent.conversationIds`
- `Relationship.relatedTimelineEventIds`
- `Relationship.relatedSemanticMemoryIds`

Assessment:

This is acceptable for first schema pass because Evidence is relational and these fields are denormalized descriptors.

Risk:

- Filtering by people/topics/emotions inside Json will not be efficient.
- Relationship-to-timeline references are not FK-enforced.

Recommendation:

- Keep for MVP.
- Add normalized association tables only when retrieval requirements are clearer.

### P2. Enum naming is mostly safe, but `UnderstandingStatus` overlaps conceptually with existing V1 terminology

Location:

- `UnderstandingStatus`
- existing `UnderstandingSourceType`
- existing `UnderstandingGraphNodeType`

Assessment:

No Prisma naming conflict exists. The names are acceptable.

Risk:

- Developer confusion is possible because V1 already has `UnderstandingSourceType` and `UnderstandingGraph*`.

Recommendation:

- Use explicit imports in service code later.
- Consider comments in schema or service names such as `memoryV2Understanding`.

### P2. Cascade behavior is intentionally conservative but inconsistent with existing V1 tables

Location:

- V1 models mostly `onDelete: Cascade`
- V2 models mostly `onDelete: Restrict`

Assessment:

This is defensible for append-only and audit-heavy data. It is also a migration risk because existing cleanup paths may assume cascading user deletion.

Recommendation:

- Document that V2 deletion is not ordinary cascade deletion.
- Add a dedicated deletion/anonymization script before enabling account deletion with V2 rows.

## 2. Checklist Answers

### 1. currentVersion / currentVersionId relation

Status: acceptable with service constraints.

- No Prisma cycle error.
- Optional `currentVersionId` makes insertion possible.
- Requires two-step transactional write.
- Needs service tests to ensure pointer/version consistency.

### 2. Version tables no-overwrite

Status: structurally good, not DB-enforced against updates.

- Unique parent/version constraints are correct.
- No `updatedAt` on version rows is good.
- Services must never update/delete version rows.
- `VersionHistory` can drift from typed version tables unless transactionally coupled.

### 3. RawMemory / RawMemoryEvent append-only

Status: modeled correctly, enforcement is service-level.

- RawMemory has no mutable status.
- tombstone/redaction is represented by RawMemoryEvent.
- Restrict deletes reduce accidental loss.
- User deletion flow must be redesigned because Restrict will block cascade deletion.

### 4. Evidence / MemoryEvidenceLink unified references

Status: flexible and consistent with the plan.

- Supports all V2 objects and version objects through `EvidenceTargetType`.
- Polymorphic target IDs mean integrity is not DB-enforced.
- Typed helper functions are required.

### 5. Index support

Status: enough for first migration, not enough for efficient production retrieval.

Add before retrieval/worker rollout:

- `SemanticMemory`: `[userId, status, lastUpdatedAt]`
- `Understanding`: `[userId, status, lastTouchedAt]`
- `TimelineEvent`: `[userId, status, importanceScore]`, `[userId, status, startDate]`
- `Relationship`: `[userId, displayName, status]`
- `RefinementJob`: `[status, createdAt]`, `[step, status, createdAt]`
- `RawMemoryEvent`: `[rawMemoryId, createdAt]`

### 6. Enum / relation / cascade risk

Status: no immediate Prisma conflicts.

Risks:

- Restrict behavior blocks account deletion.
- Polymorphic source/target IDs require service validation.
- Generic `VersionHistory` may drift.
- `Understanding*` naming may confuse V1/V2 imports.

### 7. Migration from existing ChatMessage / Note / Fact / Event

Status: feasible with ordering constraints.

Required order:

1. Backfill RawMemory for `ChatMessage`.
2. Backfill RawMemory for non-draft `Note`.
3. Add `RawMemoryEvent(CREATED)` for every backfilled RawMemory.
4. Migrate `Fact` / `ExperienceSlice` only when they resolve to RawMemory.
5. Migrate `Hypothesis` to `Understanding` only after supporting/counter evidence maps to Evidence.
6. Migrate important/core `Event` to `TimelineEvent` only when source evidence resolves.
7. Keep unresolved V1 rows as fallback, not V2 truth.

## 3. Conclusion

The first-round Memory V2 schema is a valid Prisma schema and matches the intended architecture at a high level.

The highest migration risks are:

- V2 `Restrict` relations will break any current user deletion flow that expects cascades.
- current-version pointers require strict transactional creation/update.
- no-overwrite is represented structurally but still depends on service discipline.
- polymorphic Evidence links require typed validation helpers.
- retrieval indexes need strengthening before production retrieval.

Do not run a production migration until the V2 deletion/anonymization flow and typed version/evidence write helpers are designed.

