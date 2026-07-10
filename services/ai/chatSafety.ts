import { AiGenerationResult } from "./types";

export const SAFETY_PROMPT_VERSION = "safety-gate-v1";

const CRISIS_PATTERN =
  /自杀|轻生|不想活|不想活了|结束生命|伤害自己|伤害我自己|割腕|寻死|去死|杀了自己|消失.*没人.*在意|没人.*在意.*消失|杀人|杀了他|杀了她|砍人|捅人|报复社会|同归于尽|控制不住.*动手|找.*算账.*动手|可能会动手|打了我|打我了|刚刚打我|被打|家暴|躲在厕所|吃了.*很多药|吃.*很多药.*晕|吞药|药物过量|药.*吃多/;

const MEDIA_OR_NEWS_CONTEXT_PATTERN = /电影|电视剧|小说|新闻|报道|视频|游戏|剧情|角色|演员|纪录片/;
const NEGATED_SELF_OR_OTHER_HARM_PATTERN =
  /我(不会|不會|没有|沒|没|并不).{0,8}(自杀|轻生|伤害自己|伤害我自己|结束生命|割腕|寻死|杀人|杀了他|杀了她|砍人|捅人|动手|报复社会)/;
const PAST_NO_CURRENT_RISK_PATTERN =
  /(以前|过去|小时候|之前|曾经|当时).{0,16}(被打|打我|家暴|吃多.*药|药.*吃多|吞药).{0,20}(现在想起来|现在已经|已经没事|现在没事|没有危险|现在安全|过去了)/;

const isNonCurrentRiskContext = (inputText: string) =>
  MEDIA_OR_NEWS_CONTEXT_PATTERN.test(inputText) ||
  NEGATED_SELF_OR_OTHER_HARM_PATTERN.test(inputText) ||
  PAST_NO_CURRENT_RISK_PATTERN.test(inputText);

export const isCrisisInput = (inputText: string) => CRISIS_PATTERN.test(inputText) && !isNonCurrentRiskContext(inputText);

export const createSafetyGeneration = (inputText: string): AiGenerationResult => ({
  text:
    "这件事先别一个人扛。请马上联系身边可信的人；如果有现实危险，立刻拨打当地紧急电话或去最近的急诊。",
  model: "safety-gate",
  promptVersion: SAFETY_PROMPT_VERSION,
  latencyMs: 0,
  postProcessSteps: [],
  finalReplySource: "safety",
  raw: {
    matched: isCrisisInput(inputText),
  },
});
