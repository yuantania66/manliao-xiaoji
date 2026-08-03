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

const { dataset, sha256 } = loadPreservationDataset();

const buildPlan = (scenario: PreservationScenario): ResponsePlan => {
  const conversationState = determineConversationState({
    currentUserMessage: scenario.userMessage,
    recentMessages: scenario.recentMessages,
  });
  const context = assembleConversationControlContext({
    conversationId: `stage2-${scenario.id}`,
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
            evidence: ["Stage 2 fixture contains current-turn affect."],
          }]
        : [{
            relation: "repairs_previous_move",
            confidence: 0.95,
            targetTurnId: scenario.recentMessages.at(-1)?.id,
            evidence: ["Stage 2 fixture rejects the adjacent assistant move."],
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
  assert(
    plan.responseActions.includes(scenario.expectedAction),
    `${scenario.id} action mismatch: ${plan.responseActions.join(",")}`
  );
  const preflight = preflightResponsePlan(plan);
  assert.equal(preflight.passed, true, `${scenario.id} preflight: ${preflight.failureReasons.join(",")}`);
  return plan;
};

const plans = new Map(dataset.scenarios.map((scenario) => [scenario.id, buildPlan(scenario)]));
const customEmotionScenario = (
  id: string,
  userMessage: string
): PreservationScenario => ({
  id,
  kind: "emotional_support",
  userMessage,
  recentMessages: [],
  expectedAction: "offer_emotional_support",
});
const amountPlan = buildPlan(customEmotionScenario(
  "stage2-amount-control",
  "我有点难受，但不知道怎么说"
));
const relationalPlan = buildPlan(customEmotionScenario(
  "stage2-relational-impact",
  "你一点都没懂我，我现在有点难受"
));
assert.equal(
  amountPlan.positiveFunctionContract?.action === "offer_emotional_support"
    ? amountPlan.positiveFunctionContract.supportFunction
    : null,
  "return_amount_control"
);
assert.equal(
  relationalPlan.positiveFunctionContract?.action === "offer_emotional_support"
    ? relationalPlan.positiveFunctionContract.supportFunction
    : null,
  "acknowledge_current_relational_impact"
);

type IndependentCase = {
  id: string;
  plan: ResponsePlan;
  reply: string;
  shouldPass: boolean;
  expectedFailure?: string;
};
const plan = (id: string) => {
  const result = plans.get(id);
  assert(result, `Missing Stage 2 plan ${id}.`);
  return result;
};
const planForFrozenSurfaceReplay = (id: string): ResponsePlan => {
  const result = plan(id);
  return result.positiveFunctionContract?.action === "offer_emotional_support" &&
    result.positiveFunctionContract.supportFunction === "return_amount_control"
    ? {
        ...result,
        positiveFunctionContract: {
          ...result.positiveFunctionContract,
          supportFunction: "return_focus_control",
        },
      }
    : result;
};
const focusPlan = plan("emotion-mixed-anger");
const beingIgnoredPlan = plan("emotion-being-ignored");
const reducePlan = plan("emotion-no-analysis");

const emotionalCases: IndependentCase[] = [
  { id: "S2-EF-01", plan: focusPlan, reply: "委屈和生气都在，你愿意先聊哪一个都行。", shouldPass: true },
  { id: "S2-EF-02", plan: focusPlan, reply: "这份委屈和生气，你可以从最想说的部分开始。", shouldPass: true },
  { id: "S2-EF-03", plan: focusPlan, reply: "委屈和生气，先讲哪一块由你决定。", shouldPass: true },
  { id: "S2-EF-04", plan: focusPlan, reply: "这点委屈和生气，你想先提哪一点都可以。", shouldPass: true },
  { id: "S2-EF-05", plan: focusPlan, reply: "委屈和生气都收到了，你来定先说哪部分。", shouldPass: true },
  { id: "S2-EF-06", plan: focusPlan, reply: "这份委屈和生气，从哪儿开始聊看你。", shouldPass: true },
  { id: "S2-EF-07", plan: focusPlan, reply: "委屈和生气都听到了，我在这里。", shouldPass: false, expectedFailure: "emotional_support:missing_selected_function:return_focus_control" },
  { id: "S2-EF-08", plan: focusPlan, reply: "委屈和生气都很正常，你想先聊哪一个都行。", shouldPass: false, expectedFailure: "emotional_support:generic_normalization_or_reassurance" },
  { id: "S2-EF-09", plan: focusPlan, reply: "委屈和生气，你想先说哪部分或换到别的话题都行。", shouldPass: false, expectedFailure: "emotional_support:out_of_scope_topic_switch" },
  { id: "S2-EF-10", plan: focusPlan, reply: "这份痛苦，你可以先说最想说的部分。", shouldPass: false, expectedFailure: "emotional_support:unsupported_affect_category:distress:痛苦" },
  { id: "S2-EF-11", plan: focusPlan, reply: "委屈和生气，你想先说最让你生气的部分也可以。", shouldPass: false, expectedFailure: "emotional_support:unsupported_intensification:superlative_focus" },
  { id: "S2-EF-12", plan: focusPlan, reply: "委屈和生气，你可以先聊刚才发生的哪一点。", shouldPass: false, expectedFailure: "emotional_support:unsupported_event_or_time" },
  { id: "S2-EF-13", plan: beingIgnoredPlan, reply: "被忽略确实挺难受的。你想先说说这份感受，还是别的都可以，按你的节奏来就好。", shouldPass: false, expectedFailure: "emotional_support:out_of_scope_unknown_content" },
  { id: "S2-EF-14", plan: beingIgnoredPlan, reply: "被忽略和这份难受都在，你想先说哪部分都可以。", shouldPass: true },
  { id: "S2-EF-15", plan: beingIgnoredPlan, reply: "被忽略确实挺难受的。你想先说说刚才那种感觉，还是别的部分，都按你的节奏来。", shouldPass: false, expectedFailure: "emotional_support:out_of_scope_unknown_content" },
  { id: "S2-EF-16", plan: beingIgnoredPlan, reply: "关于当前这份难受，这种感受的其他部分想先说哪一点都可以。", shouldPass: true },

  { id: "S2-ER-01", plan: reducePlan, reply: "这点难受，不用现在解释原因。", shouldPass: true },
  { id: "S2-ER-02", plan: reducePlan, reply: "这点难受，可以不急着理清缘由。", shouldPass: true },
  { id: "S2-ER-03", plan: reducePlan, reply: "这点难受，无需整理成完整的话。", shouldPass: true },
  { id: "S2-ER-04", plan: reducePlan, reply: "难受在这儿，不必非得理出个所以然。", shouldPass: true },
  { id: "S2-ER-05", plan: reducePlan, reply: "关于这点难受，不需要马上下定义。", shouldPass: true },
  { id: "S2-ER-06", plan: reducePlan, reply: "这点难受不用解释原因，先安静待一会儿。", shouldPass: false, expectedFailure: "emotional_support:unrequested_pause_or_closure" },
  { id: "S2-ER-07", plan: reducePlan, reply: "这点难受不用分析，先做几次深呼吸。", shouldPass: false, expectedFailure: "emotional_support:unsolicited_regulation_advice" },
  { id: "S2-ER-08", plan: reducePlan, reply: "这点难受很正常，不必现在找原因。", shouldPass: false, expectedFailure: "emotional_support:generic_normalization_or_reassurance" },
  { id: "S2-ER-09", plan: reducePlan, reply: "难受就慢慢来，我会陪着你。", shouldPass: false, expectedFailure: "emotional_support:missing_selected_function:reduce_expression_burden" },
  { id: "S2-ER-10", plan: reducePlan, reply: "这点难受不用分析；到底是什么原因？", shouldPass: false, expectedFailure: "emotional_support:default_cause_or_detail_question" },
  { id: "S2-ER-11", plan: reducePlan, reply: "难受就待一会儿，不用非得分析或说清楚。想聊点什么随时都行。", shouldPass: false, expectedFailure: "emotional_support:unrequested_pause_or_closure" },
  { id: "S2-ER-12", plan: reducePlan, reply: "这点难受不用分析，等想说时再继续聊。", shouldPass: false, expectedFailure: "emotional_support:unrequested_pause_or_closure" },
  { id: "S2-ER-13", plan: reducePlan, reply: "这点难受不用分析，也不必解释原因。", shouldPass: true },
  { id: "S2-ER-14", plan: reducePlan, reply: "这点难受不用等到分析清楚再说，也不必解释原因。", shouldPass: true },
  { id: "S2-ER-15", plan: reducePlan, reply: "这点难受不用等到分析清楚再说；先待一会儿也可以。", shouldPass: false, expectedFailure: "emotional_support:unrequested_pause_or_closure" },

  { id: "S2-EA-01", plan: amountPlan, reply: "这点难受，想说多少就说多少。", shouldPass: true },
  { id: "S2-EA-02", plan: amountPlan, reply: "难受可以只说一点。", shouldPass: true },
  { id: "S2-EA-03", plan: amountPlan, reply: "这份难受不用一次说完。", shouldPass: true },
  { id: "S2-EA-04", plan: amountPlan, reply: "难受说到哪儿就到哪儿。", shouldPass: true },
  { id: "S2-EA-05", plan: amountPlan, reply: "这点难受，讲多少由你来定。", shouldPass: true },
  { id: "S2-EA-06", plan: amountPlan, reply: "这点难受，想说的时候再说。", shouldPass: false, expectedFailure: "emotional_support:missing_selected_function:return_amount_control" },
  { id: "S2-EA-07", plan: amountPlan, reply: "难受不用一次说完，我一直在这里。", shouldPass: false, expectedFailure: "emotional_support:formulaic_presence_or_contact" },
  { id: "S2-EA-08", plan: amountPlan, reply: "这份难受不用一次说完，也可以换到别的话题。", shouldPass: false, expectedFailure: "emotional_support:out_of_scope_topic_switch" },
  { id: "S2-EA-09", plan: amountPlan, reply: "这份痛苦不用一次说完。", shouldPass: false, expectedFailure: "emotional_support:unsupported_intensification:痛苦" },
  { id: "S2-EA-10", plan: amountPlan, reply: "这点难受不用一次说完；具体发生了什么？", shouldPass: false, expectedFailure: "emotional_support:default_cause_or_detail_question" },
  { id: "S2-EA-11", plan: amountPlan, reply: "这点难受，想说多少就说多少，还是别的都可以。", shouldPass: false, expectedFailure: "emotional_support:out_of_scope_unknown_content" },
  { id: "S2-EA-12", plan: amountPlan, reply: "这点难受，想说多少就说多少，不聊别的也可以。", shouldPass: true },
  { id: "S2-EA-13", plan: amountPlan, reply: "这点难受就说一点，不想多说也没关系。", shouldPass: true },
  { id: "S2-EA-14", plan: amountPlan, reply: "这点难受，少说几句也可以。", shouldPass: true },
  { id: "S2-EA-15", plan: amountPlan, reply: "这点难受，不愿多讲也行。", shouldPass: true },
  { id: "S2-EA-16", plan: amountPlan, reply: "这点难受，可以讲一小段就好。", shouldPass: true },
  { id: "S2-EA-17", plan: amountPlan, reply: "这点难受就说出来。", shouldPass: false, expectedFailure: "emotional_support:missing_selected_function:return_amount_control" },
  { id: "S2-EA-18", plan: amountPlan, reply: "这点难受慢慢说。", shouldPass: false, expectedFailure: "emotional_support:missing_selected_function:return_amount_control" },
  { id: "S2-EA-19", plan: plan("emotion-future-worry"), reply: "有点担心也没关系，你想说多少就说多少，不用非得讲完整件事。", shouldPass: false, expectedFailure: "emotional_support:generic_normalization_or_reassurance" },
  { id: "S2-EA-20", plan: plan("emotion-embarrassed"), reply: "觉得丢脸就说一点，不想多说也没关系。", shouldPass: true },
  { id: "S2-EA-21", plan: amountPlan, reply: "这点难受就说一点，我不想听建议。", shouldPass: false, expectedFailure: "emotional_support:missing_selected_function:return_amount_control" },
  { id: "S2-EA-22", plan: amountPlan, reply: "这点难受，说一点也行。", shouldPass: true },
  { id: "S2-EA-23", plan: amountPlan, reply: "这点难受，你能说一点吗？", shouldPass: false, expectedFailure: "emotional_support:missing_selected_function:return_amount_control" },
  { id: "S2-EA-24", plan: amountPlan, reply: "这点难受，你可以只说一点。", shouldPass: true },
  { id: "S2-EA-25", plan: amountPlan, reply: "这点难受是可以的，想说多少都行。", shouldPass: false, expectedFailure: "emotional_support:generic_normalization_or_reassurance" },
  { id: "S2-EA-26", plan: amountPlan, reply: "这点难受，可以只说一点。", shouldPass: true },

  { id: "S2-EL-01", plan: relationalPlan, reply: "这次是我没懂你；没有足够信息前，我不继续猜。", shouldPass: true },
  { id: "S2-EL-02", plan: relationalPlan, reply: "刚才我没接住你，我不能把这说成已经理解。", shouldPass: true },
  { id: "S2-EL-03", plan: relationalPlan, reply: "我前面说偏了，也不说自己已经理解你。", shouldPass: true },
  { id: "S2-EL-04", plan: relationalPlan, reply: "你觉得我没理解你，这个影响在这里；我还没有具体信息往下猜。", shouldPass: true },
  { id: "S2-EL-05", plan: relationalPlan, reply: "我没懂你，但我还在努力理解。", shouldPass: false, expectedFailure: "emotional_support:assistant_centered_understanding" },
  { id: "S2-EL-06", plan: relationalPlan, reply: "抱歉让你觉得我没懂，你可以再解释。", shouldPass: false, expectedFailure: "emotional_support:non_owning_apology" },
  { id: "S2-EL-07", plan: relationalPlan, reply: "我没接住你；请指出我哪里理解错了。", shouldPass: false, expectedFailure: "emotional_support:user_must_diagnose_assistant_failure" },
  { id: "S2-EL-08", plan: relationalPlan, reply: "我没理解你，但我会一直陪着你。", shouldPass: false, expectedFailure: "emotional_support:formulaic_presence_or_contact" },
];

const repairCases: IndependentCase[] = [
  { id: "S2-RAD-01", plan: plan("repair-advice-boundary"), reply: "是我刚才不该给建议，那些主意我收回。", shouldPass: true },
  { id: "S2-RAD-02", plan: plan("repair-advice-boundary"), reply: "抱歉，刚才不该教你怎么做。", shouldPass: true },
  { id: "S2-RAD-03", plan: plan("repair-advice-boundary"), reply: "抱歉，我不该追问细节。", shouldPass: false, expectedFailure: "repair:missing_interaction_move_withdrawal:unsolicited_advice" },
  { id: "S2-RAD-04", plan: plan("repair-advice-boundary"), reply: "我会认真听，不再建议。", shouldPass: false, expectedFailure: "repair:missing_ownership" },

  { id: "S2-RPQ-01", plan: plan("repair-question-pressure"), reply: "是我刚才连续问了太多，不该逼着你回答。", shouldPass: true },
  { id: "S2-RPQ-02", plan: plan("repair-question-pressure"), reply: "抱歉，我刚才追问过头了，不再追问。", shouldPass: true },
  { id: "S2-RPQ-03", plan: plan("repair-question-pressure"), reply: "抱歉，我不该替你出主意。", shouldPass: false, expectedFailure: "repair:missing_interaction_move_withdrawal:pressure_question" },
  { id: "S2-RPQ-04", plan: plan("repair-question-pressure"), reply: "我会认真听，不问了。", shouldPass: false, expectedFailure: "repair:missing_ownership" },
  { id: "S2-RPQ-05", plan: plan("repair-question-pressure"), reply: "刚才问时间地点和在场的人确实不对，没回应你说的难受。", shouldPass: true },
  { id: "S2-RPQ-06", plan: plan("repair-question-pressure"), reply: "前面问什么时候、在哪儿、谁在场确实问偏了。", shouldPass: true },
  { id: "S2-RPQ-07", plan: plan("repair-question-pressure"), reply: "刚才问的是时间、地点和在场的人。", shouldPass: false, expectedFailure: "repair:missing_ownership" },
  { id: "S2-RPQ-08", plan: plan("repair-question-pressure"), reply: "我刚才问了时间、地点和在场的人。", shouldPass: false, expectedFailure: "repair:missing_interaction_move_withdrawal:pressure_question" },
  { id: "S2-RPQ-09", plan: plan("repair-question-pressure"), reply: "是我刚才给了建议，确实不对。", shouldPass: false, expectedFailure: "repair:missing_interaction_move_withdrawal:pressure_question" },
  { id: "S2-RPQ-10", plan: plan("repair-question-pressure"), reply: "是我刚才不该追问那些细节。你能再具体说说吗？", shouldPass: false, expectedFailure: "repair:continues_rejected_interaction_move:pressure_question" },
  { id: "S2-RPQ-11", plan: plan("repair-question-pressure"), reply: "是你没表达清楚时间地点，我才继续问的。", shouldPass: false, expectedFailure: "repair:shifts_blame_to_user" },
  { id: "S2-RPQ-12", plan: plan("repair-question-pressure"), reply: "抱歉让你觉得我在追问。", shouldPass: false, expectedFailure: "repair:non_owning_apology" },
  { id: "S2-RPQ-13", plan: plan("repair-question-pressure"), reply: "刚才问了时间地点，天气确实不对。", shouldPass: false, expectedFailure: "repair:missing_interaction_move_withdrawal:pressure_question" },

  { id: "S2-RGL-01", plan: plan("repair-generic-listening"), reply: "我不该只说会听，这种套话我收回。", shouldPass: true },
  { id: "S2-RGL-02", plan: plan("repair-generic-listening"), reply: "抱歉，我刚才只重复那句话，不该这么回应。", shouldPass: true },
  { id: "S2-RGL-03", plan: plan("repair-generic-listening"), reply: "抱歉，我不该继续追问。", shouldPass: false, expectedFailure: "repair:missing_interaction_move_withdrawal:generic_listening" },
  { id: "S2-RGL-04", plan: plan("repair-generic-listening"), reply: "我会认真听你说。", shouldPass: false, expectedFailure: "repair:missing_ownership" },

  { id: "S2-RMO-01", plan: plan("repair-moralizing"), reply: "是我刚才在说教，不该评判你的选择。", shouldPass: true },
  { id: "S2-RMO-02", plan: plan("repair-moralizing"), reply: "抱歉，我前面讲对错讲偏了，不再这样评判。", shouldPass: true },
  { id: "S2-RMO-03", plan: plan("repair-moralizing"), reply: "抱歉，我不该那样说。", shouldPass: false, expectedFailure: "repair:missing_interaction_move_withdrawal:moralizing" },
  { id: "S2-RMO-04", plan: plan("repair-moralizing"), reply: "好，我不再说那些了。", shouldPass: false, expectedFailure: "repair:missing_ownership" },

  { id: "S2-RTS-01", plan: plan("repair-topic-switch"), reply: "是我把话题带偏了，不该扯到放松上。", shouldPass: true },
  { id: "S2-RTS-02", plan: plan("repair-topic-switch"), reply: "抱歉，我刚才岔开了话题，不再转开。", shouldPass: true },
  { id: "S2-RTS-03", plan: plan("repair-topic-switch"), reply: "抱歉，我不该继续追问。", shouldPass: false, expectedFailure: "repair:missing_interaction_move_withdrawal:topic_switch" },
  { id: "S2-RTS-04", plan: plan("repair-topic-switch"), reply: "我不再那样说了。", shouldPass: false, expectedFailure: "repair:missing_interaction_move_withdrawal:topic_switch" },

  { id: "S2-RFA-01", plan: plan("repair-wrong-person"), reply: "抱歉记错了，是你姐姐。", shouldPass: true },
  { id: "S2-RFA-02", plan: plan("repair-wrong-person"), reply: "抱歉弄错了，是你姐姐。", shouldPass: true },
  { id: "S2-RFA-03", plan: plan("repair-wrong-person"), reply: "不是同事，是你姐姐。", shouldPass: false, expectedFailure: "repair:missing_ownership" },
  { id: "S2-RFA-04", plan: plan("repair-wrong-person"), reply: "抱歉，我记错了，是你同事。", shouldPass: false, expectedFailure: "repair:missing_factual_replacement" },

  { id: "S2-RPR-01", plan: plan("repair-unsupported-fear"), reply: "是我刚才替你下了害怕被否定的判断，那个判断我收回。", shouldPass: true },
  { id: "S2-RPR-02", plan: plan("repair-unsupported-fear"), reply: "抱歉，我前面的判断不该放在你身上。", shouldPass: true },
  { id: "S2-RPR-03", plan: plan("repair-unsupported-fear"), reply: "抱歉，我理解偏了。", shouldPass: false, expectedFailure: "repair:missing_proposition_withdrawal" },
  { id: "S2-RPR-04", plan: plan("repair-unsupported-fear"), reply: "我收回，但你可能还是有点害怕。", shouldPass: false, expectedFailure: "repair:continues_withdrawn_proposition" },
];

const independentCases = [...emotionalCases, ...repairCases];
assert(independentCases.length >= 40, "Stage 2 must contain at least 40 new counterexamples.");
for (const testCase of independentCases) {
  const validation = validateResponsePlanOutput({ plan: testCase.plan, reply: testCase.reply });
  assert.equal(
    validation.passed,
    testCase.shouldPass,
    `${testCase.id} mismatch: ${validation.failureReasons.join(",")}`
  );
  if (testCase.expectedFailure) {
    assert(
      validation.failureReasons.includes(testCase.expectedFailure),
      `${testCase.id} missing expected reason ${testCase.expectedFailure}: ${validation.failureReasons.join(",")}`
    );
  }
}

const amountPrompt = formatResponsePlanForPrompt(amountPlan);
assert(amountPrompt.includes("Amount control governs expression quantity only"));
assert(amountPrompt.includes("Permission language must modify the user's expression choice"));
assert(amountPrompt.includes("Keep the feeling acknowledgement descriptive"));
const burdenPrompt = formatResponsePlanForPrompt(reducePlan);
assert(burdenPrompt.includes("Releasing an expression burden is not a pause or closure"));
const pauseRegeneration = formatResponsePlanRegenerateConstraint(
  reducePlan,
  ["emotional_support:unrequested_pause_or_closure"]
);
assert(pauseRegeneration.includes("减轻分析或表达负担不等于暂停"));
const unknownAlternativeRegeneration = formatResponsePlanRegenerateConstraint(
  beingIgnoredPlan,
  ["emotional_support:out_of_scope_unknown_content"]
);
assert(unknownAlternativeRegeneration.includes("无明确指代的未知选项"));

type Candidate3Audit = {
  sourceArtifactSha256: string;
  datasetSha256: string;
  finalFailures: Array<{
    auditId: string;
    scenarioId: string;
    runIndex: number;
    attribution: string;
  }>;
  regenerationAudits: Array<{
    auditId: string;
    scenarioId: string;
    runIndex: number;
    firstAttribution: string;
    secondAttribution: string;
  }>;
};
type Candidate3Artifact = {
  datasetSha256: string;
  rows: Array<{
    scenarioId: string;
    runIndex: number;
    attempts: Array<{ attempt: number; text: string }>;
  }>;
};
const audit = JSON.parse(readFileSync(
  "docs/evals/hill-helping-batch1-5-candidate3-layered-attribution-20260802.json",
  "utf8"
)) as Candidate3Audit;
const artifactSource = readFileSync(
  "docs/evals/hill-helping-batch1-5-preservation-candidate3-20260802.json"
);
const artifact = JSON.parse(artifactSource.toString("utf8")) as Candidate3Artifact;
assert.equal(audit.datasetSha256, sha256);
assert.equal(artifact.datasetSha256, sha256);
assert.equal(createHash("sha256").update(artifactSource).digest("hex"), audit.sourceArtifactSha256);
assert.equal(audit.finalFailures.length, 10);
assert.equal(audit.regenerationAudits.length, 13);

const shouldPassAttribution = (attribution: string) =>
  attribution === "validator_false_positive" || attribution === "appropriate_pass";
const candidate3FinalReplay = audit.finalFailures.map((entry) => {
  const replayPlan = planForFrozenSurfaceReplay(entry.scenarioId);
  if (entry.attribution === "planner_contract_failure") {
    const preflight = preflightResponsePlan(replayPlan);
    assert.equal(
      preflight.passed,
      true,
      `${entry.auditId} frozen planner failure must now pass preflight: ${preflight.failureReasons.join(",")}`
    );
    return { auditId: entry.auditId, attribution: entry.attribution, corrected: true };
  }
  const row = artifact.rows.find((candidate) =>
    candidate.scenarioId === entry.scenarioId && candidate.runIndex === entry.runIndex
  );
  assert(row, `${entry.auditId} missing candidate 3 final row.`);
  const finalAttempt = row.attempts.at(-1);
  assert(finalAttempt, `${entry.auditId} missing candidate 3 final attempt.`);
  const validation = validateResponsePlanOutput({ plan: replayPlan, reply: finalAttempt.text });
  assert.equal(
    validation.passed,
    shouldPassAttribution(entry.attribution),
    `${entry.auditId} final ${entry.attribution}: ${validation.failureReasons.join(",")}`
  );
  if (entry.attribution === "both" || entry.attribution === "validator_false_positive") {
    assert(
      !validation.failureReasons.some((reason) => reason.includes("missing_selected_function")),
      `${entry.auditId} final replay must recognize the completed function.`
    );
  }
  return { auditId: entry.auditId, attribution: entry.attribution, corrected: true };
});
const candidate3Replay = audit.regenerationAudits.flatMap((entry) => {
  const row = artifact.rows.find((candidate) =>
    candidate.scenarioId === entry.scenarioId && candidate.runIndex === entry.runIndex
  );
  assert(row, `${entry.auditId} missing candidate 3 row.`);
  const replayPlan = planForFrozenSurfaceReplay(entry.scenarioId);
  return [entry.firstAttribution, entry.secondAttribution].map((attribution, index) => {
    const attempt = row.attempts[index];
    assert(attempt, `${entry.auditId} missing attempt ${index + 1}.`);
    const validation = validateResponsePlanOutput({ plan: replayPlan, reply: attempt.text });
    assert.equal(
      validation.passed,
      shouldPassAttribution(attribution),
      `${entry.auditId} attempt ${index + 1} ${attribution}: ${validation.failureReasons.join(",")}`
    );
    if (attribution === "both" || attribution === "validator_false_positive") {
      assert(
        !validation.failureReasons.some((reason) => reason.includes("missing_selected_function")),
        `${entry.auditId} attempt ${index + 1} must recognize the completed function.`
      );
    }
    if (attribution === "surface_failure_validator_false_negative") {
      assert(
        validation.failureReasons.includes("emotional_support:out_of_scope_topic_switch"),
        `${entry.auditId} attempt ${index + 1} must reject out-of-scope topic switching.`
      );
    }
    return { auditId: entry.auditId, attempt: index + 1, attribution, validation };
  });
});

console.log(JSON.stringify({
  stage: "batch1.5-stage2-compositional-validator-and-repair-subtypes",
  datasetSha256: sha256,
  frozenPlans: plans.size,
  repairSubtypes: [
    "unsolicited_advice",
    "pressure_question",
    "generic_listening",
    "moralizing",
    "topic_switch",
  ],
  independentCounterexamples: {
    total: independentCases.length,
    emotional: emotionalCases.length,
    repair: repairCases.length,
    accepted: independentCases.filter((item) => item.shouldPass).length,
    rejected: independentCases.filter((item) => !item.shouldPass).length,
  },
  candidate3FrozenRegenerationReplay: {
    audits: audit.regenerationAudits.length,
    attempts: candidate3Replay.length,
    accepted: candidate3Replay.filter((item) => item.validation.passed).length,
    rejected: candidate3Replay.filter((item) => !item.validation.passed).length,
  },
  candidate3FrozenFinalFailureReplay: {
    failures: candidate3FinalReplay.length,
    corrected: candidate3FinalReplay.filter((item) => item.corrected).length,
  },
}, null, 2));
