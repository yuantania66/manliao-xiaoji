import assert from "node:assert/strict";

import {
  SAFETY_SCHEMA_VERSION,
  createSafetyGeneration,
  getDeterministicImminentDecision,
  parseSafetyTriageDecision,
  triageSafety,
  type SafetyCategory,
  type SafetyTriageDecision,
} from "../services/ai/chatSafety";

const evidenceFor = (message: string, text: string) => {
  const start = message.indexOf(text);
  assert.notEqual(start, -1, `Missing evidence text ${text} in test message`);
  assert.equal(message.indexOf(text, start + 1), -1, `Evidence text must be unique: ${text}`);
  return { text };
};

const encodedDecision = ({
  message,
  riskLevel = "concern",
  categories,
  currentness = "current",
  evidenceText,
  requiresSafetyResponse = true,
}: {
  message: string;
  riskLevel?: SafetyTriageDecision["riskLevel"];
  categories: SafetyCategory[];
  currentness?: SafetyTriageDecision["currentness"];
  evidenceText: string;
  requiresSafetyResponse?: boolean;
}) => JSON.stringify({
  schemaVersion: SAFETY_SCHEMA_VERSION,
  riskLevel,
  categories,
  currentness,
  evidence: evidenceText ? [evidenceFor(message, evidenceText)] : [],
  requiresSafetyResponse,
});

for (const message of [
  "我想自\n杀",
  "我想自 杀",
  "我想自\u200B杀",
  "我想自，杀",
  "我想自／杀",
  "我想自　杀",
] as const) {
  assert.equal(
    getDeterministicImminentDecision(message),
    null,
    `Intent language must defer to semantic triage: ${JSON.stringify(message)}`
  );
}
assert.equal(getDeterministicImminentDecision("我准备杀了他。"), null);
assert(getDeterministicImminentDecision("我已经吃了很多药。")?.categories.includes("overdose"));
assert(getDeterministicImminentDecision("我正在割腕。")?.categories.includes("self_harm"));
assert(getDeterministicImminentDecision("我正在伤害他。")?.categories.includes("harm_to_others"));
assert.equal(getDeterministicImminentDecision("电影里有杀人情节。"), null);
assert.equal(getDeterministicImminentDecision("我不会伤害自己。"), null);
const explicitThirdPartyCases = [
  "电影台词是“我想自杀”，这句该怎么理解？",
  "新闻原文写着“我已经吃了很多药”，我在核对这句话。",
  "朋友刚对我说“我想自杀”",
  "研究访谈对象说我想自杀",
  "“我正在割腕”，这是小说台词",
  "我已经吃了很多药——这是研究访谈对象的原话",
  "我正在伤害他，是小说人物的独白",
] as const;
const ambiguousOwnershipCases = [
  "“我正在割腕”",
  "『我已经吃了很多药』",
  '"我正在伤害他"',
  "（我已经流血）",
  "「我正在割腕」。",
  "“我正在割腕",
  "我正在割腕”",
  "> 我正在割腕",
  "｜我正在割腕｜",
  "`我正在割腕`",
  "```我正在割腕```",
  "｢我正在割腕｣",
  "﹁我正在割腕﹂",
  "❝我正在割腕❞",
] as const;
for (const message of [...explicitThirdPartyCases, ...ambiguousOwnershipCases]) {
  assert.equal(
    getDeterministicImminentDecision(message),
    null,
    `Quoted/media context must defer to semantic triage: ${message}`
  );
}
const mixedQuotedCurrentRisk = "新闻里看到有人自杀，但我现在也想自杀。";
assert.equal(getDeterministicImminentDecision(mixedQuotedCurrentRisk), null);

const currentMessage = "新闻里看到有人自杀，但我现在也想这么做";
const validRisk = encodedDecision({
  message: currentMessage,
  categories: ["suicide", "self_harm"],
  evidenceText: "我现在也想这么做",
});
const parsed = parseSafetyTriageDecision(validRisk, currentMessage);
assert.equal(parsed.requiresSafetyResponse, true);
assert.deepEqual(parsed.categories, ["suicide", "self_harm"]);
assert.deepEqual(parsed.evidence, [{
  text: "我现在也想这么做",
  start: currentMessage.indexOf("我现在也想这么做"),
  end: currentMessage.indexOf("我现在也想这么做") + "我现在也想这么做".length,
}]);

const validNone = JSON.stringify({
  schemaVersion: SAFETY_SCHEMA_VERSION,
  riskLevel: "none",
  categories: [],
  currentness: "quoted",
  evidence: [],
  requiresSafetyResponse: false,
});
assert.equal(parseSafetyTriageDecision(validNone, "电影里有自杀情节").riskLevel, "none");

