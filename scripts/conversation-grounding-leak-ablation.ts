import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadEnvConfig } from "@next/env";

import { createChatReply } from "../services/ai/chatOrchestrationService";
import { callModel, getAiProvider, getDefaultAiModel, isAiProviderConfigured } from "../services/ai/modelProvider";
import { CHAT_PROMPT_VERSION, formatResponsePlanForPrompt } from "../services/ai/promptBuilder";
import { validateResponsePlanOutput } from "../services/ai/responsePlanValidator";
import type { AiConversationMessage, AiModelMessage } from "../services/ai/types";
import type { ResponsePlan } from "../conversation-os/control";

loadEnvConfig(process.cwd());

const phase = process.argv.includes("--post") ? "post" : "pre";
const requiredAuthorizationFlag = phase === "pre" ? "--authorized-pre" : "--authorized-post";
if (!process.argv.includes(requiredAuthorizationFlag)) {
  throw new Error(`External evaluation is locked; pass ${requiredAuthorizationFlag} only for the approved synthetic run.`);
}

const outputJson = `docs/evals/conversation-grounding-leak-${phase}-ablation.json`;
const outputMarkdown = `docs/evals/conversation-grounding-leak-${phase}-ablation.md`;
const configuredModel = process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel();

if (!isAiProviderConfigured() || getAiProvider() !== "qwen" || !configuredModel.includes("qwen3.7-max")) {
  throw new Error("This evaluation requires the configured Qwen/DashScope qwen3.7-max provider.");
}

const sha256 = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");

const syntheticTexts = new Set([
  "回来了，随时可以开始聊。",
  "不知道聊啥",
  "你会坐吗",
  "我没有真实身体，没法真的坐下。",
  "你是谁",
  "我是慢聊小记，一个AI聊天助手。",
  "我没问会不会坐",
  "我也没问你是谁",
  "我不会坐，我是慢聊小记，没话题也没关系。",
  "下班后有什么想聊的？",
  "我最近没上班",
]);

const secretEnvironmentValues = Object.entries(process.env)
  .filter(([name, value]) => /(?:API[_-]?KEY|TOKEN|SECRET|COOKIE|PASSWORD|AUTH)/i.test(name) && value?.trim())
  .map(([, value]) => value!.trim())
  .filter((value) => value.length >= 8);

const assertSafePrompt = ({
  label,
  messages,
}: {
  label: string;
  messages: AiModelMessage[];
}) => {
  const serialized = JSON.stringify(messages);
  if (secretEnvironmentValues.some((secret) => serialized.includes(secret))) {
    throw new Error(`${label}: prompt contains a credential value`);
  }
  if (/(?:authorization|cookie)\s*[:=]\s*(?:bearer\s+)?[a-z0-9._~+/-]{8,}/iu.test(serialized)) {
    throw new Error(`${label}: prompt resembles a credential`);
  }
  if (/Selected user-confirmed memory:|Selected observed context:|rawMemory|database/iu.test(serialized)) {
    throw new Error(`${label}: prompt contains Memory or database-derived content`);
  }
  if (/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?|services\/ai\/|conversation-os\/|\.tsx?:\d+/u.test(serialized)) {
    throw new Error(`${label}: prompt contains source code or logs`);
  }

  for (const message of messages.filter((item) => item.role === "assistant")) {
    if (!syntheticTexts.has(message.content)) {
      throw new Error(`${label}: unapproved assistant history`);
    }
  }
  for (const message of messages.filter((item) => item.role === "user")) {
    if (syntheticTexts.has(message.content)) continue;
    try {
      const payload = JSON.parse(message.content) as {
        currentUserMessage?: string;
        adjacentTurns?: Array<{ role?: string; content?: string }>;
      };
      if (
        !payload.currentUserMessage ||
        !syntheticTexts.has(payload.currentUserMessage) ||
        !Array.isArray(payload.adjacentTurns) ||
        payload.adjacentTurns.some(
          (turn) =>
            (turn.role !== "user" && turn.role !== "assistant") ||
            typeof turn.content !== "string" ||
            !syntheticTexts.has(turn.content)
        )
      ) {
        throw new Error("unapproved structured content");
      }
    } catch {
      throw new Error(`${label}: unapproved user content`);
    }
  }
};

