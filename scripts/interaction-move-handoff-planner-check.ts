import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildProactiveGreetingAssistantMoveEnvelope } from "../conversation-os";
import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlanPreflightAuthoritySnapshot,
  createResponsePlan,
  interpretTurnDeterministically,
  planInteractionMoveHandoff,
  type ActiveInteractionMoveHandoffTarget,
  type InteractionMoveHandoffPlan,
  type ResponsePlanPreflightAuthoritySnapshot,
  type UserMoveRelationCandidate,
  type UserMoveRelationKind,
  type UserMoveRelationProjection,
} from "../conversation-os/control";
import type { ProactiveGreetingRequiredFunction } from "../conversation-os/interactionMoveEnvelope";
import { determineConversationState } from "../conversation-os/state";
import { PROACTIVE_GREETING_PROMPT_VERSION } from "../lib/proactive-greeting";
import { preflightResponsePlan } from "../services/ai/chatExecutionLifecycle";
import type { AiConversationMessage } from "../services/ai/types";

const userTurnId = "phm-b-user-turn";
const preflightAuthorities = new WeakMap<object, ResponsePlanPreflightAuthoritySnapshot>();
const preflightV1 = (
  planValue: Parameters<typeof preflightResponsePlan>[0],
  authoritySource: object = planValue
) => preflightResponsePlan(planValue, preflightAuthorities.get(authoritySource));
const userText = "  当前用户证据  ";
const span = {
  source: "current_user_turn" as const,
  sourceUserTurnId: userTurnId,
  start: 0,
  end: userText.length,
  text: userText,
};

const moveForFunction: Record<ProactiveGreetingRequiredFunction, "simple_greeting" | "open_statement" | "light_question"> = {
  initiate_reciprocal_contact: "simple_greeting",
  offer_self_contained_conversation_entry: "open_statement",
  ask_one_bounded_low_burden_question: "light_question",
};

const targetFor = (
  sourceGreetingFunction: ProactiveGreetingRequiredFunction
): ActiveInteractionMoveHandoffTarget => {
  const envelope = buildProactiveGreetingAssistantMoveEnvelope({
    assistantMoveId: `assistant-${sourceGreetingFunction}`,
    generationId: `generation-${sourceGreetingFunction}`,
    greetingMove: moveForFunction[sourceGreetingFunction],
  });
  return {
    sourceAssistantMoveId: envelope.assistantMoveId,
    sourceGreetingFunction,
    envelope,
  };
};

const candidate = (
  kind: UserMoveRelationKind,
  confidence = 0.8,
  evidence = [span]
): UserMoveRelationCandidate => ({ kind, confidence, evidence });

const relationFor = (
  target: ActiveInteractionMoveHandoffTarget,
  candidates: UserMoveRelationCandidate[]
): UserMoveRelationProjection => ({
  sourceUserTurnId: userTurnId,
  targetAssistantMoveId: target.sourceAssistantMoveId,
  targetFunction: target.sourceGreetingFunction,
  candidates,
  ambiguous: candidates.length > 1,
});

const plan = ({
  greetingFunction,
  candidates,
  hasCurrentAnswerObligation = false,
  hasExplicitBoundary = false,
}: {
  greetingFunction: ProactiveGreetingRequiredFunction;
  candidates: UserMoveRelationCandidate[];
  hasCurrentAnswerObligation?: boolean;
  hasExplicitBoundary?: boolean;
}) => {
  const target = targetFor(greetingFunction);
  return planInteractionMoveHandoff({
    target,
    relation: relationFor(target, candidates),
    currentUserTurnId: userTurnId,
    currentUserText: userText,
    hasCurrentAnswerObligation,
    hasExplicitBoundary,
  });
};

const tuple = (value: InteractionMoveHandoffPlan | null) => {
  assert(value);
  return {
    selectedRelation: value.selectedRelation,
    requiredFunction: value.requiredFunction,
    completionIntent: value.completionIntent,
    questionPolicy: value.questionPolicy,
  };
};

const questionGreeting = "ask_one_bounded_low_burden_question" as const;
const nonQuestionGreetings = [
  "initiate_reciprocal_contact",
  "offer_self_contained_conversation_entry",
] as const;

