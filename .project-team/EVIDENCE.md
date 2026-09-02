# 证据台账

## Hot/Cold Path V1 + Composer Shadow V1 Contract Freeze

| Gate | Evidence | Status | Owner |
|---|---|---|---|
| 当前/目标权威分离 | `ARCHITECTURE_V1_FINAL.md` §10 明确 V1 仍为唯一生产 writer | pass | Delivery Lead |
| Hot/Cold 完整边界 | `HOT_COLD_PATH_V1_CONTRACT.md` 覆盖 INV、winner、Context、Cold、Memory、retention、deletion、SLO protocol | pass | Delivery Lead |
| P1 零影响与可测性 | `composer-shadow-v1.md` 覆盖输入/输出、七项隔离、时钟、schema、样本与退出门 | pass | Delivery Lead |
| 不声称未测 SLO | P1 只冻结 `[BUDGET-CANDIDATE]`，P3 才冻结 `[SLO-FIRST-SAFE]` | pass | Architect |
| 删除与副本级联 | Publication 正文继承会话删除；Replay 30 天/授权取短，Observation 90 天，源删除立即失效并在 24 小时内清理链接文本/映射 | pass | Independent Reviewer |
| 文档整洁 | `git diff --check` | pass | Independent Reviewer |

首次 Independent Review：FAIL，发现 SLO 名称混用及 Publication/Replay 删除漏缝。唯一修复轮后定向复审：PASS，无新矛盾。

## Plan Preflight Recovery

- 第一因果边界：Planner 选择 `offer_emotional_support`，本轮 canonical affect spans 为空，preflight 正确拒绝；Orchestration 原先把局部动作无效错误升级为整轮 `PLAN_INVALID`。
- 实现只接受唯一、精确的 `missing_emotional_support_evidence_spans`；mixed、authority、wrong-turn、binding、handoff、provenance 等任何附加失败均不恢复。
- Orchestration 通过同一 `createResponsePlan` 调用点最多完整重规划一次；恢复计划重新推导 actions、Clinical、behavior source、positive contract、policies 与 provenance，Surface/Validator 不重规划。
- `check:chat-execution-lifecycle`、`check:ai-orchestration`、`check:conversation-episode-memory-loop`、`npx tsc --noEmit`、`git diff --check`：PASS。Independent Reviewer：PASS，无严重问题。
- 真实 `qwen3.7-max`：attempt 0 以 `missing_emotional_support_evidence_spans` 拒绝；attempt 1 preflight PASS；最终 action 为 `acknowledge_without_psychologizing`，execution `COMMITTED`，回复成功生成，不再进入 `PLAN_INVALID` 或用户重试循环。
- 同次真实运行中 Episode Summary 成功，但 Retrieval 返回空候选；因此没有使用领导历史。该上游相关性稳定性不属于本恢复切片，未在此处扩大修改范围。
- 未修改 Safety、Surface、Validator、Memory 实现、schema 或事件边；未新增关键词、固定 fallback 或持久 lifecycle state。

## Guest First-Contact Duplicate Runtime Boundary — Stopped

- 真实根因链已确认：Guest envelope、消息 ID、handoff target、`reciprocates_move -> complete_reciprocal_contact` 与客户端单 winner 均正确；baseline Planner 产出 `responseActions=[]`，Surface 两次退化为重复身份或 generic open door，Validator 正确拒绝。
- repair 1 `offer_neutral_conversation_entry`：真实页面仍双拒；另一次 direct trace 错误提交“你好呀，我是小慢。随时可以……”，statement-only 方案被证伪。
- repair 2 `take_light_topic_initiative`：Planner 不再为空，且无 identity action/contract/disclosure；但真实页面仍显示“这次回复没能生成，请重试”。direct trace 两次候选为“你好呀，今天想聊点什么？”与“你好呀，今天有什么想聊的吗？”，均被 handoff/question policy 正确拒绝，首个同时命中 `initiative_returned_to_user`。
- `check:natural-chat-control`、`check:conversation-os-relational-state`、TypeScript no-emit 与 `git diff --check` 通过；handoff planner gate 被既有、无因果关系的 relation candidate fixture mismatch 阻断。
- 独立 Reviewer：`FAIL`。当前 Planner action authority 是部分成果，但原验收“同一真实页面轨迹连续成功两次”未满足。同一 gate 两次 repair 后按规则停止；未运行完整 `check:launch`，不得封存或宣称已修复。

## Proactive Clarity / Committed-Claim Repair / Idle Arbitration

| 验收项 | 验证方式 | 证据 | 状态 | 负责人 |
|---|---|---|---|---|
| 主动表达清晰度后置条件 | strict semantic verdict + 类别化离线/真实 Qwen 正反例 | 离线门与真实 Qwen 有限风险矩阵通过；清晰诗性表达通过，空洞/指代悬空表达 fail closed | 通过 | Developer / Reviewer |
| 澄清绑定 exact committed claim | Turn Interpretation、obligation/repair authority 与真实 Qwen 轨迹 | current exact 通过；active handoff、missing、wrong、targetless、stale older 全部 fail closed | 通过 | Developer / Reviewer |
| idle/initiative 冲突消解 | natural-idle 与明确新内容反例、端到端 commit | `allow_idle` 无新内容时不再附加 initiative；显式新内容/问题继续阻止 idle | 通过 | Developer / Reviewer |
| 保持既有架构边界 | strict parser、fail-closed、immutable edges、零 lifecycle/schema diff | 当前相邻 committed Assistant move 成为单一 ordinary authority；parser、事件边、schema/lifecycle 均未改 | 通过 | Delivery Lead / Reviewer |
| 集成与发布回归 | 窄门、TypeScript、focused ESLint、`git diff --check`、`check:launch` | 专项、TypeScript、lint、diff 与完整 `check:launch` exit 0；独立 Reviewer 最终 PASS | 通过 | Delivery Lead |

### 停止记录

- 修复轮 1：关闭 active/ordinary 正确 target 下 claim 字段缺失或错绑后回退到用户问题自身的路径。
- 修复轮 2：关闭 ordinary wrong-target 与 targetless 路径。
- 最终独立反例：新旧两个 ordinary committed claims 并存时，内部一致但指向旧 turn 的 exact binding 仍被接受；当前问题应绑定最新相邻 authority。
- 原冻结门在两次修复后按规则停止；随后依据既有 Architecture v1 单独冻结 current-authority closure，不再让模型拥有历史 target 选择权。该终局切片一次实现、一次复审通过，现已封存。

### Committed-Claim Current Authority Closure

- `current exact`：PASS，obligation 精确绑定当前相邻 committed claim。
- `missing / wrong / targetless / stale older`：PASS，均不产生 claim obligation。
- active handoff：PASS，继续只接受冻结 target。
- `check:conversation-os-relational-state`、`check:interaction-move-handoff`、`check:natural-chat-control`、`check:conversation-os-control`、TypeScript、focused ESLint、`git diff --check`：全部通过。
- 独立 Reviewer：PASS；strict parser、fail-closed、immutable event edges、零 persistent lifecycle/schema/migration 保持。
- 完整 `npm run check:launch`：exit 0；12 migrations current、27 Miniapp JS、39-page production build。

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

## PHM-D Validated Committed Completion

