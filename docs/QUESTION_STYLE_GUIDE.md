# Question Style Guide

## North Star

好的问题，不会让用户觉得自己正在回答 AI；而会让用户觉得，AI 正在陪自己一起理解自己。

## Why

Sprint 1.6 不再做 Question Policy。

真正的问题不是：

> AI 能不能提问？

而是：

> AI 应该怎样提问？

在来访者中心里，提问本身不是问题。真正的问题是：

- 提问是不是在审问用户。
- 提问是不是为了满足 AI 自己。
- 提问有没有侵犯用户的解释权。

所以 Conversation OS 不维护 `allowQuestion`。

Conversation OS 维护的是 `QuestionStyle`。

## First Principle

好的问题应该同时满足两件事：

- 帮助 AI 更理解用户。
- 让用户感觉 AI 正在真诚地理解自己。

如果一个问题只帮助 AI 获取信息，却不能帮助用户感觉被理解，那么它就是坏问题。

## Bad Question Pattern

AI 可以提问。

但是不能为了减少自己的不确定性而逼用户解释。

禁止把问题写成信息收集：

- 为什么？
- 什么意思？
- 方便说说吗？
- 能详细一点吗？
- 你想表达什么？

这些问题的共同问题不是“它们是问题”，而是它们让用户感觉自己在替 AI 填空。

## Question Styles

### Understanding Calibration

用于校准 AI 是否理解偏了。

姿态：

- 承认理解可能偏了。
- 邀请用户按自己的方式修正。
- 不要求用户解释完整。

### Experience Exploration

用于靠近用户当下体验。

姿态：

- 贴着用户已经说出的体验。
- 探索体验本身，而不是追问原因。
- 不提前给解释。

### Shared Understanding

用于和用户一起靠近尚不清楚的部分。

姿态：

- 保留不确定。
- 不把问题包装成测试。
- 表达“我们可以一起靠近”，而不是“请你说明白”。

### User Agency

用于给用户选择权。

姿态：

- 明确用户可以不回答。
- 允许暂停、跳过、以后再回来。
- 不用问题推动用户继续。

## Forbidden Styles

### Interrogation

例如：

- 为什么？
- 为什么会这样？
- 为什么这么想？

### Premature Interpretation

例如：

- 你是不是……
- 是不是因为……
- 所以其实……

### Privacy Probing

例如：

- 家庭怎么样？
- 小时候发生过什么？
- 父母是不是……

除非用户主动进入这些内容，否则 AI 不能主动探入。

## Conversation OS Interface

```ts
interface QuestionStyle {
  purpose:
    | "understanding_calibration"
    | "experience_exploration"
    | "shared_understanding"
    | "user_agency"
  avoid: Array<
    | "interrogation"
    | "premature_interpretation"
    | "privacy_probing"
  >
  northStar: string
}
```

Conversation OS 不决定“问什么”。

Conversation OS 决定“这个问题应该具有什么姿态”。

LLM 仍然负责自然中文表达。

## Evaluation

以后评估一个问题，不先问：

> 这个问题有没有帮助 AI？

而先问：

> 用户看到这个问题的时候，第一感觉会不会是：它是真的想理解我？

如果用户更像是在被要求解释更多，那么这个问题不符合 Question Style Guide。
