import {
  MessageRole,
  MessageStatus,
  RefinementStatus,
  RefinementStep,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import { createRawMemoryFromChatMessage, createRawMemoryFromNote } from "../services/memory/rawMemoryService";
import {
  claimPendingRefinementJob,
  createRefinementJobForRawMemory,
  listPendingRefinementJobs,
  markRefinementJobFailed,
  markRefinementJobSucceeded,
} from "../services/memory/refinementJobService";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const main = async () => {
  const user = await prisma.user.create({
    data: {
      phone: `memory-v2-job-${Date.now()}`,
      nickname: "memory-v2-job-check",
    },
    select: { id: true },
  });

  try {
    const session = await prisma.chatSession.create({
      data: { userId: user.id, title: "memory-v2-job-check" },
      select: { id: true },
    });
    const message = await prisma.chatMessage.create({
      data: {
        userId: user.id,
        sessionId: session.id,
        role: MessageRole.USER,
        status: MessageStatus.SAVED,
        content: "今天我把一个小任务推进完了。",
      },
      select: { id: true },
    });

    const chatRaw = await createRawMemoryFromChatMessage({ chatMessageId: message.id });
    const chatJob = await prisma.refinementJob.findFirst({
      where: {
        rawMemoryId: chatRaw.id,
        step: RefinementStep.RAW_CAPTURED,
      },
    });
    if (!chatJob) throw new Error("Chat RawMemory should create a refinement job");
    assert(chatJob.status === RefinementStatus.PENDING, "Chat job should start as PENDING");

    const duplicateChatJob = await createRefinementJobForRawMemory({ rawMemoryId: chatRaw.id });
    assert(duplicateChatJob.id === chatJob.id, "Duplicate job create should return existing job");
    const chatJobCount = await prisma.refinementJob.count({
      where: { rawMemoryId: chatRaw.id, step: RefinementStep.RAW_CAPTURED },
    });
    assert(chatJobCount === 1, `Expected 1 chat job, got ${chatJobCount}`);

    const pendingWindow = await listPendingRefinementJobs({
      step: RefinementStep.RAW_CAPTURED,
      take: 10,
    });
    assert(pendingWindow.length <= 10, "Pending job list must respect the requested take limit");
    assert(
      pendingWindow.every(
        (job) => job.status === RefinementStatus.PENDING && job.step === RefinementStep.RAW_CAPTURED
      ),
      "Pending job list must apply status and step filters"
    );
    assert(
      pendingWindow.every(
        (job, index) => index === 0 || pendingWindow[index - 1].createdAt <= job.createdAt
      ),
      "Pending job list must preserve FIFO creation order"
    );

    const pendingJobCount = await prisma.refinementJob.count({
      where: {
        status: RefinementStatus.PENDING,
        step: RefinementStep.RAW_CAPTURED,
      },
    });
    const pendingJobs = await listPendingRefinementJobs({
      step: RefinementStep.RAW_CAPTURED,
      take: pendingJobCount,
    });
    assert(
      pendingJobs.some((job) => job.id === chatJob.id),
      "Complete pending job list should include chat job"
    );

    const runningChatJob = await claimPendingRefinementJob({ jobId: chatJob.id });
    if (!runningChatJob) throw new Error("Pending chat job should be claimed");
    const duplicateClaim = await claimPendingRefinementJob({ jobId: chatJob.id });
    assert(duplicateClaim === null, "Claiming the same pending job twice should only succeed once");
    assert(runningChatJob.status === RefinementStatus.RUNNING, "Chat job should become RUNNING");
    assert(runningChatJob.attempt === 1, "Running job should increment attempt");

    const succeededChatJob = await markRefinementJobSucceeded({
      jobId: chatJob.id,
      outputSnapshot: { check: "succeeded" },
    });
    assert(succeededChatJob.status === RefinementStatus.SUCCEEDED, "Chat job should become SUCCEEDED");
    const succeededClaim = await claimPendingRefinementJob({ jobId: chatJob.id });
    assert(succeededClaim === null, "Succeeded job claim should fail");

    const note = await prisma.note.create({
      data: {
        userId: user.id,
        content: "今天记录一个失败状态测试。",
        recordDate: new Date("2026-07-08T00:00:00.000Z"),
        isDraft: false,
      },
      select: { id: true },
    });

    const noteRaw = await createRawMemoryFromNote({ noteId: note.id });
    const noteJob = await prisma.refinementJob.findFirst({
      where: {
        rawMemoryId: noteRaw.id,
        step: RefinementStep.RAW_CAPTURED,
      },
    });
    if (!noteJob) throw new Error("Note RawMemory should create a refinement job");
    assert(noteJob.status === RefinementStatus.PENDING, "Note job should start as PENDING");

    const runningNoteJob = await claimPendingRefinementJob({ jobId: noteJob.id });
    if (!runningNoteJob) throw new Error("Pending note job should be claimed");
    const failedNoteJob = await markRefinementJobFailed({
      jobId: noteJob.id,
      error: "memory-v2 refinement job check failure",
      outputSnapshot: { check: "failed" },
    });
    assert(failedNoteJob.status === RefinementStatus.FAILED, "Note job should become FAILED");
    assert(Boolean(failedNoteJob.error), "Failed job should store error text");
    const failedClaim = await claimPendingRefinementJob({ jobId: noteJob.id });
    assert(failedClaim === null, "Failed job claim should fail");

    console.log("Memory V2 refinement job checks passed");
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
