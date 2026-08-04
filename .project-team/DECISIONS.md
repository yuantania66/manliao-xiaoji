# 项目团队决策

| 日期 | 决策 | 证据 | 影响 |
|---|---|---|---|
| 2026-08-05 | 在 `.project-team/` 建立项目专属角色注册表和轻量台账 | 用户要求每个项目建立对应角色；仓库已有根目录历史交付账本 | 根目录账本保留历史，`.project-team/` 管理可复用提示词、角色档案和当前切片 |
| 2026-08-05 | 建立全部八个基础角色，但按交付切片激活 | 通用提示词要求角色完整，同时项目团队工作流要求最小有效团队 | 角色长期存在，未参与当前任务时保持待命 |
| 2026-08-05 | 当前初始化不创建子代理 | 用户要求初始化角色档案，没有要求启动并行代理工作 | 由主线程依次履行项目经理、产品、架构和测试职责 |
| 2026-08-05 | PHM-B 只冻结 Planner Transition Contract，不提前实现运行时 | PHM-A 已把 target-bound relation 送到 Planner 边界；真实缺口是 Planner 仍读取 `promptVersion` 且没有 handoff plan | 在唯一 Handoff v1 合同内补齐 tuple、歧义和 reciprocal semantics；Planner、Surface、Validator 与 committed edges 保持后续独立切片 |
