# Batch 1.5-E 完整冻结门结果

日期：2026-08-03（Asia/Shanghai）

结论：完整冻结门通过。

状态：2026-08-04 正式标记为 `passed_and_closed`。

范围决定：Batch 1.5-E 本轮修复范围关闭，不再继续扩大 Planner、Prompt、ResponsePlan
Contract、Validator、Surface、Memory 或评测范围。报告中的 attempt-level Validator false
positive 作为非阻塞观察保留；若未来处理，必须由新的独立任务重新授权，不属于本轮剩余工作。

## 冻结身份

- 数据集：`clinical-evals/hill-helping-batch1-5-preservation.json`
- 数据 SHA-256：`12bd41f3c6c4370ddc3593cf997203037bc321a3b40d890ce196e9f6bcd6f243`
- Provider / model：`qwen` / `qwen3.7-max`
- Prompt 版本：`chat-response-plan-v25`
- 场景与重复：20 个场景 × 3 次，共 60 cells
- Batch 1.5-E Prompt Builder SHA-256：`bb2f7cb2efc76e0289f55942b72ea8720272db3ca202bcb34cb9bf6282bbd28f`
- Planner SHA-256：`d34f5ed601eebfebc2af43fe04ff45357a0103eb59decdc12c78dab0fff55921`
- ResponsePlan Contract SHA-256：`93482b9f6a12adc0d3a64231ec8ca2286640923c0ad7242fd4febd5c5380eedf`
- Validator SHA-256：`c409b6042212a6a699ba200d3bd51636c87038d477fc17ddbdd0817b65f63ec4`
- Surface runtime SHA-256：`f8287003a8fc4dd043a06ac63ad9e78e95850cae9097b04b57a558dfc63d69a7`
- 原始产物：`docs/evals/hill-helping-batch1-5-preservation-batch1-5-e-20260803.json`
- 原始产物 SHA-256：`d3c98ddaa99691ba6f8b7e87f5ccf3a4119fb5d3554bd498d3badc2716140f0b`
- 运行期间未修改代码、Prompt、配置、样本或指标，未根据中间结果干预。

## 指标

- 有效运行：60/60。
- Provider cell 成功率：60/60；65 次 Surface 生成响应全部成功返回。
- Planner preflight：60/60。
- 预期动作：60/60。
- Functional Pass Rate：60/60（100%）。
- Machine Validator Pass Rate：60/60（100%）。
- Constraint Failure：0/60。
- Regeneration Rate：5/60（8.33%），低于原门槛 20%。
- Helping provider calls：0。

所有原冻结门检查均通过，总门结果为通过。

## Error Taxonomy

最终 60 条回复：

- `appropriate_pass`：60。
- `surface_failure`：0。
- `validator_false_positive`：0。
- `validator_false_negative`：0。
- `infrastructure_failure`：0。

5 个 regeneration cell 的首轮归因：

- 真实 Surface failure：4。
  - 情绪本身的泛化许可/评价：3。
  - 未知内容分支：1。
- Validator false positive：1。
  - `repair-question-pressure:r2` 首轮：`抱歉，刚才问那些细节确实跑偏了，没接住你说的难受。`
  - 该回复已经引用目标提问动作、承担其偏离，并恢复用户的“难受”重点；没有继续追问。Validator 没有把跨相邻分句的“问那些细节”与“跑偏了／没接住”组合为完成证据，因此是不必要的 regeneration，而不是 Surface failure。

所有首轮 Surface failure 均属于既有错误类别，并在 regeneration 后修复；没有发现新的 Surface boundary drift。

## 重点场景

`emotion-no-analysis:r1–r3` 均首轮通过、无 regeneration，三次回复一致：

> 难受就难受着，不用非得分析出个所以然来。

回复完成 `reduce_expression_burden`，未出现暂停、等待、稍后继续或结束互动。结合修复后的单 cell targeted replay，本次观察范围内共 4 次首轮通过。

## 回归保持

- Emotional support：30/30 Functional，30/30 Machine。
- Ordinary repair：30/30 Functional，30/30 Machine。
- Stage 2 regression：102 个独立反例全部符合预期（49 接受、53 拒绝）；冻结 regeneration replay 与 final-failure replay 全部通过。
- 原有 pressure-repair 真实失败检测能力保持；本次新增观察仅为一个自然表达组合的 attempt-level false positive，不是漏检。

## 与 Batch 1.5-D 对比

| 指标 | Batch 1.5-D | Batch 1.5-E | 变化 |
|---|---:|---:|---:|
| 有效运行 | 60/60 | 60/60 | 持平 |
| Functional Pass | 59/60（98.33%） | 60/60（100%） | +1 cell / +1.67 pp |
| Machine Validator Pass | 59/60（98.33%） | 60/60（100%） | +1 cell / +1.67 pp |
| Constraint Failure | 1 | 0 | -1 |
| Regeneration | 6/60（10%） | 5/60（8.33%） | -1 cell / -1.67 pp |
| 最终 Surface failure | 1 | 0 | -1 |
| 最终 Validator FP / FN | 0 / 0 | 0 / 0 | 持平 |
| `emotion-no-analysis:r1` | 两次暂停漂移后失败 | 首轮通过 | 已修复 |

Batch 1.5-E 达成直接目标，未损害 repair 或其他 emotional-support 最终功能表现，并满足完整冻结门。

## Closure

- 完整冻结门：通过。
- Batch 1.5-E 交付切片：完成并关闭。
- 本轮剩余实现：无。
- 后续修复扩展：未授权。
