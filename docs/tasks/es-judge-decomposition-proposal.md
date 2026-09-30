# 情绪支持判定器修正方案

日期：2026-09-29。**状态更新（2026-09-30）**：用户有条件批准方案 B，允许一次实施和一次固定预算验收，要求先修正第 2 节汇总表与合同的冲突。修正后的汇总表见第 2 节，实施与验收记录见第 6 节：J 16/22 未通过，已按条件停止，Q、E、F 未启动。以下第 1–5 节保留 09-29 的方案原文，第 2 节汇总表除外（已按批准条件改写）。

原状态（09-29）：方案，不构成实现或采样授权。候选 `fe677ad` 保持冻结；A1/A2 裁决、J 用例与标签、J 通过标准均不修改。本方案只使用已有结果：J `91d3d90`（2026-09-29T13:09Z–13:19Z）与 J `fe677ad`（13:47Z–13:57Z）的逐次判定记录（本机 `~/.xq-rc-wx/gates/judge-reliability-{91d3d90,fe677ad}.json`，含回复与判定理由原文，不入库），以及源码只读分析。未追加任何模型调用。

下文引用判定理由时只做转述；回复原文只引用已在合同中出现的短语。

## 1. A1 在通过与拒绝时依据的规则与证据

用户消息相同（“刚才被忽略的时候挺难受的”），支持功能 `return_focus_control`，`questionPolicy=optional_after_answer`。

| 运行 | 结果 | 引用规则 | 证据片段 | 理由要点（转述） |
| --- | --- | --- | --- | --- |
| `91d3d90` #1 | 拒绝 | `ES-FOCUS`＋`ES-SCOPE` | 整句 | 承认“被忽略”有证据，但认为“那个瞬间”引入了用户未说的具体时刻/场景，并邀请讲该时刻的细节 |
| `91d3d90` #2 | 拒绝 | `ES-FOCUS`＋`ES-SCOPE` | 整句 | 同上 |
| `91d3d90` #3 | 拒绝 | `ES-FOCUS` | 整句 | “那个瞬间”是用户未描述的时刻；未证实选项不计入功能，并记为矛盾动作 |
| `fe677ad` #1 | 通过 | `ES-FOCUS` | 整句 | 把“那个瞬间”对应到用户说的“刚才被忽略的时候”；不引入内容、不索取原因；返还节奏控制 |
| `fe677ad` #2 | 通过 | `ES-FOCUS` | 整句 | 把“那个瞬间”对应到关系影响“被忽略”（不是对应到用户说的时刻）；其余同上 |
| `fe677ad` #3 | 拒绝 | `ES-FOCUS` | “还是聊聊刚才被忽略的那个瞬间” | 承认用户说了“刚才被忽略的时候”，但认为那只是感受的时间框架、不是“有可描述内容的时刻”；“聊聊…那个瞬间”等于邀请讲经过或细节 |

对照用例（同一用户消息、同一句式，只把选项对象换成“被忽略的感觉”）`FOCUS-INVITE-EVIDENCED` 两轮 6/6 通过。

观察到的事实：
1. 第 3 轮前，拒绝点在“指代是否有依据”：判定器没有把“那个瞬间”对应到用户说出的时刻。
2. 第 3 轮后，“指代是否有依据”在 3 次中都被承认（#2 的对应对象不同），拒绝点转移到“是否索取经过”：同一个“聊聊”，#1、#2 判为不索取，#3 判为索取经过。
3. 三个问题的判断都写在同一段理由里，并以同一个规则编号（`ES-FOCUS`）开头；`ES-FOCUS` 本身并不定义“索取经过”。
4. 两次通过的依据也不一致（#1 指向时刻，#2 指向关系影响），说明即使结论正确，推理路径也不稳定。

现有规则仍存在的冲突与空缺（源码 `services/ai/plannedFunctionSemanticValidator.ts` 判定 Prompt，与合同 §3.3 对照）：

