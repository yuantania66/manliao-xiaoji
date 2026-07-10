# ClinicalPlan Prompt Integration Design

## 1. Purpose

本文档定义 Clinical Logic Sprint 1 中 `ClinicalPlan` 进入 `Prompt Builder` 前的工程设计。

本设计严格遵循 SlowTalk Notes PRD v1.0 与当前五层架构：

```text
Application Layer
Conversation Layer
Clinical Logic Layer
Memory & Mental Model Layer
Governance & Safety Layer
```

本设计不新增架构层，不扩展 Memory，不改 Safety 判断逻辑，不实现 CBT / ACT / MI，也不继续扩展旧 `EngageMode` / `ExperienceGoal` / `QuestionStyle` / `Voice`。

目标只有一个：

```text
在不改变默认线上回复行为的前提下，定义 ClinicalPlan 如何以 feature flag 控制的方式进入 Prompt Builder。
```

## 2. Current State

当前 Clinical Logic Sprint 1 已具备：

- `ClinicalContext`
- `ClinicalPlan`
- `ClinicalStrategy`
- `ClinicalTrace`
- `RogersStrategy` dry-run
- `NoOpClinicalStrategy` fallback
- Safety 命中时跳过普通 ClinicalPlan

当前 `ClinicalPlan` 只进入 debug / trace，不进入 Prompt。

当前正常聊天链路为：

```text
createChatReply()
  -> Safety
  -> ClinicalMemoryContext
  -> ClinicalContext
  -> ClinicalPlan dry-run
  -> generateChatReply()
  -> runConversationPipeline()
  -> buildVoiceConstraints()
  -> buildChatPrompt()
  -> LLM
```

## 3. Integration Principle

`ClinicalPlan` 进入 Prompt 后，职责是提供助人策略边界，不提供固定回复文本。

它回答：

```text
这一轮采用什么回应意图？
问题功能是什么？
语气边界是什么？
干预边界是什么？
Safety 有什么非阻断提示？
```

它不回答：

```text
最终中文怎么写？
用户是什么样的人？
是否存在诊断？
是否应该写 Memory？
```

最终自然语言仍由 LLM 生成。

## 4. Feature Flag

新增 feature flag：

```text
CLINICAL_PLAN_PROMPT_ENABLED=false
```

默认值必须是 `false`。

行为：

| Flag | 行为 |
| --- | --- |
| `false` | `ClinicalPlan` 只进入 debug / trace，不进入 Prompt。线上回复行为保持不变。 |
| `true` | `ClinicalPlan` 以最小结构化 instruction 进入 Prompt Builder。 |

Flag 读取位置建议：

```text
services/ai/chatOrchestrationService.ts
或
services/ai/promptBuilder.ts
```

但无论放在哪里，都必须满足：

- 默认关闭。
- 关闭时 `buildChatPrompt()` 输出与当前一致。
- 开启时只注入 `ClinicalPlan` 的最小字段。
- 不改变 Memory retrieval。
- 不改变 Safety gate。

## 5. Prompt Builder Integration

建议新增一个极薄 formatter：

```ts
formatClinicalPlanForPrompt(clinicalPlan: ClinicalPlan): string
```

输出为短结构化上下文：

```text
【Clinical Plan】
responseIntent: empathic_reflection
primaryStrategy: rogers
questionFunction: clarify_or_reflect
toneConstraint:
- warm
- non-directive
- non-diagnostic
interventionBoundary:
- no diagnosis
- no treatment plan
safetyNotes: none
```

约束：

- 不写中文模板话术。
- 不写示例回复。
- 不加入用户画像。
- 不加入长期 Memory 原文。
- 不加入 Clinical rationale。
- 不加入 debug-only 字段。

`rationale` 只保留在 trace，不进入 Prompt。

## 6. Rogers Dry-Run Mapping

当前 Rogers dry-run `ClinicalPlan` 字段进入 Prompt 的映射如下：

### responseIntent

```text
responseIntent: empathic_reflection
```

含义：

