import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "");

const read = (path: string) => readFileSync(path, "utf8");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  });

const readUnionMembers = (source: string, typeName: string) => {
  const match = source.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
  assert(match, `Missing ${typeName} type definition.`);
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
};

const responseGoalSelector = stripComments(read("services/clinical/responseGoalSelector.ts"));

const usedSignals = Array.from(responseGoalSelector.matchAll(/context\.signals\.([a-zA-Z0-9_]+)/g)).map(
  (match) => match[1]
);
const allowedSignals = new Set(["expressionDifficulty", "explicitAdviceRequest", "semanticEvidence"]);

for (const signal of usedSignals) {
  assert(
    allowedSignals.has(signal),
    `ResponseGoalSelector reads unapproved ClinicalContext signal: ${signal}.`
  );
}

const bannedResponseGoalInputs = [
  "context.conversation.state",
  "relationshipStage",
  "expressionMode",
  "rhythm",
  "presenceMode",
  "continuity",
  "memoryAvailability",
  "emotionalIntensity",
];

for (const bannedInput of bannedResponseGoalInputs) {
  assert(
    !responseGoalSelector.includes(bannedInput),
    `ResponseGoalSelector must not read unapproved input: ${bannedInput}.`
  );
}

assert(
  responseGoalSelector.includes("context.signals.expressionDifficulty"),
  "ResponseGoalSelector must continue to use approved expressionDifficulty signal."
);
assert(
  responseGoalSelector.includes("context.signals.explicitAdviceRequest"),
  "ResponseGoalSelector must continue to use approved explicitAdviceRequest signal."
);
assert(
  responseGoalSelector.includes("context.signals.semanticEvidence.status"),
  "ResponseGoalSelector must use semanticEvidence.status to determine grounded interpretation eligibility."
);

const clinicalFiles = walk("services/clinical");
const legacyClinicalContextAccess =
  /context\.(userTurn|memoryContext|conversationSignals|recentTurns|currentUnderstanding|safetyNotes)\b/;

for (const filePath of clinicalFiles) {
  const source = stripComments(read(filePath));

  assert(!source.includes("@prisma/client"), `${filePath} must not import Prisma models directly.`);
  assert(!source.includes("rawMemoryService"), `${filePath} must not read RawMemory directly.`);
  assert(!source.includes("PrismaClient"), `${filePath} must not instantiate Prisma directly.`);

  if (filePath.endsWith("clinicalContextBuilder.ts")) continue;

  const legacyAccess = source.match(legacyClinicalContextAccess);
  assert(
    !legacyAccess,
    `${filePath} must not read legacy ClinicalContext field ${legacyAccess?.[0]}.`
  );
}

const conversationTypes = read("conversation-os/types.ts");

assert.deepEqual(readUnionMembers(conversationTypes, "EngageMode"), [
  "acknowledge",
  "invite",
  "reflect",
  "stay",
  "clarify",
  "repair",
  "repair_with_invitation",
  "repair_with_low_pressure_exit",
]);

assert.deepEqual(readUnionMembers(conversationTypes, "ExperienceGoal"), [
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

assert.deepEqual(readUnionMembers(conversationTypes, "QuestionPurpose"), [
  "understanding_calibration",
  "experience_exploration",
  "shared_understanding",
  "user_agency",
]);

assert.deepEqual(readUnionMembers(conversationTypes, "QuestionAvoid"), [
  "interrogation",
  "premature_interpretation",
  "privacy_probing",
]);

const aiTypes = read("services/ai/types.ts");
const voiceConstraintsMatch = aiTypes.match(/export type AiVoiceConstraints = \{([\s\S]*?)\};/);
assert(voiceConstraintsMatch, "Missing AiVoiceConstraints type definition.");
const voiceConstraintFields = Array.from(voiceConstraintsMatch[1].matchAll(/^\s{2}([a-zA-Z0-9_]+):/gm)).map(
  (match) => match[1]
);
assert.deepEqual(voiceConstraintFields, [
  "source",
  "styleDirectives",
  "rhythm",
  "prohibitedExpressions",
  "questionDirectives",
]);

const promptBuilder = read("services/ai/promptBuilder.ts");
const legacyPromptBranchLines = promptBuilder
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("\"engageMode="));

assert.deepEqual(
  legacyPromptBranchLines,
  [
    "\"engageMode=acknowledge 时：先承认你注意到了这个输入；如果提问，只能是共同靠近式，不询问“什么意思”。\",",
    "\"engageMode=stay 时：允许停在这里；如果提问，只能给用户选择权，不推进话题。\",",
    "\"engageMode=reflect 时：只贴着用户明确说出的体验反映；如果提问，只能探索体验，不追问原因。\",",
    "\"engageMode=repair 时：先放下刚刚的理解，不辩解，不沿用旧理解。\",",
    "\"engageMode=repair_with_invitation 时：承认刚刚理解偏了，并给用户一个按自己方式纠正你的低压入口。\",",
    "\"engageMode=repair_with_low_pressure_exit 时：允许用户先不说，同时低压收回你可能没接住的部分；不要把它说成关闭对话。\",",
    "\"engageMode=invite 时：更适合主动邀请用户校准；问题必须低压力，允许用户不用解释。\",",
  ],
  "Legacy Conversation OS prompt branches are frozen. Do not add old strategy prompt branches."
);

const productCodeFiles = ["app", "services", "conversation-os", "scripts"]
  .flatMap((root) => walk(root))
  .filter((file) => !file.endsWith("architecture-v1-boundary-check.ts"));

for (const filePath of productCodeFiles) {
  const source = stripComments(read(filePath));
  assert(!/\bProjectionLayer\b/.test(source), `${filePath} must not export or name a ProjectionLayer.`);
}

const architectureFinal = read("docs/ARCHITECTURE_V1_FINAL.md");
const prd = read("docs/PRD_V1.md");
assert(
  architectureFinal.includes("Architecture v1 has exactly five product layers"),
  "ARCHITECTURE_V1_FINAL.md must preserve the five-layer product architecture."
);
assert(
  prd.includes("本文件是 SlowTalk Notes v1 的正式产品与架构需求基准。"),
  "PRD_V1.md must declare itself as the formal SlowTalk Notes v1 baseline."
);

console.log(
  JSON.stringify(
    {
      responseGoalSelectorAllowedSignals: Array.from(new Set(usedSignals)),
      clinicalFilesChecked: clinicalFiles.length,
      frozenLegacy: {
        engageMode: readUnionMembers(conversationTypes, "EngageMode").length,
        experienceGoal: readUnionMembers(conversationTypes, "ExperienceGoal").length,
        questionPurpose: readUnionMembers(conversationTypes, "QuestionPurpose").length,
        questionAvoid: readUnionMembers(conversationTypes, "QuestionAvoid").length,
        voiceConstraintFields: voiceConstraintFields.length,
        legacyPromptBranches: legacyPromptBranchLines.length,
      },
      projectionFramework: "internal_memory_implementation_not_product_layer",
      limitations:
        "This check uses stable source assertions and explicit file whitelists; it can still miss semantically equivalent aliases and may require updates if code is intentionally moved.",
    },
    null,
    2
  )
);
