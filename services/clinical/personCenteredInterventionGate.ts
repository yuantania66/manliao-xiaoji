import type { AiConversationMessage } from "@/services/ai/types";

import type {
  EligibilityReasonCode,
  InterventionFamily,
  PersonCenteredGateDecision,
  PersonCenteredGateEvidence,
  ResponseGoal,
} from "./clinicalTypes";
import { isUserCorrection } from "./userCorrectionSignal";

export const PERSON_CENTERED_INTERVENTION_FAMILIES: readonly InterventionFamily[] = [
  "bounded_decision_support",
  "direct_judgment",
  "low_risk_action_support",
  "high_impact_action_support",
  "general_advice",
  "diagnostic_assessment",
  "cbt",
  "act",
  "mi",
  "case_formulation",
  "dream_interpretation",
];

const BASELINE_RESPONSE_GOALS: ResponseGoal[] = [
  "reflect",
  "clarify",
  "help_continue_expression",
  "hold_space",
  "summarize",
];

const EXACT_REFUSAL_PATTERN = /^(?:不|不要|不用|不了|不行|别|no)$/i;
const REFUSAL_PATTERN =
  /不想(?:继续|再)?说|不想说|不想(?:现在|继续|再)?(?:知道|分析|解释|判断)|不想(?:让你|请你).{0,12}(?:知道|分析|解释|判断)|别(?:再)?问|不要(?:再)?问|别继续|不要继续|别分析|不要分析|先别分析|先(?:不要|别)往下(?:走|了)|(?:先|暂时)?别(?:再)?(?:给(?:我)?)?建议|先不要建议|不要建议|不要(?:再)?回答|(?:不需要|不用)(?:你)?(?:再)?(?:给(?:我)?|帮(?:我)?|告诉(?:我)?)?(?:任何)?(?:建议|分析|解释|判断|办法|帮忙|第一步|下一步|该先做什么|怎么做|怎么办)|(?:不要|别)(?:再)?(?:告诉我|帮我|给我)(?:怎么办|怎么做|分析|解释|判断|建议|第一步|下一步|该先做什么)|我只想说说/;
const NEGATED_REFUSAL_PATTERN =
  /(?:不是|并不是|并非)(?:不想(?:继续|再)?说|不想说|不想(?:再)?(?:知道|分析|解释|判断)|不想(?:让你|请你).{0,12}(?:知道|分析|解释|判断)|不要建议|不要(?:再)?回答|不需要(?:你)?(?:给(?:我)?)?(?:任何)?建议|不用(?:你)?(?:帮(?:我)?)?(?:建议|分析)|别给(?:我)?建议)/;
const PAUSE_PATTERN =
  /(?:^|[，。！？!?；;])(?:其实|还是|这件事|这事)?算了(?:吧|[，。！？!?]|$)|先不说了|不说了|不聊了|^(?:(?:我|我们)(?:想)?先?|先)?(?:暂停(?:一下)?|停一下|停一停)(?:吧|[，。！？!?]|$)|(?:^|[，。！？!?；;])(?:对[，,]?)?(?:不过|但)?(?:我想)?(?:先)?(?:暂停(?:一下)?|停一下|停一停|等等)(?:吧|[，。！？!?]|$)|(?:^|[，。！？!?；;])(?:不过|但)?先打住(?:吧|[，。！？!?]|$)|^(?:我|我们)?先(?:等一下|等等)(?:吧|[，。！？!?]|$)|先这样(?:吧|[，。！？!?]|$)|就这样吧|稍后再聊|^(?:我|我们)?回头再说(?:吧|[，。！？!?]|$)|下次再说|先到这|到这里吧|结束吧/;
