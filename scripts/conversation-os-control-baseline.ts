import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadEnvConfig } from "@next/env";

import { createChatReply } from "../services/ai/chatOrchestrationService";
import { getAiProvider, getDefaultAiModel, isAiProviderConfigured } from "../services/ai/modelProvider";
import type { AiConversationMessage, AiModelMessage } from "../services/ai/types";
import { inspectActiveAnswerFrame } from "../services/clinical/semanticEvidence";

loadEnvConfig(process.cwd());

const roundArgument = process.argv.find((argument) => argument.startsWith("--round="));
const round = roundArgument ? Number(roundArgument.slice("--round=".length)) : 1;
if (!Number.isInteger(round) || round < 1 || round > 3) {
  throw new Error("--round must be an integer from 1 to 3.");
}
const ROUND_SUFFIX = round === 1 ? "" : `-round-${round}`;
const JSON_OUTPUT = `docs/evals/conversation-os-control-baseline-post${ROUND_SUFFIX}.json`;
const MARKDOWN_OUTPUT = `docs/evals/conversation-os-control-baseline-post${ROUND_SUFFIX}.md`;

type Scenario = {
  id: "A" | "B";
  initialAssistant: string;
  userTurns: string[];
};

const scenarios: Scenario[] = [
  {
    id: "A",
    initialAssistant: "夜深了，有什么想慢慢说的都可以留在这里。",
    userTurns: ["我想不到说什么耶"],
  },
  {
    id: "B",
    initialAssistant: "凌晨两点多还醒着，这里可以陪你坐一会儿。",
    userTurns: ["你会坐吗", "你是谁", "那你怎么不会说话", "接住是什么意思"],
  },
];

const serializePrompt = (messages: AiModelMessage[]) =>
  messages.map((message, index) => ({ index, role: message.role, content: message.content }));

const secretEnvironmentValues = Object.entries(process.env)
  .filter(([name, value]) => /(?:API[_-]?KEY|TOKEN|SECRET|COOKIE|PASSWORD|AUTH)/i.test(name) && value?.trim())
  .map(([, value]) => value!.trim())
  .filter((value) => value.length >= 8);

const assertAuthorizedPrompt = ({
  stage,
  messages,
  approvedConversationTexts,
}: {
  stage: "turn_interpretation" | "surface_realization" | "interaction_move_handoff_validation";
  messages: AiModelMessage[];
  approvedConversationTexts: Set<string>;
}) => {
  const serialized = JSON.stringify(messages);
  if (secretEnvironmentValues.some((secret) => serialized.includes(secret))) {
    throw new Error("Preflight rejected the prompt because it contains a credential value.");
  }
  if (/(?:authorization|cookie)\s*[:=]\s*(?:bearer\s+)?[a-z0-9._~+/-]{8,}/iu.test(serialized)) {
    throw new Error("Preflight rejected the prompt because it resembles an authorization credential.");
  }
  if (/Selected user-confirmed memory:|Selected observed context:|rawMemory|database/iu.test(serialized)) {
    throw new Error("Preflight rejected memory or database-derived content.");
  }

  if (stage === "turn_interpretation") {
    const userMessages = messages.filter((message) => message.role === "user");
    if (userMessages.length !== 1) throw new Error("Preflight rejected unexpected Turn Interpretation user-message count.");
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(userMessages[0].content) as Record<string, unknown>;
    } catch {
      throw new Error("Preflight rejected malformed Turn Interpretation payload.");
    }
    const allowedKeys = new Set([
      "currentUserMessage",
      "adjacentTurns",
      "interactionEvidence",
      "semanticEvidence",
      "repairSignal",
    ]);
    if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
      throw new Error("Preflight rejected an unexpected Turn Interpretation payload field.");
    }
    if (typeof payload.currentUserMessage !== "string" || !approvedConversationTexts.has(payload.currentUserMessage)) {
      throw new Error("Preflight rejected unapproved current-user content in Turn Interpretation.");
    }
    if (!Array.isArray(payload.adjacentTurns) || payload.adjacentTurns.some((turn) => {
      if (!turn || typeof turn !== "object") return true;
      const candidate = turn as Record<string, unknown>;
      return !["user", "assistant"].includes(String(candidate.role)) ||
        typeof candidate.content !== "string" ||
        !approvedConversationTexts.has(candidate.content) ||
        Object.keys(candidate).some((key) => !["role", "content"].includes(key));
    })) {
      throw new Error("Preflight rejected unapproved adjacent-turn content in Turn Interpretation.");
    }
    return;
  }

  const conversationalMessages = messages.filter((message) => message.role === "user" || message.role === "assistant");
  for (const message of conversationalMessages) {
    if (!approvedConversationTexts.has(message.content)) {
      throw new Error(`Preflight rejected unapproved conversation content in ${message.role} history.`);
    }
  }
};