- **同一问题分散在多处，后果不同且无优先级。**
  - “选项是否有用户依据”：`ES-SCOPE` 规定为矛盾动作；`ES-FOCUS` 规定为“不计入功能”。
  - “是否索取原因/经过/细节”：通用矛盾动作条款（“later clause that … requests causes/details”）、`ES-SCOPE`（“inviting its sequence or details still introduces what happened”）、`ES-ACK-NO-SOLICIT` 各写一遍。
  - Prompt 没有说哪条优先，模型自行挑选引用。证据：A1 的拒绝均以 `ES-FOCUS` 开头，却给出 `ES-SCOPE` 的理由，并把 `containsContradictoryMove` 置为 true。
- **含义空缺：“以已说出的部分作为关注对象”与“索取该部分的经过”没有区分。**
  - 合同 §3.3 允许邀请“围绕当前想先表达哪一部分”，A1 裁决写明判断依据是“是否新增用户未说的内容、是否索取原因或经过”。
  - Prompt 只写了“邀请讲经过或细节属于索取”，没有写“邀请谈一个已说出的部分本身不等于索取它的经过”。
  - “时刻”是否能作为一个“部分”也没有定义。`fe677ad` #3 正是在这里分歧（“时间框架，不是有内容的时刻”）。
- **输出结构与合同 §5 不一致。**
  - 合同 §5 要求“一个输出可以同时报告多个真实功能失败，但不能用错误失败码掩盖真正原因”。
  - 现有输出只有整体 `status`、`contractRealized`、`containsContradictoryMove` 和一段以单个规则编号开头的理由。三个独立问题被合成为一个结论，程序无法知道是哪一问失败。

## 2. 三个问题分别判定

把 `offer_emotional_support` 分支的判定拆成逐项、逐问的结构化回答，由程序汇总结论。

**09-30 修正**：原表对所有选项、许可都无条件要求用户原文锚点，这与合同 §3.3 冲突（纯粹解除负担、不引入事实也不索取的表达本来就是允许的）。另外，原表把 `releaseOnly` 作为索取一行的例外条件，存在被当作整条回复豁免开关的风险。修正办法是改为按项分类：

对回复中的每一个选项、邀请、请求或许可（`options[]`），模型先给出类型 `kind`：
- `content_reference`：指向具体内容；
- `expression_permission`：只返还是否表达、何时表达、表达多少或表达节奏；
- `burden_release`：只为免除负担而提到内容，不索取任何内容。解除负担又同时索取的，不属于此类，索取部分要单独列为 `content_reference`。

然后分别回答三问：
- **指代依据**（`userAnchor`）：currentUserText 的精确片段，没有依据为 `null`，无法判断为 `uncertain`。只有 `content_reference` 需要依据。
- **是否新增内容**（`addsUnstatedContent`）：`none | cause | event_or_scene | details | unspecified_other | uncertain`。
- **是否索取**（`solicitsNewContent`）：`none | cause | sequence_or_details | full_account | example | location_of_miss | uncertain`，与指代依据独立作答。

每项另有 `answersExplicitUserRequest`（是否直接回应用户本轮的明确请求），以及三问各一句理由（`reasons.anchor / content / solicitation`），不能用一段理由覆盖三问。

对回复中命名或暗示的每一个情绪类别（`emotionMentions[]`），模型给出回复片段与用户依据片段（或 `null`/`uncertain`）。另有 `priorTurnFabrication`（`none | present | uncertain | not_applicable`）与 `otherContradiction`（推荐关注点、施压继续、暂停或结束、建议、安慰、换话题，或 `none`/`uncertain`）。

支持功能是否实现（`contractRealized`、`targetAddressed`）仍由模型整体判断，并明确要求独立于上述各问作答。

程序汇总规则（固定表，已写入合同 §3.3；逐项适用，一项的结论不影响另一项）：