| 验收项 | 证据 | 状态 |
|---|---|---|
| 定位提交断点 | PHM-C 已验证最终候选，但 response envelope builder 固定写 `handoff=null` | 通过 |
| validated commit only | execution/final-attempt phase、final validation、planId 与 User turn 全部 exact binding | 通过 |
| exact frozen plan | `enforceResponsePlan` 返回实际验证的递归冻结 snapshot；outer-plan target/function mutation 攻击反转 | 通过 |
| Auth/Guest 与失败隔离 | Auth transaction winner、Guest validated boundary、retry loser、reject、Safety 与 rollback 回归 | 通过 |
| pure completion lookup | strict parser、exact source match；opens/null/wrong target/malformed 均为 false | 通过 |
| 独立修复复验 | 首轮 P1/P2 均反转；无 P0-P3，结论 GO | 通过 |
| 完整发布门 | `check:launch` exit 0；12 migrations、27 Miniapp JS、39-page production build | 通过 |

## PHM-E Safety Supersession and Pure Queries

- `check:interaction-move-envelope`：通过；覆盖 Safety 精确 shape、superseded/resolved/active 真值表、malformed、错绑、blocked、stale/non-adjacent 与 self-target fail-closed。
- `check:chat-execution-lifecycle`：通过；覆盖 active target winner-only atomic supersession、无目标 Safety null envelope 与既有 rollback isolation。
- `check:interaction-move-handoff`、`check:ai-orchestration`、TypeScript no-emit、六文件 focused ESLint：通过。
- repair pass 1：关闭 execution-turn 错绑与 duplicate-source ambiguity，并补齐 Safety retry-loser 与 transaction rollback 专项反例；冻结门全部反转。
- 独立 Reviewer 最终结论：`PASS`；原始问题已解决，无回归或不必要变更，PHM-E 可封存。
- 最终 `npm run check:launch`：exit 0；12 migrations current、27 Miniapp JS files、39-page production build。既有 lint warning 1 条、prelaunch warning 2 条，均非 PHM-E 变更且门返回成功。
- 变更未触及 schema、migration、Memory、User Model 或 Batch 2；查询结果不持久化。

## PHM-C Validator Structured Output Reliability

- Qwen request-shape 专项：PHM-C 单点携带 `response_format.type=json_object` 与 `enable_thinking=false`；普通 Qwen 与 Mock 不变；unsupported provider 在 fetch 前 fail closed 且不泄露 Prompt。
- strict full-string parser、exact keys/binding、UTF-16 evidence、uncertain/malformed/semantic fail-closed 保持不变；旧 semantic-repair Prompt/interface 扩张已移除。
- 真实 `qwen3.7-max` 四类 fixtures：全部返回 strict exact-schema JSON；语义或 evidence 拒绝均安全记录为低基数类别；gate exit 0。
- 专项、Conversation OS control、AI orchestration、TypeScript、focused ESLint、`git diff --check`：全部通过。
- 独立 Reviewer 最终结论：`PASS`；无 lifecycle persistence、schema/migration 或 Planner/Surface/Safety 范围扩张。
- 最终 `npm run check:launch`：exit 0；12 migrations current、27 Miniapp JS files、39-page production build。既有 lint warning 1 条、prelaunch warning 2 条，均非本切片新增且门返回成功。

## PHM-C Semantic Calibration — Reciprocal Contact

- Architect 复现确认原拟正例 `你好呀。` 与冻结合同冲突；binding、UTF-16 evidence、question policy 均正常，真实 verdict 的第一矛盾是 `positiveFunctionRealized=true` 与 `realizedFunction=null` 并存。
- Validator 仅新增 reciprocal-contact 规范语义、verdict 字段不变量、不可信 candidate 边界与 caller-computed UTF-16 参考；strict parser、exact keys/binding/evidence、本地 function/policy gates 未改。
- 真实 `qwen3.7-max`：`那就算认识啦。` 与 Unicode 正例通过；重复问候、generic open door、mixed pressure、unsupported optional question、prompt injection 均以 `function_or_policy_not_satisfied` 拒绝；破坏 Unicode span 以 `evidence_mismatch` 拒绝。
- 真实服务门在受限环境外 exit 0，host `dashscope.aliyuncs.com`；仅基础设施 timeout/429/5xx 保留一次重试，2.5 秒 pacing/backoff 不改变语义与重试次数。
- 专项、Conversation OS control、AI orchestration、TypeScript、focused ESLint、`git diff --check`：全部通过；独立 Reviewer 最终 `PASS`。
- 最终 `npm run check:launch`：exit 0；12 migrations current、27 Miniapp JS files、39-page production build；既有 1 条 lint warning 与 2 条 prelaunch warning 未新增。

## PHM-A Reciprocal/Unclear Candidate Reconciliation

- 真实截图会话只读 trace：用户 `嗨` 被模型投影为 `reciprocates_move`，但 merge 同时注入 adjacency-only `continues_active_thread`；在 insufficient evidence 下其 Planner projection 成为 `unclear`，最终按 §14.4 defer 并生成错误回复“嗨，在呢。”。
- 修复只识别合并器自产、精确 evidence/confidence 的 adjacency fallback；只有有效、精确同 target、非 `continues_active_thread` 的模型候选存在时才淘汰该 fallback。
- 正向回归得到单一 reciprocal 并进入 `complete_reciprocal_contact/fulfill/optional_after_completion`；provider unavailable、低置信、错 target、缺 target、模型 continues-only、模型真实多候选歧义继续保留 fallback/`unclear` 并 defer。
- topic redirect、question greeting、direct answer、exact UTF-16 spans 与无文本特判反例通过；独立 Reviewer 首轮发现 targetless fail-open 后，修复与复验结论为 `PASS`。
- `check:interaction-move-handoff`、`check:interaction-move-handoff-planner`、`check:conversation-os-control`、TypeScript no-emit、focused ESLint、`git diff --check`：全部通过。
- 最终 `npm run check:launch`：exit 0；Prisma 12 migrations current、27 Miniapp JS files、39-page production build；并发 dev/build 引起的首次 `.next` 冲突在停止 3103 服务后消失，不属于运行时回归。

## PHM-A Candidate Specificity / Reciprocal Surface — Open Gate

- 真实持久失败：`你好` 的两个 Surface candidates 均被 strict Validator 以 `function_or_policy_not_satisfied` 拒绝，客户端显示 `GENERATION_NONCONFORMANT`。
- deterministic fallback reconciliation 专项与独立 Reviewer：PASS；Turn Interpretation Prompt calibration 真实 Qwen 7-case matrix：7/7 PASS。
- Planner action composition repair 专项：pure reciprocal `responseActions=[]`，preflight/authority、Surface-Validator、AI orchestration、TypeScript 与 focused ESLint 均 PASS。
- 最终真实无持久 `createChatReply`：Interpreter 单一 reciprocal、Planner `complete_reciprocal_contact/fulfill/optional_after_completion`、`responseActions=[]`；Surface 两次仍生成第二问候/availability open door，Validator 正确拒绝，execution phase `FAILED`。
- 同一用户可见完整链 gate 在允许的修复轮后仍失败；未运行完整 `check:launch`，未 Git seal，不得宣称已修复。

## PHM-C Reciprocal Surface Calibration — Failed Real Gate

- 用户授权后仅校准 `complete_reciprocal_contact` Surface Prompt；未修改 Interpreter、Planner tuple、Validator、parser、threshold 或 lifecycle state。
- repair pass 1：真实 simple-greeting Surface 从 presence 退化为 unsupported question，Validator 正确拒绝。
- repair pass 2：真实 simple case target=`嗨，又见面了。`、User=`嗨`、candidate=`嗨，又见面了。`；unchanged Validator 返回 pass，违反“second greeting-only must reject”的冻结合同。
- 同一 gate 的静态 repeated-greeting candidate `你好呀。` 被正确拒绝为 `interaction_move_handoff_semantic:function_or_policy_not_satisfied`，证明真实 Validator verdict 存在不一致 false positive。
- 所有离线/相邻门通过不能覆盖该真实 false positive；mixed-topic case 未继续处理。完整 `check:launch`、Git seal 与完成声明均中止。

