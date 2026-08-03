import { getRequiredGroundingDisclosure } from "./assistantGrounding";
import type {
  AnswerObligation,
  CommonGroundProposition,
  ConversationControlContext,
  DialogueState,
  InteractionState,
  TurnInterpretation,
} from "./types";

const obligationFor = (
  question: TurnInterpretation["directQuestions"][number],
  index: number,
  context: ConversationControlContext,
  interpretation: TurnInterpretation
): AnswerObligation => ({
  id: `${context.conversationId}:${context.currentTurnId}:answer-${index + 1}`,
  sourceConversationId: context.conversationId,
  sourceTurnId: context.currentTurnId,
  // Compatibility metadata only. The Planner reads openObligations, not this label.
  triggeringUserAct: interpretation.primaryDialogueAct,
  targetProposition: question.text,
  status: "open",
  question: question.text,
  kind: question.kind,
  priority: "must_answer_first",
  requiredDisclosure: getRequiredGroundingDisclosure(interpretation.groundingReference),
  evidence: question.evidence,
});

const propositionFromUpdate = (
  update: TurnInterpretation["stateUpdate"]["commonGround"][number]
): CommonGroundProposition => ({
  id: update.propositionId,
  text: update.proposition,
  status: update.operation === "confirm"
    ? "confirmed"
    : update.operation === "hypothesize"
      ? "hypothesized"
      : "rejected",
  subject: update.subject,
  speaker: update.speaker,
  epistemicStatus: update.epistemicStatus,
  sourceTurnId: update.sourceTurnId,
  confidence: update.confidence,
  evidence: update.evidence,
});

const uniquePropositions = (items: CommonGroundProposition[]) => {
  const byIdentity = new Map<string, CommonGroundProposition>();
  for (const item of items) {
    const key = `${item.status}:${item.subject}:${item.speaker}:${item.text}`;
    if (!byIdentity.has(key)) byIdentity.set(key, item);
  }
  return [...byIdentity.values()];
};

const buildCommonGround = (
  context: ConversationControlContext,
  interpretation: TurnInterpretation
): InteractionState["commonGround"] => {
  const updates = interpretation.stateUpdate.commonGround.map(propositionFromUpdate);
  const rejected = updates.filter((item) => item.status === "rejected");
  const rejectedTexts = new Set(rejected.map((item) => item.text));
  const committedUserUtterances = context.adjacentTurns
    .filter((turn) => turn.role === "user" && Boolean(turn.content.trim()))
    .map((turn, index): CommonGroundProposition => ({
      id: `${turn.id ?? `${context.conversationId}:user-${index + 1}`}:committed-utterance`,
      text: turn.content,
      status: "confirmed",
      subject: "user",
      speaker: "user",
      epistemicStatus: "asserted_by_user",
      sourceTurnId: turn.id ?? `${context.conversationId}:user-${index + 1}`,
      confidence: 1,
      evidence: [
        `committedConversationEvent=${turn.id ?? "legacy-user-event"}`,
        "The raw user utterance is preserved as an asserted proposition, not promoted to an independently verified world fact.",
      ],
    }));
  const committedAssistantClaims = context.adjacentTurns
    .filter((turn) => turn.role === "assistant" && Boolean(turn.committedAssistantMove))
    .flatMap((turn, turnIndex) =>
      (turn.committedAssistantMove?.claims ?? []).map((claim, claimIndex): CommonGroundProposition => {
        const systemTruth = claim.source === "system_truth";
        return {
          id: `${turn.id ?? `${context.conversationId}:assistant-${turnIndex + 1}`}:claim-${claimIndex + 1}`,
          text: claim.text,
          status: systemTruth ? "confirmed" : "hypothesized",
          subject: claim.subject ?? "assistant",
          speaker: "assistant",
          epistemicStatus: systemTruth ? "system_truth" : "assistant_hypothesis",
          sourceTurnId: turn.id ?? `${context.conversationId}:assistant-${turnIndex + 1}`,
          confidence: systemTruth ? 1 : 0.5,
          evidence: [
            `committedConversationEvent=${turn.id ?? "legacy-assistant-event"}`,
            ...claim.provenance,
          ],
        };
      })
    );
  const committedAssistantHypotheses = context.adjacentTurns
    .filter((turn) => turn.role === "assistant" && Boolean(turn.committedAssistantMove))
    .flatMap((turn, turnIndex) =>
      (turn.committedAssistantMove?.assumptions ?? []).map((assumption, assumptionIndex): CommonGroundProposition => ({
        id: `${turn.id ?? `${context.conversationId}:assistant-${turnIndex + 1}`}:assumption-${assumptionIndex + 1}`,
        text: assumption.text,
        status: "hypothesized",
        subject: "user",
        speaker: "assistant",
        epistemicStatus: "assistant_hypothesis",
        sourceTurnId: turn.id ?? `${context.conversationId}:assistant-${turnIndex + 1}`,
        confidence: 0.5,
        evidence: [
          `committedConversationEvent=${turn.id ?? "legacy-assistant-event"}`,
          "Committed Assistant assumptions remain hypotheses until user confirmation.",
        ],
      }))
    );
  const confirmedFromContext = context.confirmedFacts.map((text, index): CommonGroundProposition => ({
    id: `${context.currentTurnId}:confirmed-context-${index + 1}`,
    text,
    status: "confirmed",
    subject: "user",
    speaker: "system",
    epistemicStatus: "selected_memory",
    sourceTurnId: context.currentTurnId,
    confidence: 1,
    evidence: ["Context Assembly marked this proposition as user-confirmed or current-turn explicit."],
  })).filter((item) => !item.text.startsWith("Current user message:"));
  const hypothesizedFromContext = context.unconfirmedHypotheses.map((text, index): CommonGroundProposition => ({
    id: `${context.currentTurnId}:hypothesized-context-${index + 1}`,
    text,
    status: "hypothesized",
    subject: "user",
    speaker: "system",
    epistemicStatus: "selected_memory",
    sourceTurnId: context.currentTurnId,
    confidence: 0.5,
    evidence: ["Context Assembly supplied this only as an unconfirmed hypothesis."],
  }));

  return {
    confirmed: uniquePropositions([
      ...committedUserUtterances,
      ...committedAssistantClaims.filter((item) => item.status === "confirmed"),
      ...confirmedFromContext,
      ...updates.filter((item) => item.status === "confirmed"),
    ].filter((item) => !rejectedTexts.has(item.text))),
    hypothesized: uniquePropositions([
      ...committedAssistantClaims.filter((item) => item.status === "hypothesized"),
      ...committedAssistantHypotheses,
      ...hypothesizedFromContext,
      ...updates.filter((item) => item.status === "hypothesized"),
    ].filter((item) => !rejectedTexts.has(item.text))),
    rejected: uniquePropositions(rejected),
  };
};

