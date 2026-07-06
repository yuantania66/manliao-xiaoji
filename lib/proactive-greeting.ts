export const PROACTIVE_GREETING_PROMPT_VERSION = "chat-proactive-greeting-v1";

export const isProactiveGreetingPromptVersion = (promptVersion?: string | null) =>
  promptVersion === PROACTIVE_GREETING_PROMPT_VERSION;
