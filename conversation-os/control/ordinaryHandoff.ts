import type {
  ConversationControlContext,
  DialogueState,
  OrdinaryHandoffBoundary,
  ResponseAction,
} from "./types";
import { evaluateSemanticEvidence } from "@/services/clinical/semanticEvidence";

const hasActivity = (
  state: DialogueState,
  activity: DialogueState["currentActivity"]["primary"]
) => state.currentActivity.primary === activity || state.currentActivity.concurrent.includes(activity);

const hasHigherPriorityOwner = (state: DialogueState) => [
  "answering_obligation",
  "repairing_common_ground",
  "supporting_emotion",
  "supporting_action",
  "pausing",
  "idle",
].some((activity) => hasActivity(state, activity as DialogueState["currentActivity"]["primary"]));

const hasEstablishedThreadEvidence = (
  context: ConversationControlContext
) => {
  if (context.semanticEvidence.source === "established_conversation_frame") return true;
  return context.adjacentTurns.some((turn, index) =>
    turn.role === "user" &&
    evaluateSemanticEvidence({
      userTurn: turn.content,
      recentMessages: context.adjacentTurns.slice(0, index),
    }).status === "sufficient"
  );
};

export const selectOrdinaryHandoffAction = ({
  context,
  state,
  boundary,
}: {
  context: ConversationControlContext;
  state: DialogueState;
  boundary: OrdinaryHandoffBoundary | null;
}): ResponseAction | null => {
  if (!boundary || boundary.applicability !== "uncertain" || hasHigherPriorityOwner(state)) return null;

  if (
    context.activeAnswerFrame.compatible ||
    context.semanticEvidence.source === "established_conversation_frame"
  ) return "continue_established_frame";

  if (hasEstablishedThreadEvidence(context)) return "continue_established_thread";

  const previousMove = state.lastCommittedAssistantMove;
  const questionsForbidden = boundary.userBoundaries.some((item) =>
    item === "no_questions" || item === "pause" || item === "stop"
  );
  const previousMoveAlreadyAsked = previousMove?.questionOrRequest?.kind === "question" ||
    previousMove?.purpose.includes("invite_low_pressure_calibration");

  if (questionsForbidden || previousMoveAlreadyAsked) return "offer_neutral_conversation_entry";
  return "invite_low_pressure_calibration";
};
