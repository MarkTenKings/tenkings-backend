import { speedsterTraceRleV1Spans } from '@atlas/grading-core/trace-codec';
import { INSPECTION_SIZE, fitInspectionScale, clampInspectionPan, zoomInspectionAt } from './inspection-viewport.mjs';

export const reportFindingMask = finding => finding.finalTrace ?? finding.detectorMask;
export const reportFindingRegions = finding => finding.measurementRegions ?? [{ zone: finding.zone, measurement: finding.measurement, canonicalContour: finding.canonicalContour }];
const spanCache = new WeakMap();
export function reportTraceSpans(mask) {
  let spans = spanCache.get(mask);
  if (!spans) { spans = [...speedsterTraceRleV1Spans(mask)]; spanCache.set(mask, spans); }
  return spans;
}

export function reportAwardedGrade(report) {
  if (report?.version === 'atlas-machine-provisional-report-v1' && report.authority === 'MACHINE_PROPOSAL'
    && report.certification === null && report.finalGradePolicy === 'atlas-final-half-point-v1') return report.proposedGrade;
  if (report?.version === 'atlas-manual-draft-report-v1') return report.grade?.overall?.displayGrade;
  if (report?.version === 'atlas-manual-draft-report-v2' && report.finalGradePolicy === 'atlas-final-half-point-v1') return report.finalGrade;
  return null;
}

/** Display geometry comes only from this report's saved trace, never an Astra proposal. */
export function reportFindingBounds(finding) {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  const include = (left, top, r = left, b = top) => { x = Math.min(x, left); y = Math.min(y, top); right = Math.max(right, r); bottom = Math.max(bottom, b); };
  const mask = reportFindingMask(finding);
  if (mask) for (const span of reportTraceSpans(mask)) include(span.x / 1270, span.y / 1778, (span.x + span.width) / 1270, (span.y + 1) / 1778);
  else for (const region of reportFindingRegions(finding)) for (const point of region.canonicalContour ?? []) include(point.x, point.y);
  return Number.isFinite(x) ? { x, y, width: right - x, height: bottom - y } : null;
}

export function reportFindingAt(findings, point) {
  if (!point) return null;
  for (const finding of findings) {
    if (finding.reviewResult === 'REMOVED') continue;
    const mask = reportFindingMask(finding);
    if (mask) {
      for (const span of reportTraceSpans(mask)) if (point.y === span.y && point.x >= span.x && point.x < span.x + span.width) return finding;
    } else for (const region of reportFindingRegions(finding)) {
      const polygon = region.canonicalContour ?? []; let inside = false;
      const x = point.x / 1269, y = point.y / 1777;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      if (inside) return finding;
    }
  }
  return null;
}

export function reportImagesMatch(report, workspace) {
  return Number.isFinite(reportAwardedGrade(report)) && Array.isArray(report.findings)
    && ['FRONT', 'BACK'].every(side => {
      const inspection = report.inspection?.[side.toLowerCase()], slot = workspace?.sides?.[side];
      return inspection?.inspected === true && slot && inspection.imageSha256 === slot.frame.inspectionImageSha256
        && inspection.findingRevision === slot.findingRevision;
    });
}

export const REPORT_CATEGORIES = ['centering', 'corners', 'edges', 'surface'];
/** Staff geometry is accepted only on the saved inspection frame; public geometry was projected from the approval. */
export function reportDisplayGeometry(geometry, report) {
  if (!geometry?.sides) return geometry;
  return Object.fromEntries(['FRONT', 'BACK'].map(side => {
    const slot = geometry.sides[side], frame = slot?.prepared?.frame;
    return [side, frame && slot?.printed && frame.inspection?.sha256 === report?.inspection?.[side.toLowerCase()]?.imageSha256
      && slot?.printed?.frameId === frame?.id && slot?.printed?.frameSha256 === frame?.rectified?.sha256
      ? { physicalQuad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], printedQuad: slot.printed.quad } : null];
  }));
}
export function reportFindingEntries(findings) {
  const numbers = { FRONT: 0, BACK: 0 };
  return findings.filter(finding => finding.reviewResult !== 'REMOVED').map(finding => ({ finding,
    number: ++numbers[finding.side], label: `${finding.side === 'FRONT' ? 'Front' : 'Back'} ${numbers[finding.side]}`,
    categories: [...new Set(reportFindingRegions(finding).map(region => region.zone.toLowerCase()))] }));
}

