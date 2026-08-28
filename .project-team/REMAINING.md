# 剩余事项

- Composer Shadow V1 的 local/eval-only replay、Snapshot/Outcome/Ledger authorities、P1 Exit Evaluator 与 12 ordinary ×3 runner mechanism 已依次封存，runner 提交 `e9f6740`。真实 Qwen 36 次已执行但 36/36 `malformed`；脱敏 diagnostic 证明模型返回合法 JSON，却采用自创 input-mirroring keys，根因是 Prompt 未提供冻结7字段 schema。需要新的 Composer Output Schema Prompt Authority，不能对失败门直接做第三轮 Prompt；之后才可重跑12×3。人工盲评、V1/Shadow equality、production background/low-privilege telemetry、三自然日/200 Hot 与 bootstrap 仍 pending。

- Frozen Snapshot 的历史 STOP 已由新独立 V1 Execution Outcome Integrity Authority V1 关闭：FAILED winner/edge 必须为 null，COMMITTED winner/failure/retryable 约束成立，六类既有 P0 failure code 为冻结枚举；Snapshot 只消费 strict-valid authority output。仍不得接入生产；三自然日/200 Hot、production background 与 low-privilege telemetry 继续 pending。

- Conversation Purpose Stage 1、Stage 2A 与独立 Subject-Ownership Authority V1 已封存于隔离提交 `05f8329`：生产默认无 provider；真实 Qwen 固定 9 类 9/9；无中文词序/话题词表、持久化、Surface 或 Planned Function 扩张。

- P0 Current Baseline 已在隔离分支 `codex/p0-current-baseline-20260824` 提交 `aadc62d`；完整本地/真实门与 Independent Review PASS，`node_modules` 未纳入，未 push/merge/deploy。

- Episode Memory 结构检索稳定性已在隔离候选提交 `ed0cc19`：仅 topics 支持长度至少 2 的双向复合包含（如 `工作` ↔ `工作压力`）；people/emotions 继续 exact。相关/无关/单字、跨用户、当前会话、最多 3 条与 Planner 0/1 边界通过本地门及双重独立复核；无 schema、持久化、生产读取、词表或 hypothesis 因果升级。

- P2 Winner Skeleton 已封存于隔离提交 `ee5ed04`：独立 `AssistantPublication` 五态、tenant复合FK、单winner、lease/fencing、draft CAS、content tombstone与DB failure enum通过全新隔离PostgreSQL及双重独立复核。仍未接生产route；P3才可消费其接口，P5仍负责完整retention/visibility/index/Memory cascade。

- P3 Safety Trunk + HardFacts Surface Authority 已封存于 `bb1852d`：default-off、input/output Safety、canonical hard facts、Memory isolation、INV-1/2、first-safe metric 与 commit retry 分类通过专项及双重独立复核；仍未接 production route 或真实用户。

- P4 Minimum Memory 已封存于 `249be49`：Eligibility/Read 41 门与 Profile Cache Commitment 27 门、fresh PG、TypeScript、ESLint、diff-check 和双重复核 PASS。仍未授权生产 runtime 接线、持久 HMAC key/multi-instance 策略、真实数据或部署；这些不影响 local/default-off 封存。

- P5 Deletion Cascade Authority 已在独立提交 `3e1844c` 封存：41 ID、fresh PG 15 migrations、不可逆 tombstone、精确 SourceEdge、CAS/崩溃/deadline/audit 及双重独立复核 PASS。仍未授权/完成物理删除、法律保留、生产 route/scheduler/SLA 或真实用户数据。

- P6 Principal & Cache Time Integrity Authority 已在独立提交 `d7dd07b` 封存：Session 派生身份、可信认证时钟、process-local HMAC 时间/内容 commitment、old47/new14/repair5、fresh PG 与双重独立复核 PASS。生产密钥生命周期、多实例共享以及真实 P4/P5 接线仍 pending。

