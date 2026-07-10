# Projection Pipeline Architecture

## 1. Purpose

Projection Pipeline 是 Memory V2 Phase 2 的前置工程设计。

它用于把已经形成的 `Evidence` 投影为长期记忆对象：

- `SemanticMemory`
- `TimelineEvent`
- `Understanding`
- `Relationship`

Projection Pipeline 不新增新的架构层。它是现有 Memory V2 async refinement pipeline 中 `Evidence -> V2 long-term objects` 这一段的工程契约。

Phase 1 已验收的闭环为：

```text
Chat / Note
  -> RawMemory
  -> RefinementJob
  -> Segmentation
  -> Evidence
  -> SemanticMemoryVersion
  -> V2 Retrieval
  -> Response Context behind feature flag
```

Phase 2 的 Projection Pipeline 在此基础上扩展：

```text
Evidence
  -> Projection Dispatcher
  -> SemanticMemory Projection
  -> Timeline Projection
  -> Understanding Projection
  -> Relationship Projection
  -> Version rows
  -> currentVersion pointers
  -> MemoryEvidenceLink
```

## 2. Non-Negotiable Rules

### 2.1 Evidence Is The Only Projection Input

Projection 的唯一输入是 `Evidence`。

`RawMemory` 不直接写：

- `TimelineEvent`
- `Understanding`
- `Relationship`
- `SemanticMemory`

Allowed path:

```text
RawMemory
  -> Evidence
  -> Projection
  -> Long-term object + Version
```

Disallowed path:

```text
RawMemory
  -> TimelineEvent / Understanding / Relationship
```

Reason:

- PRD 要求所有长期理解必须绑定 Evidence。
- Evidence 是 traceable、auditable、invalidatable 的主入口。
- RawMemory 是未经解释的数据，不能直接成为长期理解。

### 2.2 Projection Does Not Create Raw Evidence From Nothing

Projection 不能绕过 Evidence 生成长期对象。

If an extraction result cannot be represented as Evidence, it cannot be projected.

### 2.3 No Overwrite

Projection 不能覆盖历史版本。

Every meaning-changing projection must create a new version row:

- `SemanticMemoryVersion`
- `TimelineEventVersion`
- `UnderstandingVersion`
- `RelationshipVersion`

The parent object stores the current pointer:

- `currentVersion`
- `currentVersionId`

Previous versions remain immutable.

### 2.4 Evidence Link Required

Every projected object and every version row must be linked to Evidence through `MemoryEvidenceLink`.

Minimum links per projection:

```text
Evidence -> Parent object
Evidence -> Version object
```

The projected object must not be eligible for retrieval or response injection unless it has at least one active Evidence link.

### 2.5 Current Version Required

A projected object is not complete until:

- a version row exists;
- `currentVersionId` points to that version;
- `currentVersion` matches that version number;
- Evidence links exist for both parent and version.

### 2.6 Rollback Is A Pointer Move, Not Deletion

Rollback boundary:

- Rollback may update parent object current pointer.
- Rollback must not delete version rows.
- Rollback must not delete Evidence.
- Rollback must create a new audit/version history record when implemented.

Phase 2 may define rollback mechanics, but UI rollback is not required.

## 3. Projection Contract

Every projection implementation must satisfy the same contract.

### 3.1 Input

Input is one Evidence record plus its trace context:

```ts
type ProjectionInput = {
  evidenceId: string;
  userId: string;
  evidenceType: string;
  evidenceText?: string | null;
  sourceKind: string;
  sourceId: string;
  rawMemoryId?: string | null;
  occurredAt?: Date | null;
  confidence: number;
  weight: number;
  status: "ACTIVE" | "INVALIDATED" | "SUPERSEDED" | "REVOKED";
};
```

Rules:

- `status` must be active enough for projection.
- `rawMemoryId` is not required for all future Evidence, but every Evidence must be traceable to raw source either directly or transitively.
- Projection services may read RawMemory for context, but RawMemory is not the projection input.

### 3.2 Output

Output is a projection result:

```ts
type ProjectionResult = {
  projectionType:
    | "SEMANTIC_MEMORY"
    | "TIMELINE_EVENT"
    | "UNDERSTANDING"
    | "RELATIONSHIP";
  targetId: string;
  versionId: string;
  version: number;
  currentVersionId: string;
  evidenceLinkIds: string[];
  status: "CREATED" | "UPDATED" | "SKIPPED" | "FAILED";
  reason?: string;
};
```

