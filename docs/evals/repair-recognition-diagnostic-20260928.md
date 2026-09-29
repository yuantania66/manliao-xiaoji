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
- 确定性探针复现同一差异（第 3 节第二行）。在同配置、同期对照中，基线 `7a2f3ab` 恢复通过（24/24），候选存在可确定性复现的校验回归；关系选择差异（机制 B）的完整归因仍未确定。

机制 B（9/24 格，“模型没提出修复”）：

- `a02f0ff`（2026-08-04，交接关系上下文）把 `challenges_move_fit` 加入 Turn Interpretation 关系集合与 Prompt。按交接合同，它只在存在活动交接信封时经 `withdraw_or_repair_targeted_move` 进入修复；这些场景没有信封，因此不修复。确定性探针两侧一致（`7a2f3ab` 也不会把它当修复），差异来自模型在新关系集合下的选择。

提交与版本关系：`aadc62d`、`a02f0ff` 都在生产 `9750adc` 中，且都晚于 `7a2f3ab`。结论：这是相对 Batch 1.5-E 封存的回归，但生产已存在，不是本发布候选引入。

`a45da36`（把每个候选的 `targetTurnId` 改为必填）：被拒绝的候选都已带正确目标，拒绝原因与 `targetTurnId` 无关，第 3 节中“不给目标”在两侧仍可修复；未找到它导致本次失效的证据。它对模型选择倾向的额外影响未单独测量，**尚未确定**。`a02f0ff` 与 `aadc62d` 之间各提交分别对模型倾向的影响未逐一测量，机制 B 的倾向变化只能归到“`a02f0ff` 引入该关系”这一代码事实，精确引入点**尚未确定**。

## 6. “你一点都不懂我”（`TRJ-REPAIR-OBS-001` t1）单独链路

- 无前序助手回合，合法修复目标为空；两侧结构上都不可能进入修复（与探针“目标为用户回合/无助手回合 → 无修复”一致）。
- `7a2f3ab`：`repairs_previous_move@0.6`，无目标（低于阈值）+ `shares_distress@0.85` → supporting_emotion / `offer_emotional_support` → 3/3 `GENERATION_NONCONFORMANT`（`emotional_support:missing_selected_function:acknowledge_current_relational_impact`）。
- `0a80b5d`：`challenges_move_fit@0.85`，无目标 + `shares_distress@0.75` → 同一计划 → 3/3 `GENERATION_NONCONFORMANT`（`planned_function_semantic:positive_function_not_satisfied`）。
- 结论：与上述修复识别漂移**不同根因**。计划两侧一致且符合现有合同，失败在情绪支持的生成/校验层，封存基线上同样失败，属既有问题。

## 7. 最小修复建议（诊断时未实施；用户已批准，实施与验证见第 8 节）

证据最充分的是机制 A（确定性复现 + 15/15 真实格）。所属层：Conversation OS Turn Interpretation，`conversation-os/control/turnInterpreter.ts` 的 `modelRelationCandidates`。

建议：目标助手回合**没有任何已提交 claim** 时，忽略模型附带的、无法校验的 `targetProposition`/`targetOperation`，保留已通过目标绑定校验的关系本身；目标回合**有** claim 时仍按精确匹配 fail closed。0.93 阈值、`targetTurnId` 校验、handoff 目标绑定不变，`modelRepair` 在无 claim 时本来就按“目标回合无已提交 claim”路径接受。

需要用户确认的点：交接合同 `docs/CONVERSATION_OS_INTERACTION_MOVE_HANDOFF_CONTRACT_V1.md` §6 写明“缺失或不匹配的 claim 绑定 fail closed”。上述修复把“目标回合根本没有 claim 可绑定”解释为不适用该条，需要作为合同澄清写入。替代方案是只改 Prompt（要求无 claim 时省略这两个字段），但模型遵从度未验证。

不在本建议内、需另行决定：机制 B（无信封时 `challenges_move_fit` 是否应进入修复，属产品/架构决定）；`advice-boundary` 的 `PLAN_INVALID`；“你一点都不懂我”的情绪支持生成失败；重复 Safety 话术（待评审，符合书面规则不等于体验通过）。

修复若实施，需要重跑：诊断工具两侧、`check:interaction-move-*`、`check:conversation-os-control`、`check:interaction-move-handoff-turn-interpretation-qwen-real`、Batch 1.5 保持门（冻结门，门槛不变）以及受影响的轨迹。

## 8. 机制 A 修复实施与局部验收（2026-09-28，用户批准）

实施（`5f87394`，合同 `8afb9f3`）：

- `conversation-os/control/turnInterpreter.ts`：`modelRelationCandidates` 中，仅当同时满足以下条件时丢弃无法核验的 `targetProposition`/`targetOperation`，保留针对该助手轮次的修复，并在候选 evidence 中记录丢弃：关系为 `repairs_previous_move`、`targetOperation=repair_or_withdraw`、置信度 ≥0.93、目标是上下文中最近一个助手轮次、该轮次**明确**记录空 claims（有效的 `committedAssistantMove` 或有效 move envelope 的 `claims: []`，或交接信封的 claims 为空，且所有来源都为空）。
- “明确没有 claims”与“claims 不可用”分开：没有 committed move、envelope 无效、目标缺失、未知、用户轮次、非最近助手轮次，都不走该例外，保持原 fail closed。目标轮次有 claims 时仍要求精确绑定。0.93 阈值、目标轮次校验、handoff 目标绑定不变；没有新增无目标放行路径；不生成或伪造 claim 绑定（修复状态沿用既有的轮次级 `model-rejected` 标识和该轮次原文）。
- 合同：交接合同 §6.2 增加“Claimless-target repair”澄清条款。

确定性回归（`check:conversation-os-relational-state` 新增 12 例，全部通过）：

