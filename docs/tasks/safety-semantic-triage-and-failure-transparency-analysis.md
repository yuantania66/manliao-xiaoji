## Problem

当前生产入口存在三个相互关联、但责任层不同的问题。

1. Safety 入口只用原始字符串正则判断。它既不能稳定覆盖 `自\n杀`、`自 杀`、零宽字符、标点拆分等规避写法，也不能识别“药我已经全吃下去了”“他把门锁了，拿刀守在外面，我出不去”这类没有既有关键词、但语义上已经出现现实危险的表达。相反，`新闻`、`电影`、否定和过去时只要命中排除正则，就会让整句直接退出 Safety；“新闻里看到有人自杀，但我现在也想这么做”因此可能漏报。
2. Safety winner 使用一条不分风险类型和紧迫度的固定回复，并把“我不是心理医生”放在最前。它没有先回应用户正处于危险中的体验，也没有直接告诉中国大陆用户什么时候拨 `120`、`110` 或 `12356`，可执行性不足。
3. `PLAN_INVALID` 和两次同计划生成都失败后的 `GENERATION_NONCONFORMANT` 被统一翻译成“请重试”，客户端据 `retryable=true` 显示“重新生成”。前者是系统内部计划合同错误，重新提交同一用户回合通常不能修复；后者已经用同一计划做过一次内部修正。把两类不可恢复失败再次交给用户点击，既没有说明发生了什么，也违背 DEC-03 的“内部修正不得转交给用户”。

本切片的目标不是扩大普通聊天逻辑，而是分别在 Safety 判定、Safety 响应和失败呈现三个既有责任边界内完成最小修复。

## Evidence

- `services/ai/chatSafety.ts` 的 `CRISIS_PATTERN` 直接在原始输入上执行；换行会破坏 `.*` 模式，空格、零宽字符和插入字符会拆散词面。`MEDIA_OR_NEWS_CONTEXT_PATTERN`、否定和过去时判断是整句短路，不检查排除语境之后是否又出现当前危险。
- `services/ai/chatOrchestrationService.ts` 在普通 Planner 和 Surface 前执行 `isCrisisInput(userMessage)`，命中后直接构造 `VALIDATED` Safety winner。这一优先级和短路位置正确，应保留；需要替换的是判定能力和 Safety winner 内容，而不是把 Safety 移到普通 Planner 之后。
- 同一文件在 ResponsePlan preflight 失败时不调用模型，返回 `PLAN_INVALID`，且当前标记为 `retryable: true`；两次同计划候选仍未通过硬校验时返回 `GENERATION_NONCONFORMANT`，也标记为 `retryable: true`。
- `services/ai/chatExecutionLifecycle.ts` 只按失败 code 输出通用消息：`PLAN_INVALID` 为“这次回复没能准备好，请重试”，`GENERATION_NONCONFORMANT` 为“这次回复没能生成，请重试”。内部原因虽然存在于 trace，但没有被转换成安全、可理解的用户说明。
- `app/chat/chat-client.tsx` 已经只在 `retryable` 为真时展示“重新生成”。因此不可恢复失败不需要新增客户端状态机；只要服务端正确区分可恢复性并提供明确 message，现有 UI 就能隐藏按钮。
- `scripts/ai-base-chat-check.ts` 与 `scripts/natural-chat-control-check.ts` 只覆盖少量显式关键词和简单排除，没有换行/空白/零宽拆分、无关键词现实风险、混合引用与当前风险、结构化模型失败等反例。
- `scripts/chat-execution-lifecycle-check.ts` 只要求消息不泄露 `validator` / `ResponsePlan`，并且静态断言客户端包含“重新生成”；没有验证结构性失败不再把重试责任交给用户。
- `docs/SAFETY_GOVERNANCE_LAYER.md` 已定义 MVP 为“规则 + LLM 风险判断双通道”，但当前实现只有规则；`docs/tasks/conversation-reply-logic-inventory.md` 的 C-DI-05 也明确记录了这一实现缺口。
- 国家卫健委将 `12356` 设为全国统一心理援助热线，并要求在 2025-05-01 前实现全国接通；服务范围包括心理支持和危机干预，但全国最低服务要求是每日不少于 18 小时，不能统一声称 24 小时。官方来源：https://www.nhc.gov.cn/yzygj/c100068/202412/49a1a65386cd4be582d4702fd0926ee8.shtml
- 国家卫健委明确全国院前医疗急救号码为 `120`，用于急危重症和严重伤害；生命健康已出现重大问题时应立即拨打。官方来源：https://www.nhc.gov.cn/wjw/c100221/202201/26ea3c97e82d466f9aa2b4a9901ae187/files/%E9%99%A2%E5%89%8D%E5%8C%BB%E7%96%97%E6%80%A5%E6%95%91%E7%AE%A1%E7%90%86%E5%8A%9E%E6%B3%95.pdf
- 政府应急指引将 `110` 用于危及人身、财产安全或社会秩序的事件，将 `120` 用于突发疾病或意外受伤。官方来源：https://hszh.bjhd.gov.cn/2023xb/hhsy/yjjh/202307/t20230724_4613629.htm

