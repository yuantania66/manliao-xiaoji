# Clinical Logic Layer

状态：Hill 目标合同已批准；批次 1 Shadow 于 2026-08-01 技术验收通过；Batch 2A `B2-Contract` 与 Batch 2B fixture-only association gate 于 2026-08-04 通过

日期：2026-08-01

## Approved Target Contract

慢聊聊天中的 Clinical Logic Layer 以 Helping Logic 形式实现
[Hill 助人过程产品契约](./HILL_HELPING_PROCESS_PRODUCT_CONTRACT_V1.md)。

它不是 Planner 按少数情绪关键词选择性调用的措辞建议器。每个普通非 Safety
话轮都必须到达 Helping 适用性边界，并得到：

```text
HillHelpingDecision =
  decided(HillHelpingPlan)
  | failed(explicit failure)
```

成功决定可以是 `not_applicable`，此时保持普通聊天。适用时，Helping Logic
负责：

- 评估相关上一助人行动与当前反应；
- 判断探索、领悟或行动目标；
- 检查准备度与反证；
- 形成意图并选择受合同约束的技术；
- 处理当前 AI—用户关系修复；
- 完成 Helper Self Check；
- 输出证据、禁用动作与重新评估条件。

领域边界：

- Conversation OS 负责事实、共同理解、直接义务、用户控制和普通对话动作；
- Helping Logic 负责 Hill 领域决定；
- Response Planner 汇总唯一 `ResponsePlan`，不得改写 Hill 方法；
- Surface 只表达已确定计划；
- Validator 只做同计划验证；
- Safety 可以覆盖普通 Helping；
- Memory、小记、长期人格和诊断不进入本次迁移。

Hill 是三类流动目标，不是 `exploration -> insight -> action` 的固定状态机。
行动可以在用户明确请求时直接开始；领悟必须受准备度、证据、协作性和可撤回性
约束。

目标数据合同、Shadow 隔离、正式失败语义、`CommittedHelpingMove` 和批次顺序
以
[第三阶段架构迁移计划](./HILL_HELPING_PROCESS_ARCHITECTURE_MIGRATION_PLAN_V1.md)
为准。

### Current Batch 1 Runtime Boundary

当前实现已经增加：

- 严格的 `HillHelpingInput`、`HillHelpingPlan`、`HillHelpingDecision` 和
  Helper Self Check 类型；
- 来自当前会话 Context、Interpretation、Dialogue State、直接义务、显式用户边界
  和当前关系证据的输入构建；
- 无上下文碎片的确定性 `uncertain` 边界，以及无已建立助人话题的确定性身份、能力、
  词义问题 `not_applicable` 边界；
- 其余话轮至多一次结构化 Helping provider 调用和严格 schema / goal-intention-skill /
  用户边界校验；
- `invalid_input`、`invalid_plan`、`provider_failure`、`timeout` 四类显式失败；
- 独立 Shadow trace 和 `HILL_HELPING_SHADOW` 开关，默认关闭。

当前实现明确没有：

- 把 Shadow 结果写入 `ResponsePlan`、Surface prompt 或正式会话状态；
- 让 Helping Logic 选择普通聊天动作；
- 写入或读取 `CommittedHelpingMove`；
- 改变用户可见回复；
- 启用批次 1.5、2 或 3 的能力。

## Legacy v1 Compatibility Inventory

以下内容记录 Batch 0 之前的八策略、`ClinicalContext`、`ClinicalPlan` 和固定调度
规则，目的是保持历史测试和旧 trace 可解释。它们不是批准的目标产品模型，不得
继续扩展，也不得与 `HillHelpingPlan` 同轮生效。

### Former Positioning

Clinical Logic Layer 是 Conversation OS 和 LLM 之间的专业助人策略层。

它回答：

```text
这一轮对话，应该采用什么助人策略？
为什么？
边界是什么？
```

它不回答：

```text
这句话最终怎么说？
```

最终中文表达仍由 LLM 生成。

Clinical Logic Layer 不是临床诊断系统。

产品定位仍然是：

