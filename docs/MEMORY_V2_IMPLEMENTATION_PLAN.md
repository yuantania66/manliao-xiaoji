# Memory V2 Implementation Plan

## 1. Scope and Constraints

本文档定义 SlowTalk Notes Memory V2 的工程实施计划。

约束来源：

- SlowTalk Notes PRD v1.0 第 11-25 节。
- `docs/PRODUCT_ARCHITECTURE_V1.md`。
- `docs/MEMORY_MENTAL_MODEL_LAYER.md`。
- `docs/CONVERSATION_OS_V1.md`。
- `docs/SAFETY_GOVERNANCE_LAYER.md`。

硬性约束：

- 不新增新的产品架构层。
- Memory V2 只属于既有 `Memory & Mental Model Layer`。
- 实时回复仍遵循既有链路：`Conversation Layer -> Clinical Logic Layer -> Memory Injection -> Response Generation -> Governance & Safety`。
- Conversation OS 不扩张为长期记忆容器。
- Safety 优先级高于 Clinical Logic 和 Memory Injection。
- 长期理解必须可追溯、可修正、可版本化、可删除、可导出。
- Raw Memory append-only，不允许原地修改。
- Semantic Memory、Understanding、Timeline、Relationship、Assessment、Report 均不得脱离 Evidence。
- Assessment 是长期观察结果，不是医学诊断。
- Report 是长期理解结果，不是聊天总结。
- Notes 与 Conversation 进入同一 Memory Pipeline。

本文档只产出设计和 schema 草案，不修改现有代码。

## 2. Current Implementation Baseline

当前代码中已经存在以下相关对象和服务：

- `ChatSession` / `ChatMessage`：保存会话与消息。
- `Note`：保存用户主动记录的小记。
- `Fact`：保存从聊天或小记中提取出的事实片段。
- `ExperienceSlice`：保存情绪、身体信号、行为、持续时间等体验片段。
- `Interpretation`：保存基于事实的解释性理解。
- `Hypothesis`：保存低置信长期假设。
- `Event` / `EmotionSlice` / `EventRelation`：保存基础事件、情绪切片和事件关系。
- `UnderstandingGraphNode` / `UnderstandingGraphEdge`：保存基础理解图谱。
- `services/understanding/extractService.ts`：从单条消息中提取 `facts`、`experiences`、`interpretations`、`people`、`topics`。
- `services/understanding/hypothesisService.ts`：基于提取结果更新 `Hypothesis` 和 `UnderstandingGraph`。
- `services/understanding/retrievalService.ts`：检索近期记忆、相似记忆、核心事件、活跃假设、反证和用户反馈。
- `services/ai/promptBuilder.ts`：将结构化检索结果注入 prompt。

当前实现已经具备 Memory V1 的雏形，但尚未满足 PRD 第 11-25 节要求：

- Raw Memory 尚未作为独立 append-only 对象建模。
- Evidence 尚未成为所有长期理解的统一约束。
- Semantic Memory 尚未独立于 `Fact` / `Hypothesis` 建模。
- Understanding Continuity 尚未形成可版本化对象。
- Timeline 与用户人生事件轴的职责尚未和普通 `Event` 完全区分。
- Relationship 尚未作为长期关系对象建模，目前主要存在于 `UnderstandingGraphNode(type=PERSON)`。
- Refinement Pipeline 尚未异步任务化、可重跑、可审计。
- Version History 尚未统一存在。
- 用户删除、导出、撤销、派生理解失效尚未形成统一机制。

## 3. PRD 11-25 Gap Mapping

### 11. Raw Memory

PRD 要求：

- 保存未经解释的数据。
- 包括 Conversation、Notes、Metadata、Timestamp、Session、Message Sequence。
- Raw Memory 永不修改，只允许追加。
- 后续理解均引用 Raw Memory。

当前映射：

- `ChatMessage` 保存聊天原文、role、session、createdAt。
- `ChatSession` 保存会话级信息。
- `Note` 保存小记原文、recordDate、mediaUrls、draft 状态。

差距：

- `ChatMessage` / `Note` 是业务源对象，不是统一 Raw Memory。
- 没有统一 `rawMemoryId`。
- 没有 message sequence。
- 没有 append-only 约束字段。
- Notes 与 Conversation 尚未统一进入同一 Raw Memory 入口。
- 后续 `Fact` / `ExperienceSlice` 通过 `sourceType/sourceId` 引用源对象，但没有统一 Evidence。

Memory V2 决策：

- 新增 `RawMemory` 作为统一原始数据账本。
- `ChatMessage` 和 `Note` 保留为业务对象。
- `RawMemory` 引用业务对象，不替代业务对象。
- 所有派生对象必须通过 `Evidence` 间接或直接回指 `RawMemory`。

### 12. Semantic Memory

PRD 要求：

- 保存异步理解后的长期知识。
- 包括主题、兴趣、偏好、价值观、长期目标、行为模式、应对方式、重要关系、重要事件。
- 必须包含 Evidence、Confidence、Source、Version、Last Updated。
- 可修正，不覆盖历史。

当前映射：

- `Fact` 保存事实。
- `ExperienceSlice` 保存体验。
- `Interpretation` 保存解释。
- `Hypothesis` 保存低置信长期假设。
- `UnderstandingGraphNode` 可表达 PERSON、EVENT、EMOTION、TOPIC、HYPOTHESIS、VALUE、COPING_METHOD。

差距：

- 长期语义知识没有统一对象。
- `Hypothesis` 有置信度和证据 ID，但证据 ID 指向 `Fact`，不是统一 Evidence。
- `Fact` / `ExperienceSlice` / `Interpretation` 没有版本。
- `UnderstandingGraphNode` 更像索引，不适合作为主长期知识记录。

Memory V2 决策：

- 新增 `SemanticMemory` 作为长期知识主表。
- `Fact` / `ExperienceSlice` / `Hypothesis` 在 Phase 1 保留，并逐步映射到 `SemanticMemory`。
- `SemanticMemory` 通过 `Evidence` 关联 Raw Memory。
- 所有修正通过 `VersionHistory` 追加，不覆盖历史。

### 13. Async Semantic Refinement

PRD 要求：

Pipeline：

`Raw Memory -> Segmentation -> Entity Extraction -> Emotion Extraction -> Event Extraction -> Relationship Update -> Timeline Update -> Understanding Update -> Semantic Memory Update -> Index`

所有步骤可独立重跑，结果支持版本化。

当前映射：

- `extractUnderstandingFromMessage` 同步或近实时从单条消息提取结构化结果。
- `writeUnderstandingExtraction` 写入 `Fact`、`ExperienceSlice`、`Interpretation`。
- `updateUnderstandingHypotheses` 更新 `Hypothesis` 和 `UnderstandingGraph`。
- `buildStructuredRagContext` 检索结构化记忆。

差距：

- 没有任务表。
- 没有 segment 对象。
- 没有可重跑 step 状态。
- Pipeline 不是完整异步。
- 抽取结果没有统一版本。
- Relationship / Timeline / Understanding / Semantic Memory 更新没有明确分步边界。

Memory V2 决策：

- 新增 `RefinementJob`。
- Phase 1 MVP Pipeline 收敛为同轮回复链路与异步长期理解链路：

```text
Same-turn: Current Message -> Safety -> Clinical Logic -> Retrieval(previous completed memory) -> Response Injection -> Generation
Async: RawMemory -> Segmentation -> Extraction -> Evidence -> MemoryEvidenceLink -> SemanticMemory/Timeline/Understanding -> future Retrieval
```

- Entity / Emotion / Event / Relationship 等细分步骤保留为 `RefinementJob.step`，Phase 1 只实现必要子集。

### 14. Timeline

PRD 要求：

- Timeline 是用户人生事件轴，不是聊天时间轴。
- 保存事件、日期、持续时间、结束状态、关联人物、关联情绪、关联主题、关联 Conversation。
- 支持新增、结束、修正、合并、拆分、关联。

当前映射：

