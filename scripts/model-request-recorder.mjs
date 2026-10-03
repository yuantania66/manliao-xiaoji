// Evaluation-only preload: `NODE_OPTIONS="--import=<abs path>/scripts/model-request-recorder.mjs"` with
// MODEL_REQUEST_LOG=<file>. Appends one JSON line per outbound model request: configuration, status,
// token usage and SHA-256 hashes only; never message text. Inactive when MODEL_REQUEST_LOG is unset.
// When the request throws, only allowlisted error type names and standard error codes (walking `cause`
// and AggregateError `errors`) are recorded; message, stack, URL, headers and body are never stored.
// The original exception is rethrown unchanged.
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";

const logPath = process.env.MODEL_REQUEST_LOG;
// Stable line of the planned-function semantic validator developer message (initial and repair calls).
const JUDGE_MARKER = "semanticQuestionCount counts semantic requests for a User response";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const ERROR_TYPES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "DOMException",
  "AbortError",
  "TimeoutError",
  "AggregateError",
  "SystemError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "BodyTimeoutError",
  "SocketError",
  "RequestAbortedError",
  "ClientDestroyedError",
  "ClientClosedError",
  "InformationalError",
]);
const ERROR_CODES = new Set([
  "ABORT_ERR",
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "EHOSTDOWN",
  "ENETUNREACH",
  "ENETDOWN",
  "EPROTO",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_ABORTED",
  "UND_ERR_CLOSED",
  "UND_ERR_DESTROYED",
  "UND_ERR_INFO",
  "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
]);
const MAX_ERROR_NODES = 6;

const allowlisted = (allowed, value) => (typeof value === "string" && allowed.has(value) ? value : "unknown");
const safeGet = (value, key) => {
  try {
    return value !== null && (typeof value === "object" || typeof value === "function") ? value[key] : undefined;
  } catch {
    return undefined;
  }
};

// Breadth-first over the error, its `cause` chain and AggregateError `errors`; each node keeps only
// an allowlisted type name and code.
const errorChainOf = (error) => {
  const chain = [];
  const seen = new Set();
  const queue = [error];
  while (queue.length > 0 && chain.length < MAX_ERROR_NODES) {
    const node = queue.shift();
    if (node === undefined || node === null || seen.has(node)) continue;
    if (typeof node === "object" || typeof node === "function") seen.add(node);
    chain.push({ type: allowlisted(ERROR_TYPES, safeGet(node, "name")), code: allowlisted(ERROR_CODES, safeGet(node, "code")) });
    const cause = safeGet(node, "cause");
    if (cause !== undefined) queue.push(cause);
    const errors = safeGet(node, "errors");
    if (Array.isArray(errors)) queue.push(...errors.slice(0, MAX_ERROR_NODES));
  }
  return chain;
};

let sequence = 0;

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
    sequence += 1;
    const startedAt = Date.now();
    const record = {
      pid: process.pid,
      requestId: `${process.pid}-${sequence}`,
      at: new Date(startedAt).toISOString(),
      stage: first.includes(JUDGE_MARKER) ? "planned_function_semantic_validation" : "other",
      model: typeof body.model === "string" ? body.model : null,
      responseFormat: body.response_format?.type ?? null,
      enableThinking: typeof body.enable_thinking === "boolean" ? body.enable_thinking : null,
      temperature: typeof body.temperature === "number" ? body.temperature : null,
      developerMessageSha256: first ? sha256(first) : null,
      httpStatus: null,
      promptTokens: null,
      completionTokens: null,
      durationMs: null,
      failure: null,
    };
    try {
      const response = await originalFetch(input, init);
      record.durationMs = Date.now() - startedAt;
      record.httpStatus = response.status;
      const usage = await response.clone().json().then((data) => data?.usage).catch(() => undefined);
      record.promptTokens = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null;
      record.completionTokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null;
      return response;
    } catch (error) {
      record.durationMs = Date.now() - startedAt;
      const chain = errorChainOf(error);
      record.failure = {
        stage: record.httpStatus !== null
          ? "after_response"
          : init?.signal?.aborted === true
            ? "before_response_signal_aborted"
            : "before_response",
        errorType: chain[0]?.type ?? "unknown",
        errorCode: chain.find((node) => node.code !== "unknown")?.code ?? "unknown",
        chain,
      };
      throw error;
    } finally {
      appendFileSync(logPath, `${JSON.stringify(record)}\n`);
    }
  };
}
