import type { ConversationControlContext, DeclinedSharingSource, DialogueState, TurnInterpretation } from "./types";
import { declinesSharingInvitation, reopensInteraction, extractAffectEvidence, isAssistantSharingInvitation } from "../state";

// Shared existing decisions; no additional classification or matching rules.
export const hasExpressionBurden = (text: string) =>
  /(?:不想|不要|不用).{0,8}(?:分析|解释|找原因|讲原因)|不知道为什么/u.test(text);

export const sharingInvitationDeclinedSource = (context: ConversationControlContext): DeclinedSharingSource | null => {
  if (declinesSharingInvitation(context.currentUserMessage)) return "current_turn";
  const previousUserTurn = [...context.adjacentTurns].reverse().find((turn) => turn.role === "user");
  return previousUserTurn &&
    declinesSharingInvitation(previousUserTurn.content) &&
    !reopensInteraction(context.currentUserMessage)
    ? "previous_user_turn"
    : null;
};

// Conservative adoption from existing source-bound signals, never from a legacy
// posture suggestion, factual roles alone or the compatibility continuity label.
export const supportsOrdinaryExperienceInvitation = (
  context: ConversationControlContext, interpretation: TurnInterpretation, state: DialogueState
): boolean => {
  if (context.safety.triggered || context.correction || sharingInvitationDeclinedSource(context) ||
      hasExpressionBurden(context.currentUserMessage) || interpretation.primaryDialogueAct !== "share" ||
      interpretation.contentMeaning.directQuestions.length || state.openObligations.length ||
      state.initiativeOwner !== "user" ||
      !["ordinary_exchange", "developing_thread"].includes(state.currentActivity.primary) ||
      state.currentActivity.concurrent.some(activity => ["pausing", "idle", "repairing_common_ground", "answering_obligation"].includes(activity))) return false;
  const previous = context.adjacentTurns.at(-1);
  const previousUser = [...context.adjacentTurns].reverse().find(turn => turn.role === "user");
  if (!previous || previous.role !== "assistant" || (previous.status !== undefined && previous.status !== "saved") ||
      !isAssistantSharingInvitation(previous.content) ||
      state.lastCommittedAssistantMove?.questionOrRequest?.kind === "question" ||
      state.lastCommittedAssistantMove?.expectedUserContribution === "answer") return false;
  const relations = interpretation.responseRelation.candidates;
  if (!relations.length || !relations.some(item => item.relation === "continues_active_thread" &&
        !(item.confidence === 0.68 && item.evidence.length === 1 &&
          item.evidence[0] === "Current user turn follows an adjacent assistant turn.")) ||
      relations.some(item => item.targetTurnId !== previous.id || item.targetProposition || item.targetOperation ||
        !["continues_active_thread", "acknowledges_previous_move"].includes(item.relation))) return false;
  // An already expressed personal concern supplies the topic; affect alone does
  // not grant an invitation without the actual invitation and continuation above.
  const personalConcern = [context.currentUserMessage, previousUser?.content ?? ""].some(text =>
    extractAffectEvidence(text).some(span => span.object === "self_experience" || span.object === "interpersonal_experience"));
  return personalConcern && interpretation.contentMeaning.explicitPropositions.some(item =>
    item.sourceTurnId === context.currentTurnId && item.text.trim() && context.currentUserMessage.includes(item.text)) &&
    context.currentUserMessage !== previousUser?.content;
};