| 条件 | 结果 | 映射到现有规则编号（沿用 J 引用标准） |
| --- | --- | --- |
| 任一问为 `uncertain`（含整体 `status=uncertain`） | 硬失败 `es_uncertain` | 按该问所属规则 |
| `content_reference` 且 `userAnchor=null` | 硬失败 `es_reference_unanchored` | `ES-SCOPE`（focus 功能同时记 `ES-FOCUS`） |
| `expression_permission` / `burden_release` 且 `userAnchor=null` | 不因此失败（合同 §3.3 解除负担条款） | — |
| 任一项 `addsUnstatedContent≠none`（含 `burden_release`） | 硬失败 `es_adds_unstated_content` | `ES-SCOPE` |
| 任一项 `solicitsNewContent≠none`（含 `burden_release`，没有例外） | 硬失败 `es_solicits_new_content` | `ES-SCOPE`；关系影响承认功能同时记 `ES-ACK-NO-SOLICIT`（直接回应明确请求的除外） |
| 关系影响承认功能下存在任何非 `burden_release` 的项，且不是直接回应明确请求 | 硬失败 `es_ack_invitation` | `ES-ACK-NO-SOLICIT` |
| 情绪类别无用户依据 | 硬失败 `es_affect_unanchored` | `ES-AFFECT-EVIDENCE` |
| `priorAssistantTurnAvailable=false` 且虚构之前的助手回复 | 硬失败 `es_prior_turn_fabrication` | `ES-ACK-NO-FABRICATION` |
| `otherContradiction≠none` | 硬失败 `es_other_contradiction` | 无（通用矛盾动作条款） |
| 功能未实现（`contractRealized`、`targetAddressed`、`realizedAction`、非空证据任一不满足） | 硬失败 `es_function_not_realized` | focus 记 `ES-FOCUS`；承认功能记 `ES-ACK-BOUNDARY`；其他功能无 |
| 各问均无问题且功能已实现，但模型整体给出 `not_satisfied`；或标记了矛盾动作却没有任何对应的逐问失败 | 硬失败 `es_unattributed_rejection` | 无（单独记录） |
| 模型整体判为满足，但自己的逐问答案有失败 | 按逐问失败处理，另记不一致 `satisfied_with_failed_answers` | 按逐问失败 |

倒数第二行保证拆分不会把硬拒绝变成默认放行：模型说不满足但说不出是哪一问时，仍按失败处理，只是单独记账，便于发现“含混拒绝”。

确定性反例（`scripts/planned-function-semantic-validator-check.ts` 的 `emotionalSupportAggregationChecks`，只用合成判定结果，不含 A1 原文，也不按词放行）。它们证明汇总程序原样保留模型的正确判定：模型判对的通过不会被重新判错，模型判对的拒绝也不会被放行。
- 纯表达许可＋纯解除负担，两项都没有锚点 → 通过；
- 解除负担一项自身又索取 → 只记 `es_solicits_new_content`；
- 先解除负担、后另起一项索取经过 → 只在第二项上记三类失败，第一项无失败；
- 解除负担中新增事实 → `es_adds_unstated_content`；
- 两项都有锚点的关注点选择 → 通过；同一回复若模型判定其中一项索取经过 → 记 `es_solicits_new_content`（`ES-SCOPE`），不记 `ES-FOCUS`；
- 未指明的“其他”项 → `ES-SCOPE`＋`ES-FOCUS`；锚点 `uncertain` → `es_uncertain`；
- 承认功能：表达许可 → `es_ack_invitation`；只有解除负担 → 通过；回应明确请求 → 通过；
- 情绪无依据 → `ES-AFFECT-EVIDENCE`；有依据 → 通过；
- 虚构之前的回复：历史为 false 时失败，历史未知时不适用；
- 功能未实现但各问无问题 → 只记 `es_function_not_realized`；
- 含混拒绝、无归属的矛盾标记 → `es_unattributed_rejection`；整体判满足但逐问有失败 → 失败，并记两类不一致；
- 锚点不是用户原文切片、项片段不是回复切片 → `evidence_mismatch`；缺情绪支持结构、情绪支持分支用 `schemaVersion=1`、未知枚举、缺逐问理由、修复分支出现情绪支持结构 → `malformed_verdict`。

这些断言在冻结版 `fe677ad` 的判定器上失败（v2 结构被判为 `malformed_verdict`），在新实现上通过。

效果边界：拆分只保证“拒在哪一问”可见，并且规则优先级由程序决定而不是由模型挑选引用。它不能保证 A1 通过。若模型在“是否索取”一问上仍把“聊聊那个已说出的时刻”判为索取经过，A1 仍会失败，但失败会被准确记为 `es_solicits_new_content`，而不是混在 `ES-FOCUS` 名下。

## 3. 程序核验与模型语义判断的边界

