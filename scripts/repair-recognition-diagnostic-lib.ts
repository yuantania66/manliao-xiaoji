import { createHash } from "node:crypto";

// Diagnostic-only projection of the repair-recognition chain. Must stay runnable against older
// product revisions, so product objects are read structurally instead of through current types.
type UnknownRecord = Record<string, unknown>;

export const DIAGNOSTIC_VERSION = "repair-recognition-diagnostic-v1";

export type DiagnosticGroup =
  | "affected_repair"
  | "passing_repair_control"
  | "non_repair_control"
  | "trajectory_meta_repair";

type DiagnosticCommittedMove = {
  purpose: string[];
  claims: [];
  assumptions: [];
  questionOrRequest: null;
  expectedUserContribution: "none";
  userBurden: "none";
  sourceTurnId: string;
  evidence: string[];
};

export type DiagnosticScenario = {
  id: string;
  group: DiagnosticGroup;
  userMessage: string;
  recentMessages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    committedAssistantMove?: DiagnosticCommittedMove;
  }>;
};

export type HistoryShape = "fixture" | "committed_claimless";

export const AFFECTED_REPAIR_IDS = [
  "repair-advice-boundary",
  "repair-intensity-exaggeration",
  "repair-wrong-person",
  "repair-question-pressure",
  "repair-generic-listening",
  "repair-repeated-claim",
  "repair-direct-relationship-challenge",
  "repair-moralizing",
] as const;
export const PASSING_REPAIR_CONTROL_IDS = ["repair-unsupported-fear", "repair-topic-switch"] as const;
export const NON_REPAIR_CONTROL_IDS = ["emotion-mild-unhappy", "emotion-lonely"] as const;
export const TRAJECTORY_REPAIR_OBS = {
  id: "TRJ-REPAIR-OBS-001:t1",
  userMessage: "你一点都不懂我",
} as const;
export const RUNS_PER_SCENARIO = 3;
// Fix verification: scenarios whose repair was rejected only for an uncommitted target claim,
// plus the repair controls, with history carrying the committed move production records.
export const CLAIMLESS_VERIFICATION_IDS = [
  "repair-intensity-exaggeration",
  "repair-wrong-person",
  "repair-repeated-claim",
  "repair-direct-relationship-challenge",
  "repair-moralizing",
  ...PASSING_REPAIR_CONTROL_IDS,
] as const;
const UNVERIFIABLE_CLAIM_DROPPED_EVIDENCE_FRAGMENT = "unverifiable target claim text was dropped";

const REPAIR_CONFIDENCE_THRESHOLD = 0.93;
const ACCEPTANCE_MARKER = "repair-recognition-diagnostic:acceptance-marker";
const RELATION_TOKENS = new Set([
  "requests_answer", "answers_previous_move", "repairs_previous_move", "challenges_move_fit",
  "rejects_or_declines_move", "continues_active_thread", "opens_new_thread", "yields_initiative",
  "shares_initiative", "requests_pause", "requests_action_support", "shares_distress",
  "acknowledges_previous_move", "reciprocates_move", "unclear",
]);
const OPERATION_TOKENS = new Set(["explain", "answer", "affirm", "repair_or_withdraw"]);
const DIALOGUE_ACT_TOKENS = new Set([
  "share", "answer", "ask_information", "ask_identity", "ask_capability", "ask_definition",
  "challenge_contradiction", "correct_assistant", "yield_initiative", "request_pause",
  "end_conversation", "seek_emotional_support", "request_action_support", "acknowledge",
]);

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const token = (value: unknown, allowed: Set<string>) =>
  typeof value === "string" ? allowed.has(value) ? value : "unrecognized" : "absent";

export const scenarioInputFingerprint = (scenario: DiagnosticScenario) =>
  `sha256:${createHash("sha256")
    .update(JSON.stringify({ userMessage: scenario.userMessage, recentMessages: scenario.recentMessages }))
    .digest("hex")
    .slice(0, 16)}`;

