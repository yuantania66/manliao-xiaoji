import assert from "node:assert/strict";

import type { InteractionMoveHandoffPlan, ResponseAction, ResponsePlan } from "../conversation-os/control";
import {
  defaultInteractionMoveHandoffSemanticProvider,
  type InteractionMoveHandoffSemanticProviderInput,
  validateInteractionMoveHandoffOutput,
} from "../services/ai/interactionMoveHandoffOutputValidator";
import { callModel } from "../services/ai/modelProvider";
import { buildChatPrompt } from "../services/ai/promptBuilder";
import type { AiConversationMessage } from "../services/ai/types";

const MODEL = "qwen3.7-max";
const CALL_PACING_MS = 2_500;
const INFRA_RETRY_BACKOFF_MS = 2_500;
let lastCallAt = 0;

const wait = (durationMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, durationMs);
});

const infraRetryable = (error: unknown) => {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const details = record.details && typeof record.details === "object"
    ? record.details as Record<string, unknown>
    : {};
  const status = typeof details.status === "number" ? details.status : undefined;
  return status === 429 || (status !== undefined && status >= 500) ||
    /network|socket|超时|timeout|fetch failed/i.test(String(error));
};

const paced = async <T>(operation: () => Promise<T>) => {
  const remaining = CALL_PACING_MS - (Date.now() - lastCallAt);
  if (remaining > 0) await wait(remaining);
  try {
    return await operation();
  } finally {
    lastCallAt = Date.now();
  }
};