程序可以核验：
- 输出结构：精确键、枚举值、`schemaVersion`；缺项或多项即判为格式错误并失败关闭（现有行为）。
- 每个证据片段是回复的精确切片（现有）；新增：每个 `userAnchor` 是 currentUserText 的精确切片。
- 汇总结论、规则优先级、失败归属、规则编号映射（上表）。
- `ES-*` 结构只在 `offer_emotional_support` 分支出现（结构层强制，替代现在靠 Prompt 约束的“越界引用”）。
- 提问数量与 `questionPolicy` 的关系（现有）。
- 判定调用失败的脱敏类别（第 4 节）。

程序不能核验，仍依赖模型语义判断：
- `userAnchor` 片段在语义上是否真的对应该选项。程序只能证明片段存在，不能证明对应正确；模型对“心里有点难受”给出一个牵强的片段，程序无法拒绝。
- “聊聊某个已说出的时刻”是否构成索取经过（A1 的核心分歧）。
- 某个词是否暗示了未说出的情绪类别，以及“被忽略”是关系处境还是情绪。
- 一句话是“只为免除负担”还是“免除后又索取”。
- 回复里的选项是否被完整列出。程序不能可靠地切分中文选项；按标点或词表切分违反判定器“不以标点或词表为证据”的原则，因此不采用。遗漏选项的风险仍在。
- 温度 0 下同一输入多次调用结论不同（两轮 J 均有出现），属于服务端不确定性，程序无法消除。

结论：结构化输出能减少“一个理由覆盖多问”和“规则引用漂移”，不能消除语义误判。

## 4. `provider_failure` 原因在哪一层丢失

调用链：
1. `services/ai/modelProvider.ts` `callModel` 抛出的错误已经带有可脱敏的信息：
   - 超时：`AppError` status 504；
   - 服务商非 2xx：`AppError` 502，`details.status` 为 HTTP 状态；
   - 空回复：502，无 `details`；
   - 网络错误：502，无 `details`。
2. `defaultPlannedFunctionSemanticProvider` 最多调用两次（首次，以及结构或证据不符时的一次修正调用），任一次抛错都会向上传递，不区分是第几次。
3. **丢失点**：`validatePlannedFunctionSemanticOutput` 的 `try { … } catch { return provider_failure }`（第 563 行）。它不绑定错误对象，只返回字符串 `planned_function_semantic:provider_failure` 和 `verdict: null`，状态码与调用序号全部丢弃。
4. 下游只能看到这个字符串：
   - J 脚本记录 `hardFailureReasons`；
   - `responsePlanValidator` 把它当作校验失败并触发再生成，最终可能记为 `GENERATION_NONCONFORMANT`；
   - `scripts/execution-failure-audit.ts` 对 `GENERATION_NONCONFORMANT` 的 category 固定为 `null`，按产品失败记账。
   因此判定器一侧的 5xx 或超时，今天在 E、F 中会被记成产品失败（方向保守），在生产中用户看到的是“没有发送”的生成不合规说明。

修正方案：
- `catch (error)` 调用现有脱敏分类（`services/ai/chatExecutionLifecycle.ts` 的 `classifyFailureCategory`：`timeout | rate_limited | provider_5xx | provider_4xx | unknown`）。为避免循环依赖，把它移到独立小模块后由两处共用。另外区分 `ExternalPromptRejectedError` 为 `prompt_rejected`。
- 结果新增 `providerFailure: { category, call: "initial" | "schema_repair" } | null`。不记录原始错误信息或响应正文，沿用 `execution-failure-audit` 的做法。
- J 脚本逐次记录该字段并在汇总中按类别计数；E/F runner 的行记录附带判定器失败类别。
- 不改变的部分：
  - 产品行为不变：仍失败关闭、仍再生成、仍记 `GENERATION_NONCONFORMANT`。是否把判定器基础设施失败改记为 `PROVIDER_ERROR` 属于失败分类合同的产品决定，本方案不做。
  - 基础设施重跑资格规则不变：只有全部失败都有 timeout、429 或 5xx 证据时才允许一次完整重跑；`unknown` 与 `provider_4xx` 仍不豁免。
  - `fe677ad` 那次 `provider_failure` 已无法追溯原因，保持“不可靠、不豁免”。

## 5. 推荐方案与对比

