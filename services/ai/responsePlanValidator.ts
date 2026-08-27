import { ASSISTANT_GROUNDING, type ResponsePlan, type ResponseValidationResult } from "@/conversation-os/control";
import { extractAffectEvidence } from "@/conversation-os/state";
import { explicitlyResumesPreGreetingHistory } from "@/lib/proactive-greeting";

import { collectUnsupportedMeaningFailureReasons } from "./semanticEvidenceReplyGuard";
import {
  validatePlannedFunctionSemanticOutput,
  type PlannedFunctionSemanticContext,
  type PlannedFunctionSemanticProvider,
  type PlannedFunctionSemanticValidationPromptInspector,
} from "./plannedFunctionSemanticValidator";
import {
  adaptInteractionMoveHandoffPromptInspector,
  adaptInteractionMoveHandoffSemanticProvider,
  type InteractionMoveHandoffSemanticContext,
  type InteractionMoveHandoffSemanticProvider,
  type InteractionMoveHandoffValidationPromptInspector,
} from "./interactionMoveHandoffOutputValidator";
import type { AiGenerationResult } from "./types";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
const ASSISTANT_DISPLAY_NAME = ASSISTANT_GROUNDING.availableFacts.assistant.displayName;
const PRODUCT_NAME = ASSISTANT_GROUNDING.availableFacts.product.name;
const usesProductNameAsAssistantName = (value: string) =>
  ["我叫", "我的名字是", "可以叫我", "称呼我"].some((prefix) => {
    const prefixIndex = value.indexOf(prefix);
    if (prefixIndex < 0) return false;
    return value.slice(prefixIndex + prefix.length, prefixIndex + prefix.length + PRODUCT_NAME.length + 6)
      .includes(PRODUCT_NAME);
  });
