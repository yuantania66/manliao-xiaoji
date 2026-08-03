import type {
  AffectEvidenceCategory,
  AffectEvidenceObject,
  AffectEvidenceSpan,
  ConversationInteractionSignals,
  ConversationStateInput,
  ConversationStateMessage,
  ConversationStateResult,
} from "./conversationStateTypes";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
const normalizeColloquialSemantics = (value: string) => normalize(value).replace(/啥/gu, "什么");

const ADVICE_REQUEST_PATTERN =
  /给我.*建议|给点建议|一些建议|有.*建议|需要.*建议|帮我.*(想|看看|处理|解决|判断|决定|理一下|捋一下)|怎么办|怎么做|该怎么|我该|能不能.*建议|可以.*建议|接下来.*(做|办)|下一步|怎么开口|该不该/;

const CLOSING_PATTERN =
  /今天先聊到这里|先聊到这里|先不说了|不想说了|不说了|不聊了|我先不聊了|别问了|让我(?:安静|静静)(?:一会儿|一下|会)?|暂停|先这样|就这样吧|稍后再聊|回头再说|下次再说|今天就到这|先到这|到这里吧|结束吧/;

const DISCLOSURE_PATTERN =
  /今天|昨天|刚刚|后来|然后|因为|领导|妈妈|朋友|同事|项目|工作|关系|感觉|觉得|难受|委屈|焦虑|压力|累|害怕|生气|梦到|身体|胸口|胃|睡不着/;

const userMessages = (messages: ConversationStateMessage[]) => messages.filter((message) => message.role === "user");

const assistantMessages = (messages: ConversationStateMessage[]) =>
  messages.filter((message) => message.role === "assistant");

const hasPreviousAssistantReply = (messages: ConversationStateMessage[]) =>
  messages.some((message) => message.role === "assistant");

const hasSustainedUserDisclosure = (currentText: string, messages: ConversationStateMessage[]) => {
  const recentUserMessages = [...userMessages(messages).map((message) => message.content), currentText]
    .map(normalize)
    .filter(Boolean);

  if (recentUserMessages.length < 3) return false;

  const disclosureLikeCount = recentUserMessages.filter(
    (message) => message.length >= 18 || DISCLOSURE_PATTERN.test(message)
  ).length;

  return disclosureLikeCount >= 3;
};

const NO_TOPIC_PATTERN =
  /(?:想不到|不知道|不知(?:道)?|没(?:有)?)(?:.{0,8})?(?:说什么|说啥|聊什么|什么可说|话题)|没话题|没有话题|随便聊点什么都行|随便聊什么都行|你来问吧|你问吧/;

export const isNoTopicMessage = (value: string) =>
  NO_TOPIC_PATTERN.test(normalizeColloquialSemantics(value));

const EXPLICIT_REOPEN_PATTERN = /你来问吧|你问吧|随便聊点什么都行|随便聊什么都行|你带个头|你先说/;

type AffectEvidenceRule = {
  pattern: RegExp;
  category: AffectEvidenceCategory;
  object: AffectEvidenceObject;
};

const AFFECT_MODIFIER = String.raw`(?:(?:真的|确实)\s*)?(?:(?:有点|有些|一点|稍微|不太|挺|很|特别|非常|太)\s*){0,2}`;

const affectRule = (
  expression: string,
  category: AffectEvidenceCategory,
  object: AffectEvidenceObject = "self_experience"
): AffectEvidenceRule => ({
  pattern: new RegExp(`${AFFECT_MODIFIER}(?:${expression})`, "gu"),
  category,
  object,
});

/**
 * Canonical affect/relational-impact recognition. Conversation State owns
 * extraction; downstream interpretation and planning consume these spans and
 * must not maintain a second phrase list.
 */
const AFFECT_EVIDENCE_RULES: AffectEvidenceRule[] = [
  {
    pattern: /你\s*(?:(?:一点都|完全|根本|还是)\s*)?(?:没有|没|不)\s*(?:懂|理解|接住|跟上)\s*我|(?:没有|没)\s*(?:懂|理解|接住|跟上)\s*我/gu,
    category: "relational_impact",
    object: "assistant_relationship",
  },
  {
    pattern: /被\s*(?:(?:别人|人|他们|她们|他|她)\s*)?忽略/gu,
    category: "relational_impact",
    object: "interpersonal_experience",
  },
  {
    pattern: /(?:心里\s*(?:(?:真的|确实)\s*)?(?:(?:有点|有些|一点|稍微|挺|很|特别|非常|太|这点|那点|这股|那股)\s*){0,2}(?:发?堵(?:着)?|堵得慌)|(?:这|那)(?:点|股)\s*(?:堵(?:着)?|堵得慌)(?:的感觉)?)/gu,
    category: "blocked_affect",
    object: "self_experience",
  },
  affectRule("不太高兴|不高兴|高兴不起来", "unhappiness"),
  affectRule("难过|伤心|失落(?:感)?|心情低落", "sadness"),
  affectRule("委屈", "grievance"),
  affectRule("生气(?!勃勃)|恼火", "anger"),
  affectRule("担心|忧虑", "worry"),
  affectRule("丢脸|尴尬|羞耻", "embarrassment"),
  affectRule("孤单|孤独", "loneliness"),
  affectRule("心烦|烦躁|烦(?!请|劳)", "irritation"),
  affectRule("疲惫|累得慌|累(?!积|计|加|乘|赘|犯)", "fatigue"),
  affectRule("难受|痛苦|不舒服", "distress"),
  affectRule("害怕|恐惧", "fear"),
  affectRule("焦虑", "anxiety"),
  affectRule("心慌|慌", "panic"),
  affectRule("绝望", "despair"),
  affectRule("崩溃|撑不住|受不了|扛不住|喘不过气", "overwhelm"),
  {
    pattern: /(?:脑子|脑袋)\s*一片空白/gu,
    category: "overwhelm",
    object: "self_experience",
  },
  {
    pattern: /(?:压力\s*(?:很|好|太|特别|非常)?\s*大|(?:有|感觉到|觉得有)\s*(?:点|些)?\s*压力)/gu,
    category: "pressure",
    object: "self_experience",
  },
  affectRule("内疚|愧疚", "guilt"),
];

