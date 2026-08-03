import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
  mergeModelInterpretation,
  type ResponsePlan,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { preflightResponsePlan } from "../services/ai/chatExecutionLifecycle";
import { formatResponsePlanForPrompt } from "../services/ai/promptBuilder";
import {
  formatResponsePlanRegenerateConstraint,
  validateResponsePlanOutput,
} from "../services/ai/responsePlanValidator";
import {
  loadPreservationDataset,
  type PreservationScenario,
} from "./hill-helping-batch1-5-preservation-lib";

type GateCase = {
  id: string;
  dimension: string;
  scenarioId: string;
  reply: string;
  expectedPass: boolean;
  expectedFailureIncludes: string[];
  rationale: string;
};
type GateDataset = {
  schemaVersion: 1;
  status: "frozen_before_code_change";
  minimumCases: number;
  cases: GateCase[];
};
type Attribution =
  | "planner_contract_failure"
  | "surface_failure"
  | "validator_false_positive"
  | "both"
  | "appropriate_pass"
  | "surface_failure_validator_false_negative";
type Candidate4Audit = {
  sourceArtifactSha256: string;
  datasetSha256: string;
  finalFailures: Array<{
    auditId: string;
    scenarioId: string;
    runIndex: number;
    attribution: Attribution;
  }>;
  regenerationAudits: Array<{
    auditId: string;
    scenarioId: string;
    runIndex: number;
    firstAttribution: Attribution;
    secondAttribution: Attribution;
  }>;
};
type Candidate4Artifact = {
  datasetSha256: string;
  rows: Array<{
    scenarioId: string;
    runIndex: number;
    attempts: Array<{ attempt: number; text: string }>;
  }>;
};
type Candidate5Audit = {
  sourceArtifactSha256: string;
  datasetSha256: string;
  scope: { allFinalRowsAudited: number };
  anomalies: Array<{
    scenarioId: string;
    runIndex: number;
    attribution:
      | "surface_failure"
      | "validator_false_positive"
      | "both"
      | "surface_failure_validator_false_negative";
  }>;
};

const { dataset, sha256 } = loadPreservationDataset();
const buildPlan = (scenario: PreservationScenario): ResponsePlan => {
  const conversationState = determineConversationState({
    currentUserMessage: scenario.userMessage,
    recentMessages: scenario.recentMessages,
  });
  const context = assembleConversationControlContext({
    conversationId: `post-candidate4-${scenario.id}`,
    currentTurnId: `${scenario.id}-turn`,
    userMessage: scenario.userMessage,
    recentMessages: scenario.recentMessages,
    conversationState,
  });
  const deterministic = interpretTurnDeterministically(context);
  const interpretation = mergeModelInterpretation(deterministic, {
    responseRelation: {
      candidates: scenario.kind === "emotional_support"
        ? [{
            relation: "shares_distress",
            confidence: 0.9,
            evidence: ["Post-candidate-4 fixture contains current-turn affect."],
          }]
        : [{
            relation: "repairs_previous_move",
            confidence: 0.95,
            targetTurnId: scenario.recentMessages.at(-1)?.id,
            evidence: ["Post-candidate-4 fixture rejects the adjacent assistant move."],
          }],
      ambiguous: false,
    },
  }, context);
  const dialogueState = buildDialogueState(context, interpretation);
  const plan = createResponsePlan({
    context,
    interpretation,
    dialogueState,
    clinicalAdviceProvider: () => null,
  });
  assert(plan.responseActions.includes(scenario.expectedAction), `${scenario.id} action mismatch.`);
  const preflight = preflightResponsePlan(plan);
  assert.equal(preflight.passed, true, `${scenario.id} preflight: ${preflight.failureReasons.join(",")}`);
  return plan;
};

const plans = new Map(dataset.scenarios.map((scenario) => [scenario.id, buildPlan(scenario)]));
const planFor = (scenarioId: string) => {
  const plan = plans.get(scenarioId);
  assert(plan, `Missing plan for ${scenarioId}.`);
  return plan;
};
const planForFrozenSurfaceReplay = (scenarioId: string): ResponsePlan => {
  const plan = planFor(scenarioId);
  return plan.positiveFunctionContract?.action === "offer_emotional_support" &&
    plan.positiveFunctionContract.supportFunction === "return_amount_control"
    ? {
        ...plan,
        positiveFunctionContract: {
          ...plan.positiveFunctionContract,
          supportFunction: "return_focus_control",
        },
      }
    : plan;
};