const normalizeForEcho = (value: string) =>
  value
    .replace(/[\s，。！？、,.!?：:；;“”"'‘’（）()…—-]/gu, "")
    .replace(/^(?:嗯|哦|啊|呀|诶|原来是)/u, "")
    .replace(/(?:啊|呀|呢|哦)$/u, "")
    .trim();

const recursivelyFreeze = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (!value || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(value as Record<string, unknown>)) {
    recursivelyFreeze(child, seen);
  }
  return Object.freeze(value);
};

export const classifyResponseValidationReasons = (failureReasons: string[]) => {
  const uniqueReasons = Array.from(new Set(failureReasons));
  return {
    hardFailureReasons: uniqueReasons,
    advisoryFailureReasons: [],
  };
};

type RepairSemanticEvidence = {
  moveReference: boolean;
  assistantOwnership: boolean;
  moveDisavowal: boolean;
  repairCompletionEvidence: boolean;
  continuesRejectedMove: boolean;
};

type RepairPositiveFunctionContract = Extract<
  NonNullable<ResponsePlan["positiveFunctionContract"]>,
  { action: "repair_previous_wording" }
>;

const currentUserMessageFromPlan = (plan: ResponsePlan) => {
  const prefix = "currentUserMessage=";
  for (const provenance of plan.relevanceProvenance) {
    const evidence = provenance.evidence.find((item) => item.startsWith(prefix));
    if (evidence) return normalize(evidence.slice(prefix.length));
  }
  return "";
};

const preProactiveGreetingUserMessagesFromPlan = (plan: ResponsePlan) => {
  const prefix = "preProactiveGreetingUserMessage=";
  return plan.evidence
    .filter((item) => item.startsWith(prefix))
    .map((item) => normalize(item.slice(prefix.length)))
    .filter(Boolean);
};

const unsupportedEvaluationTerms = [
  "热闹",
  "棒",
  "挺好",
  "很好",
  "不错",
  "难得",
  "珍贵",
  "舒服",
  "放松",
  "开心",
  "有趣",
  "好玩",
  "投入",
];

const collectOrdinaryAcknowledgementFailures = ({
  plan,
  reply,
}: {
  plan: ResponsePlan;
  reply: string;
}) => {
  if (!plan.responseActions.includes("acknowledge_without_psychologizing")) return [];
  const userMessage = currentUserMessageFromPlan(plan);
  const failures: string[] = [];
  if (
    /(?:这种|这样的|现场|氛围).{0,16}(?:容易|会让|让人|能让).{0,16}(?:投入|放松|开心|舒服|沉浸|忘记)/u.test(reply)
  ) {
    failures.push("ordinary_acknowledgement:generic_causal_mechanism");
  }
  if (userMessage) {
    const addedEvaluation = unsupportedEvaluationTerms.find((term) =>
      reply.includes(term) && !userMessage.includes(term)
    );
    if (addedEvaluation) {
      failures.push(`ordinary_acknowledgement:unsupported_evaluation:${addedEvaluation}`);
    }
  }
  return failures;
};

const HANDOFF_ACTIONS = new Set([
  "invite_low_pressure_calibration",
  "continue_established_frame",
  "continue_established_thread",
  "offer_neutral_conversation_entry",
]);

const neutralChoiceAlternativeKinds = (value: string) => ({
  casual: /(?:随便|随意|轻松|闲聊|聊(?:上)?两句|聊点轻松)/u.test(value),
  present: /(?:此刻|现在|眼下|心里|在意|想说|想到|正想着)/u.test(value),
});

export const isNeutralConversationLightChoice = (reply: string) => {
  const normalized = normalize(reply);
  if ((normalized.match(/[？?]/gu) ?? []).length !== 1) return false;
  const questionEnd = normalized.search(/[？?]/u);
  if (questionEnd < 0) return false;
  const beforeQuestion = normalized.slice(0, questionEnd);
  const previousBoundary = Math.max(
    beforeQuestion.lastIndexOf("。"),
    beforeQuestion.lastIndexOf("！"),
    beforeQuestion.lastIndexOf("!")
  );
  const questionClause = beforeQuestion.slice(previousBoundary + 1).trim();
  let alternatives: [string, string] | null = null;
  const binaryConnector = questionClause.match(/还是|或者/u);
  if (binaryConnector && binaryConnector.index !== undefined) {
    alternatives = [
      questionClause.slice(0, binaryConnector.index).trim(),
      questionClause.slice(binaryConnector.index + binaryConnector[0].length).trim(),
    ];
  } else {
    const alsoConnector = questionClause.match(/[，,、]\s*也可以/u);
    if (alsoConnector && alsoConnector.index !== undefined) {
      alternatives = [
        questionClause.slice(0, alsoConnector.index).trim(),
        questionClause.slice(alsoConnector.index + alsoConnector[0].length).trim(),
      ];
    }
  }
  if (!alternatives || alternatives.some((value) => value.length < 2)) return false;
  const [left, right] = alternatives.map(neutralChoiceAlternativeKinds);
  return (left.casual && right.present) || (left.present && right.casual);
};

const collectOrdinaryHandoffFailures = ({
  plan,
  reply,
}: {
  plan: ResponsePlan;
  reply: string;
}) => {
  const handoffAction = plan.responseActions.find((action) => HANDOFF_ACTIONS.has(action));
  if (!handoffAction) return [];
  const failures: string[] = [];
  const normalized = normalize(reply);
  const bareReceiptOrPresence = /^(?:嗯|哦|好|好的|知道了|明白了|收到(?:了)?|听到(?:了)?|看到(?:了)?|在的|我在(?:呢|听)?|我在这(?:里|儿)?)(?:[，,。！!\s]*(?:我在(?:呢|听)?|你继续|随时可以聊))?[。！!\s]*$/u;
  const genericOpenDoorOnly = /^(?:想说什么都可以|你可以继续(?:说|发)|随时可以聊|想聊的时候再聊|我会认真听)[。！!\s]*$/u;
  if (bareReceiptOrPresence.test(normalized) || genericOpenDoorOnly.test(normalized)) {
    failures.push("ordinary_handoff:no_new_conversation_function");
  }
  if (handoffAction === "invite_low_pressure_calibration") {
    if ((normalized.match(/[？?]/gu) ?? []).length !== 1) {
      failures.push("ordinary_handoff:calibration_requires_one_question");
    }
    if (/(?:什么(?:意思|含义)|想表达什么|为什么(?:这样)?发|解释一下)/u.test(normalized)) {
      failures.push("ordinary_handoff:calibration_demands_explanation");
    }
    if (/(?:试试|测试|试探|打招呼|随便发|随手发|随机|暗号|信号|评分|分数|编号)/u.test(normalized)) {
      failures.push("ordinary_handoff:calibration_suggests_unproved_meaning");
    }
  }
  if (
    handoffAction === "continue_established_frame" ||
    handoffAction === "continue_established_thread"
  ) {
    if (/[？?]/u.test(normalized)) failures.push("ordinary_handoff:question_forbidden_for_selected_move");
  }
  if (handoffAction === "offer_neutral_conversation_entry") {
    const reciprocalEntry =
      plan.interactionMoveHandoffPlan?.requiredFunction ===
        "complete_reciprocal_contact" &&
      plan.questionPolicy.mode !== "none";
    if (!reciprocalEntry && /[？?]/u.test(normalized)) {
      failures.push("ordinary_handoff:question_forbidden_for_selected_move");
    }
    if (
      reciprocalEntry &&
      /(?:为什么|怎么会|发生了什么|具体|详细|解释|说说原因|讲讲经过)/u.test(normalized)
    ) {
      failures.push("ordinary_handoff:neutral_entry_demands_explanation");
    }
    if (
      reciprocalEntry &&
      /[？?]/u.test(normalized) &&
      !isNeutralConversationLightChoice(normalized)
    ) {
      failures.push("ordinary_handoff:neutral_entry_requires_light_choice");
    }
  }
  return failures;
};

const collectMechanicalReplyFailures = ({
  plan,
  reply,
}: {
  plan: ResponsePlan;
  reply: string;
}) => {
  const normalized = normalize(reply);
  const failures: string[] = [];
  if (
    /^(?:你好呀?[，,。！!\s]*)?(?:嗯嗯?|哦|好(?:的)?|知道了|明白了|收到(?:了|啦|你的消息啦?)?|我记下了|听到了|看到了)(?:[，,。！!\s]*(?:收到(?:了|啦)?|我记下了|我在(?:呢)?|随时都在))?[。！!\s]*$/u.test(normalized) ||
    /^(?:你好呀?[，,。！!\s]*)?(?:小慢[，,。！!\s]*)?(?:我?在(?:呢)?|随时都在|在等你(?:找我)?聊天(?:呀)?)[。！!\s]*$/u.test(normalized)
  ) {
    failures.push("assistant_voice:mechanical_receipt_or_presence");
  }
  if (/(?:^|[。！？!?]\s*)我(?:一直|正在|就在|还在|在)?等你(?:来|找我)?(?:聊天|说话)?|(?:一直|正在|就在|还在|在)等你(?:来|找我)?(?:聊天|说话)?/u.test(normalized)) {
    failures.push("assistant_grounding:invented_waiting_activity");
  }
  if (plan.responseActions.includes("repair_previous_wording")) {
    if (/(?:抱歉|对不起)(?:让你|如果让你)(?:有这种感觉|觉得|误会)/u.test(normalized)) {
      failures.push("repair:non_owning_apology");
    }
    if (/^(?:嗯嗯?|哦|好(?:的)?|知道了|明白了|收到(?:了)?)[，,。！!\s]*(?:我记下了|我会认真听|我在(?:呢)?)?[。！!\s]*$/u.test(normalized)) {
      failures.push("repair:generic_receipt");
    }
    if (/(?:其实|但|不过).{0,12}(?:我)?(?:一直|确实)(?:在)?(?:认真)?(?:听|理解)/u.test(normalized)) {
      failures.push("repair:self_defense");
    }
  }
  return failures;
};

const asksUserToDiagnoseAssistantFailure = (reply: string) =>
  /(?:哪(?:件事|句话|一段|部分|个地方)|哪里|哪儿).{0,24}(?:让你觉得)?我.{0,16}(?:没懂|不懂|没理解|理解错|说偏|说错|没接住|没跟上)/u.test(reply) ||
  /(?:请|能不能|能否|可以|麻烦|你能).{0,12}(?:指出|告诉|解释).{0,16}(?:我)?(?:哪里|哪儿|哪句话|哪部分|错在)/u.test(reply);

const hasUserControlLanguage = (reply: string) =>
  /(?:你(?:可以|可|想|愿意|决定|来定)|由你|随你|看你|都行|都可以|也可以|任你|按你)|(?:可以|能够).{0,10}(?:先|只|从|说|讲|聊|谈|提|表达)/u.test(reply);

const completesFocusControl = (reply: string) => {
  const focusObject =
    /(?:从|先).{0,10}(?:说|讲|聊|谈|提|表达|碰)|(?:说|讲|聊|谈|提|表达|碰).{0,12}(?:哪(?:儿|里|个|一个|一块|一点|部分)?|哪个|部分|那一块|那一点|开始)|(?:哪(?:儿|里|个|一个|一块|一点|部分)?|哪个).{0,10}(?:先|说|讲|聊|谈|提|表达)|(?:最想|想先).{0,8}(?:说|讲|聊|谈|提|表达)|(?:想说|想讲|想聊|想谈|想提|想表达|(?:最)?在意)的(?:那一点|部分|地方)|(?:说|讲|聊|谈)(?:说)?(?:你)?(?:现在)?(?:的)?感受/u.test(reply);
  return focusObject && hasUserControlLanguage(reply);
};

const completesExpressionBurdenReduction = (reply: string) => {
  const releasesObligation =
    /(?:不用|不必|不需要|无需|可以不|不必急着|不用急着|不用非得|不必非得)/u.test(reply);
  const burdenObject =
    /(?:分析|解释|找原因|讲原因|说原因|缘由|理清|理出|整理|组织|说完整|讲完整|说清|讲清|说明白|一次说清|下定义|得出结论|理出个所以然)/u.test(reply);
  return releasesObligation && burdenObject;
};

const completesAmountControl = (reply: string) => {
  const requestsPartialContribution =
    /(?:你|能不能|可不可以|愿不愿意).{0,8}(?:说|讲|聊|谈|表达|提)(?:个|上)?(?:一点|一些|几句|一两句|一小段|一部分).{0,4}[吗呢]?[？?]/u.test(reply);
  const returnsOpenQuantityChoice =
    /(?:想|愿意|能|可以)?(?:说|讲|聊|谈|表达)多少.{0,10}(?:由你|随你|都行|都可以|就(?:说|讲|聊|谈|表达)多少)|(?:说|讲|聊|谈|表达)多(?:说|讲|聊|谈|表达)少.{0,10}(?:由你|随你|都行|都可以|你来定)|(?:多|少|多少).{0,6}(?:说|讲|聊|谈|表达).{0,8}(?:由你|随你|你定|都行|都可以)/u.test(reply);
  const permitsPartialExpression =
    !requestsPartialContribution && (
      /(?:可以|可|能|只管|不妨)(?:先|只)?(?:说|讲|聊|谈|表达|提)(?:个|上)?(?:一点|一些|几句|一两句|一小段|一部分)/u.test(reply) ||
      /(?:先|就|只)?(?:说|讲|聊|谈|表达|提)(?:个|上)?(?:一点|一些|几句|一两句|一小段|一部分).{0,8}(?:也行|也可以|都行|都可以|就好|即可|够了|没关系)/u.test(reply)
    );
  const permitsLessExpression =
    /(?:不想|不愿)(?:再)?(?:多|全|全部|完整地?)?(?:说|讲|聊|谈|表达).{0,8}(?:也)?(?:没关系|可以|也可以|行|也行|都行)|(?:少|少点|少些)(?:说|讲|聊|谈|表达).{0,8}(?:也)?(?:可以|也可以|行|也行|都行|没关系)/u.test(reply);
  const releasesCompleteAccount =
    /(?:不用|不必|不需要|无需|可以不).{0,12}(?:全说|全讲|全部说|全部讲|说完|讲完|说完整|讲完整|一次说完|一次讲完|讲全|说全)/u.test(reply);
  const returnsExpressionEndpoint =
    /(?:说|讲|聊|谈|表达)到哪(?:儿|里)?.{0,8}(?:算|就到|停在|由你定)哪(?:儿|里)?|(?:说|讲|聊|谈|表达).{0,8}(?:到什么程度|到哪一步).{0,8}(?:由你|随你|你定)/u.test(reply);
  return returnsOpenQuantityChoice || permitsPartialExpression || permitsLessExpression ||
    releasesCompleteAccount || returnsExpressionEndpoint;
};

const completesRelationalImpactAcknowledgement = (reply: string) => {
  const acknowledgesImpact =
    /(?:我|助手).{0,12}(?:没懂|不懂|没理解|没接住|没跟上|说偏|理解偏)|(?:没懂|不懂|没理解|没接住|没跟上|说偏).{0,10}(?:你|你的)|让你觉得我.{0,8}(?:没懂|不懂|没理解|没接住|没跟上)/u.test(reply);
  const preservesInformationBoundary =
    /(?:我)?(?:还|现在)?没有.{0,12}(?:足够|具体).{0,10}(?:信息|前文)|不(?:替你|往下|继续).{0,10}(?:猜|解释)|不能把.{0,12}说成.{0,8}(?:已经|完全)?理解|不说自己.{0,8}(?:已经|完全)?理解/u.test(reply);
  return acknowledgesImpact && preservesInformationBoundary;
};

const completesEmotionalSupportFunction = ({
  plan,
  reply,
}: {
  plan: ResponsePlan;
  reply: string;
}) => {
  const contract = plan.positiveFunctionContract;
  if (contract?.action !== "offer_emotional_support") return false;
  if (contract.supportFunction === "reduce_expression_burden") {
    return completesExpressionBurdenReduction(reply);
  }
  if (contract.supportFunction === "return_focus_control") {
    return completesFocusControl(reply);
  }
  if (contract.supportFunction === "return_amount_control") {
    return completesAmountControl(reply);
  }
  return completesRelationalImpactAcknowledgement(reply);
};

const hasGroundedAffectOrImpactReference = ({
  plan,
  reply,
}: {
  plan: ResponsePlan;
  reply: string;
}) => {
  const contract = plan.positiveFunctionContract;
  if (contract?.action !== "offer_emotional_support") return false;
  if (contract.explicitAffectOrImpactTerms.some((term) => reply.includes(term))) return true;
  const contractCategories = new Set(contract.affectEvidenceSpans.map((span) => span.category));
  const contractObjects = new Set(contract.affectEvidenceSpans.map((span) => span.object));
  if (extractAffectEvidence(reply).some((span) =>
    contractCategories.has(span.category) && contractObjects.has(span.object)
  )) return true;
  if (
    contract.supportFunction === "acknowledge_current_relational_impact" &&
    /(?:我|助手).{0,10}(?:没懂|不懂|没理解|没接住|没跟上|说偏)|(?:没懂|不懂|没理解|没接住|没跟上|说偏).{0,10}(?:你|用户)/u.test(reply)
  ) {
    return true;
  }
  return /(?:这种|这份|这个|刚才那种)(?:感觉|滋味|感受|难受|担心|委屈|生气|孤单|烦躁)/u.test(reply);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const reassuresOrNormalizesAffect = ({
  plan,
  reply,
}: {
  plan: ResponsePlan;
  reply: string;
}) => {
  const contract = plan.positiveFunctionContract;
  if (contract?.action !== "offer_emotional_support") return false;
  const normalizesEvidence = contract.explicitAffectOrImpactTerms.some((term) => {
    const escaped = escapeRegExp(term);
    return new RegExp(
      `${escaped}.{0,3}(?:(?:也|本来|其实)?没关系|(?:是|本来就是)?(?:很|挺)?(?:正常|自然)|(?:也)?是(?:可以|可接受|合理)(?:的)?)`,
      "u"
    ).test(reply);
  });
  if (normalizesEvidence) return true;
  const normalizesDerivedAffect = extractAffectEvidence(reply).some((span) =>
    /^(?:也|本来|其实)?(?:是|都)?(?:人之常情|很?常见|很?普遍|很?正常|很?自然)/u.test(
      reply.slice(span.end, span.end + 12)
    )
  );
  if (normalizesDerivedAffect) return true;
  return /(?:这种|这份|这个)(?:感觉|滋味|感受|情绪).{0,5}(?:没关系|正常|自然)|(?:^|[，,。！？!?]\s*)没关系(?:的)?(?:[，,。！？!?]|$)|别(?:太)?(?:苛责自己|对自己太苛刻|给自己太大压力)/u.test(reply);
};

const suggestsUnrequestedPauseOrClosure = (reply: string) => {
  const withoutNegatedDeferral = reply.replace(
    /(?:不用|不必|无需|不需要|不要)(?:再)?(?:等|等到).{0,16}(?:再|继续)(?:说|聊|讲|谈)/gu,
    ""
  );
  return /(?:安静|静静)(?:地)?(?:待|待着|待会儿)|(?:先|暂时)(?:放|搁)(?:一放|一搁|一下|一会儿|会儿)(?:再说)?|就让自己待一会儿|让.{0,8}待一会儿|(?:就|先)待一会儿|(?:先)?这样待(?:一会儿|会儿)|(?:先|就先)(?:沉默|不说话)(?:一会儿|会儿)|(?:想|愿意).{0,8}(?:说|聊|讲|谈).{0,8}(?:时候|时)再说/u.test(withoutNegatedDeferral) ||
    /(?:等|等到).{0,16}(?:再|继续)(?:说|聊|讲|谈)|(?:之后|以后|晚点|过会儿|等会儿).{0,8}(?:再|继续)(?:说|聊|讲|谈)|(?:先|暂时).{0,8}(?:不处理|不碰|不管).{0,6}(?:这|它|情绪|感受)/u.test(withoutNegatedDeferral);
};

const offersUnboundedContentAlternative = (reply: string) => {
  const offersAlternative =
    /(?:还是|或者|或是|也可以|也能|也可).{0,8}(?:别的|其他)(?:部分|方面)?|(?:别的|其他)(?:部分|方面)?.{0,8}(?:都行|都可以|也行|也可以)/u.test(reply);
  if (!offersAlternative) return false;
  const explicitlyDeclinesAlternative =
    /(?:不|不用|不必|无需|不要)(?:再)?(?:聊|说|讲|谈)?(?:点|些)?(?:别的|其他)/u.test(reply);
  const stillOffersAnotherAlternative =
    /(?:还是|或者|或是).{0,8}(?:别的|其他)(?:部分|方面)?/u.test(reply);
  if (explicitlyDeclinesAlternative && !stillOffersAnotherAlternative) return false;
  const explicitlyScopesAlternativeToCurrentAffect =
    /(?:这份|这种|当前|当下|眼下|刚才那种).{0,10}(?:情绪|感觉|感受|难受|担心|委屈|生气|孤单|烦|被忽略)(?:中|里|之中|的)(?:别的|其他)(?:部分|方面)/u.test(reply) ||
    /关于.{0,12}(?:这份|这种|当前|当下|眼下).{0,8}(?:情绪|感觉|感受|难受|担心|委屈|生气|孤单|烦).{0,12}(?:别的|其他)(?:部分|方面)/u.test(reply);
  return !explicitlyScopesAlternativeToCurrentAffect;
};

const proposesOutOfScopeTopicSwitch = (reply: string) => {
  const explicitSwitch =
    /(?:换个|换到|转到)(?:(?:别的|其他|轻松)(?:话题|事情)|话题)|(?:聊|谈|说)(?:聊|谈|说)?(?:点|些)(?:轻松|开心)(?:的)?(?:内容|事情|话题)?|(?:分散|转移)(?:一下)?注意(?:力)?|(?:把)?注意力.{0,2}(?:挪|移|转)开|换换心情/u.test(reply);
  if (explicitSwitch) return true;
  const mentionsBareOtherTopic =
    /(?:聊|谈|说)(?:聊|谈|说)?(?:点|些)?别的(?!方面|部分)/u.test(reply);
  const explicitlyDeclinesOtherTopic =
    /(?:不|不用|不必|无需|不要)(?:再)?(?:聊|谈|说)(?:聊|谈|说)?(?:点|些)?别的/u.test(reply);
  return mentionsBareOtherTopic && !explicitlyDeclinesOtherTopic;
};

const replyAffectClaims = (reply: string) => extractAffectEvidence(reply);

const intensityRank = (intensity: "low" | "moderate" | "high" | "unspecified") =>
  intensity === "low" ? 1 : intensity === "high" ? 3 : 2;

const collectUnsupportedAffectClaimFailures = ({
  plan,
  reply,
}: {
  plan: ResponsePlan;
  reply: string;
}) => {
  const contract = plan.positiveFunctionContract;
  if (contract?.action !== "offer_emotional_support") return [];
  const failures: string[] = [];
  for (const claim of replyAffectClaims(reply)) {
    const matchingEvidence = contract.affectEvidenceSpans.filter((span) =>
      span.category === claim.category
    );
    if (matchingEvidence.length === 0) {
      failures.push(`emotional_support:unsupported_affect_category:${claim.category}:${claim.text}`);
      continue;
    }
    const maximumEvidenceIntensity = Math.max(
      ...matchingEvidence.map((span) => intensityRank(span.intensity))
    );
    if (claim.intensity !== "unspecified" && intensityRank(claim.intensity) > maximumEvidenceIntensity) {
      failures.push(`emotional_support:unsupported_intensification:${claim.text}`);
    }
  }
  if (
    /最(?:让你)?(?:挂心|担心|难受|痛苦|委屈|生气|孤单|烦|丢脸)的?(?:一点|部分|地方|事)?/u.test(reply) &&
    !/最(?:让|令)?我|我最/u.test(contract.sourceText)
  ) {
    failures.push("emotional_support:unsupported_intensification:superlative_focus");
  }
  return failures;
};

// Historical compatibility helper retained while old evidence fixtures migrate; not a production gate.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const collectEmotionalSupportFailures = ({
  plan,
  reply,
}: {
  plan: ResponsePlan;
  reply: string;
}) => {
  if (!plan.responseActions.includes("offer_emotional_support")) return [];
  const failures: string[] = [];
  const normalized = normalize(reply);
  const userMessage = currentUserMessageFromPlan(plan);
  if (plan.positiveFunctionContract?.action !== "offer_emotional_support") {
    failures.push("emotional_support:missing_positive_function_contract");
  } else {
    if (!hasGroundedAffectOrImpactReference({ plan, reply: normalized })) {
      failures.push("emotional_support:missing_grounded_affect_or_impact");
    }
    if (!completesEmotionalSupportFunction({ plan, reply: normalized })) {
      failures.push(`emotional_support:missing_selected_function:${plan.positiveFunctionContract.supportFunction}`);
    }
  }
  if (
    /^(?:我)?(?:听到|看到|知道|明白)(?:你)?(?:说)?[^。！？!?]{0,36}[，,。]?(?:想|愿意|要不要|可以|能|能不能)?(?:和我|跟我)?(?:聊聊|说说|讲讲|告诉我)[^。！？!?]{0,28}[？?]$/u.test(normalized)
  ) {
    failures.push("emotional_support:receipt_then_information_request");
  }
  if (
    /我(?:确实)?(?:还|仍|一直|正在)?(?:在)?努力(?:地)?(?:理解|懂|跟上)/u.test(normalized) ||
    /我(?:没法|无法|不能)(?:真正|完全)?(?:理解|体会)(?:你|你的)?/u.test(normalized)
  ) {
    failures.push("emotional_support:assistant_centered_understanding");
  }
  if (asksUserToDiagnoseAssistantFailure(normalized)) {
    failures.push("emotional_support:user_must_diagnose_assistant_failure");
  }
  if (/(?:抱歉|对不起)(?:让你|如果让你)(?:有这种感觉|觉得)/u.test(normalized)) {
    failures.push("emotional_support:non_owning_apology");
  }
  if (
    /(?:抱抱你|给你一个抱抱|我(?:会)?(?:就|一直|随时)?在这(?:儿|里)|我都在|我(?:会|就)?(?:一直|随时)?陪着你|我在呢)/u.test(normalized)
  ) {
    failures.push("emotional_support:formulaic_presence_or_contact");
  }
  if (reassuresOrNormalizesAffect({ plan, reply: normalized })) {
    failures.push("emotional_support:generic_normalization_or_reassurance");
  }
  if (
    /(?:先|就先)(?:让自己)?(?:喘口气|缓一缓|歇一歇|歇歇|休息|做.{0,8}(?:深呼吸|腹式呼吸|呼吸练习))|(?:做|试试).{0,8}(?:深呼吸|腹式呼吸|呼吸练习)|不用急着调整/u.test(normalized)
  ) {
    failures.push("emotional_support:unsolicited_regulation_advice");
  }
  if (suggestsUnrequestedPauseOrClosure(normalized)) {
    failures.push("emotional_support:unrequested_pause_or_closure");
  }
  if (
    /(?:发生了什么|是什么(?:事|让你)|什么事|为什么|原因|具体(?:在)?顾虑什么|当时的情况|哪件事|触发|触到)/u.test(normalized) &&
    /[？?]/u.test(normalized)
  ) {
    failures.push("emotional_support:default_cause_or_detail_question");
  }
  if (proposesOutOfScopeTopicSwitch(normalized)) {
    failures.push("emotional_support:out_of_scope_topic_switch");
  }
  if (
    /(?:聊|说|讲|谈)(?:聊|说|讲|谈)?(?:点|些)?(?:别的什么|其他事情|(?:不相干|无关)(?:的)?(?:内容|事情|话题)?)|(?:别的什么|其他事情).{0,8}(?:都行|都可以|也可以)|随便(?:聊|说|讲|谈)(?:点|些)?什么/u.test(normalized)
    || offersUnboundedContentAlternative(normalized)
  ) failures.push("emotional_support:out_of_scope_unknown_content");
  if (
    /(?:聊|说|讲|谈)(?:聊|说|讲|谈)?(?:点|些)?别的(?:部分|方面)/u.test(normalized) &&
    !/关于.{0,12}(?:这份|这种|当前|当下).{0,8}(?:情绪|感觉|感受|难过|担心|委屈|生气|孤单|烦).{0,36}别的(?:部分|方面)/u.test(normalized)
  ) failures.push("emotional_support:out_of_scope_unknown_content");
  if (
    /(?:还有|别的|其他).{0,8}(?:让你|使你).{0,10}(?:烦|难过|担心|生气|委屈|丢脸|孤单|难受)(?:的事|的事情)?/u.test(normalized)
  ) failures.push("emotional_support:out_of_scope_unsupported_cause_or_event");
  if (
    /(?:刚才|之前|当时).{0,8}(?:发生|具体|那件|哪一点|的事)/u.test(normalized) &&
    !/(?:刚才|之前|当时|发生)/u.test(userMessage)
  ) failures.push("emotional_support:unsupported_event_or_time");
  if (
    /(?:今天|今晚|此刻|眼下)?(?:发生的事|发生了什么|具体(?:的)?瞬间)|(?:让你|使你).{0,10}(?:有这|有这种|觉得这).{0,6}(?:感觉|感受).{0,6}(?:瞬间|事情|事)/u.test(normalized) &&
    !/(?:发生|瞬间|具体.{0,4}(?:事|事情)|那件事)/u.test(userMessage)
  ) failures.push("emotional_support:out_of_scope_unsupported_cause_or_event");
  failures.push(...collectUnsupportedAffectClaimFailures({ plan, reply: normalized }));
  return failures;
};

