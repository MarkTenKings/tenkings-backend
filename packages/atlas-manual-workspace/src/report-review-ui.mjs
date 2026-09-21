import { speedsterTraceRleV1Spans } from '@atlas/grading-core/trace-codec';

export const reportFindingMask = finding => finding.finalTrace ?? finding.detectorMask;
export const reportFindingRegions = finding => finding.measurementRegions ?? [{ zone: finding.zone, measurement: finding.measurement, canonicalContour: finding.canonicalContour }];

export function reportAwardedGrade(report) {
  if (report?.version === 'atlas-manual-draft-report-v1') return report.grade?.overall?.displayGrade;
  if (report?.version === 'atlas-manual-draft-report-v2' && report.finalGradePolicy === 'atlas-final-half-point-v1') return report.finalGrade;
  return null;
}

/** Display geometry comes only from this report's saved trace, never an Astra proposal. */
export function reportFindingBounds(finding) {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  const include = (left, top, r = left, b = top) => { x = Math.min(x, left); y = Math.min(y, top); right = Math.max(right, r); bottom = Math.max(bottom, b); };
  const mask = reportFindingMask(finding);
  if (mask) for (const span of speedsterTraceRleV1Spans(mask)) include(span.x / 1270, span.y / 1778, (span.x + span.width) / 1270, (span.y + 1) / 1778);
  else for (const region of reportFindingRegions(finding)) for (const point of region.canonicalContour ?? []) include(point.x, point.y);
  return Number.isFinite(x) ? { x, y, width: right - x, height: bottom - y } : null;
}

export function reportFindingAt(findings, point) {
  if (!point) return null;
  for (const finding of findings) {
    if (finding.reviewResult === 'REMOVED') continue;
    const mask = reportFindingMask(finding);
    if (mask) {
      for (const span of speedsterTraceRleV1Spans(mask)) if (point.y === span.y && point.x >= span.x && point.x < span.x + span.width) return finding;
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