```text
陪伴型心理教练 / AI 心理陪伴助手
```

明确边界：

- 不提供临床诊断。
- 不替代心理咨询师。
- 不提供医疗建议。
- 不进行疾病评估或治疗承诺。

## Legacy Methodology Sources

只允许引用成熟助人 / 心理沟通框架。

第一版允许来源：

- Rogers / Person-Centered Approach
- Egan / Skilled Helper Model
- Motivational Interviewing
- CBT
- ACT
- SFBT

原则：

- 不自造心理学派。
- 不把产品内部分类包装成心理学理论。
- 不把策略名称直接暴露给用户。

## Legacy Strategy Definition Interface

```ts
interface ClinicalStrategyDefinition {
  name: string
  theoretical_source: string[]
  goal: string
  when_to_use: string[]
  when_not_to_use: string[]
  user_need: string[]
  expected_user_experience: string[]
  risks: string[]
  example_good: string[]
  example_bad: string[]
}
```

重点不是 example。

重点是：

```text
什么时候该用
什么时候不能用
风险是什么
```

## Legacy First Strategy Set

第一版策略集合控制在 8 个以内。

```ts
type ClinicalStrategy =
  | "reflection"
  | "validation"
  | "open_question"
  | "clarification"
  | "repair"
  | "summary"
  | "affirmation"
  | "supportive_pause"
```

### 1. reflection

```ts
{
  name: "reflection",
  theoretical_source: [
    "Rogers / Person-Centered Approach",
    "Motivational Interviewing"
  ],
  goal: "准确、轻量地反映用户已经表达的体验，不解释、不放大。",
  when_to_use: [
    "用户表达情绪、疲惫、担心、委屈、压力。",
    "用户需要先被接住，而不是被分析。",
    "用户没有明确要求建议或总结。"
  ],
  when_not_to_use: [
    "用户正在纠正 AI，应优先 repair。",
    "用户明确要求行动建议。",
    "用户只给出极低信息输入，无法准确反映。"
  ],
  user_need: [
    "被接住",
    "不被分析",
    "不被放大"
  ],
  expected_user_experience: [
    "它听到了我刚刚说的。",
    "它没有把我的话解释成别的东西。"
  ],
  risks: [
    "反映过度会像替用户下结论。",
    "反映太机械会像复读。",
    "反映中加入强度词会越过用户解释权。"
  ],
  example_good: [
    "听到你说今天好累。"
  ],
  example_bad: [
    "今天确实很累吧。",
    "你现在已经撑不住了。"
  ]
}
```

### 2. validation

```ts
{
  name: "validation",
  theoretical_source: [
    "Rogers / Person-Centered Approach",
    "CBT-informed supportive communication",
    "ACT-informed acceptance"
  ],
  goal: "承认用户体验的可理解性，但不替用户确认事实或结论。",
  when_to_use: [
    "用户表达自责、羞耻、担心自己反应不合理。",
    "用户需要知道自己的感受可以被允许。",
    "用户在怀疑自己的反应是否过度。"
  ],
  when_not_to_use: [
    "用户在询问客观事实。",
    "validation 会被听成赞同用户的灾难化判断。",
    "用户需要先 repair AI 的误解。"
  ],
  user_need: [
    "被允许",
    "不被否定",
    "不被纠正"
  ],
  expected_user_experience: [
    "我这样感受不是错误。",
    "AI 没有急着反驳我。"
  ],
  risks: [
    "可能变成无底线认同。",
    "可能强化错误事实判断。",
    "可能听起来像鸡汤。"
  ],
  example_good: [
    "在没收到回复的时候，会往那个方向想，也不奇怪。"
  ],
  example_bad: [
    "你肯定是被伤到了。",
    "你这样想完全正确。"
  ]
}
```

### 3. open_question