const PRESSURE_QUESTION_SLOT_PATTERNS = [
  { id: "time", pattern: /(?:什么时候|何时|时间|几点|多久|哪天|哪一天)/u },
  { id: "location", pattern: /(?:在哪里|在哪儿|哪里|哪儿|地点|位置)/u },
  { id: "participant", pattern: /(?:还有谁|跟谁|和谁|什么人|哪些人|在场.{0,3}(?:人|人员))/u },
  { id: "reason", pattern: /(?:为什么|原因|缘由|怎么回事)/u },
  { id: "manner", pattern: /(?:怎么做|如何|方式|怎么办)/u },
  { id: "detail", pattern: /(?:具体|细节|经过|发生了什么|什么情况)/u },
] as const;

const pressureQuestionSlots = (text: string) => new Set(
  PRESSURE_QUESTION_SLOT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ id }) => id)
);

const explicitPressureQuestionReference = (text: string) =>
  /(?:追问|追着问|连续问|一连串.{0,4}问|一个接一个.{0,4}(?:问|问题)|问个不停|一串问题|问太多|盘问|逼着你回答|逼你回答|索取细节)/u.test(text);

const referencesTargetPressureQuestion = ({
  text,
  targetSlots,
}: {
  text: string;
  targetSlots: Set<string>;
}) => {
  if (explicitPressureQuestionReference(text)) return true;
  if (!/(?:问|问题|询问)/u.test(text)) return false;
  const replySlots = pressureQuestionSlots(text);
  return [...replySlots].some((slot) => targetSlots.has(slot));
};

