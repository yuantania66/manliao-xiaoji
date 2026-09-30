import type {
  EmotionalSupportAssessment,
  PlannedFunctionSemanticDiagnostics,
  PlannedFunctionSemanticVerdict,
} from "../services/ai/plannedFunctionSemanticValidator";

const RULE_ID = /\bES-[A-Z]+(?:-[A-Z]+)*\b/gu;

export type SemanticVerdictAudit = {
  status: string | null;
  containsContradictoryMove: boolean | null;
  semanticQuestionCount: number | null;
  // Emotional support: rule ids mapped by the program aggregation table; otherwise ids cited in reasons.
  ruleIds: string[];
  // ES-* ids cited outside an offer_emotional_support positive-function verdict (rule-boundary violation).
  outOfScopeRuleIds: string[];
  emotionalSupportFailures: EmotionalSupportAssessment["failures"] | null;
  emotionalSupportInconsistencies: EmotionalSupportAssessment["inconsistencies"] | null;
  evidence: Array<{ start: number; end: number; text: string; reason: string }>;
} | null;

const ruleIdsIn = (evidence: Array<{ reason: string }>) =>
  Array.from(new Set(evidence.flatMap((span) => span.reason.match(RULE_ID) ?? [])));

export const semanticVerdictAuditFor = (
  verdict: PlannedFunctionSemanticVerdict | null | undefined,
  diagnostics?: PlannedFunctionSemanticDiagnostics | null
): SemanticVerdictAudit => {
  if (!verdict) return null;
  const evidence = verdict.positiveFunction?.evidence ?? [];
  const citedRuleIds = ruleIdsIn(evidence);
  const emotionalSupportVerdict = verdict.positiveFunction?.binding.action === "offer_emotional_support";
  const assessment = emotionalSupportVerdict ? diagnostics?.emotionalSupportAssessment ?? null : null;
  return {
    status: verdict.positiveFunction?.status ?? null,
    containsContradictoryMove: verdict.positiveFunction?.containsContradictoryMove ?? null,
    semanticQuestionCount: verdict.semanticQuestionCount,
    ruleIds: assessment ? assessment.ruleIds : citedRuleIds,
    outOfScopeRuleIds: Array.from(new Set([
      ...(emotionalSupportVerdict ? [] : citedRuleIds),
      ...ruleIdsIn(verdict.handoff?.evidence ?? []),
    ])),
    emotionalSupportFailures: assessment?.failures ?? null,
    emotionalSupportInconsistencies: assessment?.inconsistencies ?? null,
    evidence: evidence.map(({ start, end, text, reason }) => ({ start, end, text, reason })),
  };
};

export const withoutEvidenceText = (audit: SemanticVerdictAudit) => audit && {
  ...audit,
  evidence: audit.evidence.map(({ start, end, reason }) => ({
    start,
    end,
    ruleIds: reason.match(RULE_ID) ?? [],
  })),
};