const missingEvidence = Object.fromEntries(
  Object.entries(JSON.parse(validRisk) as Record<string, unknown>)
    .filter(([key]) => key !== "evidence")
);

const invalidOutputs = [
  `\`\`\`json\n${validRisk}\n\`\`\``,
  `判定：${validRisk}`,
  JSON.stringify({ ...JSON.parse(validRisk), extra: true }),
  JSON.stringify(missingEvidence),
  JSON.stringify({ ...JSON.parse(validRisk), riskLevel: "critical" }),
  JSON.stringify({
    ...JSON.parse(validRisk),
    evidence: [{ text: "伪造片段" }],
  }),
  JSON.stringify({
    ...JSON.parse(validRisk),
    evidence: [{ text: "我现在也想这么做", start: 10 }],
  }),
  JSON.stringify({
    ...JSON.parse(validRisk),
    currentness: "uncertain",
    riskLevel: "none",
    categories: [],
    evidence: [],
    requiresSafetyResponse: false,
  }),
];
for (const output of invalidOutputs) {
  assert.throws(() => parseSafetyTriageDecision(output, currentMessage), /invalid_safety_triage/);
}
assert.throws(
  () => parseSafetyTriageDecision(JSON.stringify({
    schemaVersion: SAFETY_SCHEMA_VERSION,
    riskLevel: "concern",
    categories: ["immediate_physical_danger"],
    currentness: "current",
    evidence: [{ text: "危险" }],
    requiresSafetyResponse: true,
  }), "危险危险"),
  /invalid_safety_triage:evidence_not_unique/
);

const main = async () => {
for (const message of explicitThirdPartyCases) {
  const quoted = await triageSafety({
    currentUserMessage: message,
    recentMessages: [],
    provider: async () => validNone,
  });
  assert.equal(quoted.status, "decided");
  assert.equal(quoted.channel, "semantic");
  if (quoted.status === "decided") assert.equal(quoted.decision.requiresSafetyResponse, false);
}
for (const message of ambiguousOwnershipCases) {
  const ambiguous = await triageSafety({
    currentUserMessage: message,
    recentMessages: [],
    provider: async () => encodedDecision({
      message,
      categories: ["self_harm"],
      currentness: "uncertain",
      evidenceText: message,
    }),
  });
  assert.equal(ambiguous.status, "decided");
  assert.equal(ambiguous.channel, "semantic");
  if (ambiguous.status === "decided") assert.equal(ambiguous.decision.requiresSafetyResponse, true);
}
const mixedEvidenceText = "我现在也想自杀";
const mixed = await triageSafety({
  currentUserMessage: mixedQuotedCurrentRisk,
  recentMessages: [],
  provider: async () => encodedDecision({
    message: mixedQuotedCurrentRisk,
    categories: ["suicide", "self_harm"],
    evidenceText: mixedEvidenceText,
  }),
});
assert.equal(mixed.status, "decided");
assert.equal(mixed.channel, "semantic");
if (mixed.status === "decided") assert.equal(mixed.decision.requiresSafetyResponse, true);

const repairedAttempts: number[] = [];
const repaired = await triageSafety({
  currentUserMessage: currentMessage,
  recentMessages: [],
  provider: async ({ attempt, previousFailure, messages }) => {
    repairedAttempts.push(attempt);
    assert(messages[0]?.content.includes("exact schema"));
    if (attempt === 1) return "not-json";
    assert(previousFailure?.includes("invalid_json"));
    return validRisk;
  },
});
assert.equal(repaired.status, "decided");
assert.equal(repaired.channel, "semantic");
assert.equal(repaired.attempts, 2);
assert.deepEqual(repairedAttempts, [1, 2]);
if (repaired.status === "decided") assert.equal(repaired.decision.requiresSafetyResponse, true);

let malformedAttempts = 0;
const malformed = await triageSafety({
  currentUserMessage: "我只是想聊聊今天的天气",
  recentMessages: [],
  provider: async () => {
    malformedAttempts += 1;
    return "{}";
  },
});
assert.equal(malformed.status, "blocked");
assert.equal(malformed.failureType, "invalid_output");
assert.equal(malformed.attempts, 2);
assert.equal(malformedAttempts, 2);

let exceptionAttempts = 0;
const providerFailure = await triageSafety({
  currentUserMessage: "我只是想聊聊今天的天气",
  recentMessages: [],
  provider: async () => {
    exceptionAttempts += 1;
    throw new Error("private provider detail");
  },
});
assert.equal(providerFailure.status, "blocked");
assert.equal(providerFailure.failureType, "provider_error");
assert.equal(providerFailure.attempts, 2);
assert.equal(exceptionAttempts, 2);

const environmentKeys = [
  "NODE_ENV",
  "AI_PROVIDER",
  "QWEN_API_KEY",
  "DASHSCOPE_API_KEY",
  "npm_lifecycle_event",
] as const;
const savedEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]])
) as Record<(typeof environmentKeys)[number], string | undefined>;
const setEnvironment = (key: (typeof environmentKeys)[number], value: string | undefined) => {
  if (value === undefined) Reflect.deleteProperty(process.env, key);
  else Reflect.set(process.env, key, value);
};
try {
  setEnvironment("NODE_ENV", "development");
  setEnvironment("npm_lifecycle_event", undefined);
  setEnvironment("AI_PROVIDER", undefined);
  setEnvironment("QWEN_API_KEY", undefined);
  setEnvironment("DASHSCOPE_API_KEY", undefined);
  const developmentUnconfigured = await triageSafety({
    currentUserMessage: "我只是想聊聊今天的天气",
    recentMessages: [],
  });
  assert.equal(developmentUnconfigured.status, "blocked");
  if (developmentUnconfigured.status === "blocked") {
    assert.equal(developmentUnconfigured.failureType, "provider_unconfigured");
  }

  setEnvironment("NODE_ENV", "test");
  setEnvironment("npm_lifecycle_event", undefined);
  setEnvironment("AI_PROVIDER", undefined);
  setEnvironment("QWEN_API_KEY", undefined);
  setEnvironment("DASHSCOPE_API_KEY", undefined);
  const localFixtureOnly = await triageSafety({
    currentUserMessage: "我只是想聊聊今天的天气",
    recentMessages: [],
  });
  assert.equal(localFixtureOnly.status, "decided");
  assert.equal(localFixtureOnly.channel, "local_fixture_only");

  setEnvironment("NODE_ENV", "production");
  const productionUnconfigured = await triageSafety({
    currentUserMessage: "我只是想聊聊今天的天气",
    recentMessages: [],
  });
  assert.equal(productionUnconfigured.status, "blocked");
  if (productionUnconfigured.status === "blocked") {
    assert.equal(productionUnconfigured.failureType, "provider_unconfigured");
  }

  setEnvironment("NODE_ENV", "test");
  setEnvironment("AI_PROVIDER", "qwen");
  const explicitQwenUnconfigured = await triageSafety({
    currentUserMessage: "我只是想聊聊今天的天气",
    recentMessages: [],
  });
  assert.equal(explicitQwenUnconfigured.status, "blocked");
  if (explicitQwenUnconfigured.status === "blocked") {
    assert.equal(explicitQwenUnconfigured.failureType, "provider_unconfigured");
  }
} finally {
  for (const key of environmentKeys) {
    setEnvironment(key, savedEnvironment[key]);
  }
}

