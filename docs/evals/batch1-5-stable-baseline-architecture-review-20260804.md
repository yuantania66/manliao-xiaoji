# Batch 1.5 Stable Baseline Architecture Review

日期：2026-08-04（Asia/Shanghai）

评审类型：只读架构评审；未修改运行时代码、Prompt、Planner、Validator、评测配置或样本。

## 1. Executive Decision

结论：**Go for infrastructure-only — 当前 Conversation OS 具备承载 Batch 2 基础设施切片的架构骨架，但 Batch 2 能力本身尚未实现。**

可以开始的范围是：跨轮关联、`CommittedHelpingMove` 严格序列化/加载、原子提交边界、Shadow reaction trace 和生命周期回归。

不能据此开始或宣称：

- 用户可见 `hill_helping` 行为；
- 用 User Model 决定当前回复；
- 用 Initiative、继续聊天、回复长短或消息相邻推断上一技术有效；
- 将 Shadow、ordinary、legacy、Validator rejected、failed 或 unsent 回复写成正式 Helping move。

本评审最初识别的两个治理前置条件已在随后获批的 baseline-seal 交付切片中处理：

1. Architecture v1、PRD、Clinical Logic 和迁移计划统一以 Batch 1.5-E
   `passed_and_closed` 为当前权威状态；早期失败报告保留为历史证据。
2. 当前 Conversation OS / Batch 1.5-E 增量按 source/contracts、verification/evidence
   和 repository governance 三类完成清点，通过冻结门后作为一个 Git baseline seal
   提交；Batch 2 实现不混入该提交。

因此最终判定是：

```text
Architecture capacity for Batch 2 infrastructure: APPROVED
Current Batch 2 implementation completeness: NOT READY
User-visible Hill behavior: NOT AUTHORIZED / NOT READY
User Model behavior integration: NOT READY AND NOT REQUIRED FOR BATCH 2
```

## 2. Review Baseline and Evidence

Batch 1.5-E 是本评审的用户可见稳定基线：冻结数据 SHA
`12bd41f3c6c4370ddc3593cf997203037bc321a3b40d890ce196e9f6bcd6f243`，
Qwen `qwen3.7-max`，20 场景 × 3 次；Functional 60/60、Machine Validator
60/60、Constraint Failure 0、Regeneration 5/60。该门证明当前 ordinary emotional support / repair
在冻结范围内稳定，不证明 Batch 2 的跨轮关联、持久化和并发正确性。

证据：[Batch 1.5-E 完整冻结门结果](./hill-helping-batch1-5-preservation-batch1-5-e-result-20260803.md)。

本次只读复核通过：

- `npm run check:conversation-os-architecture`
- `npm run check:conversation-os-control`
- `npm run check:memory-v2`
- `npm run check:hill-helping-batch1-5`
- `git diff --check`

首次执行 `check:hill-helping-batch1-5` 时，沙箱内 `tsx` IPC socket 返回 `EPERM`；在获准的非沙箱只读重跑中通过。这是执行环境问题，不是产品或测试失败。

## 3. 当前最终架构

### 3.1 五层架构与控制链

当前产品仍是五层架构：Application、Conversation、Clinical Logic、Memory & Mental Model、Safety & Governance。Helping Logic 属于 Clinical Logic，不新增第六层。

普通非 Safety 运行链为：

```text
Safety pre-gate
  -> Context Assembly
  -> deterministic + optional model Turn Interpretation
  -> Dialogue / Interaction State
  -> Hill Shadow / uncertain ordinary-handoff boundary
  -> single Response Planner
  -> ResponsePlan preflight
  -> free-text Surface Realization
  -> same-plan Validator
       -> accept
       -> one same-plan regeneration
       -> constraint_failure
  -> atomic Assistant Message + CommittedAssistantMove persistence
  -> post-commit RawMemory capture
```

实现证据：

- Safety、Context、Interpretation、Dialogue State、Hill Shadow、Planner 的实际顺序见 [chatOrchestrationService.ts](../../services/ai/chatOrchestrationService.ts)。
- Assistant Message 与 ordinary `interactionMetadata` 已在同一事务提交，见 [chatReplyService.ts](../../services/ai/chatReplyService.ts)。
- `ChatMessage.interactionMetadata` 和幂等 `replyToMessageId` 已存在，见 [schema.prisma](../../prisma/schema.prisma)。

