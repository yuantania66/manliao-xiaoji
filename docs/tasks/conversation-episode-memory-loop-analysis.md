# Conversation Episode Memory Loop Analysis

## Problem

当前产品已经保存原始聊天并生成逐条消息的 Memory V2 投影，但没有“一个会话形成一个可检索小结”的生产对象。跨会话回复因此只能读取零散消息或旧 V1 片段，唯一 Planner 也没有结构化的历史候选可选择；Surface 更没有接收被 Planner 选中的历史材料。

目标是补齐唯一最小闭环：已提交会话形成证据化小结，当前用户表达检索相关小结，唯一 Planner 决定是否使用，Surface 只自然表达 Planner 选中的内容。

## Evidence

- `prisma/schema.prisma` 已有 `RawMemory`、`Evidence`、`SemanticMemory` 及 append-only `SemanticMemoryVersion`，但 `SemanticMemoryKind` 没有会话小结类型，也没有独立 episode summary 对象。
- `services/memory/refinementWorkerService.ts` 当前按单条 `RawMemory` 做 deterministic segmentation/projection；它不是会话级提炼。
- `services/memory/retrievalService.ts` 当前 V2 retrieval 仅按用户取最近对象，没有接受本轮 people/topics/emotions 作为 episode relevance 输入。
- `services/ai/chatReplyService.ts` 的 `loadMemoryContext` 只取最近一条 Note 或另一个会话的一条 User 消息，并裁成 48 字；它不是会话小结或相关检索。
- `services/ai/chatOrchestrationService.ts` 只把这一条 legacy memory 写入 `confirmedFacts` 或 `unconfirmedHypotheses`；`ResponsePlan` 没有 typed memory selection。
- 同一文件调用 `generateChatReply` 时显式传入 `memoryContext: null`、`understandingContext: null`，因此生产 Surface 不会直接看到检索结果。
- `conversation-os/control/responsePlanner.ts` 是唯一非安全决策所有者；`services/ai/promptBuilder.ts` 的 Surface 只实现 `ResponsePlan`。这两个边界必须保持。
- 现有 `check:memory-v2-retrieval` 与 `check:memory-v2-response-context` 基线均通过，证明复用 Memory V2 投影/版本/证据机制是最小路径。

## Root Cause

问题不是缺一句“我记得你之前提过”的 Prompt，而是数据流在四个责任边界之间断开：

1. Memory 只有逐条消息投影，没有有界、证据化的会话小结。
2. Retrieval 不按本轮语义挑选会话小结。
3. Planner 没有结构化候选，也无法明确选择或放弃历史。
4. Surface 只收到计划，却没有计划已选择的历史内容。

直接把全部历史或全部 `StructuredRagContext` 塞给 Surface 会绕过 Planner；增加固定话术或 Validator 质量硬门只会掩盖这个数据流断点。

## Proposed Solution

1. 复用 `SemanticMemory`/`SemanticMemoryVersion`，新增 `EPISODE_SUMMARY` kind，不新增架构层或持久 lifecycle state。一个 `ChatSession` 对应一个稳定 summary projection；每次更新追加 version，不覆盖旧 version。
2. 在 Assistant 消息成功 commit 且 RawMemory 已落账后，非阻断地刷新本会话小结。小结 provider 强制 JSON，strict parser 只接受：自然摘要、people、topics、emotions、openThreads、confirmedFacts、hypotheses、sourceMessageIds。事实与假设分开，sourceMessageIds 必须属于该会话的已提交消息。
3. 首次生成使用有界的 committed turns；后续使用上一版小结与新提交 turns 增量更新。失败只记录，不回滚已提交回复。
4. Retrieval 接收本轮 extraction/current session，按 people/topics/emotions 重合、文本相关性与 recency 排序，只返回少量其他会话的小结；无相关性时返回空。
5. `ConversationControlContext` 接收 typed episode candidates。Planner 在直接回答、修复、暂停、无内容或低相关场景可不选；选中时写入 `ResponsePlan.selectedEpisodeMemory` 和 memory provenance。它只是可用材料，不改变本轮主要动作，也不得把 hypothesis/因果升级成事实。
6. Surface 只接收 Planner 选中的一条 compact episode memory。Prompt 说明自然承接、不得复述系统结构、不得宣称未确认因果；不提供示例句或固定话术。
7. Validator 不新增聊天质量规则；Safety、硬事实、strict parser、fail-closed、不可变 commit/event edge 保持原样。

验收：

- 旧会话“领导临时改需求”形成小结；新会话“最近不想上班”能检索到它，Planner 可选并把它投影给 Surface。
- Planner 可以在直接问题、暂停、无关话题和低相关候选中明确不使用历史。
- 未确认的“领导导致不想上班”只能作为探索线索，不能成为事实或确定因果。
- Surface Prompt 只含被选中的 compact summary，不含完整旧聊天或未选候选。
- Summary 失败不影响当前 Assistant commit；不产生 lifecycle state。

## Files To Change

- `prisma/schema.prisma` 与一个 additive migration：新增 `SemanticMemoryKind.EPISODE_SUMMARY`。
- 新增 `services/memory/episodeSummaryService.ts`：strict structured summary、增量 version、Evidence links、相关检索。
- `services/ai/chatReplyService.ts`：commit 后触发非阻断 summary refresh，并传入 episode candidates。
- `app/api/chat/sessions/[sessionId]/messages/route.ts`：用本轮 extraction 检索相关 episode candidates。
- `conversation-os/control/types.ts`、`contextAssembly.ts`、`responsePlanner.ts`：typed candidate、Planner optional selection、memory provenance。
- `services/ai/chatOrchestrationService.ts`、`services/ai/promptBuilder.ts`：贯通 Planner 选择到 Surface 的最小投影。
- 新增 `scripts/conversation-episode-memory-loop-check.ts` 并在 `package.json` 注册窄测；必要时只扩充现有 Memory/Orchestration 测试的兼容断言。
- `docs/ARCHITECTURE_V1_FINAL.md`：记录该闭环属于 Memory projection/context provider，Planner 仍是唯一决策者，Surface 不自行检索。

## Risks

- `chatReplyService.ts`、`chatOrchestrationService.ts`、Planner、Prompt 当前已有其他未封存改动；实现必须做局部增量，不能覆盖或重排无关 diff。
- commit 后若同步等待摘要模型会增加响应延迟；实现必须把摘要失败与回复 commit 隔离，并保持可替换 provider 测试缝。
- 现有 mock provider 可能不返回 episode JSON；生产 summary 必须 strict，测试应注入 provider，不能用宽松 parser 伪造成功。
- 只靠词面重合会漏掉隐含相关性；最小闭环先复用当前 extraction 的 people/topics/emotions，再用 compact 文本 token overlap 补充，不在本切片引入 embedding/GraphRAG。
- 会话尚未出现新 committed turn 时不得重复创建版本；operationId 必须按 session + last committed message 幂等。
- 用户修正/删除 summary 的 UI、完整关系消歧、GraphRAG、长期因果模型和主动展示小结均不在本切片。
