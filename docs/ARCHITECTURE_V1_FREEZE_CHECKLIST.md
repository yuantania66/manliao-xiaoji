# Architecture v1 Freeze Checklist

## 1. Purpose

本文档用于 Architecture v1 工程收尾。

目标不是新增能力，也不是继续优化回复，而是冻结当前五层架构边界，清理后续进入 Clinical Logic Sprint 1 前的工程风险。

当前五层架构保持不变：

```text
Application Layer
Conversation Layer
Clinical Logic Layer
Memory & Mental Model Layer
Governance & Safety Layer
```

本文档不新增架构层。

## 2. Review Scope

本次只读 review 覆盖：

- `app/api/chat/**`
- `services/ai/**`
- `conversation-os/**`
- `services/understanding/**`
- `services/experience/**`
- `services/memory/**`
- `scripts/*check*`
- `docs/*`

未修改代码。

## 3. Current Runtime Chain

当前登录用户聊天主链路：

```text
app/api/chat/sessions/[sessionId]/messages/route.ts
  -> createRawMemoryFromChatMessage(user message)
  -> extractUnderstandingFromMessage()
  -> buildStructuredRagContext()
  -> maybeMergeMemoryV2ResponseContext()
  -> createReviewedChatReply()
  -> generateChatReply()
  -> runConversationPipeline()
  -> buildVoiceConstraints()
  -> buildChatPrompt()
  -> callModel()
  -> save assistant message
  -> createRawMemoryFromChatMessage(assistant message)
  -> writeUnderstandingExtraction()
  -> updateUnderstandingHypotheses()
  -> extractExperienceFromChatMessage()
```

当前游客聊天链路：

```text
app/api/chat/guest/route.ts
  -> generateChatReply()
  -> runConversationPipeline()
  -> buildVoiceConstraints()
  -> buildChatPrompt()
  -> callModel()
```

差异：

- 登录链路有 RawMemory、V1 Understanding、V2 response context merge、Experience extraction。
- 游客链路没有长期 Memory 写入、V1/V2 retrieval、Experience extraction。
- 两条链路的 Safety / fallback / judge 组装存在重复实现。

## 4. Deprecated Calls / Old Paths

以下路径与 Architecture v1 最终口径不一致，后续应收敛。

### 4.1 V1 Understanding Runtime Path

位置：

- `services/understanding/extractService.ts`
- `services/understanding/retrievalService.ts`
- `services/understanding/hypothesisService.ts`
- `services/understanding/understandingTypes.ts`
- `app/api/chat/sessions/[sessionId]/messages/route.ts`

现状：

- `extractUnderstandingFromMessage()` 在用户每轮消息后直接做 V1 extraction。
- `writeUnderstandingExtraction()` 写入 `Fact` / `ExperienceSlice` / `Interpretation`。
- `updateUnderstandingHypotheses()` 直接更新 `Hypothesis` 和 `UnderstandingGraph`。
- `buildStructuredRagContext()` 从 V1 Fact / ExperienceSlice / Event / Hypothesis / Feedback 组装 `StructuredRagContext`。

问题：

- Memory V2 已确定 Evidence 是长期理解唯一入口，但 V1 path 仍绕过 Evidence。
- Clinical Logic Sprint 1 需要消费 bounded memory context，不应直接依赖 V1 `StructuredRagContext`。
- `updateUnderstandingHypotheses()` 已经提前承担部分 Clinical/Interpretation 行为。

删除状态：

- 不能立即删除。当前登录聊天回复仍依赖它生成 response context。
- Sprint 1 前应标记为 compatibility path。
- Memory V2 response context 完全替代后，可以迁移或删除。

### 4.2 V1 Experience / Timeline Runtime Path

位置：

- `services/experience/experienceExtractorService.ts`
- `services/experience/experienceExtractorPrompt.ts`
- `app/api/chat/sessions/[sessionId]/messages/route.ts`
- `app/api/events/**`
- `app/api/emotion-slices/**`
- `app/api/event-relations/**`
- `app/api/timeline/route.ts`

现状：

- `extractExperienceFromChatMessage()` 仍在每轮聊天后写入旧 `Event` / `EmotionSlice` / `EventRelation`。
- Timeline UI 和部分 API 仍可能依赖旧 Event 模型。

问题：

