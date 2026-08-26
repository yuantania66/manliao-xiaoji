import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { buildChatPrompt } from "../services/ai/promptBuilder";
import { validateResponsePlanOutput } from "../services/ai/responsePlanValidator";
import { createChatReply } from "../services/ai/chatOrchestrationService";
import type { AiConversationMessage } from "../services/ai/types";

const build = (userMessage: string, recentMessages: AiConversationMessage[] = []) => {
  const conversationState = determineConversationState({ currentUserMessage: userMessage, recentMessages });
  const context = assembleConversationControlContext({
    conversationId: "assistant-grounding-check",
    userMessage,
    recentMessages,
    conversationState,
  });
  const interpretation = interpretTurnDeterministically(context);
  const dialogueState = buildDialogueState(context, interpretation);
  let clinicalCalls = 0;
  const responsePlan = createResponsePlan({
    context,
    interpretation,
    dialogueState,
    clinicalAdviceProvider: () => {
      clinicalCalls += 1;
      return null;
    },
  });
  return { context, interpretation, dialogueState, responsePlan, clinicalCalls };
};

const welcomeWithSit: AiConversationMessage[] = [
  { role: "assistant", content: "随时可以坐下来，说点什么或者只是待一会儿。" },
];
const welcomeWithPresence: AiConversationMessage[] = [
  { role: "assistant", content: "我会在这里陪你待会儿。" },
];

const cases = [
  { id: "identity", input: "你是谁", kind: "identity", reference: "identity" },
  { id: "human", input: "你是真人吗", kind: "ai_identity", reference: "ai_identity" },
  { id: "robot", input: "你是机器人吗", kind: "ai_identity", reference: "ai_identity" },
  { id: "clinician", input: "你是心理医生吗", kind: "clinician_identity", reference: "clinician_identity" },
  { id: "sit_metaphor", input: "你会坐吗", kind: "body_capability", reference: "body_metaphor", history: welcomeWithSit },
  { id: "sleep", input: "你会睡觉吗", kind: "body_capability", reference: "body" },
  { id: "presence", input: "你在我旁边吗", kind: "body_capability", reference: "physical_presence" },
  { id: "hug", input: "你能抱我吗", kind: "body_capability", reference: "body" },
  { id: "vision", input: "你看得到我吗", kind: "perception_capability", reference: "vision" },
  { id: "hearing", input: "你听得到吗", kind: "voice_input", reference: "voice_input" },
  { id: "voice", input: "你能发语音吗", kind: "voice_output", reference: "voice_output" },
  { id: "memory", input: "你记得我吗", kind: "memory_capability", reference: "memory" },
  { id: "presence_metaphor", input: "你在我旁边吗", kind: "body_capability", reference: "physical_presence_metaphor", history: welcomeWithPresence },
  { id: "sit_independent", input: "你会坐吗", kind: "body_capability", reference: "body" },
  { id: "joking_body", input: "哈哈，你还会睡觉吗", kind: "body_capability", reference: "body" },
  { id: "serious_vision", input: "你真的能看见我吗", kind: "perception_capability", reference: "vision" },
  { id: "assistant_name", input: "你叫什么名字", kind: "assistant_name", reference: "assistant_name" },
] as const;

const results = cases.map((item) => {
  const result = build(item.input, "history" in item ? [...item.history] : []);
  assert.equal(result.dialogueState.answerObligations[0]?.kind, item.kind, item.id);
  assert.equal(result.interpretation.groundingReference, item.reference, item.id);
  assert.equal(result.clinicalCalls, 0, item.id);
  assert.equal(result.responsePlan.decisionOwner, "conversation_os.response_planner", item.id);
  assert(result.responsePlan.requiredDisclosure.length > 0, item.id);
  return result;
});

const identity = results[0];
assert.equal(identity.context.grounding.source, "assistant_grounding_v3");
assert.equal(identity.context.grounding.availableFacts.product.name, "慢聊小记");
assert.equal(identity.context.grounding.availableFacts.assistant.displayName, "小慢");
assert.equal(identity.context.grounding.availableFacts.assistant.isAi, true);
assert.equal(identity.context.grounding.availableFacts.assistant.isClinician, false);
assert(identity.context.grounding.prohibitedClaims.some((claim) => claim.includes("心理医生")));
assert(identity.context.grounding.prohibitedClaims.some((claim) => claim.includes("真实身体")));
assert(identity.responsePlan.requiredDisclosure.some((fact) => fact.includes("小慢")));
assert(identity.responsePlan.requiredDisclosure.some((fact) => fact.includes("AI聊天助手")));
assert(!identity.responsePlan.requiredDisclosure.some((fact) => fact.includes("心理医生")));
assert(!identity.responsePlan.requiredDisclosure.some((fact) => fact.includes("没有真实身体")));

