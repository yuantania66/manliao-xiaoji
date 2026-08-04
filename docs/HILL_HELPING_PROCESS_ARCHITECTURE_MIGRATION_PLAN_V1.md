# Hill 助人过程第三阶段架构迁移与分批实施计划 v1

状态：修订计划已获用户批准；早期批次 1.5 人工盲审及候选 1—6 的失败结果保留为历史证据；后续 Batch 1.5-E 完整冻结门已通过并关闭；2026-08-04 批准进入 Batch 2 infrastructure-only，Batch 2A `B2-Contract`、Batch 2B fixture-only association gate 与 Batch 2C-A `B2-Reaction-Shadow` fixture evaluator gate 已通过，未授权用户可见 Hill 行为或 downstream integration

日期：2026-08-01

上游基准：

- [AI 版 Hill 助人过程产品契约 v1](./HILL_HELPING_PROCESS_PRODUCT_CONTRACT_V1.md)
- [第二阶段验收报告](./evals/hill-helping-phase2-acceptance.md)
- [产品需求基准](./PRD_V1.md)
- [五层架构基准](./ARCHITECTURE_V1_FINAL.md)
- [Conversation Trajectory Eval Spec](./CONVERSATION_TRAJECTORY_EVAL_SPEC.md)
- [Batch 2C Reaction Assessment Contract v1](./HILL_HELPING_BATCH2C_REACTION_ASSESSMENT_CONTRACT_V1.md)

验收：

- [第三阶段计划验收报告](./evals/hill-helping-phase3-plan-acceptance.md)
- [批次 0 基线](./evals/hill-helping-batch0-baseline.md)
- [批次 0 验收报告](./evals/hill-helping-batch0-acceptance.md)
- [批次 0 人工盲审结果](./evals/hill-helping-batch0-human-blind-result-20260731.md)
- [批次 1 验收报告](./evals/hill-helping-batch1-acceptance.md)
- [批次 1.5 自动验收报告](./evals/hill-helping-batch1-5-automatic-acceptance.md)
- [批次 1.5 人工盲审结果](./evals/hill-helping-batch1-5-human-blind-result-20260801.md)
- [批次 1.5 情绪与关系修复质量保留门](./evals/hill-helping-batch1-5-preservation-gate-20260802.md)
- [批次 1.5 候选 2 冻结归因与正向合同验收材料](./evals/hill-helping-batch1-5-candidate2-attribution-acceptance-20260802.md)
- [批次 1.5 ResponsePlan 正向功能合同 V1](./HILL_HELPING_BATCH1_5_RESPONSE_PLAN_POSITIVE_FUNCTION_CONTRACT_V1.md)
- [批次 1.5 候选 3 结果报告](./evals/hill-helping-batch1-5-preservation-candidate3-result-20260802.md)
- [批次 1.5 候选 3 分层归因与候选 4 前合同验收材料](./evals/hill-helping-batch1-5-candidate3-attribution-contract-acceptance-20260802.md)
- [批次 1.5 候选 4 前四项正向验收合同 V1](./HILL_HELPING_BATCH1_5_CANDIDATE4_POSITIVE_ACCEPTANCE_CONTRACT_V1.md)
- [批次 1.5 候选 4 结果报告](./evals/hill-helping-batch1-5-preservation-candidate4-result-20260803.md)
- [批次 1.5 候选 4 分层归因验收](./evals/hill-helping-batch1-5-candidate4-attribution-acceptance-20260803.md)
- [批次 1.5 候选 4 后通用修改正向合同 V1](./HILL_HELPING_BATCH1_5_POST_CANDIDATE4_POSITIVE_ACCEPTANCE_CONTRACT_V1.md)
- [批次 1.5 候选 4 后本地验收](./evals/hill-helping-batch1-5-post-candidate4-local-acceptance-20260803.md)
- [批次 1.5 候选 5 结果与全量终局审计](./evals/hill-helping-batch1-5-preservation-candidate5-result-20260803.md)
- [批次 1.5 候选 6 结果与收敛判断](./evals/hill-helping-batch1-5-preservation-candidate6-result-20260803.md)
- [Batch 1.5-E 完整冻结门结果](./evals/hill-helping-batch1-5-preservation-batch1-5-e-result-20260803.md)
- [Batch 1.5 Stable Baseline Architecture Review](./evals/batch1-5-stable-baseline-architecture-review-20260804.md)

## 1. 本阶段目的

本计划只回答：

```text
怎样把第二阶段通过的产品契约接入现有五层架构？
怎样保持一个最终 ResponsePlan，而不是形成两套决策系统？
怎样按能力批次实现，每批验收后才继续？
怎样证明改动改善的是助人过程，而不是几个示例句？
```

本阶段不做：

- 运行代码修改；
- Prompt 改写；
- 数据库迁移；
- UI 改造；
- 小记、长期记忆或用户隔离；
- 生产部署。

## 2. 已确认的当前架构事实

### 2.1 当前普通聊天链路

```text
Safety
  ↓
Context Assembly
  ↓
Turn Interpretation
  ↓
Dialogue / Interaction State
  ↓
Response Planner
  ↓
Surface Realization
  ↓
Same-plan Validation
  ↓
Atomic State Commit
```

当前检查确认：

- `conversation_os.response_planner` 是生产普通聊天的最终计划汇总者；
- 每轮只有一个 `ResponsePlan`；
- Surface 不拥有重新规划权；
- Validator 不能重规划；
- 只有成功提交的 Assistant 消息才会更新交互状态。

这些都是必须保留的正确边界。

### 2.2 当前 Clinical 接入方式

当前 Clinical：