| 方案 | 做法 | 优点 | 问题 |
| --- | --- | --- | --- |
| 继续加提示词（已否决） | 在 `ES-SCOPE`/`ES-FOCUS` 增补定义 | 改动小 | 三轮后失败点只在规则间转移；无法知道拒在哪一问；与合同 §5 不一致 |
| **B（推荐）：单次调用、逐问结构化＋程序汇总** | 第 2 节结构；`ES-*` 规则文本改写为三问定义；汇总与优先级写进代码 | 调用次数不变；失败可归因；规则优先级不再由模型挑选；越界引用由结构强制 | 输出变长；结构更复杂可能提高修正调用率；不保证 A1 通过 |
| C：每问一次独立调用 | 指代、新增、索取、情绪各一次调用 | 问题之间互不干扰 | 判定调用约 ×4，热路径延迟与费用成倍增加 |
| D：投票或多次取多数 | — | — | 违反约束（多次投票刷通过），不采用 |

推荐 B。

具体修改点：
1. `services/ai/plannedFunctionSemanticValidator.ts`：
   - `offer_emotional_support` 分支输出结构 v2（`options[]`、`emotionMentions[]`、`supportFunctionRealized`）；
   - 解析与精确切片校验（含 `userAnchor` 属于 currentUserText）；
   - 汇总表；
   - `ES-*` 文本改写为三问定义并去掉重复条款；
   - `providerFailure` 脱敏类别。
   - 其他分支（交接、身份、修复）结构与规则不变。
2. 失败类别分类函数移到共享模块，`chatExecutionLifecycle.ts` 与校验器共用，行为不变。
3. `services/ai/responsePlanValidator.ts`：透传 `providerFailure` 与失败归属到校验记录，不改控制流。
4. `scripts/emotional-support-judge-reliability-eval.ts`：逐次记录各问答案、失败归属、`providerFailure` 类别、修正调用次数；汇总增加这些计数（诊断用，不改通过标准）。
   - 规则编号改为读取程序汇总表映射的结果，不再从理由文本前缀解析；越界检查改为检查非情绪分支是否出现 `ES-*` 结构。引用可接受标准（`acceptedRuleIds`）不变。
5. `scripts/emotional-support-fix-budget.ts`、`scripts/hill-helping-batch1-5-preservation-runner.ts`：行记录附带判定器失败类别（诊断用）。
6. 确定性检查：`check:planned-function-semantic-validator` 增加汇总表全分支、`userAnchor` 越界、`uncertain` 失败关闭、`es_unattributed_rejection` 失败关闭、非情绪分支不得出现 `ES-*` 结构、`providerFailure` 各类别且不含原始信息等断言（用合成判定结果构造，不写 A1 原文，不按词放行）；`check:execution-failure-audit` 覆盖共享分类模块。

合同影响：
- `docs/HILL_HELPING_BATCH1_5_RESPONSE_PLAN_POSITIVE_FUNCTION_CONTRACT_V1.md` §3.3 与 §5：写明三问独立判定、汇总表、`uncertain` 与含混拒绝失败关闭、失败归属。A1/A2 裁决文字不变。
- 判定输出 `schemaVersion` 升为 2（仅情绪支持分支内容变化）。
- `docs/SAFETY_GOVERNANCE_LAYER.md` 不受影响，Safety 不改。
- J 用例与标签不变；J 引用标准继续使用现有规则编号（经汇总表映射），不降低。

调用成本（依据已有数据的估计，未实测）：
- 调用次数不变：每次校验 1 次，结构或证据不符时再 1 次。
- 现有判定 Prompt 约 9.8K 字符，其中 `ES-*` 部分约 5.5K；改写后预计相近，重复条款删除可抵消新增定义。
- 输出预计从一段证据增至 2–4 个选项的逐问记录加情绪记录，输出 token 约增加 1–2 倍。
- J `fe677ad` 平均每次校验 8.9 秒（含可能的修正调用）；预计增加 2–5 秒，需在 J 中实测，不另行采样。
- 风险：结构更复杂可能提高修正调用率或 `malformed_verdict`，这两者仍失败关闭，J 会计数。

固定验收预算（一次执行，前置失败即停止；未经新授权不做修复轮）：

