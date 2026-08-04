# Batch 2C Reaction Assessment Contract v1

状态：`B2-Reaction-Shadow` 已冻结；仅授权 reaction-only、shadow-only、
fixture-only 合同，不启用任何 downstream integration

日期：2026-08-04

## 1. 目的与范围

本合同冻结 Batch 2C 的 Reaction Assessment 结构、证据语义、fail-closed 边界及
formal/Shadow 隔离规则。它建立在已通过的 Batch 2A formal Helping metadata contract
和 Batch 2B fixture load/association gate 之上。

Batch 2C 的权威名称为：

> **Batch 2C — Reaction Assessment Contract Gate**

验收门标识为：

```text
B2-Reaction-Shadow
```

本批次严格限定为：

- reaction-only；
- shadow-only；
- fixture-only；
- observation-only；
- zero downstream integration；
- zero user-visible behavior change；
- zero formal reaction persistence。

早期路线材料中把 Atomic Boundary 称为 Batch 2C、把 Shadow reaction 称为 Batch 2D
的编号，不再代表当前权威 Batch 2C 范围。历史评审证据保持不改写；Atomic Boundary
继续保持未授权、未实现，并由后续独立决定确定编号。

## 2. 非目标

本合同不授权：

- runtime 或 production orchestration 接入；
- production/current-session DB loader 或 writer；
- Reaction evaluator、LLM extraction 或 provider 调用；
- `HillHelpingPlan.previousMoveAssessment` 接入；
- Planner、Prompt、Surface 或 Validator 修改；
- Memory、Understanding、Relationship 或 User Model 接入；
- Initiative、问题预算、主动话题或暂停所有权修改；
- formal Reaction state 或 reaction persistence；
- 新的 `CommittedHelpingMove` 正式生产写入；
- 用户可见 Hill 行为、Batch 3、默认开启或部署。

## 3. 输入前置条件

Reaction Assessment 只能消费已经通过 Batch 2B gate 的目标绑定结果。处理顺序固定为：

```text
Batch 2A formal_v1 parse
  -> Batch 2B bounded fixture load
  -> Batch 2B target-bound association
  -> Batch 2C Reaction Candidate validation
  -> derive reactionEvidenceKnown
  -> derive impactKnown
  -> fixture-only Shadow trace
```

Batch 2C 不得重新选择历史 target，不得用最近一条消息、物理相邻、回复长度、继续
聊天、Initiative state 或 `expectedUserResponse` 替代 Batch 2B association。

只有当前 session、Assistant role、身份一致、严格解析为 `formal_v1` 且通过唯一
target/relation gate 的 `CommittedHelpingMove` 可以成为影响评估目标。

`topic_shift` 和 `unclear` 仍是 non-associating relation。如果 fixture trace 保留了
同一当前 user turn 的 target-bound provenance，Batch 2C 可以记录
`observed_non_impact`；否则必须返回 `not_evaluable`。两者都不能形成影响结论。

## 4. 权威 Schema

### 4.1 Reaction evidence

```ts
type ReactionEvidenceRole =
  | "supports_reaction"
  | "supports_impact"
  | "counterevidence"

type ReactionEvidenceV1 = {
  sourceUserTurnId: string
  targetAssistantTurnId: string
  role: ReactionEvidenceRole
  text: string
}
```

规则：

- identity 和 `text` 必须为非空字符串；
- evidence 必须来自当前 user turn 的用户原文或由该原文直接支持的冻结 fixture
  semantic evidence；
- Assistant 文本只能定位 target，不能作为用户反应或影响证据；
- 模型生成的用户事实摘要、Memory、User Model、消息形式和统计特征不能成为 evidence；
- `counterevidence` 必须保留，不能为了得到 known 结论而丢弃。

### 4.2 Reaction candidate

```ts
type ReactionCandidateV1 = {
  reaction:
    | "continued_exploration"
    | "expressed_new_awareness"
    | "moved_toward_action"
    | "reported_action_result"
    | "accepted_or_used_move"
    | "corrected_or_rejected_move"
    | "relationship_strain"
    | "paused_or_withdrew"
    | "requested_different_help"
    | "topic_shift"
    | "unclear"

  confidence: number
  sourceUserTurnId: string
  targetAssistantTurnId: string

  relationToPreviousMove:
    | "direct_response"
    | "continues_move"
    | "rejects_move"
    | "topic_shift"
    | "unclear"

  evidence: ReactionEvidenceV1[]
}
```

严格规则：

- 顶层和嵌套对象拒绝未知字段；
- `confidence` 必须为有限数并位于 `[0, 1]`；
- confidence 只用于排序与审计，不能决定 known 状态或 formal 晋升；
- evidence 必须非空；
- candidate、association 和所有 evidence 必须绑定同一个 current user turn 和同一个
  formal target；