const pressureMoveDisavowal = (text: string) =>
  /(?:不对|不合适|不该|不应|不再|不会再|不能再|停止|收回|撤回|越界|过头|问偏|偏离.{0,8}重点|没(?:有)?回应|没接住|没对上|没抓住)/u.test(text);

const pressureRepairCompletion = (text: string) =>
  /(?:不对|不合适|不该|不应|不再|不会再|不能再|停止|收回|撤回|越界|过头|问偏|偏离.{0,8}重点|没(?:有)?回应|没接住|没对上|没抓住|逼着你回答|逼你回答)/u.test(text);

const collectPressureQuestionRepairEvidence = ({
  contract,
  reply,
  explicitFirstPersonOwnership,
}: {
  contract: RepairPositiveFunctionContract;
  reply: string;
  explicitFirstPersonOwnership: boolean;
}): RepairSemanticEvidence => {
  const targetSlots = pressureQuestionSlots(contract.targetText);
  const clauses = reply
    .split(/[，,。；;！!？?]/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const referencedClauses = clauses.filter((clause) =>
    referencesTargetPressureQuestion({ text: clause, targetSlots })
  );
  const disavowingClauses = clauses.filter((clause, index) => {
    if (!pressureMoveDisavowal(clause)) return false;
    if (referencesTargetPressureQuestion({ text: clause, targetSlots })) return true;
    const previousClause = clauses[index - 1];
    return /^(?:这|这样|这种|这么|那样|这个)/u.test(clause) && Boolean(
      previousClause && referencesTargetPressureQuestion({ text: previousClause, targetSlots })
    );
  });
  const explicitlyAttributesQuestionToUser =
    /(?:你|用户)(?:刚才|前面)?[^，,。；;！!？?]{0,12}(?:问|询问|追问)/u.test(reply);
  const omittedAssistantSubject =
    !explicitlyAttributesQuestionToUser &&
    disavowingClauses.some((clause) => /(?:刚才|前面|之前|上一句)/u.test(clause));
  return {
    moveReference: referencedClauses.length > 0,
    assistantOwnership: explicitFirstPersonOwnership || omittedAssistantSubject,
    moveDisavowal: disavowingClauses.length > 0,
    repairCompletionEvidence: disavowingClauses.some(pressureRepairCompletion),
    continuesRejectedMove: /[？?]/u.test(reply),
  };
};

// Historical compatibility helper retained while old evidence fixtures migrate; not a production gate.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const collectRepairQualityFailures = ({
  plan,
  reply,
}: {
  plan: ResponsePlan;
  reply: string;
}) => {
  if (!plan.responseActions.includes("repair_previous_wording")) return [];
  const failures: string[] = [];
  const normalized = normalize(reply);
  const contract = plan.positiveFunctionContract;
  if (contract?.action !== "repair_previous_wording") {
    failures.push("repair:missing_positive_function_contract");
  } else {
    const explicitFirstPersonOwnership =
      /(?:是我|是我的(?:问题|错|责任)|我刚才|我前面|我弄错|我搞错|我记错|我认错|我理解错|我说错|我多说|我不该|我不应|我(?:先)?(?:收回|撤回)|抱歉.{0,10}(?:是我|是我的|我|刚才|前面)|对不起.{0,10}(?:是我|是我的|我|刚才|前面))/u.test(normalized);
    const unambiguousOmittedSubjectOwnership =
      /(?:抱歉|对不起)[，,\s]*(?:(?:刚才|前面)\s*)?(?:把.{0,10})?(?:记错|弄错|搞错|认错|看错|说错|理解错)/u.test(normalized) ||
      /(?:^|[。！？!?]\s*)(?:刚才|前面).{0,32}(?:不该|不应|越界|偏离.{0,6}重点|没(?:有)?回应.{0,6}重点|没对上.{0,6}重点|问偏|跑题)/u.test(normalized);
    const pressureQuestionEvidence =
      contract.repairMode === "interaction_move_withdrawal" &&
      contract.interactionMoveSubtype === "pressure_question"
        ? collectPressureQuestionRepairEvidence({
            contract,
            reply: normalized,
            explicitFirstPersonOwnership,
          })
        : null;
    const ownsAssistantError = pressureQuestionEvidence?.assistantOwnership ??
      (explicitFirstPersonOwnership || unambiguousOmittedSubjectOwnership);
    if (!ownsAssistantError) failures.push("repair:missing_ownership");

    if (contract.repairMode === "factual_replacement") {
      if (!contract.replacementFact || !normalized.includes(contract.replacementFact)) {
        failures.push("repair:missing_factual_replacement");
      }
    } else if (contract.repairMode === "proposition_withdrawal") {
      const explicitlyWithdraws =
        /(?:收回|撤回|作废).{0,18}(?:那|刚才|前面|这个|自己的|判断|说法|理解)?/u.test(normalized) ||
        /(?:那|刚才|前面|这个).{0,18}(?:收回|撤回|作废|不再作为|不再沿用)/u.test(normalized) ||
        /不该(?!那样(?:说|讲)(?:[。！!]|$)).{1,24}/u.test(normalized) ||
        /(?:说法|判断|理解).{0,12}不再(?:作为|沿用)/u.test(normalized);
      if (!explicitlyWithdraws) failures.push("repair:missing_proposition_withdrawal");
      if (/(?:但|不过)[，,\s]*(?:其实)?你(?:可能|也许|大概|还是|其实)/u.test(normalized)) {
        failures.push("repair:continues_withdrawn_proposition");
      }
    } else {
      const subtype = contract.interactionMoveSubtype;
      const identifiesMove = subtype === "pressure_question" && pressureQuestionEvidence
        ? pressureQuestionEvidence.moveReference
        : subtype === "unsolicited_advice"
        ? /(?:建议|教你|教你怎么做|替你决定|出主意|给方案|给主意|列.{0,5}(?:方案|选项|清单)|让你.{0,8}(?:列|做).{0,5}(?:方案|选项|清单)|让你怎么做)/u.test(normalized)
        : subtype === "generic_listening"
            ? /(?:套话|空话|泛泛.{0,4}(?:回应|说)|(?:只|光|光顾着).{0,6}(?:说|丢下).{0,6}(?:会听|认真听)|(?:会|认真)听.{0,8}(?:没|没有).{0,6}(?:重点|接住)|只(?:是)?重复(?:那|这)(?:句|些)?(?:话)?|重复.{0,6}(?:会听|那句话))/u.test(normalized)
            : subtype === "moralizing"
              ? /(?:应该不应该|应该.{0,6}(?:勇敢|面对)|评判|评价|说教|讲道理|道德|对错|勇不勇敢|勇敢(?:一)?点|不够勇敢|不能总)/u.test(normalized)
              : subtype === "topic_switch"
                ? /(?:转(?:开|走|换)话题|换(?:了)?话题|扯到|带到|岔开|放松|呼吸练习|跑到.{0,8}(?:放松|别的)|把.{0,12}(?:带偏|扯偏)|话题.{0,8}(?:带偏|跑偏))/u.test(normalized)
                : false;
      const functionallyDisavowsMove = subtype === "pressure_question" && pressureQuestionEvidence
        ? pressureQuestionEvidence.moveDisavowal
        : /(?:不该|不应|不再|不会再|不能再|收回|撤回|停止|错在|越界|多嘴|没守住边界|只是空话|是空话|没抓住.{0,6}重点|没接住.{0,6}重点|没对上.{0,6}重点|没(?:有)?回应.{0,6}重点|问偏了?|偏离了?.{0,6}重点|跑题了?|(?:没|没有).{0,4}(?:接|回应|抓).{0,6}(?:重点|原话)|(?:用|拿).{0,5}(?:空话|套话|泛泛回应).{0,8}(?:代替|顶替).{0,8}(?:回应|承接|接住)|把.{0,8}重点(?:搞错|弄错)|带偏了|跑偏了|岔开.{0,4}话题|是我的(?:问题|错|责任))/u.test(normalized);
      const repairCompletionEvidence = subtype === "pressure_question" && pressureQuestionEvidence
        ? pressureQuestionEvidence.repairCompletionEvidence
        : functionallyDisavowsMove;
      if (!subtype || !functionallyDisavowsMove || !identifiesMove || !repairCompletionEvidence) {
        failures.push(`repair:missing_interaction_move_withdrawal:${subtype ?? "missing_subtype"}`);
      }
      if (subtype === "pressure_question" && pressureQuestionEvidence?.continuesRejectedMove) {
        failures.push("repair:continues_rejected_interaction_move:pressure_question");
      }
    }
  }
  if (asksUserToDiagnoseAssistantFailure(normalized)) {
    failures.push("repair:user_must_diagnose_assistant_failure");
  }
  if (/(?:抱歉|对不起)(?:让你|如果让你)(?:有这种感觉|觉得|误会)/u.test(normalized)) {
    failures.push("repair:non_owning_apology");
  }
  if (/(?:是|可能是|也许是)?你.{0,10}(?:没表达清楚|误会|想多了|太敏感)/u.test(normalized)) {
    failures.push("repair:shifts_blame_to_user");
  }
  if (/(?:但|不过).{0,12}(?:我的意思|我只是|其实我|我是想)/u.test(normalized)) {
    failures.push("repair:self_defense");
  }
  return failures;
};

