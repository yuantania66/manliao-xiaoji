import type {
  ConversationControlContext,
  DialogueState,
  TurnInterpretation,
} from "@/conversation-os/control";

import type {
  CommittedHelpingMove,
  CurrentRelationshipEvidence,
  HillHelpingInput,
  HillUserBoundary,
} from "./hillHelpingTypes";
import { evaluateSemanticEvidence } from "@/services/clinical/semanticEvidence";

const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();

const boundaryFromExplicitText = ({
  text,
  sourceTurnId,
}: {
  text: string;
  sourceTurnId: string;
}): HillUserBoundary[] => {
  const boundaries: HillUserBoundary[] = [];
  if (/(?:不要|别|不想|不用).{0,6}(?:建议|办法|方案)/u.test(text)) {
    boundaries.push({
      kind: "no_advice",
      sourceTurnId,
      text,
      evidence: ["The current user turn explicitly rejects advice or solution-giving."],
    });
  }
  if (/(?:不要|别|不想|不用).{0,6}(?:分析|解读|剖析)/u.test(text)) {
    boundaries.push({
      kind: "no_analysis",
      sourceTurnId,
      text,
      evidence: ["The current user turn explicitly rejects analysis or interpretation."],
    });
  }
  if (/(?:不要|别|不想|不用).{0,6}(?:问|提问|追问)/u.test(text)) {
    boundaries.push({
      kind: "no_questions",
      sourceTurnId,
      text,
      evidence: ["The current user turn explicitly rejects questions."],
    });
  }
  return boundaries;
};

const buildUserBoundaries = ({
  context,
  interpretation,
}: {
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
}): HillUserBoundary[] => {
  const text = normalize(context.currentUserMessage);
  const hasPriorAssistantTurn = context.adjacentTurns.some((turn) => turn.role === "assistant");
  const boundaries = boundaryFromExplicitText({ text, sourceTurnId: context.currentTurnId });
  if (context.interaction.stopIntent) {
    boundaries.push({
      kind: context.interaction.engagement === "stop_requested" ? "stop" : "pause",
      sourceTurnId: context.currentTurnId,
      text,
      evidence: context.interaction.evidence.filter((item) =>
        item.includes("stop") || item.includes("pause")
      ),
    });
  }
  if (interpretation.correction && hasPriorAssistantTurn) {
    boundaries.push({
      kind: "correction",
      sourceTurnId: context.currentTurnId,
      text,
      evidence: interpretation.correction.evidence,
    });
  }
  return boundaries.filter(
    (boundary, index, items) =>
      items.findIndex((candidate) => candidate.kind === boundary.kind) === index
  );
};

const buildRelationshipEvidence = ({
  context,
  interpretation,
  dialogueState,
}: {
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
  dialogueState: DialogueState;
}): CurrentRelationshipEvidence[] => {
  const hasPriorAssistantTurn = context.adjacentTurns.some((turn) => turn.role === "assistant");
  if (!hasPriorAssistantTurn) return [];
  if (!interpretation.correction && dialogueState.repairState.status !== "active") return [];
  const evidence = Array.from(new Set([
    ...(interpretation.correction?.evidence ?? []),
    ...dialogueState.repairState.evidence,
  ]));
  return [{
    kind: interpretation.correction ? "misunderstanding" : "strain",
    sourceTurnId: context.currentTurnId,
    text: normalize(context.currentUserMessage),
    evidence,
  }];
};

const buildEstablishedConversationContext = (
  context: ConversationControlContext
): HillHelpingInput["establishedConversationContext"] => {
  const evidence: HillHelpingInput["establishedConversationContext"] = [];
  if (context.activeAnswerFrame.compatible) {
    evidence.push({
      kind: "active_answer_frame",
      sourceTurnId: context.currentTurnId,
      evidence: [
        `activeAnswerFrame.type=${context.activeAnswerFrame.type ?? "unknown"}`,
        `activeAnswerFrame.question=${context.activeAnswerFrame.question ?? "unknown"}`,
      ],
    });
  }
  for (const [index, turn] of context.adjacentTurns.entries()) {
    if (turn.role !== "user") continue;
    const semanticEvidence = evaluateSemanticEvidence({
      userTurn: turn.content,
      recentMessages: context.adjacentTurns.slice(0, index),
    });
    if (semanticEvidence.status !== "sufficient") continue;
    evidence.push({
      kind: "prior_semantic_topic",
      sourceTurnId: turn.id ?? `${context.conversationId}:prior-user-${index + 1}`,
      evidence: [
        `semanticEvidence.source=${semanticEvidence.source}`,
        semanticEvidence.reason,
      ],
    });
  }
  return evidence.slice(-4);
};

export const buildHillHelpingInput = ({
  context,
  interpretation,
  dialogueState,
  recentCommittedHelpingMoves = [],
}: {
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
  dialogueState: DialogueState;
  recentCommittedHelpingMoves?: CommittedHelpingMove[];
}): HillHelpingInput => ({
  userTurnId: context.currentTurnId,
  currentUserMaterial: {
    sourceTurnId: context.currentTurnId,
    literalText: context.currentUserMessage,
    semanticEvidence: interpretation.contentMeaning.semanticEvidence,
    explicitPropositions: interpretation.contentMeaning.explicitPropositions,
    directQuestions: interpretation.contentMeaning.directQuestions,
  },
  turnInterpretation: interpretation,
  dialogueState,
  interactionState: dialogueState,
  directObligations: dialogueState.openObligations,
  userBoundaries: buildUserBoundaries({ context, interpretation }),
  currentRelationshipEvidence: buildRelationshipEvidence({ context, interpretation, dialogueState }),
  establishedConversationContext: buildEstablishedConversationContext(context),
  // Batch 1 has no committed Helping moves yet. Preserve caller chronology;
  // opaque turn ids are not a valid timestamp and must never be used to reorder.
  recentCommittedHelpingMoves: recentCommittedHelpingMoves.slice(-8),
});
