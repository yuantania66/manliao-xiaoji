import type { AiConversationMessage } from "@/services/ai/types";

import type { ClinicalSemanticEvidence } from "./clinicalTypes";

const CONVERSATION_RESET_GAP_MS = 5 * 60 * 1000;

const SEMANTICALLY_UNGROUNDED_ATOM_PATTERN =
  /^(?:[+-]?[0-9０-９]+(?:[.．][0-9０-９]+)?|[一二三四五六七八九十百千万零〇]+|[a-zA-Z]|[^\s\p{L}\p{N}]+|嗯+|啊+|哦+|好|行|对|不对|是|不是|可以|不可以|能|不能|yes|no|yeah|nope|ok|okay|sure)$/iu;
const MIXED_LOW_INFORMATION_TOKEN_PATTERN =
  /^(?=.*(?:[0-9０-９]|[一二三四五六七八九十百千万零〇]))(?:[0-9０-９一二三四五六七八九十百千万零〇+,.．。-]|[^\s\p{L}\p{N}])+$/u;
const QUANTITY_OR_AGE_QUESTION_PATTERN =
  /(?:多少|多大|几\s*(?:个|次|回|天|岁|年|人|项|件|只|颗|杯|碗|斤|公斤|小时|分钟)|^(?:请|麻烦)?(?:告诉我|回复|回答).{0,12}(?:年龄|岁数)|(?:年龄|岁数).{0,8}(?:是多少|多大))|\bhow\s+(?:many|much|old)\b|\bwhat(?:'s|\s+is)\s+your\s+age\b/iu;
const NUMERIC_ANSWER_PATTERN =
  /^(?:[+-]?[0-9０-９]+(?:[.．][0-9０-９]+)?|[一二三四五六七八九十百千万零〇]+)$/u;
const SCALE_QUESTION_PATTERN =
  /(?:几|多少)\s*分|^(?:(?:请|麻烦).{0,8})?(?:给|打|评).{0,18}(?:分|评分)\s*[？?。！!]?$/u;
const SCALE_FRAME_CUE_PATTERN = /分|评分|量表|程度|\bscale\b/iu;
const CHOICE_FRAME_CUE_PATTERN = /选|选择|任选|回复|回答|回编号|哪个|哪一|\bchoose\b|\boption/iu;
const EXPLICIT_CHOICE_ANSWER_REQUEST_PATTERN =
  /(?:^|[，。；;：:])\s*(?:(?:请|麻烦)(?:你)?[^，。；;：:！？?]{0,8}(?:回复|回答|选择|选|回编号)(?!可能|可以|是)|你(?:可以|可|只需|需要)[^，。；;：:！？?]{0,8}(?:回复|回答|选择|选|回编号)(?!可能|可以|是)|(?:回复|回答|选择|选|回编号)(?!可能|可以|是))/u;
const NUMERIC_SELECTION_QUESTION_PATTERN = /(?:哪一个|哪个|哪一项).{0,8}(?:数字|编号)/u;
const NUMERIC_ANSWER_REQUEST_CUE_PATTERN = /请|麻烦|告诉我|回复|回答/u;
const TERMINAL_QUESTION_PATTERN = /[？?]\s*$/u;
const TERMINAL_NUMERIC_QUESTION_PATTERN =
  /(?:多少|多大|几\s*(?:个|次|回|天|岁|年|人|项|件|只|颗|杯|碗|斤|公斤|小时|分钟)|(?:几|多少)\s*分|(?:哪一个|哪个|哪一项).{0,8}(?:数字|编号))\s*[。！!]?$/u;
const NON_ANSWER_SEEKING_CLAUSE_PATTERN =
  /(?:不知道|不清楚|不确定|不需要|无需|不用|不必|不要|不会|不是|不告诉|不讨论|不谈|只是|仅仅|举例|例子)/u;
const BINARY_QUESTION_PATTERN =
  /(?:吗[？?]?$|(?:是不是|是否)[^。！？?]*[？?]?$)|\b(?:are|is|do|does|did|can|could|would|will|have|has)\b[^?]*\?$/iu;
const SHORT_CORRECTION_PATTERN = /^不对$/u;
const AGE_QUESTION_PATTERN =
  /(?:几\s*岁|年龄|岁数|多大)|\bhow\s+old\b|\bwhat(?:'s|\s+is)\s+your\s+age\b/iu;
const COUNT_QUESTION_PATTERN =
  /(?:多少|几\s*(?:个|次|回|天|年|人|项|件|只|颗|杯|碗|斤|公斤|小时|分钟))|\bhow\s+(?:many|much)\b/iu;
const OPEN_QUESTION_PATTERN =
  /^(?:你|请|说说|告诉我|可以说说|愿意说说).*(?:什么|怎么|为什么|为何|如何|哪里|哪儿|哪些|谁|想说|想聊)/u;
const OPEN_QUESTION_CUE_PATTERN = /什么|怎么|为什么|为何|如何|哪里|哪儿|哪个|哪些|哪一|谁|想说|想聊/gu;
const REASSURANCE_SEGMENT_PATTERN = /慢慢|不用着急|不着急|可以慢慢|按你的节奏|没关系/u;
const SINGLE_CHOICE_OPTION_PATTERN =
  /^(?:[0-9０-９一二三四五六七八九十]+|[a-z])\s*[.、:：)）]/iu;
const BINARY_ALLOWED_ANSWERS = new Set(
  ["是", "不是", "对", "不对", "好", "不好", "可以", "不可以", "能", "不能", "yes", "no", "yeah", "nope", "ok", "okay", "sure"]
);

type ActiveAnswerFrame = {
  type: "explicit_choice" | "numeric_scale" | "count" | "age" | "numeric_selection" | "yes_no" | "open_question";
  segment: string;
  question: string;
  answerKind: "numeric" | "text" | "mixed" | "yes_no" | "open";
  constraints: {
    numericValues?: Set<number>;
    allowedAnswers?: Set<string>;
    min?: number;
    max?: number;
    units?: string;
  };
};

type AnswerFrameCandidate = {
  frame: ActiveAnswerFrame;
  position: number;
};

type ConversationalSegment = {
  text: string;
  position: number;
};

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizeAtomicAnswer = (value: string) => {
  let text = normalize(value).replace(/[。！？!?]+$/u, "").trim();
  if (/^[+-]?[0-9０-９]+\.$/u.test(text)) text = text.slice(0, -1);
  return text;
};

const normalizeDigits = (value: string) =>
  value
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - "０".charCodeAt(0)))
    .replace("．", ".");

