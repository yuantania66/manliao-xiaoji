> Superseded decision (2026-08-24): product authority selected the user-choice path. A pure reciprocal greeting now keeps `responseActions=[]`; after completing reciprocal contact, Surface may ask at most one low-pressure topic-choice question such as “今天想聊点什么？”. The earlier `take_light_topic_initiative` proposal below is historical analysis and is no longer implementation authority.

## Problem

冻结的 Conversation Purpose Stage 1 要求：首次欢迎完成并提交后，用户回复“你好”时，小慢应自然承接并继续对话，不能重复完整自我介绍，也不能因生成不合格而向用户显示失败。

真实 guest 轨迹 `trace2.localhost:3107/chat?debugAi=1` 已证明首次欢迎成功提交，但用户发送“你好”后，guest execution 进入 `FAILED`，失败码为 `GENERATION_NONCONFORMANT`。同一冻结 ResponsePlan 下的两次 Surface candidate 分别是：

- `你好呀，我是小慢。`
- `你好呀，随时可以开始聊。`

两次 candidate 均被 canonical planned-function semantic validator 以 `planned_function_semantic:handoff_not_satisfied` 正确拒绝。另一次无 debug 的真实运行曾成功提交，但最终 candidate 原样重复整段首次自我介绍。需要确认首个责任层，并给出不修改 Validator、41/41、持久状态或 Conversation Purpose Stage 2 的最小修复范围。

## Evidence

### Observation

- 客户端创建首次欢迎消息时，保留服务端返回的 `id` 与 `interactionMoveEnvelope`；发送下一轮 guest 消息时，又把同一消息的 `id`、正文、`promptVersion` 与 `interactionMoveEnvelope` 原样放入 `recentMessages`。
- `app/api/chat/guest/route.ts` 会解析每条相邻消息的 committed envelope，只有合法 envelope 才进入 orchestration。它没有丢弃这次真实欢迎的 envelope。
- `conversation-os/control/contextAssembly.ts` 与 `interactionMoveHandoff.ts` 进一步要求相邻事件是未 blocked 的 Assistant、envelope 可解析，并且消息 ID 与 `envelope.assistantMoveId` 相同；只有满足这些条件才建立 active handoff target。
- 真实 trace 已形成 `reciprocates_move -> complete_reciprocal_contact`。如果 envelope 缺失或 ID 不匹配，Planner 不会得到 handoff target；如果 orchestration 找不到相同 `sourceAssistantMoveId` 的目标文本，semantic gate 会报告 `handoff_missing_context`；如果 provider 回显的 binding 不同，则会报告 `binding_mismatch`。实际失败是 `handoff_not_satisfied`，因此 committed greeting envelope、消息 ID、目标文本与 frozen binding 已正确进入 Planner 和 Validator。
- 本轮冻结的 handoff binding 为：
  - `sourceAssistantMoveId`：已提交首次欢迎的 Assistant message ID；
  - `sourceUserTurnId`：当前 guest turn ID；
  - `selectedRelation=reciprocates_move`；
  - `requiredFunction=complete_reciprocal_contact`；
  - `completionIntent=fulfill`；
  - `questionPolicy=optional_after_completion`。
