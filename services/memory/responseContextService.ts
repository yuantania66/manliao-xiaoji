import { StructuredRagContext } from "@/services/understanding/understandingTypes";

import { retrieveMemoryV2ContextForUser } from "./retrievalService";

export const isMemoryV2ResponseContextEnabled = () =>
  process.env.MEMORY_V2_RESPONSE_CONTEXT_ENABLED?.trim().toLowerCase() === "true";

export const maybeMergeMemoryV2ResponseContext = async ({
  userId,
  v1Context,
  enabled = isMemoryV2ResponseContextEnabled(),
  retrieve = retrieveMemoryV2ContextForUser,
}: {
  userId: string;
  v1Context: StructuredRagContext;
  enabled?: boolean;
  retrieve?: typeof retrieveMemoryV2ContextForUser;
}) => {
  if (!enabled) return v1Context;
  return retrieve({ userId, v1Context });
};
