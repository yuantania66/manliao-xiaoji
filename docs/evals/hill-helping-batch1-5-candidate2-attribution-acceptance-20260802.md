# 批次 1.5 候选 2 冻结归因审计与正向合同验收材料

状态：待用户验收；尚未修改代码

## 冻结对象

- 候选 2 原始产物 SHA-256：
  `043d0ebadfa0ad7509950b9fccfc3112ea4e6db9e0d2c3a40539b36c38db2da6`
- 冻结数据 SHA-256：
  `12bd41f3c6c4370ddc3593cf997203037bc321a3b40d890ce196e9f6bcd6f243`
- 25 条首次失败归因 JSON SHA-256：
  `b447d44e4ffdfa05ec216d113f8c2e383f596927509987df08b5901605d3c557`
- ResponsePlan 正向功能合同 V1 SHA-256：
  `59df20ae5c8efc8533eb957d8654e65aff7798ced1f5f9a28d7f206a4e3f3c14`

逐条归因文件：
[候选 2 首次失败冻结归因](./hill-helping-batch1-5-candidate2-first-failure-attribution-20260802.json)

正向合同：
[批次 1.5 ResponsePlan 正向功能合同 V1](../HILL_HELPING_BATCH1_5_RESPONSE_PLAN_POSITIVE_FUNCTION_CONTRACT_V1.md)

## 审计结果

25 条首次失败已经逐项与原始产物自动核对，文本和 Validator 失败码无差异：

- `surface_failure`：18 条；
- `validator_false_positive`：6 条；
- `both`：1 条；
- 含真实 Surface 问题：19 条；
- 含 Validator 错误归因：7 条；
- 情绪支持：15 条；
- 普通关系修复：10 条。

主要结论：

1. 候选 2 的高再生成率不能全部归因于 Surface。事实型修复和附着于表达选择的许可
   被现有 Validator 误拒。
2. 也不能通过放宽 Validator 解决。19 条确实存在情绪强化、公式化在场、建议、主动
   暂停、不完整撤回或修复后继续采访等生成问题。
3. 根缺口是 ResponsePlan 没有把普通支持和修复的正向完成条件结构化交给 Surface；
   当前实现主要依赖禁止项和词表。

## 正向合同决策

合同将动作所有权保留在 Response Planner：

- 情绪支持必须完成“同强度承接＋一个明确的表达负担/控制权功能”；
- 关系修复按事实替换、命题撤回、互动动作撤回分别判断完成；
- Surface 只实现，不选择功能；
- Validator 按作用对象和功能判断，不以固定词代替语义完成；
- 不启用 Hill 技术，不写 Helping 状态，不进入批次 2。

## 验收选择

本次只请求验收两项，不请求代码修改授权：

1. 是否接受 25 条冻结归因及其 18/6/1 分类；
2. 是否接受 ResponsePlan 正向功能合同 V1 作为下一轮代码修改的唯一产品与架构依据。

如有异议，应先修改审计或合同并产生新版本与新哈希；不得在代码修改后回头调整归因
以适配实现。
