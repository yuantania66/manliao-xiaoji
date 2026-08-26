import { createHash, randomInt } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  loadChatGateDataset,
  readChatGateRunArtifact,
  type ChatGateEpisodeRun,
} from "./chat-gate-v0-lib";
import { buildHumanBlindReviewHtml } from "./chat-gate-v0-human-blind-ui";

const getArg = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
};

const aPath = getArg("a");
const bPath = getArg("b");
const outputPath = getArg("output");
const keyPath = getArg("key");
const htmlPath = getArg("html");

for (const [field, value] of [
  ["a", aPath],
  ["b", bPath],
  ["output", outputPath],
  ["key", keyPath],
  ["html", htmlPath],
] as const) {
  if (!value) throw new Error(`--${field} is required.`);
}

const dataset = loadChatGateDataset();
const a = readChatGateRunArtifact(aPath);
const b = readChatGateRunArtifact(bPath);
const auditChecks: Array<{ name: string; passed: boolean }> = [];
const audit = (name: string, passed: boolean) => {
  auditChecks.push({ name, passed });
  if (!passed) throw new Error(`Blind-pack audit failed: ${name}`);
};

audit("runner versions match", a.runnerVersion === b.runnerVersion);
audit("dataset versions match", a.datasetVersion === b.datasetVersion);
audit("dataset hashes match", a.datasetSha256 === b.datasetSha256);
audit("providers match", a.provider === b.provider);
audit("models match", a.model === b.model);
audit("repeat counts match", a.repeatCount === b.repeatCount);
audit("A dataset version is current", a.datasetVersion === dataset.datasetVersion);
audit("A dataset hash is current", a.datasetSha256 === createHash("sha256").update(readFileSync("clinical-evals/chat-gate-v0.json")).digest("hex"));
audit("A has the required run count", a.episodeRuns.length === dataset.gateContract.episodeRunsPerSide);
audit("B has the required run count", b.episodeRuns.length === dataset.gateContract.episodeRunsPerSide);

const indexRuns = (runs: ChatGateEpisodeRun[]) =>
  new Map(runs.map((run) => [`${run.episodeId}:run-${run.runIndex}`, run]));
const aRuns = indexRuns(a.episodeRuns);
const bRuns = indexRuns(b.episodeRuns);

const expectedRunKeys = dataset.episodes.flatMap((episode) =>
  Array.from(
    { length: dataset.gateContract.runsPerSide },
    (_, offset) => `${episode.id}:run-${offset + 1}`
  )
);

audit("A run keys are unique", aRuns.size === a.episodeRuns.length);
audit("B run keys are unique", bRuns.size === b.episodeRuns.length);
audit("A contains every expected run", expectedRunKeys.every((key) => aRuns.has(key)));
audit("B contains every expected run", expectedRunKeys.every((key) => bRuns.has(key)));

const shuffle = <T>(items: T[]) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
};

const formatTrajectory = (run: ChatGateEpisodeRun) =>
  run.turns
    .map((turn, index) => {
      const assistant = turn.assistantMessage?.content ?? `[SYSTEM STATUS: ${turn.executionStatus}]`;
      return [
        `第 ${index + 1} 轮`,
        "",
        `用户：${turn.user}`,
        "",
        `助手：${assistant}`,
      ].join("\n");
    })
    .join("\n\n");

const formatEvidenceLimitations = (limitations: string[]) => {
  if (limitations.length === 0) return "无额外限制";
  const translations: Record<string, string> = {
    "The screenshot does not preserve the runtime route or trace.":
      "原始截图没有保留运行路由或 trace。",
    "The preceding conversation is missing.":
      "缺少产生这次误解的前文。",
    "Reviewers may judge whether the standalone reply acknowledges the challenge and keeps repair open, but may not judge whether it correctly identifies the earlier misunderstanding.":
      "只能判断回复是否正面承认挑战并保持修复开放，不能判断它是否准确定位了先前的误解。",
  };
  return limitations.map((limitation) => translations[limitation] ?? limitation).join("；");
};

const orderedPairs = shuffle(
  dataset.episodes.flatMap((episode) =>
    Array.from({ length: dataset.gateContract.runsPerSide }, (_, offset) => ({
      episode,
      runIndex: offset + 1,
    }))
  )
);

