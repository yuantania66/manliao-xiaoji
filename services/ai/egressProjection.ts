import { createPiiRedactor } from "./piiRedaction";
import type { AiModelMessage } from "./types";

// Only internal evidence/binding consumers opt in. Ordinary replies never restore PII.
export type EgressResponseKind =
  | "safety" | "interpretation" | "purpose" | "planned_function"
  | "episode_summary" | "proactive_verdict"
  | "relational_remaining" | "relational_solicitation" | "emotional_remaining" | "emotional_use";

const plannedPaths = [
  "planId", "handoff.binding.sourceAssistantMoveId", "handoff.binding.sourceUserTurnId",
  "handoff.evidence.*.text", "positiveFunction.evidence.*.text",
  "positiveFunction.binding.sourceTurnId", "positiveFunction.binding.targetTurnId",
  "positiveFunction.binding.targetProposition",
  "positiveFunction.ordinaryUseObservation.purposeEvidence.*.text",
  "positiveFunction.invitationUseObservation.priorInvitation.text",
  "positiveFunction.affectEvidence.userSpans.*.text",
  "positiveFunction.affectEvidence.candidateSpans.*.text",
];

const restoredPaths: Record<EgressResponseKind, readonly string[]> = {
  safety: ["evidence.*.text", "dangerEvents.*.userEvidence.*.text",
    "dangerEvents.*.assistantReference.text", "supportComparison.userEvidence.*.text",
    "supportComparison.assistantReference.text"],
  interpretation: [
    "acknowledgmentTreatmentEvidence.acknowledgment.text",
    "acknowledgmentTreatmentEvidence.acknowledgment.sourceTurnId",
    "acknowledgmentTreatmentEvidence.treatment.text",
    "acknowledgmentTreatmentEvidence.treatment.sourceTurnId",
    "ordinaryPostureProposal.sourceSpans.*.text",
    "ordinaryPostureProposal.sourceSpans.*.sourceTurnId",
    "responseRelation.candidates.*.targetTurnId",
    "responseRelation.candidates.*.targetProposition",
    "legacyMemorySelection.candidateId",
    "legacyMemorySelection.currentTurnEvidence.*.text",
    "legacyMemorySelection.memoryEvidence.*.text",
  ],
  purpose: ["conversationId", "turnId", "question.text", "evidence.*.text"],
  planned_function: plannedPaths,
  relational_remaining: plannedPaths.map(path => `verdict.${path}`),
  emotional_remaining: plannedPaths,
  relational_solicitation: ["planId", "evidence.*.text", "explicitRequestException.userEvidence.text"],
  emotional_use: ["planId", "binding.sourceTurnId", "evidence.*.text",
    "ordinaryUseObservation.purposeEvidence.*.text", "invitationUseObservation.priorInvitation.text"],
  episode_summary: ["sourceMessageIds.*"],
  proactive_verdict: [
    "candidate", "evidenceSpan", "intent.realization.topic",
    "intent.realization.proposition", "intent.realization.question",
  ],
};

const jsonStrings = /"(?:[^"\\]|\\[\s\S])*"/g;
const tryJson = (text: string): { value: unknown } | null => {
  try { return { value: JSON.parse(text) as unknown }; } catch { return null; }
};

function collect(value: unknown, into: string[], depth = 0) {
  if (depth > 64) throw new Error("PII_REDACTION_INPUT_DEPTH_EXCEEDED");
  if (typeof value === "string") {
    into.push(value);
    const parsed = tryJson(value);
    if (parsed) collect(parsed.value, into, depth + 1);
    else {
      // Embedded JSON need not occupy the whole string or follow a particular prefix.
      // Decode key/value pairs together so existing explicit-label rules still apply.
      const pairs = new RegExp(`(${jsonStrings.source})\\s*:\\s*(${jsonStrings.source})`, "g");
      for (const match of value.matchAll(pairs)) {
        const key = tryJson(match[1])?.value, item = tryJson(match[2])?.value;
        if (typeof key === "string" && typeof item === "string") into.push(`${key}：${item}`);
      }
      for (const match of value.matchAll(jsonStrings)) {
        const literal = tryJson(match[0]);
        if (literal) collect(literal.value, into, depth + 1);
      }
    }
  } else if (typeof value === "number") into.push(String(value));
  else if (Array.isArray(value)) value.forEach((item) => collect(item, into, depth + 1));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      into.push(key);
      if (typeof item === "string") into.push(`${key}：${item}`);
      collect(item, into, depth + 1);
    }
  }
}

