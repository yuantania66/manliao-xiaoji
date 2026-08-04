import { generateChatReply } from "./aiService";
import { ExternalPromptRejectedError } from "./externalPromptInspection";
import { createSafetyGeneration, isCrisisInput } from "./chatSafety";
import { createClinicalMemoryContext } from "./clinicalMemoryAdapter";
import { buildAiDebugTrace } from "./debugTrace";
import { JUDGE_PROMPT_VERSION } from "./promptBuilder";
import type { ChatPromptEvaluationAdapter } from "./promptBuilder";
import {
  AiConversationMessage,
  AiDebugTrace,
  AiGenerationResult,
  AiJudgeResult,
  AiMemoryContext,
  AiModelMessage,
  AiRiskLevel,
} from "./types";
import { StructuredRagContext } from "@/services/understanding/understandingTypes";
import { buildClinicalContext } from "@/services/clinical/clinicalContextBuilder";
import { createClinicalStrategyAdvice } from "@/services/clinical/clinicalAdviceService";
import { buildClinicalTrace, buildSafetySkippedClinicalTrace } from "@/services/clinical/clinicalTrace";
import type { ClinicalTrace } from "@/services/clinical/clinicalTypes";
import { determineConversationState } from "@/conversation-os/state";
import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlanPreflightAuthoritySnapshot,
  createResponsePlan,
  interpretTurnDeterministically,
  type ConversationControlTrace,
  type OrdinaryHandoffBoundary,
  type ResponseValidationResult,
} from "@/conversation-os/control";
import { enrichTurnInterpretation } from "./turnInterpretationAdapter";
import { enforceResponsePlan } from "./responsePlanValidator";
import type { InteractionMoveHandoffSemanticProvider } from "./interactionMoveHandoffOutputValidator";
import {
  buildAttemptTransitions,
  classifyExecutionError,
  createExecutionIdentity,
  preflightResponsePlan,
  type ChatExecutionTrace,
} from "./chatExecutionLifecycle";
import {
  buildHillHelpingInput,
  createSkippedHillHelpingTrace,
  isHillHelpingOrdinaryHandoffEnabled,
  isHillHelpingShadowEnabled,
  runHillHelpingShadow,
  type HillHelpingDecisionProvider,
  type HillHelpingShadowTrace,
} from "@/services/helping";

type CreateChatReplyInput = {
  conversationId: string;
  currentTurnId?: string;
  requestId?: string;
  retrying?: boolean;
  userId?: string;
  userMessage: string;
  recentMessages: AiConversationMessage[];
  memoryContext?: AiMemoryContext | null;
  loadMemoryContext?: () => Promise<AiMemoryContext | null>;
  understandingContext?: StructuredRagContext | null;
  includeDebugTrace?: boolean;
  evaluationAdapter?: ChatPromptEvaluationAdapter | null;
  helpingShadowEnabled?: boolean;
  helpingOrdinaryHandoffEnabled?: boolean;
  helpingDecisionProvider?: HillHelpingDecisionProvider;
  /** Test seam. Production omits this and uses the fail-closed default semantic provider. */
  interactionMoveHandoffSemanticProvider?: InteractionMoveHandoffSemanticProvider;
  inspectHelpingPrompt?: (input: {
    stage: "helping_shadow";
    messages: AiModelMessage[];
  }) => void | Promise<void>;
  inspectExternalPrompt?: (input: {
    stage: "turn_interpretation" | "surface_realization" | "interaction_move_handoff_validation";
    messages: AiModelMessage[];
  }) => void | Promise<void>;
};

type ChatReplyFinalSource = AiDebugTrace["route"]["finalSource"];

export type ChatReplyResult = {
  generation: AiGenerationResult;
  generationAttempts: AiGenerationResult[];
  judge: AiJudgeResult & { judgeModel: string; promptVersion: string };
  finalSource: ChatReplyFinalSource;
  rewriteAttempted: boolean;
  regenerateAttempted: boolean;
  fallbackUsed: boolean;
  debugTrace?: AiDebugTrace;
  clinicalTrace: ClinicalTrace;
  helpingTrace: HillHelpingShadowTrace;
  controlTrace?: ConversationControlTrace;
  execution: ChatExecutionTrace;
};

