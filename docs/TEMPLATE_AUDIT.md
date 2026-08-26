# Template Audit

> 2026-07-29 follow-up：TA-011 的 production guarded fallback 已移除。模型欢迎语
> 于第二轮修订中改为 `simple_greeting/open_statement/light_question` 多动作合同，
> 不再强制问题；固定候选只服务显式 deterministic 开发模式。模型欢迎语
> 连续两次未通过自然度约束时，现在返回生成失败并不创建欢迎消息；只有显式
> `PROACTIVE_GREETING_MODE="deterministic"` 的开发配置仍使用固定动作候选。
> 下方数量统计保留为本审计形成时的历史基线。

## 审计目标

本审计检查当前系统中的固定回复模板和固定措辞注入，判断安全、约束或产品逻辑是否越界成为正常聊天中的用户可见回复。

本次只做静态审计，不修改 Prompt、Clinical Logic、ResponseGoal、Strategy、Memory、Safety 或任何产品行为。

## 审计范围与口径

扫描范围：

- `services/ai/`
- `services/clinical/`
- `conversation-os/`
- `services/chat/`
- `app/api/chat/`
- `app/chat/`

计数单位：

- 一个独立的固定最终回复分支，计为一个模板。
- 一组在 Prompt 中被正向推荐、可能被模型照搬的固定措辞，计为一个模板族。
- 同一固定文本由多个触发条件复用时，只计一个模板，但记录全部触发条件。

不计入：

- 仅用于禁止或检测某类表达的负面示例。
- debug、trace、日志、异常详情和测试断言文本。
- 不作为 assistant message 展示的普通 UI 错误。
- 输入提交期间的 `...` 打字占位。
- 只描述目标或约束、没有给出正向固定说法的 Prompt 指令。

## 数量统计

当前共识别 **16 个固定回复模板或固定措辞族**。

其中：

| 路径 | 数量 | 说明 |
|---|---:|---|
| Safety | 1 | Safety gate 命中后直接返回稳定危机回复。 |
| Fallback / development fallback | 7 | 模型调用失败、风险 fallback、mock provider 或缺少 provider key 时返回。 |
| 正常聊天路径 | 4 | Guard rewrite、主动问候 deterministic/guarded 路径、游客额度提示。 |
| Prompt-only 固定措辞注入 | 4 | 不直接成为最终回复，但作为正向示例进入模型上下文。 |

直接用户可见模板共 **12 个**；Prompt-only、非直接用户可见的固定措辞族共 **4 个**。

## 结论摘要

- **发现正常聊天模板污染。** Semantic evidence guard 会把合规模型生成之后的最终文本替换为固定澄清句；这是约束逻辑直接变成用户可见回复的明确实例。
- 主动问候的 deterministic/guarded 分支也会用同一句固定产品文案替代模型表达，属于正常产品入口中的固定模板路径。
- 游客额度提示以 assistant message 形式展示，但其内容明确表达产品额度状态，不伪装成对用户内容的理解，属于产品行为模板，不构成语义回复污染。
- Prompt 与 Voice Layer 中存在正向固定措辞锚点。它们不直接覆盖回复，但可能提高“我听到你说”“我没跟上”“我理解错了”等句式的重复概率。
- Safety 模板和真正的系统 fallback 模板有明确触发边界，固定性本身没有越界。

## 相关文档一致性观察

`services/ai/README.md` 将当前最终回复 contract 描述为“针对语义尚未建立的纯数字输入的一条窄路径”。实际实现中的 `UNSUPPORTED_MEANING_PATTERNS` 还覆盖测试/试探、评分/计数、方向、情绪、节奏和随手输入等多类含义。因此，README 对 guard 的实际触发范围描述偏窄。

这项差异不改变本审计的模板数量，但说明 TA-009 的真实覆盖面大于文档字面描述。本任务不修改该文档或实现。

## 逐项审计

## TA-001

1. **文件位置**：`services/ai/chatSafety.ts:21-28`；调用入口 `services/ai/chatOrchestrationService.ts:119-124`
2. **触发条件**：`isCrisisInput(userMessage)` 命中当前自伤、他伤、暴力、家暴或药物过量等危机模式，且不属于新闻、影视、否定或明确的过去安全语境。
3. **当前回复内容**：`这件事先别一个人扛。请马上联系身边可信的人；如果有现实危险，立刻拨打当地紧急电话或去最近的急诊。`
4. **类型**：safety
5. **是否用户可见**：yes
6. **判断**：保留。该模板只在 Safety gate 命中后返回，普通模型与 ClinicalPlan 被跳过，固定性符合稳定安全响应要求。

## TA-002

