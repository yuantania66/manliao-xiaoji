import { AiConversationMessage } from "./types";

export type RelationshipStage = "stranger" | "present" | "opening" | "organizing";
export type ExpressionMode =
  | "word"
  | "number"
  | "symbol"
  | "sentence"
  | "correction"
  | "silence-ish"
  | "advice"
  | "crisis"
  | "boundary";
export type Rhythm = "hold" | "soft_echo" | "small_open" | "follow" | "organize";
export type PresenceMode =
  | "quiet"
  | "witness"
  | "permission"
  | "anchor"
  | "invite"
  | "repair"
  | "safety";

export type SlowChatContinuity = {
  recentUserInputs: string[];
  knownSignals: string[];
  primarySignal: string;
  recentBoundary: boolean;
  repeatedLowInformation: boolean;
  numericValues: number[];
  numericTrend: "none" | "first" | "same" | "decreasing" | "increasing" | "mixed";
  observation: string;
  shouldMentionObservation: boolean;
};

export type SlowChatState = {
  relationshipStage: RelationshipStage;
  expressionMode: ExpressionMode;
  rhythm: Rhythm;
  presenceMode: PresenceMode;
  continuity: SlowChatContinuity;
  responseIntent: string;
  responseShape: string;
};

const CRISIS_PATTERN = /自杀|轻生|不想活|伤害自己|结束生命|割腕|寻死/;
const CORRECTION_PATTERN = /不是这样|不是这个|不对|现在是|其实|我说的是|我都已经说了|已经说了|还问我|你回复得很假|套模板|别圆/;
const ADVICE_PATTERN = /怎么办|怎么做|建议|要不要|该不该|帮我想|你觉得|能做什么/;
const BOUNDARY_PATTERN = /别问|别追问|别让我想|先别|别替我|不想被教育|别说你永远|不想说|不说也行|你也别装懂|我知道你是AI/;
const SILENCE_PATTERN = /不知道|说不上来|没什么|随便|都行|不知道怎么说|不知道说什么|算了|就这样/;
const NUMBER_PATTERN = /^[0-9０-９]+$/;
const SYMBOL_PATTERN = /^[。,.，…!！?？]+$/;
const LOW_INFORMATION_PATTERN = /^([0-9０-９]+|[一二三四五六七八九十零〇]+|[嗯啊哦好行对是]|[a-zA-Z]|[。,.，…!！?？]+)$/;

const SIGNALS = [
  "累",
  "疲惫",
  "没力气",
  "撑不住",
  "耗尽",
  "困",
  "不想动",
  "难受",
  "烦",
  "堵",
  "空",
  "麻木",
  "委屈",
  "害怕",
  "焦虑",
  "慌",
  "压力",
  "孤单",
  "纠结",
  "脑子乱",
  "胃不舒服",
];

const normalizeDigit = (value: string) => {
  const normalized = value.trim().replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xff10 + 0x30)
  );
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

const getRecentUserMessages = (recentMessages: AiConversationMessage[]) =>
  recentMessages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean);

const collectKnownSignals = (userInputs: string[]) => {
  const text = userInputs.join("\n");
  return SIGNALS.filter((signal) => text.includes(signal));
};

const choosePrimarySignal = (knownSignals: string[]) => {
  if (knownSignals.some((signal) => /累|疲惫|没力气|撑不住|耗尽|困|不想动/.test(signal))) {
    return "累";
  }
  if (knownSignals.includes("烦")) return "烦";
  if (knownSignals.some((signal) => /难受|堵|空|麻木|委屈|焦虑|慌|压力/.test(signal))) {
    return "这个感觉";
  }
  if (knownSignals.includes("孤单")) return "孤单";
  return "这件事";
};

const getNumericValues = (userInputs: string[]) =>
  userInputs
    .map((input) => normalizeDigit(input))
    .filter((value): value is number => value !== null);

const getNumericTrend = (values: number[]): SlowChatContinuity["numericTrend"] => {
  if (values.length === 0) return "none";
  if (values.length === 1) return "first";

  const previous = values[values.length - 2];
  const current = values[values.length - 1];
  if (current < previous) return "decreasing";
  if (current > previous) return "increasing";
  if (current === previous) return "same";
  return "mixed";
};

const getExpressionMode = (userMessage: string): ExpressionMode => {
  const text = userMessage.trim();
  if (CRISIS_PATTERN.test(text)) return "crisis";
  if (CORRECTION_PATTERN.test(text)) return "correction";
  if (BOUNDARY_PATTERN.test(text)) return "boundary";
  if (ADVICE_PATTERN.test(text)) return "advice";
  if (NUMBER_PATTERN.test(text)) return "number";
  if (SYMBOL_PATTERN.test(text)) return "symbol";
  if (SILENCE_PATTERN.test(text) || /^(嗯|啊|哦|好|行|对|是)$/.test(text)) return "silence-ish";
  if (text.length <= 4) return "word";
  return "sentence";
};

const getRelationshipStage = ({
  userInputs,
  knownSignals,
  recentBoundary,
}: {
  userInputs: string[];
  knownSignals: string[];
  recentBoundary: boolean;
}): RelationshipStage => {
  if (recentBoundary) return "present";
  if (userInputs.length <= 1) return "stranger";
  if (userInputs.length >= 6 && knownSignals.length >= 2) return "opening";
  if (/怎么办|怎么做|理一下|看看|一起/.test(userInputs.join("\n"))) return "organizing";
  return "present";
};

