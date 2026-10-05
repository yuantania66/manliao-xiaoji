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
  questionsDeclined = false,
}: {
  context: ConversationControlContext;
  state: DialogueState;
  boundary: OrdinaryHandoffBoundary | null;
  questionsDeclined?: boolean;
}): ResponseAction | null => {
  if (!boundary || boundary.applicability !== "uncertain" || hasHigherPriorityOwner(state)) return null;

  if (
    context.activeAnswerFrame.compatible ||
    context.semanticEvidence.source === "established_conversation_frame"
  ) return "continue_established_frame";

  if (hasEstablishedThreadEvidence(context)) return "continue_established_thread";

  const questionsForbidden = questionsDeclined || boundary.userBoundaries.some((item) =>
    item === "no_questions" || item === "pause" || item === "stop"
  );

  if (questionsForbidden || lowInformationWindowAlreadyAsked(context, state)) {
    return "offer_neutral_conversation_entry";
  }
  return "invite_low_pressure_calibration";
};

// Reached only when no adjacent user turn carries sufficient meaning, so the adjacent window is the
// current low-information stretch. History holds committed Assistant replies only; failed or
// uncommitted generations never enter it and therefore never count as an asked calibration.
const lowInformationWindowAlreadyAsked = (
  context: ConversationControlContext,
  state: DialogueState
) => {
  const previousMove = state.lastCommittedAssistantMove;
  if (
    previousMove?.questionOrRequest?.kind === "question" ||
    previousMove?.purpose.includes("invite_low_pressure_calibration")
  ) return true;
  return context.adjacentTurns.some((turn) => {
    if (turn.role !== "assistant" || turn.status === "blocked") return false;
    const committed = turn.committedAssistantMove;
    if (committed) {
      return committed.questionOrRequest?.kind === "question" ||
        committed.purpose.includes("invite_low_pressure_calibration");
    }
    return /[？?]\s*$/u.test(turn.content);
  });
};