- 由 Response Planner 内部根据少量活动类型决定是否调用；
- 只覆盖情绪支持和行动支持的部分场景；
- 主要提供 Rogers 风格的可选策略；
- 没有 Hill 的适用性、流动目标、准备度、领悟技术和跨轮反应闭环。

### 2.3 根因

观察：

- Conversation OS 在调用 Clinical 之前，已经先缩窄了“哪些话轮属于助人”；
- Clinical 返回的是可选策略字符串，不是受合同约束的助人决定；
- 已提交状态记录了通用 Assistant Move，却没有完整的 Hill 目标、意图、技术和
  预期反应；
- 下一轮没有先判断用户是否真的在回应上一助人行动。

解释：

- 现有系统可以约束回复格式、事实和提问，但无法形成
  “上一行动—用户反应—下一意图”的助人过程。

结论：

- 根因在最终 `ResponsePlan` 形成之前的领域决策与跨轮状态，不在单条回复措辞；
- 继续按个例修改 Prompt 或添加关键词路由不能完成第二阶段契约。

## 3. 目标运行链路

```text
Safety pre-gate
  ↓
Context Assembly
  ↓
Turn Interpretation
  ↓
Dialogue / Interaction State
  ↓
Build HillHelpingInput
  ↓
Helping Logic
  ├─ assess relevant prior committed helping moves
  ├─ decide applicability
  ├─ assess readiness and counter-evidence
  ├─ choose goal, intention and skill
  └─ run helper self-check
  ↓
HillHelpingDecision
  ↓
Response Planner
  ├─ preserve direct obligations
  ├─ preserve grounding and user controls
  ├─ integrate decided Hill plan
  └─ produce one final ResponsePlan
  ↓
Surface Realization
  ↓
Same-plan Validation
  ↓
Atomic commit:
Assistant message + CommittedAssistantMove + optional CommittedHelpingMove
  ↓
next user turn evaluates reaction
```

关键约束：

1. Helping Logic 在 Planner 完成最终计划之前运行。
2. Planner 仍是唯一最终计划汇总者。
3. Helping Logic 只拥有 Hill 领域决策，不生成最终中文。
4. Planner 不能改写 Helping Logic 已提交的目标、意图或技术。
5. Surface 和 Validator 都不能生成新的 Hill 决定。
6. 每个普通非 Safety 话轮都产生一个 `HillHelpingDecision`。
7. 明确的身份、功能、事实或纯事务话轮可以走确定性快速边界，但仍记录
   `not_applicable`。
8. Safety 覆盖的轮次不进入普通 Hill 决策。

## 4. 领域所有权

| 领域 | 唯一所有者 | 允许做什么 | 禁止做什么 |
| --- | --- | --- | --- |
| 高风险与危机覆盖 | Safety | 覆盖普通助人链路 | 让 Hill 计划覆盖 Safety |
| 事实、话题、共同理解、直接义务 | Conversation OS | 形成可追溯的会话控制状态 | 选择 Hill 技术 |
| 适用性、反应、准备度、目标、意图、技术 | Helping Logic | 输出结构化 Hill 决定 | 删除直接义务或生成最终文案 |
| 最终回应计划汇总 | Response Planner | 把普通义务与 Hill 决定汇总为一个计划 | 发明或替换 Hill 方法 |
| 中文表达 | Surface | 忠实表达同一计划 | 重新选择目标或技术 |
| 同计划验收 | Validator | 接受或拒绝当前计划的实现 | 修复、改写或重规划 |
| 已提交状态 | State Update | 原子记录已发送行动 | 记录失败或未发送的行动 |
| 长期记忆 | Memory | 本计划不改动 | 存储 Hill 反应、人格或诊断 |

`uncertain` 是 Helping Logic 对证据充分性的判断，不是普通对话动作。Helping
Logic 不决定“接住、轻量回应、最小澄清、继续当前话题”等普通动作；这些动作仍由
Conversation OS 拥有。Response Planner 只能汇总两个领域已作出的决定，不能把
`uncertain` 偷换成 Hill 技术，也不能让 Helping Logic 接管普通聊天。

## 5. 单一决策路径

每个非 Safety 话轮必须有且只有一个行为来源：

```ts
type BehaviorSource =
  | "ordinary_conversation"
  | "hill_helping"
  | "legacy_compat"
```

规则：

- `ordinary_conversation`：Helping Logic 成功决定为 `not_applicable`，或
  `uncertain` 且只需要普通回应或最小澄清；
- `hill_helping`：Helping Logic 成功提交适用的 Hill 计划；
- `legacy_compat`：只在迁移期间服务尚未切换的流量，必须受开关控制并有退出批次；
- 同一轮不得同时使用 `hill_helping` 和旧 `clinicalStrategy`；
- Planner 必须拒绝含两个行为来源的计划；
- 兼容路径不能在 Hill 失败时临时接管当前话轮。
- Shadow trace 不是 `BehaviorSource`，不得进入 ResponsePlan 或正式会话状态。

`legacy_compat` 是迁移手段，不是长期产品架构。

## 6. 优先级与组合规则

从高到低：

1. Safety；
2. 用户明确的暂停、纠正、拒绝和当前关系修复；
3. 用户明确提出的直接问题和已承诺义务；
4. Helping Logic 的目标、意图和技术；
5. 普通对话的自然表达约束。

组合规则：

- Hill 计划可以与直接回答共同存在，但不能删除或心理化直接问题；
- 关系修复激活时，暂停探索、领悟和行动技术；
- 用户禁止建议时，Planner 不得通过普通动作重新加入建议；
- `not_applicable` 时不生成 Hill 风格的空洞陪伴话术；
- 一轮承载不了全部内容时，优先完成高优先级义务，不强行塞入所有助人目标。

## 7. 目标数据合同

以下是目标边界，不是本阶段的代码实现。

### 7.1 `HillHelpingInput`