const gateSource = readFileSync("clinical-evals/hill-helping-batch1-5-post-candidate4-gate.json");
const gate = JSON.parse(gateSource.toString("utf8")) as GateDataset;
assert.equal(gate.schemaVersion, 1);
assert.equal(gate.status, "frozen_before_code_change");
assert(gate.cases.length >= gate.minimumCases);
assert(gate.cases.filter((item) => item.expectedPass).length >= 20);
assert(gate.cases.filter((item) => !item.expectedPass).length >= 20);

for (const testCase of gate.cases) {
  const validation = validateResponsePlanOutput({
    plan: planForFrozenSurfaceReplay(testCase.scenarioId),
    reply: testCase.reply,
  });
  assert.equal(
    validation.passed,
    testCase.expectedPass,
    `${testCase.id} mismatch: ${validation.failureReasons.join(",")}`
  );
  for (const failure of testCase.expectedFailureIncludes) {
    assert(
      validation.failureReasons.includes(failure),
      `${testCase.id} missing ${failure}: ${validation.failureReasons.join(",")}`
    );
  }
}

const freshAdversarialCases: GateCase[] = [
  {
    id: "FRESH-RAD-P",
    dimension: "repair_adversarial",
    scenarioId: "repair-advice-boundary",
    reply: "刚才替你列步骤是在给方案，是我多嘴，这种做法不该。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Advice is identified and disavowed through a new composition.",
  },
  {
    id: "FRESH-RPQ-P",
    dimension: "repair_adversarial",
    scenarioId: "repair-question-pressure",
    reply: "一个问题接一个问题地抛给你，是我在盘问，这样越界了。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Question pressure is owned without copying the frozen forms.",
  },
  {
    id: "FRESH-RGL-P",
    dimension: "repair_adversarial",
    scenarioId: "repair-generic-listening",
    reply: "光顾着说认真听，却没有接你的重点，是我的问题。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Generic listening is rejected by its failed function.",
  },
  {
    id: "FRESH-RMO-P",
    dimension: "repair_adversarial",
    scenarioId: "repair-moralizing",
    reply: "把勇敢一点当成标准来评判你，是我说教越界了。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Moral evaluation target and boundary are explicit.",
  },
  {
    id: "FRESH-RTS-P",
    dimension: "repair_adversarial",
    scenarioId: "repair-topic-switch",
    reply: "刚才扯到放松上，把你原来的话带偏了，是我的问题。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Topic detour is identified by its effect.",
  },
  {
    id: "FRESH-RAD-N",
    dimension: "repair_adversarial",
    scenarioId: "repair-advice-boundary",
    reply: "我刚才追着问细节了，这样越界。",
    expectedPass: false,
    expectedFailureIncludes: ["repair:missing_interaction_move_withdrawal:unsolicited_advice"],
    rationale: "Wrong repair target must remain rejected.",
  },
  {
    id: "FRESH-RPQ-N",
    dimension: "repair_adversarial",
    scenarioId: "repair-question-pressure",
    reply: "我刚才抛了一串问题，下次会注意。",
    expectedPass: false,
    expectedFailureIncludes: ["repair:missing_interaction_move_withdrawal:pressure_question"],
    rationale: "Future promise is not functional disavowal.",
  },
  {
    id: "FRESH-RGL-N",
    dimension: "repair_adversarial",
    scenarioId: "repair-generic-listening",
    reply: "我刚才只是在说会听，以后会更认真听。",
    expectedPass: false,
    expectedFailureIncludes: ["repair:missing_interaction_move_withdrawal:generic_listening"],
    rationale: "Repeating the rejected promise is not repair.",
  },
  {
    id: "FRESH-RMO-N",
    dimension: "repair_adversarial",
    scenarioId: "repair-moralizing",
    reply: "我刚才表达得不好，是我的问题。",
    expectedPass: false,
    expectedFailureIncludes: ["repair:missing_interaction_move_withdrawal:moralizing"],
    rationale: "Vague ownership lacks the rejected moral target.",
  },
  {
    id: "FRESH-RTS-N",
    dimension: "repair_adversarial",
    scenarioId: "repair-topic-switch",
    reply: "我不该继续给你列方案。",
    expectedPass: false,
    expectedFailureIncludes: ["repair:missing_interaction_move_withdrawal:topic_switch"],
    rationale: "Advice withdrawal cannot satisfy a topic-switch repair.",
  },
  {
    id: "FRESH-AFF-BLOCKED-P",
    dimension: "affect_adversarial",
    scenarioId: "emotion-vague-blocked",
    reply: "心里那股堵，你愿意先碰哪一块都可以。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Blocked affect survives a new demonstrative form.",
  },
  {
    id: "FRESH-AFF-SAD-P",
    dimension: "affect_adversarial",
    scenarioId: "emotion-sudden-sadness",
    reply: "眼下这阵伤心，你想先说哪一点都行。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "A same-category sadness synonym remains grounded.",
  },
  {
    id: "FRESH-AFF-MIXED-P",
    dimension: "affect_adversarial",
    scenarioId: "emotion-mixed-anger",
    reply: "这份委屈和生气，先说哪部分由你定。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Both user-provided affect categories remain in scope.",
  },
  {
    id: "FRESH-AFF-FEAR-N",
    dimension: "affect_adversarial",
    scenarioId: "emotion-lonely",
    reply: "这份害怕，你想先讲哪部分都可以。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:unsupported_affect_category:fear:害怕"],
    rationale: "Loneliness cannot be relabeled as fear.",
  },
  {
    id: "FRESH-AFF-INTENSE-N",
    dimension: "affect_adversarial",
    scenarioId: "emotion-sudden-sadness",
    reply: "现在非常难过，你想先说哪一点都可以。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:unsupported_intensification:非常难过"],
    rationale: "A low-intensity source cannot be intensified.",
  },
  {
    id: "FRESH-SCOPE-CURRENT-P",
    dimension: "scope_adversarial",
    scenarioId: "emotion-lonely",
    reply: "这份孤单，你想先碰眼下的感觉还是今晚这一刻都可以。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Both choices refer to current evidence.",
  },
  {
    id: "FRESH-SCOPE-ASPECT-P",
    dimension: "scope_adversarial",
    scenarioId: "emotion-sudden-sadness",
    reply: "关于这份难过，先说这种感受的哪一面由你定。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "A new aspect noun remains scoped by current sadness.",
  },
  {
    id: "FRESH-SCOPE-UNRELATED-N",
    dimension: "scope_adversarial",
    scenarioId: "emotion-lonely",
    reply: "这份孤单，你也可以聊聊无关的内容。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:out_of_scope_unknown_content"],
    rationale: "Unrelated content is outside the current turn.",
  },
  {
    id: "FRESH-SCOPE-CAUSE-N",
    dimension: "scope_adversarial",
    scenarioId: "emotion-future-worry",
    reply: "这点担心，你想先说还有哪些事情使你担心都可以。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:out_of_scope_unsupported_cause_or_event"],
    rationale: "Unmentioned additional causes must be rejected.",
  },
  {
    id: "FRESH-SCOPE-DISTRACT-N",
    dimension: "scope_adversarial",
    scenarioId: "emotion-irritated",
    reply: "这股烦，你也可以先谈点轻松的把注意力挪开。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:out_of_scope_topic_switch"],
    rationale: "A synonymous distraction move remains out of scope.",
  },
  {
    id: "FRESH-SURFACE-BURDEN-P",
    dimension: "surface_adversarial",
    scenarioId: "emotion-no-analysis",
    reply: "这点难受不必分析来龙去脉，也不用讲完整。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Burden reduction does not add another action.",
  },
  {
    id: "FRESH-SURFACE-PAUSE-N",
    dimension: "surface_adversarial",
    scenarioId: "emotion-no-analysis",
    reply: "这点难受不用分析，先搁一搁。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:unrequested_pause_or_closure"],
    rationale: "A synonymous pause must not be smuggled into burden reduction.",
  },
  {
    id: "FRESH-SURFACE-BREATH-N",
    dimension: "surface_adversarial",
    scenarioId: "emotion-future-worry",
    reply: "这点担心，你想先说哪部分，也可以做几次腹式呼吸。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:unsolicited_regulation_advice"],
    rationale: "A new breathing-exercise wording is still regulation advice.",
  },
  {
    id: "FRESH-SURFACE-NORMALIZE-N",
    dimension: "surface_adversarial",
    scenarioId: "emotion-sudden-sadness",
    reply: "这份难过是人之常情，你想先说哪部分都可以。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:generic_normalization_or_reassurance"],
    rationale: "A synonymous normalization remains prohibited.",
  },
];