- Architecture v1 中 Timeline 应属于 Memory & Mental Model Layer，并应通过 Evidence / Projection 演进。
- 当前 Experience path 直接从聊天写 Event/EmotionSlice，不符合 Evidence-only 长期入口。

删除状态：

- 不能立即删除。前端 Timeline / events API 可能仍依赖旧表。
- Sprint 1 不继续扩展。
- 后续进入 Memory V2 Timeline schema 阶段前，应冻结为 legacy timeline path。

### 4.3 Local Prompt Memory Context

位置：

- `services/ai/chatReplyService.ts`
- `services/ai/dataLayers.ts`
- `services/ai/types.ts` 中 `AiMemoryContext`
- `services/ai/promptBuilder.ts` 中 `memoryContext`

现状：

- `loadMemoryContext()` 从最近 note 或跨 session chat message 取一条文本。
- `createNoteMemoryContext()` / `createChatMemoryContext()` 将其注入 prompt。

问题：

- 这是 Memory V2 前的轻量兼容路径。
- 它绕过 Evidence / Projection / Retrieval。
- 它与 `StructuredRagContext` / Memory V2 response context 重复。

删除状态：

- Clinical Logic Sprint 1 前建议移出主链路，或至少默认关闭。
- 如果保留，必须明确标记为 legacy compatibility，不得作为 ClinicalContext 输入。

### 4.4 EngageMode / ExperienceGoal / QuestionStyle / Voice Expansion

位置：

- `conversation-os/engage/index.ts`
- `conversation-os/types.ts`
- `services/ai/voiceLayer.ts`
- `services/ai/promptBuilder.ts`
- `services/ai/debugTrace.ts`

现状：

- `ResponseGoal` 仍包含 `experienceGoal`、`engageMode`、`questionStyle`。
- `Voice Layer` 仍根据这些字段生成大量表达约束。
- `promptBuilder` 仍把这些字段作为核心 Conversation OS context 注入模型。

问题：

- Architecture v1 已明确：旧 EngageMode / ExperienceGoal / QuestionStyle / Voice 不再扩展。
- 这些字段目前仍在承担 response strategy 的一部分职责。
- Clinical Logic 接入后，它们应降级为兼容输入或被 `ClinicalPlan` 替代。

删除状态：

- 不建议 Sprint 1 前直接删除，避免破坏正常聊天链路。
- 必须冻结，不再新增规则、枚举或禁词。
- Clinical Logic 接入后，优先让 LLM 读取 `ClinicalPlan`，再逐步删除这些字段的 prompt 主导地位。

### 4.5 Disabled Judge / Rewrite Path

位置：

- `services/ai/chatReplyService.ts`
- `services/ai/types.ts`
- `services/ai/promptBuilder.ts`
- `services/ai/debugTrace.ts`

现状：

- `JUDGE_PROMPT_VERSION = "judge-disabled-v1"`。
- `REWRITE_PROMPT_VERSION = "rewrite-disabled-v1"`。
- `createDisabledJudge()` 每轮仍写入 AiJudgeResult。

问题：

- 这是旧 judge/rewrite 架构的审计兼容层。
- 当前不再承担真实 judge/rewrite。

删除状态：

- 不能立即删除，数据库和前端 debug 仍展示 judge 字段。
- 可以保留为 audit compatibility。
- 后续应改名为 `generationAudit` 或将 judge disabled 状态从 Clinical/Safety 语义中剥离。

## 5. Duplicate Implementations

### 5.1 Safety / Fallback / Judge Duplication

重复位置：

- `services/ai/chatReplyService.ts`
- `app/api/chat/guest/route.ts`

重复内容：

- `getFallbackRiskLevel()`
- `createFallbackJudge()`
- `createDisabledJudge()`
- safety gate 命中后的 response assembly
- fallback response assembly

风险：

- 登录用户和游客用户的 debug / safety / fallback 行为可能漂移。
- Safety 优先级虽然存在，但不是单一服务入口。

建议：

- Sprint 1 前将普通聊天生成入口收敛到同一个 service facade。
- 游客和登录用户只负责不同的 persistence/rate-limit，不应复制 AI generation orchestration。

### 5.2 Low Information / Legacy Template Filters

重复位置：

- `conversation-os/engage/index.ts`
- `services/ai/promptBuilder.ts`
- `services/ai/voiceLayer.ts`
- `services/understanding/extractService.ts`
- `services/experience/experienceExtractorService.ts`

