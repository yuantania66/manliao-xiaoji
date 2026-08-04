# 当前交付切片

- 名称：PHM-B-AUTH — Immutable Detached Preflight Authority。
- 交付结果：在 `ResponsePlan` 组装前从 Context / Interpretation / DialogueState 生成深拷贝、规范化、深度冻结的 preflight authority snapshot，execution preflight 只用该 snapshot 验证 PHM-B handoff plan 与 answer-obligation provenance。
- 用户价值：为 PHM-B 提供真正独立的 fail-closed 信任边界，阻止 plan 与其输入/证据通过共享可变引用协同漂移。
- 验收标准：生产唯一调用在 Planner 前创建 snapshot；snapshot 与 ResponsePlan 零共享可变引用且递归 `Object.isFrozen=true`；preflight 对 nullable handoff plan、answer obligations 和规范化 provenance 执行 exact equality；plan/provenance 协同篡改、alias mutation、缺失 authority、extra/conflicting provenance 均 fail closed；合法 Guest/Auth 等价输入通过；专项、TypeScript、ESLint、相邻门、独立验收与 `check:launch` 通过。
- 允许范围：一个 Conversation OS 纯 authority/provenance 辅助模块，`conversation-os/control/index.ts`、`responsePlanner.ts`，`services/ai/chatExecutionLifecycle.ts`、`chatOrchestrationService.ts`，PHM-B 专项脚本，以及直接相关文档/项目台账。允许对当前未提交 PHM-B diff 做仅为解决该已命名信任边界所需的重构。
- 非目标：不改 PHM-B mapping/priority/typed repair/legacy isolation；不改 PHM-A target/relation；不修改 Prompt/Surface、semantic Validator、API/client、Memory、User Model、Batch 2、schema、persistence、committed edges 或部署；不新增决策 owner、持久 lifecycle state、关键词/regex/case patch。
- 当前基线：分支 `codex/planner-handoff-migration`；HEAD `bb38951`；工作区包含未封存 PHM-B runtime candidate 与项目台账，`git diff --check` 通过；已复现 shared-reference 与 non-exact provenance 阻塞。
- 依赖项：Interaction Move Handoff Contract v1 §14、当前 PHM-B candidate、唯一 `createResponsePlan`、execution preflight。
- 主要风险：snapshot 创建时机过晚；浅拷贝或冻结不完整；provenance 生成与验证双实现漂移；nullable expected plan 未被对比；为修复 alias 越界改 Planner 语义。
- 激活角色：项目经理、技术架构师、开发工程师、测试工程师。
- 待命角色：产品经理、UX 设计师、UI 设计师、运维工程师。
- 文件写入负责人：开发工程师独占 runtime/专项脚本；主线程项目经理独占文档与台账；测试工程师只读。
- 执行顺序：冻结任务卡 → detached authority/provenance 纯合同 → Planner 前 snapshot 组装 → preflight exact compare → alias/adversarial 回归 → 相邻/完整门 → 独立验收 → PHM-B 本地 checkpoint。
- 修复预算：一次实现；本新切片的同一冻结门最多两次证据驱动修复。
- 当前状态：已通过专项、相邻、TypeScript、ESLint、独立对抗复核和完整 `check:launch`，与 PHM-B runtime 作为同一可回滚检查点封存；不将本切片计为 PHM-B 第三轮修复。
