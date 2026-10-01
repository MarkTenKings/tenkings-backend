import { reportFindingBounds, reportFindingMask, reportTraceSpans } from './report-review-ui.mjs';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const shapeCache = new WeakMap();
export const adaptiveEvidenceScale = bounds => Math.max(1.08, Math.min(10, .15 / Math.max(bounds.width, 1 / 1270), .15 / Math.max(bounds.height, 1 / 1778)));
export const breathingEvidenceScale = (bounds, elapsedMs) => 1 + (adaptiveEvidenceScale(bounds) - 1) * (1 - Math.cos(elapsedMs / 4000 * Math.PI * 2)) / 2;

/** The actual saved pixel rows, one path per independent finding. No contours
 * synthesized from bounding boxes and no adjustment to grading membership. */
export function evidenceShapes(findings) {
  return findings.filter(f => ['ACCEPTED', 'CORRECTED'].includes(f.reviewResult) && !f.geometryExclusion).flatMap(finding => {
    const mask = reportFindingMask(finding);
    if (!mask) return [];
    let path = shapeCache.get(mask);
    if (!path) {
      path = reportTraceSpans(mask).map(s => `M${s.x} ${s.y}h${s.width}v1h-${s.width}Z`).join('');
      shapeCache.set(mask, path);
    }
    const bounds = reportFindingBounds(finding);
    return [{ finding, path, bounds, label: `${finding.side === 'FRONT' ? 'Front' : 'Back'} · ${finding.defectType.toLowerCase().replaceAll('_', ' ')}` }];
  });
}

/** Event-to-following-frame timing. This is a browser response sample, not a
 * network, image verification, motion completion or production latency claim. */
export function measureEvidenceResponse(action, start = globalThis.performance?.now()) {
  if (!Number.isFinite(start) || typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { performance.measure('atlas-evidence-response', { start, end: performance.now(), detail: { action } }); } catch {}
  }));
}

/** Tiny shared timeline. Subscribers update compositor styles directly; a frame
 * never rerenders the report or recomputes measurements. Injectable for tests. */
export function createEvidenceMotion({ request = cb => requestAnimationFrame(cb), cancel = id => cancelAnimationFrame(id) } = {}) {
  let state = { progress: 0, playing: false, reduced: false, durationMs: 1400, linear: false }, frame = null;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn(state));
  const stop = () => { if (frame !== null) cancel(frame); frame = null; state = { ...state, playing: false }; };
  return {
    snapshot: () => ({ ...state }),
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    configure({ reduced = state.reduced, progress = state.progress, durationMs = 1400, linear = false } = {}) {
      stop(); state = { progress: clamp(progress, 0, 1), playing: false, reduced, durationMs, linear }; emit();
    },
    set(values, action) { stop(); state = { ...state, ...values, progress: clamp(values.progress ?? state.progress, 0, 1), angle: clamp(values.angle ?? state.angle, -180, 180) }; emit(); if (action) measureEvidenceResponse(action); },
    pause() { stop(); emit(); },
    play(target = 1) {
      stop(); target = clamp(target, 0, 1);
      if (state.reduced) { state = { ...state, progress: target }; emit(); return; }
      if (state.progress === target) state = { ...state, progress: target === 1 ? 0 : 1 };
      const from = state.progress; let started;
      state = { ...state, playing: true }; emit();
      const tick = now => {
        started ??= now;
        const t = clamp((now - started) / (state.durationMs * Math.max(.001, Math.abs(target - from))), 0, 1), eased = state.linear ? t : t * t * (3 - 2 * t);
        state = { ...state, progress: from + (target - from) * eased, playing: t < 1 }; emit();
        frame = t < 1 ? request(tick) : null;
      };
      frame = request(tick); measureEvidenceResponse('play');
    },
    dispose() { stop(); listeners.clear(); },
  };
}
