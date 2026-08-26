import type { ClinicalContext, ClinicalPlan } from "./clinicalTypes";
import { isUserCorrection } from "./userCorrectionSignal";

const getSupportActionElement = (text: string) => {
  if (/辞职|该不该|要不要/.test(text)) {
    return "actionSupportElement: decision frame - offer a small decision frame with 2-3 factors to compare, without deciding for the user.";
  }

  if (/开口|怎么说|怎么讲|跟.*谈|谈.*怎么/.test(text)) {
    return "actionSupportElement: wording frame - offer one adjustable opening sentence or wording frame the user can change.";
  }

  if (/道歉|卑微/.test(text)) {
    return "actionSupportElement: option set - help separate apology intent, boundary, and wording; offer a small option set without telling the user what to choose.";
  }

  if (/先做什么|先做啥|第一步|从哪.*开始|理一下|捋一下|排序/.test(text)) {
    return "actionSupportElement: sorting scaffold - offer a simple sorting scaffold that helps identify the first smallest next step.";
  }

  if (/能做什么|现在做什么|别安慰|不要安慰/.test(text)) {
    return "actionSupportElement: concrete step - offer one immediate low-pressure next step before asking for more context.";
  }

  return "actionSupportElement: concrete step - if the action domain is clear, offer one small optional next step; if unclear, ask for the advice domain without pretending to have enough context.";
};

const getPlanShapeForGoal = (
  context: ClinicalContext,
  responseGoal: ClinicalPlan["responseGoal"]
): Pick<ClinicalPlan, "responseIntent" | "questionFunction"> => {
  if (responseGoal === "help_continue_expression") {
    return {
      responseIntent:
        context.signals.interaction.contentAvailability === "no_topic" &&
        (context.signals.interaction.engagement === "engaged" ||
          context.signals.interaction.engagement === "open")
          ? "initiate_topic"
          : "invite_expression",
      questionFunction: "open_gentle_invitation",
    };
  }

  if (responseGoal === "support_action") {
    return {
      responseIntent: "support_action",
      questionFunction: "support_user_agency",
    };
  }

  if (responseGoal === "summarize") {
    return {
      responseIntent: "summarize",
      questionFunction: "none",
    };
  }

  if (responseGoal === "hold_space") {
    return {
      responseIntent: "support_pause",
      questionFunction: "none",
    };
  }

  if (responseGoal === "clarify") {
    const userCorrectedAi = isUserCorrection(context.conversation.currentUserMessage);

    if (context.signals.semanticEvidence.status === "insufficient") {
      return {
        responseIntent: "receive",
        questionFunction: "none",
      };
    }

    return {
      responseIntent: userCorrectedAi ? "repair" : "clarify",
      questionFunction: userCorrectedAi ? "repair_understanding" : "clarify_meaning",
    };
  }

  return {
    responseIntent: "empathic_reflection",
    questionFunction: "clarify_or_reflect",
  };
};

export const createRogersClinicalPlan = (
  context: ClinicalContext,
  responseGoal: ClinicalPlan["responseGoal"]
): ClinicalPlan => {
  const planShape = getPlanShapeForGoal(context, responseGoal);
  const supportActionElement =
    responseGoal === "support_action" ? getSupportActionElement(context.conversation.currentUserMessage) : null;
  const clarificationContract = planShape.responseIntent === "clarify";
  const observationContract =
    responseGoal === "clarify" && context.signals.semanticEvidence.status === "insufficient";

  return {
    responseGoal,
    responseIntent: planShape.responseIntent,
    primaryStrategy: "rogers",
    secondaryStrategies: [],
    questionFunction: planShape.questionFunction,
    toneConstraint: [
      "warm",
      "non-directive",
      "non-diagnostic",
      ...(clarificationContract
        ? [
            "clarify unestablished meaning without assigning one.",
            "ask one direct, small clarification question when meaning is absent.",
            "keep a low-pressure continuation entry; do not require immediate explanation.",
          ]
        : []),
      ...(observationContract
        ? ["remain at observation until the user or active conversation context establishes meaning."]
        : []),
      ...(planShape.responseIntent === "initiate_topic"
        ? [
            "The user has no topic but remains engaged; take one light, low-pressure topic initiative instead of asking them to supply a topic.",
            "Keep the initiative easy to decline and do not turn it into a checklist, choice test, or demand for self-explanation.",
            ...(context.signals.interaction.initiativeDirection === "shared"
              ? ["Recent turns already contain repeated assistant questions; do not add another information-gathering question."]
              : []),
          ]
        : []),
      ...(responseGoal === "hold_space" && context.signals.interaction.affect === "negative"
        ? ["Lower interaction intensity because the user supplied explicit distress or fatigue evidence."]
        : []),
      ...(supportActionElement
        ? ["support_action must include one small, optional, user-adjustable action-support element."]
        : []),
    ],
    interventionBoundary: [
      "no diagnosis",
      "no treatment plan",
      ...(clarificationContract
        ? [
            "do not convert ambiguity into an emotion, score, activity, or conversational purpose.",
            "do not close the conversation unless the user asks to pause.",
          ]
        : []),
      ...(observationContract
        ? [
            "do not infer emotion, intent, score, activity, or conversational purpose from message form or repetition.",
            "do not treat an assistant-authored guess as established semantic evidence.",
          ]
        : []),
      ...(planShape.responseIntent === "initiate_topic"
        ? [
            "do not interpret no topic as withdrawal, sadness, or a request for silence.",
            "do not make the user choose or explain a topic before the assistant offers a light entry.",
          ]
        : []),
      ...(supportActionElement
        ? [
            "do not decide for the user",
            "do not produce a large plan",
            "do not retreat into pure reflection when a minimal action scaffold is safe",
          ]
        : []),
    ],
    safetyNotes: context.safety.safetyTriggered ? [`safetyLevel=${context.safety.safetyLevel}`] : [],
    interaction: context.signals.interaction,
    rationale: [
      `ResponseGoalSelector dry-run selected responseGoal=${responseGoal}.`,
      "RogersStrategy remains the default dry-run strategy and serves the selected responseGoal.",
      "Plan remains trace-first unless an approved interaction decision requires a bounded Prompt rendering.",
      `Semantic evidence is ${context.signals.semanticEvidence.status} (${context.signals.semanticEvidence.source}).`,
      `Interaction: content=${context.signals.interaction.contentAvailability}, engagement=${context.signals.interaction.engagement}, initiative=${context.signals.interaction.initiativeDirection}, affect=${context.signals.interaction.affect}, stopIntent=${context.signals.interaction.stopIntent}.`,
      ...(supportActionElement ? [supportActionElement] : []),
      `ClinicalContext memory received: understandings=${context.memory.understandings.length}, timelineEvents=${context.memory.timelineEvents.length}, relationships=${context.memory.relationships.length}, semanticMemories=${context.memory.semanticMemories.length}.`,
    ],
  };
};