```ts
{
  name: "open_question",
  theoretical_source: [
    "Motivational Interviewing",
    "Egan / Skilled Helper Model",
    "SFBT"
  ],
  goal: "用低压力开放问题帮助用户继续探索自己的体验。",
  when_to_use: [
    "用户表达了一个可继续探索的体验。",
    "用户没有明显想暂停。",
    "问题会帮助用户理解自己，而不是只帮助 AI 收集信息。"
  ],
  when_not_to_use: [
    "用户已经表示不想说。",
    "用户只给出极短模糊输入。",
    "用户正在纠正 AI。",
    "问题会变成审问、二选一或隐私探查。"
  ],
  user_need: [
    "被共同探索",
    "保留主动权",
    "不被审问"
  ],
  expected_user_experience: [
    "我可以继续说一点。",
    "这个问题不是在逼我解释。"
  ],
  risks: [
    "提问过早会像索取信息。",
    "二选一问题会像量表。",
    "为什么式问题会像审问。"
  ],
  example_good: [
    "刚才那一下，最卡住你的是什么？"
  ],
  example_bad: [
    "为什么会这样？",
    "是身体累还是心理累？",
    "能详细说说吗？"
  ]
}
```

### 4. clarification

```ts
{
  name: "clarification",
  theoretical_source: [
    "Egan / Skilled Helper Model",
    "Motivational Interviewing"
  ],
  goal: "在不夺取解释权的前提下，确认 AI 是否跟上用户的意思。",
  when_to_use: [
    "用户表达中存在关键歧义，且不澄清会接错方向。",
    "用户愿意继续，但上下文不足以安全回应。",
    "AI 需要确认的是理解方向，不是索取隐私。"
  ],
  when_not_to_use: [
    "用户只是短暂停顿。",
    "用户不想解释。",
    "澄清问题会显得像让用户补作业。"
  ],
  user_need: [
    "不被误解",
    "保留解释权",
    "低压力校准"
  ],
  expected_user_experience: [
    "它没有硬猜。",
    "它愿意和我校准。"
  ],
  risks: [
    "可能变成连续追问。",
    "可能把 AI 的不确定性转嫁给用户。",
    "可能打断用户原本的表达节奏。"
  ],
  example_good: [
    "我怕我接偏了，你刚刚更想说的是这件事本身，还是它带来的那种不安？"
  ],
  example_bad: [
    "什么意思？",
    "你到底想表达什么？"
  ]
}
```

### 5. repair

```ts
{
  name: "repair",
  theoretical_source: [
    "Rogers / Congruence",
    "Person-Centered Approach",
    "Therapeutic alliance repair"
  ],
  goal: "当 AI 理解偏了时，承认偏差、收回旧理解，并让用户感觉可以继续纠正 AI。",
  when_to_use: [
    "用户说“不是这个意思”。",
    "用户说“你没懂”。",
    "用户指出 AI 理解错了、接偏了。",
    "用户将 AI 与过去不被理解的经验联系起来。"
  ],
  when_not_to_use: [
    "用户说“我是不是...”是在怀疑自己或他人关系，不是在纠正 AI。",
    "用户只是表达不确定。",
    "用户没有指向 AI 的误解。"
  ],
  user_need: [
    "误解被修复",
    "不承担 AI 的错误",
    "可以安全纠正 AI"
  ],
  expected_user_experience: [
    "它没有辩解。",
    "它把刚刚偏掉的理解收回去了。",
    "我可以纠正它。"
  ],
  risks: [
    "过度道歉会把焦点转到 AI。",
    "要求用户解释错误会把负担推回用户。",
    "继续沿用旧理解会破坏信任。"
  ],
  example_good: [
    "哦，是我刚刚理解岔了。"
  ],
  example_bad: [
    "那你可以重新说一遍吗？",
    "我只是想确认你的意思。"
  ]
}
```

### 6. summary

