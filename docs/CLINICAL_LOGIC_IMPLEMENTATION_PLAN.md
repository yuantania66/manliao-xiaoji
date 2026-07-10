# Clinical Logic Sprint 1 Implementation Plan

## 1. Purpose

本文档定义 Clinical Logic Sprint 1 的修订后工程实施计划。

本阶段严格遵循 SlowTalk Notes PRD v1.0 与当前五层产品架构：

```text
Application Layer
Conversation Layer
Clinical Logic Layer
Memory & Mental Model Layer
Governance & Safety Layer
```

本阶段不新增架构层，不扩展 Memory，不继续优化单句回复、Voice Layer、Prompt、EngageMode、ExperienceGoal 或 QuestionStyle。

本次修订的核心结论：

```text
Clinical Logic 的第一决策不是 Rogers / CBT / ACT / MI。
Clinical Logic 的第一决策是 Response Goal。
```

Strategy 是完成 Response Goal 的方法，不是第一入口。

## 2. Layer Positioning

Clinical Logic Layer 位于 Conversation Layer 与 LLM 表达之间。

它负责回答：

```text
这一轮用户需要获得什么回应目标？
为了完成这个回应目标，采用什么助人策略？
边界是什么？
哪些事情不能做？
```

它不负责回答：

```text
最终中文应该怎么说？
用户是什么样的人？
是否存在安全危机？
哪些内容应该写入长期记忆？
```

最终自然语言仍由 LLM 生成。

## 3. Responsibilities

Clinical Logic Layer 负责：

- 决定本轮 `responseGoal`。
- 根据 `responseGoal` 选择最小可用 `primaryStrategy`。
- 输出可追踪的 ClinicalPlan。
- 明确本轮回应的边界和禁区。
- 明确是否适合提问，以及问题的功能。
- 输出 trace/debug，便于验证目标、策略和边界是否正确。

Clinical Logic Layer 不负责：

- 长期记忆写入。
- RawMemory / Evidence / Projection 创建。
- Safety 风险判定。
- Safety Response 生成。
- 诊断、评估、治疗计划。
- 用户画像。
- 最终中文文案生成。

Clinical Logic 不直接写 Memory。任何 Memory 写入仍由 Memory & Mental Model Layer 根据 Evidence / Projection 机制处理。

## 4. Boundary With Conversation OS

Conversation Layer 继续负责实时对话链路：

- observe
- understand
- update
- LLM adapter
- trace assembly

Clinical Logic Layer 负责 response goal 和 response strategy。

边界如下：

```text
User Message
  -> Safety Gate
  -> Conversation OS observe / understand
  -> Clinical Logic response goal selection
  -> Clinical Logic strategy selection
  -> LLM context assembly
  -> LLM natural language output
  -> Conversation OS update / trace
  -> Save
```

旧概念处理：

- EngageMode：保留为历史辅助字段，不再扩展。
- ExperienceGoal：保留为历史辅助字段，不再扩展。
- QuestionStyle：保留为历史辅助字段，不再扩展。
- Voice：保留为表达约束，不承担策略决策。

Clinical Logic 是后续回应目标与助人策略的唯一主入口。

## 5. Safety Priority

Governance & Safety Layer 永远优先于 Clinical Logic Layer。

执行顺序：

```text
User Message
  -> Safety Gate
  -> if crisis / high-risk: Safety Response
  -> else: Clinical Logic
```

当 Safety 判断为 crisis / high-risk：

- 不进入普通 ClinicalPlan。
- 不选择普通 Response Goal。
- 不选择普通 ClinicalStrategy。
- 不调用普通陪伴回复链路。
- 直接进入 Safety Response。

Clinical Logic 可以接收 Safety 提供的非阻断性 `safetyNotes`，但不能覆盖 Safety 判定。

## 6. Core Objects

### 6.1 ClinicalContext

ClinicalContext 是 Clinical Logic 的输入。

它只包含本轮 response goal / strategy selection 所需的上下文，不包含完整长期记忆，也不直接暴露 RawMemory。