const HESITATION_PATTERN =
  /可能算了|也可能再说|要不要说|不太想说|有点不想说|(?:还没|没有|没)准备好(?:继续|说|聊|面对|往下|接受建议|[，。！？!?]|$)|(?:还没|没有|没)准备好.{0,12}(?:分析|解释|判断|行动|接受建议)|还不确定要不要.{0,12}(?:分析|解释|判断|行动|接受建议)|有点犹豫要不要.{0,12}(?:分析|解释|判断|行动|接受建议)|想再考虑一下要不要.{0,12}(?:分析|解释|判断|行动|接受建议)|让我(?:再)?想想|我得想想/;
const NEGATED_HESITATION_PATTERN =
  /(?:不是|并不是|并非)(?:(?:还没|没有|没)准备好)/;
const RESPONSE_MISALIGNMENT_PATTERN =
  /你(?:刚才|前面)?(?:说偏了|偏题了|答非所问|说的不对)|(?:前面|刚才)(?:那段|那部分|的理解)?(?:不准确|不对)|(?:我说的)?不是(?:这个意思|这意思|这样的|这样)|这不是我问的|你没有回答我|你没回答我/;
const CONFIRMATION_PATTERN =
  /^(?:对|对的|是的|就是这样|没错|你说得对|你理解得对)(?:[，,。.!！]|$)/;
const MIXED_CONFIRMATION_PATTERN =
  /^(?:对|对的|是的|没错)[，,]?(?:但|不过|可)/;
const UNCLEAR_INPUT_PATTERN = /^(?:[0-9０-９]+|[a-zA-Z]|[^\s\p{L}\p{N}]|嗯+|啊+|哦+)$/u;
const EMOJI_EXPRESSION_PATTERN = /\p{Extended_Pictographic}/u;
const EXPLORATION_PATTERN =
  /为什么|怎么会|^是不是|说不清.*(?:原因|为什么)|脑子里.{0,24}是不是|会想.{0,24}是不是|觉得.{0,24}是不是/;
const RATING_QUESTION_PATTERN = /0.{0,6}10|几分|多少分|程度|评分|打分/;

const JUDGMENT_REQUEST_PATTERN =
  /该不该|要不要|谁对谁错|谁有错|帮我.{0,16}(?:判断|决定)|我该.{0,16}吗/;
const DREAM_INTERPRETATION_REQUEST_PATTERN =
  /梦.{0,20}(?:代表什么|意味着什么|是什么意思|怎么解释)|帮我.{0,16}(?:解梦|解释.{0,8}梦|分析.{0,8}梦)/;
const CASE_FORMULATION_REQUEST_PATTERN =
  /帮我.{0,16}(?:分析|解释).{0,16}(?:为什么|原因|总是|每次)|为什么我.{0,16}(?:总是|每次)/;
const CBT_REQUEST_PATTERN =
  /帮我.{0,16}(?:判断|看看).{0,16}(?:想法|推断).{0,16}(?:事实|依据)|这个想法.{0,16}(?:是不是|是否).{0,8}事实/;
const DIAGNOSTIC_REQUEST_PATTERN =
  /我是不是.{0,8}(?:抑郁|焦虑症|双相|精神疾病)|帮我.{0,12}(?:诊断|判断).{0,12}(?:抑郁|焦虑症|双相|精神疾病)/;
const HIGH_IMPACT_DOMAIN_PATTERN =
  /药|处方|诊断|治疗|手术|就医|自杀|不想活|伤害自己|法律|律师|诉讼|起诉|投资|股票|基金|加密货币|借贷|贷款|转账|转钱|把钱转|辞职|离职|离开.{0,4}公司|公司.{0,4}离开|分手|离婚|结束婚姻|怀孕|流产/;
const SEPARATE_ACTION_INTENT_PATTERN =
  /(?:^|[，。！？!?；;])(?:(?:我)?(?:现在)?|现在我)(?:想|打算|准备|决定|要)(?!要|知道|问|请|一个|个|点|些).{1,30}[，,。；;].{0,30}(?:第一步|下一步|小办法|小动作|最小.{0,4}(?:动作|步骤)|做什么|怎么办|怎么做)/;