| 类别 | 用例 | 结果 |
| --- | --- | --- |
| 无 claims 的合法轮次级修复被保留 | 已提交 move `claims: []`；游客 envelope `claims: []` | 保留修复，proposition 被丢弃并记录；进入 `repairing_common_ground`，`repairState.status=active`，计划含 `repair_previous_wording` |
| 有 claims 且绑定正确 | 精确绑定 | 正常通过，绑定到 `claim-1`，不走例外 |
| 有 claims 但绑定缺失/错误 | 缺失；不匹配 | 拒绝，无修复 |
| 无效、过期或缺失目标 | claims 数据不可用；无目标；未知目标；用户轮次；较早助手轮次 | 拒绝，例外不放行 |
| 其他 | 置信度 0.9；`requests_answer` + `explain` | 拒绝 |

回退验证：把例外临时置为关闭后，新回归在第一例失败；恢复后文件字节一致。

相关确定性门（均 exit 0）：`tsc`、eslint（改动文件）、`check:conversation-os-{control,relational-state,architecture}`、`check:interaction-move-{envelope,handoff,handoff-planner,handoff-surface-validator}`、`check:hill-helping-batch1-5`、`-preservation`、`-stage2`、`-post-candidate4`、`-causal-ablation`、`check:hill-helping-batch1`、`-batch2a`、`-batch2b`、`-batch2c-a`、`check:ai-orchestration`、`check:natural-chat-control`、`check:conversation-trajectories`、`check:trajectory-experiments`、诊断工具检查。

确定性探针（修复后候选，无凭据）：

- 已提交且无 claims 的历史（下述真实验证输入）：“合法目标 + 未提交 proposition + repair_or_withdraw”7/7 进入修复；用户轮次目标、置信度 0.9、`continues_active_thread`、`challenges_move_fit` 仍不修复（唯一例外是确定性修复场景 `repair-unsupported-fear`，与模型候选无关）。
- 冻结夹具原样历史：同一探针 9/10 仍不修复（1 格为确定性修复场景）。原因是夹具历史中的助手轮次**没有** committed move 数据，按批准的规则属于“claims 不可用”，例外不适用。

真实模型验证（预算在运行前固定：机制 A 的 5 个场景 + 2 个修复对照 × 3 轮 = 21 回合，仅候选侧，无重试；输入为冻结夹具的相同用户消息与助手原文，助手轮次附加生产普通回复会记录的空 claims committed move，夹具文件本身未改；HEAD `8afb9f3` 干净，`qwen3.7-max`，13:36:59–13:43:20 UTC，exit 0）：

- 21/21 `repair_planned`，全部 VALIDATED；受影响 5 个场景 15/15（此前 0/15）。
- 15 格中 14 格模型仍复制了上一轮措辞作为 `targetProposition`（即使看到 `claims: []`），由例外丢弃后保留修复；1 格模型未提供 proposition，走既有路径。对照 6/6 保持修复（3 确定性，3 无 proposition）。
- 产物：`repair-recognition-diagnostic-20260928/diag-real-candidate-fix-claimless.json`、`diag-probes-candidate-fix-{claimless,fixture}.json`（探针在提交前以同一份代码运行，productDirty 仅为本修复文件）。CJK 0、文本键 0、疑似密钥 0。原诊断与失败记录均保留。

对冻结门的影响（未重跑冻结门）：冻结保持门的夹具历史不含 committed move，机制 A 的 15 格在该门上按规则仍会被拒绝，加上机制 B 的 9 格，保持门仍是已知阻塞。夹具是否应表示生产的已提交历史形态，属于冻结门/夹具决定，本轮未改。

## 9. 剩余 9 格 `challenges_move_fit` 分析（不追加采样）

依据：第 4 节已有结构数据、冻结夹具原文、现有代码与合同。

三类区分：

| 类别 | 判断依据 | 现有负责机制 | 本次数据 |
| --- | --- | --- | --- |
| 用户明确纠正或反对上一轮助手表达（命题） | 否定上一轮加入的情绪、强度、意图、人物或事实 | TI `repairs_previous_move` → 修复 `proposition_withdrawal`/`factual_replacement` | 机制 A 的 15 格；第 8 节修复后已恢复（生产形态历史） |
| 用户认为当前帮助方式不合适（互动动作） | 反对上一轮的建议、追问、套话或话题切换，有明确可指向的上一助手轮次 | Batch 1.5 正向功能合同 §4.1 `interaction_move_withdrawal`（`repair_previous_wording` 的子类型：`unsolicited_advice`、`pressure_question`、`generic_listening`、`moralizing`、`topic_switch`） | 剩余 9 格：advice-boundary（“我说了不想要建议，你还是在教我怎么做”）、question-pressure（“你又在追问……”）、generic-listening（“……只是在说你会听”）；模型 9/9 给出 `challenges_move_fit@0.95`，目标为合法的上一助手轮次 `a1`，无活动交接信封 |
| 没有明确可指向的助手轮次 | 无前序助手轮次或候选无目标 | 不进入修复；按当前内容规划（如情绪支持） | `REPAIR-OBS`：`challenges_move_fit@0.85` 无目标，结构上不能修复（第 6 节） |

现有机制为什么没有履行第二类责任：

1. Turn Interpretation Prompt（`a02f0ff` 起）同时要求“`repairs_previous_move` 只用于否定具体命题”（该句封存时已存在）与“互动动作被认为不必要、重复、施压或不匹配时用 `challenges_move_fit`”。封存时没有 `challenges_move_fit` 可选，模型对这三类抱怨给出 `repairs_previous_move`；现在模型按 Prompt 改选 `challenges_move_fit`，这是符合 Prompt 的分类，不是模型失误。
2. `challenges_move_fit` 只有交接路径消费：交接合同 §7.2 把它映射到 `withdraw_or_repair_targeted_move`，前提是存在活动交接目标（主动问候的 `opens` 信封）。普通聊天中它只用于阻止 idle 和排除记忆召回（`responsePlanner.ts`），Dialogue State 不会因此进入 `repairing_common_ground`。
3. 因此 Batch 1.5 的 `interaction_move_withdrawal` 在普通聊天中只剩确定性纠正这一个入口，模型路径不可达；Planner 退回 `acknowledge_without_psychologizing`，advice-boundary 还因确定性 `requests_action_support@0.9`（两侧都有，封存侧被修复优先覆盖）落到 `offer_action_support`，触发 `PLAN_INVALID`。

