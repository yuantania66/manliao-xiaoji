# Agency Agents × 心晴 2.0

## 结论

Agency Agents 适合作为研发期的专业角色来源，不适合作为心晴运行时的多 Agent
回复架构。心晴已有单一 Response Planner、明确的 Safety/Clinical/Surface/Validator
权限边界和 winner-only 正式提交约束；多个角色共同决定用户回复会破坏这些边界。

本项目采用“上游角色专长 + 本地权限约束”的方式：借用 Project Shepherd、Backend
Architect、AI Engineer、Reality Checker 等角色的专长，但由项目的 `AGENTS.md`、产品
合同和 `$project-team` 规则覆盖其通用人格提示。

## 项目证据与角色选择

| 项目事实 | 风险 | 采用角色 |
|---|---|---|
| Conversation OS 有单一决策链和单一 Response Planner | 多角色形成竞争决策权 | Delivery Lead + 单一 Scoped Builder |
| Safety 高于普通规划，产品非医疗 | 危机主体误判、诊断越界 | Safety & Privacy Reviewer |
| 只有 VALIDATED → COMMITTED 可形成正式消息/记忆/状态 | 重试、失败或 loser 泄漏状态 | Backend Architect + Reality Checker |
| Memory、身份、心理内容和删除链路涉及敏感数据 | 明文、训练、审计与删除传播风险 | Safety & Privacy Reviewer |
| 同时存在 Web、Guest/auth 和微信小程序 | 多端语义与身份不一致 | API Tester / WeChat Mini Program Developer（按需） |
| 当前工作树有大量在途改动 | 覆盖、格式化和范围漂移 | 单 writer + 独立 verifier |

### 推荐团队

常驻的是四种责任，而不是四个永远同时运行的 Agent：

1. Delivery Lead（源自 Project Shepherd）：主线程负责人，独占范围、整合和完成判断。
2. Scoped Builder（Backend Architect 或 AI Engineer 二选一）：一个切片只有一个写入负责人。
3. Independent Verifier（源自 Reality Checker）：只读验证冻结验收和反例。
4. Safety & Privacy Reviewer（本地专化）：仅在临床、安全、Memory 或数据边界触发。

前端、小程序、UX、API 测试、数据库、技术写作、DevOps 和性能角色均按风险启用，
不组成固定“大团队”。Rapid Prototyper、增长、营销和 Whimsy 等角色不进入安全敏感
工程核心。

## 与 `$project-team` 的区别

| 维度 | Agency Agents | `$project-team` | 本项目组合方式 |
|---|---|---|---|
| 解决什么 | 提供专业身份、方法和交付风格 | 控制一个切片如何分工、验收和停止 | 前者回答“谁适合”，后者回答“怎样安全交付” |
| 范围所有权 | 角色文件本身不保证单一总控 | Lead 独占范围和完成判断 | 始终以 `$project-team` 为上位治理 |
| 多 Agent 调度 | 角色库可被不同工具调用，但不是强制编排器 | 明确何时才使用子 Agent | 只委派独立、边界清楚的任务 |
| 写入冲突 | 通用角色可能各自实现 | 一个文件/子系统一个 writer | 禁止竞争实现 |
| 验收 | 每个角色有自己的成功标准 | 冻结 acceptance 和证据台账 | verifier 不能发明新 gate |
| 安全敏感性 | 通用角色未必了解心晴合同 | 支持领域审查，但不内置本项目语义 | 本地 Safety & Privacy 角色补齐 |
| 产品运行时 | 可被误解成产品内多 Agent | 面向研发交付 | 明确禁止进入回复决策链 |

两者不是替代关系。仅安装 Agency Agents 会得到很多“专家提示词”，但不会自动获得
范围冻结、单 writer、失败轮次预算或项目边界；只用 `$project-team` 则缺少项目技术
和领域角色的具体触发条件。

## Codex 化结果

项目内 skill 位于 `codex-skills/xinqing-delivery-team/`：

- `SKILL.md`：选择、授权、委派、验证和停止流程；
- `references/roles.md`：核心/按需角色卡和项目专属禁区；
- `agents/openai.yaml`：Codex UI 元数据。

该包刻意不复制完整上游角色文本。原因是心晴已有更严格的架构与安全合同，直接复制
会引入重复、冲突和过长上下文。使用时先加载 `$project-team`，再加载本 skill；对每个
切片只激活最小角色集合。

本包当前保存在仓库普通目录，尚未全局安装。项目 `.codex/` 在当前环境只读；同时，
全局安装会影响其他项目，需另行明确授权。

## 来源与边界

- 上游：<https://github.com/msitarzewski/agency-agents>，MIT License。
- 项目权威：`AGENTS.md`、`.project-team/PROJECT_TEAM.md`、
  `docs/ARCHITECTURE_V1_FINAL.md`、`docs/SAFETY_GOVERNANCE_LAYER.md` 和
  `services/ai/README.md`。
- 上游角色的口吻、流程或成功指标若与项目合同冲突，项目合同优先。
