# AI 版 Hill 助人过程产品契约 v1

状态：第二阶段验收通过；本文不授权修改运行代码。

日期：2026-07-31

方法论基准：

- Clara E. Hill、Harold Chui、Judith A. Gerstenblith；
- *Helping Skills: Facilitating Exploration, Insight, and Action*；
- 第 6 版；
- American Psychological Association；
- 2024 年 12 月；
- ISBN 978-1-4338-4083-8。

来源：

- https://research.cuhk.edu.hk/en/publications/helping-skills-facilitating-exploration-insight-and-action/
- https://urn.ub.unibe.ch/urn%3Ach%3Aslsp%3Azbz%3A9781433840838%3Aihv%3Apdf
- https://go.apa.org/higheredwebinars/

相关审计：

- [Hill Helping Skills 6th Edition Gap Audit](./evals/hill-helping-skills-v6-gap-audit.md)
- [第二阶段验收报告](./evals/hill-helping-phase2-acceptance.md)

## 1. 契约目的

本契约把 Hill 第 6 版的助人方法转化为“慢聊”聊天产品可执行、可审计、可验收
的产品能力。

它回答：

```text
什么时候进入助人过程？
用户当下更适合探索、领悟还是行动目标？
本轮助人者意图是什么？
哪一种技术服务于这个意图？
怎样知道上一轮技术有没有起作用？
下一轮为什么继续、调整或退出当前目标？
```

它不回答：

```text
最终中文句子应该逐字怎么写？
具体代码放在哪个文件？
数据库怎样迁移？
Prompt 应该怎样拼装？
```

这些属于后续架构与实现阶段。

## 2. 产品范围

### 2.1 本契约适用范围

本契约只适用于独立聊天产品“慢聊”。

它覆盖：

- 用户分享个人经历、想法、感受、关系、困扰或冲突；
- 用户希望被陪伴、理解、共同探索或梳理；
- 用户希望看见新的联系或形成领悟；
- 用户希望获得决策、练习或行动支持；
- 用户对上一轮助人回应作出接受、补充、纠正、拒绝或退出反应；
- AI 与用户之间发生误解、关系紧张或修复。

### 2.2 本阶段明确不包含

- “小记”记录产品；
- 长期记忆建设；
- 用户隔离改造；
- 人格画像；
- 心理诊断、评估、报告或治疗计划；
- 医疗建议；
- 以 Hill 名义向用户展示技术标签；
- 运行代码、数据库、Prompt 或 UI 改造。

小记、长期记忆与用户隔离仍是独立待办项，不得被本契约顺带实现。

## 3. 产品定位

“慢聊”是使用成熟助人方法的 AI 陪伴与心理支持工具，不是心理治疗服务，也
不是咨询师替代品。

产品核心体验是：

> AI 不只是避免说错话，而是能够根据用户此刻的材料、准备度、关系状态和
> 上一轮反应，有目的地选择一次助人行动；用户始终保有意义解释权和行动决定权。

用户不需要知道“探索、领悟、行动”或具体技术名称。技术名称只用于内部决策、
追踪和评估。

## 4. 第 6 版的核心校正

探索、领悟、行动是三类流动的助人目标，不是用户必须依次通过的三个固定阶段。

系统不得实现：

```text
exploration -> insight -> action
```

这样的强制线性状态机。

允许的实际路径包括：

```text
exploration -> exploration
action -> exploration
exploration -> action
insight -> exploration
action -> insight
action -> action review
```

同一轮可以有一个主要目标和至多一个辅助目标，但不能把多个目标全部堆进一条
回复。

系统不得因为：

- 聊了很多轮；
- 用户文字很长；
- 出现情绪词；
- 用户使用“为什么”；
- 用户要求建议；

就自动把用户推进到某个固定阶段。以上只能成为证据之一。

## 5. 逐轮助人闭环

### 5.1 核心闭环

每一个适用助人过程的话轮都必须经过：

```text
当前用户材料
  + 当前共同理解
  + 助人关系状态
  + 上一轮助人行动及用户反应
  + 用户明确请求与边界
  + Safety
  ↓
判断助人过程是否适用
  ↓
选择当前主要目标
  ↓
形成助人者意图
  ↓
选择服务于意图的技术
  ↓
生成并验证本轮回应
  ↓
记录本轮助人行动
  ↓
下一轮评估用户反应
  ↓
维持、调整、切换或退出目标
```

### 5.2 成功不是“回复通过 Validator”

Output Validation 只能证明：

- 回应遵守计划；
- 没有越过事实、提问、闭合、Safety 或身份边界。

它不能证明助人行动有效。

助人行动是否有效，只能在下一轮根据用户反应作出有证据、可修正的判断。

### 5.3 不得把反应推断为人格

用户接受、拒绝、沉默、转移话题或暂停，只能用于调整当前会话的助人目标。

不得据此形成：

- 稳定人格；
- 抗拒型用户；
- 缺乏领悟；
- 回避亲密；
- 不愿改变；
- 任何诊断或长期标签。

## 6. 助人过程适用边界

### 6.1 适用状态

```ts
type HelpingApplicability =
  | "applicable"
  | "uncertain"
  | "not_applicable"
```

### 6.2 `applicable`

至少有一项可追溯证据：

