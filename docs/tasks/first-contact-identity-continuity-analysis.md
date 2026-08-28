## Problem

当前首次进入聊天的用户路径同时暴露了三个责任边界的问题：

1. 欢迎语生成失败时页面呈现为空，用户看不到欢迎语，也看不到失败或重试状态。
2. 初始欢迎语之后，用户以“你好”回礼时，系统只完成 reciprocal contact，却没有选择任何可以把首次接触推进到下一步的正向动作，结果容易停在另一句问候或无内容过渡。
3. 产品身份、助手身份和身份建立连续性没有被分别建模：系统把产品名“慢聊小记”声明成助手姓名；用户纠正后只能撤回错误，不能给出正确助手身份；用户继续允许助手拥有名字时，Planner 又只能做普通确认，无法自然回应或提出一次有依据的问题。

第 2–5 个现象属于同一个 first-contact / identity continuity 合同缺口。第 1 个现象与它相邻，但属于欢迎语交付可靠性，不应通过放宽语义校验来修复。

## Evidence

- `conversation-os/control/assistantGrounding.ts:6-8` 将 `identity.name` 直接设为“慢聊小记”；`conversation-os/control/types.ts:228-234` 又把这个值写进类型合同。`getRequiredGroundingDisclosure("identity")` 在 `assistantGrounding.ts:43-47` 必然输出“助手名称是慢聊小记”。所以“我叫慢聊小记”不是模型偶发发挥，而是 Grounding 的确定性错误。
- `services/ai/promptBuilder.ts:70-75` 再次把“你是慢聊小记”写入 ResponsePlan Surface prompt，并禁止输出计划和 Grounding 未提供的命题。即使模型知道产品名与助手名应分开，也没有权限生成另一个名字。
- 架构文档 `docs/ARCHITECTURE_V1_FINAL.md:488-502` 明确声明 Grounding 是身份单一事实源，并规定普通身份问题要求“产品名和 AI assistant identity”。这项文档合同本身混合了产品身份与助手身份，和运行时错误一致。
- proactive handoff 对 reciprocal greeting 给出 `questionPolicy="optional_after_completion"`（`conversation-os/control/interactionMoveHandoffPlanner.ts:69-77`），但 `responsePlanner.ts:345-352` 会在 `complete_reciprocal_contact` 时删除唯一的普通 acknowledgement action。随后 `promptBuilder.ts:173-180` 在 actions 为空时明确要求陈述式过渡后立即结束，哪怕 questionPolicy 是 optional 也禁止提问、邀请或提供话题。由此，“你好”之后不存在独立支持的首次接触推进动作。
- 普通 Planner 还会在 direct answer、repair without topic initiative、shared initiative 或 allow-idle 情况下把问题设为 `none`（`responsePlanner.ts:464-483`）。身份询问本轮不追问是合理的；但身份纠错完成后以及用户明确延续“名字”话题时，当前动作集合没有 identity-continuation action，系统只能落到 `acknowledge_without_psychologizing`。这解释了“嗯，听到了”一类无推进回复。
- `BASE_PRODUCT_PROMPT` 已禁止只说“听到了/嗯/好”（`promptBuilder.ts:57-60`），但 ResponsePlan 又要求 Surface 只能实现计划内动作和命题（`promptBuilder.ts:70-75`）。当计划只有 acknowledgement 且不允许问句或新命题时，风格提示无法补造缺失的对话功能。因此继续增加禁用短语不会修复根因。
- Guest 欢迎语调用在 `app/chat/chat-client.tsx:554-593` 捕获所有错误后直接返回 `null`；`readOrSeedGuestMessages` 在 `chat-client.tsx:596-612` 随即返回原消息列表。空缓存时页面因此保持空白。dedupe 时间在请求之前写入（`chat-client.tsx:543-551`），失败时也没有释放。Authenticated 路径同样把 `ensureProactiveChatGreeting` 的 `null` 当作无事发生（`services/chat/proactiveGreetingService.ts:203-230` 及其页面/API 调用方）。
- 主动欢迎生成器已经在同一冻结意图上尝试两次，之后严格失败（`services/ai/proactiveGreeting.ts:593-646`）。这证明欢迎语消失不是 strict parser 应被放宽，而是调用方没有把合法的 fail-closed 结果转换为可恢复的交付状态。