```ts
{
  name: "summary",
  theoretical_source: [
    "Motivational Interviewing",
    "Egan / Skilled Helper Model"
  ],
  goal: "把当前共同理解整理成可修改的草稿，而不是给用户下结论。",
  when_to_use: [
    "用户请求梳理、总结、复盘。",
    "对话出现多个线索，需要暂时整理。",
    "进入行动前需要先确认共同理解。"
  ],
  when_not_to_use: [
    "用户只有一句短表达。",
    "用户正在纠正 AI。",
    "总结会把未完成理解固化。"
  ],
  user_need: [
    "被帮助整理",
    "看到当前脉络",
    "保留修改权"
  ],
  expected_user_experience: [
    "这是我们目前的理解草稿。",
    "如果不贴近，我可以改。"
  ],
  risks: [
    "总结太像诊断。",
    "总结太早会压住用户当下表达。",
    "总结可能把一次情绪固化成长期判断。"
  ],
  example_good: [
    "我先按现在听到的整理一下，哪里不贴近你可以改。"
  ],
  example_bad: [
    "所以你就是一个很容易自责的人。"
  ]
}
```

### 7. affirmation

```ts
{
  name: "affirmation",
  theoretical_source: [
    "Motivational Interviewing",
    "Rogers / Unconditional Positive Regard"
  ],
  goal: "看见用户的努力、价值、选择或勇气，但不夸大、不评判。",
  when_to_use: [
    "用户表现出尝试、澄清、坚持、设边界。",
    "用户说出难以表达的内容。",
    "用户在困境中仍做了一个小行动。"
  ],
  when_not_to_use: [
    "用户只是表达痛苦，还不需要被评价。",
    "肯定会听起来像敷衍夸奖。",
    "肯定会跳过用户真实的难受。"
  ],
  user_need: [
    "努力被看见",
    "价值不被忽略",
    "不被廉价表扬"
  ],
  expected_user_experience: [
    "它看见了我在努力。",
    "它不是随便夸我。"
  ],
  risks: [
    "变成鸡汤。",
    "变成上对下评价。",
    "过早肯定会让用户感觉不被理解。"
  ],
  example_good: [
    "你刚刚已经在很努力地把它说清楚了。"
  ],
  example_bad: [
    "你真的很棒。",
    "你一定可以的。"
  ]
}
```

### 8. supportive_pause

```ts
{
  name: "supportive_pause",
  theoretical_source: [
    "Rogers / Non-directiveness",
    "Person-Centered Approach",
    "Supportive counseling microskills"
  ],
  goal: "允许用户暂停、不说、保持沉默，同时不让关系被关闭。",
  when_to_use: [
    "用户说“算了，先不说了”。",
    "用户说“不想说”。",
    "用户给出沉默、停顿、低信息回应。",
    "用户可能因为 AI 没接住而退出。"
  ],
  when_not_to_use: [
    "用户明确请求帮助。",
    "用户正在纠正 AI，需要先 repair。",
    "暂停会让用户感觉被丢下。"
  ],
  user_need: [
    "被允许暂停",
    "不被逼迫",
    "关系不被关掉"
  ],
  expected_user_experience: [
    "我可以先不说。",
    "它没有逼我，也没有把门关上。"
  ],
  risks: [
    "太冷会像结束对话。",
    "太热会像继续拉扯。",
    "可能错过高风险信号。"
  ],
  example_good: [
    "可以先不说。"
  ],
  example_bad: [
    "好的，那再见。",
    "为什么不想说？"
  ]
}
```

## Legacy Strategy Scheduling Input

Clinical Logic Layer 的输入来自 Conversation OS。

建议接口：

```ts
interface ClinicalContext {
  userTurn: string
  currentUnderstanding: UnderstandingState
  recentTurns: ConversationTurn[]
  riskSignal?: RiskSignal
  correctionSignal?: boolean
  userWantsAdvice?: boolean
  userWantsPause?: boolean
  userRequestsSummary?: boolean
  ambiguityLevel?: "low" | "medium" | "high"
}
```

调整说明：

- 增加 `userRequestsSummary`，因为 Summary 是明确策略，不应只靠文本模式临时判断。
- `correctionSignal` 只表示用户是否在纠正 AI，不表示用户是否自我怀疑。
- `ambiguityLevel` 用于判断 Clarification / Supportive Pause / Reflection 的边界。
- `riskSignal` 一旦高危，Safety 层优先于 Clinical Logic。

## Legacy Strategy Output