export function filterReportFindings(entries, side = 'ALL', category = 'ALL') {
  return entries.filter(entry => (side === 'ALL' || entry.finding.side === side)
    && (category === 'ALL' || entry.categories.includes(category)));
}

/** A description of the recorded scores, never another scoring implementation. */
export function reportGradeReason(report) {
  const categories = REPORT_CATEGORIES.filter(key => Number.isFinite(report.grade?.subgrades?.[key]));
  if (categories.length !== 4) return 'The calculation details show the recorded result for each category.';
  const lowest = Math.min(...categories.map(key => report.grade.subgrades[key]));
  if (lowest === 10) return report.findingCounts.included > 0
    ? 'Every category is within its grade-10 scoring band. The recorded imperfections remain visible in the evidence.'
    : 'Every category scores 10. No included damage findings were recorded; the result also includes confirmed centering.';
  const names = categories.filter(key => report.grade.subgrades[key] === lowest).join(' and ');
  return `${names.includes(' and ') ? `${names.charAt(0).toUpperCase()}${names.slice(1)} have` : `The ${names} category has`} the lowest subgrade. Explore the category totals and confirmed findings to see why.`;
}

export function reportFindingFragment(reportKey, findingId) {
  if (!/^[a-f0-9]{64}$/.test(reportKey ?? '') || typeof findingId !== 'string' || !findingId || findingId.length > 180) return null;
  return `#atlas-report=${reportKey}&finding=${encodeURIComponent(findingId)}`;
}
export function reportFindingLink(publication, fragment) {
  if (!fragment || !publication?.url) return fragment;
  try {
    const url = new URL(publication.url, 'https://atlasgrading.com');
    if (url.origin !== 'https://atlasgrading.com' || !/^\/reports\/[A-Za-z0-9_-]+$/.test(url.pathname)
      || url.searchParams.size !== 1 || url.searchParams.get('v') !== String(publication.version)) return fragment;
    return `${url.pathname}${url.search}${fragment}`;
  } catch { return fragment; }
}
export function reportFindingFromFragment(fragment, reportKey, findings) {
  if (!/^[a-f0-9]{64}$/.test(reportKey ?? '') || typeof fragment !== 'string' || fragment.length > 1200) return null;
  const value = new URLSearchParams(fragment.replace(/^#/, ''));
  if (value.getAll('atlas-report').length !== 1 || value.getAll('finding').length !== 1
    || [...value.keys()].some(key => !['atlas-report', 'finding'].includes(key)) || value.get('atlas-report') !== reportKey) return null;
  return findings.find(finding => finding.id === value.get('finding') && finding.reviewResult !== 'REMOVED') ?? null;
}

/** Pinch preserves the image point under the initial midpoint as both fingers move. */
export function reportPinchView(start, points, size) {
  const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const view = zoomInspectionAt(start.view, start.view.zoom * distance / Math.max(1, start.distance), start.midpoint, size);
  return { ...view, pan: clampInspectionPan({ x: view.pan.x + midpoint.x - start.midpoint.x,
    y: view.pan.y + midpoint.y - start.midpoint.y }, view.zoom, size) };
}

/** Visible rectangle in full verified-image coordinates, independent of the card mask. */
export function reportMinimap(view, size) {
  const scale = fitInspectionScale(size) * view.zoom;
  const width = INSPECTION_SIZE.width * scale, height = INSPECTION_SIZE.height * scale;
  const left = size.width / 2 + view.pan.x - width / 2, top = size.height / 2 + view.pan.y - height / 2;
  const x = Math.max(0, -left / width), y = Math.max(0, -top / height);
  return { x, y, width: Math.max(0, Math.min(1, (size.width - left) / width) - x),
    height: Math.max(0, Math.min(1, (size.height - top) / height) - y) };
}

export function reportCropBounds(bounds) {
  if (!bounds) return null;
  const width = Math.min(1270, Math.max(96, bounds.width * 1270) * 1.5), height = Math.min(1778, Math.max(96, bounds.height * 1778) * 1.5);
  return { x: 40 + Math.max(0, Math.min(1270 - width, (bounds.x + bounds.width / 2) * 1270 - width / 2)),
    y: 40 + Math.max(0, Math.min(1778 - height, (bounds.y + bounds.height / 2) * 1778 - height / 2)), width, height };
}