- `Event` 保存 title、description、eventDate、startTime、endTime、sourceMessageIds、participants、category、importanceScore、isCoreEvent、status。
- `EmotionSlice` 可关联 `Event`。
- `EventRelation` 可关联事件。

差距：

- `Event` 更偏日历/核心事件，不完全表达 Timeline 的版本化、合并、拆分、修正。
- `sourceMessageIds` 是 Json，不是 Evidence。
- 没有明确 conversation 关联对象。
- 没有 timeline-specific merge/split lineage。

Memory V2 决策：

- 新增 `TimelineEvent` 作为 PRD 语义下的用户人生事件轴。
- `Event` Phase 1 保留，并作为旧事件来源映射。
- Phase 2 后可将 `Event` 降级为兼容表或逐步废弃。

### 15. Relationship

PRD 要求：

- 保存人与人的长期关系。
- 包括家庭、朋友、恋人、同事、宠物、其他重要对象。
- 保存身份、关系变化、互动频率、重要事件、冲突、支持、影响。
- 必须关联 Timeline、Conversation、Semantic Memory。

当前映射：

- `UnderstandingGraphNode(type=PERSON)` 表达人物节点。
- `UnderstandingGraphEdge` 表达 PERSON 与 EVENT/TOPIC/EMOTION 的关系。
- `Fact.people` 保存人物数组。
- `Event.participants` 保存参与者 Json。

差距：

- 没有 Relationship 主对象。
- 没有关系身份、互动频率、支持/冲突/影响等字段。
- 没有关系变化历史。
- 与 Timeline、Conversation、Semantic Memory 的关系未结构化。

Memory V2 决策：

- 新增 `Relationship` 作为长期关系主表。
- `UnderstandingGraphNode(type=PERSON)` Phase 1 保留为检索索引。
- Relationship 更新在 Phase 2 做完整化，Phase 1 只保存基本身份和证据。

### 16. Understanding Continuity

PRD 要求：

- 目标是理解持续演化，不是重复总结。
- 包括过去理解、当前理解、变化原因、证据变化、理解修正。
- 必须包含 Understanding、Confidence、Evidence、Alternative Hypothesis、Version、History。
- AI 可以说“我以前理解错了”。

当前映射：

- `Hypothesis` 保存低置信长期假设、支持证据、反证、状态。
- `conversation-os/types.ts` 定义 `UnderstandingState`，用于实时对话。
- `retrievalService` 返回 active hypotheses 和 counterEvidence。

差距：

- 没有持久化 `Understanding` 主对象。
- 没有替代假设字段。
- `UnderstandingState` 是实时状态，不是长期连续性对象。
- 理解修正没有统一历史。

Memory V2 决策：

- 新增 `Understanding`。
- `Hypothesis` Phase 1 保留，并映射到 `Understanding(type=HYPOTHESIS)`。
- `Understanding` 作为长期连续性的主对象，`VersionHistory` 保存演进。

### 17. Response Generation

PRD 要求：

回复流程：

`Conversation -> Safety -> Clinical Logic -> Memory Injection -> Response Planning -> Generation -> Quality Check -> Output`

Response 不直接读取 Raw Chat，优先读取 Understanding、Timeline、Relationship、Semantic Memory。

当前映射：

- `promptBuilder.ts` 已将 `StructuredRagContext` 注入 prompt。
- `buildStructuredRagContext` 检索 `Fact`、`ExperienceSlice`、`Note`、`Event`、`Hypothesis`、Feedback。
- `sanitizeChatHistory` 仍会携带近期聊天上下文。

差距：

- Memory Injection 当前读取 `Fact` / `ExperienceSlice` / `Hypothesis`，不是 V2 主对象。
- 近期聊天仍直接进入 prompt，符合实时对话需要，但长期理解不能直接由 Raw Chat 替代。
- Quality Check 未形成独立对象或明确检查项。

Memory V2 决策：

- Phase 1 Response Injection 继续复用 `StructuredRagContext` 接口。
- 数据源逐步切换到 `Understanding`、`TimelineEvent`、`Relationship`、`SemanticMemory`。
- 近期聊天只作为当前轮对话上下文，不作为长期理解替代。

### 18. Notes

PRD 要求：

- Notes 与 Chat 等价。
- Notes 是主动记录，Conversation 是互动记录。
- 两者最终进入统一 Memory Pipeline。
- Notes 支持标签、日期、图片、语音、关联事件、关联人物、关联 Timeline。

当前映射：

- `Note` 保存 content、mood、mediaUrls、recordDate、coreEventIds、emotionSliceIds、generatedFromChatIds。
- `sourceType=NOTE` 已可进入 `Fact` / `ExperienceSlice`。

差距：

- Note 未统一进入 `RawMemory`。
- 标签、人物、Timeline 关联不完整。
- 图片、语音未来能力未进入 pipeline contract。

Memory V2 决策：

- `Note` 保留。
- 新建或保存 Note 时追加 `RawMemory(kind=NOTE)`。
- Note 的图片/语音先放入 `RawMemory.metadata` 和 `Note.mediaUrls`，Phase 3 再做多模态提取。

### 19. Reports

PRD 要求：

- Report 不是聊天总结。
- Report 是长期理解结果。
- 包括近期变化、长期变化、重要事件、关系变化、情绪变化、行为变化、价值变化、成长轨迹、理解修正。
- 必须引用 Evidence，不得虚构。

当前映射：

- 当前没有 Report 模型。
- `NIGHTLY_REPORT.md` 是工程/项目报告，不是用户长期理解报告。

差距：

- 没有用户级报告对象。
- 没有 evidence-backed report section。

Memory V2 决策：

- Report 不进入 Phase 1。
- Phase 3 基于 `SemanticMemory`、`TimelineEvent`、`Relationship`、`Understanding` 和 `Evidence` 生成。
- 不允许直接基于 Raw Chat 生成报告。

### 20. Assessment

PRD 要求：

- Assessment 为长期观察结果，不是医学诊断。
- 包括压力变化、恢复能力、社交变化、生活规律、目标推进、长期稳定性。
- 永远可撤销、可修正、不可定性、不可贴标签。

当前映射：

- `Hypothesis` 可表达部分长期观察。
- `ExperienceSlice` 可表达压力、恢复等片段。

差距：

- 没有 Assessment 对象。
- 没有非诊断边界字段。
- 没有撤销/修正历史。

Memory V2 决策：

- Assessment 不进入 Phase 1。
- Phase 3 作为特殊 `SemanticMemory(kind=ASSESSMENT)` 或独立 `Assessment` 表实现。
- 所有 Assessment 必须引用 Evidence 和 VersionHistory。

### 21. Data Objects

PRD 要求：

核心对象：

- Conversation
- Message
- Session
- Raw Memory
- Semantic Memory
- Timeline Event
- Relationship
- Understanding
- Assessment
- Report

所有对象 Versioned、Traceable、Auditable。

当前映射：

- Conversation: `ChatSession`
- Message: `ChatMessage`
- Session: `Session`
- Raw Memory: 缺失
- Semantic Memory: 缺失
- Timeline Event: `Event` 部分满足
- Relationship: `UnderstandingGraphNode/Edge` 部分满足
- Understanding: `Hypothesis` 部分满足
- Assessment: 缺失
- Report: 缺失

差距：

- Versioning、Traceability、Auditability 未统一。

Memory V2 决策：

- Phase 1 新增核心 Memory 对象：`RawMemory`、`Evidence`、`SemanticMemory`、`Understanding`、`TimelineEvent`、`Relationship`、`VersionHistory`、`RefinementJob`。
- Assessment / Report 延后到 Phase 3。
- 审计先通过 `VersionHistory` 和 `RefinementJob` 覆盖 Memory 写入链路，产品级访问审计后续进入 Governance & Safety Layer。

### 22. Understanding Rules

PRD 要求：

- 来源明确。
- 证据充分。
- 允许修正。
- 允许冲突。
- 允许未知。
- 不为了回答制造理解。

当前映射：

- `Hypothesis` 有 supporting/counter evidence。
- Prompt 中已有“不要把假设当事实”的约束。
- Extraction 有 confidence。

