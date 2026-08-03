import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildProactiveGreetingMessages,
  generateProactiveGreeting,
  proactiveGreetingMove,
  proactiveGreetingSimilarity,
  proactiveGreetingTopics,
  selectProactiveGreetingMove,
  validateProactiveGreeting,
} from "../services/ai/proactiveGreeting";
import {
  appendGuestRecentGreeting,
  collapseConsecutiveGuestGreetings,
  parseGuestRecentGreetings,
} from "../lib/guest-proactive-greeting";

const stiffGreetingCounterexamples = [
  "随时可以在这儿说点什么，或者只是待一会儿。",
  "你可以先放一句话在这里，不用想清楚。",
  "想说什么都可以。",
  "你想说的时候再说。",
  "不用着急，慢慢来就好。",
  "没关系，不想说也可以。",
  "不知道说什么也没关系。",
  "你可以从任何地方开始说。",
  "这里可以放下你想说的话。",
  "有什么想聊的吗？",
  "有什么想说的吗？",
  "你想聊点什么？",
  "今天想说点什么？",
  "最近怎么样？",
  "今天过得怎么样？",
  "现在感觉怎么样？",
  "你好吗？",
  "我们随便聊聊吧。",
  "我会在这里陪你。",
  "我们就安静地待一会儿。",
  "先不说也行。",
  "从哪里开始都可以。",
  "把心里的话慢慢说出来就好。",
  "准备好了就开口。",
  "傍晚的上海刚入夜，这会儿正好适合慢慢聊几句。",
  "上海刚入夜。",
  "这会儿正好适合聊几句。",
  "晚上好。",
];

for (const greeting of stiffGreetingCounterexamples) {
  assert(
    validateProactiveGreeting(greeting),
    `Stiff, permission-only, passive, or vague greeting must be rejected: ${greeting}`
  );
}
assert(
  validateProactiveGreeting(
    "傍晚的上海刚入夜，这会儿正好适合慢慢聊几句。"
  ),
  "A server timezone must never be presented as the user's location or local day phase."
);

const naturalGreetingExamples = [
  "你好。",
  "嗨。",
  "哈喽。",
  "嗨，我先来打个招呼。",
  "你好，今天先从一声问候开始。",
  "先说一声你好。",
  "今天先简单问个好。",
  "你好，先简单打个招呼。",
  "嗨，先和你问个好。",
  "我先来问个好。",
  "先打声招呼。",
  "哈喽，我先来问候一声。",
  "最近听到的歌里，有没有一首还记得？",
  "最近看过的电影里，哪一幕还留着印象？",
  "如果给今天挑一种颜色，你会选什么？",
  "最近吃过的一顿饭里，哪样最有印象？",
  "最近有没有一本书，让你愿意多翻两页？",
  "最近有没有一部剧，让你愿意多看一集？",
  "最近有没有一句台词，还留在脑子里？",
  "最近有没有哪件小东西，用起来特别顺手？",
];

for (const greeting of naturalGreetingExamples) {
  assert.equal(
    validateProactiveGreeting(greeting),
    null,
    `Natural greeting move must remain allowed: ${greeting}`
  );
}
assert.equal(naturalGreetingExamples.length, 20);
assert.equal(proactiveGreetingMove("你好。"), "simple_greeting");
assert.equal(proactiveGreetingMove("我先来打个招呼。"), "open_statement");
assert.equal(proactiveGreetingMove("最近看了什么？"), "light_question");
assert.equal(
  selectProactiveGreetingMove({ kind: "initial", recentGreetings: [] }),
  "simple_greeting"
);
assert.equal(
  selectProactiveGreetingMove({ kind: "return", recentGreetings: ["你好。"] }),
  "open_statement"
);
assert.equal(
  selectProactiveGreetingMove({
    kind: "return",
    recentGreetings: ["你好。", "我先来打个招呼。"],
  }),
  "light_question"
);
assert(
  validateProactiveGreeting(
    "最近看了什么？",
    ["你好。", "最近听了什么？"],
    "light_question"
  ),
  "Only one question greeting may appear in a three-greeting window."
);
assert(
  validateProactiveGreeting("最近看了什么？", [], "open_statement"),
  "The generated greeting must implement the selected non-question move."
);
assert.equal(
  validateProactiveGreeting("我先来打个招呼。", [], "simple_greeting"),
  null,
  "A safe non-question opening may satisfy a simple-greeting preference without failing the request."
);
assert.equal(
  validateProactiveGreeting("你好。", [], "open_statement"),
  null,
  "A conventional greeting may satisfy a non-question opening preference."
);

const recentGreeting = "最近听到的歌里，有没有一首还记得？";
const nearDuplicate = "最近听过的歌里，有没有一首还记得？";
const differentGreeting = "最近吃过的一顿饭里，哪样最有印象？";
assert(proactiveGreetingSimilarity(recentGreeting, nearDuplicate) >= 0.72);
assert(proactiveGreetingSimilarity(recentGreeting, differentGreeting) < 0.72);
assert(validateProactiveGreeting(nearDuplicate, [recentGreeting]));
assert.equal(
  validateProactiveGreeting(
    differentGreeting,
    [recentGreeting, "你好。", "我先来打个招呼。"]
  ),
  null
);

const screenshotSongGreeting = "最近有没有哪首歌让你忍不住单曲循环？";
const screenshotSongParaphrase = "最近有没有哪首歌单曲循环了好几遍？";
assert(
  validateProactiveGreeting(screenshotSongParaphrase, [screenshotSongGreeting]),
  "Greetings that repeat the same song/replay topic must be rejected even when character similarity is below the near-duplicate threshold."
);
assert.deepEqual(proactiveGreetingTopics(screenshotSongGreeting), ["music"]);