export const buildDiagnosticScenarios = (preservationScenarios: unknown[]): DiagnosticScenario[] => {
  const byId = new Map(preservationScenarios.map((item) => {
    const record = asRecord(item);
    return [String(record?.id ?? ""), record] as const;
  }));
  const pick = (id: string, group: DiagnosticGroup): DiagnosticScenario => {
    const record = byId.get(id);
    if (!record) throw new Error(`Missing preservation scenario ${id}.`);
    return {
      id,
      group,
      userMessage: String(record.userMessage),
      recentMessages: asArray(record.recentMessages).map((message) => {
        const value = asRecord(message) ?? {};
        return {
          id: String(value.id),
          role: value.role === "assistant" ? "assistant" : "user",
          content: String(value.content),
        };
      }),
    };
  };
  return [
    ...AFFECTED_REPAIR_IDS.map((id) => pick(id, "affected_repair")),
    ...PASSING_REPAIR_CONTROL_IDS.map((id) => pick(id, "passing_repair_control")),
    ...NON_REPAIR_CONTROL_IDS.map((id) => pick(id, "non_repair_control")),
    {
      id: TRAJECTORY_REPAIR_OBS.id,
      group: "trajectory_meta_repair",
      userMessage: TRAJECTORY_REPAIR_OBS.userMessage,
      recentMessages: [],
    },
  ];
};

// Attaches the claimless committed move an ordinary validated reply records (no selected memory,
// no required disclosure); the frozen fixture itself is not modified.
export const withCommittedClaimlessHistory = (scenario: DiagnosticScenario): DiagnosticScenario => ({
  ...scenario,
  recentMessages: scenario.recentMessages.map((message, index) => {
    if (message.role !== "assistant") return message;
    const sourceTurnId = scenario.recentMessages
      .slice(0, index)
      .reverse()
      .find((item) => item.role === "user")?.id ?? `${message.id}:source`;
    return {
      ...message,
      committedAssistantMove: {
        purpose: [],
        claims: [],
        assumptions: [],
        questionOrRequest: null,
        expectedUserContribution: "none",
        userBurden: "none",
        sourceTurnId,
        evidence: ["repair-recognition-diagnostic:committed-claimless-history"],
      },
    };
  }),
});

export const buildClaimlessVerificationScenarios = (preservationScenarios: unknown[]) => {
  const scenarios = buildDiagnosticScenarios(preservationScenarios);
  return CLAIMLESS_VERIFICATION_IDS.map((id) => {
    const scenario = scenarios.find((item) => item.id === id);
    if (!scenario) throw new Error(`Missing verification scenario ${id}.`);
    return withCommittedClaimlessHistory(scenario);
  });
};

// Mirrors the private extractor in services/ai/turnInterpretationAdapter.ts (identical at the
// sealed and candidate revisions) so raw candidates are parsed exactly as the product parses them.
export const extractModelObject = (text: string | undefined): UnknownRecord | null => {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return asRecord(JSON.parse(fenced.slice(start, end + 1)));
  } catch {
    return null;
  }
};

type AdjacentTurn = { id: string | null; role: string; content: string; committedClaims: string[] };

const adjacentTurnsOf = (context: UnknownRecord | null): AdjacentTurn[] =>
  asArray(context?.adjacentTurns).map((item) => {
    const turn = asRecord(item) ?? {};
    const committed = asRecord(turn.committedAssistantMove);
    return {
      id: typeof turn.id === "string" ? turn.id : null,
      role: String(turn.role ?? "unknown"),
      content: String(turn.content ?? ""),
      committedClaims: asArray(committed?.claims)
        .map((claim) => String(asRecord(claim)?.text ?? ""))
        .filter(Boolean),
    };
  });

export type TargetClass =
  | "absent"
  | "legal_assistant_turn"
  | "user_turn"
  | "current_turn"
  | "unknown_id";

export const classifyTargetId = (
  targetTurnId: unknown,
  context: UnknownRecord | null
): TargetClass => {
  if (typeof targetTurnId !== "string" || !targetTurnId) return "absent";
  if (targetTurnId === context?.currentTurnId) return "current_turn";
  const turn = adjacentTurnsOf(context).find((item) => item.id === targetTurnId);
  if (!turn) return "unknown_id";
  return turn.role === "assistant" ? "legal_assistant_turn" : "user_turn";
};