type CapturedPrompt = {
  stage: "turn_interpretation" | "surface_realization" | "ablation";
  label: string;
  messages: AiModelMessage[];
  hash: string;
  preflightPassed: true;
};

const capturedPrompts: CapturedPrompt[] = [];
let authorizedUserTurns = 0;
let externalCallCount = 0;

const capturePrompt = (
  stage: CapturedPrompt["stage"],
  label: string,
  messages: AiModelMessage[]
) => {
  assertSafePrompt({ label, messages });
  const copy = messages.map((message) => ({ ...message }));
  capturedPrompts.push({
    stage,
    label,
    messages: copy,
    hash: sha256(copy),
    preflightPassed: true,
  });
  externalCallCount += 1;
};

const runProductionTurn = async ({
  label,
  conversationId,
  userMessage,
  history,
}: {
  label: string;
  conversationId: string;
  userMessage: string;
  history: AiConversationMessage[];
}) => {
  authorizedUserTurns += 1;
  const turnPrompts: CapturedPrompt[] = [];
  const result = await createChatReply({
    conversationId,
    userId: `synthetic-${conversationId}`,
    userMessage,
    recentMessages: history,
    memoryContext: null,
    understandingContext: null,
    includeDebugTrace: true,
    inspectExternalPrompt: ({ stage, messages }) => {
      capturePrompt(stage, `${label}:${stage}`, messages);
      turnPrompts.push(capturedPrompts[capturedPrompts.length - 1]);
    },
  });
  const surfacePrompt = [...turnPrompts].reverse().find((item) => item.stage === "surface_realization");
  if (!surfacePrompt || !result.controlTrace) {
    throw new Error(`${label}: missing Surface Prompt or control trace`);
  }
  syntheticTexts.add(result.generation.text);
  return {
    label,
    conversationId,
    userMessage,
    history: history.map((message) => ({ ...message })),
    prompts: turnPrompts,
    promptHash: surfacePrompt.hash,
    planHash: sha256(result.controlTrace.responsePlan),
    controlTrace: result.controlTrace,
    generationAttempts: result.generationAttempts,
    rawOutput: result.generation.rawLLMOutput ?? result.generation.text,
    validator: result.controlTrace.validation,
    finalOutput: result.generation.text,
    finalSource: result.finalSource,
    rawEqualsFinal:
      (result.generation.rawLLMOutput ?? result.generation.text) === result.generation.text,
  };
};

const runDirectAblation = async ({
  label,
  messages,
  plan,
}: {
  label: string;
  messages: AiModelMessage[];
  plan: ResponsePlan;
}) => {
  authorizedUserTurns += 1;
  capturePrompt("ablation", label, messages);
  const result = await callModel({
    model: configuredModel,
    messages,
    temperature: 0.75,
  });
  const validation = validateResponsePlanOutput({ plan, reply: result.text });
  syntheticTexts.add(result.text);
  return {
    label,
    messages,
    promptHash: sha256(messages),
    planHash: sha256(plan),
    model: result.model,
    parameters: {
      temperature: 0.75,
      enableThinking: false,
      topP: "unset",
      seed: "unset",
    },
    rawOutput: result.text,
    validator: validation,
    finalOutput: validation.passed ? result.text : null,
    rawEqualsFinal: validation.passed,
  };
};

const assistant = (content: string, promptVersion = CHAT_PROMPT_VERSION): AiConversationMessage => ({
  role: "assistant",
  content,
  promptVersion,
});
const user = (content: string): AiConversationMessage => ({ role: "user", content });

const buildMinimalSurfaceMessages = (
  productionMessages: AiModelMessage[],
  plan: ResponsePlan
): AiModelMessage[] => {
  const conversationMessages = productionMessages.filter(
    (message) => message.role === "user" || message.role === "assistant"
  );
  return [
    {
      role: "developer",
      content: [
        "你是慢聊小记的 AI 聊天助手，只能依据当前文字对话回应。",
        "严格实现给定 ResponsePlan，使用自然、简洁的中文。",
        "不得虚构身体、身份、感知或现实能力；不要主动枚举与本轮无关的边界。",
      ].join("\n"),
    },
    { role: "developer", content: formatResponsePlanForPrompt(plan) },
    ...conversationMessages,
  ];
};

