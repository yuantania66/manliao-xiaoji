/**
 * Resolve Qwen credentials for P2 publication streaming (opt-in / eval only).
 * Does not flip site-wide AI_PROVIDER; P2 path prefers Qwen explicitly.
 */

import {
  DEFAULT_ASSISTANT_DISPLAY_NAME,
  buildP2PreviewSystemPrompt,
} from "./assistantIdentity";
import type { EnvBag } from "@/lib/p2-publication-flag";

export type P2QwenStreamConfig = {
  configured: boolean;
  missing: string[];
  apiKey: string | null;
  baseUrl: string;
  model: string;
  provider: "qwen";
};

export function resolveP2QwenStreamConfig(
  env: EnvBag = process.env,
): P2QwenStreamConfig {
  const apiKey =
    env.QWEN_API_KEY?.trim() ||
    env.DASHSCOPE_API_KEY?.trim() ||
    null;
  const baseUrl =
    env.QWEN_BASE_URL?.trim() ||
    env.DASHSCOPE_BASE_URL?.trim() ||
    "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const model =
    env.P2_PUBLICATION_MODEL?.trim() ||
    (env.AI_PROVIDER?.trim().toLowerCase() === "qwen"
      ? env.AI_MAIN_MODEL?.trim()
      : null) ||
    "qwen3.7-max";

  const missing: string[] = [];
  if (!apiKey) missing.push("QWEN_API_KEY (or DASHSCOPE_API_KEY)");

  return {
    configured: missing.length === 0,
    missing,
    apiKey,
    baseUrl,
    model,
    provider: "qwen",
  };
}

/** Default prompt for checks / fallbacks — uses canonical 小慢. */
export const P2_PREVIEW_SYSTEM_PROMPT = buildP2PreviewSystemPrompt(
  DEFAULT_ASSISTANT_DISPLAY_NAME,
);

export { buildP2PreviewSystemPrompt, DEFAULT_ASSISTANT_DISPLAY_NAME };
