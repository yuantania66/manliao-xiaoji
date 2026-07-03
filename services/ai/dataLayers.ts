import { AiMemoryContext } from "./types";

export type AiDataLayerId =
  | "raw_conversation"
  | "user_confirmed_memory"
  | "derived_draft"
  | "generation_audit"
  | "safety_signal";

export type AiDataTrust = "observed" | "user_confirmed" | "derived" | "system";

export const AI_DATA_LAYERS: Record<
  AiDataLayerId,
  {
    trust: AiDataTrust;
    promptEligible: boolean;
    description: string;
  }
> = {
  raw_conversation: {
    trust: "observed",
    promptEligible: true,
    description: "用户和助手的原始聊天，只作为当前上下文，不能沉淀成人格判断。",
  },
  user_confirmed_memory: {
    trust: "user_confirmed",
    promptEligible: true,
    description: "用户主动保存的小记或明确确认的信息，可作为轻量长期记忆。",
  },
  derived_draft: {
    trust: "derived",
    promptEligible: false,
    description: "AI 从聊天生成的小记草稿；用户保存前不能当作事实记忆。",
  },
  generation_audit: {
    trust: "system",
    promptEligible: false,
    description: "AI 生成、fallback、debug、judge 等工程审计数据，不进入陪伴记忆。",
  },
  safety_signal: {
    trust: "system",
    promptEligible: false,
    description: "危机/安全信号，只用于当轮安全路由，不做长期画像。",
  },
};

export const createNoteMemoryContext = ({
  text,
  date,
}: {
  text: string;
  date?: string;
}): AiMemoryContext => ({
  source: "note",
  layer: "user_confirmed_memory",
  trust: "user_confirmed",
  text,
  date,
});

export const createChatMemoryContext = ({
  text,
  date,
}: {
  text: string;
  date?: string;
}): AiMemoryContext => ({
  source: "chat",
  layer: "raw_conversation",
  trust: "observed",
  text,
  date,
});

export const formatMemoryContextForPrompt = (memoryContext: AiMemoryContext) => {
  const datePrefix = memoryContext.date ? `${memoryContext.date}，` : "";

  if (memoryContext.layer === "user_confirmed_memory") {
    return `用户保存过的小记（用户确认）：${datePrefix}${memoryContext.text}\n如果自然，可以轻轻提一句“上次你记下过……”。如果不自然，不要硬提；不能添加这里没有的细节。`;
  }

  return `近期聊天线索（未确认，只能轻参考）：${datePrefix}${memoryContext.text}\n如果自然，可以很轻地接上；如果不自然，不要硬提；不能把它当成用户画像或稳定结论。`;
};