assert.deepEqual(tuple(plan({
  greetingFunction: questionGreeting,
  candidates: [candidate("sets_boundary_or_pause")],
})), {
  selectedRelation: "sets_boundary_or_pause",
  requiredFunction: "respect_user_boundary",
  completionIntent: "fulfill",
  questionPolicy: "none",
});
for (const kind of ["challenges_move_fit", "rejects_or_declines_move"] as const) {
  assert.equal(plan({ greetingFunction: questionGreeting, candidates: [candidate(kind)] })?.requiredFunction,
    "withdraw_or_repair_targeted_move");
}
assert.equal(plan({
  greetingFunction: questionGreeting,
  candidates: [candidate("opens_or_redirects_thread")],
})?.requiredFunction, "continue_user_introduced_content");
for (const kind of ["answers_move", "continues_from_move"] as const) {
  assert.deepEqual(tuple(plan({ greetingFunction: questionGreeting, candidates: [candidate(kind)] })), {
    selectedRelation: kind,
    requiredFunction: "continue_from_user_answer",
    completionIntent: "fulfill",
    questionPolicy: "none",
  });
}
for (const greetingFunction of nonQuestionGreetings) {
  assert.equal(plan({
    greetingFunction,
    candidates: [candidate("continues_from_move")],
  })?.requiredFunction, "continue_user_introduced_content");
  assert.deepEqual(tuple(plan({
    greetingFunction,
    candidates: [candidate("reciprocates_move")],
  })), {
    selectedRelation: "reciprocates_move",
    requiredFunction: "complete_reciprocal_contact",
    completionIntent: "fulfill",
    questionPolicy: "optional_after_completion",
  });
  assert.equal(plan({
    greetingFunction,
    candidates: [candidate("answers_move")],
  })?.requiredFunction, "defer_handoff_completion");
}
for (const kind of ["reciprocates_move", "unclear"] as const) {
  const deferred = plan({ greetingFunction: questionGreeting, candidates: [candidate(kind)] });
  assert.equal(deferred?.requiredFunction, "defer_handoff_completion");
  assert.equal(deferred?.completionIntent, "defer");
  assert.equal(deferred?.questionPolicy, "none");
}

assert.equal(plan({
  greetingFunction: questionGreeting,
  candidates: [candidate("challenges_move_fit", 0.7), candidate("rejects_or_declines_move", 0.9)],
})?.requiredFunction, "withdraw_or_repair_targeted_move");
assert.equal(plan({
  greetingFunction: questionGreeting,
  candidates: [candidate("answers_move", 0.7), candidate("continues_from_move", 0.9)],
})?.requiredFunction, "continue_from_user_answer");
for (const companion of ["answers_move", "continues_from_move", "reciprocates_move"] as const) {
  const contentWins = plan({
    greetingFunction: questionGreeting,
    candidates: [candidate(companion, 0.95), candidate("opens_or_redirects_thread", 0.6)],
  });
  assert.equal(contentWins?.requiredFunction, "continue_user_introduced_content");
  assert.equal(contentWins?.selectedRelation, "opens_or_redirects_thread");
}
for (const kinds of [
  ["answers_move", "reciprocates_move"],
  ["challenges_move_fit", "answers_move"],
  ["opens_or_redirects_thread", "sets_boundary_or_pause"],
] as const) {
  assert.equal(plan({
    greetingFunction: questionGreeting,
    candidates: kinds.map((kind, index) => candidate(kind, 0.9 - index * 0.1)),
  })?.requiredFunction, "defer_handoff_completion");
}
assert.equal(plan({
  greetingFunction: questionGreeting,
  candidates: [candidate("answers_move", 0.95), candidate("unclear", 0.6)],
})?.requiredFunction, "defer_handoff_completion");

const boundaryOverride = plan({
  greetingFunction: questionGreeting,
  candidates: [candidate("answers_move", 0.99), candidate("sets_boundary_or_pause", 0.5)],
  hasExplicitBoundary: true,
});
assert.equal(boundaryOverride?.requiredFunction, "respect_user_boundary");
assert.equal(boundaryOverride?.selectedRelation, "sets_boundary_or_pause");
assert.equal(plan({
  greetingFunction: questionGreeting,
  candidates: [candidate("answers_move")],
  hasExplicitBoundary: true,
}), null);
const answerOverride = plan({
  greetingFunction: questionGreeting,
  candidates: [candidate("reciprocates_move", 0.4), candidate("opens_or_redirects_thread", 0.8)],
  hasCurrentAnswerObligation: true,
});
assert.equal(answerOverride?.requiredFunction, "answer_current_obligation");
assert.equal(answerOverride?.selectedRelation, "opens_or_redirects_thread");
const tied = plan({
  greetingFunction: questionGreeting,
  candidates: [candidate("answers_move", 0.8), candidate("continues_from_move", 0.8)],
});
assert.equal(tied?.selectedRelation, "answers_move");

