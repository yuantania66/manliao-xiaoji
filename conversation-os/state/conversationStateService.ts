import type {
  ConversationStateInput,
  ConversationStateMessage,
  ConversationStateResult,
} from "./conversationStateTypes";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const ADVICE_REQUEST_PATTERN =
  /给我.*建议|给点建议|一些建议|有.*建议|需要.*建议|帮我.*(想|看看|处理|解决|判断|决定|理一下|捋一下)|怎么办|怎么做|该怎么|我该|能不能.*建议|可以.*建议|接下来.*(做|办)|下一步|怎么开口|该不该/;

const CLOSING_PATTERN =
  /今天先聊到这里|先聊到这里|先不说了|不说了|不聊了|暂停|先这样|就这样吧|稍后再聊|回头再说|下次再说|今天就到这|先到这|到这里吧|结束吧/;

const DISCLOSURE_PATTERN =
  /今天|昨天|刚刚|后来|然后|因为|领导|妈妈|朋友|同事|项目|工作|关系|感觉|觉得|难受|委屈|焦虑|压力|累|害怕|生气|梦到|身体|胸口|胃|睡不着/;

const userMessages = (messages: ConversationStateMessage[]) => messages.filter((message) => message.role === "user");

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
    };
  }

  if (explicitAdviceRequest) {
    return {
      state: "action",
      reason: "User explicitly requested advice, a choice, or a next step.",
      signals,
    };
  }

  if (sustainedUserDisclosure && turnCount >= 6) {
    return {
      state: "deepening",
      reason: "Multiple in-session user turns are continuing a substantive thread.",
      signals,
    };
  }

  if (turnCount <= 2 && !previousAssistantReply) {
    return {
      state: "opening",
      reason: "New or very early conversation without an established shared direction.",
      signals,
    };
  }

  return {
    state: "exploring",
    reason: "Default dry-run state when the conversation has a topic but no reliable deeper phase signal.",
    signals,
  };
};
