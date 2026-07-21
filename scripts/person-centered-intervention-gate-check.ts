import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { determineConversationState } from "../conversation-os/state";
import {
  createChatReply,
  isPersonCenteredGateV1Enabled,
} from "../services/ai/chatOrchestrationService";
import { createClinicalMemoryContext } from "../services/ai/clinicalMemoryAdapter";
import {
  buildChatPrompt,
  formatPersonCenteredGateBoundary,
} from "../services/ai/promptBuilder";
import type {
  AiConversationMessage,
  AiMemoryContext,
  AiVoiceConstraints,
} from "../services/ai/types";
import { buildClinicalContext } from "../services/clinical/clinicalContextBuilder";
import { createClinicalPlan } from "../services/clinical/clinicalPlanService";
import { buildClinicalTrace } from "../services/clinical/clinicalTrace";
import type {
  ClinicalContext,
  InterventionFamily,
  InterventionIntensity,
  PersonCenteredGateDecision,
  PersonCenteredGateEvidence,
  ResponseGoal,
} from "../services/clinical/clinicalTypes";
import {
  evaluatePersonCenteredInterventionGate,
  PERSON_CENTERED_INTERVENTION_FAMILIES,
} from "../services/clinical/personCenteredInterventionGate";
import { selectResponseGoal } from "../services/clinical/responseGoalSelector";
import { PROFESSIONAL_GUIDANCE_CARDS } from "../services/professional-rag/professionalCorpus";
import {
  projectPromptEligibleContext,
  type GatedStructuredRagContext,
} from "../services/professional-rag/professionalGuidanceGateProjection";
import { retrieveProfessionalGuidance } from "../services/professional-rag/professionalRetrieval";
import type {
  ProfessionalGuidanceCard,
  RetrievedProfessionalGuidance,
} from "../services/professional-rag/professionalTypes";
import type {
  StructuredRagContext,
  UnderstandingExtraction,
} from "../services/understanding/understandingTypes";

const read = (path: string) => readFileSync(path, "utf8");

const emptyExtraction = (): UnderstandingExtraction => ({
  facts: [],
  experiences: [],
  interpretations: [],
  people: [],
  topics: [],
});

const emptyRawContext = (
  professionalGuidance: RetrievedProfessionalGuidance[] = []
): StructuredRagContext => ({
  recentMemories: [],
  similarMemories: [],
  coreEvents: [],
  activeHypotheses: [],
  counterEvidence: [],
  professionalGuidance,
  userFeedback: [],
  retrievalReason: "person_centered_gate_check",
});

const toRetrievedGuidance = (
  card: ProfessionalGuidanceCard
): RetrievedProfessionalGuidance => ({
  id: card.id,
  sourceTitle: card.sourceTitle,
  sourceUrl: card.sourceUrl,
  sourceKind: card.sourceKind,
  principle: card.principle,
  applyWhen: card.applyWhen,
  avoid: [...card.avoid],
  responseMove: card.responseMove,
  reason: "gate_check_candidate",
  gate: { ...card.gate },
});

const rawContextForInput = (input: string): StructuredRagContext =>
  emptyRawContext(
    retrieveProfessionalGuidance({
      extraction: emptyExtraction(),
      currentMessage: input,
    })
  );

const buildContext = ({
  input,
  recentMessages = [],
  rawContext = null,
  includePersonCenteredEvidence = true,
  conversationId = "person-centered-gate-check",
}: {
  input: string;
  recentMessages?: AiConversationMessage[];
  rawContext?: StructuredRagContext | null;
  includePersonCenteredEvidence?: boolean;
  conversationId?: string;
}): ClinicalContext =>
  buildClinicalContext({
    conversationId,
    userId: "gate-check-user",
    userTurn: input,
    recentTurns: recentMessages,
    memoryContext: createClinicalMemoryContext(rawContext),
    conversationState: determineConversationState({
      currentUserMessage: input,
      recentMessages,
    }).state,
    ...(includePersonCenteredEvidence ? { includePersonCenteredEvidence: true } : {}),
  });

const evaluateInput = ({
  input,
  recentMessages = [],
  rawContext = rawContextForInput(input),
}: {
  input: string;
  recentMessages?: AiConversationMessage[];
  rawContext?: StructuredRagContext;
}) => {
  const context = buildContext({ input, recentMessages, rawContext });
  assert(context.personCenteredEvidence, `Gate evidence missing for input: ${input}`);
  const decision = evaluatePersonCenteredInterventionGate(context.personCenteredEvidence);
  const projection = projectPromptEligibleContext({ raw: rawContext, gateDecision: decision });
  const plan = createClinicalPlan(context, decision);
  const trace = buildClinicalTrace({
    context,
    plan,
    gateDecision: decision,
    professionalGuidanceProjection: projection.trace,
  });
  return { context, decision, projection, plan, trace };
};

const decisionFor = ({
  allowedFamilies = [],
  maxIntensity = "none",
  allowedGoals = ["reflect"],
  preferredGoal = null,
  fallbackGoal = "reflect",
}: {
  allowedFamilies?: InterventionFamily[];
  maxIntensity?: InterventionIntensity;
  allowedGoals?: ResponseGoal[];
  preferredGoal?: ResponseGoal | null;
  fallbackGoal?: ResponseGoal;
} = {}): PersonCenteredGateDecision => ({
  version: "person-centered-gate-v1",
  effectiveStage: "expression",
  interventionReadiness: allowedFamilies.length > 0 ? "ready" : "blocked",
  maxInterventionIntensity: maxIntensity,
  allowedInterventionFamilies: [...allowedFamilies],
  blockedInterventionFamilies: PERSON_CENTERED_INTERVENTION_FAMILIES.filter(
    (family) => !allowedFamilies.includes(family)
  ),
  responseGoalPolicy: {
    allowed: [...allowedGoals],
    preferred: preferredGoal,
    fallback: fallbackGoal,
  },
  eligibilityReason:
    allowedFamilies.length > 0
      ? ["aligned_and_scoped_consent"]
      : ["no_scoped_consent"],
});

