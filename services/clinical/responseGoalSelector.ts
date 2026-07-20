import type { ClinicalContext, PersonCenteredGateDecision, ResponseGoal } from "./clinicalTypes";
import { isUserCorrection } from "./userCorrectionSignal";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const SUMMARY_REQUEST_PATTERN = /梳理|总结|复盘|整理一下|理一下|帮我理|捋一下/;

const HIGH_EMOTION_PATTERN = /崩|撑不住|喘不过气|受不了|扛不住|难受死|痛苦|害怕|焦虑|慌|绝望|崩溃/;

const SOFT_PAUSE_PATTERN = /算了|先不说了|不说了|不聊了|暂停|先这样|不想说/;

const QUESTION_PATTERN = /[?？]|吗$|呢$/;

const isLongDisclosure = (text: string) => {
  const punctuationCount = (text.match(/[，。！？；、,.!?;]/g) ?? []).length;
  return text.length >= 80 || punctuationCount >= 4;
};

export const selectLegacyResponseGoal = (context: ClinicalContext): ResponseGoal => {
  const text = normalize(context.conversation.currentUserMessage);

  if (context.signals.explicitAdviceRequest) return "support_action";
  if (context.signals.expressionDifficulty) return "help_continue_expression";
  if (SUMMARY_REQUEST_PATTERN.test(text)) return "summarize";
  if (SOFT_PAUSE_PATTERN.test(text)) return "hold_space";
  if (HIGH_EMOTION_PATTERN.test(text) && !QUESTION_PATTERN.test(text)) return "hold_space";
  if (isLongDisclosure(text)) return text.length >= 120 ? "summarize" : "reflect";
  if (context.signals.semanticEvidence.status === "insufficient") return "clarify";
  if (isUserCorrection(text)) return "clarify";

  return "reflect";
};

export const selectResponseGoal = (
  context: ClinicalContext,
  gateDecision: PersonCenteredGateDecision | null = null
): ResponseGoal => {
  const candidate = selectLegacyResponseGoal(context);

  if (!gateDecision) return candidate;
  if (gateDecision.responseGoalPolicy.preferred) {
    return gateDecision.responseGoalPolicy.preferred;
  }
  if (gateDecision.responseGoalPolicy.allowed.includes(candidate)) return candidate;
  return gateDecision.responseGoalPolicy.fallback;
};