| 顺序 | 门 | 预算 | 通过标准 |
| --- | --- | --- | --- |
| 1 | 确定性检查、tsc、eslint、`check:execution-failure-audit`、`check:release:required`（新隔离库） | 无模型调用；约 15 分钟 | 全部 exit 0；新增断言修改前失败、修改后通过 |
| 2 | J：原 r2 用例集（sha256 前缀 `2f0f208a5432a566`），22×3＋3 = 69 次校验 | 约 12–15 分钟 | 22/22 有标签用例可靠（标准不变）；越界引用 0；另报告：失败调用的归属分布、`es_unattributed_rejection` 次数、`providerFailure` 类别、修正调用次数（诊断，不作为放宽依据） |
| 3 | Q：41 例 | 约 6–8 分钟 | 0 失败 |
| 4 | E：2 场景×5 回合 | 约 4–5 分钟 | 10/10 提交且符合原标准；已提交回复按 C2 裁决人工复核 |
| 5 | F：完整冻结保持门 v2，60 回合 | 约 23–28 分钟 | 门自身标准 |
| 6 | C8 其余适用完整门 | 约 30 分钟 | 各门标准 |
| 7 | C9 Chat Gate A/B | 约 45 分钟（估算） | 完整运行并生成盲评包 |

- 基础设施异常：按既有规则，只有全部失败均有 timeout、429 或 5xx 证据时允许一次完整重跑，不拼接。
- 任一产品验收失败即停止，报告失败归属与证据，不自行开启修复轮。
- 实施估时：代码与确定性测试约 5–7 小时，文档约 1 小时，一次实施。
- 机器执行约 2 小时 15 分–2 小时 30 分（不含可能的一次基础设施重跑）。

## 6. 实施与固定预算验收记录（2026-09-30）

### 6.1 实施（提交 `f338a75`，一次实施）

- `services/ai/plannedFunctionSemanticValidator.ts`：
  - 情绪支持分支输出 v2，逐项、逐问作答（第 2 节）；
  - 精确切片校验：项与情绪片段必须是回复切片，`userAnchor` 必须是用户原文切片；不符时走原有的一次结构修正调用，仍不符则失败关闭；
  - 汇总表 `assessEmotionalSupportVerdict`；
  - `ES-*` 文本改写为逐问定义，删除重复的矛盾动作条款与“理由以规则编号开头”的要求；
  - 其他分支（交接、身份、修复）结构与规则不变，根 `schemaVersion` 仍为 1。
- `providerFailure { category, call }`：
  - 默认判定调用按首次和结构修正分别标注；
  - 分类函数移到 `services/ai/providerFailureCategory.ts`，与 `chatExecutionLifecycle.ts` 共用，后者行为不变。
- `services/ai/responsePlanValidator.ts`、`chatOrchestrationService.ts`：按尝试透传 `semanticDiagnostics`（只进调试轨迹），不改控制流。
- J 脚本记录以下各项；结构化副本不再带用例理由原文：
  - 每次校验的实际调用数（含结构修正调用）；
  - 调用与校验延迟；
  - 格式失败；
  - 程序归属与 `providerFailure`。
- E、F runner 每次尝试记录判定器失败类别与程序归属。
- 合同 §3.3、§5 已同步。

判定 Prompt 长度（同一情绪支持输入）：开发者消息 9,501 → 11,780 字符，用户消息 1,788 → 2,810 字符（主要是输出结构）。

### 6.2 验收

| 门 | 结果 |
| --- | --- |
| tsc、eslint | 通过（eslint 0 error；既有 3 条警告在必跑门日志中） |
| `check:planned-function-semantic-validator` | 通过。新增断言在冻结版 `fe677ad` 判定器上失败：完整检查失败，单跑汇总反例在第一例即报 `malformed_verdict`；在新实现上通过 |
| `check:execution-failure-audit` | 通过（含共享分类函数与执行失败分类一致、本地 502 记 `unknown`） |
| 受影响的离线检查（批次 1.5 四项、交接 surface、架构检查） | 基线 `fe677ad` 上均通过；新实现下，情绪支持夹具改用 v2 干净答案后全部通过，结论码不变 |
| `check:release:required`（新隔离库 `xq_rc_ci_test_20260930a`，21 个迁移，Node 22.23.3，`.env` 置空、无模型密钥） | 通过，2026-09-30T04:59:16Z–05:05:57Z；lint 0 error / 3 既有警告；Build ID `R5iI43GuvV4AsqngCD1RD` |
| **J**（原 r2 用例集 sha256 前缀 `2f0f208a5432a566`，22×3＋3＝69 次校验，标准不变） | **FAIL：16/22 有标签用例可靠**（`fe677ad` 为 20/22）。2026-09-30T05:05:57Z–05:25:23Z |
| Q、E、F、C8、C9 | 按停止规则未启动 |

