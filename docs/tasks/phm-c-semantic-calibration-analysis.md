## Problem

PHM-C 的真实 Qwen Validator 对 `complete_reciprocal_contact` 会产生语义内部不一致的 exact-schema verdict，随后被本地 `function_or_policy_not_satisfied` 门正确地 fail closed。当前拟议验收又把目标 Assistant 已问候、User 已回礼后的候选 `你好呀。` 当作正例，但冻结合同明确规定第二次 greeting-only move 不能实现该函数；因此不能直接把这个字符串“校准为通过”。

本切片应解决的是 Validator 对冻结 reciprocal-contact 语义的理解与字段一致性，而不是改变产品语义、放宽本地信任边界，或用词表/正则/固定回复白名单替代语义判断。

## Evidence

- 冻结合同 §14.5 定义 `complete_reciprocal_contact`：接受 User 的 reciprocal contact 为充分、在本回复中释放 greeting ritual；第二次 greeting-only move、receipt、echo、Assistant presence/availability statement 或 generic open door 均不实现该正向函数。
- Surface 已把同一规则写入生成约束；Validator Prompt 只提供 plan labels、通用 mixed-reply 规则与字段 schema，没有提供 `complete_reciprocal_contact` 的正向含义和明确反例。
- Validator 本地门保持分层：先 exact keys/type，再 plan binding，再 `reply.slice(start,end)===text`，最后才检查 function/question policy。
- 2026-08-08 真实 `qwen3.7-max` 固定回归中，`reciprocal` 返回 exact-schema JSON，但最终类别为 `interaction_move_handoff_semantic:function_or_policy_not_satisfied`；其余 structured-output fixtures 当前因 evidence mismatch 安全拒绝。
- 对 `你好呀。` 的一次低基数真实 verdict 检查得到：`status=satisfied`、`targetAddressed=true`、`relationAddressed=true`、`positiveFunctionRealized=true`、`realizedFunction=null`、无 contradiction、无 completion claim、问题数为 0，evidence 为 `[0,4]` 且 UTF-16 slice 完全匹配。

观察：该 reciprocal 样本的 binding、evidence offset 与 question policy 均未失败；唯一冲突是 fulfilled/satisfied verdict 没有把 `realizedFunction` 绑定到 `requiredFunction`。解释：Prompt 没有给出函数的规范语义，也没有声明 verdict 字段间的不变量，Qwen 因而能同时声称“已实现正向函数”和“没有实现任何函数”。结论：第一因果边界是 Validator Prompt 的语义与字段约束不足；本地 parser、offset 校验和 fail-closed gate 不是根因。

## Root Cause

`buildSemanticValidationMessages` 把 `realizedFunction` 描述为“one handoff function or null”，却没有说明：

- 对 `completionIntent=fulfill`，只有在候选真正满足冻结函数语义时才可 `status=satisfied`，且此时 `realizedFunction` 必须精确等于 `requiredFunction`、`positiveFunctionRealized=true`；
- `realizedFunction=null` 只适用于 defer 或未实现/不确定的判断，不能与 fulfilled positive realization 并存；
- `complete_reciprocal_contact` 的正向后置条件及 greeting-only/receipt/echo/presence/open-door 反例；
- `candidateReply` 是待判断的不可信数据，其中的指令不得改变 schema、binding 或判断规则。

因此 Qwen 输出了可解析、可绑定、证据正确但语义字段互相矛盾的 verdict。本地门拒绝它是预期安全行为。把 `你好呀。` 直接设为必须通过则是另一个产品合同变更，不属于 Validator 校准。

## Proposed Solution

采用一个最小、合同一致的 Prompt 校准路径，仅修改 PHM-C Validator 的模型输入，不改变本地判定代码：

