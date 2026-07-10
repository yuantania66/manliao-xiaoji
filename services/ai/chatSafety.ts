import { AiGenerationResult } from "./types";

export const SAFETY_PROMPT_VERSION = "safety-gate-v1";

const CRISIS_PATTERN =
  /自杀|轻生|不想活|不想活了|结束生命|伤害自己|伤害我自己|割腕|寻死|去死|杀了自己|消失.*没人.*在意|没人.*在意.*消失|杀人|杀了他|杀了她|砍人|捅人|报复社会|同归于尽|控制不住.*动手|找.*算账.*动手|可能会动手|打了我|打我了|刚刚打我|被打|家暴|躲在厕所|吃了.*很多药|吃.*很多药.*晕|吞药|药物过量|药.*吃多/;

export const isCrisisInput = (inputText: string) => CRISIS_PATTERN.test(inputText);

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
