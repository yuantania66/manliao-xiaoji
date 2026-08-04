import { parseCommittedAssistantMoveMetadata } from "./committedHelpingMoveMetadata";
import type { CommittedHelpingMove, HelpingReactionCandidate } from "./hillHelpingTypes";

export const FORMAL_HELPING_MOVE_FIXTURE_WINDOW_LIMIT = 8 as const;

export type FormalHelpingMoveFixtureRecord = {
  sessionId: string;
  messageId: string;
  role: "user" | "assistant";
  committedOrder: number;
  interactionMetadata: unknown;
};

export type LoadedFormalHelpingMove = {
  sessionId: string;
  messageId: string;
  committedOrder: number;
  move: CommittedHelpingMove;
};

export type FormalHelpingMoveLoadTraceEntry = {
  recordIndex: number;
  messageId: string | null;
  status: "loaded" | "ignored";
  reason:
    | "formal_v1_loaded"
    | "different_session"
    | "non_assistant_role"
    | "invalid_message_id"
    | "invalid_committed_order"
    | "duplicate_message_id"
    | "duplicate_committed_order"
    | "metadata_absent"
    | "metadata_invalid"
    | "ordinary_without_helping"
    | "assistant_turn_mismatch"
    | "outside_bounded_window";
};

export type FormalHelpingMoveFixtureLoadResult = {
  moves: LoadedFormalHelpingMove[];
  trace: FormalHelpingMoveLoadTraceEntry[];
};

export type HelpingAssociationRelation =
  HelpingReactionCandidate["relationToPreviousMove"];

export type HelpingAssociationSemanticEvidence = {
  sourceUserTurnId: string;
  targetAssistantTurnId: string;
  relation: HelpingAssociationRelation;
  evidence: string[];
};

export type HelpingAssociationLookupResult =
  | {
      status: "associated";
      targetAssistantTurnId: string;
      relation: Exclude<HelpingAssociationRelation, "topic_shift" | "unclear">;
      move: CommittedHelpingMove;
      evidence: string[];
    }
  | {
      status: "not_associated";
      reason:
        | "no_formal_moves"
        | "conflicting_explicit_targets"
        | "target_not_formal"
        | "missing_target_bound_semantic_evidence"
        | "invalid_semantic_evidence"
        | "non_associating_relation"
        | "ambiguous_semantic_target"
        | "ambiguous_relation"
        | "correction_relation_mismatch";
    };

const ASSOCIATING_RELATIONS = [
  "direct_response",
  "continues_move",
  "rejects_move",
] as const satisfies readonly HelpingAssociationRelation[];
const ALL_RELATIONS = [
  ...ASSOCIATING_RELATIONS,
  "topic_shift",
  "unclear",
] as const satisfies readonly HelpingAssociationRelation[];
const SEMANTIC_EVIDENCE_KEYS = new Set([
  "sourceUserTurnId",
  "targetAssistantTurnId",
  "relation",
  "evidence",
]);

type MissingRelation = Exclude<HelpingAssociationRelation, (typeof ALL_RELATIONS)[number]>;
const RELATIONS_ARE_EXHAUSTIVE: MissingRelation extends never ? true : never = true;
void RELATIONS_ARE_EXHAUSTIVE;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isNonEmptyStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);

const isMember = <T extends readonly string[]>(value: unknown, members: T): value is T[number] =>
  typeof value === "string" && members.includes(value as T[number]);

const cloneJsonValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const validCommittedOrder = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const countBy = <T>(values: T[]) => {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
};

