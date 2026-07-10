# Memory V2 Graph-Ready Design

## 1. Scope

本文档定义 Memory V2 Phase 2 的 Graph-ready 最小设计。

目标：

- 在当前 PostgreSQL / Prisma 下，让 `Relationship`、`TimelineEvent`、`Understanding`、`SemanticMemory`、`Evidence` 之间形成可查询关系。
- 不引入 Graph DB。
- 不实现图算法。
- 不新增架构层。
- 不进入 Clinical Logic、Report、Assessment。

Graph-ready 仍属于现有五层架构中的：

```text
Memory & Mental Model Layer
```

它不是新的 Product Layer，也不是新的 Architecture Layer。

## 2. PRD Alignment

SlowTalk Notes PRD v1.0 对 Memory 相关能力要求：

- 长期理解必须可追溯。
- Timeline 是用户人生事件轴。
- Relationship 保存长期关系及其变化。
- Understanding Continuity 保存可演进理解。
- 所有长期理解必须绑定 Evidence。
- Version 不覆盖历史。
- AI 可以修正过去理解。

Graph-ready 的目的不是构建完整图数据库，而是让当前 V2 对象之间的关系具备：

- 查询性。
- 可审计性。
- 可版本化演进的基础。
- 可被后续 Relationship / Understanding / Retrieval 使用的结构化边。

## 3. Non-Goals

本阶段明确不做：

- Neo4j。
- Graph DB。
- GraphRAG。
- 图算法。
- centrality / shortest path / community detection。
- 可视化关系图。
- Report。
- Assessment。
- Clinical Logic。
- Clinical Feedback。
- Prompt 主结构改造。
- Safety 逻辑改造。

## 4. Current State

当前 Memory V2 已有节点：

- `Evidence`
- `SemanticMemory`
- `TimelineEvent`
- `Relationship`
- `Understanding`

当前 Memory V2 已有证据边：

- `MemoryEvidenceLink`

当前 `MemoryEvidenceLink` 表达：

```text
Evidence --supports/source/counter/correction--> Projection Target
```

可链接目标：

- `SEMANTIC_MEMORY`
- `SEMANTIC_MEMORY_VERSION`
- `TIMELINE_EVENT`
- `TIMELINE_EVENT_VERSION`
- `RELATIONSHIP`
- `RELATIONSHIP_VERSION`
- `UNDERSTANDING`
- `UNDERSTANDING_VERSION`

当前 V2 对象内部也已有一些 Json 引用字段：

- `Understanding.relatedTimelineEventIds`
- `Understanding.relatedRelationshipIds`
- `Understanding.relatedSemanticMemoryIds`
- `Relationship.relatedTimelineEventIds`
- `Relationship.relatedSemanticMemoryIds`

这些 Json 字段适合作为 version snapshot 的一部分，但不适合作为 Graph-ready 查询的唯一来源。

原因：

- 无法统一表达 edge type。
- 无法索引 source / target 双向查询。
- 无法保存 edge confidence。
- 无法绑定 edge evidence。
- 无法表达 active / weakened / corrected / invalidated 状态。

## 5. Graph Nodes

Graph-ready MVP 的节点不是新增节点表，而是使用现有 V2 对象作为节点。

### 5.1 Evidence

职责：

- 证据来源。
- 支撑或修正投影对象。
- 所有 Projection 的唯一输入。

Node identity:

```text
EVIDENCE:{Evidence.id}
```

### 5.2 SemanticMemory

职责：

- 保存长期语义记忆。
- 支撑 Understanding。
- 作为 lower-level memory。

Node identity:

```text
SEMANTIC_MEMORY:{SemanticMemory.id}
```

### 5.3 TimelineEvent

职责：

- 用户人生事件轴上的事件。
- 可关联人物、关系、主题、情绪、Conversation。
- 可成为 Understanding 的时间基础。

Node identity:

```text
TIMELINE_EVENT:{TimelineEvent.id}
```

### 5.4 Relationship

职责：

- 保存长期重要对象或人与人的关系。
- 可关联 TimelineEvent。
- 可被 Understanding 引用。

Node identity:

```text
RELATIONSHIP:{Relationship.id}
```

### 5.5 Understanding

职责：

- 保存当前长期理解。
- 通过版本表达理解演进。
- 引用 TimelineEvent、Relationship、SemanticMemory 作为理解来源。

Node identity:

```text
UNDERSTANDING:{Understanding.id}
```

