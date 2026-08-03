# SlowTalk Notes PRD v1

本文件是 SlowTalk Notes v1 的正式产品与架构需求基准。

本文归并已经确认的 PRD、Architecture v1 Final、Memory V2、Clinical Logic 与
Safety 文档口径。2026-07-23 已批准的 Conversation OS 控制权收口更新了普通
聊天运行时职责。2026-07-31 已批准的 Hill 助人过程产品契约进一步划分了普通
对话汇总权与助人领域决策权，但不新增产品层。

## 1. Product Positioning

慢聊小记的 Application 可以承载两个产品，但二者不是同一个工作流：

- **慢聊**：聊天、陪伴与助人过程；
- **小记**：用户主动记录事件、开心、成就、善意或其他生活材料。

当前 Hill 迁移只适用于“慢聊”。小记、长期记忆和用户隔离是独立待办，不得被
聊天改造顺带实现。

慢聊是重隐私、长生命周期、具备数字治愈属性的 AI 陪伴产品。

它不是普通聊天机器人，也不是医疗产品。产品核心不是让 AI 在单句回复中显得更聪明，而是让用户在持续使用中感受到：

> AI 正在真诚地尝试理解自己，而用户始终拥有对自己意义的最终解释权。

产品定位：

- AI 情感陪伴与心理支持工具。
- 陪伴型心理教练 / AI 心理陪伴助手。
- 长期理解系统，而不是单次问答系统。

产品不定位为：

- 医疗诊断工具。
- 专业心理咨询替代品。
- 治疗计划生成器。
- 量表评估或临床报告系统。
- 用人格画像定义用户的系统。

## 2. Product Goals

v1 的核心目标：

1. 让用户感受到 AI 正在认真、持续、真诚地理解自己。
2. 建立长期理解的最小闭环。
3. 让每一轮回复来自可追踪的理解与决策过程，而不是直接来自 Prompt。
4. 将实时对话、长期记忆、助人策略与安全治理分层，避免职责混杂。
5. 保留用户修正系统理解的权利。

v1 的非目标：

- 不实现完整 CBT / ACT / MI 临床策略。
- 不生成诊断、评估、治疗计划或临床反馈报告。
- 不扩展 Graph-ready Memory。
- 不把 Prompt、Projection Framework、Trace 或 Dataset 升级为架构层。
- 不继续扩展旧 `EngageMode` / `ExperienceGoal` / `QuestionStyle` / `VoiceConstraints`。

## 3. Product Principles

### 3.1 Meaning Authority

AI 可以尝试理解、表达当前理解、邀请用户校准，并随着聊天不断修正理解。

AI 不可以：

- 替用户定义自己。
- 把猜测当成事实。
- 把一次表达固化成长期标签。
- 用历史覆盖当下。

### 3.2 Co-constructed Understanding

慢聊小记不是回答用户的 AI，而是不断与用户共同形成理解的 AI。

Memory、Summary、Insight、ClinicalPlan 都必须保持可修正性。它们表达的是当前共同理解草稿，而不是对用户的最终结论。

### 3.3 Evidence Before Conclusion

长期理解必须可追溯到底层证据。

Evidence 是长期理解入口。没有证据的判断不能写成长期理解。

### 3.4 Safety First

Safety & Governance 高于 Clinical Logic、Memory、Prompt 和 LLM 输出。

任何高风险场景都必须先进入 Safety 路径，不允许普通陪伴链路覆盖 Safety。

## 4. Five-Layer Architecture

Architecture v1 只有五个产品层：

```text
Application Layer
Conversation Layer
Clinical Logic Layer
Memory & Mental Model Layer
Safety & Governance Layer
```

以下不是产品层：

- `ClinicalContext`
- `ResponseGoal`
- `Strategy`
- `ClinicalPlan`
- `Prompt`
- `Projection Framework`
- `Conversation State`
- `Golden Dataset`
- `Trace`

