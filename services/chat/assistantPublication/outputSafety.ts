/**
 * Streaming Output Safety Guard (P3 trunk v1 — deterministic segment gate).
 *
 * Runs on each sentence-sized segment BEFORE provisional egress.
 * Hard Guard remains the final commit tail and reuses these checks.
 *
 * Honest scope: deterministic pattern / coaching rejects — not an LLM Safety judge.
 * Memory isolation hooks are labeled here for S3 wiring.
 */

export const P3_STREAM_OUTPUT_SAFETY_VERSION = "stream_output_safety_v1";

export type OutputSafetyDecision =
  | { accept: true; version: string }
  | {
      accept: false;
      version: string;
      reason:
        | "harm_coaching"
        | "weapon_diy"
        | "medical_authority"
        | "crisis_coaching"
        | "empty";
      detail?: string;
    };

const HARM_COACHING =
  /教你自杀|怎么自杀|自杀方法|自杀步骤|割腕教程|如何结束生命|安乐死方法|教你轻生/;

const WEAPON_DIY =
  /制作炸弹|怎么造炸弹|炸药配方|如何杀人|教你杀人|无痕下毒|制作枪支/;

const MEDICAL_AUTHORITY =
  /(?:我是|作为)(?:你的)?(?:心理医生|精神科医生|主治医生)|我(?:可以|能)(?:给你)?(?:开药|诊断|处方)/;

const CRISIS_COACHING =
  /(?:你可以|建议你|试试).{0,12}(?:自杀|轻生|割腕|结束生命)/;

/**
 * Segment-level streaming Output Safety.
 * Rejected segments must not become provisional or committed.
 */
export function evaluateStreamingOutputSegment(
  accumulatedOrSegmentText: string,
): OutputSafetyDecision {
  const text = accumulatedOrSegmentText.trim();
  if (!text) {
    return { accept: true, version: P3_STREAM_OUTPUT_SAFETY_VERSION };
  }
  if (HARM_COACHING.test(text)) {
    return {
      accept: false,
      version: P3_STREAM_OUTPUT_SAFETY_VERSION,
      reason: "harm_coaching",
      detail: "harm_coaching_pattern",
    };
  }
  if (WEAPON_DIY.test(text)) {
    return {
      accept: false,
      version: P3_STREAM_OUTPUT_SAFETY_VERSION,
      reason: "weapon_diy",
      detail: "weapon_diy_pattern",
    };
  }
  if (MEDICAL_AUTHORITY.test(text)) {
    return {
      accept: false,
      version: P3_STREAM_OUTPUT_SAFETY_VERSION,
      reason: "medical_authority",
      detail: "medical_authority_claim",
    };
  }
  if (CRISIS_COACHING.test(text)) {
    return {
      accept: false,
      version: P3_STREAM_OUTPUT_SAFETY_VERSION,
      reason: "crisis_coaching",
      detail: "crisis_coaching_pattern",
    };
  }
  return { accept: true, version: P3_STREAM_OUTPUT_SAFETY_VERSION };
}

export function evaluateStreamingOutputFinal(
  text: string,
): OutputSafetyDecision {
  return evaluateStreamingOutputSegment(text);
}

/** Honest depth for API / guides. */
export const P3_PUBLICATION_SAFETY_DEPTH =
  "stream_output_safety_v1+hard_guard+hard_facts: input crisis gate; streaming segment Output Safety (deterministic); final Hard Guard; hard facts + Memory untrusted labeling on prompt; LLM Safety judge not mounted";