const buildObservation = ({
  expressionMode,
  primarySignal,
  numericTrend,
  repeatedLowInformation,
}: {
  expressionMode: ExpressionMode;
  primarySignal: string;
  numericTrend: SlowChatContinuity["numericTrend"];
  repeatedLowInformation: boolean;
}) => {
  if (expressionMode === "number") {
    if (numericTrend === "decreasing") return "用户在用数字表达，数字正在往下走。";
    if (numericTrend === "increasing") return "用户在用数字表达，数字比刚才高了一点。";
    if (numericTrend === "same") return "用户重复了同一个数字，像是在维持连接。";
    return "用户选择用数字表达，而不是解释原因。";
  }
  if (repeatedLowInformation) return "用户连续给出很短的回应，更需要低压陪着。";
  if (expressionMode === "boundary") return "用户正在划边界，需要收住。";
  if (expressionMode === "correction") return "用户正在纠正，需要修复关系。";
  return `用户当前主要信号是：${primarySignal}。`;
};

export const buildSlowChatState = ({
  userMessage,
  recentMessages,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
}): SlowChatState => {
  const recentUserInputs = [...getRecentUserMessages(recentMessages), userMessage.trim()].slice(-8);
  const knownSignals = collectKnownSignals(recentUserInputs);
  const primarySignal = choosePrimarySignal(knownSignals);
  const expressionMode = getExpressionMode(userMessage);
  const recentText = recentUserInputs.join("\n");
  const recentBoundary = BOUNDARY_PATTERN.test(recentText);
  const repeatedLowInformation =
    recentUserInputs.slice(-4).filter((input) => LOW_INFORMATION_PATTERN.test(input)).length >= 2;
  const numericValues = getNumericValues(recentUserInputs);
  const numericTrend = getNumericTrend(numericValues);
  const relationshipStage = getRelationshipStage({ userInputs: recentUserInputs, knownSignals, recentBoundary });

  let rhythm: Rhythm = "soft_echo";
  let presenceMode: PresenceMode = "anchor";
  let responseIntent = "接住用户当前这一下，不急着解释。";
  let responseShape = "一句短回复；贴着用户刚给出的内容，不补场景。";

  if (expressionMode === "crisis") {
    rhythm = "organize";
    presenceMode = "safety";
    responseIntent = "先把安全放在第一位。";
    responseShape = "一句确认重视；一句现实安全动作。";
  } else if (expressionMode === "correction") {
    rhythm = "hold";
    presenceMode = "repair";
    responseIntent = "承认没接住，修复关系。";
    responseShape = "只承认偏差并回到用户已说事实，不继续解释。";
  } else if (expressionMode === "boundary" || recentBoundary) {
    rhythm = "hold";
    presenceMode = "quiet";
    responseIntent = "记住边界，降低压迫感。";
    responseShape = "一句短回复；不追问，不要求用户证明还在。";
  } else if (expressionMode === "number") {
    rhythm = numericTrend === "decreasing" ? "soft_echo" : "hold";
    presenceMode = numericTrend === "first" || numericTrend === "same" ? "quiet" : "witness";
    responseIntent = "把数字当作连续状态，而不是当作要解释的内容。";
    responseShape = "一句话观察数字或强度变化；不要求原因。";
  } else if (expressionMode === "symbol" || expressionMode === "silence-ish") {
    rhythm = repeatedLowInformation ? "hold" : "soft_echo";
    presenceMode = repeatedLowInformation ? "permission" : "quiet";
    responseIntent = "允许用户少说、不完整地停留。";
    responseShape = "一句很短的话；必要时只确认在场，不打开新问题。";
  } else if (expressionMode === "advice") {
    rhythm = relationshipStage === "organizing" ? "organize" : "small_open";
    presenceMode = "invite";
    responseIntent = "只给一个可撤回的小整理入口。";
    responseShape = "先接住犹豫，再给一个很小选择，不替用户决定。";
  } else if (relationshipStage === "opening") {
    rhythm = "follow";
    presenceMode = "invite";
    responseIntent = "跟随用户已经打开的一点点。";
    responseShape = "短承接；只给一个很小入口。";
  }

  const observation = buildObservation({
    expressionMode,
    primarySignal,
    numericTrend,
    repeatedLowInformation,
  });

  return {
    relationshipStage,
    expressionMode,
    rhythm,
    presenceMode,
    continuity: {
      recentUserInputs,
      knownSignals,
      primarySignal,
      recentBoundary,
      repeatedLowInformation,
      numericValues,
      numericTrend,
      observation,
      shouldMentionObservation:
        expressionMode === "number" && (numericTrend === "same" || numericTrend === "decreasing" || numericTrend === "increasing"),
    },
    responseIntent,
    responseShape,
  };
};

export const buildSlowChatOSGuidance = ({
  userMessage,
  recentMessages,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
}) => {
  const state = buildSlowChatState({ userMessage, recentMessages });

  return [
    "慢聊 OS 状态：",
    `- 关系阶段 relationshipStage：${state.relationshipStage}`,
    `- 表达模式 expressionMode：${state.expressionMode}`,
    `- 节奏 rhythm：${state.rhythm}`,
    `- 在场方式 presenceMode：${state.presenceMode}`,
    `- 已知信号 knownSignals：${state.continuity.knownSignals.join("、") || "暂无"}`,
    `- 连续观察 continuity：${state.continuity.observation}`,
    `- 本轮意图：${state.responseIntent}`,
    `- 回复形状：${state.responseShape}`,
    "- 回复先服从状态，再考虑措辞；不要每轮重新开始。",
  ].join("\n");
};
