import assert from "node:assert/strict";

import { buildProactiveGreetingAssistantMoveEnvelope } from "../conversation-os";
import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
  type InteractionMoveHandoffPlan,
  type ResponseRelationKind,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { enrichTurnInterpretation } from "../services/ai/turnInterpretationAdapter";
import type { AiConversationMessage } from "../services/ai/types";
import type { ProactiveMoveIntentV1 } from "../conversation-os/interactionMoveEnvelope";

const MODEL = "qwen3.7-max";
const FIXTURE_PACING_MS = 2_500;
const INFRA_RETRY_BACKOFF_MS = 2_500;

type GreetingMove = "simple_greeting" | "open_statement" | "light_question";
type ExpectedTuple = Pick<
  InteractionMoveHandoffPlan,
  "selectedRelation" | "requiredFunction" | "completionIntent" | "questionPolicy"
>;

type Fixture = {
  id: string;
  move: GreetingMove;
  assistantText: string;
  userText: string;
  requiredRelations: ResponseRelationKind[];
  forbiddenRelations?: ResponseRelationKind[];
  expectedTuple: ExpectedTuple;
  expectedTargetOperation?: "explain" | "answer" | "repair_or_withdraw";
  expectedAnswerTarget?: boolean;
  expectedRepairTarget?: boolean;
};

const fixtures: Fixture[] = [
  {
    id: "generic_reciprocal_simple_greeting",
    move: "simple_greeting",
    assistantText: "嗨，又见面了。",
    userText: "你好",
    requiredRelations: ["acknowledges_previous_move"],
    forbiddenRelations: ["opens_new_thread", "continues_active_thread"],
    expectedTuple: {
      selectedRelation: "reciprocates_move",
      requiredFunction: "complete_reciprocal_contact",
      completionIntent: "fulfill",
      questionPolicy: "optional_after_completion",
    },
  },
  {
    id: "generic_reciprocal_open_statement",
    move: "open_statement",
    assistantText: "把想说的话慢慢打出来就好。",
    userText: "你好",
    requiredRelations: ["acknowledges_previous_move"],
    forbiddenRelations: ["opens_new_thread", "continues_active_thread"],
    expectedTuple: {
      selectedRelation: "reciprocates_move",
      requiredFunction: "complete_reciprocal_contact",
      completionIntent: "fulfill",
      questionPolicy: "optional_after_completion",
    },
  },
  {
    id: "concrete_redirect",
    move: "open_statement",
    assistantText: "把想说的话慢慢打出来就好。",
    userText: "其实我想聊聊最近的工作变化。",
    requiredRelations: ["opens_new_thread"],
    expectedTuple: {
      selectedRelation: "opens_or_redirects_thread",
      requiredFunction: "continue_user_introduced_content",
      completionIntent: "fulfill",
      questionPolicy: "optional_after_completion",
    },
  },
  {
    id: "mixed_greeting_and_topic",
    move: "simple_greeting",
    assistantText: "嗨，又见面了。",
    userText: "你好，我想聊聊最近的工作变化。",
    requiredRelations: ["acknowledges_previous_move", "opens_new_thread"],
    expectedTuple: {
      selectedRelation: "opens_or_redirects_thread",
      requiredFunction: "continue_user_introduced_content",
      completionIntent: "fulfill",
      questionPolicy: "optional_after_completion",
    },
  },
  {
    id: "concrete_continuation_ambiguity",
    move: "open_statement",
    assistantText: "接着刚才做饭的话题慢慢说就好。",
    userText: "好，我最近还在学做饭，不过总是掌握不好火候。",
    requiredRelations: ["acknowledges_previous_move", "continues_active_thread"],
    forbiddenRelations: ["opens_new_thread"],
    expectedTuple: {
      selectedRelation: "continues_from_move",
      requiredFunction: "defer_handoff_completion",
      completionIntent: "defer",
      questionPolicy: "none",
    },
  },
  {
    id: "question_greeting_answer",
    move: "light_question",
    assistantText: "今天有没有吃到什么还不错的东西？",
    userText: "吃了个炒饭。",
    requiredRelations: ["answers_previous_move"],
    expectedTuple: {
      selectedRelation: "answers_move",
      requiredFunction: "continue_from_user_answer",
      completionIntent: "fulfill",
      questionPolicy: "none",
    },
  },
  {
    id: "question_greeting_reciprocal_only",
    move: "light_question",
    assistantText: "今天有没有吃到什么还不错的东西？",
    userText: "你好",
    requiredRelations: ["acknowledges_previous_move"],
    forbiddenRelations: ["opens_new_thread", "continues_active_thread"],
    expectedTuple: {
      selectedRelation: "reciprocates_move",
      requiredFunction: "defer_handoff_completion",
      completionIntent: "defer",
      questionPolicy: "none",
    },
  },
  {
    id: "committed_claim_clarification",
    move: "open_statement",
    assistantText: "雨点落在窗上，像把匆忙的一天调成了慢速播放。",
    userText: "你这句话想表达什么？",
    requiredRelations: ["requests_answer"],
    forbiddenRelations: ["opens_new_thread", "continues_active_thread"],
    expectedTargetOperation: "explain",
    expectedAnswerTarget: true,
    expectedTuple: {
      selectedRelation: "opens_or_redirects_thread",
      requiredFunction: "answer_current_obligation",
      completionIntent: "fulfill",
      questionPolicy: "none",
    },
  },
  {
    id: "committed_claim_direct_question",
    move: "open_statement",
    assistantText: "没做完的事常比做完的事更容易留在脑中，因为注意仍在等待收尾。",
    userText: "你为什么这么说？",
    requiredRelations: ["requests_answer"],
    forbiddenRelations: ["opens_new_thread", "continues_active_thread"],
    expectedTargetOperation: "answer",
    expectedAnswerTarget: true,
    expectedTuple: {
      selectedRelation: "opens_or_redirects_thread",
      requiredFunction: "answer_current_obligation",
      completionIntent: "fulfill",
      questionPolicy: "none",
    },
  },
  {
    id: "committed_claim_challenge",
    move: "open_statement",
    assistantText: "缝隙里的回声会替沉默记住尚未发生的方向。",
    userText: "这个说法没有明确意思，请撤回。",
    requiredRelations: ["repairs_previous_move"],
    forbiddenRelations: ["opens_new_thread", "continues_active_thread"],
    expectedTargetOperation: "repair_or_withdraw",
    expectedRepairTarget: true,
    expectedTuple: {
      selectedRelation: "challenges_move_fit",
      requiredFunction: "withdraw_or_repair_targeted_move",
      completionIntent: "fulfill",
      questionPolicy: "none",
    },
  },
];

