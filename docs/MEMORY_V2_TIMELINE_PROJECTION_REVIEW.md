# Memory V2 Timeline Projection Review

## 1. Scope

本文档 review 当前 `TimelineProjection` 是否符合 SlowTalk Notes PRD v1.0 对 Timeline 的长期定位。

Review 范围：

- `services/memory/projection/projectionRegistry.ts`
- `services/memory/projection/projectionContext.ts`
- `services/memory/projection/projectionIds.ts`
- `prisma/schema.prisma` 中的 `TimelineEvent` / `TimelineEventVersion`
- 当前 Memory V2 Projection Framework 契约

本文档只评审 Timeline Projection，不讨论 Report、Assessment、Clinical Logic，不新增架构层。

## 2. Current Implementation Summary

当前 `TimelineProjection` 已接入 Projection Framework：

```text
RAW_SEGMENTATION Evidence
  -> ProjectionDispatcher
  -> SemanticProjection
  -> TimelineProjection
  -> TimelineEvent
  -> TimelineEventVersion
  -> currentVersionId
  -> MemoryEvidenceLink
```

当前实现特征：

- Projection 的触发输入是 `Evidence`。
- `RawMemory` 只作为 Evidence trace context 被读取，不直接写 Timeline。
- 支持 `RAW_SEGMENTATION` Evidence。
- 使用 deterministic id：`timeline_${evidenceId}`。
- 创建 `TimelineEvent`。
- 创建 `TimelineEventVersion(version=1)`。
- 设置 `TimelineEvent.currentVersionId`。
- 创建 EvidenceLink 到：
  - `TIMELINE_EVENT`
  - `TIMELINE_EVENT_VERSION`
- `UnderstandingProjection` / `RelationshipProjection` 仍为 stub skip。

当前投影内容是 deterministic minimum projection，不是最终语义事件抽取：

- `title` 来自 segmentation algorithm。
- `description` 来自 deterministic segment metadata。
- `startDate` 来自 `RawMemory.occurredAt`，回退到 `Evidence.occurredAt` / `Evidence.createdAt`。
- `confidence` 来自 Evidence。
- `eventType` 暂存于 `topics` 和 version `snapshot`。
- `conversationIds` 来自 `RawMemory.conversationId`。

## 3. PRD Timeline Definition Mapping

PRD v1.0 第 14 节定义：

> Timeline 是用户人生事件轴，不是聊天时间轴。

| PRD 要求 | 当前 schema 支撑 | 当前 Projection 支撑 | Review |
|---|---|---|---|
| 事件 | `TimelineEvent.title` / `description` | 已创建最小事件 | 部分满足。当前是 raw segment 占位事件，不是完整人生事件。 |
| 日期 | `startDate` / `endDate` | `startDate` 来自 RawMemory.occurredAt | 满足最小要求。 |
| 持续时间 | `durationText` / `startDate` / `endDate` | 未写入 duration | schema 支撑，projection 未实现。 |
| 结束状态 | `endStatus` | 写入 `UNKNOWN` | schema 支撑，projection 只给默认值。 |
| 关联人物 | `people Json` | 未写入 | schema 支撑，projection 未实现。 |
| 关联情绪 | `emotions Json` | 未写入 | schema 支撑，projection 未实现。 |
| 关联主题 | `topics Json` | 写入 eventType / evidenceType / algorithm / segmentCount | 部分满足；当前 topics 混用了 event metadata。 |
| 关联 Conversation | `conversationIds Json` | Chat RawMemory 有 conversationId 时写入 | 最小满足。 |
| 事件新增 | `TimelineEvent` + version | 已实现 create | 满足最小新增。 |
| 事件结束 | `endDate` / `endStatus` / version | 未实现 | schema 支撑，projection 未实现。 |
| 事件修正 | `TimelineEventVersion` + current pointer | 只实现 version 1 | schema 支撑，projection 未实现修正路径。 |
| 事件合并 | `mergedIntoEventId` / `mergedEvents` / version | 未实现 | schema 支撑，projection 未实现。 |
| 事件拆分 | `splitFromEventId` / `splitEvents` / version | 未实现 | schema 支撑，projection 未实现。 |
| 事件关联 | parent / merged / split fields, EvidenceLink | 只关联 Evidence | 部分支撑。缺少普通 event-to-event relation 语义。 |

