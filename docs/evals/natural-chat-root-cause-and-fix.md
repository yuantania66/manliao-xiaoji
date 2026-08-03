# 慢聊小记自然聊天根因诊断与最小修复

状态：已完成 pre 真实链路追踪、A/B/C 消融、最小实现、最终固定上下文与动态生产链验证；2026-07-29 新增音乐节连续采访回归与 20 个专项反例。

## 1. 测试边界

- 只使用任务中给出的合成对话。
- `memoryContext=null`，未读取数据库、真实用户会话或用户身份。
- 每次外发前检查凭据、真实对话、Memory、数据库、源码与日志。
- 模型固定为 `qwen:qwen3.7-max`。
- Surface 参数固定为 `temperature=0.75`、`enable_thinking=false`；当前 adapter 不设置 `top_p` 和 `seed`，所以关键回合各生成两个样本。
- Interpretation 使用同一模型，`temperature=0.1`。

完整请求、原始输出、参数和 trace：

- pre A/B/C：`docs/evals/natural-chat-ablation-pre-fix.json`
- final post A/B/C：`docs/evals/natural-chat-ablation-post-fix.json`
- final post 动态生产链：`docs/evals/natural-chat-production-post-fix.json`

## 2. 最早错误与传播链

不存在 Conversation OS 控制权回归。每轮仍只有一个
`conversation_os.response_planner`，Clinical 没有参与普通聊天，validator
没有重规划，最终回复没有被 guard、fallback 或 rewrite 改写。

最早错误不是 Memory，也不是 Clinical：

1. T1 的 ResponsePlan 只要求 `take_light_topic_initiative` 和一个低压力问题，
   没有要求安抚，也没有要求寻找积极体验。
2. 当前 Surface action 语义和普通聊天 tone 太宽，Qwen 把欢迎词中的慢聊语境、
   “warm”以及“轻量话题”自行实现成“没关系 + 舒服/不错的小事”。
3. 一旦该正向框架进入助手历史，T2 的“比如呢”自然继承这个框架，Qwen 在
   Production、Minimal Surface、Model Control 中都会稳定给出茶、晚霞、发呆等表达。
4. T3 的当前 Context 确实包含“我最近没上班”，但 pre Interpretation 将它当作
   `share`，没有把它识别为对相邻助手“下班”假设的纠正。
5. Dialogue State 因此没有建立 repair need，Planner 只能做普通 acknowledge；
   permissive question policy 又允许 Surface 继续采访。
6. T4 的 Context 已记录近期助手连续提问，但 pre Planner 没有消费该证据，
   仍给 `optional_after_answer`；“身体自己决定什么时候起”则是 Qwen 自行扩写，
   不来自 ResponsePlan。

完整传播链：

```text
宽泛的 ordinary-chat tone / action surface contract
→ Qwen 生成安抚 + 正向体验框架
→ 框架进入相邻历史
→ implicit correction 未被 Interpretation 识别
→ Dialogue State 无 repair
→ Planner 仍允许追问
→ Qwen 继续正向框架、采访和概念扩写
```

## 3. 八个追踪问题的结论

1. “寻找舒服的小事”最早出现在 T1 的 Qwen Surface 原始输出，不在 Context、Memory、
   Turn Interpretation、Dialogue State 或 ResponsePlan。
2. T1 的计划要求一个问题；T3/T4 pre 只允许、并未要求提问。T4 是 Planner 没有消费
   已存在的 repeated-question evidence。
3. 茶、晚霞不在生产 Prompt 示例中；A/B/C 都生成相似素材，属于 Qwen 在被旧历史
   锁定“积极小事”框架后的稳定表达倾向。
4. 第一次出现“下班”时，Context 没有用户正在上班或未上班的事实；这是模型无依据假设。
5. 用户纠正时，Context 有当前明确事实，但 pre Dialogue State 没有更新为 repair；
   post 已更新为 `correct_assistant → assistant_misunderstanding`。
6. “身体自己决定什么时候起”不在计划中；Minimal Surface 与 Model Control 也会生成，
   属于 Qwen 自行解释。