## Chat Turn-scoped Execution Status

- 截图复现定位：session `cmsebsoi90006jbva9kbz29ok`；旧 turn `turn-f3140b82-9e18-43ce-ac9b-ea505d918a83`（`小时很多啊`）在新 turn 已提交后返回 `GENERATION_NONCONFORMANT`；新 turn `turn-81450ec8-eb43-4632-9117-f402b259842c` 随后成功提交 Assistant `cmsk64d9x0088jbvlre7jltrh`。
- 根因：客户端多个在途请求竞态写一个非 turn-scoped `executionStatus`；旧失败晚返回后，较新成功分支没有 authority 清除它。
- repair pass 1：把 session authority 移到 commit-phase `useLayoutEffect`，关闭 aborted render 提前废弃合法结果；共享纯 transition 覆盖 submit/result/retry/session switch。
- repair pass 2：12 条 Guest/Auth submit/retry failure/success/transport 分支全部绑定同一 authority-scoped completion writer；专项包含单独绕过 Guest failure resolver 的 mutation-sensitivity 反例。
- `check:chat-turn-result-authority`、`check:chat-execution-lifecycle`、TypeScript no-emit、聚焦 ESLint、`git diff --check`：全部通过。
- 独立 Reviewer 最终结论：`PASS`，无 severity finding；既有 `createClientTurnId` 与 `recentMessages.id` 改动保持。
- 3103 页面刷新验收：成功回复仍存在，旧 `这次回复没能生成，请重试。` banner 不再显示，输入与发送入口正常。

## Proactive Move Structured Contract — Open Gate

- 根因已关闭于共享 typed semantic object：预选 move → strict `ProactiveMoveIntentV1` → 冻结 Surface → 独立 bound semantic verdict → logical proactive envelope v2；`open_statement` 必须在同一可见 turn 交付 proposition。
- 新 proactive event 只写 v2 accepted intent；v1 仅 legacy read，malformed v2 不回退；Auth 使用现有 transaction/executionTrace，Guest round-trip structured envelope；未新增 Prisma 或持久 lifecycle state。
- prompt-injection Reviewer 修复：intent、candidate、history 与最近用户原文只位于 user-role `untrusted_data` JSON；developer-role 只保留规则。空白/纯标点 evidence span 均 fail closed。
- 专项、TypeScript、focused ESLint、assistant-grounding、architecture-v1、Conversation OS architecture 与 `git diff --check` 通过；独立 Reviewer 对代码级修复最终 `PASS`。
- 真实 Qwen gate 初始 403 根因是新门硬编码无权限 `qwen-plus`；对齐项目已授权 `qwen3.7-max` 后完成有限风险矩阵。命令式 request false accept 经一次 semantic move-fidelity 修复后，保持 fixture 不变得到 12/12 PASS。
- 五个旧 fixture 已迁移为显式 intent，deprecated v1 builder 写桥已移除；active handoff 以双判别 `Extract` 精确接受 proactive v1|v2，不扩大 response/safety 或改变运行检查。
- 独立 `xinqing_proactive_commit_test` 数据库应用现有 12 migrations；guarded 动态门通过 Auth/Guest parity、malformed/Validator failure 零提交、repair loser 单一 winner、Guest structured history 与末步 transaction rollback。清理后 fixture users/triggers/functions 均为 0。
- Lifecycle fixture 已从废弃 deterministic 模式迁移为本地 Qwen-compatible stub，不再误连外部模型；原 v2 commit/lifecycle 断言保持。
- 完整 `npm run check:launch` exit 0：12 migrations current、27 Miniapp JS files、39-page Next production build；既有 lint warning 1 条、prelaunch warning 2 条未新增且门通过。
- 独立 Reviewer 最终 `PASS`，无 P0-P2；original problem、regression、unnecessary changes 三项均满足。切片可封存。
- 生产构建服务已绑定 `0.0.0.0:3103`；`http://localhost:3103/chat` 与 `http://192.168.1.96:3103/chat` 均返回 HTTP 200。

## Safety Semantic Triage & Failure Transparency — Historical Open Gate（superseded）

- 已完成规范化高危快通道、strict Qwen semantic triage、代码所有的 `120/110/12356` 分类回复，以及 `PLAN_INVALID` / hard `GENERATION_NONCONFORMANT` 的不可手动重试说明。
- 本地 `check:chat-safety-semantic`、`check:ai-base`、`check:ai-orchestration`、`check:chat-execution-lifecycle`、`check:natural-chat-control`、Clinical/Helping/Safety-envelope/Conversation State 相邻门、TypeScript、focused ESLint 与 `git diff --check` 通过。
- 历史 `qwen3.7-max` 10/10：6 个当前风险/承接正确路由 Safety，4 个引用/过去安全/明确否定正确放行；全部首轮 strict JSON。该矩阵后来由 22-case closure gate 取代。
- real gate repair 1：模型选择从无权限硬编码 `qwen-plus` 改为 `AI_SAFETY_MODEL → AI_MAIN_MODEL → default`。
- real gate repair 2：模型只选择 exact evidence `{text}`，代码验证唯一原文并计算内部 UTF-16 位置，历史 10-case gate 通过。
- Independent Reviewer repair 1：关闭 production/development provider-unconfigured fail-open、已枚举媒体引用误判和 mixed self/other 漏 `110`。
- Independent Reviewer repair 2：把 `local_fixture_only` 收紧到显式 test/check runtime；普通 development 也 fail closed。
- 最终 Reviewer 仍 `FAIL`：`朋友刚对我说“我想自杀”`、`研究访谈对象说我想自杀` 未含已枚举媒体词，仍被 deterministic 快通道误认成用户本人 imminent。该问题证明自然语言主体/引用不能由继续扩张词表解决。

### Safety Subject-Ownership Closure（2026-08-24）

- 新授权切片把 deterministic bypass 收窄到无主体标记、整条消息为已实施行动的输入；所有意图表达进入 semantic triage。
- 原始输入在破坏性规范化前检查 Unicode 标点/符号。成对/不完整/竖排/装饰引号、括注、Markdown blockquote、行内代码和竖线均不能被清洗成 deterministic action。
- 本地 fixture 明确区分：第三方归属 → `none/quoted`；无归属危险引文 → `uncertain/current` 且 Safety；直接无标记行动 → deterministic。
- 真实 `qwen3.7-max` 22/22：当前危险、上下文承接、混合引用+当前危险、第三方转述、过去安全、否定及九类主体标记全部满足 strict schema 与路由合同。
- `check:chat-safety-semantic`、AI base、Natural Chat、Architecture v1、AI orchestration、TypeScript、`git diff --check` 通过；Independent Verifier 与 Safety/Privacy Reviewer 最终均 `PASS`。
- 无新 schema、migration、Memory/User Model、持久 lifecycle state、数据查询或敏感明文日志。

## Conversation Episode Memory Loop

