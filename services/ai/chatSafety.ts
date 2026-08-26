import {
  callModel,
  getAiProvider,
  getDefaultAiModel,
  isAiProviderConfigured,
} from "./modelProvider";
import type { AiConversationMessage, AiGenerationResult, AiModelMessage } from "./types";

export const SAFETY_PROMPT_VERSION = "safety-semantic-triage-v2";
export const SAFETY_SCHEMA_VERSION = 1 as const;

export type SafetyRiskLevel = "none" | "concern" | "imminent";
export type SafetyCategory =
  | "self_harm"
  | "suicide"
  | "harm_to_others"
  | "overdose"
  | "domestic_violence"
  | "immediate_physical_danger";
export type SafetyCurrentness = "current" | "past" | "quoted" | "hypothetical" | "uncertain";

export type SafetyEvidenceSpan = {
  text: string;
  start: number;
  end: number;
};

export type SafetyTriageDecision = {
  schemaVersion: typeof SAFETY_SCHEMA_VERSION;
  riskLevel: SafetyRiskLevel;
  categories: SafetyCategory[];
  currentness: SafetyCurrentness;
  evidence: SafetyEvidenceSpan[];
  requiresSafetyResponse: boolean;
};

export type SafetySemanticProviderInput = {
  messages: AiModelMessage[];
  attempt: 1 | 2;
  previousFailure: string | null;
};

export type SafetySemanticProviderResult = {
  text: string;
  model: string;
  latencyMs: number;
};

export type SafetySemanticProvider = (
  input: SafetySemanticProviderInput
) => Promise<SafetySemanticProviderResult | string>;

export type SafetyTriageResult =
  | {
      status: "decided";
      channel: "deterministic" | "semantic" | "local_fixture_only";
      decision: SafetyTriageDecision;
      model: string;
      attempts: number;
    }
  | {
      status: "blocked";
      channel: "semantic";
      failureType: "provider_error" | "provider_unconfigured" | "invalid_output";
      reason: string;
      attempts: 0 | 2;
    };

const SAFETY_CATEGORIES = new Set<SafetyCategory>([
  "self_harm",
  "suicide",
  "harm_to_others",
  "overdose",
  "domestic_violence",
  "immediate_physical_danger",
]);
const RISK_LEVELS = new Set<SafetyRiskLevel>(["none", "concern", "imminent"]);
const CURRENTNESS_VALUES = new Set<SafetyCurrentness>([
  "current",
  "past",
  "quoted",
  "hypothetical",
  "uncertain",
]);

const normalizeForImminentRecall = (inputText: string) =>
  inputText
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLowerCase();

const hasOwnershipAffectingMarker = (inputText: string) =>
  /[\p{P}\p{S}]/u.test(inputText.trim().replace(/[。.!！?？]+$/u, ""));

const SELF_HARM_IMMINENT_PATTERN =
  /^我(?:已经|正在)(?:割腕|伤害自己)(?:了)?$/u;
const OVERDOSE_IMMINENT_PATTERN =
  /^(?:我(?:已经|刚刚|正在)(?:把)?(?:这些|所有|全部)?药(?:都|全)?(?:吃|吞)(?:了|下去)|我(?:已经|刚刚)(?:吃|吞)了(?:很多|大量|过量)药|药我已经全吃下去了)$/u;
const OTHER_HARM_IMMINENT_PATTERN =
  /^我(?:已经|正在)(?:砍|捅|伤害)(?:了)?(?:他|她|人)$/u;
const PHYSICAL_DANGER_IMMINENT_PATTERN =
  /^(?:(?:他|她).{0,8}(?:拿着|带着)(?:刀|枪).{0,16}(?:我出不去|要杀我|要伤害我)|我(?:正在|现在)(?:被打|被家暴)|我已经(?:受伤|流血))$/u;
const createWholeMessageEvidence = (inputText: string): SafetyEvidenceSpan[] =>
  inputText.length > 0 ? [{ text: inputText, start: 0, end: inputText.length }] : [];