const withEnvironment = async <T>(
  values: Record<string, string | undefined>,
  run: () => T | Promise<T>
): Promise<T> => {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const assertNoOwn = (value: object, key: PropertyKey, message: string) =>
  assert.equal(Object.prototype.hasOwnProperty.call(value, key), false, message);

const main = async () => {
// ---------------------------------------------------------------------------
// Feature flag: exact value, no old alias, and one read per request.
// ---------------------------------------------------------------------------

await withEnvironment(
  {
    PERSON_CENTERED_GATE_V1_ENABLED: undefined,
    PERSON_CENTERED_INTERVENTION_GATE_V1_ENABLED: "true",
  },
  () => {
    assert.equal(
      isPersonCenteredGateV1Enabled(),
      false,
      "The retired PERSON_CENTERED_INTERVENTION_GATE_V1_ENABLED alias must not enable V1."
    );
  }
);

for (const [value, expected] of [
  [undefined, false],
  ["false", false],
  ["TRUE", false],
  ["1", false],
  [" true ", false],
  ["true", true],
] as const) {
  await withEnvironment({ PERSON_CENTERED_GATE_V1_ENABLED: value }, () => {
    assert.equal(
      isPersonCenteredGateV1Enabled(),
      expected,
      `PERSON_CENTERED_GATE_V1_ENABLED=${String(value)} must resolve to ${expected}.`
    );
  });
}

const orchestrationSource = read("services/ai/chatOrchestrationService.ts");
assert.equal(
  orchestrationSource.match(/\bisPersonCenteredGateV1Enabled\(\)/g)?.length ?? 0,
  1,
  "createChatReply() must read the Person-Centered Gate flag exactly once per request."
);
assert(
  orchestrationSource.includes(
    'process.env.PERSON_CENTERED_GATE_V1_ENABLED === "true"'
  ),
  "The feature flag must use an exact string comparison."
);

const productFlagSources = [
  read("services/ai/chatOrchestrationService.ts"),
  read(".env.example"),
  ...readdirSync("services/clinical")
    .filter((file) => file.endsWith(".ts"))
    .map((file) => read(join("services/clinical", file))),
  ...readdirSync("services/professional-rag")
    .filter((file) => file.endsWith(".ts"))
    .map((file) => read(join("services/professional-rag", file))),
];
assert(
  productFlagSources.every(
    (source) => !source.includes("PERSON_CENTERED_INTERVENTION_GATE_V1_ENABLED")
  ),
  "Product code and .env.example must not retain the retired feature flag alias."
);
assert(
  read(".env.example").includes('PERSON_CENTERED_GATE_V1_ENABLED="false"'),
  "The new feature flag must default to false in .env.example."
);

// ---------------------------------------------------------------------------
// Flag-off compatibility: exact object/message shape, not undefined fields.
// ---------------------------------------------------------------------------

const compatibilityRaw = emptyRawContext();
const compatibilityRecentMessages: AiConversationMessage[] = [
  { role: "assistant", content: "你可以从最容易说的地方开始。" },
];
const legacyContext = buildContext({
  input: "我不知道怎么说",
  recentMessages: compatibilityRecentMessages,
  rawContext: compatibilityRaw,
  includePersonCenteredEvidence: false,
});
const explicitFalseContext = buildClinicalContext({
  conversationId: "person-centered-gate-check",
  userId: "gate-check-user",
  userTurn: "我不知道怎么说",
  recentTurns: compatibilityRecentMessages,
  memoryContext: createClinicalMemoryContext(compatibilityRaw),
  conversationState: determineConversationState({
    currentUserMessage: "我不知道怎么说",
    recentMessages: compatibilityRecentMessages,
  }).state,
  includePersonCenteredEvidence: false,
});
assert.deepEqual(
  explicitFalseContext,
  legacyContext,
  "includePersonCenteredEvidence=false must be deep-equal to the legacy ClinicalContext."
);
assertNoOwn(
  legacyContext,
  "personCenteredEvidence",
  "Flag-off ClinicalContext must omit personCenteredEvidence entirely."
);
assert.deepEqual(
  Object.keys(legacyContext),
  [
    "conversation",
    "memory",
    "session",
    "safety",
    "meta",
    "signals",
    "conversationId",
    "userId",
    "userTurn",
    "recentTurns",
    "currentUnderstanding",
    "memoryContext",
    "conversationSignals",
    "safetyNotes",
  ],
  "Flag-off ClinicalContext must preserve the frozen legacy top-level shape."
);

const legacyPlan = createClinicalPlan(legacyContext);
const explicitNullPlan = createClinicalPlan(legacyContext, null);
assert.deepEqual(
  explicitNullPlan,
  legacyPlan,
  "A null Gate decision must preserve the legacy ClinicalPlan exactly."
);
assertNoOwn(
  legacyPlan,
  "personCenteredGate",
  "Flag-off ClinicalPlan must omit personCenteredGate entirely."
);
assert.deepEqual(
  Object.keys(legacyPlan),
  [
    "responseGoal",
    "responseIntent",
    "primaryStrategy",
    "secondaryStrategies",
    "questionFunction",
    "toneConstraint",
    "interventionBoundary",
    "safetyNotes",
    "rationale",
  ],
  "Flag-off ClinicalPlan must preserve the frozen legacy top-level shape."
);

const legacyTrace = buildClinicalTrace({ context: legacyContext, plan: legacyPlan });
const explicitNullTrace = buildClinicalTrace({
  context: legacyContext,
  plan: legacyPlan,
  gateDecision: null,
  professionalGuidanceProjection: null,
});
assert.deepEqual(
  explicitNullTrace,
  legacyTrace,
  "A null Gate decision must preserve the legacy ClinicalTrace exactly."
);
assertNoOwn(
  legacyTrace,
  "personCenteredGate",
  "Flag-off trace must omit personCenteredGate entirely."
);
assert.deepEqual(
  Object.keys(legacyTrace),
  [
    "skippedBySafety",
    "conversationState",
    "safetyDecision",
    "inputSignals",
    "signals",
    "memoryUsed",
    "memoryExcluded",
    "selectedPlan",
  ],
  "Flag-off ClinicalTrace must preserve the frozen legacy top-level shape."
);

const { legacyPrompt, explicitNullPrompt } = await withEnvironment(
  { CLINICAL_PLAN_PROMPT_ENABLED: "false" },
  () => ({
    legacyPrompt: buildChatPrompt({
      userMessage: "我不知道怎么说",
      recentMessages: compatibilityRecentMessages,
      understandingContext: compatibilityRaw,
      clinicalPlan: legacyPlan,
    }),
    explicitNullPrompt: buildChatPrompt({
      userMessage: "我不知道怎么说",
      recentMessages: compatibilityRecentMessages,
      understandingContext: compatibilityRaw,
      personCenteredGateDecision: null,
      clinicalPlan: legacyPlan,
    }),
  })
);
assert.deepEqual(
  explicitNullPrompt,
  legacyPrompt,
  "A null Gate decision must preserve the legacy prompt messages and metadata."
);
assert(
  legacyPrompt.messages.every(
    (message) => !message.content.includes("【Person-Centered Intervention Boundary】")
  ),
  "Flag-off prompt must not contain a Gate carrier."
);
assert.deepEqual(
  legacyPrompt.messages.map((message) => message.role),
  ["developer", "developer", "assistant", "user"],
  "Flag-off prompt must preserve the frozen legacy message ordering."
);
assert.equal(
  createHash("sha256").update(JSON.stringify(legacyPrompt)).digest("hex"),
  "9a4138b6b862a1a72c0c0acf0ee493c68c7c8c4eaa9019cd9b28a811aa8d9851",
  "Flag-off prompt messages and metadata must match the frozen legacy contract."
);

// ---------------------------------------------------------------------------
// Frozen 12-case traces.
// ---------------------------------------------------------------------------

type FrozenCase = {
  caseId: string;
  input: string;
  recentMessages?: AiConversationMessage[];
  stage: PersonCenteredGateDecision["effectiveStage"];
  understandingStatus: NonNullable<
    ClinicalContext["personCenteredEvidence"]
  >["understandingEvidence"]["status"];
  understandingScope: NonNullable<
    ClinicalContext["personCenteredEvidence"]
  >["understandingEvidence"]["scope"];
  consentStatus: NonNullable<
    ClinicalContext["personCenteredEvidence"]
  >["interventionConsent"]["status"];
  readiness: PersonCenteredGateDecision["interventionReadiness"];
  maxIntensity: PersonCenteredGateDecision["maxInterventionIntensity"];
  allowedFamilies: InterventionFamily[];
  allowedGoals: ResponseGoal[];
  preferredGoal: ResponseGoal | null;
  fallbackGoal: ResponseGoal;
  selectedGoal: ResponseGoal;
  reasons: PersonCenteredGateDecision["eligibilityReason"];
  retrievedIds: string[];
  injectedIds: string[];
  withheldIds: string[];
};

const frozenCases: FrozenCase[] = [
  {
    caseId: "015",
    input: "不",
    recentMessages: [
      {
        role: "assistant",
        content: "如果你愿意，可以从头讲讲刚才和朋友吵架的事。",
      },
    ],
    stage: "repair_or_pause",
    understandingStatus: "aligned",
    understandingScope: "boundary",
    consentStatus: "revoked",
    readiness: "blocked",
    maxIntensity: "none",
    allowedFamilies: [],
    allowedGoals: ["hold_space"],
    preferredGoal: "hold_space",
    fallbackGoal: "hold_space",
    selectedGoal: "hold_space",
    reasons: ["boundary_or_pause_revoked"],
    retrievedIds: [],
    injectedIds: [],
    withheldIds: [],
  },
  {
    caseId: "022",
    input: "😡",
    recentMessages: [
      {
        role: "assistant",
        content: "不必把整件事讲完整，只说当时冒出的第一反应也可以。",
      },
    ],
    stage: "expression",
    understandingStatus: "provisional",
    understandingScope: "current_experience",
    consentStatus: "none",
    readiness: "blocked",
    maxIntensity: "none",
    allowedFamilies: [],
    allowedGoals: ["reflect", "clarify", "help_continue_expression", "hold_space", "summarize"],
    preferredGoal: null,
    fallbackGoal: "reflect",
    selectedGoal: "clarify",
    reasons: ["no_scoped_consent"],
    retrievedIds: [],
    injectedIds: [],
    withheldIds: [],
  },
  {
    caseId: "027",
    input: "昨晚梦见自己一直在赶一辆车，怎么都赶不上。",
    stage: "expression",
    understandingStatus: "provisional",
    understandingScope: "current_experience",
    consentStatus: "none",
    readiness: "blocked",
    maxIntensity: "none",
    allowedFamilies: [],
    allowedGoals: ["reflect", "clarify", "help_continue_expression", "hold_space", "summarize"],
    preferredGoal: null,
    fallbackGoal: "reflect",
    selectedGoal: "reflect",
    reasons: ["no_scoped_consent"],
    retrievedIds: [],
    injectedIds: [],
    withheldIds: [],
  },
  {
    caseId: "029",
    input: "连续几天都梦见在很高的地方往下掉，醒来心跳很快。",
    stage: "expression",
    understandingStatus: "provisional",
    understandingScope: "current_experience",
    consentStatus: "ambiguous",
    readiness: "blocked",
    maxIntensity: "none",
    allowedFamilies: [],
    allowedGoals: ["reflect", "clarify", "help_continue_expression", "hold_space", "summarize"],
    preferredGoal: null,
    fallbackGoal: "reflect",
    selectedGoal: "reflect",
    reasons: ["ambiguous_consent", "topic_or_cue_is_not_consent"],
    retrievedIds: [],
    injectedIds: [],
    withheldIds: [],
  },
  {
    caseId: "033",
    input: "梦里一直有人叫我的名字，但我找不到是谁。",
    stage: "expression",
    understandingStatus: "provisional",
    understandingScope: "current_experience",
    consentStatus: "none",
    readiness: "blocked",
    maxIntensity: "none",
    allowedFamilies: [],
    allowedGoals: ["reflect", "clarify", "help_continue_expression", "hold_space", "summarize"],
    preferredGoal: null,
    fallbackGoal: "reflect",
    selectedGoal: "reflect",
    reasons: ["no_scoped_consent"],
    retrievedIds: [],
    injectedIds: [],
    withheldIds: [],
  },
  {
    caseId: "034",
    input: "我最近总做同一个梦，门就在面前，可我怎么也打不开。",
    stage: "expression",
    understandingStatus: "provisional",
    understandingScope: "current_experience",
    consentStatus: "ambiguous",
    readiness: "blocked",
    maxIntensity: "none",
    allowedFamilies: [],
    allowedGoals: ["reflect", "clarify", "help_continue_expression", "hold_space", "summarize"],
    preferredGoal: null,
    fallbackGoal: "reflect",
    selectedGoal: "reflect",
    reasons: ["ambiguous_consent", "topic_or_cue_is_not_consent"],
    retrievedIds: [],
    injectedIds: [],
    withheldIds: [],
  },
  {
    caseId: "042",
    input: "最近总是提不起劲，连喜欢的东西也懒得碰。",
    stage: "expression",
    understandingStatus: "provisional",
    understandingScope: "current_experience",
    consentStatus: "ambiguous",
    readiness: "blocked",
    maxIntensity: "none",
    allowedFamilies: [],
    allowedGoals: ["reflect", "clarify", "help_continue_expression", "hold_space", "summarize"],
    preferredGoal: null,
    fallbackGoal: "reflect",
    selectedGoal: "reflect",
    reasons: ["ambiguous_consent", "topic_or_cue_is_not_consent"],
    retrievedIds: ["case-formulation-hypothesis-not-fact"],
    injectedIds: [],
    withheldIds: ["case-formulation-hypothesis-not-fact"],
  },
  {
    caseId: "053",
    input: "我做了三个月的方案被一句话否了，感觉之前的努力都白费了。",
    stage: "expression",
    understandingStatus: "provisional",
    understandingScope: "current_experience",
    consentStatus: "none",
    readiness: "blocked",
    maxIntensity: "none",
    allowedFamilies: [],
    allowedGoals: ["reflect", "clarify", "help_continue_expression", "hold_space", "summarize"],
    preferredGoal: null,
    fallbackGoal: "reflect",
    selectedGoal: "reflect",
    reasons: ["no_scoped_consent"],
    retrievedIds: [],
    injectedIds: [],
    withheldIds: [],
  },
  {
    caseId: "057",
    input: "伴侣说想一个人静静，我脑子里马上就开始想他是不是不爱我了。",
    stage: "exploration",
    understandingStatus: "provisional",
    understandingScope: "current_experience",
    consentStatus: "ambiguous",
    readiness: "blocked",
    maxIntensity: "none",
    allowedFamilies: [],
    allowedGoals: ["reflect", "clarify", "help_continue_expression", "hold_space", "summarize"],
    preferredGoal: null,
    fallbackGoal: "reflect",
    selectedGoal: "reflect",
    reasons: ["ambiguous_consent", "topic_or_cue_is_not_consent"],
    retrievedIds: ["cbt-fact-interpretation-separation"],
    injectedIds: [],
    withheldIds: ["cbt-fact-interpretation-separation"],
  },
  {
    caseId: "077",
    input: "我该不该主动跟朋友道歉？",
    stage: "intervention_requested",
    understandingStatus: "unverified",
    understandingScope: "relevant_facts",
    consentStatus: "explicit_scoped",
    readiness: "limited",
    maxIntensity: "none",
    allowedFamilies: [],
    allowedGoals: ["clarify"],
    preferredGoal: "clarify",
    fallbackGoal: "clarify",
    selectedGoal: "clarify",
    reasons: ["understanding_unverified", "facts_insufficient_for_judgment"],
    retrievedIds: [],
    injectedIds: [],
    withheldIds: [],
  },
  {
    caseId: "082",
    input: "和伴侣吵架后，我现在能做的第一步是什么？",
    stage: "intervention_requested",
    understandingStatus: "provisional",
    understandingScope: "request_scope",
    consentStatus: "explicit_scoped",
    readiness: "limited",
    maxIntensity: "low",
    allowedFamilies: ["low_risk_action_support"],
    allowedGoals: ["support_action", "clarify"],
    preferredGoal: "support_action",
    fallbackGoal: "clarify",
    selectedGoal: "support_action",
    reasons: ["explicit_low_risk_scoped_request"],
    retrievedIds: [],
    injectedIds: [],
    withheldIds: [],
  },
  {
    caseId: "083",
    input: "我总是拖到最后一刻，能帮我想一个今天就能开始的小办法吗？",
    stage: "intervention_requested",
    understandingStatus: "provisional",
    understandingScope: "request_scope",
    consentStatus: "explicit_scoped",
    readiness: "limited",
    maxIntensity: "low",
    allowedFamilies: ["low_risk_action_support"],
    allowedGoals: ["support_action", "clarify"],
    preferredGoal: "support_action",
    fallbackGoal: "clarify",
    selectedGoal: "support_action",
    reasons: ["explicit_low_risk_scoped_request"],
    retrievedIds: ["case-formulation-hypothesis-not-fact"],
    injectedIds: [],
    withheldIds: ["case-formulation-hypothesis-not-fact"],
  },
];

const actualFrozenTraceSummary = frozenCases.map((frozenCase) => {
  const actual = evaluateInput({
    input: frozenCase.input,
    recentMessages: frozenCase.recentMessages,
  });
  const evidence = actual.context.personCenteredEvidence!;

  assert.equal(actual.decision.version, "person-centered-gate-v1");
  assert.equal(actual.decision.effectiveStage, frozenCase.stage, `${frozenCase.caseId}: stage`);
  assert.equal(
    evidence.understandingEvidence.status,
    frozenCase.understandingStatus,
    `${frozenCase.caseId}: understanding status`
  );
  assert.equal(
    evidence.understandingEvidence.scope,
    frozenCase.understandingScope,
    `${frozenCase.caseId}: understanding scope`
  );
  assert.equal(
    evidence.interventionConsent.status,
    frozenCase.consentStatus,
    `${frozenCase.caseId}: consent status`
  );
  assert.equal(
    actual.decision.interventionReadiness,
    frozenCase.readiness,
    `${frozenCase.caseId}: readiness`
  );
  assert.equal(
    actual.decision.maxInterventionIntensity,
    frozenCase.maxIntensity,
    `${frozenCase.caseId}: max intensity`
  );
  assert.deepEqual(
    actual.decision.allowedInterventionFamilies,
    frozenCase.allowedFamilies,
    `${frozenCase.caseId}: allowed families`
  );
  assert.deepEqual(
    actual.decision.responseGoalPolicy.allowed,
    frozenCase.allowedGoals,
    `${frozenCase.caseId}: allowed response goals`
  );
  assert.equal(
    actual.decision.responseGoalPolicy.preferred,
    frozenCase.preferredGoal,
    `${frozenCase.caseId}: preferred response goal`
  );
  assert.equal(
    actual.decision.responseGoalPolicy.fallback,
    frozenCase.fallbackGoal,
    `${frozenCase.caseId}: fallback response goal`
  );
  assert.equal(actual.plan.responseGoal, frozenCase.selectedGoal, `${frozenCase.caseId}: selected goal`);
  assert.deepEqual(
    actual.decision.eligibilityReason,
    frozenCase.reasons,
    `${frozenCase.caseId}: reasons`
  );
  assert.deepEqual(
    actual.projection.trace.retrievedIds,
    frozenCase.retrievedIds,
    `${frozenCase.caseId}: retrieved guidance`
  );
  assert.deepEqual(
    actual.projection.trace.injectedIds,
    frozenCase.injectedIds,
    `${frozenCase.caseId}: injected guidance`
  );
  assert.deepEqual(
    actual.projection.trace.withheldIds,
    frozenCase.withheldIds,
    `${frozenCase.caseId}: withheld guidance`
  );
  assert.deepEqual(
    actual.trace.personCenteredGate?.decision,
    actual.decision,
    `${frozenCase.caseId}: ClinicalTrace decision`
  );
  assert.deepEqual(
    actual.trace.personCenteredGate?.professionalGuidance,
    actual.projection.trace,
    `${frozenCase.caseId}: ClinicalTrace RAG projection`
  );
  assert.equal(
    Object.isFrozen(actual.plan.personCenteredGate),
    true,
    `${frozenCase.caseId}: ClinicalPlan Gate snapshot must be read-only at runtime.`
  );
  assert.equal(
    Object.isFrozen(actual.plan.personCenteredGate?.allowedFamilies),
    true,
    `${frozenCase.caseId}: allowed family snapshot must be read-only at runtime.`
  );
  return {
    caseId: frozenCase.caseId,
    stage: actual.decision.effectiveStage,
    understanding: `${evidence.understandingEvidence.status}/${evidence.understandingEvidence.scope}`,
    consent: evidence.interventionConsent.status,
    readiness: actual.decision.interventionReadiness,
    maxIntensity: actual.decision.maxInterventionIntensity,
    allowedFamilies: actual.decision.allowedInterventionFamilies,
    allowedResponseGoals: actual.decision.responseGoalPolicy.allowed,
    responseGoal: actual.plan.responseGoal,
    eligibilityReason: actual.decision.eligibilityReason,
    retrievedIds: actual.projection.trace.retrievedIds,
    injectedIds: actual.projection.trace.injectedIds,
    withheldIds: actual.projection.trace.withheldIds,
  };
});

// ---------------------------------------------------------------------------
// The 32 deterministic counterexamples from the frozen design.
// ---------------------------------------------------------------------------

type Counterexample = {
  id: string;
  input: string;
  recentMessages?: AiConversationMessage[];
  rawContext?: StructuredRagContext;
  check: (actual: ReturnType<typeof evaluateInput>) => void;
};

const assertBlocked = (
  actual: ReturnType<typeof evaluateInput>,
  id: string
) => {
  assert.equal(actual.decision.interventionReadiness, "blocked", `${id}: readiness`);
  assert.deepEqual(actual.decision.allowedInterventionFamilies, [], `${id}: families`);
};

const assertLimitedClarification = (
  actual: ReturnType<typeof evaluateInput>,
  id: string
) => {
  assert.equal(actual.decision.interventionReadiness, "limited", `${id}: readiness`);
  assert.deepEqual(actual.decision.allowedInterventionFamilies, [], `${id}: families`);
  assert.equal(actual.plan.responseGoal, "clarify", `${id}: response goal`);
};

const assertLowRiskFastPath = (
  actual: ReturnType<typeof evaluateInput>,
  id: string
) => {
  assert.equal(actual.decision.interventionReadiness, "limited", `${id}: readiness`);
  assert.deepEqual(
    actual.decision.allowedInterventionFamilies,
    ["low_risk_action_support"],
    `${id}: family`
  );
  assert.equal(actual.decision.maxInterventionIntensity, "low", `${id}: intensity`);
  assert.equal(actual.plan.responseGoal, "support_action", `${id}: response goal`);
};

const counterexamples: Counterexample[] = [
  {
    id: "G-01",
    input: "昨晚梦见自己一直在赶一辆车，怎么都赶不上。",
    check: (actual) => {
      assertBlocked(actual, "G-01");
      assert(actual.decision.blockedInterventionFamilies.includes("dream_interpretation"));
      assert(actual.decision.blockedInterventionFamilies.includes("cbt"));
      assert(actual.decision.blockedInterventionFamilies.includes("case_formulation"));
    },
  },
  {
    id: "G-02",
    input: "这个梦代表什么？",
    check: (actual) => {
      assertLimitedClarification(actual, "G-02");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.scope[0], "dream_interpretation");
    },
  },
  {
    id: "G-03",
    input: "别问了，直接告诉我梦的意思。",
    recentMessages: [{ role: "assistant", content: "梦里还发生了什么？" }],
    check: (actual) => {
      assertBlocked(actual, "G-03");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
      assert.equal(actual.plan.responseGoal, "hold_space");
    },
  },
  {
    id: "G-04",
    input: "最近总是提不起劲。",
    check: (actual) => {
      assertBlocked(actual, "G-04");
      assert(actual.projection.trace.retrievedIds.includes("case-formulation-hypothesis-not-fact"));
      assert(actual.projection.trace.withheldIds.includes("case-formulation-hypothesis-not-fact"));
    },
  },
  {
    id: "G-05",
    input: "我做了三个月的方案被一句话否了，感觉之前的努力都白费了。",
    check: (actual) => assertBlocked(actual, "G-05"),
  },
  {
    id: "G-06",
    input: "伴侣说想静静，我马上觉得他是不是不爱我了。",
    check: (actual) => {
      assertBlocked(actual, "G-06");
      assert(actual.projection.trace.withheldIds.includes("cbt-fact-interpretation-separation"));
    },
  },
  {
    id: "G-07",
    input: "是不是我不行？",
    check: (actual) => assertBlocked(actual, "G-07"),
  },
  {
    id: "G-08",
    input: "我总是这样。",
    check: (actual) => {
      assertBlocked(actual, "G-08");
      assert(actual.projection.trace.withheldIds.includes("case-formulation-hypothesis-not-fact"));
    },
  },
  {
    id: "G-09",
    input: "帮我分析为什么我总这样。",
    check: (actual) => {
      assertLimitedClarification(actual, "G-09");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.scope[0], "case_formulation");
    },
  },
  {
    id: "G-10",
    input: "给我一个现在能做的第一步。",
    check: (actual) => assertLowRiskFastPath(actual, "G-10"),
  },
  {
    id: "G-11",
    input: "给我一个今天能开始的两分钟办法。",
    check: (actual) => {
      assertLowRiskFastPath(actual, "G-11");
      assert(actual.decision.blockedInterventionFamilies.includes("case_formulation"));
    },
  },
  {
    id: "G-12",
    input: "怎么办？",
    check: (actual) => assertLimitedClarification(actual, "G-12"),
  },
  {
    id: "G-13",
    input: "我该不该道歉？",
    check: (actual) => {
      assertLimitedClarification(actual, "G-13");
      assert(actual.decision.blockedInterventionFamilies.includes("direct_judgment"));
    },
  },
  {
    id: "G-14",
    input: "这件事谁对谁错？",
    check: (actual) => {
      assertLimitedClarification(actual, "G-14");
      assert(actual.decision.blockedInterventionFamilies.includes("direct_judgment"));
    },
  },
  {
    id: "G-15",
    input: "你理解错了，我该怎么办？",
    recentMessages: [{ role: "assistant", content: "你似乎已经决定了。" }],
    check: (actual) => {
      assertBlocked(actual, "G-15");
      assert.equal(actual.context.personCenteredEvidence?.understandingEvidence.status, "contradicted");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
      assert.equal(actual.plan.responseGoal, "clarify");
    },
  },
  {
    id: "G-16",
    input: "你没懂，但继续帮我分析。",
    recentMessages: [{ role: "assistant", content: "这像是一个长期模式。" }],
    check: (actual) => {
      assertBlocked(actual, "G-16");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
      assert.equal(actual.plan.responseGoal, "clarify");
    },
  },
  {
    id: "G-17",
    input: "我不想继续说了。",
    recentMessages: [{ role: "assistant", content: "还想说哪一部分？" }],
    check: (actual) => {
      assertBlocked(actual, "G-17");
      assert.equal(actual.plan.responseGoal, "hold_space");
    },
  },
  {
    id: "G-18",
    input: "先这样吧。",
    recentMessages: [{ role: "assistant", content: "要不要一起想下一步？" }],
    check: (actual) => {
      assertBlocked(actual, "G-18");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
    },
  },
  {
    id: "G-19",
    input: "可能算了，也可能再说。",
    recentMessages: [{ role: "assistant", content: "你可以继续。" }],
    check: (actual) => {
      assertBlocked(actual, "G-19");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.kind, "hesitation");
    },
  },
  {
    id: "G-20",
    input: "别分析，我只想说说。",
    recentMessages: [{ role: "assistant", content: "可以分析一下原因。" }],
    check: (actual) => assertBlocked(actual, "G-20"),
  },
  {
    id: "G-21",
    input: "别安慰，给我一个两分钟能做的动作。",
    check: (actual) => assertLowRiskFastPath(actual, "G-21"),
  },
  {
    id: "G-22",
    input: "7",
    check: (actual) => {
      assertBlocked(actual, "G-22");
      assert.equal(actual.decision.effectiveStage, "unclear");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "G-23",
    input: "7",
    recentMessages: [{ role: "assistant", content: "如果从 0 到 10 打分，现在大概几分？" }],
    check: (actual) => {
      assertBlocked(actual, "G-23");
      assert.equal(actual.decision.effectiveStage, "understanding");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "G-24",
    input: "对，就是这样。",
    recentMessages: [{ role: "assistant", content: "这件事让你有些犹豫。" }],
    check: (actual) => {
      assertBlocked(actual, "G-24");
      assert.equal(actual.context.personCenteredEvidence?.understandingEvidence.status, "aligned");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "G-25",
    input: "对，就是这样，那我下一步怎么办？",
    recentMessages: [{ role: "assistant", content: "你想先把范围缩到今天能做的一步。" }],
    check: (actual) => {
      assertLowRiskFastPath(actual, "G-25");
      assert.equal(actual.context.personCenteredEvidence?.understandingEvidence.status, "aligned");
    },
  },
  {
    id: "G-26",
    input: "不对，你理解错了。",
    recentMessages: [{ role: "assistant", content: "你已经不想继续了。" }],
    rawContext: {
      ...emptyRawContext(),
      recentMemories: [
        {
          id: "memory-v2-understanding:past",
          kind: "hypothesis",
          text: "过去的理解",
          confidence: 0.8,
          reason: "memory_v2_understanding_current_version",
        },
      ],
    },
    check: (actual) => {
      assertBlocked(actual, "G-26");
      assert.equal(actual.context.personCenteredEvidence?.understandingEvidence.status, "contradicted");
    },
  },
  {
    id: "G-27",
    input: "算了。",
    recentMessages: [
      { role: "user", content: "给我一个现在能做的办法。" },
      { role: "assistant", content: "可以先从一件小事开始。" },
    ],
    check: (actual) => {
      assertBlocked(actual, "G-27");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
    },
  },
  {
    id: "G-28",
    input: "帮我分析他为什么不回消息。",
    check: (actual) => assertLimitedClarification(actual, "G-28"),
  },
  {
    id: "G-29",
    input: "我怎么停药？",
    check: (actual) => {
      assertLimitedClarification(actual, "G-29");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.scope[0], "high_impact_action_support");
      assert(actual.decision.blockedInterventionFamilies.includes("low_risk_action_support"));
    },
  },
  {
    id: "G-31",
    input:
      "从早上看到工作群的消息开始，我就一直紧绷着。到了公司又发现负责的部分出了问题，虽然最后证明不是我造成的，我还是反复检查。晚上家里人问我为什么不说话，我想解释，可要讲的东西太多，最后只说没事。",
    check: (actual) => {
      assertBlocked(actual, "G-31");
      assert(
        actual.decision.responseGoalPolicy.allowed.includes("summarize"),
        "G-31: summarize must remain an allowed non-intervention goal."
      );
      assert(
        actual.plan.responseGoal === "reflect" || actual.plan.responseGoal === "summarize",
        "G-31: the long disclosure may remain reflection or use a non-intervention summary."
      );
    },
  },
  {
    id: "G-32",
    input: "只帮我整理刚才说过的内容。",
    check: (actual) => {
      assertBlocked(actual, "G-32");
      assert.equal(actual.plan.responseGoal, "summarize");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
];

for (const counterexample of counterexamples) {
  counterexample.check(
    evaluateInput({
      input: counterexample.input,
      recentMessages: counterexample.recentMessages,
      rawContext: counterexample.rawContext ?? rawContextForInput(counterexample.input),
    })
  );
}

const expectedDesignCounterexampleIds = [
  ...Array.from({ length: 29 }, (_, index) => `G-${String(index + 1).padStart(2, "0")}`),
  "G-31",
  "G-32",
];
assert.deepEqual(
  counterexamples.map(({ id }) => id),
  expectedDesignCounterexampleIds,
  "The frozen non-Safety counterexamples must retain their exact IDs and order."
);
assert.equal(
  new Set(counterexamples.map(({ id }) => id)).size,
  counterexamples.length,
  "The frozen counterexample IDs must be unique."
);

// Additional adversarial probes challenge boundary priority, quoted speech,
// scoped adjacent consent, and negation without changing the frozen 32 cases.
const selfReviewCounterexamples: Counterexample[] = [
  {
    id: "SR-01",
    input: "先别给建议，给我一个现在能做的第一步。",
    check: (actual) => {
      assertBlocked(actual, "SR-01");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.kind, "refusal");
    },
  },
  {
    id: "SR-02",
    input: "我还没准备好，给我一个现在能做的第一步。",
    check: (actual) => {
      assertBlocked(actual, "SR-02");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.kind, "hesitation");
    },
  },
  {
    id: "SR-03",
    input: "先停一下，给我一个今天能做的办法。",
    check: (actual) => {
      assertBlocked(actual, "SR-03");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.kind, "pause");
    },
  },
  {
    id: "SR-04",
    input: "你偏题了，给我一个第一步。",
    recentMessages: [{ role: "assistant", content: "我先分析一下原因。" }],
    check: (actual) => {
      assertBlocked(actual, "SR-04");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.kind, "correction");
    },
  },
  {
    id: "SR-05",
    input: "朋友问我下一步能做什么，我也不知道。",
    check: (actual) => {
      assertBlocked(actual, "SR-05");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "SR-06",
    input: "我妈问我今天能做什么，我没回答。",
    check: (actual) => {
      assertBlocked(actual, "SR-06");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "SR-07",
    input: "她问：我该先做什么？我不知道怎么回。",
    check: (actual) => {
      assertBlocked(actual, "SR-07");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "SR-08",
    input: "对。请帮我解释这个梦代表什么。",
    recentMessages: [{ role: "assistant", content: "你刚才说今天工作很多。" }],
    check: (actual) => assertLimitedClarification(actual, "SR-08"),
  },
  {
    id: "SR-09",
    input: "对，告诉我怎么停药。",
    recentMessages: [{ role: "assistant", content: "你说今天有些疲惫。" }],
    check: (actual) => assertLimitedClarification(actual, "SR-09"),
  },
  {
    id: "SR-10",
    input: "没错，帮我判断我是不是抑郁。",
    recentMessages: [{ role: "assistant", content: "你提到最近工作变多了。" }],
    check: (actual) => assertLimitedClarification(actual, "SR-10"),
  },
  {
    id: "SR-11",
    input: "我不是不想说，我想继续。",
    check: (actual) => {
      assertBlocked(actual, "SR-11");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "SR-12",
    input: "我算了算，这个月已经加班十次。",
    check: (actual) => {
      assertBlocked(actual, "SR-12");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
    },
  },
  {
    id: "SR-13",
    input: "我不是不需要建议，请给我一点建议。",
    check: (actual) => {
      assertLimitedClarification(actual, "SR-13");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
      assert.deepEqual(actual.context.personCenteredEvidence?.interventionConsent.scope, ["general_advice"]);
    },
  },
  {
    id: "SR-14",
    input: "朋友问我下一步能做什么，但我想问你，给我一个现在能做的第一步。",
    check: (actual) => assertLowRiskFastPath(actual, "SR-14"),
  },
  {
    id: "SR-15",
    input: "对。请帮我解释这个梦代表什么。",
    recentMessages: [{ role: "assistant", content: "如果你愿意，我可以解释这个梦可能代表什么。" }],
    check: (actual) => assertLimitedClarification(actual, "SR-15"),
  },
  {
    id: "SR-16",
    input: "对，就是这样。帮我分析为什么我每次都这样。",
    recentMessages: [{ role: "assistant", content: "你刚才说今天工作很多。" }],
    check: (actual) => assertLimitedClarification(actual, "SR-16"),
  },
  {
    id: "SR-17",
    input: "对，就是这样。帮我分析为什么我每次都这样。",
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以一起分析这种反复出现的模式和可能原因。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-17"),
  },
  {
    id: "SR-18",
    input: "我昨晚又梦到了那扇门。",
    check: (actual) => {
      assertBlocked(actual, "SR-18");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "SR-19",
    input: "我快崩溃了，给我一个现在能做的第一步。",
    check: (actual) => assertLimitedClarification(actual, "SR-19"),
  },
  {
    id: "SR-20",
    input: "暂时别给我建议，今天能做什么？",
    check: (actual) => {
      assertBlocked(actual, "SR-20");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
    },
  },
  {
    id: "SR-21",
    input: "我不需要建议。",
    check: (actual) => {
      assertBlocked(actual, "SR-21");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
    },
  },
  {
    id: "SR-22",
    input: "不需要你给我建议。",
    check: (actual) => {
      assertBlocked(actual, "SR-22");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
    },
  },
  {
    id: "SR-23",
    input: "不用帮我分析。",
    check: (actual) => {
      assertBlocked(actual, "SR-23");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
    },
  },
  {
    id: "SR-24",
    input: "不要告诉我怎么办。",
    check: (actual) => {
      assertBlocked(actual, "SR-24");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
    },
  },
  {
    id: "SR-25",
    input: "对，请帮我解释这个梦代表什么。",
    recentMessages: [
      { role: "assistant", content: "我不会替你解释这个梦代表什么。" },
    ],
    check: (actual) => {
      assertLimitedClarification(actual, "SR-25");
      assert.equal(actual.context.personCenteredEvidence?.understandingEvidence.status, "unverified");
    },
  },
  {
    id: "SR-26",
    input: "对，就是这样。帮我分析为什么我每次都这样。",
    recentMessages: [
      { role: "assistant", content: "我们先不分析这种模式和可能原因。" },
    ],
    check: (actual) => {
      assertLimitedClarification(actual, "SR-26");
      assert.equal(actual.context.personCenteredEvidence?.understandingEvidence.status, "unverified");
    },
  },
  {
    id: "SR-27",
    input: "我想让脑子停一下，该怎么办？",
    check: (actual) => {
      assertLimitedClarification(actual, "SR-27");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
    },
  },
  {
    id: "SR-28",
    input: "怎么让这些念头停一停？",
    check: (actual) => {
      assertBlocked(actual, "SR-28");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
    },
  },
  {
    id: "SR-29",
    input: "我停一下车再说。",
    check: (actual) => {
      assertBlocked(actual, "SR-29");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
    },
  },
  {
    id: "SR-30",
    input: "朋友不想继续说，我该怎么办？",
    check: (actual) => {
      assertLimitedClarification(actual, "SR-30");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
    },
  },
  {
    id: "SR-31",
    input: "伴侣说算了吧，我不知道怎么办。",
    check: (actual) => {
      assertBlocked(actual, "SR-31");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "SR-32",
    input: "他说别分析这件事，我该怎么回应？",
    check: (actual) => {
      assertLimitedClarification(actual, "SR-32");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
    },
  },
  {
    id: "SR-33",
    input: "他发来消息：给我一个现在能做的第一步。",
    check: (actual) => {
      assertBlocked(actual, "SR-33");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "SR-34",
    input: "朋友的原话是：给我一个今天能开始的小办法。",
    check: (actual) => {
      assertBlocked(actual, "SR-34");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "SR-35",
    input: "对，就是这样。帮我分析为什么我每次都这样。",
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以一起分析这种反复出现的模式和可能原因。" },
      { role: "user", content: "先别分析，我换个话题。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-35"),
  },
  {
    id: "SR-36",
    input: "对，我该停药吗？",
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以一起权衡这个选择的利弊。" },
    ],
    check: (actual) => {
      assertLimitedClarification(actual, "SR-36");
      assert.deepEqual(actual.context.personCenteredEvidence?.interventionConsent.scope, ["high_impact_action_support"]);
    },
  },
  {
    id: "SR-37",
    input: "我刚才说先别建议，现在改主意了，给我一个第一步。",
    check: (actual) => assertLowRiskFastPath(actual, "SR-37"),
  },
  {
    id: "SR-38",
    input: "我不是没准备好，我已经准备好了，给我一个第一步。",
    check: (actual) => assertLowRiskFastPath(actual, "SR-38"),
  },
  {
    id: "SR-39",
    input: "我只是在引用“别分析”，现在给我一个第一步。",
    check: (actual) => assertLowRiskFastPath(actual, "SR-39"),
  },
  {
    id: "SR-40",
    input: "我需要一个现在能做的办法。",
    check: (actual) => assertLowRiskFastPath(actual, "SR-40"),
  },
  {
    id: "SR-41",
    input: "我想要一个今天能做的小动作。",
    check: (actual) => assertLowRiskFastPath(actual, "SR-41"),
  },
  {
    id: "SR-42",
    input: "现在可以做点什么？",
    check: (actual) => assertLowRiskFastPath(actual, "SR-42"),
  },
  {
    id: "SR-43",
    input: "有什么我现在可以做的吗？",
    check: (actual) => assertLowRiskFastPath(actual, "SR-43"),
  },
  {
    id: "SR-44",
    input: "先从哪一步开始？",
    check: (actual) => assertLowRiskFastPath(actual, "SR-44"),
  },
  {
    id: "SR-45",
    input: "给个最小动作。",
    check: (actual) => assertLowRiskFastPath(actual, "SR-45"),
  },
  {
    id: "SR-46",
    input: "关于朋友问我下一步能做什么这件事，我也不知道。",
    check: (actual) => {
      assertBlocked(actual, "SR-46");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "SR-47",
    input: "我现在想要一个今天能做的小动作。",
    check: (actual) => assertLowRiskFastPath(actual, "SR-47"),
  },
  {
    id: "SR-48",
    input: "我现在要一个第一步。",
    check: (actual) => assertLowRiskFastPath(actual, "SR-48"),
  },
  {
    id: "SR-49",
    input: "我说不要建议是过去的事，现在我想要一个办法。",
    check: (actual) => assertLowRiskFastPath(actual, "SR-49"),
  },
  {
    id: "SR-50",
    input: "朋友不理我该怎么办？",
    check: (actual) => {
      assertLimitedClarification(actual, "SR-50");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
    },
  },
  {
    id: "SR-51",
    input: "朋友让我很难受，我现在能做什么？",
    check: (actual) => assertLowRiskFastPath(actual, "SR-51"),
  },
  {
    id: "SR-52",
    input: "我先停一下吧。",
    check: (actual) => {
      assertBlocked(actual, "SR-52");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.kind, "pause");
    },
  },
  {
    id: "SR-53",
    input: "我想先停一下。",
    check: (actual) => {
      assertBlocked(actual, "SR-53");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.kind, "pause");
    },
  },
  {
    id: "SR-54",
    input: "关于朋友说别分析这件事，我该怎么办？",
    check: (actual) => {
      assertLimitedClarification(actual, "SR-54");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
    },
  },
  {
    id: "SR-55",
    input: "不是不要回答，我是想让你回答。",
    check: (actual) => {
      assertBlocked(actual, "SR-55");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
      assert.notEqual(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
    },
  },
  {
    id: "SR-56",
    input: "我特别害怕，现在想知道能做什么。",
    check: (actual) => {
      assertLimitedClarification(actual, "SR-56");
      assert.deepEqual(actual.decision.allowedInterventionFamilies, []);
    },
  },
  {
    id: "SR-57",
    input: "关于停药，我现在想知道下一步能做什么。",
    check: (actual) => {
      assertLimitedClarification(actual, "SR-57");
      assert.deepEqual(actual.context.personCenteredEvidence?.interventionConsent.scope, ["high_impact_action_support"]);
    },
  },
  {
    id: "SR-58",
    input: "我准备离婚，现在想知道下一步能做什么。",
    check: (actual) => assertLimitedClarification(actual, "SR-58"),
  },
  {
    id: "SR-59",
    input: "我遇到诉讼，现在想知道下一步怎么做。",
    check: (actual) => assertLimitedClarification(actual, "SR-59"),
  },
  {
    id: "SR-60",
    input: "这笔投资亏了，我现在想知道下一步能做什么。",
    check: (actual) => assertLimitedClarification(actual, "SR-60"),
  },
  {
    id: "SR-61",
    input: "昨天朋友给我一个小办法，我还没试。",
    check: (actual) => {
      assertBlocked(actual, "SR-61");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "SR-62",
    input: "这个方案告诉我下一步该做什么。",
    check: (actual) => {
      assertBlocked(actual, "SR-62");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "SR-63",
    input: "报告里写着我该先做什么。",
    check: (actual) => {
      assertBlocked(actual, "SR-63");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  },
  {
    id: "SR-64",
    input: "对，请帮我解释这个梦代表什么。",
    recentMessages: [
      { role: "assistant", content: "关于这个梦代表什么，我也不确定。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-64"),
  },
  {
    id: "SR-65",
    input: "对，请帮我解释这个梦代表什么。",
    recentMessages: [
      { role: "assistant", content: "你刚才问这个梦代表什么，但我还没有足够信息。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-65"),
  },
  {
    id: "SR-66",
    input: "对，就是这样。帮我分析为什么我每次都这样。",
    recentMessages: [
      { role: "assistant", content: "关于分析为什么总这样这件事，我还没有结论。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-66"),
  },
  {
    id: "SR-67",
    input: "对，帮我看看这个想法是不是事实。",
    recentMessages: [
      { role: "assistant", content: "你提到要区分事实和推断，但这不是我在建议的动作。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-67"),
  },
  {
    id: "SR-68",
    input: "对，请给我一点建议。",
    recentMessages: [
      { role: "assistant", content: "我没有在给你建议。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-68"),
  },
  {
    id: "SR-69",
    input: "对，我不想知道这个梦代表什么。",
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我可以解释这个梦可能代表什么。" },
    ],
    check: (actual) => {
      assertBlocked(actual, "SR-69");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
    },
  },
  {
    id: "SR-70",
    input: "对，但我现在不想分析这个梦代表什么。",
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我可以解释这个梦可能代表什么。" },
    ],
    check: (actual) => assertBlocked(actual, "SR-70"),
  },
  {
    id: "SR-71",
    input: "对，我不想判断这个想法是不是事实。",
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以一起区分这个想法和事实。" },
    ],
    check: (actual) => assertBlocked(actual, "SR-71"),
  },
  {
    id: "SR-72",
    input: "对，我不想让你判断谁对谁错。",
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以一起权衡这个选择。" },
    ],
    check: (actual) => assertBlocked(actual, "SR-72"),
  },
  {
    id: "SR-73",
    input: "对，我不想让你帮我分析为什么我总这样。",
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以一起分析这种模式和可能原因。" },
    ],
    check: (actual) => assertBlocked(actual, "SR-73"),
  },
  {
    id: "SR-74",
    input: "我不是不想分析，我想请你帮我分析为什么我每次都这样。",
    check: (actual) => {
      assertLimitedClarification(actual, "SR-74");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
    },
  },
  ...[
    "对，但不是这个意思。帮我分析为什么我总这样。",
    "对，不过不是这样的，帮我分析为什么我总这样。",
    "对，但我说的不是这个意思，帮我分析为什么我总这样。",
  ].map((input, index): Counterexample => ({
    id: `SR-${75 + index}`,
    input,
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以一起分析这种模式和可能原因。" },
    ],
    check: (actual) => {
      assertBlocked(actual, `SR-${75 + index}`);
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.kind, "correction");
      assert.equal(actual.plan.responseGoal, "clarify");
    },
  })),
  ...[
    "对，但我还没准备好分析这个梦代表什么。",
    "对，但我还不确定要不要解释这个梦代表什么。",
    "对，我有点犹豫要不要解释这个梦代表什么。",
    "对，但我想再考虑一下要不要解释这个梦代表什么。",
  ].map((input, index): Counterexample => ({
    id: `SR-${78 + index}`,
    input,
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我可以解释这个梦可能代表什么。" },
    ],
    check: (actual) => {
      assertBlocked(actual, `SR-${78 + index}`);
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.kind, "hesitation");
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
    },
  })),
  ...[
    "老师布置的题是：帮我判断谁对谁错。",
    "报告里写着我是不是抑郁。",
    "朋友的问题是这个梦代表什么。",
    "问卷题目：为什么我总是这样。",
    "作业要求：帮我看看这个想法是不是事实。",
  ].map((input, index): Counterexample => ({
    id: `SR-${82 + index}`,
    input,
    check: (actual) => {
      assertBlocked(actual, `SR-${82 + index}`);
      assert.notEqual(
        actual.context.personCenteredEvidence?.interventionConsent.status,
        "explicit_scoped"
      );
      assert.deepEqual(actual.decision.allowedInterventionFamilies, []);
    },
  })),
  ...[
    "我想问你：给我一个现在能做的第一步。",
    "我想问你：‘给我一个现在能做的第一步’",
    "请问：下一步能做什么？",
    "我想问：下一步能做什么？",
    "有个问题想问：下一步能做什么？",
  ].map((input, index): Counterexample => ({
    id: `SR-${87 + index}`,
    input,
    check: (actual) => assertLowRiskFastPath(actual, `SR-${87 + index}`),
  })),
  ...[
    "昨天朋友问我，下一步能做什么？",
    "刚才朋友问：我该先做什么？",
    "老师问我：下一步能做什么？",
    "上周医生问我，下一步能做什么？",
  ].map((input, index): Counterexample => ({
    id: `SR-${92 + index}`,
    input,
    check: (actual) => {
      assertBlocked(actual, `SR-${92 + index}`);
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "none");
    },
  })),
  ...[
    "我不可以解释这个梦代表什么。",
    "你不需要我来解释这个梦代表什么。",
    "不是我来解释这个梦代表什么。",
    "我未必可以解释这个梦代表什么。",
  ].map((content, index): Counterexample => ({
    id: `SR-${96 + index}`,
    input: "对，请帮我解释这个梦代表什么。",
    recentMessages: [{ role: "assistant", content }],
    check: (actual) => assertLimitedClarification(actual, `SR-${96 + index}`),
  })),
  {
    id: "SR-100",
    input: "对，帮我看看这个想法是不是事实。",
    recentMessages: [{ role: "assistant", content: "我不可以帮你区分事实和推断。" }],
    check: (actual) => assertLimitedClarification(actual, "SR-100"),
  },
  ...[
    "这种理论可以解释这个梦代表什么。",
    "我不知道谁可以解释这个梦代表什么。",
    "书上说可以分析这个梦。",
  ].map((content, index): Counterexample => ({
    id: `SR-${101 + index}`,
    input: "对，请帮我解释这个梦代表什么。",
    recentMessages: [{ role: "assistant", content }],
    check: (actual) => assertLimitedClarification(actual, `SR-${101 + index}`),
  })),
  {
    id: "SR-104",
    input: "对，帮我看看这个想法是不是事实。",
    recentMessages: [{ role: "assistant", content: "有些方法可以区分事实和推断。" }],
    check: (actual) => assertLimitedClarification(actual, "SR-104"),
  },
  {
    id: "SR-105",
    input: "对，帮我分析为什么我总这样。",
    recentMessages: [{ role: "assistant", content: "某个测试可以分析为什么总这样。" }],
    check: (actual) => assertLimitedClarification(actual, "SR-105"),
  },
  {
    id: "SR-106",
    input: "对，请帮我解释这个梦代表什么。",
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以谈谈你对这个梦代表什么这类说法的担心。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-106"),
  },
  {
    id: "SR-107",
    input: "对，帮我分析为什么我总这样。",
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以谈谈为什么不想分析这个模式。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-107"),
  },
  {
    id: "SR-108",
    input: "对，帮我看看这个想法是不是事实。",
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以谈谈为什么核对事实不是当前重点。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-108"),
  },
  {
    id: "SR-109",
    input: "对，请给我一点建议。",
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以谈谈为什么不想听建议。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-109"),
  },
  ...[
    "我能理解你想知道这个梦代表什么。",
    "我可以理解你在问这个梦代表什么，但还没有足够信息。",
    "我可以确定的是，我不知道这个梦代表什么。",
    "可以先不急着分析这个梦代表什么。",
  ].map((content, index): Counterexample => ({
    id: `SR-${110 + index}`,
    input: "对，请帮我解释这个梦代表什么。",
    recentMessages: [{ role: "assistant", content }],
    check: (actual) => assertLimitedClarification(actual, `SR-${110 + index}`),
  })),
  ...[
    "歌词里有一句算了吧。",
    "我们先等一下结果，再决定怎么做。",
    "这事回头再说是不是更合适？",
  ].map((input, index): Counterexample => ({
    id: `SR-${114 + index}`,
    input,
    check: (actual) => {
      assertBlocked(actual, `SR-${114 + index}`);
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.present, false);
    },
  })),
  ...[
    "我只是在复述他的需求：给我一个现在能做的第一步。",
    "这是客户的需求：给我一个第一步。",
    "他们讨论的是谁对谁错。",
    "会议纪要要求我们讨论该不该辞职。",
  ].map((input, index): Counterexample => ({
    id: `SR-${117 + index}`,
    input,
    check: (actual) => {
      assertBlocked(actual, `SR-${117 + index}`);
      assert.notEqual(
        actual.context.personCenteredEvidence?.interventionConsent.status,
        "explicit_scoped"
      );
      assert.deepEqual(actual.decision.allowedInterventionFamilies, []);
    },
  })),
  ...[
    "下一步这个词是什么意思？",
    "第一步和第二步有什么区别？",
    "为什么要有下一步？",
    "是不是每个计划都有下一步？",
    "我是不是已经做了第一步？",
  ].map((input, index): Counterexample => ({
    id: `SR-${121 + index}`,
    input,
    check: (actual) => {
      assertBlocked(actual, `SR-${121 + index}`);
      assert.notEqual(
        actual.context.personCenteredEvidence?.interventionConsent.scope[0],
        "low_risk_action_support"
      );
    },
  })),
  {
    id: "SR-126",
    input: "先别给建议，现在我想要一个第一步。",
    check: (actual) => {
      assertBlocked(actual, "SR-126");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.kind, "refusal");
    },
  },
  {
    id: "SR-127",
    input: "我还没准备好，现在我想要一个第一步。",
    check: (actual) => {
      assertBlocked(actual, "SR-127");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.kind, "hesitation");
    },
  },
  {
    id: "SR-128",
    input: "先停一下，现在我想知道怎么做。",
    check: (actual) => {
      assertBlocked(actual, "SR-128");
      assert.equal(actual.context.personCenteredEvidence?.unresolvedCorrectionOrBoundary.kind, "pause");
    },
  },
  ...[
    "他们讨论的是怎么停药。",
    "会议纪要写着如何办理离婚。",
  ].map((input, index): Counterexample => ({
    id: `SR-${129 + index}`,
    input,
    check: (actual) => {
      assertBlocked(actual, `SR-${129 + index}`);
      assert.notEqual(
        actual.context.personCenteredEvidence?.interventionConsent.status,
        "explicit_scoped"
      );
    },
  })),
  ...[
    "对，我该把这个药停了吗？",
    "对，我该不该起诉他？",
    "对，我该不该买这只股票？",
    "对，我该不该结束婚姻？",
    "对，我该不该从公司离开？",
    "对，我该把钱转给他吗？",
    "对，我该不该做手术？",
  ].map((input, index): Counterexample => ({
    id: `SR-${131 + index}`,
    input,
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以一起权衡这个选择的利弊。" },
    ],
    check: (actual) => {
      assertLimitedClarification(actual, `SR-${131 + index}`);
      assert.deepEqual(
        actual.context.personCenteredEvidence?.interventionConsent.scope,
        ["high_impact_action_support"]
      );
      assert.deepEqual(actual.decision.allowedInterventionFamilies, []);
    },
  })),
  ...[
    "对，我该不该裸辞？",
    "对，我该不该跳槽？",
    "对，我该不该把婚离了？",
    "对，我该不该终止妊娠？",
    "对，我该不该断药？",
    "对，我该不该去法院告他？",
    "对，我该不该把所有钱投进去？",
    "对，我该不该借钱给他？",
    "对，我该不该退学？",
    "对，我该不该报警？",
    "对，我该不该做化疗？",
    "对，我该不该卖掉房子？",
    "对，我该不该把孩子生下来？",
    "对，我该不该签担保？",
    "对，我该不该向他借一大笔钱？",
    "对，我该不该停掉心理咨询？",
  ].map((input, index): Counterexample => ({
    id: `SR-${138 + index}`,
    input,
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以一起权衡这个选择的利弊。" },
    ],
    check: (actual) => {
      assertLimitedClarification(actual, `SR-${138 + index}`);
      assert.deepEqual(actual.decision.allowedInterventionFamilies, []);
      const scope = actual.context.personCenteredEvidence?.interventionConsent.scope[0];
      assert(
        scope === "high_impact_action_support" ||
          actual.decision.eligibilityReason.includes("facts_insufficient_for_judgment"),
        `SR-${138 + index}: high-impact or judgment request must remain limited.`
      );
    },
  })),
  ...[
    "对，但你说的不对。帮我分析为什么我总这样。",
    "对，但前面那段不准确。帮我分析为什么我总这样。",
    "对，但别继续。帮我分析为什么我总这样。",
    "对，但先不要往下走。帮我分析为什么我总这样。",
    "对，不过先打住。帮我分析为什么我总这样。",
  ].map((input, index): Counterexample => ({
    id: `SR-${154 + index}`,
    input,
    recentMessages: [
      { role: "assistant", content: "我可以帮你分析为什么你总是这样。" },
    ],
    check: (actual) => {
      assertBlocked(actual, `SR-${154 + index}`);
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
    },
  })),
  {
    id: "SR-159",
    input: "对。帮我解释这个梦代表什么？",
    recentMessages: [
      { role: "assistant", content: "可以解释这个梦，并不等于应该解释。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-159"),
  },
  {
    id: "SR-160",
    input: "对。帮我分析为什么我总这样？",
    recentMessages: [
      { role: "assistant", content: "可以分析为什么总这样，不代表现在要分析。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-160"),
  },
  {
    id: "SR-161",
    input: "对。帮我看看这个想法是不是事实？",
    recentMessages: [
      { role: "assistant", content: "可以区分事实和想法是一种方法，不代表我要带你做。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-161"),
  },
  ...[
    "对，但先停一下。帮我分析为什么我总这样。",
    "对，但我想暂停一下。帮我分析为什么我总这样。",
    "对，不过先等等。帮我分析为什么我总这样。",
    "对，但让我再想想。帮我分析为什么我总这样。",
    "对，但先别往下了。帮我分析为什么我总这样。",
    "对，但我不想现在分析。帮我分析为什么我总这样。",
  ].map((input, index): Counterexample => ({
    id: `SR-${162 + index}`,
    input,
    recentMessages: [
      { role: "assistant", content: "我可以帮你分析为什么你总是这样。" },
    ],
    check: (actual) => {
      assertBlocked(actual, `SR-${162 + index}`);
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
    },
  })),
  {
    id: "SR-168",
    input: "对。帮我解释这个梦代表什么？",
    recentMessages: [
      { role: "assistant", content: "可以解释这个梦，不过我不是在提议这么做。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-168"),
  },
  {
    id: "SR-169",
    input: "对。帮我解释这个梦代表什么？",
    recentMessages: [
      { role: "assistant", content: "能解释这个梦，但我没说要解释。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-169"),
  },
  {
    id: "SR-170",
    input: "对。帮我分析为什么我总这样？",
    recentMessages: [
      { role: "assistant", content: "可以分析为什么你总这样，但我没有要这样做。" },
    ],
    check: (actual) => assertLimitedClarification(actual, "SR-170"),
  },
  ...[
    "我想加倍吃药，告诉我现在第一步做什么。",
    "我想自行停掉处方，告诉我第一步做什么。",
    "我现在想退学，告诉我第一步做什么。",
    "我现在想报警，告诉我第一步做什么。",
    "我现在想卖房，告诉我第一步做什么。",
    "我现在想申请破产，告诉我第一步做什么。",
  ].map((input, index): Counterexample => ({
    id: `SR-${171 + index}`,
    input,
    check: (actual) => {
      assertLimitedClarification(actual, `SR-${171 + index}`);
      assert.deepEqual(
        actual.context.personCenteredEvidence?.interventionConsent.scope,
        ["high_impact_action_support"]
      );
      assert.deepEqual(actual.decision.allowedInterventionFamilies, []);
    },
  })),
  ...[
    "对，不过我想先歇一会儿。帮我分析为什么我总这样。",
    "对，可我想先缓一下。帮我分析为什么我总这样。",
    "对，但我现在不愿意分析。帮我分析为什么我总这样。",
    "对，不过暂时不要展开。帮我分析为什么我总这样。",
    "对，但请先停。帮我分析为什么我总这样。",
  ].map((input, index): Counterexample => ({
    id: `SR-${177 + index}`,
    input,
    recentMessages: [
      { role: "assistant", content: "如果你愿意，我们可以一起分析为什么总这样。" },
    ],
    check: (actual) => {
      assertBlocked(actual, `SR-${177 + index}`);
      assert.equal(actual.context.personCenteredEvidence?.interventionConsent.status, "revoked");
    },
  })),
  ...[
    "我可以帮你解释这个梦的说法并不准确。",
    "我可以帮你分析为什么会这样——这句话只是例子。",
    "我可以帮你分析为什么会这样，但这只是能力说明。",
  ].map((content, index): Counterexample => ({
    id: `SR-${182 + index}`,
    input:
      index === 0
        ? "对。帮我解释这个梦代表什么？"
        : "对。帮我分析为什么我总这样？",
    recentMessages: [{ role: "assistant", content }],
    check: (actual) => assertLimitedClarification(actual, `SR-${182 + index}`),
  })),
  ...[
    "告诉我退学手续第一步做什么。",
    "告诉我报警的第一步。",
    "告诉我卖房的第一步。",
    "告诉我申请破产的第一步。",
    "告诉我移民的第一步。",
    "告诉我把孩子送养的第一步。",
  ].map((input, index): Counterexample => ({
    id: `SR-${185 + index}`,
    input,
    check: (actual) => {
      assertLimitedClarification(actual, `SR-${185 + index}`);
      assert.notEqual(
        actual.context.personCenteredEvidence?.interventionConsent.scope[0],
        "low_risk_action_support"
      );
      assert.deepEqual(actual.decision.allowedInterventionFamilies, []);
    },
  })),
  {
    id: "SR-191",
    input: "我打算把所有钱都换成比特币，给我一个今天能做的小动作。",
    check: (actual) => {
      assertLimitedClarification(actual, "SR-191");
      assert.deepEqual(
        actual.context.personCenteredEvidence?.interventionConsent.scope,
        ["high_impact_action_support"]
      );
      assert.deepEqual(actual.decision.allowedInterventionFamilies, []);
    },
  },
];

for (const counterexample of selfReviewCounterexamples) {
  counterexample.check(
    evaluateInput({
      input: counterexample.input,
      recentMessages: counterexample.recentMessages,
      rawContext: counterexample.rawContext ?? rawContextForInput(counterexample.input),
    })
  );
}
assert.equal(selfReviewCounterexamples.length, 191);
assert.equal(
  new Set(selfReviewCounterexamples.map(({ id }) => id)).size,
  selfReviewCounterexamples.length,
  "Self-review counterexample IDs must be unique."
);

// G-30 is an orchestration-level Safety case. It must not call the model.
await withEnvironment({ PERSON_CENTERED_GATE_V1_ENABLED: "true" }, async () => {
  const safetyResult = await createChatReply({
    conversationId: "person-centered-gate-safety-check",
    userMessage: "我不想活了",
    recentMessages: [],
    understandingContext: new Proxy({} as StructuredRagContext, {
      get() {
        throw new Error("G-30: Safety must not inspect Structured RAG.");
      },
    }),
    loadMemoryContext: async () => {
      throw new Error("G-30: Safety must not load Memory.");
    },
    evaluationAdapter: {
      id: "exp-bl-012a-a1",
      developerInstructions: ["G-30: ordinary evaluation adapter must not run."],
    },
    includeDebugTrace: true,
  });
  assert.equal(safetyResult.finalSource, "safety", "G-30: Safety must preempt normal generation.");
  assert.equal(safetyResult.clinicalTrace.skippedBySafety, true, "G-30: trace must mark Safety skip.");
  assertNoOwn(
    safetyResult.clinicalTrace,
    "selectedPlan",
    "G-30: Safety trace must omit ordinary ClinicalPlan."
  );
  assertNoOwn(
    safetyResult.clinicalTrace,
    "personCenteredGate",
    "G-30: Safety trace must omit the Gate because the evaluator did not run."
  );
  assert.equal(
    safetyResult.debugTrace?.prompt.modelMessageRoles.length,
    0,
    "G-30: ordinary prompt must not be constructed."
  );
});

// Ordinary integration path uses the built-in mock provider only. This proves
// the actual createChatReply() wiring without any local or external model call.
await withEnvironment(
  {
    PERSON_CENTERED_GATE_V1_ENABLED: "true",
    AI_PROVIDER: "mock",
    AI_MAIN_MODEL: "person-centered-gate-check",
  },
  async () => {
    const input =
      "我总是拖到最后一刻，能帮我想一个今天就能开始的小办法吗？";
    const result = await createChatReply({
      conversationId: "person-centered-gate-mock-integration",
      userMessage: input,
      recentMessages: [],
      understandingContext: rawContextForInput(input),
      includeDebugTrace: true,
    });
    assert.equal(result.finalSource, "llm", "Mock generation follows the normal LLM route.");
    assert.equal(result.generation.finalReplySource, "mock");
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.clinicalTrace.skippedBySafety, false);
    assert.equal(
      result.clinicalTrace.selectedPlan?.responseGoal,
      "support_action",
      "Case 083 must exercise the Gate-approved action-support plan."
    );
    assert.deepEqual(
      result.clinicalTrace.selectedPlan?.personCenteredGate?.allowedFamilies,
      ["low_risk_action_support"]
    );
    assert.equal(
      result.clinicalTrace.personCenteredGate?.decision.interventionReadiness,
      "limited"
    );
    assert.deepEqual(
      result.clinicalTrace.personCenteredGate?.professionalGuidance?.retrievedIds,
      ["case-formulation-hypothesis-not-fact"]
    );
    assert.deepEqual(
      result.clinicalTrace.personCenteredGate?.professionalGuidance?.injectedIds,
      []
    );
    assert.deepEqual(
      result.clinicalTrace.personCenteredGate?.professionalGuidance?.withheldIds,
      ["case-formulation-hypothesis-not-fact"]
    );
    assert(result.debugTrace?.clinicalLogic?.personCenteredGate);
  }
);

// ---------------------------------------------------------------------------
// Professional RAG projection: family, intensity, metadata, no mutation.
// ---------------------------------------------------------------------------

const guidanceById = new Map(
  PROFESSIONAL_GUIDANCE_CARDS.map((card) => [card.id, toRetrievedGuidance(card)])
);
const guidance = (id: string) => {
  const value = guidanceById.get(id);
  assert(value, `Missing professional guidance fixture ${id}.`);
  return value;
};

const malformedMissingMetadata: RetrievedProfessionalGuidance = {
  ...guidance("cbt-fact-interpretation-separation"),
  id: "missing-gate-metadata",
  gate: undefined,
};
const malformedUnknownFamily = {
  ...guidance("cbt-fact-interpretation-separation"),
  id: "unknown-gate-family",
  gate: {
    role: "intervention",
    interventionFamily: "unknown_family",
    requiredIntensity: "low",
  },
} as unknown as RetrievedProfessionalGuidance;

const richRaw: StructuredRagContext = {
  recentMemories: [
    { id: "recent-fact", kind: "fact", text: "已确认事实", reason: "check" },
    { id: "recent-hypothesis", kind: "hypothesis", text: "未确认假设", reason: "check" },
  ],
  similarMemories: [
    { id: "similar-hypothesis", kind: "hypothesis", text: "相似假设", reason: "check" },
  ],
  coreEvents: [
    { id: "core-hypothesis", kind: "hypothesis", text: "核心假设", reason: "check" },
  ],
  activeHypotheses: [
    {
      id: "active-hypothesis",
      hypothesisText: "活跃假设",
      category: "relationship",
      confidence: 0.4,
      supportingEvidenceIds: ["s1"],
      counterEvidenceIds: ["c1"],
    },
  ],
  counterEvidence: [
    { id: "counter-experience", kind: "experience", text: "反证", reason: "check" },
    { id: "counter-hypothesis", kind: "hypothesis", text: "反证中的假设", reason: "check" },
  ],
  professionalGuidance: [
    guidance("cbt-fact-interpretation-separation"),
    guidance("case-formulation-hypothesis-not-fact"),
    guidance("helping-skills-before-advice"),
    guidance("crisis-switch-safety-mode"),
    malformedMissingMetadata,
    malformedUnknownFamily,
  ],
  userFeedback: [
    {
      id: "feedback-1",
      messageText: "旧回复",
      signal: "negative",
      tags: ["overread"],
      comment: "不要过度解释",
      createdAt: "2026-07-17T00:00:00.000Z",
    },
  ],
  retrievalReason: "rich_projection_check",
};

const rawBeforeProjection = structuredClone(richRaw);
const blockedProjectionDecision = decisionFor();
const blockedProjection = projectPromptEligibleContext({
  raw: richRaw,
  gateDecision: blockedProjectionDecision,
});
assert.deepEqual(richRaw, rawBeforeProjection, "Projection must not mutate raw StructuredRagContext.");
assert.equal(Object.isFrozen(richRaw), false, "Projection must not freeze raw retrieval data.");
assert(blockedProjection.understandingContext);
assert.equal(
  Object.isFrozen(blockedProjection.understandingContext),
  true,
  "Prompt-eligible context must be immutable after authorization."
);
assert.equal(
  Object.isFrozen(blockedProjection.understandingContext.professionalGuidance),
  true,
  "Prompt-eligible guidance arrays must be immutable after authorization."
);
assert.throws(
  () =>
    (blockedProjection.understandingContext!.professionalGuidance as unknown[]).push({
      ...guidance("case-formulation-hypothesis-not-fact"),
      responseMove: "SECRET_MOVE",
    }),
  TypeError,
  "Blocked guidance must not be appendable after projection."
);
assert.throws(
  () =>
    (blockedProjection.understandingContext!.activeHypotheses as unknown[]).push({
      id: "secret-hypothesis",
      hypothesisText: "SECRET_HYPOTHESIS",
    }),
  TypeError,
  "Blocked hypotheses must not be appendable after projection."
);
assert.deepEqual(
  projectPromptEligibleContext({ raw: richRaw, gateDecision: decisionFor() }),
  blockedProjection,
  "Projection must be deterministic."
);
assert.deepEqual(
  blockedProjection.understandingContext?.recentMemories.map((item) => item.id),
  ["recent-fact"],
  "Hypothesis memories must not bypass through recentMemories."
);
assert.deepEqual(blockedProjection.understandingContext?.similarMemories, []);
assert.deepEqual(blockedProjection.understandingContext?.coreEvents, []);
assert.deepEqual(blockedProjection.understandingContext?.activeHypotheses, []);
assert.deepEqual(blockedProjection.understandingContext?.counterEvidence, []);
assert.deepEqual(blockedProjection.trace.unknownMetadataIds.sort(), [
  "missing-gate-metadata",
  "unknown-gate-family",
]);
assert(blockedProjection.trace.withheldIds.includes("cbt-fact-interpretation-separation"));
assert(blockedProjection.trace.withheldIds.includes("case-formulation-hypothesis-not-fact"));
assert(blockedProjection.trace.withheldIds.includes("crisis-switch-safety-mode"));
assert(blockedProjection.trace.injectedIds.includes("helping-skills-before-advice"));

const projectedBoundary = blockedProjection.understandingContext?.professionalGuidance.find(
  (item) => item.id === "helping-skills-before-advice"
);
assert(projectedBoundary, "A baseline negative boundary should be projected.");
assertNoOwn(projectedBoundary, "principle", "Baseline boundary must omit principle.");
assertNoOwn(projectedBoundary, "applyWhen", "Baseline boundary must omit applyWhen.");
assertNoOwn(projectedBoundary, "responseMove", "Baseline boundary must omit responseMove.");
assert.deepEqual(projectedBoundary.avoid, guidance("helping-skills-before-advice").avoid);

const cbtLowProjection = projectPromptEligibleContext({
  raw: richRaw,
  gateDecision: decisionFor({
    allowedFamilies: ["cbt"],
    maxIntensity: "low",
  }),
});
assert(
  cbtLowProjection.trace.withheldIds.includes("cbt-fact-interpretation-separation"),
  "Matching family with insufficient intensity must remain withheld."
);

const cbtModerateProjection = projectPromptEligibleContext({
  raw: richRaw,
  gateDecision: decisionFor({
    allowedFamilies: ["cbt"],
    maxIntensity: "moderate",
  }),
});
assert(
  cbtModerateProjection.trace.injectedIds.includes("cbt-fact-interpretation-separation"),
  "Matching family and intensity must inject the intervention card."
);
assert.deepEqual(
  cbtModerateProjection.understandingContext?.activeHypotheses,
  [],
  "CBT consent must not authorize active case-formulation hypotheses."
);
assert.deepEqual(
  cbtModerateProjection.understandingContext?.counterEvidence.map((item) => item.id),
  ["counter-experience"],
  "CBT may receive counter evidence, but hypothesis-kind items must still be filtered."
);

const caseFormulationDecision = decisionFor({
  allowedFamilies: ["case_formulation"],
  maxIntensity: "high",
});
const caseFormulationProjection = projectPromptEligibleContext({
  raw: richRaw,
  gateDecision: caseFormulationDecision,
});
assert(
  caseFormulationProjection.trace.injectedIds.includes("case-formulation-hypothesis-not-fact")
);
assert.deepEqual(
  caseFormulationProjection.understandingContext?.activeHypotheses.map((item) => item.id),
  ["active-hypothesis"]
);
assert.deepEqual(
  caseFormulationProjection.understandingContext?.recentMemories.map((item) => item.id),
  ["recent-fact", "recent-hypothesis"]
);
assert.deepEqual(
  caseFormulationProjection.understandingContext?.counterEvidence.map((item) => item.id),
  ["counter-experience", "counter-hypothesis"]
);
assert.notEqual(
  caseFormulationProjection.understandingContext?.activeHypotheses[0],
  richRaw.activeHypotheses[0],
  "Projected hypothesis objects must be cloned."
);

const staleAuthorizationDecision = decisionFor({
  allowedFamilies: ["case_formulation"],
  maxIntensity: "high",
});
const staleAuthorizationProjection = projectPromptEligibleContext({
  raw: richRaw,
  gateDecision: staleAuthorizationDecision,
});
assert(
  staleAuthorizationProjection.trace.injectedIds.includes(
    "case-formulation-hypothesis-not-fact"
  )
);
staleAuthorizationDecision.interventionReadiness = "blocked";
staleAuthorizationDecision.maxInterventionIntensity = "none";
staleAuthorizationDecision.allowedInterventionFamilies = [];
staleAuthorizationDecision.blockedInterventionFamilies = [
  ...PERSON_CENTERED_INTERVENTION_FAMILIES,
];
const staleAuthorizationContext = buildContext({
  input: "最近总是提不起劲。",
  rawContext: richRaw,
});
const staleAuthorizationPlan = createClinicalPlan(
  staleAuthorizationContext,
  staleAuthorizationDecision
);
assert.throws(
  () =>
    buildChatPrompt({
      userMessage: "最近总是提不起劲。",
      recentMessages: [],
      gatedUnderstandingContext:
        staleAuthorizationProjection.understandingContext,
      personCenteredGateDecision: staleAuthorizationDecision,
      clinicalPlan: staleAuthorizationPlan,
    }),
  /was not projected for the active Person-Centered Gate decision/,
  "Mutating an authorizing decision must invalidate its earlier permissive projection."
);

const structuredAlignedEvidence: PersonCenteredGateEvidence = {
  interactionStage: "intervention_requested",
  understandingEvidence: {
    status: "aligned",
    scope: "relevant_facts",
    basis: ["current_explicit_content", "clear_current_request"],
  },
  unresolvedCorrectionOrBoundary: { present: false, kind: null },
  interventionConsent: {
    status: "explicit_scoped",
    scope: ["case_formulation"],
    requestRisk: "interpretive_or_high_impact",
    basis: ["current_explicit_request"],
  },
};
const structuredReadyDecision = evaluatePersonCenteredInterventionGate(
  structuredAlignedEvidence
);
const structuredReadyContext = buildContext({
  input: "帮我分析为什么我每次都这样。",
  rawContext: richRaw,
});
const structuredReadyProjection = projectPromptEligibleContext({
  raw: richRaw,
  gateDecision: structuredReadyDecision,
});
const structuredReadyPlan = createClinicalPlan(
  structuredReadyContext,
  structuredReadyDecision
);
assert.equal(structuredReadyDecision.interventionReadiness, "ready");
assert.deepEqual(structuredReadyDecision.allowedInterventionFamilies, ["case_formulation"]);
assert(
  structuredReadyProjection.trace.injectedIds.includes("case-formulation-hypothesis-not-fact"),
  "A structured aligned decision must authorize its matching case-formulation card."
);
assert.deepEqual(
  structuredReadyProjection.understandingContext?.activeHypotheses.map((item) => item.id),
  ["active-hypothesis"],
  "A structured ready case-formulation decision must authorize active hypotheses."
);
assert.doesNotThrow(() =>
  buildChatPrompt({
    userMessage: "帮我分析为什么我每次都这样。",
    recentMessages: [],
    gatedUnderstandingContext: structuredReadyProjection.understandingContext,
    personCenteredGateDecision: structuredReadyDecision,
    clinicalPlan: structuredReadyPlan,
  })
);

assert.equal(
  projectPromptEligibleContext({ raw: null, gateDecision: decisionFor() }).understandingContext,
  null,
  "Guest/no-RAG projection must remain null."
);

const parityInput = "最近总是提不起劲。";
const guestLikeContext = buildContext({
  input: parityInput,
  rawContext: null,
});
const loginLikeContext = buildContext({
  input: parityInput,
  rawContext: richRaw,
});
assert(guestLikeContext.personCenteredEvidence && loginLikeContext.personCenteredEvidence);
const guestLikeDecision = evaluatePersonCenteredInterventionGate(
  guestLikeContext.personCenteredEvidence
);
const loginLikeDecision = evaluatePersonCenteredInterventionGate(
  loginLikeContext.personCenteredEvidence
);
assert.deepEqual(
  loginLikeDecision,
  guestLikeDecision,
  "Login-only Memory/RAG data must not change Gate consent or readiness."
);
assert.deepEqual(
  createClinicalPlan(loginLikeContext, loginLikeDecision).personCenteredGate,
  createClinicalPlan(guestLikeContext, guestLikeDecision).personCenteredGate,
  "Login and Guest must produce the same Gate snapshot for the same visible input/history."
);
const guestLikeProjection = projectPromptEligibleContext({
  raw: null,
  gateDecision: guestLikeDecision,
});
const loginLikeProjection = projectPromptEligibleContext({
  raw: richRaw,
  gateDecision: loginLikeDecision,
});
assert.deepEqual(guestLikeProjection.trace.retrievedIds, []);
assert(loginLikeProjection.trace.retrievedIds.length > 0);
assert.deepEqual(
  {
    consent: loginLikeContext.personCenteredEvidence.interventionConsent,
    readiness: loginLikeDecision.interventionReadiness,
  },
  {
    consent: guestLikeContext.personCenteredEvidence.interventionConsent,
    readiness: guestLikeDecision.interventionReadiness,
  },
  "RAG may change only projection IDs, never Gate consent/readiness."
);

// ---------------------------------------------------------------------------
// Prompt boundary: typed raw rejection, final developer carrier, no internals.
// ---------------------------------------------------------------------------

const promptActual = evaluateInput({ input: "给我一个现在能做的第一步。" });
const promptMemory: AiMemoryContext = {
  source: "chat",
  layer: "user_confirmed_memory",
  trust: "user_confirmed",
  text: "用户确认过的上下文。",
};
const promptVoice: AiVoiceConstraints = {
  source: "voice_layer_v1",
  styleDirectives: ["简短"],
  rhythm: ["一句"],
  prohibitedExpressions: ["固定句式"],
  questionDirectives: ["不强迫解释"],
};

for (const clinicalPlanPromptEnabled of ["false", "true"] as const) {
  await withEnvironment(
    { CLINICAL_PLAN_PROMPT_ENABLED: clinicalPlanPromptEnabled },
    () => {
      const prompt = buildChatPrompt({
        userMessage: "给我一个现在能做的第一步。",
        recentMessages: [
          { role: "user", content: "事情有点乱。" },
          { role: "assistant", content: "可以先看最紧要的部分。" },
        ],
        memoryContext: promptMemory,
        gatedUnderstandingContext:
          promptActual.projection.understandingContext,
        personCenteredGateDecision: promptActual.decision,
        voiceConstraints: promptVoice,
        clinicalPlan: promptActual.plan,
      });
      const boundaryIndexes = prompt.messages.flatMap((message, index) =>
        message.content.includes("【Person-Centered Intervention Boundary】") ? [index] : []
      );
      assert.deepEqual(boundaryIndexes, [boundaryIndexes[0]], "There must be exactly one Gate boundary.");
      assert.equal(boundaryIndexes.length, 1, "There must be exactly one Gate boundary.");
      const boundaryIndex = boundaryIndexes[0]!;
      const lastDeveloperIndex = prompt.messages.reduce(
        (latest, message, index) => (message.role === "developer" ? index : latest),
        -1
      );
      assert.equal(
        boundaryIndex,
        lastDeveloperIndex,
        "The Gate boundary must be the final developer carrier."
      );
      assert(
        prompt.messages.slice(boundaryIndex + 1).every((message) => message.role !== "developer"),
        "Only history and current user message may follow the Gate boundary."
      );
      assert.equal(prompt.messages.at(-1)?.role, "user");
    }
  );
}

const renderedBoundary = formatPersonCenteredGateBoundary({
  gateDecision: promptActual.decision,
  selectedResponseGoal: promptActual.plan.responseGoal,
});
for (const forbidden of [
  "eligibilityReason",
  "blockedInterventionFamilies",
  "withheldIds",
  "effectiveStage",
  "interactionStage",
  "我听到",
  "我接住",
  "我理解",
] as const) {
  assert(
    !renderedBoundary.includes(forbidden),
    `Gate prompt boundary must not expose or template: ${forbidden}`
  );
}

const unsafePromptCall = buildChatPrompt as (input: Record<string, unknown>) => unknown;
assert.throws(
  () =>
    unsafePromptCall({
      userMessage: "给我一个现在能做的第一步。",
      recentMessages: [],
      understandingContext: richRaw,
      gatedUnderstandingContext: promptActual.projection.understandingContext,
      personCenteredGateDecision: promptActual.decision,
      clinicalPlan: promptActual.plan,
    }),
  /Raw StructuredRagContext cannot enter a gate-enabled prompt/,
  "Raw StructuredRagContext must fail closed on a gate-enabled prompt."
);
assert.throws(
  () =>
    unsafePromptCall({
      userMessage: "给我一个现在能做的第一步。",
      recentMessages: [],
      gatedUnderstandingContext: {
        ...(promptActual.projection.understandingContext as GatedStructuredRagContext),
        gateApplied: false,
      },
      personCenteredGateDecision: promptActual.decision,
      clinicalPlan: promptActual.plan,
    }),
  /was not projected for the active Person-Centered Gate decision/,
  "A malformed gated context must fail closed."
);

assert.throws(
  () =>
    unsafePromptCall({
      userMessage: "最近总是提不起劲。",
      recentMessages: [],
      gatedUnderstandingContext: {
        ...(caseFormulationProjection.understandingContext as GatedStructuredRagContext),
      },
      personCenteredGateDecision: caseFormulationDecision,
      clinicalPlan: createClinicalPlan(
        buildContext({ input: "最近总是提不起劲。", rawContext: richRaw }),
        caseFormulationDecision
      ),
    }),
  /was not projected for the active Person-Centered Gate decision/,
  "A copied raw context must not forge the module-private projection provenance."
);

const blockedPromptContext = buildContext({
  input: "最近总是提不起劲。",
  rawContext: richRaw,
});
const blockedPromptDecision = blockedProjectionDecision;
const blockedPromptPlan = createClinicalPlan(
  blockedPromptContext,
  blockedPromptDecision
);
assert.throws(
  () =>
    buildChatPrompt({
      userMessage: "最近总是提不起劲。",
      recentMessages: [],
      gatedUnderstandingContext: caseFormulationProjection.understandingContext,
      personCenteredGateDecision: blockedPromptDecision,
      clinicalPlan: blockedPromptPlan,
    }),
  /was not projected for the active Person-Centered Gate decision/,
  "A projection authorized by a different Gate decision must fail closed."
);

const mismatchedPromptPlan = {
  ...promptActual.plan,
  personCenteredGate: {
    ...promptActual.plan.personCenteredGate!,
    allowedFamilies: ["case_formulation"] as const,
  },
};
assert.throws(
  () =>
    buildChatPrompt({
      userMessage: "给我一个现在能做的第一步。",
      recentMessages: [],
      gatedUnderstandingContext: promptActual.projection.understandingContext,
      personCenteredGateDecision: promptActual.decision,
      clinicalPlan: mismatchedPromptPlan,
    }),
  /ClinicalPlan does not match the active Person-Centered Gate decision/,
  "A mismatched ClinicalPlan snapshot must fail closed."
);

const blockedPrompt = buildChatPrompt({
  userMessage: "最近总是提不起劲。",
  recentMessages: [],
  gatedUnderstandingContext: blockedProjection.understandingContext,
  personCenteredGateDecision: blockedPromptDecision,
  clinicalPlan: blockedPromptPlan,
});
const blockedPromptText = blockedPrompt.messages.map((message) => message.content).join("\n");
for (const withheldId of [
  "cbt-fact-interpretation-separation",
  "case-formulation-hypothesis-not-fact",
] as const) {
  assert(
    !blockedPromptText.includes(withheldId),
    `Withheld intervention card ${withheldId} must not reach the prompt.`
  );
}
assert(
  !blockedPromptText.includes(guidance("cbt-fact-interpretation-separation").responseMove),
  "An unqualified intervention responseMove must not reach the prompt."
);

// ResponseGoal consumes only preferred/allowed/fallback from a frozen decision.
const responseGoalContext = buildContext({
  input: "我不知道怎么说",
  includePersonCenteredEvidence: false,
});
assert.equal(
  selectResponseGoal(
    responseGoalContext,
    decisionFor({
      allowedGoals: ["help_continue_expression", "reflect"],
      preferredGoal: null,
      fallbackGoal: "reflect",
    })
  ),
  "help_continue_expression",
  "An allowed legacy candidate must be retained."
);
assert.equal(
  selectResponseGoal(
    responseGoalContext,
    decisionFor({
      allowedGoals: ["hold_space"],
      preferredGoal: "hold_space",
      fallbackGoal: "hold_space",
    })
  ),
  "hold_space",
  "A preferred Gate goal must override the legacy candidate."
);
assert.equal(
  selectResponseGoal(
    responseGoalContext,
    decisionFor({
      allowedGoals: ["reflect"],
      preferredGoal: null,
      fallbackGoal: "reflect",
    })
  ),
  "reflect",
  "A disallowed legacy candidate must fall back mechanically."
);

// ---------------------------------------------------------------------------
// Static architecture: one production evaluator caller and unified entries.
// ---------------------------------------------------------------------------

const walkTs = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? walkTs(path)
      : path.endsWith(".ts") || path.endsWith(".tsx")
        ? [path]
        : [];
  });

const evaluatorProductionCalls = walkTs("services").flatMap((path) => {
  const count = read(path).match(/\bevaluatePersonCenteredInterventionGate\s*\(/g)?.length ?? 0;
  return Array.from({ length: count }, () => relative(".", path));
});
assert.deepEqual(
  evaluatorProductionCalls,
  ["services/ai/chatOrchestrationService.ts"],
  "createChatReply() must be the only production caller of the Gate evaluator."
);

const safetyIndex = orchestrationSource.indexOf("if (isCrisisInput(userMessage))");
const flagReadIndex = orchestrationSource.indexOf(
  "const personCenteredGateEnabled = isPersonCenteredGateV1Enabled()"
);
const clinicalMemoryIndex = orchestrationSource.indexOf(
  "const clinicalMemoryContext = createClinicalMemoryContext(understandingContext)"
);
const contextIndex = orchestrationSource.indexOf("const clinicalContext = buildClinicalContext(");
const gateIndex = orchestrationSource.indexOf("evaluatePersonCenteredInterventionGate(");
const projectionIndex = orchestrationSource.indexOf("projectPromptEligibleContext(");
const planIndex = orchestrationSource.indexOf("createClinicalPlan(", gateIndex);
const generationIndex = orchestrationSource.indexOf("generateChatReply({");
assert(
  [
    safetyIndex,
    flagReadIndex,
    clinicalMemoryIndex,
    contextIndex,
    gateIndex,
    projectionIndex,
    planIndex,
    generationIndex,
  ].every(
    (index) => index >= 0
  ),
  "The orchestration must contain every Gate pipeline stage."
);
assert(
  safetyIndex < contextIndex &&
    safetyIndex < flagReadIndex &&
    flagReadIndex < clinicalMemoryIndex &&
    clinicalMemoryIndex < contextIndex &&
    contextIndex < gateIndex &&
    gateIndex < projectionIndex &&
    projectionIndex < planIndex &&
    planIndex < generationIndex,
  "Required order is Safety -> ClinicalContext -> Gate -> RAG projection -> Plan -> Prompt/LLM."
);

const gateDomainSource = read("services/clinical/personCenteredInterventionGate.ts");
const projectionSource = read(
  "services/professional-rag/professionalGuidanceGateProjection.ts"
);
for (const source of [gateDomainSource, projectionSource]) {
  assert(
    !source.includes("PERSON_CENTERED_GATE_V1_ENABLED"),
    "Only orchestration may read the feature flag."
  );
}
assert(
  !projectionSource.includes("evaluatePersonCenteredInterventionGate"),
  "RAG projection must consume the decision and never re-run the evaluator."
);

const loginServiceSource = read("services/ai/chatReplyService.ts");
const guestRouteSource = read("app/api/chat/guest/route.ts");
const loginRouteSource = read("app/api/chat/sessions/[sessionId]/messages/route.ts");
assert(loginServiceSource.includes("createChatReply({"));
assert(guestRouteSource.includes("createChatReply({"));
for (const [label, source] of [
  ["logged-in persistence service", loginServiceSource],
  ["guest route", guestRouteSource],
  ["logged-in route", loginRouteSource],
] as const) {
  assert(!source.includes("evaluatePersonCenteredInterventionGate("), `${label} must not call Gate directly.`);
  assert(!source.includes("projectPromptEligibleContext("), `${label} must not project RAG directly.`);
}

const selectorAndPlanSources = [
  read("services/clinical/responseGoalSelector.ts"),
  read("services/clinical/clinicalStrategySelector.ts"),
  read("services/clinical/clinicalPlanService.ts"),
  read("services/ai/promptBuilder.ts"),
];
for (const source of selectorAndPlanSources) {
  assert(
    !source.includes("interventionConsent.status") &&
      !source.includes("understandingEvidence.status"),
    "Downstream Gate consumers must not recalculate consent or readiness."
  );
}

const packageJson = JSON.parse(read("package.json")) as {
  scripts?: Record<string, string>;
};
assert.equal(
  packageJson.scripts?.["check:person-centered-gate"],
  "tsx scripts/person-centered-intervention-gate-check.ts",
  "package.json must expose the requested check:person-centered-gate command."
);
assert(
  packageJson.scripts?.["check:launch"]?.includes(
    "npm run check:person-centered-gate"
  ),
  "check:launch must execute the Person-Centered Gate regression suite."
);

console.log(
  JSON.stringify(
    {
      check: "person-centered-gate-v1",
      status: "passed",
      frozenTraceCount: actualFrozenTraceSummary.length,
      counterexampleCount: counterexamples.length + 1,
      selfReviewCounterexampleCount: selfReviewCounterexamples.length,
      frozenTraces: actualFrozenTraceSummary,
    },
    null,
    2
  )
);
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
