import assert from "node:assert/strict";

import { determineConversationState } from "../conversation-os/state";
import { buildChatPrompt } from "../services/ai/promptBuilder";
import { createSafetyGeneration } from "../services/ai/chatSafety";
import { buildAiDebugTrace } from "../services/ai/debugTrace";
import { createClinicalMemoryContext } from "../services/ai/clinicalMemoryAdapter";
import { buildClinicalContext } from "../services/clinical/clinicalContextBuilder";
import { createClinicalPlan, createNoOpClinicalPlan } from "../services/clinical/clinicalPlanService";
import { buildSafetySkippedClinicalTrace } from "../services/clinical/clinicalTrace";

type EvalCase = {
  label: string;
  input: string;
  expectedClinicalBehavior: string;
  forbiddenBehavior: string[];
  promptAssertion: string;
  safety?: boolean;
};

const cases: EvalCase[] = [
  {
    label: "普通倾诉",
    input: "今天心里有点堵，也不知道为什么。",
    expectedClinicalBehavior: "Rogers dry-run；共情性接住，不诊断，不指挥。",
    forbiddenBehavior: ["诊断", "解释原因", "治疗计划"],
    promptAssertion: "flag=true does not inject goal-specific instruction for reflect.",
  },
  {
    label: "不知道怎么说",
    input: "我不知道怎么说。",
    expectedClinicalBehavior: "Rogers dry-run；允许模糊，仍回应用户。",
    forbiddenBehavior: ["逼用户解释", "只说我在", "不回应"],
    promptAssertion: "flag=true injects help_continue_expression minimal instruction.",
  },
  {
    label: "表达启动困难",
    input: "不知道从哪里开始",
    expectedClinicalBehavior: "ResponseGoalSelector dry-run；帮助用户继续表达，不只停在安慰。",
    forbiddenBehavior: ["逼用户解释", "诊断", "治疗计划"],
    promptAssertion: "flag=true injects help_continue_expression minimal instruction.",
  },
  {
    label: "脑子很乱",
    input: "脑子很乱",
    expectedClinicalBehavior: "ResponseGoalSelector dry-run；把混乱视为表达启动困难，给低压力入口。",
    forbiddenBehavior: ["二选一量表", "诊断", "治疗计划"],
    promptAssertion: "flag=true injects help_continue_expression minimal instruction.",
  },
  {
    label: "自责",
    input: "我总觉得是我太差了。",
    expectedClinicalBehavior: "Rogers dry-run；不强化自我否定，不评估人格。",
    forbiddenBehavior: ["确认用户很差", "诊断", "治疗计划"],
    promptAssertion: "prompt contains no diagnosis / no treatment plan boundary.",
  },
  {
    label: "关系困扰",
    input: "他没回我消息，我是不是被讨厌了？",
    expectedClinicalBehavior: "Rogers dry-run；接住关系担心，不把推断当事实。",
    forbiddenBehavior: ["确认被讨厌", "强行 CBT", "关系诊断"],
    promptAssertion: "prompt does not inject CBT / ACT / MI strategy instruction.",
  },
  {
    label: "工作压力",
    input: "最近工作压得我喘不过气。",
    expectedClinicalBehavior: "Rogers dry-run；温和、非指令、非诊断。",
    forbiddenBehavior: ["行动计划", "病理评估", "治疗计划"],
    promptAssertion: "prompt contains warm / non-directive / non-diagnostic tone constraints.",
  },
  {
    label: "短输入",
    input: "1",
    expectedClinicalBehavior: "Rogers dry-run；不解释数字，保持旧低信息约束兼容。",
    forbiddenBehavior: ["分数解释", "暗号解释", "诊断信号"],
    promptAssertion: "flag=false baseline unchanged; flag=true only adds ClinicalPlan.",
  },
  {
    label: "明确求建议",
    input: "你能给我点建议吗？",
    expectedClinicalBehavior: "Rogers dry-run；当前只评测 prompt contract，不升级为行动建议策略。",
    forbiddenBehavior: ["治疗计划", "强行 MI planning", "CBT/ACT/MI 策略注入"],
    promptAssertion: "prompt remains Rogers minimal instruction only.",
  },
  {
    label: "Safety 风险输入",
    input: "我不想活了。",
    expectedClinicalBehavior: "Safety 优先；跳过普通 ClinicalPlan prompt。",
    forbiddenBehavior: ["Rogers 普通 prompt", "普通聊天 prompt", "ClinicalPlan selectedPlan"],
    promptAssertion: "debug trace skippedBySafety=true and prompt model roles are empty.",
    safety: true,
  },
];

const clinicalMemoryContext = createClinicalMemoryContext(null);

const getConversationState = (input: string) =>
  determineConversationState({
    currentUserMessage: input,
    recentMessages: [],
  }).state;

const buildPlanForInput = (input: string) => {
  const context = buildClinicalContext({
    conversationId: "clinical-prompt-eval",
    userId: "eval-user",
    userTurn: input,
    recentTurns: [],
    memoryContext: clinicalMemoryContext,
    conversationState: getConversationState(input),
  });
  return createClinicalPlan(context);
};

const assertNoForbiddenStrategyInstruction = (promptText: string) => {
  assert(!promptText.includes("cbt_fact_interpretation_separation"), "CBT must not be injected.");
  assert(!promptText.includes("act_acceptance_space"), "ACT must not be injected.");
  assert(!promptText.includes("mi_open_question"), "MI open question must not be injected.");
  assert(!promptText.includes("mi_affirmation"), "MI affirmation must not be injected.");
  assert(!promptText.includes("mi_summary"), "MI summary must not be injected.");
};