## Root Cause

三个责任边界分别为：

1. **Welcome delivery boundary**：生成层正确地 fail closed，但页面层把失败吞成“没有欢迎语”。“未生成”和“产品选择不显示欢迎语”没有可观察区别，且失败后的 dedupe reservation 阻断即时重试。
2. **First-contact transition boundary**：handoff 只定义“结束问候仪式”，没有定义“首次接触完成后由谁、用什么动作推进”。Planner 删除 acknowledgement 后留下空 actions；Surface 层再禁止自行补问题或入口。`questionPolicy` 是放大因素，但不能靠全局放宽解决，否则会重新引入连续采访和无依据提问。
3. **Identity authority boundary**：Grounding 只有一个 `identity.name`，把产品品牌和对话助手人格合并。Correction 只能撤回被拒绝命题，Planner 没有 canonical replacement identity 或 identity-continuation action。用户的“你可以有自己的名字”虽在语义上继续名字话题，却无法形成计划支持的助手身份建立或命名邀请。

因此，问题不是 strict parser、fail-closed 或不可变事件边造成的；这些边界只是让缺失的产品合同无法被模型临场绕过。真正缺失的是一条被 Planner 明确授权、由 Validator 验证的正向 first-contact / identity function。

## Proposed Solution

冻结一个三部分、但只有一条用户轨迹的最小切片：

1. **可恢复欢迎语交付**
   - 保持 proactive intent、Surface 和 semantic verdict 的 strict parser 与 fail-closed 不变；不得加入固定欢迎文案 fallback。
   - Guest 端将 greeting 请求结果改为 `committed | retryable_failure`，失败时释放本次 session dedupe reservation，并执行一次有上限的客户端重试；仍失败则使用现有 execution-status 区域显示“欢迎语暂未生成，可重试”，而不是空白。
   - Authenticated 服务同样返回可区分的结果，由页面或 messages API 保留一次后续重试机会；失败不得写 Assistant 消息、envelope 或 lifecycle state。

2. **分离产品身份与助手身份**
   - 将 Grounding 升级为两个不可混淆的事实：`product.name="慢聊小记"` 与独立的 `assistant.displayName`。普通“你叫什么名字”只回答助手名；询问产品时才回答产品名；“你是谁”可以组合助手名与 AI kind，但不把产品名冒充助手名。
   - 本切片应采用一个稳定、配置内冻结的默认助手名。不要每轮随机生成；随机名在没有持久状态时会破坏身份连续性。确切默认名是唯一需要产品方在 Developer 开始前冻结的内容。
   - 用户纠正“慢聊小记是产品名字”时，repair contract 同时拥有两类权威证据：用户确认的产品事实和 Grounding 中的 canonical assistant identity。回复先承认事实混淆，再给出正确助手名；不能退化成“我没有名字”。
   - 用户给出的别名可作为当前会话的普通 confirmed common-ground proposition 从不可变消息事件中重建；跨会话昵称记忆不属于本切片，也不新增 persistent lifecycle state。

