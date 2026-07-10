# Memory V2 Phase 2 Acceptance

## 1. Purpose

本文档用于正式验收 Memory V2 Phase 2 当前状态，并将项目从 Memory 扩展阶段收口到下一阶段 Clinical Logic Layer。

本文档对照 SlowTalk Notes PRD v1.0 与当前五层产品架构：

```text
Application Layer
Conversation Layer
Clinical Logic Layer
Memory & Mental Model Layer
Governance & Safety Layer
```

本阶段验收对象只属于：

```text
Memory & Mental Model Layer
```

不新增架构层。

不继续扩展 Conversation OS。

不继续做单句回复优化、Voice Layer 调参或 Prompt 调参。

## 2. Phase 2 Acceptance Summary

Memory V2 当前可以验收为：

```text
RawMemory
  -> Evidence
  -> Projection Framework
  -> SemanticMemory MVP
  -> Timeline MVP
  -> Relationship MVP
  -> Understanding MVP
  -> V2 Retrieval
  -> Response Context feature flag
```

该阶段完成的是长期记忆与心智模型层的工程地基，不是新的产品层，也不是 Clinical Logic。

## 3. Completed Capabilities

### 3.1 RawMemory

Status: 已完成 MVP

已完成能力：

- ChatMessage 写入 RawMemory。
- Assistant message 写入 RawMemory。
- Proactive greeting 写入 RawMemory。
- Note 写入 RawMemory。
- Draft Note 不写入 RawMemory。
- RawMemory 创建失败不阻断实时聊天或小记主流程。
- RawMemoryEvent 记录生命周期事件。
- RawMemory 作为统一原始数据账本，保留后续 Evidence 追溯入口。

验收结论：

RawMemory 已满足 PRD 对 Raw Data Layer 的最小要求。

当前限制：

- append-only 仍主要依赖服务层约束。
- 数据库层尚未通过 trigger / permission 完整阻止所有直接 update/delete。

### 3.2 Evidence

Status: 已完成 MVP

已完成能力：

- Evidence 是 Memory V2 的一等对象。
- Evidence 从 RawMemory 派生。
- Evidence 支持 `RAW_SEGMENTATION`。
- MemoryEvidenceLink 连接 Evidence 与派生对象。
- Parent object 与 version row 均可关联 Evidence。
- 同一 rawMemoryId + evidenceType 不重复创建 Evidence。
- 同一 evidenceId + targetType + targetId + role 不重复创建 link。

验收结论：

Evidence 已成为 RawMemory 与长期理解对象之间的统一证据约束。

当前限制：

- Evidence invalidation 后的派生对象失效传播尚未实现。
- 仍缺少 Event / Emotion / Entity 等更高语义 Evidence 类型。

### 3.3 SemanticMemory

Status: 已完成 MVP

已完成能力：

- RAW_SEGMENTATION Evidence 可投影为 SemanticMemory。
- SemanticMemory 创建 current version。
- SemanticMemoryVersion 保存 version=1。
- SemanticMemory.currentVersionId 指向当前版本。
- SemanticMemory 与 SemanticMemoryVersion 均有 EvidenceLink。
- 同一 evidenceId 不重复创建同一 SemanticMemory 投影。

验收结论：

SemanticMemory 已满足 PRD 对 Semantic Memory 的最小版本化与可追溯要求。

当前限制：

- 当前内容仍是 deterministic raw segment memory。
- 尚未进入 LLM 语义抽取。
- 尚未实现用户修正、冲突证据、v2+ version 演进。

### 3.4 Timeline MVP

Status: 已完成 deterministic MVP

已完成能力：

- RAW_SEGMENTATION Evidence 可投影为 TimelineEvent。
- TimelineEvent 创建 current version。
- TimelineEventVersion 保存 version=1。
- TimelineEvent.currentVersionId 指向当前版本。
- Timeline projection 通过 EvidenceLink 可追溯。
- 同一 evidenceId 不重复创建 TimelineEvent / Version / Link。
- V2 Retrieval 可读取 TimelineEvent current version，并作为 supporting context 映射到 StructuredRagContext。

验收结论：

Timeline MVP 已证明 Projection Pipeline 可以生成可追溯、可版本化的 Timeline 对象。

当前限制：

- 当前 TimelineEvent 更接近 raw segment time projection，不是最终人生事件轴。
- Timeline 缺少长期字段，如 `eventType`、`projectionEvidenceId` 等。
- 暂不做 Timeline schema 深化。

### 3.5 Relationship MVP

Status: 已完成 deterministic MVP

已完成能力：

