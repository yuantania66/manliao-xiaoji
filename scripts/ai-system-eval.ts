import assert from "node:assert/strict";

import { inferLocalUnderstandingExtraction } from "../services/understanding/extractService";
import { retrieveProfessionalGuidance } from "../services/professional-rag/professionalRetrieval";

const now = new Date("2026-07-06T03:00:00.000Z");

const guidanceIdsFor = (content: string) => {
  const extraction = inferLocalUnderstandingExtraction({
    content,
    messageCreatedAt: now,
  });
  return retrieveProfessionalGuidance({
    extraction,
    currentMessage: content,
    limit: 4,
  }).map((item) => item.id);
};

assert(
  guidanceIdsFor("今天领导没回我消息，我是不是被讨厌了。").includes(
    "cbt-fact-interpretation-separation"
  ),
  "fact/interpretation guidance should be retrieved for evaluation-sensitive interpretations"
);

assert(
  guidanceIdsFor("1").includes("low-information-do-not-overread"),
  "low-information guidance should be retrieved for numeric micro input"
);

assert(
  guidanceIdsFor("我真的不想活了。").includes("crisis-switch-safety-mode"),
  "safety guidance should be retrieved for crisis language"
);

assert(
  guidanceIdsFor("这两天跑步以后能缓过来一点，工作还是多但没那么崩。").includes(
    "recovery-counter-evidence"
  ),
  "recovery guidance should be retrieved when coping/recovery evidence appears"
);

console.log("AI system eval passed");
