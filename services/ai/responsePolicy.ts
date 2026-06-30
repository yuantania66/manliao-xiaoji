import { AiConversationMessage } from "./types";

type ConversationSignals = {
  isCrisis: boolean;
  isCorrection: boolean;
  asksForAdvice: boolean;
  isVagueOrStuck: boolean;
  hasLowEnergyOrDistress: boolean;
  previousAssistantMove: "none" | "validation" | "question" | "advice" | "micro_entry";
};

const CRISIS_PATTERN = /自杀|轻生|不想活|伤害自己|结束生命|割腕|寻死/;
const CORRECTION_PATTERN = /不是这样|不是这个|不对|现在是|其实|我说的是/;
const ADVICE_PATTERN = /怎么办|怎么做|建议|要不要|该不该|帮我想|你觉得/;
const VAGUE_OR_STUCK_PATTERN = /不知道|说不上来|没什么|随便|都行|不知道怎么说|不知道说什么/;
const LOW_ENERGY_OR_DISTRESS_PATTERN =
  /累|疲惫|没力气|撑不住|耗尽|难受|烦|崩|压力|委屈|害怕|焦虑|慌|空|麻木/;

const detectPreviousAssistantMove = (
  recentMessages: AiConversationMessage[]
): ConversationSignals["previousAssistantMove"] => {
  const lastAssistant = recentMessages
    .slice()
    .reverse()
    .find((message) => message.role === "assistant");

  if (!lastAssistant) return "none";

  const content = lastAssistant.content;
  if (/身体累|心里累|都累|选一个|一个词|哪一|最重|最明显/.test(content)) {
    return "micro_entry";
  }
  if (/怎么办|试试|可以先|建议|选择|步骤/.test(content)) {
    return "advice";
  }
  if (/[?？]/.test(content)) {
    return "question";
  }
  if (/我在这儿|陪着你|陪你|听起来|确实|不容易|没关系|不用说清楚/.test(content)) {
    return "validation";
  }

  return "none";
};

const detectSignals = ({
  userMessage,
  recentMessages,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
}): ConversationSignals => ({
  isCrisis: CRISIS_PATTERN.test(userMessage),
  isCorrection: CORRECTION_PATTERN.test(userMessage),
  asksForAdvice: ADVICE_PATTERN.test(userMessage),
  isVagueOrStuck: VAGUE_OR_STUCK_PATTERN.test(userMessage),
  hasLowEnergyOrDistress: LOW_ENERGY_OR_DISTRESS_PATTERN.test(userMessage),
  previousAssistantMove: detectPreviousAssistantMove(recentMessages),
});

const chooseMove = (signals: ConversationSignals) => {
  if (signals.isCrisis) {
    return "安全优先：先确认当下安全，建议联系身边可信的人或当地紧急服务。";
  }
  if (signals.isCorrection) {
    return "修正偏差：承认刚才说偏了，回到用户刚补充的事实，不继续圆旧说法。";
  }
  if (signals.asksForAdvice) {
    return "小建议：只给一个低压力、可选、可撤回的小步骤，不替用户决定。";
  }
  if (signals.isVagueOrStuck && signals.previousAssistantMove === "validation") {
    return "微入口：不要重复安抚；给一个具体、容易回答的入口，例如二选一、一个词、身体/心里哪个更重。不要把猜测包装成“是不是……”。";
  }
  if (signals.isVagueOrStuck) {
    return "允许模糊：先允许说不清，再给一个很小的表达入口；不要问抽象大问题，也不要替用户判断状态。";
  }
  if (signals.hasLowEnergyOrDistress) {
    return "接住感受：准确反映用户已经说出的感受，再给一个轻微入口；不要直接建议休息或转移注意。";
  }

  return "贴近复述：只回应用户明确说出的内容，必要时问一个具体小问题。";
};

export const buildResponsePolicyGuidance = ({
  userMessage,
  recentMessages,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
}) => {
  const signals = detectSignals({ userMessage, recentMessages });
  const move = chooseMove(signals);

  return [
    "通用回应策略：",
    `- 本轮帮助动作：${move}`,
    "- 每轮只做一个帮助动作：反映、修正、微入口、小建议或安全支持，不要混在一起。",
    "- 如果用户没有给出新信息，不要重复上一轮同一种安慰话术；换成更具体、更容易回答的入口。",
    "- 用户模糊、短答或卡住时，不要问“想说什么/为什么/发生了什么”这类大问题；给一个低压力选项或一个词入口。",
    "- 微入口只能提供可选入口，不能预设答案；少用“是不是……”，除非用户已经明确说过同一件事。",
    "- 选项要自然口语，不要造词或为了对仗写出别扭表达。",
    "- 不要编造场景、天气、身体状态、人物关系或原因；只贴着用户已经说出的内容。",
    "- 除非用户明确要建议，否则不要给方法；给建议时也要小、可选、可拒绝。",
  ].join("\n");
};