- 当前 `responsePlanner.ts` 先由普通状态产生 fallback `acknowledge_without_psychologizing`，随后在 `complete_reciprocal_contact` 分支中删除该动作。真实 plan 因而成为 `responseActions=[]`、`groundingFacts=[]`，且没有 first-contact identity positive-function contract 或 identity disclosure。
- 当前 identity authority 只接受用户对相邻、精确 committed identity claim 的 `targetOperation=affirm`。用户“你好”的 reciprocal relation不满足这个条件。真实 trace 的 `responseActions=[]` 也直接证明 Planner 没有重新加入 `establish_assistant_identity`。
- Surface 收到的 handoff 约束要求：把对话推进到寒暄之后，不得退化为另一句问候、receipt、Assistant presence、availability、generic open door、关闭语或索取话题；当 `responseActions` 为空时，还不得提问、邀请或要求用户提供内容。
- candidate `你好呀，我是小慢。` 只实现了另一句问候和重复身份，没有完成寒暄后的自然过渡。candidate `你好呀，随时可以开始聊。` 只实现了另一句问候和 generic open door。两者都属于 canonical semantic contract 明确规定的不足类别，因此 `handoff_not_satisfied` 是正确判定，不是 Validator 误杀。
- orchestration 的首次生成与一次 regeneration 复用同一个 frozen execution plan、同一个 handoff target 和同一个 semantic gate。第二次生成虽然收到失败约束，但计划依然没有提供任何可陈述或推进的普通动作，所以模型再次退回被禁止的问候/open-door 类别。
- handoff 的 Surface history 会从 source greeting 开始保留。模型因此能看见整段首次欢迎，而空动作 plan 没有提供其他具体内容。复制首次自介就成为最具体的可用文本。产品 Prompt 虽要求没有 disclosure 时不要主动介绍身份，但生成模型仍可能违背；canonical semantic gate 又是模型语义判断，而不是确定性重复文本分类器，因此较长的“自介 + 低压力入口”偶尔可能被误判为包含自然过渡并提交。这是上游空动作计划造成的偶发下游症状。
- 第一次 repair 把 reciprocal 空动作 fallback 改成了 `offer_neutral_conversation_entry`。该 action 的既有 Surface 合同只允许 statement form，并明确不让用户回答；canonical ordinary-question authority 也不把它视为问题授权。
- `offer_neutral_conversation_entry` repair 的真实页面证据已将该候选方案证伪：一次页面重放仍然两次生成、两次拒绝；另一次 direct trace 的 first candidate `你好呀，我是小慢。想聊点什么...` 因重复身份且在 handoff 完成前索取回复，被 handoff 与 question policy 正确拒绝；second candidate `你好呀，我是小慢。随时可以在这儿聊点轻松的，或者说说最近在意的事。` 被 semantic validator 提交，但仍重复问候、身份，并退化为 generic open-door 风格。
- 这些 repair-pass 结果说明，statement-only neutral entry 仍没有赋予 Surface 一个具体、可由用户轻松接住的下一步。模型继续从 source greeting 复制身份，并用 permission/open-door 语言填补缺失的对话推进；只把空数组替换成 `offer_neutral_conversation_entry` 没有修复真实用户所说的“回复你好后不知道下一句”。
- guest 客户端成功路径只把一个 pending Assistant 原位替换为服务端返回的单一 Assistant message，并按同一 ID 展示；失败路径删除 pending message 并显示 `systemStatus`。成功轨迹中重复完整自介来自新的服务端 candidate，不是客户端把旧欢迎重复渲染。
- 现有 Stage 1 直接测试只证明 envelope/handoff 正确、Planner 不重开 identity，以及候选通过 deterministic `validateResponsePlanOutput`。它们没有让真实 candidate 通过 canonical async semantic gate。现有 handoff semantic 测试使用预设为 satisfied 的 test provider，也不能证明真实模型能够实现 `responseActions=[]` 的 reciprocal plan。

### Rejected hypotheses

- **guest route 丢失 envelope**：与真实 trace 已建立 exact handoff binding、且失败不是 `handoff_missing_context` 或 `binding_mismatch` 矛盾。
- **Planner 重新打开 identity**：与当前 exact-claim authority、真实 `responseActions=[]` 以及 Stage 1 直接断言矛盾。
- **客户端重复显示欢迎**：与成功路径只替换一个 pending message、失败路径删除 pending message 的实现矛盾。
- **Validator 误杀候选**：两个真实 candidate 分别是重复身份与 generic open door，正是 canonical contract 明确规定不能完成 `complete_reciprocal_contact` 的类别。

