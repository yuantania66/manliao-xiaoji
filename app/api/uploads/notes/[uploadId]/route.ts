import { readFile } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";

import { failFromError } from "@/lib/api-response";
import { getCurrentUser, requireAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stagingOwnerAccessEnabled } from "@/lib/staging-owner-access";

import { getNoteUploadRoot, tokenMatches } from "../storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ uploadId: string }> }) {
  const ownerOnly = stagingOwnerAccessEnabled();
  const cacheHeaders = ownerOnly ? { "cache-control": "private, no-store" } : undefined;
  const notFound = () => new Response(null, { status: 404, headers: cacheHeaders });
  let owner = null;
  if (ownerOnly) {
    try {
      owner = await requireAuthenticatedUser(request);
    } catch (error) {
      const response = failFromError(error);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  }

  const { uploadId } = await context.params;
  const upload = await prisma.noteUpload.findUnique({ where: { id: uploadId } });
  if (!upload || !upload.noteId) return notFound();
  const user = ownerOnly ? owner : await getCurrentUser(request);
  if (user?.id !== upload.userId &&
      (ownerOnly || !tokenMatches(new URL(request.url).searchParams.get("token") || "", upload.accessTokenHash))) {
    return notFound();
  }
  try {
    const bytes = await readFile(path.join(getNoteUploadRoot(), upload.storageKey));
    return new Response(bytes, {
      headers: {
        "content-type": upload.mimeType,
        "cache-control": cacheHeaders?.["cache-control"] ?? "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return notFound();
  }
}
