import { UpdateInput, UpdateResult } from "../types";

export const update = ({ context, assistantReply, nextUserReply }: UpdateInput): UpdateResult => ({
  understanding: context.understanding,
  notes: [
    "Sprint 1 only records the pipeline boundary; it does not update memory or persona.",
    `assistantReplyCaptured=${assistantReply.length > 0}`,
    `nextUserReplyCaptured=${Boolean(nextUserReply)}`,
  ],
});
