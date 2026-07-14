import { randomInt } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { callModel, getAiProvider, getDefaultAiModel, isAiProviderConfigured } from "../../services/ai/modelProvider";
import { H1_EVAL_CASES } from "./cases";
import {
  H1_GENERATION_STATUS_PATH,
  H1_ROUND_ONE_MANIFEST,
  H1_ROUND_TWO_MANIFEST,
  H1_SELECTIONS_PATH,
  isRoundComplete,
  readManifest,
  readSelections,
  writeGenerationStatus,
  writeManifest,
} from "./storage";
import type {
  H1Candidate,
  H1CandidateCase,
  H1CandidateManifest,
  H1EvalCase,
  H1Group,
} from "./types";

type ActionSpec = { id: string; instruction: string };

const ACTIONS: Record<H1Group, ActionSpec[]> = {
  S1: [
    { id: "sending-behavior-question", instruction: "直接针对用户当前发送这个 token、词或符号的行为询问用途，不解释它代表什么。" },
    { id: "concise-clarification", instruction: "做一句简短自然的澄清，让用户说明此刻希望 AI 如何理解或处理该输入。" },
    { id: "lightweight-open-response", instruction: "给出轻量、自然、非治疗化的回应；不强迫展开，也不要用通用放行结束。" },
    { id: "options-without-assumption", instruction: "允许用户确认这是手滑、测试、选择或其它用途，但必须明确保持开放，不能把任何选项写成事实。" },
  ],
  S2: [
    { id: "respond-explicit-state", instruction: "只回应用户已经明确说出的状态，不补原因、故事、程度或诊断。" },
    { id: "open-question", instruction: "提出一个开放但不空泛的问题，问题必须直接扎在用户已经说出的内容上。" },
    { id: "concrete-clarification", instruction: "提出一个具体澄清问题，但不要把未经支持的解释包装成问题。" },
    { id: "reflection-plus-question", instruction: "先做一句有内容的简短反映，再接一个自然追问；避免复述原句。" },
  ],
  S3: [
    { id: "select-salient-point", instruction: "选择用户话里真正重要的一个明确点回应，不把整句换词重说。" },
    { id: "preserve-tension", instruction: "保留用户原话中明确存在的矛盾或张力，不添加新的心理状态。" },
    { id: "question-not-paraphrase", instruction: "用一个基于现有事实的问题推进对话，而不是复述。" },
    { id: "value-added-reflection", instruction: "形成有价值的反映：选择、组织或连接用户已说出的信息，但不增加事实。" },
  ],
  S4: [
    { id: "preserve-layers", instruction: "同时保留叙述中的多个明确层次，不压成单一通用结论。" },
    { id: "specific-focus-question", instruction: "从用户明确说出的多个层次中提出具体聚焦问题，不替用户决定重点。" },
    { id: "specific-tension", instruction: "反映文本中明确存在的具体张力，避免使用‘拉扯、耗人、卡住’等万能结论代替内容。" },
    { id: "structured-reflection", instruction: "简短组织多个已知事实，让用户能辨认自己的具体经历；不诊断、不建议。" },
  ],
};

const ROUND_TWO_ACTIONS: ActionSpec[] = [
  { id: "round2-direct", instruction: "换一种更直接、更具体的回应动作，避开上一轮被拒绝的表达路径。" },
  { id: "round2-minimal", instruction: "尝试更短但仍真实参与对话的表达，不靠模板化确认或通用出口。" },
  { id: "round2-contrast", instruction: "尝试与上一轮句式明显不同的回应；可以提问也可以不提问，但必须处理当前输入。" },
];

const HARD_BOUNDARIES = [
  "不编造用户未说的事实、原因、关系、经历或心理状态。",
  "不诊断，不治疗化，不给治疗方案。",
  "不能把‘我听到了、我看到了、我接住了、我在这里、先放在这里’作为主要内容。",
  "不能只是换词复述用户原话。",
  "不能用‘你可以继续’作为通用结尾。",
  "不能因为输入短就默认背后有故事、创伤或隐藏意义。",
  "可以提问，但不得把未经支持的猜测包装成问题。",
  "不要求每条都提问，不机械套用统一句式。",
];

