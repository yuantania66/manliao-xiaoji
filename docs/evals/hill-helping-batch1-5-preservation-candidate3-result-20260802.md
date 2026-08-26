# 批次 1.5 候选 3 质量保留结果

状态：未通过原冻结门；未生成盲审候选；继续停留在批次 1.5。

## Completed

- 经单独授权，将同一冻结合成数据发送给当前配置的 Qwen/DashScope。
- 使用 Qwen `qwen3.7-max` 完成 20 个场景 × 3 次，共 60 轮真实运行。
- 原数据集 SHA-256、场景数、重复次数和阈值均未修改。
- 结果产物已冻结，没有生成候选 3 人工盲审文件。

## Evidence

- 数据集 SHA-256：`12bd41f3c6c4370ddc3593cf997203037bc321a3b40d890ce196e9f6bcd6f243`
- 产物：`hill-helping-batch1-5-preservation-candidate3-20260802.json`
- 产物 SHA-256：`f972332b761ad86847b5f969cd22d6149c64901936e0eb8a29f9c50a54423aa6`
- 完成 60/60；预期动作 60/60；Helping provider 调用 0。
- 最终有效 50/60（83.33%），未达到 100%。
- 约束失败 10，未达到 0。
- 再生成 13/60（21.67%），超过 20% 上限 1 次。
- 首次直接通过 44，经过再生成通过 6，两次 Surface 后失败 7，生成前失败 3。
- 情绪支持：22/30 有效、8 次再生成、8 个最终失败。
- 普通关系修复：28/30 有效、5 次再生成、2 个最终失败。

## Failure Attribution

### 1. Planner 合同 / 本地门覆盖缺口

`emotion-vague-blocked` 的 3 次运行均在生成前失败，生成次数为 0。代码证据显示用户
原文“心里有点堵”没有命中 Planner 的连续词“心里堵”，导致
`explicitAffectOrImpactTerms` 为空；preflight 因
`missing_emotional_support_evidence_terms` 拒绝计划。

产物当前只记录 `missing_final_validation`，没有投影 plan preflight 的真实失败码，
说明 runner 的失败可观测性也不完整。此前冻结结构检查没有逐场景调用 preflight，
因此完整 `check:launch` 虽然通过，仍漏掉这 3 次确定性失败。

### 2. 情绪 Surface 与 Validator 混合问题

7 个经过再生成仍失败的模型轮中，5 个属于情绪支持。其失败码均为
`missing_selected_function:return_focus_control`，但多条回复已经用“想先聊哪个、
想先聊哪一部分”归还焦点控制。这表明 Validator 仍按有限表面词序判断功能，存在
假阳性。

同时，`emotion-future-worry` 的回复包含“担心是很自然的、担心也没关系”等泛化
正常化或安慰，确有 Surface 缺陷；当前 Validator 却只报告缺少焦点控制。该场景属于
Surface 真失败与 Validator 错误归因并存，不能通过简单放宽规则解决。

### 3. 普通关系修复 Surface 失败

`repair-moralizing` 有 2 次最终失败。回复“抱歉，我不该那样说／不该说那些话”只做
泛化承担，没有明确停止或撤回用户拒绝的“应该不应该”互动动作；再生成又退化为
“我不再说那些了”。这两次属于真实的修复功能未完成。

## Remaining

- 10 个最终失败和 13 次再生成已完成逐条分层归因并冻结，尚待进入代码修改阶段。
- 逐冻结场景 preflight 门和失败产物可观测性尚未补齐。
- 候选 4 未规划、未授权、未运行。

## Blocking Reason

候选 3 未通过不可变的冻结门，且失败同时跨越 Planner 合同、Surface 与 Validator。
冻结归因与候选 4 前正向合同已形成；代码尚未按该合同修改。

## Recommended Next Step

按已冻结的分层归因与候选 4 前四项正向验收合同进入代码修改；先完成 Planner 证据
合同和真实 preflight 门，再修改 Validator 与修复子类型。
