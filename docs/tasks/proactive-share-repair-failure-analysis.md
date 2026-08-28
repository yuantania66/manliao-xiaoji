# Problem

截图会话 `cmseb...` 的链路为：主动分享不透明隐喻 → 用户“你在说啥” → 助手道歉并否认表达意图 → 用户“好的吧” → 生成失败。系统既未保证主动内容有可理解的表达点，也未在用户追问时忠实解释或撤回原主张，最后又让“允许安静结束”和“必须主动开话题”互相冲突。

# Evidence

- 数据库中 proactive envelope v2 已提交 proposition，且与生成内容一致，被分类为 `self_contained_entry`。
- 首轮计划把“你在说啥”解释为 `opens_or_redirects_thread/defer`，actions 仅 acknowledge，无解释原话的 obligation。
- 后续“你是想表达什么吗”的 obligation `targetProposition` 错指向该问题自身，而非先前已提交主张；因此否认意图通过校验。
- 最终计划 `closurePolicy=allow_idle`，action 却为 `take_light_topic_initiative`；候选“嗯那咱们随意聊着”“安静待会儿也挺好”均因 `missing_light_topic_initiative` 被拒，最终 FAILED。
- proactive validator 只检查 faithful、selfContained、delivered 等，不检查语义清晰度或锚定的 communicative point。
- `actionsForState` 对任何 `opening_thread` 强制话题动作；closurePolicy 更晚形成，无法仲裁 actions。
- proactive real-Qwen 测试手工构造优质 intents，仅评 Surface 候选，未覆盖生成 intent 不清晰；handoff Qwen gate 未覆盖对不透明前述的澄清；naturalIdle 只验 closurePolicy，未验 actions/commit。

# Root Cause

这是三个所有权边界的连续失守，而非一句话规则缺失：主动意图层允许“形式自洽但无明确表达点”；承接解释层未把澄清、质疑和直接提问绑定到精确的既有 committed claim；控制规划层先强制 initiative、后生成 closurePolicy，导致策略无法消解动作冲突。Surface 只是在末端正确地暴露了上游矛盾。

# Proposed Solution

1. 扩展 proactive 结构化 intent，并增加独立语义裁决：要求 semantic clarity 与 anchored communicative point；不得用正则或话题枚举替代语义判断。加入按失败类别组织的对抗测试。
2. 将澄清、挑战、直接询问绑定到精确的先前 committed claim，生成 `explain/withdraw/repair` obligation；validator 拒绝无依据否认原表达意图。
3. 在进入 Surface 前消解 idle/initiative：已确认完成的 move 且 `allow_idle` 时，不得再要求 topic initiative。补端到端重试回归，覆盖候选拒绝后仍能产出合法结束响应。

保持严格解析与 fail-closed、committed edges 不可变；不新增生命周期状态，不重做 UI。

# Files To Change

- 主动意图边界：`services/ai/proactiveGreeting.ts`；若结构字段变化，再改 `conversation-os/interactionMoveEnvelope.ts`。
- 承接解释边界：`services/ai/turnInterpretationAdapter.ts`、`conversation-os/control/turnInterpreter.ts`、`services/ai/responsePlanValidator.ts`。
- 规划仲裁边界：`conversation-os/control/responsePlanner.ts`、`services/ai/responsePlanValidator.ts`。
- 更新对应的 proactive real-Qwen、handoff Qwen、naturalIdle 三组脚本及相关文档。

# Risks

- 语义裁决过严会压制诗性但可理解的表达；需用类别化正反例校准，而非关键词白名单。
- prior claim 绑定错误会把普通追问误判为挑战；必须依赖 committed edge 身份与轮次证据。
- idle 仲裁若范围过宽会吞掉用户明确的新问题；仅适用于已完成 move、无未偿 obligation 且明确 `allow_idle`。
- schema 变化可能影响旧 envelope；应优先兼容扩展并验证回放。