const NEGATED_AFFECT_PREFIX_PATTERN =
  /(?:(?:没有|没)说(?:过)?我|并没有|没有|并不|不是|不用|不要|别|没|不)(?:那么|怎么|太|很|特别|非常|真的)?\s*$/u;

const NON_USER_AFFECT_SUBJECT_PATTERN =
  /(?:(?:他|她|它|妈妈|爸爸)(?:说|觉得|看起来|好像)(?:自己)?|(?:朋友|同事|领导)(?:说|觉得|看起来|好像)(?:他|她|自己)?|(?:我爸|我妈|我姐|我哥)(?:说|觉得|看起来|好像)(?:他|她|自己)?)\s*$/u;

const intensityForAffectSpan = (text: string): AffectEvidenceSpan["intensity"] => {
  if (/(?:崩溃|撑不住|受不了|扛不住|喘不过气|绝望|痛苦)/u.test(text)) return "high";
  if (/(?:一点都|完全|根本)/u.test(text)) return "moderate";
  if (/(?:有点|有些|一点|稍微|不太|(?:点|些)\s*压力)/u.test(text)) return "low";
  if (/(?:真的|确实|挺|很|特别|非常|太)/u.test(text)) return "moderate";
  return "unspecified";
};

const isUnsupportedAffectScope = (sourceText: string, start: number) => {
  const prefix = sourceText.slice(Math.max(0, start - 12), start);
  return NEGATED_AFFECT_PREFIX_PATTERN.test(prefix) || NON_USER_AFFECT_SUBJECT_PATTERN.test(prefix);
};

