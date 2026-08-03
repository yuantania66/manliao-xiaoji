import { isProactiveGreetingPromptVersion } from "./proactive-greeting";

const MAX_RECENT_GREETINGS = 3;

const normalizeGreeting = (value: unknown) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, 120)
    : null;

export const parseGuestRecentGreetings = (serialized: string | null) => {
  try {
    const value = JSON.parse(serialized || "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .flatMap((item) => {
        const greeting = normalizeGreeting(item);
        return greeting ? [greeting] : [];
      })
      .slice(-MAX_RECENT_GREETINGS);
  } catch {
    return [];
  }
};

export const appendGuestRecentGreeting = (
  recentGreetings: string[],
  value: string
) => {
  const greeting = normalizeGreeting(value);
  if (!greeting) return recentGreetings.slice(-MAX_RECENT_GREETINGS);
  return [
    ...recentGreetings.filter((item) => item !== greeting),
    greeting,
  ].slice(-MAX_RECENT_GREETINGS);
};

export const collapseConsecutiveGuestGreetings = <
  T extends { promptVersion?: string | null },
>(
  messages: T[]
) =>
  messages.filter((message, index) => {
    if (!isProactiveGreetingPromptVersion(message.promptVersion)) return true;
    return !isProactiveGreetingPromptVersion(messages[index + 1]?.promptVersion);
  });