- 本轮回应以共情性反映为主。
- 不等于复述。
- 不等于安慰。
- 不等于分析。

Prompt instruction 应表达为：

```text
Use empathic reflection as the response intent.
Do not diagnose, explain, or direct the user.
```

### questionFunction

```text
questionFunction: clarify_or_reflect
```

含义：

- 如果需要提问，只做轻量澄清或反映式问题。
- 不追问原因。
- 不索取隐私。
- 不把修正责任推给用户。

Prompt instruction 应表达为：

```text
If asking a question, keep it low-pressure and reflective.
It is also acceptable not to ask a question.
```

### toneConstraint

```text
toneConstraint:
- warm
- non-directive
- non-diagnostic
```

含义：

- 温和。
- 不指挥用户。
- 不做诊断或评估。

Prompt instruction 应表达为：

```text
Tone: warm, non-directive, non-diagnostic.
```

### interventionBoundary

```text
interventionBoundary:
- no diagnosis
- no treatment plan
```

含义：

- 不诊断。
- 不制定治疗计划。
- 不把产品说成咨询或治疗。

Prompt instruction 应表达为：

```text
Do not diagnose, assess pathology, or propose a treatment plan.
```

### safetyNotes

```text
safetyNotes: []
```

含义：

- 非阻断性 Safety 注意事项。
- 如果为空，Prompt 可显示 `none`。
- 如果 Safety 已命中阻断，则不进入普通 ClinicalPlan Prompt。

## 7. Safety Priority

Safety 永远先于 Clinical Logic。

当 Safety 命中 crisis / high-risk：

```text
Safety Gate
  -> Safety Response
  -> ClinicalTrace.skippedBySafety = true
  -> 不构造普通 ClinicalPlan Prompt
  -> 不调用普通聊天 Prompt Builder
```

必须禁止：

- Safety 命中后再注入 Rogers prompt。
- Safety response 与普通 ClinicalPlan 混合。
- Safety 文案被 Rogers / Voice / Engage 改写。

Debug 中应显示：

```text
clinicalLogic.skippedBySafety = true
selectedPlan = undefined
```

## 8. Priority With Legacy Fields

旧字段仍然存在，但已经冻结：

- `EngageMode`
- `ExperienceGoal`
- `QuestionStyle`
- `VoiceConstraints`

优先级关系：

```text
Safety
  > ClinicalPlan
  > legacy Conversation OS fields
  > Voice surface constraints
  > LLM natural language expression
```

解释：

1. Safety 命中时，ClinicalPlan 不进入普通 Prompt。
2. `ClinicalPlan` 是未来 response strategy 来源。
3. 旧 `EngageMode` / `ExperienceGoal` / `QuestionStyle` 只保留兼容，不再扩展。
4. `VoiceConstraints` 只能做语言表层约束，不再承担策略决策。
5. 如果 `ClinicalPlan` 与旧字段冲突，后续应以 `ClinicalPlan` 为准，但 Sprint 1 首次开启 flag 时必须只做最小注入，避免一次性改写体验。

## 9. Prompt Shape

当 `CLINICAL_PLAN_PROMPT_ENABLED=true` 时，Prompt Builder 中新增一个 developer message 或合并到现有 developer context。

推荐位置：

```text
Base Product Prompt
Memory Context
Understanding Context
Conversation OS Context
Voice Layer
Clinical Plan
User Message
```

注意：

- `ClinicalPlan` 不应放在 user message 后。
- 不应让 `ClinicalPlan` 包含任何固定回复。
- 不应把 `ClinicalPlan.rationale` 放进 Prompt。

为了降低与旧字段冲突，第一版也可以放在 `Voice Layer` 之前：

```text
Clinical Plan
Voice Layer
```

这样 Voice 仍可做表层中文约束，但不能覆盖 ClinicalPlan 的策略边界。

## 10. Acceptance Criteria

### Flag Off

当：

```text
CLINICAL_PLAN_PROMPT_ENABLED=false
```

必须满足：