### 3.3 Idempotency Key

Every projection must define a deterministic idempotency key.

Recommended format:

```text
projection:{projectionType}:{evidenceId}:{projectionRuleVersion}
```

Examples:

```text
projection:semantic_memory:evidence_123:v1
projection:timeline_event:evidence_123:v1
projection:understanding:evidence_123:v1
projection:relationship:evidence_123:v1
```

Rules:

- The same Evidence and same projection rule version must not create duplicate parent objects.
- The same parent object and same version number must not create duplicate version rows.
- Existing `operationId` fields should be used for version idempotency where available.
- Parent-level deterministic keys may use existing fields such as `projectionEvidenceId` or a future equivalent.

### 3.4 Evidence Links

Projection must create or reuse links:

```text
MemoryEvidenceLink(
  evidenceId,
  targetType,
  targetId,
  role
)
```

Required roles:

- `SOURCE` for direct source evidence.
- `SUPPORTING` for corroborating evidence.
- `COUNTER` for evidence that weakens an existing understanding.
- `CORRECTION` for user correction or system correction.

Phase 2 minimum:

- Use `SOURCE` for new object creation.
- Use `SUPPORTING` for repeated supporting evidence.
- Use `COUNTER` only in Understanding Projection.
- Use `CORRECTION` only when explicit correction evidence exists.

### 3.5 Version Creation

Projection must create a version row before updating current pointer.

Required version fields:

- `userId`
- parent id
- `version`
- projected content snapshot
- confidence
- status
- `changeType`
- `reason`
- `operationId`
- `createdBy`
- `createdAt`

Version rows are append-only.

### 3.6 currentVersion Update

After the version row exists, Projection may update the parent object:

- `currentVersion`
- `currentVersionId`
- denormalized current fields
- `lastUpdatedAt` or equivalent
- `status`

This update is the current pointer move. It is not an overwrite of historical understanding.

### 3.7 Rollback Boundary

Rollback operates only at projection boundary:

```text
Parent.currentVersionId -> previous Version.id
```

Rollback must not:

- mutate old version rows;
- delete evidence links;
- delete evidence;
- alter RawMemory.

Rollback may:

- create `VersionHistory(changeType=ROLLBACK)`;
- create a new correction version;
- mark a projection result as superseded.

## 4. Projection Dispatcher

Projection Dispatcher receives active Evidence and decides which projection handlers to run.

It is not a new architecture layer. It is a service inside the async refinement pipeline.

### 4.1 Dispatcher Input

```text
Evidence(status=ACTIVE)
```

The dispatcher may load:

- Evidence links.
- RawMemory context.
- Existing projected objects.
- Current versions.
- Prior projection results.

But dispatch eligibility is based on Evidence, not RawMemory.

### 4.2 Dispatcher Output

The dispatcher returns a list of ProjectionResult records:

```text
[
  SemanticMemory ProjectionResult,
  Timeline ProjectionResult,
  Understanding ProjectionResult,
  Relationship ProjectionResult
]
```

Some projection types may be skipped.

### 4.3 Dispatch Rules

The dispatcher routes Evidence by:

- `Evidence.evidenceType`
- `Evidence.sourceKind`
- Evidence confidence and weight
- Evidence text / metadata
- existing links and target state
- projection eligibility rules

Phase 2 minimum dispatch:

```text
RAW_SEGMENTATION Evidence
  -> SemanticMemory Projection
  -> Timeline Projection if timeline eligibility passes
  -> Understanding Projection if understanding eligibility passes
  -> Relationship Projection if relationship eligibility passes
```

### 4.4 Avoiding Duplicate Processing

Dispatcher must prevent duplicate projection in three places:

1. Job-level idempotency.
2. Projection-level idempotency key.
3. Version-level operationId.

Required behavior:

- If the projection was already completed for the same Evidence and same rule version, return existing result.
- If parent object exists but version is missing, create missing version and repair current pointer.
- If parent and version exist but Evidence link is missing, create missing Evidence link.
- If Evidence is inactive, skip projection.

### 4.5 Recording Projection Result

Phase 2 should record projection result without adding a new architecture layer.

