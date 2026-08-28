# 慢聊小记项目团队

## 项目信息

- 项目名称：慢聊小记（SlowTalk Notes）
- 产品目标：提供“慢聊”AI 陪伴与助人过程，以及用户主动记录生活材料的“小记”；让系统形成可追溯、可修正、可延续的长期理解。
- 目标用户：希望记录日常情绪与生活事件，并获得温和、尊重解释权的 AI 陪伴的用户。
- 当前阶段：Architecture v1 五层架构已冻结；Conversation OS 与 Hill Helping 迁移按交付切片推进；Web、微信小程序和生产部署链路已存在。
- 技术栈：Next.js 15、React 19、TypeScript、Prisma、PostgreSQL、微信小程序原生 JavaScript/WXML/WXSS、PM2、Nginx。
- 部署环境：腾讯云 CVM、Ubuntu、PostgreSQL、PM2、Nginx、Let's Encrypt；生产域名状态须以最新健康检查为准。
- 产品边界：重隐私 AI 陪伴和生活记录产品；不是医疗产品，不提供诊断、治疗计划、医学建议或危机救援调度。

## 权威资料

1. 产品范围：[`docs/PRD_V1.md`](../docs/PRD_V1.md)
2. 架构基线：[`docs/ARCHITECTURE_V1_FINAL.md`](../docs/ARCHITECTURE_V1_FINAL.md)
3. 产品架构：[`docs/PRODUCT_ARCHITECTURE_V1.md`](../docs/PRODUCT_ARCHITECTURE_V1.md)
4. 安全与治理：[`docs/SAFETY_GOVERNANCE_LAYER.md`](../docs/SAFETY_GOVERNANCE_LAYER.md)
5. Hill 助人过程契约：[`docs/HILL_HELPING_PROCESS_PRODUCT_CONTRACT_V1.md`](../docs/HILL_HELPING_PROCESS_PRODUCT_CONTRACT_V1.md)
6. Hill × 产品优先级对照：[`docs/HILL_HELPING_PRODUCT_PRIORITY_MAP_V1.md`](../docs/HILL_HELPING_PRODUCT_PRIORITY_MAP_V1.md)
7. 工程约束：[`AGENTS.md`](../AGENTS.md)
8. 历史交付账本：[`PROJECT_TEAM.md`](../PROJECT_TEAM.md)
9. 部署现状：[`DEPLOYMENT.md`](../DEPLOYMENT.md) 与 [`LAUNCH_READINESS_2026-07-02.md`](../LAUNCH_READINESS_2026-07-02.md)

Cursor、Codex 与其他代理共享同一 git 工作树：产品/架构真源在 `docs/`，当前切片与证据台账在 `.project-team/`，不另建平行目录。

如文档之间或文档与实现之间存在冲突，角色必须停止并报告证据，不得自行选择有利口径。

## 团队角色

| 角色 | 默认状态 | 当前负责人或代理 | 决策权限 | 主要交付物 |
|---|---|---|---|---|
| 产品经理 | 按切片激活 | 激活时委派 | 产品范围、优先级、业务验收 | 需求边界与产品验收结论 |
| 项目经理 | 激活 | 主线程交付负责人 | 计划、分工、依赖、整合、完成判断 | 任务卡、证据台账、最终报告 |
| UX 设计师 | 按切片激活 | 激活时委派 | 用户流程与交互验收 | 流程、状态和 UX 验收结论 |
| UI 设计师 | 按切片激活 | 激活时委派 | 视觉规范与还原验收 | 视觉规格、组件状态、UI 验收结论 |
| 技术架构师 | 按切片激活 | 激活时委派 | 技术边界与架构审查 | 最小方案、边界与架构结论 |
| 开发工程师 | 按切片激活 | 激活时委派 | 授权文件内的实现 | 代码、测试和自审 |
| 测试工程师 | 按切片激活 | 激活时委派 | 冻结验收与回归判断 | 测试证据和独立质量结论 |
| 运维工程师 | 按切片激活 | 激活时委派 | 发布准备与运行保障 | 发布、监控、备份和回滚结论 |

## 协作边界

- 产品经理决定“做什么、为什么”；用户保留重大产品决定权。
- 项目经理决定“谁在何时、按什么顺序交付”，但不覆盖专业角色的判断。
- UX 与 UI 不擅自改变产品范围；开发不以实现便利改写设计或产品合同。
- 架构师维护五层架构及单一 Response Planner 等既有不变量，不创建未授权产品层。
- 测试工程师验证冻结标准，不把可选优化升级为阻塞项。
- 运维工程师未经用户明确授权不得操作生产环境、密钥、数据迁移或发布。
- 同一文件或重叠子系统同时只有一个写入负责人。
- 主线程项目经理保留范围、整合和完成判断责任。

## 项目层级边界

```text
Application Layer
Conversation Layer
Clinical Logic Layer
Memory & Mental Model Layer
Safety & Governance Layer
```

Safety & Governance 高于普通对话和 Helping 路径。任何角色都不得把 Prompt、Trace、Dataset、ResponsePlan 或其他运行时对象擅自升级为新的产品层。