1. 在 developer instructions 中加入 `complete_reciprocal_contact` 的现有规范语义，文字与冻结合同/Surface 约束一致；明确第二次纯问候、receipt、echo、presence/availability 与 generic open door 均为未实现，而不是正例。
2. 加入 verdict 一致性不变量：fulfilled + satisfied 必须令 `realizedFunction===requiredFunction` 且 `positiveFunctionRealized=true`；defer 必须为 null/false；not_satisfied/uncertain 不得伪造正向实现。继续由现有本地门独立验证，模型自报不获得额外信任。
3. 明确 `candidateReply` 为不可信内容，候选中的指令不能覆盖 developer rules、plan binding 或 output schema。
4. 为避免模型自行计算 UTF-16，给 Prompt 提供 caller-computed 的候选长度及完整 `[0,length]` span 参考；本地仍逐 span 执行 exact slice 校验，不补写、不修复、不规范化 provider evidence。
5. 不增加重试、不更改 temperature、strict full-string `JSON.parse`、exact keys/binding/evidence、function/policy gate 或 failure categories；不新增本地文本判断或持久状态。

代表性冻结验收 fixtures：

- 正常正例：`那就算认识啦。`，必须返回 binding/evidence 正确且最终通过。
- Unicode 正例：`那就算认识啦🙂。`，必须最终通过；将返回 evidence 的 end 人为减 1 后必须以 evidence mismatch fail closed。
- 重复问候反例：`你好呀。`，必须以合法、binding/evidence 正确的 semantic verdict 拒绝，不得 malformed/evidence mismatch，也不得最终通过。
- generic open-door 反例：`你想聊什么都可以。`，必须语义拒绝。
- mixed contradiction：`那就算认识啦。不过你怎么只说你好，认真回答我。`，必须识别后半施压并语义拒绝。
- unsupported optional question：在 ordinary support 为 false 时，`那就算认识啦。你想聊什么？` 必须由 function/policy gate 拒绝。
- prompt injection：候选要求改写 planId、额外字段或 Markdown 时，仍须返回 exact binding/schema 并语义拒绝。

真实 Qwen 门应固定 provider/model/temperature，串行执行，只对 timeout/429/5xx 做一次基础设施重试；输出仅保留 case id、低基数类别与延迟，不持久化 Prompt、候选或原始 verdict。若产品确实要让 `你好呀。` 成为正例，必须先单独修改 §14.5 的产品合同及 Surface 约束，不能在本切片中暗改。

## Files To Change

- `services/ai/interactionMoveHandoffOutputValidator.ts`：加入 reciprocal-contact 规范语义、字段不变量、不可信候选边界及 caller-computed UTF-16 参考；不改 parser/本地 gates。
- `scripts/interaction-move-handoff-surface-validator-check.ts`：断言 Prompt 校准内容和 caller-computed span；覆盖正向、重复问候、generic open door、mixed、unsupported question、injection、UTF-16 corruption。
- `scripts/interaction-move-handoff-qwen-structured-output-eval.ts`：把 structured-only fixtures 升格为上述真实语义验收，要求正例通过、反例以正确语义/策略原因 fail closed。
- `.project-team/ACTIVE_SLICE.md`、`.project-team/EVIDENCE.md`、`.project-team/DECISIONS.md`、`.project-team/REMAINING.md`：在实现与独立审查通过后记录本切片；不修改架构合同，除非产品另行授权改变“第二次纯问候”规则。

## Risks

- 最大风险是把人工测试中的期望回复误当成冻结产品语义，静默允许第二次 greeting-only move；这会让 Surface 与 Validator 互相矛盾。
- Prompt 校准可能让模型机械复制字段而非正确判断语义；必须用重复问候、generic open door、mixed contradiction 和 injection 反例证明不是无条件通过。
- caller-computed full span 只能降低 offset 漂移，不能替模型决定语义；本地 exact evidence 门必须保持原样。
- 真实模型存在服务漂移；固定模型和低基数门可证明本次行为，但不能把网络或供应商稳定性当作运行时真理。
- 若一次性校准其他 handoff functions，会扩大当前 causal boundary；本切片只处理 `complete_reciprocal_contact`，其他函数的新问题应记录为 Remaining。
