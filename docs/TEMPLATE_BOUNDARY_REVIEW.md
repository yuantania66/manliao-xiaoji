# Template Boundary Review

> 2026-07-29 follow-up：TA-011 的 guarded production template 已移除。两次
> 欢迎语验证失败现在终止生成且不创建欢迎消息；固定文案仅保留在显式
> deterministic 开发模式。第二轮修订又取消 production “欢迎语必须是问题”
> 合同，改为三种开场动作与问题频率约束。下方表格保留为审查时的历史判定。

## 审查目标

本审查基于 `docs/TEMPLATE_AUDIT.md` 的 16 个 Template ID，判断哪些固定措辞属于合理的系统固定行为，哪些已经越过边界进入正常聊天表达。

本轮只做范围判定，不修改代码、不删除模板、不替换回复、不创建产品 PR。

## 判断口径

合理固定回复包括：

- Safety 场景中必须稳定一致的回复。
- 模型或系统不可用时的 fallback。
- 明确说明额度、登录或技术状态的提示。
- 只描述可观察输入格式问题的格式协议。

正常聊天路径污染是指：用户正常聊天、模型能够生成自然表达时，固定模板或固定措辞是否仍会：

- 让 AI 开始描述自己的接收、理解或修复动作。
- 替代 LLM 针对当前内容的自然表达。
- 把对话停留在确认、复述、澄清或退出入口，降低 conversation movement。
- 因跨 Case 重复而产生明显机器人感。

风险等级：

- **P0**：已确认会直接覆盖正常聊天的 LLM 最终表达，影响用户实际看到的回复。
- **P1**：位于正常聊天生成路径并具有较强模板锚定或固定替代风险，但不是每次都直接覆盖最终文本。
- **P2**：固定性有明确且合理的 Safety、fallback、技术状态或格式协议边界；或只有低概率、间接的表达同质化风险。

## 总览

| Template ID | 当前类型 | 是否越界 | 风险等级 | 边界结论 |
|---|---|---|---|---|
| TA-001 | safety | no | P2 | 合理 Safety 固定回复。 |
| TA-002 | system fallback（crisis variant） | no | P2 | 合理风险 fallback。 |
| TA-003 | system fallback | no | P2 | 模型失败边界内，措辞风险不等于路径越界。 |
| TA-004 | system fallback | no | P2 | 模型失败边界内。 |
| TA-005 | system fallback | no | P2 | 模型不可用边界内。 |
| TA-006 | system fallback（mock safety variant） | no | P2 | mock/development fallback。 |
| TA-007 | system fallback | no | P2 | mock/development fallback。 |
| TA-008 | system fallback | no | P2 | mock/development fallback。 |
| TA-009 | format constraint / guard rewrite | **yes** | **P0** | 约束决策直接变成正常聊天最终回复。 |
| TA-010 | format constraint | no | P2 | 内容属于可观察的空白输入格式协议，且公共 API 通常先行拒绝。 |
| TA-011 | product behavior template | **yes** | **P1** | 主动问候 guard/deterministic 路径用固定文案替代自然表达。 |
| TA-012 | product behavior template | no | P2 | 明确技术/额度状态提示。 |
| TA-013 | product behavior template / Prompt-only | **yes** | **P1** | 全局正向完整句示例形成固定输出锚点。 |
| TA-014 | product behavior template / Prompt-only | **yes** | **P1** | 文本聊天 Voice Layer 全局注入固定自我描述句式。 |
| TA-015 | product behavior template / Prompt-only | **yes** | **P1** | repair 场景注入完整固定句式菜单。 |
| TA-016 | product behavior template / Prompt-only | no | P2 | 有确认记忆作为证据，且仅为条件式回顾提示。 |

风险数量：

- P0：1 个
- P1：4 个
- P2：11 个

越界数量：

- 越界：5 个
- 未越界：11 个

## 与 Template Audit 初判的差异

`TEMPLATE_AUDIT.md` 将 TA-009 与 TA-010 一并标为不应作为正常聊天回复。本轮深审将两者拆开：

- TA-009 对用户输入的“意义”提出固定澄清，并覆盖已经生成的 LLM 回复，因此确认越界。
- TA-010 只陈述“没有可见内容”这一可观察格式事实，不解释用户意义；同时公共聊天 API 通常先拒绝空白输入，因此归入允许的格式协议，判定为不越界。

这不是实现事实变化，而是 Boundary Review 在更细判断口径下对 Audit 初筛结果的收敛。

## 逐项判断

## TA-001

- **当前类型**：safety
- **是否越界**：no
- **风险等级**：P2
- **判断理由**：触发前提是明确危机信号，且编排会跳过普通聊天模型。固定、一致、可预测是 Safety 的必要属性；它不会在普通低风险聊天中替代 LLM。

## TA-002

- **当前类型**：system fallback（crisis variant）
- **是否越界**：no
- **风险等级**：P2
- **判断理由**：它只在显式 crisis fallback 中使用，不是正常模型成功路径。虽然内容与 Safety 目标相近，但固定性属于风险 fallback 的允许边界。