const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  [/我(?:听到|听见)了?|听到你说/, "self-referential reception"],
  [/我看到(?:了|你|这个|这条)?/, "self-referential reception"],
  [/我接住(?:了|这个)?/, "self-referential reception"],
  [/我在这里/, "self-referential presence"],
  [/先放在这里/, "conversation closure"],
  [/你可以继续[。！!？?]?$/, "generic continuation"],
  [/抑郁症|焦虑症|人格障碍|创伤后应激|诊断|治疗方案|治疗计划|疗程|处方|药物治疗/, "diagnosis or treatment"],
];

const normalize = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();

export const detectHardViolations = (reply: string, userInput: string, existing: string[] = []) => {
  const violations = BLOCKED_PATTERNS.filter(([pattern]) => pattern.test(reply)).map(([, label]) => label);
  const normalizedReply = normalize(reply);
  const normalizedInput = normalize(userInput);

  if (!normalizedReply) violations.push("empty reply");
  if (reply.length > 220) violations.push("reply too long");
  if (normalizedInput && normalizedReply === normalizedInput) violations.push("literal repetition");
  if (existing.some((value) => normalize(value) === normalizedReply)) violations.push("duplicate candidate");
  return [...new Set(violations)];
};

const cleanModelReply = (value: string) =>
  value
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^(?:候选回复|回复|答案)\s*[：:]\s*/i, "")
    .trim();

const getModel = () =>
  process.env.AI_REWRITE_MODEL?.trim() || process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel();

const buildPrompt = ({
  item,
  action,
  rejectedReasons,
  rejectedReplies,
}: {
  item: H1EvalCase;
  action: ActionSpec;
  rejectedReasons?: string[];
  rejectedReplies?: string[];
}) => [
  "你在参加一个中文 AI 回复体验盲测。请只生成一条可以直接发给用户的候选回复。",
  "",
  `用户输入：${item.userInput}`,
  `必要上下文：${item.necessaryContext}`,
  `本条探索动作：${action.instruction}`,
  rejectedReasons?.length ? `上一轮拒绝原因标签：${rejectedReasons.join("、")}` : "",
  rejectedReplies?.length ? `不要重复或轻微改写这些已拒绝表达：\n${rejectedReplies.map((reply) => `- ${reply}`).join("\n")}` : "",
  "",
  "硬边界：",
  ...HARD_BOUNDARIES.map((boundary) => `- ${boundary}`),
  "",
  "只输出候选回复正文，不解释思路，不写动作名称，不加引号或编号。",
].filter(Boolean).join("\n");

const generateOne = async ({
  item,
  action,
  existing,
  rejectedReasons,
  rejectedReplies,
}: {
  item: H1EvalCase;
  action: ActionSpec;
  existing: string[];
  rejectedReasons?: string[];
  rejectedReplies?: string[];
}): Promise<Omit<H1Candidate, "label">> => {
  let lastViolations: string[] = [];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await callModel({
      model: getModel(),
      temperature: 0.85,
      messages: [
        { role: "developer", content: "这是 eval-only 候选生成。严格遵守边界，只输出一条匿名候选回复。" },
        {
          role: "user",
          content: [
            buildPrompt({ item, action, rejectedReasons, rejectedReplies }),
            lastViolations.length ? `\n上一稿触发明显违规：${lastViolations.join("、")}。请重新生成。` : "",
          ].join(""),
        },
      ],
    });

    if (response.model.startsWith("mock:")) {
      throw new Error("H1 candidate eval requires a real model; mock output was returned.");
    }

    const text = cleanModelReply(response.text);
    lastViolations = detectHardViolations(text, item.userInput, existing);
    if (!lastViolations.length) {
      return { text, origin: "generated", action: action.id, model: response.model };
    }
  }

  throw new Error(`Case ${item.id} action ${action.id} failed hard filters: ${lastViolations.join(", ")}`);
};

const shuffled = <T>(values: T[]) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
};

const labelCandidates = (candidates: Array<Omit<H1Candidate, "label">>): H1Candidate[] =>
  shuffled(candidates).map((candidate, index) => ({ ...candidate, label: String.fromCharCode(65 + index) }));

const runWithConcurrency = async <T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
) => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(values[currentIndex], currentIndex);
    }
  });
  await Promise.all(runners);
  return results;
};