for (const testCase of freshAdversarialCases) {
  const validation = validateResponsePlanOutput({
    plan: planForFrozenSurfaceReplay(testCase.scenarioId),
    reply: testCase.reply,
  });
  assert.equal(
    validation.passed,
    testCase.expectedPass,
    `${testCase.id} mismatch: ${validation.failureReasons.join(",")}`
  );
  for (const failure of testCase.expectedFailureIncludes) {
    assert(
      validation.failureReasons.includes(failure),
      `${testCase.id} missing ${failure}: ${validation.failureReasons.join(",")}`
    );
  }
}

const audit = JSON.parse(readFileSync(
  "docs/evals/hill-helping-batch1-5-candidate4-layered-attribution-20260803.json",
  "utf8"
)) as Candidate4Audit;
const artifactSource = readFileSync(
  "docs/evals/hill-helping-batch1-5-preservation-candidate4-20260803.json"
);
const artifact = JSON.parse(artifactSource.toString("utf8")) as Candidate4Artifact;
assert.equal(audit.datasetSha256, sha256);
assert.equal(artifact.datasetSha256, sha256);
assert.equal(createHash("sha256").update(artifactSource).digest("hex"), audit.sourceArtifactSha256);
assert.equal(audit.finalFailures.length, 16);
assert.equal(audit.regenerationAudits.length, 30);

