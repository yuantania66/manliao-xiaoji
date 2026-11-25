/* eslint-disable @typescript-eslint/no-require-imports -- WeChat mini-program runtime uses CommonJS. */
const art = require("../assets/visit-growth/plant-data");

const empty = () => ({ background: "none", backgroundWithoutNewestLeaf: "none", newestLeafBackground: "none", newestLeafOrigin: "50% 50%", leafCount: 0, flowerCount: 0 });
const background = (content) => content
  ? `url("data:image/svg+xml;charset=utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${art.viewBox}" fill="none">${content}</svg>`)}")`
  : "none";
const leafMarkup = (leaf, index) => `<g id="visit-leaf-${index + 1}">${leaf.svg}</g>`;

const buildPlant = (summary) => {
  if (!summary || !Number.isSafeInteger(summary.totalDays) || summary.totalDays < 0 ||
      summary.leafCount !== Math.min(summary.totalDays, 365) || !Array.isArray(summary.flowers)) return empty();
  const count = summary.leafCount;
  const flowers = summary.flowers;
  let totalFlowerDays = 0;
  for (let i = 0; i < flowers.length; i += 1) {
    const item = flowers[i];
    if (!item || typeof item.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month) || (i && item.month <= flowers[i - 1].month) ||
        !Number.isInteger(item.visitDays) || item.visitDays < 1 || !Number.isInteger(item.daysInMonth) ||
        item.daysInMonth !== new Date(Date.UTC(Number(item.month.slice(0, 4)), Number(item.month.slice(5, 7)), 0)).getUTCDate() ||
        item.visitDays > item.daysInMonth) return empty();
    totalFlowerDays += item.visitDays;
  }
  if (totalFlowerDays > summary.totalDays || (!count && flowers.length)) return empty();
  if (!count) return empty();
  const selected = art.leaves.slice(0, count);
  let stems = art.stems[count === 1 ? 0 : 1];
  if (count > 3) {
    const top = count >= 40 ? 0 : Math.max(0, Math.min(...selected.slice(3).map((leaf) => leaf.origin[1])) - 4);
    stems += `<defs><clipPath id="vine-reveal"><rect x="0" y="${top}" width="168" height="${168 - top}"/></clipPath></defs><g clip-path="url(#vine-reveal)">${art.vine}</g>`;
  }
  const shownFlowers = flowers.slice(0, 12);
  const petals = shownFlowers.length ? `<defs><g id="month-flower-art">${art.flower}</g></defs>` + shownFlowers.map((item, index) => {
    const angle = index * Math.PI / 6;
    const x = 84 + 69 * Math.sin(angle), y = 84 - 69 * Math.cos(angle);
    const size = 14 + 18 * item.visitDays / item.daysInMonth;
    return `<g id="visit-flower-${index + 1}" data-month="${item.month}" transform="translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${(size / 32).toFixed(5)}) translate(-16 -16)"><use href="#month-flower-art" xlink:href="#month-flower-art"/></g>`;
  }).join("") : "";
  const leaves = selected.map(leafMarkup);
  const hasNewLeaf = summary.totalDays <= 365;
  const newest = selected[count - 1];
  const full = stems + leaves.join("") + petals;
  return {
    background: background(full),
    backgroundWithoutNewestLeaf: hasNewLeaf ? background(stems + leaves.slice(0, -1).join("") + petals) : background(full),
    newestLeafBackground: hasNewLeaf ? background(leaves[count - 1]) : "none",
    newestLeafOrigin: `${(newest.origin[0] / 168 * 100).toFixed(3)}% ${(newest.origin[1] / 168 * 100).toFixed(3)}%`,
    leafCount: count,
    flowerCount: shownFlowers.length,
  };
};

module.exports = { buildPlant };
