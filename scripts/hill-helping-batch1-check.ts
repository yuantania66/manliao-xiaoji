import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { AppError } from "../lib/errors";
import {
  assembleConversationControlContext,
  buildDialogueState,
  interpretTurnDeterministically,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import type { ConversationMessage } from "../conversation-os/types";
import { createChatReply } from "../services/ai/chatOrchestrationService";
import {
  buildHillHelpingInput,
  runHillHelpingShadow,
  validateHillHelpingPlan,
  type HillHelpingDecisionProvider,
  type HillHelpingInput,
  type HillHelpingPlan,
} from "../services/helping";

const selfCheck = {
  unsupportedAssumptions: [],
  possibleCulturalAssumptions: [],
  repeatedFailedMoves: [],
  capabilityLimits: [],
  userRejectedClaims: [],
  pressureRisk: "low" as const,
};

const explorationPlan: HillHelpingPlan = {
  applicability: "applicable",
  primaryGoal: "exploration",
  readiness: {
    status: "supported",
    evidence: ["An established helping thread is available in current-session state."],
    counterEvidence: [],
  },
  intention: "clarify_shared_understanding",
  primarySkill: "minimal_encourager",
  relationshipPriority: "none",
  expectedUserResponse: ["The user may confirm, correct, continue, or pause."],
  stopOrReassessWhen: ["The user corrects, pauses, changes the requested kind of help, or changes topic."],
  prohibitedMoves: [
    "Do not infer meaning from the short surface form.",
    "Do not turn a tentative interpretation into user fact.",
  ],
  helperSelfCheck: selfCheck,
  evidence: ["The provider received an established current-session conversation frame."],
  hypotheses: [],
};

const insightPlan: HillHelpingPlan = {
  ...explorationPlan,
  primaryGoal: "insight",
  intention: "assess_insight_readiness",
  primarySkill: "insight_question_or_probe",
};

const actionPlan: HillHelpingPlan = {
  ...explorationPlan,
  primaryGoal: "action",
  intention: "clarify_action_goal",
  primarySkill: "action_question_or_probe",
};

const repairPlan: HillHelpingPlan = {
  applicability: "applicable",
  intention: "repair_current_helping_relationship",
  primarySkill: "relationship_repair",
  relationshipPriority: "repair",
  expectedUserResponse: ["The user may accept, correct further, continue, or stop."],
  stopOrReassessWhen: ["Wait for the user's next response before selecting another helping goal."],
  prohibitedMoves: ["Do not defend the rejected interpretation.", "Do not advance another helping goal."],
  helperSelfCheck: selfCheck,
  evidence: ["Current relationship evidence identifies a concrete misunderstanding."],
  hypotheses: [],
};

const notApplicablePlan: HillHelpingPlan = {
  applicability: "not_applicable",
  relationshipPriority: "none",
  prohibitedMoves: ["Do not force a helping technique into an ordinary direct-answer turn."],
  helperSelfCheck: selfCheck,
  evidence: ["The turn is a deterministic ordinary capability question without an established helping frame."],
  hypotheses: [],
};

const uncertainPlan: HillHelpingPlan = {
  applicability: "uncertain",
  relationshipPriority: "none",
  prohibitedMoves: ["Do not infer psychological meaning.", "Do not select an ordinary conversation action here."],
  helperSelfCheck: selfCheck,
  evidence: ["Current material is insufficient and has no established context."],
  hypotheses: [],
};

const providerFor = (plan: HillHelpingPlan, onCall?: () => void): HillHelpingDecisionProvider =>
  async () => {
    onCall?.();
    return {
      text: JSON.stringify(plan),
      model: "test:hill-provider",
      latencyMs: 1,
      tokenInput: 10,
      tokenOutput: 10,
    };
  };

const priorHelpingQuestion: ConversationMessage[] = [
  {
    id: "user-prior",
    role: "user",
    content: "这件事让我有点乱，强度大概一到十分。",
  },
  {
    id: "assistant-prior",
    role: "assistant",
    content: "如果只按你现在的感受，一到十分更靠近哪边？",
    replyToMessageId: "user-prior",
    committedAssistantMove: {
      purpose: ["offer_emotional_support"],
      claims: [],
      assumptions: [],
      questionOrRequest: { kind: "question", text: "一到十分更靠近哪边？" },
      expectedUserContribution: "answer",
      userBurden: "low",
      sourceTurnId: "assistant-prior",
      evidence: ["A committed low-pressure question established an answer frame."],
    },
  },
];

const buildInput = ({
  text,
  recentMessages = [],
  turnId,
}: {
  text: string;
  recentMessages?: ConversationMessage[];
  turnId: string;
}): HillHelpingInput => {
  const conversationState = determineConversationState({
    currentUserMessage: text,
    recentMessages,
  });
  const context = assembleConversationControlContext({
    conversationId: `hill-batch1-${turnId}`,
    currentTurnId: turnId,
    userMessage: text,
    recentMessages,
    conversationState,
  });
  const interpretation = interpretTurnDeterministically(context);
  const dialogueState = buildDialogueState(context, interpretation);
  return buildHillHelpingInput({ context, interpretation, dialogueState });
};

const invalidPlanCases: Array<{ id: string; value: unknown }> = [
  { id: "not-object", value: [] },
  { id: "unknown-applicability", value: { ...uncertainPlan, applicability: "maybe" } },
  { id: "unknown-key", value: { ...uncertainPlan, ordinaryAction: "acknowledge" } },
  { id: "uncertain-goal", value: { ...uncertainPlan, primaryGoal: "exploration" } },
  { id: "uncertain-intention", value: { ...uncertainPlan, intention: "offer_support" } },
  { id: "uncertain-skill", value: { ...uncertainPlan, primarySkill: "minimal_encourager" } },
  { id: "not-applicable-readiness", value: { ...notApplicablePlan, readiness: explorationPlan.readiness } },
  { id: "not-applicable-stop", value: { ...notApplicablePlan, stopOrReassessWhen: ["later"] } },
  { id: "applicable-no-goal", value: { ...explorationPlan, primaryGoal: undefined } },
  { id: "applicable-no-readiness", value: { ...explorationPlan, readiness: undefined } },
  { id: "applicable-no-intention", value: { ...explorationPlan, intention: undefined } },
  { id: "applicable-no-skill", value: { ...explorationPlan, primarySkill: undefined } },
  { id: "applicable-no-stop", value: { ...explorationPlan, stopOrReassessWhen: [] } },
  { id: "applicable-no-expected", value: { ...explorationPlan, expectedUserResponse: [] } },
  { id: "goal-intention-mismatch", value: { ...explorationPlan, intention: "clarify_action_goal" } },
  { id: "goal-skill-mismatch", value: { ...explorationPlan, primarySkill: "direct_guidance" } },
  { id: "repair-with-goal", value: { ...repairPlan, primaryGoal: "exploration" } },
  { id: "repair-with-readiness", value: { ...repairPlan, readiness: explorationPlan.readiness } },
  { id: "repair-wrong-intention", value: { ...repairPlan, intention: "offer_support" } },
  { id: "repair-wrong-skill", value: { ...repairPlan, primarySkill: "restatement" } },
  { id: "repair-supporting-skill", value: { ...repairPlan, supportingSkill: "restatement" } },
  { id: "bad-pressure", value: { ...explorationPlan, helperSelfCheck: { ...selfCheck, pressureRisk: "extreme" } } },
  { id: "empty-evidence", value: { ...explorationPlan, evidence: [] } },
  { id: "empty-prohibited", value: { ...explorationPlan, prohibitedMoves: [] } },
];

const run = async () => {
  for (const [id, plan] of [
    ["uncertain", uncertainPlan],
    ["not-applicable", notApplicablePlan],
    ["exploration", explorationPlan],
    ["insight", insightPlan],
    ["action", actionPlan],
    ["repair", repairPlan],
  ] as const) {
    assert.equal(validateHillHelpingPlan(plan).valid, true, `${id} contract fixture must be valid.`);
  }
  for (const testCase of invalidPlanCases) {
    assert.equal(
      validateHillHelpingPlan(testCase.value).valid,
      false,
      `${testCase.id} must fail the structural contract.`
    );
  }

  const pairedForms = [
    "1", "2", "3", "0", "嗯", "好", "行", "是", "不", "A",
    "？", "。", "…", "🙂", "👍", "啊", "哦", "哈", "7", "9",
  ];
  let pairedProviderCalls = 0;
  for (const [index, form] of pairedForms.entries()) {
    const noContextInput = buildInput({ text: form, turnId: `pair-${index + 1}-empty` });
    const noContext = await runHillHelpingShadow({
      input: noContextInput,
      enabled: true,
      provider: async () => {
        throw new Error(`Contextless fragment ${form} must not call a provider.`);
      },
    });
    assert.equal(noContext.decision?.status, "decided", `${form} without context must be decided.`);
    assert.equal(
      noContext.decision?.status === "decided" ? noContext.decision.plan.applicability : null,
      "uncertain",
      `${form} without context must remain uncertain.`
    );
    assert.equal(noContext.provider.attempted, false, `${form} without context must use the fast uncertain boundary.`);

    const framedInput = buildInput({
      text: form,
      recentMessages: priorHelpingQuestion,
      turnId: `pair-${index + 1}-framed`,
    });
    const framed = await runHillHelpingShadow({
      input: framedInput,
      enabled: true,
      provider: providerFor(explorationPlan, () => { pairedProviderCalls += 1; }),
    });
    assert.equal(framed.provider.attempted, true, `${form} in an answer frame must not be fast-routed by form.`);
    assert.equal(
      framed.decision?.status === "decided" ? framed.decision.plan.applicability : null,
      "applicable",
      `${form} in an established helping frame may remain in the helping process.`
    );
  }
  assert.equal(pairedProviderCalls, pairedForms.length, "Every framed pair must reach exactly one domain provider call.");

  let ordinaryProviderCalls = 0;
  const ordinary = await runHillHelpingShadow({
    input: buildInput({ text: "你是谁？", turnId: "ordinary-question" }),
    enabled: true,
    provider: providerFor(explorationPlan, () => { ordinaryProviderCalls += 1; }),
  });
  assert.equal(ordinaryProviderCalls, 0, "A deterministic ordinary identity question must not add a model call.");
  assert.equal(
    ordinary.decision?.status === "decided" ? ordinary.decision.plan.applicability : null,
    "not_applicable"
  );

  const firstTurnNoAnalysis = buildInput({
    text: "别分析我，我只是想把这件事说出来。",
    turnId: "first-turn-no-analysis",
  });
  assert(firstTurnNoAnalysis.userBoundaries.some((item) => item.kind === "no_analysis"));
  assert(!firstTurnNoAnalysis.userBoundaries.some((item) => item.kind === "correction"));
  assert.equal(
    firstTurnNoAnalysis.currentRelationshipEvidence.length,
    0,
    "A first-turn no-analysis boundary must not fabricate an AI-user relationship rupture."
  );

  const invalidInput = buildInput({ text: "今天有点乱", turnId: "invalid-input" });
  invalidInput.currentUserMaterial.sourceTurnId = "wrong-source";
  const invalidInputTrace = await runHillHelpingShadow({
    input: invalidInput,
    enabled: true,
    provider: providerFor(notApplicablePlan),
  });
  assert.equal(invalidInputTrace.decision?.status, "failed");
  assert.equal(
    invalidInputTrace.decision?.status === "failed" ? invalidInputTrace.decision.failureCode : null,
    "invalid_input"
  );
  assert.equal(invalidInputTrace.provider.attempted, false);

  const providerInput = buildInput({ text: "今天有点乱", turnId: "provider-failures" });
  const invalidOutputTrace = await runHillHelpingShadow({
    input: providerInput,
    enabled: true,
    provider: async () => ({ text: "{}", model: "test:invalid", latencyMs: 1 }),
  });
  assert.equal(
    invalidOutputTrace.decision?.status === "failed" ? invalidOutputTrace.decision.failureCode : null,
    "invalid_plan",
    "Invalid provider schema must not become not_applicable."
  );

  const providerFailureTrace = await runHillHelpingShadow({
    input: providerInput,
    enabled: true,
    provider: async () => { throw new Error("provider unavailable"); },
  });
  assert.equal(
    providerFailureTrace.decision?.status === "failed" ? providerFailureTrace.decision.failureCode : null,
    "provider_failure"
  );

  const timeoutTrace = await runHillHelpingShadow({
    input: providerInput,
    enabled: true,
    provider: async () => { throw new AppError("AI_GENERATION_FAILED", "AI 服务调用超时", 504); },
  });
  assert.equal(
    timeoutTrace.decision?.status === "failed" ? timeoutTrace.decision.failureCode : null,
    "timeout"
  );

  const inputConflictCases: Array<{
    id: string;
    boundary: HillHelpingInput["userBoundaries"][number];
    plan: HillHelpingPlan;
  }> = [
    {
      id: "no-advice-action",
      boundary: { kind: "no_advice", sourceTurnId: providerInput.userTurnId, text: "别给建议", evidence: ["explicit"] },
      plan: actionPlan,
    },
    {
      id: "no-analysis-insight",
      boundary: { kind: "no_analysis", sourceTurnId: providerInput.userTurnId, text: "别分析", evidence: ["explicit"] },
      plan: insightPlan,
    },
    {
      id: "no-questions-question-skill",
      boundary: { kind: "no_questions", sourceTurnId: providerInput.userTurnId, text: "别问我", evidence: ["explicit"] },
      plan: { ...explorationPlan, primarySkill: "thought_question_or_probe" },
    },
    {
      id: "pause-action",
      boundary: { kind: "pause", sourceTurnId: providerInput.userTurnId, text: "先停一下", evidence: ["explicit"] },
      plan: actionPlan,
    },
  ];
  for (const conflict of inputConflictCases) {
    const conflictInput: HillHelpingInput = {
      ...providerInput,
      userBoundaries: [conflict.boundary],
    };
    const trace = await runHillHelpingShadow({
      input: conflictInput,
      enabled: true,
      provider: providerFor(conflict.plan),
    });
    assert.equal(trace.decision?.status, "failed", `${conflict.id} must fail against the current user boundary.`);
    assert.equal(trace.decision?.status === "failed" ? trace.decision.failureCode : null, "invalid_plan");
  }

  const repairWithoutEvidence = await runHillHelpingShadow({
    input: providerInput,
    enabled: true,
    provider: providerFor(repairPlan),
  });
  assert.equal(repairWithoutEvidence.decision?.status, "failed");
  assert(
    repairWithoutEvidence.decision?.status === "failed" &&
      repairWithoutEvidence.decision.evidence.includes("repair_without_current_relationship_evidence")
  );

  let safetyProviderCalls = 0;
  const safetyReply = await createChatReply({
    conversationId: "hill-batch1-safety",
    currentTurnId: "hill-batch1-safety-turn",
    userMessage: "我现在想伤害自己",
    recentMessages: [],
    helpingShadowEnabled: true,
    helpingDecisionProvider: providerFor(explorationPlan, () => { safetyProviderCalls += 1; }),
  });
  assert.equal(safetyReply.finalSource, "safety");
  assert.equal(safetyProviderCalls, 0, "Safety must return before ordinary Helping Logic.");
  assert.equal(safetyReply.helpingTrace.skippedReason, "safety_pre_gate");

  const previousProvider = process.env.AI_PROVIDER;
  const previousInterpreter = process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED;
  process.env.AI_PROVIDER = "mock";
  process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED = "false";
  try {
    const disabledSurfacePrompts: string[] = [];
    const enabledSurfacePrompts: string[] = [];
    const disabled = await createChatReply({
      conversationId: "hill-batch1-equivalence",
      currentTurnId: "hill-batch1-equivalence-turn",
      requestId: "hill-batch1-equivalence-disabled",
      userMessage: "今天有点乱",
      recentMessages: [],
      helpingShadowEnabled: false,
      inspectExternalPrompt: ({ stage, messages }) => {
        if (stage === "surface_realization") disabledSurfacePrompts.push(JSON.stringify(messages));
      },
    });
    let shadowProviderCalls = 0;
    let helpingPromptInspections = 0;
    const enabled = await createChatReply({
      conversationId: "hill-batch1-equivalence",
      currentTurnId: "hill-batch1-equivalence-turn",
      requestId: "hill-batch1-equivalence-enabled",
      userMessage: "今天有点乱",
      recentMessages: [],
      helpingShadowEnabled: true,
      helpingDecisionProvider: providerFor(explorationPlan, () => { shadowProviderCalls += 1; }),
      inspectHelpingPrompt: ({ stage, messages }) => {
        assert.equal(stage, "helping_shadow");
        assert(messages.length > 0);
        helpingPromptInspections += 1;
      },
      inspectExternalPrompt: ({ stage, messages }) => {
        if (stage === "surface_realization") enabledSurfacePrompts.push(JSON.stringify(messages));
      },
    });
    assert.equal(shadowProviderCalls, 1, "One non-fast Shadow turn must call the Helping provider exactly once.");
    assert.equal(helpingPromptInspections, 1, "The exact Helping prompt must be inspectable before its external call.");
    assert.deepEqual(enabled.controlTrace?.responsePlan, disabled.controlTrace?.responsePlan);
    assert.deepEqual(enabled.controlTrace?.dialogueState, disabled.controlTrace?.dialogueState);
    assert.deepEqual(enabled.controlTrace?.stateUpdate, disabled.controlTrace?.stateUpdate);
    assert.deepEqual(enabledSurfacePrompts, disabledSurfacePrompts);
    assert.equal(enabled.generation.text, disabled.generation.text);
    assert.equal(JSON.stringify(enabled.controlTrace?.responsePlan).includes("helping"), false);
    assert.equal(JSON.stringify(enabled.controlTrace?.dialogueState).includes("HillHelping"), false);
  } finally {
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
    if (previousInterpreter === undefined) delete process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED;
    else process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED = previousInterpreter;
  }

  const orchestration = readFileSync("services/ai/chatOrchestrationService.ts", "utf8");
  const planner = readFileSync("conversation-os/control/responsePlanner.ts", "utf8");
  const surface = readFileSync("services/ai/promptBuilder.ts", "utf8");
  const validator = readFileSync("services/ai/responsePlanValidator.ts", "utf8");
  const safetyIndex = orchestration.indexOf("if (isCrisisInput(userMessage))");
  const helpingIndex = orchestration.indexOf("await runHillHelpingShadow({");
  const plannerIndex = orchestration.indexOf("const responsePlan = createResponsePlan({");
  assert(safetyIndex >= 0 && safetyIndex < helpingIndex && helpingIndex < plannerIndex);
  assert.equal((orchestration.match(/runHillHelpingShadow\(/gu) ?? []).length, 1);
  for (const [name, source] of [["Planner", planner], ["Surface", surface], ["Validator", validator]] as const) {
    assert(!source.includes("runHillHelpingShadow("), `${name} must not invoke Helping Logic.`);
    assert(!source.includes("HillGoalFamily"), `${name} must not choose a Hill goal in Batch 1.`);
    assert(!source.includes("HillSkill"), `${name} must not choose a Hill skill in Batch 1.`);
  }

  console.log(JSON.stringify({
    validContractFixtures: 6,
    invalidContractCounterExamples: invalidPlanCases.length,
    sameFormDifferentContextPairs: pairedForms.length,
    pairedTurnsChecked: pairedForms.length * 2,
    heldOutPairs: pairedForms.slice(-5),
    failureSemantics: ["invalid_input", "invalid_plan", "provider_failure", "timeout"],
    inputBoundaryCounterExamples: inputConflictCases.length + 1,
    safetyProviderCalls,
    shadowEquivalence: {
      responsePlan: true,
      dialogueState: true,
      formalStateUpdate: true,
      surfacePrompt: true,
      visibleReply: true,
    },
    ownership: {
      helpingRunsAfterSafety: true,
      helpingRunsBeforePlanner: true,
      helpingCallSites: 1,
      plannerSurfaceValidatorDoNotChooseHill: true,
    },
  }, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
