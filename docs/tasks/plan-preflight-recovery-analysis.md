## Problem

普通聊天当前只有“Planner 产出计划 → preflight 通过后调用 Surface”这一条前进路径。只要计划中的一个可选局部动作缺少证据，整个用户话轮就直接成为 `PLAN_INVALID`；客户端再次执行相同输入时，Planner 仍可能选择相同动作，于是形成可重复的失败循环。

真实反例是跨会话场景：旧会话已记录“领导临时改需求，我很累”，新会话用户说“最近不想上班”。Episode Memory 能被检索并由 Planner 选中，但本轮没有 canonical affect span。Dialogue State 仍可令 Planner 选择 `offer_emotional_support`，Planner 随后构造空 `affectEvidenceSpans` 的 positive-function contract；preflight 以 `missing_emotional_support_evidence_spans` 拒绝计划，Surface 从未被调用。

本切片的结果只应是：可选局部动作证据不足时，由唯一 Planner 在系统内部重新规划一次，再次 preflight；不得由 Orchestration 直接改 plan，不得由 Surface 或 Validator 重规划，不得提交失败计划，不得新增持久 lifecycle state。

## Evidence

- `conversation-os/state/conversationStateService.ts` 的 `extractAffectEvidence()` 是当前话轮 affect span 的唯一来源；“最近不想上班”不产生 span。该文件同时说明下游不得维护第二套 affect 词表。
- `conversation-os/control/responsePlanner.ts:307-342` 只依据 `DialogueState` 中是否存在 `supporting_emotion` 选择 `offer_emotional_support`，没有要求 `context.interaction.affectEvidence` 非空。
- `conversation-os/control/responsePlanner.ts:251-275` 在该 action 已被选择时无条件构造 emotional positive-function contract；证据来自 `context.interaction.affectEvidence`，因此可能得到空数组。
- `conversation-os/control/responsePlanner.ts:491-501` 又依据同一个 `supporting_emotion` activity 请求 Clinical compatibility advice；如果恢复只删除 action 而不让 Planner 重新组装，`clinicalStrategy` 与 `behaviorSource` 仍会残留，形成另一份不一致计划。
- `services/ai/chatExecutionLifecycle.ts:216-269` 正确地验证 emotional span 必须来自当前用户话轮、精确绑定 source text、类型有效且 projection 一致。这里的 hard evidence contract 不应放宽。
- `services/ai/chatOrchestrationService.ts:439-518` 当前只调用一次 Planner 和一次 preflight；任一 preflight failure 都立即返回 `PLAN_INVALID`，`generation.model="not-called"`，没有内部恢复。
- `scripts/chat-execution-lifecycle-check.ts:153-174` 已冻结“空 emotional spans 必须 preflight 失败”；修复不能删除这一断言，而应在 Orchestration 层消费这个具体失败并交回 Planner。
- `docs/ARCHITECTURE_V1_FINAL.md:250-275` 规定 Response Planner 是唯一普通计划 writer；`docs/tasks/conversation-reply-logic-inventory.md:167-186` 规定 Surface 只实现 preflight-valid frozen plan、Validator 只校验同一 plan。恢复因此必须发生在 Surface 之前，并且只能由 Planner 完成。
- `docs/CONVERSATION_PURPOSE_CONTRACT_V1.md` 规定证据不足时默认陪伴，不能替用户宣布真实感受或动机。撤销无证据 emotional-support action 后继续普通内容探索符合该合同；整轮无回复不符合“关系连续性”底线。

## Root Cause

根因不是 Qwen、Episode Memory 或 Surface 生成失败，而是 Planner 与 preflight 之间缺少失败反馈闭环：

1. Dialogue State 可以表达宽泛的 `supporting_emotion` 活动；
2. Planner 把该活动直接升级为需要严格 current-turn affect evidence 的 `offer_emotional_support` action；
3. canonical affect evidence 为空时，Planner 仍生成该 action 及空证据 contract；
4. preflight 正确拒绝不具备证据的动作；
5. Orchestration 把“一个可选动作不可执行”错误提升为“整个话轮不可回复”，且没有把原因交回唯一 Planner。

