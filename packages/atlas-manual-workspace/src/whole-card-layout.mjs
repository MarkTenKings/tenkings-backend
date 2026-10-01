import { CARD_SIZE, INSPECTION_SIZE } from './inspection-viewport.mjs';
import { reportFindingEntries, reportFindingMask, reportTraceSpans } from './report-review-ui.mjs';

// This is the versioned grading frame, not a particular card's photograph.
export const WHOLE_FRAME = Object.freeze({ ...INSPECTION_SIZE, cardWidth: CARD_SIZE.width, cardHeight: CARD_SIZE.height });
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const cache = new WeakMap();

/** Exterior edges of saved pixel cells. Never stroke the internal row joins. */
export function exactPixelPerimeter(spans) {
  const rows = new Map();
  for (const { x, y, width } of spans) { if (!rows.has(y)) rows.set(y, []); rows.get(y).push([x, x + width]); }
  for (const [y, intervals] of rows) {
    const merged = [];
    for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
      const last = merged.at(-1);
      if (last && start <= last[1]) last[1] = Math.max(last[1], end); else merged.push([start, end]);
    }
    rows.set(y, merged);
  }
  const exposed = (start, end, neighbors = []) => {
    const parts = []; let cursor = start;
    for (const [a, b] of neighbors) { if (b <= cursor) continue; if (a >= end) break; if (a > cursor) parts.push([cursor, Math.min(a, end)]); cursor = Math.max(cursor, b); if (cursor >= end) break; }
    if (cursor < end) parts.push([cursor, end]); return parts;
  };
  const edges = [];
  for (const [y, intervals] of rows) for (const [a, b] of intervals) {
    edges.push(`M${a} ${y}v1M${b} ${y}v1`);
    for (const [start, end] of exposed(a, b, rows.get(y - 1))) edges.push(`M${start} ${y}H${end}`);
    for (const [start, end] of exposed(a, b, rows.get(y + 1))) edges.push(`M${start} ${y + 1}H${end}`);
  }
  return edges.join('');
}

/** One independent shape per included saved finding, including disconnected cells. */
export function wholeCardShapes(findings, side) {
  return reportFindingEntries(findings).filter(entry => entry.finding.side === side).map(entry => {
    const mask = reportFindingMask(entry.finding);
    if (!mask || mask.width !== CARD_SIZE.width || mask.height !== CARD_SIZE.height) return { ...entry, path: '', anchor: null, bounds: null };
    let shape = cache.get(mask);
    if (!shape) {
      const spans = reportTraceSpans(mask);
      let longest = null, x = Infinity, y = Infinity, right = 0, bottom = 0;
      for (const span of spans) {
        if (!longest || span.width > longest.width) longest = span;
        x = Math.min(x, span.x); y = Math.min(y, span.y); right = Math.max(right, span.x + span.width); bottom = Math.max(bottom, span.y + 1);
      }
      const bounds = longest ? { x, y, width: right - x, height: bottom - y } : null;
      shape = { path: spans.map(s => `M${s.x} ${s.y}h${s.width}v1h-${s.width}Z`).join(''), perimeter: exactPixelPerimeter(spans), bounds,
        anchor: longest ? { x: INSPECTION_SIZE.padding + longest.x + longest.width / 2, y: INSPECTION_SIZE.padding + longest.y + .5 } : null,
        scale: bounds ? Math.max(1.08, Math.min(10, CARD_SIZE.width * .15 / Math.max(1, bounds.width), CARD_SIZE.height * .15 / Math.max(1, bounds.height))) : 1 };
      cache.set(mask, shape);
    }
    return { ...entry, ...shape };
  });
}

export function calloutFrame(side, compact = false, frame = WHOLE_FRAME) {
  const scale = frame.width / INSPECTION_SIZE.width;
  return compact ? { x: -25 * scale, y: -100 * scale, width: frame.width + 50 * scale, height: frame.height + 202 * scale }
    : { x: (side === 'FRONT' ? -650 : -220) * scale, y: -130 * scale, width: frame.width + 870 * scale, height: frame.height + 322 * scale };
}
export const calloutViewBox = (side, compact = false) => { const v = calloutFrame(side, compact); return `${v.x} ${v.y} ${v.width} ${v.height}`; };

export function findingCalloutLayout(shapes, side, width = 660) {
  const frame = calloutFrame(side), sourcePerCssPixel = frame.width / Math.max(1, width);
  const gap = Math.max(WHOLE_FRAME.cardHeight * .1687, 96 * sourcePerCssPixel);
  const top = WHOLE_FRAME.height * .0915, bottom = WHOLE_FRAME.height * .926;
  const sorted = shapes.filter(shape => shape.anchor).sort((a, b) => a.anchor.y - b.anchor.y);
  const flowing = sorted.length !== shapes.length || sorted.length > 1 && (sorted.length - 1) * gap > bottom - top;
  const positions = new Map(), left = side === 'FRONT', railWidth = WHOLE_FRAME.width * 400 / 1350;
  sorted.forEach((item, index) => {
    const low = top + index * gap, high = bottom - (sorted.length - index - 1) * gap;
    const previous = index ? positions.get(sorted[index - 1].finding.id).y + gap : low;
    const y = flowing ? item.anchor.y : clamp(Math.max(item.anchor.y, previous), low, high);
    const x = left ? frame.x + 30 : WHOLE_FRAME.width + 220;
    const endX = left ? x + railWidth : x, elbowX = left ? -175 : WHOLE_FRAME.width + 175;
    positions.set(item.finding.id, { x, y, width: railWidth, path: `M${item.anchor.x} ${item.anchor.y}H${elbowX}L${endX} ${y}` });
  });
  return { items: shapes, positions, flowing };
}
