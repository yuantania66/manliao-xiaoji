import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createClinicalMemoryContext } from "../services/ai/clinicalMemoryAdapter";
import { StructuredRagContext } from "../services/understanding/understandingTypes";

const read = (path: string) => readFileSync(path, "utf8");

const orchestration = read("services/ai/chatOrchestrationService.ts");
const aiService = read("services/ai/aiService.ts");
const chatSafety = read("services/ai/chatSafety.ts");
const clinicalPlanService = read("services/clinical/clinicalPlanService.ts");
const promptBuilder = read("services/ai/promptBuilder.ts");
const loginService = read("services/ai/chatReplyService.ts");
const guestRoute = read("app/api/chat/guest/route.ts");
const loginRoute = read("app/api/chat/sessions/[sessionId]/messages/route.ts");
const packageJson = read("package.json");
const envExample = read(".env.example");

assert(
  orchestration.includes("export const createChatReply"),
  "Unified AI orchestration must export createChatReply()."
);
assert(
  orchestration.includes("isCrisisInput(userMessage)") &&
    orchestration.indexOf("isCrisisInput(userMessage)") < orchestration.indexOf("generateChatReply({"),
  "createChatReply() must run Safety before normal generation."
);
assert(
  orchestration.includes("loadMemoryContext") &&
    orchestration.indexOf("loadMemoryContext") < orchestration.indexOf("generateChatReply({"),
  "createChatReply() must resolve memory before normal generation."
);
assert(
  orchestration.includes("buildClinicalContext") &&
    orchestration.indexOf("buildClinicalContext") < orchestration.indexOf("createClinicalPlan("),
  "createChatReply() must build ClinicalContext before ClinicalPlan."
);
assert(
  orchestration.includes("createClinicalPlan(clinicalContext)") &&
    orchestration.indexOf("createClinicalPlan(clinicalContext)") < orchestration.indexOf("generateChatReply({"),
  "createChatReply() must create ClinicalPlan before normal generation."
);
assert(
  orchestration.includes("createClinicalMemoryContext(understandingContext)") &&
    orchestration.indexOf("createClinicalMemoryContext(understandingContext)") <
      orchestration.indexOf("buildClinicalContext("),
  "createChatReply() must adapt StructuredRagContext into ClinicalMemoryContext before ClinicalContext."
);
assert(
  orchestration.includes("buildSafetySkippedClinicalTrace") &&
    orchestration.indexOf("buildSafetySkippedClinicalTrace") < orchestration.indexOf("buildClinicalContext("),
  "Safety path must skip ordinary ClinicalPlan and emit a safety ClinicalTrace."
);
assert(
  orchestration.includes("createFallbackGeneration"),
  "createChatReply() must own fallback orchestration."
);
assert(
  chatSafety.includes('finalReplySource: "safety"'),
  "Safety generation must be named safety, not fallback."
);
assert(
  !chatSafety.includes('finalReplySource: "fallback"'),
  "Safety generation must not reuse fallback source naming."
);
assert(
  aiService.includes('finalReplySource: "fallback"'),
  "Ordinary fallback generation must keep fallback source naming."
);

assert(
  loginService.includes('import { createChatReply } from "./chatOrchestrationService"'),
  "Logged-in chat persistence service must call the unified createChatReply() entry."
);
assert(
  loginService.includes("createChatReply({"),
  "Logged-in chat persistence service must invoke createChatReply()."
);
assert(
  guestRoute.includes('import { createChatReply } from "@/services/ai/chatOrchestrationService"'),
  "Guest chat route must call the unified createChatReply() entry."
);
assert(guestRoute.includes("createChatReply({"), "Guest chat route must invoke createChatReply().");

for (const [label, content] of [
  ["guest route", guestRoute],
  ["logged-in route", loginRoute],
] as const) {
  assert(!content.includes("generateChatReply("), `${label} must not call generateChatReply() directly.`);
  assert(!content.includes("createFallbackGeneration("), `${label} must not assemble fallback directly.`);
  assert(!content.includes("createSafetyGeneration("), `${label} must not assemble safety replies directly.`);
  assert(!content.includes("buildAiDebugTrace("), `${label} must not build AI debug trace directly.`);
  assert(!content.includes("callModel("), `${label} must not call the model provider directly.`);
}

assert(
  !guestRoute.includes("createFallbackJudge") &&
    !guestRoute.includes("createDisabledJudge") &&
    !guestRoute.includes("getFallbackRiskLevel"),
  "Guest route must not duplicate judge/fallback helper logic."
);
assert(
  !loginService.includes("createFallbackJudge") &&
    !loginService.includes("createDisabledJudge") &&
    !loginService.includes("getFallbackRiskLevel") &&
    !loginService.includes("isCrisisInput"),
  "Logged-in chat persistence service must not duplicate orchestration helper logic."
);

