import type { ClinicalPlan } from "@/services/clinical/clinicalTypes";

import type { AiConversationMessage, AiGenerationResult } from "./types";

const NUMERIC_TOKEN_PATTERN = /^[0-9０-９]+$/u;
const CONVERSATION_RESET_GAP_MS = 5 * 60 * 1000;

const SCALE_FRAME_PATTERN =
  /(?:[0-9０-９一二三四五六七八九十]+\s*[-–—到至]\s*[0-9０-９一二三四五六七八九十]+|满分\s*[0-9０-９一二三四五六七八九十]+|(?:打|评|给).{0,12}(?:分|评分)|几分)/u;
const NUMBERED_CHOICE_PATTERN =
  /(?:^|[\s，。；;:：])(?:1|１)\s*[.、:：)）].{1,80}(?:^|[\s，。；;:：])(?:2|２)\s*[.、:：)）]/u;
const COUNT_FRAME_PATTERN = /(?:多少|几)\s*(?:次|个|天|遍|回|件|人|项)|(?:次数|数量|第几)/u;

const getActiveRecentMessages = (recentMessages: AiConversationMessage[]) => {
  const latestMessageAt = recentMessages[recentMessages.length - 1]?.createdAt;
  if (!latestMessageAt) return recentMessages;

  const latestTimestamp = Date.parse(latestMessageAt);
  const elapsed = Date.now() - latestTimestamp;
  if (Number.isFinite(elapsed) && elapsed > CONVERSATION_RESET_GAP_MS) return [];

  for (let index = recentMessages.length - 1; index > 0; index -= 1) {
    const currentTimestamp = Date.parse(recentMessages[index].createdAt ?? "");
    const previousTimestamp = Date.parse(recentMessages[index - 1].createdAt ?? "");
    if (
      Number.isFinite(currentTimestamp) &&
      Number.isFinite(previousTimestamp) &&
      currentTimestamp - previousTimestamp > CONVERSATION_RESET_GAP_MS
    ) {
      return recentMessages.slice(index);
    }
  }

  return recentMessages;
};

const hasEstablishedNumericFrame = (recentMessages: AiConversationMessage[]) => {
  const context = getActiveRecentMessages(recentMessages)
    .slice(-6)
    .map((message) => message.content.replace(/\s+/g, " ").trim())
    .join("\n");

  return (
    SCALE_FRAME_PATTERN.test(context) ||
    NUMBERED_CHOICE_PATTERN.test(context) ||
    COUNT_FRAME_PATTERN.test(context)
  );
};

const getPriorConsecutiveNumericTokens = (recentMessages: AiConversationMessage[]) => {
  const userMessages = getActiveRecentMessages(recentMessages).filter((message) => message.role === "user");
  const tokens: string[] = [];

  for (let index = userMessages.length - 1; index >= 0; index -= 1) {
    const token = userMessages[index].content.trim();
    if (!NUMERIC_TOKEN_PATTERN.test(token)) break;
    tokens.unshift(token);
  }

  return tokens;
};

const buildFreeNumericReply = (token: string, priorTokens: string[]) => {
  if (priorTokens.length === 0) return `这个“${token}”有什么含义吗？`;
  if (priorTokens.length === 1) return "你是在测试我怎么回应这些数字吗？";
  if (priorTokens.length === 2) {
    return "看起来像是在测试我对连续数字的回应。我先这样理解；不是的话，你随时纠正我。";
  }

  const previousToken = priorTokens[priorTokens.length - 1];
  if (previousToken !== token) {
    const changedReplies = [
      `这次换成了“${token}”。我继续跟着；不是在测试的话，你随时纠正我。`,
      `现在是“${token}”。继续吧，我会按数字本身回应。`,
    ] as const;
    return changedReplies[priorTokens.length % changedReplies.length];
  }

  const repeatedReplies = [
    `还是“${token}”。继续吧。`,
    `又是“${token}”。我跟着呢。`,
  ] as const;
  return repeatedReplies[priorTokens.length % repeatedReplies.length];
};

export const shouldApplyFreeNumericReplyContract = ({
  userMessage,
  recentMessages,
  clinicalPlan,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  clinicalPlan: ClinicalPlan;
}) =>
  clinicalPlan.responseGoal === "clarify" &&
  clinicalPlan.responseIntent === "clarify" &&
  NUMERIC_TOKEN_PATTERN.test(userMessage.trim()) &&
  !hasEstablishedNumericFrame(recentMessages);

export const applyFreeNumericReplyContract = ({
  userMessage,
  recentMessages,
  clinicalPlan,
  generation,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  clinicalPlan: ClinicalPlan;
  generation: AiGenerationResult;
}): AiGenerationResult => {
  if (!shouldApplyFreeNumericReplyContract({ userMessage, recentMessages, clinicalPlan })) {
    return generation;
  }

  const priorNumericTokens = getPriorConsecutiveNumericTokens(recentMessages);
  const reply = buildFreeNumericReply(userMessage.trim(), priorNumericTokens);

  return {
    ...generation,
    text: reply,
    rawLLMOutput: generation.rawLLMOutput ?? generation.text,
    postProcessSteps: [
      ...(generation.postProcessSteps ?? []),
      {
        layer: "free_numeric_reply_contract",
        before: generation.text,
        after: reply,
        reason:
          "Pure numeric input has no established procedural meaning; enforce groundedness and a low-pressure continuation entry.",
      },
    ],
    finalReplySource: "guard_rewrite",
  };
};