const responseDecision = (categories: SafetyCategory[], riskLevel: SafetyTriageDecision["riskLevel"] = "concern") => ({
  schemaVersion: SAFETY_SCHEMA_VERSION,
  riskLevel,
  categories,
  currentness: "current" as const,
  evidence: [{ text: "风险", start: 0, end: 2 }],
  requiresSafetyResponse: true,
});
const overdoseReply = createSafetyGeneration(responseDecision(["overdose", "self_harm"], "imminent")).text;
assert(overdoseReply.startsWith("我很担心你现在的安全"));
assert(overdoseReply.includes("120（医疗急救）"));
assert(overdoseReply.includes("12356（心理援助）"));
const violenceReply = createSafetyGeneration(responseDecision(["domestic_violence", "immediate_physical_danger"], "imminent")).text;
assert(violenceReply.startsWith("我很担心你现在的安全"));
assert(violenceReply.includes("110（人身安全/报警）"));
assert(violenceReply.includes("120（医疗急救）"));
const ideationReply = createSafetyGeneration(responseDecision(["suicide", "self_harm"])).text;
assert(ideationReply.startsWith("我很担心你现在的安全"));
assert(ideationReply.includes("12356（心理援助）"));
assert(ideationReply.includes("120（医疗急救）"));
assert(ideationReply.includes("110（人身安全/报警）"));
const mixedDangerReply = createSafetyGeneration(responseDecision([
  "self_harm",
  "harm_to_others",
  "immediate_physical_danger",
], "imminent")).text;
assert(mixedDangerReply.includes("120（医疗急救）"));
assert(mixedDangerReply.includes("110（人身安全/报警）"));
assert(mixedDangerReply.includes("放下"));
assert(mixedDangerReply.includes("离开"));

console.log("Chat Safety semantic checks passed");
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
