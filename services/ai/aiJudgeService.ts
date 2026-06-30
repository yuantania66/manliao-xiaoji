import { AppError } from "@/lib/errors";

import { buildJudgeMessages, JUDGE_PROMPT_VERSION } from "./promptBuilder";
import { callModel, getDefaultAiModel, isAiProviderConfigured } from "./modelProvider";
import {
  AiConversationMessage,
  AiJudgeIssue,
  AiJudgeResult,
  AiRiskLevel,
} from "./types";

const VALID_ISSUES = new Set<AiJudgeIssue>([
  "safety",
  "over_diagnosis",
  "over_promising_effect",
  "ai_like_tone",
  "lack_of_empathy",
  "inappropriate_strong_advice",
  "self_harm_or_crisis",
  "invented_scene",
  "dismissive_rest_advice",
  "repetitive_reassurance",
  "unhelpful_abstract_prompt",
  "leading_interpretation",
  "sensory_mismatch",
  "reasks_known_information",
  "flippant_tone",
  "missed_user_correction",
]);

const INVENTED_SCENE_TERMS = [
  "月亮",
  "云",
  "窗外",
  "空气",
  "泡茶",
  "热茶",
  "听雨",
  "雨声",
  "发呆",
];

const LOW_ENERGY_TERMS = [
  "我累了",
  "好累",
  "累了",
  "疲惫",
  "没力气",
  "撑不住",
  "耗尽",
  "烦",
  "崩",
];

const USER_STATE_TERMS = ["累", "空", "烦", "困", "难受", "麻木", "委屈", "害怕", "焦虑", "慌"];

const DISMISSIVE_REST_PATTERNS = [
  /歇(一)?会儿吧/,
  /休息(一下|一会儿)?吧/,
  /不用硬撑/,
  /去睡(一)?觉/,
  /睡(一)?觉就好了/,
  /早点睡/,
];

const UNCERTAIN_TERMS = ["不知道说什么", "不知道怎么说", "说不上来", "不知道"];

const REASSURANCE_TERMS = ["我在这儿", "陪着你", "陪你", "没关系", "不用说清楚", "只说一点点"];

const MICRO_ENTRY_TERMS = ["身体累", "心里累", "都累", "一个词", "选一个", "哪一", "最重", "最明显"];

const ABSTRACT_PROMPT_PATTERNS = [
  /想说(点|些)?什么/,
  /发生了什么/,
  /为什么/,
  /因为什么/,
  /多说(一点|一些)/,
  /聊聊/,
  /展开说说/,
];

const INFERRED_STATE_TERMS = ["身体", "心里", "沉", "压着", "委屈", "害怕", "焦虑", "难过", "空"];

const SENSORY_MISMATCH_PATTERNS = [
  /听(到|见).{0,8}(感受|感觉|情绪|累|难受|委屈|痛苦|压力)/,
  /(感受|感觉|情绪|累|难受|委屈|痛苦|压力).{0,8}听(到|见)/,
  /听起来.{0,8}(感觉|感受)/,
  /听起来.{0,12}(累|难受|委屈|痛苦|压力|焦虑|害怕|烦|崩|麻木)/,
  /没听好/,
  /没听进去/,
  /听懂了/,
  /听明白了/,
];

const FLIPPANT_TONE_PATTERNS = [/干待着/, /那就这样吧/, /随便吧/, /爱说不说/, /那你就/];
const USER_CORRECTION_PATTERN = /不是这个问题|我已经说过了|你还问|别再让我|不是这样|不对|你说话像模板|一直在套模板/;
const CORRECTION_ACK_PATTERN = /你说得对|是我|你说了|没接住|问偏了|说偏了|不该|不追问|不选了|套模板/;

const getRecentUserText = (recentMessages: AiConversationMessage[]) =>
  recentMessages
    .slice(-4)
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");