- 一轮可以有多个互补 candidate；
- 任一 candidate 结构无效时，整份 assessment fail closed，不能静默删除坏项后接受
  剩余项；
- `CommittedHelpingMove.expectedUserResponse` 只能描述历史计划，不能证明用户实际
  产生了某个 reaction。

### 4.3 Shadow assessment envelope

```ts
type Batch2CReactionAssessmentV1 = {
  schemaVersion: 1
  mode: "shadow"
  source: "fixture"

  status:
    | "assessed"
    | "observed_non_impact"
    | "not_evaluable"
    | "invalid"
    | "failed"

  sourceUserTurnId: string
  targetAssistantTurnId?: string
  targetPlanId?: string

  relation?:
    | "direct_response"
    | "continues_move"
    | "rejects_move"
    | "topic_shift"
    | "unclear"

  reactionCandidates: ReactionCandidateV1[]
  reactionEvidenceKnown: boolean
  impactKnown: boolean
  reasons: string[]
}
```

该 envelope 只能存在于 fixture evaluation 输出。它不得复用
`FormalCommittedHelpingMoveMetadataV1`，不得进入 `ChatMessage.interactionMetadata`
或任何正式会话状态，也不得成为下一轮 Helping decision 输入。

Status 不变量：

- `assessed`：必须有唯一 formal target、`direct_response | continues_move |
  rejects_move` relation、至少一个严格有效 candidate，且
  `reactionEvidenceKnown=true`；`impactKnown` 只能按第 6 节派生；
- `observed_non_impact`：只能承载 target-bound `topic_shift | unclear`，并固定
  `impactKnown=false`；明确 topic shift 可以令 `reactionEvidenceKnown=true`，
  `unclear` 必须令其为 `false`；
- `not_evaluable | invalid | failed`：`reactionCandidates=[]`，两个 known 均为
  `false`，且 `reasons` 必须非空；
- status 不允许调用方通过删除字段或降级 reason 在不同分支之间转换。

## 5. `reactionEvidenceKnown` 语义

`reactionEvidenceKnown` 表示：

> 当前 user turn 是否提供了足够明确、可追溯、目标绑定的证据，使至少一个
> reaction 类型能够被可靠描述。

它判断“反应是否可分类”，不判断该 move 是否产生了影响。

可以为 `true` 的证据包括：

- 用户明确接受、拒绝或纠正目标 move；
- 用户明确继续回答目标问题；
- 用户明确要求不同帮助；
- 用户明确报告执行或尝试目标建议；
- 用户明确表达 target-bound topic shift。

以下情况必须为 `false`：

- 只有文本长短、继续聊天、沉默、emoji、语气词或未回答问题；
- target 或 relation 不唯一；
- evidence 不属于当前 user turn；
- 只依据 Assistant 的预期反应；
- relation 为 `unclear`；
- candidate 存在未解决冲突；
- 用户出现新内容，但不能证明是在回应目标 move。

## 6. `impactKnown` 语义

`impactKnown` 表示：

> 用户是否明确陈述了指定 Helping move 对本次互动的适配性、体验、使用结果、
> 无效果或负面效果。

逻辑约束固定为：

```text
impactKnown=true
  => reactionEvidenceKnown=true
  => formal target association 已通过
  => 至少一项 supports_impact evidence
```

反向不成立：

```text
reactionEvidenceKnown=true !=> impactKnown=true
```

`impactKnown=true` 不表示：

- 客观因果已经成立；
- Hill 技术成功；
- AI 导致了用户领悟、行动或情绪变化；
- 该方法长期适合用户；
- 用户形成稳定偏好、人格或阶段属性。

Known 与 positive/success 必须分离。用户明确报告拒绝、无效果、压力或其他负面结果
同样可以令 `impactKnown=true`；trace 只能记录“用户报告了该影响”，不能升级成客观
因果事实。

| User evidence | reactionEvidenceKnown | impactKnown |
|---|---:|---:|
| “对，就是这个意思” | true | false |
| “好，我试试” | true | false |
| “我试了，但没什么变化” | true | true |
| “你刚才连续问让我压力更大” | true | true |
| “不是你的问题让我好些，是事情解决了” | true | true，仅记录用户报告的无归因 |
| 明确换话题 | true | false |
| “嗯”或 emoji | false | false |
| 回复变长但未评价 move | false | false |
| “可能有帮助，也可能只是时间过去了” | true | false |

## 7. Relation / Reaction 兼容规则

- `topic_shift` relation 只能产生 `topic_shift` reaction，且 `impactKnown=false`；
- `unclear` relation 只能产生 `unclear` reaction，两个 known 均为 `false`；
- correction target 必须使用 `rejects_move`；
- `rejects_move` 至少支持 `corrected_or_rejected_move`；只有明确证据时才能同时产生
  `relationship_strain`、`paused_or_withdrew` 或 `requested_different_help`；