最小处理方案（未实施，需要用户决定）：在 Turn Interpretation 的修复提案处（`mergeModelInterpretation` 的 `modelRepair` 选择），当**没有活动交接目标**时，接受满足以下全部条件的 `challenges_move_fit` 作为轮次级修复提案：置信度 ≥0.93；目标是上下文中最近一个已提交助手轮次；不携带或不依赖 claim 绑定。Planner 已有的 `interactionMoveSubtypeFor` 会据此给出 `interaction_move_withdrawal` 与子类型。有活动交接目标时继续走 §7.2 的交接路径；无目标、低置信、目标非最近助手轮次都不进入修复。按第 4 节已记录的结构数据，9/9 满足这些条件，`REPAIR-OBS`（无目标、0.85）与所有非修复对照不满足；是否恢复计划与生成通过，需要实施后按固定预算验证，不能预先断言。

需要改变的具体合同条款：

- 交接合同 `CONVERSATION_OS_INTERACTION_MOVE_HANDOFF_CONTRACT_V1.md` §6.2 中 `challenges_move_fit` 条款：补充“无活动交接目标时，指向最近已提交助手轮次、置信度 ≥0.93 的 `challenges_move_fit` 进入普通修复（`interaction_move_withdrawal`）；有活动交接目标时按 §7.2”。
- `HILL_HELPING_BATCH1_5_RESPONSE_PLAN_POSITIVE_FUNCTION_CONTRACT_V1.md` §4.1：写明 `interaction_move_withdrawal` 的入口包括上述 `challenges_move_fit`，不只来自命题否定。
- Turn Interpretation Prompt 的两句分类说明可以保持不变（分类本身正确，缺的是消费方）。

仍保留为未解决事项（不因属于既有问题而视为通过）：advice-boundary 的 `PLAN_INVALID`；“你一点都不懂我”无历史上下文时的生成失败；重复 Safety 话术（待评审）。

## 10. 夹具 v2 与普通 `challenges_move_fit` 修复（2026-09-28，用户批准，候选 `72c1477`）

### 10.1 生产已提交历史结构（核实结果）

- 写入：登录会话 `commitValidatedAssistantMessage` 把 `buildCommittedAssistantMove(reply)`（即 `buildCommittedResponseMove`，claims 只来自 `plan.groundingFacts` 中“Selected user-confirmed memory:”项与 `plan.requiredDisclosure`）写入 `chatMessage.interactionMetadata`，同时写 `status`、`replyToMessageId`；执行轨迹另存响应计划信封，需要真实的 VALIDATED 提交证据。
- 读取：下一轮消息路由用 `parseCommittedAssistantMoveMetadata` 读回为 `committedAssistantMove`；游客路径只回传信封。

### 10.2 夹具 v2

- 文件 `clinical-evals/hill-helping-batch1-5-preservation-v2-committed-history.json`（版本 `hill-helping-batch1-5-preservation-v2-committed-history-2026-09-28`，sha256 `e03a6c36…`），由 `scripts/hill-helping-batch1-5-preservation-v2-generate.ts` 从 v1（sha256 `12bd41f3…`，未改动）确定性生成；`check:hill-helping-batch1-5-preservation-v2` 校验可复现性与不变量。
- 方法：每个助手历史轮次用其前一用户轮次的生产确定性 ResponsePlan 调用 `buildCommittedResponseMove`，再经 `serialize`/`parseCommittedAssistantMoveMetadata` 往返。只有派生计划无 groundingFacts、无 requiredDisclosure、无开放义务、两段文本都不涉及助手身份、往返后 claims 为空时才写 `claims: []`；否则保持原样。不写信封（无法提供真实提交证据）。
- 结果：10 个修复场景的 `a1` 全部满足条件；差异仅为这些助手轮次新增 `status: "saved"`、`replyToMessageId: "u1"` 与 `committedAssistantMove`。用户轮次、`userMessage`、`expectedAction`、门阈值不变；10 个情绪场景输入逐字节相同。
- 记录项：3 个作者撰写的 `a1`（intensity-exaggeration、repeated-claim、topic-switch）在派生计划下不会通过校验，已写入 provenance；它们本就是被抱怨的错误动作。
- 可比范围：v2 与 v1 不等价。v1 的 60/60 测的是“历史 claims 不可用”；v2 测的是生产协议下的已提交历史。修复场景的 claims 权威与 `lastCommittedAssistantMove`（purpose、questionOrRequest）不同，可能改变解释与规划，v2 结果不能当作 v1 重跑。情绪场景输入相同，但属于不同时间、不同候选的独立采样。

### 10.3 普通 `challenges_move_fit` 修复

- `mergeModelInterpretation`：没有活动交接目标、没有确定性或 `repairs_previous_move` 修复时，接受满足以下全部条件的 `challenges_move_fit`：置信度 ≥0.93；不带 `targetProposition`；目标是最近助手轮次；该轮次明确记录空 claims；当前用户轮次不含具体替代事实（与 Planner 共用 `replacementFactFromCorrection`，移至 `correctionEvidence.ts`，行为不变）。
- 原关系保留在候选中；采纳记为 `repairProposal.sourceRelation = "challenges_move_fit"` 加采纳证据，并传入 `repairState`。
- Planner 对该来源固定 `interaction_move_withdrawal`、`replacementFact = null`，子类型沿用现有相邻证据规则；无子类型时 preflight 以 `missing_interaction_move_subtype_in_contract` 失败关闭。
- 交接合同 §6.2、Batch 1.5 正向功能合同 §4.1 同步更新（`72c1477`）。

### 10.4 确定性验收

