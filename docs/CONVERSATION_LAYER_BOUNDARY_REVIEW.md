# Conversation Layer Boundary Review

## 背景

本评审只做一件事：判断五个候选 Conversation State（`opening` / `exploring` /
`deepening` / `action` / `closing`）是否符合 SlowTalk Notes PRD v1.0 对
Conversation Layer 的职责边界：

- 只做 **Observe / Understand / Update**
- 只做 **实时理解**
- 不做 **Clinical Strategy**
- 不做 **长期理解**

评审不改代码、不改 Prompt、不改 Memory、不改 Safety、不新增 ResponseGoal、
不新增架构层。

### 与现有代码的对照

现有 `services/ai/slowChatOS.ts` 的 `relationshipStage` 是
`stranger | present | opening | organizing`（四个），与本评审讨论的五个
候选 state 名字集**并不一致**。本评审对象是**候选五态模型本身**，即
Experience Sprint 2 拟引入或已在讨论中的这一套命名，与既有实现是否吻合
不作为本次结论依据。

---

## 逐项回答

### 1. 五个 state 中，哪些是纯会话状态

**纯会话状态（可从对话事实直接观察）**：

- `opening`：会话是否处于起始位。首轮 / 长时间未说 / 打招呼型入场，都是
  可从 turn index、时间戳、内容模板直接观察得到的**客观会话事实**，不需
  要临床判断。
- `closing`：用户是否在收束。出现"算了 / 先这样 / 我要走了 / 别问了 /
  长时间不回"这类可从文本层面直接标注的信号即可判定，也是客观会话事实。

其余三个（`exploring` / `deepening` / `action`）都不是纯会话状态，理由
见第 2 项。

### 2. 哪些 state 已经带有 Clinical Interpretation

- `exploring`：**命名越界，事实层可挽救**。"Exploring" 是 Hill《助人技
  术》中"探索-领悟-行动"三阶段的第一段专有名称，天然携带临床语义。它
  想表达的会话事实（用户在给素材但未指向明确方向）本身可观察，但**用
  这个名字就等于让 Conversation Layer 说出临床阶段判断**。
- `deepening`：**语义完全越界**。判断本轮比上一轮"更深"，需要在情感颗
  粒度、含义指向、自我暴露程度上做比较，属于典型的临床推断（deepening
  是咨询过程研究里对治疗性推进的描述词），不是会话事实。
- `action`：**语义越界**。"进入行动阶段"是助人过程判断；即使用户说了
  "怎么办 / 要不要 / 该不该"，那也只是一个**用户意图信号**，把它命名为
  一个 state 就等于把 ResponseGoal 的前置决定塞进了 Conversation Layer。

### 3. `deepening` 属于 Conversation Layer 还是 Clinical Logic

**`deepening` 属于 Clinical Logic，不属于 Conversation Layer。**

Conversation Layer 能观察到的是"这轮更长 / 出现了新的情感词 / 从事件描
述转为身体感受 / 从第三人称转为第一人称"这些**客观信号**。把这些信号
组合并解释为"用户正在深入"这一临床推进判断，是 Clinical Logic 的工作。
让 Conversation Layer 输出 `deepening`，就是让它替 Clinical Logic 做决
定。

### 4. `action` 是会话状态还是用户意图 / Response Goal 的前置信号

**`action` 是用户意图 / Response Goal 的前置信号，不是会话状态。**

会话事实层能捕捉到的是"用户在本轮出现了明确求建议 pattern"，这已经在
现有代码里以 `expressionMode: advice` 形式存在。是否把这一信号升格为
"进入行动阶段"，是 Clinical Logic 依据关系阶段、准备度、风险级别再做
的判断，最终应影响 ResponseGoal 而不是 ConversationState。

若把 `action` 作为 state 存在，会导致一个隐性的耦合：`state → ResponseGoal`
表面上是"会话状态影响回复目标"，实际是"临床判断影响回复目标"，绕过了
本该显式存在的 Clinical Logic 决策点。

### 5. Conversation Layer 应该输出什么

**只输出两类：**

1. **客观会话事实**：turn 位置、消息长度、表达模式、边界/纠正/危机等
   pattern 命中、连续性观察（数字变化、低信息回声、连续短答等）。
2. **实时理解信号**：把上述事实归纳后的、**不带临床推进含义**的即时
   状态描述（如 rhythm / presenceMode / relationshipStage 的
   `stranger|present|opening|organizing` 这种关系-在场描述）。

**不输出：** 助人阶段判断（探索 / 领悟 / 行动 / 深化 / 收束治疗性意义
上的收束）。这类判断属于 Clinical Logic。

### 6. Clinical Logic 与 Conversation Layer 的读写方向

**Clinical Logic 可以消费的 Conversation Layer 输出：**

- expressionMode（word / number / symbol / sentence / correction /
  silence-ish / advice / crisis / boundary）
- rhythm、presenceMode
- continuity 观察（数字趋势、低信息回声、最近是否有 boundary 等）
- 会话客观位（是否首轮、是否用户在收束、是否长时间未回复）

**Clinical Logic 不能反向修改：**

