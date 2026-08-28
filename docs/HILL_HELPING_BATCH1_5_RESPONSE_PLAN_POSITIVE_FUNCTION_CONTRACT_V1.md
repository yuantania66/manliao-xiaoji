# 批次 1.5 ResponsePlan 正向功能合同 V1

状态：2026-08-09 已冻结并由 Planned Function Semantic Validation Boundary 实施

## 1. 范围与边界

本合同只覆盖批次 1.5 已存在的两个普通 Conversation OS 动作：

- `offer_emotional_support`
- `repair_previous_wording`

它不启用 Hill 目标或技术，不写入 `CommittedHelpingMove`，不进入批次 2，也不改变
Safety、直接回答、暂停、Grounding 和当前话题的既有优先级。

本合同解决的是“ResponsePlan 只给出动作名称和禁止项，却没有说明该动作必须完成什么
正向会话功能”的缺口。它不是回复模板，也不规定固定措辞。

## 2. 决策所有权

### 2.1 Response Planner

Response Planner 是正向功能的唯一决策者。每个相关 ResponsePlan 必须在生成前确定：

- 当前动作的证据目标；
- 必须完成的正向功能；
- 允许的可选延续；
- 完成条件；
- 禁止越过的边界。

Planner 不生成用户可见句子，也不选择 Hill 目标或技术。

### 2.2 Clinical compatibility advice

旧 Clinical advice 只能为 Planner 已选择的普通情绪或行动需要提供兼容性边界。它不能
把 `empathic_reflection` 之类的抽象意图直接当成 Surface 可执行功能，也不能成为第二
决策者。

普通关系修复继续不调用旧 Clinical advice。

### 2.3 Surface

Surface 只实现 ResponsePlan 已选择的正向功能。它不能：

- 自行选择支持方式；
- 用更重情绪制造共情；
- 用提问、建议、暂停、在场承诺或安慰替代计划功能；
- 因为语言更自然就改变动作或证据边界。

### 2.4 Validator

Validator 只判断计划功能是否完成和边界是否违反。它不能重新规划，也不能把固定词
是否出现当成功能本身。

实现采用唯一的 Planned Function Semantic Validation Boundary：只要 frozen
`ResponsePlan` 含 handoff 或 positive-function contract 就调用一次 strict JSON 语义门。
handoff 与 positive function 各自 exact-bind、各自提供 exact UTF-16 candidate evidence，
并在两支同时存在时取 AND；不存在的分支必须为 null。旧 handoff Validator 仅为兼容
委托，不保留第二套判断或第二次模型调用。

## 3. `offer_emotional_support` 正向合同

### 3.1 证据目标

计划必须引用当前用户消息中明确出现的情绪或关系影响。未被用户确认的原因、事件
评价、持续时间、情绪类别和强度不属于证据目标。

### 3.2 必须完成的功能

回复必须同时完成以下两部分：

1. **同强度承接**：贴住用户明确表达的情绪或关系影响，不增加新的情绪标签，不把
   即时感受改写为更持久或更严重的体验。
2. **一个可识别的支持功能**：Planner 必须从以下功能中选择恰好一个主要功能：
   - `reduce_expression_burden`：明确用户不需要说明原因、组织完整叙述或一次讲清；
   - `return_focus_control`：允许用户只触及自己当前最想表达的已知部分；
   - `return_amount_control`：允许用户决定表达多少，不索取完整经过；
   - `acknowledge_current_relational_impact`：仅在用户当前挑战助手、但没有足够相邻证据
     形成正式修复目标时，承认当前关系影响和信息边界，不宣称已经修复。

“听到了、我在、抱抱、按你的节奏、愿意聊聊”单独出现时不构成上述支持功能。
它们只有在明确附着于已选择的内容范围或表达负担时，才可能成为自然表达的一部分。

Planner 选择上述功能时必须使用当前轮证据，而不是把 `return_focus_control` 作为情绪
支持的默认值：显式“不分析／不解释原因”优先选择 `reduce_expression_burden`；显式
“说不清／不想多说”选择 `return_amount_control`；没有正式修复目标的助手关系挑战选择
`acknowledge_current_relational_impact`。只有当前轮存在至少两个不同的情绪或关系影响
证据目标时，才能选择 `return_focus_control`。单一情绪证据默认返回表达量控制，不得
制造“选哪一部分”或 A/B 选择任务，也不得把获得控制权写成必须继续或必须回答。

### 3.3 可选延续

只有 `questionPolicy` 允许时，才能在正向功能完成后增加至多一个低负担邀请。邀请只能
围绕“当前想先表达哪一部分或表达多少”，不能默认询问原因、触发事件、完整经过或
要求用户证明助手哪里没懂。