const getKnownUserStateTerms = (userMessage: string, recentMessages: AiConversationMessage[]) => {
  const text = `${getRecentUserText(recentMessages)}\n${userMessage}`;
  return USER_STATE_TERMS.filter((term) => text.includes(term));
};

const getRecentAssistantText = (recentMessages: AiConversationMessage[]) =>
  recentMessages
    .slice(-4)
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .join("\n");

const normalizeRiskLevel = (value: unknown): AiRiskLevel => {
  if (value === "medium" || value === "high" || value === "crisis") return value;
  return "low";
};

const normalizeIssues = (value: unknown): AiJudgeIssue[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((issue): issue is AiJudgeIssue => VALID_ISSUES.has(issue));
};

const runLocalJudge = ({
  userMessage,
  assistantReply,
  recentMessages,
}: {
  userMessage: string;
  assistantReply: string;
  recentMessages: AiConversationMessage[];
}): AiJudgeResult => {
  const issues = new Set<AiJudgeIssue>();
  const combined = `${userMessage}\n${assistantReply}`;
  const recentUserText = getRecentUserText(recentMessages);
  const recentAssistantText = getRecentAssistantText(recentMessages);
  const knownUserStateTerms = getKnownUserStateTerms(userMessage, recentMessages);

  if (/自杀|轻生|不想活|伤害自己|结束生命|割腕|寻死/.test(combined)) {
    issues.add("self_harm_or_crisis");
    issues.add("safety");
  }
  if (/抑郁症|焦虑症|确诊|你这是病|人格障碍/.test(assistantReply)) {
    issues.add("over_diagnosis");
  }
  if (/一定会好|保证|治愈|马上就会好/.test(assistantReply)) {
    issues.add("over_promising_effect");
  }
  if (/作为(一个)?AI|我是AI|根据我的算法|我不能提供/.test(assistantReply)) {
    issues.add("ai_like_tone");
  }
  if (/你必须|你应该立刻|马上辞职|分手吧|必须马上/.test(assistantReply)) {
    issues.add("inappropriate_strong_advice");
  }
  if (
    INVENTED_SCENE_TERMS.some(
      (term) => assistantReply.includes(term) && !userMessage.includes(term)
    )
  ) {
    issues.add("invented_scene");
  }
  if (
    LOW_ENERGY_TERMS.some((term) => userMessage.includes(term)) &&
    DISMISSIVE_REST_PATTERNS.some((pattern) => pattern.test(assistantReply))
  ) {
    issues.add("dismissive_rest_advice");
    issues.add("lack_of_empathy");
  }
  if (
    UNCERTAIN_TERMS.some((term) => userMessage.includes(term)) &&
    REASSURANCE_TERMS.some((term) => recentAssistantText.includes(term)) &&
    REASSURANCE_TERMS.some((term) => assistantReply.includes(term)) &&
    !MICRO_ENTRY_TERMS.some((term) => assistantReply.includes(term))
  ) {
    issues.add("repetitive_reassurance");
    issues.add("lack_of_empathy");
  }
  if (
    UNCERTAIN_TERMS.some((term) => userMessage.includes(term)) &&
    ABSTRACT_PROMPT_PATTERNS.some((pattern) => pattern.test(assistantReply)) &&
    !MICRO_ENTRY_TERMS.some((term) => assistantReply.includes(term))
  ) {
    issues.add("unhelpful_abstract_prompt");
    issues.add("lack_of_empathy");
  }
  if (
    LOW_ENERGY_TERMS.some((term) => userMessage.includes(term)) &&
    ABSTRACT_PROMPT_PATTERNS.some((pattern) => pattern.test(assistantReply)) &&
    !MICRO_ENTRY_TERMS.some((term) => assistantReply.includes(term))
  ) {
    issues.add("unhelpful_abstract_prompt");
    issues.add("lack_of_empathy");
  }
  if (
    /是不是/.test(assistantReply) &&
    INFERRED_STATE_TERMS.some(
      (term) =>
        assistantReply.includes(term) &&
        !userMessage.includes(term) &&
        !recentUserText.includes(term)
    ) &&
    !/(还是|选一个|哪个)/.test(assistantReply)
  ) {
    issues.add("leading_interpretation");
  }
  if (SENSORY_MISMATCH_PATTERNS.some((pattern) => pattern.test(assistantReply))) {
    issues.add("sensory_mismatch");
    issues.add("lack_of_empathy");
  }
  if (
    knownUserStateTerms.some((term) => new RegExp(`(选|挑).{0,12}${term}|${term}.{0,12}(选|挑)`).test(assistantReply)) ||
    knownUserStateTerms.some((term) => new RegExp(`${term}、|、${term}`).test(assistantReply))
  ) {
    issues.add("reasks_known_information");
    issues.add("lack_of_empathy");
  }
  if (FLIPPANT_TONE_PATTERNS.some((pattern) => pattern.test(assistantReply))) {
    issues.add("flippant_tone");
    issues.add("lack_of_empathy");
  }
  if (
    USER_CORRECTION_PATTERN.test(userMessage) &&
    !CORRECTION_ACK_PATTERN.test(assistantReply)
  ) {
    issues.add("missed_user_correction");
    issues.add("lack_of_empathy");
  }

  const issueList = [...issues];
  const hasCrisis = issueList.includes("self_harm_or_crisis");

  return {
    passed: issueList.length === 0,
    riskLevel: hasCrisis ? "crisis" : issueList.length > 0 ? "medium" : "low",
    issues: issueList,
    rewriteRequired: issueList.length > 0 && !hasCrisis,
    reason: issueList.length > 0 ? "本地审查发现回复需要调整" : "",
  };
};