const validTarget = targetFor(questionGreeting);
const validRelation = relationFor(validTarget, [candidate("answers_move")]);
const project = (
  target: ActiveInteractionMoveHandoffTarget | null,
  relation: UserMoveRelationProjection | null,
  currentUserTurnId = userTurnId,
  currentUserText = userText
) => planInteractionMoveHandoff({
  target,
  relation,
  currentUserTurnId,
  currentUserText,
  hasCurrentAnswerObligation: false,
  hasExplicitBoundary: false,
});
assert.equal(project(null, validRelation), null);
assert.equal(project(validTarget, null), null);
assert.equal(project(validTarget, { ...validRelation, sourceUserTurnId: "wrong-user" }), null);
assert.equal(project(validTarget, { ...validRelation, targetAssistantMoveId: "wrong-assistant" }), null);
assert.equal(project(validTarget, { ...validRelation, targetFunction: "initiate_reciprocal_contact" }), null);
assert.equal(project({ ...validTarget, sourceAssistantMoveId: "wrong-envelope-id" }, validRelation), null);
assert.equal(project({ ...validTarget, sourceGreetingFunction: "initiate_reciprocal_contact" }, validRelation), null);
assert.equal(project({
  ...validTarget,
  sourceGreetingFunction: "invalid_greeting" as ProactiveGreetingRequiredFunction,
}, validRelation), null);
assert.equal(project(validTarget, { ...validRelation, candidates: [] }), null);
for (const badEvidence of [
  [],
  [{ ...span, sourceUserTurnId: "wrong-user" }],
  [{ ...span, start: -1 }],
  [{ ...span, end: userText.length + 1 }],
  [{ ...span, text: "not exact" }],
] as UserMoveRelationCandidate["evidence"][]) {
  assert.equal(project(validTarget, relationFor(validTarget, [candidate("answers_move", 0.8, badEvidence)])), null);
}
assert.equal(project(validTarget, relationFor(validTarget, [candidate("answers_move", Number.NaN)])), null);
assert.equal(project(validTarget, relationFor(validTarget, [
  candidate("invalid_relation" as UserMoveRelationKind),
])), null);

const guestPlan = project(validTarget, validRelation);
const authenticatedPlan = project(validTarget, structuredClone(validRelation));
assert.deepEqual(authenticatedPlan, guestPlan);

const reciprocalEnvelope = buildProactiveGreetingAssistantMoveEnvelope({
  assistantMoveId: "assistant-reciprocal",
  generationId: "generation-reciprocal",
  greetingMove: "simple_greeting",
});
const recentMessages: AiConversationMessage[] = [{
  id: reciprocalEnvelope.assistantMoveId,
  role: "assistant",
  content: "嗨，你好呀。",
  status: "saved",
  promptVersion: "must-not-drive-v1",
  interactionMoveEnvelope: reciprocalEnvelope,
}];
const context = assembleConversationControlContext({
  conversationId: "phm-b-integration",
  currentTurnId: userTurnId,
  userMessage: userText,
  recentMessages,
  conversationState: determineConversationState({ currentUserMessage: userText, recentMessages }),
});
const deterministic = interpretTurnDeterministically(context);
assert(context.interactionMoveHandoffTarget);
const reciprocalRelation = relationFor(
  context.interactionMoveHandoffTarget,
  [candidate("reciprocates_move")]
);
const interpretation = { ...deterministic, userMoveRelation: reciprocalRelation };
const dialogueState = buildDialogueState(context, interpretation);
const responsePlanAuthority = createResponsePlanPreflightAuthoritySnapshot({
  context,
  interpretation,
  dialogueState,
});
const responsePlan = createResponsePlan({
  context,
  interpretation,
  dialogueState,
  clinicalAdviceProvider: () => null,
});
preflightAuthorities.set(responsePlan, responsePlanAuthority);
assert(Object.isFrozen(responsePlanAuthority));
assert(Object.isFrozen(responsePlanAuthority.currentSource));
assert(Object.isFrozen(responsePlanAuthority.expectedInteractionMoveHandoffPlan));
assert(Object.isFrozen(responsePlanAuthority.expectedInteractionMoveHandoffPlan?.evidence));
assert(Object.isFrozen(responsePlanAuthority.expectedInteractionMoveHandoffPlan?.evidence[0]));
assert(Object.isFrozen(responsePlanAuthority.canonicalProvenance));
assert(Object.isFrozen(responsePlanAuthority.canonicalProvenance[0]));
assert(Object.isFrozen(responsePlanAuthority.canonicalProvenance[0].evidence));
assert.notEqual(
  responsePlan.interactionMoveHandoffPlan,
  responsePlanAuthority.expectedInteractionMoveHandoffPlan
);
assert.notEqual(
  responsePlan.interactionMoveHandoffPlan?.evidence,
  responsePlanAuthority.expectedInteractionMoveHandoffPlan?.evidence
);
assert.throws(() => {
  (responsePlanAuthority as unknown as {
    currentSource: { userText: string };
  }).currentSource.userText = "mutation must fail";
}, TypeError);
assert.equal(responsePlan.interactionMoveHandoffPlan?.requiredFunction,
  "complete_reciprocal_contact");
