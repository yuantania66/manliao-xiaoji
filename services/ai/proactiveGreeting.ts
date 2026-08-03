import { PROACTIVE_GREETING_PROMPT_VERSION } from "@/lib/proactive-greeting";
import { AppError } from "@/lib/errors";
import { formatAssistantGroundingForPrompt } from "@/conversation-os/control";

import { callModel, getDefaultAiModel, isAiProviderConfigured } from "./modelProvider";
import { AiConversationMessage, AiGenerationResult, AiModelMessage } from "./types";
import { inspectPromptBeforeExternalCall } from "./externalPromptInspection";

type ProactiveGreetingKind = "initial" | "return";
export type ProactiveGreetingMove =
  | "simple_greeting"
  | "open_statement"
  | "light_question";

const SAFE_DETERMINISTIC_GREETINGS: Record<ProactiveGreetingMove, string[]> = {
  simple_greeting: ["你好。", "嗨。", "哈喽。"],
  open_statement: ["我先来打个招呼。", "先说一声你好。", "今天先简单问个好。"],
  light_question: [
    "最近有没有哪句话还记得？",
    "最近见到的颜色里，哪一种最醒目？",
    "最近吃过的东西里，哪样还有印象？",
  ],
};

const previewHistory = (messages: AiConversationMessage[]) =>
  messages
    .slice(-6)
    .map((message) => `${message.role === "assistant" ? "AI" : "用户"}：${message.content}`)
    .join("\n");

export const buildProactiveGreetingMessages = ({
  kind,
  move,
  recentMessages,
  recentGreetings = [],
  repairInstruction,
}: {
  kind: ProactiveGreetingKind;
  move: ProactiveGreetingMove;
  recentMessages: AiConversationMessage[];
  recentGreetings?: string[];
  repairInstruction?: string;
}): AiModelMessage[] => [
  {
    role: "developer",
    content: [
      formatAssistantGroundingForPrompt(),
      "完成一个主动欢迎动作：自然地与用户建立接触，不把回答义务默认交给用户。",
      "欢迎语不等于提问。问候、无需回应的自然开场和轻量问题都是合法动作；本轮只实现指定动作。",
      move === "simple_greeting"
        ? "本轮动作是 simple_greeting：只做一句简短、自然的问候，不追加问题、话题任务、许可或陪伴声明。"
        : move === "open_statement"
          ? "本轮动作是 open_statement：说一句自足的自然开场，不使用问号，不要求用户回答，也不把沉默包装成许可或等待。"
          : "本轮动作是 light_question：只问一个具体、轻量、能用几个字回答的问题，不要求用户先寻找主题。",
      "只输出一句自然口语中文。句子可以有克制的口语感，但不要卖萌、说教、鸡汤、客服腔或心理咨询开场腔。",
      "不要输出许可声明、陪伴声明、等待姿态或泛泛的“想聊什么”。",
      "只能使用最近对话中用户明确说过的内容，以及不依赖用户状态的中性日常话题。",
      "不得猜测用户的情绪、活动、地点、所在地时区、当地时间、昼夜阶段、关系、来访频率或现实环境；不得虚构助手自己的身体、感知、偏好、经历或当下心理活动。",
      "不要写任何地名、星期、时段、饭点、天气、天色或“现在适合聊天”之类的判断。系统没有用户所在地和当地时间。",
      "不要让用户执行休息、喝水、睡觉、出门等动作，也不要把问题做成强迫二选一。",
      kind === "initial"
        ? "这是进入聊天时的第一句：严格按指定动作生成，不依赖历史背景。"
        : "这是用户隔了一段时间回来时的第一句：严格按指定动作生成；动作允许展开时，才可轻量承接最近对话中的明确内容。",
      recentGreetings.length > 0
        ? [
            `最近 ${recentGreetings.slice(0, 3).length} 条欢迎语已纳入内部防重复校验；本次更换动作、句式，并在涉及话题时更换话题。`,
            `近期已使用的开场动作：${recentGreetings.map(proactiveGreetingMove).join(" / ")}。`,
            `近期已使用的话题类别：${Array.from(new Set(
              recentGreetings.flatMap(proactiveGreetingTopics)
            )).join(" / ") || "none"}。涉及具体话题时不得再次使用这些类别。`,
          ].join("\n")
        : "当前没有可供比较的近期欢迎语。",
      repairInstruction,
    ].join("\n"),
  },
  ...(recentMessages.length > 0
    ? [
        {
          role: "developer" as const,
          content: `最近对话，只用于判断语气和连续感：\n${previewHistory(recentMessages)}`,
        },
      ]
    : []),
  {
    role: "user",
    content: "请生成慢聊小记此刻主动对用户说的第一句话。",
  },
];