```ts
type HillUserBoundary = {
  kind:
    | "pause"
    | "stop"
    | "no_advice"
    | "no_analysis"
    | "no_questions"
    | "correction"
    | "other_explicit_boundary"
  sourceTurnId: string
  text: string
  evidence: string[]
}

type CurrentRelationshipEvidence = {
  kind:
    | "strain"
    | "misunderstanding"
    | "pressure"
    | "repair_attempt"
    | "repair_response"
  sourceTurnId: string
  text: string
  evidence: string[]
}

type HillHelpingInput = {
  userTurnId: string
  currentUserMaterial: {
    sourceTurnId: string
    literalText: string
    semanticEvidence: TurnInterpretation["contentMeaning"]["semanticEvidence"]
    explicitPropositions: TurnInterpretation["contentMeaning"]["explicitPropositions"]
    directQuestions: TurnInterpretation["contentMeaning"]["directQuestions"]
  }
  turnInterpretation: TurnInterpretation
  dialogueState: DialogueState
  interactionState: InteractionState
  directObligations: AnswerObligation[]
  userBoundaries: HillUserBoundary[]
  currentRelationshipEvidence: CurrentRelationshipEvidence[]
  recentCommittedHelpingMoves: CommittedHelpingMove[]
}
```

约束：

- 输入只能来自当前会话可追溯材料；
- `currentUserMaterial` 不能使用 `unknown`、任意 JSON 或未标来源的摘要；
- `recentCommittedHelpingMoves` 是有界、按时间排序的当前会话记录；
- 用户显式回复所指向的较早助人行动必须进入候选，即使它不在普通最近窗口内；
- Helping Logic 负责从候选中判断语义相关性，Context Assembly 不得预先宣称
  某项技术有效；
- 直接义务、用户边界和关系证据必须保留来源话轮及证据，不能降级为无来源字符串；
- 不读取长期人格、诊断或未确认心理标签；
- 不以 Raw Memory 代替当前会话证据；
- 用户纠正过的主张必须标为已拒绝，不能作为本轮事实继续使用。

### 7.2 `HillHelpingDecision`

使用第二阶段冻结合同：

```ts
type HillHelpingDecision =
  | { status: "decided"; plan: HillHelpingPlan }
  | {
      status: "failed"
      failureCode:
        | "invalid_input"
        | "invalid_plan"
        | "provider_failure"
        | "timeout"
      retryable: boolean
      evidence: string[]
    }
```

### 7.3 `ResponsePlan`

目标变化：

- 保留一个 `ResponsePlan`；
- 增加行为来源；
- 增加结构化 Hill 决定或其受控投影；
- 保留直接义务、Grounding、问题预算和闭合控制；
- 迁移完成后删除生产路径对 `clinicalStrategy` 的依赖。

`ResponsePlan` 不能同时携带可执行的旧 Clinical 策略和 Hill 计划。

### 7.4 已提交行动

在现有 `CommittedAssistantMove` 上增加可选助人记录：

```ts
type CommittedAssistantMove = {
  // existing fields
  helping?: CommittedHelpingMove
}
```

初始方案复用现有 `ChatMessage.interactionMetadata` JSON：

- 不需要仅为该记录新增一张数据库表；
- 必须增加严格的序列化、加载和 schema 校验；
- 如果实现阶段发现现有字段无法满足原子性或查询需求，必须停止并单独提出数据库
  变更，不能在批次中顺带迁移。

只有 `behaviorSource=hill_helping`、实际执行该 Hill 计划、成功发送并原子提交的
Assistant 消息才能产生 `CommittedHelpingMove`。

### 7.5 下一轮反应

反应评估顺序固定为：

```text
找到最近相关的 CommittedHelpingMove
  ↓
判断当前话轮是否在语义上回应它
  ↓
抽取可追溯反应证据
  ↓
判断 impactKnown
  ↓
作为下一 Hill 目标的输入
```

不得用“消息紧邻”“回复变长”“继续聊天”替代语义关系判断。

Batch 2C 把该边界冻结为 `B2-Reaction-Shadow`：

- `reactionEvidenceKnown` 只表示当前 user turn 是否有足够明确、可追溯、目标绑定的
  reaction 分类证据；
- `impactKnown` 还要求用户明确报告该 move 的适配性、体验、结果、无效果或负面效果；
- `impactKnown=true` 不证明客观因果或技术成功；
- Reaction Assessment 只能是 `mode=shadow`、`source=fixture`；
- 结果不得进入 `HillHelpingPlan`、Response Planner、Initiative、Memory、User Model、
  `ChatMessage.interactionMetadata` 或 formal persistence；
- 无合法 formal target、唯一 relation、current-turn evidence 或严格 schema 时统一
  fail closed，两个 known 均为 `false` 且没有 actionable candidate。

该合同冻结不表示 evaluator、runtime 或 regression 已实现。

## 8. 失败、重试与回退

### 8.1 成功判断为不适用

- `status=decided`；
- `plan.applicability=not_applicable`；
- 进入普通聊天；
- 这不是错误或降级。

### 8.2 Helping Logic 失败

当 Hill 已经是当前轮的正式行为来源时：

- 允许在同一决策步骤内进行一次受限重试；
- 重试仍失败时，终止本轮普通生成链；
- 返回明确的非聊天型 `helping_plan_failure`；
- 不提交 Assistant 消息和 `CommittedHelpingMove`；
- 不临时切换到旧 Clinical 或无计划陪伴话术。

当批次 1—2 的 Hill 能力仍处于 Shadow 时：

- Shadow 不是当前轮行为来源；
- Shadow 失败必须以 `status=failed` 写入独立 trace，不能写成
  `not_applicable`；
