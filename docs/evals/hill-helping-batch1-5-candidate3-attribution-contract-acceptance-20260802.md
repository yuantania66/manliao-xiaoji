# 批次 1.5 候选 3 分层归因与候选 4 前合同验收材料

状态：两份输入已冻结并完成一致性验收；本轮未修改代码；仍停留在批次 1.5。

## Completed

- 候选 3 的 10 个最终失败逐条归因已冻结。
- 13 次再生成的第一次触发与第二次结果逐条归因已冻结。
- 候选 4 前四项正向验收合同 V1 已冻结。
- 没有修改候选 3 原产物、原冻结数据、阈值或任何人工评分。

## Frozen Inputs

- 候选 3 产物 SHA-256：
  `f972332b761ad86847b5f969cd22d6149c64901936e0eb8a29f9c50a54423aa6`
- 候选 3 分层归因：
  `docs/evals/hill-helping-batch1-5-candidate3-layered-attribution-20260802.json`
- 分层归因 SHA-256：
  `6defec76e0db4101669cd8a6c948d77998fe659a8510449a465204c328ed36b5`
- 候选 4 前四项正向验收合同：
  `docs/HILL_HELPING_BATCH1_5_CANDIDATE4_POSITIVE_ACCEPTANCE_CONTRACT_V1.md`
- 正向验收合同 SHA-256：
  `0472e86def5ee499c4697d55ce55e6547e14036bce07d03ef49703fbd51ef002`

## Evidence

- JSON 语法校验通过。
- 最终失败审计 10/10，审计 ID 10/10 唯一，并与源产物中的最终失败一一对应。
- 再生成审计 13/13，审计 ID 13/13 唯一，并与源产物中的再生成事件一一对应。
- 最终失败归因：Planner 合同 3、Surface 2、Validator 假阳性 1、两者并存 4。
- 第一次再生成触发归因：Surface 2、Validator 假阳性 5、两者并存 6。
- 第二次输出归因：正确接受 4、正确拒绝 Surface 2、Validator 假阳性 1、两者并存
  4、Validator 假阴性接受 Surface 缺陷 2。
- 合同覆盖唯一情绪证据、组合式功能校验、普通修复子类型、真实全链路本地门四项，
  并明确禁止固定文案补丁、修改阈值、启用 Hill 技术或进入批次 2。

## Acceptance Judgment

分层归因满足“观察、功能判断、Validator 判断分离”的代码修改前证据要求；正向合同
为四个负责层分别定义了完成条件，没有规定用户可见固定句式。两项均达到进入代码
修改阶段的验收标准。

这不表示候选 3 通过，也不表示候选 4 已获授权。它只说明下一轮代码修改已有冻结的
原因边界和不可降低的本地验收门。

## Remaining

- 尚未按合同修改 Planner、Surface、Validator、runner 或本地测试。
- 候选 4 的 60 轮测试尚未授权、尚未运行。

## Blocking Reason

没有证据或文档冲突。下一步属于代码修改阶段，需要严格按四项合同分阶段实现和验收。

## Recommended Next Step

进入代码修改阶段，先只实现“唯一情绪证据合同＋20 个冻结场景真实 preflight 门”；
该阶段验收通过后，再修改组合式 Validator 和普通修复目标子类型。
