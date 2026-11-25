import { AppError } from "@/lib/errors";
import { stagingOwnerAccessEnabled } from "@/lib/staging-owner-access";
import { StagingBudgetError, settleBudget, withBudgetReservation } from "./stagingBudgetLedger";

export const STAGING_BUDGET_DIRECTORY = "/var/www/manliaoxiaoji-staging/shared/first-wechat-trial-budget";
export const STAGING_BUDGET_LEDGER = `${STAGING_BUDGET_DIRECTORY}/ledger.json`;
// Legacy deployment identity, not the current request limit. Keep media/owner guards aligned.
export const STAGING_BUDGET_MODE = "first-trial-20cny-29-v1";
export const STAGING_OUTPUT_TOKEN_LIMIT = 4096;

// Official Beijing pricing and API limits checked 2026-11-10 10:39:26 UTC. No discount,
// cache credit, free allowance, character estimate or different tokenizer is used.
// validUntil is our re-verification cutoff, not a supplier price guarantee.
// https://help.aliyun.com/zh/model-studio/model-pricing
// https://help.aliyun.com/zh/model-studio/qwen3-7-max
// https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions
export const STAGING_VERIFIED_PRICE = Object.freeze({
  models: ["qwen3.7-max", "qwen3.7-max-2026-05-20"] as readonly string[],
  endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  inputMicroCnyPerToken: 12,
  outputMicroCnyPerToken: 36,
  inputTokenUpperBound: 991808,
  outputTokenTolerance: 10,
  validUntil: "2026-11-17T10:39:26.000Z",
});

const denied = (reason: string) => new AppError(
  "AI_GENERATION_FAILED",
  "测试模型费用保护已阻止发送，请由管理员核对预算和计费上界。",
  403,
  { budgetGuard: reason },
);

export const stagingModelBudgetEnabled = stagingOwnerAccessEnabled;

export const stagingBudgetUpperCost = ({
  provider,
  model,
  baseUrl,
  now = Date.now(),
}: { provider: string; model: string; baseUrl: string; now?: number }) => {
  const price = STAGING_VERIFIED_PRICE;
  if (!Number.isFinite(now) || now >= Date.parse(price.validUntil)) throw denied("PRICE_NOT_CURRENT");
  if (provider !== "qwen" || !price.models.includes(model) || baseUrl !== price.endpoint) {
    throw denied("UNVERIFIED_PROVIDER_MODEL_OR_ENDPOINT");
  }
  // Reserve the verified whole-model bound; actual trusted usage releases
  // the unused amount. No unverified smaller input estimate is substituted.
  return price.inputTokenUpperBound * price.inputMicroCnyPerToken +
    (STAGING_OUTPUT_TOKEN_LIMIT + price.outputTokenTolerance) * price.outputMicroCnyPerToken;
};

export const withStagingModelCall = async <T>(input: {
  provider: string;
  model: string;
  baseUrl: string;
}, execute: (reservationId: string) => Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (process.env.STAGING_MODEL_BUDGET_MODE !== STAGING_BUDGET_MODE) throw denied("CONFIGURATION_REQUIRED");
  if (process.env.STAGING_MODEL_BUDGET_TRIAL_ENABLED !== "1") throw denied("TRIAL_NOT_STARTED");
  const upperMicroCny = stagingBudgetUpperCost(input);
  try {
    return await withBudgetReservation(STAGING_BUDGET_LEDGER, upperMicroCny, async (id) => {
      // A request may have waited behind another process. Recheck validity at
      // dispatch time; restarting or waiting must not extend price evidence.
      stagingBudgetUpperCost(input);
      if (process.env.STAGING_MODEL_BUDGET_TRIAL_ENABLED !== "1") throw denied("TRIAL_NOT_STARTED");
      return execute(id);
    }, undefined, signal);
  } catch (error) {
    if (error instanceof StagingBudgetError) throw denied(error.code);
    throw error;
  }
};

export const settleStagingModelCall = async (
  reservationId: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  totalTokens: unknown,
) => {
  const price = STAGING_VERIFIED_PRICE;
  if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) ||
      inputTokens! < 0 || outputTokens! < 0 ||
      inputTokens! > price.inputTokenUpperBound ||
      outputTokens! > STAGING_OUTPUT_TOKEN_LIMIT + price.outputTokenTolerance ||
      totalTokens !== inputTokens! + outputTokens!) {
    throw denied("UNKNOWN_USAGE_RESERVATION_RETAINED");
  }
  try {
    await settleBudget(STAGING_BUDGET_LEDGER, reservationId,
      inputTokens! * price.inputMicroCnyPerToken + outputTokens! * price.outputMicroCnyPerToken);
  } catch {
    throw denied("SETTLEMENT_FAILED_RESERVATION_RETAINED");
  }
};
