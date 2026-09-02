> Status update (2026-08-25): Stage 1 first-contact obligations and no-repeat
> behavior are already implemented and sealed by the Proactive Structured and
> Guest First-Contact slices. Historical Stage 1 observations below are retained
> as provenance, not current implementation authority. Stage 2 remains the active
> gap; Stage 3 remains local/eval-only and unimplemented.

## Problem

冻结的 Conversation Purpose V1 要求小慢在每个普通用户话轮只选择一个主要姿态：`accompany` 或 `explore`；同时 Safety、直接责任、关系修复、暂停边界和硬事实必须优先，探索不得等同于提问，陪伴不得退化为纯收件。当前 Conversation OS 已经有单一 ResponsePlan、动作、问题策略、关闭策略、Grounding 和同计划校验，但没有一个由 Planner 明确拥有、逐轮重算、非持久的普通姿态合同。Surface 因而只能从 `responseActions`、Clinical 兼容字段和零散 Prompt 约束中猜测本轮究竟是在陪伴还是支持探索。

首次主动欢迎也尚未完整实现冻结合同。当前首次 intent 已包含“小慢”和低压力入口，但没有同时冻结“AI 聊天助手”与“可以随便聊 / 可以一起慢慢理清事情”两种可能；更严重的是，首次欢迎已经提交后，Planner 仍可能在用户回礼时再次加入 `establish_assistant_identity`，与“回访不机械重复自我介绍”冲突。

本方案只给 Developer 一个实施路径，不实施代码。目标是最小扩展现有控制链，不建立产品模式、生命周期状态、中文关键词策略或另一个聊天系统。

## Evidence

### Observation

- `services/ai/chatOrchestrationService.ts` 在普通控制链之前处理 Safety；Safety 命中后直接返回安全回复，不创建普通 ResponsePlan。这已经是最高优先级边界，应保持不变。
- `conversation-os/control/types.ts` 的 `ResponsePlan` 已冻结 `decisionOwner`、`responseActions`、`questionPolicy`、`closurePolicy`、`positiveFunctionContract`、Grounding 和证据，但没有普通姿态字段。现有 `ResponseAction` 也没有一个稳定表达“支持自我探索”的动作。
- `conversation-os/control/responsePlanner.ts` 已实现暂停短路、direct obligation、repair、情绪/行动支持、initiative、idle 仲裁以及问题策略；`allow_idle` 会去掉 `take_light_topic_initiative`。这些规则是应复用的优先级骨架，不应另建状态机。
- 同一 Planner 当前会把 `firstContactIdentityEvidence` 转成 `establish_assistant_identity`。直接测试明确期待首次主动欢迎后用户说“你好”时再次出现该动作，甚至把“我是小慢”视为可通过的候选；这与冻结合同的“首次已介绍后不重复”相反。
- `conversation-os/control/assistantGrounding.ts` 已把产品名“慢聊小记”、助手名“小慢”和“AI聊天助手”分开，并能返回 identity disclosure。缺口不在事实源，而在首次欢迎与后续 Planner 对事实的使用时机。
- `services/ai/proactiveGreeting.ts` 的首次 intent 是确定性的 `open_statement`，当前 proposition 为“小慢 + 无需准备完整话题”；Surface 和语义验证都绑定同一 intent。回访 intent 走另一条选择路径，因此无需持久 `introduced=true` 才能避免普通回访重复。
- `services/ai/promptBuilder.ts` 已声明 ResponsePlan 是本轮唯一非安全决策，Surface 不得重新规划；因此普通姿态必须进入 ResponsePlan，而不是再写一段独立的通用产品 Prompt。
- `services/ai/responsePlanValidator.ts` 已执行问题数量、硬事实、repair、initiative、纯收件/空泛承接等生产护栏，并在同一 planId 下最多重生一次。旧 `plannedFunctionSemanticValidator` 已经属于另一份冻结合同的生产拒绝链；Conversation Purpose 不应接入、修改或扩展这条 41/41 链，也不应通过 Chatability 分数或失败候选 fallback 绕过现有提交边界。
- `scripts/conversation-os-relational-state-check.ts` 已覆盖 Safety 之外的状态/计划、idle 与 initiative 仲裁、direct obligation、repair、first-contact identity 和 Grounding；其中当前 `allow_idle` 用例仍允许“嗯，好。”，需要按冻结合同迁移为有内容或关系贡献的安静承接。
- `scripts/natural-chat-control-check.ts` 已覆盖不连续采访、普通回答后不追加问题、主动话题一次推进、纯收件/无依据评价、主动欢迎后的承接等风险；它证明现有测试可作为结构护栏，但尚未评价 `accompany/explore` 的人类体验结果。
- `scripts/proactive-greeting-control-check.ts` 已验证首次 move、结构化 intent、语义验证、产品名/助手名分离与回访轮换；当前源码断言只要求固定首次 proposition 含“小慢”和低压力入口，尚未覆盖 AI 身份、双重对话可能以及“回礼不重复完整自介”。
- `scripts/experience-review-runner.ts` 明确说明机器检查不自动判断用户体验；`scripts/conversation-trajectory-eval-runner.ts` 支持 real/replay 多轮轨迹，报告也保留 reviewer fields。真人验收应建立在 real-model 轨迹上，replay 和内部测试只能验证结构与回归。
- 使用 `rg -n --glob '*.ts' --glob '*.tsx' '\bResponsePlan\b|structuredClone\(plan\)|responsePlan:\s*\{' conversation-os services scripts app lib` 与 `rg -n --glob '*.ts' --glob '*.tsx' 'decisionOwner: "conversation_os.response_planner"' .` 精确盘点后，除 Planner 中央构造外，发现 8 个直接完整对象构造文件；另有 spread/clone/JSON cast 消费者。完整清单已冻结在 Files To Change，Developer 不再承担二次仓库发现。
- 当前分支为 `codex/planner-handoff-migration`，工作树有 46 个 tracked 修改和 19 个 untracked 路径；本方案涉及的多数运行时和直接测试文件已经 dirty。任何实施都必须先保存逐文件基线 diff，并由唯一 writer 进行三方语义合并，不能覆盖现有用户改动。