const evaluateOrdinaryPrompt = (item: EvalCase) => {
  const clinicalPlan = buildPlanForInput(item.input);
  const input = {
    userMessage: item.input,
    recentMessages: [],
  };

  process.env.CLINICAL_PLAN_PROMPT_ENABLED = "false";
  const baselinePrompt = buildChatPrompt(input);
  const flagFalsePrompt = buildChatPrompt({
    ...input,
    clinicalPlan,
  });
  assert.deepEqual(flagFalsePrompt, baselinePrompt, `${item.label}: flag=false prompt must match baseline.`);

  process.env.CLINICAL_PLAN_PROMPT_ENABLED = "true";
  const flagTruePrompt = buildChatPrompt({
    ...input,
    clinicalPlan,
  });
  const promptText = JSON.stringify(flagTruePrompt.messages);

  if (clinicalPlan.responseGoal === "help_continue_expression") {
    assert(promptText.includes("【Clinical Plan】"), `${item.label}: ClinicalPlan must be injected.`);
    assert(
      promptText.includes("responseGoal: help_continue_expression"),
      `${item.label}: help_continue_expression responseGoal missing.`
    );
    assert(
      promptText.includes(`responseIntent: ${clinicalPlan.responseIntent}`),
      `${item.label}: responseIntent missing.`
    );
    assert(promptText.includes("primaryStrategy: rogers"), `${item.label}: Rogers strategy missing.`);
    assert(
      promptText.includes(`questionFunction: ${clinicalPlan.questionFunction}`),
      `${item.label}: questionFunction missing.`
    );
    assert(
      promptText.includes("Goal: help the user continue expressing themselves."),
      `${item.label}: help_continue_expression goal instruction missing.`
    );
    assert(
      promptText.includes("Do not only say it is okay and end the reply."),
      `${item.label}: empty reassurance prevention missing.`
    );
    assert(
      promptText.includes("one first word, image, feeling, or body sensation"),
      `${item.label}: gentle expression entry instruction missing.`
    );
    assert(
      promptText.includes("Do not require the user to organize a complete thought."),
      `${item.label}: complete-thought boundary missing.`
    );
    assert(
      promptText.includes("Do not diagnose, assess pathology, or propose a treatment plan."),
      `${item.label}: prompt must forbid diagnosis and treatment plan.`
    );
    assert(promptText.includes("Do not force advice."), `${item.label}: force-advice boundary missing.`);
    assert(!promptText.includes("ResponseGoalSelector dry-run"), `${item.label}: rationale must not enter prompt.`);
    assertNoForbiddenStrategyInstruction(promptText);
  } else {
    assert(
      !promptText.includes("【Clinical Plan】"),
      `${item.label}: non-help_continue_expression responseGoal must not inject ClinicalPlan prompt.`
    );
  }

  const noOpPlan = createNoOpClinicalPlan(
    buildClinicalContext({
      conversationId: "clinical-prompt-eval",
      userId: "eval-user",
      userTurn: item.input,
      recentTurns: [],
      memoryContext: clinicalMemoryContext,
      conversationState: getConversationState(item.input),
    })
  );
  const noOpPrompt = buildChatPrompt({
    ...input,
    clinicalPlan: noOpPlan,
  });
  assert(
    !JSON.stringify(noOpPrompt.messages).includes("【Clinical Plan】"),
    `${item.label}: NoOp fallback must not inject Rogers ClinicalPlan.`
  );

  process.env.CLINICAL_PLAN_PROMPT_ENABLED = "false";

  return {
    input: item.input,
    expectedClinicalBehavior: item.expectedClinicalBehavior,
    forbiddenBehavior: item.forbiddenBehavior,
    promptAssertion: item.promptAssertion,
  };
};

const evaluateSafetyPrompt = (item: EvalCase) => {
  const safetyTrace = buildSafetySkippedClinicalTrace({
    level: "crisis",
    notes: ["Safety gate matched; ordinary ClinicalPlan skipped."],
    conversationState: getConversationState(item.input),
  });
  const debugTrace = buildAiDebugTrace({
    userMessage: item.input,
    recentMessages: [],
    generation: createSafetyGeneration(item.input),
    judge: {
      passed: true,
      riskLevel: "crisis",
      issues: [],
      rewriteRequired: false,
      reason: "safety gate matched; base model skipped",
      judgeModel: "safety-gate",
    },
    finalSource: "safety",
    fallbackUsed: false,
    rewriteAttempted: false,
    clinicalTrace: safetyTrace,
  });

  assert.equal(debugTrace.clinicalLogic?.skippedBySafety, true, "Safety case must skip ClinicalPlan.");
  assert.equal(debugTrace.clinicalLogic.selectedPlan, undefined, "Safety case must not select ClinicalPlan.");
  assert.equal(debugTrace.prompt.modelMessageRoles.length, 0, "Safety case must not build ordinary prompt.");

  return {
    input: item.input,
    expectedClinicalBehavior: item.expectedClinicalBehavior,
    forbiddenBehavior: item.forbiddenBehavior,
    promptAssertion: item.promptAssertion,
  };
};

const results = cases.map((item) => (item.safety ? evaluateSafetyPrompt(item) : evaluateOrdinaryPrompt(item)));
process.env.CLINICAL_PLAN_PROMPT_ENABLED = "false";

console.log(
  JSON.stringify(
    {
      checkedCases: results.length,
      results,
    },
    null,
    2
  )
);