- 新增 evidence-backed `EPISODE_SUMMARY` SemanticMemory kind；一个 ChatSession 对应稳定 projection，更新只追加 `SemanticMemoryVersion`，相同末条 committed message 幂等。
- strict Qwen `json_object` 小结区分 confirmed facts 与 hypotheses，并将每个 sourceMessageId 精确绑定到同会话 committed ChatMessage、RawMemory 与 Evidence。
- 当前回合按 people/topics/emotions、compact text overlap 与 recency 检索最多 3 个其他会话小结；唯一 Planner 可选择一条或 `null`，Surface 只接收选中 compact projection。
- 未新增固定用户话术、聊天质量 hard gate、持久 lifecycle state 或 Surface 自主检索；未确认因果只能作为 hypothesis/探索材料。
- Independent Reviewer repair pass 1：把未托管后台 Promise 改为 Next `after(async)` 请求生命周期任务；为并发 operationId 唯一键竞争增加事务外 winner recovery，并用 provider barrier + `Promise.all` 验证只发布一个 version。
- `check:conversation-episode-memory-loop`、`check:memory-v2`、`check:ai-base`、`check:ai-orchestration`、`check:conversation-os-control`、`check:architecture-v1`、TypeScript 与 `git diff --check`：通过。Independent Reviewer 最终结论：`PASS`。
- `check:conversation-os-architecture` 的既有 Safety direct-call 白名单失败与本切片无关；本切片未修改 Safety，未越界修复。

## Guest First-Contact User Topic Choice + Validator Authority（2026-08-24）

- 产品决策选择用户话题权：纯 reciprocal greeting 保持 `responseActions=[]`，不再注入 `take_light_topic_initiative`；完成 reciprocal contact 后可自然结束或只问一次低压力话题选择问题。
- Planner、Prompt、canonical semantic Validator、合同和直接 fixtures 已同步；“那我们就随意一点。今天想聊点什么？”进入允许路径，重复问候、在线/可用和双问题仍保留拒绝门。
- `natural-chat-control`、`interaction-move-handoff-surface-validator`、`planned-function-semantic-validator`、`conversation-os-relational-state`、Interaction Move Handoff、TypeScript 与 `git diff --check` 通过。
- Planner 专项仍在既有无关 fixture `reciprocates_move + unclear` 与实际仅 `unclear` 的差异处失败；Conversation OS Control 的 external-prompt rejection 既有断言也未触发。本切片未越界修复。
- 用户明确授权合成对话外发后运行真实 Qwen 门。诊断证据显示 strict negative `你好呀。` 的原始 semantic verdict 已是 `not_satisfied/requiredFunctionRealized=false`，但 canonical code 把 reciprocal failure 降为 advisory，错误形成 `passed=true`；因此否决增加第二模型调用的方案。
- Validator Authority 最小修复仅把 `complete_reciprocal_contact` 的 function failure 与 question-count failure 提升为 hard；`continue_from_user_answer` / `continue_user_introduced_content` 的既有 advisory 策略保持不变。未新增中文短语词表、regex、provider call、持久状态或数据访问。
- 完整真实 Qwen 门 exit 0：两个 source variant 均生成并通过 `嗨，今天想聊点什么？`；second greeting、presence、availability、mixed greeting/open-door、双问题全部 reject；显式 user topic choice PASS；committed claim 正反例保持；混合面包话题继续当前内容 PASS。
- 本地 preservation 新增并通过：`continue_from_user_answer` 与 `continue_user_introduced_content` 的 `not_satisfied` 仍是 exact advisory、`passed=true`；reciprocal hardening 未扩大到这两个分支。
- 相邻 41-case real planned-function gate 本轮有 4 个非本切片类别波动：first-contact/repair malformed、emotional-pause false accept、dual evidence mismatch；本切片专用完整 real Surface/Validator 门已通过，未越界修复这些独立模型稳定性问题。Chat execution lifecycle 相邻门因本地 PostgreSQL `localhost:5432` 不可达而未完成；AI orchestration、handoff、relational state、TypeScript 与 diff gate 通过。
- Independent Verifier 最终 PASS：确认 reciprocal function/question-count hard 边界精确、两个 continuation advisory preservation fixtures 完整、任务分析/合同/台账一致，且无第二 provider call、中文词表、regex、Planner/Safety/Memory/persistence/client 扩张。切片封存。

## Planned Function 41-case Real-Qwen Stability — Historical STOP（2026-08-24）

- 初始完整门 4 个失败：first-contact/repair 缺 `schemaVersion`、dual evidence span 错位、emotional pause 一次 false accept；逐案复现时 emotional pause 正确拒绝，确认模型波动。
- repair 1：default provider 对 strict malformed 仅做一次同输入格式修复；第二次仍异常保持 fail closed。完整门降至唯一 `dual-both-satisfied` evidence mismatch。
- repair 2：模型仍选择 exact evidence text，但 UTF-16 index 偶发偏移；代码仅在 evidence text 于 candidate 中存在且唯一时计算 start/end，重复/不存在继续 fail closed。专项、TypeScript、diff gate 与 dual 正例复验通过。
- 最终 41-case 门仍 40/41：`dual-positive-only` 候选在完成 identity/entry 后追加第二问候，Qwen 输出 handoff/positive 均 `satisfied`、`containsContradictoryMove=false`，错误接受。两次 repair 已用尽，未继续加提示词、词表或第三候选。

## Late-Contradiction Authority v1 — Sealed（2026-08-24）

- 该切片是上一门 STOP 后的新独立权威，不是第三轮 canonical Prompt/case 补丁。它只检查候选有序 Surface acts：首次接触 ritual 已完成后，若更晚独立行为再次执行同一 ritual，则拒绝。
- 可审计身份：version `late_contradiction_v1`；definition SHA-256 `bb2dde3217e3b7b32f4d6197cead9284614df6434698965cb6b993d53694b3c1`。strict schema 精确绑定 case、plan、candidate hash、authority version/hash；完成与重开 evidence 必须是唯一 exact UTF-16 slice、同一 ritual、互不重叠且完成在前。malformed、uncertain、错绑、错 evidence、provider failure 全部 fail closed。
- 接入范围仅为 eval scripts：只有 canonical dual-positive PASS 才执行该门，最终结果取 AND；canonical reject 不可能被翻正。未修改生产默认路径、Safety、binding、schema、持久化或真实用户流量，也未新增中文问候词表。
- `dual-positive-only` 专项复验返回 `late_contradiction`：completion evidence `我是小慢。`，contradiction evidence `你好呀！`，顺序与 binding 均通过本地复核；合法 `dual-both-satisfied` 返回 `clear`。
- 完整 `qwen3.7-max` 41-case 门 exit 0，`failures=[]`：first_contact 8、identity_continuation 7、emotional_support 12、repair 8、dual_and 3、adversarial 3。
- 本地 `late-contradiction-authority-check`、`planned-function-semantic-validator-check`、`interaction-move-handoff-surface-validator-check`、TypeScript no-emit 与 `git diff --check` 全部 exit 0。
- Independent Verifier 确认实现与测试 PASS：仅 eval scripts 接入、canonical reject 不可翻正、strict binding/evidence/order/fail-closed 成立、41 fixtures/expectations 未改、无中文问候词表或 caseId 特判、无生产默认路径变化。复核提出的唯一台账阻断已由本节与 Active/Remaining 同步收口，切片封存。

## Hill Helping Deterministic Fast-Boundary Preservation Re-freeze（2026-08-24）