- `conversation-os-relational-state-check`：三类抱怨（建议、追问、泛泛倾听）全链路通过。链路为：解释采纳 → `repairing_common_ground` → 对应子类型修复计划 → 带权威快照的 preflight 通过 → 确定性校验通过 → 固定满足判定的语义校验通过（只证明绑定与路由，不代表模型理解）→ `buildCommittedResponseMove` 与元数据往返 → 下一轮读回 `purpose=repair_previous_wording`。继续追问的回复被 `question_not_allowed_by_plan` 拒绝。
- 拒绝边界 9 例：无历史、历史无 committed move、目标有 claims、无目标、用户轮次目标、过期目标、置信度 0.92、带命题绑定、正常回答。
- 另有 3 类情形：活动交接时交接路径不变（子类型 null）；无法分类的抱怨在 preflight 失败关闭；具体事实纠正只标为 `challenges_move_fit` 时不采纳，经 `repairs_previous_move` 仍为 `factual_replacement`。
- 回退验证：分别去掉交接、事实纠正、显式空 claims、阈值、目标这 5 个守卫，以及 Planner 的模式固定，检查都会失败；源文件恢复后逐字节一致。
- `preservation-v2-check`：v1 历史下三类 move-fit 全部拒绝，v2 下全部采纳；显式修复计划在 v1 与 v2 下相同；错误目标被拒绝。
- tsc、eslint、33 个确定性检查与诊断检查 exit 0。`chat-execution-lifecycle`、`proactive-move-structured-commit` 在新建隔离测试库 `xq_rc_ci_test_20260928d` 上通过（首次运行因隔离 PG 未启动而连接失败，不计入产品结果）。

### 10.5 完整冻结保持门（一次，无重试）

候选 `72c1477`（worktree 干净，已推送），夹具 v2，`qwen3.7-max`，`AI_TIMEOUT_MS=45000`，`.env` sha 前缀 `0ee58c243449c1a4`，14:21:13–14:38:42 UTC。结构副本见 `repair-recognition-diagnostic-20260928/preservation-v2-72c1477-structural.json`（不含回复文本）。

| 检查 | 结果 | 阈值 |
| --- | --- | --- |
| 完整运行 | 60/60 | 60 |
| preflight | 60/60 | 100% |
| 期望动作 | 60/60 | 100% |
| VALIDATED | 59/60 | 100% → **FAIL** |
| constraint_failure | 1 | 0 → **FAIL** |
| helping provider 调用 | 0 | 0 |
| 重新生成率 | 3/60 = 5% | ≤20% |

- 门结论：**FAIL**。
- 修复场景 30/30 期望动作且 VALIDATED，无重新生成（v1 历史下的 r6 为 16/30 期望动作）。
- advice-boundary 本次 3/3 规划修复并通过，未出现 `PLAN_INVALID`；只是本次运行未出现，不证明该问题已消除。
- 冻结 runner 只记录动作与校验结果，不记录关系与修复模式，因此 advice-boundary、question-pressure、generic-listening 这 9 格具体经由 `challenges_move_fit` 采纳还是 `repairs_previous_move`，本次产物无法确定；未为此追加采样。
- 唯一失败：`emotion-being-ignored` 第 2 次运行两次尝试都被语义校验拒绝（`positive_function_not_satisfied`、`question_count_quality`），最终 `constraint_failure`；同场景第 1、3 次运行也各重新生成 1 次（`question_count_quality`）。
- 同一场景在 `abec5ed` 的 r6（v1 夹具，本切片之前）出现完全相同的失败签名。封存运行 `batch1-5-e` 该场景 3/3 通过，但第 1 次同样需要重新生成。
- 该场景无历史，本切片的改动在结构上不会作用于它。它属于情绪支持生成与语义校验层的既有不稳定，不在本切片范围内，因此未进行修复轮，也未重跑。

## 11. 情绪支持生成与校验链诊断与最小修复（2026-09-29，用户批准，候选 `e3428a4`）

### 11.1 诊断（只用既有产物，未追加采样）

| 项 | `emotion-being-ignored` | 无历史“你一点都不懂我”（`TRJ-REPAIR-OBS-001` t1） |
| --- | --- | --- |
| Planner 要求 | `offer_emotional_support` / `return_focus_control`（两个证据目标：被忽略、挺难受），`optional_after_answer` | `offer_emotional_support` / `acknowledge_current_relational_impact`，`optional_after_answer` |
| 生成器实际收到 | 焦点控制约束齐全，含“不制造 A/B 选择、不问原因/触发事件/细节” | 通用约束写着“以许可与用户控制完成功能……给出控制即完成”，与合同 §3.2 对该功能的定义（承认关系影响与信息边界）冲突 |
| 首次回复实际完成 | v2/r6 共 6 行几乎都是“你想先说说 X，还是聊聊 Y”，Y 常为“当时具体发生了什么／情形／别的部分”，违反提示与合同 §3.3 | r6 3/3 给出表达量许可（“你想说多少、怎么说，都由你来决定”），无信息边界 |
| 校验依据 | 失败行 `positive_function_not_satisfied`（与合同一致）；另有 4 行仅因 advisory `question_count_quality` 触发再生成：单个低负担邀请在合同 §3.3 与 VAL-SEM-04 下是允许的，校验实现把情绪支持计划排除在允许单问的动作之外 | `positive_function_not_satisfied`：判定回复实现了另一种支持功能，与合同一致 |
| 再生成反馈 | 只有“修复校验项 planned_function_semantic:…”，无功能级纠正；r6 第 2 次运行两次尝试逐字相同 | 同左 |

结论：三个根因，两个场景不同根因、共享第 1 项。

1. 再生成反馈缺失（两场景共享）。
2. 校验实现偏离既有合同：情绪支持计划的一个低负担邀请被记为超额（只影响 `emotion-being-ignored` 的非必要再生成）。
3. 提示冲突：通用“给出控制即完成”作用于 `acknowledge_current_relational_impact`（只影响“你一点都不懂我”）。

### 11.2 最小修复（`e3428a4`）