const parseChineseInteger = (value: string) => {
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let section = 0;
  let number = 0;
  let total = 0;

  if ([...value].every((character) => character in digits)) {
    return Number([...value].map((character) => digits[character]).join(""));
  }

  for (const character of value) {
    if (character in digits) {
      number = digits[character];
      continue;
    }

    const unit = units[character];
    if (!unit) return null;
    if (unit === 10000) {
      total += (section + number) * unit;
      section = 0;
      number = 0;
      continue;
    }
    section += (number || 1) * unit;
    number = 0;
  }

  return total + section + number;
};

const parseNumberToken = (value: string) => {
  const normalized = normalizeDigits(value);
  if (/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return parseChineseInteger(normalized);
};

const getActiveRecentMessages = (recentMessages: AiConversationMessage[]) => {
  const latestMessageAt = recentMessages[recentMessages.length - 1]?.createdAt;
  if (!latestMessageAt) return recentMessages;

  const latestTimestamp = Date.parse(latestMessageAt);
  if (Number.isFinite(latestTimestamp) && Date.now() - latestTimestamp > CONVERSATION_RESET_GAP_MS) return [];

  for (let index = recentMessages.length - 1; index > 0; index -= 1) {
    const currentTimestamp = Date.parse(recentMessages[index].createdAt ?? "");
    const previousTimestamp = Date.parse(recentMessages[index - 1].createdAt ?? "");
    if (
      Number.isFinite(currentTimestamp) &&
      Number.isFinite(previousTimestamp) &&
      currentTimestamp - previousTimestamp > CONVERSATION_RESET_GAP_MS
    ) {
      return recentMessages.slice(index);
    }
  }

  return recentMessages;
};

const hasSelfContainedMeaning = (userTurn: string) => {
  const text = normalizeAtomicAnswer(userTurn);
  return (
    Boolean(text) &&
    !SEMANTICALLY_UNGROUNDED_ATOM_PATTERN.test(text) &&
    !MIXED_LOW_INFORMATION_TOKEN_PATTERN.test(text)
  );
};

const getExplicitChoiceValues = (frame: string) => {
  if (!CHOICE_FRAME_CUE_PATTERN.test(frame)) return null;

  const numbered = Array.from(
    frame.matchAll(/(?:^|[\s，。；;:：])([0-9０-９一二三四五六七八九十]+)\s*[.、:：)）]/gu),
    (match) => parseNumberToken(match[1])
  ).filter((value): value is number => value !== null);
  if (numbered.length >= 2) return new Set(numbered);

  const ordinal = Array.from(
    frame.matchAll(/第([0-9０-９一二三四五六七八九十]+)/gu),
    (match) => parseNumberToken(match[1])
  ).filter((value): value is number => value !== null);
  if (ordinal.length >= 2) return new Set(ordinal);

  const inline = Array.from(
    frame.matchAll(/[+-]?[0-9０-９]+|[一二三四五六七八九十百千万零〇]+/gu),
    (match) => ({
      value: parseNumberToken(match[0]),
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    })
  ).filter((token): token is { value: number; index: number; end: number } => token.value !== null);

  for (let start = 0; start < inline.length - 1; start += 1) {
    const values = [inline[start].value];
    for (let index = start; index < inline.length - 1; index += 1) {
      const separator = frame.slice(inline[index].end, inline[index + 1].index);
      if (!/^\s*(?:[、,，/]|或|还是)\s*$/u.test(separator)) break;
      values.push(inline[index + 1].value);
    }
    if (values.length >= 2) return new Set(values);
  }

  return null;
};

