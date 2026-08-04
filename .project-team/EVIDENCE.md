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

## PHM-B Planner Handoff Runtime Implementation

| 验收项 | 验证方式 | 证据 | 状态 | 负责人 |
|---|---|---|---|---|
| 唯一 Planner 生成 handoff plan | 专项结构与行为回归 | `createResponsePlan` 消费 PHM-A projection；其他层不选择 function | 通过 | 开发工程师 |
| v1 与 legacy 严格隔离 | 静态与对抗回归 | v1 projection 存在时不读取 `promptVersion`，invalid projection 不回落修复 | 通过 | 测试工程师 |
| 完整 tuple 与多候选规则 | 正常、边界、歧义、上下文切换和对抗案例 | §14.3-14.4 全覆盖，unsupported typed-defer | 通过 | 测试工程师 |
| Plan preflight fail closed | detached authority 对抗反例 | identity、intent、policy、evidence、function、obligation 与 canonical provenance mismatch 被拒绝 | 通过 | 开发工程师 / 测试工程师 |
| 保持 required-nullable contract | TypeScript compatibility evidence | 字段保持 required-nullable；expected null/non-null 使用 exact comparison | 通过 | 开发工程师 |
| 保持后续边界 | 差异与架构检查 | Prompt/Surface、semantic Validator、edges、Memory、Batch 2、schema 均未修改 | 通过 | 项目经理 |
| 完整工程回归 | `npx tsc --noEmit`、专项/相邻 gates、`check:launch` | 全部退出 0；12 migrations、27 个 miniapp JS 文件、39 页 production build 通过 | 通过 | 测试工程师 |

### PHM-B 独立验收修复记录

- 首轮专项、TypeScript、相邻 Conversation OS 与 AI orchestration gates 通过，但独立对抗复现得出 `FAIL`，不将已有绿灯当作封存依据。
- 已命名失败门：malformed/mismatched v1 输入丢失后误启 legacy `promptVersion`；typed challenge/reject 经旧 regex 退化为 proposition repair；伪造或已关闭 answer obligation 通过 preflight；篡改 target/evidence/tuple 的 handoff plan 未被充分拒绝。
- 修复轮 1 只允许修复上述冻结门；不得扩展到 Prompt/Surface、semantic Validator、committed edges 或持久 lifecycle state。
- 修复轮 1 后，typed repair、invalid-v1 legacy fallback、punctuation invariant 和单字段篡改已经独立复验通过；另一独立架构审阅仍复现 plan/provenance 协同篡改、valid+invalid-extra obligation 和 question/target 伪造可通过。
- 修复轮 2 是同一 exact-preflight 门的最后一轮：生产 preflight 必须从原 Context / Interpretation / DialogueState 重算并完整对比 handoff plan 与 answer obligations，不再依赖 ResponsePlan 内部自证。
- 修复轮 2 独立结论 `NO-GO`：生产调用虽传入 Context / Interpretation / DialogueState，但 `ResponsePlan.answerObligations` 与 `DialogueState.openObligations`、handoff evidence 与 Interpretation candidate evidence 仍共享可变引用；原地协同篡改后 authority 重算仍会通过。obligation provenance 也只验证必需项“存在”，没有对规范化数组做 exact equality。
- 专项、TypeScript、ESLint、相邻 Conversation OS / AI gates 通过；最终 `check:launch` 在第二轮独立 `NO-GO` 后主动中止，不作为封存证据。不得创建 PHM-B runtime checkpoint。

## PHM-B-AUTH Immutable Detached Preflight Authority

| 验收项 | 验证方式 | 证据 | 状态 | 负责人 |
|---|---|---|---|---|
| Planner 前建立 authority | 生产调用链静态审查 | snapshot 在唯一 `createResponsePlan` 调用前创建，唯一 preflight 调用必传 snapshot | 通过 | 技术架构师 |
| 零共享可变引用与深度冻结 | 引用、`Object.isFrozen` 与 mutation 对抗回归 | snapshot、obligations、handoff evidence、provenance 全部递归冻结，且与 plan/inputs 非同引用 | 通过 | 独立验收 |
| exact nullable plan / obligations / provenance | 协同篡改与 extra/conflict 回归 | plan+provenance、obligation+provenance、evidence+provenance 协同修改以及额外/冲突 provenance 全部 fail closed | 通过 | 独立验收 |
| 单一 mapping 与 provenance owner | 依赖与实现审查 | 唯一纯 handoff projector；同一 canonical provenance builder 供 snapshot 与 Planner 使用；preflight 不重新规划 | 通过 | 技术架构师 |
| Guest/Auth 逻辑等价 | 专项等价输入回归 | equivalent paths 产生相同 plan tuple 并通过 preflight | 通过 | 测试工程师 |
| 架构边界与回滚 | 独立 release audit | 无持久 state、schema、Memory、User Model、Batch 2、Prompt/Surface/Validator diff；回滚锚点 `bb38951` | 通过 | 发布与基线 |
| 完整发布门 | `npm run check:launch` | exit 0；Prisma schema/migrations、Miniapp JS 与 Next.js production build 全部通过 | 通过 | 项目经理 |

PHM-B-AUTH 是用户批准的新切片，不是 PHM-B 第三次修复。它关闭了前两轮暴露的信任边界后，PHM-B runtime 与 AUTH 作为同一 checkpoint 封存；历史 NO-GO 记录保留为决策证据。

## PHM-C Surface + Same-Plan Semantic Validation

| 验收项 | 证据 | 状态 |
|---|---|---|
| Surface tuple/history projection | 完整 handoff tuple 与 relation evidence 入 Prompt；v1 按 source id 裁剪并保留 explicit resumption | 通过 |
| 独立语义验收 | 全函数、defer、无问号索取、optional 顺序、self-report、mixed contradiction 与 provider fail-closed 专项 | 通过 |
| unchanged same plan | execution plan deep-clone + recursive freeze；首次、重试和两类 Validator 使用同一引用；独立 mutation attack 关闭 | 通过 |
| LLM 治理 | 唯一 structured non-writer call、external inspection、strict full-string JSON、单 Planner architecture gate | 通过 |
| 独立修复复验 | 原两个 P1 与 P2 parser 观察全部反转；无 P0-P3 | 通过 |
| 完整发布门 | `check:launch` exit 0；12 migrations、27 Miniapp JS、39-page production build | 通过 |
