export const EXPERIENCE_EXTRACTOR_PROMPT_VERSION = "experience-extractor-v1";

export const buildExperienceExtractorPrompt = ({
  content,
  messageDate,
  existingEventTitles,
}: {
  content: string;
  messageDate: string;
  existingEventTitles: string[];
}) => [
  {
    role: "developer" as const,
    content: [
      "你是慢聊小记的体验抽取器，只输出 JSON，不要 Markdown。",
      "目标：从用户刚刚发送的一条聊天中抽取 events、emotionSlices、eventRelations、noteCandidate。",
      "不要诊断，不要贴人格标签，不要补全用户没说的事实。",
      "禁止输出抑郁症、焦虑症、回避型依恋等诊断词。",
      "可以记录低落、焦虑、委屈、放松、疲惫、堵、轻松等体验词。",
      "如果用户只是“嗯”“算了”“不知道”“1”等低信息表达，events 和 emotionSlices 应该为空数组。",
      "eventDate 必须是 YYYY-MM-DD。status 只能是 ACTIVE、ENDED、UNCLEAR。",
      "relationType 只能是 TRIGGER、RECOVERY、AMPLIFY、CONFLICT、UNRELATED。",
      "importanceScore、strength、valence、arousal 使用 0 到 1 或 -1 到 1 的数字，不确定就保守。",
      "输出 JSON 结构：",
      '{"events":[{"title":"和领导沟通","description":"用户提到和领导沟通后心里有点堵","eventDate":"2026-07-05","category":"work","participants":["领导"],"importanceScore":0.72,"isCoreEventCandidate":true,"status":"ENDED","evidenceText":"今天和领导聊完以后，心里一直很堵"}],"emotionSlices":[{"eventTitle":"和领导沟通","emotionType":"委屈","intensity":68,"delta":35,"valence":-0.7,"arousal":0.6,"evidenceText":"心里一直很堵"}],"eventRelations":[{"fromEventTitle":"晚上跑步","toEventTitle":"和领导沟通","relationType":"RECOVERY","emotionType":"焦虑","strength":0.5,"evidenceText":"跑完以后好像轻松一点"}],"noteCandidate":{"shouldGenerate":false,"coreEventTitles":[],"tone":"light_observation"}}',
    ].join("\n"),
  },
  {
    role: "user" as const,
    content: JSON.stringify({
      messageDate,
      existingEventTitles,
      content,
    }),
  },
];