export const getJudgeModel = () => process.env.AI_JUDGE_MODEL?.trim() || getDefaultAiModel();

const getJudgeMode = () => {
  const mode = process.env.AI_JUDGE_MODE?.trim().toLowerCase();
  return mode === "model" ? "model" : "local";
};

export const judgeReply = async ({
  userMessage,
  assistantReply,
  recentMessages,
}: {
  userMessage: string;
  assistantReply: string;
  recentMessages: AiConversationMessage[];
}): Promise<AiJudgeResult & { judgeModel: string; promptVersion: string }> => {
  if (getJudgeMode() === "local" || !isAiProviderConfigured()) {
    return {
      ...runLocalJudge({ userMessage, assistantReply, recentMessages }),
      judgeModel: "local-heuristic",
      promptVersion: JUDGE_PROMPT_VERSION,
    };
  }

  try {
    const model = getJudgeModel();
    const response = await callModel({
      model,
      messages: buildJudgeMessages({ userMessage, assistantReply, recentMessages }),
      temperature: 0,
    });

    const parsed = JSON.parse(response.text) as Record<string, unknown>;
    const issues = normalizeIssues(parsed.issues);
    const riskLevel = normalizeRiskLevel(parsed.riskLevel);
    const passed = typeof parsed.passed === "boolean" ? parsed.passed : issues.length === 0;
    const rewriteRequired =
      typeof parsed.rewriteRequired === "boolean"
        ? parsed.rewriteRequired
        : !passed && riskLevel !== "crisis";

    return {
      passed,
      riskLevel,
      issues,
      rewriteRequired: rewriteRequired && riskLevel !== "crisis",
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      raw: parsed,
      judgeModel: model,
      promptVersion: JUDGE_PROMPT_VERSION,
    };
  } catch (error) {
    if (error instanceof AppError) throw new AppError("AI_JUDGE_FAILED", error.message, 502);
    return {
      ...runLocalJudge({ userMessage, assistantReply, recentMessages }),
      judgeModel: "local-heuristic",
      promptVersion: JUDGE_PROMPT_VERSION,
    };
  }
};
