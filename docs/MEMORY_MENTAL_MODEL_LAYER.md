# Memory & Mental Model Layer

## Positioning

Memory & Mental Model Layer 不是简单 Memory。

它负责：

```text
从聊天中沉淀长期理解。
```

这层不直接优化单句回复。

它服务于长生命周期陪伴：

- 让理解可延续。
- 让历史可追溯。
- 让用户可以修正系统理解。
- 让重要事件、关系、情绪变化不被遗忘。

## Core Principle

不要把一次表达固化成用户画像。

所有结构化理解必须：

- 有原始证据。
- 有 `source_message_ids`。
- 有 `confidence`。
- 可被用户修正。
- 可被后续证据削弱或覆盖。

## Layer Overview

```text
Raw Data Layer
原始对话归档

Semantic Refinement Layer
语义提炼层

Timeline
核心事件线

Relationship Graph
人际关系图谱

Understanding Continuity
未完成理解 / 开放线程

Safety Flags
安全标记
```

## 1. Raw Data Layer

职责：

- 保存全量对话。
- 保留证据链。
- 不直接参与实时 Prompt。
- 每条消息必须有 `message_id`。
- 后续结构化内容必须能回指原始 `message_id`。

建议最小字段：

```ts
interface RawMessage {
  message_id: string
  conversation_id: string
  user_id: string
  role: "user" | "assistant" | "system"
  content: string
  created_at: string
  metadata?: Record<string, unknown>
}
```

原则：

- Raw Layer 是 Ground Truth。
- 不覆盖、不重写原始消息。
- 用户删除数据时，所有派生结构必须同步失效或删除。

## 2. Semantic Refinement Layer

Semantic Refinement Layer 使用异步 LLM 蒸馏。

输入：

```text
Raw Conversation Segment
```

输出结构化 JSON：

```text
events
emotions
relationships
needs
goals
conflicts
unknowns
safetySignals
```

要求：

- 异步执行。
- 不阻塞实时聊天。
- 所有提炼结果必须带 `source_message_ids`。
- 所有提炼结果必须有 `confidence`。
- 所有提炼结果必须可被用户修正。

建议输出：

```ts
interface SemanticRefinementResult {
  segment_id: string
  source_message_ids: string[]
  events: RefinedEvent[]
  emotions: RefinedEmotion[]
  relationships: RefinedRelationship[]
  needs: RefinedNeed[]
  goals: RefinedGoal[]
  conflicts: RefinedConflict[]
  unknowns: RefinedUnknown[]
  safetySignals: RefinedSafetySignal[]
  model_version: string
  created_at: string
}
```

禁止：

- 把推测写成事实。
- 生成不可追溯的总结。
- 把一次表达直接固化成人格标签。

## 3. Timeline

Timeline 记录用户生活事件与情绪变化的索引。

不要做成简单聊天摘要。

Timeline 记录：

```text
事件
时间
情绪
影响权重
来源 message_id
状态
```

建议字段：

```ts
interface TimelineEvent {
  event_id: string
  user_id: string
  event_text: string
  occurred_at?: string
  detected_at: string
  emotions: string[]
  impact_weight: number
  source_message_ids: string[]
  confidence: number
  status: "active" | "resolved" | "unclear" | "user_corrected" | "archived"
}
```

原则：

- Timeline 是生活事件索引，不是人格分析。
- 重要事件应能回到原始消息。
- 事件状态可以变化。

## 4. Relationship Graph

Relationship Graph 记录：

```text
人
关系
事件
情绪影响
互动模式
source_message_ids
confidence
```

建议字段：

```ts
interface RelationshipNode {
  person_id: string
  user_id: string
  display_name: string
  relationship_label?: string
  confidence: number
  source_message_ids: string[]
  created_at: string
  updated_at: string
}

interface RelationshipEdge {
  edge_id: string
  user_id: string
  from_person_id: string
  to_entity_id: string
  relation_type: "mentioned_in" | "triggered_emotion" | "involved_in_event" | "support_source" | "stress_source"
  evidence_text: string
  source_message_ids: string[]
  confidence: number
  status: "active" | "weakened" | "user_corrected" | "archived"
}
```

注意：

可以记录：

```text
用户提到领导未回复消息，并担心自己被讨厌。
```

不要记录：

```text
用户是高敏感人格。
```

## 5. Understanding Continuity

Understanding Continuity 是本层核心。

它记录：

```text
哪些理解还没有完成
哪些话题中断了
哪些事件还需要未来继续理解
哪些矛盾正在形成
```

示例：

```text
用户说“今天好累”，但累的来源尚未明确。
用户说“算了”，此处可能存在一次理解中断。
用户多次提到领导，工作关系可能是持续线程。
```

建议字段：

```ts
interface UnderstandingThread {
  thread_id: string
  user_id: string
  title: string
  current_understanding: string
  unknowns: string[]
  related_event_ids: string[]
  related_person_ids: string[]
  source_message_ids: string[]
  confidence: number
  status: "open" | "paused" | "deepening" | "user_corrected" | "closed"
  last_touched_at: string
}
```

原则：

- Continuity 不是提醒用户“你还没说完”。
- 它是让 AI 未来可以继续理解，而不是从零开始。
- 开放线程必须可被用户关闭或修正。

## 6. Safety Flags

Safety Flags 记录对后续安全处理有意义的信号。

它不替代 Safety & Governance Layer。

建议字段：

```ts
interface SafetyFlag {
  flag_id: string
  user_id: string
  risk_type: string
  risk_level: "low" | "medium" | "high" | "crisis"
  evidence_text: string
  source_message_ids: string[]
  confidence: number
  status: "active" | "resolved" | "false_positive" | "archived"
  created_at: string
}
```

原则：

- Safety Flags 必须谨慎。
- 高风险信号优先交给 Governance & Safety Layer。
- 不把风险标签暴露成用户画像。

## Retrieval Boundaries

实时聊天不能直接把 Raw History 全量塞进 Prompt。

推荐检索输入：

- 当前 open UnderstandingThread。
- 近期 TimelineEvent。
- 高置信 Relationship references。
- 必要 Safety Flags。

禁止：

- 用历史压过当下。
- 把低置信假设说成事实。
- 把用户过去的表达当作当前意义。

## Phase Roadmap

### Phase 1: MVP

范围：

- PostgreSQL 保存原始消息。
- 异步 LLM 提炼结构化 JSON。
- 基础 Timeline。
- 基础 Understanding Continuity。
- Conversation Trace。
- Safety 最小规则。

不做：

- Neo4j。
- Milvus。
- LangGraph。
- GraphRAG。

### Phase 2: Graph / Retrieval

范围：

- Relationship Graph。
- Vector Search。
- GraphRAG 原型。
- 跨会话检索。

### Phase 3: Clinical Feedback

范围：

- 量表接入。
- 阶段性报告。
- 趋势变化。
- 用户可编辑理解。

### Phase 4: Multimodal / Wearable

范围：

- 语音情绪。
- 睡眠。
- HRV。
- 运动数据。

## MVP Acceptance Criteria

Phase 1 通过标准：

- 每条消息有稳定 `message_id`。
- 异步 refinement 不阻塞实时聊天。
- 结构化结果带 `source_message_ids` 和 `confidence`。
- Timeline 至少能记录核心事件。
- Understanding Continuity 至少能记录 open / paused threads。
- 用户删除原始消息时，派生结构可同步处理。