- `plannedFunctionSemanticValidator.ts`：`offer_emotional_support` 在 `questionPolicy` 允许时可带至多 1 个语义请求；`none` 仍要求 0，上限未放宽。
- `responsePlanValidator.ts`：情绪支持语义失败按支持功能给出具体中文纠正，含证据词、内容边界、邀请边界（`none` 时禁止无问号请求）。
- `promptBuilder.ts`（`chat-response-plan-v29`）：通用“给出控制即完成”不再作用于 `acknowledge_current_relational_impact`；该功能增加“承认没接住＋信息边界，不以表达量/焦点许可替代”。
- 未改阈值、未删校验、未加重试、无固定兜底回复；失败回复仍不提交。
- 确定性回归：换回 HEAD 源文件时三项回归分别失败（F1 `emotional support question count 1`、F2 `regeneration feedback must be concrete`、F3 `must not be told that granting expression control completes it`），当前代码通过；tsc、eslint、`check:release:required`（新隔离库 `xq_rc_ci_test_20260929a`）exit 0。固定 verdict 的测试只证明链路连接。
- runner 可观察性：保持门 runner 每行记录 `repairAdoption`（`adoptedRelation`、`adoptionSource`、`repairMode`、`interactionMoveSubtype`），汇总 `repairAdoptionBySource` 只作观察，不参与门判定。

### 11.3 预先固定的真实模型预算（一次，无重试）

预算：两场景各 5 次，无历史；通过标准为 10/10 VALIDATED、0 `constraint_failure`、计划与期望支持功能一致。脚本 `scripts/emotional-support-fix-budget.ts`，`e3428a4`，`qwen3.7-max`，`AI_TIMEOUT_MS=45000`，`.env` sha 前缀 `0ee58c243449c1a4`。结构副本 `emotional-support-fix-20260929/budget-e3428a4-structural.json`（不含回复文本）。

| 场景 | 通过 | 再生成 | 首次即通过 |
| --- | --- | --- | --- |
| `emotion-being-ignored` | 4/5 | 1 | 4/5（修复前 v2+r6 为 0/6） |
| 无历史“你一点都不懂我” | 1/5 | 4 | 1/5 |

- 预算结论：**FAIL**（5/10）。完整冻结保持门的前置条件未满足，未运行。
- F1 生效：advisory 不再触发非必要再生成。
- F3 部分生效：4/5 回复已包含“没接住＋还不知道具体哪里没对上”的信息边界（修复前 0/3）。但这 4 条都在后面追加了“你想说多少、先说哪部分都可以”，两次尝试都被判 `positive_function_not_satisfied`；唯一通过的一条没有这一尾句。
- `emotion-being-ignored`：判定方向不一致。第 1、4 次提供未知选项“别的部分”仍判通过（判定规则写明只能是已表达部分）；第 5 次两个选项都是已表达内容（“这份难受”“被忽略的感觉”），两次尝试都被拒绝。

### 11.4 停止点（证据不足以判断回复与校验谁错）

合同 §3.2 要求“恰好一个主要功能”，§3.3 允许在功能完成后追加至多一个围绕“先表达哪一部分或表达多少”的低负担邀请，同时禁止“要求用户证明助手哪里没懂”。紧跟在“还不知道哪里没对上”之后的“先说哪部分”尾句，既可读作 §3.3 允许的邀请，也可读作请用户指出哪里没懂。本次产物未记录判定证据片段，重放判定属于新采样。因此没有进入修复轮，两个修复轮预算都未消耗，需先由产品决定合同解释。

## 12. 第 1 轮修复：关系影响承认边界与判定器可靠性（2026-09-29，用户批准合同解释）

### 12.1 批准的合同解释

已写入合同 §3.2/§3.3。`acknowledge_current_relational_impact` 完成“承认当前未被理解的关系影响＋如实说明信息边界”后即完成：
- 不主动要求用户解释、举例、选择先说哪部分或说多少，也不要求用户证明助手哪里没懂；
- 这是功能边界，不按固定词串拦截；
- 无历史时不得虚构之前说错了什么；
- 同一轮的明确问题或请求仍须回答。

### 12.2 既有判定输出审查（只用既有产物）

- 既有日志只记录失败码。`enforceResponsePlan` 未保留语义 verdict，因此所有历史行的判定理由与证据片段均为**未知**，不推断判定器心路。
- 输入是否相同可以核实。r6 第 2 次运行两次尝试的计划、用户文本、回复与参数完全相同，判定器温度为 0，但第 1 次判正向功能满足、第 2 次判不满足。这是同输入异判的已核实事实。

`emotion-being-ignored` 已知判定结果的尝试，对照合同标签：

| 合同标签 | 依据 | 尝试 | 判定器判正向功能满足 | 被提交为最终回复 |
| --- | --- | --- | --- | --- |
| 应失败：提供未知“别的部分” | §3.2 已知部分、§3.3 | v2 r1 a2、r6 r3 a1、预算 r1、预算 r4 | 4/4 | 3（v2 r1、预算 r1、r4） |
| 应失败：邀请“具体发生了什么” | §3.3 不得默认邀请触发事件/经过 | v2 r2 a2、r6 r1 a2、r6 r2 a1、r6 r2 a2 | 2/4 | 1（r6 r1） |
| 应通过：两个选项都是本轮已说内容 | §3.2、§3.3 单个邀请 | 预算 r5（最终尝试） | 0/1 | 否（`constraint_failure`） |
| 歧义：瞬间／场景／情形／计划焦点但回复表达量 | 合同未决定 | 其余 6 次 | 不计分 | — |

- 结论：判定器在该场景对合同明确规则的正确率为 2/9（已知判定的尝试）。
- 这与本轮校验修改直接相关：`e3428a4` 取消 advisory 触发的非必要再生成后，首轮带“别的部分”的回复直接提交（预算 r1、r4）。
- 实现缺口：判定规则写了焦点控制针对“已表达部分”，也写了“请求原因/细节”属于反向动作。但没有规定“提供的选项中引入未知内容或事件经过”同样违规，也没有要求失败时给出规则依据。
- 无历史“你一点都不懂我”：预算 r1–r4 的最终尝试均被判不满足，与新解释一致，理由未知；r5 属歧义，未计分。

### 12.3 最小修复（本轮，第 1 轮修复记账）

- Planner：该功能 `questionPolicy=none`，并在原因中注明回答义务仍适用。显式问题的回答义务与 `answer_directly` 保持不变（回归覆盖）。
- 生成（提示 `chat-response-plan-v30`）：
  - 完成即止，不以提问或陈述形式索取或邀请选择；
  - 仅在对话中存在之前的助手回复时才可指涉它；
  - 同轮问题仍回答；
  - 通用“表达量许可”句不再作用于该功能。