这些只能是 runtime object、data contract、engineering implementation 或 evaluation asset。

## 5. Layer Responsibilities

### 5.1 Application Layer

职责：

- 用户入口：聊天、小记、时间线、设置、隐私管理。
- 登录、设备、会话、导出、删除、反馈等产品流程。
- 展示当前对话与用户可见的理解结果。
- 承载用户对系统理解的编辑、删除、反馈。

不负责：

- 判断心理策略。
- 生成长期心智模型。
- 做安全风险判定。
- 直接决定 Hill 目标、意图或技术。

### 5.2 Conversation Layer

职责：

- 接收用户输入。
- 组装当前消息、必要相邻话轮、回答义务、主动权、修复状态、Assistant Grounding 和相关记忆。
- 形成可组合的 Turn Interpretation 与 Dialogue State。
- 在每个普通非 Safety 慢聊话轮中调用 Helping Logic；
- 由唯一 Response Planner 输出一个 `ResponsePlan`。
- 在成功发送后记录 obligation/state update 和适用时的
  `CommittedHelpingMove`。

不负责：

- 绕过 Response Planner 让其他模块决定本轮动作。
- 自己实现心理学方法。
- 写长期 Memory。
- 形成用户画像。
- 扩展旧 Conversation OS 策略字段。

### 5.3 Clinical Logic Layer

职责：

- 在每个普通非 Safety 慢聊话轮中，作为 Helping Logic 产生可追踪的
  `HillHelpingDecision`；
- 判断 Hill 助人过程的适用性；
- 评估相关的上一已提交助人行动及当前用户反应；
- 选择流动的探索、领悟或行动目标；
- 评估准备度与反证；
- 选择服务于当前意图的 Hill 技术并执行 Helper Self Check；
- 输出结构化 `HillHelpingPlan`，供 Response Planner 汇总；
- 在迁移完成前，把旧 Rogers / `ClinicalPlan` 路径限制为显式兼容。

不负责：

- 直接读取 RawMemory。
- 写 Memory。
- 覆盖 Safety。
- 删除直接回答义务或普通对话约束。
- 汇总最终 `ResponsePlan`。
- 生成最终中文文案。
- 诊断、评估、治疗计划、临床报告。

### 5.4 Memory & Mental Model Layer

职责：

- 存储和演进长期理解。
- 维护 RawMemory、Evidence、SemanticMemory、Timeline、Relationship、Understanding Continuity。
- 通过 Projection Framework 生成可消费的 memory projection。
- 向 `ClinicalContext` 提供结构化记忆上下文。

不负责：

- 当前轮 Hill 适用性、目标、意图或技术。
- Safety 判断。
- Prompt construction。

### 5.5 Safety & Governance Layer

职责：

- 横切安全门控。
- Crisis / high-risk handling。
- 隐私与数据治理。
- 访问控制、审计、删除权、遗忘权。
- 产品边界与训练数据隔离。

Safety 可以在输入、Hill 决定、Prompt、最终回复等位置否决普通链路。

## 6. Runtime Flow

批准的目标运行时数据流：

```text
Context Assembly
  -> Turn Interpretation
  -> Dialogue State
  -> Helping Logic / HillHelpingDecision
  -> Response Planner (one final plan assembler)
  -> one ResponsePlan
  -> Surface Realization
  -> same-plan Output Validation
  -> State Update / trace / save
```

该流程不是产品层级划分。任何实现变化都必须继续遵守五层架构。

批次 0 的运行代码仍保持 2026-07-23 基线：Response Planner 只在少量活动下
请求旧 Clinical advice。该状态只作为迁移比较基线，不再是批准的产品目标。

## 7. Long-term Understanding

长期理解不是用户画像。

它是随着用户对话与小记持续形成、可追溯、可修正的共同理解过程。

长期理解必须满足：