const collectTopicInitiativeFailures = ({
  plan,
  reply,
}: {
  plan: ResponsePlan;
  reply: string;
}) => {
  if (!plan.responseActions.includes("take_light_topic_initiative")) return [];
  const failures: string[] = [];
  if (
    /^(?:没关系|不要紧|不用着急|不想说(?:也)?(?:可以|没关系|就不说)|先不说(?:也行)?)[，,。！!\s]*/u.test(reply)
  ) {
    failures.push("topic_initiative:reassurance_or_pause_preface");
  }
  if (/(?:让你觉得|有没有什么小事).{0,10}(?:还行|不错|开心|舒服|治愈|感激)/u.test(reply)) {
    failures.push("topic_initiative:positive_or_healing_frame");
  }
  return failures;
};

const collectProactiveGreetingResponseFailures = ({
  plan,
  reply,
}: {
  plan: ResponsePlan;
  reply: string;
}) => {
  if (!plan.responseActions.includes("respond_to_proactive_greeting")) return [];
  const userMessage = currentUserMessageFromPlan(plan);
  const failures: string[] = [];
  if (
    /^(?:嗯|哦|好|好的|知道了|收到|明白了|行)[，,。！!\s]*(?:知道了|收到|明白了)?[。！!\s]*$/u.test(reply)
  ) {
    failures.push("proactive_greeting_response:empty_acknowledgement");
  }
  if (/(?:就好|就行|就可以了|知道了|收到(?:了)?)[。！!\s]*$/u.test(reply)) {
    failures.push("proactive_greeting_response:generic_closure");
  }
  if (/^(?:那)?(?:挺好|很好|不错|可以|还行)(?:的)?[。！!\s]*$/u.test(reply)) {
    failures.push("proactive_greeting_response:generic_approval");
  }
  if (userMessage) {
    const addedEvaluation = unsupportedEvaluationTerms.find((term) =>
      reply.includes(term) && !userMessage.includes(term)
    );
    if (addedEvaluation) {
      failures.push(
        `proactive_greeting_response:unsupported_evaluation:${addedEvaluation}`
      );
    }
  }
  const normalizedReply = normalizeForEcho(reply);
  const normalizedUser = normalizeForEcho(userMessage);
  if (
    normalizedReply &&
    normalizedUser &&
    (
      normalizedReply === normalizedUser ||
      (
        normalizedReply.length >= 2 &&
        normalizedUser.includes(normalizedReply)
      )
    )
  ) {
    failures.push("proactive_greeting_response:bare_echo");
  }
  if (
    /(?:还有呢|然后呢|为什么呢|想再说说吗|最近怎么样|你觉得呢)[？?]$/u.test(reply)
  ) {
    failures.push("proactive_greeting_response:generic_follow_up");
  }
  const staleContent = preProactiveGreetingUserMessagesFromPlan(plan).find(
    (message) => {
      const normalizedStale = normalizeForEcho(message);
      return (
        !explicitlyResumesPreGreetingHistory(userMessage) &&
        normalizedStale.length >= 2 &&
        normalizedReply.includes(normalizedStale) &&
        !normalizedUser.includes(normalizedStale)
      );
    }
  );
  if (staleContent) {
    failures.push("proactive_greeting_response:stale_pre_greeting_content");
  }
  return failures;
};

