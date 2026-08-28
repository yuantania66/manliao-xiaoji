## Late-Contradiction Authority v1 补充（2026-08-24）

冻结的 41-case 门在原 canonical gate 两轮修复后停于 40/41；唯一 `dual-positive-only` 失败由新的 eval-only `Late-Contradiction Authority v1` 处理，而非第三轮 Prompt/case 补丁。该权威以候选内有序 Surface acts 判断“已完成首次接触 ritual 后是否在末尾重新执行同一 ritual”，版本为 `late_contradiction_v1`，合同 SHA-256 为 `bb2dde3217e3b7b32f4d6197cead9284614df6434698965cb6b993d53694b3c1`。

该权威使用 strict schema、exact binding、candidate hash、唯一 UTF-16 evidence 与先完成后重开的顺序校验；malformed、uncertain、错绑、错 evidence 和 provider failure 均 fail closed。它仅在 41-case eval runner 的 canonical dual-positive PASS 后执行并与 canonical 结果取 AND，不能翻正 canonical reject，不进入生产默认路径。完整真实 Qwen 门已达到 41/41。

## Problem

当前 `ResponsePlan` 已把正向功能冻结成一个三分支 union：`establish_assistant_identity`、`offer_emotional_support`、`repair_previous_wording`。执行层也会对首次候选和同计划 regenerate 候选调用同一个 `validateCandidate`。但是模型语义校验的入口仍由 `interactionMoveHandoffPlan` 是否存在决定，而不是由“本计划是否声明了必须完成的语义功能”决定。

这造成一个可提交旁路：合法计划可以包含 `positiveFunctionContract`，同时 `interactionMoveHandoffPlan=null`；此时确定性 Validator 只能检查名字、问号或若干词面特征，无法证明候选真正完成了首次接触入口、名字话题连续性、所选情绪支持功能或目标绑定修复。典型反例是无 handoff 的首次接触候选“我是小慢。”，以及身份连续性候选“嗯，小慢。”：它们可满足 canonical name 的确定性检查，却没有完成计划要求的正向会话功能。

本切片冻结一个结果：建立 **Planned Function Semantic Validation Boundary**。任何 `interactionMoveHandoffPlan` 或 `positiveFunctionContract` 存在的普通计划，首次候选与同计划 regenerate 候选都必须进入同一个 strict-JSON、fail-closed、same-plan 语义门；handoff 与 positive function 分别判断并取 AND。Safety、Grounding、question policy、strict parser、不可变事件提交边和 no-persistent-lifecycle-state 保持独立且不放宽。

允许范围是通用语义 Validator、`enforceResponsePlan` 的调用边、普通聊天 orchestration 的语义上下文/测试 seam、三类直接回归和相关架构合同。非目标包括重新规划、修改三类正向功能的产品定义、增加中文短语词表、增加 fallback 回复、改变 Safety 路径、改变 Planner 优先级、创建新的持久状态或提交边。

## Evidence