### Interpretation

committed envelope、关系解释、handoff tuple、目标绑定、两次执行边界和 semantic rejection 都按设计工作。失败发生在它们之前的计划内容仲裁：Planner 决定必须完成 reciprocal handoff，却没有冻结一个用户可以具体接住的下一步。原始空动作 plan 没有可见贡献；`offer_neutral_conversation_entry` repair 又把贡献限制为 statement-only，不提供独立问题 authority。两者都迫使 Surface 用 source greeting、identity 与 generic open door 填补缺口。

## Root Cause

首个可证 causal boundary 是 `conversation-os/control/responsePlanner.ts` 的 `complete_reciprocal_contact` action arbitration。

`complete_reciprocal_contact` 只冻结关系转换：用户的 reciprocal contact 已经足够，回复应离开 greeting ritual。它没有提供回复接下来要陈述或推进什么。Planner 在这个分支删除 `acknowledge_without_psychologizing` 后，如果没有其他独立 action，仍允许 `responseActions` 变为空。真实 plan 同时没有 grounding fact、required disclosure、positive-function contract 或用户提供的具体话题，因此没有一个合法、具体、可实现的 Surface 内容。

这不是“Validator 太严格”，而是 Planner 产出了语义欠定、在当前约束组合下不可稳定实现的普通动作计划。原始空动作 plan 和已证伪的 statement-only `offer_neutral_conversation_entry` 都没有给用户一个具体、低负担的接话点。`handoff_not_satisfied` 是正确保护；重复身份/open-door 偶发通过，则是 Surface 复制唯一可见具体内容后，模型型 semantic verifier发生不稳定判断的结果。

## Implemented Decision（supersedes the proposal below）

产品最终选择用户话题权，而不是强制 Assistant 选题：纯 reciprocal plan 保持
`responseActions=[]`。`complete_reciprocal_contact + optional_after_completion`
自身允许在完成 reciprocal contact 后自然结束，或只问一次低压力话题选择问题，
例如“今天想聊点什么？”。这不是 `take_light_topic_initiative`，不要求独立普通 action，
也不重新打开 identity authority。

Validator Authority 的真实诊断表明，Qwen 已把纯第二问候判为 `not_satisfied`；旧代码
却把该 function failure 降为 advisory，最终形成 `passed=true`。实现因此只把
`complete_reciprocal_contact` 的 function failure 和 question-count failure 提升为 hard。
`continue_from_user_answer` 与 `continue_user_introduced_content` 继续保留既有 advisory
策略。未新增第二模型调用、中文问候词表、regex、持久状态或数据访问。

实现边界包括 reciprocal Planner composition、Surface prompt、canonical semantic
question authority、hard/advisory 分类、直接 fixtures、真实 Qwen eval 和权威合同。
Guest route、client、Interpreter、relation taxonomy、Safety、Memory、schema 与提交边均未修改。

以下旧的 `take_light_topic_initiative` 方案已经失效，不再作为实现或验收依据。

## Risks

- **把 optional 变成采访**：reciprocal handoff 最多授权一个完成后的低压力话题选择问题；双问题必须 hard fail。
- **严重级别漂移**：`complete_reciprocal_contact` 失败必须 hard fail；两个内容 continuation function 的既有 advisory 行为必须由单独回归锁定。
- **话题选择重新打开身份**：空 action reciprocal plan 不获得名字或 AI disclosure authority。
- **测试只验证结构**：最终门必须同时覆盖真实 Surface 正向、重复问候/presence/open-door/双问题反例和当前话题保持。
- **Dirty worktree collision**：目标 Planner 与测试文件已有未提交修改。实施必须由唯一 writer 做局部 patch，禁止还原、格式化或覆盖其他现有改动。
- **范围扩张**：本修复不设计 ordinary posture、不改 Stage 2、不新增状态、数据库、Memory 或 proactive lifecycle，也不改变首次欢迎文案。
