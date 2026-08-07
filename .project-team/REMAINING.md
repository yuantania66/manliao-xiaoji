# 剩余事项

- PHM-B Planner runtime 与独立 PHM-B-AUTH 信任边界已通过并作为同一检查点封存；Planner 已消费 PHM-A relation，且 exact preflight 不再信任可协同篡改的 plan 内部自证。
- PHM-C Prompt/Surface realization、same-plan semantic Validator 与 PHM-D ordinary committed `fulfills`/`handoffCompleted` 已通过专项、独立验收与完整发布门并封存。
- PHM-E Safety `supersedes`、`handoffSuperseded`、`handoffResolved` 与
  `activeHandoff` 已通过 repair pass 1、独立 Reviewer `PASS` 与最终 `npm run check:launch`（exit 0）并封存；无持久 lifecycle state。仅待主线程 Git seal。
- PHM-C Validator Structured Output Reliability 已封存：Qwen structured call 的 strict exact-schema JSON 可靠性通过真实门；模型语义校准仍是独立未授权切片，不属于本次结构化输出交付。
- PHM-C reciprocal-contact Semantic Calibration 已封存：合同一致释放/过渡正例稳定通过，重复问候与四类对抗反例继续 fail closed；其他 handoff functions 的新语义问题仍需独立授权。
- PHM-A reciprocal/unclear candidate reconciliation 已封存：真实同 target reciprocal 不再被合并器自产的 adjacency fallback 污染；真实歧义与无效模型输出仍 defer。其他 relation/function 的新问题不属于本切片。
- 项目角色代理尚未实例化；后续交付切片只有在任务可独立分工且用户或项目规则允许时才创建。
- 本目录不复制根目录历史账本中的工程剩余项；实现路线和既有未完成边界继续以根目录 `PROJECT_TEAM.md` 及权威产品、架构文档为准。
- 每次开始新交付切片时，更新角色状态、负责人、文件写入边界和证据台账。