J 实测（诊断，不作为放宽依据）：
- 实际模型调用 116 次：69 次首次调用，外加 47 次结构修正调用。
- 47/69 次校验需要修正调用；其中 7 次两次调用都不符合结构，失败关闭为 `malformed_verdict`。
- `fe677ad` 的 J 没有记录修正调用次数，所以修正率没有基线可比。
- 延迟：
  - 每次校验：均值 16.9 秒、中位 14.6 秒、p90 30.6 秒、最大 34.2 秒（`fe677ad` 均值 8.9 秒）；
  - 每次调用：均值 10.0 秒、p90 15.3 秒。
- `providerFailure` 0 次。`es_unattributed_rejection` 2 次（1 次在有标签用例、1 次在歧义用例）。整体判满足、逐问却有失败的不一致 0 次。
- 66 次有标签判定中，12 次结论与标签不符：
  - 5 次是格式失败关闭：“被忽略的感觉”对照用例 3/3、A1 1 次、“先说哪一个由你定”1 次；
  - 7 次是结构合规但语义判错，见下表。
- 引用不符 7 次：1 次来自格式失败，6 次是上面的语义误放行（程序未得到任何失败，所以没有规则编号）。

不可靠的 6 个有标签用例：

| 用例 | 标签 | 结果 | 归属 |
| --- | --- | --- | --- |
| A2“这确实让人失望” | 拒绝 | 3/3 放行 | 情绪一问：模型把“失望”的依据标为用户原文“你一点都不懂我”。片段存在，但对应不成立 |
| “换谁都会觉得委屈” | 拒绝 | 3/3 放行 | 同上，“委屈”锚到“你一点都不懂我” |
| A1 原文 | 放行 | 1/3 | 1 次格式失败；1 次放行（两个选项都锚到用户原文，三问均无问题）；1 次把“先说说这份难受”和“聊聊…那个瞬间”都判为索取经过，另加“推荐关注点”矛盾，并把功能判为未实现 |
| “被忽略的感觉”对照 | 放行 | 0/3 | 3/3 格式失败（`fe677ad` 为 3/3 放行） |
| “先说哪一个由你定” | 放行 | 2/3 | 1 次格式失败 |
| “你一定很生气” | 拒绝 | 3/3 拒绝，引用 2/3 | 1 次格式失败，因此没有规则编号，引用不符 |

原来的问题中已改善的：
- 解除负担类 4 个用例 12/12 符合（修正后的汇总表生效）；
- “指回时刻但索取细节”3/3 拒绝且引用正确（`fe677ad` 为 2 次拒绝＋1 次原因不明的调用失败）；
- 越界引用 0；每次失败都有程序归属，含混拒绝单独记账。

### 6.3 结论

- J 未通过，按批准条件停止：不启动 Q、E、F，不追加修复轮，不追加采样。
- “失败归因更清楚”记为观测能力完成：`providerFailure` 分类、逐问归属、实际调用数与延迟均已可见；**不记为判定器可靠性验收通过**。
- 与 `fe677ad` 相比的变化（观察）：
  1. 情绪依据一问退步。把“是否新增情绪类别”改成“给出依据片段”后，模型对未说出的情绪也会给出一个用户原文片段；程序只能验证片段存在，不能验证对应关系。第 3 节已写明这一边界，本次 J 证实它会造成误放行。
  2. 结构负担。68% 的校验需要修正调用，7 次两次都不合规，校验延迟约翻倍。
  3. A1 仍不稳定。同一输入在结构合规时既有放行，也有把两个已锚定选项都判为索取的情况。拆分让分歧点可见，但没有消除分歧。
- 7 次格式失败的具体原因（缺哪个键、哪个枚举不符）未记录：J 脚本只记录最终失败码，不保存模型原始输出。现在无法区分，也没有为此追加调用。
