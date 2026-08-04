# 证据台账

| 验收项 | 验证方式 | 证据 | 状态 | 负责人 |
|---|---|---|---|---|
| 合并后的提示词存在且章节完整 | 文件结构与标题检查 | `TEAM_PROMPT.md` 包含项目初始化、任务卡、八个角色、实例化、委派、执行、协作、台账、停止和最终报告章节 | 通过 | 项目经理 |
| 八个基础角色档案齐全 | 显式预期文件数组与实际清单比对 | `expected=14 actual=14`；八个 `roles/*.md` 均存在 | 通过 | 测试工程师 |
| 角色档案字段完整 | 对每个角色检查十二个必备二级标题 | 八个角色均包含状态、使命、背景、权限、范围、输入、交付、验收、交接、风险和停止条件，无缺失输出 | 通过 | 测试工程师 |
| 角色内容绑定当前项目 | 产品、架构、安全、UI/QA、部署术语与权威资料审查 | 已绑定慢聊/小记双产品、五层架构、Safety 优先、Web/小程序、Conversation OS、Prisma/PostgreSQL 与腾讯云部署边界 | 通过 | 产品经理 / 架构师 |
| 新旧团队文档职责不冲突 | 链接与职责说明审查 | 根目录账本保留历史；顶部链接明确 `.project-team/` 负责角色档案、当前切片和轻量台账 | 通过 | 项目经理 |
| 项目资料引用有效 | 逐项文件存在检查 | AGENTS、PRD、Architecture、Product Architecture、Safety、Deployment、Launch Readiness 与历史团队账本均存在 | 通过 | 项目经理 |
| 范围外用户修改得到保留 | 实施前后工作区对比 | 验证阶段出现 `docs/CONVERSATION_OS_INTERACTION_MOVE_HANDOFF_CONTRACT_V1.md` 与 `docs/ARCHITECTURE_V1_FINAL.md` 修改；未修改、回退或纳入本切片 | 通过 | 项目经理 |
| 文档格式无明显问题 | `git diff --check`、尾随空白检查与自审 | 跟踪差异检查退出 0；新增文件检查无尾随空白；结构自审通过 | 通过 | 测试工程师 |
| 反例不会破坏团队规则 | 正常、边界、歧义、上下文切换和对抗性审查 | 覆盖已有目录复用、一人多角色、无子代理、文档冲突、重叠写入、历史生产状态和未授权生产操作 | 通过 | 测试工程师 |

## PHM-B Planner Transition Contract Freeze

| 验收项 | 验证方式 | 证据 | 状态 | 负责人 |
|---|---|---|---|---|
| 找到第一因果边界 | 只读调用链审计 | PHM-A target/relation 已传入唯一 `createResponsePlan`；Planner 忽略它并仍读取 `promptVersion` | 通过 | 技术架构师 |
| 冻结完整 Planner tuple | 权威合同审查 | 激活、fail-closed、relation/function/completion/question-policy 和 ordinary-action composition 已穷尽 | 通过 | 项目经理 |
| 冻结多候选规则 | 正常、组合、歧义和对抗性合同反例 | compatible collapse、incompatible defer、trace-only selection 与 tie order 已明确 | 通过 | 产品经理 / 技术架构师 |
| 冻结 reciprocal contact 正向语义 | 正向后置条件审查 | 接受用户回礼为充分 mutual contact，释放 greeting ritual，不要求用户继续证明在场或提供话题 | 通过 | 产品经理 |
| 保持 docs-only 和并发成果隔离 | 工作区分类与差异检查 | PHM-B 只涉及七个文档/治理路径；团队初始化目录其余文件单独保留；runtime/schema/test 未改 | 通过 | 测试工程师 |
| 独立冻结验收 | 只读合同、差异和运行现状复核 | 三类源函数、八类 relation、priority override、全部存活 evidence span、Guest/Auth 和 legacy/runtime 状态一致，无 severity defect | 通过 | 测试工程师 |