const cleanGreeting = (value: string) =>
  value
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const UNSUPPORTED_RELATION_JUDGMENT_PATTERN =
  /难得|好久不见|很久不见|好久没来|很久没来|终于来了|终于来|终于上来|又来了|又来啦|又上来/;

const PROACTIVE_GREETING_TOPIC_PATTERNS = [
  { topic: "music", pattern: /歌|音乐|旋律|歌词|歌单|单曲|曲子/u },
  { topic: "film_or_video", pattern: /电影|影视|剧|综艺|动画|视频|片段|台词|角色/u },
  { topic: "food_or_drink", pattern: /吃|饭|菜|味道|早餐|午餐|晚餐|零食|饮料|咖啡|茶/u },
  { topic: "reading_or_words", pattern: /书|小说|文章|阅读|文字|词语|一个词|故事/u },
  { topic: "photo_or_color", pattern: /照片|相册|颜色|色彩|画面|图画/u },
  { topic: "objects", pattern: /东西|物件|物品|顺手|常用/u },
  { topic: "places_or_shops", pattern: /地方|店铺|小店|街道|路过|公园/u },
  { topic: "sound", pattern: /声音|声响/u },
] as const;

export const proactiveGreetingTopics = (value: string) =>
  PROACTIVE_GREETING_TOPIC_PATTERNS
    .filter((item) => item.pattern.test(value))
    .map((item) => item.topic);

const SIMPLE_GREETING_PATTERN =
  /^(?:你好|嗨|哈喽)[。！!]?$/u;

export const proactiveGreetingMove = (value: string): ProactiveGreetingMove => {
  if (/[？?]/u.test(value)) return "light_question";
  if (SIMPLE_GREETING_PATTERN.test(value.trim())) return "simple_greeting";
  return "open_statement";
};

export const selectProactiveGreetingMove = ({
  kind,
  recentGreetings = [],
}: {
  kind: ProactiveGreetingKind;
  recentGreetings?: string[];
}): ProactiveGreetingMove => {
  const recentMoves = recentGreetings.slice(-2).map(proactiveGreetingMove);
  if (recentMoves.length === 0) {
    return kind === "initial" ? "simple_greeting" : "open_statement";
  }
  if (recentMoves.includes("light_question")) {
    return recentMoves.at(-1) === "open_statement"
      ? "simple_greeting"
      : "open_statement";
  }
  return recentMoves.at(-1) === "simple_greeting"
    ? "open_statement"
    : "light_question";
};

const normalizeGreetingForSimilarity = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\s，。！？、,.!?：:；;“”"'‘’（）()…—-]/gu, "");

const toCharacterBigrams = (value: string) => {
  const normalized = normalizeGreetingForSimilarity(value);
  if (normalized.length < 2) return new Set(normalized ? [normalized] : []);
  return new Set(
    Array.from({ length: normalized.length - 1 }, (_, index) =>
      normalized.slice(index, index + 2)
    )
  );
};