### Interpretation

现有系统并非缺少聊天能力，而是缺少一个位于 Response Planner 与 Surface 之间的、可验证的“本轮普通目的”合同。首次欢迎则是同一类所有权问题：Grounding 已正确，Proactive intent 只冻结了部分功能，而普通 Planner 又把已完成的身份功能重新打开。

## Root Cause

第一因果边界是 ResponsePlan schema 与 Planner：它们只表达动作和约束，没有表达本轮普通姿态。结果是 `acknowledge_without_psychologizing` 既可能成为贴切陪伴，也可能只生成收件；`offer_emotional_support` 可能支持用户自主权，却不能代表全部自我探索；Surface 也没有计划级证据区分“陈述式探索”与“再问一个问题”。继续在 BASE prompt、中文正则或 Chatability 通用 gate 上叠规则，只会把产品决定留在错误层。

第二因果边界是 first-contact completion authority。首次主动消息已经是一个可提交的结构化 Assistant move，但其 intent 没有包含完整欢迎语义，且用户回礼时 `firstContactIdentityEvidence` 又把身份介绍作为未完成动作重新加入计划。正确修复点是：首次 proactive intent 一次完成全部欢迎责任；该 committed move 在相邻上下文中成为“已完成介绍”的证据，后续回礼只做普通承接或 handoff，不再次建立身份。

唯一架构选择如下：新增一个必填但可为 `null` 的 ResponsePlan 字段 `ordinaryPosture`；其中不仅冻结 mode 和证据，还必须冻结 Planner-owned `requiredContribution`。不复用 `positiveFunctionContract` 来冒充姿态，也不新增 persistent lifecycle state。

```ts
type OrdinaryPosturePlan = {
  mode: "accompany" | "explore";
  sourceSpans: Array<{
    source: "current_user_turn" | "adjacent_committed_user_turn";
    sourceTurnId: string;
    start: number;
    end: number;
    text: string;
  }>;
  requiredContribution: {
    targetSpanIndexes: number[];
    instruction: string;
  };
  evidence: string[];
};

type ResponsePlan = {
  // existing fields...
  ordinaryPosture: OrdinaryPosturePlan | null;
};
```

`ordinaryPosture` 是逐轮执行合同，不是用户状态：每次只从当前话轮、相邻 committed user context、显式边界和当前 obligations 重算；不写 Interaction State、数据库、memory、session schema 或 proactive history。`sourceSpans` 使用原文范围，不引入“情绪词 / 模式词 / 探索词”中文词表。`requiredContribution.targetSpanIndexes` 只能引用同一 plan 内已经验证过的 source spans；`instruction` 是一句内部语义目的，例如“把用户已经表达的两处拉扯整理成一句可确认或修正的陈述”，不是可见文案、固定话术、operation enum 或中文词表。缺少可靠 span、模型歧义或用户态度含混时一律选择 `accompany`，并由 Planner 冻结一个贴住当前材料的陪伴贡献。

`positiveFunctionContract` 继续只承担现有 identity / emotional support / repair 的动作完成性，避免把“姿态”与“具体动作合同”混成一个 discriminated union。旧 `plannedFunctionSemanticValidator`、41/41 生产拒绝链、计数和样例完全不改。Conversation Purpose 的语义质量只进入独立 eval/shadow 与真人验收，不影响生产 commit，也不压成一个产品成功分数。