3. **增加有证据的 first-contact / identity 正向动作**
   - 增加一个明确的 Planner action（建议名 `establish_assistant_identity`），其适用证据仅限：首次 simple greeting 的 reciprocal handoff，或当前用户明确延续助手名字/称呼话题。不得用词表、正则或固定句式识别；使用现有 target-bound relation、identity obligation/common-ground evidence。
   - 首次“你好”路径应在完成 `complete_reciprocal_contact` 后保留该独立 action，使 Surface 可以简短介绍助手身份，并在有 naming/first-contact evidence 时最多提出一个低压力问题。它不能退化为“还想聊什么”或随机转话题。
   - direct identity question 仍保持 `questionPolicy=none` 并先直接回答；Safety、pause、用户拒绝、已回答助手问题等现有 none 规则保持不变。只有上述 action 的 provenance 存在时，才允许 `optional_after_answer`。这修的是 action authority，不是全局放松 questionPolicy。
   - 为该 action 增加 positive-function validation：必须具体实现助手身份建立或当前名字话题的连续性；纯 receipt、echo、“嗯，听到了”、产品名冒充助手名、无依据随机改名均为失败。Validator 只接受/拒绝同一计划，不重规划。

最小验收按语义风险类别而非固定文案：欢迎成功、欢迎双次失败可见且零提交、首次 greeting reciprocal 有合法推进、直接助手名字、产品名字询问、产品/助手名纠错、用户允许或提供名字、普通 direct answer 不追加采访、pause/拒绝不提问、模型输出产品名冒充助手名时 fail closed。所有状态从当前消息和 committed immutable envelope/query 派生，不写持久 lifecycle state。

## Files To Change

- `conversation-os/control/types.ts`：拆分 product/assistant identity 类型；增加身份建立 action 与必要的 plan contract 类型。
- `conversation-os/control/assistantGrounding.ts`：分别提供产品名、稳定助手名和对应 disclosure。
- `conversation-os/control/responsePlanner.ts`：为有证据的 first-contact / identity continuity 选择正向 action，并只在该 action 有 provenance 时允许一次可选问题；identity repair 投影 canonical replacement。
- `conversation-os/control/interactionMoveHandoffPlanner.ts`：保持 reciprocal handoff 的 `optional_after_completion`，补充它只能由独立 identity/first-contact action 消费的合同测试；不全局放宽。
- `services/ai/promptBuilder.ts`：移除“你是慢聊小记”的身份混合；增加新 action 的 Surface 约束与 identity repair 约束。
- `services/ai/responsePlanValidator.ts` 及 interaction-move same-plan validator：验证 identity positive function、名称来源和 question provenance，不增加创作 fallback。
- `app/chat/chat-client.tsx`：不要吞掉 Guest greeting failure；释放失败 reservation、执行一次有上限重试并显示 retryable status。
- `services/chat/proactiveGreetingService.ts`、`app/chat/page.tsx` 及 greeting/messages 调用方：把 authenticated greeting 的 `committed | retryable_failure` 结果传到页面恢复路径，保持原子提交。
- 对应的 focused Conversation OS、proactive greeting、Guest/Auth delivery 和真实 Qwen 对抗回归脚本。
- `docs/ARCHITECTURE_V1_FINAL.md` 与 `docs/CONVERSATION_OS_CONTROL_CLOSURE.md`：把产品身份/助手身份、first-contact action 和 greeting delivery failure 写成明确合同。

## Risks

- 默认助手名属于产品身份决定，不能由工程实现者随意发明；未冻结确切值前只能完成结构，不能宣称身份验收通过。
- 若直接把 shared initiative、repair 或所有 greeting handoff 的 questionPolicy 放宽，会让普通确认、纠错和用户回答助手问题重新进入连续追问；必须绑定新 action 的 provenance。
- 固定欢迎文案 fallback 会绕开已经冻结的 proactive semantic contract；本方案只允许重试和可见失败，不允许失败内容提交。
- 每轮随机助手名会在没有持久身份状态时自相矛盾；跨会话自定义昵称需要 Memory/User Model 的独立产品切片，不能偷渡为 lifecycle state。
- 当前相关文件存在未提交改动。Developer 必须基于本分析只修改冻结文件并保留既有 PHM、strict parser、fail-closed、immutable event edge 和 no-persistent-lifecycle-state 变更。
