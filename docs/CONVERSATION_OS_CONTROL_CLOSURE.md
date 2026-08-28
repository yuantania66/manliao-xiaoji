# Conversation OS 控制权收口与自然会话闭环

状态：代码迁移、本地结构回归与三轮改造后真实 Qwen A/B 对照均已完成。

## 1. 改造前真实基线

基线通过生产入口 `createChatReply`、项目配置的
`qwen:qwen3.7-max` 和合成对话运行。发送前预检排除了凭据、真实用户
数据、数据库、Memory、无关代码和日志。完整原始输出与 trace 位于：

- `docs/evals/conversation-os-control-baseline-pre.json`
- `docs/evals/conversation-os-control-baseline-pre.md`

### 场景 A

| 阶段 | 真实结果 |
|---|---|
| 上一轮 | `夜深了，有什么想慢慢说的都可以留在这里。` |
| 用户 | `我想不到说什么耶` |
| semantic evidence | `sufficient/current_user_message` |
| interaction | `no_topic / engaged / assistant_invited / neutral_or_light / stop=false` |
| Clinical | `help_continue_expression / initiate_topic / open_gentle_invitation` |
| 旧 Conversation OS | `acknowledge`，并要求“不急着推进” |
| raw LLM | `没关系，那我们就先这样待着。` |
| final | 与 raw 相同，`finalReplySource=llm` |

最早错误不是 `semanticEvidence` 或新 interaction 字段；它们已经正确。
错误发生在生成前：旧 Conversation OS 策略和 ClinicalPlan 同时作为行为
指令进入 Prompt，旧 `acknowledge/不推进` 覆盖了 Clinical 的
`initiate_topic`。LLM 忠实实现了冲突中更保守的一侧。

### 场景 B

| 用户轮 | 改造前结构决策 | raw / final |
|---|---|---|
| `你会坐吗` | semantic sufficient；Clinical `reflect`；旧 OS `acknowledge`；无 direct obligation / grounding | `我不太确定你问的是哪种坐，但如果你想找个地方歇一歇，我可以陪着你。` |
| `你是谁` | 同上；无身份义务 | `我是慢聊小记的聊天助手，一个陪你说话的地方。` |
| `那你怎么不会说话` | 同上；无语音能力义务 | `是我没接住你的意思，你可以按你的方式再跟我说说吗。` |
| `接住是什么意思` | 同上；无词义义务 | `是我刚才用词没选好，让你觉得困惑了。其实就是想好好听你说话，不急着下结论或讲道理。` |

四轮均为 raw=final、`finalReplySource=llm`，没有 guard、rewrite 或
fallback 覆盖。最早错误是直接问题没有进入可持续的回答义务；随后旧
Clinical `reflect` 和 Conversation `acknowledge` 把它们放大为同理、澄清
或自我修复话术。

## 2. 根因与传播链

```text
相邻上下文已存在
  -> semanticEvidence 只回答“是否有语义”
  -> 没有 Turn Interpretation / Direct Answer Obligation
  -> legacy Engage 与 Clinical ResponseGoal 同时写行为目标
  -> Prompt 同时接收两套策略
  -> LLM 选择保守的 acknowledge/reflect 语言
  -> 本组样例没有后置覆盖，错误直接成为最终回复
```

改造前普通链路中可影响目标或文本的入口有五类：legacy Engage、Clinical
ResponseGoal/Strategy、Prompt 的策略句、LLM surface、语义 guard/普通
fallback。Safety 是独立高优先级覆盖。身份与能力事实还散落在 Prompt，
没有单一 Grounding 来源。

## 3. 决策权矩阵

### 改造前

| 组件 | 实际角色 | 问题 |
|---|---|---|
| semanticEvidence / Active Answer Frame | evidence provider | 只判断内容，不表达直接回答义务 |
| Conversation State | evidence provider | interaction 正确但不能约束最终动作 |
| legacy Engage | decision owner | 与 Clinical 同时决定普通回复姿态 |
| Clinical ResponseGoal / Rogers | decision + policy owner | 所有普通轮默认经过，能力问题也被 reflect |
| Voice / Prompt | policy + surface instruction | 完整行为句锚点进一步放大冲突 |
| LLM | surface realizer + 被迫仲裁冲突 | 实际在两套目标间自行选择 |
| semantic guard | validator + historical override | 曾可覆盖最终文字；TA-009 后已取消创作 |
| ordinary fallback | override | 模型失败时可创建另一套聊天目标 |
| Safety | override | 合理高优先级，但需显式原因 |

