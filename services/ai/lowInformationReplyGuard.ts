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

  const elapsed = Date.now() - Date.parse(latestMessageAt);
  return Number.isFinite(elapsed) && elapsed > CONVERSATION_RESET_GAP_MS ? [] : recentMessages;
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

const countPriorConsecutiveNumericTurns = (recentMessages: AiConversationMessage[]) => {
  const userMessages = getActiveRecentMessages(recentMessages).filter((message) => message.role === "user");
  let count = 0;

  for (let index = userMessages.length - 1; index >= 0; index -= 1) {
    if (!NUMERIC_TOKEN_PATTERN.test(userMessages[index].content.trim())) break;
    count += 1;
  }

  return count;
};

const FREE_NUMERIC_REPLIES = [
  (token: string) => `这个“${token}”有什么含义吗？`,
  () => "你是在测试我怎么回应这些数字吗？",
  () => "我还不确定是不是在测试；你可以继续发。",
] as const;

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

  const priorNumericTurns = countPriorConsecutiveNumericTurns(recentMessages);
  const reply = FREE_NUMERIC_REPLIES[Math.min(priorNumericTurns, FREE_NUMERIC_REPLIES.length - 1)](
    userMessage.trim()
  );

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