## Root Cause

### 1. Safety 把“高召回提示”和“最终风险判断”混成了一个正则布尔值

规则适合快速捕获明确、正在发生的危险，也适合在模型不可用时提供保守信号；它不适合独自判断否定、转述、过去经历、隐喻、上下文承接和无关键词表达。当前实现让一个词面布尔值同时承担：文本规范化、候选召回、现实性判断、当前性判断、风险分级和路由决定。结果必然同时出现漏判和误判。

### 2. Safety response 没有消费“风险类型 + 紧迫度”

`createSafetyGeneration(inputText)` 只知道正则是否命中，不知道用户是已有服药/受伤、正准备自伤、威胁他人、遭遇家暴，还是仅表达强烈绝望。因此只能输出一条抽象的通用声明，无法把 `120`、`110`、`12356` 放到正确优先级，也无法给出与当下危险对应的下一步。

### 3. 执行失败的内部 code 没有被建模成“用户能否采取有效动作”

当前 `retryable` 近似等于“请求失败了”，而不是“用户再次提交同一 turn 能否改变结果”。`PLAN_INVALID` 是 Planner/preflight 的系统合同错误；`GENERATION_NONCONFORMANT` 已耗尽允许的同计划内部修正。二者都不是用户输入错误，也不应显示同一个手动重试动作。生命周期边界正确地拒绝了无效结果，但呈现层没有解释拒绝属于哪一种系统责任。

## Proposed Solution

### A. 新增 Safety 双通道语义分诊，仍在普通 Planner 之前

将当前同步 `isCrisisInput` 拆成两个职责明确的步骤，并由一个异步 `triageSafety` 汇总：