结论：

当前 `TimelineProjection` 符合 Phase 2 最小 deterministic 投影，但尚未达到 PRD 中 Timeline 作为“用户人生事件轴”的长期定位。它目前更像 `RAW_SEGMENTATION Evidence` 的可追溯时间投影，不能作为最终 Timeline 产品语义。

## 4. TimelineEvent Capability Review

### 4.1 核心事件

当前 `TimelineEvent` 能保存：

- `title`
- `description`
- `importanceScore`
- `status`
- `confidence`

这足以承载核心事件的基础展示和排序。

不足：

- 没有 `eventType` 一等字段。
- 没有 `isCoreEvent` 或 equivalent 一等字段。
- `importanceScore` 可表达重要性，但不能区分“核心事件”与普通 timeline item 的产品语义。

Review：

- Schema 足够支撑最小事件。
- 若 Timeline 要成为长期人生事件轴，`eventType` 和 core-event eligibility 不应长期埋在 Json。

### 4.2 日期

当前 `TimelineEvent` 支持：

- `startDate`
- `endDate`

当前 Projection：

- `startDate = RawMemory.occurredAt ?? Evidence.occurredAt ?? Evidence.createdAt`
- `endDate = null`

Review：

- 日期能力满足最小要求。
- 对 Note 来说，`RawMemory.occurredAt` 来自 `Note.recordDate`，符合用户主动记录日期。
- 对 ChatMessage 来说，当前只是聊天发生时间，不一定是事件发生时间。后续 Event Extraction 必须能从 Evidence 中表达 extracted event date，否则会把“提到过去事件的聊天时间”误认为人生事件时间。

### 4.3 持续时间

当前 schema 支持：

- `durationText`
- `startDate`
- `endDate`

当前 Projection：

- 不写 `durationText`
- 不写 `endDate`
- `endStatus = UNKNOWN`

Review：

- schema 足够。
- 当前 Projection 只是占位，无法表达持续事件、已结束事件、长期状态。
- 后续 Timeline Projection 必须从更高质量 Evidence 提取 `durationText` / `endDate` / `endStatus`。

### 4.4 结束状态

当前 schema 支持：

- `TimelineEventEndStatus.ONGOING / ENDED / UNKNOWN`

当前 Projection：

- 始终写 `UNKNOWN`

Review：

- schema 足够。
- 当前 Projection 不具备事件结束判断能力。

注意：schema enum 实际值为 `ONGOING` / `ENDED` / `UNKNOWN`，当前实现使用 `UNKNOWN` 正确。

### 4.5 情绪关联

当前 schema 支持：

- `emotions Json`

当前 Projection：

- 未写入。

Review：

- schema 能承载最小情绪数组。
- 当前 `RAW_SEGMENTATION Evidence` 不含 Emotion Extraction 结果，因此不应硬造情绪。
- 后续应由 Emotion Extraction Evidence 驱动，而不是从 raw segment metadata 推断。

### 4.6 人物关联

当前 schema 支持：

- `people Json`

当前 Projection：

- 未写入。

Review：

- schema 能承载最小人物数组。
- 当前没有 Entity Extraction Evidence，不应写人物。
- Relationship Projection 后续可读取 TimelineEvent.people，但当前 TimelineProjection 还不能成为 Relationship 的稳定输入。

### 4.7 主题关联

当前 schema 支持：

- `topics Json`

当前 Projection：

```json
{
  "eventType": "RAW_SEGMENT_EVENT | DAILY_NOTE_EVENT",
  "evidenceType": "RAW_SEGMENTATION",
  "algorithm": "...",
  "segmentCount": 1
}
```

