import { engage } from "./engage";
import { observe } from "./observe";
import { orient } from "./orient";
import { update } from "./update";
import {
  ConversationContext,
  ConversationPipelineInput,
  ConversationPipelineResult,
  GenerateConversationLanguage,
  UnderstandingState,
} from "./types";

export const createEmptyUnderstandingState = (): UnderstandingState => ({
  events: [],
  emotions: [],
  meanings: [],
  needs: [],
  relationships: [],
  goals: [],
  conflicts: [],
  unknowns: [],
});

export const runConversationPipeline = async (
  input: ConversationPipelineInput,
  generateLanguage: GenerateConversationLanguage
): Promise<ConversationPipelineResult> => {
  const latestNotice = observe({
    userMessage: input.userMessage,
    recentMessages: input.recentMessages,
  });
  const baseUnderstanding = input.understanding ?? createEmptyUnderstandingState();
  const orientation = orient({
    notice: latestNotice,
    understanding: baseUnderstanding,
  });
  const responseGoal = engage({
    notice: latestNotice,
    orientation,
    recentMessages: input.recentMessages,
  });
  const context: ConversationContext = {
    conversationId: input.conversationId,
    latestNotice,
    understanding: {
      ...baseUnderstanding,
      unknowns: [
        ...baseUnderstanding.unknowns,
        ...orientation.unknowns.map((text) => ({
          area: "unknown" as const,
          text,
          source: "orientation" as const,
        })),
      ],
    },
    responseGoal,
  };
  const assistantReply = await generateLanguage({ context, orientation });
  const updateResult = update({ context, assistantReply });

  return {
    context,
    orientation,
    assistantReply,
    update: updateResult,
  };
};