- ProjectionRegistry 已注册 RelationshipProjection。
- RelationshipProjection 在无 person candidate 时 skip。
- Relationship candidate flow 可创建 Relationship。
- RelationshipVersion 创建 version=1。
- Relationship.currentVersionId 指向当前版本。
- Relationship / RelationshipVersion 均可通过 EvidenceLink 追溯。
- 重复 dispatch 不重复创建 Relationship / RelationshipVersion。
- V2 Retrieval 可读取 Relationship current version，并作为 supporting memory 映射到 StructuredRagContext。

验收结论：

Relationship MVP 已满足“可创建、可版本化、可追溯、可检索”的最小要求。

当前限制：

- 不做 Relationship 消歧 / 合并。
- 不做人物身份长期解析。
- 不做互动频率、冲突、支持、影响等 schema 深化。
- 当前 `RelationshipType.OTHER` 被用来承接 UNKNOWN 语义，长期需要修正。

### 3.6 Understanding MVP

Status: 已完成 deterministic MVP

已完成能力：

- RAW_SEGMENTATION Evidence 通过 SemanticMemory current version 可投影为 Understanding。
- Understanding 创建 current version。
- UnderstandingVersion 保存 version=1。
- Understanding.currentVersionId 指向当前版本。
- Understanding / UnderstandingVersion 均可通过 EvidenceLink 追溯。
- 同一 evidenceId 不重复创建 Understanding / Version / Link。
- V2 Retrieval 中 Understanding 优先级高于 Timeline / Relationship / SemanticMemory。

验收结论：

Understanding MVP 已满足 Understanding Continuity 的最小可用要求。

当前限制：

- Understanding 缺少 `projectionEvidenceId`。
- Understanding 缺少 `hypothesisType`。
- 当前 `hypothesisType` 类语义仍通过 category / snapshot 承载。
- 不做 Understanding schema 深化。

### 3.7 Projection Framework

Status: 已完成 MVP

已完成能力：

- ProjectionDispatcher。
- ProjectionRunner。
- ProjectionRegistry。
- ProjectionContext。
- ProjectionResult。
- SemanticProjection。
- TimelineProjection。
- UnderstandingProjection。
- RelationshipProjection。
- 统一支持：
  - shouldProject
  - project
  - createVersion
  - updateCurrentVersion
  - EvidenceLink
  - idempotency
  - skipped / created / failed result

验收结论：

Projection Framework 已完成 Memory V2 Phase 2 的核心工程地基。

重要边界：

Projection Framework 只是 Memory & Mental Model Layer 内部工程实现。

它不是：

- 新架构层。
- 产品能力。
- Clinical Logic。
- Conversation OS 的扩展。
- 用户可见功能。

### 3.8 V2 Retrieval

Status: 已完成 MVP

已完成能力：

- retrieveMemoryV2ContextForUser。
- 读取 current version 对象。
- 支持 Understanding / Timeline / Relationship / SemanticMemory。
- 过滤可用状态。
- 将 V2 memory 映射到现有 StructuredRagContext。
- V2/V1 response context 可按 source 去重。
- Understanding 优先级最高。
- Timeline / Relationship 作为 supporting context。
- SemanticMemory 作为 lower-level memory。

验收结论：

V2 Retrieval 已完成最小 response injection 前置能力。

当前限制：

- StructuredRagContext 仍没有 Understanding / Timeline / Relationship 专用字段。
- 当前都映射进 recentMemories，并通过 reason / priority 区分层级。

### 3.9 Response Context Feature Flag

Status: 已完成，默认关闭

已完成能力：

- MEMORY_V2_RESPONSE_CONTEXT_ENABLED 默认 false。
- flag=false 时不调用 V2 retrieval，不注入 V2 memory。
- flag=true 时合并 V2 context 到现有 StructuredRagContext。
- 不改变 Prompt 主结构。
- 不改变 Clinical Logic。
- 不改变 Safety。
- 不改变默认线上回复行为。

验收结论：

Response Context feature flag 已完成灰度入口。

当前策略：

默认继续关闭，避免未充分验证的长期理解影响实时回复。

## 4. SlowTalk Notes PRD v1.0 Mapping

| PRD Capability | Current Status | Acceptance |
|---|---|---|
| Raw Data Layer | RawMemory + RawMemoryEvent 已完成 | 满足 MVP |
| Evidence Chain | Evidence + MemoryEvidenceLink 已完成 | 满足 MVP |
| Semantic Memory | SemanticMemory + Version 已完成 | 满足 MVP |
| Timeline | TimelineEvent + Version 已完成 deterministic MVP | 满足 Phase 2 收口，不满足长期完整 Timeline |
| Relationship | Relationship + Version 已完成 deterministic MVP | 满足 Phase 2 收口，不满足完整关系图谱 |
| Understanding Continuity | Understanding + Version 已完成 deterministic MVP | 满足 Phase 2 收口，不满足长期 hypothesis 演进 |
| Projection Pipeline | Dispatcher / Runner / Registry / Context 已完成 | 满足 MVP |
| Retrieval | V2 Retrieval + StructuredRagContext adapter 已完成 | 满足 MVP |
| Response Context Flag | 默认关闭，flag=true 注入 | 满足 MVP |
| Graph-ready | 不继续推进 | 本阶段明确停止 |
| Clinical Logic | 未进入 | 下一阶段只做设计文档 |