assert(!responsePlan.responseActions.includes("respond_to_proactive_greeting"));
assert(preflightV1(responsePlan).passed);
assert(preflightV1({
  ...responsePlan,
  interactionMoveHandoffPlan: null,
}, responsePlan).failureReasons.includes("interaction_move_handoff_authority_mismatch"));
const logicallyEquivalentAuthority = createResponsePlanPreflightAuthoritySnapshot({
  context: structuredClone(context),
  interpretation: structuredClone(interpretation),
  dialogueState: structuredClone(dialogueState),
});
assert.deepEqual(logicallyEquivalentAuthority, responsePlanAuthority);
assert(preflightResponsePlan(responsePlan, logicallyEquivalentAuthority).passed);
assert(preflightV1({
  ...responsePlan,
  interactionMoveHandoffPlan: undefined,
} as unknown as typeof responsePlan, responsePlan).failureReasons.includes(
  "missing_interaction_move_handoff_plan_field"
));

const preflightWithHandoff = (handoff: InteractionMoveHandoffPlan) =>
  preflightV1({ ...responsePlan, interactionMoveHandoffPlan: handoff }, responsePlan);
for (const invalidEnumPatch of ([
  { sourceGreetingFunction: "invalid_greeting_function" },
  { selectedRelation: "invalid_relation" },
] as unknown as Array<Partial<InteractionMoveHandoffPlan>>)) {
  const malformed = {
    ...responsePlan.interactionMoveHandoffPlan,
    ...invalidEnumPatch,
  } as InteractionMoveHandoffPlan;
  assert(preflightWithHandoff(malformed).failureReasons.includes(
    "invalid_interaction_move_handoff_identity_or_enum"
  ));
}
for (const invalidTuplePatch of [
  { completionIntent: "defer" },
  { questionPolicy: "none" },
  { requiredFunction: "continue_from_user_answer" },
] as Array<Partial<InteractionMoveHandoffPlan>>) {
  const malformed = {
    ...responsePlan.interactionMoveHandoffPlan,
    ...invalidTuplePatch,
  } as InteractionMoveHandoffPlan;
  assert(preflightWithHandoff(malformed).failureReasons.includes(
    "invalid_interaction_move_handoff_tuple"
  ));
}
const malformedPreflightEvidence = {
  ...responsePlan.interactionMoveHandoffPlan,
  evidence: [{ ...span, end: span.end + 1 }],
} as InteractionMoveHandoffPlan;
assert(preflightWithHandoff(malformedPreflightEvidence).failureReasons.includes(
  "invalid_interaction_move_handoff_evidence"
));
const wrongPlanTurn = {
  ...responsePlan.interactionMoveHandoffPlan,
  sourceUserTurnId: "another-turn",
  evidence: [{ ...span, sourceUserTurnId: "another-turn" }],
} as InteractionMoveHandoffPlan;
assert(preflightWithHandoff(wrongPlanTurn).failureReasons.includes(
  "interaction_move_handoff_wrong_plan_turn"
));
assert(preflightV1({
  ...responsePlan,
  responseActions: [...responsePlan.responseActions, "respond_to_proactive_greeting"],
  relevanceProvenance: [
    ...responsePlan.relevanceProvenance,
    {
      planElement: "responseAction:respond_to_proactive_greeting",
      source: "interaction_state",
      sourceTurnId: userTurnId,
      evidence: ["adversarial repeat"],
    },
  ],
}, responsePlan).failureReasons.includes("reciprocal_handoff_must_not_repeat_proactive_greeting"));
const noQuestionHandoff = plan({
  greetingFunction: questionGreeting,
  candidates: [candidate("answers_move")],
});
assert(noQuestionHandoff);
assert(preflightV1({
  ...responsePlan,
  interactionMoveHandoffPlan: noQuestionHandoff,
  questionPolicy: { mode: "one_low_pressure_question", reason: "adversarial mismatch" },
}, responsePlan).failureReasons.includes("interaction_move_handoff_question_policy_mismatch"));

