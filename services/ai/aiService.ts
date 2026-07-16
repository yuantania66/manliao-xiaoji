import { AppError } from "@/lib/errors";

import {
  buildChatPrompt,
  CHAT_PROMPT_VERSION,
  FALLBACK_PROMPT_VERSION,
  type ChatUnderstandingPromptInput,
  type ChatPromptEvaluationAdapter,
} from "./promptBuilder";
import { callModel, getDefaultAiModel } from "./modelProvider";
import {
  AiConversationMessage,
  AiGenerationResult,
  AiMemoryContext,
  AiPromptMeta,
  AiProviderResponse,
  AiRiskLevel,
} from "./types";
import { StructuredRagContext } from "@/services/understanding/understandingTypes";
import { runConversationPipeline } from "@/conversation-os";
import { buildVoiceConstraints } from "./voiceLayer";
import type {
  ClinicalPlan,
  PersonCenteredGateDecision,
} from "@/services/clinical/clinicalTypes";
import type { GatedStructuredRagContext } from "@/services/professional-rag/professionalGuidanceGateProjection";

export const getMainModel = () => process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel();

const getFinalReplySource = (model: string): AiGenerationResult["finalReplySource"] =>
  model.startsWith("mock:") ? "mock" : "llm";

type GenerateChatReplyInput = {
  conversationId?: string;
  userMessage: string;
  recentMessages: AiConversationMessage[];
  memoryContext?: AiMemoryContext | null;
  clinicalPlan?: ClinicalPlan | null;
  evaluationAdapter?: ChatPromptEvaluationAdapter | null;
} & (
  | {
      understandingContext?: StructuredRagContext | null;
      gatedUnderstandingContext?: never;
      personCenteredGateDecision?: null | undefined;
    }
  | {
      understandingContext?: never;
      gatedUnderstandingContext: GatedStructuredRagContext | null;
      personCenteredGateDecision: PersonCenteredGateDecision;
    }
);

export const generateChatReply = async ({
  conversationId = "unknown-conversation",
  userMessage,
  recentMessages,
  memoryContext,
  understandingContext,
  gatedUnderstandingContext,
  personCenteredGateDecision,
  clinicalPlan,
  evaluationAdapter,
}: GenerateChatReplyInput): Promise<AiGenerationResult> => {
  const pipelineRecentMessages = recentMessages.flatMap((message) =>
    message.role === "user" || message.role === "assistant"
      ? [{ role: message.role, content: message.content }]
      : []
  );
  const responseBox: { value?: AiProviderResponse; promptMeta?: AiPromptMeta } = {};
  const understandingPromptInput: ChatUnderstandingPromptInput = personCenteredGateDecision
    ? {
        gatedUnderstandingContext: gatedUnderstandingContext ?? null,
        personCenteredGateDecision,
      }
    : { understandingContext };

  const pipelineResult = await runConversationPipeline({
    conversationId,
    userMessage: {
      conversationId,
      content: userMessage,
    },
    recentMessages: pipelineRecentMessages,
  }, async ({ context }) => {
    const voiceConstraints = buildVoiceConstraints(context.responseGoal);
    const prompt = buildChatPrompt({
      userMessage,
      recentMessages,
      memoryContext,
      ...understandingPromptInput,
      conversationContext: context,
      voiceConstraints,
      clinicalPlan,
      evaluationAdapter,
    });
    responseBox.promptMeta = prompt.meta;
    responseBox.value = await callModel({
      model: getMainModel(),
      messages: prompt.messages,
      temperature: 0.75,
    });

    return responseBox.value.text;
  });

  if (!responseBox.value || !responseBox.promptMeta) {
    throw new AppError("AI_GENERATION_FAILED", "Conversation OS pipeline did not produce a reply", 502);
  }

  const response = responseBox.value;
  const promptMeta = responseBox.promptMeta;
  promptMeta.conversationOrientation = pipelineResult.orientation;
  promptMeta.conversationUpdate = pipelineResult.update;

  return {
    ...response,
    text: response.text,
    promptVersion: CHAT_PROMPT_VERSION,
    rawLLMOutput: response.text,
    postProcessSteps: [],
    finalReplySource: getFinalReplySource(response.model),
    promptMeta,
  };
};

const USER_CORRECTION_PATTERN =
  /不是这个问题|我已经说过了|你还问|别再让我|不是这样|不对|你说话像模板|一直在套模板|别编|别圆/;

export const getFallbackReply = ({
  inputText = "",
  riskLevel = "low",
}: {
  inputText?: string;
  riskLevel?: AiRiskLevel;
} = {}) => {
  if (riskLevel === "crisis") {
    return "这会儿先不用解释。请把自己和可能伤害你的东西隔开，联系身边可信的人；有危险就打当地紧急电话。";
  }

  if (USER_CORRECTION_PATTERN.test(inputText)) {
    if (/累/.test(inputText)) {
      return "是我刚才没接住。你已经说了累，就先停在这里。";
    }
    return "是我刚才没接住。先回到你刚刚说的这句。";
  }

  return "先不用解释完整。这个部分可以先放在这里，慢慢来。";
};

export const createFallbackGeneration = ({
  inputText,
  riskLevel,
}: {
  inputText: string;
  riskLevel?: AiRiskLevel;
}): AiGenerationResult => {
  if (!inputText.trim()) {
    throw new AppError("VALIDATION_ERROR", "inputText 不能为空", 400);
  }

  return {
    text: getFallbackReply({ inputText, riskLevel }),
    model: "fallback",
    promptVersion: FALLBACK_PROMPT_VERSION,
    rawLLMOutput: undefined,
    postProcessSteps: [],
    finalReplySource: "fallback",
    latencyMs: 0,
  };
};
