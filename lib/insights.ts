const STOP_WORDS = new Set([
  "一个",
  "一些",
  "这个",
  "那个",
  "什么",
  "怎么",
  "可以",
  "因为",
  "所以",
  "但是",
  "还是",
  "已经",
  "没有",
  "不是",
  "就是",
  "自己",
  "今天",
  "昨天",
  "现在",
  "真的",
  "感觉",
  "觉得",
  "有点",
  "一下",
  "我们",
  "你们",
  "他们",
  "她们",
  "它们",
  "然后",
  "如果",
  "时候",
  "这样",
  "那样",
]);

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

const normalizeWord = (word: string) => word.trim().toLocaleLowerCase("zh-CN");

export const countInsightWords = (texts: string[], limit = 6) => {
  const counts = new Map<string, number>();

  for (const text of texts) {
    for (const item of segmenter.segment(text)) {
      const word = normalizeWord(item.segment);
      if (
        !item.isWordLike ||
        word.length < 2 ||
        word.length > 24 ||
        STOP_WORDS.has(word) ||
        /^\d+(?:[.,]\d+)?$/.test(word)
      ) {
        continue;
      }
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort(([wordA, countA], [wordB, countB]) =>
      countB !== countA ? countB - countA : wordA < wordB ? -1 : wordA > wordB ? 1 : 0
    )
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
};
