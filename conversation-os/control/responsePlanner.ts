import type {
  ClinicalStrategyAdvice,
  ConversationControlContext,
  DialogueState,
  InteractionMoveSubtype,
  OrdinaryHandoffBoundary,
  PositiveFunctionContract,
  ResponseAction,
  ResponsePlan,
  TurnInterpretation,
} from "./types";
import { isProactiveGreetingPromptVersion } from "@/lib/proactive-greeting";
import { projectAffectEvidenceTerms } from "../state";
import { selectOrdinaryHandoffAction } from "./ordinaryHandoff";

export type ClinicalAdviceProvider = (input: {
  need: "emotional_support" | "action_support";
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
}) => ClinicalStrategyAdvice | null;

const unique = <T>(items: T[]) => Array.from(new Set(items));

const hasActivity = (
  state: DialogueState,
  activity: DialogueState["currentActivity"]["primary"]
) => state.currentActivity.primary === activity ||
  state.currentActivity.concurrent.includes(activity);

const emotionalSupportFunctionFor = ({
  message,
  affectEvidence,
}: {
  message: string;
  affectEvidence: ConversationControlContext["interaction"]["affectEvidence"];
}): Extract<PositiveFunctionContract, { action: "offer_emotional_support" }>["supportFunction"] => {
  if (/(?:不想|不要|不用).{0,8}(?:分析|解释|找原因|讲原因)|不知道为什么/u.test(message)) {
    return "reduce_expression_burden";
  }
  if (/(?:说不清|不知道怎么说|不想多说|没法多说|只能说一点|什么也不想说)/u.test(message)) {
    return "return_amount_control";
  }
  if (/(?:不懂我|没懂我|没理解我|没接住我|没有理解我)/u.test(message)) {
    return "acknowledge_current_relational_impact";
  }
  const distinctAffectTargets = new Set(
    affectEvidence.map((span) => `${span.category}:${span.object}`)
  );
  if (distinctAffectTargets.size > 1) return "return_focus_control";
  return "return_amount_control";
};

const replacementFactFromCorrection = (message: string) => {
  const contrast = message.match(
    /(?:不是|不叫)([^，,。；;\s]{1,18}?)[，,；;\s]*(?:而?是|叫)([^，,。；;]{1,24})/u
  );
  const replacement = contrast?.[2]?.trim();
  return replacement?.replace(/^(?:我|你)(?:的)?/u, "").trim() || null;
};

const interactionMoveSubtypeFor = ({
  currentUserMessage,
  targetText,
}: {
  currentUserMessage: string;
  targetText: string;
}): InteractionMoveSubtype | null => {
  if (
    /(?:应该不应该|说教|评判|评价|道德)/u.test(currentUserMessage) ||
    /(?:应该|不应该|必须|不能总|勇敢一点|对错|好坏)/u.test(targetText)
  ) return "moralizing";
  if (
    /(?:说的是|讲的是).{0,24}(?:不是|而不是)|不是在(?:问|说|聊)|转移话题|换(?:了)?话题|重点弄错/u.test(currentUserMessage)
  ) return "topic_switch";
  if (
    /(?:只是在说你会听|只说会听|套话|空话|没有听我说的重点)/u.test(currentUserMessage) ||
    /(?:我在|我会.{0,8}(?:听|陪)|认真听|随时.{0,6}听)/u.test(targetText)
  ) return "generic_listening";
  if (
    /(?:又在追问|别再?问|连续问|问个不停|逼我回答|没有回应.*重点)/u.test(currentUserMessage) ||
    /(?:具体|为什么|什么时候|在哪里|还有谁|怎么想).{0,28}[？?]/u.test(targetText)
  ) return "pressure_question";
  if (
    /(?:不想要建议|不要建议|没要建议|教我怎么做|替我决定)/u.test(currentUserMessage) ||
    /(?:建议|不妨|可以先|方案|主意|怎么做)/u.test(targetText)
  ) return "unsolicited_advice";
  return null;
};