这是责任恢复缺失，而不是 evidence gate 过严。若直接放宽 `missing_emotional_support_evidence_spans`，Surface 会获得授权去表达未经当前话轮支持的具体情绪；若 Orchestration 直接删除 action，则 Orchestration 会成为第二 Planner，并可能留下 `clinicalStrategy`、question policy、provenance 等互相矛盾的字段。

preflight failure 必须分为两类：

- **可恢复的局部计划失败**：本切片只允许精确的 `missing_emotional_support_evidence_spans`，并且失败 reason 集合中没有任何其他 reason；原计划必须同时包含 `offer_emotional_support` 与 matching emotional contract。它表示某个可选普通动作缺少 canonical evidence，不表示 plan identity、authority 或数据绑定已损坏。
- **必须 fail-closed 的结构或 authority 错误**：包括缺失/错误 `planId`、`decisionOwner`、`behaviorSource`、disclosure scope、planning depth、handoff 字段；detached authority、answer obligation 或 canonical provenance mismatch；handoff schema/binding/question policy 错误；multiple/missing/mismatched positive-function contract；wrong-turn、错误 span、metadata/projection mismatch；identity/repair target 错误；缺少 relevance provenance。任一此类 reason 与局部 reason 同时出现，也不得恢复。

## Proposed Solution

在现有 Planner 与 Surface 之间加入一次有界的 **Plan Preflight Recovery**，但不新增新的决策 owner：

```text
same frozen Context + Interpretation + DialogueState + authority
  → Planner attempt 0
  → preflight
      → pass: freeze final ResponsePlan → Surface
      → exact recoverable local failure:
           feedback to Planner once
           → Planner attempt 1
           → preflight
               → pass: freeze recovered final ResponsePlan → Surface
               → fail: PLAN_INVALID
      → structural/authority failure: PLAN_INVALID
```

实现合同：

1. `chatExecutionLifecycle` 提供纯分类函数，仅在 failure reasons 精确满足本切片 allowlist 且 failed plan 的 action/contract 对应时返回 recovery directive。它不修改 plan。
2. recovery directive 是 turn-local 输入，只包含 `attempt=1`、被拒 plan id、原始 failure reason 和 `unavailableActions=["offer_emotional_support"]`；不进入 Memory、Dialogue State、Interaction Move envelope 或数据库。
3. `chatOrchestrationService` 使用同一个 Planner 调用点执行最多两次：第一次普通规划；仅当纯分类函数判定可恢复时，把 directive 交回 Planner。不得捕获第二次失败后再循环；最大 Planner attempts 固定为 2。
4. `responsePlanner` 接收可选 recovery directive，并重新计算完整 plan。它不能原地修改第一次 plan。被标为 unavailable 的 emotional action 不再被选择；若还有 direct answer、repair、pause、action support 或 handoff 责任，继续保留；若没有其他责任，则由 Planner 选择普通 `acknowledge_without_psychologizing`，仍可选择已检索到的 Episode Memory，允许 Surface 作普通陪伴/探索表达。
5. recovery pass 的 `clinicalNeed` 必须从恢复后的 actions 推导，不能继续从原 `supporting_emotion` activity 推导；否则会残留 emotional Clinical advice 和 `legacy_compat` behavior source。
6. 每次 plan 都用同一 detached authority 单独 preflight。只有最后通过的 plan 才成为 `executionPlan` 并传给 Surface/Validator；第一次失败计划不生成文本、不持久化、不提交 envelope、不更新 state。
7. execution trace 记录一次 `PLANNED → REJECTED(recoverable) → PLANNED(recovery)`，最终只公开通过后的 plan；若第二次仍失败，记录两个 preflight 结果的内部原因并返回一次明确的 `PLAN_INVALID`，`retryable=false`。客户端不再承担内部计划修复。
8. Output Validator 的“同一 frozen plan 最多重新表达一次”保持不变。那是 Surface 候选修正，不是 Planner recovery；两种计数不得混用。
9. strict parser、fail-closed、Safety、Memory、Validator、不可变事件边以及“禁止持久 lifecycle state”全部保持不变。

验收用例：