export const renderCandidateMarkdown = (manifest: H1CandidateManifest) => {
  const lines = [
    `# H1 Response Candidates — Round ${manifest.round}`,
    "",
    "本文件用于 Decision Owner 盲选。候选已匿名随机排序，不显示 baseline、生成动作、Prompt 或模型偏好。",
    "",
  ];

  for (const item of manifest.cases) {
    lines.push(
      `## Case ${item.id}`,
      "",
      "用户：",
      item.userInput,
      "",
      "必要上下文：",
      item.necessaryContext,
      ""
    );
    for (const candidate of item.candidates) {
      lines.push(`候选 ${candidate.label}：`, candidate.text, "");
    }
    lines.push(
      "Decision Owner：",
      `- 最优：${item.candidates.map((candidate) => candidate.label).join(" / ")} / 全部不行`,
      "- 次优：可选",
      "- 不可接受：可多选",
      "- 简短原因：可选",
      "- 是否愿意继续聊：是 / 否",
      ""
    );
  }
  return `${lines.join("\n")}\n`;
};

const writeVisibleReport = (manifest: H1CandidateManifest) => {
  const path = manifest.round === 1
    ? join(process.cwd(), "docs/evals/h1-response-candidates-latest.md")
    : join(process.cwd(), "docs/evals/h1-response-candidates-round2.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderCandidateMarkdown(manifest));
  return path;
};

const getRoundTwoCases = () => {
  const roundOne = readManifest(1);
  if (!roundOne) throw new Error("Round 1 manifest is missing.");
  const rejectedIds = new Set(
    readSelections().selections
      .filter((selection) => selection.round === 1 && selection.best === "all_unacceptable")
      .map((selection) => selection.caseId)
  );
  return H1_EVAL_CASES.filter((item) => rejectedIds.has(item.id));
};

export const generateH1CandidateRound = async ({
  round,
  concurrency = 4,
}: {
  round: 1 | 2;
  concurrency?: number;
}) => {
  if (!isAiProviderConfigured() || getAiProvider() === "mock") {
    throw new Error("A configured real AI provider is required. Mock candidates are not allowed.");
  }

  if (round === 1) {
    [
      H1_ROUND_ONE_MANIFEST,
      H1_ROUND_TWO_MANIFEST,
      H1_SELECTIONS_PATH,
      H1_GENERATION_STATUS_PATH,
      join(process.cwd(), "docs/evals/h1-response-candidates-round2.md"),
      join(process.cwd(), "docs/evals/h1-response-selection-results.md"),
    ].forEach((path) => rmSync(path, { force: true }));
  } else if (!isRoundComplete(1)) {
    throw new Error("Round 2 requires complete Round 1 selections.");
  }

  writeGenerationStatus({ status: "running", message: `Generating round ${round}`, updatedAt: new Date().toISOString() });

  try {
    const sourceCases = round === 1 ? H1_EVAL_CASES : getRoundTwoCases();
    const roundOne = round === 2 ? readManifest(1) : null;
    const roundOneSelections = round === 2 ? readSelections().selections : [];

    const cases = await runWithConcurrency(sourceCases, concurrency, async (item): Promise<H1CandidateCase> => {
      const actions = round === 1 ? ACTIONS[item.group] : ROUND_TWO_ACTIONS;
      const existing: string[] = [];
      const selection = roundOneSelections.find((entry) => entry.round === 1 && entry.caseId === item.id);
      const rejectedReplies = roundOne?.cases.find((entry) => entry.id === item.id)?.candidates.map((entry) => entry.text);
      const generated: Array<Omit<H1Candidate, "label">> = [];

      for (const action of actions) {
        const candidate = await generateOne({
          item,
          action,
          existing,
          rejectedReasons: selection?.reasonTags,
          rejectedReplies,
        });
        generated.push(candidate);
        existing.push(candidate.text);
      }

      if (round === 1) {
        generated.push({ text: item.baselineReply, origin: "baseline", action: "baseline", model: "baseline" });
      }

      return {
        id: item.id,
        group: item.group,
        cohort: item.cohort,
        userInput: item.userInput,
        necessaryContext: item.necessaryContext,
        candidates: labelCandidates(generated),
      };
    });

    const manifest: H1CandidateManifest = {
      version: 1,
      round,
      generatedAt: new Date().toISOString(),
      model: getModel(),
      cases,
    };
    writeManifest(manifest);
    const outputPath = writeVisibleReport(manifest);
    writeGenerationStatus({ status: "idle", message: null, updatedAt: new Date().toISOString() });
    return { manifest, outputPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeGenerationStatus({ status: "failed", message, updatedAt: new Date().toISOString() });
    throw error;
  }
};