export const getDeterministicImminentDecision = (
  inputText: string
): SafetyTriageDecision | null => {
  if (hasOwnershipAffectingMarker(inputText)) return null;
  const normalized = normalizeForImminentRecall(inputText);
  const categories: SafetyCategory[] = [];
  if (OVERDOSE_IMMINENT_PATTERN.test(normalized)) categories.push("overdose", "self_harm");
  if (SELF_HARM_IMMINENT_PATTERN.test(normalized)) categories.push("suicide", "self_harm");
  if (OTHER_HARM_IMMINENT_PATTERN.test(normalized)) categories.push("harm_to_others");
  if (PHYSICAL_DANGER_IMMINENT_PATTERN.test(normalized)) {
    categories.push("immediate_physical_danger");
    if (/(?:被打|被家暴)/u.test(normalized)) categories.push("domestic_violence");
  }
  const uniqueCategories = Array.from(new Set(categories));
  if (uniqueCategories.length === 0) return null;
  return {
    schemaVersion: SAFETY_SCHEMA_VERSION,
    riskLevel: "imminent",
    categories: uniqueCategories,
    currentness: "current",
    evidence: createWholeMessageEvidence(inputText),
    requiresSafetyResponse: true,
  };
};

/** Compatibility name: this is now only the normalized, narrow imminent fast path. */
export const isCrisisInput = (inputText: string) =>
  getDeterministicImminentDecision(inputText) !== null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const failParse = (reason: string): never => {
  throw new Error(`invalid_safety_triage:${reason}`);
};

export const parseSafetyTriageDecision = (
  rawOutput: string,
  currentUserMessage: string
): SafetyTriageDecision => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return failParse("invalid_json");
  }
  if (!isRecord(parsed)) return failParse("root_not_object");
  if (!hasExactKeys(parsed, [
    "schemaVersion",
    "riskLevel",
    "categories",
    "currentness",
    "evidence",
    "requiresSafetyResponse",
  ])) return failParse("root_keys");
  if (parsed.schemaVersion !== SAFETY_SCHEMA_VERSION) return failParse("schema_version");
  if (typeof parsed.riskLevel !== "string" || !RISK_LEVELS.has(parsed.riskLevel as SafetyRiskLevel)) {
    return failParse("risk_level");
  }
  if (typeof parsed.currentness !== "string" || !CURRENTNESS_VALUES.has(parsed.currentness as SafetyCurrentness)) {
    return failParse("currentness");
  }
  if (typeof parsed.requiresSafetyResponse !== "boolean") return failParse("requires_safety_response");
  if (!Array.isArray(parsed.categories)) return failParse("categories_not_array");
  const categories = parsed.categories.map((category) => {
    if (typeof category !== "string" || !SAFETY_CATEGORIES.has(category as SafetyCategory)) {
      return failParse("category");
    }
    return category as SafetyCategory;
  });
  if (new Set(categories).size !== categories.length) return failParse("duplicate_category");
  if (!Array.isArray(parsed.evidence)) return failParse("evidence_not_array");
  const evidence = parsed.evidence.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, ["text"])) {
      return failParse("evidence_keys");
    }
    if (typeof item.text !== "string" || item.text.length === 0) {
      return failParse("evidence_text");
    }
    const start = currentUserMessage.indexOf(item.text);
    if (start < 0) return failParse("evidence_span");
    if (currentUserMessage.indexOf(item.text, start + 1) >= 0) {
      return failParse("evidence_not_unique");
    }
    const end = start + item.text.length;
    return { text: item.text, start, end };
  });
  if (new Set(evidence.map((item) => item.text)).size !== evidence.length) {
    return failParse("duplicate_evidence");
  }
  const riskLevel = parsed.riskLevel as SafetyRiskLevel;
  const currentness = parsed.currentness as SafetyCurrentness;
  const requiresSafetyResponse = parsed.requiresSafetyResponse;
  if (riskLevel === "none") {
    if (requiresSafetyResponse || categories.length > 0 || evidence.length > 0) {
      return failParse("none_inconsistent");
    }
  } else if (!requiresSafetyResponse || categories.length === 0 || evidence.length === 0) {
    return failParse("risk_inconsistent");
  }
  if (currentness === "uncertain" && !requiresSafetyResponse) {
    return failParse("uncertain_must_route_safety");
  }
  if (
    requiresSafetyResponse &&
    currentness !== "current" &&
    currentness !== "uncertain"
  ) return failParse("noncurrent_must_not_route_safety");
  return {
    schemaVersion: SAFETY_SCHEMA_VERSION,
    riskLevel,
    categories,
    currentness,
    evidence,
    requiresSafetyResponse,
  };
};

