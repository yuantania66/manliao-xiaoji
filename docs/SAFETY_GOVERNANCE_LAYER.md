# Safety & Governance Layer

## Positioning

Safety & Governance Layer 横跨整个产品架构。

它不属于 Conversation OS，也不属于 Clinical Logic。

高风险场景下：

```text
Safety & Governance Layer > Clinical Logic Layer > Conversation Layer
```

Safety Response 不能假装自己是医生。

它必须清楚表达产品边界，同时尽量帮助用户连接现实支持。

## Product Boundary

慢聊小记：

- 不是医疗产品。
- 不做诊断。
- 不替代专业心理咨询。
- 不提供医学建议。
- 不承诺治疗效果。
- 不处理紧急救援调度。

定位：

```text
陪伴型心理教练 / AI 心理陪伴助手
```

## High-Risk Signals

高风险识别包含但不限于：

- 自伤。
- 自杀。
- 伤害他人。
- 极端绝望。
- 精神病性症状。
- 严重创伤闪回。
- 家庭暴力。
- 未成年人高危处境。
- 被控制、被威胁、无法离开危险环境。
- 明确计划、工具、时间、地点。

建议风险等级：

```ts
type RiskLevel = "low" | "medium" | "high" | "crisis"
```

建议风险信号：

```ts
interface RiskSignal {
  riskLevel: RiskLevel
  categories: string[]
  evidenceText: string
  source_message_ids: string[]
  confidence: number
  requiresSafetyResponse: boolean
}
```

## Safety Response Principles

高危时 Safety 层优先级高于 Clinical Logic。

Safety Response 应该：

- 承认风险。
- 鼓励联系现实支持。
- 提供紧急资源。
- 必要时建议联系当地急救或可信任的人。
- 避免继续深入创伤细节。
- 避免表现成医生或咨询师。

Safety Response 不应该：

- 诊断用户。
- 承诺用户会好起来。
- 要求用户详细描述创伤或自伤计划。
- 让用户只依赖 AI。
- 把危机处理成普通陪伴对话。

## Safety Escalation

建议流程：

```text
User Input
  ↓
Risk Detection
  ↓
Risk Level
  ↓
Safety Response if high/crisis
  ↓
Clinical Logic only if safe
```

最小 MVP：

- 规则 + LLM 风险判断双通道。
- 高危关键词触发保守处理。
- Crisis 场景不进入普通 Clinical Strategy。
- Trace 中记录 Safety 是否覆盖普通链路。

## Privacy & Data Governance

慢聊小记是重隐私产品。

隐私设计必须是一等架构能力。

### Data Encryption

要求：

- 传输加密。
- 存储加密。
- 密钥分层管理。
- 敏感字段单独加密。

### Access Control

要求：

- 最小权限原则。
- 研发默认不能直接访问明文聊天。
- 管理后台访问必须审计。
- 高敏数据访问需要更高权限与理由。

### Right to Delete / Right to Forget

用户必须能：

- 删除单条消息。
- 删除会话。
- 删除账户数据。
- 请求清除派生结构化理解。

删除原则：

- Raw message 删除后，对应 Timeline / Graph / Continuity / Safety 派生结果必须失效、删除或重新计算。
- 删除操作必须可追踪，但审计记录不应保留明文内容。

### Sensitive Data Isolation

敏感数据包括：

- 聊天原文。
- 心理风险信号。
- 人际关系图谱。
- 安全标记。
- 用户身份信息。

要求：

- 身份信息与心理内容分离存储。
- Safety Flags 与普通记忆隔离。
- 内部调试数据脱敏。

### Training Data Isolation

默认原则：

- 用户聊天数据不进入模型训练。
- 不把用户原文用于离线评测集，除非用户明确授权且脱敏。
- 开发样本优先使用合成数据或明确授权数据。

### Audit Logs

审计日志记录：

- 谁访问了数据。
- 什么时候访问。
- 访问目的。
- 访问范围。
- 是否导出。

审计日志不记录：

- 聊天明文。
- 敏感心理内容全文。

## Safety Flags and Memory

Safety Flags 可以进入 Memory & Mental Model Layer，但必须隔离。

原则：

- Safety Flags 不等于用户画像。
- Safety Flags 不应在普通回复中被直接提及。
- 低置信风险信号需要保守处理，但不能长期污名化用户。
- 用户可请求删除或修正相关数据，但危机审计可能需要保留最小合规记录。

## Governance Review

新增能力进入产品前必须回答：

1. 是否新增敏感数据类型？
2. 是否改变数据保存周期？
3. 是否影响用户删除权？
4. 是否会让 AI 更像医疗系统？
5. 是否需要新的安全响应？
6. 是否需要用户显式同意？

## Phase Roadmap

### Phase 1: MVP

范围：

- Safety 最小规则。
- Crisis 覆盖普通回复链路。
- 基础隐私边界。
- 删除权设计。
- Trace 中记录 Safety route。

### Phase 2: Graph / Retrieval

范围：

- Safety Flags 与 Relationship Graph 隔离。
- 检索时过滤高敏内容。
- 高风险历史只在必要时进入 Safety 判断。

### Phase 3: Clinical Feedback

范围：

- 阶段性报告中的风险表达审核。
- 用户可编辑理解。
- 量表数据治理。

### Phase 4: Multimodal / Wearable

范围：

- 语音、睡眠、HRV、运动数据授权。
- 可穿戴数据隔离。
- 更严格的撤回授权机制。

## MVP Acceptance Criteria

Phase 1 通过标准：

- 产品边界在架构和用户协议中明确。
- 高风险输入不会进入普通 Clinical Logic。
- Safety response 不冒充医生。
- 用户数据删除路径明确。
- 敏感数据不进入训练。
- Trace 能显示 Safety 是否覆盖普通链路。
