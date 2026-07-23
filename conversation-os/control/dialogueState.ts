import { getGroundingFacts } from "./assistantGrounding";
import type { AnswerObligation, ConversationControlContext, DialogueState, TurnInterpretation } from "./types";

const obligationFor = (question: TurnInterpretation["directQuestions"][number], index: number, interpretation: TurnInterpretation): AnswerObligation => ({
  id: `answer-${index + 1}`,
  question: question.text,
  kind: question.kind,
  priority: "must_answer_first",
  requiredFacts: getGroundingFacts(interpretation.groundingReference),
  evidence: question.evidence,
});

export const buildDialogueState = (context: ConversationControlContext, interpretation: TurnInterpretation): DialogueState => {
  const answerObligations = interpretation.directQuestions.map((question, index) => obligationFor(question, index, interpretation));
  const lastAssistant = [...context.adjacentTurns].reverse().find((message) => message.role === "assistant")?.content ?? "";
  const followsPreviousWording = interpretation.groundingReference === "previous_wording" || interpretation.repairSignal;
  const relation = context.interaction.initiativeDirection === "assistant_invited"
    ? "responds_to_invitation"
    : followsPreviousWording ? "follows_previous_wording" : context.adjacentTurns.length ? "continues_topic" : "new_topic";
  const needs: DialogueState["activeInteractionNeeds"] = [];
  if (answerObligations.length) needs.push("direct_answer");
  if (interpretation.primaryDialogueAct === "ask_definition" || interpretation.primaryDialogueAct === "challenge_contradiction") needs.push("explanation");
  if (interpretation.repairSignal || followsPreviousWording) needs.push("repair");
  if (interpretation.primaryDialogueAct === "seek_emotional_support" || interpretation.secondarySignals.includes("seek_emotional_support")) needs.push("emotional_support");
  if (interpretation.primaryDialogueAct === "request_action_support") needs.push("action_support");
  if (context.interaction.stopIntent) needs.push("pause");
  if (!needs.length || interpretation.primaryDialogueAct === "yield_initiative") needs.push("ordinary_interaction");
  return {
    openLoops: answerObligations.map((item) => item.id),
    answerObligations,
    currentInitiative: context.interaction.initiativeDirection,
    repairState: interpretation.repairSignal ? "assistant_misunderstanding" : followsPreviousWording ? "wording_or_grounding_repair" : "none",
    conversationContinuity: { relation, evidence: [...(lastAssistant ? [`previousAssistant=${lastAssistant}`] : []), ...context.interaction.evidence] },
    confirmedFacts: context.confirmedFacts,
    unconfirmedHypotheses: context.unconfirmedHypotheses,
    activeInteractionNeeds: Array.from(new Set(needs)),
  };
};