const HIGH_UNCERTAINTY_PATTERN = /崩溃|绝望|撑不住|喘不过气|很害怕|特别害怕/;
const NARROW_ACTION_PATTERN =
  /第一步|下一步|一个.{0,8}(?:小办法|办法|动作|步骤)|今天.{0,12}(?:开始|能做)|两分钟|现在.{0,12}(?:能做|做什么|(?:可以|能).{0,4}做(?:点|些)?什么)|有什么.{0,12}(?:现在|今天).{0,8}(?:可以|能)做|先从哪一步|哪一步开始|最小.{0,4}(?:动作|步骤)|小动作|先做什么|该先做什么|能做什么/;
const LOW_RISK_ACTION_SEEKING_PATTERN =
  /(?:帮我|给我|给个|想要|需要|告诉我).{0,24}(?:第一步|下一步|办法|动作|步骤|做什么)|(?:现在|今天|接下来|下一步).{0,16}(?:(?:能|可以|该|要).{0,6})?(?:做(?:点|些)?什么|怎么办|怎么做|第一步|下一步)|(?:能|可以|该).{0,12}(?:做的)?(?:第一步|下一步|小办法|动作)|有什么.{0,16}(?:能|可以)做|(?:先从|从)(?:哪|什么).{0,4}(?:一步|步骤)|哪一步开始|一个.{0,8}(?:办法|动作|步骤)/;
const SAFE_LOW_RISK_SCOPE_PATTERN =
  /现在.{0,16}(?:能做|可以做|做(?:点|些)?什么|第一步|下一步)|今天.{0,16}(?:能做|可以做|开始|小办法|小动作)|小办法|小动作|最小.{0,4}(?:动作|步骤)|给(?:我)?(?:一个|个)?(?:第一步|下一步)|给个最小动作|(?:第一步|下一步).{0,8}(?:能做什么|做什么|怎么做|怎么办)|先从哪一步|从哪一步|哪一步开始|一个.{0,8}(?:办法|动作|步骤)/;
const NAMED_PROCEDURAL_ACTION_REQUEST_PATTERN =
  /(?:告诉我|给我)(?!(?:一个|个|现在|今天|第一步|下一步|能|可以|该|怎么))[^，。！？!?；;]{1,24}(?:第一步|下一步)/;
const EXPLICIT_ACTION_REQUEST_PATTERN =
  /帮我|给我|给(?:我)?(?:一个|个|点|些|一点|一些)?建议|给(?:我)?(?:一个|个).{0,8}(?:办法|动作|步骤|第一步|下一步)|告诉我|怎么办|怎么做|该怎么|我该|(?:我(?:现在)?|现在我)(?:想要|想知道|需要|要)(?:一个|个)?.{0,12}(?:办法|动作|步骤|第一步|下一步|能做什么)|先做什么|能做什么|能不能|可以.{0,8}建议|需要.{0,8}建议/;
const DIRECT_CURRENT_REQUEST_PATTERN =
  /^(?:请|麻烦)?(?:帮我|给我|给个|告诉我)|^(?:(?:我)?(?:现在)?|现在我)(?:想要|想知道|需要|要)|(?:^|[，。！？!?；;])(?:请|麻烦)?(?:(?:现在)?(?:帮我|给我|给个|告诉我|能不能|可以不可以)|(?:(?:我)?(?:现在)?|现在我)(?:想要|想知道|需要|要)|(?:我)?(?:现在)?想请你(?:帮我)?)|(?:^|[，。！？!?；;])(?:我想问你|我想请你|我问你|请问|我想问|想问|有个问题想问|我问)[：:]/;
const CURRENT_REQUEST_QUESTION_PATTERN =
  /(?:^|[，。！？!?；;])(?:请问[，,：:]?)?(?:那)?(?:(?:我)?(?:现在)?|现在我)(?:(?:下一步|第一步).{0,8})?(?:该|应该|要|能|可以|怎么|如何|为什么|是不是|谁).*[?？]$|(?:^|[，。！？!?；;])(?:下一步|第一步|现在|今天|这个梦|这件事|有什么|有没有|先从哪一步|从哪一步|哪一步).*[?？]$|(?:我该|我应该|我能|我可以|该怎么办|怎么办|怎么做)[^。！？!?；;]*[?？]$/;
