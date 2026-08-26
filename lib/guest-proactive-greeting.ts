import {
  parseCommittedAssistantMoveEnvelope,
  type CommittedAssistantMoveEnvelopeV1,
} from "@/conversation-os";

import { isProactiveGreetingPromptVersion } from "./proactive-greeting";

const MAX_RECENT_GREETINGS = 3;

export type GuestRecentGreeting = {
  text: string;
  interactionMoveEnvelope?: CommittedAssistantMoveEnvelopeV1 | null;
};

const normalizeText = (value: unknown) =>
  typeof value === "string" && value.trim() && value.length <= 160
    ? value.trim()
    : null;

export const normalizeGuestRecentGreeting = (
  value: unknown
): GuestRecentGreeting | null => {
  const legacyText = normalizeText(value);
  if (legacyText) return { text: legacyText };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "text" && key !== "interactionMoveEnvelope")
  ) return null;
  const text = normalizeText(record.text);
  if (!text) return null;
  if (record.interactionMoveEnvelope === undefined || record.interactionMoveEnvelope === null) {
    return { text };
  }
  const parsed = parseCommittedAssistantMoveEnvelope(record.interactionMoveEnvelope);
  return parsed.status === "valid"
    ? { text, interactionMoveEnvelope: parsed.envelope }
    : null;
};

export const parseGuestRecentGreetings = (serialized: string | null) => {
  try {
    const value = JSON.parse(serialized || "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .flatMap((item) => {
        const greeting = normalizeGuestRecentGreeting(item);
        return greeting ? [greeting] : [];
      })
      .slice(-MAX_RECENT_GREETINGS);
  } catch {
    return [];
  }
};

export const appendGuestRecentGreeting = (
  recentGreetings: GuestRecentGreeting[],
  value: GuestRecentGreeting
) => {
  const greeting = normalizeGuestRecentGreeting(value);
  if (!greeting) return recentGreetings.slice(-MAX_RECENT_GREETINGS);
  return [
    ...recentGreetings.filter((item) => item.text !== greeting.text),
    greeting,
  ].slice(-MAX_RECENT_GREETINGS);
};

export const guestProactiveGreetingKind = ({
  localMessageCount,
  recentGreetings,
}: {
  localMessageCount: number;
  recentGreetings: GuestRecentGreeting[];
}) => localMessageCount > 0 || recentGreetings.length > 0 ? "return" as const : "initial" as const;

export const collapseConsecutiveGuestGreetings = <
  T extends { promptVersion?: string | null },
>(
  messages: T[]
) =>
  messages.filter((message, index) => {
    if (!isProactiveGreetingPromptVersion(message.promptVersion)) return true;
    return !isProactiveGreetingPromptVersion(messages[index + 1]?.promptVersion);
  });