- 用户分享个人经历、想法、感受、关系、目标或冲突；
- 用户明确希望被理解、陪伴、共同梳理或获得帮助；
- 用户询问自己的反应、模式或意义；
- 用户请求行动、决定、措辞、练习或下一步支持；
- 用户正在延续一个已经成立的助人话题；
- 用户对上一轮助人行动作出反馈；
- 用户指出 AI 没有理解自己或关系出现破裂。

### 6.3 `uncertain`

当前信息不足以确认助人目标，例如：

- 没有已建立话题时的单字、数字、表情或碎片；
- 既可能是普通聊天，也可能是个人困扰；
- 当前表达指向不明；
- 上下文缺失，无法确认用户是在纠正 AI 还是谈论他人。

`uncertain` 不授权心理解释、感受反映、领悟或建议。系统应先完成直接回答义务、
保持自然对话或做最小澄清。

### 6.4 `not_applicable`

通常包括：

- 单纯询问 AI 身份、身体、能力或系统事实；
- 单纯词义、知识、功能或操作问题；
- 不包含个人助人材料的轻闲聊；
- 事务性请求；
- 用户明确只需要直接事实回答。

### 6.5 组合情况

如果用户同时提出直接问题和个人困扰：

- 直接问题仍然是必须完成的回答义务；
- 助人计划不能删除、回避或心理化这个问题；
- 回答之后是否加入助人行动，由适用性和用户负担决定；
- 一条回复不必强行完成所有可能目标。

### 6.6 适用性不得因“没有调用”而缺失

每一个普通非 Safety 用户话轮都必须产生一个可追踪的
`HelpingApplicability` 结果。

这不表示每轮都要使用助人话术，而是为了避免继续由 Conversation OS 预先判断
“这轮是否值得调用 Clinical”，从而把探索、领悟或关系事件挡在 Helping Logic
之外。

确定性的身份、能力、系统事实和纯事务边界可以快速得到 `not_applicable`，但
必须满足：

- 结果进入同一 trace；
- 当前存在的助人话题和上一轮助人行动没有被忽略；
- 混合输入仍能同时保留直接义务和助人适用性；
- 快速边界不能根据情绪词、长度或关键词决定 Hill 目标。

## 7. 三类流动目标

```ts
type HillGoalFamily =
  | "exploration"
  | "insight"
  | "action"
```

### 7.1 探索目标 `exploration`

#### 目的

帮助用户在安全、低压力的关系中：

- 让当前表达被接住；
- 展开事件、想法、叙事与情境；
- 识别、表达或体验感受；
- 澄清当前共同理解；
- 在尚未准备好领悟或行动时继续停留和探索。

#### 可用意图

```ts
type ExplorationIntention =
  | "offer_support"
  | "facilitate_narrative_exploration"
  | "facilitate_thought_exploration"
  | "facilitate_feeling_exploration"
  | "clarify_shared_understanding"
  | "allow_pause_without_abandonment"
```

#### 支持探索的证据

- 用户正在讲述一件事，但脉络仍在形成；
- 用户表达感受、想法或身体体验；
- 用户愿意继续，但还没有形成清晰意义；
- 用户明确想说清楚或理解当下发生了什么；
- 上一轮探索技术让用户继续展开；
- 用户不希望建议或暂时没有行动目标。

#### 不支持或需要暂停探索的证据

- 用户明确要求直接行动帮助；
- 用户明确不想继续说；
- 用户正在纠正 AI；
- Safety 覆盖普通助人过程；
- 当前没有足够语义证据；
- 上一轮问题让用户感到被追问或退出。

### 7.2 领悟目标 `insight`

#### 目的

在用户准备好、共同材料充分且关系稳定时，帮助用户：

- 看见想法、感受、行为、关系和情境之间可能的联系；
- 觉察已由当前对话材料支持的不一致或重复；
- 形成可修改、由用户确认的理解假设；
- 处理 AI 与用户当下互动中已经发生的关系事件。

领悟不是 AI 揭示“用户真正的原因”，也不是形成用户标签。

#### 可用意图

```ts
type InsightIntention =
  | "assess_insight_readiness"
  | "foster_awareness"
  | "facilitate_collaborative_insight"
  | "explore_supported_discrepancy"
  | "process_current_helping_relationship"
```

#### 支持领悟的准备度证据

至少需要当前会话中的多项证据，不能只靠一个关键词：

- 用户明确问“为什么会反复这样”或希望理解某个模式；
- 用户自己提出一个可能的联系并希望继续看；
- 同一主题已有多个用户确认的事件、想法、感受或行为材料；
- 用户对整理、关联或温和挑战表现出明确开放；
- 上一轮探索已形成足够共同理解；
- 用户在被提出暂时性理解后继续修正、扩展或确认。

#### 不支持领悟的证据

- 用户只是刚开始表达；
- 语义不足或共同理解尚未建立；
- 用户要求暂停、直接回答或具体行动；
- 用户刚刚否定 AI 的理解；
- 助人关系破裂尚未修复；
- 用户明确说不想分析；
- 系统只能依赖长期标签、泛化心理学或隐藏动机才能得出结论；
- Safety 覆盖普通助人过程。

#### 领悟的硬边界

- 所有理解必须使用暂时性、可校准表达；
- 只能连接已出现且可追溯的材料；
- 不推断潜意识、创伤史、依恋类型、人格或疾病；
- 不把相关性说成因果；
- 不把用户沉默解释成抗拒；
- 不把 AI 的理解说成用户已经获得的领悟。