- `conversation-os/control/types.ts` 已定义完整 `PositiveFunctionContract` union，并把三个 action 的 mode、source/target 与证据放进冻结 `ResponsePlan`。问题不是缺少 plan contract。
- `services/ai/chatExecutionLifecycle.ts` 的 preflight 已要求 positive action 与 contract 精确匹配，并分别检查情绪证据 span、身份 continuation 的 `targetOperation=affirm` authority、repair target/mode。它证明计划结构合法，但不判断自然语言是否真正实现功能。
- `services/ai/responsePlanValidator.ts` 的 `enforceResponsePlan` 会递归冻结一次 `executionPlan`，然后让首次候选和 regenerate 候选进入同一个 `validateCandidate`；因此 same-plan、同一执行对象和最多一次 regenerate 的正确接入点已经存在，不需要新的 lifecycle。
- 同一文件的 `validateCandidate` 当前无条件调用 `validateInteractionMoveHandoffOutput`，但 `services/ai/interactionMoveHandoffOutputValidator.ts` 在 `interactionMoveHandoffPlan` 为空时立即返回 `{ passed: true }`。这是已验证的第一因果边界。
- `services/ai/chatOrchestrationService.ts` 只在 handoff 存在时查找 `sourceAssistantMoveId`，并只在找到该目标消息时构造 `handoffSemanticContext`。因此语义校验上下文在类型和调用上都依赖 handoff target；无 handoff positive function 没有独立入口。
- 当前 handoff Validator 已具备可复用的安全性质：exact-key JSON parser、同 `planId`/handoff tuple binding、UTF-16 candidate evidence slice 校验、`uncertain`/malformed/provider failure fail closed、模型提示注入隔离、semantic question count 与 contradictory move 检查。
- `scripts/conversation-os-relational-state-check.ts` 明确覆盖 `interactionMoveHandoffPlan=null` 但含 `establish_assistant_identity` 的首次接触计划；同一测试还证明 `validateResponsePlanOutput("我是小慢。")` 会通过，因为自然低压力入口被假定由 handoff semantic Validator 验收。两段证据合在一起正好复现旁路。
- 同一脚本证明 identity continuation 由相邻 committed identity claim 的 exact-bound `affirm` 授权；当前确定性层只要求候选包含“小慢”，没有语义验证“是否真的延续名字话题”。
- `scripts/interaction-move-handoff-surface-validator-check.ts` 已覆盖 strict parser、binding/evidence/provider failure、first-contact bare identity reject、同计划重试和冻结 plan；但它的 first-contact fixture 人工附带 handoff，所以没有覆盖真实的 no-handoff 分支。
- `scripts/hill-helping-batch1-5-check.ts` 和 `docs/HILL_HELPING_BATCH1_5_RESPONSE_PLAN_POSITIVE_FUNCTION_CONTRACT_V1.md` 已冻结 emotional support 四个 support function 与 repair 三个 mode 的正反例语义。当前实现主要依赖 `responsePlanValidator.ts` 内不断增长的中文正则来近似这些功能，既不能成为自然语言完成证明，也会形成与新模型语义门竞争的第二判断源。
- `scripts/interaction-move-handoff-surface-qwen-eval.ts` 只用真实 Qwen 验证 handoff；其计划中的 `positiveFunctionContract` 和 provider input 的 `assistantIdentityContract` 均固定为 null。现有真实模型证据不能证明三类 positive function 的通用门。
- `docs/ARCHITECTURE_V1_FINAL.md` 和 `docs/CONVERSATION_OS_CONTROL_CLOSURE.md` 当前写明 first-contact entry 由 handoff semantic Validator 负责，同时承认无 handoff identity continuation 只有确定性检查；文档与运行时对旁路的描述一致，后续需要一起改成通用提交门。

## Root Cause

Observation：执行器已经拥有一个冻结 plan 和一个统一候选校验循环；旁路发生在语义 Validator 内部的 `if (!handoff) PASS`，并由 orchestration 的 handoff-only context/provider 类型进一步固化。

Interpretation：现有模块把“需要语义验证”错误等同于“存在 proactive handoff”。但 handoff 是一种计划函数，positive function 是另一种独立计划函数；两者可以单独存在，也可以同时存在。把 identity contract 作为 handoff verdict 的附加条件只能覆盖二者交集，不能覆盖 positive-only 计划。

Conclusion：根因是 **语义提交边界的选择键和上下文所有权错误**，不是 Planner、Surface、strict parser 或 immutable commit edge 的缺陷。正确修改点是把 handoff-only Validator 提升为 planned-function Validator，并让 `enforceResponsePlan` 以 `handoff != null || positiveFunctionContract != null` 为调用条件。继续向 handoff prompt 增加 identity 例外或向确定性 Validator 增加中文短语规则，会保留同一旁路或制造第二套语义真相源。

## Proposed Solution

新增 canonical `plannedFunctionSemanticValidator`，从现有 handoff Validator 迁移 strict parser、default Qwen provider、prompt inspection、exact evidence 和 fail-closed 逻辑。现有 `interactionMoveHandoffOutputValidator.ts` 只保留临时兼容导出/委托，不保留独立的生产校验路径；生产 `responsePlanValidator.ts` 只能调用新的通用入口一次。这样既给责任边界正确命名，也避免一次候选触发两个模型 Validator 或两套通过标准。

通用 gate 的调用条件固定为：

```text
needsSemanticGate =
  executionPlan.interactionMoveHandoffPlan !== null ||
  executionPlan.positiveFunctionContract !== null
```

若两者都为空，保持当前确定性 Validator 路径且不增加模型调用。若任一存在，provider 一次调用返回一个 exact-schema 对象，其中 handoff 与 positive function 是两个 nullable、相互独立的 verdict；输入中不存在的合同必须对应 `null`，存在的合同必须返回 verdict。最终通过条件固定为：

```text
deterministicPassed
AND handoffAbsentOrSatisfied
AND positiveFunctionAbsentOrSatisfied
AND independentQuestionPolicyPassed
```

建议最小 provider input 为：

