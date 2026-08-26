import { removeNoteUploadFile } from "@/app/api/uploads/notes/storage";
import { prisma } from "@/lib/prisma";

export const drainAccountCancellationFiles = async (taskIds: string[]) => {
  const tasks = await prisma.accountCancellationFileDeletion.findMany({
    where: { id: { in: taskIds }, completedAt: null },
    select: { id: true, storageKey: true },
  });

  let pending = 0;
  for (const task of tasks) {
    try {
      await removeNoteUploadFile(task.storageKey);
      await prisma.accountCancellationFileDeletion.delete({ where: { id: task.id } });
    } catch (error) {
      pending += 1;
      const code = error instanceof Error && "code" in error
        ? String((error as NodeJS.ErrnoException).code || "FILE_DELETE_FAILED")
        : "FILE_DELETE_FAILED";
      await prisma.accountCancellationFileDeletion.update({
        where: { id: task.id },
        data: { attempts: { increment: 1 }, lastErrorCode: code.slice(0, 64) },
      });
    }
  }
  return pending;
};

export const drainPendingAccountCancellationFiles = async (limit = 100) => {
  const tasks = await prisma.accountCancellationFileDeletion.findMany({
    where: { completedAt: null },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 500)),
    select: { id: true },
  });
  return {
    attempted: tasks.length,
    pending: await drainAccountCancellationFiles(tasks.map((task) => task.id)),
  };
};

export const cancelAccountData = async ({
  userId,
  phone,
  cancelCodeId,
}: {
  userId: string;
  phone: string | null;
  cancelCodeId: string | null;
}) => prisma.$transaction(async (tx) => {
  const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `;
  if (lockedUsers.length !== 1) throw new Error("account_cancellation_user_not_found");

  if (cancelCodeId) {
    await tx.verificationCode.update({
      where: { id: cancelCodeId },
      data: { consumedAt: new Date() },
    });
  }

  await tx.feedback.updateMany({
    where: { userId },
    data: { userId: null, content: "[account_cancelled]", contact: null, userAgent: null },
  });
  const uploads = await tx.noteUpload.findMany({
    where: { userId },
    select: { storageKey: true },
  });
  const cleanupTasks = await Promise.all(
    uploads.map((upload) => tx.accountCancellationFileDeletion.upsert({
      where: { storageKey: upload.storageKey },
      create: { storageKey: upload.storageKey },
      update: {},
      select: { id: true },
    })),
  );
  await tx.verificationCode.deleteMany({
    where: { OR: [{ userId }, ...(phone ? [{ phone }] : [])] },
  });
  await tx.user.delete({ where: { id: userId } });
  await tx.user.create({ data: { status: "CANCELLED" } });
  return cleanupTasks.map((task) => task.id);
});
