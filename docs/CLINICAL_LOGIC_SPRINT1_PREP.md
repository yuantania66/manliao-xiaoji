# Clinical Logic Sprint 1 Prep

## 1. Purpose

本文档定义进入 Clinical Logic Sprint 1 代码实现前必须完成的 P0 工程准备。

本文档基于：

- `docs/PRODUCT_ARCHITECTURE_V1.md`
- `docs/ARCHITECTURE_V1_FREEZE_CHECKLIST.md`
- `docs/CLINICAL_LOGIC_IMPLEMENTATION_PLAN.md`

本文档只描述工程准备事项，不新增架构层，不实现 Clinical Logic，不扩展 Memory，不继续调 Prompt / Voice / 单句回复。

## 2. Scope

Clinical Logic Sprint 1 的前置目标不是让回复更好，而是确保代码链路具备接入 Clinical Logic 的干净位置。

进入 Sprint 1 前必须完成四个 P0：

1. 收敛 AI orchestration 入口。
2. 定义 ClinicalMemory adapter。
3. 修 Safety trace 命名。
4. 冻结旧 EngageMode / Voice / QuestionStyle / ExperienceGoal。

完成这些 P0 后，Clinical Logic 才能作为独立策略层接入，而不是混进旧 Conversation OS / Voice / Prompt 逻辑。

## 3. P0-1: 收敛 AI Orchestration 入口

### 当前问题

当前登录用户和游客用户的 AI 生成链路分叉。

登录用户链路：

```text
app/api/chat/sessions/[sessionId]/messages/route.ts
  -> createReviewedChatReply()
  -> generateChatReply()
  -> runConversationPipeline()
  -> buildVoiceConstraints()
  -> buildChatPrompt()
  -> callModel()
```

游客链路：

```text
app/api/chat/guest/route.ts
  -> generateChatReply()
  -> runConversationPipeline()
  -> buildVoiceConstraints()
  -> buildChatPrompt()
  -> callModel()
```

重复实现包括：

- Safety gate 命中后的 response assembly。
- fallback response assembly。
- `createFallbackJudge()`。
- `createDisabledJudge()`。
- `getFallbackRiskLevel()`。
- debug trace assembly 参数。

这会导致 Clinical Logic 可能只接入其中一条链路，造成登录用户和游客用户行为不一致。

### 涉及文件

- `app/api/chat/sessions/[sessionId]/messages/route.ts`
- `app/api/chat/guest/route.ts`
- `services/ai/chatReplyService.ts`
- `services/ai/aiService.ts`
- `services/ai/chatSafety.ts`
- `services/ai/debugTrace.ts`
- `services/ai/types.ts`

### 为什么阻塞 Clinical Logic Sprint 1

Clinical Logic 必须成为所有正常聊天回复的唯一 strategy entrypoint。

如果登录用户和游客用户继续走不同 orchestration：

- ClinicalPlan 可能只在登录链路生效。
- Debug trace 会出现两套字段。
- Safety / fallback / judge 行为可能漂移。
- 架构测试无法证明“正常聊天必须经过 Clinical Logic”。

这会让 Clinical Logic 变成部分接入，而不是架构层接入。

### 最小修改范围

只做 orchestration 收敛，不改 Prompt 主结构，不改回复策略。

建议新增或收敛为一个内部服务入口，例如：

```ts
createChatGenerationOrchestration(input)
```

该入口负责：

- Safety gate。
- 调用 `generateChatReply()`。
- fallback。
- disabled judge compatibility。
- debug trace assembly。
- 返回统一 generation result。

路由层只保留：

- 登录校验。
- 游客限流。
- message persistence。
- RawMemory 写入。
- response serialization。

### 验收标准

- 登录聊天和游客聊天都通过同一个 AI orchestration service。
- Safety / fallback / disabled judge 逻辑不再在 route 中重复。
- 正常聊天仍经过 `runConversationPipeline()`。
- debug trace 字段保持兼容。
- `check:conversation-os-architecture` 仍通过。
- 新增或更新架构测试，能证明正常聊天生成入口唯一。

## 4. P0-2: 定义 ClinicalMemory Adapter

### 当前问题

当前 response memory context 使用的是混合容器 `StructuredRagContext`。

来源包括：

- V1 `Fact`
- V1 `ExperienceSlice`
- V1 `Event`
- V1 `Hypothesis`
- user feedback
- professional guidance
- Memory V2 mapped items

Memory V2 的 `Understanding` / `Timeline` / `Relationship` 目前被映射进 `recentMemories`，没有专用字段。

同时还存在旧的轻量 prompt memory：

- `loadMemoryContext()`
- `AiMemoryContext`
- `createNoteMemoryContext()`
- `createChatMemoryContext()`

这些都不适合作为 Clinical Logic 的直接输入。

### 涉及文件

- `services/understanding/understandingTypes.ts`
- `services/understanding/retrievalService.ts`
- `services/memory/retrievalService.ts`
- `services/memory/responseContextService.ts`
- `services/ai/chatReplyService.ts`
- `services/ai/dataLayers.ts`
- `services/ai/types.ts`
- `services/ai/promptBuilder.ts`

