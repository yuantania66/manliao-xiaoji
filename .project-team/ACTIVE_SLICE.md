# 当前交付切片

- 名称：PHM-E — Safety Supersession and Pure Resolved/Active Queries。
- 交付结果：Safety winner 仅对严格相邻且未解决的 proactive `opens` 写入 immutable `supersedes`，并提供 fail-closed 的纯 `handoffSuperseded`、`handoffResolved`、`activeHandoff` 查询。
- 用户价值：无需持久 greeting lifecycle state，即可从 committed events 区分 Safety supersession、resolved 与 active handoff。
- 验收标准：validated Safety winner 仅对严格相邻 active `opens` 写精确 target-bound `supersedes`；无 target、turn mismatch、retry loser、失败或 rollback 不写 edge；Guest/Auth 对等；superseded/resolved/active 查询严格、无写入且 malformed/错绑/重复 id/非相邻证据 fail closed；专项、相邻、TypeScript、ESLint、独立对抗和完整 `check:launch` 通过。
- 允许范围：Conversation OS envelope/query 与 export、authenticated/Guest commit projection、PHM-E 专项和必要相邻回归、package gate，以及 9 个直接状态文档。
- 非目标：不改 PHM-A/B/C/D 语义、Memory、User Model、Batch 2、schema/migration 或部署；不新增持久 lifecycle state、session aggregate 或文本判断。
- 当前基线：分支 `codex/planner-handoff-migration`；HEAD `ea20480`；工作区仅有用户的独立 `AGENTS.md` 修改，必须保留且不得纳入本切片。项目快照脚本在仓库中不存在，已以 Git 状态、权威合同和真实调用链只读审计替代。
- 第一因果边界：Safety 在 Planner 前返回，Auth 与 Guest 曾固定抑制 envelope，因此 active proactive greeting 无法在最终 commit boundary 投影为 supersession edge。
- 依赖项：Interaction Move Handoff Contract v1 §§4、8-10、12-13、15；PHM-C checkpoint `ea20480`；authenticated transaction 与 Guest client-scoped committed event boundary。
- 主要风险：错绑 Safety execution/user turn；解析非严格或重复 id 事件；把 stale target 当 active；retry loser 或 rollback 留下 edge；新增持久 lifecycle state。
- 激活角色：项目经理、技术架构师、开发工程师、测试工程师。
- 待命角色：产品/临床合同审查、UX 设计师、UI 设计师、运维工程师。
- 文件写入负责人：开发工程师独占 runtime/专项脚本；主线程项目经理独占文档与台账；调查与独立验收只读。
- 执行顺序：冻结任务卡 → 核对真实提交链 → 唯一 runtime 实现 → 专项/相邻门 → 独立对抗复验 → 完整门 → 文档同步 → PHM-E 封存。
- 修复预算：一次实现；同一冻结门最多两次证据驱动修复。
- 当前状态：PHM-E repair pass 1 已关闭 execution-turn 错绑与 duplicate-source ambiguity，并补齐 Safety retry-loser/rollback 专项证据；独立 Reviewer 最终 `PASS`，聚焦门、TypeScript、ESLint、diff check 与最终 `npm run check:launch`（exit 0）均通过。PHM-E 已封存，待主线程 Git seal。