- 来自 RawMemory。
- 通过 Evidence 追溯。
- 允许被用户修正。
- 不把 hypothesis 写成 fact。
- 不让历史压过当下。

## 8. Memory V2 Objects

### 8.1 RawMemory

RawMemory 是统一原始数据账本，保存聊天、小记、AI 生成记录等底层材料。

约束：

- 原始事实不应被覆盖。
- RawMemory 创建失败不阻断主流程。
- Clinical Logic 不直接读取 RawMemory。

### 8.2 Evidence

Evidence 是长期理解的唯一入口。

约束：

- 所有长期理解对象必须能追溯到 Evidence。
- Evidence 连接 RawMemory 与派生对象。
- Evidence 比结论优先。

### 8.3 SemanticMemory

SemanticMemory 是从 Evidence 投影出的语义材料。

v1 只接受 MVP 级别：

- 可版本化。
- 可追溯。
- 可进入 V2 Retrieval。

### 8.4 Timeline

Timeline 表达用户人生或产品使用中发生的重要事件线索。

v1 边界：

- 当前为 deterministic MVP。
- 不做 Timeline schema 深化。
- 不做最终人生故事生成。

### 8.5 Relationship

Relationship 表达用户提到的人际关系线索。

v1 边界：

- 当前为 deterministic MVP。
- 不做人物消歧 / 合并。
- 不做完整关系图谱。

### 8.6 Understanding Continuity

Understanding 表达当前对用户的长期理解草稿。

约束：

- Understanding 是 hypothesis-oriented，不是 fact。
- 必须可追溯 Evidence。
- 必须允许修正和下降置信。

## 9. One ResponsePlan With Hill Domain Decision

Conversation OS Response Planner 是唯一最终计划汇总者，但不是 Hill 领域决策
所有者。

职责边界：

- Conversation OS 负责事实、共同理解、直接回答义务、用户控制和普通对话动作；
- Helping Logic 负责适用性、反应、准备度、目标、意图和技术；
- Response Planner 把两类不重叠的决定汇总为一个 `ResponsePlan`；
- Surface 和 Validator 不得重新选择 Hill 方法；
- Safety 可以覆盖整个普通链路。

每个普通非 Safety 话轮必须产生一个成功决定或显式失败。成功决定可以是
`not_applicable`，这时由 Conversation OS 完成普通聊天或直接回答；它不表示每
一轮都要使用助人话术。

旧 `help_continue_expression`、`clarify`、`reflect`、`summarize`、
`support_action`、`hold_space`、Rogers advice 与 Need Resolution 只能作为迁移
兼容和历史评测语义，不能继续扩展成与 Hill 并列的决策系统。

## 10. Safety Priority

Safety 永远高于 Clinical Logic。

当 Safety 命中 crisis / high-risk：

- 不进入普通 `HillHelpingDecision`；
- 不推进探索、领悟或行动目标；
- 不注入普通 Helping / Clinical 方法；
- 直接进入 Safety Response。

## 11. Phase Roadmap

### Phase 1: MVP

目标：建立长期理解的最小闭环。

范围：

- PostgreSQL 保存原始消息。
- RawMemory / Evidence。
- SemanticMemory MVP。
- Timeline MVP。
- Relationship MVP。
- Understanding MVP。
- Conversation trace。
- Safety 最小规则。
- 一个可追踪的 ResponsePlan、Surface Realization 与同计划 Output Validation。

不做：

- Neo4j。
- Milvus。
- LangGraph。
- GraphRAG。
- 量表报告。
- 可穿戴设备。

### Phase 2: Graph / Retrieval

目标：让长期理解可检索、可关联。

范围：

- Relationship Graph。
- Vector Search。
- GraphRAG 原型。
- 跨会话检索。

### Phase 3: Clinical Feedback

目标：让用户看见并修正系统理解。

范围：

- 用户端理解草稿展示。
- 用户反馈与修正。
- Clinical feedback loop。

不做：

