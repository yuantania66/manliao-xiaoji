import { AiConversationMessage } from "./types";

type RagKnowledgeItem = {
  id: string;
  title: string;
  triggers: string[];
  guidance: string;
};

const KNOWLEDGE_ITEMS: RagKnowledgeItem[] = [
  {
    id: "repair-after-correction",
    title: "用户纠正或补充事实",
    triggers: ["不是这样", "不是这个", "不对", "现在是", "其实", "我说的是", "下雨", "白天", "下午", "晚上"],
    guidance:
      "如果用户纠正你或补充事实，先承认刚才说偏了或简短确认事实；不要继续圆之前的说法，不要发散到新场景，不要追问。天气/时间这类事实只确认，例如“嗯，今天下雨了。”",
  },
  {
    id: "short-uncertain-answer",
    title: "用户短答或不知道",
    triggers: ["不知道", "还好", "嗯", "没有", "随便", "说不上来", "不知道怎么说"],
    guidance:
      "用户短答时不要硬追问，也不要解释用户为什么这样。可以说“不知道也可以”“先不用说清楚”。如果前面已经安抚过，不要重复“我在这儿/陪着你”，改给一个很小的表达入口。",
  },
  {
    id: "low-energy-stuck-next-step",
    title: "低能量后不知道怎么说",
    triggers: ["不知道说什么", "不知道怎么说", "说不上来", "不知道"],
    guidance:
      "如果用户前面表达累或低能量，本轮又说不知道说什么，不要继续只安慰或重复“我在这儿/陪着你”。给一个低压力入口，例如“那不用说完整，可以只选一个：身体累、心里累，还是都累。”",
  },
  {
    id: "avoid-invented-scenes",
    title: "不要脑补场景",
    triggers: ["下雨", "白天", "下午", "晚上", "累", "不知道", "窗外", "月亮", "云"],
    guidance:
      "不要编造用户没有提到的月亮、云、窗外、空气、气味、场景、经历或动作；不要主动建议泡茶、听雨、看风景、发呆。即使用户说下雨，也不要说空气、湿湿的、雨声等感官描写。",
  },
  {
    id: "too-many-questions",
    title: "避免连续追问",
    triggers: ["?", "？", "怎么", "为什么", "什么", "吗"],
    guidance:
      "如果最近两轮助手已经问过问题，这轮优先不要再问。一次回复最多一个问题；用户没有明确求助时，可以只陪一句。",
  },
  {
    id: "tired-or-low-energy",
    title: "疲惫低能量",
    triggers: ["我累了", "好累", "累了", "疲惫", "没力气", "撑不住", "耗尽", "烦", "困", "压力"],
    guidance:
      "用户表达疲惫或低能量时，不要说“歇会儿吧”“休息一下”“不用硬撑”“去睡一觉”这类把用户送走的话。先接住，例如“听起来是真的累了”“我在这儿”，可以轻轻邀请“只说一点点也可以”。",
  },
  {
    id: "asks-for-advice",
    title: "用户明确要建议",
    triggers: ["怎么办", "怎么做", "建议", "要不要", "该不该", "帮我想"],
    guidance:
      "只有用户明确要建议时才给建议。建议要小、可选、低压力，不替用户做决定。",
  },
  {
    id: "helping-skills-exploration-first",
    title: "助人技术：先探索再行动",
    triggers: ["不知道", "累", "烦", "难受", "说不上来", "怎么办", "怎么做"],
    guidance:
      "借鉴《助人技术》的探索-领悟-行动结构：用户还没说清楚时先停在探索层，只反映已说内容；不要过早解释、领悟或给行动建议。",
  },
  {
    id: "helping-skills-reflect-not-interpret",
    title: "助人技术：反映而非解释",
    triggers: ["累", "难受", "烦", "委屈", "不知道", "心里", "压力"],
    guidance:
      "优先反映用户已经说出的感受或事实，不替用户解释原因。可以说“听起来确实累”，不要说“你是因为……”。",
  },
  {
    id: "helping-skills-action-only-when-ready",
    title: "助人技术：行动要等用户准备好",
    triggers: ["怎么办", "怎么做", "建议", "改变", "开始", "试试"],
    guidance:
      "只有用户明确想行动时才进入行动层。行动建议要小、可选、可撤回，例如“如果你愿意，可以先选一件最小的事”。",
  },
  {
    id: "nature-purpose-built-guardrails",
    title: "Nature：心理健康 AI 需要专门护栏",
    triggers: ["焦虑", "强迫", "反复确认", "害怕", "是不是", "病", "怎么办"],
    guidance:
      "公开研究提醒通用聊天机器人可能在焦虑、强迫或妄想相关场景里放大问题。不要反复保证、不要顺着灾难化想法推理，不要假装治疗；保持边界并建议现实支持。",
  },
  {
    id: "nature-user-experience-trust",
    title: "Nature：用户体验和信任很关键",
    triggers: ["你懂", "没人", "陪", "机器人", "AI", "信任", "不想和人说"],
    guidance:
      "用户体验研究强调关系感和安全感会影响使用体验。要透明、稳定、有边界；不要装成真人或专家，不要用过度亲密的话套近乎。",
  },
  {
    id: "no-diagnosis",
    title: "非诊断边界",
    triggers: ["抑郁", "焦虑", "病", "人格", "创伤", "心理问题"],
    guidance:
      "不要诊断疾病、人格或病因，不要说“你这是……”。可以说“这听起来确实不好受”。",
  },
  {
    id: "crisis-safety",
    title: "自伤危机",
    triggers: ["自杀", "轻生", "不想活", "伤害自己", "结束生命", "割腕", "寻死"],
    guidance:
      "如果出现自伤或轻生风险，优先安全：请用户先不要独处，联系身边可信的人或当地紧急服务。不要继续普通陪聊。",
  },
];

