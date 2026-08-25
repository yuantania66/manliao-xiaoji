import { P4MinimumMemoryStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { validateP4Memory } from "./p4MemoryPromotionAuthority";

export const P4_LOCAL_TOP_K = 3 as const;

const cosine = (left: readonly number[], right: readonly number[]) => {
  if (!left.length || left.length !== right.length) return Number.NEGATIVE_INFINITY;
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index], r = right[index];
    if (!Number.isFinite(l) || !Number.isFinite(r)) return Number.NEGATIVE_INFINITY;
    dot += l * r; leftNorm += l * l; rightNorm += r * r;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : Number.NEGATIVE_INFINITY;
};

export const retrieveP4LocalTopK = async ({
  userId,
  queryVector,
}: {
  userId: string;
  queryVector: readonly number[];
}) => {
  if (!queryVector.length || queryVector.some((value) => !Number.isFinite(value))) return [];
  const candidates = await prisma.p4MinimumMemory.findMany({
    where: {
      userId,
      status: P4MinimumMemoryStatus.ACTIVE,
      OR: [{ sensitiveExpiresAt: null }, { sensitiveExpiresAt: { gt: new Date() } }],
    },
  });
  const visible = [] as Array<{ item: (typeof candidates)[number]; score: number }>;
  for (const item of candidates) {
    if (!(await validateP4Memory(userId, item))) continue;
    const vector = Array.isArray(item.retrievalVector) ? item.retrievalVector : [];
    const score = cosine(queryVector, vector.filter((value): value is number => typeof value === "number"));
    if (Number.isFinite(score) && score > 0) visible.push({ item, score });
  }
  return visible
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id))
    .slice(0, P4_LOCAL_TOP_K);
};