### 改造后

| 组件 | 唯一角色 | 权限边界 |
|---|---|---|
| Context Assembly | context provider | 仅必要相邻轮次、配对完整的历史投影、证据、Grounding、选择性 Memory |
| semanticEvidence / Active Answer Frame | evidence provider | 不判断 engagement/goal，不写回复 |
| Turn Interpretation | evidence interpreter | 输出 contentMeaning、多个 responseRelation 候选及 stateUpdate；旧 acts 仅作兼容证据 |
| Interaction / Dialogue State | state contract | 保存 currentActivity、activeThread、commonGround 三态、turn-scoped obligations、initiativeOwner、lastCommittedAssistantMove、repairState |
| Assistant Grounding | constraint provider | 单一身份与能力事实来源 |
| Memory | context provider | 仅确认事实或明确标注的 hypothesis |
| Clinical | optional policy provider | 只在 Planner 请求时给策略建议 |
| Response Planner | **唯一非安全 decision owner** | 每轮只写一个 ResponsePlan |
| Surface Realization | surface realizer | 只实现既定计划 |
| Output Validation | validator | 区分 hard gate 与 quality advisory；同 plan 最多内部重生成一次，不重规划、不把普通质量修正交给用户 |
| State Update | recorder | 记录义务完成情况，不重规划 |
| Safety | explicit override | 规划前阻断并记录原因 |

## 4. 改造后实际调用关系

```text
createChatReply
  -> Safety gate
  -> determineConversationState
  -> assembleConversationControlContext
       -> evaluateSemanticEvidence
       -> inspectActiveAnswerFrame
       -> Assistant Grounding
  -> interpretTurnDeterministically
  -> enrichTurnInterpretation (仅歧义语用，可选 LLM)
  -> selective Memory resolution
  -> buildDialogueState                         [关系候选 -> Interaction State]
  -> createResponsePlan                         [唯一一次]
       -> createClinicalStrategyAdvice          [仅 emotional/action need]
  -> enforceResponsePlan
       -> generateChatReply                     [Surface only]
       -> validateResponsePlanOutput
       -> same-plan regenerate at most once
       -> hard failure on second candidate: constraint_failure
       -> advisory-only second candidate: validated winner + advisory trace
  -> ConversationControlTrace / State Update
  -> persist
```

## 5. 核心结构化决策变化

### 场景 A

改造前虽然 interaction 正确，但最终存在冲突目标。改造后：

```text
responseRelation=[yields_initiative, continues_active_thread]
initiativeOwner=assistant
currentActivity=opening_thread
openObligations=[]
responseActions=[take_light_topic_initiative]
clinicalInvoked=false
questionPolicy=one_low_pressure_question
closurePolicy=forbid_closure
decisionOwner=conversation_os.response_planner
```

`没关系，那我们就先这样待着。` 命中 `premature_closure` 时属于质量建议；validator
会要求按同一计划内部重新表达，不能改成陪伴/收口计划。第二候选若只剩质量建议，
仍可进入 `VALIDATED`，不会把“重新生成”交给用户。

`primaryDialogueAct` 仍可出现在兼容 trace 中，但不再被 Planner 读取。
Planner 的动作只能来自更新后的 Interaction State，并为每个动作、义务和
披露写入 `relevanceProvenance`。

### 场景 B

```text
你会坐吗           -> obligation=body_capability, grounding=no body
你是谁             -> obligation=identity, grounding=AI chat assistant / not clinician
那你怎么不会说话   -> obligation=voice_output, grounding=text output only
接住是什么意思     -> obligation=definition, action=answer_directly + explain_plainly
```

每轮 `clinicalInvoked=false`、`questionPolicy=none`、先直接回答。若 surface
用反问或继续维持身体/临床身份，validator 以同一 `planId` 拒绝。

当前身份合同已进一步拆分：`product.name=慢聊小记`，
`assistant.displayName=小慢`。`你叫什么名字` 只由 `assistant_name`
obligation 回答“小慢”；`你是谁` 可组合“小慢”和 AI assistant kind，但产品名
不能冒充助手称呼。用户对相邻、已提交 identity claim 的延续只能通过
exact-bound `affirm` 关系获得 `establish_assistant_identity` action；普通确认、
direct answer、pause 和拒绝不会因此全局获得追问权限。

