// Ephemeral numbers only. No persistence, identifiers, content, logging or transport.
const create = () => {
  let clock = () => Date.now();
  let startedAt;
  try {
    const p = wx.getPerformance && wx.getPerformance();
    if (p && typeof p.now === "function") {
      const first = p.now();
      if (Number.isFinite(first)) { clock = () => p.now(); startedAt = first; }
    }
  } catch (_) {}
  if (startedAt === undefined) startedAt = clock();
  const timing = { startedAt, responseMs: null, firstRenderedMs: null, fullRenderedMs: null };
  // Fix the clock/origin for this sample. Never fall back midway through a turn.
  Object.defineProperty(timing, "clock", { value: clock });
  return timing;
};
const mark = (timing, stage, at) => {
  if (!timing || !["responseMs", "firstRenderedMs", "fullRenderedMs"].includes(stage) || timing[stage] !== null) return;
  if (at === undefined) { try { at = timing.clock(); } catch (_) { return; } }
  const elapsed = at - timing.startedAt;
  const prior = Math.max(0, timing.responseMs || 0, timing.firstRenderedMs || 0, timing.fullRenderedMs || 0);
  const rounded = Math.round(elapsed);
  if (!Number.isFinite(elapsed) || elapsed < 0 || rounded < prior) return;
  timing[stage] = rounded;
  return true;
};
const label = timing => timing ? [
  timing.responseMs === null ? "等待回包" : `回包 ${timing.responseMs}ms`,
  timing.firstRenderedMs === null ? "首段待显示" : `首段渲染 ${timing.firstRenderedMs}ms`,
  timing.fullRenderedMs === null ? "全文待完成" : `全文渲染 ${timing.fullRenderedMs}ms`
].join(" · ") : "";
module.exports = { create, mark, label };
