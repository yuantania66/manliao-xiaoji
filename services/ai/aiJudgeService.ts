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
]);

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
}: {
  userMessage: string;
  assistantReply: string;
}): AiJudgeResult => {
  const issues = new Set<AiJudgeIssue>();
  const combined = `${userMessage}\n${assistantReply}`;

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
  if (!/听见|理解|难受|辛苦|陪|在这里|不急|慢慢|可以/.test(assistantReply)) {
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

export const judgeReply = async ({
  userMessage,
  assistantReply,
  recentMessages,
}: {
  userMessage: string;
  assistantReply: string;
  recentMessages: AiConversationMessage[];
}): Promise<AiJudgeResult & { judgeModel: string; promptVersion: string }> => {
  if (!isAiProviderConfigured()) {
    return {
      ...runLocalJudge({ userMessage, assistantReply }),
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
      ...runLocalJudge({ userMessage, assistantReply }),
      judgeModel: "local-heuristic",
      promptVersion: JUDGE_PROMPT_VERSION,
    };
  }
};
