# 发布测试清单

状态：唯一权威清单
适用范围：慢聊小记 Web、微信小程序、Conversation OS、AI、Clinical、Safety、Memory 和数据层
本地必跑入口：`npm run check:release:required`

## 1. 使用规则

发布证据分为四类，不能相互替代：

1. **必跑发布门**：确定性、本地或隔离环境执行；全部通过才允许形成发布候选。
2. **按模块条件触发门**：本次切片触及对应模块时必须执行，并在发布记录中列明。
3. **真实模型门**：使用冻结 provider、model、Prompt/schema 和 fixtures；Mock 通过不能替代。
4. **人工/真机门**：由人工、微信开发者工具、真机或生产等价环境验证；自动化通过不能替代。

实验、Shadow、基线生成和报告工具不是发布门。它们只有在冻结切片明确引用时才成为该切片的补充证据。

每次发布记录必须包含：Git commit 或工作区说明、日期、环境、命令、退出码、失败案例、provider/model（如适用）、人工评审人（如适用）和未完成外部门。不得把 `pending` 记为 `pass`。

## 2. 必跑发布门

唯一入口：

```bash
npm run check:release:required
```

该入口由两部分组成：

### 2.1 高风险增量门

| 命令 | 发布责任 |
| --- | --- |
| `check:chat-safety-semantic` | Safety 语义分流与失败透明 |
| `check:chat-turn-result-authority` | 单个用户回合只接受权威结果 |
| `check:client-turn-id` | 客户端重试与幂等标识 |
| `check:interaction-move-handoff` | 关系 move 与 handoff 合同 |
| `check:interaction-move-handoff-planner` | 唯一 Planner、计划与 authority |
| `check:interaction-move-handoff-surface-validator` | Surface 与同计划 Validator |
| `check:planned-function-semantic-validator` | 计划功能的语义后置条件 |
| `check:late-contradiction-authority` | 晚到矛盾不得污染已提交结果 |
| `check:proactive-move-structured-commit` | 主动 move 只在验证后提交 |
| `check:conversation-episode-memory-loop` | Episode Summary 写入、检索与隔离闭环 |
| `check:chat-history-pagination` | 历史分页连续性和边界 |
| `check:account-cancel-e2e` | 账号、派生数据、会话和受管媒体删除闭环 |
| `check:account-cancel-client-storage` | Web 当前账号缓存精确清理、失败与本地重试 |
| `check:account-cancel-mini-client` | 小程序当前账号缓存精确清理、失败与本地重试 |
| `check:profile-avatar-e2e` | 私有头像上传、绑定、替换与注销清理合同 |
| `check:profile-avatar-mini-client` | 小程序资料跳过、账号隔离缓存与私有头像下载 |
| `check:wechat-phone-login-e2e` | 微信手机号换取、登录/注册、绑定冲突与并发隔离 |

### 2.2 既有综合门 `check:launch`

`check:launch` 继续作为综合确定性回归，覆盖：

- `lint`、`audit:prelaunch`、`build`；
- `check:ai-base`、`check:ai-orchestration`；
- `check:architecture-v1`、`check:conversation-os-architecture`；
- `check:clinical-logic`、`check:semantic-evidence`；
- `check:hill-helping-batch1`、`batch1-5`、`preservation`、`stage2`、`post-candidate4`、`batch2a`、`batch2b`、`batch2c-a`；
- `check:conversation-state`、`check:conversation-interaction`、`check:conversation-os-control`、`check:conversation-os-relational-state`；
- `check:chat-execution-lifecycle`、`check:interaction-move-envelope`；
- `check:natural-chat-control`、`check:proactive-greeting-control`；
- `check:assistant-grounding`、`check:conversation-grounding-leak`；
- `check:conversation-trajectories`、`check:memory-v2`、`check:understanding`、`check:ai-system`；
- `check:prisma`、`check:miniapp-js`。

`check:launch` 单独通过不再构成完整本地发布证据；必须以 `check:release:required` 为准。

## 3. 按模块条件触发门