export const proactiveGreetingSimilarity = (left: string, right: string) => {
  const normalizedLeft = normalizeGreetingForSimilarity(left);
  const normalizedRight = normalizeGreetingForSimilarity(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  const leftBigrams = toCharacterBigrams(normalizedLeft);
  const rightBigrams = toCharacterBigrams(normalizedRight);
  const overlap = [...leftBigrams].filter((item) => rightBigrams.has(item)).length;
  return (2 * overlap) / (leftBigrams.size + rightBigrams.size);
};

export const validateProactiveGreeting = (
  value: string,
  recentGreetings: string[] = [],
  expectedMove?: ProactiveGreetingMove
) => {
  if (!value) return "输出为空。";
  const currentMove = proactiveGreetingMove(value);
  if (
    /(?:随时(?:都)?可以|你可以|这里可以|可以放下|想说(?:什么)?就说|想说的时候再说|说不说都可以|从(?:任何地方|哪里)开始(?:都)?可以|准备好了就开口|慢慢说出来就好|不用(?:想清楚|组织|着急)|不急|没关系)/u.test(value)
  ) {
    return "使用了许可、等待或安抚式开场，没有由助手承担启动成本。";
  }
  if (
    /(?:只是|就|先)?(?:安静地?)?(?:待一会儿|待会儿|待着|坐一会儿)|我(?:会|就)?在(?:这里|这儿)|陪你|先不说(?:也行)?/u.test(value)
  ) {
    return "在对话开始前进入了陪伴、等待或收口姿态。";
  }
  if (
    /有什么.{0,5}(?:想聊|想说)|想聊(?:点)?什么|想说(?:点)?什么|说点什么|今天想说|最近怎么样|今天过得怎么样|现在感觉怎么样|感觉还好吗|你好吗|随便聊聊|从哪里开始|心里的话/u.test(value)
  ) {
    return "问题过于空泛，仍把寻找话题的成本交给用户。";
  }
  if (UNSUPPORTED_RELATION_JUDGMENT_PATTERN.test(value)) {
    return "包含无证据的来访频率或关系判断。";
  }
  if (/上海|北京|广州|深圳|杭州|成都|重庆|武汉|西安|南京|苏州|天津|长沙|在家|出门|上班|学习|窗外|天气|蝉|雨|太阳|风|窗台|窗边|叶子|树影|影子|光线|屋檐|房间|云|天空|我刚刚.*(想|看到|听到)|我这边|我这里|我喜欢|我想起|让我想到/.test(value)) {
    return "包含无证据的场景、活动或环境判断。";
  }
  if (/躺|休息|喝水|睡觉|出去走|出门|打发时间|消磨时间/.test(value)) {
    return "包含行动建议或轻浮的时间评价。";
  }
  if (
    /周[一二三四五六日天]|星期[一二三四五六日天]|清晨|早晨|早上|上午|中午|下午|傍晚|黄昏|晚上|夜晚|夜里|入夜|深夜|凌晨|天亮|天黑|日落|饭点|这会儿|这个时间/u.test(value)
  ) {
    return "包含无依据的用户当地时间、时段或昼夜判断。";
  }
  if (/(?:正好|很|挺)?适合.{0,8}(?:聊|说)|(?:聊|说).{0,8}(?:正好|很|挺)?适合/u.test(value)) {
    return "擅自判断当前时刻适合聊天。";
  }
  if (/～|[呀呢啦哦]{2,}/u.test(value)) {
    return "包含过度卖萌或客服式语气词。";
  }
  if (/是.*还是/.test(value)) {
    return "包含强迫二选一的问题。";
  }
  if ((value.match(/[？?]/gu) ?? []).length > 1) {
    return "一次提出了多个问题，增加了开场负担。";
  }
  if (
    expectedMove === "light_question" &&
    currentMove !== "light_question"
  ) {
    return "没有实现本轮指定的轻量问题动作。";
  }
  if (
    expectedMove &&
    expectedMove !== "light_question" &&
    currentMove === "light_question"
  ) {
    return "本轮指定为非问题开场，却再次把回答义务交给了用户。";
  }
  if (
    currentMove === "light_question" &&
    recentGreetings.slice(-2).some((recent) =>
      proactiveGreetingMove(recent) === "light_question"
    )
  ) {
    return "最近三次欢迎中已经使用过问题，不能再次把回答义务交给用户。";
  }
  const repeatedGreeting = recentGreetings.find(
    (recent) => proactiveGreetingSimilarity(value, recent) >= 0.72
  );
  if (repeatedGreeting) {
    return "与最近欢迎语相同或高度相似。";
  }
  const currentTopics = new Set(proactiveGreetingTopics(value));
  const repeatedTopic = recentGreetings.find((recent) =>
    proactiveGreetingTopics(recent).some((topic) => currentTopics.has(topic))
  );
  if (repeatedTopic) {
    return "重复了最近欢迎语已经使用过的日常话题。";
  }
  return null;
};

export const generateProactiveGreeting = async ({
  kind,
  recentMessages,
  recentGreetings = [],
  inspectExternalPrompt,
}: {
  kind: ProactiveGreetingKind;
  recentMessages: AiConversationMessage[];
  recentGreetings?: string[];
  inspectExternalPrompt?: (input: {
    stage: "proactive_greeting";
    messages: AiModelMessage[];
  }) => void | Promise<void>;
}): Promise<AiGenerationResult> => {
  if (!isAiProviderConfigured()) {
    throw new AppError("AI_GENERATION_FAILED", "AI 主动问候模型未配置", 502);
  }

  const model =
    process.env.AI_PROACTIVE_GREETING_MODEL?.trim() ||
    process.env.AI_MAIN_MODEL?.trim() ||
    getDefaultAiModel();
  const move = selectProactiveGreetingMove({ kind, recentGreetings });

  const useDeterministicGreeting = process.env.PROACTIVE_GREETING_MODE?.trim() === "deterministic";
  if (useDeterministicGreeting) {
    const deterministicGreeting = SAFE_DETERMINISTIC_GREETINGS[move].find(
      (candidate) => !validateProactiveGreeting(candidate, recentGreetings, move)
    );
    if (!deterministicGreeting) {
      throw new AppError("AI_GENERATION_FAILED", "固定主动问候未通过约束", 502, {
        rejectionReason: "当前动作没有不重复的固定问候候选。",
      });
    }
    return {
      text: deterministicGreeting,
      model: "deterministic",
      promptVersion: PROACTIVE_GREETING_PROMPT_VERSION,
      latencyMs: 0,
    };
  }

  const generateOnce = async (repairInstruction?: string) => {
    const messages = buildProactiveGreetingMessages({
      kind,
      move,
      recentMessages,
      recentGreetings,
      repairInstruction,
    });
    await inspectPromptBeforeExternalCall(inspectExternalPrompt, {
      stage: "proactive_greeting" as const,
      messages,
    });
    return callModel({
      model,
      messages,
      temperature: 0.85,
    });
  };

  let response = await generateOnce();
  let text = cleanGreeting(response.text);
  const rejectionReason = validateProactiveGreeting(text, recentGreetings, move);
  if (rejectionReason) {
    response = await generateOnce(
      `上一句“${text}”不合格，原因：${rejectionReason} 请严格按本轮指定动作重写一句；不要照抄旧句，并继续遵守以上事实与安全边界。`
    );
    text = cleanGreeting(response.text);
  }

  const finalRejectionReason = validateProactiveGreeting(text, recentGreetings, move);
  if (finalRejectionReason) {
    throw new AppError("AI_GENERATION_FAILED", "主动问候未通过自然度约束", 502, {
      rejectionReason: finalRejectionReason,
      model: response.model,
    });
  }

  return {
    ...response,
    text,
    promptVersion: PROACTIVE_GREETING_PROMPT_VERSION,
  };
};
