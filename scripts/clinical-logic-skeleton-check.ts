import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createSafetyGeneration } from "../services/ai/chatSafety";
import { buildAiDebugTrace } from "../services/ai/debugTrace";
import { buildChatPrompt } from "../services/ai/promptBuilder";
import { determineConversationState } from "../conversation-os/state";
import { buildClinicalContext } from "../services/clinical/clinicalContextBuilder";
import { createClinicalPlan, createNoOpClinicalPlan } from "../services/clinical/clinicalPlanService";
import { buildClinicalTrace, buildSafetySkippedClinicalTrace } from "../services/clinical/clinicalTrace";
import type { ClinicalPlan } from "../services/clinical/clinicalTypes";
import { createClinicalMemoryContext } from "../services/ai/clinicalMemoryAdapter";
import { StructuredRagContext } from "../services/understanding/understandingTypes";

const orchestration = readFileSync("services/ai/chatOrchestrationService.ts", "utf8");
const promptBuilder = readFileSync("services/ai/promptBuilder.ts", "utf8");

const safetyBranchIndex = orchestration.indexOf("if (isCrisisInput(userMessage))");
const clinicalContextIndex = orchestration.indexOf("const clinicalContext = buildClinicalContext");
const clinicalPlanIndex = orchestration.indexOf("const clinicalPlan = createClinicalPlan");
const generateIndex = orchestration.indexOf("generateChatReply({");

assert(safetyBranchIndex >= 0, "Safety gate must remain in createChatReply().");
assert(clinicalContextIndex > safetyBranchIndex, "Ordinary ClinicalContext must be built after Safety gate.");
assert(clinicalPlanIndex > clinicalContextIndex, "ClinicalPlan must be created from ClinicalContext.");
assert(generateIndex > clinicalPlanIndex, "ClinicalPlan must be created before Prompt Builder / LLM generation.");
assert(promptBuilder.includes("CLINICAL_PLAN_PROMPT_ENABLED"), "ClinicalPlan prompt injection must be feature-flagged.");

const safetyTrace = buildSafetySkippedClinicalTrace({
  level: "crisis",
  notes: ["Safety gate matched; ordinary ClinicalPlan skipped."],
});
assert.equal(safetyTrace.skippedBySafety, true, "Safety hit must skip ordinary ClinicalPlan.");
assert.equal(safetyTrace.selectedPlan, undefined, "Safety hit must not include ordinary ClinicalPlan.");
assert.equal(safetyTrace.safetyDecision?.routedToSafety, true, "Safety trace must route to Safety.");

const structuredContext: StructuredRagContext = {
  recentMemories: [
    {
      id: "memory-v2-understanding:u1",
      kind: "hypothesis",
      text: "用户最近在意上线后的反馈。",
      confidence: 0.7,
      reason: "memory_v2_understanding_current_version",
    },
    {
      id: "memory-v2-timeline:t1",
      kind: "event",
      text: "产品上线",
      confidence: 0.6,
      reason: "memory_v2_timeline_supporting_current_version",
    },
    {
      id: "memory-v2-relationship:r1",
      kind: "hypothesis",
      text: "领导是当前相关人物。",
      people: ["领导"],
      confidence: 0.5,
      reason: "memory_v2_relationship_supporting_current_version",
    },
  ],
  similarMemories: [],
  coreEvents: [],
  activeHypotheses: [],
  counterEvidence: [],
  professionalGuidance: [],
  userFeedback: [],
  retrievalReason: "clinical_logic_skeleton_check",
};

const clinicalMemoryContext = createClinicalMemoryContext(structuredContext);
const getConversationState = (userTurn: string, recentTurns = []) =>
  determineConversationState({
    currentUserMessage: userTurn,
    recentMessages: recentTurns,
  }).state;

const clinicalContext = buildClinicalContext({
  conversationId: "check-conversation",
  userId: "check-user",
  userTurn: "今天好累",
  recentTurns: [],
  memoryContext: clinicalMemoryContext,
  conversationState: getConversationState("今天好累"),
});
const clinicalPlan = createClinicalPlan(clinicalContext);
const clinicalTrace = buildClinicalTrace({
  context: clinicalContext,
  plan: clinicalPlan,
});

