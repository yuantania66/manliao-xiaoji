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
  createResponsePlan,
  interpretTurnDeterministically,
  type ConversationControlTrace,
  type ResponseValidationResult,
} from "@/conversation-os/control";
import { enrichTurnInterpretation } from "./turnInterpretationAdapter";
import {
  RESPONSE_PLAN_CONSTRAINT_FAILURE_REPLY,
  enforceResponsePlan,
} from "./responsePlanValidator";

type CreateChatReplyInput = {
  conversationId: string;
  userId?: string;
  userMessage: string;
  recentMessages: AiConversationMessage[];
  memoryContext?: AiMemoryContext | null;
  loadMemoryContext?: () => Promise<AiMemoryContext | null>;
  understandingContext?: StructuredRagContext | null;
  includeDebugTrace?: boolean;
  evaluationAdapter?: ChatPromptEvaluationAdapter | null;
  inspectExternalPrompt?: (input: {
    stage: "turn_interpretation" | "surface_realization";
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
  controlTrace?: ConversationControlTrace;
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
  controlTrace,
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
  controlTrace?: ConversationControlTrace;
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
        controlTrace,
      })
    : undefined;

export const createChatReply = async ({
  conversationId,
  userId = "anonymous",
  userMessage,
  recentMessages,
  memoryContext,
  loadMemoryContext,
  understandingContext,
  includeDebugTrace = false,
  evaluationAdapter,
  inspectExternalPrompt,
}: CreateChatReplyInput): Promise<ChatReplyResult> => {
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

    return {
      generation,
      generationAttempts: [generation],
      judge,
      finalSource,
      rewriteAttempted,
      regenerateAttempted,
      fallbackUsed,
      clinicalTrace,
      controlTrace: undefined,
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
        controlTrace: undefined,
      }),
    };
  }

  const controlContext = assembleConversationControlContext({
    conversationId,
    userMessage,
    recentMessages,
    conversationState,
  });
  const deterministicInterpretation = interpretTurnDeterministically(controlContext);
  const interpreted = await enrichTurnInterpretation(controlContext, deterministicInterpretation, inspectExternalPrompt);
  const interpretation = interpreted.interpretation;
  const memoryRelevant =
    interpretation.directQuestions.length === 0 &&
    interpretation.primaryDialogueAct !== "yield_initiative" &&
    !interpretation.interaction.stopIntent;
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
  const responsePlan = createResponsePlan({
    context: controlContext,
    interpretation,
    dialogueState,
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

  try {
    const enforced = await enforceResponsePlan({
      plan: responsePlan,
      generate: async (constraint) =>
        generateChatReply({
          conversationId,
          userMessage,
          recentMessages,
          memoryContext: null,
          understandingContext: null,
          responsePlan,
          evaluationAdapter,
          responsePlanRegenerateConstraint: constraint,
          inspectExternalPrompt: inspectExternalPrompt
            ? ({ messages }) => inspectExternalPrompt({ stage: "surface_realization", messages })
            : undefined,
        }),
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
    const answeredObligations = finalValidation?.passed ? responsePlan.answerObligations.map((item) => item.id) : [];
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
      dialogueState,
      responsePlan,
      clinicalInvoked: Boolean(responsePlan.clinicalStrategy),
      validation: enforced.validations,
      stateUpdate: {
        answeredObligations,
        remainingOpenLoops: responsePlan.answerObligations.map((item) => item.id).filter((id) => !answeredObligations.includes(id)),
        notes: ["State update records whether the single ResponsePlan was fulfilled; it does not re-plan the reply."],
      },
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
      controlTrace,
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
        controlTrace,
      }),
    };
  } catch (error) {
    if (error instanceof ExternalPromptRejectedError) throw error;
    const generation: AiGenerationResult = {
      text: RESPONSE_PLAN_CONSTRAINT_FAILURE_REPLY,
      model: "constraint-failure",
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
      dialogueState,
      responsePlan,
      clinicalInvoked: Boolean(responsePlan.clinicalStrategy),
      validation: [failedValidation],
      stateUpdate: {
        answeredObligations: [],
        remainingOpenLoops: responsePlan.answerObligations.map((item) => item.id),
        notes: ["No fallback chat plan was created after model failure."],
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
      controlTrace,
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
        controlTrace,
      }),
    };
  }
};