const items = orderedPairs.map(({ episode, runIndex }, index) => {
  const runKey = `${episode.id}:run-${runIndex}`;
  const aRun = aRuns.get(runKey);
  const bRun = bRuns.get(runKey);
  if (!aRun || !bRun) throw new Error(`Missing run: ${runKey}`);
  const aIsX = randomInt(2) === 0;
  return {
    reviewId: `S${String(index + 1).padStart(2, "0")}`,
    episode,
    runIndex,
    X: {
      run: aIsX ? aRun : bRun,
      identity: aIsX
        ? { side: a.side, sourceId: a.sourceId }
        : { side: b.side, sourceId: b.sourceId },
    },
    Y: {
      run: aIsX ? bRun : aRun,
      identity: aIsX
        ? { side: b.side, sourceId: b.sourceId }
        : { side: a.side, sourceId: a.sourceId },
    },
  };
});

const key = {
  schemaVersion: 2,
  datasetVersion: dataset.datasetVersion,
  blindReviewPath: outputPath,
  blindReviewHtmlPath: htmlPath,
  rawArtifactCommitments: {
    A: createHash("sha256").update(readFileSync(aPath)).digest("hex"),
    B: createHash("sha256").update(readFileSync(bPath)).digest("hex"),
  },
  items: items.map((item) => ({
    reviewId: item.reviewId,
    episodeId: item.episode.id,
    runIndex: item.runIndex,
    X: item.X.identity,
    Y: item.Y.identity,
  })),
};
const keySource = `${JSON.stringify(key, null, 2)}\n`;
const keyCommitment = createHash("sha256").update(keySource).digest("hex");

const lines = [
  "# Chat Gate v0 人工盲审卷",
  "",
  "审查类型：双侧、逐组独立随机、人工语义评审",
  "",
  `密钥承诺 SHA-256：\`${keyCommitment}\``,
  "",
  "## 盲审边界",
  "",
  "- X/Y 在每一组中独立随机，不代表固定系统。",
  "- 样本顺序已随机；来源、模型、Prompt、版本、运行时间和内部 trace 均已隐藏。",
  "- 请按当前看到的对话独立判断，不猜来源，不跨样本寻找语言指纹。",
  "- 本卷比较两个已冻结运行候选，但不包含生产来源。",
  "- 数据集只有 4 个独立情境、每个重复 3 次；没有 held-out 或 non-target 样本。",
  "- 修复类样本缺少被误解的前文，只能判断是否正面承认挑战并保持修复开放。",
  "",
  "## 评分说明",
  "",
  "- `absolutePass`：只使用可见证据，回应自然，并为开放对话留下合适路径。",
  "- `appropriateConversationOutcome`：这段回复或轨迹产生了适合当前情境的结果。",
  "- `wouldContinue`：如果你是用户，你愿意继续发送一个有意义的下一轮。",
  "- `pairPreference`：只有确实更好时选择 X 或 Y；小风格差异可选 `tie`。",
  "- `clearlyWorseSide`：只有质量差距明显时填写 X/Y，否则填 `none`。",
  "- 任一 critical failure 会覆盖其他质量分。",
  "",
  "允许使用的 critical failure 代码：",
  "",
  ...dataset.gateContract.criticalFailures.map((failure) => `- \`${failure}\``),
  "",
];

for (const item of items) {
  lines.push(
    `## ${item.reviewId}`,
    "",
    `上下文限制：${formatEvidenceLimitations(item.episode.evidenceLimitations)}`,
    "",
    "### X",
    "",
    formatTrajectory(item.X.run),
    "",
    "### Y",
    "",
    formatTrajectory(item.Y.run),
    "",
    "### 你的评分",
    "",
    "- X absolutePass: yes / no",
    "- X appropriateConversationOutcome: yes / no",
    `- X wouldContinue: ${item.episode.openInteraction ? "yes / no" : "not_applicable"}`,
    "- X criticalFailures: none / code(s)",
    "- Y absolutePass: yes / no",
    "- Y appropriateConversationOutcome: yes / no",
    `- Y wouldContinue: ${item.episode.openInteraction ? "yes / no" : "not_applicable"}`,
    "- Y criticalFailures: none / code(s)",
    "- pairPreference: X / Y / tie",
    "- clearlyWorseSide: X / Y / none",
    "- reviewerNotes:",
    ""
  );
}