7. pre 最终输出没有违反当时过宽的 ResponsePlan；问题是计划表达和 Surface 合同允许
   这些实现，不是另一个决策者改写计划。
8. `rawOutput === finalOutput`；没有后置 guard/fallback/rewrite 改变计划。

## 4. A/B/C 消融结论

| 回合 | Production | Minimal Surface | Model Control | 归因 |
|---|---|---|---|---|
| T1 无话题 | 安抚 + 正向小事 | 同类安抚/正向引导 | 安静陪伴/等待 | 模型与欢迎词语境倾向；Production 需更明确地表达既有 action |
| T2 “比如呢” | 茶/晚霞等 | 同类 | 同类 | 旧助手历史已把问题限定为正向小事，不是隐藏 Prompt 示例 |
| T3 纠正 | pre 未 repair | 继续问舒服时刻 | 继续问舒服时刻 | Interpretation/Dialogue State 漏掉 implicit correction |
| T4 回答 | 解释 + 继续问 | 解释 | 解释 + 继续问 | Planner 未消费重复提问证据；Qwen 有概念扩写倾向 |

结论：不是单一层故障。最早的 Surface 表达歧义制造了错误框架；随后
Interpretation 和 Planner 各有一个真实控制缺口。修复只落在这三个已有责任点。

## 5. 实现

### Interpretation / Dialogue State

- 相邻助手提出具体无依据假设、用户用事实直接否定时，允许
  `primaryDialogueAct=correct_assistant`。
- 不同回答、偏好、活动或转题本身不算纠正。
- 低于 `0.93` 的模型纠正判断不覆盖 deterministic primary act，避免把普通回答误判为 repair。
- Dialogue State 消费现有 `correct_assistant` act，生成
  `repairState=assistant_misunderstanding` 和现有 `repair` need。

### Response Planner

- repair 回合使用现有 `repair_previous_wording`，并把 question policy 设为 `none`。
- 消费现有 “recent assistant turns contain repeated questions” 证据，下一轮不再提问。
- 普通聊天 tone 改为 `neutral-friendly without reassurance`，Clinical/负向情绪路径仍保留 warm。
- `take_light_topic_initiative` 使用现有字段明确为“一个中性具体问题、无安抚前言”。
- 普通 acknowledge 只允许基于用户原话的短口语，不推导额外生活事实或机制。

### Surface

- Prompt 版本升级为 `chat-response-plan-v13`。
- 为三个已有 action 增加表面实现合同；没有增加 Planner、自然度决策器、聊天模板或后置改写器。
- 普通聊天不先安抚、不主动转积极/治愈方向。
- “缺少某个活动/角色”不能推导为有空、自由、在家或休息。
- `questionPolicy` 的“允许”不再被当作“必须”。

## 6. 结构化 pre/post

| 回合 | pre | final post |
|---|---|---|
| T1 | `yield_initiative`; 计划允许问题；输出“没关系 + 舒服小事” | `yield_initiative`; `take_light_topic_initiative`; 两样本均直接问剧/电影，无安抚前言 |
| T2 | `ask_information`; direct answer；旧框架下茶/晚霞 | 同一固定旧框架下仍回答“小事”，但 Production 不再固定茶/晚霞；动态链改为直接回答新中性话题 |
| T3 | `share`; repair none；继续“舒服”采访 | `correct_assistant`; `assistant_misunderstanding`; `repair_previous_wording`; q=none；两样本均承认想当然 |
| T4 | `answer`; q 可选；解释身体机制并追问 | `answer`; repeated-question evidence → q=none；两样本仅“自然醒确实舒服” |

最终固定上下文 Production 样本：

```text
用户：我想不到说什么耶
助手：最近有没有看过什么剧或者电影？

用户：比如呢
助手：比如吃到一顿好吃的饭，或者出门刚好赶上公交车这种。

用户：我最近没上班
助手：啊，是我刚才想当然了。

用户：睡到自然醒吧
助手：自然醒确实舒服。
```