const relationExists = (
  interpretation: TurnInterpretation,
  relation: TurnInterpretation["responseRelation"]["candidates"][number]["relation"]
) => interpretation.responseRelation.candidates.some((candidate) => candidate.relation === relation);

const deriveCurrentActivity = (
  interpretation: TurnInterpretation,
  answerObligations: AnswerObligation[],
  initiativeOwner: InteractionState["initiativeOwner"]
): InteractionState["currentActivity"] => {
  const activities: InteractionState["currentActivity"]["primary"][] = [];
  if (relationExists(interpretation, "requests_pause")) activities.push("pausing");
  if (interpretation.stateUpdate.activeThreadProposal?.relation === "close") activities.push("idle");
  if (answerObligations.length > 0) activities.push("answering_obligation");
  if (interpretation.stateUpdate.repairProposal) activities.push("repairing_common_ground");
  if (relationExists(interpretation, "requests_action_support")) activities.push("supporting_action");
  if (relationExists(interpretation, "shares_distress")) activities.push("supporting_emotion");
  if (
    initiativeOwner === "assistant" &&
    relationExists(interpretation, "yields_initiative")
  ) activities.push("opening_thread");
  if (
    relationExists(interpretation, "continues_active_thread") ||
    relationExists(interpretation, "answers_previous_move") ||
    relationExists(interpretation, "opens_new_thread")
  ) activities.push("developing_thread");
  if (activities.length === 0) activities.push("ordinary_exchange");
  const unique = Array.from(new Set(activities));
  return {
    primary: unique[0],
    concurrent: unique.slice(1),
    evidence: interpretation.responseRelation.candidates.flatMap((candidate) => [
      `responseRelation=${candidate.relation};confidence=${candidate.confidence}`,
      ...candidate.evidence,
    ]),
  };
};

