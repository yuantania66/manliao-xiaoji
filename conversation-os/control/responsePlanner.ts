import { getGroundingFacts } from "./assistantGrounding";
import type { ClinicalStrategyAdvice, ConversationControlContext, DialogueState, ResponseAction, ResponsePlan, TurnInterpretation } from "./types";

export type ClinicalAdviceProvider = (input: {
  need: "emotional_support" | "action_support";
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
}) => ClinicalStrategyAdvice | null;

const unique = <T>(items: T[]) => Array.from(new Set(items));

export const createResponsePlan = ({ context, interpretation, dialogueState, clinicalAdviceProvider }: {
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
  dialogueState: DialogueState;
  clinicalAdviceProvider: ClinicalAdviceProvider;
}): ResponsePlan => {
  const actions: ResponseAction[] = [];
  if (dialogueState.answerObligations.length) actions.push("answer_directly");
  if (dialogueState.activeInteractionNeeds.includes("explanation")) actions.push("explain_plainly");
  if (dialogueState.activeInteractionNeeds.includes("repair")) actions.push("repair_previous_wording");
  if (context.interaction.stopIntent) actions.push("respect_pause");
  else if (interpretation.primaryDialogueAct === "yield_initiative" && context.interaction.affect !== "negative") actions.push("take_light_topic_initiative");
  else if (!dialogueState.answerObligations.length) actions.push("acknowledge_without_psychologizing");

  const clinicalNeed = dialogueState.activeInteractionNeeds.includes("action_support")
    ? "action_support"
    : dialogueState.activeInteractionNeeds.includes("emotional_support") ? "emotional_support" : null;
  const clinicalStrategy = clinicalNeed ? clinicalAdviceProvider({ need: clinicalNeed, context, interpretation }) : null;
  if (clinicalNeed === "action_support") actions.push("offer_action_support");
  if (clinicalNeed === "emotional_support") actions.push("offer_emotional_support");

  const groundingFacts = unique([
    ...getGroundingFacts(interpretation.groundingReference),
    ...dialogueState.answerObligations.flatMap((item) => item.requiredFacts),
    ...dialogueState.confirmedFacts.filter((fact) => fact.startsWith("Selected user-confirmed memory:")),
  ]);
  const stop = context.interaction.stopIntent;
  const simpleDirectAnswer = dialogueState.answerObligations.length > 0 && !clinicalNeed;
  return {
    planId: `${context.conversationId}:${Date.now()}:${context.currentUserMessage.length}`,
    decisionOwner: "conversation_os.response_planner",
    answerObligations: dialogueState.answerObligations,
    responseActions: unique(actions),
    groundingFacts,
    clinicalStrategy,
    questionPolicy: {
      mode: stop || simpleDirectAnswer || context.interaction.initiativeDirection === "shared"
        ? "none"
        : interpretation.primaryDialogueAct === "yield_initiative"
          ? "one_low_pressure_question"
          : "optional_after_answer",
      reason: stop ? "The user requested lower interaction." : simpleDirectAnswer ? "A concise direct answer is sufficient for the explicit question." : "A question is allowed only after required actions and only if it helps the user.",
    },
    closurePolicy: {
      mode: stop ? "allow_pause" : "forbid_closure",
      reason: stop ? "Explicit stop evidence permits a pause." : "No explicit stop evidence; do not close or retreat from the conversation.",
    },
    tone: ["natural Chinese", "direct", "warm without counselling jargon"],
    stance: [
      "Answer explicit questions before empathy, explanation, or follow-up.",
      "Do not make the user repair the assistant's wording or capabilities.",
      "Do not infer negative affect from missing topic content.",
    ],
    lengthGuidance: simpleDirectAnswer ? "Usually one concise sentence; at most two." : "Usually one or two concise sentences.",
    prohibitedClaims: unique([
      "Do not claim to have a body, physical presence, sight, hearing, voice output, or unsupported real-world access.",
      "Do not claim a user emotion, intention, or psychological state without evidence.",
      ...(context.semanticEvidence.status === "insufficient" ? ["Do not infer meaning from message form or repetition."] : []),
    ]),
    safetyConstraints: context.safety.triggered ? [context.safety.reason ?? "Safety override applies."] : [],
    evidence: unique([
      `primaryDialogueAct=${interpretation.primaryDialogueAct}`,
      `answerObligations=${dialogueState.answerObligations.length}`,
      `clinicalInvoked=${Boolean(clinicalStrategy)}`,
      ...context.interaction.evidence,
      ...dialogueState.conversationContinuity.evidence,
    ]),
  };
};
