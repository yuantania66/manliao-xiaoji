import type {
  AnswerObligation,
  ConversationControlContext,
  DialogueState,
  InteractionMoveHandoffPlan,
  OrdinaryPosturePlan,
  ResponsePlan,
  TurnInterpretation,
} from "./types";
import { hasExpressionBurden, sharingInvitationDeclinedSource, supportsOrdinaryExperienceInvitation } from "./ordinaryResponseBoundary";
import { planInteractionMoveHandoff } from "./interactionMoveHandoffPlanner";
import { selectSupportedOrdinaryPurpose } from "./ordinaryPurpose";
import { replacementFactFromCorrection } from "./correctionEvidence";
import { MOVE_FIT_REPAIR_ADOPTION_EVIDENCE } from "./turnInterpreter";
import { retainCommittedAssistantMoveEnvelope } from "./interactionMoveHandoff";
import { parseCommittedAssistantMoveMetadata } from "@/services/helping/committedHelpingMoveMetadata";

type RelevanceProvenance = ResponsePlan["relevanceProvenance"][number];

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ResponsePlanPreflightAuthoritySnapshot = DeepReadonly<{
  expectedInteractionMoveHandoffPlan: InteractionMoveHandoffPlan | null;
  ordinaryMoveFitRepairAuthority?: {
    userTurnId: string;
    userText: string;
    assistantMoveId: string;
    assistantText: string;
    confidence: number;
  } | null;
  ordinaryContributionAuthority?: { questionsDeclined: boolean; expressionBurden: boolean; experienceInvitationSupported?: boolean;
    supportedPurpose?: Pick<OrdinaryPosturePlan, "sourceSpans" | "requiredContribution"> | null };
  currentSource: {
    conversationId: string;
    userTurnId: string;
    userText: string;
  };
  adjacentCommittedUserSources: Array<{
    userTurnId: string;
    userText: string;
  }>;
  targetSource: {
    assistantMoveId: string;
    greetingFunction: InteractionMoveHandoffPlan["sourceGreetingFunction"];
    assistantText: string;
  } | null;
  expectedAnswerObligations: AnswerObligation[];
  canonicalProvenance: RelevanceProvenance[];
}>;

const deepFreeze = <T>(value: T): DeepReadonly<T> => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
};

const detachedFrozen = <T>(value: T): DeepReadonly<T> =>
  deepFreeze(structuredClone(value));

export const buildCanonicalResponsePlanPreflightProvenance = ({
  handoffPlan,
  currentUserText,
  targetAssistantText,
  answerObligations,
}: {
  handoffPlan: InteractionMoveHandoffPlan | null;
  currentUserText: string;
  targetAssistantText: string | null;
  answerObligations: AnswerObligation[];
}): RelevanceProvenance[] => [
  ...answerObligations.map((obligation): RelevanceProvenance => ({
    planElement: `answerObligation:${obligation.id}`,
    source: "current_turn",
    sourceTurnId: obligation.sourceTurnId,
    evidence: [
      `obligationId=${obligation.id}`,
      `sourceConversationId=${obligation.sourceConversationId}`,
      `sourceTurnId=${obligation.sourceTurnId}`,
      `status=${obligation.status}`,
      `priority=${obligation.priority}`,
      `kind=${obligation.kind}`,
      `question=${JSON.stringify(obligation.question)}`,
      `targetProposition=${JSON.stringify(obligation.targetProposition)}`,
      ...obligation.evidence,
      ...obligation.evidence.map((item) =>
        `obligationEvidence=${JSON.stringify(item)}`
      ),
    ],
  })),
  ...(handoffPlan
    ? [
        {
          planElement: "interactionMoveHandoffPlan:target",
          source: "adjacent_turn" as const,
          sourceTurnId: handoffPlan.sourceAssistantMoveId,
          evidence: [
            `sourceAssistantMoveId=${handoffPlan.sourceAssistantMoveId}`,
            `sourceGreetingFunction=${handoffPlan.sourceGreetingFunction}`,
            `targetAssistantText=${JSON.stringify(targetAssistantText ?? "")}`,
          ],
        },
        {
          planElement: "interactionMoveHandoffPlan:relation",
          source: "current_turn" as const,
          sourceTurnId: handoffPlan.sourceUserTurnId,
          evidence: [
            `selectedRelation=${handoffPlan.selectedRelation}`,
            `requiredFunction=${handoffPlan.requiredFunction}`,
            `completionIntent=${handoffPlan.completionIntent}`,
            `questionPolicy=${handoffPlan.questionPolicy}`,
            `currentUserText=${JSON.stringify(currentUserText)}`,
          ],
        },
      ]
    : []),
];