- 判定器：新增规则编号 `ES-SCOPE`、`ES-FOCUS`、`ES-ACK-BOUNDARY`、`ES-ACK-NO-SOLICIT`、`ES-ACK-NO-FABRICATION`。失败、不确定或含反向动作时，须引用确切片段并以规则编号开头说明理由。判定输入新增可选 `priorAssistantTurnAvailable`（生产由近期消息计算；缺省为未知，`ES-ACK-NO-FABRICATION` 不适用）。
- 再生成反馈：该功能改为同一边界。所有情绪支持反馈都注明“选项、邀请或许可只能指向用户本轮已说出的内容”。
- 记录：`enforceResponsePlan` 按尝试返回语义 verdict；仅在调试追踪下通过 `plannedFunctionSemanticVerdicts` 暴露，不写入持久化的 `finalValidation`。保持门 runner 与预算脚本记录规则编号与证据片段（本地），结构副本只保留编号与偏移。
- 未删校验、未降标准、未加重试。

### 12.4 预先列明的真实模型预算（第 1 轮修复；按顺序执行，前一阶段失败即停止并保留结果）

| 阶段 | 类型 | 调用 | 通过标准 |
| --- | --- | --- | --- |
| J | 固定回复判定验证（`emotional-support-judge-reliability-eval.ts`，案例留本地） | 9 个有标签案例 × 3 次 + 4 个歧义案例 × 1 次 = 31 次判定 | 9/9 案例可靠：每次结果与标签一致，且每个应失败调用引用了可接受的规则编号 |
| Q | 受影响的冻结门 `check:planned-function-semantic-qwen-real` | 全部冻结用例各 1 次 | 该门自身标准（0 失败） |
| E | 端到端生成验证（`emotional-support-fix-budget.ts`） | 两场景各 5 回合 = 10 回合（含其内部判定调用） | 10/10 VALIDATED 且提交、计划与支持功能一致、已提交回复的冻结结构筛查违规 0；歧义筛查命中列入人工复核，不计通过也不计失败 |
| F | 完整冻结保持门 v2（J、Q、E 全部通过后） | 60 回合一次 | 冻结门自身标准；按既定要求记录 advice-boundary 结果 |

- 基础设施重试只限既有的超时/429/5xx 处理。
- 所有失败结果保留。
- 本轮失败后最多再有 1 轮证据驱动修复；Safety 预算不重置。

### 12.5 第 1 轮结果（`693f9ee`，`qwen3.7-max`，`AI_TIMEOUT_MS=45000`，`.env` sha 前缀 `0ee58c243449c1a4`）

确定性：新增回归在 `e3428a4` 源文件上失败、在 `693f9ee` 上通过；tsc、eslint 通过；`check:release:required` exit 0（隔离测试库 `xq_rc_ci_test_20260929b`）。

| 阶段 | 结果 | 要点 |
| --- | --- | --- |
| J 判定验证 | **PASS** | 31 次判定；9/9 有标签案例可靠（27/27 与标签一致，18/18 应失败调用引用可接受规则编号）。歧义案例只记录：“那一刻”类 fail（ES-SCOPE）、“情形”类 fail（ES-SCOPE）、计划要求表达量却给焦点 fail（ES-FOCUS）、“刚才”漂移 pass。结构副本 `emotional-support-fix-20260929/judge-reliability-693f9ee-structural.json` |
| Q 冻结真实判定门 | **PASS** | `check:planned-function-semantic-qwen-real` 41 例 0 失败 |
| E 端到端生成 | **PASS**（按预登记标准） | 10/10 VALIDATED 并提交，0 `constraint_failure`；3 次再生成（being-ignored 首次尝试因 ES-SCOPE 被拒：“具体发生了什么”“别的部分”“刚才那个瞬间”）；冻结筛查违规 0；歧义命中 2 条列入人工复核。结构副本 `emotional-support-fix-20260929/budget-693f9ee-structural.json` |
| F 完整冻结保持门 v2 | **FAIL** | 见下 |

F（数据集 SHA `e03a6c36…`，20 场景 × 3，05:22:53–05:45:32 UTC）：完成 60/60；VALIDATED 59/60（门槛 100%）；期望动作 60/60；preflight 60/60；`constraint_failure` 1（门槛 0）；再生成 6/60 = 10%（门槛 20%）；Helping provider 0。`repairAdoptionBySource`：`none:none` 30、`model_repair:proposition_withdrawal` 9、`model_repair:interaction_move_withdrawal` 9、`model_move_fit:interaction_move_withdrawal` 6、`deterministic_correction:proposition_withdrawal` 3、`model_repair:factual_replacement` 3。advice-boundary 3/3 VALIDATED，无 `PLAN_INVALID`。结构副本 `emotional-support-fix-20260929/preservation-v2-693f9ee-structural.json`（不含用户消息、历史、回复与证据文本）。

- 唯一失败 `emotion-lonely` 第 3 次：`surface_realization_unavailable`，`generationAttempts=0`，耗时 16.3 秒。它来自编排层异常分支（`classifyExecutionError`，只可能是 `PROVIDER_ERROR` 或 `TIMEOUT`），在任何候选回复产生之前抛出，不是校验拒绝。语义判定器自身会捕获异常并记为 `planned_function_semantic:provider_failure`，所以异常不来自判定器。本轮代码改动在该路径上只新增 `recentMessages.some(...)`，不会抛出。**具体子类型（HTTP 非 2xx、空回复、网络错误或超时）未知**：保持门 runner 不记录 `execution.failure`，未推断，未重试。同场景第 1、2 次 VALIDATED。
- 语义判定：65 次尝试有 verdict，6 次被拒，均引用 ES-SCOPE。逐条对照合同：
  - 正确 2 次：“还是聊聊刚才具体发生了什么”“还是聊聊别的部分”（being-ignored）。
  - 歧义类 1 次：“还是聊聊刚才那个瞬间”（being-ignored）。同类在 E 中被放行、在 J 中被拒；判定器对“瞬间”类仍不一致，不贴标签。
  - 规则归属存疑 3 次：
    - `emotion-vague-blocked` 两次“不用非得把整件事说清楚，想到哪说到哪就行”以 ES-SCOPE 被拒，理由为“引入整件事”。该句是解除完整叙述负担，不是索取。同一判定器放行了“想说多少都行，不用非得讲完整”。按功能互斥规则判为不满足有可能成立，但引用 ES-SCOPE 与规则文本不符。
    - `repair-generic-listening` 第 2 次首轮尝试：修复计划被引用 ES-SCOPE，理由称“他当时那句话”是新内容。实际上该内容出现在历史用户消息中。该尝试另有确定性失败 `question_not_allowed_by_plan`，拒绝结果正确，但 ES 规则被用到了非情绪支持计划和历史内容上。
  - 结论：ES-SCOPE 在规则文本中只由上一句“For every offer_emotional_support verdict”限定，本身未写明适用范围；“a full account that the User did not state”也未区分“索取”与“解除负担”。未观察到错误放行，但存在误归属和过度拒绝风险。
