# Architecture v1 Final

## Status

**Final.** 本文档固定 Manliao Xiaoji 在所有已完成 Review 之后的最终架
构基线。任何对层次划分、层间数据流、层职责或已接受 Architecture Rules
的变更，都必须走 v2 评审，不允许通过 diff 逐步侵蚀。

本文档只固定架构，不新增设计、不新增 Layer、不修改已有实现。文档中出
现的所有命名（ClinicalContext / ResponseGoal / Strategy / ClinicalPlan
/ Projection Framework）均为对已在讨论中出现过的概念做归总命名，不引
入新组件。

---

## 1. 五层架构（最终版）

```text
┌─────────────────────────────────────────────────────────┐
│                    Safety Layer                          │  横切 / 优先级最高
├─────────────────────────────────────────────────────────┤
│  Conversation Layer   │  Memory Layer                    │  感知 / 记忆
├───────────────────────┴──────────────────────────────────┤
│                Clinical Logic Layer                      │  决策
├──────────────────────────────────────────────────────────┤
│                Prompt / Composition Layer                │  表达
└──────────────────────────────────────────────────────────┘
```

五层分别为：

1. **Conversation Layer** — 感知层
2. **Memory Layer** — 记忆层
3. **Clinical Logic Layer** — 决策层
4. **Safety Layer** — 横切护栏层（优先级高于 Clinical Logic）
5. **Prompt / Composition Layer** — 表达层

## 2. 每一层的唯一职责

### 2.1 Conversation Layer — 实时理解

- **唯一职责**：对**本轮及最近若干轮**对话做实时观察与理解。
- **输出**：Facts + Signals（见 §4）。
- **不做**：Clinical Strategy、长期理解、助人阶段判断、跨会话推断。

### 2.2 Memory Layer — 长期材料的存储与投影

- **唯一职责**：持久化对话/小记/生成记录/审查记录，并向上层提供**经过
  投影（Projection）后的可消费视图**。
- **输出**：Memory Projection（对 raw records 做过筛选、汇总、去噪的结
  构化视图）。
- **不做**：ResponseGoal 决策、Clinical Strategy、直接对外暴露 raw
  records。

### 2.3 Clinical Logic Layer — 决策

- **唯一职责**：基于 ClinicalContext 依序产出 **ResponseGoal → Strategy
  → ClinicalPlan**。
- **输入**：ClinicalContext（由 Conversation Facts+Signals 与 Memory
  Projection 合成，见 §3）。
- **不做**：直接读取原始 Message、直接读取 RawMemory、渲染 Prompt。

### 2.4 Safety Layer — 优先级最高的横切护栏

- **唯一职责**：对 Message、Clinical Logic 决策、最终 Prompt 三个位置
  做安全评估，具备**否决权**。
- **权限**：Safety **可以**直接读 Message（这是它与 Clinical Logic 的
  关键差别）。
- **不做**：产生 ResponseGoal、决定回复内容风格、参与常规回复措辞。

### 2.5 Prompt / Composition Layer — 表达

- **唯一职责**：把 ClinicalPlan 渲染为发给模型的 Prompt，并把模型输出
  组织为最终回复。
- **不做**：Clinical 决策、Safety 判断、Memory 读写。

## 3. 层间唯一数据流

**唯一合法数据流**：

```text
Conversation ─┐
              ├─► ClinicalContext ─► ResponseGoal ─► Strategy ─► ClinicalPlan ─► Prompt
Memory ───────┘
                       │
                       └─ Safety gates every arrow above
```

关键约定：

- **ClinicalContext** 是 Clinical Logic 唯一的输入结构，由
  Conversation Facts+Signals 与 Memory Projection 合成，不包含 raw
  Message，也不包含 raw Memory records。
- **ResponseGoal → Strategy → ClinicalPlan** 是 Clinical Logic 内部的
  三步顺序（见 §7 §8）。
- **Prompt Layer** 只读 ClinicalPlan，不再回读 Conversation / Memory /
  Clinical Logic 的中间产物。
- **Safety Layer** 是横切的：它同时在 Message 入口、Clinical Logic 输
  出、Prompt 出口三个位置做检查，任一位置否决即整条流程降级到安全兜
  底路径。

除上述箭头外，**没有任何其他跨层数据传递路径被允许**。

## 4. Conversation Layer 输出：Facts + Signals

Conversation Layer 只输出两类内容：

- **Facts（客观会话事实）**：turn 位置、消息长度、时间间隔、pattern
  命中（correction / boundary / advice / crisis / silence-ish 等）、
  连续性观察（数字趋势、低信息回声、最近边界记录等）。
- **Signals（实时理解信号）**：由 Facts 归纳得到、**不带临床阶段含义**
  的即时状态描述（如现有 `expressionMode / rhythm / presenceMode /
  relationshipStage(stranger|present|opening|organizing) / continuity`）。

Facts + Signals 均属于**实时理解**范畴，不包含助人流程阶段判断
（exploring / deepening / action 等）。这一边界由
[`CONVERSATION_LAYER_BOUNDARY_REVIEW`](./CONVERSATION_LAYER_BOUNDARY_REVIEW.md)
固定。

## 5. Clinical Logic 不直接读取 Message

Clinical Logic 的输入**只能是 ClinicalContext**，不允许直接读取用户原
始 Message，也不允许绕过 Conversation Layer 自行做正则/关键词判断。

原因：

- 保证 Conversation Layer 是唯一"看到消息"的感知入口，避免同一个消息
  在两处被独立解读、产生分裂结论。
- 让 Conversation Layer 的边界（§4）能真正约束 Clinical Logic 的输入
  面。

