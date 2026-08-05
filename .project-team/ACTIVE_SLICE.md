# 当前交付切片

- 名称：PHM-D — Validated Committed Completion Edges and Query。
- 交付结果：PHM-C 接受的正向 `interactionMoveHandoffPlan` 只在最终 Assistant 消息与 v1 envelope 真正提交时写入同源 `handoff.edge=fulfills`，并提供基于严格有效 committed envelopes 的纯 `handoffCompleted` 查询。
- 用户价值：把“已语义验证”推进为可审计的“已提交完成”，使后续流程无需持久 greeting lifecycle state 即可判断 proactive greeting 是否完成。
- 验收标准：`completionIntent=fulfill` 精确写入冻结 plan 的 `sourceAssistantMoveId` 与正向 `requiredFunction`；null/defer 不写 edge；validator reject、generation failure、retry loser、Safety、失败提交与事务回滚不写 edge；Guest/Auth 对等输入产生同一逻辑 envelope；纯查询只认严格有效 `fulfills` envelope 与精确 source id；专项、相邻、TypeScript、ESLint、独立对抗和完整 `check:launch` 通过。
- 允许范围：`conversation-os/interactionMoveEnvelope.ts` 及 barrel export、authenticated commit service、Guest chat route、PHM-D 专项与必要相邻回归、package gate，以及直接相关合同/架构/团队台账。独立验收证明原 `controlTrace.responsePlan` 不是 PHM-C 实际验证的冻结 snapshot，修复轮 1 额外只允许 `responsePlanValidator.ts` 返回该既有 snapshot、`chatOrchestrationService.ts` 将其作为 commit evidence 继续传递；不得改变 Planner、Surface 或 Validator 的决策语义。
- 非目标：不实现 Safety `supersedes`、`handoffSuperseded`、`handoffResolved` 或 `activeHandoff`；不改 PHM-A target/relation、PHM-B Planner/preflight、PHM-C Surface/Validator 语义；不改 Memory、User Model、Batch 2、schema/migration 或部署；不新增任何持久 lifecycle state、session aggregate、关键词/regex/固定话术/case patch。
- 当前基线：分支 `codex/planner-handoff-migration`；HEAD `ea20480`；工作区仅有用户的独立 `AGENTS.md` 修改，必须保留且不得纳入本切片。项目快照脚本在仓库中不存在，已以 Git 状态、权威合同和真实调用链只读审计替代。
- 第一因果边界：PHM-C 已把最终候选标记为 `VALIDATED`，但 Auth 与 Guest 都调用固定写入 `handoff=null` 的 `buildResponsePlanAssistantMoveEnvelope`，因此验证结果未在最终 commit boundary 投影为 completion edge。
- 依赖项：Interaction Move Handoff Contract v1 §§4、8-10、12-13、15；PHM-C checkpoint `ea20480`；authenticated transaction 与 Guest client-scoped committed event boundary。
- 主要风险：把 validation success 误当 commit；从非冻结数据重算 function；defer 误写 edge；幂等 loser 生成第二条 edge；查询接受 malformed envelope；为 completion 新增状态或 aggregate。
- 激活角色：项目经理、技术架构师、开发工程师、测试工程师。
- 待命角色：产品/临床合同审查、UX 设计师、UI 设计师、运维工程师。
- 文件写入负责人：开发工程师独占 runtime/专项脚本；主线程项目经理独占文档与台账；调查与独立验收只读。
- 执行顺序：冻结任务卡 → 核对真实提交链 → 唯一 runtime 实现 → 专项/相邻门 → 独立对抗复验 → 完整门 → 文档同步 → PHM-D 本地 checkpoint。
- 修复预算：一次实现；同一冻结门最多两次证据驱动修复。
- 当前状态：PHM-D 修复轮 1 已关闭 frozen execution plan 与 final-attempt phase 两个信任边界；专项、数据库、相邻、TypeScript、ESLint、独立复验与完整 `check:launch` 全部通过，准备以 `ea20480` 为回滚锚点封存。
