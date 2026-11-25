// Shared by the server and the packaged guest client. No network, model or storage access.
export const WALLPAPER_TEMPLATES = [
  { id: "garden-light-v1", group: "garden" },
  { id: "garden-meadow-v1", group: "garden" },
  { id: "hills-path-v1", group: "hills" },
  { id: "hills-lake-v1", group: "hills" },
  { id: "collage-flower-v1", group: "collage" },
  { id: "collage-leaf-v1", group: "collage" },
] as const;

export const WALLPAPER_COPIES = [
  { copyId: "uncertainty-v1", quote: "没想明白，也可以向前。", caption: "先做一件确定的小事，答案也会在途中出现。" },
  { copyId: "choice-v1", quote: "不是每条路，都要走到底。", caption: "转个方向，也是在认真选择。" },
  { copyId: "cloudy-v1", quote: "不必把每一天，都过成晴天。", caption: "阴天也有阴天的光，不用急着放晴。" },
  { copyId: "rest-v1", quote: "休息，不是落后。", caption: "把力气留一点给自己，路才走得长。" },
  { copyId: "joy-v1", quote: "快乐也值得被认真记住。", caption: "那些微小的好，正在给日子添光。" },
  { copyId: "relationship-v1", quote: "靠近别人，也别丢下自己。", caption: "好的相处，容得下两种声音。" },
  { copyId: "photo-v1", quote: "照片留住的，不只是风景。", caption: "还有那一刻，愿意停下来看的自己。" },
  { copyId: "ordinary-v1", quote: "平常的一天，也有分量。", caption: "那些被记住的小事，慢慢成了生活。" },
] as const;

export const GENERATED_WALLPAPER_COPY_ID = "generated-v1" as const;

const patterns = [/(不知道|为什么|想不明白|不清楚)/, /(怎么办|要不要|选择|决定)/,
  /(难过|失落|委屈|伤心|焦虑)/, /(累|忙|撑|疲|倦)/, /(开心|高兴|喜欢|顺利|满足)/, /(关系|对你|对我|我们)/];

