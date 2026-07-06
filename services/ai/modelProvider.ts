import { AppError } from "@/lib/errors";

import { AiModelMessage, AiProviderReasoningMeta, AiProviderResponse } from "./types";

type AiProvider = "openai" | "deepseek" | "qwen" | "zhipu" | "mock";

const getTimeoutMs = () => {
  const value = Number(process.env.AI_TIMEOUT_MS ?? "45000");
  return Number.isFinite(value) && value > 0 ? value : 45000;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const getAiProvider = (): AiProvider => {
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (provider === "deepseek" || provider === "qwen" || provider === "zhipu" || provider === "mock") return provider;
  return "openai";
};

export const isAiProviderConfigured = () => {
  const provider = getAiProvider();
  if (provider === "mock") return false;
  if (provider === "deepseek") return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  if (provider === "qwen") {
    return Boolean(process.env.QWEN_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim());
  }
  if (provider === "zhipu") return Boolean(process.env.ZHIPU_API_KEY?.trim());
  return Boolean(process.env.OPENAI_API_KEY?.trim());
};

export const getDefaultAiModel = () => {
  const provider = getAiProvider();
  if (provider === "deepseek") return "deepseek-v4-flash";
  if (provider === "qwen") return "qwen-plus";
  if (provider === "zhipu") return "glm-4.7";
  return "gpt-4.1-mini";
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

const extractChatCompletionText = (data: unknown) => {
  if (typeof data !== "object" || data === null) return "";
  const choices = (data as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) return "";

  const firstChoice = choices[0];
  if (typeof firstChoice !== "object" || firstChoice === null) return "";

  const message = (firstChoice as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null) return "";

  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((piece) => {
      if (typeof piece === "string") return piece;
      if (typeof piece !== "object" || piece === null) return "";
      const text = (piece as Record<string, unknown>).text;
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();
};

const extractChatCompletionReasoningMeta = (data: unknown): AiProviderReasoningMeta | undefined => {
  if (typeof data !== "object" || data === null) return undefined;
  const choices = (data as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) return undefined;

  const firstChoice = choices[0];
  if (typeof firstChoice !== "object" || firstChoice === null) return undefined;

  const message = (firstChoice as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null) return undefined;

  const record = message as Record<string, unknown>;
  const reasoning = record.reasoning_content ?? record.reasoning;
  if (typeof reasoning !== "string" || !reasoning.trim()) return undefined;

  return {
    available: true,
    source: "chat_completions.message.reasoning_content",
    characters: reasoning.trim().length,
  };
};

const normalizeChatMessages = (messages: AiModelMessage[]) =>
  messages.map((message) => ({
    role: message.role === "developer" ? "system" : message.role,
    content: message.content,
  }));

const mockResponse = ({
  messages,
  model,
}: {
  messages: AiModelMessage[];
  model: string;
}): AiProviderResponse => {
  const rawUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const lastUser =
    rawUser.match(/用户刚刚说：([\s\S]*)$/)?.[1]?.trim() ??
    rawUser.match(/用户输入：([^\n]*)/)?.[1]?.trim() ??
    rawUser;
  const hasCrisis = /自杀|轻生|不想活|伤害自己|结束生命|割腕|寻死/.test(lastUser);
  const isCorrection = /不是这样|不是这个|不对|我已经说过|你回复得很假|套模板|别编|别圆/.test(
    lastUser
  );
  const text = hasCrisis
    ? "这会儿先不用解释。请把自己和可能伤害你的东西隔开，联系身边可信的人；有危险就打当地紧急电话。"
    : isCorrection
      ? "刚才没接住。先回到你说的这句，不编场景。"
    : "嗯，先不用整理清楚。可以只从一个很小的地方开始说。";

  return {
    text,
    model: `mock:${model}`,
    latencyMs: 0,
  };
};

const callOpenAiResponses = async ({
  apiKey,
  messages,
  model,
  temperature,
  signal,
}: {
  apiKey: string;
  messages: AiModelMessage[];
  model: string;
  temperature: number;
  signal: AbortSignal;
}) => {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
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
  const text = response.ok ? extractOutputText(data) : "";
  const usage =
    typeof data === "object" && data !== null
      ? ((data as Record<string, unknown>).usage as Record<string, unknown> | undefined)
      : undefined;

  return {
    ok: response.ok,
    status: response.status,
    data,
    text,
    providerReasoning: undefined,
    tokenInput: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
    tokenOutput: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
  };
};

const callChatCompletions = async ({
  apiKey,
  baseUrl,
  messages,
  model,
  temperature,
  signal,
}: {
  apiKey: string;
  baseUrl: string;
  messages: AiModelMessage[];
  model: string;
  temperature: number;
  signal: AbortSignal;
}) => {
  const response = await fetch(`${trimTrailingSlash(baseUrl)}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: normalizeChatMessages(messages),
      temperature,
    }),
  });

  const data = (await response.json().catch(() => null)) as unknown;
  const text = response.ok ? extractChatCompletionText(data) : "";
  const providerReasoning = response.ok ? extractChatCompletionReasoningMeta(data) : undefined;
  const usage =
    typeof data === "object" && data !== null
      ? ((data as Record<string, unknown>).usage as Record<string, unknown> | undefined)
      : undefined;

  return {
    ok: response.ok,
    status: response.status,
    data,
    text,
    providerReasoning,
    tokenInput: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
    tokenOutput: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined,
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
  const provider = getAiProvider();
  if (provider === "mock") return mockResponse({ messages, model });

  const apiKey =
    provider === "deepseek"
      ? process.env.DEEPSEEK_API_KEY?.trim()
      : provider === "qwen"
        ? process.env.QWEN_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim()
      : provider === "zhipu"
        ? process.env.ZHIPU_API_KEY?.trim()
        : process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) return mockResponse({ messages, model });

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const result =
      provider === "deepseek"
        ? await callChatCompletions({
            apiKey,
            baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
            messages,
            model,
            temperature,
            signal: controller.signal,
          })
        : provider === "qwen"
          ? await callChatCompletions({
              apiKey,
              baseUrl:
                process.env.QWEN_BASE_URL?.trim() ||
                process.env.DASHSCOPE_BASE_URL?.trim() ||
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
              messages,
              model,
              temperature,
              signal: controller.signal,
            })
        : provider === "zhipu"
          ? await callChatCompletions({
              apiKey,
              baseUrl: process.env.ZHIPU_BASE_URL?.trim() || "https://open.bigmodel.cn/api/paas/v4",
              messages,
              model,
              temperature,
              signal: controller.signal,
            })
          : await callOpenAiResponses({
              apiKey,
              messages,
              model,
              temperature,
              signal: controller.signal,
            });

    if (!result.ok) {
      throw new AppError("AI_GENERATION_FAILED", "AI 服务调用失败", 502, {
        provider,
        status: result.status,
      });
    }

    const text = result.text;
    if (!text) throw new AppError("AI_GENERATION_FAILED", "AI 回复为空", 502);

    return {
      text,
      model: `${provider}:${model}`,
      latencyMs: Date.now() - startedAt,
      tokenInput: result.tokenInput,
      tokenOutput: result.tokenOutput,
      providerReasoning: result.providerReasoning,
      raw: result.data,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("AI_GENERATION_FAILED", "AI 服务暂时不可用", 502);
  } finally {
    clearTimeout(timer);
  }
};
