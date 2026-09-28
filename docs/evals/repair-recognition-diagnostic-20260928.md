# 修复识别漂移诊断（2026-09-28，仅诊断）

范围：用户批准的只做诊断切片。不修改产品行为、阈值或验收标准；不降低 0.93 阈值、不放宽 `targetTurnId` 校验、不改夹具、不重置 Safety 修复预算。Chat Gate、盲评包、合并、生产部署与发布继续暂停。原失败运行（`r6-preservation`，36/60）保留，不被本次结果覆盖。

## 1. 冻结门基线身份

| 用途 | 提交 | 依据 |
| --- | --- | --- |
| Batch 1.5 保持门 60/60 封存 | `7a2f3ab`（“Seal Batch 1.5-E stable baseline”，2026-08-04） | 结果文档 `hill-helping-batch1-5-preservation-batch1-5-e-result-20260803.md` 与产物（SHA `d3c98dda…`）：运行 2026-08-03T13:29Z，`qwen/qwen3.7-max`，数据集 SHA `12bd41f3…`；产物记录的 Prompt Builder `bb2f7cb2`、Planner `d34f5ed6`、Validator `c409b604` 指纹与 `7a2f3ab` 文件一致；保持门 runner/lib 指纹封存时与现在相同（`45ef815d`、`f9775250`），runner 强制 `helpingOrdinaryHandoffEnabled: true`。 |
| Chat Gate A 侧 | `3e34257c`（2026-07-23） | 早于 Batch 1.5，是 `7a2f3ab` 的祖先；只用于 Chat Gate A/B 对照，不是保持门基线。上一版 Remaining 写“在 `3e34257c` 上对照”不准确，本次对照使用 `7a2f3ab`。 |

## 2. 工具、预算与环境

- 工具（本切片新增，仅诊断）：`scripts/repair-recognition-diagnostic-{lib,runner,check}.ts`（`repair-recognition-diagnostic-v1`；lib `sha256:7e8c9c975539…`，runner `sha256:36e5b40347e9…`）。两侧使用同一份工具（在 `7a2f3ab` 的独立 worktree 中以未跟踪文件拷入，指纹一致）。
- 场景与预算（运行前固定在代码常量中，无重试）：13 场景 × 3 轮 × 2 侧 = 78 次真实回合。8 个受影响修复场景；2 个通过的修复对照（`repair-unsupported-fear`、`repair-topic-switch`）；2 个非修复对照（`emotion-mild-unhappy`、`emotion-lonely`）；`TRJ-REPAIR-OBS-001` t1（“你一点都不懂我”，无历史）。输入来自同一数据集（SHA `12bd41f3…`），两侧 `inputFingerprint` 相同。
- 轮次 ID：每侧用自身 `assembleConversationControlContext` 生成的上下文；历史轮次为 `u1`/`a1`，当前轮次 `repair-diag-${side}-${id}-r${n}`，两侧合法目标集合一致（助手 `a1`，无已提交 claim，无活动交接目标）。
- 调用：`createChatReply`，`includeDebugTrace:true`，`helpingShadowEnabled:false`，`helpingOrdinaryHandoffEnabled:true`（与保持门 runner 相同）。同一 `.env`（`qwen3.7-max`，`AI_TIMEOUT_MS=45000`），两侧同时运行：10:50:24 UTC 开始，seal 10:55:21 结束，candidate 11:02:05 结束，均 exit 0。seal HEAD `7a2f3ab`、candidate HEAD `0a80b5d`，两侧 worktree 干净。
- 记录内容：只有结构字段（relation、confidence、目标类别与 ID、是否提供 targetProposition 及是否匹配已提交 claim、接受/拒绝原因、Dialogue State、responseActions、执行阶段与失败码）。不含 Prompt、回复、evidence 或用户文本；产物中 CJK 字符 0、文本键 0、疑似密钥 0。
- 产物：`docs/evals/repair-recognition-diagnostic-20260928/diag-{real,probes}-{seal,candidate}.json`。

接受判定使用各侧自身的合并函数（向候选注入标记 evidence，看是否出现在最终 interpretation），不是重新实现；拒绝原因按各侧候选过滤顺序镜像给出。确定性检查 `tsx scripts/repair-recognition-diagnostic-check.ts` 两侧均通过。

## 3. 确定性探针（无凭据，每个场景相同结论）

