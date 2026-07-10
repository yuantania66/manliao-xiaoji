# Clinical Logic Layer

## Positioning

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

## Methodology Sources

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

## Strategy Definition Interface

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

## First Strategy Set

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

## Strategy Scheduling Input

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

## Strategy Output

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

## Scheduling Principles

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

## Relationship to Current Conversation OS

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

## MVP Acceptance Criteria

Phase 1 的 Clinical Logic Layer 只需要做到：

- 从 Conversation OS 接收 `ClinicalContext`。
- 输出 `ClinicalPlan`。
- 策略集合不超过 8 个。
- 每个策略有明确 when_to_use / when_not_to_use / risks。
- Safety 高危时不参与普通策略调度。
- Trace 中能看到策略选择与 rationale。