const wait = (durationMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, durationMs);
});

const planTuple = (plan: InteractionMoveHandoffPlan | null): ExpectedTuple => {
  assert(plan, "A committed proactive greeting must produce a handoff plan");
  return {
    selectedRelation: plan.selectedRelation,
    requiredFunction: plan.requiredFunction,
    completionIntent: plan.completionIntent,
    questionPolicy: plan.questionPolicy,
  };
};

const intentForFixture = (fixture: Fixture): ProactiveMoveIntentV1 => {
  if (fixture.move === "simple_greeting") {
    return {
      move: fixture.move,
      requiredFunction: "initiate_reciprocal_contact",
      realization: { kind: "reciprocal_contact" },
      expectedUserContribution: "none",
      userBurden: "none",
    };
  }
  if (fixture.move === "open_statement") {
    return {
      move: fixture.move,
      requiredFunction: "offer_self_contained_conversation_entry",
      realization: {
        kind: "self_contained_entry",
        topic: "fixture conversation entry",
        proposition: fixture.assistantText,
      },
      expectedUserContribution: "none",
      userBurden: "none",
    };
  }
  return {
    move: fixture.move,
    requiredFunction: "ask_one_bounded_low_burden_question",
    realization: {
      kind: "bounded_question",
      topic: "food",
      question: fixture.assistantText,
    },
    expectedUserContribution: "answer",
    userBurden: "low",
  };
};

