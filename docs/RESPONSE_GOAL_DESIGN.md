# Response Goal Design

## 1. Why This Document Exists

Clinical Logic Sprint 1 的真实问题不是 Rogers prompt 不够强，而是第一决策对象错了。

如果 Clinical Logic 一开始就选择 Rogers / CBT / ACT / MI，那么系统会变成“技术驱动”：

```text
用户输入
  -> 选择某个心理学技术
  -> 生成回复
```

这会带来一个明显问题：

模型可能变得更温柔，但不一定更贴近用户当下真正需要的回应。

因此 Clinical Logic 的第一决策必须改成：

```text
这一轮用户需要获得什么 Response Goal？
```

Strategy 只是完成 Response Goal 的方法。

## 2. Principle

Response Goal 是 Clinical Logic 的第一决策。

Strategy 是方法，不是入口。

Language 是表达，不是决策。

```text
User Turn
  -> Response Goal
  -> Strategy
  -> Response Intent / Question Function / Boundaries
  -> LLM Language
```

这条链路的重点是：

```text
先判断用户此刻需要什么，再决定用什么技术完成它。
```

## 3. Minimal Response Goal

Sprint 1 最小 Response Goal：

```ts
type ResponseGoal =
  | "help_continue_expression"
  | "clarify"
  | "reflect"
  | "summarize"
  | "support_action"
  | "hold_space"
```

## 4. Goal Definitions

### 4.1 help_continue_expression

目标：

帮助用户在低压力下继续表达。

适用：

- 用户说“不知道怎么说”。
- 用户说“不知道想说什么”。
- 用户说“想说但又不太想说”。
- 用户表达卡住、含混、起不了头。

不适用：

- 用户明确想暂停。
- 用户明确要求行动建议。
- 用户处于 Safety 高风险。

关键边界：

- 不要逼用户解释。
- 不要只做 empathic reflection。
- 不要把“不知道说什么”处理成一个情绪反映。
- 要给表达留出一个小入口。

例子：

```text
用户：我不知道想说什么
responseGoal: help_continue_expression
```

不能只输出：

```text
responseIntent: empathic_reflection
```

原因：

用户真正卡住的是表达入口，不是只需要被共情一句。

### 4.2 clarify

目标：

澄清当前理解，但不把解释责任压给用户。

适用：

- 用户纠正 AI。
- 用户说“不是这个意思”。
- 当前理解方向明显可能接偏。

不适用：

- 用户只是短句停留。
- 用户明确想暂停。
- 用户已经表达很强情绪，需要先接住。

关键边界：

- AI 先承担可能没跟上。
- 不要说“你到底什么意思”。
- 不要用校准术语。

### 4.3 reflect

目标：

反映用户已经表达出的体验，让用户感到被看见。

适用：

- 用户表达累、堵、委屈、担心、压力。
- 用户没有明确请求建议。
- 当前已表达内容足够反映。

不适用：

- 用户明确请求建议。
- 用户只是表达卡住。
- 用户正在纠正 AI。

关键边界：

- 不放大强度。
- 不替用户确认事实。
- 不把反映变成套话。

### 4.4 summarize

目标：

整理当前共同理解草稿。

适用：

- 用户请求梳理、总结、复盘。
- 多轮内容散乱，用户需要看清当前脉络。

不适用：

- 用户只是短句表达。
- 用户还没展开。
- 用户想暂停。

关键边界：

- Summary 是共同理解草稿，不是结论。
- 必须保留可修正性。
- 不生成报告、评估或治疗计划。

### 4.5 support_action

目标：

在用户明确请求建议或行动帮助时，提供边界内的实用支持。

适用：

- 用户说“你能给我点建议吗”。
- 用户问“我该怎么办”。
- 用户明确需要下一步。

不适用：

- 用户只是倾诉。
- 用户还没准备行动。
- Safety 高风险。

关键边界：

- 不给治疗计划。
- 不诊断。
- 不强行 CBT / ACT / MI。
- 不因为 non-directive 就削弱帮助。

### 4.6 hold_space

目标：

允许暂停、沉默、模糊或暂时不解决。

适用：

- 用户说“算了，先不说了”。
- 用户明确想停。
- 用户表达暂时不想展开。

不适用：

- 用户是在卡住但仍想继续。
- 用户明确请求帮助。

关键边界：

- 不关闭对话。
- 不继续追问。
- 不把暂停解释成拒绝。

## 5. Response Goal vs Strategy

Response Goal 回答：

```text
用户此刻需要获得什么？
```

Strategy 回答：

```text
用什么成熟助人技术完成这个目标？
```

例子：

| User Input | Response Goal | Possible Strategy |
| --- | --- | --- |
| 我不知道想说什么 | help_continue_expression | Rogers / MI open question / ACT acceptance space |
| 今天好累 | reflect | Rogers reflection |
| 不是这个意思 | clarify | Rogers repair |
| 你能给我点建议吗 | support_action | Rogers + bounded practical support |
| 帮我梳理下 | summarize | MI summary |
| 算了，先不说了 | hold_space | Rogers / ACT acceptance space |

Sprint 1 只实现 ResponseGoalSelector dry-run，不实现复杂策略选择。

## 6. ClinicalPlan Revision

ClinicalPlan 应更新为：

```ts
interface ClinicalPlan {
  responseGoal: ResponseGoal
  primaryStrategy: ClinicalStrategy
  responseIntent: ClinicalResponseIntent
  questionFunction: ClinicalQuestionFunction
  toneConstraint: string[]
  interventionBoundary: string[]
  safetyNotes: string[]
  rationale: string[]
}
```

字段关系：

```text
responseGoal
  -> primaryStrategy
  -> responseIntent
  -> questionFunction
  -> toneConstraint / interventionBoundary
```

`responseGoal` 必须先于 `primaryStrategy` 产生。

## 7. RogersStrategy Status

RogersStrategy 不废弃。

但它不再是第一决策。

它只作为默认策略之一，用于服务 Response Goal。

当前代码里的 Rogers dry-run 暂不继续扩展。

下一步不要继续加强 Rogers prompt，也不要继续用 Rogers 修所有 case。

## 8. Next Engineering Step

下一步代码应做：

```text
ResponseGoalSelector dry-run
```

要求：

- 输入 ClinicalContext。
- 输出 ResponseGoal。
- 写入 ClinicalPlan trace。
- Rogers 只作为默认策略之一。
- ClinicalPlan 先进入 trace，不急着继续改 Prompt。

不做：

- CBT / ACT / MI。
- Prompt 修改。
- Memory 扩展。
- Safety 修改。
- 新增架构层。
- 固定回复模板。

## 9. Acceptance Criteria

Response Goal 设计通过条件：

- “我不知道想说什么” 输出 `help_continue_expression`。
- `responseGoal` 是 ClinicalPlan 的第一字段。
- Strategy 被定义为方法，而不是入口。
- RogersStrategy 保留但不继续扩展。
- ClinicalPlan 先进入 trace。
- 默认线上行为不变。

## 10. Final Decision

```text
Clinical Logic first decides Response Goal.
Strategy serves Response Goal.
Rogers is not removed, but it is not the first decision.
```