## Proposed Solution

### Control flow and priority

1. 保持 Safety pre-gate 不变；Safety 路径不创建普通计划，等价于 `ordinaryPosture=null`。
2. Turn Interpreter 增加一个只针对当前轮的结构化、非权威 proposal：建议 `mode`、逐字 source spans 与一条 `proposedContribution`（target span indexes + 内部语义 instruction）。`explore` proposal 只能在用户已表达内在材料、矛盾/反复/权衡、意义困惑或明确想理解自己时给出；这不是诊断，也不得推断童年、人格、病因或隐藏动机。Interpreter 不能直接写 ResponsePlan，不能沿用上一轮 mode，也不能决定提交。
3. Response Planner 是唯一 acceptance authority。它先检查：span 的 role/turn/offset/text 是否精确绑定当前或相邻 committed user turn；contribution target 是否为这些 span 的非空子集；是否只有一条 bounded internal instruction；proposal 是否与 pause/stop/no_analysis/no_questions、repair、Grounding、direct obligation、idle/initiative 冲突。任何一项不成立、模型缺失或含混时，Planner 拒绝 proposal，选择 `accompany` 并依据当前已选 action/obligation 与用户 span 生成一个最小 `requiredContribution`。只有全部检查通过，Planner 才把 proposal 接受、规范化并复制为自己的 frozen `ordinaryPosture`；ResponsePlan 内的 binding，而不是 Interpreter 原始 proposal，才是 Surface 权威。
4. 显式 `pause/stop`、repair、bound direct obligation、硬事实/助手身份/能力 disclosure，以及被现有 handoff/positiveFunction 合同完整拥有的轮次设 `ordinaryPosture=null`：这些责任本身就是本轮主合同，不能再追加一个普通 contribution。当前 `directQuestionFromText` 会把无绑定的“为什么”普遍打开 reason obligation；Stage 2 必须把“询问外部/已提交命题”和“用户请求理解自己的反复/张力”分开。只有前者保留 direct obligation；像“我为什么总会这样”且没有可回答的 committed proposition 时，不得伪装成可确证事实问题，应由带 spans 的 proposal 进入 `explore`，required contribution 只整理已有材料，禁止断言病因。对其余普通轮，可靠探索证据才选 `explore`；日常分享、轻松聊天、证据不足、边界含混或明确不想深入都选 `accompany`。
5. `idle` 与 initiative 在 Planner/preflight 形成硬互斥：`closurePolicy=allow_idle` 时不得包含 `take_light_topic_initiative`，问题必须为 `none`；有 `take_light_topic_initiative` 时不得 `allow_idle/allow_pause`；`respect_pause` 必须是唯一 action。用户把球踢回时只保留“安静承接”或“一次轻推进”之一。
6. 现有 `questionPolicy` 继续是唯一问题权威。`explore` 必须先用陈述完成探索功能，问题不是完成条件；只有 plan 已允许、用户未拒绝且问题确实服务于同一 span 时，才允许最多一个低压力问题。普通 direct answer 完成后默认 `none`。

确定性 preflight 的 posture 检查冻结为：非 null posture 必须有且仅有一个 mode；至少一个 source span；每个 span 的 source role、turn id、offset、text 与当前 control context 精确一致；`targetSpanIndexes` 非空、唯一且全部在 sourceSpans 范围内；trim 后 instruction 长度为 1–240 个字符；每个 posture plan 有 provenance。`ordinaryPosture=null` 只允许在上一段列出的 priority-owned plan 或标记明确的离线 `legacy_compat` artifact；其余普通生产 plan 缺 posture 直接 PLAN_INVALID。preflight 还检查上述 priority/question/action/closure 互斥。它不得判断 instruction 是否“有洞察”、候选是否“温暖”或用户是否获得理解增量。

### Surface realization

