import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["app", "services", "conversation-os"];
const ALLOWED_LLM_CALL_FILES = new Set([
  "services/ai/aiService.ts",
  "services/ai/proactiveGreeting.ts",
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
    `Unexpected direct LLM call in ${file}. Normal chat replies must go through conversation-os pipeline.`
  );
}

for (const file of files.filter((file) => file.startsWith("app/api/chat/"))) {
  const content = readFileSync(file, "utf8");
  assert(!content.includes("callModel("), `${file} must not call LLM directly.`);
}

const aiService = readFileSync("services/ai/aiService.ts", "utf8");
const pipelineIndex = aiService.indexOf("runConversationPipeline(");
const callModelIndex = aiService.indexOf("callModel(");

assert(pipelineIndex >= 0, "generateChatReply must invoke runConversationPipeline().");
assert(callModelIndex >= 0, "generateChatReply must still delegate language generation to the LLM.");
assert(
  pipelineIndex < callModelIndex,
  "runConversationPipeline() must wrap the normal chat LLM call."
);

const callModelCount = (aiService.match(/callModel\(/g) ?? []).length;
assert.equal(
  callModelCount,
  1,
  "Normal chat generation must not add extra direct LLM repair/rewrite calls outside the pipeline."
);

const promptBuilder = readFileSync("services/ai/promptBuilder.ts", "utf8");
assert(
  promptBuilder.includes("Conversation OS Context"),
  "LLM prompt composition must receive Conversation OS context."
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
    `${typeName} is legacy/frozen/do not extend. Future response strategy must use ClinicalPlan.`
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
  "AiVoiceConstraints is legacy/frozen/do not extend. Future response strategy must use ClinicalPlan."
);
assert(
  voiceConstraintsMatch[1].includes('source: "voice_layer_v1"'),
  "AiVoiceConstraints source must remain voice_layer_v1 for legacy compatibility."
);

console.log(
  JSON.stringify(
    {
      llmCallFiles,
      normalChatPipeline: "runConversationPipeline -> callModel",
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
