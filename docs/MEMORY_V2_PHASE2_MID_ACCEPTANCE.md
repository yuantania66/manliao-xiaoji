# Memory V2 Phase 2 Mid Acceptance

## 1. Scope

本文档用于验收 Memory V2 Phase 2 中期状态，并确认当前实现仍符合 SlowTalk Notes PRD v1.0 与五层产品架构。

当前完成内容属于：

- Phase 1 最小闭环的延伸。
- Memory & Mental Model Layer 内部的 Projection Pipeline。
- Understanding Continuity deterministic MVP。
- V2 Retrieval / Response Context feature flag 适配。

当前未进入：

- Clinical Logic。
- Relationship。
- Report。
- Assessment。
- Clinical Feedback。

## 2. Architecture Boundary Check

SlowTalk Notes PRD v1.0 当前产品架构为五层：

```text
Application Layer
Conversation Layer
Clinical Logic Layer
Memory & Mental Model Layer
Governance & Safety Layer
```

本阶段改动只发生在 `Memory & Mental Model Layer`。

| Architecture Layer | Current Change | Acceptance |
|---|---:|---|
| Application Layer | 无产品 UI / 设置 / 导出 / 删除界面改动 | 符合 |
| Conversation Layer | 未改变实时对话主流程；只保留既有 RawMemory capture 接入 | 符合 |
| Clinical Logic Layer | 未新增策略判断，未改变助人策略计划 | 符合 |
| Memory & Mental Model Layer | 新增 Projection Framework、Semantic / Timeline / Understanding projection、V2 retrieval adapter | 符合 |
| Governance & Safety Layer | 未改变 Safety 判定和高风险覆盖规则 | 符合 |

结论：

当前 Phase 2 中期实现没有新增架构层，也没有把 Memory 能力塞回 Conversation OS。Projection Framework 是 Memory & Mental Model Layer 内部实现，不是新的 Product Layer。

## 3. Phase 2 Roadmap Check

PRD Phase 2 Roadmap 关注：

- Clinical Logic。
- Relationship。
- Graph-ready。

当前实际完成情况如下。

| Roadmap Area | Status | Acceptance Notes |
|---|---|---|
| Clinical Logic | 未开始 | 当前没有修改 Clinical Logic、Prompt 主结构、Safety、Response 生成策略。V2 context 仅在 feature flag 开启时作为 Memory Injection 输入。 |
| Relationship | 未开始 | `RelationshipProjection` 仍为 stub skip。没有创建 `Relationship` / `RelationshipVersion`。 |
| Graph-ready | 部分完成 | 已具备 EvidenceLink、Version、currentVersion、ProjectionDispatcher、Semantic / Timeline / Understanding 三类节点雏形，但尚未建立 Relationship Graph 或 graph traversal。 |

中期结论：

当前工作不是 Clinical Logic Phase 2。

当前实际完成的是：

```text
Phase 1 延伸
  + Projection Pipeline 地基
  + Timeline deterministic MVP
  + Understanding Continuity deterministic MVP
  + V2 Retrieval 注入路径 behind feature flag
```

## 4. Completed Capabilities

### 4.1 Projection Framework

Status: 已完成中期 MVP

已实现 Memory layer 内部 Projection Framework：

- `ProjectionDispatcher`
- `ProjectionRunner`
- `ProjectionRegistry`
- `ProjectionContext`
- `ProjectionResult`
- Projection interface：
  - `projectionName`
  - `supportedEvidenceTypes`
  - `shouldProject`
  - `project`
  - `createVersion`
  - `updateCurrentVersion`

Framework 规则：

- Projection 输入是 `Evidence`。
- Parent object 与 version row 都必须有 EvidenceLink。
- 每个 Projection 走统一生命周期。
- Runner 负责事务、异常、EvidenceLink、currentVersion 更新。
- Dispatcher 不关心 Projection 内部业务逻辑。

### 4.2 SemanticProjection

Status: 已完成 deterministic MVP

当前链路：