const repeatsRejectedGroundingProposition = (
  reply: string,
  reference: NonNullable<
    NonNullable<ResponsePlan["correction"]>["challengedPropositions"][number]["groundingReference"]
  >
) => {
  if (reference === "assistant_name") return reply.includes(ASSISTANT_DISPLAY_NAME);
  if (reference === "identity") return reply.includes(ASSISTANT_DISPLAY_NAME) ||
    /(?:我是|属于|作为).{0,8}(?:AI|人工智能|聊天助手)/u.test(reply);
  if (reference === "ai_identity") return /(?:我是|属于|作为).{0,8}(?:AI|人工智能|聊天助手|真人|人类)/u.test(reply);
  if (reference === "clinician_identity") return /心理医生|心理咨询师|咨询师|治疗师|专业人员/u.test(reply);
  if (["body", "body_metaphor", "physical_presence", "physical_presence_metaphor"].includes(reference)) {
    return /没有(?:真实)?身体|没有现实中的物理位置|不能真的|不会真的|没法真的|不是字面|只是.{0,8}(?:说法|比喻|比方)/u.test(reply);
  }
  if (reference === "voice_input" || reference === "hearing") return /语音输入|不能听|听不见|只能.{0,4}文字/u.test(reply);
  if (reference === "voice_output") return /语音输出|不能.{0,6}(?:发|播放|用).{0,4}语音|只能.{0,4}(?:文字|打字)/u.test(reply);
  if (reference === "vision") return /不能看|看不见|看不到|没法看|无法看/u.test(reply);
  if (reference === "time") return /实时|当前时间|现在几点/u.test(reply);
  if (reference === "memory") return /记忆|记得|不一定记得/u.test(reply);
  return false;
};

const obligationSatisfied = (reply: string, obligation: ResponsePlan["answerObligations"][number]) => {
  if (obligation.kind === "assistant_name") {
    return reply.includes(ASSISTANT_DISPLAY_NAME) && !usesProductNameAsAssistantName(reply);
  }
  if (obligation.kind === "identity") {
    return reply.includes(ASSISTANT_DISPLAY_NAME) && /AI|人工智能|聊天助手/u.test(reply);
  }
  if (obligation.kind === "ai_identity") {
    const statesAiIdentity = /AI|人工智能|聊天助手/u.test(reply);
    const contradictsHumanClaim = /(?:我是|属于|作为).{0,6}(?:真人|人类)/u.test(reply);
    return statesAiIdentity && !contradictsHumanClaim;
  }
  if (obligation.kind === "clinician_identity") {
    return /不是|不能代替|不能替代|不属于/u.test(reply) &&
      /心理医生|心理咨询师|咨询师|治疗师|专业人员/u.test(reply);
  }
  if (obligation.kind === "body_capability") {
    const statesLiteralBoundary = /没有(?:真实)?身体|没有现实中的物理位置|不能真的|不会真的|没法真的|不是字面|只是.{0,8}(?:说法|比喻|比方)|通过文字/u.test(reply);
    const requiresMetaphorAcknowledgement = obligation.requiredDisclosure.some((item) =>
      item.includes("关系隐喻")
    );
    const acknowledgesMetaphor = /(?:刚才|前面|上一句|之前).{0,12}(?:说法|比喻|比方|口语)|只是.{0,8}(?:说法|比喻|比方)/u.test(reply);
    return statesLiteralBoundary && (!requiresMetaphorAcknowledgement || acknowledgesMetaphor);
  }
  if (obligation.kind === "voice_input") return /不能听|听不见|不支持.{0,4}语音输入|只能.{0,4}文字/u.test(reply);
  if (obligation.kind === "voice_output") return /不能.{0,6}(?:发|播放|用).{0,4}语音|不支持.{0,4}语音|只能.{0,4}(?:文字|打字)|文字.{0,6}(?:回复|聊天|交流)/u.test(reply);
  if (obligation.kind === "perception_capability") return /不能看|看不见|看不到|没法看|无法看|只能.{0,4}文字/u.test(reply);
  if (obligation.kind === "time_capability") return /不知道.{0,6}(?:实时|当前|现在).{0,4}时间|没有.{0,6}(?:实时|当前).{0,4}时间|需要.{0,6}(?:提供|告诉).{0,4}时间/u.test(reply);
  if (obligation.kind === "memory_capability") return /只能.{0,12}(?:当前|提供|选取|聊天)|不一定记得|不会.{0,8}全部|有限/u.test(reply);
  if (obligation.kind === "proactive_messaging_capability") {
    const statesOpenOrReturnGreeting =
      /(?:打开|回到|进入).{0,28}(?:先.{0,10}(?:问候|打招呼)|(?:问候|打招呼).{0,10}(?:先|主动))/u.test(reply);
    const statesNoBackgroundPush =
      /(?:关闭|关掉|退出|离开).{0,24}(?:不能|没法|不会).{0,12}(?:主动)?(?:推送|发消息|联系)/u.test(reply) ||
      /(?:不能|没法|不会).{0,24}(?:关闭|关掉|退出|离开).{0,12}(?:推送|发消息|联系)/u.test(reply);
    return statesOpenOrReturnGreeting && statesNoBackgroundPush;
  }
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
  if (plan.questionPolicy.mode === "none" && /[？?]/u.test(text)) {
    failureReasons.push("question_not_allowed_by_plan");
  }
  if ((text.match(/[？?]/gu) ?? []).length > 1) {
    failureReasons.push("too_many_follow_up_questions");
  }
  if (plan.responseActions.includes("establish_assistant_identity")) {
    const identityContract = plan.positiveFunctionContract?.action === "establish_assistant_identity"
      ? plan.positiveFunctionContract
      : null;
    if (!identityContract) {
      failureReasons.push("assistant_identity:missing_positive_function_contract");
    }
    if (!text.includes(identityContract?.displayName ?? ASSISTANT_DISPLAY_NAME)) {
      failureReasons.push("assistant_identity:missing_canonical_display_name");
    }
    if (usesProductNameAsAssistantName(text)) {
      failureReasons.push("assistant_identity:product_name_used_as_assistant_name");
    }
    if (/(?:我没有|没有自己的|还没有|暂时没有).{0,6}(?:名字|称呼)/u.test(text)) {
      failureReasons.push("assistant_identity:canonical_identity_withheld");
    }
  }
  if (
    plan.requiredDisclosure.some((item) => item.includes("是当前产品名称，不是助手称呼")) &&
    !(text.includes(PRODUCT_NAME) && /产品/u.test(text) && /不是.{0,8}(?:称呼|名字)/u.test(text))
  ) {
    failureReasons.push("assistant_identity:missing_product_assistant_disambiguation");
  }
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
  failureReasons.push(...collectOrdinaryAcknowledgementFailures({ plan, reply: text }));
  failureReasons.push(...collectOrdinaryHandoffFailures({ plan, reply: text }));
  failureReasons.push(...collectMechanicalReplyFailures({ plan, reply: text }));
  if (plan.positiveFunctionContract?.action === "offer_emotional_support") {
    failureReasons.push(...collectUnsupportedAffectClaimFailures({ plan, reply: text }));
  }
  failureReasons.push(...collectTopicInitiativeFailures({ plan, reply: text }));
  failureReasons.push(...collectProactiveGreetingResponseFailures({ plan, reply: text }));
  for (const proposition of plan.correction?.challengedPropositions ?? []) {
    if (
      proposition.groundingReference &&
      repeatsRejectedGroundingProposition(text, proposition.groundingReference)
    ) {
      failureReasons.push(`repeated_rejected_grounding_proposition:${proposition.id}`);
    }
  }
  if (/(?:我会|我能|我可以).{0,5}(?:真的)?(?:坐|抱|触碰)|我(?:就在|正待在).{0,8}(?:你身边|这里陪你)/u.test(text)) {
    failureReasons.push("assistant_grounding:embodiment_claim");
  }
  if (/(?:我是|属于|作为).{0,6}(?:心理医生|心理咨询师|治疗师)/u.test(text)) {
    failureReasons.push("assistant_grounding:clinician_claim");
  }
  if (/(?:我是|属于|作为).{0,6}(?:真人|人类)/u.test(text)) {
    failureReasons.push("assistant_grounding:human_claim");
  }
  if (/(?:我能|我可以|我会|我正在|我就在).{0,8}(?:看见|看到|听见|听到|触碰|碰到|抱到)/u.test(text)) {
    failureReasons.push("assistant_grounding:unsupported_perception_or_contact");
  }
  if (plan.prohibitedClaims.some((claim) => claim.includes("message form or repetition"))) {
    failureReasons.push(...collectUnsupportedMeaningFailureReasons(text));
  }
  const uniqueFailureReasons = Array.from(new Set(failureReasons));
  const classified = classifyResponseValidationReasons(uniqueFailureReasons);
  return {
    passed: classified.hardFailureReasons.length === 0,
    failureReasons: uniqueFailureReasons,
    ...classified,
    rewriteRequired: classified.advisoryFailureReasons.length > 0,
    checkedPlanId: plan.planId,
    planChanged: false,
  };
};