export const loadFormalCommittedHelpingMoveFixtures = ({
  records,
  sessionId,
  explicitTargetAssistantTurnId,
}: {
  records: FormalHelpingMoveFixtureRecord[];
  sessionId: string;
  explicitTargetAssistantTurnId?: string | null;
}): FormalHelpingMoveFixtureLoadResult => {
  const identityDomain = records.filter((record) =>
    record.sessionId === sessionId &&
    record.role === "assistant" &&
    isNonEmptyString(record.messageId) &&
    validCommittedOrder(record.committedOrder)
  );
  const messageIdCounts = countBy(identityDomain.map((record) => record.messageId));
  const committedOrderCounts = countBy(identityDomain.map((record) => record.committedOrder));
  const trace: FormalHelpingMoveLoadTraceEntry[] = [];
  const formalCandidates: Array<LoadedFormalHelpingMove & { traceIndex: number }> = [];

  for (const [recordIndex, record] of records.entries()) {
    const messageId = isNonEmptyString(record.messageId) ? record.messageId : null;
    const ignored = (reason: FormalHelpingMoveLoadTraceEntry["reason"]) => {
      trace.push({ recordIndex, messageId, status: "ignored", reason });
    };

    if (record.sessionId !== sessionId) {
      ignored("different_session");
      continue;
    }
    if (record.role !== "assistant") {
      ignored("non_assistant_role");
      continue;
    }
    if (!messageId) {
      ignored("invalid_message_id");
      continue;
    }
    if (!validCommittedOrder(record.committedOrder)) {
      ignored("invalid_committed_order");
      continue;
    }
    if ((messageIdCounts.get(messageId) ?? 0) > 1) {
      ignored("duplicate_message_id");
      continue;
    }
    if ((committedOrderCounts.get(record.committedOrder) ?? 0) > 1) {
      ignored("duplicate_committed_order");
      continue;
    }

    const parsed = parseCommittedAssistantMoveMetadata(record.interactionMetadata);
    if (parsed.status === "absent") {
      ignored("metadata_absent");
      continue;
    }
    if (parsed.status === "invalid") {
      ignored("metadata_invalid");
      continue;
    }
    if (parsed.source !== "formal_v1" || !parsed.helping) {
      ignored("ordinary_without_helping");
      continue;
    }
    if (parsed.helping.assistantTurnId !== messageId) {
      ignored("assistant_turn_mismatch");
      continue;
    }

    const traceIndex = trace.length;
    trace.push({
      recordIndex,
      messageId,
      status: "ignored",
      reason: "outside_bounded_window",
    });
    formalCandidates.push({
      sessionId,
      messageId,
      committedOrder: record.committedOrder,
      move: cloneJsonValue(parsed.helping),
      traceIndex,
    });
  }

  formalCandidates.sort((left, right) => left.committedOrder - right.committedOrder);
  const normalizedExplicitTarget = isNonEmptyString(explicitTargetAssistantTurnId)
    ? explicitTargetAssistantTurnId
    : null;
  const latestWindow = formalCandidates.slice(-FORMAL_HELPING_MOVE_FIXTURE_WINDOW_LIMIT);
  const explicitTarget = normalizedExplicitTarget
    ? formalCandidates.find((candidate) => candidate.messageId === normalizedExplicitTarget)
    : undefined;
  const selected = explicitTarget && !latestWindow.includes(explicitTarget)
    ? [
        explicitTarget,
        ...formalCandidates
          .filter((candidate) => candidate !== explicitTarget)
          .slice(-(FORMAL_HELPING_MOVE_FIXTURE_WINDOW_LIMIT - 1)),
      ].sort((left, right) => left.committedOrder - right.committedOrder)
    : latestWindow;

  for (const candidate of selected) {
    trace[candidate.traceIndex] = {
      recordIndex: trace[candidate.traceIndex].recordIndex,
      messageId: candidate.messageId,
      status: "loaded",
      reason: "formal_v1_loaded",
    };
  }

  return {
    moves: selected.map((candidate) => ({
      sessionId: candidate.sessionId,
      messageId: candidate.messageId,
      committedOrder: candidate.committedOrder,
      move: candidate.move,
    })),
    trace,
  };
};

const validateSemanticEvidence = (
  value: unknown
): value is HelpingAssociationSemanticEvidence => {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !SEMANTIC_EVIDENCE_KEYS.has(key))) return false;
  return isNonEmptyString(value.sourceUserTurnId) &&
    isNonEmptyString(value.targetAssistantTurnId) &&
    isMember(value.relation, ALL_RELATIONS) &&
    isNonEmptyStringArray(value.evidence);
};