const getFallbackRiskLevel = (content: string): AiRiskLevel => (isCrisisInput(content) ? "crisis" : "low");

const createFallbackJudge = (
  riskLevel: AiRiskLevel,
  reason: string
): AiJudgeResult & { judgeModel: string; promptVersion: string } => ({
  passed: true,
  riskLevel,
  issues: [],
  rewriteRequired: false,
  reason,
  judgeModel: "fallback-local",
  promptVersion: JUDGE_PROMPT_VERSION,
});

const createDisabledJudge = (reason: string): AiJudgeResult & { judgeModel: string; promptVersion: string } =>
  createFallbackJudge("low", reason);

const buildMaybeDebugTrace = ({
  includeDebugTrace,
  userMessage,
  recentMessages,
  generation,
  judge,
  finalSource,
  fallbackUsed,
  rewriteAttempted,
  regenerateAttempted,
  clinicalTrace,
  helpingTrace,
  controlTrace,
  execution,
}: {
  includeDebugTrace: boolean;
  userMessage: string;
  recentMessages: AiConversationMessage[];
  generation: AiGenerationResult;
  judge: AiJudgeResult & { judgeModel: string; promptVersion: string };
  finalSource: ChatReplyFinalSource;
  fallbackUsed: boolean;
  rewriteAttempted: boolean;
  regenerateAttempted: boolean;
  clinicalTrace: ClinicalTrace;
  helpingTrace: HillHelpingShadowTrace;
  controlTrace?: ConversationControlTrace;
  execution?: ChatExecutionTrace;
}) =>
  includeDebugTrace
    ? buildAiDebugTrace({
        userMessage,
        recentMessages,
        generation,
        judge,
        finalSource,
        fallbackUsed,
        rewriteAttempted,
        regenerateAttempted,
        clinicalTrace,
        helpingTrace,
        controlTrace,
        execution,
      })
    : undefined;

