import assert from "node:assert/strict";

import { determineConversationState } from "../conversation-os/state";
import { createClinicalMemoryContext } from "../services/ai/clinicalMemoryAdapter";
import { inspectSemanticEvidenceReplyContract } from "../services/ai/semanticEvidenceReplyGuard";
import type { AiConversationMessage, AiGenerationResult } from "../services/ai/types";
import { buildClinicalContext } from "../services/clinical/clinicalContextBuilder";
import { createClinicalPlan } from "../services/clinical/clinicalPlanService";
import type { ClinicalSemanticEvidence } from "../services/clinical/clinicalTypes";

type ReviewCase = {
  id: string;
  category: string;
  userMessage: string;
  recentMessages?: AiConversationMessage[];
  expectedStatus: ClinicalSemanticEvidence["status"];
  expectedSource?: ClinicalSemanticEvidence["source"];
  expectedIntent?: ReturnType<typeof createClinicalPlan>["responseIntent"];
};

const now = Date.now();
const minutesAgo = (minutes: number) => new Date(now - minutes * 60 * 1000).toISOString();
const assistant = (content: string, ageMinutes = 0): AiConversationMessage => ({
  role: "assistant",
  content,
  createdAt: minutesAgo(ageMinutes),
});
const user = (content: string, ageMinutes = 0): AiConversationMessage => ({
  role: "user",
  content,
  createdAt: minutesAgo(ageMinutes),
});