```text
RAW_SEGMENTATION Evidence
  -> SemanticProjection
  -> SemanticMemory(kind=RAW_SEGMENT)
  -> SemanticMemoryVersion(version=1)
  -> SemanticMemory.currentVersionId
  -> EvidenceLink
```

特征：

- `SemanticProjection` 是 SemanticMemory 写入的唯一业务投影入口。
- `semanticMemoryService` 保留为底层 repository/helper。
- 同一 `evidenceId` 不重复创建 SemanticMemory / Version / Link。
- 不调用 LLM。

### 4.3 TimelineProjection

Status: 已完成 deterministic MVP

当前链路：

```text
RAW_SEGMENTATION Evidence
  -> TimelineProjection
  -> TimelineEvent
  -> TimelineEventVersion(version=1)
  -> TimelineEvent.currentVersionId
  -> EvidenceLink
```

特征：

- `startDate` 来自 `RawMemory.occurredAt`，通过 Evidence trace context 读取。
- `confidence` 来自 Evidence。
- `eventType` 暂存于 `topics` / `snapshot`。
- 同一 `evidenceId` 不重复创建 TimelineEvent / Version / Link。
- 不调用 LLM。

注意：

当前 TimelineProjection 是 raw segment 事件投影，不是最终人生事件轴语义抽取。

### 4.4 UnderstandingProjection

Status: 已完成 deterministic MVP

当前链路：

```text
RAW_SEGMENTATION Evidence
  -> SemanticProjection
  -> SemanticMemory.currentVersion
  -> UnderstandingProjection
  -> Understanding
  -> UnderstandingVersion(version=1)
  -> Understanding.currentVersionId
  -> EvidenceLink
```

特征：

- `UnderstandingProjection` 输入是 Evidence。
- 不直接读取 RawMemory。
- `summary / understanding` 来源于 `SemanticMemory.currentVersionRecord.content`。
- `confidence` 来源于 Evidence。
- 当前 schema 没有 `ACTIVE` status，使用 `UnderstandingStatus.OPEN` 表达可用开放理解。
- 当前 schema 没有 `hypothesisType` 字段，`RAW_SEGMENT` 写入 `category` 与 version `snapshot.hypothesisType`。
- 同一 `evidenceId` 不重复创建 Understanding / Version / Link。
- 不调用 LLM。

### 4.5 V2 Retrieval And Response Context

Status: 已完成中期 MVP，默认关闭

`retrieveMemoryV2ContextForUser` 当前读取：

- `Understanding`
- `TimelineEvent`
- `SemanticMemory`

只读取：

- 有 `currentVersionId` 的对象。
- 可用状态对象：
  - Understanding: `OPEN` / `DEEPENING` / `USER_CORRECTED`
  - TimelineEvent: `ACTIVE` / `USER_CORRECTED`
  - SemanticMemory: `ACTIVE` / `USER_CORRECTED`

映射到现有 `StructuredRagContext.recentMemories`：

```text
Understanding: highest priority
TimelineEvent: supporting context
SemanticMemory: lower-level memory
```

Feature flag：

```text
MEMORY_V2_RESPONSE_CONTEXT_ENABLED=false
```

默认关闭时：

- 不调用 V2 retrieval。
- 不注入 V2 context。
- 返回原 V1 `StructuredRagContext`。
- 现有线上回复行为不变。

开启时：

- 注入 V2 Understanding / Timeline / SemanticMemory context。
- 仍不修改 Prompt 主结构。
- 仍不修改 Clinical Logic。
- 仍不修改 Safety。

## 5. Current Complete Data Flow

当前完整链路：

