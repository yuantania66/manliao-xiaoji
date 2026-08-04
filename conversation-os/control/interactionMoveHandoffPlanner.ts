import type {
  ActiveInteractionMoveHandoffTarget,
  InteractionMoveHandoffPlan,
  UserMoveRelationCandidate,
  UserMoveRelationKind,
  UserMoveRelationProjection,
} from "./types";

type HandoffTuple = Pick<
  InteractionMoveHandoffPlan,
  "requiredFunction" | "completionIntent" | "questionPolicy"
>;

const FULFILL = "fulfill" as const;
const DEFER: HandoffTuple = {
  requiredFunction: "defer_handoff_completion",
  completionIntent: "defer",
  questionPolicy: "none",
};

const tupleForSingleCandidate = ({
  kind,
  sourceGreetingFunction,
}: {
  kind: UserMoveRelationKind;
  sourceGreetingFunction: ActiveInteractionMoveHandoffTarget["sourceGreetingFunction"];
}): HandoffTuple => {
  if (kind === "sets_boundary_or_pause") {
    return {
      requiredFunction: "respect_user_boundary",
      completionIntent: FULFILL,
      questionPolicy: "none",
    };
  }
  if (kind === "challenges_move_fit" || kind === "rejects_or_declines_move") {
    return {
      requiredFunction: "withdraw_or_repair_targeted_move",
      completionIntent: FULFILL,
      questionPolicy: "none",
    };
  }
  if (kind === "opens_or_redirects_thread") {
    return {
      requiredFunction: "continue_user_introduced_content",
      completionIntent: FULFILL,
      questionPolicy: "optional_after_completion",
    };
  }
  if (
    sourceGreetingFunction === "ask_one_bounded_low_burden_question" &&
    (kind === "answers_move" || kind === "continues_from_move")
  ) {
    return {
      requiredFunction: "continue_from_user_answer",
      completionIntent: FULFILL,
      questionPolicy: "none",
    };
  }
  if (
    sourceGreetingFunction !== "ask_one_bounded_low_burden_question" &&
    kind === "continues_from_move"
  ) {
    return {
      requiredFunction: "continue_user_introduced_content",
      completionIntent: FULFILL,
      questionPolicy: "optional_after_completion",
    };
  }
  if (
    sourceGreetingFunction !== "ask_one_bounded_low_burden_question" &&
    kind === "reciprocates_move"
  ) {
    return {
      requiredFunction: "complete_reciprocal_contact",
      completionIntent: FULFILL,
      questionPolicy: "optional_after_completion",
    };
  }
  return DEFER;
};

const candidateSupportsFunction = ({
  candidate,
  functionName,
  sourceGreetingFunction,
}: {
  candidate: UserMoveRelationCandidate;
  functionName: InteractionMoveHandoffPlan["requiredFunction"];
  sourceGreetingFunction: ActiveInteractionMoveHandoffTarget["sourceGreetingFunction"];
}) => tupleForSingleCandidate({
  kind: candidate.kind,
  sourceGreetingFunction,
}).requiredFunction === functionName;

const exactEvidenceIsValid = ({
  candidate,
  sourceUserTurnId,
  currentUserText,
}: {
  candidate: UserMoveRelationCandidate;
  sourceUserTurnId: string;
  currentUserText: string;
}) => candidate.evidence.length > 0 && candidate.evidence.every((span) =>
  span.source === "current_user_turn" &&
  span.sourceUserTurnId === sourceUserTurnId &&
  Number.isInteger(span.start) &&
  Number.isInteger(span.end) &&
  span.start >= 0 &&
  span.end > span.start &&
  span.end <= currentUserText.length &&
  currentUserText.slice(span.start, span.end) === span.text
);

const highestConfidence = (
  candidates: UserMoveRelationCandidate[],
  predicate: (candidate: UserMoveRelationCandidate) => boolean = () => true
) => candidates.reduce<UserMoveRelationCandidate | null>((selected, candidate) => {
  if (!predicate(candidate)) return selected;
  return !selected || candidate.confidence > selected.confidence ? candidate : selected;
}, null);