| 探针（模型候选） | `7a2f3ab` | `0a80b5d` |
| --- | --- | --- |
| `repairs_previous_move@0.95`，目标 `a1`，无 proposition | 修复 | 修复 |
| 同上 + 未提交的 `targetProposition` + `repair_or_withdraw` | **修复** | **无修复**（`target_proposition_not_committed_claim`） |
| 目标为用户回合 `u1` | 无 | 无 |
| 不给目标 | 修复（落到最后一个助手回合） | 修复 |
| 置信度 0.9（低于 0.93） | 无 | 无 |
| `continues_active_thread` | 无 | 无 |
| `challenges_move_fit@0.95`，目标 `a1` | 无 | 无 |

唯一的行为差异是第二行。正确目标、错误目标、低置信与非修复关系两侧一致。

## 4. 真实模型链路

### `7a2f3ab`（封存基线，今天重跑）

- 8 个受影响修复场景 24/24 `repair_planned`：模型给出 `repairs_previous_move@0.95`（1 格 0.98），目标 `a1`，**不带** `targetProposition` → 接受 → `repairing_common_ground` → `repair_previous_wording`。其中 23 格 VALIDATED；`repair-question-pressure` 1 格 `GENERATION_NONCONFORMANT`（`repair:missing_ownership`、`repair:missing_interaction_move_withdrawal:pressure_question`），属生成层，计划正确。
- 修复对照 6/6 `repair_planned`；非修复对照 6/6 `offer_emotional_support`（1 格 `PROVIDER_ERROR`，基础设施，未重试）。

### `0a80b5d`（当前候选）

| 场景 | 模型候选（3/3） | 阶段 | Dialogue State / 计划 | 执行 |
| --- | --- | --- | --- | --- |
| intensity-exaggeration | `repairs_previous_move@0.95` → `a1`，带 proposition + `repair_or_withdraw` | 提出但被校验拒绝（`target_proposition_not_committed_claim`） | supporting_emotion / `offer_emotional_support` | VALIDATED |
| wrong-person | 同上 | 提出但被校验拒绝 | developing_thread / `acknowledge_without_psychologizing` | VALIDATED |
| repeated-claim | 同上（另有 `challenges_move_fit@0.85`） | 提出但被校验拒绝 | developing_thread / `acknowledge_without_psychologizing` | VALIDATED |
| direct-relationship-challenge | 同上 | 提出但被校验拒绝 | supporting_emotion / `offer_emotional_support` | 2 VALIDATED，1 `GENERATION_NONCONFORMANT`（`positive_function_not_satisfied`） |
| moralizing | 同上（另有 `challenges_move_fit@0.85`） | 提出但被校验拒绝 | developing_thread / `acknowledge_without_psychologizing` | VALIDATED |
| advice-boundary | `challenges_move_fit@0.95` → `a1`（+ `rejects_or_declines_move` 或 `acknowledges_previous_move`） | 模型没提出修复 | supporting_action / `offer_action_support` | 3/3 `PLAN_INVALID`（`ordinary_posture_conflicts_with_priority_owned_turn`） |
| question-pressure | `challenges_move_fit@0.95` → `a1` | 模型没提出修复 | developing_thread / `acknowledge_without_psychologizing` | VALIDATED |
| generic-listening | `challenges_move_fit@0.95` → `a1` | 模型没提出修复 | developing_thread / `acknowledge_without_psychologizing` | VALIDATED |
| unsupported-fear、topic-switch（对照） | 确定性修复 / `repairs_previous_move@0.95` 不带 proposition | 修复已规划 | repairing_common_ground / `repair_previous_wording` | VALIDATED |
| 两个情绪对照 | `opens_new_thread` / `shares_distress` | 非修复 | supporting_emotion / `offer_emotional_support` | VALIDATED |

没有“接受后状态或计划没采用”的格子：两侧凡是接受了 ≥0.93 的修复候选，都进入了 `repairing_common_ground` 并规划 `repair_previous_wording`。

## 5. 归因

机制 A（15/24 格，“提出但被校验拒绝”）：

- 过滤规则：`aadc62d`（2026-08-25，“feat: seal current conversation baseline”）在 `conversation-os/control/turnInterpreter.ts` 的 `modelRelationCandidates` 中加入：若提供了 `targetProposition` 但它不是目标回合的精确已提交 claim，整个候选丢弃。
- 同一提交在 `services/ai/turnInterpretationAdapter.ts` Prompt 中要求“语义上针对已提交助手 claim 的候选须逐字复制 targetProposition 并设置 targetOperation”。普通回复通常没有已提交 claim（`buildCommittedResponseMove` 只从 grounding facts 与 required disclosure 生成 claim），模型仍复制了上一轮的措辞，于是正确目标、置信 0.95 的修复被整体拒绝。
- 确定性探针复现同一差异（第 3 节第二行）；`7a2f3ab` 侧今天重跑 24/24 通过，排除了“模型已漂移”的解释。