Review：

- 能临时承载 deterministic metadata。
- 不适合作为长期主题语义。
- `topics` 应长期保存用户事件主题，例如 work、family、health、relationship 等。
- 当前把 `eventType`、`algorithm`、`segmentCount` 写入 `topics` 会污染主题字段。

### 4.8 Conversation 关联

当前 schema 支持：

- `conversationIds Json`

当前 Projection：

- 当 `RawMemory.conversationId` 存在时写入 `[conversationId]`。

Review：

- 满足最小 Conversation 关联。
- 仍是 Json，不是强 relation；但符合当前 schema 的最低成本路径。
- EvidenceLink 已提供 traceability，`conversationIds` 可作为 retrieval shortcut。

## 5. eventType In topics/snapshot Review

当前实现因为 `TimelineEvent` 没有 `eventType` 字段，将 eventType 写入：

- `TimelineEvent.topics.eventType`
- `TimelineEventVersion.snapshot.eventType`

结论：

- 适合作为 Phase 2 deterministic MVP 的临时方案。
- 不适合作为长期方案。

原因：

- `eventType` 是事件分类，不是主题。
- `topics` 长期应服务 Timeline retrieval、Understanding Continuity 和用户人生主题聚合。
- 将 eventType 混入 topics 会造成后续 Relationship / Understanding 读取时语义混乱。
- `snapshot` 可以保存历史完整内容，但不适合作为主查询字段。

必须修改：

- 在进入真正 Timeline Event Extraction 前，必须把 `eventType` 升级为一等字段，或明确建立受控分类字段。

可以后置：

- Phase 2 当前 deterministic minimum 可以暂时保留，因为它只用于验证 Projection 生命周期。

## 6. deterministic id + EvidenceLink Review

当前实现：

```text
TimelineEvent.id = timeline_${evidenceId}
```

并通过 `MemoryEvidenceLink` 建立：

```text
Evidence -> TimelineEvent
Evidence -> TimelineEventVersion
```

结论：

- 对当前 MVP 的幂等验证足够。
- 不能长期完全替代 `projectionEvidenceId`。

优点：

- 不改 schema。
- 同一 evidenceId 重跑不会创建多个 TimelineEvent。
- ProjectionContext 可通过 EvidenceLink 或 deterministic id 找回当前投影。
- Version 通过 `operationId` 保持幂等。

不足：

- 目标表没有显式 `projectionEvidenceId`，可读性弱。
- deterministic id 把业务语义放进主键，后续如果要合并多个 Evidence 到同一个 TimelineEvent，会变得别扭。
- EvidenceLink 的唯一约束只能防止同一 evidence-target-role 重复 link，不能表达“同一个 Evidence 对 TimelineProjection 只能有一个 parent target”。
- 并发下 parent-level 幂等依赖 deterministic primary key，而不是明确 projection key。

必须修改：

- 在 Timeline 从 deterministic MVP 进入真实事件抽取前，增加 Timeline parent-level projection identity。推荐方向是 `TimelineEvent.projectionEvidenceId` 或 equivalent idempotency key 字段。

可以后置：

- 当前 Phase 2 minimum 可以继续使用 deterministic id。

## 7. TimelineEventVersion Review

### 7.1 修正

当前 schema 支持：

- `TimelineEventVersion.version`
- `changeType`
- `reason`
- `snapshot`
- `operationId`
- `currentVersionId`

Review：

- 足够支撑修正。
- 当前 Projection 只创建 version 1，没有修正路径。
- 后续用户修正或系统修正必须创建新 version，不得更新旧 version。

### 7.2 合并

当前 schema 支持：

- `mergedIntoEventId`
- `mergedEvents`
- version snapshot 中保存 merge 后状态。

Review：