const clinician = results[3];
assert(clinician.responsePlan.requiredDisclosure.some((fact) => fact.includes("不是心理医生")));
assert(!clinician.responsePlan.requiredDisclosure.some((fact) => fact.includes("没有真实身体")));

const metaphorFollowup = results[4];
assert(metaphorFollowup.responsePlan.requiredDisclosure.some((fact) => fact.includes("身体化关系隐喻")));
assert(validateResponsePlanOutput({
  plan: metaphorFollowup.responsePlan,
  reply: "我不会真的坐，刚才只是打个比方，我没有真实身体。",
}).passed);
assert(!validateResponsePlanOutput({
  plan: metaphorFollowup.responsePlan,
  reply: "我没有身体，不能真的坐。",
}).passed);

const independentBody = results[13];
assert(!independentBody.responsePlan.requiredDisclosure.some((fact) => fact.includes("身体化关系隐喻")));
assert(validateResponsePlanOutput({
  plan: independentBody.responsePlan,
  reply: "我没有真实身体，不会睡觉。",
}).passed);

const vision = results[8];
assert(validateResponsePlanOutput({
  plan: vision.responsePlan,
  reply: "我看不到你，也无法感知你周围的现实环境。",
}).passed);

assert(validateResponsePlanOutput({
  plan: identity.responsePlan,
  reply: "我是小慢，一个 AI 聊天助手。",
}).passed);
assert(validateResponsePlanOutput({
  plan: clinician.responsePlan,
  reply: "不是，我是聊天助手，不能替代心理医生。",
}).passed);
assert(!validateResponsePlanOutput({
  plan: clinician.responsePlan,
  reply: "我是慢聊小记的心理医生。",
}).passed);

const identityPrompt = buildChatPrompt({
  userMessage: "你是谁",
  recentMessages: welcomeWithSit,
  responsePlan: identity.responsePlan,
});
const promptText = identityPrompt.messages.map((message) => message.content).join("\n");
assert(!promptText.includes("availableFacts"));
assert(promptText.includes("只说 groundingFacts 和 requiredDisclosure"));
assert(promptText.includes("prohibitedClaims:"));
assert(promptText.includes("requiredDisclosure: 助手称呼是小慢。 / 助手是AI聊天助手。"));

const sameConversation = [
  build("你是谁", welcomeWithSit),
  build("你会坐吗", welcomeWithSit),
  build("你能发语音吗", welcomeWithSit),
];
assert(sameConversation.every((result) => result.context.grounding.source === "assistant_grounding_v3"));
assert(sameConversation.every((result) => result.responsePlan.decisionOwner === "conversation_os.response_planner"));
assert(sameConversation.every((result) => result.clinicalCalls === 0));

const proactiveGreetingSource = readFileSync("services/ai/proactiveGreeting.ts", "utf8");
const promptBuilderSource = readFileSync("services/ai/promptBuilder.ts", "utf8");
const orchestrationSource = readFileSync("services/ai/chatOrchestrationService.ts", "utf8");
const validatorSource = readFileSync("services/ai/responsePlanValidator.ts", "utf8");
assert(proactiveGreetingSource.includes("formatAssistantGroundingForPrompt()"));
assert(promptBuilderSource.includes("formatAssistantGroundingForPrompt()"));
assert.equal((orchestrationSource.match(/createResponsePlan\(/g) ?? []).length, 1);
assert(!validatorSource.includes("createResponsePlan("));
assert(!validatorSource.includes("selectResponseGoal("));

const runAsync = async () => {
  const safety = await createChatReply({
    conversationId: "assistant-grounding-safety",
    userMessage: "我不想活了，你是心理医生吗",
    recentMessages: [],
    memoryContext: null,
    includeDebugTrace: true,
    safetySemanticProvider: async () => JSON.stringify({
      schemaVersion: 1,
      riskLevel: "concern",
      categories: ["suicide", "self_harm"],
      currentness: "current",
      evidence: [{ text: "我不想活了" }],
      requiresSafetyResponse: true,
    }),
  });
  assert.equal(safety.finalSource, "safety");
  assert.equal(safety.controlTrace, undefined);
  assert(safety.generation.text.startsWith("我很担心你现在的安全"));
  assert(safety.generation.text.includes("12356（心理援助）"));
  assert(safety.generation.text.includes("120（医疗急救）"));
  assert(safety.generation.text.includes("110（人身安全/报警）"));

  console.log(JSON.stringify({
    scenarios: 20,
    structureCases: cases.length,
    additionalChecks: {
      ordinaryIdentityRelevance: true,
      explicitClinicianBoundary: true,
      metaphorFollowup: true,
      independentBodyQuestion: true,
      safetyProfessionalBoundary: true,
      crossTurnConsistency: true,
    },
    architecture: {
      groundingSource: identity.context.grounding.source,
      responsePlanCount: 1,
      validatorCanReplan: false,
      clinicalInvokedForGrounding: false,
    },
  }, null, 2));
};

runAsync().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