差距：

- 证据不是统一对象。
- 未知没有长期对象。
- 冲突理解没有一等表达。
- 修正历史不完整。

Memory V2 决策：

- `Understanding` 支持 `alternativeHypotheses`、`unknowns`、`status`。
- `Evidence` 支持 `weight`、`confidence`、`status`。
- `VersionHistory` 记录修正原因和旧值摘要。

### 23. Evidence System

PRD 要求：

- 所有长期理解必须绑定证据。
- Evidence 来源包括 Conversation、Notes、Timeline、Relationship。
- 保存 Source、Time、Confidence、Weight。
- Evidence 可失效、可更新。

当前映射：

- `Fact.sourceType/sourceId`。
- `Event.sourceMessageIds`。
- `EmotionSlice.sourceMessageId`。
- `Hypothesis.supportingEvidenceIds/counterEvidenceIds`。
- `UnderstandingGraphEdge.evidenceId`。

差距：

- Evidence 分散在多个表。
- `evidenceId` 多数指向 `Fact`，不是 evidence record。
- 无统一失效机制。

Memory V2 决策：

- 新增 `Evidence`。
- 所有 V2 长期对象必须通过 Evidence 关联 Raw Memory 或其他 V2 对象。
- 旧对象在 Phase 1 通过迁移映射产生 Evidence。

### 24. Version System

PRD 要求：

- 所有长期理解具有 Version、Created Time、Updated Time、History、Rollback。
- 不存在覆盖，只有演进。

当前映射：

- 多数表有 `createdAt` / `updatedAt`。
- `Hypothesis.status` 可表达 active/weakened/rejected/merged。

差距：

- 没有统一 version 字段。
- 更新会覆盖当前记录。
- 没有回滚历史。

Memory V2 决策：

- 新增 `VersionHistory`。
- V2 主对象包含 `version`。
- 对长期对象的每次语义修改必须追加 `VersionHistory`。
- Phase 1 不实现 UI rollback，但保留 rollback 所需数据。

### 25. Privacy

PRD 要求：

- 用户数据默认私有。
- 用户拥有查看、删除、导出、撤销权限。
- 支持数据隔离、权限控制、加密存储、删除恢复策略。

当前映射：

- 主要对象按 `userId` 隔离。
- 用户、会话、消息、Note 等存在 Cascade 删除。
- Safety 文档规定删除派生结构、敏感数据隔离、训练数据隔离。

差距：

- 没有 V2 对象级撤销状态。
- 没有导出 contract。
- 没有派生理解统一失效。
- 加密存储未在 schema 层表达。

Memory V2 决策：

- RawMemory 原始记录不更新、不删除；删除、撤销、redaction 通过 append-only tombstone / redaction 事件表达。
- 原始数据与可见状态分离：检索和 refinement 通过 RawMemory lifecycle event 判断可见性，不修改 RawMemory 本体。
- V2 长期投影对象包含 lifecycle `status`，但每次语义变化必须追加 VersionHistory。
- `Evidence.status=INVALIDATED` 后，关联长期理解必须重新计算、失效或降置信。
- Phase 1 设计删除传播规则。
- 加密存储和恢复策略进入 Phase 3/治理实施，不在本 schema 草案中直接实现。

## 4. Core Object Design

### 4.1 RawMemory

职责：

- 保存未经解释的原始输入。
- 统一 Conversation 和 Notes。
- 作为所有长期理解的 ground truth。
- 真正 append-only。

关键字段：

- `id`
- `userId`
- `kind`: `CONVERSATION_MESSAGE` / `NOTE` / `METADATA`
- `sourceType`: `CHAT_MESSAGE` / `NOTE` / `SESSION` / `SYSTEM`
- `sourceId`
- `sourceRevision`
- `revisionOfRawMemoryId`
- `sessionId`
- `conversationId`
- `messageSequence`
- `role`
- `content`
- `metadata`
- `occurredAt`
- `createdAt`
- `appendOnlyHash`

规则：

- RawMemory 本体不允许 update。
- RawMemory 本体不允许 delete。
- 原始 `content` 不允许 redaction-in-place。
- 删除、撤销、redaction、导出请求只能通过 `RawMemoryEvent` 追加表达。
- 原始数据与可见状态分离：retrieval、refinement、export 必须根据 `RawMemoryEvent` 判断当前可见性。
- 后续对象不得直接引用 `ChatMessage` 或 `Note` 作为证据，必须经过 `Evidence` 和 `MemoryEvidenceLink`。

### 4.2 RawMemoryEvent

职责：

- 以 append-only 方式表达 RawMemory 的可见状态变化。
- 支持删除权、撤销权、redaction、导出审计。

关键字段：

- `id`
- `userId`
- `rawMemoryId`
- `eventType`: `CREATED` / `TOMBSTONED` / `REDACTION_REQUESTED` / `REDACTED` / `EXPORT_REQUESTED` / `RESTORED`
- `reason`
- `metadata`
- `createdBy`: `SYSTEM` / `USER`
- `createdAt`

规则：

- `RawMemoryEvent` 只追加，不覆盖。
- Phase 1 的删除语义是追加 `TOMBSTONED`，不是更新 RawMemory。
- Governance & Safety Layer 后续可以执行物理删除或加密擦除，但必须保留不含明文的审计事件。

### 4.3 Evidence

职责：

- 统一表达所有长期理解的证据。
- 连接 Raw Memory、Timeline、Relationship、Semantic Memory、Understanding。
- 支持失效、降权、撤销。

关键字段：

- `id`
- `userId`
- `sourceKind`: `RAW_MEMORY` / `TIMELINE_EVENT` / `RELATIONSHIP` / `SEMANTIC_MEMORY` / `UNDERSTANDING`
- `sourceId`
- `rawMemoryId`
- `evidenceText`
- `occurredAt`
- `confidence`
- `weight`
- `status`: `ACTIVE` / `INVALIDATED` / `SUPERSEDED` / `REVOKED`
- `createdAt`
- `updatedAt`

规则：

- Phase 1 只创建 `sourceKind=RAW_MEMORY` 的 Evidence。
- Evidence 是一等对象，不是 Json ID。
- Evidence 状态可以变化，但状态变化必须写入 `VersionHistory` 或后续治理审计。
- 每条可进入长期理解的 Evidence 必须能追溯到 RawMemory。
- 非 RawMemory Evidence 放到 Phase 2；任何派生 Evidence 必须能传递追溯到至少一条 RawMemory Evidence，并禁止循环引用。

### 4.4 MemoryEvidenceLink

职责：

- 作为 Evidence 与长期对象之间的主关联表。
- 替代 `evidenceIds Json`。
- 支持证据角色、反证、修正证据和失效传播。

关键字段：

- `id`
- `userId`
- `evidenceId`
- `targetType`: `SEMANTIC_MEMORY` / `UNDERSTANDING` / `TIMELINE_EVENT` / `RELATIONSHIP` / `VERSION_HISTORY` / `REPORT` / `ASSESSMENT`
- `targetId`
- `role`: `SUPPORTING` / `COUNTER` / `SOURCE` / `CORRECTION`
- `createdAt`

规则：

- `SemanticMemory`、`Understanding`、`TimelineEvent`、`Relationship` 进入 retrieval 或 response context 前，必须至少有一条有效 `MemoryEvidenceLink`。
- Json evidence cache 只能作为可选冗余，不是 source of truth。
- Evidence invalidation 必须通过 `MemoryEvidenceLink` 找到受影响的长期对象。

### 4.5 VersionHistory

职责：

- 保存长期理解对象的不可覆盖版本历史。
- 支持 no-overwrite、回滚基础、理解修正和“我以前理解错了”。

关键字段：