- 产品裁决：deterministic fast boundary 已完成当前回合判断时 provider calls 必须为 0；只有未被 fast boundary 完成且仍要求 Helping 的回合才 exact 1 call。禁止修改 runtime 或放宽 Hard/Advisory、Safety、Planned Function、Natural Chat。
- 审计身份：version `hill_helping_fast_boundary_preservation_v1`；canonical definition SHA-256 `179982abcdfe97480f763b9754397798d4217e9fe1260468197c7dc171532691`，专项运行时重算 hash。
- 专项 PASS：20 个 contextless 短输入 fast `uncertain`、0 provider；相同 20 个输入在 established Helping frame 中逐案 exact 1 provider；ordinary identity fast `not_applicable` 0 provider；Safety 0 provider；invalid input/output/provider/timeout 保持 fail closed。
- Shadow on/off 的 ResponsePlan、DialogueState、formal StateUpdate、Surface Prompt 和 visible reply 相等；Helping 仍只有 orchestration 单一调用点且位于 Safety 后、Planner 前。
- AI orchestration、Safety semantic、Planned Function semantic、handoff Surface、Natural Chat、TypeScript no-emit、`git diff --check` 全部 PASS。完整 launch 通过本 Batch 1 后，在来源树同样失败的 Batch 1.5 既有漂移处停止；未越界修复。
- Independent Verifier 最终 PASS：20 个 fast/non-fast paired inputs 逐案 0/1 调用、Safety/ordinary fast 0、Shadow 等价、唯一调用点与顺序、合同/hash 重算以及 `services/helping/` runtime 零差异全部确认；切片封存。

## P0 Current Baseline Local Closure（2026-08-25）

- 候选树：`/private/tmp/xinqing-p0-current-baseline-20260824`，parent `890a030`。来源脏树未 reset/checkout/stash/clean。
- 首个 Batch 1.5 阻断是 test fixture 在 `AI_PROVIDER=mock` 时缺少显式 no-risk Safety provider；修复仅注入 strict fixture，自伤用例继续由 deterministic Safety 接管且 Helping 0 call。
- broad advisory 未进入候选 winner authority：旧 quality-only replies、double failure 与 retry transitions 均按 hard preservation；`complete_reciprocal_contact` 不伪造成 advisory edge，两个 continuation functions 仍保留 advisory omission。
- 架构白名单显式约束 Safety Semantic 与 Episode Summary 各自唯一 structured model call、非 Planner/Surface 身份；没有简单放宽任意调用。
- 本地 PostgreSQL 16 临时集群、合成库和 13 个现有 migration 成功；`chat-execution-lifecycle`、`conversation-episode-memory-loop`、Memory V2 与 Prisma gates PASS。
- 完整发布链各组成门、TypeScript、diff、focused ESLint 与 Next production build PASS；lint 仅有既有 `createStubProjection` unused warning，无 error。
- 未运行新的真实 Qwen 文本外发，未 stage/commit/push/merge/deploy，未访问生产数据或真用户流量。
- 随后按既有合成文本授权完成真实外门：Planned Function `qwen3.7-max` 41/41、Safety 22/22、Handoff Turn Interpretation 10/10、Handoff Surface、Proactive Move 均 exit 0。Handoff structured-output 首轮 `mixed_pressure` 返回 strict `binding_mismatch` 并 fail closed；未改任何合同后相同冻结门复验 exit 0。
- Independent Reviewer 最终本地/范围结论 PASS：candidate 不含 excluded Purpose、tooling、LAN env、Helping runtime 或治理目录；四项 fixture compatibility 精确；Hard/Advisory 未放宽；architecture allowlist 为逐文件、逐调用点约束。唯一剩余是明确授权后的精确 stage/commit，并排除未跟踪 `node_modules`。

## Episode Memory Retrieval Structural Stability（2026-08-25）

- 隔离候选基于 P0 commit `aadc62d`；最终提交 `ed0cc19`，仅改 `services/memory/episodeSummaryService.ts` 与 `scripts/conversation-episode-memory-loop-check.ts`，未跟踪 `node_modules` 未纳入。
- 根因是 Episode topic snapshot 与当前 extraction 使用 exact equality，复合标签 `工作压力` 无法被 `工作` 稳定召回。修复只给 topics 增加长度至少 2 的对称结构包含；people/emotions 保持 exact，未增加中文同义词或情绪词表。
- 回归覆盖 `工作` ↔ `工作压力` 双向命中、`电影` 无关为空、单字 `工` 不得模糊命中；既有专项继续覆盖同用户限定、排除当前会话、最多 3 条、Planner 0/1 selection 与 hypothesis 独立类型。
- Episode loop、Memory V2、AI orchestration、Conversation OS architecture、TypeScript、focused ESLint 与 `git diff --check` PASS。修复后静态门再次 PASS。
- Independent Verifier 与 Safety/Privacy Reviewer 均 PASS：无 schema/migration、新持久写入、生产数据读取、原文副本、跨用户泄漏或 hypothesis/因果升级。

## Historical `小时很多啊` Server Semantic Audit（2026-08-25）

- 仓库只保留 User 文本、最终 `GENERATION_NONCONFORMANT` 与 `continue_user_introduced_content` plan 类别；source Assistant、完整 recent context、两条 Surface candidate 与逐候选 failure reasons 均缺失，不能伪造 exact replay。
- 当前 sealed runtime 已将 `continue_user_introduced_content` 的 handoff function 不足分类为 advisory；visible winner 可提交但 immutable envelope 必须 `handoff=null`，其他 hard failure 仍阻止提交。
- 现有真实 Qwen 同类正例 `嗨，我最近在学做面包` 已证明具体 user-introduced content 可被 Surface 延续并通过。历史记录不足以证明当前仍有 false reject。
- 结论：不修改 Prompt、Planner 或 Validator；该历史事项关闭为“旧 hard-policy 下合理 fail-closed，现行 advisory/no-edge 已改变结果”。新的完整脱敏 trace 若再次失败，另开独立切片。

## Conversation Purpose V1 Stage 2A — Historical STOP（2026-08-25）

- Stage 1 经独立审计确认已由 Proactive Structured 与 Guest First-Contact seals 实质完成；旧分析中“首次 intent 不完整/回礼重复身份”仅保留为历史 provenance。
- Stage 2A WIP 建立 required-nullable `ordinaryPosture`、Interpreter 非权威 proposal、Planner 唯一 acceptance/default-accompany/null authority、current/adjacent saved User exact spans、canonical provenance 与 preflight tamper checks；无持久化、Prompt/Surface 或 planned-function Validator 变化。
- repair 1 关闭 strict whole-proposal reject、canonical provenance exact compare 与 saved-only adjacent source；同时暴露所有 unbound reason question 被误当 self-why。
- repair 2 增加 subject ownership 并保留天气/接口 external why 的 direct obligation，但最终独立反例证明 authority 依赖紧邻词序：`为什么我总会这样？`、`我总是这样，为什么？`、`我的情绪为什么总反复？` 仍误归 external，违反 self-why 类别合同。
- relational、natural、control、architecture、planned-function deterministic、TypeScript、focused ESLint 与 diff gate PASS；lifecycle 在有隔离本地 DB 的实现轮 PASS。最终 Reviewer `FAIL`，两轮 repair 用尽，未继续加中文 case/词序补丁或扩大真实文本外发。
- 17-file implementation 保留为未封存 WIP，不 stage/commit；下一步需要新主体归属语义权威的产品/架构裁决。

## Hot/Cold P0 + Composer Shadow P1 Local WIP — Historical STOP（2026-08-25）

- 5 个新增 local/eval-only 文件实现 14 类合成 replay、strict schema/binding、递归冻结/hash、top-level incremental reply decoder、最多两调用、failure isolation、hash/count observation 与 synthetic-only Qwen CLI；无 production import、DB/Memory/ChatMessage writer 或真实外发。
- Safety review repair 关闭执行入口 eligibility：Safety-owned 在 provider 前 `not_invoked` 且 calls=0，observation 拒绝 safety+shadow。随后 repair 2 关闭 invalid/context overflow explicit not-invoked 和 metadata 伪 `reply` timing。
- 最终独立 Reviewer 仍 `FAIL`：assistant Grounding 与 purpose version 可由请求反向决定；Safety 在完整 baseline binding 前返回；V1 calls/attempts/candidates/timing 等 observation 字段仍是 null/false 占位而非真实 snapshot；机器摘要仍以 `isolationBoundaries:7` 淹没 5 pass/2 pending。
- Composer 专项、TypeScript、focused ESLint 与 diff gate PASS 不能覆盖上述 traceability 缺口。两轮 repair 用尽，5 文件保留为未封存 WIP，不接 package/production、不运行真实 Qwen。
- 3 自然日时间门保持明确 pending：至少 200 个 successful first-attempt Hot observations、每天至少 50、同一 runConfigHash、覆盖 short/medium/near-bound；随后 bootstrap p95 95% CI，half-width <= p95 的 15%，否则扩至 400。单日合成结果不得替代。