export const projectCanonicalResponsePlanPreflightProvenance = (
  provenance: ResponsePlan["relevanceProvenance"]
) => provenance.filter((item) =>
  item.planElement.startsWith("answerObligation:") ||
  item.planElement === "interactionMoveHandoffPlan:target" ||
  item.planElement === "interactionMoveHandoffPlan:relation"
);

export const buildCanonicalOrdinaryPostureProvenance = (
  posture: OrdinaryPosturePlan
): RelevanceProvenance => {
  const primarySpan = posture.sourceSpans[0];
  return {
    planElement: "ordinaryPosture:binding",
    source: primarySpan?.source === "adjacent_committed_user_turn"
      ? "adjacent_turn"
      : "current_turn",
    sourceTurnId: primarySpan?.sourceTurnId,
    evidence: [
      `mode=${posture.mode}`,
      ...posture.sourceSpans.map((span, index) =>
        `sourceSpan[${index}]=${span.source}:${span.sourceTurnId}:${span.start}:${span.end}:${JSON.stringify(span.text)}`
      ),
      `targetSpanIndexes=${JSON.stringify(posture.requiredContribution?.targetSpanIndexes ?? null)}`,
      `instruction=${JSON.stringify(posture.requiredContribution?.instruction ?? null)}`,
      ...(posture.requiredContribution?.purposeEvidence
        ? [`purposeEvidence=${JSON.stringify(posture.requiredContribution.purposeEvidence)}`] : []),
      ...posture.evidence.map((item, index) => `postureEvidence[${index}]=${JSON.stringify(item)}`),
    ],
  };
};

// Reconstruct this authority from the interpreted turn and committed source, never from a Plan.
const ordinaryMoveFitRepairAuthorityFor = ({ context, interpretation, dialogueState }: {
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
  dialogueState: DialogueState;
}): ResponsePlanPreflightAuthoritySnapshot["ordinaryMoveFitRepairAuthority"] => {
  const target = [...context.adjacentTurns].reverse().find((turn) => turn.role === "assistant");
  const proposal = interpretation.stateUpdate.repairProposal;
  const repair = dialogueState.repairState;
  if (context.safety.triggered || context.interactionMoveHandoffTarget ||
      replacementFactFromCorrection(context.currentUserMessage) ||
      !context.currentTurnId || !context.currentUserMessage.trim() ||
      !interpretation.evidenceSources.includes("model_interpretation") ||
      interpretation.contentMeaning.literalText !== context.currentUserMessage.replace(/\s+/g, " ").trim() ||
      !interpretation.contentMeaning.explicitPropositions.some((item) =>
        item.sourceTurnId === context.currentTurnId && item.text === interpretation.contentMeaning.literalText
      ) ||
      !target?.id || target.status !== "saved" || !target.content.trim() ||
      proposal?.sourceRelation !== "challenges_move_fit" || proposal.targetTurnId !== target.id ||
      !proposal.evidence.includes(MOVE_FIT_REPAIR_ADOPTION_EVIDENCE) ||
      repair.status !== "active" || repair.sourceRelation !== "challenges_move_fit" ||
      repair.targetTurnId !== target.id || !repair.evidence.includes(MOVE_FIT_REPAIR_ADOPTION_EVIDENCE)) return null;
  const candidate = interpretation.responseRelation.candidates.find((item) =>
    item.relation === "challenges_move_fit" && item.targetTurnId === target.id &&
    Number.isFinite(item.confidence) && item.confidence >= 0.93 && item.confidence <= 1 &&
    !item.targetProposition && item.evidence.some((value) => value.trim())
  );
  if (!candidate || !interpretation.stateUpdate.commonGround.some((item) =>
    item.operation === "reject" && item.subject === "assistant" && item.speaker === "user" &&
    item.epistemicStatus === "rejected_by_user" && item.sourceTurnId === target.id &&
    item.proposition === target.content && proposal.rejectedPropositionIds.includes(item.propositionId) &&
    item.confidence >= 0.93 && item.evidence.includes(MOVE_FIT_REPAIR_ADOPTION_EVIDENCE)
  )) return null;
  const envelope = retainCommittedAssistantMoveEnvelope(target);
  const legacy = parseCommittedAssistantMoveMetadata(target.committedAssistantMove);
  if ((target.interactionMoveEnvelope != null && !envelope) ||
      (context.interactionMoveHandoffEnvelopePresent && context.adjacentTurns.at(-1) === target && !envelope) ||
      legacy.status === "invalid" || (!envelope && legacy.status !== "valid") ||
      (envelope && envelope.committedMove.claims.length !== 0) ||
      (legacy.status === "valid" && legacy.assistantMove.claims.length !== 0)) return null;
  return {
    userTurnId: context.currentTurnId,
    userText: context.currentUserMessage,
    assistantMoveId: target.id,
    assistantText: target.content,
    confidence: candidate.confidence,
  };
};