- Shadow 失败不能阻断或改变既有基线回复；
- 基线回复继续由该轮已经选定的 `ordinary_conversation` 或
  `legacy_compat` 路径完成；
- 这不是 Hill 的运行时 fallback，因为 Hill 尚未接管该轮。

具体错误文案在实现批次中沿用现有非聊天约束失败边界，不在本计划中设计新产品
交互。

### 8.3 灰度回退

- 功能开关只改变后续请求走哪条已验收路径；
- 不在同一请求中从失败的新路径偷换到旧路径；
- 回退到最近一个已验收批次；
- 已提交记录保持可读，不因关开关而被删除或改写。

## 9. 现有结构处理

### 9.1 保留

- Safety pre-gate；
- Context Assembly；
- Turn Interpretation；
- Dialogue / Interaction State；
- Assistant Grounding；
- Response Planner 的唯一汇总权；
- Surface Realization；
- same-plan Validator；
- 原子消息与交互元数据提交；
- 现有会话轨迹评估基础设施。

### 9.2 修改

- Conversation OS 类型：能够携带有界的近期 `CommittedHelpingMove` 候选，并
  纳入用户显式指向的较早行动；
- orchestration：在最终 Planner 前调用 Helping Logic；
- Response Planner：汇总 Hill 决定但不重做领域判断；
- `ResponsePlan`：加入唯一行为来源和 Hill 计划投影；
- Surface prompt：只表达已提交 Hill 计划；
- Validator：检查行为来源唯一、目标技术一致、直接义务和禁用动作；
- state load / commit：加载和提交助人行动；
- debug trace：记录适用性、反应关系、计划和失败，不记录长期人格推断。

### 9.3 降级为迁移兼容

- 当前 Rogers-only `clinicalAdviceService`；
- 当前 `ClinicalPlan` 和 `clinicalStrategy` 生产接入；
- 基于少数 `currentActivity` 的 Clinical 条件调用；
- 旧 Response Goal / strategy registry 中与 Hill 重叠的助人决策。

这些结构不得继续新增产品能力。

### 9.4 不作为 Hill 决策器

- 现有五态 Conversation State；
- 关键词和单句分类；
- Need Resolution 枚举；
- Surface prompt；
- Validator；
- Memory。

它们可以提供证据或约束，但不能成为并列的助人目标选择器。

## 10. 分批实施与阶段门

总原则：

> 每一批只解决一个可验证的架构能力；该批验收通过后才进入下一批。发现问题时
> 留在当前批次修复并重新验收，不通过功能开关绕过验收。

### 批次 0：文档与基线冻结

状态：2026-07-31 用户验收通过；没有自动进入批次 1。

目标：

- 在用户批准本计划后，更新与新契约冲突的 PRD、架构和 Clinical 文档；
- 固化现有普通聊天、Safety、Grounding、直接回答和轨迹结果；
- 冻结评估样本、指标、盲审流程与性能测量方法。

代码行为：不改变。

验收门：

- 文档不存在双重决策权；
- 旧文档不再把 Clinical 永久定义为仅两个场景的可选 Rogers 提供者；
- 基线检查全部通过；
- 评估阈值在运行新模型结果之前冻结。

失败处理：只修正文档和基线，不进入批次 1。

### 批次 1：结构化合同与 Shadow Helping Decision

状态：2026-08-01 技术验收通过；未自动进入批次 1.5。

目标：

- 实现 Hill 类型、输入构建、适用性、准备度、目标、意图、技术和 self-check；
- 每个非 Safety 话轮在 Planner 前产生结构化决定；
- 新决定只写 trace，不影响最终回复；
- 确定性普通话轮使用快速 `not_applicable` 边界。
- `uncertain` 只表达证据不足，不选择普通对话动作；
- 相同表面输入必须能够因已建立话题、回答框架、关系事件或缺失上下文而得到不同
  适用性结果，禁止按单字、数字、长度或表情固定路由。

代码行为：用户可见回复必须与基线等价。

验收门：

- 100% 非 Safety 测试话轮有一个决定或显式失败；
- 无一轮同时产生两套 Hill 决定；
- 24 个契约反例和至少 20 个新增反例通过结构校验；
- 没有已建立话题的单字、数字、表情或碎片判为 `uncertain`，不能快速判为
  `not_applicable`；
- 已建立助人话题或有效回答框架不会仅因当前输入很短而快速判为
  `not_applicable`；
- 至少 20 组“相同表面形式、不同上下文”的配对反例通过，且包含未参与规则设计
  的 held-out 组合；
- Helping Logic 不输出普通对话动作，Planner、Surface 和 Validator 不选择 Hill
  目标或技术；
- Shadow 开启与关闭的最终 `ResponsePlan`、正式会话状态、Surface prompt 和用户
  可见回复完全等价；唯一允许的差异是独立 Shadow trace 和 Shadow 自身耗时；
- Safety 不调用普通 Hill 决策；
- provider / timeout / invalid schema 不会变成 `not_applicable`；
- 相关架构、类型、单元和回归测试全部通过。

失败处理：修正领域合同或输入构建，不修改 Surface 文案补救。

### 批次 1.5：`uncertain` 到普通聊天的受控交接

状态：早期 2026-08-02 人工盲审及候选 1—6 的情绪与普通关系修复质量保留测试未达到
冻结阈值，停止候选 7 及同义正则补丁。后续严格限制在 Planner、Surface boundary 和
Validator semantic composition 的最小修复，经 Batch 1.5-E 完整冻结门达到 60/60
Functional、60/60 Machine Validator、0 constraint failure、5/60 regeneration，
于 2026-08-04 标记 `passed_and_closed`。候选能力仍默认关闭，仅在
`HILL_HELPING_ORDINARY_HANDOFF=true` 时启用；它不隐式开启完整 Hill Shadow、Hill
目标/技术或正式 Helping state。