- `id`
- `userId`
- `targetType`: `SEMANTIC_MEMORY` / `UNDERSTANDING` / `TIMELINE_EVENT` / `RELATIONSHIP` / `EVIDENCE` / `ASSESSMENT` / `REPORT`
- `targetId`
- `version`
- `changeType`: `CREATED` / `UPDATED` / `CORRECTED` / `WEAKENED` / `REJECTED` / `MERGED` / `SPLIT` / `ARCHIVED` / `ROLLBACK`
- `reason`
- `snapshot`
- `operationId`
- `createdBy`: `SYSTEM` / `USER`
- `createdAt`

规则：

- `VersionHistory` 本身 append-only，不更新旧 version。
- 每次理解变化创建新的 `VersionHistory` row。
- 旧 version 不覆盖、不删除。
- 当前版本通过长期对象投影表上的 `currentVersion` 指针表达。
- 所有 `SemanticMemory`、`Understanding`、`TimelineEvent`、`Relationship` 投影更新必须与新增 `VersionHistory` 在同一事务内完成。
- `VersionHistory.version` 必须等于投影对象更新后的 `currentVersion`。
- `operationId` 用于 retry 幂等，避免重复版本。

### 4.6 SemanticMemory

职责：

- 保存长期语义知识的当前投影。
- 表达主题、兴趣、偏好、价值观、长期目标、行为模式、应对方式、重要关系、重要事件。

关键字段：

- `id`
- `userId`
- `kind`: `TOPIC` / `INTEREST` / `PREFERENCE` / `VALUE` / `LONG_TERM_GOAL` / `BEHAVIOR_PATTERN` / `COPING_METHOD` / `IMPORTANT_RELATIONSHIP` / `IMPORTANT_EVENT` / `ASSESSMENT`
- `title`
- `content`
- `confidence`
- `source`
- `currentVersion`
- `status`: `ACTIVE` / `WEAKENED` / `REJECTED` / `MERGED` / `USER_CORRECTED` / `ARCHIVED`
- `lastUpdatedAt`
- `createdAt`
- `updatedAt`

规则：

- `SemanticMemory` 是当前投影，不是历史本体。
- 历史由 `VersionHistory` 保存。
- 证据由 `MemoryEvidenceLink` 保存。
- 一次聊天或一条 Note 中出现的普通 topic 不得直接固化为 `SemanticMemory(kind=TOPIC)`。
- Phase 1 只有重复证据、明确用户确认或高置信明确恢复方式/重要事件，才能创建 SemanticMemory。

### 4.7 Understanding

职责：

- 保存持续演化的理解线程当前投影。
- 表达开放问题、当前理解、替代假设、证据变化、理解修正。

关键字段：

- `id`
- `userId`
- `title`
- `understanding`
- `category`
- `confidence`
- `alternativeHypotheses`
- `unknowns`
- `relatedTimelineEventIds`
- `relatedRelationshipIds`
- `relatedSemanticMemoryIds`
- `currentVersion`
- `status`: `OPEN` / `PAUSED` / `DEEPENING` / `USER_CORRECTED` / `CLOSED` / `REJECTED` / `MERGED`
- `lastTouchedAt`
- `createdAt`
- `updatedAt`

规则：

- `Understanding` 是当前投影，不是聊天摘要。
- 允许冲突理解共存。
- 未知、替代假设和反证必须通过 `MemoryEvidenceLink(role=COUNTER|CORRECTION)` 表达。
- 可以被用户关闭、修正或撤销。
- AI 回复中引用时必须保持低断言强度。

### 4.8 TimelineEvent

职责：

- 保存用户人生事件轴当前投影。
- 不是聊天时间轴。
- 支持事件新增、结束、修正、合并、拆分、关联。

关键字段：

- `id`
- `userId`
- `title`
- `description`
- `startDate`
- `endDate`
- `durationText`
- `endStatus`: `ONGOING` / `ENDED` / `UNKNOWN`
- `people`
- `emotions`
- `topics`
- `conversationIds`
- `parentEventId`
- `mergedIntoEventId`
- `splitFromEventId`
- `confidence`
- `importanceScore`
- `currentVersion`
- `status`: `ACTIVE` / `USER_CORRECTED` / `ARCHIVED` / `MERGED`
- `createdAt`
- `updatedAt`

规则：

- 只记录对用户生活理解有长期意义的事件。
- 不把每条聊天都写成 TimelineEvent。
- TimelineEvent 必须通过 `MemoryEvidenceLink` 回指 Evidence。
- Phase 1 TimelineEvent eligibility：
  - fact 有明确 `occurredAt`，且包含 people/topics/emotion 中至少一种；
  - 或 fact confidence >= 0.7，且 topic 属于 work/family/relationship/health/recovery；
  - 或消息/小记明确表示持续时间、开始、结束、反复发生；
  - 或未来 UI 中用户主动标记为重要。

### 4.9 Relationship

职责：

- 保存用户与重要对象的长期关系当前投影。
- 表达身份、关系变化、互动频率、重要事件、冲突、支持、影响。

关键字段：

- `id`
- `userId`
- `displayName`
- `relationshipType`: `FAMILY` / `FRIEND` / `ROMANTIC` / `COLLEAGUE` / `PET` / `OTHER`
- `identityLabel`
- `interactionFrequency`
- `supportSignals`
- `conflictSignals`
- `influenceSummary`
- `relatedTimelineEventIds`
- `relatedSemanticMemoryIds`
- `confidence`
- `currentVersion`
- `status`: `ACTIVE` / `WEAKENED` / `USER_CORRECTED` / `ARCHIVED` / `MERGED`
- `createdAt`
- `updatedAt`

规则：

- 不基于一次提及确认关系类型。
- Phase 1 只创建最小 Relationship：
  - extraction 有明确 people；
  - `displayName` 来自用户原文；
  - `relationshipType=OTHER`，除非用户明确说“妈妈/同事/朋友/伴侣/宠物”等；
  - 未明确身份时 `confidence <= 0.5`；
  - 必须通过 `MemoryEvidenceLink` 关联 Evidence。
- Relationship 进入 Phase 1 Response Injection 必须同时满足：
  - 与当前 retrieval intent 的 people 匹配；
  - `confidence >= 0.5`；
  - 有有效 Evidence。

### 4.10 RefinementJob

职责：

- 承载 post-session async semantic refinement。
- 让 Pipeline 可重跑、可审计、可独立失败恢复。

关键字段：

- `id`
- `userId`
- `rawMemoryId`
- `parentJobId`
- `segmentKey`
- `pipelineVersion`
- `step`: `SEGMENTATION` / `EXTRACTION` / `EVIDENCE` / `SEMANTIC_MEMORY` / `TIMELINE` / `RELATIONSHIP` / `UNDERSTANDING` / `INDEX`
- `status`: `PENDING` / `RUNNING` / `SUCCEEDED` / `FAILED` / `SKIPPED` / `RETRYING`
- `attempt`
- `operationId`
- `inputSnapshot`
- `outputSnapshot`
- `error`
- `startedAt`
- `finishedAt`
- `createdAt`
- `updatedAt`

规则：

- 一个 RawMemory 可以产生多个 RefinementJob。
- Phase 1 `segmentKey = rawMemoryId`，不能为空。
- 后续 step 必须读取 `parentJob.outputSnapshot`，不能只凭 rawMemoryId 猜上游输出。
- `operationId` 用于 retry 幂等。
- 失败不阻塞实时聊天。

## 5. Prisma Schema Draft

以下为草案，不在本阶段修改 `prisma/schema.prisma`。

