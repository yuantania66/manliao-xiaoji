import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireNonEmptyString } from "@/lib/validation";

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

const serializeNote = (note: {
  id: string;
  content: string;
  moodName: string | null;
  moodIcon: string | null;
  mediaUrls: unknown;
  recordDate: Date;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: note.id,
  content: note.content,
  moodName: note.moodName,
  moodIcon: note.moodIcon,
  mediaUrls: Array.isArray(note.mediaUrls) ? note.mediaUrls : [],
  recordDate: note.recordDate.toISOString().slice(0, 10),
  createdAt: note.createdAt.toISOString(),
  updatedAt: note.updatedAt.toISOString(),
});

const findOwnedNote = async (noteId: string, userId: string) => {
  const note = await prisma.note.findFirst({
    where: { id: noteId, userId },
    select: {
      id: true,
      content: true,
      moodName: true,
      moodIcon: true,
      mediaUrls: true,
      recordDate: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!note) throw new AppError("NOT_FOUND", "小记不存在", 404);
  return note;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ noteId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { noteId } = await context.params;
    const note = await findOwnedNote(noteId, user.id);
    return ok(serializeNote(note));
  } catch (error) {
    return failFromError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ noteId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { noteId } = await context.params;
    await findOwnedNote(noteId, user.id);
    const body = await readJson(request);

    const note = await prisma.note.update({
      where: { id: noteId },
      data: {
        ...(body.content === undefined
          ? {}
          : { content: requireNonEmptyString(body.content, "content", 500) }),
      },
      select: {
        id: true,
        content: true,
        moodName: true,
        moodIcon: true,
        mediaUrls: true,
        recordDate: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return ok(serializeNote(note));
  } catch (error) {
    return failFromError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ noteId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { noteId } = await context.params;
    await findOwnedNote(noteId, user.id);
    await prisma.note.delete({ where: { id: noteId } });
    return ok({ deleted: true });
  } catch (error) {
    return failFromError(error);
  }
}