- 能表达“当前 event 被合并到另一个 event”。
- 但缺少明确 merge operation 记录。`VersionHistory` 可承担审计索引，但当前 Projection 未写入。
- 合并时必须为受影响的每个 TimelineEvent 创建新 version。

### 7.3 拆分

当前 schema 支持：

- `splitFromEventId`
- `splitEvents`
- version snapshot 中保存 split 后状态。

Review：

- 能表达拆分 lineage。
- 拆分产生的新 event 仍需要自己的 EvidenceLink 和 version。
- 当前 deterministic id 基于 evidenceId，不适合一个 Evidence 拆出多个 events 的长期场景。

### 7.4 no-overwrite

当前 schema 支持：

- `TimelineEventVersion` 独立行。
- `@@unique([timelineEventId, version])`。
- `operationId @unique`。
- parent object 只移动 `currentVersionId`。

Review：

- schema 能支持 no-overwrite。
- 当前服务层对 version row 不更新、不删除。
- 数据库层没有禁止 update/delete；no-overwrite 仍依赖服务层约束和代码审查。

必须修改：

- 在实现修正、合并、拆分前，必须明确 Timeline version 创建服务，禁止业务代码直接更新 version row。

可以后置：

- DB trigger 或权限级不可变约束可后置。

## 8. Timeline As Input To Relationship Projection

PRD 要求 Relationship 保存：

- 身份
- 关系变化
- 互动频率
- 重要事件
- 冲突
- 支持
- 影响

并关联：

- Timeline
- Conversation
- Semantic Memory

当前 TimelineEvent schema 对 Relationship 有用的字段：

- `people`
- `conversationIds`
- `topics`
- `startDate`
- `description`
- `confidence`
- EvidenceLink

当前 TimelineProjection 的实际输出：

- 不写 `people`
- 不写 relationship-specific topic
- 不写 conflict/support/impact
- 只写 raw segment metadata

结论：

- 当前 Timeline schema 可作为 Relationship Projection 的输入。
- 当前 TimelineProjection 输出不适合作为 Relationship Projection 的主要输入。

必须修改：

- Relationship Projection 启动前，TimelineEvent 必须至少能稳定写入 `people`，或 Relationship Projection 必须直接消费 Entity/Relationship Evidence，而不是依赖当前 raw segment TimelineEvent。

可以后置：

- Relationship 进入 Phase 2 后半段再实现，不应现在从 raw segment TimelineEvent 强推关系。

## 9. Timeline As Input To Understanding Continuity

PRD 要求 Understanding Continuity 表达：

- 过去理解
- 当前理解
- 变化原因
- 证据变化
- 理解修正
- alternative hypothesis
- version history

Timeline 对 Understanding 的价值：

- 提供人生事件顺序。
- 提供事件持续性和结束状态。
- 提供人物、情绪、主题随时间变化。
- 提供 Conversation 与 Evidence 的追溯入口。

当前 TimelineEvent schema 可支撑：

- 时间排序：`startDate`
- 状态演进：`endStatus` / `status`
- 版本演进：`TimelineEventVersion`
- 事件 lineage：parent / merge / split
- 证据追溯：MemoryEvidenceLink

当前 TimelineProjection 不足：

- title / description 是 technical metadata，不是用户人生事件语义。
- topics 混入 eventType 和 algorithm。
- emotions / people 为空。
- 没有事件结束、修正、合并、拆分路径。

结论：

- Timeline schema 可以成为 Understanding Continuity 的输入。
- 当前 TimelineProjection 只能作为 Projection 生命周期证明，不能作为 Understanding Continuity 的高质量输入。

必须修改：

- Understanding Projection 启动前，Timeline Projection 至少需要支持从 Event Extraction Evidence 生成语义事件，而不是只从 RAW_SEGMENTATION Evidence 生成 raw segment event。

## 10. Migration Relationship With Existing Event / EmotionSlice

### 10.1 Existing Event

现有 `Event` 支持：