1. **文件位置**：`services/ai/aiService.ts:111-113`
2. **触发条件**：创建 fallback generation 时显式传入 `riskLevel="crisis"`。
3. **当前回复内容**：`这会儿先不用解释。请把自己和可能伤害你的东西隔开，联系身边可信的人；有危险就打当地紧急电话。`
4. **类型**：system fallback（crisis variant）
5. **是否用户可见**：yes
6. **判断**：保留。它是风险 fallback，不是正常聊天模板；主聊天编排中危机输入通常已由 TA-001 提前截获。

## TA-003

1. **文件位置**：`services/ai/aiService.ts:115-118`
2. **触发条件**：主模型抛错或不可用；用户文本命中纠错模式，同时包含“累”。
3. **当前回复内容**：`是我刚才没接住。你已经说了累，就先停在这里。`
4. **类型**：system fallback
5. **是否用户可见**：yes
6. **判断**：保留。它只在模型失败时出现，不属于正常 LLM 成功路径；但措辞包含 AI 描述自身和“停在这里”，是 fallback 中 conversation movement 较低的模板。

## TA-004

1. **文件位置**：`services/ai/aiService.ts:115-120`
2. **触发条件**：主模型抛错或不可用；用户文本命中纠错模式，但不包含“累”。
3. **当前回复内容**：`是我刚才没接住。先回到你刚刚说的这句。`
4. **类型**：system fallback
5. **是否用户可见**：yes
6. **判断**：保留。它只在模型失败时出现；内容以 AI 自身是否“接住”为中心，但没有证据表明它覆盖成功的正常模型回复。

## TA-005

1. **文件位置**：`services/ai/aiService.ts:122`
2. **触发条件**：主模型抛错或不可用；输入既不是 crisis fallback，也不命中纠错分支。
3. **当前回复内容**：`先不用解释完整。这个部分可以先放在这里，慢慢来。`
4. **类型**：system fallback
5. **是否用户可见**：yes
6. **判断**：保留。它是明确的模型不可用 fallback；固定性没有进入成功的正常模型路径，但句式本身会降低 conversation movement。

## TA-006

1. **文件位置**：`services/ai/modelProvider.ts:129-137`；provider 路由 `services/ai/modelProvider.ts:245-266`
2. **触发条件**：provider 为 `mock`，或当前 provider 缺少 API key；提取到的用户文本命中 mock crisis 模式。
3. **当前回复内容**：`这会儿先不用解释。请把自己和可能伤害你的东西隔开，联系身边可信的人；有危险就打当地紧急电话。`
4. **类型**：system fallback（mock safety variant）
5. **是否用户可见**：yes
6. **判断**：需要后续 review。它属于开发或缺少配置时的 fallback，但安全内容由 mock provider 独立判断和输出，不带 `finalReplySource="safety"` 的 Safety gate 语义。

## TA-007

1. **文件位置**：`services/ai/modelProvider.ts:130-137`；provider 路由 `services/ai/modelProvider.ts:245-266`
2. **触发条件**：provider 为 `mock`，或当前 provider 缺少 API key；用户文本命中纠错模式。
3. **当前回复内容**：`刚才没接住。先回到你说的这句，不编场景。`
4. **类型**：system fallback
5. **是否用户可见**：yes
6. **判断**：需要后续 review。它不是线上模型成功路径，但会作为完整 assistant reply 出现；回复主要描述 AI 自身是否接住，并暴露“不要编场景”式系统约束语言。

## TA-008

1. **文件位置**：`services/ai/modelProvider.ts:133-137`；provider 路由 `services/ai/modelProvider.ts:245-266`
2. **触发条件**：provider 为 `mock`，或当前 provider 缺少 API key；输入不命中 mock crisis 或纠错模式。
3. **当前回复内容**：`嗯，先不用整理清楚。可以只从一个很小的地方开始说。`
4. **类型**：system fallback
5. **是否用户可见**：yes
6. **判断**：需要后续 review。它承担开发 fallback，但对所有普通输入使用同一句回复，存在明显的机械泛化特征。

## TA-009

1. **文件位置**：`services/ai/semanticEvidenceReplyGuard.ts:21-24, 35-64`；正常编排入口 `services/ai/chatOrchestrationService.ts:175-193`
2. **触发条件**：ClinicalPlan 进入 clarify/receive 或 clarify/clarify_meaning contract，且已生成的模型回复命中 `UNSUPPORTED_MEANING_PATTERNS`。
3. **当前回复内容**：`你发的“${observedText}”是指什么？`，其中用户文本会被规范化并截断到 80 字。
4. **类型**：format constraint
5. **是否用户可见**：yes
6. **判断**：明显不应该作为正常聊天回复。该路径保留了“是否存在 unsupported meaning”的约束判断，但把约束结果直接实现为固定最终回复，并以 `finalReplySource="guard_rewrite"` 覆盖 LLM 文本。它是当前最明确的正常聊天模板污染。

