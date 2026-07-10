import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { determineConversationState } from "../conversation-os/state";
import type { ConversationMessage } from "../conversation-os";
import { createSafetyGeneration } from "../services/ai/chatSafety";
import { buildAiDebugTrace } from "../services/ai/debugTrace";
import { buildChatPrompt } from "../services/ai/promptBuilder";
import { createClinicalMemoryContext } from "../services/ai/clinicalMemoryAdapter";
import { buildClinicalContext } from "../services/clinical/clinicalContextBuilder";
import { createClinicalPlan } from "../services/clinical/clinicalPlanService";
import { buildClinicalTrace, buildSafetySkippedClinicalTrace } from "../services/clinical/clinicalTrace";

const serviceSource = readFileSync("conversation-os/state/conversationStateService.ts", "utf8");
assert(!serviceSource.includes("RawMemory"), "Conversation State must not read RawMemory.");
assert(!serviceSource.includes("Timeline"), "Conversation State dry-run must not read Timeline.");
assert(!serviceSource.includes("Relationship"), "Conversation State dry-run must not read Relationship.");
assert(!serviceSource.includes("Understanding"), "Conversation State dry-run must not read Understanding.");
assert(!serviceSource.includes("ClinicalPlan"), "Conversation State must not read ClinicalPlan.");

const firstTurn = determineConversationState({
  currentUserMessage: "我不知道想说什么",
  recentMessages: [],
});
assert.equal(firstTurn.state, "opening", "First turn expression difficulty must be opening.");

const sustainedRecentMessages: ConversationMessage[] = [
  { role: "user", content: "今天领导开会的时候说了那个项目。" },
  { role: "assistant", content: "听起来那个项目让你一直挂着。" },
  { role: "user", content: "后来我回去想了很久，觉得自己是不是又没做好。" },
  { role: "assistant", content: "这里好像不只是项目，还有你对自己的怀疑。" },
  { role: "user", content: "对，我一遇到这种反馈就会想到以前也这样。" },
];

const sustainedState = determineConversationState({
  currentUserMessage: "然后我就开始反复想是不是我哪里有问题。",
  recentMessages: sustainedRecentMessages,
});
assert(
  sustainedState.state === "exploring" || sustainedState.state === "deepening",
  "Sustained same-thread disclosure must be exploring or deepening."
);
assert.equal(sustainedState.state, "deepening", "Current dry-run should identify sustained disclosure as deepening.");

const actionState = determineConversationState({
  currentUserMessage: "你觉得我接下来该怎么办",
  recentMessages: [],
});
assert.equal(actionState.state, "action", "Explicit next-step request must be action.");

const closingState = determineConversationState({
  currentUserMessage: "今天先聊到这里吧",
  recentMessages: [],
});
assert.equal(closingState.state, "closing", "Explicit ending signal must be closing.");

const memoryContext = createClinicalMemoryContext(null);
const clinicalContext = buildClinicalContext({
  conversationId: "conversation-state-check",
  userId: "check-user",
  userTurn: "我不知道想说什么",
  recentTurns: [],
  memoryContext,
  conversationState: firstTurn.state,
});
assert.equal(clinicalContext.conversation.state, "opening", "Conversation State must enter ClinicalContext.");

const clinicalPlan = createClinicalPlan(clinicalContext);
const clinicalTrace = buildClinicalTrace({
  context: clinicalContext,
  plan: clinicalPlan,
});
assert.equal(clinicalTrace.conversationState, "opening", "Conversation State must enter ClinicalTrace.");
assert.equal(
  clinicalPlan.responseGoal,
  "help_continue_expression",
  "Existing ResponseGoal behavior must remain unchanged after state injection."
);

const sameInputOpening = buildClinicalContext({
  conversationId: "conversation-state-check",
  userId: "check-user",
  userTurn: "今天好累",
  recentTurns: [],
  memoryContext,
  conversationState: "opening",
});
const sameInputDeepening = buildClinicalContext({
  conversationId: "conversation-state-check",
  userId: "check-user",
  userTurn: "今天好累",
  recentTurns: sustainedRecentMessages,
  memoryContext,
  conversationState: "deepening",
});
const openingPlan = createClinicalPlan(sameInputOpening);
const deepeningPlan = createClinicalPlan(sameInputDeepening);
assert.equal(openingPlan.responseGoal, deepeningPlan.responseGoal, "State must not change ResponseGoal in dry-run.");
assert.deepEqual(openingPlan, deepeningPlan, "ClinicalPlan must remain unchanged by state in dry-run.");

process.env.CLINICAL_PLAN_PROMPT_ENABLED = "true";
const promptInput = {
  userMessage: "今天好累",
  recentMessages: [],
};
assert.deepEqual(
  buildChatPrompt({ ...promptInput, clinicalPlan: openingPlan }),
  buildChatPrompt({ ...promptInput, clinicalPlan: deepeningPlan }),
  "Prompt output must remain unchanged by Conversation State dry-run."
);
process.env.CLINICAL_PLAN_PROMPT_ENABLED = "false";

const safetyState = determineConversationState({
  currentUserMessage: "我不想活了",
  recentMessages: [],
});
const safetyTrace = buildSafetySkippedClinicalTrace({
  level: "crisis",
  notes: ["Safety gate matched; ordinary ClinicalPlan skipped."],
  conversationState: safetyState.state,
});
const safetyDebugTrace = buildAiDebugTrace({
  userMessage: "我不想活了",
  recentMessages: [],
  generation: createSafetyGeneration("我不想活了"),
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
assert.equal(safetyTrace.skippedBySafety, true, "Safety path must still skip ordinary ClinicalPlan.");
assert.equal(safetyDebugTrace.clinicalLogic?.conversationState, safetyState.state, "State must enter debug trace.");
assert.equal(safetyDebugTrace.prompt.modelMessageRoles.length, 0, "Safety behavior must remain unchanged.");

console.log(
  JSON.stringify(
    {
      states: {
        firstTurn: firstTurn.state,
        sustained: sustainedState.state,
        action: actionState.state,
        closing: closingState.state,
      },
      clinicalContextState: clinicalContext.conversation.state,
      clinicalTraceState: clinicalTrace.conversationState,
      responseGoalUnchanged: openingPlan.responseGoal,
      safetySkipped: safetyTrace.skippedBySafety,
    },
    null,
    2
  )
);
