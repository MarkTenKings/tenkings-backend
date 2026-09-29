import { speedsterTraceRleV1Spans } from '@atlas/grading-core/trace-codec';
import { INSPECTION_SIZE, fitInspectionScale, clampInspectionPan, zoomInspectionAt } from './inspection-viewport.mjs';

export const reportFindingMask = finding => finding.geometryExclusion ? null : finding.finalTrace ?? finding.detectorMask;
export const reportFindingRegions = finding => finding.geometryExclusion ? [] : finding.measurementRegions ?? [{ zone: finding.zone, measurement: finding.measurement, canonicalContour: finding.canonicalContour }];
const spanCache = new WeakMap();
export function reportTraceSpans(mask) {
  let spans = spanCache.get(mask);
  if (!spans) { spans = [...speedsterTraceRleV1Spans(mask)]; spanCache.set(mask, spans); }
  return spans;
}

export function reportGeometryUnresolved(report) {
  return report?.calculationState === 'GEOMETRY_UNRESOLVED'
    && report.grade === null && report.proposedGrade === null
    && Array.isArray(report.unresolvedGeometry) && report.unresolvedGeometry.length > 0
    && report.unresolvedGeometry.every(value => ['FRONT', 'BACK'].includes(value.side) && ['PRINTED_GEOMETRY_UNRESOLVED', 'BORDERLESS_CENTERING_UNSUPPORTED'].includes(value.code));
}

export function reportAwardedGrade(report) {
  if (report?.calculationState === 'GEOMETRY_UNRESOLVED') return null;
  if ((report?.version === 'atlas-machine-provisional-report-v1' && report.authority === 'MACHINE_PROPOSAL'
    || report?.version === 'atlas-review-provisional-report-v1' && report.authority === 'HUMAN_REVIEW_DRAFT')
    && report.certification === null && report.finalGradePolicy === 'atlas-final-half-point-v1') return report.proposedGrade;
  if (report?.version === 'atlas-manual-draft-report-v1') return report.grade?.overall?.displayGrade;
  if (report?.version === 'atlas-manual-draft-report-v2' && report.finalGradePolicy === 'atlas-final-half-point-v1') return report.finalGrade;
  return null;
}

/** Display geometry comes only from this report's saved trace, never an Astra proposal. */
export function reportFindingBounds(finding) {
  if (finding.geometryExclusion) return null;
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
export function reportPinchView(start, points, size, gutter = 16) {
  const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const view = zoomInspectionAt(start.view, start.view.zoom * distance / Math.max(1, start.distance), start.midpoint, size, gutter);
  return { ...view, pan: clampInspectionPan({ x: view.pan.x + midpoint.x - start.midpoint.x,
    y: view.pan.y + midpoint.y - start.midpoint.y }, view.zoom, size, gutter) };
}

/** Visible rectangle in full verified-image coordinates, independent of the card mask. */
export function reportMinimap(view, size, gutter = 16) {
  const scale = fitInspectionScale(size, gutter) * view.zoom;
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


const spanMeasurementCache = new WeakMap();
const cross = (a, b, c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
/** Maximum straight span between saved pixel edges, in the canonical 20 px/mm frame.
 * This is not a curved scratch's path length or a second grading calculation.
 * Row extremes preserve the convex hull, including every disconnected component. */
export function reportMarkedSpan(finding) {
  const mask = reportFindingMask(finding);
  if (!mask) return null; // A display contour is not a complete measured trace.
  if (spanMeasurementCache.has(mask)) return spanMeasurementCache.get(mask);
  const rows = new Map();
  for (const {x,y,width} of reportTraceSpans(mask)) {
    const old = rows.get(y); rows.set(y, {left:Math.min(x,old?.left ?? x),right:Math.max(x+width,old?.right ?? x+width)});
  }
  const points = [...rows].flatMap(([y,{left,right}])=>[{x:left,y},{x:right,y},{x:left,y:y+1},{x:right,y:y+1}]).sort((a,b)=>a.x-b.x||a.y-b.y);
  const half = values => { const h=[]; for(const p of values){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h; };
  const lo=half(points),hi=half([...points].reverse()),hull=[...lo.slice(0,-1),...hi.slice(0,-1)];
  if(hull.length<2)return null;
  let best=0,start,end,j=1;
  const consider=(a,b)=>{const d=(a.x-b.x)**2+(a.y-b.y)**2;if(d>best){best=d;start=a;end=b;}};
  for(let i=0;i<hull.length;i++){
    const next=(i+1)%hull.length;
    while(Math.abs(cross(hull[i],hull[next],hull[(j+1)%hull.length]))>Math.abs(cross(hull[i],hull[next],hull[j])))j=(j+1)%hull.length;
    consider(hull[i],hull[j]);consider(hull[next],hull[j]);
    if(Math.abs(cross(hull[i],hull[next],hull[(j+1)%hull.length]))===Math.abs(cross(hull[i],hull[next],hull[j])))consider(hull[i],hull[(j+1)%hull.length]);
  }
  const normalize=p=>({x:p.x/1270,y:p.y/1778});
  const result={mm:Math.sqrt(best)/20,start:normalize(start),end:normalize(end),hull:hull.map(normalize)};
  spanMeasurementCache.set(mask,result);return result;
}

export const rectanglesOverlap = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
/** A fixed-size label never covers the trace, its ruler, photo heading or locator.
 * null means render in normal document flow below the photograph instead. */
export function reportMeasurementPlacement(size, exclusions, width=240, height=176) {
  if(size.width<width+32||size.height<height+32)return null;
  const protectedBoxes=exclusions.map(b=>({x:b.x-14,y:b.y-14,width:b.width+28,height:b.height+28}));
  const xs=[16,(size.width-width)/2,size.width-width-16],ys=[52,(size.height-height)/2,size.height-height-16];
  for(const y of ys)for(const x of xs){const box={x,y,width,height};if(y+height<=size.height-16&&!protectedBoxes.some(p=>rectanglesOverlap(box,p)))return box;}
  return null;
}

export function reportSpanRuler(span, project) {
  if(!span)return null;
  const a=project(span.start),b=project(span.end),length=Math.hypot(b.x-a.x,b.y-a.y);
  if(!length)return null;
  const normal={x:-(b.y-a.y)/length,y:(b.x-a.x)/length};
  const support=Math.max(...span.hull.map(project).map(p=>(p.x-a.x)*normal.x+(p.y-a.y)*normal.y));
  const offset=support+24;
  const c={x:a.x+normal.x*offset,y:a.y+normal.y*offset},d={x:b.x+normal.x*offset,y:b.y+normal.y*offset};
  const tick=p=>`M${p.x-normal.x*6} ${p.y-normal.y*6}L${p.x+normal.x*6} ${p.y+normal.y*6}`;
  const points=[a,b,c,d],xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  return {path:`M${a.x} ${a.y}L${c.x} ${c.y} M${b.x} ${b.y}L${d.x} ${d.y} M${c.x} ${c.y}L${d.x} ${d.y} ${tick(c)} ${tick(d)}`,
    bounds:{x:Math.min(...xs)-6,y:Math.min(...ys)-6,width:Math.max(...xs)-Math.min(...xs)+12,height:Math.max(...ys)-Math.min(...ys)+12}};
}