export const legalTargetsOf = (context: UnknownRecord | null) => {
  const turns = adjacentTurnsOf(context);
  const handoff = asRecord(context?.interactionMoveHandoffTarget);
  return {
    assistantTurnIds: turns.filter((turn) => turn.role === "assistant").map((turn) => turn.id ?? "null"),
    userTurnIds: turns.filter((turn) => turn.role === "user").map((turn) => turn.id ?? "null"),
    assistantTurnsWithCommittedClaims: turns
      .filter((turn) => turn.role === "assistant" && turn.committedClaims.length > 0)
      .map((turn) => turn.id ?? "null"),
    activeHandoffTargetId: typeof handoff?.sourceAssistantMoveId === "string"
      ? handoff.sourceAssistantMoveId
      : null,
  };
};

export type RawCandidateProjection = {
  relation: string;
  confidence: number | null;
  meetsRepairThreshold: boolean;
  target: TargetClass;
  targetTurnId: string | null;
  targetOperation: string;
  targetPropositionSupplied: boolean;
  targetPropositionMatchesCommittedClaim: boolean;
  targetPropositionEqualsTargetTurnText: boolean;
  acceptedBySideMerge: boolean;
  claimDroppedAsUnverifiable: boolean;
  rejectionReason: string;
};

type MergeFn = (deterministic: unknown, model: unknown, context?: unknown) => unknown;

const candidatesOf = (interpretation: unknown) =>
  asArray(asRecord(asRecord(interpretation)?.responseRelation)?.candidates).map((item) => asRecord(item) ?? {});

// Acceptance is decided by the side's own mergeModelInterpretation with the candidate alone; the
// reason label is a best-effort mirror of the candidate revision's filter order and is only
// reported for candidates the side's code actually rejected.
const rejectionReasonMirror = (raw: UnknownRecord, context: UnknownRecord | null) => {
  const relation = raw.relation;
  if (typeof relation !== "string" || !RELATION_TOKENS.has(relation)) return "relation_not_allowed";
  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
  if (confidence < 0.55) return "confidence_below_0_55";
  const target = typeof raw.targetTurnId === "string" ? raw.targetTurnId : undefined;
  const legal = legalTargetsOf(context);
  if (legal.activeHandoffTargetId && target !== legal.activeHandoffTargetId) return "handoff_target_mismatch";
  const turns = adjacentTurnsOf(context);
  const claims = turns.find((turn) => turn.id === target)?.committedClaims ?? [];
  const proposition = typeof raw.targetProposition === "string" ? raw.targetProposition : undefined;
  const operation = typeof raw.targetOperation === "string" && OPERATION_TOKENS.has(raw.targetOperation)
    ? raw.targetOperation
    : undefined;
  const claimTargeting = relation === "requests_answer" || relation === "repairs_previous_move";
  const claimAuthorityTargets = legal.assistantTurnsWithCommittedClaims;
  if (claimTargeting && claimAuthorityTargets.length > 0 && !claimAuthorityTargets.includes(target ?? "")) {
    return "claim_target_not_committed_claim_turn";
  }
  if (Boolean(proposition) !== Boolean(operation)) return "target_proposition_operation_incomplete";
  if (proposition && !claims.includes(proposition)) return "target_proposition_not_committed_claim";
  if (operation === "repair_or_withdraw" && relation !== "repairs_previous_move") return "operation_relation_mismatch";
  if (operation === "affirm" && relation !== "continues_active_thread" && relation !== "acknowledges_previous_move") {
    return "operation_relation_mismatch";
  }
  if ((operation === "explain" || operation === "answer") && relation !== "requests_answer") {
    return "operation_relation_mismatch";
  }
  return "unclassified_by_mirror";
};