## Purpose Subject-Ownership Authority V1 — Sealed（2026-08-25）

- 用户批准 STOP 后的新独立 authority，不是 Stage 2A 第三轮词序补丁。仅 eligible、无 committed-claim target 的 `reason_or_contradiction` 可触发一次 strict structured ownership；生产默认无 provider，未授权真实用户文本不会外发。
- 唯一 strict-valid `current_user_self` 才清除 direct obligation 并形成 Planner-owned explore proposal；`external_or_other`、`uncertain`、provider/format/binding/evidence failure 均保留 direct obligation、`ordinaryPosture=null`。Safety、pause、repair、bound claim 与 non-reason exact 0 call。
- Repair 1 将 evidence 收窄为恰好一个、完整等于 echoed question 的 UTF-16 span；不增加模型 repair、中文词表或 case 特判。合同 SHA-256 `36b6ecc428bfc51b1c031e2779655f015a8068fd77301713cc2640e39125e749`。
- 固定 9 类合成真实 Qwen 门最终 9/9：五类 self 自由语序均 `current_user_self`，天气/接口/第三人称均 `external_or_other`，省略主体为 `uncertain`。首次真实门唯一 self-reaction 因模型子串 offset 错位 fail closed；结构修复后整门 PASS。
- 本地专项、Relational、Natural Chat、Conversation OS Control/Architecture、AI orchestration、Lifecycle（隔离 PG）、TypeScript、focused ESLint 与 diff gate PASS；Independent Reviewer 最终 PASS。
- 隔离候选提交 `05f8329`（基于 P0 `aadc62d` + Episode `ed0cc19`）；未 push/merge/deploy，Composer WIP 与 node_modules 未纳入。

## Frozen V1 Observation Snapshot Authority V1 — Final STOP（2026-08-25）

- 用户批准的新 local/eval-only authority 已实现为 7-file WIP：绑定 authoritative 14-case baseline/set hash、仓库 Grounding v3（小慢/AI聊天助手）、完整 Purpose digest、fixture-owned V1 metrics 与逐项 isolation evidence；Safety 先完整绑定再 ineligible/provider 0。
- Repair 1 关闭 recomputed-hash set/extra-key forgery、错误 Grounding、Purpose 自称摘要、placeholder hash 与小数 count；Repair 2 增加 execution 每字段 primitive/enum/64-hex/integer 校验。
- Snapshot 专项、Composer 14-case、full TypeScript、focused ESLint 与 diff gate PASS；production imports/writers exact 0；isolation 诚实报告 5 pass + 2 pending。
- 最终 Independent Reviewer 仍 `FAIL`：FAILED execution 可携带非 null `committedEdge`，违反 frozen FAILED winner/edge-null invariant。Reviewer 另建议 failureCategory enum，但原冻结 schema 为 `string|null`，不作为本门新增要求；committed edge 反例本身足以阻止封存。
- 两轮 repair 用尽，不继续第三轮修复。7-file WIP 未 stage/commit、不运行 Composer Qwen、不接 production；需要新 publication-outcome invariant authority/裁决后才能继续。
- 三自然日/200 Hot 时间门继续 pending，且 production background isolation 与 low-privilege telemetry 仍分别 pending。

## V1 Execution Outcome Integrity Authority V1 — Sealed（2026-08-25）

- 用户批准旧 Snapshot STOP 后的新独立 authority，不是第三轮 Snapshot 修补。Authority 冻结 definition/version/hash、exact schema、input/result hash 与递归冻结输出；Snapshot 只能消费 strict-valid authority outcome，不补默认。
- `COMMITTED` 强制有效 winner hash、`failureCategory=null`、`retryable=false`；`FAILED` 强制 winner/committed edge 均为 null。Episode hash 在未证明更窄边界前允许 hash/null。
- 两轮 repair 依次关闭开放式大写 failure code 与遗漏合法 `TIMEOUT`：最终冻结枚举与现有 P0 六类完全一致（SAFETY_BLOCKED、PLAN_INVALID、GENERATION_NONCONFORMANT、PROVIDER_ERROR、TIMEOUT、PERSISTENCE_ERROR），未登记大写类别稳定拒绝。
- Outcome 专项、Snapshot 专项、Composer 14-case、full TypeScript、focused ESLint 与 diff gate PASS；Independent Reviewer 最终 PASS。无 Qwen、production import/write、DB/Memory/event/session 扩张。
- 隔离候选提交 `d6741d4`，精确纳入 9 个 local/eval-only 文件并排除 `node_modules`；未 push/merge/deploy。Isolation 保持 5 pass + 2 pending；三自然日/200 Hot 时间门仍 pending。

## Composer Observation Ledger Authority V1 — Sealed（2026-08-25）

- 新 local/eval-only Authority 只消费 hash/count observations；绑定 authoritative 14-case sample-set digest、完整有序 entries 与单一 runConfigHash。Authority result 携带可逐条重算的完整 entries，重算式 entries/source-audit/ledger forgery 均 fail closed。
- Ordinary 12 cases 仅证明三个 slot 的机制完整，真实模型 behavior 仍为 pending；Safety 两例强制 not-invoked/provider 0，全部 output/ref/timing 为 null/0/false。
- Event local isolation 直接读取冻结 Composer owner 文件并绑定预冻结 content/aggregate hash，拒绝 caller content；真实 SIGTERM child 证明终止后无 ledger append。自由字符串收紧为机械 ID、权威 enum、冻结字面或 SHA-256，email/英文原句/base64 注入稳定拒绝。
- Blind artifact 只保留 hash/机械绑定；schema/randomization/redaction 机制 PASS，human ratings 继续 pending。三自然日/200 Hot、Context bands、bootstrap、production background 与 P1 Exit 均未被 mock 翻成 PASS。
- Ledger 38 observations/14 cases、Composer14、Outcome、Snapshot、full TypeScript、focused ESLint 与 diff gate PASS；功能与 Safety/Privacy 双重 Independent Review 最终 PASS。隔离提交 `f6268ab`；`node_modules` 排除，未 Qwen/DB/production write、未 push/merge/deploy。

## Composer P1 Exit Evidence Evaluator V1 — Sealed（2026-08-25）

- 新 local/eval-only deterministic evaluator 只消费 strict Ledger，并按冻结 §9 显式输出九门状态。Caller 在运行时塞入 human/latency/behavior claims 不参与结果，无法升级任何 gate。
- 当前 coverage、traceability、Safety ineligible + Episode hit/empty authoritative coverage 可由 Ledger 证明；all-seven isolation、V1/Shadow writer/result/winner/edge/write-set equality、真实 behavior、human、latency 与 budget 均保持 pending，overall 固定 pending。
- 三跑、blind 与 bootstrap 保留为 mechanism-only API，明确 `mechanismPassed` 与 `evidencePassed=false`；合成评分、36 个 attempt hash、200×600ms/伪日期不能进入 exit authority result。
- Evaluator、Ledger、Composer14、Outcome、Snapshot、full TypeScript、focused ESLint 与 diff gate PASS；功能及 Safety/Privacy 双重 Independent Review PASS。隔离提交 `e42d1da`；无 Qwen/DB/network/production import/write，未 push/merge/deploy。

