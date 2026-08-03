import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadEnvConfig } from "@next/env";

import { createChatReply } from "../services/ai/chatOrchestrationService";
import { callModel, getAiProvider, getDefaultAiModel, isAiProviderConfigured } from "../services/ai/modelProvider";
import {
  formatResponsePlanForPrompt,
  sanitizeChatHistory,
} from "../services/ai/promptBuilder";
import type {
  AiConversationMessage,
  AiModelMessage,
} from "../services/ai/types";
import type { ResponsePlan } from "../conversation-os/control";

loadEnvConfig(process.cwd());

const isPostFix = process.argv.includes("--post-fix");
const artifactLabel = isPostFix ? "post-fix" : "pre-fix";
const OUTPUT_JSON = `docs/evals/natural-chat-ablation-${artifactLabel}.json`;
const OUTPUT_MARKDOWN = `docs/evals/natural-chat-ablation-${artifactLabel}.md`;
const TEMPERATURE = 0.75;
const SAMPLES_PER_TURN = 2;

type FixedTurn = {
  id: string;
  user: string;
  observedAssistant: string;
};

const initialAssistant = "夜深了，有什么想慢慢说的都可以留在这里。";
const fixedTurns: FixedTurn[] = [
  {
    id: "T1_NO_TOPIC",
    user: "我想不到说什么耶",
    observedAssistant: "没关系，不用特意找话题。最近有没有什么小事让你觉得还不错的？",
  },
  {
    id: "T2_EXAMPLE_REQUEST",
    user: "比如呢",
    observedAssistant: "比如喝到一杯温度刚好的茶，或者下班路上刚好看到很美的晚霞。",
  },
  {
    id: "T3_CORRECTION",
    user: "我最近没上班",
    observedAssistant: "那也可以是睡到自然醒，或者安静地发会儿呆。不用上班的日子里，有没有哪个瞬间让你觉得挺舒服的？",
  },
  {
    id: "T4_ANSWER",
    user: "睡到自然醒吧",
    observedAssistant: "自然醒确实舒服，身体自己决定什么时候起……",
  },
];

const syntheticTexts = new Set([
  initialAssistant,
  ...fixedTurns.flatMap((turn) => [turn.user, turn.observedAssistant]),
]);

const secretEnvironmentValues = Object.entries(process.env)
  .filter(([name, value]) => /(?:API[_-]?KEY|TOKEN|SECRET|COOKIE|PASSWORD|AUTH)/i.test(name) && value?.trim())
  .map(([, value]) => value!.trim())
  .filter((value) => value.length >= 8);

const assertPromptAllowed = ({
  stage,
  messages,
}: {
  stage: string;
  messages: AiModelMessage[];
}) => {
  const serialized = JSON.stringify(messages);
  if (secretEnvironmentValues.some((secret) => serialized.includes(secret))) {
    throw new Error(`${stage}: prompt contains a credential value`);
  }
  if (/(?:authorization|cookie)\s*[:=]\s*(?:bearer\s+)?[a-z0-9._~+/-]{8,}/iu.test(serialized)) {
    throw new Error(`${stage}: prompt resembles a credential`);
  }
  if (/Selected user-confirmed memory:|Selected observed context:|rawMemory|database/iu.test(serialized)) {
    throw new Error(`${stage}: prompt contains Memory or database-derived content`);
  }
  if (/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?|services\/ai\/|conversation-os\/|\.tsx?:\d+/u.test(serialized)) {
    throw new Error(`${stage}: prompt contains source-code or log-like content`);
  }
  for (const message of messages.filter((item) => item.role === "user" || item.role === "assistant")) {
    if (!syntheticTexts.has(message.content)) {
      if (stage === "turn_interpretation" && message.role === "user") {
        const parsed = JSON.parse(message.content) as {
          currentUserMessage?: unknown;
          adjacentTurns?: Array<{ role?: unknown; content?: unknown }>;
        };
        if (
          typeof parsed.currentUserMessage === "string" &&
          syntheticTexts.has(parsed.currentUserMessage) &&
          Array.isArray(parsed.adjacentTurns) &&
          parsed.adjacentTurns.every(
            (turn) =>
              (turn.role === "user" || turn.role === "assistant") &&
              typeof turn.content === "string" &&
              syntheticTexts.has(turn.content)
          )
        ) {
          continue;
        }
      }
      throw new Error(`${stage}: prompt contains unapproved conversation content`);
    }
  }
};

