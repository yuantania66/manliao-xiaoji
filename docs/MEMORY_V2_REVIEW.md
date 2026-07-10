# Memory V2 Implementation Plan Review

Review target: `docs/MEMORY_V2_IMPLEMENTATION_PLAN.md`

Review scope:

- Object design: append-only, Evidence, Version, Understanding Continuity.
- Prisma schema draft: naming conflicts, unclear relations, migration risk.
- MVP pipeline: Chat/Note -> SemanticMemory/Timeline -> Response Injection.

This review only records required changes. It does not modify schema or service code.

## 1. Required Changes

### P0. RawMemory is not truly append-only

Location:

- `4.1 RawMemory`
- Prisma draft `model RawMemory`
- `9.2 Raw Memory`

Problem:

The document states `RawMemory` is append-only, but the schema includes mutable lifecycle state on the same row:

- `status RawMemoryStatus @default(ACTIVE)`
- no `updatedAt`, but services would still need to update `status` to `DELETED` or `REDACTED`
- deletion strategy says “Phase 1 使用 status=DELETED”

This violates PRD 11: “Raw Memory 永不修改，只允许追加.”

Required modification:

- Keep `RawMemory.content` and the RawMemory row immutable.
- Do not update `RawMemory.status`.
- Replace mutable lifecycle updates with an append-only lifecycle/audit object, for example:
  - `RawMemoryEvent(rawMemoryId, eventType=CREATED|DELETION_REQUESTED|REDACTED|EXPORT_REQUESTED, metadata, createdAt)`
  - or `DataRevocation(rawMemoryId, reason, createdAt, createdBy)`
- Retrieval and refinement must exclude revoked/deleted RawMemory by joining against the latest lifecycle event or revocation table, not by mutating RawMemory.
- If product deletion requires physical deletion later, the implementation plan must distinguish:
  - logical revocation event for pipeline correctness
  - physical deletion/anonymization for privacy compliance

Acceptance update:

- Add: “RawMemory rows are never updated after insert; deletion/redaction is represented by append-only lifecycle records.”

### P0. Evidence links are modeled as Json arrays, so Evidence is not enforceable

Location:

- `4.3 SemanticMemory`
- `4.4 Understanding`
- `4.5 TimelineEvent`
- `4.6 Relationship`
- Prisma draft fields:
  - `SemanticMemory.evidenceIds Json`
  - `Understanding.evidenceIds Json`
  - `TimelineEvent.evidenceIds Json`
  - `Relationship.evidenceIds Json`
  - `VersionHistory.evidenceIds Json?`

Problem:

The PRD requires all long-term understanding to bind Evidence. Json arrays cannot enforce referential integrity, cascade behavior, invalidation queries, or migration safety. This makes the core Evidence requirement optional in practice.

Concrete failure modes:

- A SemanticMemory can contain a nonexistent evidence ID.
- Evidence invalidation cannot efficiently find every dependent SemanticMemory/Timeline/Relationship/Understanding.
- Migration from `Fact -> Evidence -> SemanticMemory` cannot be verified with database constraints.
- Deleting or revoking user data cannot reliably identify all derived objects.

Required modification:

- Replace Json evidence lists with relation tables.
- Minimum acceptable design:

```prisma
model MemoryEvidenceLink {
  id         String @id @default(cuid())
  userId     String
  evidenceId String
  targetType EvidenceTargetType
  targetId   String
  role       EvidenceRole @default(SUPPORTING)
  createdAt  DateTime @default(now())

  @@index([userId, targetType, targetId])
  @@index([userId, evidenceId])
  @@unique([evidenceId, targetType, targetId, role])
}
```

- `EvidenceTargetType` should include `SEMANTIC_MEMORY`, `UNDERSTANDING`, `TIMELINE_EVENT`, `RELATIONSHIP`, `VERSION_HISTORY`, and future `REPORT` / `ASSESSMENT`.
- `EvidenceRole` should include at least `SUPPORTING`, `COUNTER`, `SOURCE`, `CORRECTION`.
- Keep denormalized Json only as optional cache, not source of truth.

Acceptance update:

- Add: “Every V2 long-term object must have at least one `MemoryEvidenceLink` before it is eligible for retrieval or response injection.”