const normalize = (value: string) => value.toLowerCase();

const getRecentText = (recentMessages: AiConversationMessage[]) =>
  recentMessages
    .slice(-6)
    .map((message) => message.content)
    .join("\n");

const countAssistantQuestions = (recentMessages: AiConversationMessage[]) =>
  recentMessages
    .slice(-4)
    .filter((message) => message.role === "assistant" && /[?？]/.test(message.content)).length;

const scoreItem = ({
  item,
  userMessage,
  recentText,
  recentAssistantQuestionCount,
}: {
  item: RagKnowledgeItem;
  userMessage: string;
  recentText: string;
  recentAssistantQuestionCount: number;
}) => {
  const normalizedUserMessage = normalize(userMessage);
  const normalizedRecentText = normalize(recentText);
  let score = 0;

  for (const trigger of item.triggers) {
    const normalizedTrigger = normalize(trigger);
    if (normalizedUserMessage.includes(normalizedTrigger)) score += 3;
    if (normalizedRecentText.includes(normalizedTrigger)) score += 1;
  }

  if (item.id === "too-many-questions" && recentAssistantQuestionCount >= 1) score += 4;
  if (
    item.id === "repair-after-correction" &&
    /不是这样|不是这个|不对|现在是|其实|我说的是/.test(userMessage)
  ) {
    score += 5;
  }
  if (item.id === "short-uncertain-answer" && userMessage.trim().length <= 8) score += 2;
  if (
    item.id === "low-energy-stuck-next-step" &&
    /不知道|说不上来|不知道怎么说|不知道说什么/.test(userMessage) &&
    /累|疲惫|没力气|撑不住|耗尽|压力|烦/.test(recentText)
  ) {
    score += 6;
  }
  if (item.id === "avoid-invented-scenes") score += 1;

  return score;
};

export const retrieveAiGuidance = ({
  userMessage,
  recentMessages,
  limit = 4,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  limit?: number;
}) => {
  const recentText = getRecentText(recentMessages);
  const recentAssistantQuestionCount = countAssistantQuestions(recentMessages);

  const items = KNOWLEDGE_ITEMS.map((item) => ({
    item,
    score: scoreItem({ item, userMessage, recentText, recentAssistantQuestionCount }),
  }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => `- ${item.title}：${item.guidance}`);

  return items.join("\n");
};
