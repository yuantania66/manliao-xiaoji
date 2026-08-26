import { isNoTopicMessage } from "../state";
import type { ConversationMessage } from "../types";
import type { CorrectionSignal } from "./types";

const USER_CORRECTION_PATTERN =
  /你是不是.*(没懂|没理解)|你.*(没懂|没理解|理解错|理解偏|误会|误解|说错)|^不对[。！？!?]?$|^(其实)?不是(这个意思|这意思|这样的|这样|那个|因为这个)|不是我想表达的|我(?:刚刚|刚才)?(?:说|问|表达|指)的不是|我不是在说这个|我想纠正一下|我来纠正一下|我纠正一下|我(刚刚|刚才)?是不是没表达清楚/u;

const NEGATED_CORRECTION_PATTERN =
  /不是在说.*(你|你们|AI|ai|机器人).*(理解错|理解偏|没懂|没理解|误会|误解)|不是说.*(你|你们|AI|ai|机器人).*(理解错|理解偏|没懂|没理解|误会|误解)/u;

// This parses a general meta-conversational denial ("I did not ask/say/request X").
// It is proposition-agnostic: the complement is kept as structured evidence and
// is never used as a reply template or a domain-specific capability rule.
const NEGATED_USER_SPEECH_ACT_PATTERN =
  /^(?:我|这|那|刚才|刚刚)?(?:其实|也|根本|并|确实)?(?:没|没有|并未|并没有|不是在)(?:问|说|提|提出|要求|让)(?:过)?[：:，,\s]*(.+?)[。！？!?]*$/u;

const THIRD_PARTY_SPEECH_OBJECT_PATTERN = /^(?:他|她|它|他们|她们|它们)/u;

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const turnIdAt = (turn: ConversationMessage, index: number) =>
  turn.id ?? `adjacent-turn-${index + 1}`;

const findStillOpenNoTopicIntent = (
  adjacentTurns: ConversationMessage[],
  beforeIndex: number
): CorrectionSignal["stillOpenUserIntent"] => {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const turn = adjacentTurns[index];
    if (turn.role === "user" && isNoTopicMessage(turn.content)) {
      return {
        kind: "no_topic",
        sourceTurnId: turnIdAt(turn, index),
        text: turn.content,
      };
    }
  }
  return null;
};

export const detectAssistantCorrection = ({
  text,
  adjacentTurns,
}: {
  text: string;
  adjacentTurns: ConversationMessage[];
}): CorrectionSignal | null => {
  const normalized = normalize(text);
  if (!normalized || NEGATED_CORRECTION_PATTERN.test(normalized)) return null;

  const lastAssistantIndex = adjacentTurns.findLastIndex((turn) => turn.role === "assistant");
  if (lastAssistantIndex < 0) return null;
  const targetTurn = adjacentTurns[lastAssistantIndex];
  const targetTurnId = turnIdAt(targetTurn, lastAssistantIndex);
  const parsedSpeechAct = normalized.match(NEGATED_USER_SPEECH_ACT_PATTERN);
  const deniedSpeechAct =
    parsedSpeechAct && !THIRD_PARTY_SPEECH_OBJECT_PATTERN.test(normalize(parsedSpeechAct[1]))
      ? parsedSpeechAct
      : null;
  const generalCorrection = USER_CORRECTION_PATTERN.test(normalized);
  if (!deniedSpeechAct && !generalCorrection) return null;

  const challengedText = normalize(deniedSpeechAct?.[1] ?? targetTurn.content);
  return {
    targetTurnId,
    correctionType: deniedSpeechAct ? "irrelevant_answer" : "misunderstanding",
    challengedPropositions: [{
      id: `${targetTurnId}:challenged-1`,
      text: challengedText,
      sourceTurnId: targetTurnId,
      status: "rejected",
    }],
    stillOpenUserIntent: findStillOpenNoTopicIntent(adjacentTurns, lastAssistantIndex),
    evidence: [
      deniedSpeechAct
        ? "current user turn structurally denies having asked, stated, or requested the challenged proposition"
        : "current user turn explicitly corrects the immediately preceding assistant turn",
      `targetTurnId=${targetTurnId}`,
    ],
  };
};

export const isAssistantRepairSignal = (
  text: string,
  adjacentTurns: ConversationMessage[] = []
): boolean => {
  const normalized = normalize(text);
  if (NEGATED_CORRECTION_PATTERN.test(normalized)) return false;
  if (adjacentTurns.length > 0) {
    return Boolean(detectAssistantCorrection({ text: normalized, adjacentTurns }));
  }
  return USER_CORRECTION_PATTERN.test(normalized) ||
    NEGATED_USER_SPEECH_ACT_PATTERN.test(normalized);
};