### P0. VersionHistory snapshots do not guarantee rollback or no-overwrite semantics

Location:

- `4.7 VersionHistory`
- Prisma draft `model VersionHistory`
- `9.7 Understanding Continuity`

Problem:

The plan says “不存在覆盖，只有演进”, but V2 main objects still use mutable fields plus `updatedAt`:

- `SemanticMemory.content`, `confidence`, `status`, `version`
- `Understanding.understanding`, `confidence`, `status`
- `TimelineEvent.title`, `description`, `status`
- `Relationship.identityLabel`, `supportSignals`, `conflictSignals`

Mutable current-state rows are acceptable as a projection, but the document does not explicitly define that main objects are projections and VersionHistory is the immutable event log. Without that rule, implementation can silently update records without writing history.

Required modification:

- Define V2 long-term object rows as current projections.
- Define `VersionHistory` as append-only source of semantic history.
- Require all writes to SemanticMemory/Understanding/TimelineEvent/Relationship to occur through one service that:
  1. reads current projection
  2. appends `VersionHistory`
  3. updates projection
  4. links VersionHistory to Evidence
- Add database-level or service-level guardrails:
  - `version` increments by 1
  - `VersionHistory.version` must match resulting projection version
  - no projection update without VersionHistory in the same transaction

Schema risk:

- `VersionHistory.targetType + targetId` is polymorphic and has no FK. This is acceptable only if the plan explicitly states it is an audit/event table and must be validated in service tests.

Required schema addition:

- `VersionHistory` needs an `updatedAt` only if it can be corrected; otherwise it should remain append-only and omit `updatedAt`.
- Add `idempotencyKey` or `operationId` to avoid duplicate version rows on retry.

### P0. Prisma draft is incomplete because new User relations are missing

Location:

- Prisma draft models:
  - `RawMemory`
  - `Evidence`
  - `SemanticMemory`
  - `Understanding`
  - `TimelineEvent`
  - `Relationship`
  - `VersionHistory`
  - `RefinementJob`

Problem:

The draft adds `user User @relation(...)` fields on every new model, but does not update `model User` with inverse relation lists. The current schema style already declares inverse arrays for every user-owned model.

Required modification:

Add inverse relations to `User` in the schema draft:

```prisma
rawMemories      RawMemory[]
evidenceRecords  Evidence[]
semanticMemories SemanticMemory[]
understandings   Understanding[]
timelineEventsV2 TimelineEvent[]
relationships    Relationship[]
versionHistories VersionHistory[]
refinementJobs   RefinementJob[]
```

Migration risk:

- If this is pasted into `schema.prisma` without the inverse fields, Prisma validation may fail or produce inconsistent generated client ergonomics compared with the existing schema style.

### P0. Chat pipeline cannot deliver same-turn Response Injection from async refinement

Location:

- `6. Async Pipeline MVP`
- `6.1 RawMemory`
- `6.6 Retrieval`
- `6.7 Response Injection`

Problem:

The MVP pipeline is described as:

```text
RawMemory -> Segmentation -> Extraction -> Evidence -> SemanticMemory/Timeline -> Retrieval -> Response Injection
```

But `6.1` also requires “不阻塞用户收到回复.” These two requirements conflict for the current user message:

- If refinement is async and non-blocking, the same user message cannot reliably become SemanticMemory/Timeline before the same-turn response.
- Current response generation needs retrieval before assistant output.
- Therefore the MVP can only inject V2 memory from previous completed refinement jobs, not from the current just-created RawMemory.

Required modification:

Define two separate paths:

1. Same-turn response path:

```text
Current Message -> Safety -> Clinical Logic -> Retrieval(previous V2 + V1 fallback) -> Response Injection -> Generation
```

2. Async memory path:

```text
Persist ChatMessage/Note -> RawMemory -> RefinementJob -> Evidence -> SemanticMemory/Timeline/Understanding -> available for future retrieval
```

Required acceptance update:

- “A Chat/Note becomes available for Response Injection on a later turn after its RefinementJob succeeds.”
- “Same-turn response may use current message and recent chat context, but not as long-term memory.”

### P0. Note pipeline trigger is underspecified for current note flow

Location:

- `6.1 RawMemory`
- `8.2 Note`

Problem:

The plan says RawMemory is appended for `Note(isDraft=false)`, but current `Note` has:

- `isDraft`
- `generatedFromChatIds`
- `recordDate`
- `mediaUrls`
- `coreEventIds`
- `emotionSliceIds`

The implementation plan does not define which transitions create RawMemory:

- creating a non-draft note
- updating a draft to non-draft
- editing an already-saved note
- saving an AI-generated note from chat
- modifying `recordDate`, mood, or media

Because RawMemory is append-only, edits cannot overwrite prior raw note content. Without explicit rules, Note edits can either lose evidence or create duplicate evidence.

Required modification:

Define Note RawMemory events:

- `NOTE_CREATED`: first non-draft save.
- `NOTE_PUBLISHED_FROM_DRAFT`: draft becomes non-draft.
- `NOTE_EDITED`: saved note content changes; append a new RawMemory revision, do not mutate previous RawMemory.
- `NOTE_METADATA_UPDATED`: mood/date/media-only changes; append metadata RawMemory if those fields are used by refinement.

Required schema support:

- RawMemory needs `revisionOfRawMemoryId` or `sourceRevision` for edited notes.
- Evidence should point to the specific RawMemory revision used.

### P1. Relationship is Phase 1 schema but Phase 2 behavior, causing ambiguous MVP expectations

Location:

- `4.6 Relationship`
- `6.5 SemanticMemory / Timeline`
- `7. Phase Plan`

Problem:

The schema includes `Relationship` in Phase 1, but Phase 1 explicitly does not do “完整 Relationship 更新.” Response Injection says it prioritizes Relationship. This creates an MVP ambiguity:

- Is Relationship written in Phase 1 at all?
- If yes, what minimum fields are populated?
- If no, why is it required in Phase 1 schema and response injection priority?

Required modification:

Define Phase 1 Relationship minimum:

- create only when extraction has explicit people
- `displayName`
- `relationshipType=OTHER` unless relationship label is explicit
- `identityLabel` only when explicit
- `confidence <= 0.5` unless user explicitly names the relationship
- link to Evidence

Or move Relationship model creation and Response Injection priority to Phase 2.

Recommendation:

- Keep the table in Phase 1 only if it is needed for migration and evidence linking.
- Do not include Relationship in Phase 1 Response Injection unless `confidence >= threshold` and evidence count meets minimum.

### P1. TimelineEvent criteria are too vague to run deterministically

Location:

- `4.5 TimelineEvent`
- `6.5 SemanticMemory / Timeline`
- `9.5 Timeline`

Problem:

The plan says TimelineEvent writes “重要事件或明确持续事件”, but does not define a decision rule. Current extraction returns `facts`, `experiences`, and `topics`, but no `importanceScore`, no duration certainty, and no explicit timeline eligibility.

Required modification:

Add deterministic Phase 1 eligibility:

- Create TimelineEvent only when one of these is true:
  - fact has explicit `occurredAt` and people/topics/emotion
  - fact confidence >= 0.7 and topic is one of work/family/relationship/health/recovery
  - message indicates duration or continuing status
  - note is manually saved and user-selected as important in future UI
- Otherwise write `SemanticMemory` or `Understanding`, not TimelineEvent.

Required extraction update in plan:

- Add `timelineCandidate: boolean`
- Add `importanceScore`
- Add `durationText` or `ongoingStatus`

Without this, Chat/Note -> Timeline cannot be reliably tested.

### P1. SemanticMemory write rules can incorrectly turn topics into long-term knowledge

Location:

- `6.5 SemanticMemory / Timeline`
- `8.3 Fact`

Problem:

The plan says `Fact.topics` can generate `SemanticMemory(kind=TOPIC)`. That risks turning a one-time topic into long-term knowledge. PRD explicitly says not to solidify one expression into a user profile.

Required modification:

Define thresholds:

- Single-event topics should remain Evidence or `StructuredMemoryItem`, not `SemanticMemory`.
- Create `SemanticMemory(kind=TOPIC)` only after repeated evidence or explicit user confirmation.
- For a single message, only `IMPORTANT_EVENT` or `COPING_METHOD` may be created if evidence is explicit and confidence high.
- Otherwise create `Understanding(status=OPEN|PAUSED)` with low confidence.