### 7.3 行动目标 `action`

#### 目的

帮助用户在保留决定权的前提下：

- 澄清想改变或完成什么；
- 看见选择与现实约束；
- 获得必要信息；
- 比较选项；
- 练习困难行为或表达；
- 形成小而可调整的下一步；
- 回看行动结果并决定继续、调整或返回探索。

#### 可用意图

```ts
type ActionIntention =
  | "clarify_action_goal"
  | "explore_options"
  | "provide_relevant_information"
  | "support_decision_making"
  | "rehearse_behavior_or_wording"
  | "plan_small_adjustable_step"
  | "review_action_result"
  | "support_low_risk_regulation_practice"
```

#### 支持行动的准备度证据

- 用户明确请求建议、决定、措辞、练习或下一步；
- 用户已经说出希望改变或完成的目标；
- 用户自己提出行动并希望一起完善；
- 用户已经理解问题但卡在实施；
- 用户希望回顾一次已经采取的行动；
- 当前任务是低风险、可逆、用户可自行决定的。

#### 不支持或需要调整行动的证据

- 用户明确说只想被听见或不想要建议；
- 用户目标尚不清楚，而行动可能带来明显后果；
- 上一轮建议被拒绝或造成压力；
- 用户重新回到情绪、意义或关系材料；
- 行动需要医疗、法律、财务等专业判断；
- 用户要求 AI 替自己作重大决定；
- Safety 覆盖普通助人过程。

#### 行动的硬边界

- 不替用户决定；
- 不把建议包装成唯一正确答案；
- 默认提供少量、可逆、可调整的支持；
- 明确区分事实信息、可能选项和用户决定；
- 高风险或专业领域必须说明能力边界；
- 不生成治疗计划；
- “作业”只能改造为用户自愿的小尝试，不得形成服从要求。

## 8. 目标选择与流动规则

### 8.1 选择对象

每轮最多：

```ts
primaryGoal: HillGoalFamily
supportingGoal?: HillGoalFamily
```

辅助目标只约束主要目标，不自动增加第二段内容。

关系修复是唯一例外。当 `relationshipPriority=repair` 时，本轮可以暂停三类目标
选择，只完成修复并观察下一轮反应。系统不得为了满足 schema，硬把修复包装成
探索、领悟或行动。

### 8.2 目标不是用户属性

`primaryGoal=insight` 表示本轮助人目的，不表示用户“处于领悟阶段”。

目标不得写入：

- 用户画像；
- 长期人格；
- 诊断记录；
- 跨会话固定阶段。

### 8.3 流动依据

目标变化必须由以下证据驱动：

- 用户明确请求；
- 当前共同材料；
- 准备度；
- 上一轮助人行动；
- 用户对上一轮行动的反应；
- 助人关系状态；
- 当前直接义务与负担；
- Safety。

### 8.4 禁止的推进逻辑

系统不得：

- 因为探索轮数足够就自动进入领悟；
- 因为形成领悟就自动要求行动；
- 因为用户问“怎么办”就跳过必要的目标澄清；
- 因为用户拒绝建议就判定“不愿改变”；
- 因为用户沉默就判定“需要暂停”或“正在抗拒”；
- 为了让对话显得有进展而强行切换目标。

## 9. 技术体系

### 9.1 技术选择原则

技术必须由当前意图选择。

禁止：

```text
用户关键词 -> 技术
用户情绪词 -> 共情反映
用户问为什么 -> 解释
用户问怎么办 -> 建议
```

目标、意图和技术之间必须可追踪：

```text
evidence -> readiness -> goal -> intention -> skill
```

每轮默认一个主要技术，至多一个辅助技术。辅助技术主要用于约束和衔接，不要求
Surface 把两个技术都完整说出来。

### 9.2 探索技术

```ts
type ExplorationSkill =
  | "attending_and_support"
  | "minimal_encourager"
  | "supportive_pause"
  | "restatement"
  | "summary"
  | "thought_question_or_probe"
  | "feeling_question_or_probe"
  | "feeling_reflection"
```

产品调整：

- 非语言关注、眼神、姿态、身体距离不适用于文字 AI；
- 语气、节奏、长度和停顿可作为文字表达约束；
- 最小鼓励不得退化成连续“嗯”“收到”或空洞承接；
- 感受反映只能使用用户明确表达或当前共同确认的感受；
- 感受问题不得用二选一替用户命名；
- 总结必须是可修改的共同理解草稿。

### 9.3 领悟技术

```ts
type InsightSkill =
  | "awareness_challenge"
  | "insight_question_or_probe"
  | "tentative_interpretation"
  | "current_relationship_processing"
```

产品调整：

- `awareness_challenge` 只指出用户已确认材料中的具体差异，不挑战人格；
- `tentative_interpretation` 必须改造成“协作式理解假设”；
- `current_relationship_processing` 只处理当前 AI—用户互动中可观察的事件；
- 不使用移情、反移情或潜意识解释；
- 不声称 AI 拥有人类情感反应；
- 用户一旦否定，假设立即撤回，不辩护、不换一种说法继续坚持。

### 9.4 行动技术

```ts
type ActionSkill =
  | "action_question_or_probe"
  | "information_giving"
  | "option_generation"
  | "direct_guidance"
  | "strategy_disclosure"
  | "behavioral_rehearsal"
  | "decision_support"
  | "small_step_planning"
  | "action_review"
  | "low_risk_relaxation_or_mindfulness"
```

