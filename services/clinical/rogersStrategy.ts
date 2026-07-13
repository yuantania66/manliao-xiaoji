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
      responseIntent: "invite_expression",
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
            "keep a low-pressure continuation entry; do not require immediate explanation.",
          ]
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
      ...(supportActionElement
        ? [
            "do not decide for the user",
            "do not produce a large plan",
            "do not retreat into pure reflection when a minimal action scaffold is safe",
          ]
        : []),
    ],
    safetyNotes: context.safety.safetyTriggered ? [`safetyLevel=${context.safety.safetyLevel}`] : [],
    rationale: [
      `ResponseGoalSelector dry-run selected responseGoal=${responseGoal}.`,
      "RogersStrategy remains the default dry-run strategy and serves the selected responseGoal.",
      "Plan is trace-first in this sprint; Prompt structure is not changed.",
      ...(supportActionElement ? [supportActionElement] : []),
      `ClinicalContext memory received: understandings=${context.memory.understandings.length}, timelineEvents=${context.memory.timelineEvents.length}, relationships=${context.memory.relationships.length}, semanticMemories=${context.memory.semanticMemories.length}.`,
    ],
  };
};
