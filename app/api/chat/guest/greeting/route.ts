import { NextRequest } from "next/server";

import { ok, failFromError } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { generateProactiveGreeting } from "@/services/ai/proactiveGreeting";
import { AiConversationMessage } from "@/services/ai/types";

const normalizeRecentMessages = (value: unknown): AiConversationMessage[] => {
  if (!Array.isArray(value)) return [];

  return value.slice(-6).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const role = record.role;
    const content = record.content;
    const promptVersion = record.promptVersion;
    const aiGenerationId = record.aiGenerationId;
    if (role !== "user" && role !== "assistant" && role !== "system") return [];
    if (typeof content !== "string" || !content.trim()) return [];
    return [
      {
        role,
        content: content.trim().slice(0, 1000),
        promptVersion: typeof promptVersion === "string" ? promptVersion : null,
        aiGenerationId: typeof aiGenerationId === "string" ? aiGenerationId : null,
      },
    ];
  });
};

const normalizeRecentGreetings = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-3)
    .flatMap((item) =>
      typeof item === "string" && item.trim()
        ? [item.trim().slice(0, 120)]
        : []
    );
};

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = (await readJson(request)) as Record<string, unknown>;
    const kind = body.kind === "return" ? "return" : "initial";
    const generation = await generateProactiveGreeting({
      kind,
      recentMessages: normalizeRecentMessages(body.recentMessages),
      recentGreetings: normalizeRecentGreetings(body.recentGreetings),
    });
    const now = new Date().toISOString();

    return ok({
      assistantMessage: {
        id: `guest-proactive-greeting-${Date.now()}`,
        role: "assistant",
        content: generation.text,
        createdAt: now,
        promptVersion: generation.promptVersion,
      },
    });
  } catch (error) {
    const diagnostic = error instanceof AppError
      ? {
          code: error.code,
          message: error.message,
          details: error.details,
        }
      : {
          code: "UNCLASSIFIED",
          message: error instanceof Error ? error.message : "unknown error",
        };
    console.error("guest proactive greeting generation failed", diagnostic);
    return failFromError(error);
  }
}
