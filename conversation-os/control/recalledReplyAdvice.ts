import type {
  ConversationControlContext,
  DialogueState,
  RecalledEvidence,
  ReplyRecallEvidence,
  ResponsePlan,
  TurnInterpretation,
} from "./types";

const ordinaryActions = new Set<ResponsePlan["responseActions"][number]>([
  "acknowledge_without_psychologizing",
  "continue_established_frame",
  "continue_established_thread",
]);

export const canUseRecalledReplyAdvice = (plan: ResponsePlan): boolean =>
  plan.behaviorSource === "ordinary_conversation" &&
  !plan.correction && !plan.clinicalStrategy && !plan.positiveFunctionContract &&
  !plan.interactionMoveHandoffPlan && !plan.answerObligations.length && !plan.requiredDisclosure.length &&
  !plan.safetyConstraints.length && plan.closurePolicy.mode === "forbid_closure" &&
  plan.responseActions.length > 0 && plan.responseActions.every((action) => ordinaryActions.has(action));

export const resolveRecalledReplySource = ({
  context,
  interpretation,
  dialogueState,
  recall,
}: {
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
  dialogueState: DialogueState;
  recall?: ReplyRecallEvidence | null;
}): { source: RecalledEvidence; ref: string } | null => {
  if (!recall || context.safety.triggered || context.interactionMoveHandoffTarget ||
      interpretation.responseRelation.ambiguous || interpretation.directQuestions.length ||
      interpretation.groundingReference !== "none" || interpretation.purposeSubjectOwnershipAuthority ||
      interpretation.interaction.stopIntent || interpretation.repairSignal || interpretation.correction ||
      dialogueState.repairState.status === "active" || dialogueState.openObligations.length) return null;

  const { history, reference } = recall;
  const { sourceTurnId, currentQuote, sourceQuote } = reference;
  if (history.referenceText !== context.currentUserMessage || !sourceTurnId || sourceTurnId === context.currentTurnId ||
      currentQuote.trim().length < 2 || sourceQuote.trim().length < 2 ||
      !context.currentUserMessage.includes(currentQuote)) return null;

  const matchingSources = history.candidates.filter((candidate) => candidate.sourceTurnId === sourceTurnId);
  if (matchingSources.length !== 1) return null;

  const source = matchingSources[0];
  const sourceTime = Date.parse(source.createdAt);
  const turnTime = Date.parse(history.currentTurnCreatedAt ?? "");
  const ageLimit = history.confirmationAfterDays * 86_400_000;
  if (source.role !== "user" || !source.sourceConversationId || !source.text.includes(sourceQuote) ||
      history.candidates.filter((candidate) => candidate.text.includes(sourceQuote)).length !== 1 ||
      !source.matchedTerms.some((term) => term.length >= 2 && currentQuote.includes(term) && sourceQuote.includes(term)) ||
      !Number.isFinite(sourceTime) || !Number.isFinite(turnTime) || !Number.isFinite(ageLimit) ||
      sourceTime >= turnTime || ageLimit <= 0 || turnTime - sourceTime > ageLimit) return null;

  return { source, ref: `R${history.candidates.indexOf(source) + 1}` };
};