- `accompany`：Surface 必须实现 frozen `requiredContribution`，对其 target spans 或当前关系完成 Planner 已选定的具体贡献。纯“嗯 / 收到 / 我在 / 你好呀”、裸回声、泛泛“想聊都可以”不能替代该 contribution；同时不得自动心理化、解释深层原因或把找话题任务退给用户。陪伴贡献完成后即可以结束，不得为了证明有贡献强迫探索。
- `explore`：Surface 必须实现 frozen `requiredContribution`，而不是在映照、区分、连接、整理、呈现选择/张力之间重新选择本轮目的。Planner 的 instruction 可以自然描述其中任一语义贡献，但这些能力说明不进入 enum、中文关键词表或固定模板。候选应以独立成立的陈述实现 contribution，不能只用问号、邀请或“为什么”代替；不得增加未表达的情绪强度、病因、人格、诊断或历史解释。
- Prompt 只渲染 Planner-owned `ordinaryPosture.requiredContribution`、绑定 source spans、现有 actions/obligations/question policy；标明 instruction 是不可照抄的内部语义目的。Surface 不重新选择 mode、target 或 contribution。
- runtime 确定性 preflight 只验证 schema 完整性、span/target binding、priority、question/action/closure 互斥和 evidence/provenance；它不判断“陪伴是否动人”或“探索是否真的增加理解”。现有 Safety、Grounding、问题数量、repair、handoff、positiveFunction 与其他 validator 原样保留，Conversation Purpose 不加入旧 planned-function 生产拒绝链。
- 姿态完成性与质量由独立 shadow evaluator 读取 frozen plan、候选与轨迹，分别输出“是否实现 required contribution、是否越过 spans、是否重新选姿态、是否形成采访压力”等诊断项；shadow 结果不影响 commit、不触发 regeneration、不选 winner，也不汇总成单一产品成功分数。最终产品判断只由 Stage 4 真人三指标和否决项完成。
- 现有生产 validator 若因既有 Safety/Grounding/question/repair 等原因拒绝候选，仍按当前同一 ResponsePlan 最多 regeneration 一次；第二次失败保持内部 `constraint_failure`，不包装成假聊天 fallback，不提交多个 Assistant winner。姿态 shadow 的失败本身不进入这条链。

### First contact and continuity

- 首次 `firstContactIntent()` 的 proposition 一次冻结四个不可省略的语义义务：助手名是“小慢”；身份是“AI聊天助手”；用户既可随便聊，也可一起慢慢理清事情；提供无需准备完整话题的低压力入口。文案可以自然改写，但 intent 与语义 verdict 必须逐项满足后才可提交。
- `assistantGrounding` 继续是名字、AI 身份和产品名的唯一事实源；不得在 proactive 文件复制另一套产品事实。
- 首次 proactive move 提交即视为完整自介已完成。用户随后说“你好”、回礼或接住入口时，Planner 不再加入 `establish_assistant_identity`，只执行 handoff 和当轮唯一普通姿态。只有当前 adjacent committed context 中确实没有任何已提交 Assistant 自介，或用户直接询问/纠正身份时，identity action 才重新获得 authority。
- `kind=return` 的主动问候维持现有 return 选择逻辑，不使用 first-contact intent，不机械重复完整自介；主动分享本身始终按 `accompany`，只有用户后续给出探索证据且愿意展开，下一轮才可选 `explore`。

### Delivery stages

| Stage | Outcome | Acceptance | Allowed scope | Non-goals / stop rule |
| --- | --- | --- | --- | --- |
| 1. 最短首次轨迹 | “首次欢迎 → 用户回礼”完整且不重复身份 | 初始候选语义上同时包含小慢、AI、双重对话可能、低压力入口；用户随后“你好”不再完整自介；产品名不被当助手名；首次生成失败仍不提交假 fallback；`proactive-greeting-control`、`conversation-os-relational-state`、`natural-chat-control` 三份直接测试各有明确断言 | `assistantGrounding.ts`（仅复用/必要的 disclosure 边界）、`responsePlanner.ts` 的 first-contact completion authority、`proactiveGreeting.ts`、上述三份直接测试 | 不动普通姿态 schema；同一 gate 两次修复仍失败即停止并报告 proactive semantic binding 缺口 |
| 2. 单轮 posture contract | 无优先责任拥有的普通 ResponsePlan 有且只有一个 Planner-owned `accompany/explore + requiredContribution`；direct/hard-fact/repair/pause/既有 handoff-positiveFunction owning contract 为 `null`；全都不持久化 | 普通日常=accompany；明确理解自己=explore；含混=accompany；no_analysis 不能 explore；bound direct/硬事实先完成且 posture null；无绑定自我“为什么”不伪造事实 obligation；idle/initiative 互斥；trace 可见 accepted spans、target 与 instruction；无效 Interpreter proposal 被 Planner 拒绝并安全落到 accompany | `types.ts`、`turnInterpreter.ts`、解释器结构化输入文件、`responsePlanner.ts`、preflight authority snapshot、确定性 preflight、relational/natural/lifecycle checks，以及已冻结的机械兼容清单 | 不改数据库、memory、Interaction State schema；不引入关键词表、第二 Planner 或产品拆分；兼容清单全部迁移后才允许结束本阶段 |
| 3. Surface 本地/eval rollout 与独立 shadow | 在非生产启用状态下证明 Surface 服从 frozen contribution，姿态质量不进入 commit gate | eval flag 开启时，Surface 不重选 mode/target/contribution；shadow 分项报告 contribution/span/posture/interview 风险；eval flag 默认关闭；现有生产 Safety/Grounding/question/validator 全部回归；`plannedFunctionSemanticValidator.ts` 零 diff，两个旧 planned-function 测试文件除 required field 机械兼容外零语义 diff，41/41 verdict schema/cases 不变 | `promptBuilder.ts` 的显式 local/eval flag 与 contribution projection、独立 conversation-purpose shadow evaluator、相关 control/eval tests；生产 `responsePlanValidator.ts` 与 `plannedFunctionSemanticValidator.ts` 只读回归 | 不创建新 semantic commit gate、不触发 posture regeneration、不设计 Chatability bypass、不修改 41/41；shadow 失败只产生诊断，不能影响 winner 或 commit |
| 4. 真实模型回放与真人验收 | 用最小真实轨迹证明产品合同，再由产品决定是否生产启用 | 10 类真实失败均来自 real run 或已有 captured failure；机器结构门通过；人工三指标完成；无任何否决条件；至少复跑一次确认非偶然；报告明确给出“建议启用/不建议启用”，但不自行打开生产 flag | 现有 trajectory runner/lib 的 dataset 选择与 reviewer fields、独立 `conversation-purpose-v1` 数据集和报告；只生成一份 latest 报告 | replay 不算当前模型质量；不扩展旧 golden 41/41，不产生成套候选报告；真人通过后仍由用户/产品明确决定生产启用，本切片不自动启用 |

