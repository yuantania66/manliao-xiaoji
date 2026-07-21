import { createFallbackGeneration, generateChatReply } from "./aiService";
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
  AiRiskLevel,
} from "./types";
import { StructuredRagContext } from "@/services/understanding/understandingTypes";
import { buildClinicalContext } from "@/services/clinical/clinicalContextBuilder";
import { createClinicalPlan } from "@/services/clinical/clinicalPlanService";
import { buildClinicalTrace, buildSafetySkippedClinicalTrace } from "@/services/clinical/clinicalTrace";
import type { ClinicalTrace } from "@/services/clinical/clinicalTypes";
import { evaluatePersonCenteredInterventionGate } from "@/services/clinical/personCenteredInterventionGate";
import { projectPromptEligibleContext } from "@/services/professional-rag/professionalGuidanceGateProjection";
import { determineConversationState } from "@/conversation-os/state";
import {
  applySemanticEvidenceReplyContract,
  isUnsupportedSemanticMeaningError,
} from "./semanticEvidenceReplyGuard";

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
};

type ChatReplyFinalSource = AiDebugTrace["route"]["finalSource"];

export type ChatReplyResult = {
  generation: AiGenerationResult;
  judge: AiJudgeResult & { judgeModel: string; promptVersion: string };
  finalSource: ChatReplyFinalSource;
  rewriteAttempted: boolean;
  semanticEvidenceBlocked: boolean;
  fallbackUsed: boolean;
  debugTrace?: AiDebugTrace;
  clinicalTrace: ClinicalTrace;
};

const getFallbackRiskLevel = (content: string): AiRiskLevel => (isCrisisInput(content) ? "crisis" : "low");

