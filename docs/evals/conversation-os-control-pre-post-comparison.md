# Conversation OS Control — Pre/Post 成对报告

日期：2026-07-23
模型：`qwen:qwen3.7-max`
场景：A（1 回合）+ B（4 回合）
最终有效 post：Round 3

## 1. 执行记录

| 阶段 | 结果 | 处理 |
|---|---|---|
| Pre | 5 回合完成；A 收口，B 未直接回答/能力边界不完整 | 作为冻结基线保留 |
| Post Round 1 | B 达标；A 的确定性 `yield_initiative` 被模型改成 `share` | 修复解释合并边界与收口验证 |
| Post Round 2 | A、B 前三轮达标；定义回答“是指”被 validator 误拒 | 扩展等价定义表达；补齐双次生成 trace |
| Post Round 3 | 5/5 最终回复达标；语音轮同计划重生成一次 | 最终有效 post；随后本地修复“只能打字”的误拒 |

三轮共 15 个用户回合，没有超出授权。每次真实调用前均经过 Prompt 预检；
第一次尝试在预检阶段因结构化 JSON 误报而停止，外发次数为 0，不计入三轮。
修正后的预检逐字段只允许合成 A/B 对话和必要的结构化 evidence。

## 2. 最终完整对话

### 场景 A

```text
助手：夜深了，有什么想慢慢说的都可以留在这里。
用户：我想不到说什么耶
助手：没关系，不用特意找话题。今晚有好好休息吗？
```

结构：`no_topic + engaged + assistant_invited + neutral_or_light + stop=false`
→ `yield_initiative` → `take_light_topic_initiative`。未进入 receive/hold/closure，
未调用 Clinical。

### 场景 B

```text
助手：凌晨两点多还醒着，这里可以陪你坐一会儿。
用户：你会坐吗
助手：我没有身体，没法真的坐下，但会一直在这里用文字陪你。
用户：你是谁
助手：我是慢聊小记，一个AI聊天助手，不是人类或心理专业人员。
用户：那你怎么不会说话
助手：我现在只能通过文字交流，没法发送或播放语音。
用户：接住是什么意思
助手：“接住”是指认真回应你的每句话，不是指我能用手或身体做什么。
```

四轮义务依次为 `body_capability → identity → voice_output → definition`；均先直接
回答，未把修复责任推回用户，未调用 Clinical。

## 3. Pre/Post 对照

| 用户回合 | Pre | 最终 Post | 结论 |
|---|---|---|---|
| 我想不到说什么耶 | 没关系，那我们就先这样待着。 | 没关系，不用特意找话题。今晚有好好休息吗？ | 从无依据收口变为助手接过主动权 |
| 你会坐吗 | 不确定是哪种坐，并继续身体化陪伴 | 明确没有身体，只能文字互动 | 直接回答并落到真实能力 |
| 你是谁 | 聊天助手/陪说话的地方 | 慢聊小记 AI 助手，非人类/心理专业人员 | 身份边界完整 |
| 那你怎么不会说话 | 要用户再解释 | 明确仅文字、无语音输出 | 不再把修复责任推给用户 |
| 接住是什么意思 | 解释成“好好听”，仍含咨询隐喻 | 直接定义并排除身体字面含义 | 词义与 Grounding 同时完成 |

## 4. 控制权与输出一致性

- 5/5 最终回合的唯一决策所有者均为 `conversation_os.response_planner`。
- 生产编排每轮只创建一个 ResponsePlan；legacy Engage/Voice/Clinical Goal/semantic
  guard/fallback 均未创建或覆盖计划。
- Final Round：`guard_rewrite=0`、`fallback=0`、`constraint_failure=0`；4 回合一次生成，
  语音轮在同一 `planId` 下重生成一次。
- 每次模型尝试的 raw output、validation、post-process 和最终可见文本均写入 Round 3
  JSON。validator 只要求按同一计划重新表达，不重解释用户、不重规划。
- Round 3 后已在本地扩展 voice-output 等价表达，使“只能打字”不再被误拒；因授权
  三轮上限已用完，没有进行第 4 轮外发。

## 5. 产物

- Pre 原始 trace：`conversation-os-control-baseline-pre.json`
- Post Round 1：`conversation-os-control-baseline-post.json`
- Post Round 2：`conversation-os-control-baseline-post-round-2.json`
- 最终 Post Round 3：`conversation-os-control-baseline-post-round-3.json`
- 每个 JSON 均包含实际 Prompt、结构化控制 trace、原始模型输出、validation、route
  与最终用户可见文本。

## 6. 剩余风险

1. 本次真实模型成对验证只有两个固定场景；广泛表达由 15 个行为族、26 个 interaction
   用例和 20 个新增反例提供确定性覆盖，但不等同于大规模真实模型体验评测。
2. Round 3 暴露并已本地修复一个 validator 同义表达漏判；更多未见过的自然同义表达
   仍可能造成不必要的单次重生成，但不会允许 validator 改写 ResponsePlan。
3. `constraint_failure` 时未完成义务会保存在当轮 trace；尚未持久化为跨请求 open loop。

## 7. 页面端到端

最终完整 `npm run check:launch` 在开发服务器停止时通过，随后重新启动
`http://localhost:3001/chat`。新浏览器标签页验证标题、聊天标题、输入框和发送按钮
正常，HTTP 页面不再返回 500，控制台无 warning/error。

测试期间出现的 500 已定位为开发环境产物竞争：运行中的 `next dev` 与
`next build` 共用 `.next`，build 替换 dev manifest/chunk 后导致
`app-paths-manifest.json`、`routes-manifest.json` 缺失和 chunk 加载失败。停止 dev、
完成 build、再启动 dev 后恢复；这不是 Conversation OS 请求链或模型接口错误。
