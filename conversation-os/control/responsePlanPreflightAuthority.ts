import type {
  AnswerObligation,
  ConversationControlContext,
  DialogueState,
  InteractionMoveHandoffPlan,
  ResponsePlan,
  TurnInterpretation,
} from "./types";
import { planInteractionMoveHandoff } from "./interactionMoveHandoffPlanner";

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
  currentSource: {
    conversationId: string;
    userTurnId: string;
    userText: string;
  };
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
    currentSource: {
      conversationId: context.conversationId,
      userTurnId: context.currentTurnId,
      userText: context.currentUserMessage,
    },
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