```ts
interface ClinicalContext {
  conversationId: string
  userId: string
  userTurn: string
  recentTurns: Array<{
    role: "user" | "assistant"
    content: string
    createdAt?: string
  }>
  currentUnderstanding: {
    event?: string[]
    emotion?: string[]
    meaning?: string[]
    need?: string[]
    relationship?: string[]
    goal?: string[]
    conflict?: string[]
    unknown?: string[]
  }
  memoryContext?: {
    understandings: ClinicalMemoryItem[]
    relationships: ClinicalMemoryItem[]
    timelineEvents: ClinicalMemoryItem[]
    retrievalNotes: string[]
  }
  conversationSignals: {
    userCorrectedAi: boolean
    userWantsPause: boolean
    userRequestsHelp: boolean
    userRequestsSummary: boolean
    userExpressesUncertainty: boolean
    userExpressesEmotion: boolean
    ambiguityLevel: "low" | "medium" | "high"
  }
  safetyNotes: string[]
}

interface ClinicalMemoryItem {
  id: string
  kind: "understanding" | "relationship" | "timeline"
  text: string
  confidence?: number
  source: "memory_v2"
  limitation?: string
}
```

ClinicalContext 约束：

- `currentUnderstanding` 来自 Conversation OS 的当前理解。
- `memoryContext.understandings` 优先级最高。
- `relationships` 和 `timelineEvents` 只能作为 supporting context。
- 不允许直接读取 RawMemory。
- 不允许将 deterministic MVP memory 当成强判断依据。

### 6.2 ResponseGoal

ResponseGoal 是 Clinical Logic 的第一决策。

它回答：

```text
这一轮用户最需要获得什么回应目标？
```

最小 Response Goal：

```ts
type ResponseGoal =
  | "help_continue_expression"
  | "clarify"
  | "reflect"
  | "summarize"
  | "support_action"
  | "hold_space"
```

字段含义：

- `help_continue_expression`：帮助用户继续表达，尤其适用于“我不知道想说什么 / 不知道怎么说 / 想说但又不想说”。目标不是共情一句，而是让表达可以继续发生。
- `clarify`：帮助澄清当前意思，但不能逼用户解释。
- `reflect`：反映用户已经表达出的体验、感受或担心。
- `summarize`：整理当前共同理解草稿。
- `support_action`：当用户明确请求建议或行动帮助时，提供边界内的实用支持。
- `hold_space`：允许暂停、沉默、模糊或暂时不解决。

关键例子：

```text
用户：我不知道想说什么
responseGoal: help_continue_expression
```

不能把该输入简单处理为：

```text
responseIntent: empathic_reflection
```

原因：

用户不是只需要被反映情绪，而是需要一个低压力入口，让表达有机会继续。

### 6.3 ClinicalStrategy

ClinicalStrategy 是完成 Response Goal 的方法。

它不是第一入口。

Rogers / CBT / ACT / MI 都只能在 Response Goal 明确之后，作为实现方法被选择。

```ts
type ClinicalStrategy =
  | "noop"
  | "rogers"
  | "rogers_reflection"
  | "rogers_validation"
  | "rogers_repair"
  | "cbt_fact_interpretation_separation"
  | "act_acceptance_space"
  | "mi_open_question"
  | "mi_affirmation"
  | "mi_summary"
```

Phase 1 只定义 strategy contract，不做完整临床推理。

当前 RogersStrategy 不废弃。

但 RogersStrategy 不再代表 Clinical Logic 的第一决策。它只是默认可用策略之一，用来服务当前 Response Goal。

### 6.4 ClinicalPlan

ClinicalPlan 是 Clinical Logic 的输出。

修订后结构：

```ts
interface ClinicalPlan {
  responseGoal: ResponseGoal
  primaryStrategy: ClinicalStrategy
  responseIntent:
    | "receive"
    | "repair"
    | "explore"
    | "clarify"
    | "summarize"
    | "affirm"
    | "support_pause"
    | "support_action"
    | "empathic_reflection"
  questionFunction:
    | "none"
    | "clarify_or_reflect"
    | "clarify_meaning"
    | "explore_experience"
    | "repair_understanding"
    | "support_user_agency"
    | "separate_fact_from_interpretation"
  toneConstraint: string[]
  interventionBoundary: string[]
  safetyNotes: string[]
  rationale: string[]
}
```

输出字段说明：