const run = async () => {
  if (!process.argv.includes("--authorized-post")) {
    throw new Error("Post-refactor external baseline is locked. Run only after explicit authorization with --authorized-post.");
  }
  if (!isAiProviderConfigured()) {
    throw new Error("A real AI provider is required for the post-refactor baseline trace.");
  }
  const configuredModel = process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel();
  if (getAiProvider() !== "qwen" || !configuredModel.includes("qwen3.7-max")) {
    throw new Error("This controlled A/B trace is restricted to Qwen/DashScope qwen3.7-max.");
  }

  const results = [];
  for (const scenario of scenarios) {
    const recentMessages: AiConversationMessage[] = [
      { role: "assistant", content: scenario.initialAssistant },
    ];
    const turns = [];

    for (let index = 0; index < scenario.userTurns.length; index += 1) {
      const userMessage = scenario.userTurns[index];
      const inputContext = recentMessages.map((message) => ({ ...message }));
      const conversationId = `conversation-os-control-baseline-${scenario.id.toLowerCase()}`;
      const approvedConversationTexts = new Set([
        scenario.initialAssistant,
        ...scenario.userTurns,
        ...inputContext.map((message) => message.content),
        userMessage,
      ]);
      const inspectedPrompts: Array<{
        stage: "turn_interpretation" | "surface_realization" | "interaction_move_handoff_validation";
        messages: AiModelMessage[];
      }> = [];
      const activeAnswerFrame = inspectActiveAnswerFrame({ userTurn: userMessage, recentMessages: inputContext });
      const result = await createChatReply({
        conversationId,
        userId: "conversation-os-control-baseline-user",
        userMessage,
        recentMessages: inputContext,
        includeDebugTrace: true,
        inspectExternalPrompt: ({ stage, messages }) => {
          assertAuthorizedPrompt({ stage, messages, approvedConversationTexts });
          inspectedPrompts.push({ stage, messages: messages.map((message) => ({ ...message })) });
        },
      });
      const clinicalPlan = result.clinicalTrace.selectedPlan ?? null;
      const surfacePrompt = [...inspectedPrompts].reverse().find((item) => item.stage === "surface_realization");
      if (!surfacePrompt) throw new Error("Preflight inspector did not observe the real surface prompt.");

      turns.push({
        turn: index + 1,
        userMessage,
        inputContext,
        activeAnswerFrame,
        semanticEvidence: result.controlTrace?.context.semanticEvidence ?? result.clinicalTrace.signals.semanticEvidence,
        clinicalContext: {
          conversationState: result.clinicalTrace.conversationState,
          signals: result.clinicalTrace.signals,
          memoryUsed: result.clinicalTrace.memoryUsed,
          safetyDecision: result.clinicalTrace.safetyDecision,
        },
        clinicalPlan,
        controlTrace: result.controlTrace ?? null,
        promptInput: serializePrompt(surfacePrompt.messages),
        inspectedExternalPrompts: inspectedPrompts.map((item) => ({
          stage: item.stage,
          messages: serializePrompt(item.messages),
        })),
        promptPreflight: {
          passed: true,
          excluded: ["credentials", "real user data", "database content", "memory", "unrelated project data"],
          externalCallCount: inspectedPrompts.length,
          messageCount: inspectedPrompts.reduce((total, item) => total + item.messages.length, 0),
        },
        generation: {
          model: result.generation.model,
          latencyMs: result.generation.latencyMs,
          rawLLMOutput: result.generation.rawLLMOutput ?? null,
          postProcessSteps: result.generation.postProcessSteps ?? [],
          finalReplySource: result.generation.finalReplySource ?? result.finalSource,
          tokenInput: result.generation.tokenInput ?? null,
          tokenOutput: result.generation.tokenOutput ?? null,
          attempts: result.generationAttempts.map((attempt, attemptIndex) => ({
            attempt: attemptIndex + 1,
            model: attempt.model,
            latencyMs: attempt.latencyMs,
            rawLLMOutput: attempt.rawLLMOutput ?? attempt.text,
            finalReplySource: attempt.finalReplySource ?? null,
            tokenInput: attempt.tokenInput ?? null,
            tokenOutput: attempt.tokenOutput ?? null,
          })),
        },
        route: result.debugTrace?.route ?? {
          finalSource: result.finalSource,
          fallbackUsed: result.fallbackUsed,
          rewriteAttempted: result.rewriteAttempted,
          regenerateAttempted: result.regenerateAttempted,
        },
        finalUserVisibleOutput: result.generation.text,
      });

      recentMessages.push({ role: "user", content: userMessage });
      recentMessages.push({
        role: "assistant",
        content: result.generation.text,
        promptVersion: result.generation.promptVersion,
      });
    }

    results.push({
      scenario: scenario.id,
      initialAssistant: scenario.initialAssistant,
      turns,
    });
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    phase: "post_refactor",
    round,
    provider: getAiProvider(),
    configuredModel,
    providerConfigured: true,
    scenarios: results,
  };
  mkdirSync(dirname(JSON_OUTPUT), { recursive: true });
  writeFileSync(JSON_OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const markdown = [
    "# Conversation OS Control Baseline — Post-refactor",
    "",
    `Generated at: ${artifact.generatedAt}`,
    `Round: ${artifact.round}`,
    `Provider/model: ${artifact.provider}:${artifact.configuredModel}`,
    "",
    ...results.flatMap((scenario) => [
      `## Scenario ${scenario.scenario}`,
      "",
      `Initial assistant: ${scenario.initialAssistant}`,
      "",
      ...scenario.turns.flatMap((turn) => [
        `### Turn ${turn.turn}`,
        "",
        `- User: ${turn.userMessage}`,
        `- Active Answer Frame: ${turn.activeAnswerFrame.frame?.type ?? "none"}; compatible=${turn.activeAnswerFrame.compatible}`,
        `- Semantic Evidence: ${turn.semanticEvidence.status}/${turn.semanticEvidence.source}`,
        `- Conversation OS: ${turn.controlTrace?.responsePlan.decisionOwner ?? "none"} / ${turn.controlTrace?.interpretation.primaryDialogueAct ?? "none"}`,
        `- Clinical: ${turn.clinicalPlan?.responseGoal ?? "none"} / ${turn.clinicalPlan?.responseIntent ?? "none"} / ${turn.clinicalPlan?.primaryStrategy ?? "none"} / ${turn.clinicalPlan?.questionFunction ?? "none"}`,
        `- Interaction: ${JSON.stringify(turn.clinicalContext.signals.interaction)}`,
        `- Route: ${JSON.stringify(turn.route)}`,
        `- Raw LLM: ${turn.generation.rawLLMOutput ?? "(none)"}`,
        `- Generation attempts: ${JSON.stringify(turn.generation.attempts)}`,
        `- Final: ${turn.finalUserVisibleOutput}`,
        "",
      ]),
    ]),
    "Full prompt inputs and structured traces are stored in the JSON artifact.",
    "",
  ].join("\n");
  writeFileSync(MARKDOWN_OUTPUT, markdown, "utf8");

  console.log(JSON.stringify({ JSON_OUTPUT, MARKDOWN_OUTPUT, scenarios: results.length, turns: results.flatMap((item) => item.turns).length }, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