Allowed mechanisms:

- `RefinementJob.outputSnapshot`
- `VersionHistory`
- `MemoryEvidenceLink`
- parent object current fields
- version row `operationId`

Minimum Phase 2 recording:

```json
{
  "processedBy": "memory_v2_projection_dispatcher",
  "evidenceId": "...",
  "projectionRuleVersion": "v1",
  "results": [
    {
      "projectionType": "TIMELINE_EVENT",
      "targetId": "...",
      "versionId": "...",
      "status": "CREATED"
    }
  ]
}
```

## 5. Projection Types

### 5.1 SemanticMemory Projection

Purpose:

Convert Evidence into stable long-term semantic memory.

Phase 1 status:

- Minimal `RAW_SEGMENT` projection exists.

Phase 2 direction:

- Keep existing `RAW_SEGMENT` projection as deterministic baseline.
- Add higher-quality semantic categories only when evidence eligibility is defined.

Inputs:

- `Evidence(type=RAW_SEGMENTATION)` or future refined Evidence types.

Outputs:

- `SemanticMemory`
- `SemanticMemoryVersion`
- `MemoryEvidenceLink` to parent and version

Eligibility:

- Active Evidence.
- Traceable source.
- Confidence and weight meet threshold.
- Category can be determined without fabrication.

Idempotency:

```text
projection:semantic_memory:{evidenceId}:{projectionRuleVersion}
```

No-overwrite:

- New interpretation creates new `SemanticMemoryVersion`.
- Parent current pointer moves only after version creation.

### 5.2 Timeline Projection

Purpose:

Convert Evidence into user life timeline events.

Timeline is a user life event axis, not a chat timeline.

Inputs:

- Evidence that describes an event, duration, ending state, recurring life situation, or explicit user-marked important event.

Outputs:

- `TimelineEvent`
- `TimelineEventVersion`
- Evidence links to parent and version

Eligibility:

Timeline Projection must not create events for every chat or note.

Minimum eligibility:

- clear event or life situation;
- usable date or duration;
- event belongs to user life narrative, not merely chat metadata;
- confidence above deterministic threshold;
- no conflicting evidence that makes the event unsafe to assert.

Examples that may pass:

- explicit important event;
- repeated significant life circumstance;
- user-confirmed relationship/work/school/home event;
- event with date and durable relevance.

Examples that must not pass:

- low-information messages;
- raw segmentation metadata alone;
- ambiguous mood without event;
- assistant-generated text without user evidence.

Idempotency:

```text
projection:timeline_event:{evidenceId}:{projectionRuleVersion}
```

No-overwrite:

- Corrections create `TimelineEventVersion`.
- Merge/split must preserve prior versions and lineage fields.

### 5.3 Understanding Projection

Purpose:

Create evolving understanding that can be corrected, weakened, strengthened, or replaced.

Inputs:

- Evidence that supports a meaningful interpretation, hypothesis, unknown, counter-evidence, or user correction.

Outputs:

- `Understanding`
- `UnderstandingVersion`
- Evidence links to parent and version

Eligibility:

- Understanding must explicitly allow uncertainty.
- It must include confidence.
- It must support alternative hypotheses.
- It must not convert weak evidence into a fixed conclusion.

Required fields:

- understanding text
- confidence
- evidence
- alternative hypothesis
- unknowns when relevant
- version history

Counter Evidence:

- Use `MemoryEvidenceLink(role=COUNTER)` for evidence that weakens an understanding.
- Do not delete the old understanding.
- Create a new version with lower confidence or changed status.

Idempotency:

```text
projection:understanding:{evidenceId}:{projectionRuleVersion}
```

No-overwrite:

- Every understanding change creates `UnderstandingVersion`.
- Parent current pointer moves after version creation.

### 5.4 Relationship Projection

Purpose:

Represent long-term important relationships.

Inputs:

- Evidence involving a person, pet, colleague, family member, friend, romantic partner, or other important object.

Outputs:

- `Relationship`
- `RelationshipVersion`
- Evidence links to parent and version

Eligibility:

Relationship Projection must be conservative.

Minimum eligibility:

- explicit identity or stable reference;
- relation type can be inferred or remains `OTHER`;
- evidence is not a one-off ambiguous mention unless user explicitly marks importance;
- confidence meets threshold;
- relationship does not require clinical labeling.