const regenerationInstructionFor = (plan: ResponsePlan, failure: string) => {
  if (failure === "assistant_voice:mechanical_receipt_or_presence") {
    return "删除“收到、我在、随时都在”或只重复问候的客服式收条。按当前 ResponsePlan 完成一个具体会话功能：允许提问时给出一个容易回答的自然话头；禁止提问时则贴住用户本轮内容并向前推进，不要只宣布在线。";
  }
  if (failure === "assistant_grounding:invented_waiting_activity") {
    return "不要声称一直在等用户、正在等用户来聊天。只描述当前真实动作，例如正在回复这条消息；再按 ResponsePlan 继续当前对话。";
  }
  if (failure === "repair:generic_receipt") {
    return "删除“收到、记下了、我会听”式收条；明确指出并撤回助手上一轮造成问题的具体措辞或互动动作。";
  }
  if (failure === "ordinary_handoff:no_new_conversation_function") {
    return "删除纯收件、纯在场或泛泛开放式话术；实现 ResponsePlan 已选定的普通交接动作，为下一轮增加一个可识别的会话功能。";
  }
  if (failure === "ordinary_handoff:calibration_requires_one_question") {
    return "只保留一个低压力、非诱导的校准问题；不猜含义，也不让用户解释完整意图。";
  }
  if (failure === "ordinary_handoff:calibration_demands_explanation") {
    return "不要问“什么意思、想表达什么、为什么发”或要求解释；换成容易回答的低负担校准。";
  }
  if (failure === "ordinary_handoff:calibration_suggests_unproved_meaning") {
    return "删除对当前输入可能含义的举例或猜测；只询问用户希望助手下一步先等待、先起一个中性话头或采取其他明确动作。";
  }
  if (failure === "ordinary_handoff:question_forbidden_for_selected_move") {
    return "删除问题；用陈述句完成已选定的继续当前框架、当前话题或中性话题入口。";
  }
  if (failure === "emotional_support:receipt_then_information_request") {
    return "不要只复述或宣布听到后立刻索取原因/细节；先完成一个贴合用户已表达内容的支持动作，再决定是否需要一个真正可选的低负担邀请。";
  }
  if (failure === "emotional_support:missing_positive_function_contract") {
    return "当前 ResponsePlan 缺少情绪支持正向功能合同；不得自行选择支持方式。";
  }
  if (failure === "emotional_support:missing_grounded_affect_or_impact") {
    return "先贴住用户当前明确表达的感受或关系影响；不要换成新的情绪标签或事件评价。";
  }
  const missingSupportFunction = failure.match(/^emotional_support:missing_selected_function:(.+)$/u);
  if (missingSupportFunction) {
    return `完成 ResponsePlan 已选择的支持功能“${missingSupportFunction[1]}”；纯复述、纯邀请、“我在”或“按你的节奏”不能替代该功能。`;
  }
  if (failure === "emotional_support:assistant_centered_understanding") {
    return "删除关于助手正在努力理解、无法完全理解或能完全体会的自我陈述；把回复重心放回用户明确表达的体验和选择权。";
  }
  if (failure === "emotional_support:user_must_diagnose_assistant_failure") {
    return "不要要求用户指出助手究竟哪句话、哪件事或哪里做错；在缺少具体前文时承认当前影响和信息边界，把是否以及如何继续的决定留给用户。";
  }
  if (failure === "emotional_support:non_owning_apology") {
    return "删除“抱歉让你有这种感觉/让你觉得……”式非承担性道歉；只承认当前可见影响和信息边界，不暗示问题只是用户的感觉。";
  }
  if (failure === "emotional_support:formulaic_presence_or_contact") {
    return "删除“我在、我陪着你、抱抱你”等公式化在场或模拟接触；改为贴合用户已明确表达内容、并保留其表达选择权的支持动作。";
  }
  if (failure === "emotional_support:generic_normalization_or_reassurance") {
    return "删除对情绪本身的“正常、没关系、自然、是可以的、可接受”等评价；不要评价用户该如何看待或管理自己的感受。若计划需要表达量控制，只能把许可明确附着于少说、未说完整或其他表达数量选择。";
  }
  if (failure === "emotional_support:unsolicited_regulation_advice") {
    return "删除未经请求的呼吸、缓一缓、休息或调整建议；本轮只承接用户已经表达的体验和表达边界。";
  }
  if (failure === "emotional_support:unrequested_pause_or_closure") {
    return "删除未经请求的安静待着、等待、稍后继续或先放一放选项；减轻分析或表达负担不等于暂停、悬置或结束话题。保留当前计划的正向功能，并在本轮直接完成它。";
  }
  if (failure === "emotional_support:default_cause_or_detail_question") {
    return "删除对原因、触发事件或具体经过的默认追问；如计划允许邀请，只把说什么、说多少以及是否继续的控制权交给用户。";
  }
  if (failure === "emotional_support:out_of_scope_topic_switch") {
    return "删除切换其他话题或转移注意力的选项；只在用户本轮已经表达的感受与关系影响内完成所选支持功能。不要再补一个 A-or-B 的第二选项，一个当前焦点邀请已经完整。";
  }
  if (failure === "emotional_support:out_of_scope_unknown_content") {
    return "删除“别的、其他、别的什么、其他事情、不相干内容”等无明确指代的未知选项；“别的部分/其他方面”只有明确从属于当前已表达的感受时才有范围。保留已经完成的支持功能，并把所有可选焦点限定在当前用户本轮已经表达的内容中。不要用另一个未知选项填回原位置。";
  }
  if (failure === "emotional_support:out_of_scope_unsupported_cause_or_event") {
    return "删除用户没有提供的其他原因、事件或“还有什么让你……”；保留当前情绪承接，只允许用户选择当前已知内容的焦点。";
  }
  if (failure === "emotional_support:unsupported_event_or_time") {
    return "删除用户本轮没有提供的先前事件、时间或具体经过；只使用正向功能合同中的当前轮证据。";
  }
  const unsupportedAffectCategory = failure.match(/^emotional_support:unsupported_affect_category:[^:]+:(.+)$/u);
  if (unsupportedAffectCategory) {
    return `删除用户本轮没有表达的情绪类别“${unsupportedAffectCategory[1]}”；只使用正向功能合同中的情绪证据。`;
  }
  const emotionalIntensification = failure.match(/^emotional_support:unsupported_intensification:(.+)$/u);
  if (emotionalIntensification) {
    return `删除用户本轮没有说出的强化情绪词“${emotionalIntensification[1]}”；只使用用户自己明确表达的强度和关系影响。`;
  }
  if (failure === "repair:missing_positive_function_contract") {
    return "当前 ResponsePlan 缺少普通修复正向功能合同；不得自行选择修复方式。";
  }
  if (failure === "repair:missing_ownership") {
    return "明确把错误归于助手自己的上一行动、判断或措辞；不要只说发生了误会或用户有某种感觉。";
  }
  if (failure === "repair:missing_factual_replacement") {
    return "采用 ResponsePlan 中用户已经明确给出的替代事实，完成事实型修正；不要额外猜测。";
  }
  if (failure === "repair:missing_proposition_withdrawal") {
    return "明确撤回、否定或停止沿用 ResponsePlan 指定的被拒绝命题；只有道歉或“理解偏了”不算完成。";
  }
  if (failure === "repair:continues_withdrawn_proposition") {
    return "撤回后不要用“但你可能还是……”继续推进同一个被用户拒绝的判断；本轮只完成撤回。";
  }
  const missingInteractionMove = failure.match(/^repair:missing_interaction_move_withdrawal:(.+)$/u);
  if (missingInteractionMove) {
    const contract = plan.positiveFunctionContract?.action === "repair_previous_wording"
      ? plan.positiveFunctionContract
      : null;
    return `使用相邻目标动作“${contract?.targetText || "目标动作缺失"}”中的具体证据，明确承担并功能性否定同一个互动动作；可以说明它不应发生、越界、无效或偏离重点，不要求复述内部子类型“${missingInteractionMove[1]}”或固定使用“停止/撤回”，也不要用另一个问题、建议或承诺替代。`;
  }
  if (failure === "repair:continues_rejected_interaction_move:pressure_question") {
    return "删除修复后的新问题；本轮只完成对刚才追问动作的承担和功能性否定，不再索取任何细节或原因。";
  }
  if (failure === "repair:user_must_diagnose_assistant_failure") {
    return "删除要求用户指出助手错误位置的提问或请求；修复责任属于助手。";
  }
  if (failure === "repair:self_defense") {
    return "删除“但/不过我的意思是……”式解释或辩护；只承担并撤回已经被拒绝的理解。";
  }
  if (failure === "repair:non_owning_apology") {
    return "删除“抱歉让你觉得/误会”式非承担性道歉；明确承担并撤回助手自己的错误理解或措辞。";
  }
  if (failure === "repair:shifts_blame_to_user") {
    return "删除把问题归因于用户没表达清楚、误会、想多或敏感的说法；修复责任属于助手。";
  }
  const unsupportedEvaluation = failure.match(
    /^(?:ordinary_acknowledgement|proactive_greeting_response):unsupported_evaluation:(.+)$/u
  );
  if (unsupportedEvaluation) {
    const term = unsupportedEvaluation[1];
    return `删掉助手自行添加的评价词“${term}”。用户没有评价该活动、偏好或经历时，不要替用户说它好、不错、舒服或有益；只承接用户明确说出的内容。`;
  }
  if (failure === "proactive_greeting_response:stale_pre_greeting_content") {
    return "删除主动欢迎语之前的旧话题。只回应当前用户在欢迎语之后明确说出的内容；除非用户本轮主动重提，否则不要恢复更早的话题。";
  }
  return `修复校验项 ${failure}，不要改变 ResponsePlan 的动作、事实边界或对话目标。`;
};