const cases: ReviewCase[] = [
  {
    id: "explicit-letter-choice",
    category: "explicit question -> short answer",
    userMessage: "A",
    recentMessages: [assistant("请选择 A 或 B。")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "explicit-whether-confirmation",
    category: "explicit question -> short answer",
    userMessage: "对",
    recentMessages: [assistant("你是否愿意继续聊？")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "contextual-chinese-quantity",
    category: "contextual completion",
    userMessage: "六",
    recentMessages: [assistant("昨晚睡了几个小时？")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "contextual-fullwidth-number",
    category: "contextual completion",
    userMessage: "４",
    recentMessages: [assistant("你带了几件行李？")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "isolated-symbol",
    category: "isolated messages",
    userMessage: "+",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "isolated-letter",
    category: "isolated messages",
    userMessage: "Z",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "isolated-english-yes",
    category: "isolated messages",
    userMessage: "yes",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "ambiguous-ellipsis",
    category: "ambiguous messages",
    userMessage: "……",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "ambiguous-word-with-meaning",
    category: "ambiguous messages",
    userMessage: "也许",
    expectedStatus: "sufficient",
    expectedSource: "current_user_message",
  },
  {
    id: "topic-switch-invalidates-scale",
    category: "conversation switching",
    userMessage: "7",
    recentMessages: [assistant("从 1 到 10 打几分？", 2), user("先不说这个，我想聊工作。", 1)],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "new-question-replaces-old-scale",
    category: "conversation switching",
    userMessage: "8",
    recentMessages: [assistant("从 1 到 10 打几分？", 3), user("换个话题。", 2), assistant("你想聊哪件事？", 1)],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "assistant-assumption-not-numeric-frame",
    category: "previous AI assumptions",
    userMessage: "2",
    recentMessages: [assistant("我猜你是在测试我。")],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "assistant-assumption-explicitly-confirmed",
    category: "previous AI assumptions",
    userMessage: "是",
    recentMessages: [assistant("你是在测试我吗？")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "full-user-correction",
    category: "user corrections",
    userMessage: "你理解偏了",
    recentMessages: [assistant("听起来你是不想继续。")],
    expectedStatus: "sufficient",
    expectedSource: "current_user_message",
    expectedIntent: "repair",
  },
  {
    id: "correction-with-content",
    category: "user corrections",
    userMessage: "不是累，是失望",
    recentMessages: [assistant("你现在很累。")],
    expectedStatus: "sufficient",
    expectedSource: "current_user_message",
  },
  {
    id: "second-low-information-input",
    category: "multiple consecutive low-information inputs",
    userMessage: "5",
    recentMessages: [
      user("4", 2),
      assistant("我看到你发的是“4”。现在的线索还不够，我先不替它加上含义。你可以继续。", 1),
    ],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "third-low-information-input",
    category: "multiple consecutive low-information inputs",
    userMessage: "6",
    recentMessages: [
      user("4", 4),
      assistant("我看到你发的是“4”。现在的线索还不够，我先不替它加上含义。你可以继续。", 3),
      user("5", 2),
      assistant("我看到你发的是“5”。现在的线索还不够，我先不替它加上含义。你可以继续。", 1),
    ],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "single-emoji",
    category: "emoji",
    userMessage: "🫥",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "emoji-sequence",
    category: "emoji",
    userMessage: "👨‍👩‍👧‍👦",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "question-marks-only",
    category: "punctuation",
    userMessage: "？？？",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "punctuation-mix-only",
    category: "punctuation",
    userMessage: "?!…",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "single-emotion-word",
    category: "single words",
    userMessage: "累",
    expectedStatus: "sufficient",
    expectedSource: "current_user_message",
  },
  {
    id: "single-acknowledgement-word",
    category: "single words",
    userMessage: "嗯嗯",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "explicit-test-instruction",
    category: "explicit testing scenarios",
    userMessage: "测试一下：我连续发数字时，不要猜我的意图。",
    expectedStatus: "sufficient",
    expectedSource: "current_user_message",
  },
  {
    id: "test-follow-up-number",
    category: "explicit testing scenarios",
    userMessage: "9",
    recentMessages: [
      user("测试一下：我连续发数字时，不要猜我的意图。", 2),
      assistant("好，我不会根据数字本身猜你的意图。", 1),
    ],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "contradictory-context-current-wins",
    category: "contradictory context",
    userMessage: "其实一点也不焦虑，我只是困。",
    recentMessages: [assistant("从 0 到 5 给焦虑打几分？")],
    expectedStatus: "sufficient",
    expectedSource: "current_user_message",
  },
  {
    id: "contradictory-answer-not-in-choice-set",
    category: "contradictory context",
    userMessage: "3",
    recentMessages: [assistant("选一个：1. 继续说；2. 先暂停。")],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "scale-answer-out-of-range",
    category: "contradictory context",
    userMessage: "8",
    recentMessages: [assistant("请用 0–5 给压力打分。")],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "delayed-answer-within-active-window",
    category: "delayed clarification",
    userMessage: "2",
    recentMessages: [assistant("有几只猫？", 4)],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "delayed-answer-outside-active-window",
    category: "delayed clarification",
    userMessage: "2",
    recentMessages: [assistant("有几只猫？", 6)],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "decimal-within-scale",
    category: "explicit question -> short answer",
    userMessage: "4.5",
    recentMessages: [assistant("请用 1–5 给今天的疲惫打分。")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "numbered-choice-with-trailing-instruction",
    category: "contextual completion",
    userMessage: "2",
    recentMessages: [assistant("你可以选：1. 先说工作；2. 先说家里。只回编号也可以。")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "binary-question-without-punctuation",
    category: "explicit question -> short answer",
    userMessage: "是",
    recentMessages: [assistant("你愿意继续吗")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "whether-question-without-punctuation",
    category: "explicit question -> short answer",
    userMessage: "对",
    recentMessages: [assistant("你是否想先说工作")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "alphabetic-enumerated-choice",
    category: "contextual completion",
    userMessage: "B",
    recentMessages: [assistant("请选择：A. 继续聊；B. 先暂停。")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "isolated-yes-with-punctuation",
    category: "isolated messages",
    userMessage: "yes!",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "isolated-number-with-chinese-period",
    category: "isolated messages",
    userMessage: "1。",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "isolated-english-acknowledgement",
    category: "single words",
    userMessage: "OK",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "punctuated-binary-answer",
    category: "explicit question -> short answer",
    userMessage: "yes!",
    recentMessages: [assistant("Do you want to continue?")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "numbered-summary-is-not-choice-frame",
    category: "previous AI assumptions",
    userMessage: "1",
    recentMessages: [assistant("我刚才总结了两点：1. 睡眠；2. 工作。")],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "year-range-is-not-scale-frame",
    category: "contradictory context",
    userMessage: "2023",
    recentMessages: [assistant("我们刚聊到 2020-2025 年发生的变化。")],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "chinese-age-answer",
    category: "contextual completion",
    userMessage: "三十四",
    recentMessages: [assistant("你多大？")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "fullwidth-out-of-range-scale",
    category: "contradictory context",
    userMessage: "９",
    recentMessages: [assistant("请按 １—５ 给压力评分。")],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "fullwidth-choice-not-offered",
    category: "contradictory context",
    userMessage: "３",
    recentMessages: [assistant("请选择：１、继续；２、暂停。")],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "lowercase-letter-choice",
    category: "contextual completion",
    userMessage: "b",
    recentMessages: [assistant("A or B?")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "letter-choice-not-offered",
    category: "contradictory context",
    userMessage: "C",
    recentMessages: [assistant("A or B?")],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "intervening-user-invalidates-binary",
    category: "conversation switching",
    userMessage: "是",
    recentMessages: [assistant("你想继续吗？", 2), user("等一下。", 1)],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "later-assistant-statement-invalidates-scale",
    category: "conversation switching",
    userMessage: "4",
    recentMessages: [assistant("请按 1-5 评分。", 2), assistant("没关系，可以慢慢来。", 1)],
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "single-english-emotion-word",
    category: "single words",
    userMessage: "sad",
    expectedStatus: "sufficient",
    expectedSource: "current_user_message",
  },
  {
    id: "ascii-emoticon",
    category: "emoji",
    userMessage: ":)",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "whitespace-wrapped-number",
    category: "punctuation",
    userMessage: "  7\n",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "negated-binary-answer-without-question-mark",
    category: "explicit question -> short answer",
    userMessage: "不是",
    recentMessages: [assistant("你是不是想暂停")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "english-negative-answer",
    category: "explicit question -> short answer",
    userMessage: "nope",
    recentMessages: [assistant("Would you like advice?")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "explicit-hypothesis-question-without-mark",
    category: "previous AI assumptions",
    userMessage: "是",
    recentMessages: [assistant("你是在测试我吗")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
  },
  {
    id: "malformed-numeric-token",
    category: "ambiguous messages",
    userMessage: "4..5",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "mixed-number-and-emoji",
    category: "ambiguous messages",
    userMessage: "1🙂",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
  {
    id: "short-correction-of-assistant-assertion",
    category: "user corrections",
    userMessage: "不对",
    recentMessages: [assistant("所以你是不想继续。")],
    expectedStatus: "sufficient",
    expectedSource: "established_conversation_frame",
    expectedIntent: "repair",
  },
  {
    id: "isolated-short-correction-token",
    category: "isolated messages",
    userMessage: "不对",
    expectedStatus: "insufficient",
    expectedIntent: "receive",
  },
];

const memoryContext = createClinicalMemoryContext(null);
const modelGeneration: AiGenerationResult = {
  text: "MODEL_OUTPUT",
  model: "stability-review",
  promptVersion: "stability-review",
  latencyMs: 0,
  postProcessSteps: [],
  finalReplySource: "mock",
};

const results = cases.map((item) => {
  const recentMessages = item.recentMessages ?? [];
  const context = buildClinicalContext({
    conversationId: `semantic-evidence-stability-${item.id}`,
    userTurn: item.userMessage,
    recentTurns: recentMessages,
    memoryContext,
    conversationState: determineConversationState({
      currentUserMessage: item.userMessage,
      recentMessages,
    }).state,
  });
  const plan = createClinicalPlan(context);
  const inspection = inspectSemanticEvidenceReplyContract({
    clinicalPlan: plan,
    reply: modelGeneration.text,
  });
  const failures = [
    context.signals.semanticEvidence.status === item.expectedStatus
      ? null
      : `status expected=${item.expectedStatus} actual=${context.signals.semanticEvidence.status}`,
    item.expectedSource && context.signals.semanticEvidence.source !== item.expectedSource
      ? `source expected=${item.expectedSource} actual=${context.signals.semanticEvidence.source}`
      : null,
    item.expectedIntent && plan.responseIntent !== item.expectedIntent
      ? `intent expected=${item.expectedIntent} actual=${plan.responseIntent}`
      : null,
    item.expectedStatus === "insufficient" && inspection.hasUnsupportedMeaning
      ? "natural model output unexpectedly matched unsupported-meaning patterns"
      : null,
  ].filter((failure): failure is string => Boolean(failure));

  return {
    id: item.id,
    category: item.category,
    input: item.userMessage,
    expected: {
      status: item.expectedStatus,
      source: item.expectedSource,
      intent: item.expectedIntent,
    },
    actual: {
      status: context.signals.semanticEvidence.status,
      source: context.signals.semanticEvidence.source,
      responseGoal: plan.responseGoal,
      responseIntent: plan.responseIntent,
      questionFunction: plan.questionFunction,
      replySource: modelGeneration.finalReplySource,
      unsupportedMeaning: inspection.hasUnsupportedMeaning,
    },
    failures,
  };
});

const failed = results.filter((result) => result.failures.length > 0);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
assert.equal(failed.length, 0, `${failed.length} semantic-evidence stability scenarios failed.`);