## TA-003

- **当前类型**：system fallback
- **是否越界**：no
- **风险等级**：P2
- **判断理由**：只有主模型失败且用户正在纠错并提到“累”时才触发。它会描述 AI 自己“没接住”并降低 conversation movement，但这是模板质量问题，不是正常成功路径的边界污染。

## TA-004

- **当前类型**：system fallback
- **是否越界**：no
- **风险等级**：P2
- **判断理由**：触发条件是主模型失败后的纠错 fallback。固定回复没有覆盖一个已成功生成的自然回复，因此属于允许的系统错误边界。

## TA-005

- **当前类型**：system fallback
- **是否越界**：no
- **风险等级**：P2
- **判断理由**：这是普通模型不可用时的最后回复。其“放在这里、慢慢来”可能降低对话推进，但系统错误 fallback 被允许保持稳定，不应与正常聊天污染混为一类。

## TA-006

- **当前类型**：system fallback（mock safety variant）
- **是否越界**：no
- **风险等级**：P2
- **判断理由**：只在 mock provider 或 provider 缺少 key 时产生，属于开发/配置 fallback。它不代表线上成功模型回复；安全语义与真实 Safety source 不一致的问题不属于本轮 Template Boundary 修复范围。

## TA-007

- **当前类型**：system fallback
- **是否越界**：no
- **风险等级**：P2
- **判断理由**：mock/development 条件明确。文本包含“没接住”和“不编场景”的系统语言，机器人感较强，但没有证据显示它会覆盖正常 provider 的成功回复。

## TA-008

- **当前类型**：system fallback
- **是否越界**：no
- **风险等级**：P2
- **判断理由**：它是 mock/development 默认回复，对普通输入会机械复用，但固定性存在明确 provider fallback 边界，不进入本轮正常聊天修复范围。

## TA-009

- **当前类型**：format constraint / semantic guard rewrite → **已改为** inspect + 最多一次受控重生成 + `constraint_failure`
- **是否越界**：实现后应为 **no**（guard 不再创作最终聊天文案）
- **风险等级**：原 P0；修复后应降为约束执行路径
- **判断理由（历史）**：模型已经成功生成回复后，guard 根据正则判断其中是否包含 unsupported meaning；一旦命中，guard 自己生成固定澄清句并覆盖最终文本。
- **实现后边界**：命中后携带结构化失败原因最多重生成一次；二次失败返回不插值用户输入的系统状态消息（`constraint_failure`）。`guard_rewrite` 仅保留兼容读取。

## TA-010

- **当前类型**：format constraint
- **是否越界**：no
- **风险等级**：P2
- **判断理由**：内容只描述可观察事实——消息没有可见内容——没有推断用户情绪、意图或意义，符合格式协议允许边界。当前公共聊天 API 通常会先拒绝空白输入，使其在正常聊天中的实际可达性很低。它与 TA-009 共用 guard builder，但内容边界不同。

## TA-011

- **当前类型**：product behavior template
- **是否越界**：**yes**
- **风险等级**：**P1**
- **判断理由**：主动问候是正常产品交互，不是模型故障提示。当 deterministic mode 开启或两次模型问候未通过 validator 时，同一句产品文案会替代自然生成结果。它不针对当次关系和上下文变化，容易产生重复、机器人感和较低的首次 conversation movement。

## TA-012

- **当前类型**：product behavior template / technical status
- **是否越界**：no
- **风险等级**：P2
- **判断理由**：消息明确说明游客额度耗尽与登录能力，没有声称理解用户内容，也没有伪装成情绪回应。即使以 assistant message 展示，它仍属于允许的技术状态提示。

## TA-013

- **当前类型**：product behavior template / Prompt-only
- **是否越界**：**yes**
- **风险等级**：**P1**
- **判断理由**：它表面上用于说明“不要无依据确认用户感受”的风格规则，但同时提供了两句完整、可直接输出的正向示例，并随基础 Prompt 注入每一次正常聊天。对模型而言，这不仅是抽象风格指导，也是高频输出锚点；尤其在系统又要求回复通常只有一两句时，照搬示例是最低成本的满足方式，因此容易让大量回复收敛到同一框架。

## TA-014

- **当前类型**：product behavior template / Voice Layer Prompt-only
- **是否越界**：**yes**
- **风险等级**：**P1**
- **判断理由**：这里的 Voice Layer 是文本聊天的表达风格层，不是语音识别、语音通话或播报反馈层，因此不存在必须用固定口头确认保证交互可靠性的需求。它在所有正常聊天中注入完整短句，且其中一部分描述 AI 自己是否理解，属于普通聊天表达污染。

## TA-015

- **当前类型**：product behavior template / Voice Layer Prompt-only
- **是否越界**：**yes**
- **风险等级**：**P1**
- **判断理由**：repair 场景需要承认理解可能偏离，但 Voice Layer 给出的不是抽象边界，而是一组完整可复用句式。模型容易把 repair 处理为从句库中选择一句，持续回应 AI 自己的理解动作，而没有回到用户内容。它不是语音交互必要反馈，而是普通文本聊天的固定表达锚点。