### 3.2 已实现、扩展点与未实现

| 能力 | 当前状态 | Batch 2 含义 |
|---|---|---|
| 唯一 final Response Planner | 已实现 | 保持不变 |
| Hill Shadow 在 Planner 前运行 | 已实现 | 可承载 reaction trace |
| Shadow 不进入 ResponsePlan/Surface/正式状态 | 已实现 | 必须保持 |
| same-plan Validator + 最多一次 regeneration | 已实现 | 不负责判断助人效果 |
| Assistant Message + ordinary move 原子提交 | 已实现 | 可作为 Batch 2 提交接点 |
| `CommittedHelpingMove` TypeScript 类型 | 已实现 | 只是类型脚手架 |
| `recentCommittedHelpingMoves` 输入字段 | 已实现 | 当前调用仍为空 |
| 严格序列化、schema validation、加载 | 未实现 | Batch 2 核心工作 |
| 显式较早 target 补入候选 | 未实现 | Batch 2 核心工作 |
| Shadow/formal 状态区分 | 未实现 | Batch 2 核心工作 |
| 删除/重试/失败/并发无幽灵记录 | 未实现 | Batch 2 硬门 |
| `behaviorSource=hill_helping` | 未实现 | Batch 3 才允许用户可见启用 |

`CommittedHelpingMove` 和输入字段见 [hillHelpingTypes.ts](../../services/helping/hillHelpingTypes.ts)；Input Builder 当前默认空数组并只保留最后 8 项，见 [hillHelpingInputBuilder.ts](../../services/helping/hillHelpingInputBuilder.ts)。实际 orchestration 没有传入历史 Helping move，见 [chatOrchestrationService.ts](../../services/ai/chatOrchestrationService.ts)。

## 4. Planner / Surface / Validator 边界

### 4.1 Planner

Planner 是唯一最终计划写入者，读取 Dialogue State 中的活动、直接义务、修复、主动权、已确认事实和普通 handoff boundary，产出唯一 `ResponsePlan`。当前实际 `behaviorSource` 仍只有 `ordinary_conversation | legacy_compat`，没有正式 Hill plan projection。

证据：[types.ts](../../conversation-os/control/types.ts)、[responsePlanner.ts](../../conversation-os/control/responsePlanner.ts)。

Batch 2 不应让 Planner读取 reaction candidate 后直接换动作。Batch 2 的 reaction assessment 只进入独立 Shadow trace；用户可见计划保持基线等价。

### 4.2 Surface

Surface 只接收最终 ResponsePlan 和有界历史，自由生成自然语言。生产调用显式传入 `memoryContext:null`、`understandingContext:null`；长期上下文若要影响表达，必须先通过计划边界，不能直达 Surface。

证据：[chatOrchestrationService.ts](../../services/ai/chatOrchestrationService.ts)、[promptBuilder.ts](../../services/ai/promptBuilder.ts)。

Batch 1.5-E 证明此 Surface 在冻结 ordinary emotional support/repair 范围可用，但 8.33% regeneration 和一个 attempt-level Validator false positive 说明自由文本仍有随机实现成本。Batch 2 不改变 Surface，因此该成本是已知但非阻塞风险。

### 4.3 Validator

Validator 只能接受、拒绝或要求同一 `planId` 再生成；它不能重规划，也不能判断“帮助是否有效”。产品合同明确规定，助人影响只能在下一轮依据用户反应判断。

证据：[responsePlanValidator.ts](../../services/ai/responsePlanValidator.ts)、[Hill 产品合同](../HILL_HELPING_PROCESS_PRODUCT_CONTRACT_V1.md)。

结论：Planner / Surface / Validator 三层边界足以承载 Batch 2；不需要为了 Batch 2 重构它们。跨轮目标绑定、reaction relation 和 `impactKnown` 应属于 Helping Logic/状态关联层，不能塞进 responsePlanValidator。

## 5. Memory 接入点

### 5.1 当前真实接点

