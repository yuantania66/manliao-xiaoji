import { EngageInput, EngageMode, ExperienceGoal, Notice, QuestionStyle, ResponseGoal } from "../types";

// LEGACY/FROZEN/DO NOT EXTEND:
// This file preserves Conversation OS v1 behavior for compatibility only.
// Do not add new strategy rules, EngageMode values, ExperienceGoal values, or QuestionStyle values here.
// Future response strategy must use ClinicalPlan.

const getCurrentUserText = (notice: Notice) => {
  const raw = notice.observations.find((item) => item.kind === "user_message")?.text ?? "";
  return raw.replace(/^用户当前消息：/, "").trim();
};

const hasObservation = (notice: Notice, pattern: RegExp) =>
  notice.observations.some((item) => pattern.test(item.text));

const isShortStayToken = (text: string) => /^(嗯+|啊+|哦+|好|行|对|是)$/u.test(text.trim());
const isLowInformationToken = (text: string) =>
  /^([0-9０-９]+|[a-zA-Z]|[^\s\p{L}\p{N}])$/u.test(text.trim());
const isAiDirectedRepairFeedback = (text: string) =>
  /不是这个意思|不是这意思|不是这个|不是这样|不对|你理解错|你说错|你没懂|你没理解|你是不是.*(没懂|没理解)|你.*(没懂|没理解|理解错|说错|接错|没接住)|你跟他们一样/.test(
    text
  );
const isSelfOrRelationshipDoubt = (text: string) =>
  /我是不是.*(被讨厌|做错|太|不该)|他是不是.*(不想理|讨厌|生气)|她是不是.*(不想理|讨厌|生气)|他们是不是.*(不想理|讨厌|生气)|被讨厌了/.test(
    text
  );

const selectEngageMode = ({ notice }: EngageInput): { engageMode: EngageMode; policyReason: string } => {
  const userText = getCurrentUserText(notice);

  if (isAiDirectedRepairFeedback(userText)) {
    return {
      engageMode: "repair_with_invitation",
      policyReason: "relation_feedback_priority：用户正在指出 AI 理解偏了，需要承认偏差并给出低压纠正入口。",
    };
  }

  if (isSelfOrRelationshipDoubt(userText)) {
    return {
      engageMode: "reflect",
      policyReason: "用户在询问自己处境、关系或他人评价，不是质疑 AI；需要接住这种悬着的担心。",
    };
  }

  if (/算了|先不说了|不说了|不聊了|随便吧/.test(userText)) {
    return {
      engageMode: "repair_with_low_pressure_exit",
      policyReason: "relation_feedback_priority：用户可能正在退出或表达失望，需要允许离开，同时低压收回没接住的部分。",
    };
  }

  if (/先这样|停一下|暂停|到这/.test(userText)) {
    return {
      engageMode: "stay",
      policyReason: "用户可能想暂停，需要允许停在这里。",
    };
  }

  if (isShortStayToken(userText)) {
    return {
      engageMode: "stay",
      policyReason: "用户给出极短承接音，先陪在原地，不追问含义。",
    };
  }

  if (/累|疲惫|难受|委屈|崩|烦|焦虑|害怕|生气|难过|压力|撑不住/.test(userText)) {
    return {
      engageMode: "reflect",
      policyReason: "用户明确给出体验词，需要贴着表达反映，不急着询问。",
    };
  }

  if (isLowInformationToken(userText)) {
    if (hasObservation(notice, /连续发送数字|连续发送很短的消息/)) {
      return {
        engageMode: "invite",
        policyReason: "用户连续给出低信息输入，可以轻轻邀请用户共同校准。",
      };
    }

    return {
      engageMode: "acknowledge",
      policyReason: "用户第一次给出低信息输入，先承认注意到，不索取解释。",
    };
  }

  return {
    engageMode: "acknowledge",
    policyReason: "当前只需要承接用户刚刚给出的内容，不急着推进。",
  };
};

const getUserExperience = (engageMode: EngageMode) => {
  const base = ["用户感到自己刚刚给出的内容被注意到了。", "用户感到 AI 没有急着定义自己。"];

  if (engageMode === "invite") {
    return [...base, "用户感到可以在低压力下继续共同校准。"];
  }

  if (engageMode === "repair") {
    return [...base, "用户感到 AI 愿意收回偏掉的理解。"];
  }

  if (engageMode === "repair_with_invitation") {
    return [...base, "用户感到 AI 承认理解偏了，并愿意跟着用户修正。"];
  }

  if (engageMode === "repair_with_low_pressure_exit") {
    return [...base, "用户感到可以先退出，同时 AI 没有把退出简单当成结束。"];
  }

  if (engageMode === "stay") {
    return [...base, "用户感到可以不用继续解释。"];
  }

  if (engageMode === "reflect") {
    return [...base, "用户感到当前体验被轻轻接住。"];
  }

  return [...base, "用户感到这个输入本身已经被看见。"];
};