Stage 1 是最短可验证用户轨迹，应先独立合入和验证；Stage 2 冻结 control contract 后，Stage 3 才允许 Surface 在 local/eval flag 下消费，避免 schema、生成和生产拒绝链一次大爆炸。Stage 4 只在前三阶段的窄测试通过后运行；真人通过只形成生产启用建议，实际启用需要后续明确产品决定。

### Required test and review gates

内部护栏按风险从窄到宽运行：

1. `check:proactive-greeting-control`：首次四项功能、产品/助手名分离、回礼不重复、return 不重复。
2. `check:conversation-os-relational-state`：逐轮 posture、required contribution binding、evidence span、Interpreter proposal rejection、优先级、idle/initiative、priority-owned null、bound direct/硬事实先完成、无绑定自我“为什么”进入 explore。
3. `check:natural-chat-control`：eval Surface 服从 frozen contribution；shadow 能定位纯收件、question-only、心理化与 interview loop，但 shadow verdict 不改变生产 validation/commit。
4. `check:chat-execution-lifecycle`、类型检查与相关 orchestration/architecture checks：所有 ResponsePlan 直接构造点显式填充 `ordinaryPosture`，不存在 optional/undefined 旁路；preflight 只验结构/binding/互斥；旧 production validator 仍只因既有条件拒绝候选。
5. 旧 planned-function deterministic/Qwen checks 原样通过，确认 41/41 binding、schema 和生产拒绝链没有被 Conversation Purpose 改写。
6. real-model trajectory run 后由真人填写三项指标；shadow、机器检查和 replay 只作为护栏，不得代替真人结论。

真实失败回放保持 10 个类别，每类只收一条最短、已复现的代表轨迹；没有 real run 或已有 captured failure 的类别标为 pending，不得伪造“真实失败”文本：

| Category | 最短轨迹与主要风险 | 预期姿态/责任 |
| --- | --- | --- |
| 1. 首次进入 | 初始欢迎漏 AI、漏双重可能或把产品名当名字 | proactive first-contact 完整完成；accompany |
| 2. 首次回礼/普通回访 | 用户“你好”后重复完整自介，或只回另一句问候 | accompany；不重复 identity |
| 3. 普通日常分享 | 用户分享事件，被心理化或只回裸收件 | accompany；具体内容/关系贡献 |
| 4. 无话题并交出主动权 | 把找话题任务退回用户，或一次同时 idle + initiative | accompany；一次轻推进 |
| 5. 明确想理解自己 | “我为什么总会这样”被诊断、说教或连问 | explore；先陈述一个已有模式/张力 |
| 6. 含混/轻度耗竭 | “小事很多，挺耗精力”被擅自深挖或强化情绪 | 默认 accompany；可靠证据才 explore |
| 7. 拒绝分析/提问 | “我不想分析这个”后换一种方式继续分析 | accompany 或 respect_pause；自主权优先 |
| 8. direct / 硬事实 | “你叫什么名字”答产品名或转成采访 | direct answer first；小慢；question none |
| 9. repair / 纠正 | 用户指出没接住或事实错误，助手辩解、重复旧命题或让用户诊断 | repair only；ordinaryPosture null |
| 10. idle、Safety 与执行权边界 | “好吧/然后呢”同时安静和推进；危机走普通聊天；provider 失败显示假回复或多 winner | idle/initiative 二选一；Safety pre-gate；失败不提交 |