当前存在两类 Memory 接点：

1. 简化 compatibility memory：最新用户确认 Note 可进入 `confirmedFacts`，普通历史聊天只能进入 `unconfirmedHypotheses`；Planner 只把用户确认 memory 纳入 grounding facts。
2. Memory V2：RawMemory → Evidence → deterministic projections → V2 retrieval → `StructuredRagContext` feature flag。该 flag 默认关闭，当前投影是工程骨架，不是经过验证的长期 User Model 语义。

证据：[chatOrchestrationService.ts](../../services/ai/chatOrchestrationService.ts)、[dataLayers.ts](../../services/ai/dataLayers.ts)、[Memory V2 Phase 2 Acceptance](../MEMORY_V2_PHASE2_ACCEPTANCE.md)。

### 5.2 Batch 2 的正确接入点

`CommittedHelpingMove` 是当前会话的助人过程状态，不是长期 Memory，也不是用户画像。正确接点是现有 `ChatMessage.interactionMetadata` / committed Assistant move 的会话生命周期：

```text
validated formal Hill plan
  + actually committed Assistant Message
  -> optional versioned CommittedHelpingMove metadata
  -> bounded current-session loader
  -> HillHelpingInput candidates on next turn
```

初始方案应遵循现有迁移合同，优先验证复用 `interactionMetadata` 的可行性；如果严格 schema、原子性或查询需求无法满足，应停止并单独申请数据库变更，不能顺带迁移。

Batch 2 不得：

- 把 Helping move 写入 RawMemory/Understanding/Relationship；
- 将 reaction 或 `impactKnown` 固化为长期用户特征；
- 让异步 Memory 写入回灌当前轮计划；
- 用长期 Memory 代替当前会话中的显式 reply target 和语义关系。

## 6. Initiative 接入风险

当前 `initiativeOwner=user|assistant|shared|paused` 已是正式 Interaction State；Planner据此控制轻量话题主动权和问题预算。该状态可继续作为 Conversation OS 的当前轮证据，但不能成为上一 Helping move 的效果证据。

主要风险：

1. **归因污染（高）**：`yields_initiative`、用户继续聊天或 assistant initiative 不等于接受或使用上一技术。
2. **较早目标丢失（高）**：当前有界相邻历史无法保证包含用户显式回复的较早 move；必须按 `replyToMessageId` 补候选，不能简单改为“只取最后一条”或无界历史。
3. **暂停误读（高）**：`paused` / `requests_pause` 是用户控制硬边界，不能被记成技术失败或 exploration 反馈。
4. **普通动作升级（高）**：ordinary handoff、proactive greeting、`repair_previous_wording`、light topic initiative 都不能自动升级为正式 Hill move 或 relationship repair。
5. **双向污染（中高）**：reaction assessment 不得直接改写 initiative；initiative 也不得直接决定 `impactKnown`。

Batch 2 应增加一个明确的 `B2-Initiative-Isolation` 门：相同 initiative 状态在“相关回复、话题切换、主动欢迎、暂停、普通修复、显式较早目标”中不得产生错误 Helping 归因。

## 7. User Model 接入风险

结论：**User Model 不是 Batch 2 前置依赖，当前也不具备影响回复行为的安全接入条件。**

当前风险排序：

1. **P0 — 语义输入不合格**：V2 主要是 deterministic raw-segment projection，不能当作稳定用户理解。
2. **P0 — 事实/假设合同不足**：推断若进入 `confirmedFacts` 会升级成事实；若直达 Prompt 会绕过 Planner/Validator。
3. **P1 — 生命周期/相关性不足**：检索缺少完整的失效 Evidence、删除/tombstone 与当前话轮相关性硬门。
4. **P1 — V1/V2 双轨漂移**：规则型 V1 hypothesis 与 evidence-backed V2 共存，容易在同一容器中失去来源边界。
5. **P2 — 可观测性不足**：当前计划/Surface provenance 还不能完整保留 memory id、version、evidence 和修正状态。

未来若单独评审 User Model，最小合同应要求：current version、有效 Evidence、可见 Raw、明确 epistemic status、当前轮相关性、修正状态和可追溯 provenance；只有用户确认内容可进入事实通道，hypothesis 必须保持可修正且不得直接决定 affect、initiative、repair 或 Safety。该工作应先 Shadow/read-only 评估，不应并入 Batch 2。

