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
| 2026-08-05 | 冻结 PHM-C Surface + same-plan semantic Validator | 两项独立只读审查确认 handoff plan 已到 orchestration，但 Prompt 与 Validator 均不消费；§§7-9 已冻结正向语义且禁止词表/regex patch | 用独立 strict typed semantic verdict 关闭生成/验收 NO-OP；committed `fulfills/supersedes` edges 继续后置 |
| 2026-08-05 | PHM-C 修复轮 1 纳入 Output Validation LLM 治理 | 完整 `check:launch` 在架构静态门拒绝新的 validator `callModel`；权威架构 §2.7 已要求独立 same-plan semantic verification | 只扩展架构白名单/断言并让 validator prompt 经过既有 external inspection；不放宽单 Planner、fail-closed 或无额外 rewrite 的边界 |
| 2026-08-05 | PHM-C 修复轮 1 同时冻结 execution plan | 独立只读反例在 Surface 读取后原地修改 plan，Validator 按新 tuple 接受并误报 `planChanged=false` | `enforceResponsePlan` 在首次生成前 deep-clone + recursive-freeze，一份 snapshot 同时供 Surface、两次候选和 semantic Validator；不新增 lifecycle state |
| 2026-08-05 | 冻结并执行 PHM-D ordinary committed completion | 用户明确授权只实现验证成功后的 committed completion edges 与查询，不新增持久 lifecycle state | 只实现 target-bound `fulfills` 与纯 `handoffCompleted`；Safety `supersedes`、resolved/active lookup 后置 |
| 2026-08-05 | PHM-D 修复轮 1 绑定 PHM-C frozen execution plan | 独立验收复现 outer plan 同 planId 篡改 target/function 与 REJECTED final attempt 可越过首版证据门 | 原样传递既有 frozen snapshot，并强制最终 attempt phase 为 VALIDATED；不改变 Planner/Surface/Validator 决策语义 |
| 2026-08-05 | 冻结并执行 PHM-E Safety supersession 与纯查询 | 用户明确授权单独实现 Safety supersedes 和 resolved/active 纯查询，并继续禁止持久 lifecycle state | 只从严格有效、相邻 committed events 投影 winner-only `supersedes`；无 active target 保持 null envelope |
| 2026-08-05 | 封存 PHM-E，待 Git seal | repair pass 1 关闭 execution-turn 错绑与 duplicate-source ambiguity；独立 Reviewer 最终 `PASS`，最终 `npm run check:launch` exit 0 | 当前切片验收关闭；不新增产品决策，不授权持久 lifecycle state 或 Batch 2 实现 |
| 2026-08-07 | 封存 PHM-C Validator Structured Output Reliability | 用户批准将真实门限定为 strict exact-schema JSON；四类真实 Qwen fixtures、专项/相邻门、完整 launch 与独立 Reviewer 均通过 | Qwen PHM-C 单点启用 `json_object`；语义拒绝继续 fail closed，Semantic Calibration 保持独立未授权切片 |