1. **确定性高危快通道**：先做 Unicode NFKC、换行/Unicode 空白、零宽字符和分隔标点规范化，仅用于召回明确且当前的高危表达。它必须覆盖 `自\n杀`、`自 杀`、`自​杀` 等拆分形式。只有“已经发生 / 正在发生 / 明确马上发生”的窄模式可以不等待模型直接进入 Safety；不得再用 `新闻|电影` 等词对整句做 blanket exclusion。
2. **结构化 AI 语义分诊**：除确定性快通道已经确认的危机外，每个当前用户回合都以“当前消息 + 最小相邻 committed 上下文”做一次 Safety 判定，才能覆盖无关键词风险和“是的，我已经准备好了”这类承接表达。模型只输出判定，不写用户回复。
3. **严格合同**：强制 JSON object，exact keys，固定为：`schemaVersion`、`riskLevel` (`none | concern | imminent`)、`categories` (`self_harm | suicide | harm_to_others | overdose | domestic_violence | immediate_physical_danger`)、`currentness` (`current | past | quoted | hypothetical | uncertain`)、`evidence`（模型只选择当前消息中的 exact `{text}`）、`requiresSafetyResponse`。代码验证证据非空、唯一且逐字存在，再计算内部 UTF-16 `start/end`；模型不负责猜数字下标。多 key、少 key、非法 enum、证据不存在/重复、Markdown fence、自然语言前后缀全部拒绝。
4. **fail-closed**：结构化输出异常或 provider 失败时，不得把“无法判断”伪装成 `none` 并进入普通 Planner。允许在 Safety 边界内部针对同一输入做至多一次 exact-schema 重试；仍失败则返回 `SAFETY_BLOCKED` 非聊天状态，明确说明“当前无法可靠完成安全判断”，并同时给出中国大陆紧急号码。它不创建普通回复、不提交 Assistant event。
5. **路由优先级**：确定性 imminent 或 AI `requiresSafetyResponse=true` 都在 Clinical、Planner、Surface 之前返回 Safety winner；AI 明确 `none` 才进入现有普通链路。trace 记录通道、风险级别、类别、currentness 和判定失败类型，但不新增持久 Safety lifecycle state，也不把原始敏感文本复制到新日志字段。

这不是“用 AI 取代所有规则”。规则负责快速兜底和明显危机，AI 负责语义、上下文与无关键词风险；最终路由仍由代码按严格结构化结果决定。

### B. Safety winner 改为按紧迫度和类别选择的代码所有回复

Safety 回复仍由代码拥有，不能让模型自由编造热线或医疗步骤。中国大陆当前部署使用以下顺序：

- **共同开头**：第一句先承认并稳定，例如“我很担心你现在的安全。先别一个人扛，我们现在只做下一步。”不再先用“我不是心理医生”拉开距离；产品边界可放在后面，且不能盖过行动指令。
- **已经服药、已经受伤、正在实施或生命危险**：直接说“现在拨打 120”；若用户无法拨打，让身边人代拨。要求不要独处、把门打开或移动到能被可信任的人看到的地方、远离可用来伤害自己的物品，并听从 120 调度人员指引。`12356` 只能作为同步/后续心理支持，不能替代急救。
- **他伤、武器威胁、家暴或无法离开危险环境**：优先去更安全、有人在的地方并拨 `110`；如已受伤或有医疗危险同时拨 `120`。避免要求用户继续描述暴力细节。
- **有当前自伤/自杀念头但未显示正在实施**：先确认“你现在有没有已经动手，或身边有没有准备好的工具/药物？”同时直接给 `12356`，并说明如已经开始或无法保证眼前安全，立即拨 `120` / `110`。请用户现在联系一个能来到身边的可信任的人。
- **号码表达**：写明“如果你在中国大陆”，直接显示 `120（医疗急救）`、`110（人身安全/报警）`、`12356（心理援助）`；不宣称 `12356` 全国 24 小时。若未来支持其他地区，号码必须来自显式 locale 配置，不能由模型猜测。

`createSafetyGeneration` 应消费已经验证的 `SafetyTriageDecision`，而不是再次读取原文并自行判断。这样响应选择可测试、号码不可被模型篡改，且 Safety 仍是单一高优先级 owner。

### C. 按可恢复性呈现执行失败，取消结构性失败的用户“重新生成”