const removeAvailableFactsFromProduction = (
  productionMessages: AiModelMessage[]
): AiModelMessage[] =>
  productionMessages.map((message, index) => {
    if (index !== 0 || message.role !== "developer") return { ...message };
    return {
      ...message,
      content: message.content.replace(
        /^【Assistant Grounding】[\s\S]*?(?=始终用自然、简短的中文回应。)/u,
        ""
      ),
    };
  });

const runPre = async () => {
  const greeting = assistant("回来了，随时可以开始聊。", "chat-proactive-greeting-v2");
  const bodyPair = [
    user("你会坐吗"),
    assistant("我没有真实身体，没法真的坐下。"),
  ];
  const identityPair = [
    user("你是谁"),
    assistant("我是慢聊小记，一个AI聊天助手。"),
  ];
  const legacyBodyPair = [
    user("你会坐吗"),
    assistant("我没有真实身体，没法真的坐下。", "chat-response-plan-v13"),
  ];
  const legacyIdentityPair = [
    user("你是谁"),
    assistant("我是慢聊小记，一个AI聊天助手。", "chat-response-plan-v13"),
  ];

  const scenarioA = await runProductionTurn({
    label: "A_new_conversation",
    conversationId: "synthetic-grounding-pre-a",
    userMessage: "不知道聊啥",
    history: [greeting],
  });
  const scenarioB = await runProductionTurn({
    label: "B_answered_body_then_no_topic",
    conversationId: "synthetic-grounding-pre-b",
    userMessage: "不知道聊啥",
    history: [...bodyPair],
  });
  const scenarioC = await runProductionTurn({
    label: "C_answered_identity_then_no_topic",
    conversationId: "synthetic-grounding-pre-c",
    userMessage: "不知道聊啥",
    history: [...identityPair],
  });

  const dHistory: AiConversationMessage[] = [
    ...legacyBodyPair,
    ...legacyIdentityPair,
    greeting,
  ];
  const d1 = await runProductionTurn({
    label: "D1_resumed_no_topic",
    conversationId: "synthetic-grounding-pre-d",
    userMessage: "不知道聊啥",
    history: dHistory,
  });
  dHistory.push(user("不知道聊啥"), assistant(d1.finalOutput));
  const d2 = await runProductionTurn({
    label: "D2_first_correction",
    conversationId: "synthetic-grounding-pre-d",
    userMessage: "我没问会不会坐",
    history: dHistory,
  });
  dHistory.push(user("我没问会不会坐"), assistant(d2.finalOutput));
  const d3 = await runProductionTurn({
    label: "D3_second_correction",
    conversationId: "synthetic-grounding-pre-d",
    userMessage: "我也没问你是谁",
    history: dHistory,
  });

  const d1Surface = d1.prompts.find((item) => item.stage === "surface_realization");
  if (!d1Surface) throw new Error("D1 Surface Prompt missing");
  const minimalSurface = await runDirectAblation({
    label: "ABLATION_C_minimal_surface_same_plan",
    messages: buildMinimalSurfaceMessages(d1Surface.messages, d1.controlTrace.responsePlan),
    plan: d1.controlTrace.responsePlan,
  });
  const noAvailableFacts = await runDirectAblation({
    label: "ABLATION_D_remove_available_facts_same_plan",
    messages: removeAvailableFactsFromProduction(d1Surface.messages),
    plan: d1.controlTrace.responsePlan,
  });

  return {
    production: [scenarioA, scenarioB, scenarioC, d1, d2, d3],
    ablations: [minimalSurface, noAvailableFacts],
    cacheControl: {
      externalCallConsumed: false,
      serverResponseCacheImplemented: false,
      evidence:
        "POST always reads database history and invokes orchestration; browser sessionStorage is UI hydration only.",
    },
  };
};

