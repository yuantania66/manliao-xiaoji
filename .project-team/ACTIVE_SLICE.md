# 当前交付切片

- 名称：P0–P6 Overnight Local Delivery Audit — Active / Externally Blocked。
- Outcome：在不接触生产数据、真用户流量、合入或部署的前提下，连续完成可本地证明的 P0–P6 工作，并把修复额度用尽、直接授权、凭据和三自然日时间门如实记录。
- Acceptance：
  1. 每个封存切片必须有冻结合同、本地或隔离 PostgreSQL 证据、反例挑战及独立复核。
  2. 两轮 repair 后仍失败的门必须 STOP，不得用第三轮案例、提示词或自签权威伪装通过。
  3. Composer 真实 Qwen、人工盲评和三个不同自然日 Hot 观测只能以真实外部证据升级；没有凭据、真实日期或可信来源时保持 pending。
  4. 所有候选保持隔离，不 push、merge、deploy，不读取生产或真实用户数据。
- Allowed scope：隔离 worktree、合成 fixtures、本地/隔离 PostgreSQL、local/eval-only authority、治理台账。
- Non-goals：生产 route/scheduler、真实用户镜像、生产数据库、默认开启、合入、部署或删除真实数据。
- Baseline：主候选封存链为 `aadc62d -> ed0cc19 -> 05f8329 -> d6741d4 -> f6268ab -> e42d1da -> ee5ed04 -> bb1852d -> e9f6740 -> 249be49`。P5 独立封存提交为 `3e1844c`；P6 独立封存提交为 `d7dd07b`。所有 `node_modules` 与生成 Prisma client 均排除。
- Roles：主线程 Delivery Lead；每个实现切片一个 writer；Independent Functional Reviewer 与 Safety/Privacy Reviewer 只读复核。
- Round budget：每个冻结门一次实现、最多两次 repair；随后仍失败则 STOP。
- 当前状态：
  - P0：本地基线封存。
  - P1：local/eval authorities、Ledger 与 Exit Evaluator 封存；真实 Qwen、人工盲评、production-like isolation 与三自然日/200 Hot 时间门 pending。当前环境 `QWEN_API_KEY`、`DASHSCOPE_API_KEY` 与区域 Base URL 均未配置。
    - Real-Qwen 机制 runner 已补齐 authoritative 12 ordinary × 3 独立尝试；mock 只能产生 mechanism-only，真实结果仍须 Ledger Authority 验证。隔离提交 `e9f6740`，clean worktree 全量 TypeScript/ESLint/diff PASS。
  - P2：Winner Skeleton 封存于 `ee5ed04`。
  - P3：default-off Safety Trunk + canonical HardFacts Surface Authority 封存于 `bb1852d`。
  - P4：Eligibility & Read Integrity 旧 41 门与 Profile Cache Commitment 新 27 门均通过 fresh PG、静态门及功能/Safety 双复核，封存于 `249be49`。
  - P5：Deletion Cascade Authority 已完成 41-case、fresh PG 15 migrations、功能与 Safety 双复核，封存于独立提交 `3e1844c`。
  - P6：Principal & Cache Time Integrity Authority 已完成 old47/new14/repair5、fresh PG 15 migrations、功能与 Safety 双复核，封存于独立提交 `d7dd07b`。
  - 当前不可继续项仅属于 P1 外部证据：Composer 仍需要本地凭据、人工证据和三个真实自然日。