- `title`
- `description`
- `eventDate`
- `startTime`
- `endTime`
- `sourceMessageIds`
- `participants`
- `category`
- `importanceScore`
- `isCoreEvent`
- `status`
- `EmotionSlice[]`
- `EventRelation[]`

与 `TimelineEvent` 的关系：

- `Event` 更像 Memory V1 的 extracted event / core event 表。
- `TimelineEvent` 是 PRD v1.0 定义下的长期人生事件轴对象。
- `TimelineEvent` 有 version、currentVersion、merge/split lineage，长期能力更完整。

Review：

- 保留 `Event` 是合理的。
- 不应立即废弃 `Event`。
- 迁移应通过 Evidence，而不是 Event 直接写 Timeline。

合理迁移路径：

```text
Event / EmotionSlice
  -> Evidence(sourceKind = existing V1 object or migrated raw evidence)
  -> TimelineProjection
  -> TimelineEvent / TimelineEventVersion
```

当前 schema 的 `EvidenceSourceKind` 没有 `EVENT` / `EMOTION_SLICE`，因此 V1 到 V2 的正式迁移 Evidence 类型还未完备。

### 10.2 Existing EmotionSlice

现有 `EmotionSlice` 支持：

- `emotionType`
- `intensity`
- `valence`
- `arousal`
- `evidenceText`
- `sourceMessageId`
- optional `eventId`

与 `TimelineEvent.emotions` 的关系：

- `EmotionSlice` 是细粒度情绪记录。
- `TimelineEvent.emotions Json` 可保存事件级情绪摘要或引用。

Review：

- 不应把 `EmotionSlice` 直接塞入 `TimelineEvent.emotions` 后废弃。
- 更合理的是保留 EmotionSlice 作为 V1 source，后续通过 Evidence 生成 TimelineEvent emotion projection。

必须修改：

- 在正式 V1 -> V2 迁移前，补充 Evidence source/target 规则，明确 Event / EmotionSlice 如何变为 Evidence。

可以后置：

- Event / EmotionSlice 的批量迁移可后置到 Timeline semantic extraction 稳定后。

## 11. Required Changes

以下是进入真正 Timeline 语义阶段前必须修改的事项。

### 11.1 eventType 必须成为一等语义

当前 `eventType` 暂存 `topics/snapshot` 不能作为长期方案。

必须收敛为一个正式字段策略：

- 增加 `TimelineEvent.eventType` / `TimelineEventVersion.eventType`，并明确 `topics` 只保存用户事件主题。

Review 结论：推荐新增一等字段，但该 schema change 不属于本 review 执行范围。

### 11.2 Timeline parent-level projection identity 必须明确

当前 deterministic id 足够 MVP，但不适合长期投影身份。

必须增加或明确：

- `projectionEvidenceId`
- 或 `projectionKey`
- 或单独 projection result identity

目的：

- 支持一条 Evidence 一次 projection。
- 支持后续多 Evidence merge 到同一 TimelineEvent。
- 提高审计可读性。

### 11.3 TimelineEvent 不能长期由 RAW_SEGMENTATION 直接代表人生事件

当前 `RAW_SEGMENTATION` 只能说明“这条 RawMemory 被分段”，不是“用户人生事件已被抽取”。

必须在 Phase 2 Timeline 语义阶段引入更明确的 Evidence：

- Event Extraction Evidence
- Emotion Extraction Evidence
- Entity Extraction Evidence

并让 TimelineProjection 基于这些 Evidence 生成真正 TimelineEvent。

### 11.4 修正、合并、拆分前必须封装 Timeline version 写入服务

当前 version row schema 足够，但缺少专门服务约束。

必须保证：

- 每次 meaningful change 创建新 `TimelineEventVersion`。
- 不更新旧 version。
- current pointer 通过 parent row 更新。
- merge/split 涉及的每个 TimelineEvent 都有独立 version。

### 11.5 V1 Event / EmotionSlice 迁移必须先 Evidence 化

