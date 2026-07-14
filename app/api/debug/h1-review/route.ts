import { spawn } from "node:child_process";
import { join } from "node:path";

import { NextResponse } from "next/server";

import {
  buildReviewPayload,
  isRoundComplete,
  readManifest,
  writeSelection,
} from "@/lib/h1-eval/storage";
import { H1_REASON_TAGS, type H1ReasonTag, type H1Selection } from "@/lib/h1-eval/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unavailable = () => NextResponse.json({ error: "Local eval route is disabled in production." }, { status: 404 });

const startAutomaticAnalysis = () => {
  const executable = join(process.cwd(), "node_modules", ".bin", "tsx");
  const child = spawn(executable, ["scripts/h1-response-selection-results.ts"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
};

export async function GET() {
  if (process.env.NODE_ENV === "production") return unavailable();
  return NextResponse.json(buildReviewPayload(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return unavailable();

  const body = await request.json().catch(() => null) as Partial<H1Selection> | null;
  if (!body || (body.round !== 1 && body.round !== 2) || typeof body.caseId !== "string") {
    return NextResponse.json({ error: "Invalid selection payload." }, { status: 400 });
  }

  const manifest = readManifest(body.round);
  const item = manifest?.cases.find((entry) => entry.id === body.caseId);
  if (!item) return NextResponse.json({ error: "Unknown case or round." }, { status: 400 });

  const labels = new Set(item.candidates.map((candidate) => candidate.label));
  const best = body.best ?? null;
  if (best !== null && best !== "all_unacceptable" && !labels.has(best)) {
    return NextResponse.json({ error: "Invalid best candidate." }, { status: 400 });
  }
  if (body.secondBest && !labels.has(body.secondBest)) {
    return NextResponse.json({ error: "Invalid second-best candidate." }, { status: 400 });
  }

  const unacceptable = Array.isArray(body.unacceptable)
    ? [...new Set(body.unacceptable.filter((label): label is string => typeof label === "string" && labels.has(label)))]
    : [];
  if (best !== null && best !== "all_unacceptable" && unacceptable.includes(best)) {
    return NextResponse.json({ error: "Best candidate cannot also be unacceptable." }, { status: 400 });
  }
  if (body.secondBest && unacceptable.includes(body.secondBest)) {
    return NextResponse.json({ error: "Second-best candidate cannot also be unacceptable." }, { status: 400 });
  }
  const reasonTags = Array.isArray(body.reasonTags)
    ? [...new Set(body.reasonTags.filter((tag): tag is H1ReasonTag => H1_REASON_TAGS.includes(tag as H1ReasonTag)))]
    : [];
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  const willingToContinue = typeof body.willingToContinue === "boolean" ? body.willingToContinue : null;

  writeSelection({
    caseId: body.caseId,
    round: body.round,
    best,
    secondBest: body.secondBest && body.secondBest !== best ? body.secondBest : null,
    unacceptable,
    reasonTags,
    note,
    willingToContinue,
    updatedAt: new Date().toISOString(),
  });

  const roundComplete = isRoundComplete(body.round);
  if (roundComplete) startAutomaticAnalysis();

  return NextResponse.json({ ok: true, roundComplete, payload: buildReviewPayload() });
}
