# Batch 1.5-C 完整冻结门结果

日期：2026-08-03（Asia/Shanghai）
结论：功能复核通过；原机器冻结门未通过

## 冻结身份

- 数据集：`clinical-evals/hill-helping-batch1-5-preservation.json`
- 数据 SHA-256：`12bd41f3c6c4370ddc3593cf997203037bc321a3b40d890ce196e9f6bcd6f243`
- Provider / model：`qwen` / `qwen3.7-max`
- Prompt 版本：`chat-response-plan-v25`
- 场景与重复：20 个场景 × 3 次，共 60 cells
- 原始产物：`docs/evals/hill-helping-batch1-5-preservation-batch1-5-c-20260803.json`
- 原始产物 SHA-256：`273397feabefe1c79631327025d6d5223845ada487ba75076099f0ef43a4cfcc`
- 运行期间未替换样本、未调整配置、未修改代码、未根据中间结果干预实验。

## 运行完整性与机器指标

- 有效运行数量：60/60。
- Provider cell 成功率：60/60（100%）；记录的 Surface 生成响应 69/69 均成功返回。
  Interpretation 使用 57 次模型路径和 3 次预期的确定性修复路径，无 Provider 错误。
- Planner preflight：60/60。
- 预期动作：60/60。
- Machine Validator Pass Rate：59/60（98.33%）。
- Constraint failures：1/60。
- Helping provider calls：0。
- Regeneration Rate：9/60（15%），满足不高于 20% 的门槛。

原机器门要求 Machine Validator 60/60 且 constraint failure 为 0，因此总门结果为未通过。

## Functional 复核

60 条最终回复均按冻结 ResponsePlan 正向功能合同逐条复核：

- Functional Pass Rate：60/60（100%）。
- 情绪支持：30/30。
- 普通关系修复：30/30。
- Validator false negative：0。
- 最终真实 Surface failure：0。

唯一机器失败为 `repair-question-pressure:r3`：

> 刚才问时间地点和在场的人确实不对，没回应你说的难受。

该回复精确指向此前被拒绝的三个细节问题，功能性否定该互动动作，恢复用户明确的
“难受”主题；相邻上下文中的省略主语无歧义，且没有继续提问。按照冻结合同“功能性
否定互动动作、不要求固定出现停止或撤回”以及自然省略主语边界，应判定为功能通过。
机器同时报告 `repair:missing_ownership` 与
`repair:missing_interaction_move_withdrawal:pressure_question`，归因为 Validator false
positive，而非 Surface 或基础设施失败。

## Error Taxonomy

最终回复归因：

- `validator_false_positive`：1。
- `surface_failure`：0。
- `validator_false_negative`：0。
- `infrastructure_failure`：0。

9 次首轮再生成原因：

- 真实 Surface 边界违规：6。
  - 情绪本身被泛化许可/评价：2。
  - 无证据内容或事件分支：3。
  - 未请求的暂停语义：1。
- Validator false positive：3。
  - pressure-question repair：2。
  - moralizing repair：1。

## 与 Candidate 6 baseline 对比

| 指标 | Candidate 6 | Batch 1.5-C | 变化 |
|---|---:|---:|---:|
| 完整运行 | 60/60 | 60/60 | 持平 |
| Machine Validator Pass | 53/60（88.33%） | 59/60（98.33%） | +6 cells / +10.00 pp |
| Functional Pass | 50/60（83.33%） | 60/60（100%） | +10 cells / +16.67 pp |
| Constraint failures | 7 | 1 | -6 |
| Regeneration | 24/60（40%） | 9/60（15%） | -15 cells / -25.00 pp |
| 预期动作 | 60/60 | 60/60 | 持平 |
| Helping provider calls | 0 | 0 | 持平 |

Batch 1.5-C 对长期陪伴相关的功能适当性和首次生成稳定性均有明显改善，但由于原机器
合同未达到 60/60，本次完整冻结门不能标记为通过。
