import {
  AiConversationMessage,
  AiDebugTrace,
  AiGenerationResult,
  AiJudgeResult,
} from "./types";
import { FALLBACK_PROMPT_VERSION } from "./promptBuilder";
import type { ChatExecutionTrace } from "./chatExecutionLifecycle";

export const buildAiDebugTrace = ({
  recentMessages,
  generation,
  judge,
  finalSource,
  fallbackUsed,
  rewriteAttempted,
  regenerateAttempted = false,
  clinicalTrace,
  helpingTrace,
  controlTrace,
  execution,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  generation: AiGenerationResult;
  judge: AiJudgeResult & { judgeModel?: string };
  finalSource: AiDebugTrace["route"]["finalSource"];
  fallbackUsed: boolean;
  rewriteAttempted: boolean;
  regenerateAttempted?: boolean;
  clinicalTrace?: AiDebugTrace["clinicalLogic"];
  helpingTrace?: AiDebugTrace["helpingLogic"];
  controlTrace?: AiDebugTrace["conversationControl"];
  execution?: ChatExecutionTrace;
}): AiDebugTrace => {
  const promptMeta = generation.promptMeta;
  const providerReasoningLabel = generation.providerReasoning?.available
    ? `模型返回了隐藏推理字段（${generation.providerReasoning.characters ?? 0} 字），这里只展示安全摘要。`
    : "模型未暴露隐藏推理。";
  const promptVersion = promptMeta?.promptVersion ?? generation.promptVersion ?? FALLBACK_PROMPT_VERSION;
  const receivedHistoryCount = promptMeta?.receivedHistoryCount ?? recentMessages.length;
  const includedHistoryCount = promptMeta?.includedHistoryCount ?? recentMessages.slice(-8).length;
  const filteredHistoryCount = promptMeta?.filteredHistoryCount ?? 0;
  const memoryIncluded = promptMeta?.memoryIncluded ?? false;
  const memorySource = promptMeta?.memorySource;
  const memoryLayer = promptMeta?.memoryLayer;
  const memoryTrust = promptMeta?.memoryTrust;
  const memoryLabel = memoryIncluded
    ? [memorySource, memoryLayer, memoryTrust].filter(Boolean).join(" / ")
    : "none";
  const understandingIncluded = promptMeta?.understandingIncluded ?? false;
  const understanding = promptMeta?.understanding;
  const conversationContext = promptMeta?.conversationContext;
  const conversationOrientation = promptMeta?.conversationOrientation;
  const conversationUpdate = promptMeta?.conversationUpdate;
  const voiceConstraints = promptMeta?.voiceConstraints;
  const responsePlan = promptMeta?.responsePlan;
  const filteredHistory = promptMeta?.filteredHistory ?? [];
  const modelMessageRoles = promptMeta?.modelMessageRoles ?? [];
  const thinkingLayers = [
    {
      title: "1. 路由",
      body:
        finalSource === "llm"
          ? controlTrace
            ? "Conversation OS ResponsePlan 经 Surface Realization 一次实现并通过 Output Validation；没有普通下游改写。"
            : "兼容路径的模型输出直达。"
          : finalSource === "llm_regenerate"
            ? "首次生成未通过语义证据约束；受控重生成一次后通过，guard 未创作最终文案。"
            : finalSource === "constraint_failure"
              ? "两次生成均未通过语义证据约束；返回系统约束硬失败状态，不伪装成对用户内容的理解。"
              : finalSource === "safety"
                ? "安全闸门命中，普通聊天模型未调用。"
                : finalSource === "guard_rewrite"
                  ? "兼容读取：历史语义证据 guard rewrite 路径（当前成功路径不再使用）。"
                  : "模型调用失败后走 fallback；没有二次改写。",
      evidence: [
        `路线：${finalSource}`,
        `rewrite=${rewriteAttempted}`,
        `regenerate=${regenerateAttempted}`,
        `fallback=${fallbackUsed}`,
        `safety=${finalSource === "safety"}`,
      ],
    },
    {
      title: "2. Prompt",
      body:
        finalSource === "safety"
          ? "安全回复不构造普通聊天 prompt。"
          : `收到 ${receivedHistoryCount} 条历史，送入 ${includedHistoryCount} 条，过滤 ${filteredHistoryCount} 条历史。`,
      evidence: [
        `promptVersion：${promptVersion}`,
        `memory=${memoryLabel}`,
        understandingIncluded
          ? `understanding=recent:${understanding?.recentMemoryCount ?? 0}, similar:${understanding?.similarMemoryCount ?? 0}, hypotheses:${understanding?.activeHypothesisCount ?? 0}, counter:${understanding?.counterEvidenceCount ?? 0}`
          : "understanding=none",
        conversationContext
          ? `conversationOS=observe:${conversationContext.latestNotice.observations.length}, unknowns:${conversationContext.understanding.unknowns.length}, experienceGoal:${conversationContext.responseGoal.experienceGoal.join(",")}, engageMode:${conversationContext.responseGoal.engageMode}`
          : "conversationOS=none",
        conversationContext
          ? `notice=${conversationContext.latestNotice.observations.map((item) => item.text).join(" | ")}`
          : "notice=none",
        conversationOrientation
          ? `orientation=current:${conversationOrientation.currentUnderstanding.join(" | ") || "none"}; unknowns:${conversationOrientation.unknowns.join(" | ") || "none"}; directions:${conversationOrientation.possibleDirections.join(" | ") || "none"}`
          : "orientation=none",
        conversationContext
          ? `responseGoal=experienceGoal:${conversationContext.responseGoal.experienceGoal.join(" | ")}; mode:${conversationContext.responseGoal.engageMode}; reason:${conversationContext.responseGoal.policyReason}; experience:${conversationContext.responseGoal.userExperience.join(" | ")}`
          : "responseGoal=none",
        conversationContext
          ? `questionStyle=purpose:${conversationContext.responseGoal.questionStyle.purpose}; avoid:${conversationContext.responseGoal.questionStyle.avoid.join(",")}`
          : "questionStyle=none",
        voiceConstraints
          ? `voiceLayer=style:${voiceConstraints.styleDirectives.join(" | ")}; prohibited:${voiceConstraints.prohibitedExpressions.join(" | ")}`
          : "voiceLayer=none",
        conversationUpdate
          ? `updateResult=notes:${conversationUpdate.notes.join(" | ") || "none"}`
          : "updateResult=none",
        `messages：${modelMessageRoles.join(" -> ") || "无"}`,
        ...filteredHistory.map((item) => `过滤 ${item.role}: ${item.reason} / ${item.preview}`),
      ],
    },
    {
      title: "3. Conversation OS Control",
      body: controlTrace
        ? `唯一决策者 ${controlTrace.responsePlan.decisionOwner} 生成 planId=${controlTrace.responsePlan.planId}。`
        : finalSource === "safety"
          ? "Safety 在普通规划前阻断。"
          : "Conversation OS control trace unavailable.",
      evidence: controlTrace
        ? [
            `responseRelations=${controlTrace.interpretation.responseRelation.candidates.map((item) => `${item.relation}:${item.confidence}`).join(",") || "none"}`,
            `currentActivity=${controlTrace.dialogueState.currentActivity.primary}`,
            `concurrentActivities=${controlTrace.dialogueState.currentActivity.concurrent.join(",") || "none"}`,
            `initiativeOwner=${controlTrace.dialogueState.initiativeOwner}`,
            `answerObligations=${controlTrace.responsePlan.answerObligations.map((item) => item.kind).join(",") || "none"}`,
            `responseActions=${controlTrace.responsePlan.responseActions.join(",")}`,
            `behaviorSource=${controlTrace.responsePlan.behaviorSource}`,
            `clinicalInvoked=${controlTrace.clinicalInvoked}`,
            `questionPolicy=${controlTrace.responsePlan.questionPolicy.mode}`,
            `closurePolicy=${controlTrace.responsePlan.closurePolicy.mode}`,
            `validation=${controlTrace.validation.map((item) => item.passed).join(" -> ")}`,
          ]
        : ["decisionOwner=safety_or_unavailable"],
    },
    {
      title: "4. Helping Logic Shadow",
      body: helpingTrace
        ? helpingTrace.skippedReason === "safety_pre_gate"
          ? "Safety 在普通 Helping Logic 前接管。"
          : helpingTrace.skippedReason === "ordinary_handoff_no_fast_boundary"
            ? "本轮不满足确定性 uncertain 边界；批次 1.5 未调用完整 Hill Shadow。"
          : helpingTrace.enabled
            ? controlTrace?.responsePlan.responseActions.some((action) =>
                action === "invite_low_pressure_calibration" ||
                action === "continue_established_frame" ||
                action === "continue_established_thread" ||
                action === "offer_neutral_conversation_entry"
              )
              ? "Helping 只把 uncertain 适用性边界交给普通 Planner；Hill 目标和技术未进入回复。"
              : `Shadow 产生 ${helpingTrace.decision?.status ?? "missing"} 结果；未进入 ResponsePlan 或正式状态。`
            : "Helping Shadow 已关闭；正式回复路径不变。"
        : "Helping Shadow trace unavailable.",
      evidence: helpingTrace
        ? [
            `enabled=${helpingTrace.enabled}`,
            `skippedReason=${helpingTrace.skippedReason ?? "none"}`,
            `decision=${helpingTrace.decision?.status ?? "none"}`,
            `applicability=${helpingTrace.decision?.status === "decided" ? helpingTrace.decision.plan.applicability : "none"}`,
            `failureCode=${helpingTrace.decision?.status === "failed" ? helpingTrace.decision.failureCode : "none"}`,
            `providerAttempted=${helpingTrace.provider.attempted}`,
            `providerUsed=${helpingTrace.provider.used}`,
            ...helpingTrace.inputEvidence,
          ]
        : ["helpingLogic=none"],
    },
    {
      title: "5. Provider",
      body: `${generation.model} / ${generation.latencyMs}ms`,
      evidence: [
        `finalReplySource=${generation.finalReplySource ?? "unknown"}`,
        `rawLLMOutput=${generation.rawLLMOutput ?? "none"}`,
        `postProcessSteps=${generation.postProcessSteps?.length ?? 0}`,
        ...(generation.postProcessSteps ?? []).map(
          (step) => `${step.layer}: ${step.before} -> ${step.after}${step.reason ? ` / ${step.reason}` : ""}`
        ),
        providerReasoningLabel,
        `tokenInput=${generation.tokenInput ?? "unknown"}`,
        `tokenOutput=${generation.tokenOutput ?? "unknown"}`,
      ],
    },
    {
      title: "6. Legacy Clinical Logic",
      body: clinicalTrace
        ? clinicalTrace.skippedBySafety
          ? "Safety 命中，普通 ClinicalPlan 已跳过。"
          : clinicalTrace.invokedByPlanner
            ? "Response Planner 按需调用 Clinical，Clinical 仅返回策略建议。"
            : "Response Planner 未请求 Clinical Strategy。"
        : "Clinical Logic trace unavailable.",
      evidence: clinicalTrace
        ? [
            `skippedBySafety=${clinicalTrace.skippedBySafety}`,
            `safety=${clinicalTrace.safetyDecision?.level ?? "none"}:${clinicalTrace.safetyDecision?.routedToSafety ?? false}`,
            `responseIntent=${clinicalTrace.selectedPlan?.responseIntent ?? "none"}`,
            `primaryStrategy=${clinicalTrace.selectedPlan?.primaryStrategy ?? "none"}`,
            `questionFunction=${clinicalTrace.selectedPlan?.questionFunction ?? "none"}`,
            `memoryUsed=understandings:${clinicalTrace.memoryUsed.understandings.length}, relationships:${clinicalTrace.memoryUsed.relationships.length}, timeline:${clinicalTrace.memoryUsed.timelineEvents.length}`,
            `rawMemory=${clinicalTrace.memoryExcluded.rawMemory}`,
          ]
        : ["clinicalLogic=none"],
    },
  ];

  return {
    visibleSteps: thinkingLayers.map((layer) => `${layer.title}：${layer.body}`),
    thinkingLayers,
    clinicalLogic: clinicalTrace,
    helpingLogic: helpingTrace,
    conversationControl: controlTrace,
    execution,
    prompt: {
      mode: promptMeta?.mode ?? (fallbackUsed ? "fallback" : finalSource === "safety" ? "safety" : "base_product"),
      promptVersion,
      receivedHistoryCount,
      includedHistoryCount,
      filteredHistoryCount,
      memoryIncluded,
      memorySource,
      memoryLayer,
      memoryTrust,
      understandingIncluded,
      understanding,
      conversationContext,
      conversationOrientation,
      conversationUpdate,
      voiceConstraints,
      responsePlan,
      filteredHistory,
      modelMessageRoles,
    },
    generation: {
      model: generation.model,
      promptVersion: generation.promptVersion,
      latencyMs: generation.latencyMs,
      rawLLMOutput: generation.rawLLMOutput,
      postProcessSteps: generation.postProcessSteps,
      finalReplySource: generation.finalReplySource,
      tokenInput: generation.tokenInput,
      tokenOutput: generation.tokenOutput,
      providerReasoning: generation.providerReasoning,
    },
    judge: {
      passed: judge.passed,
      riskLevel: judge.riskLevel,
      issues: judge.issues,
      rewriteRequired: judge.rewriteRequired,
      reason: judge.reason,
      judgeModel: judge.judgeModel,
    },
    route: {
      finalSource,
      fallbackUsed,
      rewriteAttempted,
      regenerateAttempted,
      safetyUsed: finalSource === "safety",
      safetyOverrideReason: finalSource === "safety" ? judge.reason : undefined,
    },
  };
};