真人逐条填写：

- 关系连续性：`pass / unclear / fail`，判断用户是否自然有下一句，而不是被问住、被分析或无话可接。
- 自我理解增量：仅 `explore` 填 `pass / unclear / fail`，其他填 `N/A`；必须指出用户更具体看见、说清或确认了哪一点，不能用“问题问得好”代替。
- 用户自主权：`pass / unclear / fail`，判断用户能否停下、转浅、换话题或只闲聊。

任一以下条件直接否决整条轨迹，不用平均分抵消：Safety/硬事实错误；连续采访；无依据心理化或诊断；纯收件空转；plan 内姿态/动作互相冲突；主动消息连发；同一 user turn 提交多个 Assistant winner；系统错误候选被包装成用户可见回复。Stage 4 完成要求所有否决项为零，且每条适用的人类指标均为 `pass`；`unclear` 视为未通过而不是半通过。

## Files To Change

实施时由一名 Developer 作为所有下列文件的唯一 writer；Architect、Reviewer 和真人验收者全部只读。若分阶段交接，后续 writer 必须等前一 writer 完成交接并记录基线 diff，禁止并发编辑同一文件。未列出的 dirty 文件一律不碰。

| File | Stage | 单一职责改动 | Compatibility gate |
| --- | --- | --- | --- |
| `conversation-os/control/types.ts` | 2 | 新增 Interpreter posture proposal 与 `OrdinaryPosturePlan` 类型；`ordinaryPosture` 包含 mode、sourceSpans、Planner-owned `requiredContribution` 和 evidence，并在 ResponsePlan 中必填 nullable | 所有直接 plan fixture 必须显式填值；禁止 optional/undefined 兼容旁路 |
| `conversation-os/control/turnInterpreter.ts` | 2 | 接受/合并非权威 proposal；保留逐字 spans、target 和 proposed instruction；不直接产生 plan binding | 现有 direct/repair/pause relation 与 committed claim binding 不回归；模型缺失不阻断 accompany |
| `services/ai/turnInterpretationAdapter.ts` | 2 | 在现有结构化解释请求中增加 proposal 与 span/target 约束；明确不诊断、不用关键词、不因上一轮 mode 延续 | Prompt injection 数据继续隔离；proposal 只能引用 current/adjacent committed user data |
| `conversation-os/control/responsePlanner.ts` | 1–2 | Stage 1 关闭已 committed 首次自介的重复 authority；Stage 2 实现 proposal acceptance、默认 accompany contribution、唯一 posture、direct/repair/pause/Grounding 优先与 idle/initiative 互斥，并写完整 binding provenance | Planner 是唯一 owner；Surface/Interpreter 都不能生成或改写 accepted contribution |
| `conversation-os/control/responsePlanPreflightAuthority.ts` | 2 | authority snapshot 增加当前与相邻 committed user source 清单，并把 accepted posture binding 纳入 canonical provenance | preflight 只能接受 snapshot 中逐字一致的 user spans；不得接受 Assistant 文本、未提交轮次或持久 state |
| `conversation-os/control/assistantGrounding.ts` | 1 | 不新增事实源；仅在确有需要时提供复用“小慢 + AI聊天助手”的组合 disclosure | 产品名、助手名、AI/临床边界保持原值；无免责声明泛滥 |
| `services/ai/proactiveGreeting.ts` | 1 | 首次 intent 一次冻结四项欢迎义务；Surface/semantic verdict 绑定完整 intent；return 不复用首次 intent | 继续最多两次 same-intent 尝试；不增加安全确定性假欢迎 fallback |
| `services/ai/chatExecutionLifecycle.ts` | 2 | 扩展 deterministic `preflightResponsePlan`：只验 posture schema、span/target binding、priority、question/action/closure 互斥与 provenance | 不判断语义质量，不调用模型，不改 production output validator |
| `services/ai/promptBuilder.ts` | 3 | 在默认关闭的 `CONVERSATION_PURPOSE_V1_SURFACE_ENABLED` local/eval flag 下渲染 Planner-owned contribution 与 spans；说明 instruction 不可照抄，Surface 不得重选 | 未显式设为 `true` 时生产 prompt 不消费该字段；ResponsePlan 仍是唯一决策源；不恢复 legacy strategy prompt |
| `services/ai/debugTrace.ts` | 2–3 | 在 debug/eval trace 投影 accepted mode、target spans 与 required contribution，供 shadow 和人工复核 | 不把 proposal 或 shadow verdict写成 committed state |
| `scripts/conversation-purpose-shadow-eval.ts` | 3 | 新增独立只读 shadow：逐项诊断 contribution realization、span 越界、posture 重选、采访压力；输出诊断而非单分 | 不影响 commit/winner/regeneration，不调用或复用 41/41 validator |
| `scripts/proactive-greeting-control-check.ts` | 1 | 首次源码/语义断言升级为四项完整欢迎；断言 initial/return move 与产品名边界 | Stage 1 三份直接测试之一；删除“只含小慢即可”的旧期望 |
| `scripts/conversation-os-relational-state-check.ts` | 1–3 | Stage 1 断言 proactive 自介后用户“你好”不再 identity；Stage 2/3 覆盖 proposal acceptance、required contribution、priority/null、source binding、idle/initiative；把“嗯，好。”纯收件通过迁移为失败 | Stage 1 三份直接测试之二；保留 direct/repair/Grounding/claim binding 回归集 |
| `scripts/natural-chat-control-check.ts` | 1–3 | Stage 1 断言首次回礼自然承接且不重复完整自介；Stage 2/3 增加 frozen contribution、陈述式 explore、question-only/心理化/纯 receipt、转浅/换话题和普通 direct 后不追问 | Stage 1 三份直接测试之三；代表性按风险类别，不继续任意 20/41 数量 |
| `scripts/chat-execution-lifecycle-check.ts` | 2–3 | 覆盖 required 字段、preflight schema/binding/互斥；证明 posture shadow 不进入既有 enforce/commit gate | 旧 Safety/Grounding/question/positiveFunction failure 行为原样通过 |
| `scripts/conversation-trajectory-eval-lib.ts` | 4 | 允许选择独立 conversation-purpose 数据集并固定三项 reviewer fields 与 veto 字段 | 旧 v1 trajectory 默认路径和 replay 行为兼容 |
| `scripts/conversation-trajectory-eval-runner.ts` | 4 | 增加显式 dataset 选择和独立 latest 输出；real/replay 语义保持不变 | replay 报告继续声明不代表当前模型质量 |
| `clinical-evals/conversation-purpose-trajectories-v1.json` | 4 | 保存上述 10 类最短真实/captured 失败；未复现项标 pending | 不复制旧 41/41 golden；不写臆造 observedAssistant |
| `docs/evals/conversation-purpose-review-latest.md` | 4 generated | 单一最新回放与人工评审表 | 不把生成数量当决策证据，不生成候选报告族 |