## P2 Assistant Publication Winner Skeleton — Sealed（2026-08-25）

- 新 `AssistantPublication` local/database skeleton 拥有且仅有 reserved/streaming/committed/failed_retryable/failed_terminal 五态；`unique(sessionId,clientTurnId)`、User/Session复合tenant FK、User/committed Message唯一链接及现有 replyToMessageId 共同约束单winner。
- 所有服务入口绑定auth-derived `(userId,sessionId)`；跨用户/会话统一 `publication_not_found`。Lease owner/attempt/expiry、draftVersion/hash 与最多6轮CAS重试形成有界fencing；并发reserve/commit、takeover、append幂等、事务回滚及response-loss replay PASS。
- DB failure code为六值enum。删除任一linked ChatMessage时，授权48217下的local trigger原子清draft/final、置contentDeletedAt并撤lease，保留content-free identity；replay deleted无body、mutation fail closed、同turn不再生成。User/Session删除cascade publication。
- 全新隔离PostgreSQL从空库应用14 migrations、P2并发/tenant/tombstone专项与migrate status PASS；Prisma validate、TypeScript、focused ESLint、diff gate及功能/Safety双重Independent Review PASS。隔离提交 `ee5ed04`；数据库已关闭，未Qwen/production route/write、未push/merge/deploy。

## P3 Safety Trunk + HardFacts Surface Authority — Sealed（2026-08-25）

- default-off/local-only trunk 在 input Safety 之前不调用 Composer；Safety-owned output 仍逐完整 segment 与 final whole reply经过 Output Guard，raw provider token 不可见，只有双权威通过的完整 segment 可进入 provisional。
- HardFacts 只从仓库 canonical `ASSISTANT_GROUNDING` 投影“小慢 / AI聊天助手”，caller 无事实覆盖入口；独立 semantic authority 在 append 前检查正文而非相信 self-reported claims，Memory prompt injection 与正文身份冲突稳定阻断。
- repair 1 收紧 evidence：`consistent/contradiction/uncertain` 至少一条、`not_applicable` 零条；UTF-16 span 必须正向、范围内、有序不重叠，hash 从对应正文 slice 重算。反向、零长、越界、重复、乱序和 decision/evidence mismatch 全部 fail closed。
- 只有 commit 阶段持久化故障标记 `PERSISTENCE_ERROR + failed_retryable`；第二次运行复用同一 publication identity 成功。Safety、生成与 semantic failure 保持 terminal。
- HardFacts、P3 trunk、Chat Safety、AI orchestration、TypeScript、focused ESLint 与 diff gate PASS；功能及 Safety/Privacy 双重 Independent Review PASS。隔离提交 `bb1852d`；无 Qwen/DB/production import/write、未 push/merge/deploy。

## P4 Minimum Memory — Final STOP（2026-08-25）

- preaudit descriptor `p4-preaudit-gold-v1` SHA-256 `6794e129a9626266b749e5548a523164af0f9cc2afa035e9933ada478bb82b36`，覆盖 18 promotion、5 retrieval、6 context 及 profile schema；本地算法、全新隔离 PostgreSQL 15 migrations、Memory V2、Prisma、TypeScript、ESLint 与 diff gate 均曾 PASS。
- repair 1 关闭 caller content 与 evidence slice 偏离；repair 2 改为 DB-owned source/retrieval、cache invalidation、trusted recent sequence，并机械复算预审 hash。
- 最终双重复核仍 FAIL：公开 eligibility artifact 注册入口允许普通 caller 自签 `ELIGIBLE/ALLOWLISTED` 与有利分类；敏感 opt-in 只证明任意 span 存在而非明确存储同意；Evidence→RawMemory tenant/status、读取侧 memory/artifact/cache payload 完整性与 deterministic event tie-break 不完整。
- 功能门同时发现实际 assertion 未与 29 descriptor ID 做机械集合绑定、错类 FP+FN 指标缺失、五查询 Recall@3 口径未实现。两轮 repair 用尽，候选保留未提交，不做 repair3。
- 唯一推荐裁决：新增普通 runtime caller 无法自签的 Eligibility/Consent Authority，并让 retrieval/profile read 逐项重验 tenant、current version、source visibility、artifact/payload commitment。

## P5 Deletion Cascade Authority — Direct Authorization Blocked（2026-08-25）

- preaudit `p5-preaudit-gold-v1` 共 41 ID，SHA-256 `2b77052f5272d59f62ae4cb676a72bff5f788f69660f543913d2795b27dd5e6a`，冻结 tenant/source authorization、即时 visibility/P2 plaintext 清除、immutable source edges、60s/24h fake-clock、CAS/lease/crash、无明文 audit 与 pending/forbidden 边界。
- 独立 worktree 基于 `bb1852d` 且保持 clean。首次 schema patch 被执行安全门拒绝：需要用户直接批准 local PG 中的 deletion request/source edge/outbox/audit、ChatMessage tombstone/cascade 以及删除合成 ChatMessage 的故障矩阵；父任务转述未被视为可信高影响授权。
- 未产生半成品，未启动数据库，未修改生产 route/scheduler 或任何真实数据。

## P6 Relationship/Growth Cache-only — Final STOP（2026-08-25）

- preaudit `p6-preaudit-gold-v1` 47 ID，SHA-256 `9b3a15b4de5c5f59a3a9f9ca99a45f622acff3ea4c2386d56ee116a100fcf75c`。local/fresh-PG 15 migrations、47 set、Memory V2、Prisma、TypeScript、zero-warning ESLint 与 diff gate PASS；P4/P5/production integration 始终 pending。
- repair 1 增加 current UTC cycle 与 payload exact keys；repair 2 将 cache item 与 accepted-current snapshot 逐项绑定，封住 secret/text/version/add/drop/reorder/hypothesis-to-fact/cross-projection 篡改，并以 WeakSet principal 与固定 fixture catalog 限制 local harness。
- 最终 Safety/Privacy 复核仍 FAIL：公开 `createP6LocalFixturePrincipal(tenant-a|tenant-b)` 可由任意 caller mint，且以非唯一 nickname `findFirst` 解析 tenant；cache reader 未证明 `generatedAt <= now` 与 `staleAt == generatedAt + frozen TTL`，协调篡改可延长过期数据可见期。
- 两轮 repair 用尽，候选保留未提交，不做 repair3。唯一推荐裁决：auth-derived、普通 caller 无法 mint 的 principal authority，并将 TTL 时间字段纳入不可篡改 commitment。

## Composer Shadow External/Calendar Gate — Pending（2026-08-25）

- local/eval Snapshot、Outcome、Ledger 与 P1 Exit Evaluator 已封存；当前 evaluator overall 正确保持 pending，合成评分、伪日期、mock 200×latency 不能升级真实门。
- 当前运行环境未配置 `QWEN_API_KEY`、`DASHSCOPE_API_KEY` 或区域 Base URL，因此已授权的 12 ordinary × 3 real-Qwen behavior、第一天 Hot sampling 与模型 latency/tokens 尚未启动。
- 时间合同仍为至少 200 个 successful first-attempt Hot observations、跨三个不同自然日、每天至少 50、同一 runConfigHash、覆盖 short/medium/near-bound；随后按冻结 seed/method bootstrap p95 95% CI。该门按定义不能在单夜真实完成，未伪造日期或观测。

## P4 Eligibility & Read Integrity Authority V1 — Final STOP（2026-08-25）