const GREETING_FUNCTIONS = new Set<unknown>([
  "initiate_reciprocal_contact",
  "offer_self_contained_conversation_entry",
  "ask_one_bounded_low_burden_question",
]);
const RELATIONS = new Set<unknown>([
  "reciprocates_move",
  "answers_move",
  "continues_from_move",
  "opens_or_redirects_thread",
  "challenges_move_fit",
  "rejects_or_declines_move",
  "sets_boundary_or_pause",
  "unclear",
]);

export const validateInteractionMoveHandoffPlan = (
  plan: InteractionMoveHandoffPlan
): string[] => {
  const reasons: string[] = [];
  if (
    !plan.sourceAssistantMoveId ||
    !plan.sourceUserTurnId ||
    !GREETING_FUNCTIONS.has(plan.sourceGreetingFunction) ||
    !RELATIONS.has(plan.selectedRelation)
  ) reasons.push("invalid_interaction_move_handoff_identity_or_enum");
  if (
    !Array.isArray(plan.evidence) ||
    plan.evidence.length === 0 ||
    plan.evidence.some((span) =>
      span.source !== "current_user_turn" ||
      span.sourceUserTurnId !== plan.sourceUserTurnId ||
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start < 0 ||
      span.end <= span.start ||
      typeof span.text !== "string" ||
      span.end - span.start !== span.text.length
    )
  ) reasons.push("invalid_interaction_move_handoff_evidence");

  const expected: HandoffTuple | null = (() => {
    if (plan.requiredFunction === "defer_handoff_completion") return DEFER;
    if (plan.requiredFunction === "answer_current_obligation") {
      return {
        requiredFunction: "answer_current_obligation",
        completionIntent: FULFILL,
        questionPolicy: "none",
      };
    }
    if (
      plan.requiredFunction === "respect_user_boundary" &&
      plan.selectedRelation === "sets_boundary_or_pause"
    ) {
      return {
        requiredFunction: "respect_user_boundary",
        completionIntent: FULFILL,
        questionPolicy: "none",
      };
    }
    if (
      plan.requiredFunction === "withdraw_or_repair_targeted_move" &&
      (plan.selectedRelation === "challenges_move_fit" ||
        plan.selectedRelation === "rejects_or_declines_move")
    ) {
      return {
        requiredFunction: "withdraw_or_repair_targeted_move",
        completionIntent: FULFILL,
        questionPolicy: "none",
      };
    }
    if (
      plan.requiredFunction === "continue_from_user_answer" &&
      plan.sourceGreetingFunction === "ask_one_bounded_low_burden_question" &&
      (plan.selectedRelation === "answers_move" || plan.selectedRelation === "continues_from_move")
    ) {
      return {
        requiredFunction: "continue_from_user_answer",
        completionIntent: FULFILL,
        questionPolicy: "none",
      };
    }
    if (
      plan.requiredFunction === "complete_reciprocal_contact" &&
      plan.sourceGreetingFunction !== "ask_one_bounded_low_burden_question" &&
      plan.selectedRelation === "reciprocates_move"
    ) {
      return {
        requiredFunction: "complete_reciprocal_contact",
        completionIntent: FULFILL,
        questionPolicy: "optional_after_completion",
      };
    }
    if (
      plan.requiredFunction === "continue_user_introduced_content" &&
      (
        plan.selectedRelation === "opens_or_redirects_thread" ||
        (
          plan.sourceGreetingFunction !== "ask_one_bounded_low_burden_question" &&
          plan.selectedRelation === "continues_from_move"
        )
      )
    ) {
      return {
        requiredFunction: "continue_user_introduced_content",
        completionIntent: FULFILL,
        questionPolicy: "optional_after_completion",
      };
    }
    return null;
  })();
  if (
    !expected ||
    plan.completionIntent !== expected.completionIntent ||
    plan.questionPolicy !== expected.questionPolicy
  ) reasons.push("invalid_interaction_move_handoff_tuple");
  return reasons;
};

