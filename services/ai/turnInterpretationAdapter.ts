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
      "Use adjacent turns and preserve multiple plausible response relations with separate confidence values.",
      "Do not infer emotion from message length, product category, or lack of topic content.",
      "Do not convert an interpretation into a response action. Do not force one primary intent.",
      "Use repairs_previous_move only when the current turn rejects a concrete proposition in the targeted assistant turn; a different answer or topic continuation alone is not repair.",
      "Return one JSON object only with: literalMeaning, responseRelation, confidence, notes.",
      "responseRelation.candidates is an array of { relation, confidence, targetTurnId?, evidence[] }.",
      "Allowed relations: requests_answer, answers_previous_move, repairs_previous_move, continues_active_thread, opens_new_thread, yields_initiative, shares_initiative, requests_pause, requests_action_support, shares_distress, acknowledges_previous_move.",
      "Direct questions, stop evidence, Grounding references, common-ground rejection, and deterministic interaction evidence are resolved elsewhere and cannot be overridden.",
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
      correction: context.correction,
    }),
  },
];

export const enrichTurnInterpretation = async (
  context: ConversationControlContext,
  deterministic: TurnInterpretation,
  inspectExternalPrompt?: (input: { stage: "turn_interpretation"; messages: AiModelMessage[] }) => void | Promise<void>
): Promise<{
  interpretation: TurnInterpretation;
  modelUsed: boolean;
  rawModelOutput: string | null;
  modelTrace: {
    attempted: boolean;
    used: boolean;
    reason: string;
    model?: string;
    latencyMs?: number;
    tokenInput?: number;
    tokenOutput?: number;
    promptMessages?: AiModelMessage[];
    rawOutput?: string;
    error?: string;
  };
}> => {
  const modelEnabled = process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED !== "false";
  const needsModel = deterministic.confidence < 0.8 && deterministic.directQuestions.length === 0 && !deterministic.interaction.stopIntent;
  if (!modelEnabled || !needsModel) {
    return {
      interpretation: deterministic,
      modelUsed: false,
      rawModelOutput: null,
      modelTrace: {
        attempted: false,
        used: false,
        reason: !modelEnabled
          ? "Interpreter model is disabled."
          : "Deterministic evidence is sufficient; no extra interpretation call is justified.",
      },
    };
  }

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
      interpretation: mergeModelInterpretation(deterministic, extractJsonObject(response.text), context),
      modelUsed: true,
      rawModelOutput: response.text,
      modelTrace: {
        attempted: true,
        used: true,
        reason: "Low-confidence relational pragmatics require multiple-interpretation evidence before planning.",
        model: response.model,
        latencyMs: response.latencyMs,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        promptMessages: messages,
        rawOutput: response.text,
      },
    };
  } catch (error) {
    return {
      interpretation: { ...deterministic, notes: [...deterministic.notes, "Model interpretation unavailable; deterministic evidence preserved."] },
      modelUsed: false,
      rawModelOutput: null,
      modelTrace: {
        attempted: true,
        used: false,
        reason: "Low-confidence relational pragmatics requested model evidence, but the provider failed.",
        promptMessages: messages,
        error: error instanceof Error ? error.message : "Unknown interpreter provider failure",
      },
    };
  }
};
