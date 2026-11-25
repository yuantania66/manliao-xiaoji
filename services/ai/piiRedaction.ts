const TOKEN_ERROR = "PII_REDACTION_TOKEN_CAPACITY_EXHAUSTED";
const TOKEN_START = 0xe000;
const TOKEN_END = 0xf8ff;

type Candidate = { start: number; end: number; value: string; priority: number };

function addMatches(
  text: string,
  regex: RegExp,
  priority: number,
  output: Candidate[],
  accept: (value: string) => boolean = () => true,
) {
  for (const match of text.matchAll(regex)) {
    const value = match[1] ?? match[0];
    if (!value || !accept(value)) continue;
    const offset = match[0].indexOf(value);
    const start = (match.index ?? 0) + offset;
    output.push({ start, end: start + value.length, value, priority });
  }
}

function compactDigits(value: string) {
  return value
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
    .replace(/[\s\-－]/g, "");
}

function findExplicit(text: string) {
  const found: Candidate[] = [];
  addMatches(text, /(?:^|[^A-Za-z0-9_])([0-9０-９]{15}|[0-9０-９]{17}[0-9０-９XxＸｘ])(?![A-Za-z0-9_])/gu, 0, found, (v) => {
    const digits = compactDigits(v);
    const birth = digits.length === 15 ? `19${digits.slice(6, 12)}` : digits.slice(6, 14);
    return /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(birth);
  });
  addMatches(text, /(?:^|[^A-Za-z0-9_])([0-9０-９](?:[\s\-－]*[0-9０-９]){15,18})(?![A-Za-z0-9_])/gu, 1, found, (v) => /^\d{16,19}$/.test(compactDigits(v)));
  addMatches(text, /(?:身份证(?:号(?:码)?)?|身份证号码)\s*[：:=是]?\s*([0-9０-９][0-9０-９\s\-－]{13,22}[0-9０-９XxＸｘ])/giu, 0, found, (v) => /^(?:\d{15}|\d{17}[\dXx])$/.test(compactDigits(v)));
  addMatches(text, /(?:银行卡|银行卡号|卡号)\s*[：:=是]?\s*([0-9０-９][0-9０-９\s\-－]{14,27}[0-9０-９])/giu, 1, found, (v) => /^\d{16,19}$/.test(compactDigits(v)));
  addMatches(text, /(?:^|[^A-Za-z0-9_])((?:\+|＋)?[ \t]*(?:86|８６)?[ \t]*[1１][3-9３-９](?:[ \t\-－]*[0-9０-９]){9})(?![A-Za-z0-9_])/giu, 2, found, (v) => /^(?:\+?86)?1[3-9]\d{9}$/.test(compactDigits(v).replace(/^＋/, "+")));
  // An explicit phone label permits line-wrapped digits; unlabelled lines stay separate.
  addMatches(text, /(?:手机号?|电话号码?|联系电话)\s*[：:=是]?\s*((?:\+|＋)?\s*(?:86|８６)?\s*[1１][3-9３-９](?:[\s\-－]*[0-9０-９]){9})(?![A-Za-z0-9_])/giu, 2, found);
  addMatches(text, /(?:^|[^A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?![A-Za-z0-9._%+-])/giu, 3, found);

  addMatches(text, /(?:微信(?:号|ID)?|wechat)\s*[：:=是]?\s*([A-Za-z0-9][A-Za-z0-9_-]{4,19})/giu, 4, found);
  addMatches(text, /QQ(?:号)?\s*[：:=是]?\s*([0-9０-９]{5,12})/giu, 4, found);
  addMatches(text, /(?:密码|验证码)\s*(?:[：:=]|是)\s*([^\s，。；、,;]{1,32})/gu, 4, found);
  const safeName = (v: string) => !/(?:不想|想死|活了|自杀|伤害|难受|痛苦|求救)/u.test(v);
  addMatches(text, /(?:姓名|联系人)\s*[：:=是]?\s*([\p{Script=Han}·]{1,4}|[A-Za-z][A-Za-z .'-]{1,30})(?=$|[\s，。；、,;])/gu, 5, found, safeName);
  addMatches(text, /(?:我叫|(?:不|并不|其实不)是叫|(?:而|而是|是)叫)\s*([\p{Script=Han}·]{1,4}|[A-Za-z][A-Za-z .'-]{1,30})(?=$|[\s，。；、,;])/gu, 5, found, safeName);
  addMatches(text, /(?:地址\s*[：:=是]?\s*|住在\s*)([^\n，。；,;]{3,80}?(?:号|栋|幢|单元|室|楼)(?:[ \t]*[0-9０-９一二三四五六七八九十百A-Za-z-]+(?:号|栋|幢|单元|室|楼))*)/gu, 6, found, (v) => /(?:省|市|区|县|镇|乡|街|路|巷|弄)/u.test(v));
  return found.filter((item) => item.priority !== 1 || !/(?:哈希|hash)\s*[:=]?\s*$/iu.test(text.slice(Math.max(0, item.start - 12), item.start)));
}

function tokenFor(index: number, length: number, unavailable: (token: string) => boolean) {
  const radix = TOKEN_END - TOKEN_START + 1;
  if (length < 1 || index >= radix ** Math.min(length, 3)) throw new Error(TOKEN_ERROR);
  for (let attempt = index; attempt < radix ** Math.min(length, 3); attempt += 1) {
    let number = attempt;
    let token = "";
    for (let position = 0; position < length; position += 1) {
      token += String.fromCharCode(TOKEN_START + (number % radix));
      number = Math.floor(number / radix);
    }
    if (!unavailable(token)) return token;
  }
  throw new Error(TOKEN_ERROR);
}

// JSON-containing business strings are still source text: do not decode/re-encode
// them on the wire. Derive aliases for actual escaped spellings of already matched
// values, preserving their literal UTF-16 length and exact evidence round-trip.
function encodedSpellings(values: string[], inputs: readonly string[]): string[] {
  const known = new Set(values);
  const literals = new Map<string, string>();
  for (const input of inputs) for (const match of input.matchAll(/"(?:[^"\\]|\\[\s\S])*"/g)) {
    try { literals.set(match[0], JSON.parse(match[0]) as string); } catch { /* Not a valid JSON literal. */ }
  }
  // A nested literal's decoded content contains its child's encoded spelling.
  // Visit children first; each newly observed spelling can then be found in its parent.
  for (const [literal, decoded] of [...literals].sort((a, b) => a[1].length - b[1].length)) {
    const starts: number[] = [], ends: number[] = [];
    for (let offset = 1; offset < literal.length - 1;) {
      starts.push(offset);
      offset += literal[offset] === "\\" ? literal[offset + 1] === "u" ? 6 : 2 : 1;
      ends.push(offset);
    }
    if (starts.length !== decoded.length) throw new Error("PII_REDACTION_INVALID_JSON_MAPPING");
    for (const value of [...known]) {
      for (let offset = decoded.indexOf(value); offset >= 0; offset = decoded.indexOf(value, offset + value.length)) {
        known.add(literal.slice(starts[offset], ends[offset + value.length - 1]));
      }
    }
  }
  return [...known];
}

export function createPiiRedactor(inputs: readonly string[]) {
  const joined = inputs.join("\u0000");
  const explicit = [...new Set(inputs.flatMap(findExplicit).map((item) => item.value))];
  const values = encodedSpellings(explicit, inputs)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();
  values.forEach((value, index) => {
    const token = tokenFor(index, value.length, (candidate) => joined.includes(candidate) || reverse.has(candidate));
    forward.set(value, token);
    reverse.set(token, value);
  });

  const replace = (text: string, mapping: Map<string, string>) => {
    let result = text;
    for (const [from, to] of mapping) result = result.split(from).join(to);
    return result;
  };

  return {
    redact(text: string) {
      return replace(text, forward);
    },
    restore(text: string) {
      return replace(text, reverse);
    },
    neutralize(text: string) {
      let result = text;
      for (const token of reverse.keys()) result = result.split(token).join("[个人信息]");
      return result.replace(/[\ue000-\uf8ff]+/gu, "[个人信息]");
    },
    hasRedactions: forward.size > 0,
  };
}
