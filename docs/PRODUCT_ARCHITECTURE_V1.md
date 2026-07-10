# Product Architecture v1

## Product Positioning

慢聊小记重新定位为：

> 重隐私、长生命周期、具备数字治愈属性的 AI 陪伴产品。

核心不再是单句回复是否更像人。

核心是：

> 聊天之后，系统是否沉淀了可延续的理解。

慢聊小记不是医疗产品，不做诊断，不替代专业心理咨询，不提供医学建议。它的产品定位是陪伴型心理教练 / AI 心理陪伴助手。

## Architecture Overview

产品架构分为五层：

```text
Application Layer
应用层

Conversation Layer
实时对话层

Clinical Logic Layer
专业助人策略层

Memory & Mental Model Layer
记忆与心智模型层

Governance & Safety Layer
治理与安全层
```

## 1. Application Layer

职责：

- 提供用户入口：聊天、小记、时间线、设置、隐私管理。
- 展示当前对话与用户可见的理解结果。
- 承载用户对系统理解的编辑、删除、反馈。
- 管理登录、设备、会话、导出、删除等产品级流程。

不负责：

- 判断心理策略。
- 生成长期心智模型。
- 做安全风险判定。

## 2. Conversation Layer

Conversation Layer 负责实时对话链路。

当前 `Conversation OS` 保留，但冻结扩张。

它只负责：

```text
Observe
Understand
Update
LLM Adapter
Trace
```

具体职责：

- 接收用户输入。
- 形成当前轮基本理解。
- 调用 Clinical Logic Layer 获得策略计划。
- 组装 LLM 上下文。
- 输出 trace。
- 接收下一轮反馈并更新当前理解。

不再新增：

```text
Experience Goal Engine
Question Style Engine
Voice Engine
Response Intention
Continuity Engine
```

已有概念如果已经存在，先不删除，但从主架构中降级，后续逐步收敛。

Conversation OS 不负责决定心理学方法。

## 3. Clinical Logic Layer

Clinical Logic Layer 是实时对话与 LLM 之间的专业助人策略层。

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

详见：

[CLINICAL_LOGIC_LAYER.md](./CLINICAL_LOGIC_LAYER.md)

## 4. Memory & Mental Model Layer

Memory & Mental Model Layer 不等于简单 Memory。

它负责：

```text
从聊天中沉淀长期理解。
```

核心对象：

- Raw Data Layer：原始对话归档。
- Semantic Refinement Layer：异步语义提炼。
- Timeline：核心事件线。
- Relationship Graph：人际关系图谱。
- Understanding Continuity：未完成理解 / 开放线程。
- Safety Flags：安全标记。

详见：

[MEMORY_MENTAL_MODEL_LAYER.md](./MEMORY_MENTAL_MODEL_LAYER.md)

## 5. Governance & Safety Layer

Governance & Safety Layer 横跨所有层。

它负责：

- 产品边界。
- 高风险识别。
- Safety Response。
- 隐私与数据治理。
- 访问控制与审计。
- 删除权 / 遗忘权。
- 训练数据隔离。

高风险场景下，Safety 优先级高于 Clinical Logic。

详见：

[SAFETY_GOVERNANCE_LAYER.md](./SAFETY_GOVERNANCE_LAYER.md)

## Current Architecture Repositioning

当前项目中已经存在 Conversation OS、Voice Layer、Experience Goal、Question Style、Trace 等概念。

本轮架构收敛不要求立即删除这些实现。

但主架构口径调整为：

- Conversation OS 是实时对话层，不是所有智能能力的容器。
- Voice Layer 是表达约束，不是策略决策层。
- EngageMode / ExperienceGoal / QuestionStyle 不再继续扩张。
- 专业助人策略迁移到 Clinical Logic Layer。
- 长期理解迁移到 Memory & Mental Model Layer。
- 风险、隐私、治理迁移到 Governance & Safety Layer。

## Phase Roadmap

### Phase 1: MVP

目标：

先建立长期理解的最小闭环。

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
- 量表报告。
- 可穿戴设备。

### Phase 2: Graph / Retrieval

目标：

让长期理解可检索、可关联。

范围：

- Relationship Graph。
- Vector Search。
- GraphRAG 原型。
- 跨会话检索。

### Phase 3: Clinical Feedback

目标：

让用户看见并修正系统理解。

范围：

- 量表接入。
- 阶段性报告。
- 趋势变化。
- 用户可编辑理解。

### Phase 4: Multimodal / Wearable

目标：

把更多真实生活信号纳入长期理解。

范围：

- 语音情绪。
- 睡眠。
- HRV。
- 运动数据。

## Architecture Principle

不要把所有能力塞进 Conversation OS。

实时对话、专业策略、长期记忆、安全治理必须分层。

慢聊小记真正的护城河不是某一句回复，而是：

> 在长期使用中，系统是否形成了用户可修正、可追溯、可延续的理解。
