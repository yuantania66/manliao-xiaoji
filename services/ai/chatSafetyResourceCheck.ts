export type UnverifiedSafetyResource = "phone" | "link";

const digit = "[\\p{Decimal_Number}〇零一二两三四五六七八九幺壹贰叁肆伍陆柒捌玖]";
const number = new RegExp(digit + "(?:[\\s().·\\p{Dash_Punctuation}]{0,3}" + digit + ")+", "gu");
const contactBefore = /(?:拨(?:打|通|号)?|呼叫|致电|打(?:给)?|联系|发(?:送)?短信|报警|急救|消防|救援|电话|热线|号码|专线|短号|\b(?:call|dial|text|hotline|phone(?: number)?|emergency (?:number|services)))\s*(?:是|为|到|至|拨打|is|at)?[\s:=+("'“‘【\[]*$/iu;
const contactAfter = /^[\s)"'”’]*(?:\(\s*)?(?:报警|急救|消防|救援|(?:紧急|求助|报警|急救)?热线|(?:紧急|报警|急救)电话|\bemergency\b|\bhotline\b)/iu;
const quantityAfter = /^\s*(?:个|位|人|条|次|秒|分钟|小时|天|周|年|点|公里|米|元|%|\b(?:people|times|seconds|minutes|hours|days)\b)/iu;
const clockPrefix = /(?:^|\D)(?:[01]?\d|2[0-3]):(?:[0-5]\d:)?$/u;
const clockComponent = /^[0-5]\d$/u;
const resourceLink = /\b(?:https?|ftp):\s*\/\s*\/|\b(?:tel|sms|mailto):|\]\s*\(|(?<![a-z0-9@-])[a-z0-9][a-z0-9-]*(?:[.。][a-z0-9][a-z0-9-]*)*[.。][a-z]{2,}(?![a-z0-9-])/iu;

// The supervised path has no trusted resource catalog. Generated contact
// details in these forms must be replaced with generic local support.
export const findUnverifiedSafetyResource = (reply: string): UnverifiedSafetyResource | null => {
  const text = reply.normalize("NFKC").replace(/[\p{Cf}\uFE00-\uFE0F]/gu, "");
  if (resourceLink.test(text)) return "link";

  const unformatted = text.replace(/[*~_\x60]/gu, "");
  for (const match of unformatted.matchAll(number)) {
    const before = unformatted.slice(Math.max(0, match.index - 48), match.index);
    const end = match.index + match[0].length;
    const after = unformatted.slice(end, end + 24);
    if (contactBefore.test(before) && !quantityAfter.test(after)) return "phone";
    if (contactAfter.test(after) && !(clockPrefix.test(before) && clockComponent.test(match[0]))) return "phone";
  }
  return null;
};
