import { reportFindingMask, reportFindingBounds, reportTraceSpans } from './report-review-ui.mjs';

export const EDGE_STRIP = Object.freeze({ widthPx: 50, widthMm: 2.5, pixelsPerMm: 20, width: 1270, height: 1778, perimeter: 6096 });
const { width: W, height: H, perimeter: P, widthPx: B } = EDGE_STRIP;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const full = { x: 675, y: 929, size: 1950 };
export function edgeRoute(progress) {
  let d = clamp(progress) * P;
  if (d <= W) return { x: 40 + d, y: 40, label: 'Top edge', edge: 0 };
  d -= W; if (d <= H) return { x: 40 + W, y: 40 + d, label: 'Right edge', edge: 1 };
  d -= H; if (d <= W) return { x: 40 + W - d, y: 40 + H, label: 'Bottom edge', edge: 2 };
  return { x: 40, y: 40 + H - (d - W), label: 'Left edge', edge: 3 };
}
export function edgeVisitedRects(progress) {
  let d = clamp(progress) * P; const result = [];
  let n = Math.min(W, d); if (n > 0) result.push({ x: 40, y: 40, width: n, height: B });
  d -= W; n = Math.min(H, d); if (n > 0) result.push({ x: 40 + W - B, y: 40, width: B, height: n });
  d -= H; n = Math.min(W, d); if (n > 0) result.push({ x: 40 + W - n, y: 40 + H - B, width: n, height: B });
  d -= W; n = Math.min(H, d); if (n > 0) result.push({ x: 40, y: 40 + H - n, width: B, height: n });
  return result;
}
export const edgeRectPath = r => `M${r.x} ${r.y}h${r.width}v${r.height}h-${r.width}Z`;
/** Membership requires real saved pixels intersecting the strip. Scoring zones
 * are neither read nor reassigned. Every finding keeps its complete saved mask. */
export function edgeContact(finding) {
  if (!['ACCEPTED', 'CORRECTED'].includes(finding.reviewResult)) return null;
  const mask = reportFindingMask(finding); if (!mask) return null;
  const ranges = [[], [], [], []];
  for (const { x, y, width } of reportTraceSpans(mask)) {
    const end = x + width;
    if (y < B) ranges[0].push([x, end]);
    if (end > W - B) ranges[1].push([W + y, W + y + 1]);
    if (y >= H - B) ranges[2].push([W + H + W - end, W + H + W - x]);
    if (x < B) ranges[3].push([P - y - 1, P - y]);
  }
  return ranges.filter(r => r.length).map(r => ({ finding, start: Math.min(...r.map(v => v[0])) / P, end: Math.max(...r.map(v => v[1])) / P })).sort((a, b) => a.start - b.start)[0] ?? null;
}
export function createEdgeTour(findings) {
  const hits = findings.map(edgeContact).filter(Boolean).sort((a, b) => a.start - b.start), segments = [];
  let time = 0, previous = 0;
  const pose = p => ({ ...edgeRoute(p), size: 430 });
  const add = (seconds, kind, a, b, rest = {}) => { if (seconds <= 0) return; segments.push({ start: time, end: time + seconds, kind, a, b, ...rest }); time += seconds; };
  add(3, 'approach', full, pose(0), { route: 0 });
  for (const hit of hits) {
    const start = Math.max(previous, hit.start), end = Math.max(start, hit.end), at = pose(end), box = reportFindingBounds(hit.finding);
    const close = { x: 40 + (box.x + box.width / 2) * W, y: 40 + (box.y + box.height / 2) * H, size: Math.max(180, Math.max(box.width * W, box.height * H) * 1.8 + 80) };
    add((start - previous) * 36, 'travel', pose(previous), pose(start), { pa: previous, pb: start });
    add(.6, 'scan', pose(start), at, { pa: start, pb: end, finding: hit.finding });
    add(1, 'focus', at, close, { route: end, finding: hit.finding });
    add(3.5, 'inspect', close, close, { route: end, finding: hit.finding });
    add(.8, 'retreat', close, at, { route: end, finding: hit.finding }); previous = end;
  }
  add((1 - previous) * 36, 'travel', pose(previous), pose(1), { pa: previous, pb: 1 });
  add(2.5, 'return', pose(1), full, { route: 1 });
  return { hits, segments, duration: time };
}
export function sampleEdgeTour(plan, progress) {
  const time = clamp(progress) * plan.duration, segment = plan.segments.find(s => time >= s.start && time < s.end) ?? plan.segments.at(-1);
  const u = clamp((time - segment.start) / (segment.end - segment.start)), q = u * u * (3 - 2 * u), mix = (a, b) => a + (b - a) * q;
  const moving = ['travel', 'scan'].includes(segment.kind), route = moving ? segment.pa + (segment.pb - segment.pa) * u : segment.route;
  const point = moving ? edgeRoute(route) : { x: mix(segment.a.x, segment.b.x), y: mix(segment.a.y, segment.b.y) };
  return { ...point, size: mix(segment.a.size, segment.b.size), route, time, kind: segment.kind, finding: segment.finding, label: edgeRoute(route).label, key: segment.kind + ':' + segment.start };
}
/** Clamp the camera to actual saved image bounds. Edge padding is preserved;
 * empty synthetic canvas outside the photograph is never introduced. */
export function edgeCamera(sample, width, height) {
  const w = Math.min(1350, sample.size * width / Math.max(width, height)), h = Math.min(1858, sample.size * height / Math.max(width, height));
  return { x: clamp(sample.x - w / 2, 0, 1350 - w), y: clamp(sample.y - h / 2, 0, 1858 - h), width: w, height: h };
}
/** SVG's default xMidYMid meet transform, including image-bound letterboxing. */
export function edgeCameraFrame(camera, width, height) {
  const scale = Math.min(width / camera.width, height / camera.height);
  return { scale, offsetX: (width - camera.width * scale) / 2, offsetY: (height - camera.height * scale) / 2 };
}