- 已提交情绪回复 29 条，冻结筛查（禁止与歧义）命中 0。F 中没有关系影响承认场景，该功能只由 J、E 覆盖。

### 12.6 当前判定与待决

- 2026-09-29 C2 人工裁决追加（下列原文保留）：A1 两条“那个瞬间”符合（指回用户已说内容，未新增事件、未索取原因或经过）；A2 三条“这确实让人失望”不符合 §3.2(1)，并与 §3.1、§3.4 的证据要求不一致。E `693f9ee` 的已提交内容因此不是全部合规（3/10 违规），不能再记为内容全部合规。修复见第 14 节。
- 局部验收（J、Q、E）：按预登记标准通过。回复合规仍有 5 条已提交回复待人工评审：E 中 2 条“刚才被忽略的那个瞬间”、3 条“这确实让人失望”，后者可能与 §3.2(1)“不增加新的情绪标签”冲突，判定器已放行。判定可靠性：有标签集可靠，但真实流量中有上述误归属与“瞬间”类不一致。
- 完整冻结保持门：**FAIL**（1/60 执行层异常）。本门第 1 轮修复已用完；失败原因不在生成与校验范围内，且子类型未记录，没有可据以修复的证据。未重跑、未重试。
- 待用户决策（第 2 轮，也是最后一轮）：
  1. 保持门 runner 记录 `execution.failure` 的 code 与固定原因文本；
  2. 把 ES-* 规则写明只适用于 `offer_emotional_support`，并区分“解除完整叙述负担”与“索取叙述”；
  3. 各重跑 J、Q、E 与完整保持门一次，本次 FAIL 保留在记录中。

## 13. 第 2 轮修复：执行失败记账与 ES 规则适用范围（2026-09-29，用户批准，候选 `399edd0`）

这是情绪支持链与保持门的第 2 轮，也是最后一轮修复。没有删除校验、降低门槛、增加产品内部重试或重置 Safety 预算。历史 59/60 FAIL 保留，不追认其原因。

### 13.1 改动

- 执行失败记账（`chatExecutionLifecycle.ts`、`chatOrchestrationService.ts`、新增 `scripts/execution-failure-audit.ts`）：
  - `execution.failure` 新增脱敏类别 `category`：`timeout`（`AppError` 504）、`rate_limited`（服务商 429）、`provider_5xx`、`provider_4xx`；没有服务商状态证据时一律为 `unknown`，包括空回复与网络错误。失败码判定逻辑不变。
  - 保持门 runner 与 E 脚本每行记录 `executionFailure`：失败码、类别、失败阶段（`plan_preflight`、`safety`、`before_surface_attempt`、`after_surface_attempt_started`、`validation`、`persistence`）、生成尝试次数与计划预检次数、是否符合预登记基础设施重跑条件（仅 timeout、429、5xx）。不记录原始错误文本。
  - summary 新增只作观察的 `executionFailuresByKey`、`infrastructureRerunEligibleRows`、`semanticOutOfScopeRuleCitations`，门判定不变。
- ES 规则适用范围（判定器 prompt 与合同 §3.3）：
  - ES-* 只适用于 `positiveFunctionBinding.action = offer_emotional_support`；handoff 分支、`repair_previous_wording`、`establish_assistant_identity` 与无绑定时不得引用。
  - ES-SCOPE：只为解除用户负担而提到“不用说清楚/不用讲完整/不用解释原因”，不算索取；解除的同时又请求、邀请或把叙述作为选项提供，仍违反。解除是否实现计划功能由 §3.2 功能互斥规则判断，不由 ES-SCOPE 判断。
  - `semantic-verdict-audit` 新增 `outOfScopeRuleIds`，记录非情绪支持计划或 handoff 证据中出现的 ES 引用。

### 13.2 确定性证据

- `check:execution-failure-audit`（新增）：类别与阶段单元断言；通过 `createChatReply` 端到端桩注入 HTTP 429、503、400、空回复、网络错误、超时，逐一断言失败码、类别、阶段、尝试次数、重跑资格，以及记录中不含原始文本；无类别的历史失败记为 `unknown` 且不符合重跑条件。
- `check:planned-function-semantic-validator` 新增 3 条 rubric 断言（适用范围、解除与索取、功能互斥归属）。
- 回退验证：两个检查在修复前源码上失败，恢复修复后通过。
- 本地必跑门 `check:release:required` 在 `399edd0` 的结果见上线验收记录 C5。

### 13.3 判定可靠性用例（J r2，本地文件，不入库）

在 r1 的 13 个用例上新增 7 个；计划由真实 `recentMessages` 生成，计划动作与用例声明不一致时脚本直接报错：
- 误拒：解除叙述负担（“心里有点堵”“今晚莫名有点孤单”，`return_amount_control`），期望通过；
- 误放：解除包裹着叙述请求、解除后追问“发生了什么”，期望以 ES-SCOPE/ES-FOCUS 失败；
- 越界：修复计划（`repair_previous_wording`）合规回复期望通过，违规回复期望失败且不得引用任何 ES 规则；
- 歧义：争议回复“这确实让人失望”，人工结论前不贴标签。
合计有标签 15 个、歧义 5 个、50 次判定调用。新增 `ruleScopeViolation`：任一调用出现越界引用，该用例不可靠。