- `responseGoal`：本轮第一决策，说明用户此刻最需要获得什么回应目标。
- `primaryStrategy`：完成该目标的主策略。
- `responseIntent`：给 LLM 的本轮回应意图。
- `questionFunction`：如果本轮需要提问，说明问题的功能；不是具体问题文本。
- `toneConstraint`：给 LLM 的表达边界，例如短句、低压力、不诊断。
- `interventionBoundary`：本轮明确不能越过的边界。
- `safetyNotes`：Safety 传入或 Clinical Logic 发现但未达到阻断级别的注意事项。
- `rationale`：供 trace/debug 使用，不直接暴露给用户。

### 6.5 ClinicalTrace

ClinicalTrace 用于 debug 和架构验收。

```ts
interface ClinicalTrace {
  skippedBySafety: boolean
  safetyDecision?: {
    level: "none" | "low" | "medium" | "high" | "crisis"
    routedToSafety: boolean
    notes: string[]
  }
  inputSignals: ClinicalContext["conversationSignals"]
  memoryUsed: {
    understandings: string[]
    relationships: string[]
    timelineEvents: string[]
  }
  memoryExcluded: {
    rawMemory: "not_allowed"
    deterministicMemoryCaveat: string[]
  }
  selectedPlan?: ClinicalPlan
}
```

Trace 目标不是证明回复正确，而是证明：

- Safety 是否先执行。
- Clinical Logic 是否被跳过。
- 使用了哪些输入信号。
- 使用了哪些 Memory context。
- `responseGoal` 是否先于 `primaryStrategy`。
- 是否直接使用了 RawMemory。
- 最终计划是什么。

## 7. Response Goal Selection MVP

Sprint 1 下一步代码应先实现 ResponseGoalSelector dry-run。

该 selector 只进入 trace，不急着继续改 Prompt。

最小选择规则：

1. 用户表达“不知道怎么说 / 不知道想说什么 / 想说但又不想说”：
   - `responseGoal = "help_continue_expression"`
2. 用户纠正 AI 或质疑 AI 没懂：
   - `responseGoal = "clarify"` 或 `"help_continue_expression"`，根据是否需要修复表达入口决定。
3. 用户表达情绪、疲惫、压力、担心：
   - `responseGoal = "reflect"`
4. 用户请求总结、梳理、复盘：
   - `responseGoal = "summarize"`
5. 用户明确请求建议或行动帮助：
   - `responseGoal = "support_action"`
6. 用户想暂停、不说、先停：
   - `responseGoal = "hold_space"`
7. 信息不足但用户没有表达继续困难：
   - `responseGoal = "clarify"`，但必须保持低压力。

ResponseGoalSelector dry-run 不做：

- 复杂临床推理。
- CBT / ACT / MI 选择。
- Memory 扩展。
- Prompt 修改。
- 线上行为改变。

## 8. Strategy Selection MVP

Strategy selection 必须在 Response Goal 之后发生。

最小映射：

```text
help_continue_expression -> rogers / act_acceptance_space / mi_open_question
clarify -> rogers_repair / mi_open_question
reflect -> rogers_reflection / rogers_validation
summarize -> mi_summary
support_action -> rogers + bounded practical support
hold_space -> rogers / act_acceptance_space
```

Sprint 1 当前代码中的 Rogers dry-run 暂不继续扩展。

下一步只应：

- 新增 ResponseGoalSelector dry-run。
- 让 Rogers 作为默认策略之一，而不是第一决策。
- 让 ClinicalPlan 在 trace 中先出现 `responseGoal`。
- 不急着继续把新的 plan 改进 Prompt。

## 9. Phase 1 Strategy Contracts

Phase 1 仍保留成熟理论来源的 strategy contract。

这些 contract 是 Response Goal 之后的实现方法，不是入口。

### 9.1 Rogers: Reflection

用于 `reflect`。

目标：

- 反映用户已表达的体验，不解释、不放大。

不适合：

- 用户正在纠正 AI。
- 用户明确要求行动建议。
- 可反映内容不足，容易变成编造。

### 9.2 Rogers: Validation

用于 `reflect` 或 `help_continue_expression`。

目标：

- 承认用户体验的可理解性，同时不赞同未经确认的事实判断。

不适合：

- validation 会强化灾难化解释。
- 用户正在询问客观事实。
- 用户正在纠正 AI。

### 9.3 Rogers: Repair

用于 `clarify` 或 `help_continue_expression`。

目标：

- 当 AI 被纠正或关系性误解出现时，由 AI 承担接偏，并恢复用户解释权。

