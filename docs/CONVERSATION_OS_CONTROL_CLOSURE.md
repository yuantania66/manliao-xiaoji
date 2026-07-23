# Conversation OS 控制权收口与自然会话闭环

状态：代码迁移与本地结构回归完成；改造后真实 Qwen A/B 对照尚未调用，等待独立外发授权。

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
| Context Assembly | context provider | 仅必要相邻轮次、证据、Grounding、选择性 Memory |
| semanticEvidence / Active Answer Frame | evidence provider | 不判断 engagement/goal，不写回复 |
| Turn Interpretation | evidence interpreter | 组合 acts/signals；不计划、不回复 |
| Dialogue State | state contract | 保存 open loops / obligations / continuity |
| Assistant Grounding | constraint provider | 单一身份与能力事实来源 |
| Memory | context provider | 仅确认事实或明确标注的 hypothesis |
| Clinical | optional policy provider | 只在 Planner 请求时给策略建议 |
| Response Planner | **唯一非安全 decision owner** | 每轮只写一个 ResponsePlan |
| Surface Realization | surface realizer | 只实现既定计划 |
| Output Validation | validator | 同 plan 接受/拒绝/最多重生成一次，不重规划 |
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
  -> buildDialogueState
  -> createResponsePlan                         [唯一一次]
       -> createClinicalStrategyAdvice          [仅 emotional/action need]
  -> enforceResponsePlan
       -> generateChatReply                     [Surface only]
       -> validateResponsePlanOutput
       -> same-plan regenerate at most once
       -> constraint_failure on second failure
  -> ConversationControlTrace / State Update
  -> persist
```

## 5. 核心结构化决策变化

### 场景 A

改造前虽然 interaction 正确，但最终存在冲突目标。改造后：

```text
primaryDialogueAct=yield_initiative
answerObligations=[]
responseActions=[take_light_topic_initiative]
clinicalInvoked=false
questionPolicy=one_low_pressure_question
closurePolicy=forbid_closure
decisionOwner=conversation_os.response_planner
```

`没关系，那我们就先这样待着。` 会因 `premature_closure` 被拒绝；validator
只能要求按同一计划重新表达，不能改成陪伴/收口计划。

### 场景 B

```text
你会坐吗           -> obligation=body_capability, grounding=no body
你是谁             -> obligation=identity, grounding=AI chat assistant / not clinician
那你怎么不会说话   -> obligation=voice_output, grounding=text output only
接住是什么意思     -> obligation=definition, action=answer_directly + explain_plainly
```

每轮 `clinicalInvoked=false`、`questionPolicy=none`、先直接回答。若 surface
用反问或继续维持身体/临床身份，validator 以同一 `planId` 拒绝。

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