function mapJson(value: unknown, map: (text: string, path: (string | number)[]) => string, path: (string | number)[] = []): unknown {
  if (typeof value === "string") return map(value, path);
  if (Array.isArray(value)) return value.map((item, index) => mapJson(item, map, [...path, index]));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, mapJson(item, map, [...path, key]),
    ]));
  }
  return value;
}

/** Transport-only copy. No mapping escapes this request or changes original messages. */
export function createEgressProjection<T>(messages: readonly AiModelMessage[], kind?: EgressResponseKind, responseFormat?: T) {
  if (!Array.isArray(messages) || messages.some(message => !message || typeof message.content !== "string" ||
      !["system", "developer", "user", "assistant"].includes(message.role))) throw new Error("PII_REDACTION_INVALID_INPUT");
  const inputs: string[] = [];
  for (const { content } of messages) collect(content, inputs);
  // Schema constants carry request-local bindings. Discover them before allocating aliases,
  // so prompts and schema use exactly the same map. Never rewrite schema structure/enums.
  const visitConstants = (value: unknown, map: (value: unknown) => unknown): unknown => {
    if (Array.isArray(value)) return value.map(item => visitConstants(item, map));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, key === "const" ? map(item) : visitConstants(item, map)]));
    return value;
  };
  visitConstants(responseFormat, value => { collect(value, inputs); return value; });
  const redactor = createPiiRedactor(inputs);

  const projectJson = (value: unknown): unknown => {
    if (typeof value === "string") return redactor.redact(value);
    if (typeof value === "number") {
      const raw = String(value);
      const masked = redactor.redact(raw);
      return raw === masked ? value : masked;
    }
    if (Array.isArray(value)) return value.map(projectJson);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactor.redact(key), projectJson(item)]));
    }
    return value;
  };
  const projectText = (content: string): string => {
    const parsed = tryJson(content);
    if (parsed) return JSON.stringify(projectJson(parsed.value));
    return redactor.redact(content.split("\n").map((line) => {
      const offset = line.indexOf("=");
      const embedded = offset >= 0 ? tryJson(line.slice(offset + 1)) : null;
      if (embedded) return redactor.redact(line.slice(0, offset + 1)) + JSON.stringify(projectJson(embedded.value));
      return redactor.redact(line);
    }).join("\n"));
  };

  const allowed = (kind ? restoredPaths[kind] : []).map(path => path.split("."));
  const mayRestore = (path: (string | number)[]) => allowed.some(pattern =>
    pattern.length === path.length && pattern.every((segment, index) =>
      segment === "*" ? typeof path[index] === "number" : segment === path[index]));
  const projectedFormat = visitConstants(responseFormat, projectJson) as T;
  // A changed non-string constant would invalidate its schema type. Reject, never send raw.
  const checkConstantTypes = (before: unknown, after: unknown): void => {
    if (typeof before !== typeof after) throw new Error("PII_REDACTION_SCHEMA_TYPE_CHANGED");
    if (before && typeof before === "object") for (const [key, item] of Object.entries(before)) {
      checkConstantTypes(item, (after as Record<string, unknown>)[key]);
    }
  };
  checkConstantTypes(responseFormat, projectedFormat);
  return {
    responseFormat: projectedFormat,
    messages: redactor.hasRedactions
      ? messages.map((message) => ({ ...message, content: projectText(message.content) }))
      : messages.map((message) => ({ ...message })),
    responseText(text: string) {
      if (!redactor.hasRedactions) return text;
      // Keep wrappers/invalid JSON intact: the existing stage parser remains authority.
      const first = text.indexOf("{");
      const last = text.lastIndexOf("}");
      const exact = tryJson(text);
      const fragment = !exact && first >= 0 && last > first ? tryJson(text.slice(first, last + 1)) : null;
      const parsed = exact ?? fragment;
      if (!parsed) return redactor.neutralize(text);
      const mapped = mapJson(parsed.value, (value, path) => mayRestore(path)
        ? redactor.restore(value) : redactor.neutralize(value));
      const encoded = JSON.stringify(mapped);
      return exact ? encoded
        : redactor.neutralize(text.slice(0, first)) + encoded + redactor.neutralize(text.slice(last + 1));
    },
  };
}