不适合：

- 用户的“是不是”指向他人评价或自身处境，而不是 AI。
- 没有 AI 误解线索时。

### 9.4 CBT: Fact / Interpretation Separation

用于未来 `clarify` 或 `summarize`。

Sprint 1 不实现。

### 9.5 ACT: Acceptance Space

用于未来 `hold_space` 或 `help_continue_expression`。

Sprint 1 不实现。

### 9.6 MI: Open Question / Affirmation / Summary

用于未来 `help_continue_expression`、`support_action` 或 `summarize`。

Sprint 1 不实现。

## 10. Memory Consumption Rules

Clinical Logic 可以消费 Memory & Mental Model Layer 输出的 bounded context。

读取优先级：

1. Understanding
2. Relationship as supporting context
3. Timeline as supporting context

禁止：

- 直接读取 RawMemory。
- 直接遍历聊天原文。
- 根据 Relationship / Timeline 做强判断。
- 根据 deterministic MVP projection 推断人格、创伤、病理或稳定模式。
- 直接写入 Memory。

Memory 使用原则：

- Understanding 用于保持理解连续性。
- Relationship 只帮助识别可能相关的人物或关系线索。
- Timeline 只帮助识别可能相关的事件背景。
- 当 Memory 与当前用户表达冲突时，以当前表达为准。
- 当 Memory 置信度或语义层级不足时，只能进入 `rationale` 或 `interventionBoundary`，不能成为强策略依据。

## 11. LLM Input Contract

当前阶段不继续改 Prompt。

未来当 ClinicalPlan 进入 LLM 前，应以短结构化上下文提供，并以 `responseGoal` 为第一字段。

示例：

```text
【Clinical Plan】
responseGoal: help_continue_expression
primaryStrategy: rogers
responseIntent: receive
questionFunction: support_user_agency
toneConstraint:
- short conversational Chinese
- do not diagnose
- do not force explanation
interventionBoundary:
- do not turn uncertainty into empathic reflection only
- do not ask the user to explain immediately
safetyNotes: []
```

ClinicalPlan 不包含固定回复文本。

LLM 负责自然语言表达，但必须受 ClinicalPlan 边界约束。

## 12. Explicit Non-Goals

Clinical Logic Sprint 1 不做：

- CBT / ACT / MI 具体实现。
- Report。
- Assessment。
- Diagnosis。
- Clinical Feedback。
- Treatment Plan。
- 量表解释。
- 病理分类。
- 用户画像。
- 长期 Memory 写入。
- Graph-ready Memory。
- Timeline schema 深化。
- Understanding schema 深化。
- Relationship 消歧 / 合并。
- Voice Layer 继续调参。
- Prompt 大改。
- 固定回复模板。

## 13. Immediate Engineering Next Step

下一步代码只做：

```text
ResponseGoalSelector dry-run
```

要求：

- 输出 `responseGoal`。
- Rogers 只作为默认策略之一。
- ClinicalPlan 先进入 trace。
- 不继续扩展当前 Rogers dry-run。
- 不改 Prompt。
- 不扩 Memory。
- 不实现 CBT / ACT / MI。
- 不改变线上默认行为。

## 14. Acceptance Criteria

进入下一步实现前，必须满足：

- Response Goal 是 Clinical Logic 第一决策。
- Strategy 被定义为完成 Response Goal 的方法。
- ClinicalPlan 包含 `responseGoal`。
- “我不知道想说什么”明确归入 `help_continue_expression`。
- RogersStrategy 不废弃，但不再作为第一入口。
- 当前 Rogers dry-run 暂不继续扩展。
- 下一步只做 ResponseGoalSelector dry-run。

实现完成后的验收标准应是：

- 正常聊天回复路径可生成 ClinicalPlan。
- ClinicalPlan trace 中可看到 `responseGoal`。
- Crisis / high-risk 不进入普通 ClinicalPlan。
- final reply 仍由 LLM 生成。
- Prompt 默认不变。

## 15. Sprint 1 Conclusion

Clinical Logic Sprint 1 不追求让回复立即更像心理咨询师。

本阶段要先修正决策入口：

```text
Response Goal first.
Strategy second.
Language last.
```

只有当 Response Goal 通过 Review 后，才进入具体策略扩展。

