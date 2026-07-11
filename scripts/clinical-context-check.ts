import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createClinicalMemoryContext } from "../services/ai/clinicalMemoryAdapter";
import { determineConversationState } from "../conversation-os/state";
import { buildClinicalContext } from "../services/clinical/clinicalContextBuilder";
import { createClinicalPlan } from "../services/clinical/clinicalPlanService";
import { selectResponseGoal } from "../services/clinical/responseGoalSelector";
import { StructuredRagContext } from "../services/understanding/understandingTypes";

const selectorSource = readFileSync("services/clinical/responseGoalSelector.ts", "utf8");
assert(
  !selectorSource.includes("context.userTurn"),
  "ResponseGoalSelector must use ClinicalContext.conversation.currentUserMessage, not context.userTurn."
);
assert(
  selectorSource.includes("context.conversation.currentUserMessage"),
  "ResponseGoalSelector must read conversation.currentUserMessage from structured ClinicalContext."
);
assert(
  selectorSource.includes("context.signals.expressionDifficulty"),
  "ResponseGoalSelector must consume ClinicalContext.signals.expressionDifficulty."
);
assert(
  selectorSource.includes("context.signals.explicitAdviceRequest"),
  "ResponseGoalSelector must consume ClinicalContext.signals.explicitAdviceRequest."
);

const clinicalDir = "services/clinical";
const legacyClinicalContextAccess =
  /context\.(userTurn|memoryContext|conversationSignals|recentTurns|currentUnderstanding|safetyNotes)\b/;
const signalCalculationLiteral = /\b(expressionDifficulty|explicitAdviceRequest|emotionalIntensity|memoryAvailability):/;

for (const fileName of readdirSync(clinicalDir)) {
  if (!fileName.endsWith(".ts")) continue;
  if (fileName === "clinicalContextBuilder.ts") continue;

  const filePath = join(clinicalDir, fileName);
  const source = readFileSync(filePath, "utf8");
  const legacyAccess = source.match(legacyClinicalContextAccess);
  const signalCalculation = fileName === "clinicalTypes.ts" ? null : source.match(signalCalculationLiteral);

  assert(
    !legacyAccess,
    `${filePath} must not read legacy ClinicalContext field ${legacyAccess?.[0]}. Use conversation/memory/session/safety/meta.`
  );
  assert(
    !signalCalculation,
    `${filePath} must not calculate ClinicalContext signals. Signals are generated only by clinicalContextBuilder.`
  );
  assert(!source.includes("rawMemoryService"), `${filePath} must not read RawMemory directly.`);
  assert(!source.includes("RawMemoryKind"), `${filePath} must not depend on RawMemory types.`);
}

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
    {
      id: "memory-v2:semantic:s1",
      kind: "fact",
      text: "用户提到上线前容易卡住。",
      confidence: 0.6,
      reason: "memory_v2_raw_segment_current_version",
    },
  ],
  similarMemories: [],
  coreEvents: [],
  activeHypotheses: [],
  counterEvidence: [],
  professionalGuidance: [],
  userFeedback: [],
  retrievalReason: "clinical_context_check",
};

const memoryContext = createClinicalMemoryContext(structuredContext);
const contextRecentTurns = [
  {
    role: "assistant" as const,
    content: "可以慢慢说。",
  },
];
const buildConversationState = (userTurn: string, recentTurns = contextRecentTurns) =>
  determineConversationState({
    currentUserMessage: userTurn,
    recentMessages: recentTurns,
  }).state;

const context = buildClinicalContext({
  conversationId: "clinical-context-check",
  userId: "check-user",
  userTurn: "我不知道想说什么",
  recentTurns: contextRecentTurns,
  memoryContext,
  conversationState: buildConversationState("我不知道想说什么"),
  previousResponseGoal: "reflect",
  safetyTriggered: false,
  safetyLevel: "none",
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
  channel: "chat",
});