```prisma
enum RawMemoryKind {
  CONVERSATION_MESSAGE
  NOTE
  METADATA
}

enum RawMemorySourceType {
  CHAT_MESSAGE
  NOTE
  SESSION
  SYSTEM
}

enum RawMemoryEventType {
  CREATED
  TOMBSTONED
  REDACTION_REQUESTED
  REDACTED
  EXPORT_REQUESTED
  RESTORED
}

enum MemoryActor {
  SYSTEM
  USER
}

enum EvidenceSourceKind {
  RAW_MEMORY
  TIMELINE_EVENT
  RELATIONSHIP
  SEMANTIC_MEMORY
  UNDERSTANDING
}

enum EvidenceStatus {
  ACTIVE
  INVALIDATED
  SUPERSEDED
  REVOKED
}

enum EvidenceTargetType {
  SEMANTIC_MEMORY
  UNDERSTANDING
  TIMELINE_EVENT
  RELATIONSHIP
  VERSION_HISTORY
  REPORT
  ASSESSMENT
}

enum EvidenceRole {
  SUPPORTING
  COUNTER
  SOURCE
  CORRECTION
}

enum SemanticMemoryKind {
  TOPIC
  INTEREST
  PREFERENCE
  VALUE
  LONG_TERM_GOAL
  BEHAVIOR_PATTERN
  COPING_METHOD
  IMPORTANT_RELATIONSHIP
  IMPORTANT_EVENT
  ASSESSMENT
}

enum SemanticMemoryStatus {
  ACTIVE
  WEAKENED
  REJECTED
  MERGED
  USER_CORRECTED
  ARCHIVED
}

enum UnderstandingStatus {
  OPEN
  PAUSED
  DEEPENING
  USER_CORRECTED
  CLOSED
  REJECTED
  MERGED
}

enum TimelineEventEndStatus {
  ONGOING
  ENDED
  UNKNOWN
}

enum TimelineEventStatus {
  ACTIVE
  USER_CORRECTED
  ARCHIVED
  MERGED
}

enum RelationshipType {
  FAMILY
  FRIEND
  ROMANTIC
  COLLEAGUE
  PET
  OTHER
}

enum RelationshipStatus {
  ACTIVE
  WEAKENED
  USER_CORRECTED
  ARCHIVED
  MERGED
}

enum VersionTargetType {
  SEMANTIC_MEMORY
  UNDERSTANDING
  TIMELINE_EVENT
  RELATIONSHIP
  EVIDENCE
  ASSESSMENT
  REPORT
}

enum VersionChangeType {
  CREATED
  UPDATED
  CORRECTED
  WEAKENED
  REJECTED
  MERGED
  SPLIT
  ARCHIVED
  ROLLBACK
}

enum RefinementStep {
  SEGMENTATION
  EXTRACTION
  EVIDENCE
  SEMANTIC_MEMORY
  TIMELINE
  RELATIONSHIP
  UNDERSTANDING
  INDEX
}

enum RefinementStatus {
  PENDING
  RUNNING
  SUCCEEDED
  FAILED
  SKIPPED
  RETRYING
}

// Add these relation fields to the existing User model.
// Existing User fields stay unchanged.
// rawMemories         RawMemory[]
// rawMemoryEvents     RawMemoryEvent[]
// evidenceRecords     Evidence[]
// memoryEvidenceLinks MemoryEvidenceLink[]
// semanticMemories    SemanticMemory[]
// understandings      Understanding[]
// timelineEventsV2    TimelineEvent[]
// relationships       Relationship[]
// versionHistories    VersionHistory[]
// refinementJobs      RefinementJob[]

model RawMemory {
  id                    String              @id @default(cuid())
  userId                String
  kind                  RawMemoryKind
  sourceType            RawMemorySourceType
  sourceId              String
  sourceRevision        Int                 @default(1)
  revisionOfRawMemoryId String?
  sessionId             String?
  conversationId        String?
  messageSequence       Int?
  role                  MessageRole?
  content               String
  metadata              Json?
  occurredAt            DateTime
  appendOnlyHash        String?
  createdAt             DateTime            @default(now())
  user                  User                @relation(fields: [userId], references: [id], onDelete: Restrict)
  events                RawMemoryEvent[]
  evidence              Evidence[]
  jobs                  RefinementJob[]

  @@unique([userId, sourceType, sourceId, sourceRevision])
  @@index([userId, occurredAt])
  @@index([userId, kind])
  @@index([sessionId, messageSequence])
}

model RawMemoryEvent {
  id          String             @id @default(cuid())
  userId      String
  rawMemoryId String
  eventType   RawMemoryEventType
  reason      String?
  metadata    Json?
  createdBy   MemoryActor        @default(SYSTEM)
  createdAt   DateTime           @default(now())
  user        User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  rawMemory   RawMemory          @relation(fields: [rawMemoryId], references: [id], onDelete: Cascade)

  @@index([userId, rawMemoryId, createdAt])
  @@index([userId, eventType])
}

model Evidence {
  id           String             @id @default(cuid())
  userId       String
  sourceKind   EvidenceSourceKind
  sourceId     String
  rawMemoryId  String?
  evidenceText String?
  occurredAt   DateTime?
  confidence   Float              @default(0.5)
  weight       Float              @default(0.5)
  status       EvidenceStatus     @default(ACTIVE)
  createdAt    DateTime           @default(now())
  updatedAt    DateTime           @updatedAt
  user         User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  rawMemory    RawMemory?         @relation(fields: [rawMemoryId], references: [id], onDelete: SetNull)
  links        MemoryEvidenceLink[]

  @@index([userId, sourceKind, sourceId])
  @@index([userId, rawMemoryId])
  @@index([userId, status])
  @@index([userId, occurredAt])
}

model MemoryEvidenceLink {
  id         String             @id @default(cuid())
  userId     String
  evidenceId String
  targetType EvidenceTargetType
  targetId   String
  role       EvidenceRole       @default(SUPPORTING)
  createdAt  DateTime           @default(now())
  user       User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  evidence   Evidence           @relation(fields: [evidenceId], references: [id], onDelete: Cascade)

  @@index([userId, targetType, targetId])
  @@index([userId, evidenceId])
  @@unique([evidenceId, targetType, targetId, role])
}

model SemanticMemory {
  id             String               @id @default(cuid())
  userId         String
  kind           SemanticMemoryKind
  title          String
  content        String
  confidence     Float                @default(0.5)
  source         String
  currentVersion Int                  @default(1)
  status         SemanticMemoryStatus @default(ACTIVE)
  lastUpdatedAt  DateTime             @default(now())
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt
  user           User                 @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, kind])
  @@index([userId, status])
  @@index([userId, lastUpdatedAt])
}

model Understanding {
  id                       String              @id @default(cuid())
  userId                   String
  title                    String
  understanding            String
  category                 String?
  confidence               Float               @default(0.5)
  alternativeHypotheses    Json?
  unknowns                 Json?
  relatedTimelineEventIds  Json?
  relatedRelationshipIds   Json?
  relatedSemanticMemoryIds Json?
  currentVersion           Int                 @default(1)
  status                   UnderstandingStatus @default(OPEN)
  lastTouchedAt            DateTime            @default(now())
  createdAt                DateTime            @default(now())
  updatedAt                DateTime            @updatedAt
  user                     User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, status])
  @@index([userId, category])
  @@index([userId, lastTouchedAt])
}

model TimelineEvent {
  id                 String                 @id @default(cuid())
  userId             String
  title              String
  description        String?
  startDate          DateTime?
  endDate            DateTime?
  durationText       String?
  endStatus          TimelineEventEndStatus @default(UNKNOWN)
  people             Json?
  emotions           Json?
  topics             Json?
  conversationIds    Json?
  parentEventId      String?
  mergedIntoEventId  String?
  splitFromEventId   String?
  confidence         Float                  @default(0.5)
  importanceScore    Float                  @default(0)
  currentVersion     Int                    @default(1)
  status             TimelineEventStatus    @default(ACTIVE)
  createdAt          DateTime               @default(now())
  updatedAt          DateTime               @updatedAt
  user               User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  parentEvent        TimelineEvent?         @relation("TimelineParent", fields: [parentEventId], references: [id], onDelete: SetNull)
  childEvents        TimelineEvent[]        @relation("TimelineParent")

  @@index([userId, startDate])
  @@index([userId, status])
  @@index([userId, importanceScore])
}

model Relationship {
  id                       String             @id @default(cuid())
  userId                   String
  displayName              String
  relationshipType         RelationshipType   @default(OTHER)
  identityLabel            String?
  interactionFrequency     String?
  supportSignals           Json?
  conflictSignals          Json?
  influenceSummary         String?
  relatedTimelineEventIds  Json?
  relatedSemanticMemoryIds Json?
  confidence               Float              @default(0.5)
  currentVersion           Int                @default(1)
  status                   RelationshipStatus @default(ACTIVE)
  createdAt                DateTime           @default(now())
  updatedAt                DateTime           @updatedAt
  user                     User               @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, displayName])
  @@index([userId, relationshipType])
  @@index([userId, status])
}

model VersionHistory {
  id          String            @id @default(cuid())
  userId      String
  targetType  VersionTargetType
  targetId    String
  version     Int
  changeType  VersionChangeType
  reason      String?
  snapshot    Json
  operationId String
  createdBy   MemoryActor       @default(SYSTEM)
  createdAt   DateTime          @default(now())
  user        User              @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([targetType, targetId, version])
  @@unique([operationId])
  @@index([userId, targetType, targetId])
  @@index([userId, createdAt])
}

model RefinementJob {
  id              String           @id @default(cuid())
  userId          String
  rawMemoryId     String
  parentJobId     String?
  segmentKey      String
  pipelineVersion String
  step            RefinementStep
  status          RefinementStatus @default(PENDING)
  attempt         Int              @default(0)
  operationId     String
  inputSnapshot   Json?
  outputSnapshot  Json?
  error           String?
  startedAt       DateTime?
  finishedAt      DateTime?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  user            User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  rawMemory       RawMemory        @relation(fields: [rawMemoryId], references: [id], onDelete: Cascade)
  parentJob       RefinementJob?   @relation("RefinementJobChain", fields: [parentJobId], references: [id], onDelete: SetNull)
  childJobs       RefinementJob[]  @relation("RefinementJobChain")

  @@unique([operationId])
  @@index([userId, status])
  @@index([rawMemoryId, step])
  @@index([parentJobId])
  @@index([userId, createdAt])
}
```