例外：**Safety Layer** 可以直接读 Message（见 §2.4）。Safety 与 Clinical
Logic 是两条独立通道，Safety 的直接读权限不代表 Clinical Logic 也有。

## 6. Memory 不直接决定 ResponseGoal

Memory 的输出（Memory Projection）**只能作为 ClinicalContext 的一部分
被 Clinical Logic 消费**，不允许存在"某条记忆命中 → 直接切换 ResponseGoal"
这样的短路径。

推论：

- 任何"用户之前说过 X，所以本轮 ResponseGoal = Y"的逻辑，必须以
  Clinical Logic 内的显式规则形式存在，而不是藏在 Memory 层。
- Memory 层不允许存放 ResponseGoal 相关的判断表。

## 7. ResponseGoal 是 Clinical Logic 的第一决策

Clinical Logic 一进入就必须先决定 **ResponseGoal**（本轮回复要达成的
目标）：

- ResponseGoal 之前，不做 Strategy 挑选，不做 ClinicalPlan 组装，不做
  措辞倾向选择。
- ResponseGoal 是 Clinical Logic 对外可解释、可 log、可回溯的第一个决
  策产物。
- ResponseGoal 的候选集属于 Clinical Logic 内部定义，本文档不枚举。

## 8. Strategy 是 ResponseGoal 的实现方式

- **Strategy** 描述"用什么方式去达成本轮 ResponseGoal"。
- Strategy 由 ResponseGoal 决定，**不能与 ResponseGoal 并列**，也不能
  绕过 ResponseGoal 独立存在。
- Strategy 的产物送入 **ClinicalPlan**，ClinicalPlan 是 Clinical Logic
  向 Prompt Layer 交付的最终结构化载荷。

## 9. Projection Framework 是 Memory 内部工程实现

- **Projection Framework** 指 Memory Layer 内部把 raw records（chat
  messages / ai generations / judge results / notes 等）投影为可供上
  层消费的结构化视图的工程手段。
- 它是 **Memory Layer 的内部实现细节**，不属于产品架构，不出现在层次
  图中，不出现在层间接口契约中。
- 上层（Clinical Logic / Prompt）**只感知 Memory Projection 的结构**，
  不感知 Projection Framework 本身。

## 10. Architecture Rules（已接受）

以下规则在 v1 阶段为**硬约束**，任何一条被违反都视为 v1 违规。

### R1. Conversation-derived signals 未通过独立评审前不得影响 ResponseGoal

- 任何"新的 Conversation Signal 直接 → ResponseGoal"链路，必须先通过
  一次针对该信号本身的边界评审，确认它属于 Facts+Signals 范畴而非临床
  阶段判断。
- 未通过评审前，**该 signal 只能被 Clinical Logic 读取，不能作为
  ResponseGoal 的决定性输入。**
- 参见：`CONVERSATION_LAYER_BOUNDARY_REVIEW.md`。

### R2. Clinical Logic 不得直接消费 RawMemory

- Clinical Logic 只能读 Memory Projection，不能读 raw records。
- 违反本条即绕过 Memory Layer 的职责边界（§2.2 §6）。

### R3. Safety 永远高于 Clinical Logic

- Safety Layer 在 Message 入口、Clinical Logic 输出、Prompt 出口三处
  均具备否决权。
- 任一处否决时，流程必须走安全兜底路径（fallback / crisis 应答），
  Clinical Logic 的 ResponseGoal / Strategy / ClinicalPlan 全部作废。
- Clinical Logic 不允许"覆盖"或"降级"Safety 判定。

### R4. Legacy Conversation OS 策略冻结

- 现有 `services/ai/slowChatOS.ts` / `ragKnowledge.ts` /
  `responsePolicy.ts` / `interactionPlan.ts` / `promptBuilder.ts` /
  `aiJudgeService.ts` / `chatReplyService.ts` / `rewriteService.ts`
  中的**策略集与规则表**在 v1 阶段冻结。
- "冻结"含义：
  - 不新增新的策略维度、新的关系阶段、新的 rhythm、新的 presenceMode。
  - 不新增新的 RAG 卡片类型（现有卡片的文案微调不受此条约束）。
  - 不新增新的 Judge issue 种类。
  - **允许**在现有维度下修正 bug、收紧误判、调整措辞。
- v2 才讨论解冻。

### R5. 层间数据流唯一

- §3 描述的数据流是唯一合法路径；不允许存在其他跨层短路径（例如
  Memory → Prompt 直连、Conversation → Prompt 直连、Memory →
  ResponseGoal 直连）。

### R6. 命名归属不可越界

- `exploring / deepening / action / closing` 等助人流程阶段词**不得**
  出现在 Conversation Layer 的输出结构中（Facts+Signals 命名空间内）。
- 若 Clinical Logic 内部需要类似概念，仅可出现在 Clinical Logic 内部
  的 ResponseGoal / Strategy 命名空间中，不外泄回 Conversation Layer。

## 11. Architecture v1 最终版（速览）

- **五层**：Conversation / Memory / Clinical Logic / Safety / Prompt。
- **数据流**：`Conversation + Memory → ClinicalContext → ResponseGoal
  → Strategy → ClinicalPlan → Prompt`；Safety 横切三点门控。
- **感知边界**：Conversation 输出 Facts+Signals；Clinical Logic 不读
  Message；Memory 不决定 ResponseGoal。
- **决策顺序**：ResponseGoal 先，Strategy 后，ClinicalPlan 最后。
- **工程边界**：Projection Framework 属于 Memory 内部，不进架构图。
- **硬约束**：R1–R6 全部生效。

本节即为 Architecture v1 最终版。任何后续变更须走 v2 评审。