const getLetterChoiceValues = (frame: string) => {
  const match = frame.match(/\b([a-z])\b\s*(?:或|还是|or|\/)\s*\b([a-z])\b/iu);
  if (match) return new Set([match[1].toLowerCase(), match[2].toLowerCase()]);
  if (!CHOICE_FRAME_CUE_PATTERN.test(frame)) return null;

  const enumerated = Array.from(
    frame.matchAll(/(?:^|[\s，。；;:：])([a-z])\s*[.、:：)）]/giu),
    (item) => item[1].toLowerCase()
  );
  return enumerated.length >= 2 ? new Set(enumerated) : null;
};

const getQuotedChoiceValues = (frame: string) => {
  const values = Array.from(frame.matchAll(/[“"]([^”"]+)[”"]/gu), (match) =>
    normalize(match[1]).toLowerCase()
  );
  return values.length > 0 ? new Set(values) : null;
};

const getScaleRange = (frame: string): [number, number] | null => {
  if (!SCALE_FRAME_CUE_PATTERN.test(frame)) return null;

  const tokens = Array.from(
    frame.matchAll(/[+-]?[0-9０-９]+(?:[.．][0-9０-９]+)?|[一二三四五六七八九十百千万零〇]+/gu),
    (match) => ({
      value: parseNumberToken(match[0]),
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    })
  ).filter((token): token is { value: number; index: number; end: number } => token.value !== null);

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const separator = frame.slice(tokens[index].end, tokens[index + 1].index);
    if (/^\s*[-–—到至]\s*$/.test(separator)) {
      return [
        Math.min(tokens[index].value, tokens[index + 1].value),
        Math.max(tokens[index].value, tokens[index + 1].value),
      ];
    }
  }

  const fullScore = frame.match(/满分\s*([0-9０-９一二三四五六七八九十百]+)/u);
  const maximum = fullScore ? parseNumberToken(fullScore[1]) : null;
  return maximum === null ? null : [0, maximum];
};

const isNumericAnswerRequest = (clause: string) => {
  const hasNumericQuestionSemantics =
    QUANTITY_OR_AGE_QUESTION_PATTERN.test(clause) ||
    SCALE_QUESTION_PATTERN.test(clause) ||
    NUMERIC_SELECTION_QUESTION_PATTERN.test(clause);
  if (!hasNumericQuestionSemantics || NON_ANSWER_SEEKING_CLAUSE_PATTERN.test(clause)) return false;
  return (
    TERMINAL_QUESTION_PATTERN.test(clause) ||
    NUMERIC_ANSWER_REQUEST_CUE_PATTERN.test(clause) ||
    TERMINAL_NUMERIC_QUESTION_PATTERN.test(clause)
  );
};

const hasExplicitChoiceValues = (segment: string) =>
  Boolean(
    getExplicitChoiceValues(segment)?.size ||
      getLetterChoiceValues(segment)?.size ||
      getQuotedChoiceValues(segment)?.size
  );

