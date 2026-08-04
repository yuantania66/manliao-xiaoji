# 项目团队决策

| 日期 | 决策 | 证据 | 影响 |
|---|---|---|---|
| 2026-08-05 | 在 `.project-team/` 建立项目专属角色注册表和轻量台账 | 用户要求每个项目建立对应角色；仓库已有根目录历史交付账本 | 根目录账本保留历史，`.project-team/` 管理可复用提示词、角色档案和当前切片 |
| 2026-08-05 | 建立全部八个基础角色，但按交付切片激活 | 通用提示词要求角色完整，同时项目团队工作流要求最小有效团队 | 角色长期存在，未参与当前任务时保持待命 |
| 2026-08-05 | 当前初始化不创建子代理 | 用户要求初始化角色档案，没有要求启动并行代理工作 | 由主线程依次履行项目经理、产品、架构和测试职责 |
| 2026-08-05 | PHM-B 只冻结 Planner Transition Contract，不提前实现运行时 | PHM-A 已把 target-bound relation 送到 Planner 边界；真实缺口是 Planner 仍读取 `promptVersion` 且没有 handoff plan | 在唯一 Handoff v1 合同内补齐 tuple、歧义和 reciprocal semantics；Planner、Surface、Validator 与 committed edges 保持后续独立切片 |
| 2026-08-05 | PHM-B 修复轮 1 最小扩展 Context 输入存在信号 | 严格 envelope 解析会丢弃 malformed/mismatched v1，Planner 因而无法区分“真正无 v1”与“有但无效 v1”，并误启 legacy `promptVersion` | 只增加非持久 presence projection 用于 fail closed；不改 PHM-A relation 分类、API 或存储 |
| 2026-08-05 | direct-answer obligation 保持 PHM-B explicit override | 合同 §14 明确 refine §7；§14.4 指定 established direct-answer obligation 应用高优先级 tuple，challenge relation 仅作 trace focus | 同一 turn 同时有 challenge candidate 和真实 current answer obligation 时，`requiredFunction=answer_current_obligation`，不因章节表面行序改为 repair |
| 2026-08-05 | 新建 PHM-B-AUTH 独立切片 | 用户明确批准 immutable detached preflight-authority contract；PHM-B 两轮修复证明原 plan 与 authority 共享可变引用 | 本切片拥有新的实施与修复预算，不算 PHM-B 第三轮修复；只解决 detached snapshot 与 exact provenance 信任边界 |
| 2026-08-05 | PHM-B runtime 与 PHM-B-AUTH 合并封存 | Planner transition、detached recursive freeze、exact nullable plan/obligation/provenance comparison、独立对抗复核和完整 launch gate 均通过 | 以 `bb38951` 为回滚锚点整体封存；Prompt/Surface、semantic Validator 与 committed edges 仍是后续独立切片 |