const SUMMARY_ONLY_REQUEST_PATTERN =
  /(?:只|仅)?(?:帮我)?(?:整理|总结|梳理|复盘).{0,20}(?:刚才|已经|前面|说过|说的|内容)/;
const AMBIGUOUS_INTERVENTION_PURPOSE_PATTERN =
  /连续.{0,16}(?:梦见|做梦)|(?:最近|这阵子).{0,12}(?:总做|反复做).{0,8}梦|总做同一个梦|最近总是提不起劲|脑子里.{0,24}是不是/;
const REPORTED_SPEECH_CLAUSE_PATTERN =
  /(?:^|[，。！？!?；;])(?:关于|至于)?(?:朋友|同事|领导|医生|家人|妈妈|爸爸|伴侣|室友|他|她|他们|她们|别人|有人|我妈|我爸)(?:(?:的)?原话(?:是)?|发来消息|发消息|写道|问我|问(?!候)|告诉我|跟我说|对我说|说(?!话)|表示)[^，。！？!?；;]{0,80}(?:[，。！？!?；;]|$)/g;
const REPORTED_BOUNDARY_CLAUSE_PATTERN =
  /(?:^|[，。！？!?；;])(?:关于|至于)?(?:朋友|同事|领导|医生|家人|妈妈|爸爸|伴侣|室友|他|她|他们|她们|别人|有人|我妈|我爸)[^，。！？!?；;]{0,32}(?:不想(?:继续|再)?说|算了|别(?:再)?(?:问|分析|建议)|不要(?:再)?(?:问|分析|建议)|不需要建议)[^，。！？!?；;]*(?:[，。！？!?；;]|$)/g;
const GENERIC_REPORTED_QUESTION_PATTERN =
  /(?:^|[。！？!?；;])(?:(?:昨天|刚才|上周|前几天|之前|当时)[，,]?)?(?!(?:请问|(?:我)?想问|有个问题想问|我问))(?!(?:我|我们)(?:想|要|来|正在)?问(?:你|一下))(?!(?:没人|没有人))[^，。！？!?；;]{1,20}(?:问我|问道|问[：:])[,，：:]?[^。！？!?；;]{0,100}(?:[。！？!?；;]|$)/g;
const META_REPORTED_CLAUSE_PATTERN =
  /(?:^|[，。！？!?；;])(?:老师布置的题|报告里|朋友的问题|问卷题目|作业要求|题目|原文|消息内容)(?:是|写着|要求)?[：:]?[^，。！？!?；;]{0,100}(?:[，。！？!?；;]|$)/g;
const QUOTED_CONTENT_PATTERN = /“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'/g;
const CURRENT_INTENT_OVERRIDE_PATTERN =
  /(?:但|不过)?现在(?:我)?(?:已经)?(?:改主意了|准备好了)[，,]?|(?:是过去的事|那是之前(?:说的)?)[，,]?现在(?:我)?/g;