重复内容：

- 数字、单字、语气词、低信息输入判断。
- legacy assistant template 过滤。
- 不同模块对短输入的本地规则。

风险：

- 同一用户输入可能在不同层被不同方式解释。
- 旧单句优化逻辑容易继续渗透到新 Clinical Logic。

建议：

- Sprint 1 前不要继续扩展这些规则。
- Clinical Logic 接入后，只允许 Conversation OS 输出 minimal signal，不允许各层继续各自解释短输入。

### 5.3 Memory Context Shape Duplication

重复位置：

- `services/understanding/understandingTypes.ts` 的 `StructuredRagContext`
- `services/memory/retrievalService.ts` 的 V2-to-StructuredRagContext mapping
- `services/ai/types.ts` 的 `AiMemoryContext`
- `docs/CLINICAL_LOGIC_IMPLEMENTATION_PLAN.md` 的 `ClinicalContext.memoryContext`

问题：

- `StructuredRagContext` 仍是 V1/V2 混合容器。
- V2 Understanding / Timeline / Relationship 被塞入 `recentMemories`，缺少专用字段。
- Clinical Logic 需要的是 bounded clinical memory context，不应直接接收旧 RAG 容器。

建议：

- Sprint 1 前定义 adapter：`StructuredRagContext -> ClinicalMemoryContext`。
- adapter 只暴露 Understanding 优先、Relationship/Timeline supporting，不暴露 RawMemory。

## 6. Temporary Compatibility Code

必须明确标记为临时兼容：

| Code | Current Role | Freeze Decision |
| --- | --- | --- |
| `maybeMergeMemoryV2ResponseContext()` | 将 Memory V2 注入 V1 `StructuredRagContext` | 保留到 Clinical Memory adapter 完成 |
| `StructuredRagContext` | V1 response context + V2 mapped context | 暂留，不再扩展字段以外的策略语义 |
| `loadMemoryContext()` | 一条 note/chat 轻量 prompt memory | 建议 Sprint 1 前退出主链路或默认关闭 |
| `sanitizeChatHistory()` legacy filters | 避免旧模板污染当前回复 | 暂留，直到历史数据清理或 promptVersion 迁移完成 |
| disabled judge/rewrite | DB/debug 兼容 | 暂留，后续改名或迁移 |
| `Voice Layer v1` | 表达约束 | 冻结，不再新增禁词/规则 |
| `EngageMode` / `ExperienceGoal` / `QuestionStyle` | 旧策略信号 | 冻结，ClinicalPlan 接入后降级 |

## 7. Code That Can Be Deleted

### 7.1 Safe To Delete Now

当前没有发现可在不影响运行链路的情况下立即删除的明确死代码。

原因：

- 大多数旧路径仍被登录聊天、debug、检查脚本或前端 API 间接依赖。
- 直接删除会影响现有聊天、Timeline、debug 或 launch checks。

### 7.2 Can Delete After Clinical Logic Sprint 1 Integration

满足对应替代条件后可删除：

| Candidate | Delete After |
| --- | --- |
| `services/ai/voiceLayer.ts` 中基于 `experienceGoal/engageMode/questionStyle` 的扩展规则 | `ClinicalPlan` 成为 LLM 主要策略输入，Voice 只保留极薄语言约束 |
| `conversation-os/engage/index.ts` 中复杂 policy rules | Conversation OS 降级为 observe/understand/update，Clinical Logic 接管 strategy |
| `promptBuilder` 中 `experienceGoal/engageMode/questionStyle` 的主 prompt 文案 | prompt 改为消费 `ClinicalPlan` |
| `loadMemoryContext()` / `AiMemoryContext` / `dataLayers.ts` prompt memory | ClinicalMemoryContext adapter 完成并默认启用 |
| guest route 内重复 fallback/judge assembly | AI generation orchestration service facade 完成 |

### 7.3 Can Delete After Memory V2 Fully Replaces V1 Response Context

满足对应替代条件后可删除：

