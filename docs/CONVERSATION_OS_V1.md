# Conversation OS v1

## North Star

慢聊小记不是一个回答用户的 AI。

它是一个不断与用户共同形成理解的 AI。

最高原则：

> AI 真诚地尝试理解用户，而用户始终拥有对自己意义的最终解释权。

Sprint 1 的目标不是让回复更聪明，而是确保每一次正常聊天回复都先经过可见的理解流程，再交给 LLM 表达。

## Pipeline

```text
User Message
  ↓
Observe
  ↓
Orient
  ↓
Engage
  ↓
LLM
  ↓
Update
  ↓
Save
```

禁止正常聊天回复绕过 Pipeline 直接进入 LLM。

当前入口：

```text
generateChatReply()
  ↓
runConversationPipeline()
  ↓
buildChatPrompt(ConversationContext)
  ↓
callModel()
```

## Stage Responsibilities

### Observe

输入：

- User Message
- Recent Messages

输出：

- Notice
- observations

职责：

- 观察当前用户给出了什么
- 记录消息形式
- 记录可见上下文数量

禁止：

- 判断用户情绪
- 判断用户意图
- 判断用户人格
- 判断用户是否测试 AI
- 把短输入解释成分数、暗号或逃避

### Orient

输入：

- Notice
- UnderstandingState

输出：

- Orientation
- currentUnderstanding
- unknowns
- possibleDirections

职责：

- 形成暂时理解方向
- 保留未知
- 指出下一步只应如何靠近

禁止：

- 输出 Intent
- 输出 Classification
- 输出 Persona
- 输出不可修正结论
- 把观察扩展成事实判断

### Engage

输入：

- Notice
- Orientation
- Recent Messages

输出：

- ResponseGoal
- engageMode
- policyReason
- userExperience
- languageConstraint

职责：

- 决定这一轮采用哪一种回应方式
- 决定这一轮希望用户体验到什么
- 约束语言表达边界

禁止：

- 生成回复文本
- 给建议
- 分析用户
- 替用户定义意义
- 把每一轮都变成提问或邀请

Sprint 1.4 起，Engage 是一个策略层。它先选择 `EngageMode`，LLM 只能表达这个策略，不能自行决定要问、陪、修正或承接。

Sprint 1.6 起，Conversation OS 不再维护 `allowQuestion`。问题本身不是风险，问题的姿态才是风险。Engage 输出 `QuestionStyle`，用于约束如果本轮出现问题，它应该是理解校准、体验探索、共同靠近，还是给予选择。

```ts
type EngageMode =
  | "acknowledge"
  | "invite"
  | "reflect"
  | "stay"
  | "clarify"
  | "repair"
  | "repair_with_invitation"
  | "repair_with_low_pressure_exit"
```

```ts
type QuestionStyle = {
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

当前最小策略：

- `acknowledge`：第一次低信息输入，只承认看见，不索取解释。
- `invite`：连续低信息输入时，才轻轻邀请共同校准。
- `reflect`：用户明确表达体验时，贴着表达反映，不追问。
- `stay`：用户给出短承接音或暂停信号时，允许停在这里。
- `repair`：用户纠正 AI 时，先放下旧理解。
- `repair_with_invitation`：用户指出 AI 理解偏了时，承认偏差，并给出低压纠正入口。
- `repair_with_low_pressure_exit`：用户可能因没被接住而退出时，允许先不说，同时低压收回没接住的部分。
- `clarify`：保留给后续更明确的小澄清场景。

关系性反馈优先级高于普通输入表面。包含“不是这个意思 / 你没懂 / 算了 / 不说了 / 随便吧”的输入，不先按字面归为普通 `stay`，而先进入修复策略。

Question Style Guide 见 [QUESTION_STYLE_GUIDE.md](./QUESTION_STYLE_GUIDE.md)。

### LLM

输入：

- Notice
- Orientation
- ResponseGoal

输出：

- 自然语言回复

职责：

- 只负责语言表达

禁止：

- 绕过 Conversation OS 自行决定理解过程
- 把暂时理解说成事实
- 把用户表达固化成画像

### Update

输入：

- ConversationContext
- Assistant Reply
- Next User Reply（未来）

输出：

- UpdateResult

职责：

- 标记本轮 Pipeline 边界
- 未来根据用户修正更新当前 UnderstandingState

禁止：

- 更新 Persona
- 写长期 Memory
- 形成 Insight
- 把用户一次回应固化成标签

## ConversationContext

Conversation OS 当前统一维护一个对象：

```ts
interface ConversationContext {
  conversationId: string
  latestNotice: Notice
  understanding: UnderstandingState
  responseGoal: ResponseGoal
}
```

`UnderstandingState` 包含：

```text
events
emotions
meanings
needs
relationships
goals
conflicts
unknowns
```

Sprint 1 只定义对象与链路，不填充智能理解能力。

## Explicitly Not In Sprint 1

Sprint 1 明确不做：

- 情绪识别
- Intent
- Persona
- Summary
- RAG
- Memory
- User Profile
- Insight
- 长期学习
- 数据库 schema 改造
- 完整状态机

这些能力如果未来加入，必须自然长在 Conversation OS 的某一层里。

## Future Capability Entry Points

- 观察类能力：只能接入 Observe。
- 暂时理解类能力：只能接入 Orient。
- 用户体验目标类能力：只能接入 Engage。
- 用户修正与共同理解推进：只能接入 Update。
- 语言风格能力：只能接入 LLM Language Surface。
- 长期连续性能力：必须先进入 UnderstandingState，再由 Memory 保存过程，不能绕过 Conversation OS。

## Debug Requirements

Debug 必须能看到四层：

- notice
- orientation
- responseGoal
- updateResult

如果 debug 只能看到 Prompt 或模型输出，说明架构退回了旧链路。

## Architecture Guard

`npm run check:conversation-os-architecture` 会检查：

- 所有 `callModel()` 调用点
- 聊天 API 不允许直接调用 LLM
- 正常聊天回复必须调用 `runConversationPipeline()`
- `services/ai/aiService.ts` 中正常聊天只能有一个 LLM 语言生成调用
- LLM prompt composition 必须接收 Conversation OS Context

这条测试用于防止系统退回：

```text
Input -> Prompt -> LLM
```

目标链路必须保持：

```text
Input -> Conversation OS -> LLM
```