- Safety Semantic Triage & Failure Transparency 已连同 Subject-Ownership Closure 封存：deterministic 只接受无主体标记的已实施行动；意图、第三方归属及所有带 Unicode 标点/符号的主体歧义输入进入 semantic triage。真实 Qwen 22/22、独立工程与 Safety/Privacy 复审均 PASS；未新增词表、持久状态或数据访问。

- Guest First-Contact User Topic Choice + Validator Authority 已完成：纯 reciprocal plan 为 `responseActions=[]`，handoff 允许完成后一次低压力话题选择；canonical `not_satisfied` 与双问题不再被 advisory 吞掉。完整真实 Qwen Surface/Validator 门通过，未新增第二模型调用、词表、持久状态或数据访问。

- Proactive Clarity / Committed-Claim Repair / Idle Arbitration 已连同 Current Authority Closure 封存：主动清晰度、exact claim binding 与 idle 仲裁全部通过；模型不得自行选择历史 claim，且没有新增短语规则、持久 lifecycle state 或 Validator 放宽。

- PHM-B Planner runtime 与独立 PHM-B-AUTH 信任边界已通过并作为同一检查点封存；Planner 已消费 PHM-A relation，且 exact preflight 不再信任可协同篡改的 plan 内部自证。
- PHM-C Prompt/Surface realization、same-plan semantic Validator 与 PHM-D ordinary committed `fulfills`/`handoffCompleted` 已通过专项、独立验收与完整发布门并封存。
- PHM-E Safety `supersedes`、`handoffSuperseded`、`handoffResolved` 与
  `activeHandoff` 已通过 repair pass 1、独立 Reviewer `PASS` 与最终 `npm run check:launch`（exit 0）并封存；无持久 lifecycle state。仅待主线程 Git seal。
- PHM-C Validator Structured Output Reliability 已封存：Qwen structured call 的 strict exact-schema JSON 可靠性通过真实门；模型语义校准仍是独立未授权切片，不属于本次结构化输出交付。
- PHM-C reciprocal-contact Semantic Calibration 已封存：合同一致释放/过渡正例稳定通过，重复问候与四类对抗反例继续 fail closed；其他 handoff functions 的新语义问题仍需独立授权。
- PHM-A reciprocal/unclear candidate reconciliation 已封存：真实同 target reciprocal 不再被合并器自产的 adjacency fallback 污染；真实歧义与无效模型输出仍 defer。其他 relation/function 的新问题不属于本切片。
- PHM-A candidate specificity、Planner composition 与 PHM-C reciprocal Surface 的旧未封存状态已被 Guest First-Contact User Topic Choice + Validator Authority 取代：正向 user-topic-choice Surface 稳定通过，重复问候等反例 fail closed。
- Chat Turn-scoped Execution Status 已完成。对历史 `小时很多啊` 记录的后续只读审计确认：仓库未保留 source Assistant、候选文本和逐候选原因，不能诚实重建 exact trace；且当前已封存策略把 `continue_user_introduced_content` 的 function 不足保留为 advisory winner、同时 `handoff=null`，历史 hard fail 不再证明现行 runtime 缺陷。无证据支持修改 Prompt/Planner/Validator；若未来出现新的脱敏完整 trace，再按新切片判断。
- Proactive Move Structured Contract 已封存：typed intent、Surface、独立 semantic verdict、proactive envelope v2、Auth/Guest structured history、v1 legacy read-only、动态 commit/rollback、真实 Qwen 12 类矩阵、完整发布门与独立 Reviewer 全部通过；无持久 lifecycle state。人工体验只确认产品感受，不再承担语义覆盖。
- 项目角色代理尚未实例化；后续交付切片只有在任务可独立分工且用户或项目规则允许时才创建。
- 本目录不复制根目录历史账本中的工程剩余项；实现路线和既有未完成边界继续以根目录 `PROJECT_TEAM.md` 及权威产品、架构文档为准。
- 每次开始新交付切片时，更新角色状态、负责人、文件写入边界和证据台账。
