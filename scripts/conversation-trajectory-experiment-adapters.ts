import type { ChatPromptEvaluationAdapter } from "../services/ai/promptBuilder";
import type { AiConversationMessage } from "../services/ai/types";
import type { ConversationTrajectory, TrajectoryDataset } from "./conversation-trajectory-eval-lib";

export type GroundednessExperimentVariant = "a0" | "a1" | "a2" | "a3";

const A1_INSTRUCTIONS = [
  "When a low-information token has no meaning established by the user or an explicit procedural interaction frame, treat it only as the observed token.",
  "Do not assign an emotion, intent, score, direction, activity, interface-testing purpose, repetition purpose, or conversational purpose.",
  "Explicit scales, numbered choices, and counting frames remain usable according to their established meaning.",
  "An assistant-only semantic guess is not established meaning merely because it appears in history.",
  "Preserve conversation movement without requiring the user to explain the token. Offer a low-pressure way to continue, and do not mechanically stop or park the token.",
  "Do not list canned possible interpretations and do not reuse one fixed acknowledgement opening.",
];

const A2_INSTRUCTIONS = [
  ...A1_INSTRUCTIONS,
  "Across later turns, never repeat or build on an assistant-originated interpretation that the user has not confirmed.",
  "If history contains an unconfirmed assistant interpretation, leave it unknown or withdraw it; do not treat it as a fact.",
  "Distinguish unconfirmed semantic guesses from explicit procedural scale, numbered-choice, and counting frames, which must remain usable.",
];

const PROCEDURAL_FRAME_PATTERN = /(?:1\s*[-–—到至]\s*10|[一二三四五六七八九十0-9]+\s*[.、:：]|选项|编号|打分|评分|几分|次数|第几)/u;

export const getGroundednessPromptAdapter = (
  variant: GroundednessExperimentVariant
): ChatPromptEvaluationAdapter | null => {
  if (variant === "a1") return { id: "exp-bl-012a-a1", developerInstructions: A1_INSTRUCTIONS };
  if (variant === "a2") return { id: "exp-bl-012a-a2", developerInstructions: A2_INSTRUCTIONS };
  return null;
};

export const applyGroundednessHistoryAdapter = (
  variant: GroundednessExperimentVariant,
  messages: AiConversationMessage[]
) => {
  if (variant !== "a3") return messages;

  return messages.filter(
    (message) => message.role !== "assistant" || PROCEDURAL_FRAME_PATTERN.test(message.content)
  );
};

const pendingStructure = {
  responseGoal: "pending" as const,
  responseIntent: "pending" as const,
  questionFunction: "pending" as const,
};

const makeTurn = ({
  turnId,
  user,
  allowedFacts,
  forbiddenPatterns = [],
}: {
  turnId: string;
  user: string;
  allowedFacts: string[];
  forbiddenPatterns?: string[];
}) => ({
  turnId,
  fixtureStatus: "pending_reproduction" as const,
  user,
  expectedStructure: pendingStructure,
  allowedFacts,
  forbiddenPatterns,
  machineChecks: ["forbidden_patterns_absent"],
  reviewerFields: [
    "unsupportedMeaning",
    "conversationMovement",
    "forcedExplanation",
    "continuationEntry",
    "reviewerNotes",
  ],
});

const source = {
  kind: "product_self_test" as const,
  capturedAt: "2026-07-12",
  evidence: ["reported" as const],
  captureEnvironment: "local_development",
};

const commonTrajectoryChecks = ["repeated_opening_skeleton_locator", "cross_run_opening_skeleton_locator"];
const commonTrajectoryReviewerFields = ["unsupportedMeaning", "conversationMovement", "templateRut", "reviewerNotes"];