## 6. Memory V2 MVP Pipeline

Phase 1 必须区分两个链路：

### 6.1 Same-Turn Response Injection

同轮即时回复链路：

```text
Current Message
  -> Safety
  -> Clinical Logic
  -> Retrieval(previous completed V2 + V1 fallback)
  -> Response Injection
  -> Generation
```

规则：

- 同轮回复不能依赖当前消息的 async refinement 结果。
- 当前消息可以作为实时对话上下文进入 Conversation Layer。
- 当前消息不能在同轮被当作长期记忆注入。
- Response Injection 只读取已经完成 refinement 的 V2 对象，以及迁移期间必要的 V1 fallback。

### 6.2 Post-Session Async Refinement

异步长期理解链路：

```text
Persist ChatMessage / Note
  -> append RawMemory
  -> append RawMemoryEvent(CREATED)
  -> RefinementJob(SEGMENTATION)
  -> RefinementJob(EXTRACTION)
  -> Evidence
  -> MemoryEvidenceLink
  -> SemanticMemory / TimelineEvent / Understanding / Relationship
  -> VersionHistory
  -> available for future Retrieval
```

规则：

- 该链路不阻塞用户收到回复。
- 结果从下一轮或后续会话开始可被检索。
- 每个 step 可重跑。
- 每个 step 必须有 `operationId`。
- 后续 step 必须引用 parent job。

### 6.3 RawMemory Triggers

触发条件：

- 新增 `ChatMessage(role=USER)`。
- 新增正式 `Note(isDraft=false)`。
- 草稿 Note 发布为正式 Note。
- 用户保存由聊天生成的小记。
- 已保存 Note 的正文编辑。
- 已保存 Note 的关键 metadata 变化：recordDate、mood、mediaUrls。

Note 规则：

- `NOTE_CREATED`：首次非草稿保存，写入 `RawMemory(sourceRevision=1)`。
- `NOTE_PUBLISHED_FROM_DRAFT`：草稿转正式，写入 `RawMemory(sourceRevision=1)`。
- `NOTE_EDITED`：已保存 Note 正文变化，追加新 RawMemory revision，不覆盖旧 RawMemory。
- `NOTE_METADATA_UPDATED`：只有 recordDate、mood、mediaUrls 变化且会影响 refinement 时，追加 `kind=METADATA` 的 RawMemory。
- Evidence 必须指向实际用于 refinement 的 RawMemory revision。

### 6.4 Segmentation

Phase 1 行为：

- 单条用户消息作为一个 segment。
- 单条 Note revision 作为一个 segment。
- `segmentKey = rawMemoryId`。

Phase 2 扩展：

- 多消息窗口分段。
- 同一事件跨消息合并。
- 小记与聊天生成同一 segment。

### 6.5 Extraction

Phase 1 复用现有能力：

- `extractUnderstandingFromMessage`。
- `parseUnderstandingExtraction`。
- `inferLocalUnderstandingExtraction` 作为 fallback。

但需要在 job output 中保存 V2 extraction DTO：

```ts
type MemoryV2Extraction = {
  segmentKey: string;
  provenance: "model" | "fallback";
  facts: Array<{
    eventText: string;
    occurredAt?: string | null;
    people?: string[];
    topics?: string[];
    confidence: number;
    explicitness: "explicit" | "inferred";
    timelineCandidate: boolean;
    importanceScore?: number;
    durationText?: string | null;
  }>;
  experiences: Array<{
    eventText?: string | null;
    emotion?: string | null;
    confidence: number;
    explicitness: "explicit" | "inferred";
  }>;
  interpretations: Array<{
    interpretationText: string;
    confidence: number;
    explicitness: "explicit" | "inferred";
  }>;
  people: Array<{
    name: string;
    relationshipLabel?: string;
    explicitness: "explicit" | "inferred";
    confidence: number;
  }>;
  topics: string[];
};
```

规则：

- 抽取结果不直接成为长期理解，必须先形成 Evidence。
- fallback provenance 的 Evidence weight 不高于 0.4。

### 6.6 Evidence and MemoryEvidenceLink

输入：

- RawMemory。
- MemoryV2Extraction。

输出：

- Evidence。
- MemoryEvidenceLink。

规则：

- 用户明确事实：初始 weight 0.7。
- 用户情绪体验：初始 weight 0.6。
- AI 解释性理解：初始 weight 0.3。
- fallback 推断：weight 不高于 0.4。
- Evidence 创建后不自动等于长期理解。
- 长期对象必须通过 `MemoryEvidenceLink` 引用 Evidence。

### 6.7 SemanticMemory / TimelineEvent / Understanding / Relationship Writes

SemanticMemory：

- 单次普通 topic 不创建稳定 SemanticMemory。
- `SemanticMemory(kind=TOPIC)` 需要重复 Evidence、用户确认或迁移自高置信长期对象。
- `SemanticMemory(kind=COPING_METHOD)` 需要明确恢复方式和正向效果。
- `SemanticMemory(kind=IMPORTANT_EVENT)` 需要 Timeline eligibility 或用户确认。

TimelineEvent：

- 只在满足 TimelineEvent eligibility 时创建。
- 不满足 eligibility 的事实进入 Evidence 或 Understanding。

Understanding：

- 低置信、开放、矛盾、需要未来继续理解的内容进入 Understanding。
- `Hypothesis` 迁移到 `Understanding`。

Relationship：

- Phase 1 只创建最小关系对象。
- 不进行完整关系图谱推理。

Version：

- 每次创建或更新长期投影对象，必须先追加 `VersionHistory`，再更新投影的 `currentVersion`。
- 旧 version 保持不变。

### 6.8 V2 to StructuredRagContext Adapter

Phase 1 保持 `services/ai/promptBuilder.ts` 的 `understandingContext` 注入位置不变。

新增适配器：

```text
V2 Retrieval
  -> semanticMemories
  -> timelineEvents
  -> understandings
  -> relationships
  -> V1 fallback
  -> dedupe
  -> StructuredRagContext
```

映射规则：

