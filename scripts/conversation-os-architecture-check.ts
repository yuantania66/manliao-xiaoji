import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["app", "services", "conversation-os"];
const ALLOWED_LLM_CALL_FILES = new Set([
  "services/ai/aiService.ts",
  "services/ai/turnInterpretationAdapter.ts",
  "services/helping/hillHelpingDecisionService.ts",
  "services/ai/proactiveGreeting.ts",
  "services/ai/chatSafety.ts",
  "services/ai/interactionMoveHandoffOutputValidator.ts",
  "services/ai/plannedFunctionSemanticValidator.ts",
  "services/ai/purposeSubjectOwnershipAuthority.ts",
  "services/memory/episodeSummaryService.ts",
  "services/understanding/extractService.ts",
  "services/experience/experienceExtractorService.ts",
]);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  });

const files = ROOTS.flatMap((root) => walk(root));
const llmCallFiles = files.filter((file) => readFileSync(file, "utf8").includes("callModel("));

for (const file of llmCallFiles) {
  assert(
    ALLOWED_LLM_CALL_FILES.has(file),
    `Unexpected direct LLM call in ${file}. Every model call requires an explicit architecture owner and bounded role.`
  );
}

const chatSafetyRepeatedCheck = readFileSync("services/ai/chatSafety.ts", "utf8");
assert.equal(
  (chatSafetyRepeatedCheck.match(/callModel\(/g) ?? []).length,
  1,
  "Safety semantic triage may have only one structured provider call site."
);
assert(
  chatSafetyRepeatedCheck.includes("只做判定，不生成回复") &&
    !chatSafetyRepeatedCheck.includes("createResponsePlan(") &&
    !chatSafetyRepeatedCheck.includes("generateChatReply("),
  "Safety semantic triage must remain a non-writer and must not become Planner or Surface."
);

const episodeSummaryServiceRepeatedCheck = readFileSync("services/memory/episodeSummaryService.ts", "utf8");
assert.equal(
  (episodeSummaryServiceRepeatedCheck.match(/callModel\(/g) ?? []).length,
  1,
  "Episode Summary may have only one bounded structured provider call site."
);
assert(
  episodeSummaryServiceRepeatedCheck.includes("committedMessages") &&
    episodeSummaryServiceRepeatedCheck.includes("sourceMessageIds") &&
    !episodeSummaryServiceRepeatedCheck.includes("createResponsePlan(") &&
    !episodeSummaryServiceRepeatedCheck.includes("generateChatReply("),
  "Episode Summary must remain a committed-message memory writer, not Planner or Surface."
);

for (const file of files.filter((file) => file.startsWith("app/api/chat/"))) {
  const content = readFileSync(file, "utf8");
  assert(!content.includes("callModel("), `${file} must not call LLM directly.`);
}

const chatSafety = readFileSync("services/ai/chatSafety.ts", "utf8");
assert.equal(
  (chatSafety.match(/callModel\(/g) ?? []).length,
  1,
  "Safety semantic triage may have only one structured provider call site."
);

const purposeSubjectOwnershipAuthority = readFileSync(
  "services/ai/purposeSubjectOwnershipAuthority.ts",
  "utf8"
);
assert.equal(
  (purposeSubjectOwnershipAuthority.match(/callModel\(/g) ?? []).length,
  1,
  "Purpose Subject-Ownership Authority may have only one bounded structured provider call site."
);
assert(
  purposeSubjectOwnershipAuthority.includes("responseFormat: \"json_object\"") &&
    purposeSubjectOwnershipAuthority.includes("provider_not_authorized") &&
    purposeSubjectOwnershipAuthority.includes("current_user_self") &&
    !purposeSubjectOwnershipAuthority.includes("createResponsePlan(") &&
    !purposeSubjectOwnershipAuthority.includes("generateChatReply("),
  "Purpose Subject-Ownership must remain a strict local/eval authority, not Planner or Surface."
);

const episodeSummaryService = readFileSync("services/memory/episodeSummaryService.ts", "utf8");
assert.equal(
  (episodeSummaryService.match(/callModel\(/g) ?? []).length,
  1,
  "Episode Summary may have only one bounded structured provider call site."
);
assert(
  episodeSummaryService.includes("committedMessages") &&
    episodeSummaryService.includes("sourceMessageIds") &&
    !episodeSummaryService.includes("createResponsePlan(") &&
    !episodeSummaryService.includes("generateChatReply("),
  "Episode Summary must remain a committed-message memory writer, not Planner or Surface."
);
assert(
  chatSafety.includes("只做判定，不生成回复") &&
    !chatSafety.includes("createResponsePlan(") &&
    !chatSafety.includes("generateChatReply("),
  "Safety semantic triage must remain a non-writer and must not become Planner or Surface."
);

const aiService = readFileSync("services/ai/aiService.ts", "utf8");
const callModelIndex = aiService.indexOf("callModel(");

assert(callModelIndex >= 0, "generateChatReply must still delegate language generation to the LLM.");
assert(!aiService.includes("runConversationPipeline("), "Surface Realization must not invoke the legacy Engage decision owner.");
assert(aiService.includes("responsePlan"), "Surface Realization must receive the one finalized ResponsePlan.");

const callModelCount = (aiService.match(/callModel\(/g) ?? []).length;
assert.equal(
  callModelCount,
  1,
  "Normal chat generation must not add extra direct LLM repair/rewrite calls outside the pipeline."
);

const helpingDecisionService = readFileSync("services/helping/hillHelpingDecisionService.ts", "utf8");
assert.equal(
  (helpingDecisionService.match(/callModel\(/g) ?? []).length,
  1,
  "Helping Logic may have only one structured provider call site."
);
assert(
  helpingDecisionService.includes("Output JSON only") &&
    helpingDecisionService.includes("never write final chat copy"),
  "Helping Logic provider must be constrained to a structured domain decision, not final copy."
);

const handoffValidator = readFileSync("services/ai/interactionMoveHandoffOutputValidator.ts", "utf8");
const plannedFunctionValidator = readFileSync("services/ai/plannedFunctionSemanticValidator.ts", "utf8");
assert.equal(
  (plannedFunctionValidator.match(/callModel\(/g) ?? []).length,
  1,
  "Planned Function Semantic Validation may have only one structured provider call site."
);
assert(
  plannedFunctionValidator.includes("same-plan semantic verifier") &&
    plannedFunctionValidator.includes("not a response writer") &&
    plannedFunctionValidator.includes("provider_failure") &&
    plannedFunctionValidator.includes("malformed_verdict") &&
    plannedFunctionValidator.includes("binding_mismatch") &&
    plannedFunctionValidator.includes("uncertain"),
  "Planned-function validation must remain an explicit same-plan, non-writer, fail-closed hard verifier with advisory quality findings."
);
assert(
  !plannedFunctionValidator.includes("createResponsePlan(") &&
    !plannedFunctionValidator.includes("generateChatReply("),
  "Planned-function validation must not become a second Planner or Surface."
);
assert(
  plannedFunctionValidator.indexOf("inspectPromptBeforeExternalCall(") < plannedFunctionValidator.indexOf("callModel("),
  "Planned-function validation must inspect its structured prompt before its external model call."
);
assert.equal((handoffValidator.match(/callModel\(/g) ?? []).length, 0,
  "Legacy handoff validation adapter must delegate to the canonical planned-function provider.");

const chatOrchestration = readFileSync("services/ai/chatOrchestrationService.ts", "utf8");
assert.equal(
  (chatOrchestration.match(/createResponsePlan\(/g) ?? []).length,
  1,
  "The normal chat pipeline must retain exactly one Response Planner call site."
);
assert(
  !helpingDecisionService.includes("createResponsePlan(") &&
    !helpingDecisionService.includes("generateChatReply("),
  "Helping Logic must not become a second final Planner or Surface."
);

const promptBuilder = readFileSync("services/ai/promptBuilder.ts", "utf8");
assert(
  promptBuilder.includes("Conversation OS ResponsePlan"),
  "LLM prompt composition must receive the single Conversation OS ResponsePlan."
);

const conversationTypes = readFileSync("conversation-os/types.ts", "utf8");
const aiTypes = readFileSync("services/ai/types.ts", "utf8");

const readUnionMembers = (source: string, typeName: string) => {
  const match = source.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
  assert(match, `Missing ${typeName} type definition.`);
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
};

const assertFrozenUnion = (typeName: string, expected: string[]) => {
  assert.deepEqual(
    readUnionMembers(conversationTypes, typeName),
    expected,
    `${typeName} is legacy/frozen/do not extend. Production response strategy must use ResponsePlan.`
  );
};

assertFrozenUnion("EngageMode", [
  "acknowledge",
  "invite",
  "reflect",
  "stay",
  "clarify",
  "repair",
  "repair_with_invitation",
  "repair_with_low_pressure_exit",
]);

assertFrozenUnion("ExperienceGoal", [
  "feel_seen",
  "feel_accepted",
  "feel_not_pressured",
  "feel_misunderstanding_repaired",
  "feel_safe_to_correct_ai",
  "feel_less_alone",
  "feel_allowed_to_pause",
  "feel_gently_invited",
  "feel_grounded",
  "feel_understanding_can_continue",
]);

assertFrozenUnion("QuestionPurpose", [
  "understanding_calibration",
  "experience_exploration",
  "shared_understanding",
  "user_agency",
]);

assertFrozenUnion("QuestionAvoid", ["interrogation", "premature_interpretation", "privacy_probing"]);

const voiceConstraintsMatch = aiTypes.match(/export type AiVoiceConstraints = \{([\s\S]*?)\};/);
assert(voiceConstraintsMatch, "Missing AiVoiceConstraints type definition.");
const voiceConstraintFields = Array.from(voiceConstraintsMatch[1].matchAll(/^\s{2}([a-zA-Z0-9_]+):/gm)).map(
  (item) => item[1]
);
assert.deepEqual(
  voiceConstraintFields,
  ["source", "styleDirectives", "rhythm", "prohibitedExpressions", "questionDirectives"],
  "AiVoiceConstraints is legacy/frozen/do not extend. Production response strategy must use ResponsePlan."
);
assert(
  voiceConstraintsMatch[1].includes('source: "voice_layer_v1"'),
  "AiVoiceConstraints source must remain voice_layer_v1 for legacy compatibility."
);

console.log(
  JSON.stringify(
    {
      llmCallFiles,
      normalChatPipeline: "SafetyGate -> ContextAssembly -> TurnInterpretation -> DialogueState -> HelpingLogicShadow -> ResponsePlanner -> SurfaceRealization -> OutputValidation -> StateUpdate",
      frozenLegacyStrategyFields: {
        engageMode: readUnionMembers(conversationTypes, "EngageMode").length,
        experienceGoal: readUnionMembers(conversationTypes, "ExperienceGoal").length,
        questionPurpose: readUnionMembers(conversationTypes, "QuestionPurpose").length,
        questionAvoid: readUnionMembers(conversationTypes, "QuestionAvoid").length,
        voiceConstraintFields: voiceConstraintFields.length,
      },
    },
    null,
    2
  )
);
