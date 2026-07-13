import type { ClinicalPlan } from "@/services/clinical/clinicalTypes";

import type { AiConversationMessage, AiGenerationResult } from "./types";

const NUMERIC_TOKEN_PATTERN = /^[0-9０-９]+$/u;

const SCALE_FRAME_PATTERN =
  /(?:[0-9０-９一二三四五六七八九十]+\s*[-–—到至]\s*[0-9０-９一二三四五六七八九十]+|满分\s*[0-9０-９一二三四五六七八九十]+|(?:打|评|给).{0,12}(?:分|评分)|几分)/u;
const NUMBERED_CHOICE_PATTERN =
  /(?:^|[\s，。；;:：])(?:1|１)\s*[.、:：)）].{1,80}(?:^|[\s，。；;:：])(?:2|２)\s*[.、:：)）]/u;
const COUNT_FRAME_PATTERN = /(?:多少|几)\s*(?:次|个|天|遍|回|件|人|项)|(?:次数|数量|第几)/u;

const hasEstablishedNumericFrame = (recentMessages: AiConversationMessage[]) => {
  const context = recentMessages
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
  const userMessages = recentMessages.filter((message) => message.role === "user");
  let count = 0;

  for (let index = userMessages.length - 1; index >= 0; index -= 1) {
    if (!NUMERIC_TOKEN_PATTERN.test(userMessages[index].content.trim())) break;
    count += 1;
  }

  return count;
};

const FREE_NUMERIC_REPLIES = [
  "我先不猜。你想继续发就继续，想说点别的也行。",
  "我还是先不猜。你可以接着发，也可以随时换成想说的话。",
  "继续发也可以；什么时候想说点别的，直接说就行。",
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
  const reply = FREE_NUMERIC_REPLIES[Math.min(priorNumericTurns, FREE_NUMERIC_REPLIES.length - 1)];

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