const positiveFunctionContractFor = ({
  actions,
  context,
  interpretation,
  dialogueState,
}: {
  actions: ResponseAction[];
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
  dialogueState: DialogueState;
}): PositiveFunctionContract | null => {
  if (actions.includes("repair_previous_wording")) {
    const targetTurnId = dialogueState.repairState.targetTurnId ??
      interpretation.correction?.targetTurnId ??
      [...context.adjacentTurns].reverse().find((turn) => turn.role === "assistant")?.id ??
      context.currentTurnId;
    const targetText = context.adjacentTurns.find((turn) => turn.id === targetTurnId)?.content ??
      interpretation.correction?.challengedPropositions[0]?.text ??
      "";
    const replacementFact = replacementFactFromCorrection(context.currentUserMessage);
    const interactionMoveSubtype = replacementFact
      ? null
      : interactionMoveSubtypeFor({
          currentUserMessage: context.currentUserMessage,
          targetText,
        });
    const repairMode = replacementFact
      ? "factual_replacement"
      : interactionMoveSubtype
        ? "interaction_move_withdrawal"
        : "proposition_withdrawal";
    return {
      action: "repair_previous_wording",
      repairMode,
      interactionMoveSubtype,
      sourceTurnId: context.currentTurnId,
      sourceText: context.currentUserMessage,
      targetTurnId,
      targetText,
      replacementFact,
      evidence: [
        `repairMode=${repairMode}`,
        ...(interactionMoveSubtype ? [`interactionMoveSubtype=${interactionMoveSubtype}`] : []),
        `targetTurnId=${targetTurnId}`,
        ...(replacementFact ? [`replacementFact=${replacementFact}`] : []),
        ...dialogueState.repairState.evidence,
      ],
    };
  }
  if (actions.includes("offer_emotional_support")) {
    const supportFunction = emotionalSupportFunctionFor({
      message: context.currentUserMessage,
      affectEvidence: context.interaction.affectEvidence,
    });
    const affectEvidenceSpans = context.interaction.affectEvidence.map((span) => ({
      ...span,
      sourceTurnId: context.currentTurnId,
    }));
    return {
      action: "offer_emotional_support",
      supportFunction,
      sourceTurnId: context.currentTurnId,
      sourceText: context.currentUserMessage,
      affectEvidenceSpans,
      explicitAffectOrImpactTerms: projectAffectEvidenceTerms(affectEvidenceSpans),
      intensityCeiling: "current_user_expression",
      evidence: [
        `supportFunction=${supportFunction}`,
        `currentUserMessage=${context.currentUserMessage}`,
        ...affectEvidenceSpans.map((span) =>
          `affectEvidence=${span.category}:${span.intensity}:${span.object}:${span.start}-${span.end}`
        ),
      ],
    };
  }
  return null;
};

const actionsForState = ({
  state,
  respondsToProactiveGreeting,
  ordinaryHandoffAction,
}: {
  state: DialogueState;
  respondsToProactiveGreeting: boolean;
  ordinaryHandoffAction: ResponseAction | null;
}): ResponseAction[] => {
  const actions: ResponseAction[] = [];
  const repairsAssistant = hasActivity(state, "repairing_common_ground");
  if (hasActivity(state, "pausing")) return ["respect_pause"];
  if (hasActivity(state, "answering_obligation")) actions.push("answer_directly");
  if (state.openObligations.some((obligation) =>
    obligation.kind === "definition" || obligation.kind === "reason_or_contradiction"
  )) actions.push("explain_plainly");
  if (repairsAssistant) actions.push("repair_previous_wording");
  if (!repairsAssistant && hasActivity(state, "supporting_action")) actions.push("offer_action_support");
  if (!repairsAssistant && hasActivity(state, "supporting_emotion")) actions.push("offer_emotional_support");
  if (
    !hasActivity(state, "supporting_emotion") &&
    !hasActivity(state, "supporting_action") &&
    !hasActivity(state, "answering_obligation") &&
    (
      hasActivity(state, "opening_thread") ||
      (repairsAssistant && state.initiativeOwner === "assistant")
    )
  ) actions.push("take_light_topic_initiative");
  if (actions.length === 0) {
    actions.push(
      ordinaryHandoffAction ?? (respondsToProactiveGreeting
        ? "respond_to_proactive_greeting"
        : "acknowledge_without_psychologizing")
    );
  }
  return unique(actions);
};