export const createResponsePlanPreflightAuthoritySnapshot = ({
  context,
  interpretation,
  dialogueState,
}: {
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
  dialogueState: DialogueState;
}): ResponsePlanPreflightAuthoritySnapshot => {
  const expectedInteractionMoveHandoffPlan = context.safety.triggered
    ? null
    : planInteractionMoveHandoff({
        target: context.interactionMoveHandoffTarget,
        relation: interpretation.userMoveRelation,
        currentUserTurnId: context.currentTurnId,
        currentUserText: context.currentUserMessage,
        hasCurrentAnswerObligation: dialogueState.openObligations.some(
          (obligation) => obligation.sourceTurnId === context.currentTurnId
        ),
        hasExplicitBoundary:
          dialogueState.currentActivity.primary === "pausing" ||
          dialogueState.currentActivity.concurrent.includes("pausing"),
      });
  const targetTurn = expectedInteractionMoveHandoffPlan
    ? context.adjacentTurns.find((turn) =>
        turn.role === "assistant" &&
        turn.id === expectedInteractionMoveHandoffPlan.sourceAssistantMoveId
      )
    : null;
  const targetSource = expectedInteractionMoveHandoffPlan
    ? {
        assistantMoveId: expectedInteractionMoveHandoffPlan.sourceAssistantMoveId,
        greetingFunction: expectedInteractionMoveHandoffPlan.sourceGreetingFunction,
        assistantText: targetTurn?.content ?? "",
      }
    : null;
  const snapshot = {
    expectedInteractionMoveHandoffPlan,
    ordinaryMoveFitRepairAuthority: ordinaryMoveFitRepairAuthorityFor({ context, interpretation, dialogueState }),
    ordinaryContributionAuthority: {
      questionsDeclined: sharingInvitationDeclinedSource(context) !== null,
      expressionBurden: hasExpressionBurden(context.currentUserMessage),
      experienceInvitationSupported: supportsOrdinaryExperienceInvitation(context, interpretation, dialogueState),
      supportedPurpose: selectSupportedOrdinaryPurpose(context, interpretation),
    },
    currentSource: {
      conversationId: context.conversationId,
      userTurnId: context.currentTurnId,
      userText: context.currentUserMessage,
    },
    adjacentCommittedUserSources: context.adjacentTurns.flatMap((turn) =>
      turn.role === "user" && turn.id && turn.status === "saved"
        ? [{ userTurnId: turn.id, userText: turn.content }]
        : []
    ),
    targetSource,
    expectedAnswerObligations: dialogueState.openObligations,
    canonicalProvenance: buildCanonicalResponsePlanPreflightProvenance({
      handoffPlan: expectedInteractionMoveHandoffPlan,
      currentUserText: context.currentUserMessage,
      targetAssistantText: targetSource?.assistantText ?? null,
      answerObligations: dialogueState.openObligations,
    }),
  };
  return detachedFrozen(snapshot);
};
