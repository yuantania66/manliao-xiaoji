import { readFile } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getNoteUploadRoot } from "@/app/api/uploads/notes/storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ uploadId: string }> }) {
  const user = await getCurrentUser(request);
  if (!user) return new Response(null, { status: 401 });
  const { uploadId } = await context.params;
  const upload = await prisma.noteUpload.findFirst({
    where: { id: uploadId, userId: user.id, purpose: "PROFILE_AVATAR", boundAt: { not: null } },
  });
  if (!upload) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(path.join(getNoteUploadRoot(), upload.storageKey));
    return new Response(bytes, {
      headers: { "content-type": "image/webp", "cache-control": "private, no-store" },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