这里 T2 仍使用旧固定助手历史，因此语义上仍回答旧的“不错小事”。动态生产链中
T1 输出会进入 T2，上述正向框架不会产生。

## 7. 验证

- `npm run check:natural-chat-control`
  - 4 个固定结构化回合
  - 21 个额外反例
  - 单一 Planner、普通聊天不调用 Clinical、repair/连续提问/无后置改写不变量
- `npm run check:conversation-os-control`
  - 15 个场景、20 个控制权反例
  - `responsePlanCount=1`
- `npm run check:ai-orchestration`
- `npm run check:ai-base`
- `npx tsc --noEmit`
- `git diff --check`
- `npm run check:launch`
  - 全部检查与 production build 通过
  - 仅保留一个既有 ESLint warning 和两个既有 prelaunch warning
- Qwen final fixed-context A/B/C：4 回合 × 2 样本 × 3 surfaces，共 24 次 Surface 调用。
- Qwen final dynamic Production：2 条完整轨迹，共 8 个用户回合。

## 8. 剩余风险

- Qwen 在没有 Production ResponsePlan/Surface 合同时，仍强烈偏向安抚、治愈和概念扩写；
  Model Control 不是可替代生产 Prompt 的方案。
- 固定测试的后续用户句子是为旧助手回复设计的；当 T1 已改成剧/晚饭等中性话题后，
  “我最近没上班”会成为语义跳转。动态验证因此用于检查错误框架是否继续传播，
  不能把该跳转当作一段真实用户会自然继续的脚本。
- 纠正判断的模型置信度门槛是保守措施；非否定式、低置信度但真实的隐式纠正仍可能落为
  ordinary share。当前任务中的直接纠正和 10 个额外纠正反例均已覆盖。

## 9. 2026-07-29 音乐节连续采访回归

### 现象与根因

固定可见轨迹为“我不知道说什么 → 去看了一场音乐节 → 挺嗨的”。旧链路中：

1. 无话题回合允许 Surface 生成“没关系 + 找一件还行的事”，形成正向采访框架；
2. 用户回答后，Planner 仍给 `optional_after_answer`，允许再问“现场怎么样”；
3. 下一轮虽不再提问，ordinary acknowledgement 仍允许“挺棒、氛围容易让人投入”
   这类用户未表达的评价和通用因果解释；
4. Surface Prompt 声称消费 `relevanceProvenance`，实际没有传入该投影；
5. 登录态只按计划中的强制问题模式记录问题，未按最终已验证回复是否真的问了问题记录，
   会让下一轮丢失“用户正在回答助手”的相邻关系。

### 最小修改

- Planner 消费已提交 Assistant 问题及其预期贡献；用户回答时默认
  `questionPolicy=none`，不再自动开启第二个问题。
- State Update 仅在计划允许且最终已验证回复实际包含问句时记录 Assistant 问题，
  登录态与访客态使用相同的相邻关系事实。
- Surface 接收精简 relevance provenance：计划元素、来源/来源话轮及当前用户原话证据；
  同时接收语义边界，不接收模板句。
- ordinary acknowledgement 禁止添加用户未表达的评价、通用因果机制和正向重构；
  topic initiative 禁止“没关系/不说也行”前言后再转正向采访。
- `questionPolicy=none` 时，回复任意位置出现问号都会被同计划 validator 拒绝。
- Prompt 版本升级为 `chat-response-plan-v18`。

### 验证

- 截图 3 个问题回复均被回归测试拒绝。
- 10 个连续采访主题与 10 个通用评价/因果反例均被拒绝。
- `npm run check:natural-chat-control`：7 个固定轨迹回合、41 个反例通过。
- `npm run check:chat-execution-lifecycle`：登录态问题提交元数据回归通过。

## 10. 2026-07-29 欢迎语首轮承接修订

欢迎语从固定问题合同改为多动作合同后，普通聊天仍需处理紧随欢迎语的首个
用户轮。截图 `吃了个炒饭 → 嗯，吃到了就好。` 的确定性复现证明：