目标：

- 只修复本次人工盲审暴露的通用架构缺口：Helping Logic 判断为 `uncertain` 后，
  Conversation OS 仍需形成有功能的普通聊天动作；
- `behaviorSource` 保持 `ordinary_conversation`；
- Response Planner 使用适用性作为边界证据，结合当前话题、回答框架、直接义务、
  用户边界、关系状态和上一已提交普通 Assistant Move 选择普通动作；
- 禁止 Helping Logic 选择普通动作，禁止 Planner 发明 Hill 目标或技术；
- 禁止根据单字、数字、表情或长度猜测用户意义；
- 禁止连续提交没有新增会话功能的普通动作，即使表面措辞从“收到”换成“我在”或
  “听到了”。

代码行为：这是第一个允许改变用户可见普通聊天行为的批次，但不启用任何用户可见
Hill 技术，不写入 `CommittedHelpingMove`，不增加第二个 `ResponsePlan`。

验收门：

- 批次 0 人工盲审中普通低信息场景的 0/6 作为固定回归样本保留，但不得成为唯一
  设计或验收样本；
- 至少 20 组新的同形式不同上下文配对反例和独立 held-out 样本通过；
- 连续两个已提交 Assistant Move 不得仅完成同一种“无新增功能承接”，不以字符串
  是否完全相同作为判定标准；
- Safety、直接回答、暂停、Answer Frame、Grounding 和当前活动话题硬门 100% 通过；
- 情绪表达 3/3 的当前非回退结果必须保留；
- 无上文的关系修复开场 3/3 只作为“独立修复开场未回退”，不得表述为完整关系
  修复能力已经通过；
- 人工盲审继续使用预先提交的逐组密钥、冻结评分和揭盲流程；绝对通过、适当结果和
  愿意继续均达到冻结的 85%，`clearly worse` 不超过 10%，严重失败为 0；
- 质量保留门必须同时满足 60/60 最终有效、100% 预期动作、0 个约束失败、0 次 Helping
  provider 调用和不高于 20% 再生成；机器判定还必须按冻结正向功能合同复核，不得用
  Validator 漏放把真实 Surface 失败计为通过；
- 通过后重新冻结用户可见基线，再进入批次 2。

失败处理：只修正 Conversation OS 的普通动作选择或 Planner 汇总边界；不得为数字、
单字或某条盲审回复添加专用文案，不得提前启用 Hill 技术。

候选 6 当时提出的结构化有限动作 Surface 路线未被采用；Batch 1.5-E 保持自由文本
Surface 架构并通过冻结门。该历史收敛判断不再是进入 Batch 2 的阻塞项。

### 批次 2：跨轮关联与提交边界

状态：Batch 2A Contract Gate 已冻结 versioned formal Helping metadata、严格 parser
和 formal/Shadow 隔离；Batch 2B 已在 fixture-only 范围通过有界加载、显式较早 target、
target-bound semantic association 与 Initiative 隔离；Batch 2C 已冻结为
Reaction Assessment Contract Gate，gate id 为 `B2-Reaction-Shadow`，范围严格是
reaction-only、Shadow-only、fixture-only 和 zero downstream integration。Batch 2C-A
已实现隔离的 fixture evaluator、known 派生和 fail-closed regression gate；production
runtime、production loader、原子写入、formal reaction state 和 Atomic Boundary 尚未实现。详见
[Batch 2A metadata contract](./HILL_HELPING_BATCH2A_COMMITTED_MOVE_METADATA_CONTRACT_V1.md)
、[Batch 2B implementation report](./evals/hill-helping-batch2b-implementation-report-20260804.md)
、[Batch 2C Reaction Assessment Contract](./HILL_HELPING_BATCH2C_REACTION_ASSESSMENT_CONTRACT_V1.md)
与 [Batch 2C-A implementation report](./evals/hill-helping-batch2c-a-implementation-report-20260804.md)。

当前权威命名中，Batch 2C 不再表示 Atomic Boundary。历史材料中的旧编号保持为历史
证据；Atomic Boundary 保持未授权、未实现，后续编号由独立决定冻结。

目标：

- 实现 `CommittedHelpingMove` 的序列化、加载和原子提交边界；
- 使用 fixture 和受控测试验证只关联真正相关的历史助人行动；
- 在 Shadow trace 中产生关系类型、反应候选和 `impactKnown`；
- Shadow 计划或旧路径回复绝不写成 `CommittedHelpingMove`；
- 删除、重试、失败发送和并发情况下不产生幽灵行动记录。

代码行为：用户可见回复仍不因反应评估改变。

验收门：

- Shadow trace 与正式 `CommittedHelpingMove` 使用不同状态标识，且 Shadow
  记录不进入下一轮正式决策输入；
- 未发送、Validator 拒绝、Shadow 或旧路径回复不写入正式助人行动；
- fixture 中的已提交行动可以序列化、加载并准确关联；
- 显式回复指向的较早行动不会被“只取最后一条”丢失；
- 话题切换不被判为技术成功或失败；
- 用户纠正能够关联到被纠正的具体行动；
- 删除会话后状态随会话失效；
- 至少 20 个新的跨轮、换话题、重试和并发反例通过；
- 原子提交与既有会话生命周期测试通过。

失败处理：修正状态与语义关联，不提前启用用户可见 Hill 行为。

Batch 2C Contract Freeze 冻结了以下 fixture 验收边界；Batch 2C-A 已将这些边界实现为
隔离 regression gate，但不代表 production runtime 或 downstream integration：