const buildConversationalSegments = (assistantMessage: string): ConversationalSegment[] => {
  const atomicSegments = Array.from(
    assistantMessage.matchAll(/[^\r\n]+?(?:[？?。！!；;]|(?=\r?\n|$))/gu),
    (match) => ({ text: match[0], position: match.index ?? 0 })
  );
  const segments: ConversationalSegment[] = [];

  for (let index = 0; index < atomicSegments.length; index += 1) {
    const current = atomicSegments[index];
    const currentText = normalize(current.text);

    if (
      EXPLICIT_CHOICE_ANSWER_REQUEST_PATTERN.test(currentText) &&
      !hasExplicitChoiceValues(currentText)
    ) {
      const parts = [current.text];
      let optionIndex = index + 1;
      while (
        optionIndex < atomicSegments.length &&
        SINGLE_CHOICE_OPTION_PATTERN.test(normalize(atomicSegments[optionIndex].text))
      ) {
        parts.push(atomicSegments[optionIndex].text);
        optionIndex += 1;
      }
      if (parts.length > 1) {
        segments.push({ text: parts.join("\n"), position: current.position });
        index = optionIndex - 1;
        continue;
      }
    }

    const range = getScaleRange(currentText);
    let questionIndex = index + 1;
    while (
      questionIndex < atomicSegments.length &&
      REASSURANCE_SEGMENT_PATTERN.test(normalize(atomicSegments[questionIndex].text))
    ) {
      questionIndex += 1;
    }
    const next = atomicSegments[questionIndex];
    const nextText = next ? normalize(next.text) : "";
    if (
      range &&
      !isNumericAnswerRequest(currentText) &&
      !NON_ANSWER_SEEKING_CLAUSE_PATTERN.test(currentText) &&
      next &&
      isNumericAnswerRequest(nextText) &&
      SCALE_QUESTION_PATTERN.test(nextText)
    ) {
      segments.push({
        text: atomicSegments
          .slice(index, questionIndex + 1)
          .map((part) => part.text)
          .join("\n"),
        position: current.position,
      });
      index = questionIndex;
      continue;
    }

    segments.push(current);
  }

  return segments;
};

const extractCandidateAnswerFrames = (segment: ConversationalSegment): AnswerFrameCandidate[] => {
  const clause = normalize(segment.text);
  if (!clause || NON_ANSWER_SEEKING_CLAUSE_PATTERN.test(clause)) return [];

  const candidates: AnswerFrameCandidate[] = [];
  const addCandidate = (frame: ActiveAnswerFrame, index: number) => {
    candidates.push({ frame, position: segment.position + Math.max(index, 0) });
  };
  const createFrame = (
    type: ActiveAnswerFrame["type"],
    answerKind: ActiveAnswerFrame["answerKind"],
    constraints: ActiveAnswerFrame["constraints"] = {}
  ): ActiveAnswerFrame => ({ type, segment: clause, question: clause, answerKind, constraints });

  const explicitChoiceRequest = EXPLICIT_CHOICE_ANSWER_REQUEST_PATTERN.exec(clause);
  if (explicitChoiceRequest) {
    const numericValues = getExplicitChoiceValues(clause) ?? new Set<number>();
    const letterValues = getLetterChoiceValues(clause) ?? new Set<string>();
    const quotedValues = getQuotedChoiceValues(clause) ?? new Set<string>();
    const allowedAnswers = new Set([...letterValues, ...quotedValues]);
    if (numericValues.size > 0 || allowedAnswers.size > 0) {
      addCandidate(
        createFrame(
          "explicit_choice",
          numericValues.size > 0 && allowedAnswers.size > 0
            ? "mixed"
            : numericValues.size > 0
              ? "numeric"
              : "text",
          { numericValues, allowedAnswers }
        ),
        explicitChoiceRequest.index
      );
    }
  }

  if (isNumericAnswerRequest(clause)) {
    const scaleQuestion = SCALE_QUESTION_PATTERN.exec(clause);
    const ageQuestion = AGE_QUESTION_PATTERN.exec(clause);
    const countQuestion = COUNT_QUESTION_PATTERN.exec(clause);
    const numericSelectionQuestion = NUMERIC_SELECTION_QUESTION_PATTERN.exec(clause);

    if (scaleQuestion) {
      const range = getScaleRange(clause);
      addCandidate(
        createFrame("numeric_scale", "numeric", {
          min: range?.[0],
          max: range?.[1],
          units: "points",
        }),
        scaleQuestion.index
      );
    }
    if (ageQuestion) addCandidate(createFrame("age", "numeric", { units: "years" }), ageQuestion.index);
    if (countQuestion) addCandidate(createFrame("count", "numeric", { units: "count" }), countQuestion.index);
    if (numericSelectionQuestion) {
      addCandidate(createFrame("numeric_selection", "numeric"), numericSelectionQuestion.index);
    }
  }

  const binaryQuestion = BINARY_QUESTION_PATTERN.exec(clause);
  if (binaryQuestion) {
    addCandidate(
      createFrame("yes_no", "yes_no", { allowedAnswers: BINARY_ALLOWED_ANSWERS }),
      binaryQuestion.index
    );
  }

  const openQuestionCues = Array.from(clause.matchAll(OPEN_QUESTION_CUE_PATTERN));
  const lastOpenQuestionCue = openQuestionCues.at(-1);
  const questionFragmentStart = Math.max(clause.lastIndexOf("，"), clause.lastIndexOf(",")) + 1;
  const questionFragment = clause.slice(questionFragmentStart).trim();
  const fragmentHasTypedFrame =
    EXPLICIT_CHOICE_ANSWER_REQUEST_PATTERN.test(questionFragment) ||
    isNumericAnswerRequest(questionFragment) ||
    BINARY_QUESTION_PATTERN.test(questionFragment);
  if (TERMINAL_QUESTION_PATTERN.test(questionFragment) && !fragmentHasTypedFrame) {
    addCandidate(
      createFrame("open_question", "open"),
      lastOpenQuestionCue?.index ?? questionFragmentStart
    );
  } else if (!fragmentHasTypedFrame && OPEN_QUESTION_PATTERN.test(clause) && lastOpenQuestionCue) {
    addCandidate(createFrame("open_question", "open"), lastOpenQuestionCue.index ?? 0);
  }

  return candidates;
};