| Candidate | Delete After |
| --- | --- |
| `buildStructuredRagContext()` V1 retrieval | Memory V2 retrieval 输出专用 ClinicalMemoryContext |
| `extractUnderstandingFromMessage()` runtime V1 write path | Evidence-driven extraction/projection 成为唯一长期理解入口 |
| `writeUnderstandingExtraction()` | Fact / ExperienceSlice / Interpretation 不再作为 runtime long-term write path |
| `updateUnderstandingHypotheses()` | Hypothesis 全部迁入 Evidence/Projection 或后续 Insight 机制 |
| `extractExperienceFromChatMessage()` old Event/EmotionSlice path | Timeline / Emotion projection 完成并替代旧 events API |

## 8. Must Keep Compatibility Layers

以下不能在 Architecture v1 Freeze 阶段删除：

- Prisma migrations：历史迁移不可删除。
- `Fact` / `ExperienceSlice` / `Interpretation` / `Hypothesis` / old `Event` / `EmotionSlice` models：仍被 runtime 或 API 使用。
- `StructuredRagContext`：当前 response prompt 仍依赖。
- `maybeMergeMemoryV2ResponseContext()`：当前 Memory V2 feature flag 入口。
- `sanitizeChatHistory()`：仍用于降低旧模板污染。
- fallback generation：provider error、timeout、empty output、安全异常仍需要。
- Safety gate：最高优先级，必须保留。
- debug trace：当前架构验收依赖 `rawLLMOutput` / `postProcessSteps` / `finalReplySource`。

## 9. Known Technical Debt

### P0: Must Resolve Before Clinical Logic Sprint 1 Implementation

1. Clinical Logic insertion point 未落地。
   - 当前链路是 Conversation OS -> Voice -> Prompt -> LLM。
   - Sprint 1 前必须确定 `ClinicalPlan` 插入位置，并保证正常聊天不能绕过。

2. Conversation OS 仍承担策略职责。
   - `engageMode` / `experienceGoal` / `questionStyle` 仍是 prompt 主策略输入。
   - Sprint 1 前必须冻结这些字段，不再扩展。

3. Memory input to Clinical Logic 未定义 runtime adapter。
   - 当前只有 `StructuredRagContext` 混合容器。
   - Clinical Logic 不能直接消费该容器。
   - 必须定义 `StructuredRagContext -> ClinicalMemoryContext` adapter，且禁止 RawMemory 直入。

4. 登录 / 游客 AI orchestration 分叉。
   - fallback、judge、safety assembly 重复。
   - Sprint 1 前应收敛 AI generation facade，避免 Clinical Logic 只接入登录链路。

5. Safety trace source 不准确。
   - `createSafetyGeneration()` 的 `finalReplySource` 当前是 `"fallback"`。
   - Debug route 另有 `finalSource: "safety"`。
   - Sprint 1 前应修正类型或 trace，避免 Safety 被误判为 fallback。

### P1: Resolve During Or After Clinical Logic Sprint 1

1. V1 Understanding runtime path 绕过 Evidence。
   - 需要逐步迁入 Memory V2 Evidence / Projection。

2. V1 Experience / Timeline path 绕过 Evidence。
   - 需要冻结旧 Event/EmotionSlice 写入扩展。

3. `StructuredRagContext` 缺少 Understanding / Timeline / Relationship 专用字段。
   - Memory V2 当前只能映射进 `recentMemories`。

4. `Voice Layer` 和 `promptBuilder` 职责重叠。
   - Voice 负责表达约束，但 prompt 也包含大量表达规则。

5. disabled judge/rewrite 命名误导。
   - 目前只是 audit compatibility，不是实际 judge。

6. 多处低信息输入规则重复。
   - 后续应统一为 Conversation minimal signal 或 Clinical input signal。

### P2: Can Defer

1. Memory V2 deterministic MVP schema 技术债。
   - Timeline 缺 `eventType` / `projectionEvidenceId`。
   - Understanding 缺 `projectionEvidenceId` / `hypothesisType`。
   - Relationship 使用 `OTHER` 表示 UNKNOWN。

2. Projection Framework 长期演进。
   - Graph-ready implementation 暂不做。
   - Timeline schema 深化暂不做。
   - Relationship 消歧/合并暂不做。

3. RUNNING stale refinement job 未处理。

4. append-only 仍依赖服务层约束，数据库层未完全强制。

5. 前端 debug UI 仍展示旧 Conversation OS / Voice 字段。
   - Clinical Trace 接入后再统一整理。

## 10. Modules Recommended To Freeze

立即冻结，不再扩展：

