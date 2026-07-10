export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

export type UserMessageInput = {
  id?: string;
  conversationId: string;
  content: string;
  createdAt?: string;
};

export type Observation = {
  kind:
    | "user_message"
    | "message_form"
    | "conversation_context"
    | "assistant_reply";
  text: string;
  source: "current_user_message" | "recent_messages" | "assistant_reply";
};

export type Notice = {
  observations: Observation[];
};

export type UnderstandingItemStatus =
  | "observed"
  | "oriented"
  | "user_confirmed"
  | "revised"
  | "rejected"
  | "unknown";

export type UnderstandingItem = {
  id?: string;
  text: string;
  status: UnderstandingItemStatus;
  source?: "notice" | "orientation" | "user_correction" | "system";
};

export type UnknownItem = {
  area:
    | "event"
    | "emotion"
    | "meaning"
    | "need"
    | "relationship"
    | "goal"
    | "conflict"
    | "unknown";
  text: string;
  source?: "notice" | "orientation" | "user_correction" | "system";
};

export type UnderstandingState = {
  events: UnderstandingItem[];
  emotions: UnderstandingItem[];
  meanings: UnderstandingItem[];
  needs: UnderstandingItem[];
  relationships: UnderstandingItem[];
  goals: UnderstandingItem[];
  conflicts: UnderstandingItem[];
  unknowns: UnknownItem[];
};

export type Orientation = {
  currentUnderstanding: string[];
  unknowns: string[];
  possibleDirections: string[];
};

// LEGACY/FROZEN/DO NOT EXTEND:
// Kept only for Conversation OS v1 compatibility and trace continuity.
// Future response strategy must use ClinicalPlan, not new EngageMode values.
export type EngageMode =
  | "acknowledge"
  | "invite"
  | "reflect"
  | "stay"
  | "clarify"
  | "repair"
  | "repair_with_invitation"
  | "repair_with_low_pressure_exit";

// LEGACY/FROZEN/DO NOT EXTEND:
// Kept only for Conversation OS v1 compatibility and trace continuity.
// Future user-experience strategy must use ClinicalPlan, not new ExperienceGoal values.
export type ExperienceGoal =
  | "feel_seen"
  | "feel_accepted"
  | "feel_not_pressured"
  | "feel_misunderstanding_repaired"
  | "feel_safe_to_correct_ai"
  | "feel_less_alone"
  | "feel_allowed_to_pause"
  | "feel_gently_invited"
  | "feel_grounded"
  | "feel_understanding_can_continue";

// LEGACY/FROZEN/DO NOT EXTEND:
// Kept only for Conversation OS v1 compatibility and trace continuity.
// Future question strategy must use ClinicalPlan.questionFunction, not new QuestionStyle values.
export type QuestionPurpose =
  | "understanding_calibration"
  | "experience_exploration"
  | "shared_understanding"
  | "user_agency";

export type QuestionAvoid =
  | "interrogation"
  | "premature_interpretation"
  | "privacy_probing";

// LEGACY/FROZEN/DO NOT EXTEND:
// Existing shape remains for compatibility. Future response strategy must use ClinicalPlan.
export type QuestionStyle = {
  purpose: QuestionPurpose;
  avoid: QuestionAvoid[];
  northStar: string;
};

// LEGACY/FROZEN/DO NOT EXTEND:
// ResponseGoal is the old Conversation OS strategy carrier. Keep behavior stable,
// but do not add new strategy fields. Future response strategy must use ClinicalPlan.
export type ResponseGoal = {
  experienceGoal: ExperienceGoal[];
  engageMode: EngageMode;
  policyReason: string;
  questionStyle: QuestionStyle;
  userExperience: string[];
  languageConstraint: string[];
};

export type ConversationContext = {
  conversationId: string;
  latestNotice: Notice;
  understanding: UnderstandingState;
  responseGoal: ResponseGoal;
};

export type ObserveInput = {
  userMessage: UserMessageInput;
  recentMessages: ConversationMessage[];
};

export type OrientInput = {
  notice: Notice;
  understanding: UnderstandingState;
};

export type EngageInput = {
  notice: Notice;
  orientation: Orientation;
  recentMessages: ConversationMessage[];
};

export type UpdateInput = {
  context: ConversationContext;
  assistantReply: string;
  nextUserReply?: UserMessageInput;
};

export type UpdateResult = {
  understanding: UnderstandingState;
  notes: string[];
};

export type ConversationPipelineInput = {
  conversationId: string;
  userMessage: UserMessageInput;
  recentMessages: ConversationMessage[];
  understanding?: UnderstandingState;
};

export type ConversationPipelineLanguageInput = {
  context: ConversationContext;
  orientation: Orientation;
};

export type ConversationPipelineResult = {
  context: ConversationContext;
  orientation: Orientation;
  assistantReply: string;
  update: UpdateResult;
};

export type GenerateConversationLanguage = (
  input: ConversationPipelineLanguageInput
) => Promise<string>;