- `SemanticMemory(status=ACTIVE|WEAKENED)` -> `recentMemories` 或 `similarMemories`。
- `TimelineEvent(status=ACTIVE|USER_CORRECTED)` -> `coreEvents` 或 `recentMemories`。
- `Understanding(status=OPEN|DEEPENING|PAUSED)` -> `activeHypotheses`。
- `Understanding` 的 counter Evidence -> `counterEvidence`。
- `Relationship` 只在 people intent 命中且 confidence 达阈值时进入 `similarMemories`。
- V1 `Fact` / `ExperienceSlice` / `Hypothesis` / `Event` / `EmotionSlice` 只作为 fallback。

Retrieval priority：

1. Safety context, handled outside ordinary memory injection.
2. Current Conversation OS context, only for current turn.
3. V2 `Understanding` with status `OPEN` / `DEEPENING` and matching intent.
4. V2 `TimelineEvent` with high importance or recent occurrence.
5. V2 `SemanticMemory` with active status, matching people/topics/emotions.
6. V2 `Relationship` with explicit match and sufficient confidence.
7. V1 fallback objects not yet migrated.
8. Recent Note fallback, only if no equivalent V2 memory exists.

Dedupe rules：

- Prefer V2 over V1 when both trace to the same RawMemory or source object.
- Deduplicate by `Evidence.rawMemoryId`.
- During migration, if V1 `Fact.sourceType/sourceId` maps to a RawMemory already linked to a V2 object, omit the V1 item.
- If V1 `Hypothesis.supportingEvidenceIds` were migrated to `Understanding`, omit the V1 Hypothesis.
- If V1 `Event.sourceMessageIds` were migrated to `TimelineEvent`, omit the V1 Event.
- Dedupe happens before `StructuredRagContext` is returned to promptBuilder.

Response Injection rules：

- RawMemory never enters prompt directly as long-term memory.
- Evidence text can enter only as compact evidence summary through mapped V2 objects.
- Prompt constraints continue to say: only reference naturally, do not recite, do not present hypotheses as facts.

## 7. Phase Plan

### Phase 1: Memory V2 MVP

目标：

- 建立长期理解最小闭环。
- 不改变五层架构。
- 不引入 Neo4j、Milvus、LangGraph、GraphRAG。

必做：

- 新增 `RawMemory`、`RawMemoryEvent`、`Evidence`、`MemoryEvidenceLink`、`SemanticMemory`、`Understanding`、`TimelineEvent`、`Relationship`、`VersionHistory`、`RefinementJob` schema。
- 写入 ChatMessage 时追加 RawMemory 和 `RawMemoryEvent(CREATED)`。
- 写入 Note 时按 revision 规则追加 RawMemory 和 `RawMemoryEvent(CREATED)`。
- 建立异步 RefinementJob runner 的最小实现。
- 复用现有 extraction 能力。
- 从 extraction 生成 Evidence。
- 通过 `MemoryEvidenceLink` 关联 Evidence 与 V2 长期对象。
- 从 Evidence 生成基础 SemanticMemory、TimelineEvent、Understanding、最小 Relationship。
- 每次长期对象变化追加 VersionHistory，并更新投影对象的 `currentVersion`。
- Retrieval 通过 V2 adapter 读取 V2 对象，并兼容 V1 fallback。
- Response Injection 继续通过现有 `StructuredRagContext`，但只读取 previous completed V2 memory，不依赖当前消息的异步结果。
- 删除/撤销 RawMemory 时追加 tombstone/redaction event，再使派生 Evidence 和 V2 长期对象失效或降置信。
- 保留现有 `Fact`、`ExperienceSlice`、`Hypothesis`、`Event`、`EmotionSlice`、`UnderstandingGraph`。

不做：

- 用户可视化编辑理解。
- Report。
- Assessment。
- 完整 Relationship Graph。
- 向量检索。
- GraphRAG。
- 多模态提取。
- 医学量表。
- UI rollback。

### Phase 2: Relationship and Retrieval

目标：

- 增强长期关系和跨会话检索。

范围：

- 完整 Relationship 更新。
- Relationship 与 TimelineEvent / SemanticMemory / Conversation 关联。
- 多消息 Segmentation。
- 事件合并、拆分、关联。
- Vector Search。
- `UnderstandingGraph` 降级为索引或由 V2 对象驱动。
- 跨会话检索排序。
- Evidence invalidation 后自动重算相关理解。

### Phase 3: User Feedback, Report, Assessment, Privacy UX

目标：

- 让用户看见并修正系统理解。
- 生成 evidence-backed 报告和长期观察。

范围：

- 用户查看、删除、导出、撤销长期理解。
- UI 级理解修正。
- Report。
- Assessment。
- Rollback。
- 加密存储策略落地。
- 物理删除恢复策略。
- 多模态 Notes：图片、语音。
- 量表接入。

## 8. Migration Strategy

### 8.1 ChatMessage

保留。

角色：

- 继续作为聊天业务对象。
- 新增 RawMemory 的来源之一。

迁移：

- 为历史 `ChatMessage` 回填 `RawMemory(kind=CONVERSATION_MESSAGE, sourceType=CHAT_MESSAGE, sourceRevision=1)`。
- 为每条回填 RawMemory 追加 `RawMemoryEvent(CREATED)`。
- `conversationId = ChatSession.id`。
- `messageSequence` 按 `sessionId + createdAt` 排序生成。
- 后续长期对象不直接引用 `ChatMessage.id`，改为引用 Evidence 和 MemoryEvidenceLink。

### 8.2 Note

保留。

角色：

- 继续作为小记业务对象。
- 新增 RawMemory 的来源之一。

迁移：

- 为历史非草稿 `Note` 回填 `RawMemory(kind=NOTE, sourceType=NOTE, sourceRevision=1)`。
- 为每条回填 RawMemory 追加 `RawMemoryEvent(CREATED)`。
- `occurredAt = recordDate`。
- `metadata` 保存 mood、mediaUrls、generatedFromChatIds。
- 草稿 Note 不进入 RawMemory，直到保存为正式 Note。
- 历史 Note 编辑无法还原 revision 时，只回填当前版本；上线后所有正文编辑必须追加新 RawMemory revision。

### 8.3 Fact

Phase 1 保留，兼容读取。

角色：

- 作为 V1 extraction 写入结果。
- 作为 V2 Evidence 回填来源。

迁移：

- 为每条 `Fact` 创建 `Evidence(sourceKind=RAW_MEMORY)`。
- 若能通过 `sourceType/sourceId` 找到 RawMemory，则填入 `rawMemoryId`。
- `eventText` 映射为 `evidenceText`。
- `Fact.topics` 不直接生成稳定 `SemanticMemory(kind=TOPIC)`；只有重复证据、用户确认或高置信迁移对象才可生成。
- 高重要事实可生成 `TimelineEvent`，但必须满足 TimelineEvent eligibility。
- 生成任何 V2 长期对象时必须创建 `MemoryEvidenceLink`。

长期方向：

- Phase 2 后不再作为长期理解主表。
- 可保留为 extraction artifact 或兼容表。

### 8.4 ExperienceSlice

Phase 1 保留，兼容读取。

角色：

- 表达情绪、身体信号、行为。

迁移：

- 为每条 `ExperienceSlice` 创建 Evidence。
- emotion/bodySignal/behavior 可关联 `TimelineEvent.emotions` 或进入 `Understanding`。
- 只有重复且稳定的恢复方式或行为模式，才可生成 `SemanticMemory`。

长期方向：

- 保留为体验片段明细。
- 不作为长期理解主对象。

### 8.5 Interpretation

Phase 1 保留，兼容读取。

迁移：

- 解释性内容映射为低权重 Evidence。
- 可生成 `Understanding`，不得直接生成高置信 `SemanticMemory`。
- 解释性内容必须标记为 inferred，并保留低断言强度。

长期方向：

- 逐步由 `Understanding` 替代。

### 8.6 Hypothesis

Phase 1 保留，兼容读取。

角色：

- 现有长期低置信假设。

迁移：