Rules:

- One mention can create a low-confidence candidate only if the PRD-safe minimum is met.
- Repeated evidence can strengthen confidence.
- Conflict/support signals require separate evidence links.
- Relationship must be able to connect to TimelineEvent and SemanticMemory later, but those links do not need to be complete at creation.

Idempotency:

```text
projection:relationship:{normalizedIdentityKey}:{evidenceId}:{projectionRuleVersion}
```

No-overwrite:

- Relationship changes create `RelationshipVersion`.
- Parent current pointer moves after version creation.

## 6. No-Overwrite, Evidence, currentVersion Rules

### 6.1 Parent Object Rules

Parent objects may update only denormalized current fields and current version pointer.

Allowed parent updates:

- `currentVersion`
- `currentVersionId`
- denormalized title/content/status/confidence/current fields
- `updatedAt`
- `lastUpdatedAt` or equivalent

Disallowed parent updates:

- rewriting historical version content
- deleting old versions
- removing Evidence links to hide history

### 6.2 Version Rules

Version rows are append-only.

Required:

- unique `(parentId, version)`
- unique `operationId`
- snapshot of projected state
- evidence link

### 6.3 Evidence Rules

Evidence is not embedded as Json arrays for primary association.

Required:

- `Evidence` row exists.
- `MemoryEvidenceLink` links Evidence to target.
- Evidence has status.
- Inactive Evidence must not create new projections.

### 6.4 currentVersion Rules

Current pointer update must happen after version creation.

Safe write order:

```text
1. create or reuse parent object
2. create version row
3. create evidence links
4. update parent currentVersion/currentVersionId
5. record projection result
```

If step 4 fails, the system may repair by locating the version row and setting current pointer later.

## 7. Phase 2 Development Order

Phase 2 must proceed in this order:

### Step 1: Abstract Projection Pipeline

Implement shared projection primitives:

- projection contract types
- dispatcher
- idempotency helpers
- evidence link helpers
- version creation helpers
- current pointer update helpers
- projection result recording in `RefinementJob.outputSnapshot` or equivalent existing object

Do not add Timeline behavior before the shared contract exists.

### Step 2: Timeline Projection

Implement:

- deterministic TimelineEvent eligibility
- TimelineEvent creation
- TimelineEventVersion creation
- currentVersion pointer update
- Evidence links
- tests for create, skip, duplicate, correction, currentVersion

Timeline comes before Understanding because it gives Understanding a stable life-event axis.

### Step 3: Understanding Continuity

Implement:

- Understanding creation
- UnderstandingVersion creation
- alternative hypothesis
- unknowns
- counter evidence
- correction evidence
- currentVersion evolution

Understanding must be able to say:

```text
I previously understood this incorrectly.
```

This is a product capability, not an error state.

### Step 4: Relationship Projection

Implement:

- conservative relationship eligibility
- Relationship creation
- RelationshipVersion creation
- identity normalization
- support/conflict evidence links
- connection to TimelineEvent and SemanticMemory where available

Relationship follows Timeline and Understanding to avoid over-asserting relationships from weak evidence.

## 8. Explicit Non-Goals

Phase 2 Projection Pipeline does not enter:

- Report
- Assessment
- Clinical Feedback
- diagnosis
- medical labeling
- personality labeling
- prompt restructuring
- Safety rewrite
- Clinical Logic rewrite

Report and Assessment remain deferred until:

- Timeline is stable.
- Understanding Continuity is stable.
- Evidence invalidation and currentVersion behavior are reliable.

## 9. Acceptance Criteria

Projection Pipeline design is accepted when:

- Evidence is the only projection input.
- RawMemory cannot directly create Timeline / Understanding / Relationship.
- Each projection has idempotency key rules.
- Each projection creates or reuses parent object.
- Each projection creates version row before current pointer update.
- Each projection links Evidence to parent and version.
- Duplicate Evidence processing does not create duplicate objects, versions, or links.
- Inactive Evidence is skipped.
- Projection result is recorded.
- Timeline implementation can be developed next without revising the contract.
- Understanding Continuity can use the same contract after Timeline.
- Relationship can use the same contract after Understanding.
- Report / Assessment / Clinical Feedback remain out of scope.
