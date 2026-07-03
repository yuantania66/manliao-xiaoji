import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildAiDebugTrace } from "../services/ai/debugTrace";
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
assert(prompt.messages[0].content.includes("不要追加候选解释"));

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

const implicitLegacyPrompt = buildChatPrompt({
  userMessage: "b",
  recentMessages: [
    { role: "assistant", content: "还在这里。" },
  ],
});

assert.equal(implicitLegacyPrompt.meta.filteredHistoryCount, 1);
assert.equal(implicitLegacyPrompt.meta.filteredHistory[0].reason, "legacy_template_text");

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

console.log("AI base chat checks passed");