以下是 required `ResponsePlan.ordinaryPosture` 的机械兼容清单，来自上述精确检索；不得在实施时重新“边做边找”：

| Classification | Exact files | Required action |
| --- | --- | --- |
| 中央完整构造 | `conversation-os/control/responsePlanner.ts` | 生产 plan 必须写入 accepted posture 或明确 `null` |
| 直接完整 fixture / eval plan（8 files） | `scripts/interaction-move-envelope-check.ts`; `scripts/interaction-move-handoff-surface-qwen-eval.ts`; `scripts/interaction-move-handoff-surface-validator-check.ts`; `scripts/interaction-move-handoff-qwen-structured-output-eval.ts`; `scripts/chat-execution-lifecycle-check.ts`; `scripts/planned-function-semantic-validator-check.ts`; `scripts/planned-function-semantic-qwen-eval.ts`; `scripts/hill-helping-batch1-5-causal-ablation-check.ts` | 每个 base object 显式增加字段：handoff/positiveFunction/direct/repair/pause 隔离 fixture 按 null-authority 规则写 `null`；普通 acknowledge/surface fixture 写与 fixture user text 对齐的完整 accompany binding；离线 ablation 标 `legacy_compat + null`。两个 planned-function 文件只做机械类型兼容，禁止改 verdict/schema/cases/production validator |
| 从已完整 plan 做 spread 派生 | `scripts/interaction-move-envelope-check.ts`; `scripts/chat-execution-lifecycle-check.ts`; `scripts/hill-helping-batch1-5-check.ts`; `scripts/hill-helping-batch1-5-post-candidate4-check.ts`; `scripts/hill-helping-batch1-5-preservation-check.ts`; `scripts/hill-helping-batch1-5-stage2-check.ts` | 不重复构造字段；确认 spread 保留 binding。若 fixture 改变用户材料或 action，必须显式同步/置 null，不能继承失效 target |
| `structuredClone` 保真 | `services/ai/responsePlanValidator.ts`; `scripts/interaction-move-handoff-surface-qwen-eval.ts` | clone implementation 无需修改；在 lifecycle/surface eval 测试增加“clone 前后 posture 深相等/plan 不变”断言，生产 validator 源码不接入 posture gate |
| unknown/JSON cast 与旧离线 artifact | `scripts/hill-helping-batch1-5-causal-ablation-lib.ts`; `scripts/hill-helping-batch1-5-artifact-check.ts` | loader 边界显式识别旧 artifact 缺字段并仅在离线兼容投影标为 `legacy_compat + ordinaryPosture:null`，不得把该归一化函数导入生产控制链；新 artifact 必须含字段 |
| 手写 debug DTO 投影 | `app/chat/chat-client.tsx` | 若 Stage 3 需要界面读取新 trace，则只扩展 DTO 读类型；不赋予 UI 修改或选择 posture 的权限 |