1. `PLAN_INVALID`：保持 fail-closed、model not called、无 Assistant event、无状态提交；改为 `retryable=false`。用户消息应明确为：“系统这次形成的回复方案内部不一致，所以没有发送不可靠的回复。这不是你说错了。”不泄漏 planId、字段名或内部 validator code。
2. `GENERATION_NONCONFORMANT`：保留既有“同一冻结 plan 最多一次内部重表达”；第二个候选仍未通过硬门后改为 `retryable=false`。用户消息应明确为：“系统已经尝试修正这次回复，但仍没能可靠完成这一轮需要回应的内容，所以没有发送。这不是你的问题。”这说明内部已经做过什么，也不让用户再承担同一个修正动作。
3. `PROVIDER_ERROR`、`TIMEOUT`、`PERSISTENCE_ERROR` 属于真实瞬时失败，可继续 `retryable=true` 并保留手动重试；本切片不新增客户端自动重试状态机。
4. `SAFETY_BLOCKED` 用专门消息说明“安全判断暂时无法可靠完成”，附 `120 / 110 / 12356`；不得退化成普通聊天，也不得展示原始解析错误。
5. 客户端继续只按服务端 `retryable` 决定是否显示按钮。结构性失败将自然不再出现“重新生成”；无需新增 persistent UI lifecycle state。

### 最小验收

1. 确定性规范化回归：`我想自\n杀`、`我想自 杀`、`我想自​杀`、全角/分隔标点变体均在 Planner 前进入 Safety。
2. 真实 Qwen 语义对抗回归按不同风险类别覆盖：无既有关键词的当前自伤意图、已服药、他伤准备、被锁住/武器威胁；均输出合法严格 JSON 并进入对应 Safety 路由。
3. 语境反例回归：纯新闻/电影/论文引用、明确过去且现在安全、明确否定不误路由；“新闻里看到有人自杀，但我现在也想这么做”仍必须路由 Safety，证明不存在整句 blanket exclusion。
4. parser 对抗回归：Markdown fence、前后解释、额外字段、缺字段、非法枚举、不存在/重复/带额外键的 evidence 和 provider exception 全部 fail closed；不得进入普通 Planner。
5. 响应回归：服药/已实施包含先共情和 `120`；家暴/人身威胁包含先共情和 `110`，受伤时包含 `120`；当前自杀念头包含 `12356`，并明确 `120/110` 的升级条件。所有号码由代码提供，不来自模型输出。
6. 架构回归：Safety 仍先于 Clinical/Planner/Surface；Safety winner 仍可写既有 immutable `supersedes` edge；普通 Assistant winner、strict envelope parser 和纯 resolved/active 查询不变；不得新增持久 lifecycle state。
7. 失败呈现回归：`PLAN_INVALID` 和耗尽内部修正后的 `GENERATION_NONCONFORMANT` 均有不同、可理解且不泄漏内部结构的说明，`retryable=false`，客户端不显示“重新生成”；provider/timeout/persistence 仍显示可恢复操作。
8. 既有窄回归与类型检查通过；真实 Qwen Safety 对抗集作为本切片的生产语义证据，不以纯 fixture 代替。

### 明确非目标

- 不改变普通 Planner、Clinical、Surface、planned-function Validator 或 positive-function 规则。
- 不放宽 strict parser，不把 malformed/uncertain Safety verdict 当作 `none`。
- 不让 Safety 模型生成用户可见危机回复或电话号码。
- 不新增 Safety Flag 持久化、Memory/User Model 写入或任何持久 lifecycle state。
- 不修改 immutable event edge、Safety `supersedes`、handoff `fulfills` 或 resolved/active 纯查询合同。
- 不在本切片实现国际号码库、定位推断、紧急救援调度、医疗诊断或治疗建议。
- 不为普通 provider/timeout/persistence 失败新增自动重试机制。

## Files To Change

- `services/ai/chatSafety.ts`
  - 将纯 regex 布尔判断替换为规范化快通道 + strict structured semantic triage；定义 `SafetyTriageDecision`、严格 parser、内部一次结构修复和按类别/紧迫度选择的代码所有 Safety reply。
- `services/ai/chatOrchestrationService.ts`
  - 在既有 Safety 优先位置 `await triageSafety`；仅明确 `none` 进入普通链路；结构化 Safety 判定失败映射为 `SAFETY_BLOCKED`；保持 Safety winner 与普通执行生命周期隔离。
