import { AppError } from "@/lib/errors";

import { AiModelMessage, AiProviderResponse } from "./types";

const getTimeoutMs = () => {
  const value = Number(process.env.AI_TIMEOUT_MS ?? "20000");
  return Number.isFinite(value) && value > 0 ? value : 20000;
};

const extractOutputText = (data: unknown) => {
  if (typeof data !== "object" || data === null) return "";
  const record = data as Record<string, unknown>;

  if (typeof record.output_text === "string") return record.output_text;

  const output = record.output;
  if (!Array.isArray(output)) return "";

  return output
    .flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) return [];
      return content.map((piece) => {
        if (typeof piece !== "object" || piece === null) return "";
        const text = (piece as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      });
    })
    .join("")
    .trim();
};

const mockResponse = ({
  messages,
  model,
}: {
  messages: AiModelMessage[];
  model: string;
}): AiProviderResponse => {
  const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const hasCrisis = /自杀|轻生|不想活|伤害自己|结束生命|割腕|寻死/.test(lastUser);
  const text = hasCrisis
    ? "我听见你现在真的很难受。请先不要一个人扛着，马上联系身边可信的人，或拨打当地紧急求助电话。"
    : "听起来你正在认真地撑过这一刻。可以不用急着整理清楚，我会在这里陪你慢慢说。";

  return {
    text,
    model: `mock:${model}`,
    latencyMs: 0,
  };
};

export const callModel = async ({
  messages,
  model,
  temperature = 0.7,
}: {
  messages: AiModelMessage[];
  model: string;
  temperature?: number;
}): Promise<AiProviderResponse> => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return mockResponse({ messages, model });

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        temperature,
      }),
    });

    const data = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw new AppError("AI_GENERATION_FAILED", "AI 服务调用失败", 502, {
        status: response.status,
      });
    }

    const text = extractOutputText(data);
    if (!text) throw new AppError("AI_GENERATION_FAILED", "AI 回复为空", 502);

    const usage =
      typeof data === "object" && data !== null
        ? ((data as Record<string, unknown>).usage as Record<string, unknown> | undefined)
        : undefined;

    return {
      text,
      model,
      latencyMs: Date.now() - startedAt,
      tokenInput: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
      tokenOutput: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
      raw: data,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("AI_GENERATION_FAILED", "AI 服务暂时不可用", 502);
  } finally {
    clearTimeout(timer);
  }
};