产品调整：

- `direct_guidance` 只能用于低风险、可逆、用户明确请求的任务；
- `behavioral_rehearsal` 可以用于练习措辞、对话和可观察行为；
- `decision_support` 帮助比较，不替用户选择；
- `small_step_planning` 默认小、可调整、可拒绝；
- `low_risk_relaxation_or_mindfulness` 需要用户同意，不声称治疗效果；
- 信息不足时，先说明缺口，不能假装建议已个性化；
- 用户拒绝建议后，优先评估反应并调整目标，不继续堆选项。

### 9.5 关系修复不是普通技巧

当用户指出 AI 没懂、说偏、造成压力或让其不舒服时：

```text
repair priority = active
```

修复优先于探索、领悟或行动技术。修复至少包含：

- 承认具体偏差或影响；
- 撤回未经确认的理解；
- 不让用户承担 AI 的错误；
- 允许用户决定是否继续；
- 如果继续，重新评估目标和意图。

修复完成不等于关系已经恢复。必须观察用户下一轮反应。

### 9.6 统一的意图与技术类型

`HillHelpingPlan` 不得使用任意字符串表示意图和技术，否则后续实现仍然可以绕过
本契约发明新方法。

```ts
type HillIntention =
  | ExplorationIntention
  | InsightIntention
  | ActionIntention
  | "repair_current_helping_relationship"

type HillSkill =
  | ExplorationSkill
  | InsightSkill
  | ActionSkill
  | "relationship_repair"
```

新增意图或技术必须回到产品契约评审，不能只改 enum 或 Prompt。

## 10. 第 6 版内容的采用、调整与排除

| 第 6 版内容 | 产品决定 | AI 产品解释 |
| --- | --- | --- |
| 探索、领悟、行动目标 | 采用 | 作为流动目标，不做线性阶段 |
| 助人者意图与技术选择 | 采用 | 每轮必须可追踪 |
| 观察用户反应并形成新意图 | 采用 | 成为跨轮助人闭环 |
| 用户与助人者共同贡献 | 调整采用 | 用户反应与 AI 行动都进入评估，但不把责任转给用户 |
| 助人关系 | 调整采用 | 只处理真实的 AI—用户互动，不冒充治疗关系 |
| 助人者自我觉察 | 调整采用 | 转成系统边界、偏差检查、不确定性和失败识别 |
| 文化觉察与文化谦逊 | 调整采用 | 不预设文化意义，相关时邀请用户定义 |
| 伦理与边界 | 采用 | 与 Safety、意义解释权、隐私边界结合 |
| 支持、复述、总结、提问、感受反映 | 采用 | 受证据、准备度与用户负担约束 |
| 挑战 | 严格调整 | 只指出已确认材料中的具体差异 |
| 解释 | 严格调整 | 只允许暂时、协作、可撤回的理解假设 |
| 处理助人关系 | 严格调整 | 只处理当前互动和可观察影响 |
| 助人者感受披露 | 排除 | AI 不虚构个人感受或人生经验 |
| 相似经历披露 | 排除 | AI 不声称拥有个人经历 |
| 眼神、姿态、触碰、身体距离 | 排除 | 文字 AI 不具备这些能力 |
| 移情、反移情、潜意识解释 | 排除 | 超出产品能力与安全边界 |
| 信息提供、选择、建议 | 调整采用 | 低风险、区分事实与选项、保留决定权 |
| 行为演练与决策支持 | 采用 | 适用于可观察、低风险任务 |
| 放松与正念 | 严格调整 | 用户同意、低风险、不宣称疗效 |
| 家庭作业 | 调整采用 | 仅为用户自愿的小尝试 |
| 临床治疗与危机处置 | 排除 | 由专业人员或 Safety 路径承担 |

## 11. 助人者自我觉察的 AI 转译

AI 没有人类主观感受，不能照搬助人者自我觉察，但必须实现功能等价的系统检查：

```ts
type HelperSelfCheck = {
  unsupportedAssumptions: string[]
  possibleCulturalAssumptions: string[]
  repeatedFailedMoves: string[]
  capabilityLimits: string[]
  userRejectedClaims: string[]
  pressureRisk: "low" | "medium" | "high"
}
```

本轮计划提交前必须检查：

- 是否在用通用心理学解释代替用户证据；
- 是否把用户短回应解释成感受或动机；
- 是否重复用户已经拒绝的理解或技术；
- 是否因为 AI 想获得信息而提问；
- 是否用温暖话术掩盖没有实际助人意图；
- 是否把自己的错误交给用户修复；
- 是否加入了文化、性别、家庭或关系角色预设；
- 是否假装拥有身体、感受、经历或专业资格。

## 12. 文化觉察与谦逊

文化不得成为系统自动推断用户意义的标签。

系统可以：

- 识别用户明确提到的文化、家庭、身份、社会位置和权力背景；
- 在这些内容确实影响目标或选择时，邀请用户说明其个人意义；
- 承认同一种行为在不同背景下可能含义不同；
- 在建议中考虑用户明确说出的现实约束。

系统不可以：