```text
ChatMessage / Note
  -> RawMemory
  -> RawMemoryEvent(CREATED)
  -> RefinementJob(RAW_CAPTURED)
  -> RAW_CAPTURED worker
  -> RefinementJob(RAW_TO_SEGMENTATION)
  -> RAW_TO_SEGMENTATION worker
  -> deterministic Segmentation metadata
  -> Evidence(type=RAW_SEGMENTATION)
  -> MemoryEvidenceLink(targetType=RAW_SEGMENTATION)
  -> ProjectionDispatcher
      -> SemanticProjection
          -> SemanticMemory
          -> SemanticMemoryVersion
          -> currentVersionId
          -> EvidenceLink
      -> TimelineProjection
          -> TimelineEvent
          -> TimelineEventVersion
          -> currentVersionId
          -> EvidenceLink
      -> UnderstandingProjection
          -> Understanding
          -> UnderstandingVersion
          -> currentVersionId
          -> EvidenceLink
      -> RelationshipProjection
          -> skipped
  -> Retrieval
      -> Understanding first
      -> Timeline supporting context
      -> SemanticMemory lower-level memory
  -> Response Context feature flag
      -> flag=false: no V2 injection
      -> flag=true: merge V2 context into StructuredRagContext
```

This is still Memory Injection, not Clinical Logic.

## 6. Explicitly Not Entered

当前没有进入以下范围。

### 6.1 Report

未实现：

- 长期报告。
- 近期变化报告。
- 成长轨迹报告。
- Report Evidence citation。

### 6.2 Assessment

未实现：

- 压力变化 assessment。
- 恢复能力 assessment。
- 社交变化 assessment。
- 稳定性 assessment。

当前系统没有进行医学诊断，也没有给用户贴标签。

### 6.3 Clinical Feedback

未实现：

- 用户可见理解反馈 UI。
- 用户修正 workflow。
- 阶段性反馈。
- 量表接入。

### 6.4 Relationship

未实现：

- `RelationshipProjection`。
- `Relationship` 创建。
- `RelationshipVersion` 创建。
- 关系身份、互动频率、冲突、支持、影响。
- Relationship 与 Timeline / Conversation / SemanticMemory 的结构化关联。

### 6.5 Clinical Logic

未实现：

- 助人策略选择改造。
- Clinical plan 改造。
- 风险下策略覆盖。
- Prompt 主结构改造。
- Response generation behavior 改造。

## 7. Evidence / Version / Continuity Acceptance

当前中期实现满足以下 Memory V2 原则。

### 7.1 Evidence

已满足：

- SemanticMemory、TimelineEvent、Understanding 均由 Evidence 投影产生。
- Parent object 与 version row 均通过 `MemoryEvidenceLink` 关联 Evidence。
- Retrieval 对象来自带 currentVersion 的投影对象。

仍未完成：

- Evidence invalidation 后的派生对象失效传播。
- 非 RawMemory Evidence 类型。
- Event / Emotion / Entity extraction Evidence。

### 7.2 Version

已满足：

- SemanticMemoryVersion 创建。
- TimelineEventVersion 创建。
- UnderstandingVersion 创建。
- Parent object 通过 currentVersionId 指向当前版本。
- 重复执行不重复创建 version。

仍未完成：

- v2+ version 演进。
- 用户修正 version。
- merge / split version。
- Rollback。
- VersionHistory 写入。

### 7.3 Understanding Continuity

已完成 MVP：

- `Understanding` 可由 Evidence 和 SemanticMemory currentVersion deterministic 创建。
- `UnderstandingVersion` 保存初始版本。
- Retrieval 中 Understanding 优先级高于 SemanticMemory。

未完成长期能力：

- Alternative Hypothesis。
- “我以前理解错了”的修正链。
- 证据变化导致理解变化。
- 冲突证据。
- 版本历史可视化。

## 8. Current Risks

### 8.1 Timeline schema 长期字段不足

风险：

- `eventType` 不是一等字段。
- 当前暂存于 `topics` / `snapshot`。
- raw segment event 不是最终人生事件语义。

影响：

- 后续 Timeline retrieval、Relationship、Understanding 可能混淆 technical metadata 与用户主题。

### 8.2 Understanding schema 缺少 projectionEvidenceId / hypothesisType

风险：

- `Understanding` 没有 `projectionEvidenceId`。
- 当前使用 deterministic id `understanding_${evidenceId}` 实现 parent-level 幂等。
- `hypothesisType` 写入 `category` 和 `snapshot.hypothesisType`。

影响：