const actionEvidence = (
  action: ResponseAction,
  state: DialogueState,
  context: ConversationControlContext,
  ordinaryHandoffBoundary: OrdinaryHandoffBoundary | null
): string[] => {
  const currentTurnEvidence = [`currentUserMessage=${context.currentUserMessage}`];
  if (action === "answer_directly") {
    return [
      ...currentTurnEvidence,
      ...state.openObligations.flatMap((obligation) => [
        `openObligation=${obligation.id}`,
        ...obligation.evidence,
      ]),
    ];
  }
  if (action === "repair_previous_wording") {
    return [...currentTurnEvidence, ...state.repairState.evidence];
  }
  if (action === "respect_pause") {
    return [...currentTurnEvidence, ...(state.activeThread?.evidence ?? ["initiativeOwner=paused"])];
  }
  if (action === "take_light_topic_initiative") {
    return [
      ...currentTurnEvidence,
      `initiativeOwner=${state.initiativeOwner}`,
      ...(state.activeThread?.evidence ?? []),
    ];
  }
  if (
    action === "invite_low_pressure_calibration" ||
    action === "continue_established_frame" ||
    action === "continue_established_thread" ||
    action === "offer_neutral_conversation_entry"
  ) {
    return [
      ...currentTurnEvidence,
      `helpingApplicability=${ordinaryHandoffBoundary?.applicability ?? "missing"}`,
      ...(ordinaryHandoffBoundary?.evidence ?? []),
      ...(state.lastCommittedAssistantMove?.purpose.map((purpose) => `lastCommittedPurpose=${purpose}`) ?? []),
      ...(context.activeAnswerFrame.compatible
        ? [`activeAnswerFrame=${context.activeAnswerFrame.type ?? "unknown"}`]
        : []),
    ];
  }
  return [
    ...currentTurnEvidence,
    `currentActivity=${state.currentActivity.primary}`,
    ...state.currentActivity.concurrent.map((item) => `concurrentActivity=${item}`),
    ...(state.activeThread?.evidence ?? []),
  ];
};

