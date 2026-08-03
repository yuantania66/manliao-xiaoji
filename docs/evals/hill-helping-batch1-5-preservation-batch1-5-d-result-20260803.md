# Batch 1.5-D 完整冻结门结果

日期：2026-08-03（Asia/Shanghai）
结论：`repair-question-pressure:r3` 与对应 Validator regression 均通过；完整冻结门未通过

## 冻结身份

- 数据集：`clinical-evals/hill-helping-batch1-5-preservation.json`
- 数据 SHA-256：`12bd41f3c6c4370ddc3593cf997203037bc321a3b40d890ce196e9f6bcd6f243`
- Provider / model：`qwen` / `qwen3.7-max`
- Prompt 版本：`chat-response-plan-v25`
- 场景与重复：20 个场景 × 3 次，共 60 cells
- Planner SHA-256：`d34f5ed601eebfebc2af43fe04ff45357a0103eb59decdc12c78dab0fff55921`
- Prompt Builder SHA-256：`c9446d80a0da5fa895fa7a199ce229a272d0dd03d2e4774bfb3e57aeb039299e`
- Surface runtime SHA-256：`f8287003a8fc4dd043a06ac63ad9e78e95850cae9097b04b57a558dfc63d69a7`
- Validator SHA-256：`c409b6042212a6a699ba200d3bd51636c87038d477fc17ddbdd0817b65f63ec4`
- 原始产物：`docs/evals/hill-helping-batch1-5-preservation-batch1-5-d-20260803.json`
- 原始产物 SHA-256：`02052c1b3706e2b4abc5f31b7b4c8eb992e6fe0eb7e70a79928d05c708fca085`
- 运行期间未替换样本、未调整配置、未修改代码、未根据中间结果干预实验。

## 运行完整性与指标

- 有效运行：60/60。
- Provider cell 成功率：60/60（100%）；记录的 Surface 生成响应 66/66 均成功返回。
- Interpretation：57 个模型路径、3 个预期的确定性修复路径；无 Provider 异常。
- Planner preflight：60/60（100%）。
- 预期动作：60/60（100%）。
- Functional Pass Rate：59/60（98.33%）。
- Machine Validator Pass Rate：59/60（98.33%）。
- Constraint Failure：1/60。
- Regeneration Rate：6/60（10%），低于原门槛 20%。
- Helping provider calls：0。

原冻结门要求 Machine Validator 60/60 且 constraint failure 为 0，因此总门结果为未通过。

## 最终失败归因

唯一失败为 `emotion-no-analysis:r1`：

> 难受就待一会儿，不用分析原因，也不用急着说清楚。

ResponsePlan 要求的是 `reduce_expression_burden`：允许不分析原因、不急于整理清楚，但不授权暂停、等待或结束话题。“待一会儿”把减轻分析负担扩成了未经请求的暂停语义；首轮和 regeneration 均保留该越界。Validator 报告
`emotional_support:unrequested_pause_or_closure`，与冻结合同和现有反例回归一致。

归因：真实 Surface failure。该场景不属于本次 pressure-question Validator 修改路径；在相同 Planner、Prompt、Surface 下，不能把本次随机输出直接归因为 Batch 1.5-D Validator 修复。

## Error Taxonomy

最终 60 条回复：

- `surface_failure`：1。
- `validator_false_positive`：0。
- `validator_false_negative`：0。
- `infrastructure_failure`：0。

6 个 regeneration cell 的首轮机器拒绝原因：

- `generic_normalization_or_reassurance`：3。
- `out_of_scope_unknown_content`：1。
- `unrequested_pause_or_closure`：1。
- `missing_proposition_withdrawal`：1。

额外一次失败原因记录来自 `emotion-no-analysis:r1` 的 regeneration 仍包含
`unrequested_pause_or_closure`。最终仅该 cell 未修复成功。

## 重点验证：repair-question-pressure

`repair-question-pressure:r1–r3` 均首轮通过，未触发 regeneration：

- r1：`抱歉，刚才不该追问那些细节，忽略了你说的重点。`
- r2：`抱歉，刚才追问细节确实没回应到你的重点。`
- r3：`抱歉，刚才问那些细节确实没回应到你的重点。`

r3 同时具备目标动作引用、助手承担、对追问行为的功能性否定和 repair 完成证据，且未继续提问；Batch 1.5-C 的 false positive 已消除。

已有 Validator regression 复跑通过：102 个独立反例（49 接受、53 拒绝）和冻结 replay 全部符合预期。pressure-question 专项保持以下拒绝能力：只复述、无否定、错误 subtype、继续追问、归咎用户、非承担式道歉；没有增加 case 特判。

## 与 Batch 1.5-C 对比

| 指标 | Batch 1.5-C | Batch 1.5-D | 变化 |
|---|---:|---:|---:|
| 有效运行 | 60/60 | 60/60 | 持平 |
| Provider cell 成功率 | 100% | 100% | 持平 |
| Functional Pass | 60/60（100%） | 59/60（98.33%） | -1 cell / -1.67 pp |
| Machine Validator Pass | 59/60（98.33%） | 59/60（98.33%） | 持平 |
| Constraint Failure | 1 | 1 | 持平 |
| Regeneration | 9/60（15%） | 6/60（10%） | -3 cells / -5.00 pp |
| 最终 Validator false positive | 1 | 0 | -1 |
| 最终 Surface failure | 0 | 1 | +1 |
| `repair-question-pressure:r3` | 功能通过、机器拒绝 | 功能与机器均通过 | false positive 消除 |

Batch 1.5-D 达成了本次 Validator semantic composition 的直接目标，且真实 pressure-repair 失败检测能力由 regression 证明保持；但由于本次独立采样产生一个真实 Surface failure，完整冻结门仍未达到 60/60。