机制 B（9/24 格，“模型没提出修复”）：

- `a02f0ff`（2026-08-04，交接关系上下文）把 `challenges_move_fit` 加入 Turn Interpretation 关系集合与 Prompt。按交接合同，它只在存在活动交接信封时经 `withdraw_or_repair_targeted_move` 进入修复；这些场景没有信封，因此不修复。确定性探针两侧一致（`7a2f3ab` 也不会把它当修复），差异来自模型在新关系集合下的选择。

提交与版本关系：`aadc62d`、`a02f0ff` 都在生产 `9750adc` 中，且都晚于 `7a2f3ab`。结论：这是相对 Batch 1.5-E 封存的回归，但生产已存在，不是本发布候选引入。

`a45da36`（把每个候选的 `targetTurnId` 改为必填）：被拒绝的候选都已带正确目标，拒绝原因与 `targetTurnId` 无关，第 3 节中“不给目标”在两侧仍可修复；未找到它导致本次失效的证据。它对模型选择倾向的额外影响未单独测量，**尚未确定**。`a02f0ff` 与 `aadc62d` 之间各提交分别对模型倾向的影响未逐一测量，机制 B 的倾向变化只能归到“`a02f0ff` 引入该关系”这一代码事实，精确引入点**尚未确定**。

## 6. “你一点都不懂我”（`TRJ-REPAIR-OBS-001` t1）单独链路

- 无前序助手回合，合法修复目标为空；两侧结构上都不可能进入修复（与探针“目标为用户回合/无助手回合 → 无修复”一致）。
- `7a2f3ab`：`repairs_previous_move@0.6`，无目标（低于阈值）+ `shares_distress@0.85` → supporting_emotion / `offer_emotional_support` → 3/3 `GENERATION_NONCONFORMANT`（`emotional_support:missing_selected_function:acknowledge_current_relational_impact`）。
- `0a80b5d`：`challenges_move_fit@0.85`，无目标 + `shares_distress@0.75` → 同一计划 → 3/3 `GENERATION_NONCONFORMANT`（`planned_function_semantic:positive_function_not_satisfied`）。
- 结论：与上述修复识别漂移**不同根因**。计划两侧一致且符合现有合同，失败在情绪支持的生成/校验层，封存基线上同样失败，属既有问题。

## 7. 最小修复建议（未实施，待用户决定）

证据最充分的是机制 A（确定性复现 + 15/15 真实格）。所属层：Conversation OS Turn Interpretation，`conversation-os/control/turnInterpreter.ts` 的 `modelRelationCandidates`。

建议：目标助手回合**没有任何已提交 claim** 时，忽略模型附带的、无法校验的 `targetProposition`/`targetOperation`，保留已通过目标绑定校验的关系本身；目标回合**有** claim 时仍按精确匹配 fail closed。0.93 阈值、`targetTurnId` 校验、handoff 目标绑定不变，`modelRepair` 在无 claim 时本来就按“目标回合无已提交 claim”路径接受。

需要用户确认的点：交接合同 `docs/CONVERSATION_OS_INTERACTION_MOVE_HANDOFF_CONTRACT_V1.md` §6 写明“缺失或不匹配的 claim 绑定 fail closed”。上述修复把“目标回合根本没有 claim 可绑定”解释为不适用该条，需要作为合同澄清写入。替代方案是只改 Prompt（要求无 claim 时省略这两个字段），但模型遵从度未验证。

不在本建议内、需另行决定：机制 B（无信封时 `challenges_move_fit` 是否应进入修复，属产品/架构决定）；`advice-boundary` 的 `PLAN_INVALID`；“你一点都不懂我”的情绪支持生成失败；重复 Safety 话术（待评审，符合书面规则不等于体验通过）。

修复若实施，需要重跑：诊断工具两侧、`check:interaction-move-*`、`check:conversation-os-control`、`check:interaction-move-handoff-turn-interpretation-qwen-real`、Batch 1.5 保持门（冻结门，门槛不变）以及受影响的轨迹。
