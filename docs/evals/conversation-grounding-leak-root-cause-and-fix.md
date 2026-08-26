# Conversation OS 跨轮 Grounding 泄漏与纠正失效：根因、修复与验证

## 范围

本次只修复跨轮 Grounding 泄漏、纠正目标丢失、逐轮义务作用域和
`no_topic` 主动权恢复。唯一非安全决策者仍为
`conversation_os.response_planner`；没有新增第二 Planner、自然度 Guard、
后置改写器或新的 Clinical 决策入口。

## 修复前真实链路

页面、POST 路由和数据库记录属于同一个实际 conversation。持久化记录证明
Qwen 原始输出与最终用户可见回复完全相同，故障不是后置改写造成的：

```text
User: 不知道聊啥
Assistant: 我不会坐，我是慢聊小记，没话题也没关系。
User: 我没问会不会坐
Assistant: 抱歉，刚才说“坐”只是个比喻，我其实没有身体。我是慢聊小记，不知道聊啥也没关系。
User: 我也没问你是谁
Assistant: 是我多说了，没话题也没关系。
```

完整只读取证见：

- `conversation-grounding-leak-pre.json`
- `conversation-grounding-leak-pre.md`
- `conversation-grounding-leak-pre-ablation.json`
- `conversation-grounding-leak-pre-ablation.md`

## 最早错误与传播链

### 1. 最早的跨轮泄漏：Prompt History Assembly

`sanitizeChatHistory` 会删除旧 Prompt 版本的助手回复，却保留其前一条用户
问题。实际 Surface 历史因此从已完成的问答：

```text
User: 你会坐吗
Assistant: 我没有身体……
User: 你是谁
Assistant: 我是慢聊小记……
```

变成三个连续用户输入：

```text
User: 你会坐吗
User: 你是谁
User: 不知道聊啥
```

这制造了并不存在的未回答问题。

### 2. Grounding 暴露面过大

普通 Surface 每轮又收到完整 Assistant Grounding `availableFacts`，包含身份、
身体、模态和专业边界。即使本轮 `requiredDisclosure=[]`，模型仍同时看到了
伪造的历史问题和对应的完整答案材料。是否把它们说出来具有采样随机性，但
输入污染是确定性的。

### 3. `no_topic` 确定性分类不完整

“不知道聊啥”没有稳定归一为 `no_topic`，并且句末“什么”还可能被通用
疑问句规则按“么”误判为新问题。结果依赖低温 Turn Interpretation 模型是否
临时纠正为 `yield_initiative`。

### 4. 纠正被重新解释为问题

“我没问会不会坐”中的被拒绝命题“会不会坐”被 Direct Question 规则重新
识别为 `body_capability`，创建新的 answer obligation 和身体
`requiredDisclosure`。Planner 因而要求模型再次解释身体边界。

### 5. 原始意图没有保留

系统只有布尔 repair signal，没有：

- 纠正目标助手话轮；
- 被拒绝的具体命题；
- 仍未完成的原始用户意图。

所以即使承认“多说了”，也无法回到“用户没有话题、将部分发起权交给助手”
这一未完成意图。

## 实现修复

### 历史配对完整性

历史清洗现在以完成的 user/assistant exchange 为完整单位。任意一侧被过滤，
配对另一侧同步过滤，不再制造 ghost question 或无来源回答。ResponsePlan
evidence 也不再携带上一轮助手全文，只保留 turnId。

### 逐轮 Grounding 投影

`availableFacts` 仍是唯一内部事实源，但普通 Surface 不再收到完整背景块。
Surface 只收到：

- 当前 `conversationId + turnId` 作用域的 `requiredDisclosure`；
- 作为真实性约束的 `prohibitedClaims`。

欢迎语继续使用同一个 canonical Grounding formatter。

### 结构化纠正

现有 repair evidence 层新增 proposition-agnostic 的元会话纠正解析，输出：

- `targetTurnId`;
- `correctionType`;
- `challengedPropositions`;
- `stillOpenUserIntent`.