export const isPersonCenteredGateV1Enabled = () =>
  process.env.PERSON_CENTERED_GATE_V1_ENABLED === "true";

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
  semanticEvidenceBlocked,
  clinicalTrace,
}: {
  includeDebugTrace: boolean;
  userMessage: string;
  recentMessages: AiConversationMessage[];
  generation: AiGenerationResult;
  judge: AiJudgeResult & { judgeModel: string; promptVersion: string };
  finalSource: ChatReplyFinalSource;
  fallbackUsed: boolean;
  rewriteAttempted: boolean;
  semanticEvidenceBlocked: boolean;
  clinicalTrace: ClinicalTrace;
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
        semanticEvidenceBlocked,
        clinicalTrace,
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
}: CreateChatReplyInput): Promise<ChatReplyResult> => {
  if (isCrisisInput(userMessage)) {
    const safetyConversationState = determineConversationState({
      currentUserMessage: userMessage,
      recentMessages,
    });
    const generation = createSafetyGeneration(userMessage);
    const rewriteAttempted = false;
    const semanticEvidenceBlocked = false;
    const judge = createFallbackJudge("crisis", "safety gate matched; base model skipped");
    const finalSource: ChatReplyFinalSource = "safety";
    const fallbackUsed = false;
    const clinicalTrace = buildSafetySkippedClinicalTrace({
      level: "crisis",
      notes: ["Safety gate matched; ordinary ClinicalPlan skipped."],
      conversationState: safetyConversationState.state,
    });

    return {
      generation,
      judge,
      finalSource,
      rewriteAttempted,
      semanticEvidenceBlocked,
      fallbackUsed,
      clinicalTrace,
      debugTrace: buildMaybeDebugTrace({
        includeDebugTrace,
        userMessage,
        recentMessages,
        generation,
        judge,
        finalSource,
        fallbackUsed,
        rewriteAttempted,
        semanticEvidenceBlocked,
        clinicalTrace,
      }),
    };
  }

  if (evaluationAdapter && !conversationId.startsWith("trajectory-eval-")) {
    throw new Error("Evaluation adapters are restricted to trajectory-eval conversations.");
  }

  const personCenteredGateEnabled = isPersonCenteredGateV1Enabled();
  const clinicalMemoryContext = createClinicalMemoryContext(understandingContext);
  const conversationState = determineConversationState({
    currentUserMessage: userMessage,
    recentMessages,
  });

  const clinicalContext = buildClinicalContext({
    conversationId,
    userId,
    userTurn: userMessage,
    recentTurns: recentMessages,
    memoryContext: clinicalMemoryContext,
    conversationState: conversationState.state,
    safetyNotes: [],
    ...(personCenteredGateEnabled
      ? { includePersonCenteredEvidence: true }
      : {}),
  });
  const personCenteredGateEvidence =
    clinicalContext.personCenteredEvidence;
  if (personCenteredGateEnabled && !personCenteredGateEvidence) {
    throw new Error(
      "Person-Centered Gate is enabled but ClinicalContext has no evidence."
    );
  }
  const personCenteredGateDecision = personCenteredGateEnabled
    ? evaluatePersonCenteredInterventionGate(
        personCenteredGateEvidence!
      )
    : null;
  const promptEligibleProjection = personCenteredGateDecision
    ? projectPromptEligibleContext({
        raw: understandingContext,
        gateDecision: personCenteredGateDecision,
      })
    : null;
  const clinicalPlan = personCenteredGateDecision
    ? createClinicalPlan(clinicalContext, personCenteredGateDecision)
    : createClinicalPlan(clinicalContext);
  const clinicalTrace = buildClinicalTrace({
    context: clinicalContext,
    plan: clinicalPlan,
    ...(personCenteredGateDecision
      ? {
          gateDecision: personCenteredGateDecision,
          professionalGuidanceProjection:
            promptEligibleProjection?.trace ?? null,
        }
      : {}),
    safetyDecision: {
      level: "low",
      routedToSafety: false,
      notes: [],
    },
  });

  const resolvedMemoryContext =
    memoryContext !== undefined ? memoryContext : loadMemoryContext ? await loadMemoryContext() : null;

  try {
    const generationUnderstandingInput = personCenteredGateDecision
      ? {
          gatedUnderstandingContext:
            promptEligibleProjection?.understandingContext ?? null,
          personCenteredGateDecision,
        }
      : { understandingContext };
    const modelGeneration = await generateChatReply({
      conversationId,
      userMessage,
      recentMessages,
      memoryContext: resolvedMemoryContext,
      ...generationUnderstandingInput,
      clinicalPlan,
      evaluationAdapter,
    });
    const generation = applySemanticEvidenceReplyContract({
      clinicalPlan,
      generation: modelGeneration,
    });
    const judge = createDisabledJudge("judge/rewrite disabled; base model output returned directly");
    const rewriteAttempted = false;
    const semanticEvidenceBlocked = false;
    const finalSource: ChatReplyFinalSource = "llm";
    const fallbackUsed = false;

    return {
      generation,
      judge,
      finalSource,
      rewriteAttempted,
      semanticEvidenceBlocked,
      fallbackUsed,
      clinicalTrace,
      debugTrace: buildMaybeDebugTrace({
        includeDebugTrace,
        userMessage,
        recentMessages,
        generation,
        judge,
        finalSource,
        fallbackUsed,
        rewriteAttempted,
        semanticEvidenceBlocked,
        clinicalTrace,
      }),
    };
  } catch (error) {
    const semanticEvidenceBlocked = isUnsupportedSemanticMeaningError(error);
    const riskLevel = getFallbackRiskLevel(userMessage);
    const generation = createFallbackGeneration({
      inputText: userMessage,
      riskLevel,
    });
    const judge = createFallbackJudge(
      riskLevel,
      semanticEvidenceBlocked
        ? "semantic evidence guard blocked unsupported model meaning; fallback used"
        : "AI 主回复为空或不可用，已使用 fallback"
    );
    const rewriteAttempted = false;
    const finalSource: ChatReplyFinalSource = "fallback";
    const fallbackUsed = true;

    return {
      generation,
      judge,
      finalSource,
      rewriteAttempted,
      semanticEvidenceBlocked,
      fallbackUsed,
      clinicalTrace,
      debugTrace: buildMaybeDebugTrace({
        includeDebugTrace,
        userMessage,
        recentMessages,
        generation,
        judge,
        finalSource,
        fallbackUsed,
        rewriteAttempted,
        semanticEvidenceBlocked,
        clinicalTrace,
      }),
    };
  }
};