const tupleForCandidates = ({
  candidates,
  sourceGreetingFunction,
}: {
  candidates: UserMoveRelationCandidate[];
  sourceGreetingFunction: ActiveInteractionMoveHandoffTarget["sourceGreetingFunction"];
}): HandoffTuple => {
  if (candidates.length === 1) {
    return tupleForSingleCandidate({ kind: candidates[0].kind, sourceGreetingFunction });
  }
  const kinds = new Set(candidates.map((candidate) => candidate.kind));
  if (kinds.has("unclear")) return DEFER;
  if ([...kinds].every((kind) =>
    kind === "challenges_move_fit" || kind === "rejects_or_declines_move"
  )) {
    return {
      requiredFunction: "withdraw_or_repair_targeted_move",
      completionIntent: FULFILL,
      questionPolicy: "none",
    };
  }
  if (
    sourceGreetingFunction === "ask_one_bounded_low_burden_question" &&
    [...kinds].every((kind) => kind === "answers_move" || kind === "continues_from_move")
  ) {
    return {
      requiredFunction: "continue_from_user_answer",
      completionIntent: FULFILL,
      questionPolicy: "none",
    };
  }
  if (
    kinds.has("opens_or_redirects_thread") &&
    [...kinds].every((kind) =>
      kind === "opens_or_redirects_thread" ||
      kind === "answers_move" ||
      kind === "continues_from_move" ||
      kind === "reciprocates_move"
    )
  ) {
    return {
      requiredFunction: "continue_user_introduced_content",
      completionIntent: FULFILL,
      questionPolicy: "optional_after_completion",
    };
  }
  return DEFER;
};

export const planInteractionMoveHandoff = ({
  target,
  relation,
  currentUserTurnId,
  currentUserText,
  hasCurrentAnswerObligation,
  hasExplicitBoundary,
}: {
  target: ActiveInteractionMoveHandoffTarget | null;
  relation: UserMoveRelationProjection | null;
  currentUserTurnId: string;
  currentUserText: string;
  hasCurrentAnswerObligation: boolean;
  hasExplicitBoundary: boolean;
}): InteractionMoveHandoffPlan | null => {
  if (!target || !relation || relation.candidates.length === 0) return null;
  if (
    !currentUserTurnId ||
    !target.sourceAssistantMoveId ||
    !GREETING_FUNCTIONS.has(target.sourceGreetingFunction) ||
    target.envelope.origin.kind !== "proactive_greeting" ||
    target.envelope.handoff.kind !== "proactive_greeting" ||
    target.envelope.handoff.edge !== "opens" ||
    target.sourceAssistantMoveId !== target.envelope.assistantMoveId ||
    target.sourceGreetingFunction !== target.envelope.handoff.greetingFunction ||
    relation.sourceUserTurnId !== currentUserTurnId ||
    relation.targetAssistantMoveId !== target.sourceAssistantMoveId ||
    relation.targetFunction !== target.sourceGreetingFunction ||
    relation.candidates.some((candidate) =>
      !RELATIONS.has(candidate.kind) ||
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence < 0 ||
      candidate.confidence > 1 ||
      !exactEvidenceIsValid({
        candidate,
        sourceUserTurnId: currentUserTurnId,
        currentUserText,
      })
    )
  ) return null;

  let tuple: HandoffTuple;
  let selected: UserMoveRelationCandidate | null;
  if (hasExplicitBoundary) {
    tuple = {
      requiredFunction: "respect_user_boundary",
      completionIntent: FULFILL,
      questionPolicy: "none",
    };
    selected = highestConfidence(
      relation.candidates,
      (candidate) => candidate.kind === "sets_boundary_or_pause"
    );
    if (!selected) return null;
  } else if (hasCurrentAnswerObligation) {
    tuple = {
      requiredFunction: "answer_current_obligation",
      completionIntent: FULFILL,
      questionPolicy: "none",
    };
    selected = highestConfidence(relation.candidates);
  } else {
    tuple = tupleForCandidates({
      candidates: relation.candidates,
      sourceGreetingFunction: target.sourceGreetingFunction,
    });
    selected = tuple.requiredFunction === "defer_handoff_completion"
      ? highestConfidence(relation.candidates)
      : highestConfidence(
          relation.candidates,
          (candidate) => candidateSupportsFunction({
            candidate,
            functionName: tuple.requiredFunction,
            sourceGreetingFunction: target.sourceGreetingFunction,
          }) || (
            tuple.requiredFunction === "continue_user_introduced_content" &&
            candidate.kind === "opens_or_redirects_thread"
          )
        );
  }
  if (!selected) return null;
  return {
    sourceAssistantMoveId: target.sourceAssistantMoveId,
    sourceGreetingFunction: target.sourceGreetingFunction,
    sourceUserTurnId: currentUserTurnId,
    selectedRelation: selected.kind,
    ...tuple,
    evidence: selected.evidence,
  };
};
