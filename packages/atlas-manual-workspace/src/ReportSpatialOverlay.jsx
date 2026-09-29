import React, { useMemo, useState } from 'react';
import { reportFindingMask, reportFindingRegions, reportTraceSpans } from './report-review-ui.mjs';

const thumbnailCache = new WeakMap();
const finite = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const validBounds = box => box && finite(box) && Number.isFinite(box.width) && Number.isFinite(box.height)
  && box.width >= 0 && box.height >= 0;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const shortName = finding => String(finding.defectType ?? finding.type ?? 'Finding').toLowerCase()
  .replaceAll('_', ' ').replace(/^visible whitening$/, 'Whitening').replace(/^light scratch scuff$/, 'Scratch / scuff')
  .replace(/^./, letter => letter.toUpperCase());

/** These silhouettes enlarge the saved pixels; they never enlarge marks on the photograph. */
function traceThumbnail(finding) {
  if (!finding || finding.geometryExclusion) return null;
  const mask = reportFindingMask(finding), key = mask ?? finding;
  if (thumbnailCache.has(key)) return thumbnailCache.get(key);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, anchor = null, longest = -1;
  const paths = [], include = (x, y, r = x, b = y) => {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, r); bottom = Math.max(bottom, b);
  };
  if (mask) {
    for (const span of reportTraceSpans(mask)) {
      include(span.x, span.y, span.x + span.width, span.y + 1);
      paths.push(`M${span.x} ${span.y}h${span.width}v1h${-span.width}Z`);
      if (span.width > longest) {
        longest = span.width;
        anchor = { x: (span.x + span.width / 2) / 1270, y: (span.y + .5) / 1778 };
      }
    }
  } else {
    // Historical contour-only evidence uses the same convention as ReportMasks.
    for (const region of reportFindingRegions(finding)) {
      const points = (region.canonicalContour ?? []).filter(finite);
      if (points.length < 3) continue;
      if (!anchor) anchor = points[0];
      points.forEach(point => include(point.x * 1269, point.y * 1777));
      paths.push(points.map((point, index) => `${index ? 'L' : 'M'}${point.x * 1269} ${point.y * 1777}`).join('') + 'Z');
    }
  }
  const result = paths.length && Number.isFinite(left) ? {
    path: paths.join(''), anchor,
    viewBox: `${left - 1} ${top - 1} ${Math.max(1, right - left) + 2} ${Math.max(1, bottom - top) + 2}`,
  } : null;
  thumbnailCache.set(key, result);
  return result;
}

function projectBox(box, project) {
  const points = [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }].map(project);
  if (!points.every(finite)) return null;
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/** Area brackets sit outside the card, never at an invented damage centroid. */
function areaBracket(area, card, project) {
  const box = projectBox(area.bounds, project);
  if (!box) return null;
  let edge = area.kind;
  if (!['top', 'right', 'bottom', 'left'].includes(edge)) {
    const cx = area.bounds.x + area.bounds.width / 2, cy = area.bounds.y + area.bounds.height / 2;
    edge = [['left', cx], ['right', 1 - cx], ['top', cy], ['bottom', 1 - cy]].sort((a, b) => a[1] - b[1])[0][0];
  }
  const gap = 12, cap = 5;
  if (edge === 'left' || edge === 'right') {
    const x = edge === 'left' ? card.x - gap : card.right + gap, inward = edge === 'left' ? cap : -cap;
    return { anchor: { x, y: (box.y + box.bottom) / 2 },
      path: `M${x + inward} ${box.y}H${x}V${box.bottom}H${x + inward}` };
  }
  const y = edge === 'top' ? card.y - gap : card.bottom + gap, inward = edge === 'top' ? cap : -cap;
  return { anchor: { x: (box.x + box.right) / 2, y },
    path: `M${box.x} ${y + inward}V${y}H${box.right}V${y + inward}` };
}

function placeTargets(targets, card, size, hasBack) {
  const gutters = [card.x - 26, size.width - card.right - 26];
  const lanes = [[], []], center = (card.x + card.right) / 2;
  targets.forEach(target => lanes[target.anchor.x < center ? 0 : 1].push(target));
  const top = hasBack ? 80 : 28, bottom = size.height - 28, gap = 54;
  const flowing = size.width <= 700 || lanes.some((lane, side) => lane.length &&
    (gutters[side] < 138 || (lane.length - 1) * gap > bottom - top));
  const result = new Map();
  lanes.forEach((lane, side) => {
    lane.sort((a, b) => a.anchor.y - b.anchor.y);
    lane.forEach((target, index) => {
      const low = top + index * gap, high = bottom - (lane.length - 1 - index) * gap;
      const previous = index ? result.get(lane[index - 1].key).y + gap : top;
      const y = clamp(Math.max(target.anchor.y, previous), low, high);
      const width = Math.min(192, Math.max(138, gutters[side]));
      const x = side ? size.width - width - 10 : 10;
      const start = side ? x : x + width;
      const dx = target.anchor.x - start, dy = target.anchor.y - y, distance = Math.hypot(dx, dy);
      // The leader ends beside the evidence, with no dot or enlarged damage mark.
      const end = distance > 4 ? { x: target.anchor.x - dx / distance * 3, y: target.anchor.y - dy / distance * 3 } : target.anchor;
      result.set(target.key, { x, y, width,
        path: `M${start} ${y}H${start + (side ? -10 : 10)}L${end.x} ${end.y}` });
    });
  });
  return { flowing, positions: result };
}