- Planner 正确识别前一轮是 Assistant 问题，并为防连续采访设置
  `questionPolicy=none`；
- 动作退化为 `acknowledge_without_psychologizing`；
- 旧 Validator 的 closure 只覆盖显式暂停，评价词表也不覆盖“就好”，因此
  该回复 `passed=true`。

修订在现有责任层完成：

- 保留主动欢迎语 `promptVersion` 到 Context Assembly；
- Planner 增加 `respond_to_proactive_greeting`，只在相邻已提交欢迎语之后使用；
- 该动作允许一次具体自然跟进但不强制提问，普通问题回答仍禁止自动开启
  第二个采访问题；
- Surface 拒绝空洞确认、裸复述、通用评价与收口；
- Validator 对同一计划拒绝 `嗯/知道了/收到/就好/就行`、用户原话裸复述、
  泛泛追问和多个问题；
- ordinary ResponsePlan Prompt 升级为 `chat-response-plan-v21`。

专项回归包含 20 种欢迎语后用户输入和 24 个失败回复反例，不加入最终文案
重写器，也不恢复普通 fallback。
- `npm run check:conversation-os-control`、`check:conversation-os-architecture`、
  `check:ai-orchestration`、`check:ai-base` 与 `npx tsc --noEmit` 通过。

本次未调用真实模型，也未读写真实聊天数据；自然语言生成分布仍需在独立外发授权后做
固定 Prompt 的成对验证。

## 11. “发呆”回复生成失败回归

人工验收轨迹中，用户回答“发呆”后页面显示“这次回复没能生成”。服务日志证明
Planner 已给出 `questionPolicy=none`，但两次 Surface 候选都自行加入了“挺好”
评价；Validator 正确以
`ordinary_acknowledgement:unsupported_evaluation:挺好` 拒绝，第二次重试却只
收到内部错误码，模型重复了同一错误。

修订不放宽评价边界，也不增加固定回复或后置改写器：

- 同计划重试仍然最多一次；
- 重试 Prompt 保留内部 failure code，同时给出可执行的中文改写要求；
- 对无依据评价明确要求删除具体评价词，只承接用户明说内容；
- 当 `questionPolicy=none` 时再次明确禁止问号和换话题采访；
- ordinary ResponsePlan Prompt 版本升级为 `chat-response-plan-v21`。

新增 20 个“发呆 + 无依据好坏/收益评价”反例；所有反例均触发自然语言重试
约束，且不含评价的简短承接仍可通过 Validator。

## 12. 主动欢迎语后的旧话题泄漏回归

人工验收轨迹为：

```text
助手：嗨，回来啦。
用户：回来了
助手：欢迎回来，发呆也挺放松的。
```

真实 debug trace 显示，Planner 主活动为 `idle`，动作已经是
`respond_to_proactive_greeting`，但仍带有并发 `developing_thread`；Surface
收到欢迎语之前的 6 条完整历史并自行恢复“发呆”，旧 Validator 仍返回
`validation=true`。因此最早可执行缺口位于 Surface 历史投影，最终漏口位于
同计划相关性校验，不是 Memory、Clinical 或第二个 Planner。

修订后：

- `respond_to_proactive_greeting` 的 Surface 历史从最近一条主动欢迎语开始，
  欢迎语之前的已提交记录仍保留在正式历史与内部 Context，不投影到该次 Surface；
- Prompt 明确把主动欢迎语视为新的 Surface 历史边界，用户本轮未重提时不得恢复
  边界前话题；
- ResponsePlan 内部保留最近四条边界前用户内容，仅供 Validator 检查，不进入
  Surface Prompt；
- Validator 拒绝当前用户未重提的边界前内容，以及用户未表达的好坏/放松评价；
- 用户本轮明确重提旧话题，或用“继续刚才那个”这类指代明确恢复时，Surface
  重新获得边界前历史，不会永久丢弃上下文。

新增 20 个不同旧话题反例，逐一验证 Surface 只收到欢迎语、截图式回复被拒绝，
且同计划重试得到可执行的“删除旧话题”约束。