## TA-010

1. **文件位置**：`services/ai/semanticEvidenceReplyGuard.ts:21-24, 35-64`
2. **触发条件**：与 TA-009 相同，但规范化后的用户文本为空。
3. **当前回复内容**：`这条消息没有可见内容，可以重新发一次吗？`
4. **类型**：format constraint
5. **是否用户可见**：yes（服务级；当前公共聊天 API 通常会先拒绝空白输入）
6. **判断**：明显不应该作为正常聊天回复。它同样把 guard 的判断结果变成固定最终文本；公共 API 的输入校验降低了可达性，但服务函数本身仍存在覆盖能力。

## TA-011

1. **文件位置**：`services/ai/proactiveGreeting.ts:8, 145-152, 167-186`；落库与展示入口 `services/chat/proactiveGreetingService.ts`
2. **触发条件**：仅显式 `PROACTIVE_GREETING_MODE="deterministic"`；模型主动问候连续两次未通过 validator 时不再生成固定回复。
3. **当前回复内容**：按选定动作从开发专用候选中选择；例如 `你好。`、
   `我先来打个招呼。` 或一个具体轻量问题。
4. **类型**：product behavior template
5. **是否用户可见**：yes
6. **判断**：仅保留为显式开发模式的 deterministic 文案。production 模型路径不会再用它覆盖失败候选；普通欢迎语由多动作合同、问题频率、近似重复和话题复用校验控制。

## TA-012

1. **文件位置**：`app/chat/chat-client.tsx:216-217, 753-761`
2. **触发条件**：游客当日 AI 使用次数达到 3 次，且未开启 AI debug trace。
3. **当前回复内容**：`今天的游客体验次数用完啦。登录后可以继续慢慢说，也能保存聊天回看。`
4. **类型**：product behavior template
5. **是否用户可见**：yes，以 assistant message 形式展示
6. **判断**：保留。它明确表达额度与登录状态，没有伪装成对用户内容的理解；虽然处于聊天流中，但属于产品状态通知，不是语义回复模板污染。

## TA-013

1. **文件位置**：`services/ai/promptBuilder.ts:36-47`
2. **触发条件**：每次构建基础聊天 Prompt 都会注入 `BASE_PRODUCT_PROMPT`。
3. **当前回复内容**：正向固定示例族：`听起来今天有点累`、`我听到你说今天好累`。
4. **类型**：product behavior template
5. **是否用户可见**：no（Prompt-only；模型可能照搬后间接可见）
6. **判断**：需要后续 review。该规则原本用于限制无依据确认，但正向示例包含“我听到你说”，可能把约束转化为 AI 描述自己正在接收用户内容的固定句式。

## TA-014

1. **文件位置**：`services/ai/voiceLayer.ts:37-50`；注入入口 `services/ai/promptBuilder.ts:278-286`
2. **触发条件**：正常聊天构建 Voice Layer constraints 时始终注入基础风格指令。
3. **当前回复内容**：正向固定示例族：`我没跟上`、`我理解错了`、`先不说也行`、`能帮上就好`。
4. **类型**：product behavior template
5. **是否用户可见**：no（Prompt-only；模型可能照搬后间接可见）
6. **判断**：需要后续 review。它与“不要输出固定句式”同时存在，但又提供一组可直接输出的固定短句；其中前两句把回复中心放在 AI 自身理解状态。

## TA-015

1. **文件位置**：`services/ai/voiceLayer.ts:87-98`；注入入口 `services/ai/promptBuilder.ts:278-286`
2. **触发条件**：Conversation OS 的 engage mode 为 `repair` 或 `repair_with_invitation`。
3. **当前回复内容**：正向固定示例族：`哦，我听岔了`、`可能是我刚刚没跟上`、`不是你没说清，是我接偏了`、`那我先收回来`、`你刚刚想说的不是这个`。
4. **类型**：product behavior template
5. **是否用户可见**：no（Prompt-only；模型可能照搬后间接可见）
6. **判断**：需要后续 review。触发场景确实需要 repair，但连续提供五个可直接复用的完整句式，会提高 repair 回复模板化和“AI 回应自己”的概率。

## TA-016