const buildV1ResponsePlan = ({
  message,
  relationKind,
  assistantText = "嗨，你好呀。",
}: {
  message: string;
  relationKind: UserMoveRelationKind;
  assistantText?: string;
}) => {
  const envelope = buildProactiveGreetingAssistantMoveEnvelope({
    assistantMoveId: "assistant-typed-repair-target",
    generationId: "generation-typed-repair-target",
    greetingMove: "simple_greeting",
  });
  const messages: AiConversationMessage[] = [{
    id: envelope.assistantMoveId,
    role: "assistant",
    content: assistantText,
    status: "saved",
    interactionMoveEnvelope: envelope,
  }];
  const currentTurnId = "typed-repair-user-turn";
  const currentContext = assembleConversationControlContext({
    conversationId: "phm-b-typed-repair",
    currentTurnId,
    userMessage: message,
    recentMessages: messages,
    conversationState: determineConversationState({
      currentUserMessage: message,
      recentMessages: messages,
    }),
  });
  assert(currentContext.interactionMoveHandoffTarget);
  const currentRelation: UserMoveRelationProjection = {
    sourceUserTurnId: currentTurnId,
    targetAssistantMoveId: envelope.assistantMoveId,
    targetFunction: "initiate_reciprocal_contact",
    candidates: [{
      kind: relationKind,
      confidence: 0.9,
      evidence: [{
        source: "current_user_turn",
        sourceUserTurnId: currentTurnId,
        start: 0,
        end: message.length,
        text: message,
      }],
    }],
    ambiguous: false,
  };
  const baseInterpretation = interpretTurnDeterministically(currentContext);
  const currentInterpretation = {
    ...baseInterpretation,
    userMoveRelation: currentRelation,
  };
  const currentDialogueState = buildDialogueState(currentContext, currentInterpretation);
  const authoritySnapshot = createResponsePlanPreflightAuthoritySnapshot({
    context: currentContext,
    interpretation: currentInterpretation,
    dialogueState: currentDialogueState,
  });
  const createdPlan = createResponsePlan({
    context: currentContext,
    interpretation: currentInterpretation,
    dialogueState: currentDialogueState,
    clinicalAdviceProvider: () => null,
  });
  preflightAuthorities.set(createdPlan, authoritySnapshot);
  return createdPlan;
};

const typedChallengePlans = [
  "这次互动不合适",
  "这个动作与当前交流不匹配",
].map((message) => buildV1ResponsePlan({
  message,
  relationKind: "challenges_move_fit",
}));
for (const challengePlan of typedChallengePlans) {
  assert.equal(challengePlan.interactionMoveHandoffPlan?.requiredFunction,
    "withdraw_or_repair_targeted_move");
  assert.equal(challengePlan.positiveFunctionContract?.action, "repair_previous_wording");
  if (challengePlan.positiveFunctionContract?.action !== "repair_previous_wording") assert.fail();
  assert.equal(challengePlan.positiveFunctionContract.repairMode,
    "interaction_move_withdrawal");
  assert.equal(challengePlan.positiveFunctionContract.interactionMoveSubtype, null);
  assert.equal(challengePlan.positiveFunctionContract.targetTurnId,
    "assistant-typed-repair-target");
  assert.equal(challengePlan.positiveFunctionContract.targetText, "嗨，你好呀。");
  assert(preflightV1(challengePlan).passed);
}
assert.deepEqual(
  typedChallengePlans.map((challengePlan) => {
    const contract = challengePlan.positiveFunctionContract;
    assert(contract?.action === "repair_previous_wording");
    return {
      function: challengePlan.interactionMoveHandoffPlan?.requiredFunction,
      mode: contract.repairMode,
      subtype: contract.interactionMoveSubtype,
      targetTurnId: contract.targetTurnId,
      targetText: contract.targetText,
    };
  }),
  [0, 1].map(() => ({
    function: "withdraw_or_repair_targeted_move",
    mode: "interaction_move_withdrawal",
    subtype: null,
    targetTurnId: "assistant-typed-repair-target",
    targetText: "嗨，你好呀。",
  }))
);
const validTypedRepairPlan = typedChallengePlans[0];
const validTypedRepairContract = validTypedRepairPlan.positiveFunctionContract;
assert(validTypedRepairContract?.action === "repair_previous_wording");
for (const invalidRepairContract of [
  { ...validTypedRepairContract, repairMode: "proposition_withdrawal" as const },
  { ...validTypedRepairContract, targetTurnId: "wrong-assistant-target" },
  { ...validTypedRepairContract, targetText: "wrong assistant text" },
]) {
  assert(preflightV1({
    ...validTypedRepairPlan,
    positiveFunctionContract: invalidRepairContract,
  }, validTypedRepairPlan).failureReasons.includes(
    "interaction_move_handoff_repair_contract_mismatch"
  ));
}

const validAnswerPlan = buildV1ResponsePlan({
  message: "你是谁？",
  relationKind: "opens_or_redirects_thread",
});
assert.equal(validAnswerPlan.interactionMoveHandoffPlan?.requiredFunction,
  "answer_current_obligation");