/** Public display only. Expansion changes labels, never saved findings, measurements, or camera. */
export function ReportSpatialOverlay({ navigation, side, activeArea, onAreaChange, onSelect,
  project, size, selectedId, ready, density = 'all' }) {
  const [hovered, setHovered] = useState(null);
  const entries = useMemo(() => (navigation?.entries ?? []).filter(entry => entry.finding?.side === side
    && entry.finding.reviewResult !== 'REMOVED' && validBounds(entry.bounds)), [navigation, side]);
  const neighborhoods = useMemo(() => (navigation?.neighborhoods ?? []).filter(area => area.side === side
    && validBounds(area.bounds) && area.entries?.some(entry => entries.some(value => value.finding.id === entry.finding.id))), [navigation, side, entries]);
  const area = density === 'areas' ? neighborhoods.find(value => value.id === activeArea) : null;
  const targets = useMemo(() => {
    const individual = entry => ({ key: `finding:${entry.finding.id}`, entry, thumbnail: traceThumbnail(entry.finding) });
    if (density !== 'areas') return entries.map(individual);
    if (area) return area.entries.filter(entry => entries.some(value => value.finding.id === entry.finding.id)).map(individual);
    return neighborhoods.map(value => value.kind === 'finding' && value.entries.length === 1
      ? individual(value.entries[0]) : { key: `area:${value.id}`, area: value });
  }, [entries, neighborhoods, area, density]);
  if (!ready || typeof project !== 'function' || !size || !(size.width > 0) || !(size.height > 0)) return null;
  const card = projectBox({ x: 0, y: 0, width: 1, height: 1 }, project);
  if (!card) return null;
  const projected = targets.flatMap(target => {
    if (target.area) {
      const bracket = areaBracket(target.area, card, project);
      return bracket ? [{ ...target, anchor: bracket.anchor, bracket: bracket.path }] : [];
    }
    const point = target.thumbnail?.anchor;
    const anchor = point && project(point);
    // Unlocated findings remain available in the report's ordinary text navigator.
    return finite(anchor) ? [{ ...target, anchor }] : [];
  });
  if (!projected.length) return null;
  const layout = placeTargets(projected, card, size, Boolean(area));
  const isSelected = target => target.entry ? target.entry.finding.id === selectedId
    : target.area.entries.some(entry => entry.finding.id === selectedId);
  const stop = event => event.stopPropagation();
  return <div className={`rr-spatial-overlay${layout.flowing ? ' rr-spatial-flow' : ''}`}
    style={{ '--rr-spatial-height': `${size.height}px` }}>
    <svg className="rr-spatial-lines" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
      {projected.map(target => <g key={target.key} className={isSelected(target) || hovered === target.key ? 'rr-spatial-emphasis' : undefined}>
        {target.bracket && <path className="rr-spatial-bracket" d={target.bracket}/>}
        <path className="rr-spatial-leader" d={layout.positions.get(target.key).path}/>
      </g>)}
    </svg>
    <div className="rr-spatial-controls" role="group" aria-label={`${side === 'FRONT' ? 'Front' : 'Back'} finding locations`}
      onPointerDown={stop} onPointerUp={stop} onKeyDown={event => { if (!['[', ']'].includes(event.key)) stop(event); }}>
      {area && <div className="rr-spatial-back"><button type="button" onClick={() => onAreaChange?.(null)}>
        <span aria-hidden="true">← </span>All areas</button><span>{area.label} · {area.entries.length} {area.entries.length === 1 ? 'finding' : 'findings'}</span></div>}
      <div className="rr-spatial-targets">
        {projected.map(target => {
          const position = layout.positions.get(target.key), entry = target.entry, selected = isSelected(target);
          return <button type="button" key={target.key}
            className={`rr-spatial-target${entry ? ' rr-spatial-finding' : ' rr-spatial-area'}${selected ? ' rr-spatial-selected' : ''}`}
            style={{ left: position.x, top: position.y, width: position.width }}
            aria-label={entry ? `Inspect ${entry.label}: ${shortName(entry.finding)}`
              : `${target.area.label}: ${target.area.entries.length} ${target.area.entries.length === 1 ? 'finding' : 'findings'}. Show individual findings`}
            aria-pressed={entry ? selected : undefined} aria-expanded={entry ? undefined : false}
            onPointerEnter={() => setHovered(target.key)} onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered(target.key)} onBlur={() => setHovered(null)}
            onClick={() => { setHovered(null); entry ? onSelect?.(entry.finding) : onAreaChange?.(target.area.id); }}>
            {entry ? <>
              {target.thumbnail && <svg className="rr-spatial-silhouette" viewBox={target.thumbnail.viewBox} aria-hidden="true"><path d={target.thumbnail.path}/></svg>}
              <span className="rr-spatial-number">{entry.number}</span>
              <span className="rr-spatial-name">{shortName(entry.finding)}</span>
            </> : <><span className="rr-spatial-name">{target.area.label}<small>{target.area.entries.length} {target.area.entries.length === 1 ? 'finding' : 'findings'}</small></span><span className="rr-spatial-open" aria-hidden="true">↗</span></>}
          </button>;
        })}
      </div>
      {projected.some(target => target.thumbnail) && <p className="rr-spatial-caption">Trace silhouettes enlarged for identification.</p>}
    </div>
  </div>;
}

export default ReportSpatialOverlay;