export const projectRawCandidates = ({
  rawOutput,
  context,
  deterministic,
  merge,
}: {
  rawOutput: string | undefined;
  context: UnknownRecord | null;
  deterministic: unknown;
  merge: MergeFn;
}) => {
  const model = extractModelObject(rawOutput);
  const rawCandidates = asArray(asRecord(model?.responseRelation)?.candidates).map((item) => asRecord(item) ?? {});
  const turns = adjacentTurnsOf(context);
  const projections: RawCandidateProjection[] = rawCandidates.map((raw) => {
    const relation = token(raw.relation, RELATION_TOKENS);
    const confidence = typeof raw.confidence === "number" ? raw.confidence : null;
    const targetTurnId = typeof raw.targetTurnId === "string" ? raw.targetTurnId : null;
    const targetTurn = turns.find((turn) => turn.id === targetTurnId);
    const proposition = typeof raw.targetProposition === "string" ? raw.targetProposition : null;
    const merged = merge(
      deterministic,
      { responseRelation: { candidates: [{ ...raw, evidence: [ACCEPTANCE_MARKER] }] } },
      context ?? undefined
    );
    const survivor = candidatesOf(merged).find((item) =>
      asArray(item.evidence).includes(ACCEPTANCE_MARKER)
    );
    const markerSurvived = Boolean(survivor);
    const claimDroppedAsUnverifiable = asArray(survivor?.evidence).some((item) =>
      typeof item === "string" && item.includes(UNVERIFIABLE_CLAIM_DROPPED_EVIDENCE_FRAGMENT)
    );
    const absorbedByDeterministic = !markerSurvived && candidatesOf(deterministic).some((item) =>
      item.relation === raw.relation && (item.targetTurnId ?? null) === targetTurnId
    );
    const accepted = markerSurvived || absorbedByDeterministic;
    return {
      relation,
      confidence,
      meetsRepairThreshold: (confidence ?? 0) >= REPAIR_CONFIDENCE_THRESHOLD,
      target: classifyTargetId(targetTurnId, context),
      targetTurnId: targetTurn ? targetTurnId : targetTurnId ? "not_in_context" : null,
      targetOperation: token(raw.targetOperation, OPERATION_TOKENS),
      targetPropositionSupplied: Boolean(proposition),
      targetPropositionMatchesCommittedClaim: Boolean(
        proposition && targetTurn?.committedClaims.includes(proposition)
      ),
      targetPropositionEqualsTargetTurnText: Boolean(proposition && targetTurn?.content === proposition),
      acceptedBySideMerge: accepted,
      claimDroppedAsUnverifiable,
      rejectionReason: absorbedByDeterministic
        ? "absorbed_by_deterministic_candidate"
        : accepted ? "none" : rejectionReasonMirror(raw, context),
    };
  });
  return {
    parsed: model !== null,
    primaryDialogueAct: token(model?.primaryDialogueAct, DIALOGUE_ACT_TOKENS),
    candidates: projections,
  };
};

export type ProbeName =
  | "repair_legal_assistant_target"
  | "repair_legal_target_with_uncommitted_proposition"
  | "repair_user_turn_target"
  | "repair_absent_target"
  | "repair_legal_target_below_threshold"
  | "non_repair_continues_thread"
  | "challenges_move_fit_legal_target";

export const runDeterministicProbes = ({
  context,
  deterministic,
  merge,
}: {
  context: UnknownRecord | null;
  deterministic: unknown;
  merge: MergeFn;
}): Record<ProbeName, { repairProposal: boolean; repairTarget: TargetClass }> | null => {
  const turns = adjacentTurnsOf(context);
  const assistant = [...turns].reverse().find((turn) => turn.role === "assistant");
  const user = [...turns].reverse().find((turn) => turn.role === "user");
  if (!assistant?.id) return null;
  const probe = (candidate: UnknownRecord) => {
    const merged = asRecord(merge(
      deterministic,
      { confidence: 0.95, responseRelation: { candidates: [{ evidence: ["diagnostic probe"], ...candidate }] } },
      context ?? undefined
    ));
    const proposal = asRecord(asRecord(merged?.stateUpdate)?.repairProposal);
    return {
      repairProposal: Boolean(proposal),
      repairTarget: classifyTargetId(proposal?.targetTurnId, context),
    };
  };
  return {
    repair_legal_assistant_target: probe({ relation: "repairs_previous_move", confidence: 0.95, targetTurnId: assistant.id }),
    repair_legal_target_with_uncommitted_proposition: probe({
      relation: "repairs_previous_move",
      confidence: 0.95,
      targetTurnId: assistant.id,
      targetProposition: assistant.content,
      targetOperation: "repair_or_withdraw",
    }),
    repair_user_turn_target: probe({ relation: "repairs_previous_move", confidence: 0.95, targetTurnId: user?.id ?? "missing-user-turn" }),
    repair_absent_target: probe({ relation: "repairs_previous_move", confidence: 0.95 }),
    repair_legal_target_below_threshold: probe({ relation: "repairs_previous_move", confidence: 0.9, targetTurnId: assistant.id }),
    non_repair_continues_thread: probe({ relation: "continues_active_thread", confidence: 0.95, targetTurnId: assistant.id }),
    challenges_move_fit_legal_target: probe({ relation: "challenges_move_fit", confidence: 0.95, targetTurnId: assistant.id }),
  };
};

