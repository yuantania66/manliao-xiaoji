import { AiGenerationResult } from "./types";

export const SAFETY_PROMPT_VERSION = "safety-gate-v1";

const CRISIS_PATTERN =
  /自杀|轻生|不想活|不想活了|结束生命|伤害自己|伤害我自己|割腕|寻死|去死|杀了自己|杀人|杀了他|杀了她|砍人|捅人|报复社会|同归于尽/;

export const isCrisisInput = (inputText: string) => CRISIS_PATTERN.test(inputText);

export const createSafetyGeneration = (inputText: string): AiGenerationResult => ({
  text:
    "这件事先别一个人扛。请马上联系身边可信的人；如果有现实危险，立刻拨打当地紧急电话或去最近的急诊。",
  model: "safety-gate",
  promptVersion: SAFETY_PROMPT_VERSION,
  latencyMs: 0,
  raw: {
    matched: isCrisisInput(inputText),
  },
});