## 6. Graph Edges

Graph-ready MVP 需要五类边。

### 6.1 Evidence Supports Projection

Current status: 已有。

Model:

```text
MemoryEvidenceLink
```

Meaning:

```text
Evidence --SOURCE/SUPPORTING/COUNTER/CORRECTION--> Projection Target
```

Examples:

```text
Evidence -> SemanticMemory
Evidence -> TimelineEvent
Evidence -> Relationship
Evidence -> Understanding
Evidence -> SemanticMemoryVersion
Evidence -> TimelineEventVersion
Evidence -> RelationshipVersion
Evidence -> UnderstandingVersion
```

This edge already exists and should not be duplicated by `ProjectionRelation`.

### 6.2 TimelineEvent Involves Relationship

Current status: 需要新增。

Meaning:

```text
TimelineEvent --INVOLVES_RELATIONSHIP--> Relationship
```

Use cases:

- 某个事件涉及某个重要人物。
- 某次聊天或小记中的事件与 Relationship 相关。
- 查询某个 Relationship 关联过哪些 TimelineEvent。

### 6.3 Understanding References TimelineEvent

Current status: 需要新增。

Meaning:

```text
Understanding --REFERENCES_TIMELINE_EVENT--> TimelineEvent
```

Use cases:

- 理解某个长期模式时，需要知道它来自哪些人生事件。
- 查询某个事件影响了哪些长期理解。

### 6.4 Understanding References Relationship

Current status: 需要新增。

Meaning:

```text
Understanding --REFERENCES_RELATIONSHIP--> Relationship
```

Use cases:

- 理解某个长期关系模式。
- 查询某个 Relationship 影响了哪些 Understanding。

### 6.5 SemanticMemory Supports Understanding

Current status: 需要新增。

Meaning:

```text
SemanticMemory --SUPPORTS_UNDERSTANDING--> Understanding
```

Use cases:

- 查询某个 Understanding 来源于哪些 lower-level SemanticMemory。
- 当 SemanticMemory 被修正、撤销、削弱时，找到受影响的 Understanding。

## 7. Existing Edge Model

### 7.1 MemoryEvidenceLink

Current model:

```prisma
model MemoryEvidenceLink {
  id         String
  userId     String
  evidenceId String
  targetType EvidenceTargetType
  targetId   String
  role       EvidenceRole
  createdAt  DateTime
}
```

Role:

- `SOURCE`
- `SUPPORTING`
- `COUNTER`
- `CORRECTION`

Graph-ready interpretation:

```text
Evidence -> V2 Object
Evidence -> V2 Version
```

`MemoryEvidenceLink` remains the source of truth for evidence support.

It must not be repurposed to express object-to-object relationships.

## 8. Required New Edge Model

Graph-ready MVP needs one new PostgreSQL / Prisma model.

Recommended name:

```text
ProjectionRelation
```

Purpose:

- Store typed relations between projected V2 objects.
- Keep object-to-object edges separate from Evidence-to-object support edges.
- Support bidirectional queries without Graph DB.

### 8.1 Proposed Prisma Model

Draft:

```prisma
enum ProjectionNodeType {
  SEMANTIC_MEMORY
  TIMELINE_EVENT
  RELATIONSHIP
  UNDERSTANDING
}

enum ProjectionRelationType {
  TIMELINE_INVOLVES_RELATIONSHIP
  UNDERSTANDING_REFERENCES_TIMELINE_EVENT
  UNDERSTANDING_REFERENCES_RELATIONSHIP
  SEMANTIC_MEMORY_SUPPORTS_UNDERSTANDING
}

enum ProjectionRelationStatus {
  ACTIVE
  WEAKENED
  SUPERSEDED
  USER_CORRECTED
  REJECTED
  ARCHIVED
}

model ProjectionRelation {
  id               String                   @id @default(cuid())
  userId           String
  fromType         ProjectionNodeType
  fromId           String
  relationType     ProjectionRelationType
  toType           ProjectionNodeType
  toId             String
  evidenceId       String?
  confidence       Float                    @default(0.5)
  weight           Float                    @default(0.5)
  status           ProjectionRelationStatus @default(ACTIVE)
  reason           String?
  metadata         Json?
  createdAt        DateTime                 @default(now())
  updatedAt        DateTime                 @updatedAt
  user             User                     @relation(fields: [userId], references: [id], onDelete: Cascade)
  evidence         Evidence?                @relation(fields: [evidenceId], references: [id], onDelete: SetNull)

  @@unique([userId, fromType, fromId, relationType, toType, toId, evidenceId])
  @@index([userId, fromType, fromId])
  @@index([userId, toType, toId])
  @@index([userId, relationType])
  @@index([userId, status])
  @@index([evidenceId])
}
```