## 5. Explicit Stop Line

Memory V2 当前停止继续扩展。

本阶段不做：

- Graph-ready 实现。
- Timeline schema 深化。
- Understanding schema 深化。
- Relationship 消歧 / 合并。
- Graph traversal。
- GraphRAG。
- Neo4j。
- Milvus。
- LangGraph。
- Report。
- Assessment。
- Clinical Feedback。

理由：

Memory V2 的 Phase 2 目标是验证长期理解对象的可追溯、可版本化、可投影、可检索地基。

该目标已经完成。

继续扩展 Memory 会推迟 Clinical Logic Layer，并增加未验证长期理解影响实时回复的风险。

## 6. Known Technical Debt

### 6.1 StructuredRagContext 缺少专用字段

当前：

- Understanding。
- Timeline。
- Relationship。
- SemanticMemory。

均映射到 `StructuredRagContext.recentMemories`。

问题：

- Prompt 侧无法天然区分 memory layer。
- 依赖 reason / priority 作为软区分。
- 后续 Clinical Logic 消费 memory 时 contract 不够清晰。

### 6.2 Timeline 长期字段不足

缺少：

- `eventType`
- `projectionEvidenceId`
- 更明确的 event lifecycle 字段
- 更清晰的 core event eligibility 字段

当前：

- eventType 类信息暂存在 topics / snapshot。
- deterministic id 承担 parent-level idempotency。

### 6.3 Understanding 长期字段不足

缺少：

- `projectionEvidenceId`
- `hypothesisType`

当前：

- parent-level idempotency 依赖 deterministic id。
- hypothesisType 类语义通过 category / version snapshot 承载。

### 6.4 Relationship 使用 OTHER 表示 UNKNOWN

当前：

- RelationshipType 使用 `OTHER` 承接未知或无法分类关系。

问题：

- OTHER 与 UNKNOWN 语义不同。
- 长期会影响关系消歧、UI 展示和检索解释。

### 6.5 RUNNING stale job 未处理

当前：

- RefinementJob claim 后进入 RUNNING。
- Worker 崩溃可能留下 stale RUNNING job。
- 当前不自动重试。

风险：

- 部分 RawMemory 可能停留在中间状态。

### 6.6 append-only 依赖服务层约束

当前：

- RawMemory append-only。
- Version no-overwrite。

主要依赖：

- 服务层写入约束。
- 验证脚本。
- 代码审查。

问题：

- 数据库层尚未完整禁止所有直接 update/delete。
- 后续需要更强的 DB permission / trigger / migration 策略。

## 7. Architecture Boundary

Projection Framework 不新增架构层。

它属于：

```text
Memory & Mental Model Layer
```

它不是：

- Product Layer。
- Conversation Layer。
- Clinical Logic Layer。
- Governance Layer。
- 用户可见产品能力。

当前 Memory V2 与现有 Conversation OS 不冲突。

但 Memory V2 不应继续向 Conversation OS 扩张。

Conversation OS 只负责实时对话链路与 trace。

长期理解沉淀属于 Memory & Mental Model Layer。

## 8. Next Stage

下一阶段进入：

```text
Clinical Logic Layer
```

但下一阶段只做：

```text
设计文档
```

不直接写代码。

不改 Prompt。

不改 Voice。

不改 Conversation OS。

不继续扩展 Memory。

Clinical Logic Layer 的目标是重新定义：

- 助人策略如何选择。
- 策略与 Safety 的边界。
- 策略如何消费 Memory。
- 哪些信息可以进入实时回复。

## 9. Final Acceptance

Memory V2 Phase 2 当前正式验收为：

```text
RawMemory + Evidence + Projection Framework + SemanticMemory MVP
+ Timeline MVP + Relationship MVP + Understanding MVP
+ V2 Retrieval + Response Context feature flag
```

验收结论：

- 已满足 SlowTalk Notes PRD v1.0 对 Memory & Mental Model Layer 的 Phase 2 工程地基要求。
- 已建立可追溯、可版本化、可投影、可检索的长期理解基础。
- Projection Framework 明确是内部工程实现，不是新架构层。
- 当前不继续扩展 Memory。
- 下一阶段进入 Clinical Logic Layer 设计文档。