assert(validAnswerPlan.answerObligations.length > 0);
assert(preflightV1(validAnswerPlan).passed);
const validAnswerAuthority = preflightAuthorities.get(validAnswerPlan);
assert(validAnswerAuthority);
assert(Object.isFrozen(validAnswerAuthority.expectedAnswerObligations));
assert(Object.isFrozen(validAnswerAuthority.expectedAnswerObligations[0]));
assert(Object.isFrozen(validAnswerAuthority.expectedAnswerObligations[0].evidence));
assert.notEqual(validAnswerPlan.answerObligations, validAnswerAuthority.expectedAnswerObligations);
assert.notEqual(
  validAnswerPlan.answerObligations[0],
  validAnswerAuthority.expectedAnswerObligations[0]
);
assert(preflightResponsePlan(validAnswerPlan).failureReasons.includes(
  "interaction_move_handoff_authority_missing"
));
const challengeWithAnswerObligation = buildV1ResponsePlan({
  message: "你是谁？",
  relationKind: "challenges_move_fit",
});
assert.equal(challengeWithAnswerObligation.interactionMoveHandoffPlan?.requiredFunction,
  "answer_current_obligation");
assert.equal(challengeWithAnswerObligation.interactionMoveHandoffPlan?.selectedRelation,
  "challenges_move_fit");
assert(preflightV1(challengeWithAnswerObligation).passed);
const validObligation = validAnswerPlan.answerObligations[0];
for (const invalidObligation of [
  { ...validObligation, status: "answered" as const },
  { ...validObligation, sourceConversationId: "wrong-conversation" },
  { ...validObligation, sourceTurnId: "wrong-turn" },
  { ...validObligation, question: "" },
  { ...validObligation, question: "伪造的非空问题" },
  { ...validObligation, targetProposition: "" },
  { ...validObligation, targetProposition: "伪造的非空目标命题" },
  { ...validObligation, evidence: [] },
  { ...validObligation, kind: "invalid-kind" as typeof validObligation.kind },
]) {
  assert(preflightV1({
    ...validAnswerPlan,
    answerObligations: [invalidObligation],
  }, validAnswerPlan).failureReasons.some((reason) =>
    reason === "interaction_move_handoff_missing_current_answer_obligation" ||
    reason === "interaction_move_handoff_answer_obligation_authority_mismatch"
  ));
}
assert(preflightV1({
  ...validAnswerPlan,
  answerObligations: [
    validObligation,
    { ...validObligation, id: "invalid-extra-obligation", question: "" },
  ],
}, validAnswerPlan).failureReasons.includes(
  "interaction_move_handoff_answer_obligation_authority_mismatch"
));
assert(preflightV1({
  ...validAnswerPlan,
  relevanceProvenance: validAnswerPlan.relevanceProvenance.filter((item) =>
    item.planElement !== `answerObligation:${validObligation.id}`
  ),
}, validAnswerPlan).failureReasons.includes(
  "response_plan_canonical_provenance_mismatch"
));
const validObligationProvenance = validAnswerPlan.relevanceProvenance.find((item) =>
  item.planElement === `answerObligation:${validObligation.id}`
);
assert(validObligationProvenance);
for (const extraProvenance of [
  validObligationProvenance,
  {
    ...validObligationProvenance,
    evidence: [...validObligationProvenance.evidence, "question=\"conflict\""],
  },
  {
    ...validObligationProvenance,
    planElement: "answerObligation:fake-extra",
  },
]) {
  assert(preflightV1({
    ...validAnswerPlan,
    relevanceProvenance: [...validAnswerPlan.relevanceProvenance, extraProvenance],
  }, validAnswerPlan).failureReasons.includes(
    "response_plan_canonical_provenance_mismatch"
  ));
}
assert(preflightV1({
  ...validAnswerPlan,
  relevanceProvenance: validAnswerPlan.relevanceProvenance.map((item) =>
    item.planElement === `answerObligation:${validObligation.id}`
      ? { ...item, evidence: [...item.evidence, "conflicting-extra-field=true"] }
      : item
  ),
}, validAnswerPlan).failureReasons.includes("response_plan_canonical_provenance_mismatch"));

const inPlaceMutatedAnswerPlan = buildV1ResponsePlan({
  message: "你是谁？",
  relationKind: "opens_or_redirects_thread",
});
const inPlaceAnswerAuthority = preflightAuthorities.get(inPlaceMutatedAnswerPlan);
assert(inPlaceAnswerAuthority);
const originalAuthoritativeQuestion =
  inPlaceAnswerAuthority.expectedAnswerObligations[0].question;