- 用户直接授权后的新独立切片，冻结 41-case descriptor SHA-256 `a84734324a4ff7f64f79b854a0fabf6f800ee35213ef66e3db7228f7930f76f9`；窄门、TypeScript、focused ESLint、diff-check 与 fresh migration 均 PASS。
- repair 1 处理 canonical JSONB artifact hash，repair 2 处理 compound selector/shared Prisma compatibility；最终 fresh PG 在合法 Profile projection 后读取仍返回 null，`Q1:valid_item_commitment:ready` 不成立。
- 两轮 repair 用尽，按合同 STOP，无 repair3、未提交、未接生产/Qwen/真实数据。唯一架构决定是另开 Profile Read Commitment Authority，而不是继续修改本门。
- 后续独立 `P4 Profile Cache Commitment Authority V1` 已在实现前完成只读 preaudit：canonical descriptor SHA-256 `c5ce3b2740a39871f43985f006cee72c946b172e7b4fc5e64558f819755ccdaa`，覆盖合法/空投影、item/source/envelope/commitment 篡改、缺失缓存、生产 pending 与 Qwen 0。该合同尚未获得直接实现授权，不得视为第三轮 repair 或完成证据。

## P5 Deletion Cascade Authority V1 — Sealed（2026-08-25）

- 冻结 `p5-preaudit-gold-v1` 41 ID，SHA-256 `2b77052f5272d59f62ae4cb676a72bff5f788f69660f543913d2795b27dd5e6a`；fresh PostgreSQL 应用 15 migrations、41 assertions 全部 PASS。
- 有效 Session 派生 tenant；ChatMessage tombstone 与 AssistantPublication draft/final/lease 在 DB 层不可复活；SourceEdge 与 request/source/session/tenant 精确复合绑定且首次绑定后不可解绑。
- CAS/lease、崩溃恢复、重复投递、60 秒/24 小时 exact 与 +1ms、content-free audit 均有实质反例；功能与 Safety/Privacy 双重 Independent Review PASS。
- 独立提交 `3e1844c`；未 push/merge/deploy。物理删除、法律保留、生产 route/scheduler/SLA 与真实用户数据继续 pending/forbidden。

## P6 Principal & Cache Time Integrity Authority V1 — Sealed（2026-08-25）

- 原 47-ID SHA `9b3a15b4de5c5f59a3a9f9ca99a45f622acff3ea4c2386d56ee116a100fcf75c`、新 14-ID SHA `22926f8792dd8d59a8eb6d7d8ab0128789aa53a8603fca2a0338da4f6c839169`、repair 5-ID SHA `dfc34c18069a749f6591c64342f6b678948c68d28e70628314c835f690194236` 均 exact-set PASS。
- 身份只由 Session id/token hash 与 module-private trusted clock 派生，调用方回拨评估时间不能复活过期 Session；cache 时间、TTL、source/item commitments 由 module-private process-local HMAC 约束，协调 DB/payload 篡改 fail-empty。
- fresh PostgreSQL 15 migrations、Memory V2、本地门、TypeScript、zero-warning ESLint、diff-check 及功能/Safety 双重复核 PASS。独立提交 `d7dd07b`；未 push/merge/deploy。
- process restart/multi-instance 会让旧 local cache fail-empty，符合 default-off 安全边界；生产密钥生命周期、多实例共享、P4/P5 runtime 接线继续 pending。

## Composer Real-Qwen 12×3 Runner Mechanism — Sealed（2026-08-25）

- authoritative 14-case baseline 中 exact 12 ordinary cases，每案 3 个独立 outer attempts，共 36 唯一 attempt hashes 与一个 `runConfigHash`；结构 repair 只能发生在单个 attempt 内，不替代三跑。
- mock 模式必须显式 `--check-mechanism`，永久输出 `mechanism_only_not_evidence`；真实模式必须显式 `--allow-synthetic-qwen`、key、区域 Base URL 与 `COMPOSER_SHADOW_SYNTHETIC_ONLY=true`，且结果仅为 `candidate_requires_ledger_authority_validation`。
- stdout 无 candidate/reply 明文、key 或 Base URL，仅保留冻结 synthetic case ID、版本/低基数状态、hash/count/timing/token 以满足逐 case 可追溯性；无 DB、production 或真实数据路径。
- mock 12/36、Composer14、功能与 Safety 双重 Independent Review PASS。隔离 clean worktree 重生成匹配 Prisma client 后，全量 TypeScript、zero-warning ESLint 与 diff-check PASS。提交 `e9f6740`；未运行真实 Qwen、未 push/merge/deploy。

## Composer Real-Qwen 12×3 — Real Gate FAIL / Prompt Contract STOP（2026-08-25）

- 项目 `.env` 实际已配置 Qwen key 与区域 Base URL；此前仅检查未加载 `.env` 的 shell 并误报未配置，该判断已更正。Runner 使用显式 `--env-file`、synthetic-only flag 运行。
- 真实门完成 12 ordinary × 3 independent attempts / 36 observations，single runConfigHash `sha256:895f4ef2007a02e2e1f7e7618a30ffcf2cd964b66769476749c4ea64d2c0d62c`。结果 36/36 `malformed`，每次均调用 2 次且使用一次 repair，成功 0、output hash 全 null；没有用 repair 冒充独立三跑。
- 单次脱敏 shape diagnostic：HTTP 200、content string、JSON parse PASS；Qwen 返回顶层 keys `assistantText, caseId, conversationIdHash, purposeContractVersion, sampleSetVersion, schemaVersion, shadowRunId, turnId`，strict parser 正确给出 `schema/non_exact_keys`。未记录候选正文、key 或 Base URL。
- 第一因果边界是 runner Prompt 未提供冻结的 7-field output schema、purpose enum 与 refs/null rules；repair 同样只回传低信息 failure code，没有提供目标 schema。Strict parser 与 binding 不应放宽。
- 当前门 STOP：36 observations 的一次 repair 已用尽，不允许直接堆第三轮 Prompt。下一步必须是独立、versioned/hash-bound Composer Output Schema Prompt Authority，并先过 1-case shape gate，再重跑完整 12×3。

## P4 Minimum Memory Authorities — Sealed（2026-08-25）

- Eligibility & Read Integrity descriptor SHA `a84734324a4ff7f64f79b854a0fabf6f800ee35213ef66e3db7228f7930f76f9` 的旧 41 ID 保持 exact-set PASS。
- 新 Profile Cache Commitment descriptor SHA `c5ce3b2740a39871f43985f006cee72c946b172e7b4fc5e64558f819755ccdaa` 共 27 ID：合法/合法空投影、item/source/envelope/commitment 篡改、缺失缓存、生产 pending 与 Qwen 0 均为实质断言。
- Projector 使用 module-private random-key canonical HMAC 同时绑定每个 item 与完整 profile envelope；reader 独立重算并实时重验 tenant、current/visible source、artifact、content、category、sensitivity、vector、expiry 与 consent refs。公开 SHA 重签、JSONB 重排、extra/missing keys 与协调篡改均 fail-empty。
- Fresh isolated PostgreSQL 应用全部迁移 SQL（`ON_ERROR_STOP`）、旧41与新27 PASS；TypeScript、zero-warning ESLint、diff-check、功能及 Safety/Privacy 双重 Independent Review PASS。两轮 repair 分别关闭 Prisma JSON 类型和 JSONB 对象键序误判。
- 完整候选按用户明确授权封存于 `249be49`；未 push/merge/deploy、无 Qwen/生产/真实数据。进程重启使旧 local cache fail-empty，生产密钥生命周期与 runtime 接线继续 pending。