const buildHistoryBefore = (turnIndex: number): AiConversationMessage[] => {
  const history: AiConversationMessage[] = [
    { role: "assistant", content: initialAssistant },
  ];
  for (const turn of fixedTurns.slice(0, turnIndex)) {
    history.push(
      { role: "user", content: turn.user },
      { role: "assistant", content: turn.observedAssistant }
    );
  }
  return history;
};

const buildMinimalSurfaceMessages = ({
  userMessage,
  recentMessages,
  responsePlan,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  responsePlan: ResponsePlan;
}): AiModelMessage[] => {
  const { included } = sanitizeChatHistory({ userMessage, recentMessages });
  return [
    {
      role: "developer",
      content: [
        "你是慢聊小记的 AI 聊天助手，只能通过文字交流，不是人类或心理专业人员。",
        "严格完成下面唯一的 ResponsePlan；不要另选目标，不要虚构事实或能力。",
        "遵守计划中的必要安全和身份边界。",
        "使用自然、简洁的中文回应。",
      ].join("\n"),
    },
    {
      role: "developer",
      content: formatResponsePlanForPrompt(responsePlan),
    },
    ...included,
    { role: "user", content: userMessage },
  ];
};

const buildModelControlMessages = ({
  userMessage,
  recentMessages,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
}): AiModelMessage[] => {
  const { included } = sanitizeChatHistory({ userMessage, recentMessages });
  return [
    {
      role: "developer",
      content: [
        "你是慢聊小记的 AI 聊天助手，只能通过文字交流，不是人类或心理专业人员。",
        "不要虚构身体、感知、身份、用户事实或现实能力。",
        "如有安全风险，优先保护用户安全。",
        "直接、自然、简洁地回应用户。",
      ].join("\n"),
    },
    ...included,
    { role: "user", content: userMessage },
  ];
};

const modelParameters = {
  temperature: TEMPERATURE,
  top_p: null,
  seed: null,
  enable_thinking: false,
  note: "Current project adapter does not set top_p or seed.",
};

const callDiagnosticSurface = async ({
  stage,
  messages,
  configuredModel,
}: {
  stage: string;
  messages: AiModelMessage[];
  configuredModel: string;
}) => {
  assertPromptAllowed({ stage, messages });
  const result = await callModel({
    model: configuredModel,
    messages,
    temperature: TEMPERATURE,
  });
  return {
    request: { messages, parameters: modelParameters },
    response: {
      model: result.model,
      rawOutput: result.text,
      latencyMs: result.latencyMs,
      tokenInput: result.tokenInput ?? null,
      tokenOutput: result.tokenOutput ?? null,
      providerReasoning: result.providerReasoning ?? null,
    },
  };
};