- 长期审计可读性弱。
- 后续多 Evidence 支持同一个 Understanding 时需要更明确 identity。

### 8.3 StructuredRagContext 没有专门 Understanding 字段

风险：

- 当前 Understanding、Timeline、SemanticMemory 都映射到 `recentMemories`。
- 通过 `reason` 和 priority 区分层级。

影响：

- Prompt 主结构暂不变，但长期需要更明确 Memory Injection contract。

### 8.4 V2 response context 默认关闭

风险：

- 当前完整 V2 retrieval 只有 flag=true 时进入 response context。

影响：

- 线上默认行为不体现 V2 Understanding。
- 这是刻意的安全收口，避免未验证长期理解影响实时回复。

### 8.5 RUNNING stale job 未处理

风险：

- `RUNNING` job 不自动重试。
- Worker 崩溃后可能留下 stale job。

影响：

- 部分 RawMemory 可能停留在中间状态。

### 8.6 append-only 仍依赖服务层约束

风险：

- RawMemory append-only、version no-overwrite 主要依赖服务层和验证。
- 数据库层尚未通过 trigger / permission 完全禁止 update/delete。

影响：

- 需要代码审查和服务边界维持不可变语义。

## 9. Validation Status

当前中期实现已通过以下验证命令：

```bash
npx prisma validate && npx prisma generate
npx tsx services/memory/projection/projection-framework-check.ts
npm run check:memory-v2-raw
npm run check:memory-v2-refinement-job
npm run check:memory-v2-raw-worker
npm run check:memory-v2-retrieval
npm run check:memory-v2-response-context
npm run check:prisma
```

验证覆盖：

- RawMemory append-only write path。
- RefinementJob idempotency 与 claim。
- RAW_CAPTURED -> RAW_TO_SEGMENTATION。
- Evidence 创建。
- ProjectionDispatcher 分发。
- SemanticProjection / TimelineProjection / UnderstandingProjection。
- RelationshipProjection skip。
- Version / currentVersion / EvidenceLink。
- V2 retrieval 中 Understanding priority。
- Response context flag=false 不注入。
- Response context flag=true 注入 V2 Understanding。

## 10. Next Step Recommendation

下一步建议按以下顺序推进。

### 10.1 RelationshipProjection deterministic MVP

先实现最小 RelationshipProjection：

- 仍然只在 Memory & Mental Model Layer 内。
- 仍然以 Evidence 为输入。
- 仍然不调用 Clinical Logic。
- 创建 `Relationship` / `RelationshipVersion` / currentVersion / EvidenceLink。
- conservative deterministic rule，避免从一次 raw segment 过度断言关系。

### 10.2 Graph-ready 最小关系

RelationshipProjection 后，再做 Graph-ready 最小关系：

- Relationship 与 TimelineEvent 的 evidence-backed linkage。
- Relationship 与 SemanticMemory 的 evidence-backed linkage。
- Relationship 与 Conversation 的 trace linkage。
- 不引入 Neo4j / GraphRAG / 新架构层。

### 10.3 Clinical Logic 暂不开始

Clinical Logic 暂不开始。

原因：

- 当前 V2 Understanding 仍是 deterministic MVP。
- Timeline 仍是 raw segment event，不是完整人生事件轴。
- Relationship 尚未建立。
- 过早让 Clinical Logic 消费 V2 可能放大低质量长期理解。

## 11. Final Acceptance

Memory V2 Phase 2 中期状态可以验收为：

```text
Phase 1 延伸 + Projection Framework + Understanding Continuity MVP
```

它满足：

- 不新增架构层。
- 改动留在 Memory & Mental Model Layer。
- 不改变 Chat 主流程行为。
- 不改变 Prompt 主结构。
- 不改变 Clinical Logic。
- 不改变 Safety。
- V2 response context 默认关闭。
- Evidence / Version / currentVersion / idempotency 的最小链路成立。

它尚不满足：

- 完整 Relationship Graph。
- Graph-ready retrieval。
- Clinical Logic。
- Report。
- Assessment。
- Clinical Feedback。

