export const PROACTIVE_GREETING_PROMPT_VERSION = "chat-proactive-greeting-v5";

export const isProactiveGreetingPromptVersion = (promptVersion?: string | null) =>
  promptVersion === "chat-proactive-greeting-v1" ||
  promptVersion === "chat-proactive-greeting-v2" ||
  promptVersion === "chat-proactive-greeting-v3" ||
  promptVersion === "chat-proactive-greeting-v4" ||
  promptVersion === PROACTIVE_GREETING_PROMPT_VERSION;

export const explicitlyResumesPreGreetingHistory = (message: string) =>
  /(?:继续|接着)(?:吧|聊|说|讲|刚才|之前|上次|那个)|(?:回到|说回|聊回)(?:刚才|之前|上次)|刚才(?:那个|说的|的话题)|之前(?:那个|说的|的话题)|上次(?:那个|说的|的话题)/u.test(
    message
  );