- Reaction Candidate strict schema 与唯一 formal target binding；
- `reactionEvidenceKnown` 和 `impactKnown` 分离；
- 消息相邻、长度、继续聊天、Initiative、topic shift 或 unclear 不形成影响结论；
- invalid assessment 为零 candidate、两个 known 均为 `false`；
- Memory、User Model、Planner、Prompt、Surface、Validator、Initiative 和 formal
  persistence 消费者均为 0；
- production integration 和用户可见变化均为 0。

### 批次 3：关系修复与探索能力

目标：

- 首次在受控测试和评估流量中让 `hill_helping` 成为用户可见行为来源；
- 启用关系修复；
- 启用探索的支持、复述、开放提问、感受反映和总结；
- `not_applicable` 继续走普通聊天；
- 每一轮保持单一行为来源。

本批及后续能力批次默认只用于本地、测试或评估环境。任何生产 canary、灰度或
部署都需要用户单独授权，不能以“部分流量”默认为生产许可。

启用顺序：

1. 当前关系修复；
2. 支持与事实复述；
3. 开放探索；
4. 有证据的感受反映与总结。

验收门：

- 只有实际采用 `hill_helping` 计划并成功发送的回复才原子写入
  `CommittedHelpingMove`；
- 下一轮可以加载该正式行动并完成第一次真实的行动—反应—下一意图闭环；
- 关系修复轮不同时推进其他目标；
- 用户说“不想分析/不想回答/不要建议”时相应动作被禁止；
- 问题不是默认结尾，且问题预算仍受 Conversation OS 控制；
- 直接问题不被探索覆盖；
- 普通聊天和 Safety 硬门 100% 不回退；
- 真实模型多轮盲审达到预先冻结阈值；
- 盲审看的是目标适配、回应性、压力、自然度和关系修复，不做固定句匹配；
- 至少 20 个新增反例和全部相关回归通过。

失败处理：只调整关系/探索领域决定或其计划投影；不能针对某一句添加回复特例。

### 批次 4：行动能力

目标：

- 启用信息提供、选项生成、决策支持、行为演练、小步骤和行动回看；
- 允许用户明确请求时直接进入行动；
- 用户保留决定权和修改权。

验收门：

- 不强制先探索再行动；
- 不替用户做重大决定；
- 建议明确为选项，并体现已知约束与信息缺口；
- 用户拒绝建议后停止堆建议；
- 高风险、医疗、法律、财务等边界按各自安全或能力约束处理；
- 行动结果进入下一轮反应，但不形成长期人格结论；
- 真实模型多轮盲审、至少 20 个新增反例和全部相关回归通过。

失败处理：留在行动批次修正，不用探索话术掩盖行动计划失败。

### 批次 5A：领悟准备度与领悟性提问

目标：

- 先启用领悟准备度；
- 只启用邀请用户自己发现联系的领悟性提问；
- 暂不启用 AI 主动解释或挑战。

验收门：

- “为什么”关键词不会自动进入领悟；
- 没有反证检查时不能判定准备度支持；
- 用户自己的联系不会被升级为事实；
- 用户拒绝分析时立即退出；
- 无人格、潜意识、依恋类型或文化定型；
- 真实模型多轮盲审、至少 20 个新增反例和全部相关回归通过。

失败处理：修正准备度判断；不得提前用解释能力补齐效果。

### 批次 5B：受限协作式解释、差异与当前关系处理

目标：

- 启用暂时、协作、可撤回的解释；
- 启用基于已确认材料的具体差异；
- 启用当前 AI—用户关系过程处理。

验收门：

- 每个解释都可追溯到用户材料并明确为假设；
- 反证会阻止或撤回解释；
- 差异只使用已确认材料，不指控动机；
- 关系处理只谈当前可观察互动，不冒充治疗关系；
- 被用户否定的解释不会换一种说法继续出现；
- 真实模型多轮盲审、至少 20 个对抗性反例和全部相关回归通过。

失败处理：关闭 5B，保留最近通过的 5A；不影响已验收探索和行动能力。

### 批次 6：旧 Clinical 生产路径退出

目标：

- 删除生产链路的 `legacy_compat`；
- 移除旧 `clinicalStrategy` 的决策作用；
- 清理重复的目标和策略选择；
- 更新架构检查、文档和数据集名称。

验收门：

- 生产普通聊天不存在旧 Clinical 与 Hill 双路径；
- 所有普通非 Safety 话轮只有 ordinary 或 hill 行为来源；
- 源码和架构检查无法通过别名绕开单一决策所有权；
- 历史交互元数据仍可向后兼容读取；
- 全量相关测试、轨迹评估和至少 20 个新增旁路反例通过。

失败处理：恢复到最近通过的兼容读取版本，不能保留半退出状态。

### 批次 7：完整发布门

目标：

- 验证完整 Hill 能力的质量、稳定性、成本、延迟和可回退性；
- 形成独立的部署建议。

验收门：

- 全量 `check:launch` 通过；
- Hill 专项结构检查和轨迹检查通过；
- 真实模型重复运行达到冻结阈值；
- Safety、直接义务、普通聊天、Grounding 和状态原子性无回退；
- 性能与成本相对批次 0 基线在预先批准的阈值内；
- 无未解释的行为差异；
- 回退演练通过。

发布：仍需用户单独批准，不因批次 7 验收自动部署。

## 11. 评估方案

### 11.1 复用现有轨迹基础设施

优先扩展现有：

- conversation trajectory spec；
- trajectory runner；
- replay；
- experiment；
- blind review；
- launch structural checks。

不新建一套与 Conversation OS 并列、标准不一致的评估系统。

### 11.2 新增 Hill 轨迹集

目标数据集：

```text
clinical-evals/hill-helping-trajectories-v1.json
```

每条轨迹至少记录：