const runDynamicProduction = async (configuredModel: string) => {
  const trajectories = [];
  for (let sample = 1; sample <= SAMPLES_PER_TURN; sample += 1) {
    const recentMessages: AiConversationMessage[] = [
      { role: "assistant", content: initialAssistant },
    ];
    const turns = [];
    for (const turn of fixedTurns) {
      const inspectedPrompts: Array<{ stage: string; messages: AiModelMessage[] }> = [];
      const production = await createChatReply({
        conversationId: `natural-chat-dynamic-post-${sample}`,
        userId: "synthetic-natural-chat-dynamic-validation",
        userMessage: turn.user,
        recentMessages,
        memoryContext: null,
        includeDebugTrace: true,
        inspectExternalPrompt: ({ stage, messages }) => {
          assertPromptAllowed({ stage, messages });
          inspectedPrompts.push({
            stage,
            messages: messages.map((message) => ({ ...message })),
          });
        },
      });
      if (!production.controlTrace) throw new Error(`${turn.id}: dynamic production control trace missing`);
      syntheticTexts.add(production.generation.text);
      turns.push({
        id: turn.id,
        user: turn.user,
        request: {
          history: recentMessages.map((message) => ({ ...message })),
          inspectedPrompts,
          parameters: modelParameters,
          memoryInput: null,
        },
        trace: production.controlTrace,
        clinicalTrace: production.clinicalTrace,
        generationAttempts: production.generationAttempts,
        rawOutput: production.generation.rawLLMOutput ?? production.generation.text,
        finalOutput: production.generation.text,
        route: production.debugTrace?.route ?? {
          finalSource: production.finalSource,
          fallbackUsed: production.fallbackUsed,
          rewriteAttempted: production.rewriteAttempted,
          regenerateAttempted: production.regenerateAttempted,
        },
      });
      recentMessages.push(
        { role: "user", content: turn.user },
        {
          role: "assistant",
          content: production.generation.text,
          promptVersion: production.generation.promptVersion,
        }
      );
    }
    trajectories.push({ sample, turns });
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    phase: "post_fix_dynamic_production_validation",
    provider: getAiProvider(),
    configuredModel,
    samplesPerTurn: SAMPLES_PER_TURN,
    parameters: modelParameters,
    memoryPolicy: "Explicit null; no database or real-user Memory was loaded.",
    initialAssistant,
    trajectories,
  };
  const outputJson = "docs/evals/natural-chat-production-post-fix.json";
  const outputMarkdown = "docs/evals/natural-chat-production-post-fix.md";
  mkdirSync(dirname(outputJson), { recursive: true });
  writeFileSync(outputJson, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  const markdown = [
    "# Natural Chat Dynamic Production Validation — Post-fix",
    "",
    `Generated: ${artifact.generatedAt}`,
    `Provider/model: ${artifact.provider}:${artifact.configuredModel}`,
    `Parameters: ${JSON.stringify(modelParameters)}`,
    `Memory: ${artifact.memoryPolicy}`,
    "",
    ...trajectories.flatMap((trajectory) => [
      `## Trajectory ${trajectory.sample}`,
      "",
      `Assistant: ${initialAssistant}`,
      "",
      ...trajectory.turns.flatMap((turn) => [
        `User: ${turn.user}`,
        "",
        `Assistant: ${turn.finalOutput}`,
        "",
        `- act: ${turn.trace.interpretation.primaryDialogueAct}`,
        `- actions: ${turn.trace.responsePlan.responseActions.join(" / ")}`,
        `- questionPolicy: ${JSON.stringify(turn.trace.responsePlan.questionPolicy)}`,
        `- Clinical invoked: ${turn.trace.clinicalInvoked}`,
        `- route: ${JSON.stringify(turn.route)}`,
        "",
      ]),
    ]),
    "Full requests, traces, raw outputs, validation attempts and parameters are in the JSON artifact.",
    "",
  ].join("\n");
  writeFileSync(outputMarkdown, markdown, "utf8");
  console.log(JSON.stringify({
    OUTPUT_JSON: outputJson,
    OUTPUT_MARKDOWN: outputMarkdown,
    trajectories: trajectories.length,
    userTurns: trajectories.length * fixedTurns.length,
  }, null, 2));
};

const run = async () => {
  if (!process.argv.includes("--authorized-real-model")) {
    throw new Error("Real-model diagnostic is locked; pass --authorized-real-model only for the approved synthetic ablation.");
  }
  if (!isAiProviderConfigured()) throw new Error("A configured real model provider is required.");
  const configuredModel = process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel();
  if (getAiProvider() !== "qwen" || !configuredModel.includes("qwen3.7-max")) {
    throw new Error("Diagnostic is restricted to Qwen/DashScope qwen3.7-max.");
  }
  if (process.argv.includes("--dynamic-production")) {
    await runDynamicProduction(configuredModel);
    return;
  }

  const results = [];
  for (let turnIndex = 0; turnIndex < fixedTurns.length; turnIndex += 1) {
    const turn = fixedTurns[turnIndex];
    const recentMessages = buildHistoryBefore(turnIndex);
    const samples = [];
    for (let sample = 1; sample <= SAMPLES_PER_TURN; sample += 1) {
      const inspectedPrompts: Array<{ stage: string; messages: AiModelMessage[] }> = [];
      const production = await createChatReply({
        conversationId: `natural-chat-ablation-${turn.id.toLowerCase()}-${sample}`,
        userId: "synthetic-natural-chat-ablation",
        userMessage: turn.user,
        recentMessages,
        memoryContext: null,
        includeDebugTrace: true,
        inspectExternalPrompt: ({ stage, messages }) => {
          assertPromptAllowed({ stage, messages });
          inspectedPrompts.push({
            stage,
            messages: messages.map((message) => ({ ...message })),
          });
        },
      });
      if (!production.controlTrace) throw new Error(`${turn.id}: production control trace missing`);
      const productionSurfacePrompt = [...inspectedPrompts]
        .reverse()
        .find((item) => item.stage === "surface_realization");
      if (!productionSurfacePrompt) throw new Error(`${turn.id}: production surface prompt missing`);

      const minimalMessages = buildMinimalSurfaceMessages({
        userMessage: turn.user,
        recentMessages,
        responsePlan: production.controlTrace.responsePlan,
      });
      const controlMessages = buildModelControlMessages({
        userMessage: turn.user,
        recentMessages,
      });
      const minimal = await callDiagnosticSurface({
        stage: `minimal_surface:${turn.id}:${sample}`,
        messages: minimalMessages,
        configuredModel,
      });
      const modelControl = await callDiagnosticSurface({
        stage: `model_control:${turn.id}:${sample}`,
        messages: controlMessages,
        configuredModel,
      });

      samples.push({
        sample,
        production: {
          request: {
            inspectedPrompts,
            surfacePrompt: productionSurfacePrompt.messages,
            parameters: modelParameters,
            memoryInput: null,
          },
          trace: production.controlTrace,
          clinicalTrace: production.clinicalTrace,
          generationAttempts: production.generationAttempts,
          validator: production.controlTrace.validation,
          route: production.debugTrace?.route ?? {
            finalSource: production.finalSource,
            fallbackUsed: production.fallbackUsed,
            rewriteAttempted: production.rewriteAttempted,
            regenerateAttempted: production.regenerateAttempted,
          },
          rawOutput: production.generation.rawLLMOutput ?? null,
          finalOutput: production.generation.text,
        },
        minimalSurface: minimal,
        modelControl,
      });
    }
    results.push({
      id: turn.id,
      user: turn.user,
      fixedHistory: recentMessages,
      observedAssistant: turn.observedAssistant,
      samples,
    });
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    phase: isPostFix ? "post_fix_validation" : "pre_fix_diagnosis",
    provider: getAiProvider(),
    configuredModel,
    samplesPerTurn: SAMPLES_PER_TURN,
    parameters: modelParameters,
    memoryPolicy: "Explicit null; no database or real-user Memory was loaded.",
    turns: results,
  };
  mkdirSync(dirname(OUTPUT_JSON), { recursive: true });
  writeFileSync(OUTPUT_JSON, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const markdown = [
    `# Natural Chat Ablation — ${isPostFix ? "Post-fix" : "Pre-fix"}`,
    "",
    `Generated: ${artifact.generatedAt}`,
    `Provider/model: ${artifact.provider}:${artifact.configuredModel}`,
    `Parameters: ${JSON.stringify(modelParameters)}`,
    `Memory: ${artifact.memoryPolicy}`,
    "",
    ...results.flatMap((turn) => [
      `## ${turn.id} — ${turn.user}`,
      "",
      `Observed assistant: ${turn.observedAssistant}`,
      "",
      ...turn.samples.flatMap((sample) => [
        `### Sample ${sample.sample}`,
        "",
        `- Production act: ${sample.production.trace.interpretation.primaryDialogueAct}`,
        `- Production actions: ${sample.production.trace.responsePlan.responseActions.join(" / ")}`,
        `- Question policy: ${JSON.stringify(sample.production.trace.responsePlan.questionPolicy)}`,
        `- Clinical invoked: ${sample.production.trace.clinicalInvoked}`,
        `- Production raw: ${sample.production.rawOutput}`,
        `- Production final: ${sample.production.finalOutput}`,
        `- Minimal Surface: ${sample.minimalSurface.response.rawOutput}`,
        `- Model Control: ${sample.modelControl.response.rawOutput}`,
        "",
      ]),
    ]),
    "Full requests, traces, raw outputs and parameters are in the JSON artifact.",
    "",
  ].join("\n");
  writeFileSync(OUTPUT_MARKDOWN, markdown, "utf8");
  console.log(JSON.stringify({
    OUTPUT_JSON,
    OUTPUT_MARKDOWN,
    turns: results.length,
    samplesPerTurn: SAMPLES_PER_TURN,
    surfaceCalls: results.length * SAMPLES_PER_TURN * 3,
  }, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
