# Vocabulary Review

## 1. Purpose

本文档固定 Architecture v1 的术语边界，避免同一个词跨层表达不同含义。

本文不新增架构层、不新增产品能力、不重命名既有代码。它只明确：哪些词属于 Product Layer，哪些只是 runtime object、data contract、engineering implementation、legacy/frozen term，哪些不得继续用于正式架构命名。

## 2. Vocabulary Categories

### Product Layer

产品架构层。Architecture v1 只有五个 Product Layer。

### Runtime Object

运行时对象。它可以出现在链路中，但不能被描述为产品架构层。

### Data Contract

跨模块传递的数据契约。它定义输入输出形状，不代表独立能力层。

### Engineering Implementation

工程实现细节。可以被代码复用，但不能进入产品架构层级图。

### Legacy / Frozen Term

历史实现中保留的术语。允许兼容存在，但不得继续扩展，不得作为未来策略入口。

### Prohibited or Deprecated Term

禁止或弃用的正式架构命名。可以在历史文档中出现，但不得作为新设计中的正式术语。

## 3. Canonical Terms

| Term | Category | Status | Rule |
| --- | --- | --- | --- |
| Application Layer | Product Layer | Active | 用户入口、API、设置、隐私、展示与反馈流程。 |
| Conversation Layer | Product Layer | Active | 实时 Observe / Understand / Update，输出事实与已批准 deterministic signals。 |
| Clinical Logic Layer | Product Layer | Active | 决定 `ResponseGoal -> Strategy -> ClinicalPlan`。 |
| Memory & Mental Model Layer | Product Layer | Active | 负责长期理解、Evidence、Projection 内部实现与结构化 memory context。 |
| Safety & Governance Layer | Product Layer | Active | 横切安全与治理，优先级最高。 |
| ClinicalContext | Data Contract | Active | Clinical Logic 的输入契约，不是 Layer。 |
| ResponseGoal | Runtime Object | Active | Clinical Logic 的第一决策，不是 Layer，不是 Prompt 字段。 |
| Strategy | Runtime Object | Active | 服务于 ResponseGoal 的方法，不是第一入口。 |
| ClinicalPlan | Data Contract | Active | Clinical Logic 输出给 reply generation / trace 的结构化计划，不是 Layer。 |
| Prompt | Engineering Implementation | Active | 表达层构造物，不是 Product Layer，不承担理解职责。 |
| Projection Framework | Engineering Implementation | Active / Internal | Memory & Mental Model Layer 内部实现，不是产品能力，不是 Layer。 |
| RawMemory | Data Contract | Active | 原始数据账本。Clinical Logic 不得直接读取。 |
| Evidence | Data Contract | Active | 长期理解唯一入口。高层理解必须可追溯 Evidence。 |
| Understanding | Data Contract | Active | 长期理解草稿 / hypothesis-oriented object，不是用户事实。 |
| TimelineEvent | Data Contract | Active MVP | 事件线索对象。当前不深化 schema。 |
| Relationship | Data Contract | Active MVP | 人际关系线索对象。当前不做消歧 / 合并。 |
| EngageMode | Legacy / Frozen Term | Frozen | 旧 Conversation OS 策略字段，禁止新增枚举值。未来策略走 ClinicalPlan。 |
| ExperienceGoal | Legacy / Frozen Term | Frozen | 旧体验目标字段，禁止新增枚举值。未来回应目标走 ResponseGoal。 |
| QuestionStyle | Legacy / Frozen Term | Frozen | 旧问题风格字段，禁止新增枚举值。未来问题功能走 ClinicalPlan。 |
| VoiceConstraints | Legacy / Frozen Term | Frozen | 旧表达约束字段，禁止新增策略字段。 |
| relationshipStage.opening | Legacy / Frozen Term | Frozen / Compatibility | 旧 Conversation OS relationshipStage 的一个值，不等同于候选五态 opening。不得扩展。 |
| opening / exploring / deepening / action / closing | Prohibited or Deprecated Term | Not accepted as Conversation State | 不作为正式 Conversation State 落地。只允许在历史评审或废弃候选语境中出现。 |

