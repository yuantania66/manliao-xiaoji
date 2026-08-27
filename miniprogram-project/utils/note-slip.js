const REFLECTION_RULES = [
  {
    pattern: /(不知道|为什么|想不明白|不清楚)/,
    quote: "先不用急着找到答案。",
    caption: "可以先写清楚：你不想继续的是什么，你希望接下来有什么不同。"
  },
  {
    pattern: /(怎么办|要不要|选择|决定)/,
    quote: "答案可以晚一点来。",
    caption: "先列出你最在意的两件事，再看哪一步更靠近它们。"
  },
  {
    pattern: /(开心|高兴|喜欢|顺利|满足)/,
    quote: "把这份具体的好留下来。",
    caption: "再记一个让它发生的细节，以后会更容易找回这份感受。"
  },
  {
    pattern: /(累|忙|撑|疲|倦)/,
    quote: "先把最重的一件事放下来。",
    caption: "写下今天最消耗你的部分，再看看哪一步可以先不做。"
  },
  {
    pattern: /(关系|对你|对我|我们)/,
    quote: "先分开发生的事和你的感受。",
    caption: "各写一句，也许会更容易看见你真正想表达什么。"
  }
];

const createNoteSlip = (content, mediaCount = 0) => {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return {
      quote: mediaCount > 1 ? "从这些画面里选一个细节。" : "从这张画面里选一个细节。",
      caption: "把它为什么值得留下来写成一句话，也许会看见更多。"
    };
  }

  const matched = REFLECTION_RULES.find((rule) => rule.pattern.test(text));
  if (matched) return { quote: matched.quote, caption: matched.caption };

  return {
    quote: "再靠近这一刻一点。",
    caption: "可以补一句：刚才发生了什么，以及你希望接下来有什么不同。"
  };
};

module.exports = {
  createNoteSlip
};