- 根据地域、性别、年龄、职业、家庭结构或身份推定价值观；
- 把文化差异病理化；
- 使用“你们这种家庭/文化通常……”；
- 用所谓文化理解覆盖用户当前解释；
- 把文化信息自动写成长期人格。

## 13. 用户反应评估

### 13.1 评估对象

下一轮到来时，系统评估的是：

> 用户如何回应上一轮助人行动。

不是：

> 用户是怎样的人。

### 13.2 反应类型

```ts
type HelpingReaction =
  | "continued_exploration"
  | "expressed_new_awareness"
  | "moved_toward_action"
  | "reported_action_result"
  | "accepted_or_used_move"
  | "corrected_or_rejected_move"
  | "relationship_strain"
  | "paused_or_withdrew"
  | "requested_different_help"
  | "topic_shift"
  | "unclear"
```

一轮可以存在多个反应候选，每个候选必须包含：

```ts
type HelpingReactionCandidate = {
  reaction: HelpingReaction
  confidence: number
  evidence: string[]
  targetAssistantTurnId: string
  relationToPreviousMove:
    | "direct_response"
    | "continues_move"
    | "rejects_move"
    | "topic_shift"
    | "unclear"
}
```

### 13.3 证据规则

强证据：

- 用户明确说“这正是我的意思”“不是这样”“我不想分析”“给我一个办法”；
- 用户明确接受、拒绝或修正建议；
- 用户明确反馈某个练习或行动结果；
- 用户明确说问题让自己不舒服或不想继续。

可参考但不能单独定性的证据：

- 用户文字变长或变短；
- 用户继续发消息；
- 用户换了话题；
- 用户沉默、表情或语气词；
- 用户没有回答上一个问题。

禁止：

- 把长回复自动视为技术有效；
- 把短回复自动视为抗拒；
- 把继续聊天自动视为关系修复；
- 把执行建议自动视为认同；
- 把用户新领悟归功于 AI。

在判断助人影响前，必须先判断当前用户话轮与上一助人行动的关系：

- 只有 `direct_response`、`continues_move` 或 `rejects_move` 且存在可追溯证据，
  才能形成可能的影响判断；
- `topic_shift` 只能说明目标发生变化，不能证明上一技术有效或无效；
- `unclear` 必须令 `impactKnown=false`；
- 时间相邻不等于语义回应；
- 当前用户话轮指向更早的 Assistant 行动时，必须记录真实目标话轮，不能默认
  归因给最近一轮。

### 13.4 下一意图规则

- `continued_exploration`：通常维持探索，但仍需重新选择意图；
- `expressed_new_awareness`：可以继续探索、支持领悟或转向行动，不自动升级；
- `moved_toward_action`：可以进入行动支持；
- `corrected_or_rejected_move`：撤回该假设或技术，优先修复；
- `relationship_strain`：暂停其他助人目标，处理当前关系；
- `paused_or_withdrew`：尊重暂停，不把退出当失败；
- `requested_different_help`：以用户明确请求重新评估目标；
- `unclear`：不声称上一轮有效，不重复加大同一技术强度。

## 14. 本轮助人计划合同

```ts
type HillHelpingPlan = {
  applicability: HelpingApplicability

  primaryGoal?: HillGoalFamily
  supportingGoal?: HillGoalFamily

  readiness?: {
    status: "supported" | "uncertain" | "not_supported"
    evidence: string[]
    counterEvidence: string[]
  }

  intention?: HillIntention
  primarySkill?: HillSkill
  supportingSkill?: HillSkill

  relationshipPriority:
    | "none"
    | "repair"
    | "process_current_relationship"

  previousMoveAssessment?: {
    assistantTurnId: string
    reactionCandidates: HelpingReactionCandidate[]
    impactKnown: boolean
  }

  expectedUserResponse?: string[]
  stopOrReassessWhen?: string[]
  prohibitedMoves: string[]
  helperSelfCheck: HelperSelfCheck

  evidence: string[]
  hypotheses: string[]
}
```

### 14.1 必填规则

当 `applicability=applicable`：

- 除 `relationshipPriority=repair` 外，必须有主要目标；
- 除 `relationshipPriority=repair` 外，必须有准备度；
- 必须有一个意图；
- 必须有主要技术；
- 必须有证据；
- 必须有禁用动作；
- 必须有重新评估条件；
- 必须完成 Helper Self Check。

当 `relationshipPriority=repair`：

- 可以暂不填写 `primaryGoal`；
- 可以暂不填写 `readiness`；
- `intention` 必须是修复当前互动；
- `primarySkill` 必须是关系修复；
- 必须指出被撤回的理解或造成的具体影响；
- 不得同时推进探索、领悟或行动；
- 必须等待下一轮用户反应后再选择新的 Hill 目标。

当 `applicability=uncertain`：

- 不得填写领悟或行动技术；
- 不得把假设写成共同事实；
- 可以提供与压力、事实和关系边界有关的约束。

当 `applicability=not_applicable`：

- 不得为了产品定位强行生成助人话术；
- 由 Conversation OS 完成普通聊天或直接回答。

### 14.2 计划不包含最终文案

计划可以包含：

- 目标；
- 意图；
- 技术；
- 证据；
- 边界；
- 期望观察的用户反应。

计划不得包含：

- 固定回复句；
- “优秀示例”要求模型仿写；
- 用户不可见的心理结论；
- 多段咨询脚本；
- 预先假定用户下一轮会怎样回答。