export const formatResponsePlanRegenerateConstraint = (
  plan: ResponsePlan,
  failures: string[]
) => [
  "上一次候选回复未通过同一 ResponsePlan 的输出校验。",
  `必须保持完全相同的 ResponsePlan planId=${plan.planId}；不得重新解释用户，不得另选目标或策略。`,
  "本次只按以下要求改写：",
  ...failures.map((failure) =>
    `- failureCode=${failure}\n  修复方式：${regenerationInstructionFor(plan, failure)}`
  ),
  ...(plan.questionPolicy.mode === "none"
    ? ["- 本计划禁止提问：不要添加问号，不要换一个话题继续采访用户。"]
    : []),
  "不要输出错误码、校验说明或内部计划；只输出新的用户可见回复。",
].join("\n");

const constraintFailureGeneration = (
  first: AiGenerationResult,
  second: AiGenerationResult,
  failures: string[]
): AiGenerationResult => ({
  ...second,
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
      after: second.rawLLMOutput ?? second.text,
      reason: `Same ResponsePlan failed twice and remained an internal rejected candidate: ${failures.join(", ")}`,
    },
  ],
});

export const enforceResponsePlan = async ({
  plan,
  generate,
  plannedFunctionSemanticContext,
  plannedFunctionSemanticProvider,
  inspectPlannedFunctionExternalPrompt,
  handoffSemanticContext,
  handoffSemanticProvider,
  inspectHandoffExternalPrompt,
}: {
  plan: ResponsePlan;
  generate: (constraint: string | null, executionPlan: ResponsePlan) => Promise<AiGenerationResult>;
  plannedFunctionSemanticContext?: PlannedFunctionSemanticContext;
  plannedFunctionSemanticProvider?: PlannedFunctionSemanticProvider;
  inspectPlannedFunctionExternalPrompt?: PlannedFunctionSemanticValidationPromptInspector;
  /** @deprecated Use plannedFunctionSemanticContext. */
  handoffSemanticContext?: InteractionMoveHandoffSemanticContext;
  /** @deprecated Use plannedFunctionSemanticProvider. */
  handoffSemanticProvider?: InteractionMoveHandoffSemanticProvider;
  /** @deprecated Use inspectPlannedFunctionExternalPrompt. */
  inspectHandoffExternalPrompt?: InteractionMoveHandoffValidationPromptInspector;
}) => {
  const executionPlan = recursivelyFreeze(structuredClone(plan));
  const semanticContext = plannedFunctionSemanticContext ?? (
    handoffSemanticContext
      ? {
          currentUserText: handoffSemanticContext.currentUserText,
          handoffTargetAssistantText: handoffSemanticContext.targetAssistantText,
        }
      : undefined
  );
  const semanticProvider = plannedFunctionSemanticProvider ?? (
    handoffSemanticProvider
      ? adaptInteractionMoveHandoffSemanticProvider(executionPlan, handoffSemanticProvider)
      : undefined
  );
  const semanticPromptInspector = inspectPlannedFunctionExternalPrompt ?? (
    inspectHandoffExternalPrompt
      ? adaptInteractionMoveHandoffPromptInspector(inspectHandoffExternalPrompt)
      : undefined
  );
  const validateCandidate = async (reply: string): Promise<ResponseValidationResult> => {
    const deterministic = validateResponsePlanOutput({ plan: executionPlan, reply });
    const semantic = await validatePlannedFunctionSemanticOutput({
      plan: executionPlan,
      reply,
      semanticContext,
      provider: semanticProvider,
      inspectExternalPrompt: semanticPromptInspector,
    });
    const hardFailureReasons = Array.from(new Set([
      ...(deterministic.hardFailureReasons ?? deterministic.failureReasons),
      ...semantic.hardFailureReasons,
    ]));
    const advisoryFailureReasons = Array.from(new Set([
      ...(deterministic.advisoryFailureReasons ?? []),
      ...semantic.advisoryFailureReasons,
    ]));
    const failureReasons = [...hardFailureReasons, ...advisoryFailureReasons];
    return {
      passed: hardFailureReasons.length === 0,
      failureReasons,
      hardFailureReasons,
      advisoryFailureReasons,
      rewriteRequired: advisoryFailureReasons.length > 0,
      checkedPlanId: executionPlan.planId,
      planChanged: false,
    };
  };
  const first = await generate(null, executionPlan);
  const firstValidation = await validateCandidate(first.text);
  if (firstValidation.failureReasons.length === 0) {
    return {
      outcome: "validated" as const,
      executionPlan,
      generation: first,
      attempts: [first],
      validations: [firstValidation],
      regenerateAttempted: false,
    };
  }
  const second = await generate(
    formatResponsePlanRegenerateConstraint(executionPlan, firstValidation.failureReasons),
    executionPlan
  );
  const secondValidation = await validateCandidate(second.text);
  if (secondValidation.passed) {
    return {
      outcome: "validated" as const,
      executionPlan,
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
    outcome: "failed" as const,
    executionPlan,
    generation: constraintFailureGeneration(first, second, [...firstValidation.failureReasons, ...secondValidation.failureReasons]),
    attempts: [first, second],
    validations: [firstValidation, secondValidation],
    regenerateAttempted: true,
  };
};
