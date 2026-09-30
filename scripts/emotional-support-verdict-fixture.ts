import type {
  EmotionalSupportAnswers,
  PositiveFunctionSemanticVerdict,
} from "../services/ai/plannedFunctionSemanticValidator";

export const cleanEmotionalSupportAnswers = (): EmotionalSupportAnswers => ({
  options: [],
  emotionMentions: [],
  priorTurnFabrication: "not_applicable",
  otherContradiction: "none",
});

// Offline fixtures: an offer_emotional_support verdict uses schemaVersion 2 with per-question answers.
// Clean answers leave the outcome to the fixture's own status/contractRealized/containsContradictoryMove.
export const withEmotionalSupportSchema = <T extends {
  schemaVersion: number;
  positiveFunction: Omit<PositiveFunctionSemanticVerdict, "binding"> & { binding: { action: string } } | null;
}>(verdict: T): T => {
  const positive = verdict.positiveFunction;
  if (positive?.binding.action !== "offer_emotional_support") return verdict;
  return {
    ...verdict,
    schemaVersion: 2,
    positiveFunction: { ...positive, emotionalSupport: positive.emotionalSupport ?? cleanEmotionalSupportAnswers() },
  };
};
