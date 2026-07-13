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
import { determineConversationState } from "@/conversation-os/state";
import { applyFreeNumericReplyContract } from "./lowInformationReplyGuard";

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
  fallbackUsed: boolean;
  debugTrace?: AiDebugTrace;
  clinicalTrace: ClinicalTrace;
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
  if (evaluationAdapter && !conversationId.startsWith("trajectory-eval-")) {
    throw new Error("Evaluation adapters are restricted to trajectory-eval conversations.");
  }
  const rewriteAttempted = false;
  const clinicalMemoryContext = createClinicalMemoryContext(understandingContext);
  const conversationState = determineConversationState({
    currentUserMessage: userMessage,
    recentMessages,
  });

  if (isCrisisInput(userMessage)) {
    const generation = createSafetyGeneration(userMessage);
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
      judge,
      finalSource,
      rewriteAttempted,
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
        clinicalTrace,
      }),
    };
  }

  const clinicalContext = buildClinicalContext({
    conversationId,
    userId,
    userTurn: userMessage,
    recentTurns: recentMessages,
    memoryContext: clinicalMemoryContext,
    conversationState: conversationState.state,
    safetyNotes: [],
  });
  const clinicalPlan = createClinicalPlan(clinicalContext);
  const clinicalTrace = buildClinicalTrace({
    context: clinicalContext,
    plan: clinicalPlan,
    safetyDecision: {
      level: "low",
      routedToSafety: false,
      notes: [],
    },
  });

  const resolvedMemoryContext =
    memoryContext !== undefined ? memoryContext : loadMemoryContext ? await loadMemoryContext() : null;

  try {
    const modelGeneration = await generateChatReply({
      conversationId,
      userMessage,
      recentMessages,
      memoryContext: resolvedMemoryContext,
      understandingContext,
      clinicalPlan,
      evaluationAdapter,
    });
    const generation = applyFreeNumericReplyContract({
      userMessage,
      recentMessages,
      clinicalPlan,
      generation: modelGeneration,
    });
    const judge = createDisabledJudge("judge/rewrite disabled; base model output returned directly");
    const finalSource: ChatReplyFinalSource = "base_model";
    const fallbackUsed = false;

    return {
      generation,
      judge,
      finalSource,
      rewriteAttempted,
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
        clinicalTrace,
      }),
    };
  } catch {
    const riskLevel = getFallbackRiskLevel(userMessage);
    const fallbackGeneration = createFallbackGeneration({
      inputText: userMessage,
      riskLevel,
    });
    const generation = applyFreeNumericReplyContract({
      userMessage,
      recentMessages,
      clinicalPlan,
      generation: fallbackGeneration,
    });
    const judge = createFallbackJudge(riskLevel, "AI 主回复为空或不可用，已使用 fallback");
    const finalSource: ChatReplyFinalSource = "fallback";
    const fallbackUsed = true;

    return {
      generation,
      judge,
      finalSource,
      rewriteAttempted,
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
        clinicalTrace,
      }),
    };
  }
};