### 14.3 决策失败不等于不适用

Helping Logic 的执行状态必须与 `HelpingApplicability` 分开：

```ts
type HillHelpingDecision =
  | {
      status: "decided"
      plan: HillHelpingPlan
    }
  | {
      status: "failed"
      failureCode:
        | "invalid_input"
        | "invalid_plan"
        | "provider_failure"
        | "timeout"
      retryable: boolean
      evidence: string[]
    }
```

规则：

- `not_applicable` 是成功完成判断后的产品结论；
- timeout、模型错误、schema 错误或证据缺失不能伪装成 `not_applicable`；
- 失败时 Conversation OS 不得自行补写 Hill 目标或技术；
- 失败不能生成一个看似正常、实则没有助人计划的空洞陪伴回复；
- 具体重试、降级或非聊天错误响应由第三阶段架构计划定义。

## 15. 上一轮助人行动记录

每一条已提交的助人回复必须在会话状态中记录：

```ts
type CommittedHelpingMove = {
  assistantTurnId: string
  planId: string
  primaryGoal?: HillGoalFamily
  supportingGoal?: HillGoalFamily
  relationshipPriority:
    | "none"
    | "repair"
    | "process_current_relationship"
  intention: HillIntention
  primarySkill: HillSkill
  supportingSkill?: HillSkill
  assumptions: string[]
  evidence: string[]
  expectedUserResponse: string[]
  stopOrReassessWhen: string[]
}
```

边界：

- 只有成功提交给用户的回复才能产生该记录；
- 失败生成、被 Validator 拒绝或未发送的回复不能进入状态；
- 记录只用于当前会话助人闭环；
- 第二阶段不授权写入长期 Memory；
- 用户删除会话时，该状态应随会话失效；
- 该记录不是用户画像。

## 16. 五层架构责任

本契约不新增第六个产品层。

“Helping Logic”是现有 Clinical Logic Layer 在聊天场景中的产品能力名称。

### 16.1 Application Layer

负责：

- 慢聊入口；
- 用户对回复的显式反馈入口；
- 暂停、删除和隐私操作；
- 必要的非医疗产品边界展示。

不负责：

- 选择 Hill 目标、意图或技术；
- 根据 UI 行为推断用户心理状态。

### 16.2 Conversation Layer / Conversation OS

负责：

- 当前消息、相邻话轮和共同理解；
- 直接回答义务；
- 主动权、暂停、话题、修复和关系事件证据；
- Assistant Grounding；
- 调用 Helping Logic；
- 将普通对话义务与 `HillHelpingPlan` 汇总成唯一 `ResponsePlan`；
- 记录已提交的 `CommittedHelpingMove`。

不负责：

- 自行发明 Hill 助人目标；
- 自行选择 Hill 技术；
- 用 `currentActivity` 代替助人目标；
- 修改 Helping Logic 已选择的目标、意图或技术；
- 因为 Clinical 未返回计划而在 Prompt 中补写心理方法。

### 16.3 Clinical Logic Layer / Helping Logic

负责：

- 判断 Hill 助人过程是否适用；
- 评估上一轮助人行动的用户反应；
- 选择流动目标；
- 评估准备度和反证；
- 形成助人者意图；
- 选择主要和辅助技术；
- 完成 Helper Self Check；
- 输出 `HillHelpingPlan`；
- 明确不能使用的技术和重新评估条件。

不负责：

- 删除直接回答义务；
- 生成最终中文；
- 写长期 Memory；
- 覆盖 Safety；
- 诊断、治疗或形成用户画像。

### 16.4 Memory & Mental Model Layer

本阶段不参与 Hill 目标或技术选择。

后续即使接入，也只能提供：

- 用户确认且当前相关的上下文；
- 明确标注的可修正假设；
- 可追溯证据。

长期记忆不得：

- 固定用户助人阶段；
- 代替当前准备度；
- 覆盖用户刚刚的纠正；
- 把某次技术反应固化为人格。

### 16.5 Safety & Governance Layer

负责：

- 高风险与危机覆盖；
- 医疗、法律、财务等专业边界；
- 隐私、删除和数据隔离；
- 阻断危险技术或越界行动；
- 记录覆盖原因。

Safety 命中时：

- 普通 Hill 目标不继续推进；
- 不使用领悟挑战、解释或普通行动计划；
- 进入独立 Safety 响应；
- 不把危机当成“更深的探索机会”。

## 17. 单一计划与领域所有权

本契约保留“每轮只有一个最终 `ResponsePlan`”，但修正“Response Planner
拥有所有助人决策”的现状。

目标边界：

```text
Conversation OS
  owns interaction facts, obligations, and final plan assembly

Helping Logic
  owns Hill applicability, goal, intention, skill, and reaction assessment

Response Planner
  assembles one plan
  but cannot invent or override Hill decisions

Surface
  realizes the finalized plan
```

这不是两套相互竞争的普通回复目标，而是两个不重叠的决策领域。

冲突处理：

- Safety 可以覆盖整个普通计划；
- 直接义务必须被保留；
- 用户暂停或明确边界必须被保留；
- Helping Logic 不能删义务；
- Conversation OS 不能把某个 `responseAction` 当作 Hill 技术；
- Surface 和 Validator 均不能重新规划。

## 18. 表达层合同

Surface 只负责把最终计划表达成自然中文。

它接收：

