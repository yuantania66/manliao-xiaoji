import type { ResponsePlan, ResponseValidationResult } from "@/conversation-os/control";

import { collectUnsupportedMeaningFailureReasons } from "./semanticEvidenceReplyGuard";
import type { AiGenerationResult } from "./types";

export const RESPONSE_PLAN_CONSTRAINT_FAILURE_REPLY =
  "本轮回复未通过既定回复计划约束，暂时无法安全生成。这不是对你内容的新解释。";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const obligationSatisfied = (reply: string, obligation: ResponsePlan["answerObligations"][number]) => {
  if (obligation.kind === "identity") {
    return /AI|人工智能|聊天助手/u.test(reply) && !/(?:我是|属于|作为).{0,6}(?:心理医生|心理咨询师|治疗师)/u.test(reply);
  }
  if (obligation.kind === "body_capability") return /没有身体|不能真的|不会真的|只是.{0,6}(?:说法|比喻)|通过文字/u.test(reply);
  if (obligation.kind === "voice_input") return /不能听|听不见|不支持.{0,4}语音输入|只能.{0,4}文字/u.test(reply);
  if (obligation.kind === "voice_output") return /不能.{0,6}(?:发|播放|用).{0,4}语音|不支持.{0,4}语音|只能.{0,4}(?:文字|打字)|文字.{0,6}(?:回复|聊天|交流)/u.test(reply);
  if (obligation.kind === "perception_capability") return /不能看|看不见|无法看|只能.{0,4}文字/u.test(reply);
  if (obligation.kind === "time_capability") return /不知道.{0,6}(?:实时|当前|现在).{0,4}时间|没有.{0,6}(?:实时|当前).{0,4}时间|需要.{0,6}(?:提供|告诉).{0,4}时间/u.test(reply);
  if (obligation.kind === "memory_capability") return /只能.{0,12}(?:当前|提供|选取|聊天)|不一定记得|不会.{0,8}全部|有限/u.test(reply);
  if (obligation.kind === "definition") return /意思是|指的是|是指|说的是|就是说|就是/u.test(reply) && !/^[^。！!]{0,30}[？?]$/u.test(reply);
  if (obligation.kind === "reason_or_contradiction") return /因为|其实|刚才|我说的|只能|文字|指的是/u.test(reply) && !/^[^。！!]{0,30}[？?]$/u.test(reply);
  return Boolean(reply) && !/^[^。！!]{0,30}[？?]$/u.test(reply);
};

export const validateResponsePlanOutput = ({ plan, reply }: { plan: ResponsePlan; reply: string }): ResponseValidationResult => {
  const text = normalize(reply);
  const failureReasons: string[] = [];
  for (const obligation of plan.answerObligations) {
    if (!obligationSatisfied(text, obligation)) failureReasons.push(`unanswered_obligation:${obligation.id}:${obligation.kind}`);
  }
  if (plan.questionPolicy.mode === "none" && /[？?]\s*$/u.test(text)) failureReasons.push("question_not_allowed_by_plan");
  if (plan.closurePolicy.mode === "forbid_closure" && /就(?:先)?这样(?:安静地?)?待着|安静(?:地)?待着也|先不说也行|不聊也行|停在这里|先放在这里/u.test(text)) {
    failureReasons.push("premature_closure");
  }
  if (plan.responseActions.includes("take_light_topic_initiative")) {
    if (!/[？?]/u.test(text) && !/(?:我来|聊个|先从|起个头|说个|换个轻松)/u.test(text)) {
      failureReasons.push("missing_light_topic_initiative");
    }
    if (/(?:你)?(?:想|要不要)?(?:聊|说)(?:点)?什么|从哪里(?:开始|说起)|想不到(?:也)?没关系/u.test(text)) {
      failureReasons.push("initiative_returned_to_user");
    }
  }
  if (/(?:我会|我能|我可以).{0,5}(?:真的)?(?:坐|抱|触碰)|我(?:就在|正待在).{0,8}(?:你身边|这里陪你)/u.test(text)) {
    failureReasons.push("assistant_grounding:embodiment_claim");
  }
  if (/(?:我是|属于|作为).{0,6}(?:心理医生|心理咨询师|治疗师)/u.test(text)) {
    failureReasons.push("assistant_grounding:clinician_claim");
  }
  if (plan.prohibitedClaims.some((claim) => claim.includes("message form or repetition"))) {
    failureReasons.push(...collectUnsupportedMeaningFailureReasons(text));
  }
  return {
    passed: failureReasons.length === 0,
    failureReasons: Array.from(new Set(failureReasons)),
    checkedPlanId: plan.planId,
    planChanged: false,
  };
};

export const formatResponsePlanRegenerateConstraint = (plan: ResponsePlan, failures: string[]) => [
  "The previous surface realization was rejected by Output Validation.",
  `Keep the exact same ResponsePlan planId=${plan.planId}. Do not reinterpret the user or choose another goal.`,
  "Fix only these validation failures:",
  ...failures.map((failure) => `- ${failure}`),
  "Return only the new user-facing reply.",
].join("\n");

const constraintFailureGeneration = (
  first: AiGenerationResult,
  second: AiGenerationResult,
  failures: string[]
): AiGenerationResult => ({
  ...second,
  text: RESPONSE_PLAN_CONSTRAINT_FAILURE_REPLY,
  rawLLMOutput: second.rawLLMOutput ?? second.text,
  finalReplySource: "constraint_failure",
  postProcessSteps: [
    ...(first.postProcessSteps ?? []),
    {
      layer: "response_plan_output_validation",
      before: first.rawLLMOutput ?? first.text,
      after: second.rawLLMOutput ?? second.text,
      reason: "Regenerated once against the same ResponsePlan after the first validation failure.",
    },
    ...(second.postProcessSteps ?? []),
    {
      layer: "response_plan_output_validation",
      before: second.rawLLMOutput ?? second.text,
      after: RESPONSE_PLAN_CONSTRAINT_FAILURE_REPLY,
      reason: `Same ResponsePlan failed twice: ${failures.join(", ")}`,
    },
  ],
});

export const enforceResponsePlan = async ({
  plan,
  generate,
}: {
  plan: ResponsePlan;
  generate: (constraint: string | null) => Promise<AiGenerationResult>;
}) => {
  const first = await generate(null);
  const firstValidation = validateResponsePlanOutput({ plan, reply: first.text });
  if (firstValidation.passed) {
    return { generation: first, attempts: [first], validations: [firstValidation], regenerateAttempted: false };
  }
  const second = await generate(formatResponsePlanRegenerateConstraint(plan, firstValidation.failureReasons));
  const secondValidation = validateResponsePlanOutput({ plan, reply: second.text });
  if (secondValidation.passed) {
    return {
      generation: {
        ...second,
        finalReplySource: "llm_regenerate" as const,
        postProcessSteps: [
          ...(first.postProcessSteps ?? []),
          {
            layer: "response_plan_output_validation",
            before: first.text,
            after: second.text,
            reason: `Regenerated against the same plan after: ${firstValidation.failureReasons.join(", ")}`,
          },
          ...(second.postProcessSteps ?? []),
        ],
      },
      attempts: [first, second],
      validations: [firstValidation, secondValidation],
      regenerateAttempted: true,
    };
  }
  return {
    generation: constraintFailureGeneration(first, second, [...firstValidation.failureReasons, ...secondValidation.failureReasons]),
    attempts: [first, second],
    validations: [firstValidation, secondValidation],
    regenerateAttempted: true,
  };
};