首次空会话欢迎提交一个包含“小慢”自我介绍与低压力入口的结构化
`open_statement` intent；回访不重复自我介绍。Guest 连续生成失败会释放
dedupe reservation、只重试一次并显示可见失败；Auth 同样保留一次恢复机会。
Auth 首次/回访从该用户跨会话的 committed Message 判断，Guest 则把
structured greeting history 或 local messages 视为回访证据；空的新 session 不等于
首次。Auth ensure 结果显式区分 `committed / not_due / retryable_failure`，后者由
page、sessions/messages API 传入既有 Chat execution-status 区域。首次身份
positive function 的 canonical name、exact binding 与问题策略由确定性层检查；
无论是否有 handoff，统一 Planned Function Semantic Validator 都按 frozen identity
contract 验证“小慢”自我介绍和自然低压力入口。只有“我是小慢。”或身份后立刻收尾
不能通过，identity continuation 也必须绑定并自然延续相邻 committed claim，不使用中文
完成短语词表分类。
model relation fail closed 时不伪造 `complete_reciprocal_contact`：exact initial intent、
目标前无 User、当前无/低内容，并且没有 direct question、repair、boundary、Safety
或 pause 时，可独立授权 `establish_assistant_identity`；unclear handoff 仍保持 defer。
所有失败都保持零 Assistant 事件提交，不增加固定 fallback 或持久 lifecycle state。

统一语义提交门在 `interactionMoveHandoffPlan` 或 `positiveFunctionContract` 任一存在时
执行一次 strict `json_object` provider 调用。handoff 与 positive function 是独立 nullable
verdict：不存在的分支必须为 null，存在分支必须 exact-bind 并各自提供候选回复中的 exact
UTF-16 evidence，两支同时存在时取 AND。三类 positive function union（identity 三 mode、
emotional 四 support function、repair 三 mode）均由该门验收；malformed、extra/missing key、
binding/evidence mismatch、uncertain 与 provider failure 全部 fail closed。该 verdict 不能
重规划或授予问题权限；首次候选和同 plan regenerate 复用同一个 frozen plan，旧 handoff
Validator 只作兼容委托，不形成第二生产逻辑或第二模型调用。

## 6. 旧逻辑迁移

- `lowInformationReplyGuard.ts`：删除；不再独立推断用户意图。
- legacy Engage / Voice：保留兼容和历史测试入口，生产 surface 不调用。
- legacy `responseGoalSelector` / `clinicalPlanService`：保留 Clinical 单测和
  旧 trace 兼容，生产 orchestration 不调用。
- Rogers：迁移为 Planner 按需调用的 Clinical 策略提供者。
- `semanticEvidenceReplyGuard`：保留 TA-009 合同单测；生产由统一
  ResponsePlan validator 承接，不再覆盖聊天文案。
- ordinary fallback：从生产 orchestration 移除；模型/验证失败返回非伪装
  `constraint_failure`，保留原计划和未完成义务。
- user correction：共享 `isAssistantRepairSignal` evidence classifier，避免
  Clinical 与 Conversation 各维护一套纠正判断。
- correction target：`detectAssistantCorrection` 记录目标助手话轮、被拒绝
  命题和仍未完成的原始用户意图；被引用的问句不再创建新 obligation。
- history projection：只过滤未提交、BLOCKED 或非对话事件；已提交原文不再
  因旧 Prompt 版本、低信息形式或模板文本被删除，窗口裁剪继续保留显式
  `replyToMessageId` 关系。
- obligation lifecycle：义务只属于来源 `conversationId + turnId`；State
  Update 将其记录为 answered/expired，不跨轮自动复用。
- execution lifecycle：trace 显式记录 `PLANNED / GENERATED / VALIDATED /
  REJECTED / RETRYING / COMMITTED / FAILED`，只有原子提交能产生 Assistant
  事件和状态更新。
- planning depth：唯一 Planner 根据关系复杂度选择 `minimal / standard /
  deep`；Surface 只接收深度对应的最小计划投影。完整 provenance 保留在
  trace，Surface 仅接收计划元素、来源/来源话轮及当前用户原话证据。
- adjacent answer：已提交的 Assistant 回复若实际提出了计划允许的问题，会将
  `questionOrRequest=question` 与 `expectedUserContribution=answer` 写入状态；
  用户回答该问题时，Planner 默认使用 `questionPolicy=none`，避免连续采访。
