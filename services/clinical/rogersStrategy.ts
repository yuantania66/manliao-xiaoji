import type { ClinicalContext, ClinicalPlan } from "./clinicalTypes";

const USER_CORRECTION_PATTERN = /不是这个意思|不是这意思|你没懂|你没理解|你理解错|你说错|你是不是.*(没懂|没理解)/;

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
    const userCorrectedAi = USER_CORRECTION_PATTERN.test(context.conversation.currentUserMessage);

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

  return {
    responseGoal,
    responseIntent: planShape.responseIntent,
    primaryStrategy: "rogers",
    secondaryStrategies: [],
    questionFunction: planShape.questionFunction,
    toneConstraint: ["warm", "non-directive", "non-diagnostic"],
    interventionBoundary: ["no diagnosis", "no treatment plan"],
    safetyNotes: context.safety.safetyTriggered ? [`safetyLevel=${context.safety.safetyLevel}`] : [],
    rationale: [
      `ResponseGoalSelector dry-run selected responseGoal=${responseGoal}.`,
      "RogersStrategy remains the default dry-run strategy and serves the selected responseGoal.",
      "Plan is trace-first in this sprint; Prompt structure is not changed.",
      `ClinicalContext memory received: understandings=${context.memory.understandings.length}, timelineEvents=${context.memory.timelineEvents.length}, relationships=${context.memory.relationships.length}, semanticMemories=${context.memory.semanticMemories.length}.`,
    ],
  };
};