const buildSafetyMessages = ({
  currentUserMessage,
  recentMessages,
  previousFailure,
}: {
  currentUserMessage: string;
  recentMessages: AiConversationMessage[];
  previousFailure: string | null;
}): AiModelMessage[] => {
  const adjacentContext = recentMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-2)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const repairInstruction = previousFailure
    ? `\n上一次输出违反合同（${previousFailure}）。只修正结构，不改变对同一输入的风险判断。`
    : "";
  return [
    {
      role: "developer",
      content: `你是聊天入口的 Safety 风险分诊器，只做判定，不生成回复。输出必须是单个 JSON object，不得有 Markdown、解释或额外字段。\nexact schema: {"schemaVersion":1,"riskLevel":"none|concern|imminent","categories":["self_harm|suicide|harm_to_others|overdose|domestic_violence|immediate_physical_danger"],"currentness":"current|past|quoted|hypothetical|uncertain","evidence":[{"text":"当前用户消息中的唯一原文片段"}],"requiresSafetyResponse":true}\nevidence 每项只能有 text，必须逐字引用当前用户消息中只出现一次的非空原文片段；不要输出索引。\n只评估当前用户本人的现实风险；明确归属于朋友、访谈对象、作品角色或其他第三方的危险表达属于 quoted，不得当作当前用户风险。仅有引文或括注而无法确认主体时不得假定安全，应使用 uncertain 并路由 Safety。riskLevel=none 时 categories 与 evidence 必须为空且 requiresSafetyResponse=false；currentness 仍按风险内容的实际语境选择 current、past、quoted 或 hypothetical。concern/imminent 必须至少有一个 category 和 evidence，且 requiresSafetyResponse=true。无法可靠排除当前现实危险时使用 currentness=uncertain、riskLevel=concern、requiresSafetyResponse=true。纯引用、假设、明确过去且现在安全、明确否定且没有混合当前危险时输出 none。新闻/电影/否定词不能覆盖同一句中后续出现的当前危险。${repairInstruction}`,
    },
    {
      role: "user",
      content: `相邻已提交上下文：\n${adjacentContext || "（无）"}\n\n当前用户消息：\n${currentUserMessage}`,
    },
  ];
};

const defaultSafetySemanticProvider: SafetySemanticProvider = async ({ messages }) => {
  const model = process.env.AI_SAFETY_MODEL?.trim() ||
    process.env.AI_MAIN_MODEL?.trim() ||
    getDefaultAiModel();
  const response = await callModel({
    messages,
    model,
    temperature: 0,
    responseFormat: "json_object",
  });
  return { text: response.text, model: response.model, latencyMs: response.latencyMs };
};

const toProviderResult = (
  result: SafetySemanticProviderResult | string
): SafetySemanticProviderResult => typeof result === "string"
  ? { text: result, model: "injected-safety-provider", latencyMs: 0 }
  : result;

const noRiskDecision = (): SafetyTriageDecision => ({
  schemaVersion: SAFETY_SCHEMA_VERSION,
  riskLevel: "none",
  categories: [],
  currentness: "current",
  evidence: [],
  requiresSafetyResponse: false,
});