assert(
  aiService.includes("runConversationPipeline("),
  "Normal generation must still go through Conversation OS."
);
assert(
  packageJson.includes('"check:ai-orchestration"'),
  "package.json must expose check:ai-orchestration."
);
assert(
  packageJson.includes('"check:clinical-logic-skeleton"'),
  "package.json must expose check:clinical-logic-skeleton."
);
assert(
  clinicalPlanService.includes("selectResponseGoal(context)") &&
    clinicalPlanService.includes("selectClinicalStrategy") &&
    clinicalPlanService.includes('primaryStrategy === "rogers"') &&
    clinicalPlanService.includes("createRogersClinicalPlan(context, responseGoal)"),
  "Default normal ClinicalPlan must use ResponseGoalSelector -> StrategySelector -> Rogers dry-run strategy."
);
assert(
  clinicalPlanService.includes("createNoOpClinicalPlan"),
  "NoOp ClinicalStrategy fallback must remain available."
);
assert(
  envExample.includes('CLINICAL_PLAN_PROMPT_ENABLED="false"'),
  "ClinicalPlan prompt feature flag must default to false in .env.example."
);
assert(
  promptBuilder.includes("CLINICAL_PLAN_PROMPT_ENABLED") &&
    promptBuilder.includes("formatClinicalPlanForPrompt"),
  "ClinicalPlan prompt integration must be feature-flagged in Prompt Builder."
);

const structuredContext: StructuredRagContext = {
  recentMemories: [
    {
      id: "memory-v2-understanding:u1",
      kind: "hypothesis",
      text: "用户当前对项目上线有一点担心。",
      confidence: 0.7,
      reason: "memory_v2_understanding_current_version",
    },
    {
      id: "memory-v2-timeline:t1",
      kind: "event",
      text: "项目上线",
      confidence: 0.6,
      reason: "memory_v2_timeline_supporting_current_version",
    },
    {
      id: "memory-v2-relationship:r1",
      kind: "hypothesis",
      text: "领导是当前对话中的相关人物。",
      people: ["领导"],
      confidence: 0.5,
      reason: "memory_v2_relationship_supporting_current_version",
    },
    {
      id: "memory-v2:s1",
      kind: "interpretation",
      text: "raw segment summary",
      confidence: 0.5,
      reason: "memory_v2_raw_segment_current_version",
    },
    {
      id: "legacy-note-1",
      kind: "note",
      text: "旧小记摘要",
      reason: "recent_note_3d",
    },
  ],
  similarMemories: [
    {
      id: "legacy-similar-1",
      kind: "experience",
      text: "旧相似体验",
      reason: "same_emotion_people_or_topic",
    },
  ],
  coreEvents: [
    {
      id: "legacy-core-event-1",
      kind: "event",
      text: "旧核心事件",
      reason: "core_event",
    },
  ],
  activeHypotheses: [
    {
      id: "legacy-hypothesis-1",
      hypothesisText: "工作可能是近期压力来源之一。",
      category: "work",
      confidence: 0.4,
      supportingEvidenceIds: [],
      counterEvidenceIds: [],
    },
  ],
  counterEvidence: [
    {
      id: "legacy-counter-1",
      kind: "experience",
      text: "运动后恢复明显",
      reason: "possible_recovery_counter_evidence",
    },
  ],
  professionalGuidance: [],
  userFeedback: [],
  retrievalReason: "clinical_memory_adapter_check",
};

const clinicalMemory = createClinicalMemoryContext(structuredContext);
assert.equal(clinicalMemory.understandings.length, 1, "V2 Understanding must map to understandings.");
assert.equal(clinicalMemory.timelineEvents.length, 1, "V2 Timeline must map to timelineEvents.");
assert.equal(clinicalMemory.relationships.length, 1, "V2 Relationship must map to relationships.");
assert.equal(clinicalMemory.semanticMemories.length, 1, "V2 SemanticMemory must map to semanticMemories.");
assert.equal(clinicalMemory.rawSummaries.length, 1, "Legacy notes/raw summaries must map to rawSummaries.");
assert.equal(clinicalMemory.legacyMemories.length, 4, "Legacy non-primary memories must stay separated.");
assert.equal(clinicalMemory.excluded.rawMemory, "not_allowed", "Clinical memory must not expose RawMemory.");
assert.equal(
  clinicalMemory.excluded.directRecentMemories,
  "not_allowed",
  "Clinical Logic must not consume recentMemories directly."
);
assert.equal(
  clinicalMemory.understandings[0]?.role,
  "primary_understanding",
  "Understanding must be marked as primary context."
);
assert.equal(
  clinicalMemory.timelineEvents[0]?.role,
  "supporting_context",
  "Timeline must be supporting context only."
);
assert.equal(
  clinicalMemory.relationships[0]?.role,
  "supporting_context",
  "Relationship must be supporting context only."
);

console.log(
  JSON.stringify(
    {
      unifiedEntry: "services/ai/chatOrchestrationService.ts:createChatReply",
      loggedInPath: "chatReplyService -> createChatReply",
      guestPath: "guest route -> createChatReply",
      clinicalMemoryAdapter: {
        understandings: clinicalMemory.understandings.length,
        timelineEvents: clinicalMemory.timelineEvents.length,
        relationships: clinicalMemory.relationships.length,
        semanticMemories: clinicalMemory.semanticMemories.length,
        rawSummaries: clinicalMemory.rawSummaries.length,
        legacyMemories: clinicalMemory.legacyMemories.length,
        rawMemory: clinicalMemory.excluded.rawMemory,
        directRecentMemories: clinicalMemory.excluded.directRecentMemories,
      },
      clinicalLogic: "Rogers dry-run ClinicalPlan receives ClinicalMemoryContext and enters debug trace",
    },
    null,
    2
  )
);
