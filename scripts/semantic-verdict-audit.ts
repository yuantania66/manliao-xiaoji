import type { PlannedFunctionSemanticVerdict } from "../services/ai/plannedFunctionSemanticValidator";

const RULE_ID = /\bES-[A-Z]+(?:-[A-Z]+)*\b/gu;

export type SemanticVerdictAudit = {
  status: string | null;
  containsContradictoryMove: boolean | null;
  semanticQuestionCount: number | null;
  ruleIds: string[];
  evidence: Array<{ start: number; end: number; text: string; reason: string }>;
} | null;

export const semanticVerdictAuditFor = (
  verdict: PlannedFunctionSemanticVerdict | null | undefined
): SemanticVerdictAudit => {
  if (!verdict) return null;
  const evidence = verdict.positiveFunction?.evidence ?? [];
  return {
    status: verdict.positiveFunction?.status ?? null,
    containsContradictoryMove: verdict.positiveFunction?.containsContradictoryMove ?? null,
    semanticQuestionCount: verdict.semanticQuestionCount,
    ruleIds: Array.from(new Set(evidence.flatMap((span) => span.reason.match(RULE_ID) ?? []))),
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