export const triageSafety = async ({
  currentUserMessage,
  recentMessages,
  provider,
}: {
  currentUserMessage: string;
  recentMessages: AiConversationMessage[];
  provider?: SafetySemanticProvider;
}): Promise<SafetyTriageResult> => {
  const deterministic = getDeterministicImminentDecision(currentUserMessage);
  if (deterministic) {
    return {
      status: "decided",
      channel: "deterministic",
      decision: deterministic,
      model: "safety-deterministic",
      attempts: 0,
    };
  }
  const providerEnvConfigured = Boolean(process.env.AI_PROVIDER?.trim());
  const configuredDefault = getAiProvider() === "qwen" && isAiProviderConfigured();
  const explicitLocalFixtureContext = process.env.NODE_ENV === "test" ||
    process.env.npm_lifecycle_event?.startsWith("check:") === true;
  const localFixtureOnly = explicitLocalFixtureContext && !providerEnvConfigured;
  if (!provider && !configuredDefault && localFixtureOnly) {
    return {
      status: "decided",
      channel: "local_fixture_only",
      decision: noRiskDecision(),
      model: "local-fixture-no-semantic-provider",
      attempts: 0,
    };
  }
  if (!provider && !configuredDefault) {
    return {
      status: "blocked",
      channel: "semantic",
      failureType: "provider_unconfigured",
      reason: "safety_semantic_provider_unconfigured",
      attempts: 0,
    };
  }
  const selectedProvider = provider ?? defaultSafetySemanticProvider;
  let previousFailure: string | null = null;
  let lastFailureType: "provider_error" | "invalid_output" = "provider_error";
  for (const attempt of [1, 2] as const) {
    try {
      const result = toProviderResult(await selectedProvider({
        messages: buildSafetyMessages({ currentUserMessage, recentMessages, previousFailure }),
        attempt,
        previousFailure,
      }));
      try {
        const decision = parseSafetyTriageDecision(result.text, currentUserMessage);
        return {
          status: "decided",
          channel: "semantic",
          decision,
          model: result.model,
          attempts: attempt,
        };
      } catch (error) {
        lastFailureType = "invalid_output";
        previousFailure = error instanceof Error ? error.message : "invalid_safety_triage";
      }
    } catch (error) {
      lastFailureType = "provider_error";
      previousFailure = error instanceof Error ? error.message : "safety_provider_error";
    }
  }
  return {
    status: "blocked",
    channel: "semantic",
    failureType: lastFailureType,
    reason: previousFailure ?? "safety_triage_failed",
    attempts: 2,
  };
};

export function createSafetyGeneration(decision: SafetyTriageDecision): AiGenerationResult;
/** @deprecated Pass the validated SafetyTriageDecision from triageSafety. */
export function createSafetyGeneration(inputText: string): AiGenerationResult;
export function createSafetyGeneration(
  decisionOrInput: SafetyTriageDecision | string
): AiGenerationResult {
  const decision = typeof decisionOrInput === "string"
    ? getDeterministicImminentDecision(decisionOrInput) ?? {
        schemaVersion: SAFETY_SCHEMA_VERSION,
        riskLevel: "concern",
        categories: ["self_harm"],
        currentness: "uncertain",
        evidence: createWholeMessageEvidence(decisionOrInput),
        requiresSafetyResponse: true,
      }
    : decisionOrInput;
  const categories = new Set(decision.categories);
  const empathy = "我很担心你现在的安全。先别一个人扛，我们现在只做下一步。";
  const hasImmediateSelfHarm = categories.has("overdose") ||
    categories.has("self_harm") && decision.riskLevel === "imminent";
  const hasOtherDanger = categories.has("harm_to_others") ||
    categories.has("domestic_violence") ||
    categories.has("immediate_physical_danger");
  let action: string;
  if (hasImmediateSelfHarm && hasOtherDanger) {
    action = "如果你在中国大陆，现在就拨打 120（医疗急救），同时拨打 110（人身安全/报警），或让身边的人代拨。如果手里有刀、药物或其他危险物品，先放下并远离；如果能安全离开，马上离开危险现场，去可信任的人能看到的地方，不要独处。";
  } else if (hasImmediateSelfHarm) {
    action = "如果你在中国大陆，现在就拨打 120（医疗急救），或让身边的人代拨。先不要独处，去可信任的人能看到你的地方，远离可能继续伤害你的物品，并听从 120 调度人员指引。12356（心理援助）可以提供同步或后续支持，但不能替代急救。";
  } else if (hasOtherDanger) {
    action = "如果你在中国大陆，先去更安全、有人在的地方，立即拨打 110（人身安全/报警）；如果已经受伤或有医疗危险，同时拨打 120（医疗急救）。尽量远离武器或其他可能造成伤害的物品。";
  } else {
    action = "你现在有没有已经动手，或身边有没有准备好的工具、药物？如果你在中国大陆，请现在拨打 12356（心理援助），并联系一个能来到你身边的可信任的人；如果已经开始、无法保证眼前安全，立即拨打 120（医疗急救）或 110（人身安全/报警）。";
  }
  return {
    text: `${empathy}${action}`,
    model: "safety-gate",
    promptVersion: SAFETY_PROMPT_VERSION,
    latencyMs: 0,
    postProcessSteps: [],
    finalReplySource: "safety",
    raw: {
      riskLevel: decision.riskLevel,
      categories: decision.categories,
      currentness: decision.currentness,
      requiresSafetyResponse: decision.requiresSafetyResponse,
    },
  };
}
