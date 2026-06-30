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
    triggers: ["不是", "不对", "现在是", "其实", "我说的是", "下雨", "白天", "下午", "晚上"],
    guidance:
      "如果用户纠正你或补充事实，先承认刚才说偏了或简短确认事实；不要继续圆之前的说法，不要发散到新场景，不要追问。天气/时间这类事实只确认，例如“嗯，今天下雨了。”",
  },
  {
    id: "short-uncertain-answer",
    title: "用户短答或不知道",
    triggers: ["不知道", "还好", "嗯", "没有", "随便", "说不上来", "不知道怎么说"],
    guidance:
      "用户短答时不要硬追问，也不要解释用户为什么这样。可以说“不知道也可以”“先不用说清楚”，然后停住。",
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
    triggers: ["累", "疲惫", "没力气", "撑不住", "烦", "困", "压力"],
    guidance:
      "用户表达疲惫时，先承认累是真实的；不要急着给方法，也不要把原因说满。可以用很短的话陪住。",
  },
  {
    id: "asks-for-advice",
    title: "用户明确要建议",
    triggers: ["怎么办", "怎么做", "建议", "要不要", "该不该", "帮我想"],
    guidance:
      "只有用户明确要建议时才给建议。建议要小、可选、低压力，不替用户做决定。",
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
  if (item.id === "repair-after-correction" && /不是|不对|现在是|其实/.test(userMessage)) {
    score += 5;
  }
  if (item.id === "short-uncertain-answer" && userMessage.trim().length <= 8) score += 2;
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
