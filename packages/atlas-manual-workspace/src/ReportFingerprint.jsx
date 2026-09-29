import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FINGERPRINT_VERSION, FINGERPRINT_MAX_WIDTH, fingerprintSource, fingerprintFieldSteps,
  fingerprintSampleSteps, scheduleFingerprint, paintFingerprintPixels, animateFingerprint } from './report-fingerprint.mjs';

/** The verified viewer owns photograph readiness. This layer owns presentation only. */
export function ReportFingerprint({ findings, side, active, command, onReturn }) {
  const source = useMemo(() => fingerprintSource(findings, side), [findings, side]);
  const root = useRef(null), canvas = useRef(null), traces = useRef(null), amount = useRef(0);
  const cached = useRef(null), animation = useRef(null), raster = useRef(null);
  const [prepared, setPrepared] = useState(null), [failedKey, setFailedKey] = useState(null);
  const sampled = prepared?.key === source.key ? prepared.value : null, failed = failedKey === source.key;
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  const hasSource = source.spans.length > 0 && source.unavailable === 0;
  useEffect(() => {
    const query = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(Boolean(query.matches));
    query?.addEventListener?.('change', changed); return () => query?.removeEventListener?.('change', changed);
  }, []);
  useEffect(() => {
    if (!active || !hasSource) return;
    if (cached.current?.key === source.key) { setPrepared(cached.current); return; }
    const controller = new AbortController(); setPrepared(null); setFailedKey(null);
    const prepare = async () => {
      try {
        const field = await scheduleFingerprint(fingerprintFieldSteps(source.spans), { signal: controller.signal });
        const width = FINGERPRINT_MAX_WIDTH, height = Math.round(width * 1778 / 1270);
        const value = await scheduleFingerprint(fingerprintSampleSteps(field, width, height), { signal: controller.signal });
        if (!controller.signal.aborted) { cached.current = { key: source.key, value }; setPrepared(cached.current); }
      } catch (error) { if (error.name !== 'AbortError') setFailedKey(source.key); }
    };
    prepare(); return () => controller.abort();
  }, [active, source.key, hasSource]);
  useEffect(() => {
    const context = traces.current?.getContext('2d'); if (!context) return;
    context.clearRect(0, 0, 1270, 1778); context.fillStyle = '#df3442';
    for (const span of source.spans) context.fillRect(span.x, span.y, span.width, 1);
  }, [source.key, active]);
  useEffect(() => {
    animation.current?.(); animation.current = null;
    const context = canvas.current?.getContext('2d');
    if (!active) { amount.current = 0; root.current?.style.setProperty('--rr-fingerprint-amount', '0'); return; }
    if (command?.type === 'RETURN' && (!sampled || !hasSource || failed)) { onReturn(); return; }
    if (!sampled || !hasSource || !context || failed) {
      amount.current = 0; root.current?.style.setProperty('--rr-fingerprint-amount', '0');
      context?.clearRect(0, 0, FINGERPRINT_MAX_WIDTH, Math.round(FINGERPRINT_MAX_WIDTH * 1778 / 1270)); return;
    }
    if (raster.current?.sampled !== sampled) raster.current = { sampled, image: context.createImageData(sampled.width, sampled.height) };
    const paint = value => {
      amount.current = value; root.current?.style.setProperty('--rr-fingerprint-amount', String(value));
      paintFingerprintPixels(raster.current.image.data, sampled, value); context.putImageData(raster.current.image, 0, 0);
    };
    const run = (target, duration, complete) => {
      animation.current = animateFingerprint({ from: amount.current, target, duration, reducedMotion: reduced, paint, complete });
    };
    if (command?.type === 'RETURN') run(0, 1400, onReturn);
    else if (command?.type === 'PLAY' && !reduced) {
      paint(0); run(1, 1600, () => run(1, 650, () => run(0, 1400, onReturn)));
    } else run(1, 1700);
    return () => { animation.current?.(); animation.current = null; };
  }, [active, sampled, command, reduced, hasSource, failed, onReturn]);

  const empty = source.count === 0, unavailable = !empty && !hasSource;
  return <div ref={root} className="rr-fingerprint-layer" hidden={!active} data-algorithm={FINGERPRINT_VERSION}
    data-status={empty ? 'empty' : unavailable || failed ? 'unavailable' : sampled ? 'ready' : 'preparing'}
    style={empty || unavailable ? { '--rr-fingerprint-amount': 1 } : undefined}>
    <div className="rr-fingerprint-paper"/>
    <div className="rr-fingerprint-card" aria-hidden="true">
      <canvas ref={canvas} style={{ visibility: sampled && !failed ? 'visible' : 'hidden' }} width={FINGERPRINT_MAX_WIDTH} height={Math.round(FINGERPRINT_MAX_WIDTH * 1778 / 1270)}/>
      <canvas ref={traces} width={1270} height={1778}/>
    </div>
    {empty || unavailable || failed ? <p className="rr-fingerprint-message" role="status">{empty ? 'No recorded defects on this side' : 'Saved traces are unavailable for this fingerprint.'}</p>
      : !sampled && <p className="rr-fingerprint-loading" role="status">Preparing card fingerprint…</p>}
  </div>;
}