不允许：

```text
Event / EmotionSlice -> TimelineEvent
```

必须：

```text
Event / EmotionSlice -> Evidence -> TimelineProjection -> TimelineEvent
```

当前 Evidence enum 尚未覆盖 `EVENT` / `EMOTION_SLICE` source kind，这部分迁移前需要 schema 或 mapping 决策。

## 12. Deferrable Changes

以下事项可以后置，不阻塞当前 Phase 2 deterministic MVP。

### 12.1 duration / end status 推断

当前 projection 写 `endStatus=UNKNOWN` 是合理的。

可后置到 Event Extraction Evidence 可表达持续时间后实现。

### 12.2 people / emotions 写入

当前 RAW_SEGMENTATION Evidence 不包含这些信息，不应硬造。

可后置到 Entity Extraction / Emotion Extraction 完成后。

### 12.3 Timeline retrieval ranking

当前 TimelineProjection 只是写入对象，还未进入 response retrieval。

Timeline retrieval priority、importance ranking、recency ranking 可后置。

### 12.4 VersionHistory 写入

当前 `TimelineEventVersion` 已可审计。

统一 `VersionHistory` 索引可后置到多对象 rollback / audit UI 前。

### 12.5 DB-level no-update/no-delete enforcement

当前 no-overwrite 依赖服务层。

DB trigger、权限隔离、migration guard 可后置。

## 13. Not Recommended Changes

### 13.1 不建议让 RawMemory 直接写 TimelineEvent

这违反 Projection Pipeline 契约和 PRD Evidence 约束。

当前路径应保持：

```text
RawMemory -> Evidence -> TimelineProjection
```

### 13.2 不建议立即废弃 Event / EmotionSlice

`Event` / `EmotionSlice` 仍是现有 Memory V1 的数据来源和兼容资产。

应该保留并通过 Evidence 化迁移，而不是直接删除或替换。

### 13.3 不建议把 TimelineEvent 做成聊天时间轴

ChatMessage 时间只能作为 source timestamp。

Timeline 的目标是人生事件轴。后续如果 Evidence 提到“上个月发生的事”，TimelineEvent 应使用事件发生日期，而不是消息创建日期。

### 13.4 不建议长期把技术 metadata 当用户主题

`algorithm`、`segmentCount`、`evidenceType` 不应长期存在于 `topics`。

这些信息应保留在 Evidence、projection metadata 或 version snapshot 中。

### 13.5 不建议让 Understanding / Relationship 依赖当前 raw segment event

当前 raw segment TimelineEvent 缺少 people、emotion、semantic topic。

Understanding / Relationship 可以等待 Event / Entity / Emotion Evidence 后再消费 Timeline。

## 14. Final Review Conclusion

当前 `TimelineProjection` 是合格的 Phase 2 minimum projection：

- 遵守 Evidence-only input。
- 不让 RawMemory 直接写 Timeline。
- 能创建 TimelineEvent。
- 能创建 TimelineEventVersion。
- 能设置 currentVersionId。
- 能创建 EvidenceLink。
- 能保持重复执行幂等。
- 不影响 SemanticProjection。
- 不启动 Understanding / Relationship。

但它尚不满足 PRD 对 Timeline 的长期完整定位。

关键缺口：

- `eventType` 不是一等字段。
- deterministic id 不能长期替代 parent-level projection identity。
- 当前事件语义来自 RAW_SEGMENTATION metadata，不是 Event Extraction。
- people / emotions / duration / end status / merge / split 尚未进入 projection 行为。
- V1 Event / EmotionSlice 迁移还未 Evidence 化。

下一步进入 Timeline 语义建设前，应优先处理：

1. 明确 `TimelineEvent` 的 event type / projection identity schema 策略。
2. 引入 Event Extraction Evidence，避免把 raw segment 当人生事件。
3. 封装 Timeline version mutation 服务，为修正、合并、拆分做 no-overwrite 地基。