const associationForTarget = ({
  target,
  semanticEvidence,
  correctionTarget,
}: {
  target: LoadedFormalHelpingMove;
  semanticEvidence: HelpingAssociationSemanticEvidence[];
  correctionTarget: boolean;
}): HelpingAssociationLookupResult => {
  if (semanticEvidence.length === 0) {
    return { status: "not_associated", reason: "missing_target_bound_semantic_evidence" };
  }
  const relations = Array.from(new Set(semanticEvidence.map((item) => item.relation)));
  if (relations.length > 1) {
    return { status: "not_associated", reason: "ambiguous_relation" };
  }
  const relation = relations[0];
  if (relation === "topic_shift" || relation === "unclear") {
    return { status: "not_associated", reason: "non_associating_relation" };
  }
  if (correctionTarget && relation !== "rejects_move") {
    return { status: "not_associated", reason: "correction_relation_mismatch" };
  }
  return {
    status: "associated",
    targetAssistantTurnId: target.messageId,
    relation,
    move: cloneJsonValue(target.move),
    evidence: Array.from(new Set(semanticEvidence.flatMap((item) => item.evidence))),
  };
};

export const lookupAssociatedCommittedHelpingMove = ({
  loadedMoves,
  currentUserTurnId,
  explicitReplyToAssistantTurnId,
  correctionTargetAssistantTurnId,
  semanticEvidence,
}: {
  loadedMoves: LoadedFormalHelpingMove[];
  currentUserTurnId: string;
  explicitReplyToAssistantTurnId?: string | null;
  correctionTargetAssistantTurnId?: string | null;
  semanticEvidence: HelpingAssociationSemanticEvidence[];
}): HelpingAssociationLookupResult => {
  if (loadedMoves.length === 0) return { status: "not_associated", reason: "no_formal_moves" };
  if (!isNonEmptyString(currentUserTurnId)) {
    return { status: "not_associated", reason: "invalid_semantic_evidence" };
  }
  if (!semanticEvidence.every(validateSemanticEvidence)) {
    return { status: "not_associated", reason: "invalid_semantic_evidence" };
  }

  const explicitReplyTarget = isNonEmptyString(explicitReplyToAssistantTurnId)
    ? explicitReplyToAssistantTurnId
    : null;
  const correctionTarget = isNonEmptyString(correctionTargetAssistantTurnId)
    ? correctionTargetAssistantTurnId
    : null;
  if (explicitReplyTarget && correctionTarget && explicitReplyTarget !== correctionTarget) {
    return { status: "not_associated", reason: "conflicting_explicit_targets" };
  }

  const byAssistantTurnId = new Map(loadedMoves.map((item) => [item.messageId, item]));
  const currentTurnEvidence = semanticEvidence.filter(
    (item) => item.sourceUserTurnId === currentUserTurnId
  );
  const explicitTarget = correctionTarget ?? explicitReplyTarget;
  if (explicitTarget) {
    const target = byAssistantTurnId.get(explicitTarget);
    if (!target) return { status: "not_associated", reason: "target_not_formal" };
    return associationForTarget({
      target,
      semanticEvidence: currentTurnEvidence.filter(
        (item) => item.targetAssistantTurnId === explicitTarget
      ),
      correctionTarget: Boolean(correctionTarget),
    });
  }

  const formalTargetEvidence = currentTurnEvidence.filter((item) =>
    byAssistantTurnId.has(item.targetAssistantTurnId)
  );
  if (formalTargetEvidence.length !== currentTurnEvidence.length) {
    return { status: "not_associated", reason: "target_not_formal" };
  }
  if (formalTargetEvidence.length === 0) {
    return {
      status: "not_associated",
      reason: "missing_target_bound_semantic_evidence",
    };
  }
  const semanticTargets = Array.from(new Set(
    formalTargetEvidence.map((item) => item.targetAssistantTurnId)
  ));
  if (semanticTargets.length !== 1) {
    return { status: "not_associated", reason: "ambiguous_semantic_target" };
  }
  const targetAssistantTurnId = semanticTargets[0];
  return associationForTarget({
    target: byAssistantTurnId.get(targetAssistantTurnId)!,
    semanticEvidence: formalTargetEvidence.filter(
      (item) => item.targetAssistantTurnId === targetAssistantTurnId
    ),
    correctionTarget: false,
  });
};