## 8. Batch 2 推荐路线

Batch 2 必须保持迁移计划定义：跨轮关联与提交边界，用户可见回复不变。

### 2A — Contract Gate

- 统一 Batch 1.5-E 权威状态并冻结 Batch 2 delivery slice；
- 定义带版本的 `CommittedHelpingMove` metadata schema 和严格 parser；
- 区分 formal committed state 与 Shadow trace；
- 明确 invalid/legacy metadata 的忽略、trace 和不进入决策规则。

通过门：`B2-Contract`。

### 2B — Fixture Load and Association Gate

- 实现当前会话、有界、按提交顺序的 loader；
- 额外补入显式 `replyToMessageId` 指向的较早 Assistant move；
- 先判断 target/relation，再生成 reaction candidates；
- `topic_shift` 与 `unclear` 必须保持 `impactKnown=false`；
- 当前轮纠正必须绑定被纠正的具体 move。

通过门：`B2-Association`、`B2-Initiative-Isolation`。

### 2C — Atomic Boundary Gate

- 在现有 ChatMessage transaction/idempotency 边界验证 optional helping metadata；
- 证明 unsent、Validator rejected、provider failure、retry loser、ordinary、legacy 和 Shadow 均产生 0 个正式 Helping move；
- 验证重复请求、并发、删除会话和级联失效无幽灵记录。

由于当前生产 `ResponsePlan` 没有 `hill_helping` behavior source，Batch 2 生产普通流量的正式 Helping move 写入预期应为 0；正向提交路径只使用 fixture/受控测试验证，不能把 ordinary 或 Shadow 伪装成 formal move。

通过门：`B2-Atomicity`。

### 2D — Shadow Preservation Gate

- 仅在独立 Shadow trace 记录 relation type、reaction candidates、target turn 和 `impactKnown`；
- 比较开关前后 ResponsePlan、Surface input、用户可见回复和正式状态，除 Shadow trace/latency 外必须等价；
- 重跑 Conversation OS、Chat execution lifecycle、Memory、Initiative/proactive greeting 以及 Batch 1.5-E 冻结保留门。

通过门：`B2-Baseline-Preservation`。

五个门全部通过后，才可宣布 Batch 2 完成。Batch 2 通过不自动授权 Batch 3、生产 canary、默认开启或 User Model 行为接入。

## 9. Resolved Entry Preconditions and Final Readiness

### 已解决的进入前置条件

1. **文档权威状态已统一**：Architecture v1、PRD、Clinical Logic、迁移计划、
   Batch 1.5-E 结果和 `PROJECT_TEAM.md` 均以 `passed_and_closed` 为当前状态；早期
   candidate 失败文档不被改写。
2. **实现基线已纳入封存切片**：所有待提交路径已分类，敏感信息和大文件检查通过，
   本报告与权威状态修订随同一 baseline-seal commit 上传；提交 SHA 由交付报告记录。

### 不是阻塞项，但必须保留的边界

- 自由文本 Surface 和现有 same-plan Validator 不需要为 Batch 2 重构。
- User Model 不进入 Batch 2。
- `behaviorSource=hill_helping` 不在 Batch 2 用户可见流量启用。
- Batch 1.5-E 的 attempt-level Validator false positive 仍是已知非阻塞观察，不应在 Batch 2 顺带修复。

## 10. Final Conclusion

当前 Conversation OS **具备承载 Batch 2 的架构能力**：单一 Planner、受限 Surface、same-plan Validator、Shadow Helping seam、正式消息事务边界和会话级 interaction metadata 都已存在。

当前 Conversation OS **尚不具备直接运行 Batch 2 的完整实现条件**：正式 Helping move 的严格存取、目标绑定、reaction semantic association、formal/shadow 区分、删除/重试/并发一致性均未实现。

批准进入 **Batch 2 infrastructure-only delivery slice**；保持用户可见回复不变，
排除 User Model 和 Batch 3 行为启用。该批准在 baseline-seal commit 成功推送后生效。