- 回复行为不变。
- Prompt Builder 输出不包含 `Clinical Plan`。
- `ClinicalPlan` 仍进入 debug / trace。
- 现有 `check:launch` 通过。

### Flag On

当：

```text
CLINICAL_PLAN_PROMPT_ENABLED=true
```

必须满足：

- Prompt Builder 只注入 Rogers minimal prompt instruction。
- 注入字段仅包含：
  - `responseIntent`
  - `primaryStrategy`
  - `questionFunction`
  - `toneConstraint`
  - `interventionBoundary`
  - `safetyNotes`
- 不注入：
  - `rationale`
  - raw Memory
  - user profile
  - fixed reply text
- Safety 命中时不注入普通 ClinicalPlan Prompt。
- Memory retrieval 行为不变。
- 不实现 CBT / ACT / MI。
- 不改变 Safety 判断逻辑。

## 11. Required Checks

建议新增或更新检查：

```text
check:clinical-plan-prompt
```

覆盖：

1. `flag=false` 时 Prompt 不包含 ClinicalPlan。
2. `flag=true` 时 Prompt 包含 Rogers minimal instruction。
3. Prompt 不包含 `rationale`。
4. Prompt 不包含固定回复文本。
5. Safety 命中时不构造普通 ClinicalPlan Prompt。
6. Memory retrieval service 没有被改动。
7. CBT / ACT / MI strategy 不进入 Prompt。

现有检查继续保留：

- `check:clinical-logic-skeleton`
- `check:ai-orchestration`
- `check:conversation-os-architecture`
- `check:ai-base`
- `check:launch`

## 12. Risks

### 12.1 Double Strategy Conflict

风险：

`ClinicalPlan` 与旧 `EngageMode` / `ExperienceGoal` / `QuestionStyle` / `VoiceConstraints` 同时影响模型，造成双策略冲突。

缓解：

- 旧字段保持 frozen，不再扩展。
- `ClinicalPlan` 第一版只注入最小 Rogers instruction。
- 后续逐步降低旧字段在 Prompt 中的策略权重。

### 12.2 Prompt Too Long

风险：

Prompt 已经包含 Product Prompt、Memory、Conversation OS、Voice 等上下文。继续加入 ClinicalPlan 可能让 Prompt 变长，降低模型稳定性。

缓解：

- ClinicalPlan Prompt 限制为 6 个字段。
- 不注入 rationale。
- 不注入 examples。
- 不注入完整 strategy definition。

### 12.3 Non-Directive Misread As No Response

风险：

模型可能把 `non-directive` 理解成“不回应、不推进、不承接”，导致回复变空、变冷或只说“我在”。

缓解：

- Prompt 中同时保留 `empathic_reflection`。
- 明确 non-directive 的含义是“不指挥用户”，不是“不回应用户”。
- 验收时检查是否出现过度空泛、只陪不接的回复。

### 12.4 Rogers Over-Generalization

风险：

Rogers dry-run 默认选择可能让所有回复都变成同一类共情反映，削弱帮助整理、行动支持或修复误解的能力。

缓解：

- Sprint 1 只做 dry-run。
- Prompt flag 默认关闭。
- 后续真实策略选择前必须单独 Review。

## 13. Non-Goals

本设计不做：

- 不实现 CBT。
- 不实现 ACT。
- 不实现 MI。
- 不新增 Memory schema。
- 不改变 Memory retrieval。
- 不改变 Safety 判断逻辑。
- 不改变 Safety 文案。
- 不新增架构层。
- 不写固定回复模板。
- 不做诊断、评估、治疗计划。

## 14. Conclusion

`ClinicalPlan` 进入 Prompt 的第一步应是安全、最小、可回滚的。

默认关闭：

```text
CLINICAL_PLAN_PROMPT_ENABLED=false
```

开启后只注入 Rogers dry-run 的 minimal instruction，并继续保证：

- Safety 优先。
- Memory 不变。
- 旧字段冻结。
- ClinicalPlan 成为未来 response strategy 来源。
- 最终中文仍由 LLM 生成。
