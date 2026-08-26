# 当前交付切片

- 名称：PHM-A Reciprocal/Unclear Candidate Reconciliation。
- 交付结果：真实主动问候后的明确 reciprocal relation 不再被自动 adjacency fallback `unclear` 污染；Planner 可选择 `complete_reciprocal_contact`，而真实歧义仍 defer。
- 用户价值：用户回复“嗨”等简短回礼时，系统不再错误回到“嗨，在呢。”的重复问候/在场声明。
- 验收标准：报告场景先复现 `[reciprocates_move, unclear]` 与 defer；修复后仅保留有效 same-target model reciprocal 并产生 `complete_reciprocal_contact/fulfill/optional_after_completion`；模型失败/无效/错 target、模型自身 unclear、多关系真歧义继续 defer；topic redirect、question greeting、direct question、boundary、repair 保持既有语义；专项、真实端到端人工路径、TypeScript、ESLint、独立 Reviewer 与完整 `check:launch` 通过。
- 允许范围：`mergeModelInterpretation` 中唯一 deterministic adjacency fallback 的候选协调；PHM-A 与最小 Planner 回归；直接状态台账。
- 非目标：不改 Planner 的“含真实 unclear 必须 defer”合同；不改 relation mapping、confidence threshold、evidence span、PHM-C、Surface、Safety、schema/migration、Memory/User Model 或 lifecycle state；不新增问候关键词、regex、固定回复白名单。
- 当前基线：分支 `codex/planner-handoff-migration`；HEAD `febff4b`。已有未提交的 `AGENTS.md`、客户端 UUID/Guest history 修复及其 package/test 变更必须保留并隔离；本次截图对应 committed trace 已只读核验。
- 第一因果边界：`mergeModelInterpretation` 无条件合并 deterministic adjacency-only `continues_active_thread` fallback 与有效模型关系；在 insufficient semantic evidence 下 fallback 投影为 `unclear`，Planner 随后按合同 defer。
- 依赖项：合同 §§14.2-14.5、PHM-A target-bound projection、既有 model candidate validation/target binding、PHM-B total mapping。
- 主要风险：过宽抑制造成模型猜测 fail-open、误删模型自身 `continues_active_thread`、错 target 候选压掉 fallback、破坏真实多候选歧义、加入文本特判。
- 激活角色：主线程 Delivery Lead、Architect、Developer、独立 Reviewer。
- 文件写入负责人：Architect 仅分析文档；Developer 独占 `turnInterpreter` 与两份专项；主线程独占任务卡和状态台账；Reviewer 只读。
- 执行顺序：真实 trace → 根因分析 → 冻结合同 → 唯一 merge 修复 → 专项/相邻/完整门 → 独立复核 → Git 封存 → 重启 3103 人工测试服务。
- 修复预算：一次实现；同一冻结门最多两次证据驱动修复。
- 当前状态：已封存；Developer 修复、专项/相邻/完整门与独立 Reviewer 全部通过，等待 Git seal 与 3103 人工测试服务恢复。