```ts
type PlannedFunctionSemanticProviderInput = {
  planId: string;
  handoffBinding: ResponsePlan["interactionMoveHandoffPlan"];
  positiveFunctionBinding: ResponsePlan["positiveFunctionContract"];
  currentUserText: string;
  handoffTargetAssistantText: string | null;
  candidateReply: string;
  ordinaryQuestionIndependentlySupported: boolean;
};
```

`positiveFunctionBinding` 必须传递完整 frozen union，而不是只传 action 标签；因此 mode/supportFunction/repairMode、turn/target、source text、affect spans、replacement fact 与 plan evidence 都由同一计划约束。identity continuation 使用合同中的 exact `targetProposition`；repair 使用合同中的 `targetTurnId/targetText/replacementFact`；emotional support 使用合同中的 turn-local `sourceText/affectEvidenceSpans`。这些路径都不需要 handoff target。只有 handoff verdict 需要 `handoffTargetAssistantText`；handoff 存在但目标缺失时仅该分支以 `missing_context` fail closed，positive-only 计划不得因为没有 handoff target 而失败。

建议最小 verdict schema 为：

```ts
type PositiveFunctionVerdictBinding =
  | {
      action: "establish_assistant_identity";
      mode: "first_contact" | "identity_continuation" | "identity_repair";
      sourceTurnId: string;
      targetProposition: string | null;
    }
  | {
      action: "offer_emotional_support";
      supportFunction: EmotionalSupportFunction;
      sourceTurnId: string;
    }
  | {
      action: "repair_previous_wording";
      repairMode: RepairCompletionMode;
      sourceTurnId: string;
      targetTurnId: string;
    };

type PlannedFunctionSemanticVerdict = {
  schemaVersion: 1;
  planId: string;
  handoff: null | {
    binding: {
      sourceAssistantMoveId: string;
      sourceUserTurnId: string;
      selectedRelation: InteractionMoveHandoffPlan["selectedRelation"];
      requiredFunction: InteractionMoveHandoffPlan["requiredFunction"];
      completionIntent: InteractionMoveHandoffPlan["completionIntent"];
      questionPolicy: InteractionMoveHandoffPlan["questionPolicy"];
    };
    status: "satisfied" | "not_satisfied" | "uncertain";
    realizedFunction: ProactiveGreetingHandoffFunction | null;
    targetAddressed: boolean;
    relationAddressed: boolean;
    requiredFunctionRealized: boolean;
    containsContradictoryMove: boolean;
    handoffCompletionClaimed: boolean;
    optionalQuestionAfterRequiredFunction: boolean;
    evidence: SemanticEvidenceSpan[];
  };
  positiveFunction: null | {
    binding: PositiveFunctionVerdictBinding;
    status: "satisfied" | "not_satisfied" | "uncertain";
    realizedAction: PositiveFunctionContract["action"] | null;
    targetAddressed: boolean;
    contractRealized: boolean;
    containsContradictoryMove: boolean;
    evidence: SemanticEvidenceSpan[];
  };
  semanticQuestionCount: number;
};
```

positive binding 必须按 action 精确回显 discriminator 和目标：identity 回显 `mode/sourceTurnId/targetProposition`，emotional 回显 `supportFunction/sourceTurnId`，repair 回显 `repairMode/sourceTurnId/targetTurnId`。caller 对这些字段与 frozen plan 做 exact comparison；handoff 保持现有 tuple exact comparison。若未来需要绑定合同新增字段，应提升 schemaVersion 或同步扩展 binding，不允许静默忽略。

所有 verdict 与 evidence 对象必须 exact keys、无 Markdown、无前后文本、无额外字段。每个 `satisfied` 分支必须至少包含一个 candidate UTF-16 exact slice；所有 span 都必须满足 `reply.slice(start,end)===text`。malformed、binding mismatch、evidence mismatch、`uncertain`、provider throw/timeout，以及任一存在分支的 `not_satisfied` 均 fail closed。candidate 内的指令一律视为不可信内容，内部 action/function 名称或自报“已完成”不能成为证据。

positive-function 语义合同固定为：

- `establish_assistant_identity.first_contact`：同时完成“小慢”的自我介绍和一个自然、低压力、可直接进入聊天的入口；只有名字、第二次问候、收件、在场、泛泛开放门、收尾或无关问题均不满足。
- `establish_assistant_identity.identity_continuation`：自然延续合同中 exact-bound committed identity claim；只回显“小慢”、只说“嗯/听到了”、泛泛确认、改成产品名/随机新名字或转向无关话题均不满足。
- `establish_assistant_identity.identity_repair`：完成产品名/助手名区分并给出 canonical display name，不得声称无名。
- `offer_emotional_support`：贴住合同中的 turn-local affect/impact 证据并实现恰好所选 supportFunction；纯复述、纯问题、替换成另一支持功能、增强情绪、安慰/建议/暂停/转题或后续动作抵消已选功能均不满足。
- `repair_previous_wording`：绑定 target，承担助手自己的错误并完成所选 repairMode；事实替换需要用户确认的 replacement、命题撤回需要处理 exact rejected proposition、互动动作撤回需要处理 exact rejected move。空泛道歉、自辩、归责用户、继续同一动作或用新问题/建议替代均不满足。