const hasActivity = (dialogueState: UnknownRecord | null, activity: string) => {
  const current = asRecord(dialogueState?.currentActivity);
  return current?.primary === activity || asArray(current?.concurrent).includes(activity);
};

export const sanitizeReasonTokens = (values: unknown[]) =>
  values.map((value) => {
    const text = String(value ?? "");
    return /^[a-z0-9_:.\-]{1,120}$/u.test(text) ? text : "unrecognized";
  });

export type RepairStage =
  | "model_not_called"
  | "model_unavailable"
  | "deterministic_repair"
  | "model_not_proposed"
  | "proposed_rejected_by_validation"
  | "accepted_below_threshold"
  | "accepted_target_unresolved"
  | "accepted_state_not_adopted"
  | "state_adopted_plan_not_adopted"
  | "repair_planned";

export type DiagnosticCell = {
  scenarioId: string;
  group: DiagnosticGroup;
  runIndex: number;
  inputFingerprint: string;
  currentTurnId: string;
  legalTargets: ReturnType<typeof legalTargetsOf>;
  interpretationModel: { attempted: boolean; used: boolean; errored: boolean };
  deterministic: { repairSignal: boolean; repairProposal: boolean };
  rawModel: ReturnType<typeof projectRawCandidates>;
  finalInterpretation: {
    candidates: Array<{ relation: string; confidence: number | null; target: TargetClass }>;
    repairProposal: boolean;
    repairTarget: TargetClass;
  };
  dialogueState: { primaryActivity: string; repairingCommonGround: boolean };
  plan: {
    present: boolean;
    responseActions: string[];
    questionPolicy: string;
    interactionMoveHandoff: boolean;
    positiveFunction: string;
  };
  execution: {
    phase: string;
    finalSource: string;
    failureCode: string;
    failureReasonTokens: string[];
    preflightFailures: string[];
    validationFailures: string[];
  };
  stage: RepairStage;
  probes: ReturnType<typeof runDeterministicProbes>;
};

export const classifyRepairStage = (cell: Omit<DiagnosticCell, "stage" | "probes">): RepairStage => {
  if (cell.deterministic.repairProposal) {
    return cell.plan.responseActions.includes("repair_previous_wording")
      ? "repair_planned"
      : cell.dialogueState.repairingCommonGround
        ? "state_adopted_plan_not_adopted"
        : "deterministic_repair";
  }
  if (!cell.interpretationModel.attempted) return "model_not_called";
  if (cell.interpretationModel.errored || !cell.rawModel.parsed) return "model_unavailable";
  const proposed = cell.rawModel.candidates.filter((candidate) => candidate.relation === "repairs_previous_move");
  if (proposed.length === 0) return "model_not_proposed";
  const accepted = proposed.filter((candidate) => candidate.acceptedBySideMerge);
  if (accepted.length === 0) return "proposed_rejected_by_validation";
  if (!accepted.some((candidate) => candidate.meetsRepairThreshold)) return "accepted_below_threshold";
  if (!cell.finalInterpretation.repairProposal) return "accepted_target_unresolved";
  if (!cell.dialogueState.repairingCommonGround) return "accepted_state_not_adopted";
  if (!cell.plan.responseActions.includes("repair_previous_wording")) return "state_adopted_plan_not_adopted";
  return "repair_planned";
};