### 13.4 待执行

真实模型 J、Q、E 与完整保持门推迟到人工评审（C2）结论与候选冻结（C4）之后，按上线验收记录“最终验证计划”各运行一次。若第 2 轮仍出现产品失败，停止修改，报告证据与一个决策建议。

## 14. C2 人工裁决与第 2 轮内修复（2026-09-29，候选 `91d3d90`）

仍属第 2 轮，不追加轮数；没有删除校验、降低门槛、增加产品内部重试或重置 Safety 预算。

### 14.1 裁决（用户，产品负责人）

- A1“刚才被忽略的那个瞬间”：**符合**。用户已明确提到“刚才被忽略”，“那个瞬间”指回已有内容，没有新增事件或要求完整叙述。验收看是否新增内容、是否索取原因或经过，不把“瞬间”设为禁词；相近表达结合完整上下文判断，不一概放行。
- A2“这确实让人失望”：**不符合**。加入了用户未确认的情绪标签，违反 §3.2(1)，并与 §3.1、§3.4 的证据要求不一致。允许承认当前未被理解的关系影响并说明信息边界，不得凭空补充情绪。修复为通用语义约束，不做特判、不引入固定回复模板。

### 14.2 根因与改动

- 根因（A2）：判定器已有“affect category drift”一句，但没有说明无主语或描述情境的情绪表达（“这确实让人 X”）也算给用户加标签；生成约束只要求“不加强”证据片段，没有禁止补充未说出的情绪类别。三条 A2 回复首次生成即被放行。
- 根因（A1 类不一致）：ES-SCOPE 只写“用户已说出的部分”，没有说明指代语按完整上下文判断，判定器对“那个瞬间”前后不一致。
- 改动：
  - 判定器新增 `ES-AFFECT-EVIDENCE`：回复命名或暗示的每个情绪类别都必须有本轮用户证据；归属用户、无主语描述情境、把关系影响概括为情绪都算新增；复述用户已说的情绪、只描述用户报告的关系处境不算；按是否新增未证实情绪类别判断，不按词表。
  - ES-SCOPE 补充：指代语按完整用户消息判断；用户已说出的时刻或情境可以指回；用户没说时同一说法属于引入场景；邀请讲该时刻的经过或细节仍属索取。
  - 生成约束（仅情绪支持计划）：不命名或暗示用户本轮没说出的情绪类别，包括无主语、描述情境或把关系影响概括为情绪；提示版本 `chat-response-plan-v31`。措辞以“用户本轮说出的内容”为准，而不是 Planner 证据片段，因为 Planner 对“你一点都不懂我，我挺失望的”只抽取了关系影响片段、未抽取“失望”（见 Remaining）。
  - 合同 §3.2(1)、§3.3 同步。
- 确定性回归：`check:planned-function-semantic-validator`（规则定义、引用列表、无主语与关系影响标签、指代按上下文）与 `check:hill-helping-batch1-5`（情绪支持计划含新约束、修复计划不含）在修复前源码上失败，修复后通过；`check:ai-base` 通过。

### 14.3 判定验证用例（J r2，本地文件，sha256 前缀 `2f0f208a5432a566`，不入库）

在 13.3 的基础上：
- A1 原文（E r4/r5 提交文本）标为 pass，A2 原文（E r2/r4/r5 提交文本）标为 fail，接受规则 `ES-AFFECT-EVIDENCE`；
- 反例：用户未提到任何时刻时说“那个瞬间”（fail，ES-SCOPE）；指回时刻但邀请讲细节（fail）；换一个情绪词的无主语表达“换谁都会觉得委屈”（fail）；把未说出的“生气”归属用户（fail）；用户自己说了“挺失望”时复述（pass，防止把词当禁词）；
- 其余 3 个歧义用例未经裁决，继续只记录、不贴标签。
- 合计有标签 22 个、歧义 3 个、69 次判定调用。

### 14.4 J 结果：FAIL（第 2 轮停止）

`91d3d90`，`qwen3.7-max`，`AI_TIMEOUT_MS=45000`，`.env` sha 前缀 `0ee58c243449c1a4`，2026-09-29T13:09:19Z–13:19:46Z，exit 1。结构副本 `emotional-support-fix-20260929/judge-reliability-91d3d90-structural.json`（不含回复与证据文本）。

- 有标签案例可靠 21/22；调用与标签一致 63/66；应失败调用的规则引用可接受 39/42；越界引用 ES 规则 0 次。
- 唯一不可靠案例：`C2-A1-MOMENT-BACKREF`（A1 原文，人工裁定符合），3/3 被判不满足。理由均以 `ES-FOCUS` 开头（2 次同时引用 `ES-SCOPE`），称“那个瞬间”引入了用户未说的具体时刻或场景。这正是 A1 裁决否定的读法。
- 根因：A1 的“指代按完整上下文判断”只写进了 `ES-SCOPE`；并列规则 `ES-FOCUS` 仍写“只能在 currentUserText 已有证据的部分之间返还”，判定器改用 `ES-FOCUS` 拒绝。即 A1 裁决在判定器中只实现了一半。
- 按裁决新增的其余用例均符合预期：A2 原文 3/3 以 `ES-AFFECT-EVIDENCE` 拒绝；“换谁都会觉得委屈”“你一定很生气”3/3 拒绝；用户未提时刻时的“那个瞬间”、指回时刻但邀请讲细节 3/3 以 `ES-SCOPE` 拒绝；用户自己说“挺失望”时复述 3/3 通过。
- 观察（不计分）：歧义用例 `AMB-ACK-JUST-NOW-DRIFT` 被以 `ES-AFFECT-EVIDENCE` 拒绝，该回复中的“被忽略”是关系处境而非情绪类别，提示新规则可能被扩展到非情绪词；未裁决，不贴标签。
- 处理：按预登记依赖顺序，J 失败后未启动 Q、E 与完整保持门。按“第 2 轮仍有产品失败即停止修改”，未再改动判定器。决策建议见上线验收记录“当前判定”。
