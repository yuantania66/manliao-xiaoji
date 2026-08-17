import { AppError } from "@/lib/errors";

import type { AiModelMessage } from "./types";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const normalizeChatMessages = (messages: AiModelMessage[]) =>
  messages.map((message) => ({
    role: message.role === "developer" ? "system" : message.role,
    content: message.content,
  }));

export type StreamChatCompletionsArgs = {
  apiKey: string;
  baseUrl: string;
  messages: AiModelMessage[];
  model: string;
  temperature?: number;
  extraBody?: Record<string, unknown>;
  signal?: AbortSignal;
};

/**
 * OpenAI-compatible chat.completions streaming (Qwen / DashScope compatible-mode).
 * Yields text deltas only; does not buffer the full reply.
 */
export async function* streamChatCompletionDeltas(
  args: StreamChatCompletionsArgs,
): AsyncGenerator<string, void, unknown> {
  const {
    apiKey,
    baseUrl,
    messages,
    model,
    temperature = 0.7,
    extraBody,
    signal,
  } = args;

  const response = await fetch(`${trimTrailingSlash(baseUrl)}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model,
      messages: normalizeChatMessages(messages),
      temperature,
      stream: true,
      ...extraBody,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new AppError("AI_GENERATION_FAILED", "AI 流式服务调用失败", 502, {
      status: response.status,
      detail: detail.slice(0, 240),
    });
  }

  if (!response.body) {
    throw new AppError("AI_GENERATION_FAILED", "AI 流式响应缺少 body", 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx = buffer.indexOf("\n");
    while (newlineIdx >= 0) {
      let line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      newlineIdx = buffer.indexOf("\n");

      line = line.replace(/\r$/, "").trim();
      if (!line || line.startsWith(":")) continue;
      if (!line.startsWith("data:")) continue;

      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }

      const delta = extractDeltaContent(parsed);
      if (delta) yield delta;
    }
  }
}

function extractDeltaContent(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const choices = (data as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0];
  if (typeof first !== "object" || first === null) return "";
  const delta = (first as Record<string, unknown>).delta;
  if (typeof delta !== "object" || delta === null) return "";
  const content = (delta as Record<string, unknown>).content;
  return typeof content === "string" ? content : "";
}