## 4. Terms That Are Not Layers

以下术语不得作为 Product Layer：

- `ClinicalContext`
- `ResponseGoal`
- `Strategy`
- `ClinicalPlan`
- `Prompt`
- `Projection Framework`
- `RawMemory`
- `Evidence`
- `Understanding`
- `TimelineEvent`
- `Relationship`
- `Golden Dataset`
- `Trace`
- `Conversation State`
- `Voice Layer`
- `Question Style Guide`

## 5. Runtime Object Rules

Runtime object 只能描述运行时链路中的结构或决策点。

允许：

- `ClinicalContext` 作为 Clinical Logic 输入。
- `ResponseGoal` 作为 Clinical Logic 第一决策。
- `Strategy` 作为完成 ResponseGoal 的方法。
- `ClinicalPlan` 作为 traceable output。

不允许：

- 把 runtime object 写入产品层级图。
- 把 runtime object 当成独立产品能力。
- 让 runtime object 绕过 Safety。

## 6. Data Contract Rules

Data contract 必须只表达数据边界。

允许：

- `ClinicalContext` 汇总 Conversation 与 Memory 的结构化输入。
- `ClinicalPlan` 向 Prompt Builder 提供 response strategy contract。
- `Evidence` 作为长期理解证据入口。

不允许：

- Data contract 自己承担策略决策。
- Data contract 直接读 RawMemory。
- Data contract 通过命名暗示新的 Layer。

## 7. Engineering Implementation Rules

Engineering implementation 是内部机制。

`Projection Framework` 的规则：

- 只属于 Memory & Mental Model Layer 内部。
- 不出现在产品架构层级图。
- 不被导出或命名为 `Projection Layer`。
- 不被描述为用户可感知产品能力。

`Prompt` 的规则：

- 是表达构造机制。
- 不承担理解职责。
- 不替代 Clinical Logic。
- 不成为第六层。

## 8. Frozen Legacy Terms

以下术语冻结：

- `EngageMode`
- `ExperienceGoal`
- `QuestionStyle`
- `VoiceConstraints`
- `relationshipStage.opening`

冻结含义：

- 不新增枚举值。
- 不新增策略字段。
- 不新增旧策略 Prompt 分支。
- 允许兼容读取与展示。
- 允许 bug fix。
- 未来 response strategy 必须使用 ClinicalPlan。

## 9. Deprecated / Prohibited Formal Names

以下词不得继续用于正式架构命名：

- `Conversation State` 表达 `opening / exploring / deepening / action / closing` 五态。
- `exploring` 作为 Conversation Layer 输出。
- `deepening` 作为 Conversation Layer 输出。
- `action` 作为 Conversation Layer 输出。
- `Projection Layer`。
- `Prompt Layer` 作为 Architecture v1 产品层。
- `Voice Layer` 作为策略层。
- `Question Style` 作为策略层。

说明：

- `opening / exploring / deepening / action / closing` 可以出现在历史评审文档中，但不能成为当前正式架构对象。
- 如果未来需要状态敏感能力，必须重新评审并使用不含 Clinical Interpretation 的命名。

## 10. Naming Conflict Resolution

### relationshipStage.opening vs opening

`relationshipStage.opening` 是旧 Conversation OS 的 relationshipStage 值，语义是关系/在场层的旧兼容信号。

候选五态中的 `opening` 语义是会话阶段候选词。

两者不能共享正式语义。

Architecture v1 处理：

- 保留 `relationshipStage.opening` 作为 legacy/frozen compatibility term。
- 不落地候选五态 `opening / exploring / deepening / action / closing`。
- 不做全项目重命名，避免扩大变更面。

## 11. Single-Term Rule

同一个术语不得跨层表达不同含义。

如果某个词已经归属为：

- Product Layer：不能再作为 runtime object。
- Runtime Object：不能再作为 Product Layer。
- Engineering Implementation：不能再作为产品能力。
- Legacy / Frozen Term：不能再扩展为新策略入口。

任何违反本规则的新增文档或代码，都应被 architecture check 拦截或在 Review 中退回。
