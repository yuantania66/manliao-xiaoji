import {
  AiConversationMessage,
  AiDebugTrace,
  AiGenerationResult,
  AiJudgeResult,
} from "./types";
import { FALLBACK_PROMPT_VERSION } from "./promptBuilder";

export const buildAiDebugTrace = ({
  recentMessages,
  generation,
  judge,
  finalSource,
  fallbackUsed,
  rewriteAttempted,
  clinicalTrace,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  generation: AiGenerationResult;
  judge: AiJudgeResult & { judgeModel?: string };
  finalSource: AiDebugTrace["route"]["finalSource"];
  fallbackUsed: boolean;
  rewriteAttempted: boolean;
  clinicalTrace?: AiDebugTrace["clinicalLogic"];
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
  const filteredHistory = promptMeta?.filteredHistory ?? [];
  const modelMessageRoles = promptMeta?.modelMessageRoles ?? [];
  const thinkingLayers = [
    {
      title: "1. 路由",
      body:
        finalSource === "base_model"
          ? "产品底座 prompt + 基模直出；没有本地分析、规划、短路或二次改写参与回复。"
          : finalSource === "safety"
            ? "安全闸门命中，普通聊天模型未调用。"
            : "模型调用失败后走 fallback；没有二次改写。",
      evidence: [
        `路线：${finalSource}`,
        `rewrite=${rewriteAttempted}`,
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
      title: "3. Provider",
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
      title: "4. Clinical Logic",
      body: clinicalTrace
        ? clinicalTrace.skippedBySafety
          ? "Safety 命中，普通 ClinicalPlan 已跳过。"
          : "Clinical Logic Sprint 1 NoOp plan 已生成，仅进入 trace，不进入 prompt。"
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
    prompt: {
      mode: promptMeta?.mode ?? (finalSource === "fallback" ? "fallback" : finalSource === "safety" ? "safety" : "base_product"),
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
      safetyUsed: finalSource === "safety",
    },
  };
};