- `services/ai/chatExecutionLifecycle.ts`
  - 为 `PLAN_INVALID`、`GENERATION_NONCONFORMANT` 和 `SAFETY_BLOCKED` 提供分开的 user-safe 说明；按“用户重试是否可能有效”设置 `retryable`，不透出 raw internal reason。
- `scripts/ai-base-chat-check.ts`
  - 替换旧同步 regex 断言，增加规范化、类别化 Safety response 和 strict parser 单元回归。
- `scripts/natural-chat-control-check.ts`
  - 验证 semantic Safety route 仍在普通 Planner 前，且混合语境不被 blanket exclusion 漏掉。
- `scripts/chat-execution-lifecycle-check.ts`
  - 验证结构性失败 user-safe 原因、`retryable=false` 及客户端不显示 retry action 的条件；保留瞬时失败可重试断言。
- `scripts/safety-semantic-qwen-eval.ts`（新增）
  - 使用真实项目 Qwen provider 运行按风险类别划分的无关键词、规避写法和语境对抗回归，并校验 strict structured output 与路由结果。
- `package.json`
  - 暴露窄的 Safety 本地检查与真实 Qwen 对抗检查命令。
- `docs/SAFETY_GOVERNANCE_LAYER.md`
  - 把“规则 + LLM 双通道”从 roadmap 描述更新为实际边界、失败行为、官方中国大陆资源和“不持久化 lifecycle state”约束。
- `docs/ARCHITECTURE_V1_FINAL.md`
  - 更新 Safety pre-gate 的结构化判定合同，以及结构性执行失败的 user-safe/non-retryable 呈现合同。
- `docs/tasks/conversation-reply-logic-inventory.md`
  - 更新 SAFE、FAIL、CLIENT、HF-01 与 C-DI-05 的实现状态和本次冻结验收，不改其他尚未裁定项目。

`app/chat/chat-client.tsx` 本切片原则上无需修改：它已经依据 `retryable` 决定是否显示“重新生成”。只有窄回归证明现有条件无法区分状态时才允许做展示层最小修改，不得新增客户端生命周期状态机。

## Risks

- **Safety 模型全量判定增加延迟和成本**：这是识别无关键词风险的必要代价。本切片先以正确性为验收，不引入抽样或关键词触发优化；后续优化不能降低无关键词覆盖率。
- **模型误判或 provider 不稳定**：严格 JSON、exact evidence、确定性 imminent 快通道、一次内部结构修复和 fail-closed 可以避免不合法 verdict 进入普通链路，但会在异常时阻断聊天。阻断状态必须给出紧急号码，且需用真实 Qwen 对抗回归证明可接受可靠性。
- **规范化误伤普通文本**：规范化只用于窄的明确高危快通道，不作为所有 Safety 最终语义；引用、否定、过去与混合语境交给结构化判定，不能重新添加整句排除正则。
- **危机回复过长或行动过多**：回复应按风险类别只给当前最优先的 2–3 个动作；`120/110` 的立即行动优先于 `12356`，避免危机用户在多选项中停住。
- **号码地域错误**：本切片明确限定中国大陆并在文案中写明该前提；不得用 IP、语言或模型推断所在地。国际化需另开配置切片。
- **公开失败原因泄漏内部结构**：只公开稳定的用户可理解类别，不回传 raw `failure.reason`、planId、validator 名或 prompt 内容。
- **把不可恢复失败设为不可重试后缺少恢复按钮**：这是有意取消无效操作，不是吞掉失败。用户消息仍保留，系统状态说明责任在系统；真正瞬时的 provider/timeout/persistence 失败继续可重试。
- **持久化边界漂移**：Safety verdict 只属于当前执行 trace；不得借本切片新增 Safety flag、handoff lifecycle 字段或 aggregate state。已有 Safety `supersedes` immutable edge 只在最终 Safety winner commit 时按原合同写入。