- ordinary acknowledgement：Surface 只能承接当前用户明确表达的内容；不得添加
  用户未表达的好坏评价、通用因果机制或正向重构。validator 只做同计划语义约束，
  不提供示例句、不改写回复。

## 7. 多轮与反例覆盖

自动化结构回归覆盖完整 A（1 轮）和 B（4 轮）相邻上下文，并覆盖以下
15 组行为族，不按固定回复文本验收：

| # | 场景 | 结构验收 |
|---:|---|---|
| 1 | 助手邀请后无话题 | assistant initiative；禁止收口；不调 Clinical |
| 2 | 连续追问后无话题 | shared initiative；不继续追问 |
| 3 | 先前暂停后无话题 | 保持 pause |
| 4 | 暂停后明确重开 | 清除 stop；接回主动权 |
| 5 | 身份询问 | identity obligation + Grounding |
| 6 | 身体能力询问 | body obligation；不得维持身体隐喻 |
| 7 | 文字/语音模态 | voice input/output obligation |
| 8 | 视觉、时间、Memory 能力 | 对应 grounding obligation |
| 9 | 上一轮矛盾 | direct answer + repair |
| 10 | 词义询问 | definition obligation + explain |
| 11 | 用户纠正助手 | repair，不默认 Clinical |
| 12 | 明确暂停/结束 | allow_pause；禁止追问 |
| 13 | 低落且无话题 | Clinical emotional advice；不轻闲聊 |
| 14 | 低落 + 语音问题 | 先保留语音义务，再组合支持 |
| 15 | 纯数字/单字/低信息 | 不虚构含义；兼容 Active Answer Frame |

另有 20 个新反例包含普通“不知道”、项目复杂、梦、疲惫、感谢、纠正否定、
临床身份、身体能力、行动建议、重开、身体隐喻追问和词义问题。

## 8. Active Answer Frame 修复

回归发现 `How old are you?` 会同时生成 `age` 与泛化 `yes_no` 候选，旧的
“位置更晚优先”误选 `yes_no`，使 `34` 被判 `insufficient`。修复为：同一
问句已经建立 numeric/age/count/scale frame 时，不再追加 generic binary
frame。这是帧类型互斥修复，不是对 `34` 的句子补丁。

## 9. 验证与剩余证据边界

本地验证命令和结果记录在最终交付报告中。结构测试能够证明控制权、义务、
Grounding、Clinical 按需调用和 validator 不重规划；它不能证明真实模型
自然度。

改造后 A/B 的真实 Qwen Prompt 属于新的外发内容，不在“改造前基线追踪”
授权内。因此当前文档不伪造 post raw LLM 输出。取得独立授权后，应运行同一
5 回合，保存 `conversation-os-control-baseline-post.json/.md`，并对
directness、relevance、continuity、grounding、naturalness、burden、tone
fit、over-clinicalization、closure、verbosity 做成对审阅。

授权后的受控命令为：

```bash
npm run conversation-os:control-baseline -- --authorized-post
```

脚本会在每次 Turn Interpretation / Surface Realization 的真实 `callModel`
之前检查实际 Prompt，并限制 provider/model 为 Qwen/DashScope
`qwen3.7-max`；未带授权参数时在任何模型调用前退出。

授权后共完成三轮 post（15 个用户回合）。Round 1 暴露模型解释覆盖确定性
`no_topic → yield_initiative`；Round 2 暴露 definition validator 不接受“是指”；
两处均在最早责任层修复。Round 3 的 5 个最终回复全部满足唯一 Planner、直接回答、
相邻上下文、身份/能力 Grounding 和普通聊天路由验收。完整成对结果见
`docs/evals/conversation-os-control-pre-post-comparison.md`。

## 10. 本地验证结果

截至 2026-07-23，以下检查均通过：

- `npm run check:conversation-os-control`：15 个场景族、完整 A（1 轮）与
  B（4 轮）、20 个新增反例、唯一计划所有者约束全部通过；同时验证
  Turn Interpretation / Surface 任一 Prompt 预检拒绝都会立即终止外发链。
- `npm run check:conversation-interaction`：26 个 interaction/context 用例通过。
- `npm run check:semantic-evidence`：21 个自然样例、20 个阻断样例、20 个
  regenerate、20 个 constraint failure、32 个 Active Answer Frame 用例通过。
- `npm run check:ai-orchestration`、`check:ai-base`、`check:ai-system`、
  `check:architecture-v1`、`check:conversation-os-architecture`、
  `check:conversation-state`、`check:conversation-trajectories`、
  `check:clinical-logic`、`check:memory-v2`、`check:understanding` 均通过。