const shouldPass = (attribution: Attribution) =>
  attribution === "validator_false_positive" || attribution === "appropriate_pass";
const finalReplay = audit.finalFailures.map((entry) => {
  const row = artifact.rows.find((candidate) =>
    candidate.scenarioId === entry.scenarioId && candidate.runIndex === entry.runIndex
  );
  assert(row, `${entry.auditId} row missing.`);
  const attempt = row.attempts.at(-1);
  assert(attempt, `${entry.auditId} final attempt missing.`);
  const validation = validateResponsePlanOutput({
    plan: planForFrozenSurfaceReplay(entry.scenarioId),
    reply: attempt.text,
  });
  assert.equal(
    validation.passed,
    shouldPass(entry.attribution),
    `${entry.auditId} ${entry.attribution}: ${validation.failureReasons.join(",")}`
  );
  if (entry.attribution === "both") {
    assert(
      !validation.failureReasons.includes("emotional_support:missing_grounded_affect_or_impact"),
      `${entry.auditId} must remove the false grounding reason.`
    );
  }
  return { ...entry, validation };
});

const regenerationReplay = audit.regenerationAudits.flatMap((entry) => {
  const row = artifact.rows.find((candidate) =>
    candidate.scenarioId === entry.scenarioId && candidate.runIndex === entry.runIndex
  );
  assert(row, `${entry.auditId} row missing.`);
  return [entry.firstAttribution, entry.secondAttribution].map((attribution, index) => {
    const attempt = row.attempts[index];
    assert(attempt, `${entry.auditId} attempt ${index + 1} missing.`);
    const validation = validateResponsePlanOutput({
      plan: planForFrozenSurfaceReplay(entry.scenarioId),
      reply: attempt.text,
    });
    assert.equal(
      validation.passed,
      shouldPass(attribution),
      `${entry.auditId} attempt ${index + 1} ${attribution}: ${validation.failureReasons.join(",")}`
    );
    if (attribution === "surface_failure_validator_false_negative") {
      assert(validation.failureReasons.length > 0, `${entry.auditId} false negative must now reject.`);
    }
    return { auditId: entry.auditId, attempt: index + 1, attribution, validation };
  });
});