- `direct_response` / `continues_move` 可以产生探索、觉察、行动、接受或结果 candidate，
  但不得自动令 `impactKnown=true`；
- 新领悟不得仅因发生在 Assistant move 之后而归因给 AI；
- 多个清晰且不冲突的 candidate 可以共存；未解决的正负或因果冲突必须令
  `impactKnown=false`。

## 8. Fail-closed 合同

以下任一条件必须得到统一安全结果：

```text
status = not_evaluable | invalid | failed
reactionCandidates = []
reactionEvidenceKnown = false
impactKnown = false
zero downstream state change
```

Fail-closed 条件包括：

- 无 Batch 2B association；
- target 不是当前 session 的 `formal_v1`；
- source user turn 不匹配；
- target、relation 或 correction target 冲突；
- stale、空或不可追溯 evidence；
- evidence 来自 Assistant、Memory、User Model 或模型摘要；
- unknown field、unknown enum、坏类型或空 identity；
- confidence 非有限或超出 `[0,1]`；
- candidate target/relation 与 association 不一致；
- relation/reaction 组合不相容；
- `topic_shift` 或 `unclear` 却输出 `impactKnown=true`；
- `impactKnown=true` 但没有 `supports_impact` evidence；
- 存在未解决的因果反证；
- ordinary、legacy、Shadow、invalid、unsent、Validator rejected、failed 或 retry loser
  被伪装成 formal target；
- fixture attempt identity 冲突；
- evaluator failure 或 invalid output。

`topic_shift` 和可验证的 non-impact reaction 不是系统错误，可以返回
`observed_non_impact`；但不得形成影响结论。

## 9. 与 `CommittedHelpingMove` 的边界

`CommittedHelpingMove` 记录 Assistant 实际执行并成功提交了什么。

Reaction Assessment 记录当前 user turn 如何回应那个 move，以及用户是否明确报告其
影响。

冻结边界：

- `CommittedHelpingMove` 是不可变 formal target；
- Reaction Candidate 只能引用它，不能修改、补写或重新解释它；
- 只有 Batch 2A `formal_v1` 且通过 Batch 2B association 的 move 可以成为 target；
- ordinary、legacy、Shadow、invalid、unsent、Validator rejected、failed 和 retry loser
  不可成为 target；
- 用户纠正只能 supersede working Shadow assessment，不能改写历史 move；
- 会话或 target 失效时，相关 Shadow assessment 同时失效；
- Reaction Assessment 不是用户画像，也不是长期 Memory；
- Shadow assessment 通过不能自动 promote 为 formal。

## 10. 用户纠正边界

- correction target 必须与 Batch 2B 关联的 formal move 完全一致；
- correction relation 必须是 `rejects_move`；
- 纠正只形成该目标的 `corrected_or_rejected_move` 或其他有明确证据的并行 candidate；
- 新的明确纠正优先于旧 working assessment；
- 旧 trace 可以保留审计信息，但不再作为 current assessment；
- 纠正不得转化为长期偏好、人格或 User Model 属性；
- 不要求用户解释系统为什么错，也不得把修复负担交给用户。

## 11. Zero downstream integration

Batch 2C Reaction Assessment 结果明确禁止进入：

- Memory、RawMemory、Understanding 或 Relationship projection；
- User Model、用户偏好、人格或长期适配判断；
- Response Planner 或 `HillHelpingPlan.previousMoveAssessment`；
- Prompt、Surface 或 responsePlanValidator；
- Initiative、问题预算、主动话题或 pause ownership；
- `CommittedHelpingMove`；
- `ChatMessage.interactionMetadata`；
- formal persistence 或 production database；
- production orchestration、production writer 或用户可见回复。

同样禁止：

- Shadow assessment 自动晋升 formal；
- confidence 达到阈值后晋升；
- 将单次拒绝概括为长期偏好；
- 将单次接受概括为技术有效；
- 用 Initiative、继续聊天或消息邻接推断影响。

## 12. `B2-Reaction-Shadow` 验收合同

后续 fixture-only implementation 必须同时证明：

1. **Reaction Schema**：strict schema、exact keys 和 unknown-field rejection；
2. **Target Binding**：所有 candidate/evidence 绑定唯一 formal target；
3. **Evidence Known**：反应可分类与影响已知严格分离；
4. **Causal Non-attribution**：弱相关信号不能升级为因果影响；
5. **Fail Closed**：无效 assessment 为零 candidate、两个 known 均为 `false`；
6. **User Correction**：纠正优先且不修改历史 move；
7. **Shadow Isolation**：Memory、User Model、Planner、Initiative 和 formal persistence
   消费者均为 0；
8. **Baseline Preservation**：production integration 和用户可见变化均为 0。

通过本 docs-only Contract Freeze 只冻结验收合同，不表示上述 evaluator 或 regression
已经实现，也不授权 Atomic Boundary、正式生产写入、Batch 3、部署或任何 downstream
integration。
