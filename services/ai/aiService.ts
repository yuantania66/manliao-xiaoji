import { AppError } from "@/lib/errors";

import {
  buildChatPrompt,
  CHAT_PROMPT_VERSION,
  FALLBACK_PROMPT_VERSION,
  type ChatPromptEvaluationAdapter,
} from "./promptBuilder";
import { callModel, getAiProvider, getDefaultAiModel, isAiProviderConfigured } from "./modelProvider";
import {
  AiConversationMessage,
  AiGenerationResult,
  AiMemoryContext,
  AiModelMessage,
  AiRiskLevel,
} from "./types";
import { StructuredRagContext } from "@/services/understanding/understandingTypes";
import type { ResponsePlan } from "@/conversation-os/control";
import { inspectPromptBeforeExternalCall } from "./externalPromptInspection";

export const getMainModel = () => process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel();

const getFinalReplySource = (model: string): AiGenerationResult["finalReplySource"] =>
  model.startsWith("mock:") ? "mock" : "llm";

const normalizeAdviceCopy = (text: string) => text.normalize("NFKC").replace(/[\s\p{P}\p{Cf}]/gu, "");

export const generateChatReply = async ({
  conversationId = "unknown-conversation",
  userMessage,
  recentMessages,
  memoryContext,
  understandingContext,
  responsePlan,
  evaluationAdapter,
  responsePlanRegenerateConstraint = null,
  loadApprovedReplyAdvice,
  inspectExternalPrompt,
  signal,
}: {
  conversationId?: string;
  userMessage: string;
  recentMessages: AiConversationMessage[];
  memoryContext?: AiMemoryContext | null;
  understandingContext?: StructuredRagContext | null;
  responsePlan: ResponsePlan;
  evaluationAdapter?: ChatPromptEvaluationAdapter | null;
  responsePlanRegenerateConstraint?: string | null;
  loadApprovedReplyAdvice?: () => Promise<string | null>;
  inspectExternalPrompt?: (input: { stage: "surface_realization"; messages: AiModelMessage[] }) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<AiGenerationResult> => {
  void conversationId;
  const prompt = buildChatPrompt({
    userMessage,
    recentMessages,
    memoryContext,
    understandingContext,
    responsePlan,
    evaluationAdapter,
    semanticEvidenceRegenerateConstraint: responsePlanRegenerateConstraint,
  });
  let messages = prompt.messages;
  let sentAdvice: string | null = null;
  const lastMessage = prompt.messages.at(-1);
  if (loadApprovedReplyAdvice && !evaluationAdapter && responsePlanRegenerateConstraint === null && lastMessage?.role === "user") {
    const canLoadAdvice = () => !signal?.aborted && getAiProvider() === "qwen" && isAiProviderConfigured();
    const readAdvice = async () => {
      if (!canLoadAdvice()) return null;
      try {
        const advice = await loadApprovedReplyAdvice();
        return advice?.trim() && canLoadAdvice() ? advice : null;
      } catch {
        return null;
      }
    };

    const advice = await readAdvice();
    if (advice) {
      const guidedMessages: AiModelMessage[] = [
        ...prompt.messages.slice(0, -1),
        {
          role: "developer",
          content: [
            "以下是同一用户相关历史回复经人工复核的可选改法。只在当前语境适用时参考。",
            "当前用户的明确要求、回复计划和安全规则优先。把改法当编辑建议，自然回应当前消息，不复述或提及建议本身。",
            JSON.stringify({ advice }),
          ].join("\n"),
        },
        lastMessage,
      ];

      if (inspectExternalPrompt) {
        await inspectPromptBeforeExternalCall(inspectExternalPrompt, {
          stage: "surface_realization" as const,
          messages: structuredClone(guidedMessages),
        });
        // An awaited inspector can outlive an approval. Only send the exact inspected advice.
        if (await readAdvice() === advice) {
          messages = guidedMessages;
          sentAdvice = advice;
        }
      } else {
        messages = guidedMessages;
        sentAdvice = advice;
      }
    }
  }

  const inspectBasePrompt = () => inspectPromptBeforeExternalCall(inspectExternalPrompt, {
    stage: "surface_realization" as const,
    messages: loadApprovedReplyAdvice && inspectExternalPrompt ? structuredClone(prompt.messages) : prompt.messages,
  });
  if (!sentAdvice) await inspectBasePrompt();
  const generate = (requestMessages: AiModelMessage[]) => callModel({
    model: getMainModel(),
    messages: requestMessages,
    temperature: 0.75,
    signal,
  });
  const normalizedAdvice = sentAdvice ? normalizeAdviceCopy(sentAdvice) : "";
  const copiesAdvice = (text: string) => Boolean(normalizedAdvice && normalizeAdviceCopy(text).includes(normalizedAdvice));
  let response = await generate(messages);
  if (copiesAdvice(response.text)) {
    await inspectBasePrompt();
    response = await generate(prompt.messages);
    if (copiesAdvice(response.text)) throw new AppError("AI_GENERATION_FAILED", "Surface realization copied internal guidance", 502);
  }
  if (!response.text) throw new AppError("AI_GENERATION_FAILED", "Surface realization did not produce a reply", 502);
  const promptMeta = prompt.meta;

  return {
    ...response,
    // Guided responses do not retain provider metadata that could echo the request.
    ...(sentAdvice ? { raw: undefined } : {}),
    text: response.text,
    promptVersion: CHAT_PROMPT_VERSION,
    rawLLMOutput: response.text,
    postProcessSteps: [],
    finalReplySource: getFinalReplySource(response.model),
    promptMeta,
    // Reviewed advice is ephemeral and excluded from execution traces.
    promptMessages: prompt.messages,
    generationParameters: {
      temperature: 0.75,
      topP: null,
      seed: null,
    },
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