1. **文件位置**：`services/ai/dataLayers.ts:75-82`；注入入口 `services/ai/promptBuilder.ts` 的 memory context developer message
2. **触发条件**：存在 `user_confirmed_memory`，构建聊天 Prompt 时注入已确认记忆。
3. **当前回复内容**：固定开头示例：`上次你记下过……`
4. **类型**：product behavior template
5. **是否用户可见**：no（Prompt-only；模型可能采用后间接可见）
6. **判断**：需要后续 review。它有已确认记忆作为证据，不属于无依据推断；但固定开头可能造成跨对话重复，降低自然度。

## 重点短语核查

| 重点短语 | 当前运行代码中的状态 |
|---|---|
| `我看到你发的是……` | 未发现直接运行时回复；当前同机制 guard 文本为 TA-009：`你发的“……”是指什么？`。 |
| `我听到了……` | 未发现直接 deterministic 最终回复；Prompt 中存在 TA-013 的 `我听到你说……`，Voice Layer 还将 `我听到了这句话` 列为禁用表达。 |
| `我接住了……` | 未发现该肯定句；fallback 和 repair 示例存在 `没接住`、`接偏了`，见 TA-003、TA-004、TA-007、TA-015。 |
| `我在这里……` | 未发现直接最终回复；Prompt/Voice Layer 主要将 `我在`、`我在这里` 类表达作为需要避免的陪伴口癖。 |
| `先放在这里……` | TA-005 直接包含 `这个部分可以先放在这里`；TA-011 包含 `放一句话在这里`。 |
| `你可以继续……` | 未发现直接运行时回复。 |
| AI 描述自己正在做什么 | 直接出现在 fallback 的“没接住”系列；间接出现在 Prompt 的“我听到你说”“我没跟上”“我理解错了”等正向示例族。 |

## 高风险模板列表

按“最可能造成正常聊天污染”排序：

1. **TA-009 — semantic evidence guard 动态固定澄清句**：约束判断直接覆盖 LLM；同时复述用户输入并把解释责任交还用户，最可能造成机械复述和 conversation movement 下降。
2. **TA-011 — deterministic/guarded proactive greeting**：正常产品入口中的固定最终文案；guard 连续拒绝模型输出后仍以模板替代自然表达。
3. **TA-013 — Base Prompt 的 `我听到你说……` 正向示例**：原意是限制过度确认，但可能诱导 AI 描述自己正在听，而不是回应用户内容。
4. **TA-014 / TA-015 — Voice Layer repair 固定措辞族**：完整可复用句式密度高，最可能让 repair 场景持续围绕 AI 是否理解、是否接住。
5. **TA-003 / TA-004 / TA-007 — “没接住” fallback 族**：有 AI 回应自己的特征，但当前证据显示它们只在 fallback/mock 路径出现，不构成成功 LLM 正常路径污染。
6. **TA-005 — `先放在这里，慢慢来` fallback**：容易封口并降低 conversation movement，但属于模型不可用 fallback，边界明确。

## 是否存在正常聊天模板污染

**是。**

明确污染点是 TA-009 与 TA-010：semantic evidence 的判断能力本应限制 unsupported meaning，但当前实现仍允许 guard 生成固定最终文本并覆盖模型回复。TA-011 则是主动问候中的正常产品模板路径，虽然不是对用户语义的 guard rewrite，也会在模型被拒绝后隐藏真实模型表达。

Prompt-only 的 TA-013、TA-014、TA-015 不构成直接覆盖，但属于可能把产品约束变成重复用户可见句式的间接污染源。

## 最可能导致的体验失败

### AI 在回应自己

- TA-003、TA-004、TA-007：`没接住`。
- TA-013：`我听到你说……`。
- TA-014、TA-015：`我没跟上`、`我理解错了`、`我听岔了`、`我接偏了`。

### 机械复述

- TA-009：把用户原文插入 `你发的“……”是指什么？`。
- TA-013：把用户体验重写进 `我听到你说……` 的固定框架。
- TA-016：记忆回顾可能重复使用 `上次你记下过……`。

### Conversation movement 下降

- TA-009、TA-010：固定澄清将下一步工作交给用户。
- TA-011：固定入口不根据当下对话变化。
- TA-003、TA-005：`停在这里`、`先放在这里`、`慢慢来`。
- TA-014、TA-015：repair 可能停留在 AI 自我校正，而没有回到用户内容。

## 是否需要后续修复 Epic

**需要。**

理由是已经发现至少一个明确的正常聊天 guard rewrite 污染路径，以及一组可能间接诱导模板化表达的 Prompt/Voice 固定措辞族。本审计不创建 Epic、不提出具体替换文本，也不定义修复方案。

## 下一步唯一动作

由 Decision Owner 审阅本审计并决定是否创建独立的 Template Boundary Repair Epic。