export const extractAffectEvidence = (sourceText: string): AffectEvidenceSpan[] => {
  const spans: AffectEvidenceSpan[] = [];
  const occupied = new Set<string>();
  for (const rule of AFFECT_EVIDENCE_RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of sourceText.matchAll(rule.pattern)) {
      const text = match[0];
      const start = match.index;
      const end = start + text.length;
      if (!text.trim() || isUnsupportedAffectScope(sourceText, start)) continue;
      const key = `${start}:${end}:${rule.category}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      spans.push({
        source: "current_user_message",
        text,
        start,
        end,
        category: rule.category,
        intensity: intensityForAffectSpan(text),
        object: rule.object,
      });
    }
  }
  return spans.sort((left, right) => left.start - right.start || left.end - right.end);
};

const LEADING_AFFECT_MODIFIER_PATTERN =
  /^(?:(?:真的|确实)\s*)?(?:(?:有点|有些|一点|稍微|挺|很|特别|非常|太)\s*){1,2}/u;

/**
 * Legacy Surface/Validator compatibility only. Every projected term is either
 * the exact source span or its contiguous suffix after mechanically removing
 * leading intensity modifiers; no independent affect vocabulary is used.
 */
export const projectAffectEvidenceTerms = (spans: AffectEvidenceSpan[]) =>
  Array.from(new Set(spans.flatMap((span) => {
    const withoutLeadingModifier = span.text
      .replace(LEADING_AFFECT_MODIFIER_PATTERN, "")
      .trim();
    return withoutLeadingModifier && withoutLeadingModifier !== span.text
      ? [span.text, withoutLeadingModifier]
      : [span.text];
  })));

const LIGHT_AFFECT_CUE_PATTERN = /(?:耶|呀|啦|哈哈|呵呵|～|~)/;

const ASSISTANT_SHARING_INVITATION_PATTERN =
  /有什么.{0,12}(?:想|可以).{0,8}(?:说|聊)|想.{0,8}(?:说说|聊聊)|可以.{0,8}(?:说说|聊聊)|(?:想|愿意).{0,8}(?:说|聊)/;

const isAssistantQuestion = (content: string) => /[？?]|吗[。！？!?]?$|呢[。！？!?]?$/.test(normalize(content));

const getLastMessage = (messages: ConversationStateMessage[], role: "user" | "assistant") =>
  [...messages].reverse().find((message) => message.role === role)?.content ?? null;

const getRecentAssistantQuestionCount = (messages: ConversationStateMessage[]) =>
  assistantMessages(messages).slice(-3).filter((message) => isAssistantQuestion(message.content)).length;

const deriveInteractionSignals = ({
  currentUserMessage,
  recentMessages,
}: ConversationStateInput): ConversationInteractionSignals => {
  const text = normalize(currentUserMessage);
  const semanticText = normalizeColloquialSemantics(currentUserMessage);
  const previousAssistantMessage = getLastMessage(recentMessages, "assistant");
  const previousUserMessage = getLastMessage(recentMessages, "user");
  const respondedToAssistant = recentMessages.at(-1)?.role === "assistant";
  const noTopic = isNoTopicMessage(semanticText);
  const explicitStop = CLOSING_PATTERN.test(text);
  const explicitReopen = EXPLICIT_REOPEN_PATTERN.test(text);
  const priorPauseStillActive =
    Boolean(previousUserMessage && CLOSING_PATTERN.test(previousUserMessage)) && !explicitReopen;
  const immediateAssistantInvited = Boolean(
    previousAssistantMessage && ASSISTANT_SHARING_INVITATION_PATTERN.test(previousAssistantMessage)
  );
  const repeatedAssistantQuestions = getRecentAssistantQuestionCount(recentMessages) >= 2;
  const contentAvailability = !text
    ? "unknown"
    : noTopic
      ? "no_topic"
      : [...text].length <= 2
        ? "fragmentary"
        : "has_topic";
  const stopIntent = explicitStop || (priorPauseStillActive && noTopic);
  const affectEvidence = extractAffectEvidence(currentUserMessage);
  const affect = affectEvidence.length > 0
    ? "negative"
    : LIGHT_AFFECT_CUE_PATTERN.test(text)
      ? "neutral_or_light"
      : "unknown";
  const engagement = stopIntent
    ? explicitStop
      ? "stop_requested"
      : "disengaging"
    : respondedToAssistant || noTopic
      ? "engaged"
      : "open";
  const initiativeDirection = stopIntent
    ? "pause"
    : noTopic
      ? repeatedAssistantQuestions && !immediateAssistantInvited
        ? "shared"
        : "assistant_invited"
      : contentAvailability === "fragmentary"
        ? "shared"
        : "user_leads";
  const evidence = [
    `contentAvailability=${contentAvailability}`,
    ...(respondedToAssistant ? ["current turn responds to the immediately preceding assistant turn"] : []),
    ...(immediateAssistantInvited ? ["immediately preceding assistant turn invited sharing"] : []),
    ...(repeatedAssistantQuestions ? ["recent assistant turns contain repeated questions"] : []),
    ...(explicitStop ? ["current user turn explicitly requests lower interaction or a stop"] : []),
    ...(priorPauseStillActive && noTopic ? ["recent explicit pause remains active without a clear reopening signal"] : []),
    `affect=${affect}`,
    ...affectEvidence.map((span) =>
      `affectEvidence=${span.category}:${span.intensity}:${span.object}:${span.start}-${span.end}`
    ),
  ];

  return {
    contentAvailability,
    engagement,
    initiativeDirection,
    affect,
    affectEvidence,
    stopIntent,
    evidence,
  };
};

export const determineConversationState = ({
  currentUserMessage,
  recentMessages,
}: ConversationStateInput): ConversationStateResult => {
  const text = normalize(currentUserMessage);
  const turnCount = recentMessages.length + 1;
  const previousAssistantReply = hasPreviousAssistantReply(recentMessages);
  const explicitAdviceRequest = ADVICE_REQUEST_PATTERN.test(text);
  const explicitClosingSignal = CLOSING_PATTERN.test(text);
  const sustainedUserDisclosure = hasSustainedUserDisclosure(text, recentMessages);
  const interaction = deriveInteractionSignals({ currentUserMessage, recentMessages });
  const signals = {
    turnCount,
    hasPreviousAssistantReply: previousAssistantReply,
    explicitAdviceRequest,
    explicitClosingSignal,
    sustainedUserDisclosure,
  };

  if (explicitClosingSignal) {
    return {
      state: "closing",
      reason: "User explicitly signaled pause, ending, or later continuation.",
      signals,
      interaction,
    };
  }

  if (explicitAdviceRequest) {
    return {
      state: "action",
      reason: "User explicitly requested advice, a choice, or a next step.",
      signals,
      interaction,
    };
  }

  if (sustainedUserDisclosure && turnCount >= 6) {
    return {
      state: "deepening",
      reason: "Multiple in-session user turns are continuing a substantive thread.",
      signals,
      interaction,
    };
  }

  if (turnCount <= 2 && !previousAssistantReply) {
    return {
      state: "opening",
      reason: "New or very early conversation without an established shared direction.",
      signals,
      interaction,
    };
  }

  return {
    state: "exploring",
    reason: "Default dry-run state when the conversation has a topic but no reliable deeper phase signal.",
    signals,
    interaction,
  };
};
