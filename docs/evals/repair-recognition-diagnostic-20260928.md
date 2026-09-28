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
