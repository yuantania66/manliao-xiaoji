import { parseCommittedAssistantMoveEnvelope } from "../interactionMoveEnvelope";
import type {
  CommittedAssistantMoveEnvelopeV1,
  ProactiveGreetingAssistantMoveEnvelopeV1,
} from "../interactionMoveEnvelope";
import type { ConversationMessage } from "../types";

import type {
  ActiveInteractionMoveHandoffTarget,
  RelationalInterpretationCandidate,
  UserMoveRelationCandidate,
  UserMoveRelationKind,
  UserMoveRelationProjection,
} from "./types";

export const retainCommittedAssistantMoveEnvelope = (
  message: ConversationMessage
): CommittedAssistantMoveEnvelopeV1 | null => {
  if (message.role !== "assistant" || message.status === "blocked") return null;
  const parsed = parseCommittedAssistantMoveEnvelope(message.interactionMoveEnvelope);
  if (parsed.status !== "valid") return null;
  if (message.id && message.id !== parsed.envelope.assistantMoveId) return null;
  return parsed.envelope;
};

const isProactiveGreetingOpenEnvelope = (
  envelope: CommittedAssistantMoveEnvelopeV1
): envelope is ProactiveGreetingAssistantMoveEnvelopeV1 =>
  envelope.origin.kind === "proactive_greeting" && envelope.handoff?.edge === "opens";

export const projectActiveInteractionMoveHandoffTarget = (
  adjacentTurns: ConversationMessage[]
): ActiveInteractionMoveHandoffTarget | null => {
  const immediatelyPrecedingEvent = adjacentTurns.at(-1);
  if (!immediatelyPrecedingEvent || immediatelyPrecedingEvent.role !== "assistant") {
    return null;
  }
  const envelope = retainCommittedAssistantMoveEnvelope(immediatelyPrecedingEvent);
  if (!envelope || !isProactiveGreetingOpenEnvelope(envelope)) {
    return null;
  }
  return {
    sourceAssistantMoveId: envelope.assistantMoveId,
    sourceGreetingFunction: envelope.handoff.greetingFunction,
    envelope,
  };
};

const relationKindFor = ({
  relation,
  semanticEvidenceStatus,
}: {
  relation: RelationalInterpretationCandidate["relation"];
  semanticEvidenceStatus: "sufficient" | "insufficient";
}): UserMoveRelationKind => {
  if (relation === "acknowledges_previous_move" || relation === "shares_initiative") {
    return "reciprocates_move";
  }
  if (relation === "answers_previous_move") return "answers_move";
  if (relation === "continues_active_thread") {
    return semanticEvidenceStatus === "sufficient" ? "continues_from_move" : "unclear";
  }
  if (
    relation === "opens_new_thread" ||
    relation === "requests_answer" ||
    relation === "requests_action_support" ||
    relation === "shares_distress"
  ) {
    return "opens_or_redirects_thread";
  }
  if (relation === "repairs_previous_move" || relation === "challenges_move_fit") {
    return "challenges_move_fit";
  }
  if (relation === "yields_initiative" || relation === "rejects_or_declines_move") {
    return "rejects_or_declines_move";
  }
  if (relation === "requests_pause") return "sets_boundary_or_pause";
  return "unclear";
};

export const projectUserMoveRelation = ({
  target,
  sourceUserTurnId,
  currentUserText,
  semanticEvidenceStatus,
  responseRelation,
}: {
  target: ActiveInteractionMoveHandoffTarget | null;
  sourceUserTurnId: string;
  currentUserText: string;
  semanticEvidenceStatus: "sufficient" | "insufficient";
  responseRelation: {
    candidates: RelationalInterpretationCandidate[];
    ambiguous: boolean;
  };
}): UserMoveRelationProjection | null => {
  if (!target || !sourceUserTurnId || currentUserText.length === 0) return null;
  const exactTurnSpan = {
    source: "current_user_turn" as const,
    sourceUserTurnId,
    start: 0,
    end: currentUserText.length,
    text: currentUserText,
  };
  const candidatesByKind = new Map<UserMoveRelationKind, UserMoveRelationCandidate>();

  for (const candidate of responseRelation.candidates) {
    if (
      candidate.targetTurnId &&
      candidate.targetTurnId !== target.sourceAssistantMoveId
    ) {
      continue;
    }
    const kind = relationKindFor({
      relation: candidate.relation,
      semanticEvidenceStatus,
    });
    const projected = {
      kind,
      confidence: Math.max(0, Math.min(1, candidate.confidence)),
      evidence: [exactTurnSpan],
    } satisfies UserMoveRelationCandidate;
    const existing = candidatesByKind.get(kind);
    if (!existing || projected.confidence > existing.confidence) {
      candidatesByKind.set(kind, projected);
    }
  }

  const candidates = [...candidatesByKind.values()].sort(
    (left, right) => right.confidence - left.confidence
  );
  if (candidates.length === 0) return null;
  return {
    sourceUserTurnId,
    targetAssistantMoveId: target.sourceAssistantMoveId,
    targetFunction: target.sourceGreetingFunction,
    candidates,
    ambiguous: candidates.length > 1 && responseRelation.ambiguous,
  };
};