export const createResponsePlan = ({
  context,
  interpretation,
  dialogueState,
  ordinaryHandoffBoundary = null,
  clinicalAdviceProvider,
}: {
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
  dialogueState: DialogueState;
  ordinaryHandoffBoundary?: OrdinaryHandoffBoundary | null;
  clinicalAdviceProvider: ClinicalAdviceProvider;
}): ResponsePlan => {
  const lastAssistantTurn = [...context.adjacentTurns]
    .reverse()
    .find((turn) => turn.role === "assistant");
  const respondsToProactiveGreeting = Boolean(
    lastAssistantTurn &&
    context.adjacentTurns.at(-1)?.role === "assistant" &&
    isProactiveGreetingPromptVersion(lastAssistantTurn.promptVersion)
  );
  const preProactiveGreetingUserMessages = respondsToProactiveGreeting
    ? context.adjacentTurns
        .slice(0, -1)
        .filter((turn) => turn.role === "user")
        .slice(-4)
        .map((turn) => turn.content)
    : [];
  const ordinaryHandoffAction = selectOrdinaryHandoffAction({
    context,
    state: dialogueState,
    boundary: ordinaryHandoffBoundary,
  });
  let actions = actionsForState({
    state: dialogueState,
    respondsToProactiveGreeting,
    ordinaryHandoffAction,
  });
  const repairsAssistant = hasActivity(dialogueState, "repairing_common_ground");
  const clinicalNeed = repairsAssistant
    ? null
    : hasActivity(dialogueState, "supporting_action")
    ? "action_support"
    : hasActivity(dialogueState, "supporting_emotion")
      ? "emotional_support"
      : null;
  const clinicalStrategy = clinicalNeed
    ? clinicalAdviceProvider({ need: clinicalNeed, context, interpretation })
    : null;
  const positiveFunctionContract = positiveFunctionContractFor({
    actions,
    context,
    interpretation,
    dialogueState,
  });
  if (
    positiveFunctionContract?.action === "repair_previous_wording" &&
    positiveFunctionContract.interactionMoveSubtype === "pressure_question"
  ) {
    actions = actions.filter((action) => action !== "take_light_topic_initiative");
  }
  const requiredDisclosure = unique(
    dialogueState.openObligations.flatMap((item) => item.requiredDisclosure)
  );
  const groundingFacts = dialogueState.commonGround.confirmed
    .map((item) => item.text)
    .filter((fact) => fact.startsWith("Selected user-confirmed memory:"));
  const simpleDirectAnswer =
    hasActivity(dialogueState, "answering_obligation") && !clinicalNeed;
  const takesTopicInitiative = actions.includes("take_light_topic_initiative");
  const answersAssistantQuestion =
    dialogueState.lastCommittedAssistantMove?.questionOrRequest?.kind === "question" &&
    dialogueState.lastCommittedAssistantMove.expectedUserContribution === "answer" &&
    !takesTopicInitiative;
  const ordinaryChat = !clinicalNeed;
  const structurallyComplexConcurrent = dialogueState.currentActivity.concurrent.filter(
    (activity) => activity !== "developing_thread" && activity !== "ordinary_exchange"
  );
  const planningDepth: ResponsePlan["planningDepth"] =
    context.safety.triggered ||
    Boolean(clinicalNeed) ||
    hasActivity(dialogueState, "repairing_common_ground") ||
    interpretation.responseRelation.ambiguous
      ? "deep"
      : ordinaryHandoffAction ||
          dialogueState.openObligations.length > 0 ||
          structurallyComplexConcurrent.length > 0
        ? "standard"
        : "minimal";
  const idle = hasActivity(dialogueState, "idle");
  const handoffInvitesCalibration = actions.includes("invite_low_pressure_calibration");
  const handoffRequiresNoQuestion = actions.some((action) =>
    action === "continue_established_frame" ||
    action === "continue_established_thread" ||
    action === "offer_neutral_conversation_entry"
  );
  const questionMode = hasActivity(dialogueState, "pausing") ||
    idle ||
    simpleDirectAnswer ||
    (repairsAssistant && !takesTopicInitiative) ||
    answersAssistantQuestion ||
    handoffRequiresNoQuestion
    ? "none"
    : handoffInvitesCalibration
      ? "one_low_pressure_question"
    : respondsToProactiveGreeting
      ? "optional_after_answer"
      : dialogueState.initiativeOwner === "shared"
        ? "none"
        : takesTopicInitiative
          ? "one_low_pressure_question"
          : "optional_after_answer";
  const relevanceProvenance: ResponsePlan["relevanceProvenance"] = [
    ...actions.map((action) => ({
      planElement: `responseAction:${action}`,
      source: "interaction_state" as const,
      sourceTurnId: context.currentTurnId,
      evidence: actionEvidence(action, dialogueState, context, ordinaryHandoffBoundary),
    })),
    ...dialogueState.openObligations.map((obligation) => ({
      planElement: `answerObligation:${obligation.id}`,
      source: "current_turn" as const,
      sourceTurnId: obligation.sourceTurnId,
      evidence: obligation.evidence,
    })),
    ...requiredDisclosure.map((disclosure) => ({
      planElement: `requiredDisclosure:${disclosure}`,
      source: "system_truth" as const,
      sourceTurnId: context.currentTurnId,
      evidence: dialogueState.openObligations
        .filter((obligation) => obligation.requiredDisclosure.includes(disclosure))
        .flatMap((obligation) => [`requiredBy=${obligation.id}`, ...obligation.evidence]),
    })),
    ...groundingFacts.map((fact) => ({
      planElement: `groundingFact:${fact}`,
      source: "interaction_state" as const,
      sourceTurnId: dialogueState.commonGround.confirmed.find((item) => item.text === fact)?.sourceTurnId,
      evidence: dialogueState.commonGround.confirmed.find((item) => item.text === fact)?.evidence ?? [],
    })),
  ];

  return {
    planId: `${context.conversationId}:${context.currentTurnId}:response-plan`,
    decisionOwner: "conversation_os.response_planner",
    behaviorSource: clinicalStrategy ? "legacy_compat" : "ordinary_conversation",
    planningDepth,
    answerObligations: dialogueState.openObligations,
    disclosureScope: {
      conversationId: context.conversationId,
      turnId: context.currentTurnId,
    },
    correction: interpretation.correction,
    responseActions: actions,
    groundingFacts,
    requiredDisclosure,
    clinicalStrategy,
    positiveFunctionContract,
    questionPolicy: {
      mode: questionMode,
      reason: hasActivity(dialogueState, "pausing")
        ? "Interaction State is paused."
        : handoffInvitesCalibration
          ? "Helping applicability is uncertain; ask one low-pressure calibration question without assigning meaning."
        : handoffRequiresNoQuestion
          ? "The ordinary handoff must add conversation function without another question."
        : simpleDirectAnswer
          ? "The current open obligation must be answered without adding another obligation."
          : answersAssistantQuestion
            ? "The current turn answers the assistant's question, including a question used as a proactive greeting; do not open a second interview question."
            : respondsToProactiveGreeting
              ? "The user responded to a non-question proactive greeting; one specific natural follow-up is optional, but an interview loop is not."
              : repairsAssistant && !takesTopicInitiative
                ? "Repair the rejected common-ground proposition without opening a new interview loop."
                : repairsAssistant
                  ? "Repair the rejected proposition, then return initiative according to the still-active thread."
                  : dialogueState.initiativeOwner === "shared"
                    ? "Initiative is shared; do not force another question."
                    : takesTopicInitiative
                      ? "Interaction State assigns topic initiative to the assistant."
                      : "A follow-up is optional only after the current activity is completed.",
    },
    closurePolicy: {
      mode: hasActivity(dialogueState, "pausing")
        ? "allow_pause"
        : idle
          ? "allow_idle"
          : "forbid_closure",
      reason: hasActivity(dialogueState, "pausing")
        ? "Interaction State contains explicit pause evidence."
        : idle
          ? "The committed interaction can settle without forcing a new topic."
        : "Interaction State contains no accepted stop transition.",
    },
    tone: ordinaryChat
      ? ["natural colloquial Chinese", "direct", "neutral-friendly without reassurance"]
      : ["natural Chinese", "direct", "warm without counselling jargon"],
    stance: [
      "Realize only propositions and actions present in this ResponsePlan.",
      "Do not promote hypotheses into common ground.",
      "Do not restate propositions rejected by the user.",
    ],
    lengthGuidance: simpleDirectAnswer
      ? "Usually one concise sentence; at most two."
      : "Usually one or two concise sentences.",
    prohibitedClaims: unique([
      ...context.grounding.prohibitedClaims,
      ...dialogueState.commonGround.rejected.map((item) =>
        `Do not assert, explain, or expand rejected proposition: ${item.text}`
      ),
      "不得在没有证据时断言用户的情绪、意图或心理状态。",
      ...(context.semanticEvidence.status === "insufficient"
        ? ["Do not infer meaning from message form or repetition."]
        : []),
    ]),
    safetyConstraints: context.safety.triggered
      ? [context.safety.reason ?? "Safety override applies."]
      : [],
    relevanceProvenance,
    evidence: unique([
      `currentActivity=${dialogueState.currentActivity.primary}`,
      `planningDepth=${planningDepth}`,
      ...dialogueState.currentActivity.concurrent.map((item) => `concurrentActivity=${item}`),
      `initiativeOwner=${dialogueState.initiativeOwner}`,
      `openObligations=${dialogueState.openObligations.length}`,
      `clinicalInvoked=${Boolean(clinicalStrategy)}`,
      `ordinaryHandoff=${ordinaryHandoffAction ?? "none"}`,
      ...preProactiveGreetingUserMessages.map(
        (content) => `preProactiveGreetingUserMessage=${content}`
      ),
      ...(dialogueState.activeThread?.evidence ?? []),
      ...dialogueState.repairState.evidence,
    ]),
  };
};
