import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { evidenceShapes } from './evidence-scan-motion.mjs';
import { sampleEdgeTour, edgeVisitedRects, edgeRectPath, edgeRoute, edgeCamera, edgeCameraFrame } from './evidence-edge-tour.mjs';
import { ReportPrecisionOverlay } from './ReportPrecisionOverlay.jsx';
import { Blueprint } from './ReportInspectionImage.jsx';
import { TourSoundButton } from './TourSoundButton.jsx';
const stop = event => event.stopPropagation();

export function EdgeTourControls({ controller, plan }) {
  const range = useRef(null), status = useRef(null); const [playing, setPlaying] = useState(false);
  useEffect(() => controller.subscribe(state => {
    if (range.current) range.current.value = Math.round(state.progress * 1000);
    const sample = (plan.sample ?? sampleEdgeTour)(plan, state.progress);
    if (status.current) status.current.textContent = `${Math.floor(sample.time)} / ${Math.ceil(plan.duration)} s · ${sample.kind === 'inspect' ? 'Saved finding' : sample.label}`;
    setPlaying(old => old === state.playing ? old : state.playing);
  }), [controller, plan]);
  return <div className="rr-evidence-remote rr-edge-remote" aria-label={plan.mode === 'corners' ? 'Corner scan controls' : 'Edge scan controls'}>
    <div className="rr-edge-playback"><button type="button" onClick={() => playing ? controller.pause() : controller.play()}>{playing ? 'Pause scan' : 'Play scan'}</button>
    <button type="button" onClick={() => { controller.set({ progress: 0 }); controller.play(); }}>Replay scan</button>
    <TourSoundButton controller={controller} plan={plan}/></div>
    <label>Tour progress<input ref={range} type="range" min="0" max="1000" defaultValue="0" aria-label={plan.mode === 'corners' ? 'Corner tour progress' : 'Edge tour progress'} onChange={event => controller.set({ progress: Number(event.target.value) / 1000 }, 'edge-scrub')}/></label>
    <output ref={status} aria-live="off"/>
  </div>;
}

/** A moving narrow physical strip, with deterministic reverse scrubbing. The
 * original screen-space instruments are reused at a complete-mask close-up. */
export function EvidenceEdgeScan({ controller, photo, findings, side, plan, explanation }) {
  const root = useRef(null), svg = useRef(null), visited = useRef(null), reveal = useRef(null), beam = useRef(null), masks = useRef(null), lastKey = useRef(null);
  const shapes = useMemo(() => evidenceShapes(findings), [findings]);
  const [hold, setHold] = useState(null);
  const instance = useId().replaceAll(':', '');
  const patternId = `edge-grid-${instance}-${side}`, clipId = `edge-reveal-${instance}-${side}`;
  useEffect(() => {
    const paint = state => {
      const element = root.current; if (!element || !svg.current) return;
      const size = { width: element.clientWidth, height: element.clientHeight };
      if (size.width <= 0 || size.height <= 0) return;
      const s = (plan.sample ?? sampleEdgeTour)(plan, state.progress), c = edgeCamera(s, size.width, size.height), d = s.field ? edgeRectPath({ ...s.field, height: s.field.height * (s.scan ?? 0) }) : edgeVisitedRects(s.route).map(edgeRectPath).join('');
      svg.current.setAttribute('viewBox', `${c.x} ${c.y} ${c.width} ${c.height}`);
      visited.current?.setAttribute('d', d); reveal.current?.setAttribute('d', d);
      const p = edgeRoute(s.route ?? 0), line = s.field ? 'M' + s.field.x + ' ' + (s.field.y + s.field.height * (s.scan ?? 0)) + 'h' + s.field.width : p.edge === 0 ? `M${p.x} 40v50` : p.edge === 1 ? `M1260 ${p.y}h50` : p.edge === 2 ? `M${p.x} 1768v50` : `M40 ${p.y}h50`;
      beam.current?.setAttribute('d', line);
      const detail = ['focus', 'inspect', 'retreat'].includes(s.kind);
      masks.current?.setAttribute('clip-path', detail ? 'none' : `url(#${clipId})`);
      const key = s.key + ':' + size.width + ':' + size.height;
      if (lastKey.current !== key) {
        lastKey.current = key;
        setHold(s.kind === 'inspect' && s.finding?.side === side ? { finding: s.finding, camera: c, size } : null);
      }
    };
    const unsubscribe = controller.subscribe(paint), observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { lastKey.current = null; paint(controller.snapshot()); });
    if (root.current) observer?.observe(root.current);
    return () => { unsubscribe(); observer?.disconnect(); };
  }, [controller, plan, side]);
  const toggle = () => controller.snapshot().playing ? controller.pause() : controller.play();
  const frame = hold ? edgeCameraFrame(hold.camera, hold.size.width, hold.size.height) : { scale: 1, offsetX: 0, offsetY: 0 }, factor = frame.scale;
  const project = point => ({ x: frame.offsetX + (40 + point.x * 1270 - hold.camera.x) * factor, y: frame.offsetY + (40 + point.y * 1778 - hold.camera.y) * factor });
  const view = hold && { zoom: 1, pan: { x: frame.offsetX + (675 - hold.camera.x) * factor - hold.size.width / 2, y: frame.offsetY + (929 - hold.camera.y) * factor - hold.size.height / 2 } };
  const detail = hold && explanation?.findings?.find(f => f.id === hold.finding.id);
  return <div className="rr-evidence-edge-scan" ref={root} onPointerDown={stop} onPointerUp={stop} onPointerMove={stop} onWheel={stop} onClick={toggle} onKeyDown={event => { event.stopPropagation(); if (event.key === ' ') { event.preventDefault(); toggle(); } }} tabIndex="0" role="group" aria-label={`${side === 'FRONT' ? 'Front' : 'Back'} ${plan.mode === 'corners' ? 'corner' : 'edge'} scan; tap to pause or resume`}>
    <svg ref={svg} viewBox="0 0 1350 1858" className="rr-edge-film" aria-label="Saved photograph and exact scanned traces">
      <defs><pattern id={patternId} width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#0b5361" strokeWidth=".7" opacity=".5"/></pattern><clipPath id={clipId}><path ref={reveal}/></clipPath></defs>
      <image href={photo} width="1350" height="1858"/>
      <path ref={visited} fill={`url(#${patternId})`} stroke="#079ba8" strokeWidth=".8"/>
      <g ref={masks}>{shapes.map(({ finding, path }) => <g key={finding.id} transform="translate(40 40)"><path d={path} fill="none" stroke="white" strokeWidth="3" vectorEffect="non-scaling-stroke"/><path d={path} fill="#ff173e"/></g>)}</g>
      <path ref={beam} fill="none" stroke="#00c6da" strokeWidth="3" vectorEffect="non-scaling-stroke"/>
    </svg>
    {hold && <><ReportPrecisionOverlay finding={hold.finding} project={project} size={hold.size} mode="finding"/>
      <Blueprint finding={hold.finding} explanation={detail} side={side} view={view} size={hold.size} scale={factor} docked/>
      <div className="rr-edge-readout" onClick={stop}><Blueprint outside finding={hold.finding} explanation={detail} side={side} view={view} size={hold.size} scale={factor} docked/></div></>}
    <span className="rr-edge-strip-caption">{plan.mode === 'corners' ? 'Equal corner inspection field · tap to pause' : '2.5 mm inspection strip · tap to pause'}</span>
  </div>;
}

