# 当前交付切片

- 名称：PHM-B — Planner Handoff Transition Contract Freeze（docs-only）。
- 交付结果：在现有唯一 Interaction Move Handoff v1 权威合同内冻结 PHM-A relation 到 Planner handoff plan 的完整转换边界。
- 用户价值：后续 Planner 实现可以结束主动问候后的重复 presence confirmation，并按用户的回礼、内容、问题、拒绝或边界转入自然交流，而不再依赖 `promptVersion` 猜测交接。
- 验收标准：激活与 fail-closed 条件、relation/function/completion/question-policy 完整映射、多候选兼容规则、reciprocal contact 正向语义、Guest/Auth 逻辑一致和 v1 `promptVersion` independence 均无二义性；所有状态文档明确运行时尚未改变。
- 允许范围：Handoff v1、Architecture v1、根历史账本，以及本目录的 `ACTIVE_SLICE.md`、`EVIDENCE.md`、`DECISIONS.md`、`REMAINING.md`。
- 非目标：不修改 Planner、Prompt、Surface、Validator、commit path、API/client、Memory、User Model、Batch 2、schema、migration 或部署；不创建关键词、regex、固定话术或 case patch；不声称线上问题已经修复。
- 当前基线：分支 `codex/planner-handoff-migration`；HEAD `a02f0ff`；PHM-A 已封存；切片开始时工作区干净。团队初始化切片在冻结过程中并发完成，其文件单独分类并保留。
- 依赖项：Interaction Move Handoff Contract v1、Architecture v1、PHM-A committed target 与 `UserMoveRelationProjection`。
- 主要风险：Planner、Surface 和 Validator各自解释未冻结语义；把 docs-only freeze 误报成用户可见修复；覆盖并发团队初始化成果。
- 激活角色：项目经理、产品经理、技术架构师、测试工程师。
- 待命角色：UX 设计师、UI 设计师、开发工程师、运维工程师。
- 文件写入负责人：主线程项目经理独占本切片七个文档/治理路径；调查与验收角色只读。
- 执行顺序：真实调用链调查 → 合同空白审查 → 单一权威合同冻结 → 状态同步 → 独立验收。
- 修复预算：一次 docs-only 冻结；新并发治理状态触发一次一致性修复；无运行代码候选。
- 当前状态：完成；PHM-B Planner Transition Contract 已通过独立验收并冻结，PHM-B runtime implementation 仍未授权。