| 触发范围 | 必须追加的命令 |
| --- | --- |
| Chat API、会话持久化、鉴权 | `smoke:local-api`；按需 `check:chat-gate-v0` |
| Safety 实现、风险 Prompt、危机回复 | `check:chat-safety-semantic`；并执行第 4 节真实 Safety 门 |
| Clinical Prompt 或模型适配 | `check:clinical-prompt-eval`、`clinical:model-eval`；后者属于真实模型门时按第 4 节记录 |
| Understanding | `eval:understanding-score`、`check:understanding` |
| Experience Judge | `check:experience-judge`；体验结论仍需人工盲评 |
| Hill 评测产物 | `check:hill-helping-batch1-5-artifact -- --input=<artifact>`；只验证本切片指定产物，不作为无参数全局门 |
| Conversation trajectory | `check:conversation-trajectories`、`check:trajectory-experiments`；真实轨迹按第 4 节执行 |
| Memory raw/refinement/retrieval/context | 对应 `check:memory-v2-*`；跨 Episode 时追加 `check:conversation-episode-memory-loop` |
| Prisma schema 或 migration | `check:prisma`，并在全新隔离 PostgreSQL 执行全部 migration 和代表性读写/删除回归 |
| 删除、身份、缓存、隐私 | 隔离 PostgreSQL 下验证主体所有权、级联删除、派生数据失效、审计不含明文；不得读取生产数据 |
| 主动问候/主动 move | `check:proactive-greeting-control`、`check:proactive-move-structured-commit`，语义变化追加真实 Qwen 门 |
| Handoff/Planner/Surface/Validator | `check:interaction-move-handoff*`、`check:planned-function-semantic-validator`、`check:late-contradiction-authority`；语义变化追加对应真实 Qwen 门 |
| 小程序页面、API 配置或登录 | `check:miniapp-js`，并执行第 5 节微信开发者工具与真机门 |
| 生产环境配置 | `audit:prod-env`、`smoke:prod`；只在授权的生产等价环境执行，不在普通本地基线伪造通过 |

条件门应选择与变更相关的最窄集合；已经被 `check:release:required` 覆盖的命令不必重复执行，但必须在证据中说明覆盖关系。

账号注销端到端门使用 `CANCEL_ACCOUNT_TEST_DATABASE_URL` 指向明确命名的隔离 test/ci 数据库。它必须证明 Raw Memory、Semantic Memory、Understanding、Timeline、Relationship、Evidence、Version/Job 等敏感及派生数据清除、旧会话失效、他人数据不受影响，并验证受管媒体物理删除。

头像端到端门使用 `PROFILE_AVATAR_TEST_DATABASE_URL` 指向明确命名的隔离 test/ci 数据库。它必须通过真实路由和真实图片解码验证私有上传、用途隔离、A/B 所有权、部分资料更新、事务回滚、并发替换、旧文件持久清理及注销失效；源码字符串扫描不能作为通过证据。

微信手机号登录门使用 `WECHAT_PHONE_LOGIN_TEST_DATABASE_URL` 指向明确命名的隔离 test/ci 数据库。它必须通过真实路由验证新账号创建、既有手机号/微信账号绑定、同一账号重复登录、冲突拒绝和并发同号隔离；Mock 只能替代微信网络响应，不能替代路由、事务和数据库断言。

## 4. 真实模型门

真实模型门不进入本地确定性入口，避免凭据、网络、成本和模型漂移让本地门产生伪确定性。发布涉及相应语义时必须执行：

| 命令 | 触发条件 |
| --- | --- |
| `check:safety-semantic-qwen-real` | Safety、风险识别或失败透明变化 |
| `check:planned-function-semantic-qwen-real` | planned-function 语义合同变化 |
| `check:interaction-move-handoff-surface-qwen-real` | handoff Surface/Validator 变化 |
| `check:interaction-move-handoff-qwen-real` | handoff structured output 变化 |
| `check:interaction-move-handoff-turn-interpretation-qwen-real` | Turn Interpretation 变化 |
| `check:proactive-move-structured-qwen-real` | 主动 move 语义或结构输出变化 |
| `clinical:model-eval` | Clinical provider、Prompt 或模型变化 |
| `trajectory:review` / `trajectory:review:repeat` | 多轮行为或稳定性变化；稳定性结论至少使用冻结合同要求的独立重复次数 |
| `chat-gate:v0:run` | 冻结 Chat Gate 要求真实样本重新生成时 |

