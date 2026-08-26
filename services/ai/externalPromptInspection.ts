export class ExternalPromptRejectedError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "External prompt inspection rejected the prompt.");
    this.name = "ExternalPromptRejectedError";
  }
}

export const inspectPromptBeforeExternalCall = async <T>(
  inspect: ((input: T) => void | Promise<void>) | undefined,
  input: T
) => {
  if (!inspect) return;
  try {
    await inspect(input);
  } catch (error) {
    throw new ExternalPromptRejectedError(error);
  }
};
