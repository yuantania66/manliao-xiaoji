// Evaluation-only preload: `NODE_OPTIONS="--import=<abs path>/scripts/model-request-recorder.mjs"` with
// MODEL_REQUEST_LOG=<file>. Appends one JSON line per outbound model request: configuration, status,
// token usage and SHA-256 hashes only; never message text. Inactive when MODEL_REQUEST_LOG is unset.
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";

const logPath = process.env.MODEL_REQUEST_LOG;
// Stable line of the planned-function semantic validator developer message (initial and repair calls).
const JUDGE_MARKER = "semanticQuestionCount counts semantic requests for a User response";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

if (logPath && typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    let body = null;
    try {
      body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    } catch {
      body = null;
    }
    if (!body || !Array.isArray(body.messages)) return originalFetch(input, init);
    const first = typeof body.messages[0]?.content === "string" ? body.messages[0].content : "";
    const record = {
      pid: process.pid,
      at: new Date().toISOString(),
      stage: first.includes(JUDGE_MARKER) ? "planned_function_semantic_validation" : "other",
      model: typeof body.model === "string" ? body.model : null,
      responseFormat: body.response_format?.type ?? null,
      enableThinking: typeof body.enable_thinking === "boolean" ? body.enable_thinking : null,
      temperature: typeof body.temperature === "number" ? body.temperature : null,
      developerMessageSha256: first ? sha256(first) : null,
      httpStatus: null,
      promptTokens: null,
      completionTokens: null,
    };
    try {
      const response = await originalFetch(input, init);
      record.httpStatus = response.status;
      const usage = await response.clone().json().then((data) => data?.usage).catch(() => undefined);
      record.promptTokens = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null;
      record.completionTokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null;
      return response;
    } finally {
      appendFileSync(logPath, `${JSON.stringify(record)}\n`);
    }
  };
}