const selectActiveAnswerFrame = (assistantMessage: string): ActiveAnswerFrame | null => {
  const candidates = buildConversationalSegments(assistantMessage).flatMap(extractCandidateAnswerFrames);
  const activeCandidate = candidates.reduce<AnswerFrameCandidate | null>(
    (active, candidate) => (!active || candidate.position > active.position ? candidate : active),
    null
  );
  return activeCandidate?.frame ?? null;
};

const bindReplyToActiveFrame = (reply: string, frame: ActiveAnswerFrame | null) => {
  if (!frame) return false;

  if (frame.type === "explicit_choice") {
    if (NUMERIC_ANSWER_PATTERN.test(reply)) {
      const answer = parseNumberToken(reply);
      return answer !== null && Boolean(frame.constraints.numericValues?.has(answer));
    }
    return Boolean(frame.constraints.allowedAnswers?.has(reply.toLowerCase()));
  }

  if (frame.type === "yes_no") {
    return Boolean(frame.constraints.allowedAnswers?.has(reply.toLowerCase()));
  }
  if (frame.type === "open_question") return false;
  if (!NUMERIC_ANSWER_PATTERN.test(reply)) return false;

  const answer = parseNumberToken(reply);
  if (answer === null) return false;
  if (
    frame.type === "numeric_scale" &&
    frame.constraints.min !== undefined &&
    frame.constraints.max !== undefined
  ) {
    return answer >= frame.constraints.min && answer <= frame.constraints.max;
  }
  return true;
};

const isCompatibleWithEstablishedAnswerFrame = (
  userTurn: string,
  recentMessages: AiConversationMessage[]
) => {
  const text = normalizeAtomicAnswer(userTurn);
  const activeMessages = getActiveRecentMessages(recentMessages);
  const latestMessage = activeMessages[activeMessages.length - 1];
  const previousAssistantMessage = latestMessage?.role === "assistant" ? latestMessage.content : null;

  if (!previousAssistantMessage) return false;

  const activeFrame = selectActiveAnswerFrame(previousAssistantMessage);
  if (SHORT_CORRECTION_PATTERN.test(text)) return true;
  return bindReplyToActiveFrame(text, activeFrame);
};

export const evaluateSemanticEvidence = ({
  userTurn,
  recentMessages,
}: {
  userTurn: string;
  recentMessages: AiConversationMessage[];
}): ClinicalSemanticEvidence => {
  if (hasSelfContainedMeaning(userTurn)) {
    return {
      status: "sufficient",
      source: "current_user_message",
      reason: "The current user message contains self-contained semantic content.",
    };
  }

  if (isCompatibleWithEstablishedAnswerFrame(userTurn, recentMessages)) {
    return {
      status: "sufficient",
      source: "established_conversation_frame",
      reason: "The current user message is semantically compatible with an explicit answer frame in active context.",
    };
  }

  return {
    status: "insufficient",
    source: "none",
    reason: "Neither the current message nor active conversation context establishes enough meaning to infer intent.",
  };
};