assert.equal(context.conversation.currentUserMessage, "我不知道想说什么");
assert.equal(context.conversation.previousAssistantMessage, "可以慢慢说。");
assert.equal(context.conversation.turnCount, 2);
assert.equal(context.conversation.state, "exploring");
assert.equal(context.memory.understandings.length, 1);
assert.equal(context.memory.timelineEvents.length, 1);
assert.equal(context.memory.relationships.length, 1);
assert.equal(context.memory.semanticMemories.length, 1);
assert.equal(context.session.currentResponseGoal, null);
assert.equal(context.session.previousResponseGoal, "reflect");
assert.equal(context.safety.safetyTriggered, false);
assert.equal(context.safety.safetyLevel, "none");
assert.equal(context.meta.locale, "zh-CN");
assert.equal(context.meta.timezone, "Asia/Shanghai");
assert.equal(context.meta.channel, "chat");
assert.equal(context.signals.messageLength, "SHORT");
assert.equal(context.signals.expressionDifficulty, true);
assert.equal(context.signals.explicitAdviceRequest, false);
assert.equal(context.signals.emotionalIntensity, "LOW");
assert.equal(context.signals.hasPreviousAssistantReply, true);
assert.equal(context.signals.conversationStage, "EXPLORING");
assert.deepEqual(context.signals.memoryAvailability, {
  hasUnderstanding: true,
  hasRelationship: true,
  hasTimeline: true,
  hasSemanticMemory: true,
});
assert.equal(context.userTurn, "我不知道想说什么");
assert.equal(context.memoryContext.understandings.length, 1);
assert.equal(context.conversationSignals.userExpressesUncertainty, true);
assert.deepEqual(context.safetyNotes, []);

assert.equal(
  selectResponseGoal(context),
  "help_continue_expression",
  "ResponseGoalSelector must consume ClinicalContext and keep expression-stuck behavior."
);
assert.equal(createClinicalPlan(context).responseGoal, "help_continue_expression");

const adviceContext = buildClinicalContext({
  conversationId: "clinical-context-check",
  userId: "check-user",
  userTurn: "你能给我点建议吗？",
  recentTurns: [],
  memoryContext,
  conversationState: buildConversationState("你能给我点建议吗？", []),
});
assert.equal(adviceContext.conversation.state, "action");
assert.equal(adviceContext.signals.explicitAdviceRequest, true);
assert.equal(selectResponseGoal(adviceContext), "support_action");
assert.equal(createClinicalPlan(adviceContext).responseGoal, "support_action");

const concreteActionAdviceCases = [
  "我明天要跟领导谈，怎么开口比较好？",
  "能不能帮我理一下，我现在到底该先做什么？",
  "你先别安慰我，帮我看看现在能做什么。",
];

for (const input of concreteActionAdviceCases) {
  const actionContext = buildClinicalContext({
    conversationId: "clinical-context-check",
    userId: "check-user",
    userTurn: input,
    recentTurns: [],
    memoryContext,
    conversationState: buildConversationState(input, []),
  });
  assert.equal(actionContext.signals.explicitAdviceRequest, true, `${input} must set explicitAdviceRequest.`);
  assert.equal(selectResponseGoal(actionContext), "support_action", `${input} must select support_action.`);
  assert.equal(createClinicalPlan(actionContext).responseGoal, "support_action", `${input} must create support_action plan.`);
}

const expressionOpenContext = buildClinicalContext({
  conversationId: "clinical-context-check",
  userId: "check-user",
  userTurn: "我开不了口",
  recentTurns: [],
  memoryContext,
  conversationState: buildConversationState("我开不了口", []),
});
assert.equal(expressionOpenContext.signals.expressionDifficulty, true);
assert.equal(expressionOpenContext.signals.explicitAdviceRequest, false);
assert.equal(selectResponseGoal(expressionOpenContext), "help_continue_expression");

const numericContext = buildClinicalContext({
  conversationId: "clinical-context-check",
  userId: "check-user",
  userTurn: "1",
  recentTurns: [],
  memoryContext,
  conversationState: buildConversationState("1", []),
});
assert.equal(numericContext.conversation.state, "opening");
assert.equal(numericContext.signals.messageLength, "SHORT");
assert.equal(numericContext.signals.expressionDifficulty, false);
assert.equal(numericContext.signals.explicitAdviceRequest, false);
assert.equal(selectResponseGoal(numericContext), "clarify");
assert.equal(createClinicalPlan(numericContext).responseGoal, "clarify");

console.log(
  JSON.stringify(
    {
      clinicalContext: {
        conversation: Object.keys(context.conversation),
        memory: {
          understandings: context.memory.understandings.length,
          relationships: context.memory.relationships.length,
          timelineEvents: context.memory.timelineEvents.length,
          semanticMemories: context.memory.semanticMemories.length,
        },
        session: context.session,
        safety: context.safety,
        meta: context.meta,
        signals: context.signals,
      },
      responseGoals: {
        expressionStuck: createClinicalPlan(context).responseGoal,
        advice: createClinicalPlan(adviceContext).responseGoal,
        numeric: createClinicalPlan(numericContext).responseGoal,
      },
    },
    null,
    2
  )
);