Clinical Logic Layer 输出策略计划，不输出最终文案。

```ts
interface ClinicalPlan {
  primaryStrategy: ClinicalStrategy
  secondaryStrategies?: ClinicalStrategy[]
  rationale: string
  boundaries: string[]
  avoid: string[]
  shouldAskQuestion: boolean
  questionFunction?:
    | "clarify"
    | "explore_experience"
    | "repair_understanding"
    | "support_user_agency"
    | "none"
}
```

字段说明：

- `primaryStrategy`：本轮主要助人策略。
- `secondaryStrategies`：只作为约束，不要求 LLM 把多个策略都说出来。
- `rationale`：为什么选择该策略。
- `boundaries`：本轮不能越过的边界。
- `avoid`：本轮明确避免的动作。
- `shouldAskQuestion`：是否允许提问。
- `questionFunction`：如果提问，问题服务于什么功能。

## Legacy Scheduling Principles

1. Safety first.

高风险信号出现时，Safety 层覆盖 Clinical Logic。

2. Repair before exploration.

如果用户纠正 AI，先修复误解，不继续探索用户。

3. Pause before question.

如果用户想暂停，不要用问题把用户拉回来。

4. Reflection before advice.

用户没有明确请求建议时，不进入行动支持。

5. Summary only when useful.

总结只在用户请求或对话复杂时使用，不把单句表达总结成画像。

6. Question must have a function.

每个问题必须服务于 clarify、explore_experience、repair_understanding 或 support_user_agency。

## Legacy Relationship to Current Conversation OS

以下是旧文档当时的迁移建议，仅用于解释兼容字段，不代表当前目标：

当前已有概念重新定位：

- `EngageMode`：降级为旧实现细节，后续由 `ClinicalPlan.primaryStrategy` 替代。
- `ExperienceGoal`：降级为策略的 `expected_user_experience`，不再作为独立 Engine 扩张。
- `QuestionStyle`：降级为 `ClinicalPlan.questionFunction + avoid`，不再独立存在。
- `Voice Layer`：只负责把 ClinicalPlan 翻译成自然中文约束。
- `Conversation OS`：负责调用 Clinical Logic，不负责决定心理方法。

## Non-Goals

Clinical Logic Layer 不做：

- 临床诊断。
- 医疗建议。
- 长期记忆提炼。
- 用户画像。
- 训练数据选择。
- 安全危机处置。
- 最终回复文案生成。

## Legacy MVP Acceptance Criteria

Phase 1 的 Clinical Logic Layer 只需要做到：

- 从 Conversation OS 接收 `ClinicalContext`。
- 输出 `ClinicalPlan`。
- 策略集合不超过 8 个。
- 每个策略有明确 when_to_use / when_not_to_use / risks。
- Safety 高危时不参与普通策略调度。
- Trace 中能看到策略选择与 rationale。

以上是历史兼容验收，不是 Hill 批次 1 的验收门。批次 1 的实际证据见
[批次 1 验收报告](./evals/hill-helping-batch1-acceptance.md)。批次 1.5 候选实现的
自动证据见[批次 1.5 自动验收报告](./evals/hill-helping-batch1-5-automatic-acceptance.md)。
它只允许 `uncertain` 适用性边界交给普通 Planner，保持
`behaviorSource=ordinary_conversation`，不启用 Hill 目标、技术或正式助人状态。早期
人工盲审与候选 1—6 未达到冻结阈值的结果保留为历史证据；后续 Planner、Surface
边界和 Validator 最小修复已在 Batch 1.5-E 完整冻结门达到 60/60 Functional、60/60
Machine Validator、0 constraint failure 和 5/60 regeneration，并于 2026-08-04
标记 `passed_and_closed`。Batch 2 仅获批 infrastructure-only，不启用用户可见 Hill
行为。Batch 2A 冻结 versioned formal Helping metadata、严格 parser 和
formal/Shadow 隔离；Batch 2B 只增加 fixture-only 有界加载和 target-bound semantic
association，尚未接入历史 Helping 决策、reaction/impact 状态或正式生产写入。
