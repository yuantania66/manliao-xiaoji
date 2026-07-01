import { AiConversationMessage } from "./types";

type HelpingStage = "safety" | "repair" | "receive" | "explore" | "action" | "boundary";

type HelpingMove =
  | "safety_support"
  | "repair_misalignment"
  | "steady_reflection"
  | "tiny_exploration"
  | "one_small_step"
  | "clear_boundary";

type InteractionPlan = {
  stage: HelpingStage;
  move: HelpingMove;
  userGiven: string[];
  relationshipNeed: string;
  responseShape: string;
  naturalOpening: string;
  successCriteria: string;
};

const CRISIS_PATTERN = /自杀|轻生|不想活|伤害自己|结束生命|割腕|寻死/;
const CORRECTION_PATTERN = /不是这样|不是这个|不对|现在是|其实|我说的是|我都已经说了|已经说了|还问我|你回复得很假|套模板|别圆/;
const ADVICE_PATTERN = /怎么办|怎么做|建议|要不要|该不该|帮我想|你觉得|能做什么/;
const NO_PRESSURE_PATTERN = /不知道|说不上来|没什么|随便|都行|不知道怎么说|不知道说什么|别追问|别问|别让我想|别让我想太多|算了/;
const LOW_ENERGY_PATTERN = /累|疲惫|没力气|撑不住|耗尽|困|不想动/;
const DISTRESS_PATTERN = /难受|烦|崩|压力|委屈|害怕|焦虑|慌|空|麻木|堵/;
const BOUNDARY_PATTERN = /你也别装懂|别说你永远陪我|我知道你是AI|别替我决定|先别给步骤|不想被教育/;
const RECENT_BOUNDARY_PATTERN = /别问|别追问|别让我想|先别|别替我|不想被教育|别说你永远|不想说|不说也行/;

const KNOWN_TERMS = [
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
  "下雨",
  "白天",
  "胃不舒服",
];

const latestAssistant = (recentMessages: AiConversationMessage[]) =>
  recentMessages
    .slice()
    .reverse()
    .find((message) => message.role === "assistant")?.content || "";

const recentUserText = (recentMessages: AiConversationMessage[]) =>
  recentMessages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");

const collectUserGiven = (userMessage: string, recentMessages: AiConversationMessage[]) => {
  const text = `${recentUserText(recentMessages)}\n${userMessage}`;
  return KNOWN_TERMS.filter((term) => text.includes(term));
};

const hasAskedRecently = (recentMessages: AiConversationMessage[]) =>
  recentMessages
    .slice(-4)
    .some((message) => message.role === "assistant" && /[?？]/.test(message.content));

const hasRepeatedUncertainty = (userMessage: string, recentMessages: AiConversationMessage[]) =>
  NO_PRESSURE_PATTERN.test(userMessage) &&
  recentMessages
    .slice(-6)
    .filter((message) => message.role === "user" && NO_PRESSURE_PATTERN.test(message.content)).length >= 1;