const callWithOneInfraRetry = async <T>(stage: string, operation: () => Promise<T>) => {
  try {
    return await paced(operation);
  } catch (error) {
    if (!infraRetryable(error)) throw error;
    console.log(JSON.stringify({ stage, category: "infra_retry" }));
    await wait(INFRA_RETRY_BACKOFF_MS);
    try {
      return await paced(operation);
    } catch (retryError) {
      if (!infraRetryable(retryError)) throw retryError;
      throw new Error(`infra_failure:${stage}:${String(retryError)}`);
    }
  }
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const planFor = ({
  caseId,
  sourceGreetingFunction,
  selectedRelation = "reciprocates_move",
  requiredFunction = "complete_reciprocal_contact",
  currentUserText,
  responseActions = [],
}: {
  caseId: string;
  sourceGreetingFunction: InteractionMoveHandoffPlan["sourceGreetingFunction"];
  selectedRelation?: InteractionMoveHandoffPlan["selectedRelation"];
  requiredFunction?: InteractionMoveHandoffPlan["requiredFunction"];
  currentUserText: string;
  responseActions?: ResponseAction[];
}) => {
  const sourceAssistantMoveId = `surface-qwen-assistant-${caseId}`;
  const sourceUserTurnId = `surface-qwen-user-${caseId}`;
  const handoff: InteractionMoveHandoffPlan = {
    sourceAssistantMoveId,
    sourceUserTurnId,
    sourceGreetingFunction,
    selectedRelation,
    requiredFunction,
    completionIntent: "fulfill",
    questionPolicy: requiredFunction === "answer_current_obligation"
      ? "none"
      : "optional_after_completion",
    evidence: [{
      source: "current_user_turn",
      sourceUserTurnId,
      start: 0,
      end: currentUserText.length,
      text: currentUserText,
    }],
  };
  return deepFreeze<ResponsePlan>({
    planId: `surface-qwen-${caseId}`,
    decisionOwner: "conversation_os.response_planner",
    behaviorSource: "ordinary_conversation",
    planningDepth: "minimal",
    ordinaryPosture: null,
    answerObligations: requiredFunction === "answer_current_obligation"
      ? [{
          id: `${sourceUserTurnId}:answer-1`,
          sourceConversationId: "surface-qwen-eval",
          sourceTurnId: sourceUserTurnId,
          triggeringUserAct: "ask_information",
          targetProposition: "有些没说出口的话，反而会因为留白显得更完整。",
          status: "open",
          question: currentUserText,
          kind: "definition",
          priority: "must_answer_first",
          evidence: ["The User asks for the meaning of the exact committed claim."],
          requiredDisclosure: [],
        }]
      : [],
    disclosureScope: { conversationId: "surface-qwen-eval", turnId: sourceUserTurnId },
    correction: null,
    responseActions,
    groundingFacts: [],
    requiredDisclosure: [],
    clinicalStrategy: null,
    positiveFunctionContract: null,
    interactionMoveHandoffPlan: handoff,
    questionPolicy: {
      mode: handoff.questionPolicy === "none" ? "none" : "optional_after_answer",
      reason: "frozen Qwen Surface eval",
    },
    closurePolicy: { mode: "forbid_closure", reason: "frozen Qwen Surface eval" },
    tone: ["natural"],
    stance: ["follow the plan"],
    lengthGuidance: "brief",
    prohibitedClaims: [],
    safetyConstraints: [],
    relevanceProvenance: responseActions.map((action) => ({
      planElement: `responseAction:${action}`,
      source: "interaction_state",
      sourceTurnId: sourceUserTurnId,
      evidence: [`currentUserMessage=${currentUserText}`],
    })),
    evidence: [],
  });
};

const validateWithRealQwen = async ({
  caseId,
  plan,
  targetAssistantText,
  currentUserText,
  candidateReply,
}: {
  caseId: string;
  plan: ResponsePlan;
  targetAssistantText: string;
  currentUserText: string;
  candidateReply: string;
}) => {
  const input: InteractionMoveHandoffSemanticProviderInput = {
    planId: plan.planId,
    planBinding: plan.interactionMoveHandoffPlan!,
    targetAssistantText,
    currentUserText,
    candidateReply,
    ordinaryQuestionIndependentlySupported:
      plan.responseActions.length > 0 ||
      (
        plan.interactionMoveHandoffPlan?.requiredFunction === "complete_reciprocal_contact" &&
        plan.interactionMoveHandoffPlan.questionPolicy === "optional_after_completion"
      ),
    assistantIdentityContract: null,
  };
  const rawVerdict = await callWithOneInfraRetry(
    `${caseId}:validator`,
    () => defaultInteractionMoveHandoffSemanticProvider(input)
  );
  return validateInteractionMoveHandoffOutput({
    plan,
    reply: candidateReply,
    semanticContext: { targetAssistantText, currentUserText },
    provider: async () => rawVerdict,
  });
};

const generateAndValidate = async ({
  caseId,
  plan,
  targetAssistantText,
  currentUserText,
}: {
  caseId: string;
  plan: ResponsePlan;
  targetAssistantText: string;
  currentUserText: string;
}) => {
  const planSnapshot = structuredClone(plan);
  const recentMessages: AiConversationMessage[] = [{
    id: plan.interactionMoveHandoffPlan!.sourceAssistantMoveId,
    role: "assistant",
    content: targetAssistantText,
    status: "saved",
  }];
  const prompt = buildChatPrompt({ userMessage: currentUserText, recentMessages, responsePlan: plan });
  const generation = await callWithOneInfraRetry(
    `${caseId}:surface`,
    () => callModel({ model: MODEL, messages: prompt.messages, temperature: 0 })
  );
  assert.deepEqual(plan, planSnapshot, `${caseId}: Surface must not mutate the frozen plan`);
  const result = await validateWithRealQwen({
    caseId,
    plan,
    targetAssistantText,
    currentUserText,
    candidateReply: generation.text,
  });
  assert.deepEqual(plan, planSnapshot, `${caseId}: Validator must not mutate the frozen plan`);
  return { reply: generation.text, result };
};

const main = async () => {
  assert.equal(process.env.AI_PROVIDER, "qwen", "AI_PROVIDER must be exactly qwen");
  assert.equal(process.env.AI_MAIN_MODEL, MODEL, `AI_MAIN_MODEL must be exactly ${MODEL}`);
  assert(
    process.env.QWEN_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim(),
    "QWEN_API_KEY or DASHSCOPE_API_KEY is required"
  );
  const baseUrl = process.env.QWEN_BASE_URL?.trim() || process.env.DASHSCOPE_BASE_URL?.trim();
  assert(baseUrl, "QWEN_BASE_URL or DASHSCOPE_BASE_URL must be explicit for the credential region");

  const positiveCases = [
    {
      caseId: "simple_greeting",
      sourceGreetingFunction: "initiate_reciprocal_contact" as const,
      targetAssistantText: "嗨，又见面了。",
      currentUserText: "嗨",
    },
    {
      caseId: "open_statement",
      sourceGreetingFunction: "offer_self_contained_conversation_entry" as const,
      targetAssistantText: "今天路过这里，想来和你打个招呼。",
      currentUserText: "嗨",
    },
  ];

  for (const fixture of positiveCases) {
    const plan = planFor({
      caseId: fixture.caseId,
      sourceGreetingFunction: fixture.sourceGreetingFunction,
      currentUserText: fixture.currentUserText,
    });
    const startedAt = Date.now();
    const { reply, result } = await generateAndValidate({ ...fixture, plan });
    assert.equal(
      result.passed,
      true,
      `${fixture.caseId}: Surface reply failed unchanged Validator: ${reply} :: ${result.failureReasons.join(",")}`
    );
    console.log(JSON.stringify({
      caseId: fixture.caseId,
      category: "semantic_pass",
      reply,
      latencyMs: Date.now() - startedAt,
    }));
  }

  const negativeTarget = "嗨，又见面了。";
  const negativeUser = "嗨";
  const negativePlan = planFor({
    caseId: "strict_negatives",
    sourceGreetingFunction: "initiate_reciprocal_contact",
    currentUserText: negativeUser,
  });
  const negativeCandidates = [
    { caseId: "second_greeting", reply: "你好呀。" },
    { caseId: "presence_confirmation", reply: "我在。" },
    { caseId: "availability_open_door", reply: "随时可以跟我聊聊。" },
    { caseId: "mixed_greeting_open_door", reply: "你好呀，随时可以跟我聊聊。" },
    { caseId: "interview_sequence", reply: "今天想聊点什么？最近过得怎么样？" },
  ];
  for (const fixture of negativeCandidates) {
    const result = await validateWithRealQwen({
      ...fixture,
      plan: negativePlan,
      targetAssistantText: negativeTarget,
      currentUserText: negativeUser,
      candidateReply: fixture.reply,
    });
    if (result.passed) {
      console.log(JSON.stringify({
        caseId: fixture.caseId,
        category: "unexpected_pass_diagnostic",
        failureReasons: result.failureReasons,
        handoffStatus: result.verdict?.status ?? null,
        positiveFunctionRealized: result.verdict?.positiveFunctionRealized ?? null,
      }));
    }
    assert.equal(result.passed, false, `${fixture.caseId}: forbidden candidate must reject`);
    assert.deepEqual(
      result.failureReasons,
      ["interaction_move_handoff_semantic:function_or_policy_not_satisfied"],
      `${fixture.caseId}: rejection must remain at the semantic/policy gate`
    );
    console.log(JSON.stringify({ caseId: fixture.caseId, category: "semantic_reject" }));
  }

  const topicChoiceInvitation = await validateWithRealQwen({
    caseId: "user_chooses_topic",
    plan: negativePlan,
    targetAssistantText: negativeTarget,
    currentUserText: negativeUser,
    candidateReply: "那我们就随意一点。今天想聊点什么？",
  });
  assert.equal(
    topicChoiceInvitation.passed,
    true,
    `user_chooses_topic: low-pressure topic choice must pass: ${topicChoiceInvitation.failureReasons.join(",")}`
  );
  console.log(JSON.stringify({ caseId: "user_chooses_topic", category: "semantic_pass" }));

  const claimTarget = "有些没说出口的话，反而会因为留白显得更完整。";
  const claimQuestion = "你刚才那句话想表达什么";
  const claimPlan = planFor({
    caseId: "committed_claim_explanation",
    sourceGreetingFunction: "offer_self_contained_conversation_entry",
    selectedRelation: "opens_or_redirects_thread",
    requiredFunction: "answer_current_obligation",
    currentUserText: claimQuestion,
    responseActions: ["answer_directly", "explain_plainly"],
  });
  const claimExplanation = await validateWithRealQwen({
    caseId: "committed_claim_explanation",
    plan: claimPlan,
    targetAssistantText: claimTarget,
    currentUserText: claimQuestion,
    candidateReply: "我的意思是，没说出口的内容有时会因为留白而显得更完整。",
  });
  assert.equal(
    claimExplanation.passed,
    true,
    `committed_claim_explanation: exact-claim explanation must pass: ${claimExplanation.failureReasons.join(",")}`
  );
  const claimDisowning = await validateWithRealQwen({
    caseId: "committed_claim_disowning",
    plan: claimPlan,
    targetAssistantText: claimTarget,
    currentUserText: claimQuestion,
    candidateReply: "其实没什么特别想表达的，就是随口说了一句。",
  });
  assert.equal(claimDisowning.passed, false, "committed claim must not be disowned instead of answered");
  console.log(JSON.stringify({
    caseId: "committed_claim_authority",
    category: "semantic_pass_and_reject",
  }));

  const mixedCurrentUserText = "嗨，我最近在学做面包";
  const mixedTargetAssistantText = "嗨，又见面了。";
  const mixedPlan = planFor({
    caseId: "mixed_concrete_topic",
    sourceGreetingFunction: "initiate_reciprocal_contact",
    selectedRelation: "opens_or_redirects_thread",
    requiredFunction: "continue_user_introduced_content",
    currentUserText: mixedCurrentUserText,
    responseActions: ["continue_established_thread"],
  });
  const mixed = await generateAndValidate({
    caseId: "mixed_concrete_topic",
    plan: mixedPlan,
    targetAssistantText: mixedTargetAssistantText,
    currentUserText: mixedCurrentUserText,
  });
  assert.equal(
    mixed.result.passed,
    true,
    `mixed_concrete_topic: supported continuation must pass: ${mixed.reply} :: ${mixed.result.failureReasons.join(",")}`
  );
  console.log(JSON.stringify({
    caseId: "mixed_concrete_topic",
    category: "semantic_pass",
    reply: mixed.reply,
  }));

  console.log(JSON.stringify({
    gate: "interaction_move_handoff_surface_qwen",
    provider: "qwen",
    model: MODEL,
    baseUrlHost: new URL(baseUrl).host,
    status: "passed",
  }));
};

void main().catch((error) => {
  const category = String(error).includes("infra_failure:")
    ? "infra_failure"
    : "semantic_or_contract_failure";
  console.error(JSON.stringify({
    gate: "interaction_move_handoff_surface_qwen",
    provider: "qwen",
    model: MODEL,
    category,
    error: String(error),
  }));
  process.exitCode = 1;
});