`services/ai/plannedFunctionSemanticValidator.ts` 明确不在 Files To Change：不得加入 posture branch、不得改变 41/41 binding/verdict schema、不得让 shadow 结果进入生产拒绝链。`services/ai/responsePlanValidator.ts` 同样不承担 posture 语义质量；除上述 structuredClone 保真测试所需的测试断言外，生产文件保持不改。Stage 3 的 local/eval flag 在 Stage 4 真人通过后仍保持默认关闭，直到用户/产品另行明确批准生产启用。

文档一致性在实现完成后只更新已有权威架构/验收文档中受本字段影响的章节；本分析阶段不预先改 PRD，也不创建产品拆分文档。

## Risks

- **Dirty worktree collision（高）**：核心 control、Prompt、validator、orchestration 和三份测试已有未提交修改。实施前必须逐文件保存 `git diff` 基线；唯一 writer 只做语义局部 patch，禁止格式化整文件。若现有修改与冻结合同产生不可调和冲突，立即停止并让 Delivery Lead 决定，不能覆盖。
- **Required field migration（高）**：`ordinaryPosture` 设为必填会暴露所有手写 ResponsePlan fixture 和兼容构造点。将它做 optional 会形成绕过，因此正确策略是编译失败驱动逐个迁移；若扩散超出命名 tests/control 构造点，先盘点后再继续，不能偷偷加默认值掩盖。
- **当前测试与冻结合同冲突（高）**：首次回礼重复 identity、`allow_idle` 接受“嗯，好。”都是现有明确断言。它们必须作为合同迁移被改写，而不是为了保绿保留旧行为；Reviewer 应检查改的是产品期望而非删掉覆盖。
- **Model recommendation overreach（高）**：探索选择若没有逐字 span 或把相邻 Assistant 推断当用户事实，会产生心理化。Planner 必须对 source role、turn id、offset 和 committed status 做 preflight；任何无效/含混 recommendation 只降级 accompany。
- **Surface 重新规划（高）**：只给 Prompt 写“可以探索”会让 Surface 自选目的。必须把 mode 放进冻结 ResponsePlan，并让语义 verdict 回显 binding；否则 Stage 3 不得通过。
- **Direct obligation collision（中高）**：自我指向的“为什么”既像问题又是探索入口。只有绑定外部事实或已提交命题的 direct obligation 才保持优先；“我为什么总会这样”这类没有可确证目标的自我提问不得伪造事实 obligation，应由精确 User spans 的 explore proposal 处理，并禁止病因断言、第二任务或追加采访。若现有 authority 无法安全取得该 proposal，应记录为 acquisition gap，不能到 Prompt 打补丁。
- **Eval latency and availability（中）**：独立 shadow 可以在离线 real run 中调用评估模型，但不能增加生产回复链的模型往返。shadow provider 不可用时只把该评审项标为 unavailable/pending，不得改变已生成候选的 commit 结果，也不得把缺少 shadow 当作可聊性 fallback 理由。
- **First-contact false repeat / false omission（中）**：仅靠本地 proactive history 会受缓存或缺失影响。是否已介绍只认相邻 committed Assistant move/envelope 或当前 conversation 无 Assistant turn的结构事实，不建立 lifecycle flag，也不从标点、文案相似度或中文短语推断。
- **Validator becoming a phrase classifier（中）**：已有 validator 已有若干中文正则，继续扩充会与“无中文词表”冲突。新 posture 的 runtime 只做 schema/span/target/binding/互斥 preflight；完成性和心理化仅在独立 shadow 分项诊断与真人验收中判断，不写入生产 validator。
- **Accompany overcorrection（中）**：拒绝纯 receipt 不能演变成每轮强制推进、分享或提问。真人验收必须同时看关系连续性与自主权；安静承接只需有一个具体关系/内容贡献，不要求打开新话题。
- **Explore quality proxy（中）**：字段正确、问题为零或 shadow 显示 contribution 已实现，都不证明用户获得理解增量。Stage 4 的真人“自我理解增量”是必要 gate，且只评 explore；内部测试和 shadow 永远只是护栏。
- **Scope loop（中）**：本切片明确不恢复 Chatability 通用 bypass、不继续 Planned Function 41/41、不增加 persistent lifecycle/schema、不决定产品拆分。发现相关问题只记 Remaining；同一冻结 gate 最多两次修复，仍失败即停止并给 Delivery Lead 一个责任层决策。