assert.equal(clinicalTrace.skippedBySafety, false, "Ordinary reply must enter ClinicalPlan.");
assert.equal(clinicalTrace.conversationState, "opening", "ClinicalTrace must expose Conversation State.");
assert.equal(clinicalTrace.selectedPlan?.primaryStrategy, "rogers", "Ordinary reply must create Rogers dry-run ClinicalPlan.");
assert.equal(
  clinicalTrace.selectedPlan?.responseGoal,
  "reflect",
  "Ordinary emotional input must generate reflect responseGoal."
);
assert.equal(
  clinicalTrace.selectedPlan?.responseIntent,
  "empathic_reflection",
  "Rogers dry-run ClinicalPlan must use empathic_reflection intent."
);
assert.equal(
  clinicalTrace.selectedPlan?.questionFunction,
  "clarify_or_reflect",
  "Rogers dry-run ClinicalPlan must use clarify_or_reflect question function."
);
assert.equal(clinicalTrace.signals.messageLength, "SHORT", "ClinicalTrace must expose ClinicalContext signals.");
assert.equal(clinicalTrace.signals.emotionalIntensity, "MEDIUM", "ClinicalTrace must expose emotionalIntensity.");
assert.deepEqual(
  clinicalTrace.signals.memoryAvailability,
  {
    hasUnderstanding: true,
    hasRelationship: true,
    hasTimeline: true,
    hasSemanticMemory: false,
  },
  "ClinicalTrace must expose memoryAvailability without changing ResponseGoal."
);
assert.deepEqual(clinicalTrace.selectedPlan?.toneConstraint, ["warm", "non-directive", "non-diagnostic"]);
assert.deepEqual(clinicalTrace.selectedPlan?.interventionBoundary, ["no diagnosis", "no treatment plan"]);
assert.equal(
  clinicalTrace.memoryUsed.understandings[0],
  "用户最近在意上线后的反馈。",
  "ClinicalMemoryContext understandings must enter ClinicalContext / trace."
);
assert.equal(
  clinicalTrace.memoryUsed.timelineEvents[0],
  "产品上线",
  "ClinicalMemoryContext timeline events must enter ClinicalContext / trace."
);
assert.equal(
  clinicalTrace.memoryUsed.relationships[0],
  "领导是当前相关人物。",
  "ClinicalMemoryContext relationships must enter ClinicalContext / trace."
);
assert.equal(clinicalTrace.memoryExcluded.rawMemory, "not_allowed", "Clinical Logic must not expose RawMemory.");

const noOpFallbackPlan = createNoOpClinicalPlan(clinicalContext);
assert.equal(noOpFallbackPlan.primaryStrategy, "noop", "NoOp ClinicalStrategy fallback must remain available.");
assert.equal(noOpFallbackPlan.responseGoal, "reflect", "NoOp ClinicalStrategy fallback must include responseGoal.");

const stuckExpressionContext = buildClinicalContext({
  conversationId: "check-conversation",
  userId: "check-user",
  userTurn: "我不知道想说什么",
  recentTurns: [],
  memoryContext: clinicalMemoryContext,
  conversationState: getConversationState("我不知道想说什么"),
});
const stuckExpressionPlan = createClinicalPlan(stuckExpressionContext);
assert.equal(
  stuckExpressionPlan.responseGoal,
  "help_continue_expression",
  "Expression-stuck input must generate help_continue_expression responseGoal."
);
assert.equal(
  stuckExpressionContext.signals.expressionDifficulty,
  true,
  "Expression-stuck input must set signals.expressionDifficulty."
);
assert.equal(
  stuckExpressionPlan.responseIntent,
  "invite_expression",
  "help_continue_expression must map to invite_expression in dry-run plan."
);
assert.equal(
  stuckExpressionPlan.questionFunction,
  "open_gentle_invitation",
  "help_continue_expression must map to open_gentle_invitation in dry-run plan."
);

const expressionStuckCases = [
  "不知道从哪里开始",
  "脑子很乱",
  "想说但说不出来",
  "卡住了",
  "不知道怎么讲",
];

const expressionStuckPlans = expressionStuckCases.map((userTurn) => {
  const context = buildClinicalContext({
    conversationId: "check-conversation",
    userId: "check-user",
    userTurn,
    recentTurns: [],
    memoryContext: clinicalMemoryContext,
    conversationState: getConversationState(userTurn),
  });
  const plan = createClinicalPlan(context);
  assert.equal(
    plan.responseGoal,
    "help_continue_expression",
    `${userTurn} must generate help_continue_expression responseGoal.`
  );
  return { userTurn, plan };
});

