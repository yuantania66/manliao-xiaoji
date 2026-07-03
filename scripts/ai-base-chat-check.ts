import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createSafetyGeneration, isCrisisInput } from "../services/ai/chatSafety";
import { buildAiDebugTrace } from "../services/ai/debugTrace";
import { createNoteDraft } from "../services/ai/noteDraft";
import { buildChatPrompt, CHAT_PROMPT_VERSION } from "../services/ai/promptBuilder";
import { AiConversationMessage } from "../services/ai/types";

const activeChatFiles = [
  "app/api/chat/guest/route.ts",
  "app/api/chat/sessions/[sessionId]/messages/route.ts",
  "services/ai/aiService.ts",
  "services/ai/chatReplyService.ts",
  "services/ai/debugTrace.ts",
  "services/ai/promptBuilder.ts",
];

const bannedImports = [
  "aiJudgeService",
  "rewriteService",
  "interactionPlan",
  "responsePolicy",
  "ragKnowledge",
  "slowChatOS",
  "conversationUnderstanding",
];

for (const file of activeChatFiles) {
  const content = readFileSync(file, "utf8");
  for (const bannedImport of bannedImports) {
    assert(
      !content.includes(bannedImport),
      `${file} must not reference legacy AI architecture module ${bannedImport}`
    );
  }
}

const legacyHistory: AiConversationMessage[] = [
  { role: "user", content: "3" },
  {
    role: "assistant",
    content: "嗯，往上了一点。先不用解释为什么。",
    promptVersion: "low-info-v3-clarify",
  },
  { role: "user", content: "a" },
  {
    role: "assistant",
    content: "还在这里。",
    promptVersion: "chat-v4-understanding",
  },
];

const prompt = buildChatPrompt({
  userMessage: "b",
  recentMessages: legacyHistory,
});

assert.equal(prompt.meta.promptVersion, CHAT_PROMPT_VERSION);
assert.equal(prompt.meta.filteredHistoryCount, 4);
assert.deepEqual(
  prompt.messages.map((message) => message.role),
  ["developer", "user"]
);
assert(!JSON.stringify(prompt.messages).includes("还在这里"));
assert(!JSON.stringify(prompt.messages).includes("往上了一点"));
assert(!JSON.stringify(prompt.messages).includes("\"3\""));
assert(!JSON.stringify(prompt.messages).includes("\"a\""));
assert(prompt.messages[0].content.includes("不要猜测"));
assert(prompt.messages[0].content.includes("不要列候选解释"));
assert(prompt.messages[0].content.includes("第一次对话"));

const baseAssistantPrompt = buildChatPrompt({
  userMessage: "继续",
  recentMessages: [
    {
      role: "assistant",
      content: "这个是什么意思？",
      promptVersion: CHAT_PROMPT_VERSION,
    },
  ],
});

assert.equal(baseAssistantPrompt.meta.filteredHistoryCount, 0);
assert.deepEqual(
  baseAssistantPrompt.messages.map((message) => message.role),
  ["developer", "assistant", "user"]
);

const memoryPrompt = buildChatPrompt({
  userMessage: "今天还是有点累",
  recentMessages: [],
  memoryContext: {
    source: "note",
    text: "上周提到工作交接很耗神",
    date: "2026-07-01",
  },
});

assert.equal(memoryPrompt.meta.memoryIncluded, true);
assert.equal(memoryPrompt.meta.memorySource, "note");
assert(JSON.stringify(memoryPrompt.messages).includes("上周提到工作交接很耗神"));
assert(!JSON.stringify(memoryPrompt.messages).includes("不存在的历史"));

const implicitLegacyPrompt = buildChatPrompt({
  userMessage: "b",
  recentMessages: [
    { role: "assistant", content: "还在这里。" },
  ],
});

assert.equal(implicitLegacyPrompt.meta.filteredHistoryCount, 1);
assert.equal(implicitLegacyPrompt.meta.filteredHistory[0].reason, "legacy_template_text");

const repeatedLowInfoPrompt = buildChatPrompt({
  userMessage: "5",
  recentMessages: [
    { role: "user", content: "1" },
    {
      role: "assistant",
      content: "这个1是什么意思？",
      promptVersion: CHAT_PROMPT_VERSION,
    },
    { role: "user", content: "2" },
    {
      role: "assistant",
      content: "2是接着刚才的想法，还是现在想换个东西说？",
      promptVersion: CHAT_PROMPT_VERSION,
    },
  ],
});

assert.equal(repeatedLowInfoPrompt.meta.filteredHistoryCount, 4);
assert.deepEqual(
  repeatedLowInfoPrompt.messages.map((message) => message.role),
  ["developer", "developer", "user"]
);
assert(JSON.stringify(repeatedLowInfoPrompt.messages).includes("不要再用问句或问号"));
const repeatedLowInfoHistoryText = JSON.stringify(
  repeatedLowInfoPrompt.messages.filter((message) => message.role !== "developer")
);
assert(!repeatedLowInfoHistoryText.includes("是什么意思"));
assert(!repeatedLowInfoHistoryText.includes("想换个东西说"));
assert(
  repeatedLowInfoPrompt.meta.filteredHistory.some(
    (item) => item.reason === "low_information_clarify_history_for_ambiguous_input"
  )
);

const debug = buildAiDebugTrace({
  userMessage: "b",
  recentMessages: legacyHistory,
  generation: {
    text: "这个是什么意思？",
    model: "test-model",
    promptVersion: CHAT_PROMPT_VERSION,
    latencyMs: 1,
    promptMeta: prompt.meta,
  },
  judge: {
    passed: true,
    riskLevel: "low",
    issues: [],
    rewriteRequired: false,
    reason: "judge/rewrite disabled; base model output returned directly",
    judgeModel: "disabled",
  },
  finalSource: "base_model",
  fallbackUsed: false,
  rewriteAttempted: false,
});

const debugText = JSON.stringify(debug);
assert.equal(debug.prompt.filteredHistoryCount, 4);
assert(!debugText.includes("理解层"));
assert(!debugText.includes("慢聊状态"));

assert.equal(isCrisisInput("我不想活了"), true);
const safety = createSafetyGeneration("我不想活了");
assert.equal(safety.model, "safety-gate");
assert.equal(safety.promptVersion, "safety-gate-v1");
assert(safety.text.includes("紧急电话"));

const safetyDebug = buildAiDebugTrace({
  userMessage: "我不想活了",
  recentMessages: [],
  generation: safety,
  judge: {
    passed: true,
    riskLevel: "crisis",
    issues: [],
    rewriteRequired: false,
    reason: "safety gate matched; base model skipped",
    judgeModel: "safety-gate",
  },
  finalSource: "safety",
  fallbackUsed: false,
  rewriteAttempted: false,
});

assert.equal(safetyDebug.route.finalSource, "safety");
assert.equal(safetyDebug.route.safetyUsed, true);
assert.equal(safetyDebug.prompt.modelMessageRoles.length, 0);

const draft = createNoteDraft({
  userMessage: "今天下班后突然觉得很累，但也松了一口气",
  recentMessages: [],
  assistantReply: "这会儿先承认自己的累。",
});

assert(draft);
assert.equal(draft.source, "chat_turn");
assert(draft.content.includes("今天下班后突然觉得很累"));
assert.equal(createNoteDraft({ userMessage: "1", recentMessages: [], assistantReply: "这个是什么意思？" }), null);

console.log("AI base chat checks passed");