inPlaceMutatedAnswerPlan.answerObligations[0].question = "协同篡改后的问题";
inPlaceMutatedAnswerPlan.answerObligations[0].targetProposition = "协同篡改后的目标";
const inPlaceObligationProvenance = inPlaceMutatedAnswerPlan.relevanceProvenance.find((item) =>
  item.planElement.startsWith("answerObligation:")
);
assert(inPlaceObligationProvenance);
inPlaceObligationProvenance.evidence = inPlaceObligationProvenance.evidence.map((item) =>
  item.startsWith("question=")
    ? `question=${JSON.stringify("协同篡改后的问题")}`
    : item.startsWith("targetProposition=")
      ? `targetProposition=${JSON.stringify("协同篡改后的目标")}`
      : item
);
assert.equal(
  inPlaceAnswerAuthority.expectedAnswerObligations[0].question,
  originalAuthoritativeQuestion
);
assert(preflightResponsePlan(
  inPlaceMutatedAnswerPlan,
  inPlaceAnswerAuthority
).failureReasons.includes("interaction_move_handoff_answer_obligation_authority_mismatch"));

const punctuationInvariantPlans = ["嗨，你好呀。", "嗨，你好呀？"].map((assistantText) =>
  buildV1ResponsePlan({
    message: "你好",
    relationKind: "reciprocates_move",
    assistantText,
  })
);
assert.deepEqual(
  punctuationInvariantPlans.map((item) => ({
    handoff: item.interactionMoveHandoffPlan,
    totalQuestionPolicy: item.questionPolicy,
  })),
  [0, 1].map(() => ({
    handoff: punctuationInvariantPlans[0].interactionMoveHandoffPlan,
    totalQuestionPolicy: punctuationInvariantPlans[0].questionPolicy,
  }))
);

const wrongAssistantIdHandoff = {
  ...responsePlan.interactionMoveHandoffPlan,
  sourceAssistantMoveId: "wrong-assistant-id",
} as InteractionMoveHandoffPlan;
assert(preflightWithHandoff(wrongAssistantIdHandoff).failureReasons.includes(
  "interaction_move_handoff_authority_mismatch"
));
assert(responsePlan.interactionMoveHandoffPlan);
const sameLengthWrongEvidence = {
  ...responsePlan.interactionMoveHandoffPlan,
  evidence: responsePlan.interactionMoveHandoffPlan.evidence.map((item) => ({
    ...item,
    text: "x".repeat(item.text.length),
  })),
};
assert(preflightWithHandoff(sameLengthWrongEvidence).failureReasons.includes(
  "interaction_move_handoff_authority_mismatch"
));
const reciprocalMutatedToDefer = {
  ...responsePlan.interactionMoveHandoffPlan,
  requiredFunction: "defer_handoff_completion" as const,
  completionIntent: "defer" as const,
  questionPolicy: "none" as const,
};
assert(preflightWithHandoff(reciprocalMutatedToDefer).failureReasons.includes(
  "interaction_move_handoff_authority_mismatch"
));
const coMutatedRelationProvenance = responsePlan.relevanceProvenance.map((item) =>
  item.planElement === "interactionMoveHandoffPlan:relation"
    ? {
        ...item,
        evidence: item.evidence.map((evidence) =>
          evidence.startsWith("requiredFunction=")
            ? "requiredFunction=defer_handoff_completion"
            : evidence.startsWith("completionIntent=")
              ? "completionIntent=defer"
              : evidence.startsWith("questionPolicy=")
                ? "questionPolicy=none"
                : evidence
        ),
      }
    : item
);
assert(preflightV1({
  ...responsePlan,
  interactionMoveHandoffPlan: reciprocalMutatedToDefer,
  relevanceProvenance: coMutatedRelationProvenance,
  questionPolicy: { mode: "none", reason: "co-mutated" },
}, responsePlan).failureReasons.includes("interaction_move_handoff_authority_mismatch"));

const inPlaceMutatedHandoffPlan = buildV1ResponsePlan({
  message: "你好",
  relationKind: "reciprocates_move",
});
const inPlaceHandoffAuthority = preflightAuthorities.get(inPlaceMutatedHandoffPlan);
assert(inPlaceHandoffAuthority);
assert(inPlaceMutatedHandoffPlan.interactionMoveHandoffPlan);
const authoritativeEvidenceText =
  inPlaceHandoffAuthority.expectedInteractionMoveHandoffPlan?.evidence[0].text;
inPlaceMutatedHandoffPlan.interactionMoveHandoffPlan.evidence[0].text = "协同别名篡改";
const inPlaceRelationProvenance = inPlaceMutatedHandoffPlan.relevanceProvenance.find((item) =>
  item.planElement === "interactionMoveHandoffPlan:relation"
);
assert(inPlaceRelationProvenance);
inPlaceRelationProvenance.evidence = inPlaceRelationProvenance.evidence.map((item) =>
  item.startsWith("currentUserText=")
    ? `currentUserText=${JSON.stringify("协同别名篡改")}`
    : item
);
assert.equal(
  inPlaceHandoffAuthority.expectedInteractionMoveHandoffPlan?.evidence[0].text,
  authoritativeEvidenceText
);
assert(preflightResponsePlan(
  inPlaceMutatedHandoffPlan,
  inPlaceHandoffAuthority
).failureReasons.includes("interaction_move_handoff_authority_mismatch"));