- `Hypothesis` 映射为 `Understanding`。
- `supportingEvidenceIds` / `counterEvidenceIds` 通过 `Fact -> Evidence` 映射。
- 支持证据创建 `MemoryEvidenceLink(role=SUPPORTING)`。
- 反证创建 `MemoryEvidenceLink(role=COUNTER)`。
- `status` 映射为 `Understanding.status`。
- `Hypothesis.updatedAt` 对应的当前状态写成 Understanding 投影，历史无法还原的部分不伪造 VersionHistory。

长期方向：

- Phase 2 后新写入转向 `Understanding`。
- `Hypothesis` 可作为兼容表冻结。

### 8.7 Event

Phase 1 保留，兼容读取。

角色：

- 当前基础事件表。

迁移：

- `Event` 映射为 `TimelineEvent`。
- `sourceMessageIds` 通过 RawMemory/Evidence 回填。
- `participants` 映射为 `TimelineEvent.people`。
- `EmotionSlice` 映射为 `TimelineEvent.emotions`。
- 只迁移 `isCoreEvent=true` 或 `importanceScore >= 0.7` 或有明确 source evidence 的 Event。

长期方向：

- Phase 2 后 `TimelineEvent` 成为用户人生事件轴主表。
- `Event` 可继续用于旧 API 兼容或降级为 legacy table。

### 8.8 EmotionSlice

Phase 1 保留，兼容读取。

角色：

- 当前情绪切片。

迁移：

- 映射为 Evidence。
- 关联到 `TimelineEvent.emotions`。
- 可参与 Report / Assessment，但不直接构成诊断。
- 如果无法关联到 TimelineEvent，则保留为 Evidence 或进入 Understanding，不强行创建 TimelineEvent。

长期方向：

- 保留为明细事实，不作为长期理解主对象。

### 8.9 UnderstandingGraphNode / UnderstandingGraphEdge

Phase 1 保留。

角色：

- 现有图谱索引。

迁移：

- PERSON 节点映射为 `Relationship`。
- EVENT 节点映射到 `TimelineEvent` 或 `SemanticMemory(kind=IMPORTANT_EVENT)`。
- TOPIC / VALUE / COPING_METHOD 节点映射为 `SemanticMemory`。
- HYPOTHESIS 节点映射为 `Understanding`。
- Edge evidenceId 通过 `Fact -> Evidence` 映射。
- 所有映射结果必须通过 `MemoryEvidenceLink` 引用 Evidence。
- 无 Evidence 的 Graph node 只作为候选，不进入 Response Injection。

长期方向：

- Phase 2 决定是否继续作为检索索引。
- 不作为长期理解 source of truth。

## 9. Acceptance Criteria

### 9.1 Schema and Data Contract

- 文档中的 V2 核心对象都有明确职责、字段、状态、版本和证据规则。
- Prisma schema 草案覆盖 `RawMemory`、`RawMemoryEvent`、`Evidence`、`MemoryEvidenceLink`、`SemanticMemory`、`Understanding`、`TimelineEvent`、`Relationship`、`VersionHistory`、`RefinementJob`。
- 草案不新增产品架构层。
- 草案不要求删除现有 V1 表。

### 9.2 Raw Memory

- 新聊天消息可追加 RawMemory。
- 新正式 Note 可追加 RawMemory。
- RawMemory row 创建后不 update。
- RawMemory row 创建后不 delete。
- RawMemory 不原地修改 content。
- 删除、撤销、redaction 必须通过 append-only `RawMemoryEvent` 表达。
- 原始数据与可见状态分离，retrieval/refinement/export 必须查询 RawMemoryEvent 后决定是否可用。
- RawMemory 可回指 source object。
- RawMemory 可承载 metadata、timestamp、session、message sequence。

### 9.3 Evidence

- 所有新写入的 SemanticMemory、Understanding、TimelineEvent、Relationship 必须通过 `MemoryEvidenceLink` 关联 Evidence。
- Evidence 必须包含 source、time、confidence、weight、status。
- Evidence 失效后，关联长期理解可以被失效、降置信或重算。
- Json evidence arrays 不允许作为 Evidence 主关联。

### 9.4 Async Refinement

- RefinementJob 可记录每个 step 的状态、输入、输出、错误、attempt。
- RefinementJob 必须有 parent job 或明确 rawMemory 起点。
- RefinementJob 必须有 operationId 保证 retry 幂等。
- Extraction 失败不阻塞实时回复。
- 任一步骤可独立重跑。
- Pipeline output 支持版本化。
- Post-session async refinement 结果只进入未来 retrieval，不参与同轮即时回复。

### 9.5 Timeline

- TimelineEvent 只表达用户人生事件轴。
- TimelineEvent 可关联人物、情绪、主题、Conversation、Evidence。
- TimelineEvent 支持 active/ended/unclear 和 merge/split lineage。

### 9.6 Relationship

- Relationship 可表达长期重要对象。
- Relationship 必须关联 Evidence。
- Relationship 不能基于一次提及高置信确认。
- Relationship 可关联 TimelineEvent 和 SemanticMemory。

### 9.7 Understanding Continuity

- Understanding 可保存开放线程、当前理解、未知、替代假设、证据。
- Understanding 可被修正、关闭、拒绝、合并。
- Understanding 每次变化创建新的 VersionHistory。
- 旧 VersionHistory 不覆盖、不删除。
- Understanding 当前版本通过 `currentVersion` 指针表达。
- 系统允许后续承认“以前理解错了”。

### 9.8 Response Injection

- 回复不直接把 RawMemory 当长期理解读取。
- Response Injection 优先使用已完成 refinement 的 Understanding、TimelineEvent、Relationship、SemanticMemory。
- 当前消息的 async refinement 结果不得参与同轮 Response Injection。
- 近期聊天只用于当前轮对话上下文。
- Prompt 中必须保留“不复述、不把假设当事实”的约束。
- V2 adapter 必须在返回 `StructuredRagContext` 前完成 V1/V2 去重。

### 9.9 Migration

- 现有 ChatMessage、Note、Fact、ExperienceSlice、Hypothesis、Event、EmotionSlice、UnderstandingGraph 均有保留、映射或废弃策略。
- 历史数据回填不要求一次性完成，可用后台任务渐进迁移。
- 迁移期间 Retrieval 必须兼容 V1 和 V2。

### 9.10 Privacy and Governance

- 用户删除或撤销 RawMemory 时，必须追加 tombstone/redaction event。
- RawMemory 本体不更新、不删除。
- tombstone/redaction event 后，派生 Evidence 和长期理解可追踪处理。
- V2 对象具备 status 以支持撤销、失效、归档。
- Report 和 Assessment 在 Phase 3 前不得绕过 Evidence 生成。
- Assessment 不得输出医学诊断或人格标签。

## 10. Implementation Order

Phase 1 工程顺序：

1. 添加 Prisma schema migration 草案并评审。
2. 添加 RawMemory 写入服务。
3. 添加 RawMemoryEvent 写入服务。
4. 在 ChatMessage 和 Note 保存路径追加 RawMemory 与 RawMemoryEvent。
5. 添加 RefinementJob 表和最小 runner。
6. 复用现有 extraction，扩展为 MemoryV2Extraction outputSnapshot。
7. 添加 Evidence 生成服务。
8. 添加 MemoryEvidenceLink 写入服务。
9. 添加 VersionHistory 写入服务。
10. 添加 SemanticMemory / TimelineEvent / Understanding / 最小 Relationship 投影写入服务。
11. 调整 Retrieval，新增 V2-to-StructuredRagContext adapter。
12. 在 adapter 中实现 V2 priority、V1 fallback、V1/V2 dedupe。
13. 保持 Response Injection 接口不变。
14. 添加迁移脚本，将历史 V1 对象渐进映射到 V2。
15. 添加 acceptance tests：
    - RawMemory append-only。
    - RawMemoryEvent tombstone/redaction。
    - Evidence required。
    - MemoryEvidenceLink required。
    - RefinementJob retry。
    - same-turn response does not depend on current async refinement。
    - TimelineEvent evidence trace。
    - Understanding version history。
    - Retrieval V2 priority with V1 fallback。
    - V1/V2 dedupe by Evidence/RawMemory。