- 跨会话基准：旧会话“领导临时改需求，我很累”→ 新会话“最近不想上班”。第一次 plan 可因空 spans 被拒；Planner recovery 恰好一次，最终 plan 不含 `offer_emotional_support`/emotional contract，仍选中相关 Episode Memory，第二次 preflight 通过，Surface 被调用一次并产生一个 committed winner。
- 显式情绪正例：“最近上班真的很累”。第一次 plan 带精确 current-turn span，preflight 直接通过，recovery 次数为 0，现有 emotional support 合同不退化。
- 普通无情绪正例：“最近不想上班”。没有相关 Episode Memory 时也能恢复为 ordinary response，而不是 `PLAN_INVALID`；不得新增 affect 关键词。
- 混合硬责任：direct question/repair/pause 与无证据 emotional activity 并存时，恢复仅撤销 emotional action，必须保留原硬责任及 question/closure policy。
- authority 反例：`missing_emotional_support_evidence_spans` 与任一 authority/provenance/handoff failure 同时出现，零 recovery，Surface 零调用，保持 `PLAN_INVALID`。
- evidence-integrity 反例：wrong-turn、span-not-in-source、metadata 或 projection mismatch 均零 recovery、fail-closed。
- 有界性反例：recovery plan 再次 preflight 失败时不得第三次规划；Surface 零调用；公开一次非重试状态。
- owner 边界：Surface 和 Validator 源码仍不得调用 `createResponsePlan`；普通执行最多一个 final plan、一个 Assistant winner。
- 真实 Qwen 人工验收：最终回复可以自然提及“前几天领导临时改需求”，但不得断定那就是“不想上班”的原因，应提供容易接住的探索入口。

## Files To Change

- `conversation-os/control/responsePlanner.ts`：接收一次性 recovery directive；在 Planner 内重新选择 actions、clinical need、positive contract、policies 和 provenance，不原地修补旧 plan。
- `services/ai/chatExecutionLifecycle.ts`：增加纯 recoverability 分类与 directive 构造；保留所有现有 preflight hard checks。
- `services/ai/chatOrchestrationService.ts`：在 Surface 前编排最多一次 Planner recovery，保存最终通过 plan，并把两次 preflight 结果写入内部 execution trace。
- `scripts/chat-execution-lifecycle-check.ts`：覆盖 exact allowlist、混合 failure 不恢复、第二次失败停止，以及原空-span preflight 失败断言继续成立。
- `scripts/ai-orchestration-check.ts`：覆盖同一 Planner owner、最多一次 recovery、Surface 只接收最终 preflight-valid plan、Validator 不重规划。
- `scripts/conversation-episode-memory-loop-check.ts`：覆盖相关 Episode Memory 在 recovery 后仍被 Planner 选择并投影给 Surface。
- `docs/ARCHITECTURE_V1_FINAL.md`：补充 Planner preflight recovery 的一次性、非持久、pre-Surface 边界，并区分它与 same-plan Surface regeneration。

不需要修改 `conversation-os/state/conversationStateService.ts`：canonical affect evidence 定义保持不变。不修改 Safety、Memory 检索/小结、Surface、Validator、schema 或事件 envelope。

## Risks

- 如果 recoverability 使用模糊前缀或宽泛 reason family，可能把 authority、wrong-turn 或 evidence tampering 错当成普通缺证据；必须使用 exact allowlist，并要求 failure reason 集合没有其他成员。
- 如果 Orchestration 直接过滤 `responseActions`，它会成为第二 Planner，且容易留下 clinical strategy、positive contract、question policy 与 provenance 残影；必须完整重跑 Planner。
- 如果 recovery 仍从原 `supporting_emotion` activity 无条件选 action，会再次生成同一失败计划；directive 必须作为 Planner 的明确不可用动作约束。
- 如果第一次与第二次 plan 共用可变对象，Surface 或 trace 可能看到被原地篡改的计划；两次必须创建独立对象，最终 plan 在 Surface 前冻结。
- 如果把 Planner recovery 与 Surface same-plan regeneration 合并计数，会模糊“选错动作”和“表达未达标”两种责任；trace 与测试必须分别计数。
- recovery 后使用 Episode Memory 只能提供相关历史材料，不能把相关性升级为因果；现有 memory hypothesis/Surface grounding 边界必须保留。
- 本切片只恢复一个已证实的局部失败原因，不宣称解决所有 `PLAN_INVALID`。新增 recoverable reason 必须另有真实反例与独立冻结，不能顺手扩大 allowlist。
