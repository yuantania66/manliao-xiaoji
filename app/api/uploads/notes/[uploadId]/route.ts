import { readFile } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { getNoteUploadRoot, tokenMatches } from "../storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ uploadId: string }> }) {
  const { uploadId } = await context.params;
  const upload = await prisma.noteUpload.findUnique({ where: { id: uploadId } });
  if (!upload || !upload.noteId) return new Response(null, { status: 404 });
  const user = await getCurrentUser(request);
  const token = new URL(request.url).searchParams.get("token") || "";
  if (user?.id !== upload.userId && !tokenMatches(token, upload.accessTokenHash)) {
    return new Response(null, { status: 404 });
  }
  try {
    const bytes = await readFile(path.join(getNoteUploadRoot(), upload.storageKey));
    return new Response(bytes, { headers: { "content-type": upload.mimeType, "cache-control": "private, max-age=31536000, immutable" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