- `npm run check:chat-history-pagination`：首批 50 条、137 条同时间戳、
  插入稳定性、向上 cursor、顺序、无重复和滚动位置保持均通过。
- `npx tsc --noEmit`、`git diff --check` 与完整 `npm run check:launch` 通过；
  Prisma schema/client/11 个 migration、miniapp 检查和 Next 39 页构建通过。

只读浏览器端到端检查在 `http://localhost:3001/chat` 完成：页面标题、欢迎词、
聊天输入和发送按钮正常，控制台无 warning/error。当前本地账户首屏恰有 50 条，
实际向上滚动到顶部后无更早本地记录可追加；存在更早记录时的分页行为由上述
137 条自动化数据集验证。浏览器检查没有填写或发送聊天输入，也没有触发模型调用。

完整 launch 仅保留既有非阻断 warning：projection registry 的未使用 stub，
以及 miniapp media/seed guard 的 prelaunch 识别提示；没有错误。

## 11. Hard Gate / Quality Advisory 边界（2026-08-10）

`ResponseValidationResult.passed` 现在只表示 hard-gate commit eligibility，不再表示
回复已经达到全部聊天质量偏好。Validator 仍会把质量问题作为具体内部反馈交给
同一个 frozen `ResponsePlan` 做一次 Surface 重写；第二候选若只有 advisory，成为
`VALIDATED` winner，并在 trace 中保留未解决建议，不向用户显示普通质量型“重新生成”。

继续 fail-closed 的范围包括：Safety、当前 turn/plan 与义务绑定、Assistant 身份和
硬事实、用户已拒绝命题、repair/boundary/answer 责任、strict semantic JSON/binding/
evidence、未知 failure code、immutable envelope 及 Auth transaction。标点/问题数量、
closure 词表、ordinary acknowledgement/handoff/topic-entry 词表，以及主动欢迎语的
清晰度、锚点、自足性、重复度等属于 quality advisory。

普通 handoff 的 `continue_from_user_answer`、`continue_user_introduced_content`
若第二候选仍只有 semantic advisory，可以提交可见回复，但 envelope 必须写
`handoff=null`，不得伪造 `fulfills`。`complete_reciprocal_contact` 的功能未满足、
重复问候/在线/可用替代以及超过一个语义问题均为 hard failure；
`answer_current_obligation`、
`withdraw_or_repair_targeted_move`、`respect_user_boundary` 仍是 hard function。该边界没有
新增持久 lifecycle state；resolved/active 继续由 committed immutable edges 纯查询得出。

## 12. Safety 双通道与结构性失败呈现（2026-08-10）

Safety 仍是普通 Conversation OS 之前的显式 override。明确 imminent 表达由规范化快通道处理；其余生产 Qwen 回合用 strict `json_object` 做只读语义分诊。模型只选择风险、当前性、类别和当前用户原文中的 exact evidence text；代码验证唯一绑定并计算内部位置。malformed、binding/evidence 错绑、语义不一致、4xx 或未知异常首次失败即返回 `SAFETY_BLOCKED`；只有 timeout、429、5xx 可重试一次，第二次任何失败都阻断。它不会让“不知道”伪装成安全，也不会进入 Planner。

经验证的 Safety 路由使用代码所有、按类别和紧迫度区分的中国大陆回复：先承认危险，再直接提供 `120 / 110 / 12356` 和当前动作。模型不能生成号码。Safety winner 继续使用既有 immutable `supersedes` edge；没有新增持久 lifecycle state，`resolved/active` 继续纯查询。

`PLAN_INVALID` 与耗尽同计划内部修正后的 hard `GENERATION_NONCONFORMANT` 不再向用户展示无效的“重新生成”：user-safe status 说明是系统计划不一致或已尝试修正仍无法可靠完成，并设 `retryable=false`。瞬时 provider、timeout、persistence 失败仍可重试；客户端无需新增状态机。

该 Safety 切片已通过 Subject-Ownership Closure 封存：deterministic bypass 只保留无主体标记、整条消息为已实施行动的输入；意图和带 Unicode 标点/符号的主体歧义输入在规范化前统一进入 semantic triage。明确第三方归属放行，无归属危险引文 fail closed；真实 Qwen 22/22，独立工程与 Safety/Privacy 复审均 PASS。