export const projectDiagnosticCell = ({
  scenario,
  runIndex,
  currentTurnId,
  reply,
  interpretDeterministically,
  merge,
}: {
  scenario: DiagnosticScenario;
  runIndex: number;
  currentTurnId: string;
  reply: unknown;
  interpretDeterministically: (context: unknown) => unknown;
  merge: MergeFn;
}): DiagnosticCell => {
  const result = asRecord(reply) ?? {};
  const control = asRecord(result.controlTrace);
  const context = asRecord(control?.context);
  const interpretationModel = asRecord(control?.interpretationModel);
  const deterministic = context ? interpretDeterministically(context) : null;
  const deterministicRecord = asRecord(deterministic);
  const finalInterpretation = asRecord(control?.interpretation);
  const finalProposal = asRecord(asRecord(finalInterpretation?.stateUpdate)?.repairProposal);
  const dialogueState = asRecord(control?.dialogueState);
  const plan = asRecord(control?.responsePlan);
  const execution = asRecord(result.execution);
  const failure = asRecord(execution?.failure);
  const preflight = asRecord(execution?.planPreflight);
  const lastValidation = asRecord(asArray(control?.validation).at(-1));
  const base: Omit<DiagnosticCell, "stage" | "probes"> = {
    scenarioId: scenario.id,
    group: scenario.group,
    runIndex,
    inputFingerprint: scenarioInputFingerprint(scenario),
    currentTurnId,
    legalTargets: legalTargetsOf(context),
    interpretationModel: {
      attempted: interpretationModel?.attempted === true,
      used: interpretationModel?.used === true,
      errored: typeof interpretationModel?.error === "string",
    },
    deterministic: {
      repairSignal: Boolean(deterministicRecord?.repairSignal),
      repairProposal: Boolean(asRecord(deterministicRecord?.stateUpdate)?.repairProposal),
    },
    rawModel: deterministic
      ? projectRawCandidates({
          rawOutput: typeof interpretationModel?.rawOutput === "string" ? interpretationModel.rawOutput : undefined,
          context,
          deterministic,
          merge,
        })
      : { parsed: false, primaryDialogueAct: "absent", candidates: [] },
    finalInterpretation: {
      candidates: candidatesOf(finalInterpretation).map((candidate) => ({
        relation: token(candidate.relation, RELATION_TOKENS),
        confidence: typeof candidate.confidence === "number" ? candidate.confidence : null,
        target: classifyTargetId(candidate.targetTurnId, context),
      })),
      repairProposal: Boolean(finalProposal),
      repairTarget: classifyTargetId(finalProposal?.targetTurnId, context),
    },
    dialogueState: {
      primaryActivity: String(asRecord(dialogueState?.currentActivity)?.primary ?? "absent"),
      repairingCommonGround: hasActivity(dialogueState, "repairing_common_ground"),
    },
    plan: {
      present: Boolean(plan),
      responseActions: sanitizeReasonTokens(asArray(plan?.responseActions)),
      questionPolicy: String(asRecord(plan?.questionPolicy)?.mode ?? "absent"),
      interactionMoveHandoff: Boolean(plan?.interactionMoveHandoff),
      positiveFunction: String(asRecord(plan?.positiveFunctionContract)?.action ?? "none"),
    },
    execution: {
      phase: String(execution?.phase ?? "absent"),
      finalSource: String(result.finalSource ?? "absent"),
      failureCode: String(failure?.code ?? "none"),
      failureReasonTokens: sanitizeReasonTokens(
        typeof failure?.reason === "string" ? failure.reason.split(/[,\s]+/u).filter(Boolean) : []
      ),
      preflightFailures: sanitizeReasonTokens(asArray(preflight?.failureReasons)),
      validationFailures: sanitizeReasonTokens(asArray(lastValidation?.failureReasons)),
    },
  };
  return {
    ...base,
    stage: classifyRepairStage(base),
    probes: deterministic && runIndex === 1
      ? runDeterministicProbes({ context, deterministic, merge })
      : null,
  };
};

export const summarizeDiagnosticCells = (cells: DiagnosticCell[]) => {
  const byScenario: Record<string, Record<string, number>> = {};
  const stages: Record<string, number> = {};
  for (const cell of cells) {
    byScenario[cell.scenarioId] ??= {};
    byScenario[cell.scenarioId][cell.stage] = (byScenario[cell.scenarioId][cell.stage] ?? 0) + 1;
    stages[cell.stage] = (stages[cell.stage] ?? 0) + 1;
  }
  const rawRelations: Record<string, number> = {};
  const rejectionReasons: Record<string, number> = {};
  let claimDroppedAsUnverifiable = 0;
  for (const candidate of cells.flatMap((cell) => cell.rawModel.candidates)) {
    rawRelations[candidate.relation] = (rawRelations[candidate.relation] ?? 0) + 1;
    if (candidate.claimDroppedAsUnverifiable) claimDroppedAsUnverifiable += 1;
    if (!candidate.acceptedBySideMerge) {
      const key = `${candidate.relation}:${candidate.rejectionReason}`;
      rejectionReasons[key] = (rejectionReasons[key] ?? 0) + 1;
    }
  }
  return {
    cells: cells.length,
    stages,
    byScenario,
    rawRelations,
    rejectionReasons,
    claimDroppedAsUnverifiable,
  };
};