- expressionMode（这是 Conversation Layer 对本轮输入的客观标注）
- continuity 事实（数字序列、边界记录、低信息回声计数等）
- 关系-在场层的 stage / rhythm / presenceMode（Clinical Logic 只能读，
  不能写回 Conversation Layer 的当前态；要影响下一轮，通过 ResponseGoal
  发出，让 Conversation Layer 在下一轮自然重算）

**换言之：** Conversation Layer 是感知层，单向向上供给；Clinical Logic
的决策落地必须走 ResponseGoal，不允许回写会话状态。

### 7. 当前代码需要怎么处理

前提：**本评审不改代码**。以下只是对候选五态模型的处置判断。

- **保留不动**：现有 `slowChatOS.ts` 的
  `relationshipStage / expressionMode / rhythm / presenceMode / continuity`
  这套字段，全部落在 Conversation Layer 边界内，保留。
- **改名 / 拆分 / 回退为更客观的状态**（针对候选五态）：
  - `opening`：保留，是纯会话事实。
  - `closing`：保留，是纯会话事实。
  - `exploring`：**回退为更客观的状态**。它想表达的事实由现有
    `expressionMode` + relationshipStage 已经覆盖，不需要再引入一个带
    临床名字的 state。
  - `deepening`：**移出 Conversation Layer**。这是 Clinical Logic 的判
    断结果，不应该出现在 Conversation State 枚举里。
  - `action`：**移出 Conversation Layer**。它是用户意图信号（已有
    `expressionMode: advice`）加上 Clinical Logic 判断得到的结果，最终
    表达为 ResponseGoal，不应该出现在 Conversation State 枚举里。

### 8. 唯一建议

**不要把 `opening / exploring / deepening / action / closing` 作为
Conversation Layer 的状态集落地。** Conversation Layer 只保留可从对话
事实直接观察的字段（现有 relationshipStage / expressionMode / rhythm /
presenceMode / continuity 已经够用）；`exploring / deepening / action`
所指向的"用户正处于助人流程的哪一段"这一判断，交给 Clinical Logic 在
Conversation Layer 输出之上单独推断，落到 ResponseGoal。

### 9. 是否阻塞后续让 state 影响 ResponseGoal

**阻塞。**

在候选五态被采纳的前提下，让 state 影响 ResponseGoal 等价于让"临床阶
段判断"影响 ResponseGoal，且这一临床判断被藏在 Conversation Layer 里
悄悄发生，没有显式的 Clinical Logic 决策点。这与 PRD v1.0 中
"Conversation Layer 不负责 Clinical Strategy" 的约束直接冲突。

必须先完成本评审中"必须修改项"的收敛，才允许接入 `state → ResponseGoal`
的链路。允许接入的前提是：只有**纯会话事实层**的信号可以喂给
ResponseGoal 计算；临床阶段判断必须走 Clinical Logic 单独一步。

### 10. Report / Assessment / Memory

按约定不讨论。

---

## 输出

### 结论

候选的五态模型（`opening / exploring / deepening / action / closing`）
**部分越过 Conversation Layer 边界**。`opening / closing` 属于纯会话事
实，可以留在 Conversation Layer；`exploring / deepening / action` 携
带助人流程的临床阶段判断，属于 Clinical Logic 的产物，不应作为
Conversation State 存在。

### 越界项

- `exploring`：命名与语义都指向"探索-领悟-行动"的临床阶段。
- `deepening`：完全是临床推进判断，不是会话事实。
- `action`：是用户意图信号 + 临床判断的合成结果，属于 ResponseGoal 的
  前置信号，不是 state。

### 保留项

- 现有 `relationshipStage`（stranger / present / opening / organizing）
- 现有 `expressionMode`（含 advice / correction / boundary / crisis /
  silence-ish 等）
- 现有 `rhythm`
- 现有 `presenceMode`
- 现有 `continuity`（数字趋势、低信息回声、最近边界等客观观察）
- 候选五态中的 `opening`、`closing`（作为客观会话位标注可接受）

### 必须修改项

- 不引入 `exploring` 作为 Conversation State。
- 不引入 `deepening` 作为 Conversation State。
- 不引入 `action` 作为 Conversation State。
- 明确 Conversation Layer 与 Clinical Logic 的读写方向：Clinical Logic
  只读 Conversation Layer 输出，不回写；Clinical Logic 的决策统一走
  ResponseGoal。
- 在候选五态被清理之前，暂缓 `state → ResponseGoal` 链路的接入。

### 可以后置项

- 是否需要在 Conversation Layer 显式增加 `opening` / `closing` 两个
  客观位字段（可以在下一次评审再决定，本次不动代码）。
- 现有 `relationshipStage` 的四态命名是否要与 PRD v1.0 术语再对齐一次
  （命名对齐，不改语义，可后置）。
- Clinical Logic 层如何定义"exploring / deepening / action"的推断规则
  （属于 Clinical Logic 自身的设计，不在本评审范围）。

### 下一步唯一动作

合入本评审文档，作为 Conversation Layer 边界基线。Experience Sprint 2
在这一基线被承认之前，不落地五态模型，不接入 `state → ResponseGoal`
链路。