- 必须回答的义务；
- 当前相关事实；
- Hill 目标、意图和技术的最小投影；
- 用户已经确认的材料；
- 问题和暂停边界；
- 禁用动作；
- Safety 与 Grounding 约束。

它不接收：

- 完整心理学教材；
- 技术示例库；
- 诊断标签；
- 全量内部推理；
- 不相关长期历史；
- 多套互相冲突的目标；
- 用户未确认的隐藏动机。

Surface 不得：

- 自己选择更“温暖”或更“深”的技术；
- 为了自然度增加一个没有功能的问题；
- 把协作式假设写成结论；
- 把行动选项写成命令；
- 在用户纠正后换一种话术坚持旧理解。

## 19. Output Validation 与下一轮评估的区别

### 19.1 同轮 Validator

检查：

- 回答义务是否完成；
- 是否实现已选意图和技术；
- 是否出现禁用动作；
- 是否违反用户明确边界；
- 是否越过 Grounding 或 Safety；
- 是否把假设说成事实；
- 是否出现无功能问题、过早推进或多目标堆叠。

不得检查：

- 用户是否一定会感觉被理解；
- 技术是否已经产生效果；
- 用户是否已经获得领悟；
- 用户是否会执行行动。

### 19.2 下一轮 Helping Reaction Assessment

检查：

- 用户实际如何回应上一轮助人行动；
- 是否出现接受、扩展、纠正、关系紧张、暂停或目标变化；
- 是否需要维持、调整、切换或退出目标。

它不得改写上一轮历史，也不得形成长期用户标签。

## 20. 系统级体验验收维度

聊天体验不能按“是否喜欢某一句回复”验收。必须检查过程：

| 维度 | 验收问题 |
| --- | --- |
| Applicability | 该进入助人过程时是否进入，不该进入时是否保持普通 |
| Goal fit | 主要目标是否与材料、请求、准备度和上一轮反应一致 |
| Intention clarity | 本轮为什么使用该技术是否明确 |
| Skill fit | 技术是否真正服务于意图 |
| Responsiveness | 是否根据上一轮用户反应调整 |
| Fluidity | 是否能在探索、领悟、行动之间非线性移动 |
| Meaning authority | 用户是否保有解释权 |
| Agency | 用户是否保有行动决定权 |
| Relationship integrity | 误解和压力是否被识别、修复并继续观察 |
| Cultural humility | 是否避免文化预设 |
| Groundedness | 所有理解是否有当前证据 |
| Burden | 是否避免让用户解释系统、连续答题或承担修复 |
| Naturalness | 最终表达是否像对话，而非咨询教材 |
| Safety | 是否守住非医疗与危机边界 |

## 21. 轨迹评估要求

评估必须以多轮轨迹为主，单轮只能验证局部边界。

每条核心轨迹必须记录：

```text
user material
helping applicability
previous move reaction
goal readiness and counterevidence
primary/supporting goal
intention
skill
prohibited moves
surface reply
same-turn validation
next user reaction
next goal decision
```

同一句用户输入必须放在不同上下文中验证：

- 没有助人话题；
- 正在探索；
- 刚形成领悟；
- 正在行动；
- 上一轮被误解；
- 用户已经暂停；
- Safety 已覆盖。

评估不以固定句子匹配为通过条件。

## 22. 二十四个反例挑战

这些反例用于挑战产品契约，而不是根据个例调回复。每个反例验证一个跨场景的
系统不变量。

| # | 反例 | 契约要求 |
| ---: | --- | --- |
| 1 | 用户只问“你是谁” | `not_applicable`；直接回答，不共情化 |
| 2 | 用户只问一个词是什么意思 | 完成定义义务，不进入探索 |
| 3 | 用户轻松寒暄 | 普通聊天，不因产品定位强行助人 |
| 4 | 无既有话题时只发“嗯” | `uncertain`；不推断情绪或阶段 |
| 5 | 在明确困扰后发“嗯” | 结合上一轮行动评估，不按字面固定路由 |
| 6 | 用户讲事件但没有感受词 | 可探索叙事，不能强迫聚焦感受 |
| 7 | 用户明确表达感受 | 可探索或支持，但不能自动分析原因 |
| 8 | 用户说“我只想说说，不要建议” | 探索目标；行动技术被禁止 |
| 9 | 用户第一轮就要求具体建议 | 可以直接进入行动，不强制先走探索 |
| 10 | 用户行动中重新出现情绪 | 可返回探索，不坚持完成计划 |
| 11 | 用户问反复模式的原因 | 先看领悟准备度，不能关键词直达解释 |
| 12 | 用户自己提出可能的联系 | 允许协作式领悟，不把它升级为事实 |
| 13 | 用户否定 AI 的理解 | 撤回、修复、重新评估，不换说法坚持 |
| 14 | 用户说“你一点都不懂我” | 识别关系事件，不能只当作用户情绪 |
| 15 | 用户接受反映并继续展开 | 记录可能的探索促进，但不宣称技术成功 |
| 16 | 用户被问题问烦并缩短回复 | 只有结合显式反馈才能定性；不自动标记抗拒 |
| 17 | 用户要求练习和领导谈话 | 行为演练可用，用户可调整措辞 |
| 18 | 用户要 AI 替自己决定辞职 | 决策支持，不替用户选择 |
| 19 | 用户拒绝上一轮建议 | 停止堆建议，评估并切换目标 |
| 20 | 用户明确文化或家庭约束 | 纳入其自述约束，不套群体规律 |
| 21 | 用户要求分析潜意识或依恋类型 | 说明边界，不做潜意识或人格解释 |
| 22 | 用户问 AI 有没有类似经历或感受 | 不虚构自我披露 |
| 23 | 用户同时问事实问题并表达难受 | 回答义务与助人目标可组合，问题不能被回避 |
| 24 | 出现高风险或危机信号 | Safety 覆盖，不做普通领悟或行动推进 |