const adviceContext = buildClinicalContext({
  conversationId: "check-conversation",
  userId: "check-user",
  userTurn: "你能给我点建议吗？",
  recentTurns: [],
  memoryContext: clinicalMemoryContext,
  conversationState: getConversationState("你能给我点建议吗？"),
});
const advicePlan = createClinicalPlan(adviceContext);
assert.equal(
  adviceContext.signals.explicitAdviceRequest,
  true,
  "Explicit advice input must set signals.explicitAdviceRequest."
);
assert.equal(
  advicePlan.responseGoal,
  "support_action",
  "Explicit advice request must generate support_action responseGoal."
);
assert.equal(advicePlan.responseIntent, "support_action", "support_action responseGoal must preserve action support intent.");

const getPlanContractText = (plan: ClinicalPlan) =>
  [...plan.toneConstraint, ...plan.interventionBoundary, ...plan.rationale].join("\n");

const supportActionContractCases = [
  {
    id: "GD-ADV-002",
    input: "我该不该辞职？",
    elementType: "decision frame",
  },
  {
    id: "GD-ADV-003",
    input: "我明天要跟领导谈，怎么开口比较好？",
    elementType: "wording frame",
  },
  {
    id: "GD-ADV-004",
    input: "我想道歉，但又怕显得我太卑微，怎么办？",
    elementType: "option set",
  },
  {
    id: "GD-ADV-005",
    input: "能不能帮我理一下，我现在到底该先做什么？",
    elementType: "sorting scaffold",
  },
  {
    id: "GD-ADV-006",
    input: "你先别安慰我，帮我看看现在能做什么。",
    elementType: "concrete step",
  },
];

const supportActionContractPlans = supportActionContractCases.map(({ id, input, elementType }) => {
  const context = buildClinicalContext({
    conversationId: "check-conversation",
    userId: "check-user",
    userTurn: input,
    recentTurns: [],
    memoryContext: clinicalMemoryContext,
    conversationState: getConversationState(input),
  });
  const plan = createClinicalPlan(context);
  const contractText = getPlanContractText(plan);

  assert.equal(plan.responseGoal, "support_action", `${id} must select support_action.`);
  assert.equal(plan.responseIntent, "support_action", `${id} must keep support_action responseIntent.`);
  assert.equal(plan.questionFunction, "support_user_agency", `${id} must preserve user agency.`);
  assert(
    contractText.includes("actionSupportElement:"),
    `${id} ClinicalPlan must include a renderable action-support element.`
  );
  assert(
    contractText.includes(elementType),
    `${id} ClinicalPlan must include ${elementType} action-support element.`
  );

  return { id, responseGoal: plan.responseGoal, elementType };
});

const numericContext = buildClinicalContext({
  conversationId: "check-conversation",
  userId: "check-user",
  userTurn: "1",
  recentTurns: [],
  memoryContext: clinicalMemoryContext,
  conversationState: getConversationState("1"),
});
const numericPlan = createClinicalPlan(numericContext);
assert.equal(numericContext.signals.messageLength, "SHORT", "Pure numeric input must set messageLength=SHORT.");
assert.equal(numericPlan.responseGoal, "clarify", "Pure numeric input must remain clarify.");

const promptInput = {
  userMessage: "今天好累",
  recentMessages: [],
};
process.env.CLINICAL_PLAN_PROMPT_ENABLED = "false";
const promptWithoutPlan = buildChatPrompt(promptInput);
const promptWithPlanFlagOff = buildChatPrompt({
  ...promptInput,
  clinicalPlan,
});
assert.deepEqual(
  promptWithPlanFlagOff,
  promptWithoutPlan,
  "flag=false must keep prompt output unchanged even when ClinicalPlan is available."
);

process.env.CLINICAL_PLAN_PROMPT_ENABLED = "true";
const promptWithReflectPlan = buildChatPrompt({
  ...promptInput,
  clinicalPlan,
});
const reflectPromptText = JSON.stringify(promptWithReflectPlan.messages);
assert(
  !reflectPromptText.includes("【Clinical Plan】"),
  "flag=true must not inject ClinicalPlan prompt for non-help_continue_expression responseGoal."
);