const partialV1Plan = createResponsePlan({
  context,
  interpretation: { ...interpretation, userMoveRelation: null },
  dialogueState,
  clinicalAdviceProvider: () => null,
});
assert.equal(partialV1Plan.interactionMoveHandoffPlan, null);
assert(!partialV1Plan.responseActions.includes("respond_to_proactive_greeting"));

for (const invalidEnvelope of [
  { ...reciprocalEnvelope, assistantMoveId: "mismatched-envelope-id" },
  { ...reciprocalEnvelope, schemaVersion: 999 },
] as unknown[]) {
  const invalidMessages: AiConversationMessage[] = [{
    id: reciprocalEnvelope.assistantMoveId,
    role: "assistant",
    content: "嗨，你好呀。",
    status: "saved",
    promptVersion: PROACTIVE_GREETING_PROMPT_VERSION,
    interactionMoveEnvelope: invalidEnvelope as AiConversationMessage["interactionMoveEnvelope"],
  }];
  const invalidContext = assembleConversationControlContext({
    conversationId: "phm-b-invalid-envelope",
    currentTurnId: userTurnId,
    userMessage: userText,
    recentMessages: invalidMessages,
    conversationState: determineConversationState({
      currentUserMessage: userText,
      recentMessages: invalidMessages,
    }),
  });
  assert.equal(invalidContext.interactionMoveHandoffEnvelopePresent, true);
  assert.equal(invalidContext.interactionMoveHandoffTarget, null);
  const invalidInterpretation = interpretTurnDeterministically(invalidContext);
  const invalidPlan = createResponsePlan({
    context: invalidContext,
    interpretation: invalidInterpretation,
    dialogueState: buildDialogueState(invalidContext, invalidInterpretation),
    clinicalAdviceProvider: () => null,
  });
  assert.equal(invalidPlan.interactionMoveHandoffPlan, null);
  assert(!invalidPlan.responseActions.includes("respond_to_proactive_greeting"));
}

const legacyMessages: AiConversationMessage[] = [{
  role: "assistant",
  content: "兼容问候",
  promptVersion: PROACTIVE_GREETING_PROMPT_VERSION,
}];
const legacyContext = assembleConversationControlContext({
  conversationId: "phm-b-legacy",
  currentTurnId: userTurnId,
  userMessage: userText,
  recentMessages: legacyMessages,
  conversationState: determineConversationState({ currentUserMessage: userText, recentMessages: legacyMessages }),
});
const legacyInterpretation = interpretTurnDeterministically(legacyContext);
const legacyPlan = createResponsePlan({
  context: legacyContext,
  interpretation: legacyInterpretation,
  dialogueState: buildDialogueState(legacyContext, legacyInterpretation),
  clinicalAdviceProvider: () => null,
});
assert.equal(legacyPlan.interactionMoveHandoffPlan, null);
assert(legacyPlan.responseActions.includes("respond_to_proactive_greeting"));

const plannerSource = readFileSync(
  new URL("../conversation-os/control/interactionMoveHandoffPlanner.ts", import.meta.url),
  "utf8"
);
assert(!plannerSource.includes("promptVersion"));
assert(!plannerSource.includes("RegExp"));
assert(!plannerSource.includes(".match("));
assert(!plannerSource.includes(".includes(currentUserText"));
const responsePlannerSource = readFileSync(
  new URL("../conversation-os/control/responsePlanner.ts", import.meta.url),
  "utf8"
);
assert(responsePlannerSource.includes(
  "interactionMoveHandoffPlan?.requiredFunction === \"withdraw_or_repair_targeted_move\"\n      ? typedHandoffRepairContractFor"
));
const typedRepairStart = responsePlannerSource.indexOf("const typedHandoffRepairContractFor");
const typedRepairEnd = responsePlannerSource.indexOf("const actionsForState", typedRepairStart);
const typedRepairSource = responsePlannerSource.slice(typedRepairStart, typedRepairEnd);
assert(typedRepairStart >= 0 && typedRepairEnd > typedRepairStart);
assert(!typedRepairSource.includes(".match("));
assert(!typedRepairSource.includes("interactionMoveSubtypeFor("));
assert(!typedRepairSource.includes("replacementFactFromCorrection("));
assert(responsePlannerSource.includes(
  "const legacyRespondsToProactiveGreeting = !hasAnyV1HandoffInput"
));

console.log("Interaction Move Handoff Planner check passed.");