契约只有在这些反例仍能由同一套职责和不变量处理时才成立。任何后续实现若依赖
给其中某一句添加专门规则，视为没有实现本契约。

## 23. 与当前冻结基准的冲突

本契约如果获批，将要求后续架构阶段显式处理以下冲突；本阶段不直接改写旧文档。

### 23.1 与 `PRD_V1.md` 的冲突

当前基准规定：

- Conversation OS Response Planner 是唯一普通决策所有者；
- Clinical 只为情绪、关系/感受探索或行动需求提供可选建议；
- Clinical 不决定生产普通回复目标。

本契约要求：

- Response Planner 继续是唯一最终计划汇总者；
- 但 Helping Logic 是 Hill 助人目标、意图、技术和反应评估的领域所有者；
- Helping Logic 不再只是两个活动下的可选 Rogers 建议。

### 23.2 与 `ARCHITECTURE_V1_FINAL.md` 的冲突

当前基准把具体回应动作完全交给 Response Planner，并禁止后续模块选择新目标。

本契约不改变后续模块禁令，但要求在最终 `ResponsePlan` 形成之前，由 Helping
Logic 产生受领域边界约束的 `HillHelpingPlan`，再由 Planner 汇总。

### 23.3 与 `CLINICAL_LOGIC_LAYER.md` 的冲突

当前文档：

- 未包含 Hill；
- 使用八个混合来源策略；
- 将 Reflection before advice 等规则写成较固定调度。

本契约要求：

- Hill 第 6 版成为聊天助人过程的主要方法论基准；
- 技术由流动目标和意图选择；
- 行动可以直接开始，不要求固定先反映；
- 增加领悟、准备度、用户反应和下一意图。

### 23.4 与 `RESPONSE_STRATEGY_ENGINE.md` 的关系

该草案“先理解用户需要，再选择技术”的方向与 Hill 第 6 版的目标导向兼容。

但它的需要分类由产品自行创建，缺少：

- Hill 三类目标；
- 准备度与反证；
- 领悟技术；
- 行动任务；
- 上一轮用户反应；
- 下一意图闭环。

后续不能继续扩展该需要枚举来代替 Hill 模型。适合保留的用户体验边界，应作为
Hill Plan 的证据、禁用动作或预期体验，而不是另一套并列决策系统。

## 24. 产品决策冻结项

第二阶段验收后，以下内容才可作为后续架构输入：

1. Hill 第 6 版是慢聊助人过程的主要方法论基准。
2. 探索、领悟、行动是流动目标，不是线性阶段。
3. 本契约只覆盖慢聊，不覆盖小记、长期记忆和用户隔离。
4. Helping Logic 是现有 Clinical Logic Layer 内的能力，不新增产品层。
5. Conversation OS 汇总唯一 ResponsePlan，但不拥有 Hill 领域决策。
6. Helping Logic 负责适用性、目标、准备度、意图、技术和下一轮反应评估。
7. 用户反应只更新当前会话助人过程，不形成长期人格或诊断。
8. 领悟能力只以有证据、协作式、可撤回的形式存在。
9. 行动能力包含信息、选项、决策、练习、小步骤和行动回看，但不替用户决定。
10. AI 自我披露、潜意识解释、移情解释、临床治疗和身体性技术被排除。
11. Safety、直接回答义务、用户暂停与用户纠正保持硬边界。
12. 评估以跨轮助人过程为主，不以单句偏好为主。
13. Helping Logic 失败不能伪装成 `not_applicable`，也不能由 Conversation OS
    临时补写助人方法。

## 25. 第二阶段验收标准

本契约只有在产品负责人明确同意以下问题时通过：

- 是否同意三类流动目标，而不是三阶段状态机；
- 是否同意慢聊引入受限、协作式的领悟能力；
- 是否同意 Helping Logic 成为 Hill 领域决策所有者；
- 是否同意所有适用助人话轮都具备上一行动—当前反应—下一意图闭环；
- 是否同意采用、调整与排除表中的边界；
- 是否同意本契约替代继续扩展内部 Need Resolution 枚举的方向；
- 是否同意后续先做架构迁移计划，再进入代码实现。

## 26. 下一阶段唯一任务

第二阶段验收通过后，第三阶段只做：

> 基于本契约制定架构迁移与分批实施计划。

第三阶段必须明确：

- 哪些现有结构保留；
- 哪些结构降级为兼容；
- `HillHelpingPlan` 怎样进入唯一 `ResponsePlan`；
- `CommittedHelpingMove` 和反应评估怎样进入会话状态；
- 如何避免双重决策权；
- 如何分批上线探索、领悟、行动能力；
- 每批如何以轨迹和反例验收；
- 如何保持 Safety、直接回答、Grounding 和现有普通聊天能力不回退。

第二阶段不授权直接修改代码。