const promptWithHelpContinuePlan = buildChatPrompt({
  userMessage: "我不知道想说什么",
  recentMessages: [],
  clinicalPlan: stuckExpressionPlan,
});
const helpContinuePromptText = JSON.stringify(promptWithHelpContinuePlan.messages);
assert(
  helpContinuePromptText.includes("【Clinical Plan】"),
  "flag=true must inject ClinicalPlan prompt for help_continue_expression."
);
assert(
  helpContinuePromptText.includes("responseGoal: help_continue_expression"),
  "help_continue_expression ClinicalPlan prompt must include responseGoal."
);
assert(
  helpContinuePromptText.includes("Goal: help the user continue expressing themselves."),
  "help_continue_expression ClinicalPlan prompt must include goal instruction."
);
assert(
  helpContinuePromptText.includes("Do not only say it is okay and end the reply."),
  "help_continue_expression ClinicalPlan prompt must prevent empty reassurance."
);
assert(
  helpContinuePromptText.includes("one first word, image, feeling, or body sensation"),
  "help_continue_expression ClinicalPlan prompt must include gentle expression entry instruction."
);
assert(!helpContinuePromptText.includes("CBT"), "help_continue_expression prompt must not inject CBT.");
assert(!helpContinuePromptText.includes("ACT"), "help_continue_expression prompt must not inject ACT.");
assert(!helpContinuePromptText.includes("MI"), "help_continue_expression prompt must not inject MI.");
assert(!helpContinuePromptText.includes("ResponseGoalSelector dry-run"), "Clinical rationale must not enter prompt.");

expressionStuckPlans.forEach(({ userTurn, plan }) => {
  const prompt = buildChatPrompt({
    userMessage: userTurn,
    recentMessages: [],
    clinicalPlan: plan,
  });
  const promptText = JSON.stringify(prompt.messages);
  assert(
    promptText.includes("responseGoal: help_continue_expression"),
    `${userTurn} must inject help_continue_expression instruction when flag=true.`
  );
  assert(
    promptText.includes("Goal: help the user continue expressing themselves."),
    `${userTurn} must include help_continue_expression goal instruction.`
  );
});

const promptWithNoOpPlan = buildChatPrompt({
  ...promptInput,
  clinicalPlan: noOpFallbackPlan,
});
const noOpPromptText = JSON.stringify(promptWithNoOpPlan.messages);
assert(!noOpPromptText.includes("【Clinical Plan】"), "NoOp fallback must not inject Rogers ClinicalPlan prompt.");
assert(!noOpPromptText.includes("primaryStrategy: rogers"), "NoOp fallback must not inject Rogers instruction.");
process.env.CLINICAL_PLAN_PROMPT_ENABLED = "false";

const safetyGeneration = createSafetyGeneration("我不想活了");
const debugTrace = buildAiDebugTrace({
  userMessage: "我不想活了",
  recentMessages: [],
  generation: safetyGeneration,
  judge: {
    passed: true,
    riskLevel: "crisis",
    issues: [],
    rewriteRequired: false,
    reason: "safety gate matched; base model skipped",
    judgeModel: "safety-gate",
  },
  finalSource: "safety",
  fallbackUsed: false,
  rewriteAttempted: false,
  clinicalTrace: safetyTrace,
});
assert.equal(debugTrace.clinicalLogic?.skippedBySafety, true, "Clinical trace must enter debug trace.");
assert.equal(debugTrace.clinicalLogic.selectedPlan, undefined, "Safety path must not include ordinary ClinicalPlan.");
assert.equal(debugTrace.prompt.modelMessageRoles.length, 0, "Safety path must not build ordinary ClinicalPlan prompt.");
assert(
  debugTrace.thinkingLayers.some((layer) => layer.title.includes("Clinical Logic")),
  "Debug thinking layers must include Clinical Logic."
);

console.log(
  JSON.stringify(
    {
      skeleton: "services/clinical",
      safetySkipsClinicalPlan: safetyTrace.skippedBySafety,
      ordinaryPlan: clinicalTrace.selectedPlan?.primaryStrategy,
      ordinaryResponseGoal: clinicalTrace.selectedPlan?.responseGoal,
      expressionStuckResponseGoal: stuckExpressionPlan.responseGoal,
      expandedExpressionStuckCases: expressionStuckPlans.map(({ userTurn, plan }) => ({
        input: userTurn,
        responseGoal: plan.responseGoal,
      })),
      adviceResponseGoal: advicePlan.responseGoal,
      supportActionContractCases: supportActionContractPlans,
      numericResponseGoal: numericPlan.responseGoal,
      noOpFallback: noOpFallbackPlan.primaryStrategy,
      promptInjection: {
        flagFalseUnchanged: true,
        flagTrueHelpContinueExpressionOnly: true,
        safetySkipped: true,
        noOpSkipped: true,
      },
      memoryUsed: {
        understandings: clinicalTrace.memoryUsed.understandings.length,
        relationships: clinicalTrace.memoryUsed.relationships.length,
        timelineEvents: clinicalTrace.memoryUsed.timelineEvents.length,
      },
      debugTrace: Boolean(debugTrace.clinicalLogic),
    },
    null,
    2
  )
);