- 上下文与用户边界；
- 直接回答义务；
- 上一已提交助人行动；
- 当前话轮与上一行动的关系；
- 期望适用性；
- 允许和禁止的目标/意图/技术；
- 必须保留的用户意义解释权；
- 状态提交预期；
- 结构硬门；
- 人工盲审维度。

### 11.3 硬门

以下必须 100% 通过，不用平均分抵消：

- Safety 覆盖；
- 直接问题和已承诺义务不丢失；
- 单一行为来源；
- Planner、Surface、Validator 不越权选择 Hill 方法；
- 用户暂停、纠正、拒绝有效；
- 被拒绝假设不被复用；
- AI 不虚构人格、经历、感受、身体或专业资格；
- Helping 失败不伪装成 `not_applicable`；
- 未发送消息不写入行动状态；
- 关系不明时不宣称上一技术有效。
- `uncertain` 不授权心理解释、领悟、建议或由 Helping Logic 选择普通动作；
- 连续普通 Assistant Move 不得只更换措辞而重复同一无新增功能动作。

### 11.4 人工盲审

盲审维度：

- 当前助人目标是否适配；
- 是否真实回应用户材料；
- 是否保留用户的意义解释权；
- 是否造成不必要压力；
- 是否自然，而不是展示技术；
- 是否根据上一轮反应调整；
- 是否完成直接问题；
- 是否存在方法漂移。

先冻结：

- 样本；
- 版本；
- 评分说明；
- reviewer 盲法；
- 通过阈值；
- 重复运行次数。

再运行新方案，禁止看到结果后移动通过线。

### 11.5 反例原则

每个实施批次必须新增至少 20 个不在现有测试中的反例，覆盖：

- 正常情况；
- 边界情况；
- 模糊输入；
- 上下文切换；
- 对抗性要求；
- 失败与重试；
- 旧路径旁路；
- 多轮状态错误。

发现反例失败时必须回到拥有该决定的架构层修正，不能为那一句输入添加专门回复。

## 12. 性能与成本边界

- 确定性 `not_applicable` 快速边界不得增加模型调用；
- 可适用话轮最多增加一次结构化 Helping 决策调用；
- 不得由 Planner、Surface 或 Validator 重复调用 Helping 模型；
- 具体 P50、P95 延迟和单轮成本阈值在批次 0 根据同一 official-entrypoint、
  provider 和 model 的受控本地基线测量并由用户批准；该基线不得冒充生产证据；
- 未冻结性能阈值前不得进入完整发布门。

批次 0 已在
[Hill Helping Batch 0 Baseline](./evals/hill-helping-batch0-baseline.md)
记录实测口径并冻结阈值。任何 provider/model 变化都必须重新建立匹配基线，不能
沿用原数字。

## 13. 功能开关与回退边界

建议按能力设置独立开关：

```text
HILL_HELPING_SHADOW
HILL_HELPING_ORDINARY_HANDOFF
HILL_HELPING_COMMITTED_MOVE
HILL_HELPING_EXPLORATION
HILL_HELPING_ACTION
HILL_HELPING_INSIGHT_PROBE
HILL_HELPING_INSIGHT_INTERPRETATION
```

约束：

- 开关只对应已经定义的能力批次；
- 不允许按用户某一句话创建临时开关；
- 打开下一批之前，上一批必须有验收记录；
- 关闭后续能力不破坏旧元数据读取；
- 开关不改变 Safety 优先级。

## 14. 每批验收报告模板

每一批停止时必须提交：

```text
Completed
  本批实际完成的范围

Evidence
  测试、轨迹、盲审、反例、性能和代码证据

Remaining
  尚未完成的下一批能力

Blocking Reason
  若未通过，写明阻塞层和证据；通过则写“无”

Recommended Next Step
  只给一个下一动作：继续下一批，或留在本批修正
```

没有验收记录，不进入下一批。

## 15. 明确不在本计划内

- 小记的记录模型、模板或提醒；
- 长期记忆抽取、写入和召回；
- 用户隔离和权限模型；
- 心理诊断、人格画像或治疗计划；
- UI 和品牌重设计；
- 生产部署；
- 与 Hill 无关的现有功能顺手重构。

如果实现发现必须修改这些模块，必须停止并说明负责层、证据和新增范围，由用户
单独决定。

## 16. 架构反例自审

以下反例用于寻找计划中的旁路，不是新增回复个例。结果为“覆盖”表示计划已经指定
唯一责任层和实施验收门；不表示运行代码已经通过。