const buildPlan = ({
  userMessage,
  recentMessages,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
}): InteractionPlan => {
  const userGiven = collectUserGiven(userMessage, recentMessages);
  const recentUser = recentUserText(recentMessages);
  const lastAssistant = latestAssistant(recentMessages);
  const repeatedUncertainty = hasRepeatedUncertainty(userMessage, recentMessages);
  const askedRecently = hasAskedRecently(recentMessages);
  const recentlySetBoundary = RECENT_BOUNDARY_PATTERN.test(recentUser);

  if (CRISIS_PATTERN.test(userMessage)) {
    return {
      stage: "safety",
      move: "safety_support",
      userGiven,
      relationshipNeed: "用户可能处于安全风险中，需要先稳住现实安全，而不是继续普通陪聊。",
      responseShape: "第一句明确在意和重视；第二句给现实安全动作：不要独处，联系身边可信的人或紧急求助。",
      naturalOpening: "用户下一步只需要确认自己是否安全，或说身边是否有人。",
      successCriteria: "回复把安全放第一位，同时不诊断、不讲大道理、不拖进深聊。",
    };
  }

  if (CORRECTION_PATTERN.test(userMessage)) {
    return {
      stage: "repair",
      move: "repair_misalignment",
      userGiven,
      relationshipNeed: "用户在指出不被理解，需要先修复关系和承认偏差。",
      responseShape: "第一句承认刚才没接住或问偏了；第二句回到用户已经说出的事实，不继续解释自己。",
      naturalOpening: "用户可以补一句事实，也可以停在刚刚那句话，不需要替助手纠错。",
      successCriteria: "用户读完会感觉助手收住了，而不是继续圆、继续问、继续表现自己。",
    };
  }

  if (BOUNDARY_PATTERN.test(userMessage)) {
    return {
      stage: "boundary",
      move: "clear_boundary",
      userGiven,
      relationshipNeed: "用户在划边界，需要尊重边界并降低关系压迫感。",
      responseShape: "第一句确认边界；第二句只说明会收住，不提出新问题，不引入用户没说过的时间、活动或状态。",
      naturalOpening: "用户可以停在这里，也可以自己决定是否继续补一句；助手不再索要回答。",
      successCriteria: "回复有边界感，不过度亲密，不装懂，不替用户决定，也不为了推进而另起一个问题。",
    };
  }

  if (ADVICE_PATTERN.test(userMessage)) {
    return {
      stage: "action",
      move: "one_small_step",
      userGiven,
      relationshipNeed: "用户开始要帮助，但仍需要可撤回的小步骤，而不是被安排。",
      responseShape: "先确认问题里的难处；再只给一个很小、可选、今天就能做到的下一步。",
      naturalOpening: "用户可以接受、拒绝，或调整这一步。",
      successCriteria: "回复不替用户做决定，也不一次给多条方案。",
    };
  }

  if (
    recentlySetBoundary &&
    (NO_PRESSURE_PATTERN.test(userMessage) ||
      LOW_ENERGY_PATTERN.test(userMessage) ||
      DISTRESS_PATTERN.test(userMessage) ||
      userMessage.trim().length <= 6)
  ) {
    return {
      stage: "receive",
      move: "steady_reflection",
      userGiven,
      relationshipNeed: "用户最近刚设过边界，后续短答需要延续这个边界，不要把对话重新推回追问。",
      responseShape: "只用一句话承接用户刚给出的感受或边界；不问新问题，不要求用户证明还在，不用句号或表情做入口，不引入天气、身体部位或活动场景。",
      naturalOpening: "用户可以停住，也可以自己补一句；助手不索要回答。",
      successCriteria: "回复让用户感觉边界被记住了，而不是每一轮都重新开始追问。",
    };
  }

  if (NO_PRESSURE_PATTERN.test(userMessage) || repeatedUncertainty) {
    const alreadyGaveFeeling = userGiven.length > 0;
    return {
      stage: askedRecently || repeatedUncertainty ? "receive" : "explore",
      move: askedRecently || repeatedUncertainty ? "steady_reflection" : "tiny_exploration",
      userGiven,
      relationshipNeed: "用户表达卡住或低表达意愿，需要减少负担，而不是继续索要解释。",
      responseShape: alreadyGaveFeeling
        ? "先承接已经给出的那个词；如果前面已经问过，就只用一句话停住，不继续给任务。"
        : "先允许说不清；如果要给入口，也要具体、很小、自然。",
      naturalOpening: alreadyGaveFeeling
        ? `用户已经给出“${userGiven.join("、")}”，下一句可以围绕它多说半句，也可以只说“嗯”。`
        : "用户下一句可以只说一个短词，不需要解释原因。",
      successCriteria: "用户不会觉得被考试、被催着表达，下一句有自然接法。",
    };
  }

  if (LOW_ENERGY_PATTERN.test(userMessage) || DISTRESS_PATTERN.test(userMessage)) {
    return {
      stage: "explore",
      move: "tiny_exploration",
      userGiven,
      relationshipNeed: "用户给出情绪或低能量信号，需要被准确接住，并留下自然可接的小入口。",
      responseShape: "第一句只反映用户明确说出的感受；第二句问一个具体、口语、低压力的小问题。",
      naturalOpening: "用户下一句可以回答一个很短的对比，例如今天/最近、身体/事情、轻一点/重一点。",
      successCriteria: "回复既没有把用户送走，也没有要求用户解释完整原因。",
    };
  }

  return {
    stage: "receive",
    move: "steady_reflection",
    userGiven,
    relationshipNeed: "用户给出的信息较少，先贴近回应，不急着解释或建议。",
    responseShape: "第一句复述或确认用户说出的事实；第二句只在必要时给一个具体小问题。",
    naturalOpening: lastAssistant ? "用户可以顺着当前话题继续补充。" : "用户可以继续说一个很短的细节。",
    successCriteria: "回复短、稳、贴着用户原话，不脑补场景和原因。",
  };
};

export const buildInteractionPlanGuidance = ({
  userMessage,
  recentMessages,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
}) => {
  const plan = buildPlan({ userMessage, recentMessages });

  return [
    "本轮互动计划：",
    `- 对话阶段：${plan.stage}`,
    `- 帮助动作：${plan.move}`,
    `- 用户已给信息：${plan.userGiven.join("、") || "暂无明确情绪/事实词"}`,
    `- 关系需求：${plan.relationshipNeed}`,
    `- 回复结构：${plan.responseShape}`,
    `- 自然接法：${plan.naturalOpening}`,
    `- 成功标准：${plan.successCriteria}`,
  ].join("\n");
};