const runFixture = async (fixture: Fixture) => {
  const envelope = buildProactiveGreetingAssistantMoveEnvelope({
    assistantMoveId: `qwen-turn-interpretation-${fixture.id}-assistant`,
    generationId: `qwen-turn-interpretation-${fixture.id}-generation`,
    intent: intentForFixture(fixture),
  });
  const recentMessages: AiConversationMessage[] = [{
    id: envelope.assistantMoveId,
    role: "assistant",
    content: fixture.assistantText,
    status: "saved",
    interactionMoveEnvelope: envelope,
  }];
  const context = assembleConversationControlContext({
    conversationId: `qwen-turn-interpretation-${fixture.id}`,
    currentTurnId: `qwen-turn-interpretation-${fixture.id}-user`,
    userMessage: fixture.userText,
    recentMessages,
    conversationState: determineConversationState({
      currentUserMessage: fixture.userText,
      recentMessages,
    }),
  });
  const deterministic = interpretTurnDeterministically(context);

  let enriched = await enrichTurnInterpretation(context, deterministic);
  if (!enriched.modelUsed && enriched.modelTrace.error) {
    await wait(INFRA_RETRY_BACKOFF_MS);
    enriched = await enrichTurnInterpretation(context, deterministic);
  }

  assert.equal(enriched.modelTrace.attempted, true, `${fixture.id}: model call must be attempted`);
  assert.equal(enriched.modelUsed, true, `${fixture.id}: real Qwen output must be used`);
  assert(enriched.rawModelOutput, `${fixture.id}: raw structured model output is required`);

  const relations = enriched.interpretation.responseRelation.candidates.map(
    (candidate) => candidate.relation
  );
  for (const relation of fixture.requiredRelations) {
    assert(relations.includes(relation), `${fixture.id}: missing required relation ${relation}`);
  }
  for (const relation of fixture.forbiddenRelations ?? []) {
    assert(!relations.includes(relation), `${fixture.id}: forbidden hedge relation ${relation}`);
  }
  if (fixture.expectedTargetOperation) {
    const acceptableOperations = fixture.expectedTargetOperation === "repair_or_withdraw"
      ? ["repair_or_withdraw"]
      : ["explain", "answer"];
    const boundCandidate = enriched.interpretation.responseRelation.candidates.find(
      (candidate) => candidate.targetOperation &&
        acceptableOperations.includes(candidate.targetOperation)
    );
    assert(boundCandidate, `${fixture.id}: exact committed-claim operation is required`);
    assert.equal(
      boundCandidate.targetProposition,
      fixture.assistantText,
      `${fixture.id}: targetProposition must equal the committed claim`
    );
  }
  assert(
    enriched.interpretation.responseRelation.candidates.every(
      (candidate) => candidate.targetTurnId === envelope.assistantMoveId
    ),
    `${fixture.id}: every accepted relation must bind the exact Assistant move`
  );

  const dialogueState = buildDialogueState(context, enriched.interpretation);
  const responsePlan = createResponsePlan({
    context,
    interpretation: enriched.interpretation,
    dialogueState,
    clinicalAdviceProvider: () => null,
  });
  const actualTuple = planTuple(responsePlan.interactionMoveHandoffPlan);
  assert.deepEqual(actualTuple, fixture.expectedTuple, `${fixture.id}: Planner tuple mismatch`);
  if (fixture.expectedAnswerTarget) {
    assert.equal(responsePlan.answerObligations.length, 1, `${fixture.id}: one answer obligation is required`);
    assert.equal(
      responsePlan.answerObligations[0]?.targetProposition,
      fixture.assistantText,
      `${fixture.id}: obligation must target the committed Assistant claim`
    );
    assert.notEqual(
      responsePlan.answerObligations[0]?.targetProposition,
      responsePlan.answerObligations[0]?.question,
      `${fixture.id}: obligation must not target the User question itself`
    );
  }
  if (fixture.expectedRepairTarget) {
    assert.equal(
      responsePlan.positiveFunctionContract?.action === "repair_previous_wording"
        ? responsePlan.positiveFunctionContract.targetText
        : null,
      fixture.assistantText,
      `${fixture.id}: repair authority must bind the committed Assistant claim`
    );
  }

  console.log(JSON.stringify({
    caseId: fixture.id,
    provider: "qwen",
    model: enriched.modelTrace.model,
    relations,
    projectedCandidates: enriched.interpretation.userMoveRelation?.candidates.map(
      (candidate) => candidate.kind
    ),
    plan: actualTuple,
    latencyMs: enriched.modelTrace.latencyMs,
  }));
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

  for (const [index, fixture] of fixtures.entries()) {
    if (index > 0) await wait(FIXTURE_PACING_MS);
    await runFixture(fixture);
  }

  console.log(JSON.stringify({
    gate: "interaction_move_handoff_turn_interpretation_qwen",
    provider: "qwen",
    model: MODEL,
    baseUrlHost: new URL(baseUrl).host,
    fixtures: fixtures.length,
    status: "passed",
  }));
};

void main();