export type WallpaperCopy = { copyId: string; quote: string; caption: string };
export type WallpaperVersion = { revision: number; templateId: string; allocationOrder: number; requestId: string | null };
export type WallpaperState = { schemaVersion: 1; copy: WallpaperCopy; versions: WallpaperVersion[] };
export type WallpaperAction = { action: "initialize" } | { action: "switch"; requestId: string; expectedRevision: number };
export class WallpaperStateError extends Error {
  constructor(public reason: "VALIDATION_ERROR" | "STATE_INVALID" | "REVISION_CONFLICT" | "SWITCH_LIMIT") {
    super(reason);
    this.name = "WallpaperStateError";
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).length === expected.length && expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
const requestIdValid = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
// Reject recognizable identifiers and request-local privacy aliases in shareable output.
// This is a conservative guard, not a claim that arbitrary prose can be anonymized.
const unsafeShareableText = (value: string) => {
  const text = value.normalize("NFKC");
  return /[\uE000-\uF8FF]/u.test(text) ||
    /https?:|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(text) ||
    /(?:\d[\s+().-]*){7}/u.test(text);
};
const warmTextValid = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" &&
  value === value.trim() &&
  value.length >= min &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/u.test(value) &&
  !/\s{2,}/u.test(value) &&
  !unsafeShareableText(value);
const curatedCopy = (value: unknown): value is WallpaperCopy => record(value) &&
  keys(value, ["copyId", "quote", "caption"]) && WALLPAPER_COPIES.some(copy =>
    copy.copyId === value.copyId && copy.quote === value.quote && copy.caption === value.caption);
export const isGeneratedWallpaperCopy = (value: unknown): value is WallpaperCopy =>
  record(value) &&
  keys(value, ["copyId", "quote", "caption"]) &&
  value.copyId === GENERATED_WALLPAPER_COPY_ID &&
  warmTextValid(value.quote, 2, 30) &&
  warmTextValid(value.caption, 2, 48) &&
  value.quote !== value.caption;
export const approvedWallpaperCopy = (value: unknown): value is WallpaperCopy =>
  curatedCopy(value) || isGeneratedWallpaperCopy(value);
const approvedCopy = approvedWallpaperCopy;

export const createGeneratedWallpaperCopy = (quote: unknown, caption: unknown): WallpaperCopy | null => {
  // Must already be strings; never String()-coerce objects/arrays into shareable text.
  if (typeof quote !== "string" || typeof caption !== "string") return null;
  const copy = {
    copyId: GENERATED_WALLPAPER_COPY_ID,
    quote: quote.replace(/\s+/g, " ").trim(),
    caption: caption.replace(/\s+/g, " ").trim(),
  };
  return isGeneratedWallpaperCopy(copy) ? copy : null;
};

/** Rejects AI copy that reprints the note body (including short verbatim phrases) into shareable text. */
export const warmCopyLeaksNoteBody = (noteContent: unknown, copy: WallpaperCopy): boolean => {
  const note = String(noteContent || "").replace(/\s+/g, " ").trim();
  if (!note) return false;
  const haystacks = [copy.quote, copy.caption];
  // Short notes (e.g. "离婚了") must not appear verbatim in shareable copy.
  if (note.length >= 2 && haystacks.some(text => text.includes(note))) return true;
  if (note.length < 6) return false;
  for (let start = 0; start <= note.length - 6; start += 1) {
    const slice = note.slice(start, start + 6);
    if (haystacks.some(text => text.includes(slice))) return true;
  }
  return false;
};

export const selectWallpaperCopy = (content: unknown, mediaCount = 0): WallpaperCopy => {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  const index = !text && mediaCount > 0 ? 6 : patterns.findIndex(pattern => pattern.test(text));
  return { ...WALLPAPER_COPIES[index < 0 ? 7 : index] };
};

// null alone means uninitialized. Unknown versions or corrupted data never reset the quota.
export const parseWallpaperState = (value: unknown): WallpaperState | null => {
  if (value === null) return null;
  const invalid = () => { throw new WallpaperStateError("STATE_INVALID"); };
  if (!record(value) || !keys(value, ["schemaVersion", "copy", "versions"]) ||
      value.schemaVersion !== 1 || !approvedCopy(value.copy) || !Array.isArray(value.versions) ||
      value.versions.length < 1 || value.versions.length > 4) return invalid();
  let previousOrder = 0;
  let previousTemplate: unknown;
  const requests = new Set<string>();
  const versions: WallpaperVersion[] = Array.from(value.versions).map((version: unknown, revision: number) => {
    if (!record(version) || !keys(version, ["revision", "templateId", "allocationOrder", "requestId"]) ||
        version.revision !== revision || version.templateId === previousTemplate || !WALLPAPER_TEMPLATES.some(template => template.id === version.templateId) ||
        typeof version.allocationOrder !== "number" || !Number.isSafeInteger(version.allocationOrder) ||
        version.allocationOrder <= previousOrder ||
        (revision === 0 ? version.requestId !== null : !requestIdValid(version.requestId))) return invalid();
    if (typeof version.requestId === "string") {
      if (requests.has(version.requestId)) return invalid();
      requests.add(version.requestId);
    }
    previousOrder = version.allocationOrder;
    previousTemplate = version.templateId;
    return { revision, templateId: String(version.templateId), allocationOrder: version.allocationOrder, requestId: version.requestId as string | null };
  });
  return { schemaVersion: 1, copy: { ...value.copy }, versions };
};

export const parseWallpaperAction = (value: unknown): WallpaperAction => {
  if (record(value)) {
    if (value.action === "initialize" && keys(value, ["action"])) return { action: "initialize" };
    if (value.action === "switch" && keys(value, ["action", "requestId", "expectedRevision"]) &&
        requestIdValid(value.requestId) && typeof value.expectedRevision === "number" &&
        Number.isInteger(value.expectedRevision) && value.expectedRevision >= 0 && value.expectedRevision <= 3) {
      return { action: "switch", requestId: value.requestId, expectedRevision: value.expectedRevision };
    }
  }
  throw new WallpaperStateError("VALIDATION_ERROR");
};

export const getWallpaperView = (state: WallpaperState | null) => {
  if (!state) return null;
  const current = state.versions[state.versions.length - 1];
  return { schemaVersion: state.schemaVersion, copy: { ...state.copy }, templateId: current.templateId,
    revision: current.revision, switchesRemaining: 3 - current.revision };
};

export const applyWallpaperAction = (
  state: WallpaperState | null,
  action: WallpaperAction,
  history: WallpaperState[],
  initialCopy?: WallpaperCopy,
): { state: WallpaperState; appliedRevision?: number; replayed?: boolean } => {
  // Validate again at the shared transition boundary, including the guest storage path.
  state = parseWallpaperState(state);
  action = parseWallpaperAction(action);
  if (action.action === "initialize" && state) return { state, replayed: true };
  const current = state?.versions[state.versions.length - 1];
  if (action.action === "switch") {
    const requestId = action.requestId;
    const replay = state?.versions.find(version => version.requestId === requestId);
    if (replay) {
      if (action.expectedRevision !== replay.revision - 1) throw new WallpaperStateError("REVISION_CONFLICT");
      return { state: state!, appliedRevision: replay.revision, replayed: true };
    }
    if (!current || action.expectedRevision !== current.revision) throw new WallpaperStateError("REVISION_CONFLICT");
    if (current.revision >= 3) throw new WallpaperStateError("SWITCH_LIMIT");
  }
  const copy = state?.copy ?? initialCopy;
  if (!approvedCopy(copy)) throw new WallpaperStateError("STATE_INVALID");
  const lastUsed = new Map<string, number>();
  const allocations = new Map<number, string>();
  // Include the current note even if the caller's history excludes it.
  for (const item of [...history, ...(state ? [state] : [])]) {
    const parsed = parseWallpaperState(item);
    if (!parsed) throw new WallpaperStateError("STATE_INVALID");
    for (const version of parsed.versions) {
      if (allocations.has(version.allocationOrder) && allocations.get(version.allocationOrder) !== version.templateId) {
        throw new WallpaperStateError("STATE_INVALID");
      }
      allocations.set(version.allocationOrder, version.templateId);
      lastUsed.set(version.templateId, Math.max(lastUsed.get(version.templateId) ?? 0, version.allocationOrder));
    }
  }
  let lastOrder = 0;
  let lastTemplateId: string | undefined;
  for (const [templateId, order] of lastUsed) {
    if (order > lastOrder) { lastOrder = order; lastTemplateId = templateId; }
  }
  if (!Number.isSafeInteger(lastOrder + 1)) throw new WallpaperStateError("STATE_INVALID");
  const lastGroup = WALLPAPER_TEMPLATES.find(template => template.id === lastTemplateId)?.group;
  const candidates = WALLPAPER_TEMPLATES.filter(template => template.id !== lastTemplateId && template.id !== current?.templateId);
  candidates.sort((a, b) => (lastUsed.get(a.id) ?? 0) - (lastUsed.get(b.id) ?? 0) ||
    Number(a.group === lastGroup) - Number(b.group === lastGroup) ||
    WALLPAPER_TEMPLATES.findIndex(template => template.id === a.id) - WALLPAPER_TEMPLATES.findIndex(template => template.id === b.id));
  const version = { revision: state ? state.versions.length : 0, templateId: candidates[0].id,
    allocationOrder: lastOrder + 1, requestId: action.action === "switch" ? action.requestId : null };
  return { state: { schemaVersion: 1, copy: { ...copy }, versions: [...(state?.versions ?? []), version] },
    appliedRevision: version.revision, replayed: false };
};