This is a schema design proposal only. It is not implemented in this step.

### 8.2 Why Not Json Arrays As Source Of Truth

Current fields such as `relatedTimelineEventIds` are useful snapshots, but Graph-ready queries need typed edges.

Json arrays are insufficient because:

- They do not encode relation type.
- They cannot express confidence or status per edge.
- They cannot attach Evidence per edge.
- They are difficult to query bidirectionally.
- They do not support invalidation or weakening cleanly.

Rule:

```text
Json related IDs may mirror relations for snapshot/read convenience.
ProjectionRelation is the source of truth for object-to-object graph-ready edges.
```

## 9. Edge Direction Rules

### 9.1 Evidence Supports Projection

Stored in:

```text
MemoryEvidenceLink
```

Direction:

```text
Evidence -> Projection Target
```

### 9.2 TimelineEvent Involves Relationship

Stored in:

```text
ProjectionRelation
```

Direction:

```text
TimelineEvent -> Relationship
```

Relation type:

```text
TIMELINE_INVOLVES_RELATIONSHIP
```

### 9.3 Understanding References TimelineEvent

Stored in:

```text
ProjectionRelation
```

Direction:

```text
Understanding -> TimelineEvent
```

Relation type:

```text
UNDERSTANDING_REFERENCES_TIMELINE_EVENT
```

### 9.4 Understanding References Relationship

Stored in:

```text
ProjectionRelation
```

Direction:

```text
Understanding -> Relationship
```

Relation type:

```text
UNDERSTANDING_REFERENCES_RELATIONSHIP
```

### 9.5 SemanticMemory Supports Understanding

Stored in:

```text
ProjectionRelation
```

Direction:

```text
SemanticMemory -> Understanding
```

Relation type:

```text
SEMANTIC_MEMORY_SUPPORTS_UNDERSTANDING
```

## 10. Graph-Ready MVP Query Goals

### 10.1 Query Timeline Events For A Relationship

Question:

```text
某个 Relationship 关联过哪些 TimelineEvent？
```

Query shape:

```text
ProjectionRelation
  where toType = RELATIONSHIP
    and toId = relationshipId
    and relationType = TIMELINE_INVOLVES_RELATIONSHIP
    and status in ACTIVE / USER_CORRECTED
  join TimelineEvent by fromId
  order by TimelineEvent.startDate desc
```

Purpose:

- Show relationship history.
- Retrieve events involving a person.
- Prepare Relationship-aware retrieval.

### 10.2 Query Sources For An Understanding

Question:

```text
某个 Understanding 来源于哪些 Timeline / Relationship / SemanticMemory？
```

Query shape:

```text
ProjectionRelation
  where (
    fromType = UNDERSTANDING and fromId = understandingId
  )
  or (
    relationType = SEMANTIC_MEMORY_SUPPORTS_UNDERSTANDING
    and toType = UNDERSTANDING
    and toId = understandingId
  )
```

Expected edges:

```text
Understanding -> TimelineEvent
Understanding -> Relationship
SemanticMemory -> Understanding
```

Purpose:

- Explain why an Understanding exists.
- Support user correction.
- Support rollback and invalidation analysis.

### 10.3 Query Understandings Affected By A TimelineEvent

Question:

```text
某个事件影响了哪些长期理解？
```

Query shape:

```text
ProjectionRelation
  where toType = TIMELINE_EVENT
    and toId = timelineEventId
    and relationType = UNDERSTANDING_REFERENCES_TIMELINE_EVENT
    and status in ACTIVE / USER_CORRECTED
  join Understanding by fromId
```

Purpose:

- When TimelineEvent changes, find affected Understanding.
- Show event-to-understanding continuity.
- Prepare future correction propagation.

## 11. Relation Creation Rules

Projection relations must be created by Projection services or Memory services only.

Allowed:

```text
Evidence -> Projection -> ProjectionRelation
```

Not allowed:

```text
RawMemory -> ProjectionRelation
```

Rules:

- Relation creation must reference at least one Evidence when available.
- Relation must not be created from unsupported inference.
- Relation status starts as `ACTIVE`.
- Relation must be idempotent by:

```text
userId + fromType + fromId + relationType + toType + toId + evidenceId
```

- If a relation weakens, do not delete immediately. Mark as `WEAKENED` or `SUPERSEDED`.
- Hard delete only follows user/account deletion policy.

## 12. Version Interaction

ProjectionRelation is not a replacement for version rows.

Version rows remain:

- `SemanticMemoryVersion`
- `TimelineEventVersion`
- `RelationshipVersion`
- `UnderstandingVersion`

ProjectionRelation should point to parent objects, not version rows, in the MVP.

Reason:

- Retrieval generally needs current object state.
- Version-specific evidence is already tracked by `MemoryEvidenceLink`.
- Parent-to-parent relation can remain stable while current versions change.

Future extension:

- If needed, relation metadata may include:

```json
{
  "fromVersionId": "...",
  "toVersionId": "..."
}
```

But this is not required for Graph-ready MVP.

## 13. Evidence Invalidation

When an Evidence is invalidated:

Existing path:

```text
Evidence
  -> MemoryEvidenceLink
  -> affected projected objects / versions
```

Graph-ready path:

```text
Evidence
  -> ProjectionRelation.evidenceId
  -> affected object-to-object edges
```

Minimum behavior:

- Do not delete ProjectionRelation.
- Mark relation as `WEAKENED`, `SUPERSEDED`, or `REJECTED`.
- Affected Understanding may later create a new `UnderstandingVersion`.

This keeps PRD understanding continuity:

```text
过去理解
当前理解
变化原因
证据变化
理解修正
```

## 14. Retrieval Use

Graph-ready MVP supports retrieval without Graph DB.

Examples:

### 14.1 Relationship-aware Retrieval

```text
Relationship
  -> ProjectionRelation(TIMELINE_INVOLVES_RELATIONSHIP)
  -> TimelineEvent
  -> MemoryEvidenceLink
  -> Evidence
```

Use:

- retrieve relationship history.
- retrieve relevant events.

### 14.2 Understanding Explanation

```text
Understanding
  -> ProjectionRelation
  -> TimelineEvent / Relationship
SemanticMemory
  -> ProjectionRelation
  -> Understanding
Understanding
  -> MemoryEvidenceLink
  -> Evidence
```

Use:

- explain current understanding.
- show supporting memories.

### 14.3 Event Impact Retrieval

```text
TimelineEvent
  -> ProjectionRelation(UNDERSTANDING_REFERENCES_TIMELINE_EVENT)
  -> Understanding
```

Use:

- identify which long-term understanding depends on an event.
- support correction propagation.

## 15. Implementation Order

Graph-ready should be implemented after current deterministic projections stabilize.

Recommended order:

1. Add `ProjectionRelation` schema.
2. Add typed relation write helpers.
3. Add idempotent relation creation in Projection services.
4. Backfill deterministic relations from existing V2 objects:
   - `SemanticMemory -> Understanding`
   - `TimelineEvent -> Relationship`
   - `Understanding -> TimelineEvent`
   - `Understanding -> Relationship`
5. Add retrieval helpers for the three query goals.
6. Keep response context feature flag default disabled.

No Graph DB is introduced in this order.

## 16. Acceptance Criteria

Graph-ready MVP is accepted when:

- `MemoryEvidenceLink` remains the source of truth for Evidence support.
- `ProjectionRelation` exists for object-to-object edges.
- Relationship-to-TimelineEvent query works.
- Understanding source query works.
- TimelineEvent-to-Understanding impact query works.
- Relations are idempotent.
- Relations are evidence-backed when Evidence is available.
- No code path lets RawMemory directly create graph edges.
- No Neo4j / Graph DB / graph algorithm is introduced.
- No Clinical Logic / Report / Assessment behavior is changed.

## 17. Final Position

Graph-ready Memory V2 means:

```text
PostgreSQL-queryable relations between projected memory objects.
```

It does not mean:

```text
Graph database
Graph algorithms
Graph visualization
Clinical reasoning engine
```

The minimum durable model is:

```text
Evidence support edge:
  MemoryEvidenceLink

Object-to-object relation edge:
  ProjectionRelation
```

This keeps the system aligned with SlowTalk Notes PRD v1.0:

- traceable,
- evidence-backed,
- version-compatible,
- reversible,
- and still inside Memory & Mental Model Layer.