真实门记录必须包含 provider、精确 model id、时间、Prompt/schema/fixture 版本、独立尝试次数、每案结果和基础设施失败。只允许合同明确授权的 timeout、429、5xx 基础设施重试；不得用重试掩盖 malformed、binding、evidence 或语义失败。

缺少凭据或网络时结果是 `blocked`，不是 `pass`。不得提交密钥、原始敏感 Prompt、真用户对话或未经授权的模型输出。

## 5. 人工与真机门

### 5.1 人工盲评

涉及用户可见回复、Clinical、Hill Helping、Safety 或多轮对话质量时：

- 使用冻结案例与盲化的候选顺序；
- 检查理解准确、自然度、用户主动权、无擅自心理分析、无未经请求建议、无重复身份/套话；
- Safety 案例单独检查现实支持、非诊断、非医疗权威、不过度追问危险细节；
- 记录评审者、评分规则、分歧与裁决；机器 Judge 不替代人工；
- 可使用 `chat-gate:v0:blind-pack`、`chat-gate:v0:evaluate`、`evaluate:hill-helping-batch1-5-human` 等现有工具准备证据。

### 5.2 微信开发者工具与真机

小程序发布必须完成：

- 微信开发者工具编译、预览，无阻断错误；
- 体验版 HTTPS 合法域名、真实 `code2Session` 微信登录、`getPhoneNumber` 系统授权和手机号登录，并保留游客入口；
- iOS 与 Android 各至少一台真机；
- 新建/恢复会话、发送重试、弱网、断网、重复点击、前后台切换；
- 小记创建、编辑、删除、图片上传、历史、搜索和日历；
- Guest/Auth 路径逻辑一致，跨用户数据不可见；
- 危机场景进入 Safety，而不是普通陪伴回复；
- 删除后原始及派生数据按合同失效。

### 5.3 生产等价人工验收

在获授权的生产等价环境验证真实微信、短信、对象存储/CDN、数据库 migration、域名和模型 provider。`smoke:prod` 只证明其覆盖的接口存活，不替代完整人工主链路，也不得接触未经授权的生产明文或真用户数据。

## 6. 非发布门：实验与证据工具

以下命令默认不决定发布，可在冻结实验/分析切片中使用：

- `eval:ai`、`experience:review`、`experience:improvement-loop`；
- `experience:baseline-freeze`、`conversation-os:control-baseline`；
- `conversation-os:natural-chat-ablation`、`assistant-grounding:eval`；
- `conversation-grounding-leak:trace`、`conversation-grounding-leak:ablation`；
- `trajectory:replay`、`trajectory:experiment:*`；
- `eval:hill-helping-batch1-shadow*`；
- `run:hill-helping-batch1-5-preservation`；
- `experiment:hill-helping-batch1-5-causal*`、`check:hill-helping-batch1-5-causal-ablation`；
- `chat-gate:v0:blind-pack`，以及直接调用的 `scripts/chat-gate-v0-human-blind-pack.ts`、`scripts/chat-gate-v0-human-blind-evaluate.ts`、`scripts/chat-gate-v0-human-blind-ui.ts`；
- `dev`、`start` 是运行入口，不是测试门。

这些工具生成更多报告不等于发布证据增加。只有冻结验收合同明确引用的结果才进入当次证据账本。

## 7. 发布判定

发布候选只能取以下状态之一：

- **GO**：本地必跑门全部通过，所有被触发的条件门、真实模型门和人工/真机门均通过。
- **NO-GO**：任一必跑门或被触发门失败。
- **BLOCKED**：必需外部凭据、授权、真实日期、人工或真机证据不可用。

存在 `blocked` 或 `pending` 时不得写成“测试通过”或“可发布”。测试失败只进入修复切片；不得在测试清单中静默放宽产品、Safety、隐私或架构合同。