Acceptance update:

- Test: one casual mention of “工作” must not create stable `SemanticMemory(kind=TOPIC)` unless repeated or explicit.

### P1. RefinementJob lacks job dependency and idempotency controls

Location:

- `4.8 RefinementJob`
- Prisma draft `model RefinementJob`
- `6.2 Segmentation`

Problem:

The job model has `rawMemoryId`, `step`, and `status`, but no dependency model. Steps are meant to run independently, yet output of one step feeds the next. There is no way to reliably know:

- which extraction job belongs to which segmentation output
- whether an Evidence job already processed an extraction output
- whether retry should reuse or replace previous output
- whether duplicate jobs were created for the same rawMemory/step/pipelineVersion

Required modification:

Add:

- `parentJobId String?`
- `operationId String` or `idempotencyKey String`
- unique constraint:

```prisma
@@unique([rawMemoryId, pipelineVersion, step, segmentKey, operationId])
```

If `segmentKey` is nullable, do not include it in a uniqueness rule that relies on null behavior. Use a non-null default such as `segmentKey = rawMemoryId` for Phase 1.

Required pipeline rule:

- Each step must read from its parent job outputSnapshot, not by guessing the previous step from `rawMemoryId`.

### P1. Current extraction service output does not match V2 object needs

Location:

- `6.3 Extraction`
- `services/understanding/understandingTypes.ts`

Problem:

Current `UnderstandingExtraction` supports:

- facts
- experiences
- interpretations
- people
- topics
- occurredAt

V2 objects need additional fields:

- Evidence type/source role
- timeline eligibility
- relationship label
- explicitness vs inference
- support/counter evidence role
- extraction provenance: model vs fallback
- segment ID

Required modification:

The implementation plan must define a V2 extraction DTO separate from or extending `UnderstandingExtraction`:

```ts
type MemoryV2Extraction = {
  segmentKey: string;
  provenance: "model" | "fallback";
  facts: Array<ExtractedFact & {
    explicitness: "explicit" | "inferred";
    timelineCandidate: boolean;
    importanceScore?: number;
  }>;
  people: Array<{
    name: string;
    relationshipLabel?: string;
    explicitness: "explicit" | "inferred";
    confidence: number;
  }>;
  evidenceCandidates: Array<{
    text: string;
    role: "fact" | "experience" | "interpretation";
    confidence: number;
    weight: number;
  }>;
}
```

Without this, the MVP writer has to infer too much from loose text arrays and will not be auditable.

### P1. Retrieval compatibility is stated but not designed

Location:

- `6.6 Retrieval`
- `7. Phase Plan`
- `8. Migration Strategy`

Problem:

The plan says Retrieval should prioritize V2 and fallback to V1, but does not define:

- ordering between V2 and V1 items
- deduplication between migrated V1 Fact and new V2 SemanticMemory generated from the same evidence
- mapping from V2 objects to existing `StructuredMemoryItem`
- how `activeHypotheses` maps from `Understanding`
- whether `Relationship` appears in `recentMemories`, `similarMemories`, or a new field

Required modification:

Define a compatibility adapter:

```ts
buildStructuredRagContextV2({
  v2: { semanticMemories, timelineEvents, understandings, relationships },
  v1Fallback: { facts, experiences, events, hypotheses },
}): StructuredRagContext
```

Mapping rules:

- `SemanticMemory -> StructuredMemoryItem(kind="hypothesis" | "fact")` is not enough; add new kinds or extend existing type.
- `TimelineEvent -> coreEvents/recentMemories`.
- `Understanding(status=OPEN|DEEPENING) -> activeHypotheses`.
- `Relationship -> similarMemories` only when matched by people intent and confidence threshold.
- Deduplicate by Evidence rawMemoryId/sourceId.

Acceptance update:

- Add a test where one historical Fact has already been migrated to SemanticMemory and retrieval returns only one memory item.

### P1. Prisma `Evidence.sourceKind/sourceId` is too broad without source-specific constraints

Location:

- Prisma draft `model Evidence`

Problem:

`Evidence.sourceKind` includes derived objects (`TIMELINE_EVENT`, `RELATIONSHIP`, `SEMANTIC_MEMORY`, `UNDERSTANDING`) and has a free `sourceId`. This is a polymorphic relation without constraints. It can work, but the plan must specify source rules:

- Raw evidence from user text should be `RAW_MEMORY`.
- Derived evidence from Timeline/Relationship should not become circular support for itself.
- An Understanding should not cite Evidence whose source is the same Understanding as its only evidence.

Required modification:

Add source validity rules:

- Phase 1 only creates `Evidence(sourceKind=RAW_MEMORY)`.
- Phase 2 may create derived Evidence, but must prevent cycles.
- Every non-RAW evidence must trace transitively to at least one RawMemory Evidence.

### P1. Deletion and invalidation behavior cannot be implemented with current relations

Location:

- `25. Privacy`
- `9.10 Privacy and Governance`

Problem:

The plan says RawMemory deletion invalidates Evidence and related long-term understanding. But with Json `evidenceIds`, invalidation requires scanning all long-term rows and parsing JSON. That is fragile and slow.

Required modification:

- This depends on P0 `MemoryEvidenceLink`.
- Add a specific invalidation flow:

```text
RawMemory revocation event
  -> Evidence.status=INVALIDATED where rawMemoryId=...
  -> find MemoryEvidenceLink by evidenceId
  -> mark target object WEAKENED / ARCHIVED or enqueue RefinementJob(INDEX/UNDERSTANDING)
  -> append VersionHistory for every affected target
```

Acceptance update:

- Deleting/revoking one ChatMessage must invalidate all Evidence produced from its RawMemory and write VersionHistory for affected V2 long-term objects.

### P2. Naming risks and consistency issues

Location:

- Prisma draft enums and models.

Issues:

- `LongTermObjectStatus` is generic but only used by `SemanticMemory`; rename to `SemanticMemoryStatus` or reuse a clearly documented shared status enum.
- `TimelineEventEndStatus` and `TimelineEventStatus` both contain `ACTIVE/ENDED/UNCLEAR`, creating ambiguous semantics. `endStatus` should be `ONGOING|ENDED|UNKNOWN`, while lifecycle `status` should be `ACTIVE|USER_CORRECTED|ARCHIVED|MERGED`.
- `RawMemorySourceType.NOTE` and `RawMemoryKind.NOTE` are not conflicting technically, but their distinction should be documented: kind describes memory content class; sourceType describes source table.
- `Relationship` as a model name is acceptable, but if future Prisma client naming becomes awkward, prefer `UserRelationship`.
- `VersionCreatedBy.ADMIN` introduces an actor class not described elsewhere in the PRD. If admin access is not part of Phase 1, use `SYSTEM|USER` only.

Required modification:

- Rename or document these before schema implementation to avoid churn in migrations.

## 2. Pipeline Walkthrough Review

### Current Chat path

Required Phase 1 runnable path should be:

```text
POST user message
  -> create ChatMessage
  -> append RawMemory(sourceType=CHAT_MESSAGE)
  -> enqueue RefinementJob(SEGMENTATION)
  -> build response using current message + previous completed V2/V1 memory
  -> async runner completes extraction/evidence/memory writes
  -> next turn retrieval can inject new SemanticMemory/Timeline/Understanding
```

Current plan gap:

- It implies the just-created RawMemory can flow all the way to Response Injection in the same pipeline, while also saying refinement must not block the reply.

Must modify:

- Document same-turn vs future-turn separation.

### Current Note path

Required Phase 1 runnable path should be:

```text
Save non-draft Note
  -> append RawMemory(sourceType=NOTE)
  -> enqueue RefinementJob(SEGMENTATION)
  -> async runner completes extraction/evidence/memory writes
  -> later chat retrieval can inject resulting memory
```

Current plan gap:

- Note edit/version behavior is not defined.
- `recordDate` vs `createdAt` vs `occurredAt` needs a rule.

Must modify:

- Define RawMemory revision behavior for Note edits.
- Define `occurredAt = recordDate at local day start` or a timezone-aware timestamp rule.

### SemanticMemory/Timeline write path

Required Phase 1 runnable path should be:

```text
Extraction output
  -> Evidence candidates
  -> MemoryEvidenceLink
  -> if repeated/explicit stable knowledge: SemanticMemory
  -> if important life event: TimelineEvent
  -> if uncertain/open: Understanding
  -> VersionHistory for each projection write
```

Current plan gap:

- It allows `Fact.topics -> SemanticMemory(TOPIC)` too easily.
- It lacks deterministic TimelineEvent eligibility.
- It does not define V2 extraction fields needed by writers.

Must modify:

- Add thresholds and DTO extensions before implementation.

### Response Injection path

Required Phase 1 runnable path should be:

```text
Current message extraction intent
  -> retrieve V2 objects by people/topics/emotions/status
  -> fallback to V1 facts/experiences/events/hypotheses
  -> dedupe by Evidence/RawMemory source
  -> adapt to StructuredRagContext
  -> promptBuilder injects understandingContext
```

Current plan gap:

- V2-to-`StructuredRagContext` mapping is unspecified.
- Deduplication with migrated V1 rows is unspecified.

Must modify:

- Add adapter and dedupe rules.

## 3. Schema Migration Risk Review

### High risk: relation arrays omitted from User

Must add inverse fields to `User` in the draft before implementation.

### High risk: Json evidence links

Must replace source-of-truth evidence Json arrays with relation rows.

### High risk: duplicate RawMemory on retries or migration reruns

Current draft only indexes `[userId, sourceType, sourceId]`; it does not prevent duplicates.

Required modification:

- For immutable source records, add uniqueness:

```prisma
@@unique([userId, sourceType, sourceId, messageSequence])
```

- This does not work for Note edits unless revisions are modeled. For notes, use:

```prisma
sourceRevision Int @default(1)
@@unique([userId, sourceType, sourceId, sourceRevision])
```

### Medium risk: existing `Event` vs new `TimelineEvent`

No direct naming conflict, but migration scripts must avoid mixing:

- old `Event.status` means `ACTIVE|ENDED|UNCLEAR`
- new `TimelineEvent.status` mixes lifecycle and event state
- new `TimelineEvent.endStatus` overlaps with lifecycle status

Required modification:

- Clarify status semantics before migration.

### Medium risk: polymorphic target IDs

`VersionHistory.targetId`, `Evidence.sourceId`, and proposed `MemoryEvidenceLink.targetId` are polymorphic. This is acceptable for an audit/memory system only if:

- every write happens through typed service functions
- tests validate target existence
- export/delete jobs resolve target IDs by `targetType`

The plan must explicitly require these service-level validations.

## 4. Final Required Patch List for the Plan

Before implementation, `docs/MEMORY_V2_IMPLEMENTATION_PLAN.md` should be revised to include:

1. RawMemory immutability via append-only lifecycle events, not mutable status.
2. `MemoryEvidenceLink` or equivalent relation table; Json evidence arrays cannot be source of truth.
3. Explicit projection/event-log rule for VersionHistory and V2 object updates.
4. `User` inverse relation fields for every new Prisma model.
5. Same-turn response path separated from async memory refinement path.
6. Note revision rules for draft publish, saved edits, metadata changes, and AI-generated notes.
7. Deterministic TimelineEvent eligibility rules and extraction fields.
8. Thresholds preventing one-off topics from becoming stable SemanticMemory.
9. RefinementJob parent/dependency/idempotency design.
10. V2 extraction DTO or extension of current `UnderstandingExtraction`.
11. V2 retrieval adapter into existing `StructuredRagContext`.
12. V1/V2 dedupe rules based on Evidence/RawMemory.
13. Evidence invalidation flow from RawMemory revocation to affected long-term objects.
14. Naming cleanup for status enums and actor enums.

## 5. Review Conclusion

The plan is directionally aligned with the PRD, but it is not ready for schema implementation.

The blocking issues are:

- RawMemory append-only is contradicted by mutable deletion status.
- Evidence is not enforceable because long-term objects store evidence links as Json.
- VersionHistory is not strong enough to guarantee no-overwrite semantics.
- The async MVP pipeline cannot provide same-turn Response Injection from current RawMemory.
- Retrieval compatibility from V2 to current `StructuredRagContext` is underspecified.

These must be fixed in the document before creating the Prisma migration or writing Memory V2 services.

