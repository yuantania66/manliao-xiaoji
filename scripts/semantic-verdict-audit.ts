import type { PlannedFunctionSemanticVerdict } from "../services/ai/plannedFunctionSemanticValidator";

const RULE_ID = /\bES-[A-Z]+(?:-[A-Z]+)*\b/gu;

export type SemanticVerdictAudit = {
  status: string | null;
  containsContradictoryMove: boolean | null;
  semanticQuestionCount: number | null;
  ruleIds: string[];
  // ES-* ids cited outside an offer_emotional_support positive-function verdict (rule-boundary violation).
  outOfScopeRuleIds: string[];
  evidence: Array<{ start: number; end: number; text: string; reason: string }>;
} | null;

export const ruleIdsInReason = (reason: string) => reason.match(RULE_ID) ?? [];

const ruleIdsIn = (evidence: Array<{ reason: string }>) =>
  Array.from(new Set(evidence.flatMap((span) => ruleIdsInReason(span.reason))));

// codeRuleIds: rule ids the validator derived in code (prior-pause observations); they replace ids
// parsed from the model's reason text.
export const semanticVerdictAuditFor = (
  verdict: PlannedFunctionSemanticVerdict | null | undefined,
  codeRuleIds?: string[]
): SemanticVerdictAudit => {
  if (!verdict) return null;
  const evidence = verdict.positiveFunction?.evidence ?? [];
  const ruleIds = codeRuleIds ?? ruleIdsIn(evidence);
  const emotionalSupportVerdict = verdict.positiveFunction?.binding.action === "offer_emotional_support";
  return {
    status: verdict.positiveFunction?.status ?? null,
    containsContradictoryMove: verdict.positiveFunction?.containsContradictoryMove ?? null,
    semanticQuestionCount: verdict.semanticQuestionCount,
    ruleIds,
    outOfScopeRuleIds: Array.from(new Set([
      ...(emotionalSupportVerdict ? [] : ruleIds),
      ...ruleIdsIn(verdict.handoff?.evidence ?? []),
    ])),
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