export const createChatReply = async ({
  conversationId,
  currentTurnId,
  requestId,
  retrying = false,
  userId = "anonymous",
  userMessage,
  recentMessages,
  memoryContext,
  loadMemoryContext,
  understandingContext,
  includeDebugTrace = false,
  evaluationAdapter,
  helpingShadowEnabled,
  helpingOrdinaryHandoffEnabled,
  helpingDecisionProvider,
  interactionMoveHandoffSemanticProvider,
  inspectHelpingPrompt,
  inspectExternalPrompt,
}: CreateChatReplyInput): Promise<ChatReplyResult> => {
  const executionIdentity = createExecutionIdentity({ requestId, turnId: currentTurnId });
  const resolvedTurnId = executionIdentity.turnId;
  const requestStartTransitions: ChatExecutionTrace["transitions"] = retrying
    ? [{
        phase: "RETRYING",
        reason: "The client retried the same conversationId and turnId with a fresh requestId.",
      }]
    : [];
  if (evaluationAdapter && !conversationId.startsWith("trajectory-eval-")) {
    throw new Error("Evaluation adapters are restricted to trajectory-eval conversations.");
  }
  const clinicalMemoryContext = createClinicalMemoryContext(understandingContext);
  const conversationState = determineConversationState({
    currentUserMessage: userMessage,
    recentMessages,
  });

  if (isCrisisInput(userMessage)) {
    const generation = createSafetyGeneration(userMessage);
    const rewriteAttempted = false;
    const regenerateAttempted = false;
    const judge = createFallbackJudge("crisis", "safety gate matched; base model skipped");
    const finalSource: ChatReplyFinalSource = "safety";
    const fallbackUsed = false;
    const clinicalTrace = buildSafetySkippedClinicalTrace({
      level: "crisis",
      notes: ["Safety gate matched; ordinary ClinicalPlan skipped."],
      conversationState: conversationState.state,
    });
    const helpingTrace = createSkippedHillHelpingTrace("safety_pre_gate");
    const execution: ChatExecutionTrace = {
      requestId: executionIdentity.requestId,
      conversationId,
      turnId: resolvedTurnId,
      planId: "safety-pre-gate",
      phase: "VALIDATED",
      planPreflight: { passed: true, failureReasons: [] },
      transitions: [
        ...requestStartTransitions,
        { phase: "PLANNED", reason: "Safety pre-gate selected the safety-owned response path." },
        { phase: "GENERATED", reason: "Safety generation produced a user-facing candidate." },
        { phase: "VALIDATED", reason: "Safety candidate passed the safety response boundary." },
      ],
      attempts: [],
    };

    return {
      generation,
      generationAttempts: [generation],
      judge,
      finalSource,
      rewriteAttempted,
      regenerateAttempted,
      fallbackUsed,
      clinicalTrace,
      helpingTrace,
      controlTrace: undefined,
      execution,
      debugTrace: buildMaybeDebugTrace({
        includeDebugTrace,
        userMessage,
        recentMessages,
        generation,
        judge,
        finalSource,
        fallbackUsed,
        rewriteAttempted,
        regenerateAttempted,
        clinicalTrace,
        helpingTrace,
        controlTrace: undefined,
        execution,
      }),
    };
  }

  const controlContext = assembleConversationControlContext({
    conversationId,
    currentTurnId: resolvedTurnId,
    userMessage,
    recentMessages,
    conversationState,
  });
  const deterministicInterpretation = interpretTurnDeterministically(controlContext);
  const interpreted = await enrichTurnInterpretation(controlContext, deterministicInterpretation, inspectExternalPrompt);
  const interpretation = interpreted.interpretation;
  const responseRelations = new Set(
    interpretation.responseRelation.candidates.map((candidate) => candidate.relation)
  );
  const memoryRelevant =
    interpretation.directQuestions.length === 0 &&
    !responseRelations.has("yields_initiative") &&
    !responseRelations.has("requests_pause") &&
    !responseRelations.has("repairs_previous_move");
  const resolvedMemoryContext = memoryRelevant
    ? memoryContext !== undefined
      ? memoryContext
      : loadMemoryContext
        ? await loadMemoryContext()
        : null
    : null;
  if (resolvedMemoryContext?.trust === "user_confirmed") {
    controlContext.confirmedFacts.push(`Selected user-confirmed memory: ${resolvedMemoryContext.text}`);
  } else if (resolvedMemoryContext) {
    controlContext.unconfirmedHypotheses.push(`Selected observed context: ${resolvedMemoryContext.text}`);
  }
  const dialogueState = buildDialogueState(controlContext, interpretation);
  const helpingInput = buildHillHelpingInput({
    context: controlContext,
    interpretation,
    dialogueState,
  });
  const ordinaryHandoffEnabled = helpingOrdinaryHandoffEnabled ??
    isHillHelpingOrdinaryHandoffEnabled();
  const shadowEnabled = helpingShadowEnabled ?? isHillHelpingShadowEnabled();
  const helpingTrace = await runHillHelpingShadow({
    input: helpingInput,
    enabled: ordinaryHandoffEnabled || shadowEnabled,
    fastBoundaryOnly: ordinaryHandoffEnabled && !shadowEnabled,
    provider: helpingDecisionProvider,
    inspectHelpingPrompt,
  });
  const ordinaryHandoffBoundary: OrdinaryHandoffBoundary | null =
    ordinaryHandoffEnabled &&
    helpingTrace.decision?.status === "decided" &&
    helpingTrace.decision.plan.applicability === "uncertain"
      ? {
          source: "hill_helping",
          applicability: "uncertain",
          userBoundaries: helpingInput.userBoundaries.map((item) => item.kind),
          evidence: [
            ...helpingTrace.decision.plan.evidence,
            ...helpingTrace.inputEvidence,
          ],
        }
      : null;
  let compatibilityClinicalTrace: ClinicalTrace = {
    skippedBySafety: false,
    invokedByPlanner: false,
    conversationState: conversationState.state,
    safetyDecision: { level: "low", routedToSafety: false, notes: ["Clinical strategy not requested by Response Planner."] },
    inputSignals: {
      userCorrectedAi: controlContext.repairSignal,
      userWantsPause: controlContext.interaction.stopIntent,
      userRequestsHelp: false,
      userRequestsSummary: false,
      userExpressesUncertainty: controlContext.interaction.contentAvailability !== "has_topic",
      userExpressesEmotion: controlContext.interaction.affect === "negative",
      ambiguityLevel: controlContext.semanticEvidence.status === "insufficient" ? "high" : "low",
    },
    signals: {
      messageLength: userMessage.length <= 20 ? "SHORT" : userMessage.length <= 80 ? "MEDIUM" : "LONG",
      expressionDifficulty: false,
      explicitAdviceRequest: false,
      emotionalIntensity: controlContext.interaction.affect === "negative" ? "MEDIUM" : "UNKNOWN",
      hasPreviousAssistantReply: recentMessages.some((message) => message.role === "assistant"),
      conversationStage: recentMessages.length <= 2 ? "OPENING" : "EXPLORING",
      semanticEvidence: controlContext.semanticEvidence,
      interaction: controlContext.interaction,
      memoryAvailability: {
        hasUnderstanding: false,
        hasRelationship: false,
        hasTimeline: false,
        hasSemanticMemory: false,
      },
    },
    memoryUsed: { understandings: [], relationships: [], timelineEvents: [] },
    memoryExcluded: { rawMemory: "not_allowed", deterministicMemoryCaveat: [] },
  };
  const responsePlanPreflightAuthority = createResponsePlanPreflightAuthoritySnapshot({
    context: controlContext,
    interpretation,
    dialogueState,
  });
  const responsePlan = createResponsePlan({
    context: controlContext,
    interpretation,
    dialogueState,
    ordinaryHandoffBoundary,
    clinicalAdviceProvider: ({ need }) => {
      const clinicalContext = buildClinicalContext({
        conversationId,
        userId,
        userTurn: userMessage,
        recentTurns: recentMessages,
        memoryContext: clinicalMemoryContext,
        conversationState: conversationState.state,
        conversationStateResult: conversationState,
        safetyNotes: [],
      });
      const selected = createClinicalStrategyAdvice({ context: clinicalContext, need });
      compatibilityClinicalTrace = buildClinicalTrace({
        context: clinicalContext,
        plan: selected.compatibilityPlan,
        safetyDecision: { level: "low", routedToSafety: false, notes: [`Invoked by Response Planner for ${need}.`] },
      });
      return selected.advice;
    },
  });
  const clinicalTrace = compatibilityClinicalTrace;
  const planPreflight = preflightResponsePlan(
    responsePlan,
    responsePlanPreflightAuthority
  );
  if (!planPreflight.passed) {
    const generation: AiGenerationResult = {
      text: "",
      model: "not-called",
      promptVersion: JUDGE_PROMPT_VERSION,
      latencyMs: 0,
      postProcessSteps: [],
      finalReplySource: "constraint_failure",
    };
    const judge = createFallbackJudge("low", "ResponsePlan failed preflight; model not called.");
    const controlTrace: ConversationControlTrace = {
      context: controlContext,
      interpretation,
      interpretationModel: interpreted.modelTrace,
      dialogueState,
      responsePlan,
      clinicalInvoked: Boolean(responsePlan.clinicalStrategy),
      validation: [],
      stateUpdate: {
        answeredObligations: [],
        remainingOpenLoops: responsePlan.answerObligations.map((item) => item.id),
        obligationTransitions: [],
        notes: ["PLAN_INVALID is an execution failure; no Interaction State transition was committed."],
      },
    };
    const execution: ChatExecutionTrace = {
      requestId: executionIdentity.requestId,
      conversationId,
      turnId: resolvedTurnId,
      planId: responsePlan.planId,
      phase: "FAILED",
      planPreflight,
      transitions: [
        ...requestStartTransitions,
        { phase: "PLANNED", reason: "The single Response Planner produced a plan." },
        { phase: "REJECTED", reason: planPreflight.failureReasons.join(", ") },
        { phase: "FAILED", reason: "ResponsePlan preflight failed before any model call." },
      ],
      attempts: [],
      failure: {
        code: "PLAN_INVALID",
        reason: planPreflight.failureReasons.join(", "),
        retryable: true,
      },
    };
    return {
      generation,
      generationAttempts: [],
      judge,
      finalSource: "constraint_failure",
      rewriteAttempted: false,
      regenerateAttempted: false,
      fallbackUsed: false,
      clinicalTrace,
      helpingTrace,
      controlTrace,
      execution,
      debugTrace: buildMaybeDebugTrace({
        includeDebugTrace,
        userMessage,
        recentMessages,
        generation,
        judge,
        finalSource: "constraint_failure",
        fallbackUsed: false,
        rewriteAttempted: false,
        regenerateAttempted: false,
        clinicalTrace,
        helpingTrace,
        controlTrace,
        execution,
      }),
    };
  }

  const attemptIds: string[] = [];
  try {
    const handoffTargetMessage = responsePlan.interactionMoveHandoffPlan
      ? recentMessages.find((message) =>
          message.role === "assistant" &&
          message.id === responsePlan.interactionMoveHandoffPlan?.sourceAssistantMoveId
        )
      : undefined;
    const enforced = await enforceResponsePlan({
      plan: responsePlan,
      handoffSemanticProvider: interactionMoveHandoffSemanticProvider,
      inspectHandoffExternalPrompt: inspectExternalPrompt,
      handoffSemanticContext: handoffTargetMessage
        ? {
            targetAssistantText: handoffTargetMessage.content,
            currentUserText: userMessage,
          }
        : undefined,
      generate: async (constraint, executionPlan) => {
        attemptIds.push(createExecutionIdentity({}).requestId);
        return generateChatReply({
          conversationId,
          userMessage,
          recentMessages,
          memoryContext: null,
          understandingContext: null,
          responsePlan: executionPlan,
          evaluationAdapter,
          responsePlanRegenerateConstraint: constraint,
          inspectExternalPrompt: inspectExternalPrompt
            ? ({ messages }) => inspectExternalPrompt({ stage: "surface_realization", messages })
            : undefined,
        });
      },
    });
    const generation = enforced.generation;
    const judge = createDisabledJudge("judge/rewrite disabled; base model output returned directly");
    // guard_rewrite remains readable for legacy traces but is no longer emitted on the success path.
    const rewriteAttempted = generation.finalReplySource === "guard_rewrite";
    const regenerateAttempted = enforced.regenerateAttempted;
    const finalSource: ChatReplyFinalSource = generation.finalReplySource === "llm_regenerate"
      ? "llm_regenerate"
      : generation.finalReplySource === "constraint_failure" ? "constraint_failure" : "llm";
    const fallbackUsed = false;
    const finalValidation = enforced.validations.at(-1);
    const validated = enforced.outcome === "validated" && Boolean(finalValidation?.passed);
    const controlTrace: ConversationControlTrace = {
      context: controlContext,
      interpretation: {
        ...interpretation,
        notes: [
          ...interpretation.notes,
          `modelInterpretationUsed=${interpreted.modelUsed}`,
          ...(interpreted.rawModelOutput ? [`modelInterpretationRaw=${interpreted.rawModelOutput}`] : []),
        ],
      },
      interpretationModel: interpreted.modelTrace,
      dialogueState,
      responsePlan,
      clinicalInvoked: Boolean(responsePlan.clinicalStrategy),
      validation: enforced.validations,
      stateUpdate: {
        answeredObligations: [],
        remainingOpenLoops: responsePlan.answerObligations.map((item) => item.id),
        obligationTransitions: [],
        notes: [
          validated
            ? "ResponsePlan output is validated but not committed; Interaction State remains unchanged until persistence succeeds."
            : "GENERATION_NONCONFORMANT is an execution failure; Interaction State remains unchanged.",
        ],
      },
    };
    const executionAttempts: ChatExecutionTrace["attempts"] = enforced.attempts.map((attempt, index) => ({
      attemptId: attemptIds[index] ?? createExecutionIdentity({}).requestId,
      phase: enforced.validations[index]?.passed ? "VALIDATED" : "REJECTED",
      generation: attempt,
      validation: enforced.validations[index],
    }));
    const execution: ChatExecutionTrace = {
      requestId: executionIdentity.requestId,
      conversationId,
      turnId: resolvedTurnId,
      planId: responsePlan.planId,
      phase: validated ? "VALIDATED" : "FAILED",
      planPreflight,
      transitions: [
        ...requestStartTransitions,
        { phase: "PLANNED", reason: "The single Response Planner produced a preflight-valid plan." },
        ...buildAttemptTransitions({ attempts: executionAttempts, validated }),
      ],
      attempts: executionAttempts,
      ...(validated
        ? {}
        : {
            failure: {
              code: "GENERATION_NONCONFORMANT" as const,
              reason: enforced.validations.flatMap((item) => item.failureReasons).join(", "),
              retryable: true,
            },
          }),
    };

    return {
      generation,
      generationAttempts: enforced.attempts,
      judge,
      finalSource,
      rewriteAttempted,
      regenerateAttempted,
      fallbackUsed,
      clinicalTrace,
      helpingTrace,
      controlTrace,
      execution,
      debugTrace: buildMaybeDebugTrace({
        includeDebugTrace,
        userMessage,
        recentMessages,
        generation,
        judge,
        finalSource,
        fallbackUsed,
        rewriteAttempted,
        regenerateAttempted,
        clinicalTrace,
        helpingTrace,
        controlTrace,
        execution,
      }),
    };
  } catch (error) {
    if (error instanceof ExternalPromptRejectedError) throw error;
    const classified = classifyExecutionError(error);
    const generation: AiGenerationResult = {
      text: "",
      model: "not-available",
      promptVersion: JUDGE_PROMPT_VERSION,
      latencyMs: 0,
      rawLLMOutput: undefined,
      postProcessSteps: [],
      finalReplySource: "constraint_failure",
    };
    const judge = createFallbackJudge(getFallbackRiskLevel(userMessage), "Surface realization unavailable; returned system constraint_failure without creating a new chat goal.");
    const rewriteAttempted = false;
    const regenerateAttempted = false;
    const finalSource: ChatReplyFinalSource = "constraint_failure";
    const fallbackUsed = false;
    const failedValidation: ResponseValidationResult = {
      passed: false,
      failureReasons: ["surface_realization_unavailable"],
      checkedPlanId: responsePlan.planId,
      planChanged: false,
    };
    const controlTrace: ConversationControlTrace = {
      context: controlContext,
      interpretation,
      interpretationModel: interpreted.modelTrace,
      dialogueState,
      responsePlan,
      clinicalInvoked: Boolean(responsePlan.clinicalStrategy),
      validation: [failedValidation],
      stateUpdate: {
        answeredObligations: [],
        remainingOpenLoops: responsePlan.answerObligations.map((item) => item.id),
        obligationTransitions: [],
        notes: [
          `${classified.code} is an execution failure; no Interaction State transition was committed.`,
          "No fallback chat plan or Assistant message was created after model failure.",
        ],
      },
    };
    const execution: ChatExecutionTrace = {
      requestId: executionIdentity.requestId,
      conversationId,
      turnId: resolvedTurnId,
      planId: responsePlan.planId,
      phase: "FAILED",
      planPreflight,
      transitions: [
        ...requestStartTransitions,
        { phase: "PLANNED", reason: "The single Response Planner produced a preflight-valid plan." },
        ...attemptIds.flatMap((attemptId) => [
          {
            phase: "GENERATED" as const,
            attemptId,
            reason: "A provider attempt started but did not produce a validated candidate.",
          },
          {
            phase: "FAILED" as const,
            attemptId,
            reason: classified.reason,
          },
        ]),
        ...(!attemptIds.length
          ? [{ phase: "FAILED" as const, reason: classified.reason }]
          : []),
      ],
      attempts: attemptIds.map((attemptId) => ({
        attemptId,
        phase: "FAILED",
      })),
      failure: {
        code: classified.code,
        reason: classified.reason,
        retryable: true,
      },
    };

    return {
      generation,
      generationAttempts: [],
      judge,
      finalSource,
      rewriteAttempted,
      regenerateAttempted,
      fallbackUsed,
      clinicalTrace,
      helpingTrace,
      controlTrace,
      execution,
      debugTrace: buildMaybeDebugTrace({
        includeDebugTrace,
        userMessage,
        recentMessages,
        generation,
        judge,
        finalSource,
        fallbackUsed,
        rewriteAttempted,
        regenerateAttempted,
        clinicalTrace,
        helpingTrace,
        controlTrace,
        execution,
      }),
    };
  }
};