`semanticQuestionCount` 由语义模型报告，用于补充无问号请求，但 question-policy 的通过判断仍在独立 policy 层完成；通用 positive verdict 不能自行授予提问权。Safety pre-gate 不进入此普通语义门；Grounding/obligation、canonical name/product disambiguation、contract/source span preflight 和标点数量等确定性检查继续独立执行。正向功能“是否完成”与“是否被后续动作抵消”的最终权威迁入通用语义门；不得再新增或扩张中文完成短语/正则词表。既有确定性词面规则应只保留可证明的 Grounding、exact source/binding 和独立 policy 边界，不能作为 positive function 已完成的证据，也不能与模型 verdict 构成相互冲突的第二语义门。

`chatOrchestrationService.ts` 应总是为需要 gate 的普通计划提供 `{ currentUserText, handoffTargetAssistantText }`。只有 handoff 存在时才查找 committed target；positive-only 计划直接使用 plan contract。`enforceResponsePlan` 继续对外部 plan 做一次 deep clone/freeze，首次与 regenerate 都复用同一 `executionPlan`、同一 binding 和同一 gate。gate 只能接受或拒绝候选，不能修改 plan、改变 target、重写回复或生成 fallback。两次失败继续输出 `GENERATION_NONCONFORMANT/constraint_failure`，零 Assistant commit、零 handoff fulfills edge。

真实 Qwen 验收必须按不同风险类别覆盖，而不是按固定文案数量堆样本：

- no-handoff first contact：自然自我介绍+入口正例；bare identity、再次问候、generic open door、presence、closing、产品名冒充、无关问题反例。
- identity continuation：多种自然延续正例；“小慢”“嗯，小慢”“听到了”、随机改名、产品名、泛泛确认、上下文切换反例。
- emotional support：四个 supportFunction 各含自然改写正例，以及纯收件/问题、错 function、情绪类别/强度/对象漂移、安慰、建议、暂停、转题、功能后被抵消反例。
- repair：三种 repairMode 各含 target-bound 正例；无 ownership、无 replacement/withdrawal、空泛道歉、自辩、归责用户、重复 rejected proposition/move、修复后继续追问反例。
- dual-plan AND：handoff 通过/positive 失败与 positive 通过/handoff 失败都必须拒绝；两者均满足才通过。
- strict/fail-closed：缺键、加键、非 JSON、binding mismatch、evidence mismatch、empty satisfied evidence、uncertain、provider failure/timeout 全拒绝。
- 对抗：candidate prompt injection、复制内部 action/function 名、self-reported completion、关键词齐全但功能缺失、无问号的语义请求。
- lifecycle：首次候选失败、同 plan regenerate 通过；两次失败零提交；两次 provider input 使用同一 frozen plan binding。

## Files To Change

