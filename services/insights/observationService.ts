import { prisma } from "@/lib/prisma";

const STOP_WORDS = new Set([
  "这个", "那个", "这样", "就是", "还是", "然后", "因为", "所以", "但是", "如果",
  "今天", "现在", "已经", "可以", "没有", "什么", "怎么", "觉得", "一下", "一个",
  "我们", "你们", "他们", "自己", "真的", "可能", "应该", "不是", "比较", "有点",
  "你好", "您好", "好吧", "好的", "收到", "嗯嗯", "我也", "你也", "他也", "你是",
  "我是", "为什么", "不知道", "不想", "不会", "不能", "不太", "没事", "没啥",
  "其实", "只是", "或者", "是否", "哪里", "哪个", "怎样", "感觉", "的话",
]);

export const extractObservationWords = (texts: string[]) => {
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const segment of segmenter.segment(text.normalize("NFKC"))) {
      const word = segment.segment.trim().toLowerCase();
      const length = Array.from(word).length;
      if (!segment.isWordLike || length < 2 || length > 12 || STOP_WORDS.has(word)) continue;
      if (/^\d+$/u.test(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .slice(0, 8)
    .map(([word, count]) => ({ word, count }));
};

export const getUserObservation = async ({
  userId,
  days,
  now = new Date(),
}: {
  userId: string;
  days: 7 | 30 | 90;
  now?: Date;
}) => {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const [notes, messages] = await Promise.all([
    prisma.note.findMany({
      where: { userId, createdAt: { gte: since }, content: { not: "" } },
      select: { content: true },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    prisma.chatMessage.findMany({
      where: {
        userId,
        role: "USER",
        status: "SAVED",
        contentDeletedAt: null,
        createdAt: { gte: since },
      },
      select: { content: true },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
  ]);
  return {
    rangeDays: days,
    words: extractObservationWords([
      ...notes.map((note) => note.content),
      ...messages.map((message) => message.content),
    ]),
    sourceCounts: { notes: notes.length, userMessages: messages.length },
  };
};