### 为什么阻塞 Clinical Logic Sprint 1

Clinical Logic 的输入必须是 bounded clinical context，而不是旧 RAG 容器。

Clinical Logic 需要的 Memory 规则是：

- 优先使用 Understanding。
- Relationship / Timeline 只能作为 supporting context。
- 不直接读 RawMemory。
- 不对 deterministic MVP memory 做强判断。

如果直接消费 `StructuredRagContext`：

- Clinical Logic 会继承 V1/V2 混合语义。
- Relationship / Timeline 可能被错误当作强事实。
- RawMemory 或 raw segment 语义可能间接进入策略判断。
- 后续 Memory V2 替换 V1 时会导致 Clinical Logic 大返工。

### 最小修改范围

只定义 adapter contract，不实现新的 Memory 能力。

建议新增 adapter 输出：

```ts
interface ClinicalMemoryContext {
  understandings: ClinicalMemoryItem[]
  relationships: ClinicalMemoryItem[]
  timelineEvents: ClinicalMemoryItem[]
  excluded: {
    rawMemory: "not_allowed"
    v1ContextUsed: boolean
    deterministicMemoryCaveat: string[]
  }
}
```

adapter 输入可以暂时是：

```ts
StructuredRagContext
```

但输出必须按 Clinical Logic 需要重新分层：

- `memory-v2-understanding:*` -> `understandings`
- `memory-v2-relationship:*` -> `relationships`
- `memory-v2-timeline:*` -> `timelineEvents`
- V1 hypothesis / fact / experience 只能进入 caveat 或低优先级 supporting，不得作为强判断。

不做：

- 不扩展 Memory V2 schema。
- 不新增 Graph-ready。
- 不直接读取 RawMemory。
- 不改 Projection Framework。

### 验收标准

- 存在明确的 `ClinicalMemoryContext` contract。
- Clinical Logic 可消费 adapter 输出，而不是直接消费 `StructuredRagContext`。
- adapter 输出中 RawMemory 明确为 `not_allowed`。
- Understanding 优先级高于 Relationship / Timeline。
- Relationship / Timeline 标记为 supporting context。
- deterministic MVP memory 有 caveat。
- 不新增 Memory schema。

## 5. P0-3: 修 Safety Trace 命名

### 当前问题

当前 Safety 命中后：

- route/debug 层的 `finalSource` 是 `"safety"`。
- 但 `createSafetyGeneration()` 返回的 `finalReplySource` 是 `"fallback"`。

位置：

```ts
createSafetyGeneration()
```

当前语义会让 trace 同时出现：

```text
route.finalSource = safety
generation.finalReplySource = fallback
```

这会混淆 Safety 和普通 fallback。

### 涉及文件

- `services/ai/chatSafety.ts`
- `services/ai/types.ts`
- `services/ai/debugTrace.ts`
- `services/ai/chatReplyService.ts`
- `app/api/chat/guest/route.ts`
- `app/chat/chat-client.tsx`
- `scripts/ai-base-chat-check.ts`

### 为什么阻塞 Clinical Logic Sprint 1

Clinical Logic 的前置规则是：

```text
Safety 永远先于 Clinical Logic。
Crisis / high-risk 直接走 Safety，不进入普通 ClinicalPlan。
```

如果 trace 中 Safety 被标成 fallback：

- 无法稳定验证 high-risk 是否绕过 Clinical Logic。
- Debug 会误判 Safety 是模型失败后的 fallback。
- Clinical Logic trace 无法清楚表达 `skippedBySafety`。

这会直接影响 Sprint 1 验收。

### 最小修改范围

只修命名和 trace，不改 Safety 策略。

建议：

- 将 `AiGenerationResult.finalReplySource` 扩展为包含 `"safety"`。
- `createSafetyGeneration()` 返回 `finalReplySource: "safety"`。
- Debug UI 和检查脚本同步允许 safety。
- 保留 route `finalSource: "safety"`。

不做：

- 不扩展危机词库。
- 不改 Safety Response 文案。
- 不实现 Clinical risk assessment。

### 验收标准

- Safety 命中时：
  - `route.finalSource = "safety"`
  - `generation.finalReplySource = "safety"`
- 普通 fallback 仍为：
  - provider unavailable
  - model error
  - empty output
  - timeout
- Debug 中 Safety 和 fallback 可明确区分。
- Crisis / high-risk trace 可表达 `Clinical Logic skipped by Safety`。
- 现有 AI base check 更新并通过。

## 6. P0-4: 冻结旧 EngageMode / Voice / QuestionStyle / ExperienceGoal

Status: completed on 2026-07-09.

Completion notes:

- `EngageMode`, `ExperienceGoal`, `QuestionPurpose`, `QuestionAvoid`, `QuestionStyle`, `ResponseGoal`, and `AiVoiceConstraints` are marked legacy / frozen / do not extend in code comments.
- Existing Conversation OS v1 behavior remains intact for compatibility.
- Architecture checks now pin the existing legacy enum values and `AiVoiceConstraints` fields.
- Future response strategy must use `ClinicalPlan`; old Engage / ExperienceGoal / QuestionStyle / Voice fields may remain as compatibility and trace fields only.

### 当前问题

旧 Conversation OS 仍包含大量策略性字段：

- `EngageMode`
- `ExperienceGoal`
- `QuestionStyle`
- `ResponseGoal`
- `Voice Layer`

这些字段目前仍进入 prompt，并影响 LLM 回复。

主要位置：

- `conversation-os/engage/index.ts`
- `conversation-os/types.ts`
- `services/ai/voiceLayer.ts`
- `services/ai/promptBuilder.ts`
- `services/ai/debugTrace.ts`

Architecture v1 已经明确：

- Conversation OS 不再扩展为策略层。
- Clinical Logic 负责 response strategy。
- 旧 EngageMode / ExperienceGoal / QuestionStyle / Voice 不再扩展。

### 涉及文件

- `conversation-os/engage/index.ts`
- `conversation-os/types.ts`
- `conversation-os/pipeline.ts`
- `services/ai/voiceLayer.ts`
- `services/ai/promptBuilder.ts`
- `services/ai/debugTrace.ts`
- `scripts/conversation-os-architecture-check.ts`
- `docs/CONVERSATION_OS_V1.md`
- `docs/QUESTION_STYLE_GUIDE.md`

### 为什么阻塞 Clinical Logic Sprint 1

如果这些旧字段继续扩展：

- Clinical Logic 会和旧 Engage/Voice 同时决定 strategy。
- Prompt 会同时收到两套策略信号。
- 测试失败时无法判断问题来自 Clinical Logic、Voice 还是 Engage。
- Strategy ownership 不清晰。

Clinical Logic 必须成为唯一 response strategy 主入口。

旧字段可以暂时保留为 compatibility / trace，但不能继续作为新增策略能力。

### 最小修改范围

不删除旧字段，避免破坏当前聊天。

最小准备动作：

- 在文档中标记 frozen。
- 在代码注释或架构检查中标记不允许新增枚举值和规则。
- `Voice Layer` 不再新增禁词、case 规则或 experienceGoal 解释。
- `QuestionStyle` 不再扩展。
- `EngageMode` 不再扩展。
- `ExperienceGoal` 不再扩展。

Clinical Logic 接入后：

- LLM 应优先消费 `ClinicalPlan`。
- 旧字段只保留为 legacy trace 或逐步删除。

### 验收标准

- 无新增 `EngageMode` 枚举值。
- 无新增 `ExperienceGoal` 枚举值。
- 无新增 `QuestionStyle` purpose / avoid。
- `services/ai/voiceLayer.ts` 无新增策略规则。
- `promptBuilder` 不再新增旧 Conversation OS strategy 说明。
- 架构文档明确旧字段 frozen。
- Sprint 1 后，ClinicalPlan 成为唯一新增 response strategy 输入。

## 7. Explicit Non-Goals

Clinical Logic Sprint 1 Prep 不做：

- 不实现 Rogers。
- 不实现 CBT。
- 不实现 ACT。
- 不实现 MI。
- 不做完整 Clinical reasoning。
- 不改 Prompt 主结构。
- 不继续调 Voice Layer。
- 不继续新增禁词。
- 不继续根据单句 case 写规则。
- 不继续扩 Memory。
- 不做 Graph-ready。
- 不做 Timeline schema 深化。
- 不做 Understanding schema 深化。
- 不做 Relationship 消歧 / 合并。
- 不做 Report。
- 不做 Assessment。
- 不做 Diagnosis。
- 不做 Clinical Feedback。
- 不做 Treatment Plan。

## 8. Sprint 1 Entry Criteria

只有满足以下条件，才可以进入 Clinical Logic Sprint 1 代码实现：

1. AI orchestration 入口已收敛。
2. 登录 / 游客正常聊天都能走同一生成 orchestration。
3. ClinicalMemory adapter contract 已定义。
4. Clinical Logic 不直接消费 `StructuredRagContext`。
5. Safety trace 能区分 safety 与 fallback。
6. Crisis / high-risk 可在 trace 中明确表达跳过普通 Clinical Plan。
7. EngageMode / Voice / QuestionStyle / ExperienceGoal 已冻结。
8. 架构测试覆盖：
   - 正常聊天必须经过 Conversation OS。
   - 后续正常聊天必须经过 Clinical Logic。
   - route 不直接调用 LLM。

## 9. Freeze Decision

Clinical Logic Sprint 1 Prep 的核心判断：

当前不是缺少 Clinical 策略，而是缺少干净的策略接入口。

在 P0 完成前直接实现 Rogers / CBT / ACT / MI，会把 Clinical Logic 塞进旧 Prompt / Voice / Engage 链路，造成后续返工。

因此，Sprint 1 Prep 必须先完成工程收口，再进入 Clinical Logic 正式实现。