const trajectories: ConversationTrajectory[] = [
  {
    id: "EXP19-FREE-SINGLE-001",
    category: "groundedness",
    source,
    purpose: "Test one free numeric token whose meaning has not been established.",
    initialMessages: [],
    turns: [
      makeTurn({
        turnId: "t1",
        user: "1",
        allowedFacts: ["The user sent the token 1."],
        forbiddenPatterns: [
          "松口气",
          "分数",
          "方向",
          "你就是在测试",
          "看来你在测试",
          "你在测试界面",
          "随手",
          "先停在这里",
          "留在这里",
        ],
      }),
    ],
    trajectoryMachineChecks: commonTrajectoryChecks,
    trajectoryReviewerFields: commonTrajectoryReviewerFields,
  },
  {
    id: "EXP19-FREE-SEQUENCE-001",
    category: "groundedness",
    source,
    purpose: "Test consecutive free numeric tokens without allowing assistant guesses to become facts.",
    initialMessages: [],
    turns: ["1", "2", "3"].map((user, index) =>
      makeTurn({
        turnId: `t${index + 1}`,
        user,
        allowedFacts: [`The user sent token ${user} in a consecutive free-token sequence.`],
        forbiddenPatterns: [
          "松口气",
          "分数",
          "方向",
          "你就是在测试",
          "看来你在测试",
          "你在测试界面",
          "随手",
          "第几个",
          "这次是",
          "先停在这里",
          "留在这里",
        ],
      })
    ),
    trajectoryMachineChecks: commonTrajectoryChecks,
    trajectoryReviewerFields: [...commonTrajectoryReviewerFields, "crossTurnContamination"],
  },
  {
    id: "EXP19-ESTABLISHED-SCALE-001",
    category: "groundedness",
    source,
    purpose: "Protect a numeric rating after an explicit scale has established its meaning.",
    initialMessages: [
      { role: "assistant", content: "如果愿意，可以用 1–10 给现在的紧张打个分，1 是很轻，10 是很强。", promptVersion: "chat-base-product-v11" },
    ],
    turns: [makeTurn({ turnId: "t1", user: "3", allowedFacts: ["An explicit 1–10 tension scale was established.", "The user selected 3."] })],
    trajectoryMachineChecks: commonTrajectoryChecks,
    trajectoryReviewerFields: [...commonTrajectoryReviewerFields, "establishedMeaningPreserved"],
  },
  {
    id: "EXP19-ESTABLISHED-CHOICE-001",
    category: "groundedness",
    source,
    purpose: "Protect a numeric selection after explicit numbered choices have established its meaning.",
    initialMessages: [
      { role: "assistant", content: "你可以选一个更接近现在的：1. 想先说说；2. 想先安静一会儿。", promptVersion: "chat-base-product-v11" },
    ],
    turns: [makeTurn({ turnId: "t1", user: "2", allowedFacts: ["Two numbered choices were established.", "The user selected option 2."] })],
    trajectoryMachineChecks: commonTrajectoryChecks,
    trajectoryReviewerFields: [...commonTrajectoryReviewerFields, "establishedMeaningPreserved"],
  },
  {
    id: "EXP19-EXPLICIT-COUNT-001",
    category: "groundedness",
    source,
    purpose: "Protect an explicit count expressed by the user.",
    initialMessages: [],
    turns: [makeTurn({ turnId: "t1", user: "我这周做了 3 次", allowedFacts: ["The user says they did something three times this week."] })],
    trajectoryMachineChecks: commonTrajectoryChecks,
    trajectoryReviewerFields: [...commonTrajectoryReviewerFields, "establishedMeaningPreserved"],
  },
  {
    id: "EXP19-ASSISTANT-GUESS-HISTORY-001",
    category: "groundedness",
    source,
    purpose: "Test that an earlier assistant-only semantic guess does not become established meaning.",
    initialMessages: [
      { role: "user", content: "1" },
      { role: "assistant", content: "1。像是还在刚才那个松口气的瞬间里。", promptVersion: "chat-base-product-v11" },
    ],
    turns: [
      makeTurn({
        turnId: "t1",
        user: "2",
        allowedFacts: ["The user previously sent 1 and now sent 2.", "The assistant previously guessed a feeling that the user did not confirm."],
        forbiddenPatterns: ["松口气", "这个感觉", "那个感觉", "延续", "继续刚才", "先停在这里", "留在这里"],
      }),
    ],
    trajectoryMachineChecks: commonTrajectoryChecks,
    trajectoryReviewerFields: [...commonTrajectoryReviewerFields, "crossTurnContamination"],
  },
];

export const getGroundednessExperimentDataset = (): TrajectoryDataset => ({
  schemaVersion: 1,
  datasetVersion: "exp-bl-012a-issue-19-v1",
  trajectories,
});

export const GROUNDEDNESS_VARIANTS: GroundednessExperimentVariant[] = ["a0", "a1", "a2", "a3"];