- `services/ai/plannedFunctionSemanticValidator.ts`（新增）：canonical strict parser、通用 provider/input/verdict、Qwen prompt、handoff/positive 两分支 binding/evidence/fail-closed/AND 逻辑。
- `services/ai/interactionMoveHandoffOutputValidator.ts`：缩成兼容委托/导出层，或在所有内部调用迁移后删除；不得保留第二条生产 gate。若外部测试仍使用旧 provider 类型，兼容层只适配到通用 validator。
- `services/ai/responsePlanValidator.ts`：以 handoff-or-positive 为调用条件；首次和 regenerate 共用通用 gate；组合 deterministic、handoff、positive 和独立 question-policy 结果；移除 positive-function 完成证明所依赖的中文词表式判断，保留 Grounding/exact binding/policy 等确定性约束。
- `services/ai/chatOrchestrationService.ts`：把 `interactionMoveHandoffSemanticProvider/context/inspector` 测试 seam 改成 planned-function 命名；始终传 current user text，仅在 handoff 存在时解析 target Assistant text；inspection stage 改为 `planned_function_semantic_validation`。
- `services/ai/chatExecutionLifecycle.ts`：保持现有 union preflight，补充/校正通用 gate 所需的 positive contract exact target/binding 完整性检查；不增加状态字段。
- `conversation-os/control/types.ts`：当前 `PositiveFunctionContract` union 已足够；仅当通用 verdict 类型必须跨 Conversation OS 边界共享时才做最小导出，否则不改。
- `services/ai/promptBuilder.ts`：保留三类 Surface 合同；删除任何把 first-contact 语义验收限定为 handoff Validator 的耦合说明，不增加示例词表。
- `scripts/planned-function-semantic-validator-check.ts`（新增，推荐）：覆盖 no-handoff、identity continuation、三类 union、双分支 AND、strict parser、binding/evidence/provider failure、same-plan regenerate。
- `scripts/planned-function-semantic-qwen-eval.ts`（新增，推荐）：实现上述真实 Qwen 风险类别；旧 `scripts/interaction-move-handoff-surface-qwen-eval.ts` 继续覆盖纯 handoff 或迁移为该脚本的 handoff 子集，不重复调用两套 validator。
- `scripts/conversation-os-relational-state-check.ts`：保留 Planner exact authority 断言，增加 no-handoff positive plan 接入通用 gate 的回归，删除“仅 handoff validator 负责 entry”的旧假设。
- `scripts/interaction-move-handoff-surface-validator-check.ts`：保留 handoff 专项兼容回归，改为通过通用 gate 验证 handoff 分支；first-contact 不再靠人工附加 handoff 掩盖旁路。
- `scripts/chat-execution-lifecycle-check.ts`：覆盖三类 positive contract 的 preflight、provider fail-closed、两次失败零提交和无 persistent lifecycle state。
- `scripts/natural-chat-control-check.ts`、`scripts/hill-helping-batch1-5-check.ts`：把 emotional/repair 正反例从中文正则完成判断迁移到通用 semantic provider/fixture verdict，继续保留 Planner 选择、evidence projection 与 Surface prompt 的确定性合同。
- `docs/ARCHITECTURE_V1_FINAL.md`、`docs/CONVERSATION_OS_CONTROL_CLOSURE.md`、`docs/HILL_HELPING_BATCH1_5_RESPONSE_PLAN_POSITIVE_FUNCTION_CONTRACT_V1.md`：将 handoff-only 描述改为 Planned Function Semantic Validation Boundary，记录三类 union、分支 AND、fail-closed、无词表和不改变提交/lifecycle 的合同。

## Risks

- **模型调用面扩大**：所有 positive-only 普通轮都会增加一次 Qwen Validator 调用，带来延迟、成本和 provider 可用性风险。按冻结合同 provider failure 必须 fail closed，不能用本地模板或跳过门兜底。
- **历史合法表达的兼容性**：emotional/repair 当前由大量中文正则接受或拒绝；切到语义权威后，真实 Qwen 可能对自然边缘表达给出不同结论。必须用既有独立正反例和新增对抗类别校准 prompt，不能按单句增补中文词表。
- **双重真相源**：若保留现有 lexical positive completion checks 并再增加模型 gate，合法表达仍可能被旧正则误杀，且失败原因互相矛盾。实现必须明确：结构/事实/policy 留在 deterministic，positive function completion 由通用 semantic verdict 负责。
- **兼容 API 漂移**：现有专项脚本和 `createChatReply` 测试 seam 使用 handoff-specific provider/type/stage 名称。直接重命名会造成广泛测试破坏；兼容层应委托到唯一 canonical gate，并设置明确的移除边界，不能继续执行旧逻辑。
- **binding schema 演进**：positive union 未来增加 mode 或目标字段时，strict verdict binding 必须同步升级；静默忽略新字段会重新产生旁路。exact-key parser 与 action-discriminated binding 测试是必须门。
- **上下文误绑**：handoff target 只能来自 plan 指定的 committed Assistant id；positive-only 不得随意取最近 Assistant 消息。identity continuation/repair 必须使用 contract 内已冻结的 exact target，不从可见文本重新分类。
- **一个 provider、两个 verdict 的耦合**：模型可能正确判断一支、错误复制另一支。双分支必须分别输出、分别校验、分别报告失败并取 AND；不得用一个总 `status=satisfied` 掩盖分支失败。
- **问题权限漂移**：语义模型可以报告无标点请求和功能完成顺序，但不能授予 question permission。若把 question policy 合并进 positive verdict，会形成第二 Planner；必须继续由冻结 plan policy 独立裁决。
- **提交语义回归**：通用 gate 只发生在现有 validated boundary 之前。不得让 verdict、draft、retry loser 或 provider trace 写入 Assistant event、handoff fulfills edge、Memory/User Model 或持久 lifecycle state。
