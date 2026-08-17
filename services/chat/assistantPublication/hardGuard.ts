/**
 * Publication Hard Guard + streaming Output Safety wiring.
 *
 * Input: crisis hard stop (V1 isCrisisInput).
 * Output segments: stream Output Safety (P3 v1 deterministic) before provisional.
 * Final: same Output Safety + Hard Guard tail before commit.
 */

import { createSafetyGeneration, isCrisisInput } from "@/services/ai/chatSafety";

import {
  P3_PUBLICATION_SAFETY_DEPTH,
  evaluateStreamingOutputFinal,
  evaluateStreamingOutputSegment,
} from "./outputSafety";

export type HardGuardDecision =
  | { accept: true }
  | {
      accept: false;
      reason: "input_crisis" | "output_reject";
      detail?: string;
    };

export function hardGuardInput(userText: string): HardGuardDecision {
  if (isCrisisInput(userText)) {
    return { accept: false, reason: "input_crisis" };
  }
  return { accept: true };
}

export function hardGuardOutputSegment(text: string): HardGuardDecision {
  const decision = evaluateStreamingOutputSegment(text);
  if (!decision.accept) {
    return {
      accept: false,
      reason: "output_reject",
      detail: decision.detail ?? decision.reason,
    };
  }
  return { accept: true };
}

export function hardGuardFinal(text: string): HardGuardDecision {
  const decision = evaluateStreamingOutputFinal(text);
  if (!decision.accept) {
    return {
      accept: false,
      reason: "output_reject",
      detail: decision.detail ?? decision.reason,
    };
  }
  return { accept: true };
}

export function safetyOwnedReplyForInput(userText: string): string {
  return createSafetyGeneration(userText).text;
}

/** Documented depth string for API / guide honesty. */
export const P2_PUBLICATION_SAFETY_DEPTH = P3_PUBLICATION_SAFETY_DEPTH;
