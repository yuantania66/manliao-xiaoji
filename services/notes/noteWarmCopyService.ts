import {
  createGeneratedWallpaperCopy,
  selectWallpaperCopy,
  warmCopyLeaksNoteBody,
  type WallpaperCopy,
} from "@/lib/note-wallpaper-state";
import { callModel, getAiProvider, getDefaultAiModel, isAiProviderConfigured } from "@/services/ai/modelProvider";
import type { AiModelMessage } from "@/services/ai/types";

export type NoteWarmCopyProvider = (input: {
  messages: AiModelMessage[];
}) => Promise<{ text: string }>;

const parseExactJson = (text: string): unknown => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
};

const buildMessages = (content: string, mediaCount: number): AiModelMessage[] => [
  {
    role: "developer",
    content: [
      "你为用户刚保存的小记写一句可分享的暖心短句，不是复述小记。",
      "只输出一个 JSON 对象，键仅有 quote 与 caption，不要 Markdown 或其他文字。",
      "quote：一句完整中文短句，2-30 字，可含逗号句号；caption：一句补充，2-48 字。",
      "语气温暖克制，不说教、不提问、不提产品名或助手名。",
      "不得抄写、改写或拼接用户小记原文；不得写入姓名、电话、地址、账号或其他可识别信息。",
      mediaCount > 0 && !content.trim()
        ? "小记只有图片没有文字：写与停下来看见自己相关的中性暖心句，不要假装看见了照片内容。"
        : "根据小记情绪与主题写新句子，保持抽象概括。",
    ].join("\n"),
  },
  {
    role: "user",
    content: JSON.stringify({
      noteContent: content.slice(0, 800),
      mediaCount,
    }),
  },
];

const acceptGenerated = (content: string, quote: unknown, caption: unknown): WallpaperCopy | null => {
  const copy = createGeneratedWallpaperCopy(quote, caption);
  if (!copy || warmCopyLeaksNoteBody(content, copy)) return null;
  return copy;
};

export const generateNoteWarmCopy = async ({
  content,
  mediaCount = 0,
  provider,
}: {
  content: string;
  mediaCount?: number;
  provider?: NoteWarmCopyProvider;
}): Promise<WallpaperCopy> => {
  const fallback = () => selectWallpaperCopy(content, mediaCount);
  if (!provider && !isAiProviderConfigured()) return fallback();
  const messages = buildMessages(String(content || ""), mediaCount);
  try {
    const response = provider
      ? await provider({ messages })
      : await callModel({
          model: process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
          messages,
          temperature: 0.7,
          ...(getAiProvider() === "qwen" ? { responseFormat: "json_object" as const } : {}),
        });
    const parsed = parseExactJson(response.text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback();
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "caption,quote") return fallback();
    return acceptGenerated(content, record.quote, record.caption) ?? fallback();
  } catch {
    return fallback();
  }
};