| # | 尝试破坏计划的方式 | 计划中的阻断点 | 结果 |
| ---: | --- | --- | --- |
| 1 | 快速 `not_applicable` 忽略仍在进行的助人话题 | 输入必须包含当前状态和上一行动；批次 1 结构门 | 覆盖 |
| 2 | Safety 轮仍调用普通 Helping | Safety pre-gate；批次 1 硬门 | 覆盖 |
| 3 | 正式 Helping timeout 被包装为普通安慰 | 正式决定失败分支；禁止当前轮静默回退 | 覆盖 |
| 4 | Planner 同一轮请求两个 Hill 决定 | 每轮一个决定；批次 1 唯一性检查 | 覆盖 |
| 5 | Planner 不喜欢 Hill 结果并换一种技术 | 领域所有权表；Planner 只能接受或拒绝合同 | 覆盖 |
| 6 | Surface 在措辞时加入新解释或建议 | Surface 只表达同一计划；same-plan Validator | 覆盖 |
| 7 | Validator 发现问题后自行改写 | Validator 只能接受或拒绝 | 覆盖 |
| 8 | 回复生成成功但发送失败仍写入行动 | 批次 2 建立提交边界；批次 3 正式启用 | 覆盖 |
| 9 | 重试产生两个 `CommittedHelpingMove` | 只有最终成功发送记录；批次 2—3 重试反例 | 覆盖 |
| 10 | 并发请求读取同一个旧行动并乱序覆盖 | 批次 2 并发与原子提交验收 | 覆盖 |
| 11 | 用户换话题被判断为上一技术有效 | 先判语义关系；`topic_shift` 不形成影响结论 | 覆盖 |
| 12 | 最近一条回复不是相关行动，但更早行动才是目标 | 有界候选纳入显式目标；不以物理相邻替代关联 | 覆盖 |
| 13 | 用户已否定的假设通过 Planner 普通动作重新出现 | 输入标记已拒绝主张；全局硬门 | 覆盖 |
| 14 | Hill 计划把用户明确事实问题挤掉 | 直接义务优先级高于 Hill；轨迹硬门 | 覆盖 |
| 15 | 关系修复同时推进建议或领悟 | 修复暂停其他目标；批次 3 验收门 | 覆盖 |
| 16 | 旧 Clinical 和 Hill 在同一轮同时生效 | 单一 `BehaviorSource`；批次 6 旁路检查 | 覆盖 |
| 17 | Hill 失败时旧 Clinical 临时接管 | 兼容路径不得作为当前轮失败 fallback | 覆盖 |
| 18 | Shadow 失败或结果意外改变回复/正式状态 | 批次 1 输出等价；批次 2 禁止 Shadow commit | 覆盖 |
| 19 | 开关关闭后旧会话元数据无法读取 | 兼容读取与回退边界；批次 6 验收 | 覆盖 |
| 20 | 删除会话后助人状态成为独立画像 | 状态随会话失效；不写长期 Memory | 覆盖 |
| 21 | 同一句“嗯”在不同上下文被固定路由 | 输入包含会话与上一行动；轨迹按上下文配对 | 覆盖 |
| 22 | 领悟通过关键词“为什么”绕过准备度 | 批次 5A 明确禁止关键词直达 | 覆盖 |
| 23 | 新增模型调用在 Planner、Surface 重复发生 | 只有 Helping Logic 可调用；调用次数和成本边界 | 覆盖 |
| 24 | 功能效果好但性能不可接受仍直接发布 | 批次 0 冻结基线；批次 7 性能硬门和独立发布批准 | 覆盖 |
| 25 | Helping Logic 把 `uncertain` 直接翻译成“轻量承接” | 领域所有权表；批次 1 禁止输出普通动作 | 覆盖 |
| 26 | 数字被固定判成 `not_applicable`，忽略它正在回答上一问题 | 批次 1 同形式不同上下文配对门 | 覆盖 |
| 27 | `收到` 改成 `我在` 后绕过重复检查 | 批次 1.5 按会话功能而非字符串判重 | 覆盖 |
| 28 | 为通过 0/6 样本直接加入数字专用回复 | 批次 1.5 新配对反例、held-out 和禁止专用文案 | 覆盖 |
| 29 | Planner 在普通交接时顺手加入感受反映 | `ordinary_conversation` 单一来源；批次 1.5 禁止 Hill 技术 | 覆盖 |
| 30 | Helping Shadow 开启后改变 Surface prompt 或正式状态 | 批次 1 的 plan/state/prompt/reply 完全等价门 | 覆盖 |
| 31 | 无上文修复样本通过就宣称完整关系修复完成 | 批次 1.5 明确只作独立修复开场非回退 | 覆盖 |
| 32 | 先看新结果再降低人工盲审阈值 | 批次 1.5 继续使用冻结阈值与提交密钥 | 覆盖 |

本次修订补上了 `uncertain` 到普通聊天的交接批次，没有新增产品层，也没有把普通
聊天动作转交给 Helping Logic。

## 17. 第三阶段验收问题

第三阶段只有在以下问题全部得到确认后通过：

1. 是否同意 Helping Logic 在最终 Planner 之前运行，但 Planner 仍汇总唯一
   `ResponsePlan`？
2. 是否同意每个非 Safety 话轮都有可追踪决定，且确定性普通话轮走快速边界？
3. 是否同意同一轮禁止旧 Clinical 与 Hill 双路径？
4. 是否同意 Hill 正式接管该轮后，Helping 失败终止当前普通生成，而不是静默
   回退；Shadow 失败则只记录且不影响基线回复？
5. 是否同意先完成 Hill Shadow，再由批次 1.5 单独修复普通聊天交接，然后验证跨轮
   提交边界；只有实际执行 Hill 的成功回复才写入正式状态，之后依次启用探索/修复、
   行动和领悟？
6. 是否同意领悟拆成 5A 和 5B 两个独立验收批次？
7. 是否同意每批至少新增 20 个反例，并以跨轮轨迹和盲审为主要质量证据？
8. 是否同意批次验收通过后才继续，完整发布仍需另行批准？

## 18. 本阶段完成条件

用户批准本计划后，第三阶段完成。2026-08-01 的修订批准只授权按
`批次 1 -> 批次 1.5 -> 批次 2 -> 批次 3` 顺序实施和逐批验收，不授权跨批次
合并验收或生产部署。

批次 0、批次 1 与 Batch 1.5-E 已验收通过。Batch 1.5-E 保持默认关闭并作为稳定
用户可见基线封存。2026-08-04 已批准进入 Batch 2 infrastructure-only：只实现跨轮
关联、`CommittedHelpingMove` 严格序列化/加载、Shadow reaction trace 与原子提交
生命周期；用户可见回复必须保持不变。该批准不自动授权 Batch 3、生产 canary、默认
开启或 User Model 行为接入。Batch 2C 当前已完成 `B2-Reaction-Shadow` 合同冻结与
Batch 2C-A fixture-only evaluator；production Reaction runtime、Atomic Boundary、formal
reaction state 和全部 downstream integration 均未获授权或实现。
