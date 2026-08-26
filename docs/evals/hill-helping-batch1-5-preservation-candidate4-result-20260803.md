# 批次 1.5 候选 4：60 轮质量保留测试结果

日期：2026-08-03（Asia/Shanghai）
状态：未通过冻结门；不得生成人工盲审候选

## 冻结输入与运行身份

- sourceId：`batch1-5-preservation-candidate4`
- provider：`qwen`
- model：`qwen3.7-max`
- 冻结数据 SHA-256：`12bd41f3c6c4370ddc3593cf997203037bc321a3b40d890ce196e9f6bcd6f243`
- 运行产物：`docs/evals/hill-helping-batch1-5-preservation-candidate4-20260803.json`
- 运行产物 SHA-256：`a422cf41358afa01aca5724e6d3c7f646fc80850385dde9bc17e9404c592cc13`

## 冻结门结果

| 指标 | 结果 | 阈值 | 判定 |
| --- | ---: | ---: | --- |
| 完整运行数 | 60/60 | 60/60 | 通过 |
| Planner/preflight | 60/60 | 100% | 通过 |
| 预期动作 | 60/60 | 100% | 通过 |
| Helping provider 调用 | 0 | 0 | 通过 |
| 最终验证通过 | 44/60（73.33%） | 100% | 未通过 |
| 约束失败 | 16 | 0 | 未通过 |
| 再生成 | 30/60（50%） | 不高于 20% | 未通过 |

最终结论：`passed=false`。

## 最终失败分布

情绪支持 9 次：

- `emotion-vague-blocked`：1
- `emotion-future-worry`：1
- `emotion-embarrassed`：3
- `emotion-lonely`：1
- `emotion-no-analysis`：3

普通修复 7 次：

- `repair-advice-boundary`：1
- `repair-generic-listening`：3
- `repair-moralizing`：1
- `repair-topic-switch`：2

最终失败码出现次数（一个输出可有多个失败码）：

- `emotional_support:out_of_scope_topic_switch`：5
- `emotional_support:unrequested_pause_or_closure`：3
- `emotional_support:generic_normalization_or_reassurance`：2
- `emotional_support:missing_grounded_affect_or_impact`：1
- `repair:missing_interaction_move_withdrawal:generic_listening`：3
- `repair:missing_interaction_move_withdrawal:topic_switch`：2
- `repair:missing_interaction_move_withdrawal:unsolicited_advice`：1
- `repair:missing_interaction_move_withdrawal:moralizing`：1

## 当前可下结论与不可下结论

可以确认：Planner、preflight、动作选择和 Helping provider 边界稳定，未通过发生在 Surface/Validator 阶段。

尚不能确认：16 个最终失败不能直接全部归为 Surface 失败。部分普通修复文本已经自然指出并承担了被拒绝动作，可能包含 Validator 误拒；部分情绪文本明显包含切换话题、泛化安慰或未经请求暂停，可能属于真实 Surface 失败。必须先逐条冻结归因，不能据失败码直接修改代码。

## 后续门

在完成并冻结“候选 4 的 16 个最终失败＋30 次再生成分层归因审计”之前，不修改代码、不运行下一候选、不生成人工盲审材料。
