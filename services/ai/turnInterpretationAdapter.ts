import { mergeModelInterpretation, type ConversationControlContext, type TurnInterpretation } from "@/conversation-os/control";

import { callModel, getDefaultAiModel } from "./modelProvider";
import type { AiModelMessage } from "./types";
import { inspectPromptBeforeExternalCall } from "./externalPromptInspection";

const extractJsonObject = (text: string) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as Partial<TurnInterpretation>;
  } catch {
    return null;
  }
};

export const buildInterpretationMessages = (context: ConversationControlContext): AiModelMessage[] => [
  {
    role: "developer",
    content: [
      "Interpret one conversational turn as structured evidence. Do not write a reply or choose a response strategy.",
      "Use adjacent turns. Preserve multiple simultaneous acts. Do not infer emotion from message length or product category.",
      "Return one JSON object only with: literalMeaning, primaryDialogueAct, secondarySignals, confidence, notes.",
      "Allowed dialogue acts: share, answer, ask_information, ask_identity, ask_capability, ask_definition, challenge_contradiction, correct_assistant, yield_initiative, request_pause, end_conversation, seek_emotional_support, request_action_support, acknowledge.",
      "Direct questions, stop evidence, grounding references and deterministic interaction fields are resolved elsewhere and cannot be overridden here.",
    ].join("\n"),
  },
  {
    role: "user",
    content: JSON.stringify({
      currentUserMessage: context.currentUserMessage,
      adjacentTurns: context.adjacentTurns,
      interactionEvidence: context.interaction,
      semanticEvidence: context.semanticEvidence,
      repairSignal: context.repairSignal,
    }),
  },
];

export const enrichTurnInterpretation = async (
  context: ConversationControlContext,
  deterministic: TurnInterpretation,
  inspectExternalPrompt?: (input: { stage: "turn_interpretation"; messages: AiModelMessage[] }) => void | Promise<void>
): Promise<{ interpretation: TurnInterpretation; modelUsed: boolean; rawModelOutput: string | null }> => {
  const modelEnabled = process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED !== "false";
  const needsModel = deterministic.confidence < 0.8 && deterministic.directQuestions.length === 0 && !deterministic.interaction.stopIntent;
  if (!modelEnabled || !needsModel) return { interpretation: deterministic, modelUsed: false, rawModelOutput: null };

  const messages = buildInterpretationMessages(context);
  await inspectPromptBeforeExternalCall(inspectExternalPrompt, {
    stage: "turn_interpretation" as const,
    messages,
  });
  try {
    const response = await callModel({
      model: process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
      messages,
      temperature: 0.1,
    });
    return {
      interpretation: mergeModelInterpretation(deterministic, extractJsonObject(response.text)),
      modelUsed: true,
      rawModelOutput: response.text,
    };
  } catch {
    return {
      interpretation: { ...deterministic, notes: [...deterministic.notes, "Model interpretation unavailable; deterministic evidence preserved."] },
      modelUsed: false,
      rawModelOutput: null,
    };
  }
};
