import { CARD_SIZE } from './inspection-viewport.mjs';
import { reportFindingBounds, reportFindingEntries } from './report-review-ui.mjs';

const sides = ['FRONT', 'BACK'];
const kinds = ['top', 'left', 'right', 'bottom', 'interior', 'unlocated'];
const labels = { top: 'Top', left: 'Left', right: 'Right', bottom: 'Bottom',
  interior: 'Interior', unlocated: 'Location unavailable' };

function savedBounds(finding) {
  let bounds;
  try { bounds = reportFindingBounds(finding); } catch { return null; }
  if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))
    || bounds.width < 0 || bounds.height < 0 || !(bounds.width || bounds.height)
    || bounds.x < 0 || bounds.y < 0
    || bounds.x + bounds.width > 1 + 1e-12 || bounds.y + bounds.height > 1 + 1e-12) return null;
  return bounds;
}

function neighborhoodKind(bounds) {
  if (!bounds) return 'unlocated';
  // End caps keep corner findings with the complete top/bottom area. Require
  // the entire trace bounds inside the band, including disconnected pixels.
  const band = CARD_SIZE.width * .1;
  if ((bounds.y + bounds.height) * CARD_SIZE.height <= band) return 'top';
  if (bounds.y * CARD_SIZE.height >= CARD_SIZE.height - band) return 'bottom';
  // Compare distances in the same canonical pixel scale, not unlike x/y fractions.
  // This 10% short-edge band is navigation only; it is not a measured scoring zone.
  const distances = [bounds.y * CARD_SIZE.height, bounds.x * CARD_SIZE.width,
    (1 - bounds.x - bounds.width) * CARD_SIZE.width,
    (1 - bounds.y - bounds.height) * CARD_SIZE.height];
  const nearest = Math.min(...distances);
  return nearest > band ? 'interior' : kinds[distances.indexOf(nearest)];
}

function envelope(entries) {
  const bounds = entries.map(entry => entry.bounds).filter(Boolean);
  if (!bounds.length) return null;
  const x = Math.min(...bounds.map(box => box.x)), y = Math.min(...bounds.map(box => box.y));
  return { x, y, width: Math.max(...bounds.map(box => box.x + box.width)) - x,
    height: Math.max(...bounds.map(box => box.y + box.height)) - y };
}

/** Build once from the complete report, then filter the returned entries/groups.
 * Existing per-side number/label and finding IDs remain authoritative. globalNumber
 * is an optional complete-report ordinal; filtering must never rebuild numbering.
 * A group's bounds are a camera envelope only. Findings, traces, regions and their
 * measurements retain their individual identities and are never combined here. */
export function reportSpatialNavigation(findings = []) {
  const entries = reportFindingEntries(findings).map((entry, index) => ({ ...entry,
    id: entry.finding.id, globalNumber: index + 1, bounds: savedBounds(entry.finding) }));
  const neighborhoods = sides.flatMap(side => {
    const sideEntries = entries.filter(entry => entry.finding.side === side);
    if (sideEntries.length <= 2) return sideEntries.map(entry => ({
      id: `${side}:finding:${encodeURIComponent(entry.id)}`, side, kind: 'finding',
      label: entry.label, entries: [entry], bounds: entry.bounds,
    }));
    const groups = new Map(kinds.map(kind => [kind, []]));
    for (const entry of sideEntries) groups.get(neighborhoodKind(entry.bounds)).push(entry);
    return kinds.flatMap(kind => {
      const members = groups.get(kind);
      return members.length ? [{ id: `${side}:${kind}`, side, kind, label: labels[kind],
        entries: members, bounds: envelope(members) }] : [];
    });
  });
  return { entries, neighborhoods };
}

const copyView = view => ({ zoom: view.zoom, pan: { x: view.pan.x, y: view.pan.y } });
const wholeView = () => ({ zoom: 1, pan: { x: 0, y: 0 } });

/** Display-only itinerary in inspection-viewport's zoom/pan representation.
 * The caller owns scheduling, easing, cancellation and evidence-ready gates.
 * New-side/whole-card starts first reset to whole without animating a stale view. */
export function reportCameraItinerary(fromView, toView, { sideChanged = false, reducedMotion = false } = {}) {
  if (reducedMotion) return [{ phase: 'approach', view: copyView(toView), duration: 0 }];
  if (sideChanged || fromView.zoom <= 1.05) return [
    { phase: 'locate', view: wholeView(), duration: 0 },
    { phase: 'approach', view: copyView(toView), duration: 620 },
  ];
  return [
    { phase: 'retreat', view: wholeView(), duration: 300 },
    { phase: 'locate', view: wholeView(), duration: 150 },
    { phase: 'approach', view: copyView(toView), duration: 500 },
  ];
}

/** Membership is taken only from saved measured regions. Retain original side
 * numbering and IDs, including findings which belong to multiple categories. */
export function reportCategoryNavigation(navigation, category) {
  if (!['corners', 'edges', 'surface'].includes(category)) return navigation;
  return { entries: navigation.entries.filter(entry => entry.categories.includes(category)), neighborhoods: [] };
}