const repeatedTopicPairs = [
  ["最近看过的电影里，哪一幕还留着印象？", "最近有没有一部剧，让你愿意多看一集？"],
  ["最近吃过的一顿饭里，哪样最有印象？", "最近碰到过什么味道，让你一下记住了？"],
  ["最近有没有一本书，让你愿意多翻两页？", "最近有没有一句文字，还留在脑子里？"],
  ["最近有没有哪张照片，让你多看了一眼？", "最近见到的颜色里，哪一种最醒目？"],
  ["最近有没有哪件小东西，用起来特别顺手？", "最近用过的物品里，哪一件最常用？"],
  ["最近路过的店里，有没有一个名字还记得？", "最近见过的地方里，哪一个还记得？"],
] as const;
for (const [previous, current] of repeatedTopicPairs) {
  assert(
    validateProactiveGreeting(current, [previous]),
    `Repeated greeting topic must be rejected: ${previous} -> ${current}`
  );
}

assert.deepEqual(parseGuestRecentGreetings("not-json"), []);
assert.deepEqual(
  parseGuestRecentGreetings(JSON.stringify(["一", 2, "二", "三", "四"])),
  ["二", "三", "四"]
);
assert.deepEqual(
  appendGuestRecentGreeting(["一", "二", "三"], "二"),
  ["一", "三", "二"]
);
assert.deepEqual(
  appendGuestRecentGreeting(["一", "二", "三"], "四"),
  ["二", "三", "四"]
);
assert.deepEqual(
  collapseConsecutiveGuestGreetings([
    { id: "g1", promptVersion: "chat-proactive-greeting-v2" },
    { id: "g2", promptVersion: "chat-proactive-greeting-v3" },
    { id: "u1", promptVersion: null },
    { id: "g3", promptVersion: "chat-proactive-greeting-v3" },
    { id: "g4", promptVersion: "chat-proactive-greeting-v3" },
  ]).map((item) => item.id),
  ["g2", "u1", "g4"]
);

const prompt = buildProactiveGreetingMessages({
  kind: "initial",
  move: "open_statement",
  recentMessages: [],
  recentGreetings: [recentGreeting],
});
const promptText = prompt.map((message) => message.content).join("\n");
assert(promptText.includes("欢迎语不等于提问"));
assert(promptText.includes("本轮动作是 open_statement"));
assert(promptText.includes("最近 1 条欢迎语已纳入内部防重复校验"));
assert(promptText.includes("近期已使用的开场动作：light_question"));
assert(promptText.includes("近期已使用的话题类别：music"));
assert(!promptText.includes("当前上海时间"));
assert(!promptText.includes("2026"));
assert(!promptText.includes(recentGreeting));
assert(!promptText.includes("不要使用呀、呢、啦、哦"));
assert(!promptText.includes("你可以先放一句话"));

const guestClientSource = readFileSync("app/chat/chat-client.tsx", "utf8");
const loggedInServiceSource = readFileSync(
  "services/chat/proactiveGreetingService.ts",
  "utf8"
);
assert(guestClientSource.includes("GUEST_RECENT_GREETINGS_KEY"));
assert(guestClientSource.includes("window.localStorage"));
assert(guestClientSource.includes("recentGreetings"));
assert(loggedInServiceSource.includes("recentGreetings"));

const runAsync = async () => {
  const previousProvider = process.env.AI_PROVIDER;
  const previousQwenKey = process.env.QWEN_API_KEY;
  const previousGreetingMode = process.env.PROACTIVE_GREETING_MODE;
  process.env.AI_PROVIDER = "qwen";
  process.env.QWEN_API_KEY = "synthetic-test-key";
  process.env.PROACTIVE_GREETING_MODE = "deterministic";
  try {
    const deterministicGreetings: string[] = [];
    const firstDeterministic = await generateProactiveGreeting({
      kind: "initial",
      recentMessages: [],
      recentGreetings: [],
    });
    deterministicGreetings.push(firstDeterministic.text);
    for (let index = 0; index < 5; index += 1) {
      const generated = await generateProactiveGreeting({
        kind: "return",
        recentMessages: [],
        recentGreetings: deterministicGreetings.slice(-3),
      });
      deterministicGreetings.push(generated.text);
    }
    assert.deepEqual(
      deterministicGreetings.map(proactiveGreetingMove),
      [
        "simple_greeting",
        "open_statement",
        "light_question",
        "open_statement",
        "simple_greeting",
        "open_statement",
      ]
    );
    for (const [index, greeting] of deterministicGreetings.entries()) {
      assert.equal(
        validateProactiveGreeting(greeting, deterministicGreetings.slice(Math.max(0, index - 3), index)),
        null
      );
    }
  } finally {
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
    if (previousQwenKey === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = previousQwenKey;
    if (previousGreetingMode === undefined) delete process.env.PROACTIVE_GREETING_MODE;
    else process.env.PROACTIVE_GREETING_MODE = previousGreetingMode;
  }

  console.log(JSON.stringify({
    stiffGreetingCounterexamples: stiffGreetingCounterexamples.length,
    naturalGreetingExamples: naturalGreetingExamples.length,
    greetingMoveTypes: 3,
    questionGreetingWindowEnforced: true,
    screenshotGreetingRejected: true,
    screenshotTimeAndLocationRejected: true,
    nearDuplicateRejected: true,
    repeatedTopicPairsRejected: repeatedTopicPairs.length + 1,
    consecutiveGuestGreetingsCollapsed: true,
    crossTabGuestProjectionPresent: true,
    loggedInProjectionPresent: true,
    deterministicGreetingValidated: true,
    deterministicGreetingSequenceValidated: true,
  }, null, 2));
};

runAsync().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