- `conversation-os/engage/**`
- `ExperienceGoal` enum
- `EngageMode` enum
- `QuestionStyle` enum
- `services/ai/voiceLayer.ts`
- `services/ai/promptBuilder.ts` 中旧 response strategy 文案
- `services/understanding/hypothesisService.ts`
- `services/experience/experienceExtractorService.ts`
- `services/professional-rag/**`

冻结含义：

- 不新增规则。
- 不新增枚举。
- 不新增 prompt 约束。
- 不继续针对单句 case 调参。
- 只允许 bugfix 或为 Clinical Logic 接入做 adapter。

## 11. Modules Allowed To Continue Development

允许继续开发，但必须遵守当前层边界：

### Clinical Logic Layer

允许：

- `ClinicalContext`
- `ClinicalPlan`
- `ClinicalStrategy`
- `ClinicalTrace`
- Strategy selection contract

禁止：

- 诊断。
- 报告。
- 治疗计划。
- 直接写 Memory。
- 绕过 Safety。
- 生成固定回复模板。

### Memory & Mental Model Layer

允许：

- 修 P0/P1 bug。
- 提供 bounded ClinicalMemoryContext adapter。
- 保持 Evidence / Projection traceability。

禁止：

- Graph-ready 新实现。
- Timeline schema 深化。
- Understanding schema 深化。
- Relationship 消歧/合并。
- 将 deterministic MVP memory 当强判断。

### Governance & Safety Layer

允许：

- 修正 safety trace。
- 强化 Safety priority。
- 明确 crisis/high-risk bypass Clinical Logic。

禁止：

- 将 Safety 降级为 Clinical strategy。

### Application Layer

允许：

- debug 展示适配 ClinicalTrace。
- 保持现有聊天、小记、时间线可用。

禁止：

- 在前端引入新的策略判断。

## 12. Engineering Tasks Required Before Clinical Logic Sprint 1

进入 Clinical Logic Sprint 1 代码实现前必须完成：

1. 定义 Clinical Logic runtime entrypoint。
   - 建议单一入口：`createClinicalPlan(context: ClinicalContext): ClinicalPlan`。
   - 所有正常聊天回复必须经过该入口。

2. 更新架构测试。
   - 现有 `check:conversation-os-architecture` 只验证 `runConversationPipeline -> callModel`。
   - Sprint 1 需要新增或更新检查：正常聊天必须经过 Clinical Logic plan。

3. 定义 ClinicalMemoryContext adapter。
   - 输入可以暂时来自 `StructuredRagContext`。
   - 输出必须符合 Clinical Logic 文档：
     - Understanding 优先。
     - Relationship / Timeline supporting。
     - RawMemory not allowed。

4. 收敛 AI generation facade。
   - 登录和游客链路都应调用同一个 AI generation orchestration。
   - 路由只处理认证、限流、持久化差异。

5. 修正 Safety trace / type。
   - Safety 不能在 debug 中表现为普通 fallback。
   - `finalReplySource` 或 route finalSource 需要能明确表达 safety。

6. 冻结旧 strategy fields。
   - `engageMode` / `experienceGoal` / `questionStyle` / `voiceConstraints` 只作为 legacy trace。
   - 不再作为新增策略能力入口。

7. 明确 fallback 只用于异常。
   - provider unavailable
   - model error
   - empty output
   - timeout
   - crisis safety response
   - 正常聊天不得走 fallback。

8. 保证 prompt 不含固定回复模板。
   - ClinicalPlan 只能提供 strategy、boundary、tone constraints。
   - LLM 仍负责最终自然语言。

## 13. Architecture Freeze Decision

Architecture v1 可以冻结，但不是代码清理完成状态。

冻结结论：

- 五层架构成立。
- Conversation OS 不再扩展。
- Memory V2 不再扩展。
- Clinical Logic 是下一阶段唯一主开发方向。
- Safety 继续保持最高优先级。

进入 Clinical Logic Sprint 1 前，必须先完成 P0 工程事项，尤其是：

- Clinical Logic entrypoint。
- Clinical Memory adapter。
- 登录/游客 AI orchestration 收敛。
- Safety trace 修正。
- 旧 Engage/Voice/Question/ExperienceGoal 冻结。

如果不先完成这些收尾，Clinical Logic 很容易变成“新文档 + 旧链路”的并行系统，后续返工风险高。