const compatibilityNeedsFor = (
  activity: InteractionState["currentActivity"]
): DialogueState["activeInteractionNeeds"] => {
  const activities = [activity.primary, ...activity.concurrent];
  const needs: DialogueState["activeInteractionNeeds"] = [];
  if (activities.includes("answering_obligation")) needs.push("direct_answer");
  if (activities.includes("repairing_common_ground")) needs.push("repair");
  if (activities.includes("supporting_action")) needs.push("action_support");
  if (activities.includes("supporting_emotion")) needs.push("emotional_support");
  if (activities.includes("pausing")) needs.push("pause");
  if (!needs.length) needs.push("ordinary_interaction");
  return needs;
};

export const buildDialogueState = (
  context: ConversationControlContext,
  interpretation: TurnInterpretation
): DialogueState => {
  const answerObligations = interpretation.directQuestions.map((question, index) =>
    obligationFor(question, index, context, interpretation)
  );
  const lastAssistantTurn = [...context.adjacentTurns].reverse().find((message) => message.role === "assistant") ?? null;
  const committedAssistantMove = lastAssistantTurn?.committedAssistantMove as
    | InteractionState["lastCommittedAssistantMove"]
    | undefined;
  const repeatedAssistantQuestions = context.interaction.evidence.some((item) =>
    item.includes("assistant turns contain repeated questions")
  );
  const initiativeOwner = interpretation.stateUpdate.initiativeProposal === "user" &&
    repeatedAssistantQuestions
    ? "shared"
    : interpretation.stateUpdate.initiativeProposal;
  const currentActivity = deriveCurrentActivity(interpretation, answerObligations, initiativeOwner);
  const commonGround = buildCommonGround(context, interpretation);
  const activeThreadProposal = interpretation.stateUpdate.activeThreadProposal;
  const relation = initiativeOwner === "assistant"
    ? "responds_to_invitation"
    : interpretation.stateUpdate.repairProposal
      ? "follows_previous_wording"
      : context.adjacentTurns.length
        ? "continues_topic"
        : "new_topic";

  return {
    currentActivity,
    activeThread: activeThreadProposal
      ? {
          id: `${context.conversationId}:thread:${activeThreadProposal.sourceTurnId}`,
          sourceTurnIds: Array.from(new Set([
            activeThreadProposal.sourceTurnId,
            context.currentTurnId,
          ])),
          status: activeThreadProposal.relation === "pause"
            ? "paused"
            : activeThreadProposal.relation === "close"
              ? "closed"
              : "active",
          evidence: activeThreadProposal.evidence,
        }
      : null,
    commonGround,
    openObligations: answerObligations,
    initiativeOwner,
    lastCommittedAssistantMove: lastAssistantTurn
      ? committedAssistantMove ?? {
          purpose: [],
          claims: [],
          assumptions: [],
          questionOrRequest: /[？?]\s*$/u.test(lastAssistantTurn.content)
            ? { kind: "question" as const }
            : null,
          expectedUserContribution: /[？?]\s*$/u.test(lastAssistantTurn.content)
            ? "answer" as const
            : "none" as const,
          userBurden: /[？?]\s*$/u.test(lastAssistantTurn.content)
            ? "low" as const
            : "none" as const,
          sourceTurnId: lastAssistantTurn.replyToMessageId ??
            lastAssistantTurn.id ??
            `${context.conversationId}:legacy-committed-assistant`,
          evidence: [
            "Compatibility projection from a committed legacy Assistant message without interaction metadata.",
            ...context.interaction.evidence,
          ],
        }
      : null,
    repairState: interpretation.stateUpdate.repairProposal
      ? {
          status: "active",
          targetTurnId: interpretation.stateUpdate.repairProposal.targetTurnId,
          rejectedPropositionIds: interpretation.stateUpdate.repairProposal.rejectedPropositionIds,
          evidence: interpretation.stateUpdate.repairProposal.evidence,
        }
      : {
          status: "none",
          rejectedPropositionIds: [],
          evidence: [],
        },

    // Compatibility trace projections. Response Planner does not read these fields.
    openLoops: answerObligations.map((item) => item.id),
    answerObligations,
    currentInitiative: context.interaction.initiativeDirection,
    correction: interpretation.correction,
    conversationContinuity: {
      relation,
      evidence: [
        ...(lastAssistantTurn ? [`previousAssistantTurnId=${lastAssistantTurn.id ?? "unknown"}`] : []),
        ...context.interaction.evidence,
      ],
    },
    confirmedFacts: context.confirmedFacts,
    unconfirmedHypotheses: commonGround.hypothesized.map((item) => item.text),
    activeInteractionNeeds: compatibilityNeedsFor(currentActivity),
  };
};