- 诊断。
- 治疗计划。
- 医疗建议。

### Phase 4: Reports / Advanced Reflection

目标：在安全与反馈闭环成熟后，再讨论更高阶复盘能力。

范围暂不展开。v1 不实现 Report / Assessment / Clinical Feedback / Treatment Plan。

## 12. Current v1 Boundary

当前 v1 已冻结：

- Conversation OS 骨架。
- Legacy `EngageMode` / `ExperienceGoal` / `QuestionStyle` / `VoiceConstraints`。
- Memory V2 Phase 2。
- Clinical Logic / Helping Logic 的 Hill 产品合同与分批迁移计划。
- 已通过技术验收的批次 1 类型化 Hill Shadow：默认关闭，只记录独立 trace，不改变
  `ResponsePlan`、正式状态或用户可见回复。
- 已通过完整冻结门并于 2026-08-04 关闭的 Batch 1.5-E 普通聊天交接基线：由独立
  默认关闭的 `HILL_HELPING_ORDINARY_HANDOFF` 控制，只把确定性 `uncertain` 边界
  交给普通 Planner；不启用 Hill 目标、技术或正式助人状态。早期人工盲审与候选
  1—6 的失败结果保留为历史证据，不覆盖后续 60/60 冻结门结论。
- Conversation OS 单一 ResponsePlan 决策闭环。
- Helping Logic 拥有 Hill 领域判断；Response Planner 保持唯一最终计划汇总权。
- 旧按需 Clinical advice、ResponseGoal 和 ClinicalPlan 仅作为迁移基线及兼容评测。
- Golden Dataset 与 eval 基础。
- Architecture v1 final constraints。

当前 v1 不继续做：

- Graph-ready Memory。
- Timeline schema 深化。
- Understanding schema 深化。
- Relationship 消歧 / 合并。
- 未经审查扩展 Conversation State 决策字段。
- 继续扩展 Need Resolution 枚举或旧 Clinical Strategy 集合。
- CBT / ACT / MI 策略实现。
- 把 Batch 2 infrastructure-only 授权扩大为用户可见 Hill 行为；Batch 2 只实现
  跨轮关联、序列化/加载、Shadow trace 与提交边界，Batch 3 仍须单独验收和授权。
- 把已冻结的 Batch 2A metadata/parser 合同解释为正式生产 Helping 写入或跨轮
  Helping 决策已经启用；这些仍须通过 Batch 2B—2D。
- Prompt 大改。
- 旧 Conversation OS 策略扩展。

## 13. Reference Documents

- [ARCHITECTURE_V1_FINAL.md](./ARCHITECTURE_V1_FINAL.md)
- [PRODUCT_ARCHITECTURE_V1.md](./PRODUCT_ARCHITECTURE_V1.md)
- [MEMORY_V2_PHASE2_ACCEPTANCE.md](./MEMORY_V2_PHASE2_ACCEPTANCE.md)
- [CLINICAL_LOGIC_IMPLEMENTATION_PLAN.md](./CLINICAL_LOGIC_IMPLEMENTATION_PLAN.md)
- [RESPONSE_GOAL_DESIGN.md](./RESPONSE_GOAL_DESIGN.md)
- [CONVERSATION_LAYER_BOUNDARY_REVIEW.md](./CONVERSATION_LAYER_BOUNDARY_REVIEW.md)
- [CLINICAL_GOLDEN_DATASET_SPEC.md](./CLINICAL_GOLDEN_DATASET_SPEC.md)
- [HILL_HELPING_PROCESS_PRODUCT_CONTRACT_V1.md](./HILL_HELPING_PROCESS_PRODUCT_CONTRACT_V1.md)
- [HILL_HELPING_PROCESS_ARCHITECTURE_MIGRATION_PLAN_V1.md](./HILL_HELPING_PROCESS_ARCHITECTURE_MIGRATION_PLAN_V1.md)