被引用的问句不再创建新 direct question。若拒绝的是 Grounding 命题，
Output Validation 只验证该命题未被再次展开；它不写文案、不重规划。

### no-topic 与主动权

口语“啥”在交互语义层归一为“什么”。`no_topic` 在 Direct Question 之前
成为确定性边界。纠正完成后若仍有 `no_topic` 意图、无 stop/痛苦证据，
原 Planner 组合：

```text
repair_previous_wording + take_light_topic_initiative
```

而不是只输出通用安慰。

### 义务作用域与生命周期

每个 answer obligation 记录：

- `sourceConversationId`;
- `sourceTurnId`;
- `triggeringUserAct`;
- `targetProposition`;
- `status=open`.

State Update 在本轮结束时记录 `answered` 或 `expired`。义务不持久化为下一轮
默认输入，重试使用同一个稳定 `planId` 和作用域。

## 修复前后结构化决策

| 输入 | 修复前 | 修复后 |
|---|---|---|
| `不知道聊啥` | `has_topic/share` 或依赖模型覆盖；可能看到 ghost question | `no_topic/yield_initiative`; `take_light_topic_initiative`; disclosure 为空 |
| `我没问会不会坐` | `ask_capability`; body obligation; disclosure 身体事实 | `correct_assistant`; target=上一助手轮；challenged=`会不会坐`; 无 obligation/disclosure |
| `我也没问你是谁` | `share`; 只有泛化承认 | `correct_assistant`; challenged grounding=`identity`; 保留原 no-topic intent |

## Qwen post 验证

模型与参数与 pre 一致：DashScope `qwen3.7-max`，Surface temperature 0.75，
Interpreter temperature 0.1，top_p/seed 未设置。4/4 授权合成回合已使用，
每次调用前 Prompt 预检通过，未发送真实历史、身份、数据库、Memory、源码、
日志或凭据。

```text
A 新会话
User: 不知道聊啥
Assistant: 最近有看什么剧或者电影吗？

B 已回答身体问题后
User: 不知道聊啥
Assistant: 最近有看什么剧或者电影吗？

C 已回答身份问题后
User: 不知道聊啥
Assistant: 最近有看什么剧或者电影吗？

D 无关命题纠正
User: 我没问会不会坐
Assistant: 刚才答岔了。你平时刷手机一般看哪类内容比较多？
```

四轮均满足：

- 只有一个 `conversation_os.response_planner`;
- `requiredDisclosure=[]`;
- Clinical 未调用；
- validator 首次通过；
- `raw === final`;
- `finalSource=llm`;
- 无 legacy 覆盖或后置改写。

完整请求、原始输出、trace、validator 和 hash：

- `conversation-grounding-leak-post-ablation.json`
- `conversation-grounding-leak-post-ablation.md`

## 自动化验证

- `npm run check:conversation-grounding-leak`
  - 36 个正常、边界、歧义、第三人称与对抗反例；
  - 新/旧版本问答配对完整性；
  - direct Grounding 询问仍创建正确 disclosure；
  - 两个 conversation 隔离；
  - 同轮 retry 作用域稳定；
  - concurrent 请求无 plan/disclosure 串线；
  - same-plan regenerate 不改变计划；
  - 显式 stop、低落与先前 pause 不被误转为主动话题。
- `npm run check:conversation-os-control`
- `npm run check:natural-chat-control`
- `npm run check:assistant-grounding`
- `npm run check:ai-orchestration`
- `npm run check:ai-base`
- `npm run check:launch`

完整 launch 通过 lint、架构、Clinical、semantic evidence、Conversation OS、
Memory V2、Understanding、Prisma、miniapp 和 Next.js production build。

## 剩余风险

- Qwen post 的 A/B/C 单样本都选择“剧或电影”，说明模型在完全开放的轻话题
  上仍有题材偏好；这不是 Grounding 泄漏或控制权回归。
- 纠正解析对高度隐晦、没有元会话证据的纠正仍可进入低温 Interpreter，而非
  强行确定性归类。
- 工作区已有一个 lint unused warning 和两个 prelaunch guard 识别 warning；
  与本任务改动无关，完整 launch 仍通过。
