import { runChatReplyEvaluationBatch } from "../services/ai/chatReplyEvaluationBatch";
import { callModel, getAiProvider, getDefaultAiModel, isAiProviderConfigured } from "../services/ai/modelProvider";
import { prisma } from "../lib/prisma";

const main = async () => {
  if (process.env.CHAT_REPLY_EVALUATION_ENABLED !== "true") {
    console.log(JSON.stringify({ status: "disabled" }));
    return;
  }
  const limit = Number(process.env.CHAT_REPLY_EVALUATION_BATCH_LIMIT ?? "100");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("invalid_batch_limit");
  if (getAiProvider() !== "qwen" || !isAiProviderConfigured()) throw new Error("qwen_not_configured");
  const model = process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel();
  const outcome = await runChatReplyEvaluationBatch({
    limit,
    evaluate: async (messages) => (await callModel({
      messages,
      model,
      responseFormat: "json_object",
      temperature: 0,
      signal: AbortSignal.timeout(45_000),
    })).text,
  });
  console.log(JSON.stringify({ status: "completed", ...outcome }));
  if (outcome.failed) process.exitCode = 1;
};

void main().catch(() => {
  console.error(JSON.stringify({ status: "failed" }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