const runPost = async () => {
  const greeting = assistant("回来了，随时可以开始聊。", "chat-proactive-greeting-v2");
  const newConversation = await runProductionTurn({
    label: "POST_A_new_conversation",
    conversationId: "synthetic-grounding-post-a",
    userMessage: "不知道聊啥",
    history: [greeting],
  });
  const afterBody = await runProductionTurn({
    label: "POST_B_answered_body_then_no_topic",
    conversationId: "synthetic-grounding-post-b",
    userMessage: "不知道聊啥",
    history: [user("你会坐吗"), assistant("我没有真实身体，没法真的坐下。")],
  });
  const afterIdentity = await runProductionTurn({
    label: "POST_C_answered_identity_then_no_topic",
    conversationId: "synthetic-grounding-post-c",
    userMessage: "不知道聊啥",
    history: [user("你是谁"), assistant("我是慢聊小记，一个AI聊天助手。")],
  });
  const correction = await runProductionTurn({
    label: "POST_D_irrelevance_correction",
    conversationId: "synthetic-grounding-post-d",
    userMessage: "我没问会不会坐",
    history: [
      greeting,
      user("不知道聊啥"),
      assistant("我不会坐，我是慢聊小记，没话题也没关系。"),
    ],
  });
  return { production: [newConversation, afterBody, afterIdentity, correction], ablations: [] };
};

const main = async () => {
  const results = phase === "pre" ? await runPre() : await runPost();
  const maxTurns = phase === "pre" ? 8 : 4;
  if (authorizedUserTurns > maxTurns) {
    throw new Error(`${phase}: authorized turn cap exceeded (${authorizedUserTurns}/${maxTurns})`);
  }
  const artifact = {
    generatedAt: new Date().toISOString(),
    phase,
    authorization: {
      provider: "qwen/DashScope",
      model: configuredModel,
      syntheticUserTurnCap: maxTurns,
      syntheticUserTurnsUsed: authorizedUserTurns,
      externalCallsIncludingInterpretation: externalCallCount,
      excluded: [
        "real user history",
        "user/session identifiers",
        "database",
        "Memory",
        "source code",
        "logs",
        "credentials",
        "cookies",
      ],
    },
    modelParameters: {
      surfaceTemperature: 0.75,
      interpretationTemperature: 0.1,
      enableThinking: false,
      topP: "unset",
      seed: "unset",
    },
    results,
    capturedPrompts,
  };
  mkdirSync(dirname(outputJson), { recursive: true });
  writeFileSync(outputJson, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  const allTurns = [...results.production, ...results.ablations];
  writeFileSync(
    outputMarkdown,
    [
      `# Conversation Grounding Leak — ${phase.toUpperCase()} A/B`,
      "",
      `Generated: ${artifact.generatedAt}`,
      `Provider/model: qwen/DashScope ${configuredModel}`,
      `Synthetic user turns: ${authorizedUserTurns}/${maxTurns}`,
      `External calls including interpretation: ${externalCallCount}`,
      "",
      ...allTurns.flatMap((turn) => [
        `## ${turn.label}`,
        "",
        `- Prompt hash: ${turn.promptHash}`,
        `- Plan hash: ${turn.planHash}`,
        `- Dialogue act: ${"controlTrace" in turn ? turn.controlTrace.interpretation.primaryDialogueAct : "same as D1"}`,
        `- Required disclosure: ${"controlTrace" in turn ? JSON.stringify(turn.controlTrace.responsePlan.requiredDisclosure) : "same as D1"}`,
        `- Raw: ${turn.rawOutput}`,
        `- Validator: ${JSON.stringify(turn.validator)}`,
        `- Final: ${turn.finalOutput ?? "rejected"}`,
        `- raw===final: ${turn.rawEqualsFinal}`,
        "",
      ]),
    ].join("\n"),
    "utf8"
  );
  console.log(
    JSON.stringify(
      {
        phase,
        outputJson,
        outputMarkdown,
        userTurns: authorizedUserTurns,
        externalCalls: externalCallCount,
        outputs: allTurns.map((turn) => ({
          label: turn.label,
          raw: turn.rawOutput,
          final: turn.finalOutput,
          promptHash: turn.promptHash,
        })),
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
