import type {
  ConversationInteractionSignals,
  ConversationStateInput,
  ConversationStateMessage,
  ConversationStateResult,
} from "./conversationStateTypes";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

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

const EXPLICIT_REOPEN_PATTERN = /你来问吧|你问吧|随便聊点什么都行|随便聊什么都行|你带个头|你先说/;

const NEGATIVE_AFFECT_PATTERN =
  /难受|太累|累得|疲惫|痛苦|害怕|焦虑|慌|绝望|崩溃|撑不住|烦|委屈|难过|(?:脑子|脑袋)一片空白.*(?:什么也)?不想说/;

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
  const previousAssistantMessage = getLastMessage(recentMessages, "assistant");
  const previousUserMessage = getLastMessage(recentMessages, "user");
  const respondedToAssistant = recentMessages.at(-1)?.role === "assistant";
  const noTopic = NO_TOPIC_PATTERN.test(text);
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
  const affect = NEGATIVE_AFFECT_PATTERN.test(text)
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
  ];

  return {
    contentAvailability,
    engagement,
    initiativeDirection,
    affect,
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