### 3.4 完成条件

同时满足以下条件才算完成：

- 回复中的情绪类别和强度有当前用户证据；
- 至少一个由 Planner 选择的支持功能被实现；
- 支持功能不是纯复述、纯收件、纯在场或纯问题；
- 没有未经请求的建议、调节、暂停、转移注意力或结束话题；
- 没有把用户的表达选择误判成情绪评价。

例如，附着于“是否继续表达、表达多少”的许可不是泛化安慰；Validator 不得因为其中
包含“没关系”就自动拒绝。反之，独立评价用户感受“没关系、很正常”仍不完成功能。

## 4. `repair_previous_wording` 正向合同

### 4.1 修复目标类型

Planner 必须在计划中明确修复目标属于哪一种：

- `factual_replacement`：助手弄错人物、事实或用户已经明确给出替代事实；
- `proposition_withdrawal`：助手加入了用户拒绝的情绪、强度、意图或解释；
- `interaction_move_withdrawal`：助手进行了用户拒绝的建议、提问、套话或话题切换。

Surface 不得自行推断修复类型。

### 4.2 所有修复的共同必需功能

- 明确把错误归于助手自己的上一行动、判断或措辞；
- 不辩护，不归咎用户，不要求用户诊断助手；
- 不宣称关系已经修复；
- 遵守 `questionPolicy`；
- 修复完成前不推进其他目标。

### 4.3 各类型的完成条件

#### `factual_replacement`

明确承担错误，并采用用户当前明确给出的替代事实，即可完成修复。此类回复不强制
额外出现“收回、撤回、不该”等固定词。

仅说“弄错了”而没有替换事实，或替换事实并非用户确认，均不完成。

#### `proposition_withdrawal`

必须明确撤回、否定或停止沿用被拒绝的命题。只有“理解偏了、用词重了、抱歉”而没
有处理具体命题，不完成修复。

#### `interaction_move_withdrawal`

必须明确停止或撤回被拒绝的互动动作，并恢复用户已经明确的当前主题或边界。只有
道歉、继续追问、换一个建议或重复“我会听”均不完成。

### 4.4 修复后的动作边界

修复状态排除并发情绪支持和行动支持。只有 ResponsePlan 独立包含一个仍待完成的普通
话题动作时，Surface 才能在完成修复后实现该动作；否则回复应在修复完成处停止。

## 5. Validator 功能判断合同

Validator 后续实现必须满足：

- 比较用户原词与回复中的情绪类别、强度和作用对象，而不是维护无限扩张的坏词表；
- 区分独立安慰和附着于表达选择的许可；
- 区分事实替换、命题撤回和互动动作撤回；
- 接受“承担错误＋用户确认替代事实”的事实型修复；
- 拒绝只有空泛承担、没有处理修复目标的回复；
- 一个输出可以同时报告多个真实功能失败，但不能用错误失败码掩盖真正原因；
- regeneration 仍使用同一个 ResponsePlan，不得重新解释或另选目标。

以上合同现由通用 positive-function verdict 覆盖，包括 identity 三种 mode、本节四种
support function 与 repair 三种 mode。malformed、extra/missing key、binding/evidence
mismatch、uncertain 和 provider failure 均 fail closed。该 verdict 不能改变 Safety、
Grounding、结构 preflight 或 question policy，也不能授予提问权限；正向功能是否完成不再
由中文完成短语或正则词表证明。

## 6. 实现前验收门

在修改代码前，本合同必须由用户明确验收。验收后，代码修改仍需先通过以下本地门，
才允许申请候选 3 的外部 60 轮运行：

1. 候选 2 的 25 次首次失败全部按冻结归因重放：
   - 18 条 `surface_failure` 必须被拒绝；
   - 6 条 `validator_false_positive` 必须被接受；
   - 1 条 `both` 必须因真实 Surface 缺陷被拒绝，但不得继续使用误伤许可语句的理由。
2. 至少新增 20 个未照抄候选 2 句子的正反例，覆盖正常、边缘、模糊、上下文切换和
   对抗情况。
3. 正例与反例必须共同通过，不能只追求降低 regeneration rate。
4. Safety、直接回答、暂停、Grounding、当前话题、普通交接及完整发布前回归通过。
5. 原 60 轮冻结数据、哈希和阈值保持不变。

## 7. 候选 3 与盲审边界

本合同通过和本地实现验收，不自动授权外部模型调用。候选 3 仍需单独批准 60 轮。

只有候选 3 同时通过原冻结门，才能生成新的人工盲审候选。任何失败都继续停留在
批次 1.5；不得修改原阈值，不得进入批次 2，不得按单个样本文案打补丁。
