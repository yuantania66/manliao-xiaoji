import { NextRequest } from "next/server";

import { ok, failFromError } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { getGuestSessionManager, guestNoStore, readGuestJson } from "@/lib/guest-session";
import {
  buildProactiveGreetingAssistantMoveEnvelope,
  parseCommittedAssistantMoveEnvelope,
} from "@/conversation-os";
import { generateProactiveGreeting } from "@/services/ai/proactiveGreeting";
import { AiConversationMessage } from "@/services/ai/types";
import { normalizeGuestRecentGreeting } from "@/lib/guest-proactive-greeting";

const normalizeRecentMessages = (value: unknown): AiConversationMessage[] => {
  if (!Array.isArray(value)) return [];

  return value.slice(-6).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const role = record.role;
    const content = record.content;
    const promptVersion = record.promptVersion;
    const aiGenerationId = record.aiGenerationId;
    const parsedEnvelope = parseCommittedAssistantMoveEnvelope(
      record.interactionMoveEnvelope
    );
    if (role !== "user" && role !== "assistant" && role !== "system") return [];
    if (typeof content !== "string" || !content.trim()) return [];
    return [
      {
        role,
        content: content.trim().slice(0, 1000),
        promptVersion: typeof promptVersion === "string" ? promptVersion : null,
        aiGenerationId: typeof aiGenerationId === "string" ? aiGenerationId : null,
        interactionMoveEnvelope:
          parsedEnvelope.status === "valid" ? parsedEnvelope.envelope : undefined,
      },
    ];
  });
};

const normalizeRecentGreetings = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-3)
    .flatMap((item) => {
      const greeting = normalizeGuestRecentGreeting(item);
      return greeting ? [greeting] : [];
    });
};

export async function POST(request: NextRequest) {
  try {
    const body = await readGuestJson(request);
    const sessions = getGuestSessionManager();
    const authority = sessions.authorize(request, body.conversationId);
    if (body.retry === true) throw new AppError("CONFLICT", "重试需要明确的尝试编号", 409, { reason: "GUEST_REQUEST_CONFLICT" });
    const kind = body.kind === "return" ? "return" : "initial";
    const recentMessages = normalizeRecentMessages(body.recentMessages);
    const recentGreetings = normalizeRecentGreetings(body.recentGreetings);
    const turnId = typeof body.turnId === "string" ? body.turnId.trim() : "";
    const payload = await sessions.execute({
      request,
      authority,
      endpoint: "greeting",
      turnId,
      retryOfAttempt: body.retryOfAttempt,
      inputs: { kind, recentMessages, recentGreetings },
    }, async () => {
      const generation = await generateProactiveGreeting({
        kind,
        recentMessages,
        recentGreetings,
      });
      const now = new Date().toISOString();
      const eventId = `${authority.conversationId}-${turnId}`;
      const assistantMoveId = `guest-proactive-greeting-${eventId}`;
      const interactionMoveEnvelope = buildProactiveGreetingAssistantMoveEnvelope({
        assistantMoveId,
        generationId: `guest-proactive-generation-${eventId}`,
        intent: generation.proactiveIntent,
      });

      return {
        assistantMessage: {
          id: assistantMoveId,
          role: "assistant",
          content: generation.text,
          createdAt: now,
          promptVersion: generation.promptVersion,
          interactionMoveEnvelope,
        },
      };
    });
    return guestNoStore(ok(payload));
  } catch (error) {
    return guestNoStore(failFromError(error));
  }
}