const candidate5Audit = JSON.parse(readFileSync(
  "docs/evals/hill-helping-batch1-5-candidate5-full-final-attribution-20260803.json",
  "utf8"
)) as Candidate5Audit;
const candidate5ArtifactSource = readFileSync(
  "docs/evals/hill-helping-batch1-5-preservation-candidate5-20260803.json"
);
const candidate5Artifact = JSON.parse(candidate5ArtifactSource.toString("utf8")) as Candidate4Artifact;
assert.equal(candidate5Audit.datasetSha256, sha256);
assert.equal(candidate5Artifact.datasetSha256, sha256);
assert.equal(
  createHash("sha256").update(candidate5ArtifactSource).digest("hex"),
  candidate5Audit.sourceArtifactSha256
);
assert.equal(candidate5Artifact.rows.length, candidate5Audit.scope.allFinalRowsAudited);
const candidate5Anomalies = new Map(candidate5Audit.anomalies.map((item) => [
  `${item.scenarioId}:${item.runIndex}`,
  item,
]));
const candidate5FinalReplay = candidate5Artifact.rows.map((row) => {
  const finalAttempt = row.attempts.at(-1);
  assert(finalAttempt, `${row.scenarioId}:${row.runIndex} final attempt missing.`);
  const validation = validateResponsePlanOutput({
    plan: planForFrozenSurfaceReplay(row.scenarioId),
    reply: finalAttempt.text,
  });
  const anomaly = candidate5Anomalies.get(`${row.scenarioId}:${row.runIndex}`);
  const expectedPass = !anomaly || anomaly.attribution === "validator_false_positive";
  assert.equal(
    validation.passed,
    expectedPass,
    `candidate5 ${row.scenarioId}:${row.runIndex} ${anomaly?.attribution ?? "appropriate_pass"}: ${validation.failureReasons.join(",")}`
  );
  if (anomaly?.attribution === "both") {
    assert(
      validation.failureReasons.includes("repair:continues_rejected_interaction_move:pressure_question"),
      `candidate5 ${row.scenarioId}:${row.runIndex} must reject continued pressure questioning.`
    );
    assert(
      !validation.failureReasons.includes("repair:missing_interaction_move_withdrawal:pressure_question"),
      `candidate5 ${row.scenarioId}:${row.runIndex} must accept the completed repair relation.`
    );
  }
  return { row, anomaly, validation };
});
assert(
  !planFor("repair-question-pressure").responseActions.includes("take_light_topic_initiative"),
  "Repair must not concurrently start a light topic."
);

const emotionalPrompt = formatResponsePlanForPrompt(
  planForFrozenSurfaceReplay("emotion-lonely")
);
assert(emotionalPrompt.includes("unspecified 'something else'"));
assert(emotionalPrompt.includes("content already evidenced in the current user turn"));
assert(emotionalPrompt.includes("Do not manufacture an A-or-B choice"));
const repairPlan = planFor("repair-topic-switch");
const repairPrompt = formatResponsePlanForPrompt(repairPlan);
assert(repairPrompt.includes("要不要先做个呼吸练习放松一下？"));
assert(repairPrompt.includes("do not mechanically repeat the internal subtype name"));
const scopeRegeneration = formatResponsePlanRegenerateConstraint(
  planForFrozenSurfaceReplay("emotion-lonely"),
  ["emotional_support:out_of_scope_unknown_content"]
);
assert(scopeRegeneration.includes("当前用户本轮已经表达的内容"));
const repairRegeneration = formatResponsePlanRegenerateConstraint(
  repairPlan,
  ["repair:missing_interaction_move_withdrawal:topic_switch"]
);
assert(repairRegeneration.includes("要不要先做个呼吸练习放松一下？"));
assert(repairRegeneration.includes("不要求复述内部子类型"));

console.log(JSON.stringify({
  stage: "batch1.5-post-candidate4-local-gate",
  datasetSha256: sha256,
  independentGate: {
    sha256: createHash("sha256").update(gateSource).digest("hex"),
    total: gate.cases.length,
    accepted: gate.cases.filter((item) => item.expectedPass).length,
    rejected: gate.cases.filter((item) => !item.expectedPass).length,
    dimensions: Object.fromEntries(Array.from(new Set(gate.cases.map((item) => item.dimension))).map(
      (dimension) => [dimension, gate.cases.filter((item) => item.dimension === dimension).length]
    )),
  },
  candidate4Replay: {
    finalFailures: finalReplay.length,
    regenerationRuns: audit.regenerationAudits.length,
    attempts: regenerationReplay.length,
    accepted: regenerationReplay.filter((item) => item.validation.passed).length,
    rejected: regenerationReplay.filter((item) => !item.validation.passed).length,
  },
  candidate5FullFinalReplay: {
    total: candidate5FinalReplay.length,
    accepted: candidate5FinalReplay.filter((item) => item.validation.passed).length,
    rejected: candidate5FinalReplay.filter((item) => !item.validation.passed).length,
    correctedValidatorFalseNegatives: candidate5FinalReplay.filter((item) =>
      item.anomaly?.attribution === "surface_failure_validator_false_negative" && !item.validation.passed
    ).length,
    correctedValidatorFalsePositives: candidate5FinalReplay.filter((item) =>
      item.anomaly?.attribution === "validator_false_positive" && item.validation.passed
    ).length,
  },
  freshAdversarialCases: {
    total: freshAdversarialCases.length,
    accepted: freshAdversarialCases.filter((item) => item.expectedPass).length,
    rejected: freshAdversarialCases.filter((item) => !item.expectedPass).length,
  },
  promptProjection: true,
  regenerationProjection: true,
}, null, 2));