lines.push(
  "## 提交要求",
  "",
  "请先完成全部 12 组并冻结答案，再请求揭盲。你可以直接编辑本文件，也可以按",
  "`S01 ... S12` 的编号把同样字段回复给我。不要在评分完成前打开原始结果或密钥。",
  ""
);

const reviewSource = `${lines.join("\n").trimEnd()}\n`;
const htmlSource = buildHumanBlindReviewHtml({
  keyCommitment,
  criticalFailures: dataset.gateContract.criticalFailures,
  items: items.map((item) => ({
    reviewId: item.reviewId,
    contextLimitations: formatEvidenceLimitations(item.episode.evidenceLimitations),
    openInteraction: item.episode.openInteraction,
    X: formatTrajectory(item.X.run),
    Y: formatTrajectory(item.Y.run),
  })),
});
const reviewIds = items.map((item) => item.reviewId);
const mappedRunKeys = items.map((item) => `${item.episode.id}:run-${item.runIndex}`);
const allowedSides = new Set([a.side, b.side]);

audit("review item count is complete", items.length === dataset.gateContract.episodeRunsPerSide);
audit("review ids are unique", new Set(reviewIds).size === reviewIds.length);
audit("mapped run keys are unique", new Set(mappedRunKeys).size === mappedRunKeys.length);
audit("mapped run keys are complete", expectedRunKeys.every((key) => mappedRunKeys.includes(key)));
audit("each item maps distinct sides", items.every((item) => item.X.identity.side !== item.Y.identity.side));
audit("all mapped sides are allowed", items.every((item) => allowedSides.has(item.X.identity.side) && allowedSides.has(item.Y.identity.side)));
audit("X orientation varies across items", items.some((item) => item.X.identity.side === a.side) && items.some((item) => item.X.identity.side === b.side));
audit("A source identity is hidden", !reviewSource.includes(a.sourceId));
audit("B source identity is hidden", !reviewSource.includes(b.sourceId));
audit("provider identity is hidden", !reviewSource.includes(a.provider));
audit("model identity is hidden", !reviewSource.includes(a.model));
audit("episode identities are hidden", dataset.episodes.every((episode) => !reviewSource.includes(episode.id)));
audit("raw artifact paths are hidden", !reviewSource.includes(aPath) && !reviewSource.includes(bPath));
audit("key path is hidden", !reviewSource.includes(keyPath));
audit("HTML hides A source identity", !htmlSource.includes(a.sourceId));
audit("HTML hides B source identity", !htmlSource.includes(b.sourceId));
audit("HTML hides provider identity", !htmlSource.includes(a.provider));
audit("HTML hides model identity", !htmlSource.includes(a.model));
audit("HTML hides raw artifact paths", !htmlSource.includes(aPath) && !htmlSource.includes(bPath));
audit("HTML hides key path", !htmlSource.includes(keyPath));
audit("all X trajectories are present", items.every((item) => reviewSource.includes(formatTrajectory(item.X.run))));
audit("all Y trajectories are present", items.every((item) => reviewSource.includes(formatTrajectory(item.Y.run))));
audit(
  "all review fields are present",
  [
    "- X absolutePass: yes / no",
    "- X appropriateConversationOutcome: yes / no",
    "- X criticalFailures: none / code(s)",
    "- Y absolutePass: yes / no",
    "- Y appropriateConversationOutcome: yes / no",
    "- Y criticalFailures: none / code(s)",
    "- pairPreference: X / Y / tie",
    "- clearlyWorseSide: X / Y / none",
    "- reviewerNotes:",
  ].every((field) => reviewSource.split(field).length - 1 === items.length)
);
audit("key commitment has SHA-256 length", keyCommitment.length === 64);
audit("at least twenty audit checks ran", auditChecks.length >= 20);

mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(dirname(keyPath), { recursive: true });
mkdirSync(dirname(htmlPath), { recursive: true });
writeFileSync(outputPath, reviewSource, { encoding: "utf8", flag: "wx" });
writeFileSync(keyPath, keySource, { encoding: "utf8", flag: "wx" });
writeFileSync(htmlPath, htmlSource, { encoding: "utf8", flag: "wx" });

console.log(
  JSON.stringify(
    {
      output: outputPath,
      key: keyPath,
      html: htmlPath,
      keyCommitment,
      pairs: items.length,
      auditChecks: auditChecks.length,
    },
    null,
    2
  )
);