const hasAny = (text: string, pattern: RegExp) => pattern.test(text);

const getExperienceGoal = (engageMode: EngageMode, userText: string): ExperienceGoal[] => {
  if (engageMode === "repair_with_invitation" || engageMode === "repair") {
    return ["feel_misunderstanding_repaired", "feel_safe_to_correct_ai", "feel_understanding_can_continue"];
  }

  if (engageMode === "repair_with_low_pressure_exit") {
    return ["feel_allowed_to_pause", "feel_not_pressured", "feel_misunderstanding_repaired"];
  }

  if (engageMode === "stay") {
    return ["feel_allowed_to_pause", "feel_not_pressured", "feel_accepted"];
  }

  if (engageMode === "reflect") {
    return ["feel_seen", "feel_accepted", "feel_less_alone"];
  }

  if (engageMode === "invite") {
    return ["feel_seen", "feel_gently_invited", "feel_not_pressured"];
  }

  if (hasAny(userText, /想继续说.*不太想说|不太想说.*想继续说|不知道要不要说|不知道为什么.*不想说/)) {
    return ["feel_accepted", "feel_not_pressured", "feel_gently_invited", "feel_understanding_can_continue"];
  }

  if (hasAny(userText, /谢谢|谢了|多谢/)) {
    return ["feel_seen", "feel_understanding_can_continue"];
  }

  if (hasAny(userText, /一直|怎么办|慌|乱|说不清|不知道.*感觉/)) {
    return ["feel_seen", "feel_grounded", "feel_not_pressured"];
  }

  return ["feel_seen", "feel_accepted", "feel_not_pressured"];
};

const getLanguageConstraint = (engageMode: EngageMode) => {
  const base = [
    "表达当前暂时理解，而不是结论。",
    "不替用户解释自己的意义。",
    "不把观察扩展成人格、情绪或意图判断。",
    "如果提问，问题要让用户感觉 AI 正在陪自己一起理解自己，而不是要求用户回答 AI。",
  ];

  const modeConstraints: Record<EngageMode, string[]> = {
    acknowledge: ["先承认注意到这个输入；如果提问，只能是共同靠近式，不索取解释。"],
    invite: ["可以轻轻邀请共同校准；问题必须低压力，允许用户不用解释。"],
    reflect: ["贴着用户明确说出的体验反映；如果提问，只能探索体验，不追问原因。"],
    stay: ["允许停在这里；如果提问，只能给用户选择权，不推进话题。"],
    clarify: ["可以做很小的澄清；不要展开分析。"],
    repair: ["先放下刚刚的理解；不要辩解；不要继续沿用旧理解。"],
    repair_with_invitation: [
      "承认刚刚理解偏了；给用户一个按自己方式修正你的入口；不要要求用户解释完整。",
    ],
    repair_with_low_pressure_exit: [
      "允许用户先不说；同时低压承认可能是 AI 没接住；不要关闭对话，不要追问。",
    ],
  };

  return [...base, ...modeConstraints[engageMode]];
};

const getQuestionStyle = (engageMode: EngageMode): QuestionStyle => {
  const northStar = "好的问题，不会让用户觉得自己正在回答 AI；而会让用户觉得，AI 正在陪自己一起理解自己。";

  if (engageMode === "repair" || engageMode === "repair_with_invitation") {
    return {
      purpose: "understanding_calibration",
      avoid: ["interrogation", "premature_interpretation"],
      northStar,
    };
  }

  if (engageMode === "reflect") {
    return {
      purpose: "experience_exploration",
      avoid: ["interrogation", "premature_interpretation", "privacy_probing"],
      northStar,
    };
  }

  if (engageMode === "stay" || engageMode === "repair_with_low_pressure_exit") {
    return {
      purpose: "user_agency",
      avoid: ["interrogation", "privacy_probing"],
      northStar,
    };
  }

  return {
    purpose: "shared_understanding",
    avoid: ["interrogation", "premature_interpretation", "privacy_probing"],
    northStar,
  };
};

export const engage = (input: EngageInput): ResponseGoal => {
  const { engageMode, policyReason } = selectEngageMode(input);
  const userText = getCurrentUserText(input.notice);

  return {
    experienceGoal: getExperienceGoal(engageMode, userText),
    engageMode,
    policyReason,
    questionStyle: getQuestionStyle(engageMode),
    userExperience: getUserExperience(engageMode),
    languageConstraint: getLanguageConstraint(engageMode),
  };
};
