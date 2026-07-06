import { UnderstandingExtraction } from "@/services/understanding/understandingTypes";

import { PROFESSIONAL_GUIDANCE_CARDS } from "./professionalCorpus";
import { RetrievedProfessionalGuidance } from "./professionalTypes";

const normalize = (value: string) => value.replace(/\s+/g, "").toLowerCase();

const includesAny = (text: string, values: string[]) => {
  const normalizedText = normalize(text);
  return values.some((value) => normalizedText.includes(normalize(value)));
};

const scoreCard = ({
  cardTopics,
  cardCues,
  extraction,
  currentMessage,
}: {
  cardTopics: string[];
  cardCues: string[];
  extraction: UnderstandingExtraction;
  currentMessage: string;
}) => {
  let score = 0;
  const extractionText = [
    currentMessage,
    ...extraction.topics,
    ...extraction.people,
    ...extraction.facts.map((item) => item.eventText),
    ...extraction.experiences.flatMap((item) => [item.emotion, item.bodySignal, item.behavior].filter(Boolean)),
    ...extraction.interpretations.map((item) => item.interpretationText),
  ]
    .filter(Boolean)
    .join(" ");

  for (const topic of extraction.topics) {
    if (cardTopics.some((candidate) => normalize(candidate) === normalize(topic))) score += 2;
  }
  if (includesAny(extractionText, cardCues)) score += 3;
  if (includesAny(currentMessage, cardTopics)) score += 1;
  return score;
};

export const retrieveProfessionalGuidance = ({
  extraction,
  currentMessage,
  limit = 3,
}: {
  extraction: UnderstandingExtraction;
  currentMessage: string;
  limit?: number;
}): RetrievedProfessionalGuidance[] =>
  PROFESSIONAL_GUIDANCE_CARDS.map((card) => ({
    card,
    score: scoreCard({
      cardTopics: card.topics,
      cardCues: card.cues,
      extraction,
      currentMessage,
    }),
  }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ card, score }) => ({
      id: card.id,
      sourceTitle: card.sourceTitle,
      sourceUrl: card.sourceUrl,
      sourceKind: card.sourceKind,
      principle: card.principle,
      applyWhen: card.applyWhen,
      avoid: card.avoid,
      responseMove: card.responseMove,
      reason: `score=${score}`,
    }));
