# 批次 1.5 候选 3 前本地验收记录

状态：当时的代码实现与完整 `check:launch` 通过；候选 3 后续失败，并证明本地门仍有
preflight 场景覆盖缺口。本文件保留为运行前验收记录，不代表候选 3 已通过。

## Completed

- `ResponsePlan` 新增 Planner 所有的正向功能合同。
- 情绪支持覆盖降低表达负担、归还内容焦点、归还表达量控制、承认当前关系影响四种功能。
- 普通修复覆盖事实替换、命题撤回、互动动作撤回三种目标。
- Surface 接收选定功能与证据边界；Validator 检查功能完成，而不只检查禁止项。
- 执行前置检查阻止缺失、错配、无证据或不完整合同进入 Surface。
- 未启用 Hill 目标或技术，未写入 `CommittedHelpingMove`，未进入批次 2。

## Evidence

- 冻结数据集 SHA-256：`12bd41f3c6c4370ddc3593cf997203037bc321a3b40d890ce196e9f6bcd6f243`，未修改。
- 候选 2 的 25 条首次失败冻结回放：18 条 `surface_failure` 拒绝、6 条
  `validator_false_positive` 接受、1 条 `both` 因真实 Surface 缺陷拒绝。
- 独立正向功能反例：28 条，14 条应接受全部接受，14 条应拒绝全部拒绝。
- 既有质量反例：36 条拒绝、16 条接受全部通过。
- 20 个冻结场景的动作、10 个修复场景的目标类型、60 轮规模和原阈值结构检查通过。
- 批次 0/1/1.5、Conversation OS、Natural Chat（125 条反例）、Grounding、Safety、
  Clinical 边界、普通交接、主动问候、对话轨迹和架构检查通过。
- `npm run build` 通过；`npx tsc --noEmit` 通过；`npm run lint` 为 0 错误、1 个既有
  长期记忆未使用函数警告。
- 获得本地 PostgreSQL 连接授权后，消息提交生命周期和 5 个 Memory V2 持久化测试
  全部通过。
- 完整 `npm run check:launch` 以退出码 0 通过，包含全部聊天门、Prisma schema、
  12 个迁移状态、Miniapp 语法和最终生产构建。

## Remaining

- 候选 3 已运行但未通过；不得生成盲审候选。
- 需要先冻结候选 3 的分层归因，并补齐逐冻结场景 preflight 保留门。

## Blocking Reason

候选 3 的原冻结门失败：最终有效 50/60、约束失败 10、再生成 13/60。运行还证明
本文件记录的本地验收没有覆盖每个冻结场景的计划 preflight，因而不能继续用于申请
新候选。

## Recommended Next Step

先冻结候选 3 的 10 个最终失败和 13 次再生成的分层归因，明确区分 Planner 合同、
Surface 功能与 Validator 误判，再制定候选 4 前的本地门；归因前不修改代码。
