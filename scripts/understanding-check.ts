import assert from "node:assert/strict";

import { inferLocalUnderstandingExtraction } from "../services/understanding/extractService";
import { getRetrievalIntent } from "../services/understanding/retrievalService";

const now = new Date("2026-07-06T03:00:00.000Z");

const leader = inferLocalUnderstandingExtraction({
  content: "今天领导没回我消息，我是不是被讨厌了。",
  messageCreatedAt: now,
});
assert.equal(leader.facts[0]?.eventText, "领导没有回复消息");
assert(leader.people.includes("领导"));
assert(leader.topics.includes("工作"));
assert(leader.topics.includes("沟通"));
assert(leader.experiences.some((item) => item.emotion?.includes("焦虑")));
assert(leader.interpretations.some((item) => item.interpretationText.includes("被讨厌")));

const motherMessages = [
  "妈妈刚才给我打电话，我挂完以后心情一下子低了。",
  "一看到妈妈的消息我就有点烦。",
  "今天又和妈妈说了几句，整个人很难受。",
].map((content) => inferLocalUnderstandingExtraction({ content, messageCreatedAt: now }));
const motherPeopleCount = motherMessages.filter((item) => item.people.includes("妈妈")).length;
const motherNegativeEmotionCount = motherMessages.filter((item) =>
  item.experiences.some((experience) => /低落|难受/.test(experience.emotion ?? ""))
).length;
const motherTexts = JSON.stringify(motherMessages);
assert.equal(motherPeopleCount, 3);
assert(motherNegativeEmotionCount >= 2);
assert(!motherTexts.includes("创伤"));

const workPressure = inferLocalUnderstandingExtraction({
  content: "这段时间工作压力一直很大。",
  messageCreatedAt: now,
});
const movementRecovery = inferLocalUnderstandingExtraction({
  content: "但最近运动后恢复明显，好像能缓过来一点。",
  messageCreatedAt: now,
});
assert(workPressure.topics.includes("工作"));
assert(movementRecovery.topics.includes("恢复"));
assert(movementRecovery.topics.includes("运动"));
assert(movementRecovery.experiences.some((item) => item.emotion?.includes("恢复")));
assert(movementRecovery.experiences.some((item) => item.behavior === "运动"));

const intent = getRetrievalIntent({
  facts: [...workPressure.facts, ...movementRecovery.facts],
  experiences: [...workPressure.experiences, ...movementRecovery.experiences],
  interpretations: [],
  people: [],
  topics: [...new Set([...workPressure.topics, ...movementRecovery.topics])],
  occurredAt: now.toISOString(),
});
assert(intent.topics.includes("工作"));
assert(intent.topics.includes("恢复"));
assert(intent.emotions.some((item) => item.includes("恢复")));

console.log("Understanding checks passed");