## TA-016

- **当前类型**：product behavior template / Prompt-only
- **是否越界**：no
- **风险等级**：P2
- **判断理由**：固定开头只在存在用户确认记忆时注入，并明确要求自然时才提及、不得添加细节。它可能带来措辞重复，但有事实证据和条件边界，不属于把安全/约束逻辑错误变成正常聊天回复。

## TA-009 深审：Semantic Guard Boundary

### 它保护什么

TA-009 保护 semantic groundedness：当用户输入没有建立明确意义时，模型不能把数字、符号、短输入或模糊表达擅自解释成测试、评分、计数、方向、情绪、活动或会话目的。

### 为什么需要存在

低信息输入给模型留下很大的补全空间。没有约束时，模型可能为了生成连贯回复而创造不存在的用户意图。Guard 的判断能力可以识别这种 unsupported meaning，防止模型把猜测说成事实。这个保护目标成立，且不应因模板污染问题被否定。

### 哪部分应该是内部决策

以下内容属于内部控制面：

- 当前语义证据是否充足。
- 模型回复是否引入了没有证据支持的含义。
- 当前 generation 是否通过约束检查。
- 当前输出应继续、被拒绝、被限制或进入其他受控状态。
- trace 中的命中模式、决策原因和最终来源。

这些信息描述系统如何判断回复，而不是用户此刻在表达什么。

### 哪部分不应该直接暴露给用户

以下内容不应由 guard 直接变成正常聊天最终表达：

- 把“证据不足”翻译成同一固定澄清句。
- 把用户原文机械嵌入 `你发的“……”` 框架。
- 向用户暴露系统正在避免猜测、评分、测试或其他内部约束的处理痕迹。
- 因 guard 命中而强制用户承担解释含义的下一步任务。

结论：TA-009 的保护目标合理，越界发生在“约束决策同时承担最终回复作者”这一边界，而不是发生在 semantic evidence 判断本身。

## TA-013 深审：Prompt Boundary

### 是风格指导还是固定输出模板

从代码意图看，它是风格指导；从模型实际接收的形式看，它同时是固定输出模板锚点。原因是 Prompt 没有只描述原则，而是给出两句完整、自然语言形式的正向目标句，模型可以直接复制或做极小改写。

### 为什么会导致同质化

- 它被注入每一次基础聊天，曝光频率高。
- 它是正向示例，模型会把它视为明确的成功格式。
- 回复长度被限制为通常一至两句，完整短句示例更容易成为最终答案骨架。
- `feel_seen`、acknowledge、reflect 等上游目标反复要求“看见、听见、承接”，进一步提高相同句式被选择的概率。
- 示例把“不要替用户确认”这个抽象边界压缩为一个固定自我报告框架，导致不同用户内容被包装进同一外壳。

### 是否应该作为禁止项而不是生成目标

**是。** 在本次边界判断中，`我听到你说……` 应被视为需要避免的模板化自我报告，而不是正向生成目标。这里判断的是表达边界，不提供任何替代回复文本，也不改变“不得无依据确认用户感受”的原始约束。

## TA-014 / TA-015 深审：Voice Layer Boundary

### 是否是语音交互必要反馈

**不是。** 当前 Voice Layer 通过 developer message 注入文本聊天 Prompt；调用链中没有语音识别、音频流、端点检测或语音播报确认。`Voice` 在这里指品牌和文字表达风格，而不是 voice interaction。

### 是否属于普通聊天表达污染

**是。**

- TA-014 在所有正常聊天中提供完整固定短句。
- TA-015 在 repair 模式提供五句完整可复用表达。
- 两者都把“承担误解责任”从抽象原则变成 AI 自我描述句库。
- 当这些句式跨 Case 重复时，用户更容易感到 AI 在执行修复流程，而不是回应自己。

repair 的交互目标本身合理；越界点是把目标固化为正向完整句式，而不是 repair 目标本身。

## P0 / P1 / P2 列表

### P0

- TA-009

### P1

- TA-011
- TA-013
- TA-014
- TA-015

### P2

- TA-001
- TA-002
- TA-003
- TA-004
- TA-005
- TA-006
- TA-007
- TA-008
- TA-010
- TA-012
- TA-016

## Repair Scope Recommendation

**D. Guard + Prompt 都需要修复**

判定依据：

- Guard Boundary 已有 P0 证据：TA-009 在正常模型成功后直接改写用户最终看到的回复。
- Prompt Boundary 已有 P1 证据：TA-013、TA-014、TA-015 把抽象表达约束转化为高频正向完整句式，形成同质化锚点。
- TA-011 同样属于正常产品入口的固定替代路径，应纳入 Guard Boundary 的后续范围判断。
- Safety、真实 fallback、mock/development fallback、技术状态提示和有证据边界的记忆提示不进入本轮建议修复范围。

本建议只确定边界范围，不提出具体新回复、不定义代码改法，也不创建修复 PR。