const DIRECT_QUOTED_REQUEST_INTRO_PATTERN =
  /(?:我想问你|我想请你|我问你|请问)[：:][“‘"']/;

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const getCurrentUserSpeech = (text: string) => {
  const withoutReportedClauses = text
    .replace(REPORTED_SPEECH_CLAUSE_PATTERN, " ")
    .replace(REPORTED_BOUNDARY_CLAUSE_PATTERN, " ")
    .replace(GENERIC_REPORTED_QUESTION_PATTERN, " ")
    .replace(META_REPORTED_CLAUSE_PATTERN, " ");
  const withoutQuotedContent = DIRECT_QUOTED_REQUEST_INTRO_PATTERN.test(
    withoutReportedClauses
  )
    ? withoutReportedClauses.replace(/[“”‘’"']/g, " ")
    : withoutReportedClauses.replace(QUOTED_CONTENT_PATTERN, " ");
  return normalize(withoutQuotedContent);
};

const focusCurrentBoundarySpeech = (text: string) => {
  const overrideMatches = [
    ...text.matchAll(CURRENT_INTENT_OVERRIDE_PATTERN),
  ];
  const lastOverride = overrideMatches.at(-1);
  const currentSpeech = lastOverride?.index === undefined
    ? text
    : text.slice(lastOverride.index);
  return normalize(currentSpeech);
};

const getPreviousAssistantMessage = (recentMessages: AiConversationMessage[]) => {
  const adjacentTurn = recentMessages.at(-1);
  return adjacentTurn?.role === "assistant" && normalize(adjacentTurn.content).length > 0
    ? adjacentTurn.content
    : null;
};

const classifyBoundary = ({
  text,
  hasPreviousAssistant,
}: {
  text: string;
  hasPreviousAssistant: boolean;
}): PersonCenteredGateEvidence["unresolvedCorrectionOrBoundary"] => {
  const refusalText = text.replace(NEGATED_REFUSAL_PATTERN, "");
  const hesitationText = text.replace(NEGATED_HESITATION_PATTERN, "");
  if (isUserCorrection(text) || RESPONSE_MISALIGNMENT_PATTERN.test(text)) {
    return { present: true, kind: "correction" };
  }
  if (MIXED_CONFIRMATION_PATTERN.test(text)) {
    return { present: true, kind: "hesitation" };
  }
  if (HESITATION_PATTERN.test(hesitationText)) {
    return { present: true, kind: "hesitation" };
  }
  if (PAUSE_PATTERN.test(text)) return { present: true, kind: "pause" };
  if (
    REFUSAL_PATTERN.test(refusalText) ||
    (hasPreviousAssistant && EXACT_REFUSAL_PATTERN.test(text))
  ) {
    return { present: true, kind: "refusal" };
  }
  return { present: false, kind: null };
};

const classifyExplicitRequest = ({
  text,
  legacyAdviceSignal,
}: {
  text: string;
  legacyAdviceSignal: boolean;
}): Pick<PersonCenteredGateEvidence, "interventionConsent"> | null => {
  const currentRequestBasis: PersonCenteredGateEvidence["interventionConsent"]["basis"] = [
    "current_explicit_request",
  ];
  const hasCurrentRequestSignal =
    DIRECT_CURRENT_REQUEST_PATTERN.test(text) ||
    CURRENT_REQUEST_QUESTION_PATTERN.test(text);

  if (hasCurrentRequestSignal && DIAGNOSTIC_REQUEST_PATTERN.test(text)) {
    return {
      interventionConsent: {
        status: "explicit_scoped",
        scope: ["diagnostic_assessment"],
        requestRisk: "interpretive_or_high_impact",
        basis: currentRequestBasis,
      },
    };
  }

  if (hasCurrentRequestSignal && DREAM_INTERPRETATION_REQUEST_PATTERN.test(text)) {
    return {
      interventionConsent: {
        status: "explicit_scoped",
        scope: ["dream_interpretation"],
        requestRisk: "interpretive_or_high_impact",
        basis: currentRequestBasis,
      },
    };
  }

  if (hasCurrentRequestSignal && CBT_REQUEST_PATTERN.test(text)) {
    return {
      interventionConsent: {
        status: "explicit_scoped",
        scope: ["cbt"],
        requestRisk: "interpretive_or_high_impact",
        basis: currentRequestBasis,
      },
    };
  }

  if (hasCurrentRequestSignal && CASE_FORMULATION_REQUEST_PATTERN.test(text)) {
    return {
      interventionConsent: {
        status: "explicit_scoped",
        scope: ["case_formulation"],
        requestRisk: "interpretive_or_high_impact",
        basis: currentRequestBasis,
      },
    };
  }

  if (
    (HIGH_IMPACT_DOMAIN_PATTERN.test(text) ||
      SEPARATE_ACTION_INTENT_PATTERN.test(text)) &&
    hasCurrentRequestSignal
  ) {
    return {
      interventionConsent: {
        status: "explicit_scoped",
        scope: ["high_impact_action_support"],
        requestRisk: "interpretive_or_high_impact",
        basis: currentRequestBasis,
      },
    };
  }

  if (hasCurrentRequestSignal && JUDGMENT_REQUEST_PATTERN.test(text)) {
    return {
      interventionConsent: {
        status: "explicit_scoped",
        scope: ["bounded_decision_support"],
        requestRisk: "interpretive_or_high_impact",
        basis: currentRequestBasis,
      },
    };
  }

  if (
    NARROW_ACTION_PATTERN.test(text) &&
    LOW_RISK_ACTION_SEEKING_PATTERN.test(text) &&
    SAFE_LOW_RISK_SCOPE_PATTERN.test(text) &&
    hasCurrentRequestSignal &&
    !HIGH_IMPACT_DOMAIN_PATTERN.test(text) &&
    !SEPARATE_ACTION_INTENT_PATTERN.test(text) &&
    !NAMED_PROCEDURAL_ACTION_REQUEST_PATTERN.test(text) &&
    !HIGH_UNCERTAINTY_PATTERN.test(text)
  ) {
    return {
      interventionConsent: {
        status: "explicit_scoped",
        scope: ["low_risk_action_support"],
        requestRisk: "simple_low_risk",
        basis: currentRequestBasis,
      },
    };
  }

  if (
    !SUMMARY_ONLY_REQUEST_PATTERN.test(text) &&
    hasCurrentRequestSignal &&
    (EXPLICIT_ACTION_REQUEST_PATTERN.test(text) || legacyAdviceSignal)
  ) {
    return {
      interventionConsent: {
        status: "explicit_scoped",
        scope: ["general_advice"],
        requestRisk: "unknown",
        basis: currentRequestBasis,
      },
    };
  }

  return null;
};

export const derivePersonCenteredGateEvidence = ({
  currentUserMessage,
  recentMessages,
  legacyAdviceSignal,
}: {
  currentUserMessage: string;
  recentMessages: AiConversationMessage[];
  legacyAdviceSignal: boolean;
}): PersonCenteredGateEvidence => {
  const text = normalize(currentUserMessage);
  const currentUserSpeech = getCurrentUserSpeech(text);
  const currentBoundarySpeech = focusCurrentBoundarySpeech(currentUserSpeech);
  const previousAssistantMessage = getPreviousAssistantMessage(recentMessages);
  const hasPreviousAssistant = Boolean(previousAssistantMessage);
  const boundary = classifyBoundary({
    text: currentBoundarySpeech,
    hasPreviousAssistant,
  });

  if (boundary.present) {
    const correction = boundary.kind === "correction";
    return {
      interactionStage: "repair_or_pause",
      understandingEvidence: {
        status: correction ? "contradicted" : "aligned",
        scope: correction ? "current_experience" : "boundary",
        basis: correction
          ? ["current_explicit_content", "user_correction"]
          : ["current_explicit_content"],
      },
      unresolvedCorrectionOrBoundary: boundary,
      interventionConsent: {
        status: "revoked",
        scope: [],
        requestRisk: "unknown",
        basis: ["current_revocation"],
      },
    };
  }

  const request = classifyExplicitRequest({
    text: currentUserSpeech,
    legacyAdviceSignal,
  });
  const adjacentConfirmation =
    hasPreviousAssistant && CONFIRMATION_PATTERN.test(currentUserSpeech);
  const summaryOnlyRequest = SUMMARY_ONLY_REQUEST_PATTERN.test(currentUserSpeech);

  if (request) {
    const lowRisk = request.interventionConsent.scope.includes("low_risk_action_support");
    return {
      interactionStage: "intervention_requested",
      understandingEvidence: {
        status: lowRisk
          ? adjacentConfirmation
            ? "aligned"
            : "provisional"
          : "unverified",
        scope: lowRisk ? "request_scope" : "relevant_facts",
        basis: [
          "current_explicit_content",
          "clear_current_request",
          ...(lowRisk && adjacentConfirmation
            ? (["adjacent_user_confirmation", "visible_history"] as const)
            : []),
        ],
      },
      unresolvedCorrectionOrBoundary: boundary,
      interventionConsent: request.interventionConsent,
    };
  }

  const ambiguousPurpose = AMBIGUOUS_INTERVENTION_PURPOSE_PATTERN.test(text);
  const unclear = !text || (UNCLEAR_INPUT_PATTERN.test(text) && !EMOJI_EXPRESSION_PATTERN.test(text));
  const answersRatingQuestion =
    Boolean(previousAssistantMessage) &&
    /^[0-9０-９]+(?:\.[0-9０-９]+)?$/.test(text) &&
    RATING_QUESTION_PATTERN.test(previousAssistantMessage ?? "");

  return {
    interactionStage: summaryOnlyRequest
      ? "understanding"
      : adjacentConfirmation
      ? "understanding"
      : answersRatingQuestion
        ? "understanding"
        : unclear
        ? "unclear"
        : EXPLORATION_PATTERN.test(text)
          ? "exploration"
          : "expression",
    understandingEvidence: summaryOnlyRequest
      ? {
          status: "provisional",
          scope: "request_scope",
          basis: ["current_explicit_content", "clear_current_request"],
        }
      : adjacentConfirmation
      ? {
          status: "aligned",
          scope: "current_experience",
          basis: ["current_explicit_content", "adjacent_user_confirmation", "visible_history"],
        }
      : answersRatingQuestion
        ? {
            status: "provisional",
            scope: "current_experience",
            basis: ["current_explicit_content", "visible_history"],
          }
      : unclear
        ? {
            status: "unverified",
            scope: "none",
            basis: [],
          }
        : {
            status: "provisional",
            scope: "current_experience",
            basis: ["current_explicit_content"],
          },
    unresolvedCorrectionOrBoundary: boundary,
    interventionConsent: {
      status: ambiguousPurpose ? "ambiguous" : "none",
      scope: [],
      requestRisk: "unknown",
      basis: [],
    },
  };
};

const blockedExcept = (allowed: InterventionFamily[]): InterventionFamily[] =>
  PERSON_CENTERED_INTERVENTION_FAMILIES.filter((family) => !allowed.includes(family));

const decision = ({
  evidence,
  readiness,
  maxIntensity,
  allowedFamilies,
  allowedGoals,
  preferredGoal,
  fallbackGoal,
  reason,
}: {
  evidence: PersonCenteredGateEvidence;
  readiness: PersonCenteredGateDecision["interventionReadiness"];
  maxIntensity: PersonCenteredGateDecision["maxInterventionIntensity"];
  allowedFamilies: InterventionFamily[];
  allowedGoals: ResponseGoal[];
  preferredGoal: ResponseGoal | null;
  fallbackGoal: ResponseGoal;
  reason: EligibilityReasonCode[];
}): PersonCenteredGateDecision => ({
  version: "person-centered-gate-v1",
  effectiveStage: evidence.interactionStage,
  interventionReadiness: readiness,
  maxInterventionIntensity: maxIntensity,
  allowedInterventionFamilies: [...allowedFamilies],
  blockedInterventionFamilies: blockedExcept(allowedFamilies),
  responseGoalPolicy: {
    allowed: [...allowedGoals],
    preferred: preferredGoal,
    fallback: fallbackGoal,
  },
  eligibilityReason: [...reason],
});

export const evaluatePersonCenteredInterventionGate = (
  evidence: PersonCenteredGateEvidence
): PersonCenteredGateDecision => {
  if (evidence.unresolvedCorrectionOrBoundary.present) {
    const correction = evidence.unresolvedCorrectionOrBoundary.kind === "correction";
    return decision({
      evidence,
      readiness: "blocked",
      maxIntensity: "none",
      allowedFamilies: [],
      allowedGoals: [correction ? "clarify" : "hold_space"],
      preferredGoal: correction ? "clarify" : "hold_space",
      fallbackGoal: correction ? "clarify" : "hold_space",
      reason: [correction ? "correction_requires_repair" : "boundary_or_pause_revoked"],
    });
  }

  const consent = evidence.interventionConsent;
  const lowRiskFastPath =
    consent.status === "explicit_scoped" &&
    consent.requestRisk === "simple_low_risk" &&
    consent.scope.length === 1 &&
    consent.scope[0] === "low_risk_action_support";

  if (lowRiskFastPath) {
    return decision({
      evidence,
      readiness: "limited",
      maxIntensity: "low",
      allowedFamilies: ["low_risk_action_support"],
      allowedGoals: ["support_action", "clarify"],
      preferredGoal: "support_action",
      fallbackGoal: "clarify",
      reason: ["explicit_low_risk_scoped_request"],
    });
  }

  const judgmentRequiresFactClarification =
    consent.status === "explicit_scoped" &&
    consent.scope.some((family) =>
      ["bounded_decision_support", "direct_judgment"].includes(family)
    );

  if (judgmentRequiresFactClarification) {
    return decision({
      evidence,
      readiness: "limited",
      maxIntensity: "none",
      allowedFamilies: [],
      allowedGoals: ["clarify"],
      preferredGoal: "clarify",
      fallbackGoal: "clarify",
      reason: ["understanding_unverified", "facts_insufficient_for_judgment"],
    });
  }

  if (
    consent.status === "explicit_scoped" &&
    evidence.understandingEvidence.status === "aligned" &&
    consent.scope.length > 0
  ) {
    return decision({
      evidence,
      readiness: "ready",
      maxIntensity:
        consent.requestRisk === "simple_low_risk"
          ? "low"
          : consent.requestRisk === "interpretive_or_high_impact"
            ? "high"
            : "moderate",
      allowedFamilies: consent.scope,
      allowedGoals: ["support_action", "clarify", "reflect"],
      preferredGoal: "support_action",
      fallbackGoal: "clarify",
      reason: ["aligned_and_scoped_consent"],
    });
  }

  if (consent.status === "explicit_scoped") {
    return decision({
      evidence,
      readiness: "limited",
      maxIntensity: "none",
      allowedFamilies: [],
      allowedGoals: ["clarify"],
      preferredGoal: "clarify",
      fallbackGoal: "clarify",
      reason: ["understanding_unverified"],
    });
  }

  if (
    consent.status === "none" &&
    evidence.interactionStage === "understanding" &&
    evidence.understandingEvidence.scope === "request_scope"
  ) {
    return decision({
      evidence,
      readiness: "blocked",
      maxIntensity: "none",
      allowedFamilies: [],
      allowedGoals: BASELINE_RESPONSE_GOALS,
      preferredGoal: "summarize",
      fallbackGoal: "reflect",
      reason: ["no_scoped_consent"],
    });
  }

  const ambiguousConsent = consent.status === "ambiguous";
  const fallbackGoal = evidence.interactionStage === "unclear" ? "clarify" : "reflect";

  return decision({
    evidence,
    readiness: "blocked",
    maxIntensity: "none",
    allowedFamilies: [],
    allowedGoals: BASELINE_RESPONSE_GOALS,
    preferredGoal: evidence.interactionStage === "unclear" ? "clarify" : null,
    fallbackGoal,
    reason: ambiguousConsent
      ? ["ambiguous_consent", "topic_or_cue_is_not_consent"]
      : ["no_scoped_consent"],
  });
};
