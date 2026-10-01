import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { wholeCardShapes, calloutViewBox, WHOLE_FRAME } from './whole-card-layout.mjs';
import { FindingCallouts } from './FindingCallouts.jsx';
import { usePresentationImage } from './report-presentation-image.mjs';

const SIDES = ['FRONT', 'BACK'];
const { width: W, height: H, padding: P, cardWidth: CW, cardHeight: CH } = WHOLE_FRAME;
const title = side => side === 'FRONT' ? 'Front' : 'Back';
const pretty = value => String(value ?? 'Finding').toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const fmt = value => Number.isFinite(value) ? value.toFixed(2) : '—';
const validQuad = quad => Array.isArray(quad) && quad.length === 4 && quad.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);

function Instruments({ geometry, side, id, borders }) {
  if (!validQuad(geometry?.printedQuad) || !borders) return null;
  const p = geometry.printedQuad.map(v => ({ x: P + v.x * CW, y: P + v.y * CH }));
  const mid = p.map((v, i) => ({ x: (v.x + p[(i + 1) % 4].x) / 2, y: (v.y + p[(i + 1) % 4].y) / 2 }));
  const specs = [['Top', borders.topMm, { x: mid[0].x, y: P }, mid[0], W / 2, -25, 'v'],
    ['Bottom', borders.bottomMm, { x: mid[2].x, y: P + CH }, mid[2], W / 2, H + 42, 'v'],
    ['Left', borders.leftMm, { x: P, y: mid[3].y }, mid[3], -95, H / 2 - 39, 'h'],
    ['Right', borders.rightMm, { x: P + CW, y: mid[1].y }, mid[1], W + 95, H / 2 - 39, 'h']];
  const vertical = `M${W / 2} ${P}V${P + CH}`, horizontal = `M${P} ${H / 2}H${P + CW}`;
  return <g className="centering-instruments" aria-label={`${title(side)} saved centering measurements`}>
    <defs><clipPath id={`${id}-v`} clipPathUnits="userSpaceOnUse"><rect className="axis-reveal-v" x="0" y={P} width={W} height={CH}/></clipPath>
      <clipPath id={`${id}-h`} clipPathUnits="userSpaceOnUse"><rect className="axis-reveal-h" x={P} y="0" width={CW} height={H}/></clipPath></defs>
    <g className="registration" aria-hidden="true"><path d={`M${P * 2} ${P - 12}H${P - 12}V${P * 2} M${W - P * 2} ${P - 12}H${W - P + 12}V${P * 2} M${P - 12} ${H - P * 2}V${H - P + 12}H${P * 2} M${W - P * 2} ${H - P + 12}H${W - P + 12}V${H - P * 2}`}/>
      {Array.from({ length: 19 }, (_, i) => <path key={i} d={`M16 ${P * 2 + i * CH / 19.75}h${i % 3 === 0 ? -16 : -8} M${W - 16} ${P * 2 + i * CH / 19.75}h${i % 3 === 0 ? 16 : 8}`}/>)}</g>
    <polygon className="printed-frame" points={p.map(v => `${v.x},${v.y}`).join(' ')}/>
    {['v', 'h'].map(axis => <g className={`axis-group axis-${axis}`} key={axis} aria-hidden="true"><g clipPath={`url(#${id}-${axis})`}>
      <path className="axis-under" d={axis === 'v' ? vertical : horizontal}/><path className="axis-core" d={axis === 'v' ? vertical : horizontal}/></g>
      <g className={`head-${axis}`}><path className="head-tail" d={axis === 'v' ? `M${W / 2} ${P - 100}V${P}` : `M${P - 100} ${H / 2}H${P}`}/>
        <path d={axis === 'v' ? `M${W / 2 - 15} ${P}h30 M${W / 2} ${P - 9}v18` : `M${P} ${H / 2 - 15}v30 M${P - 9} ${H / 2}h18`} className="head-core"/></g></g>)}
    <g className="center-lock" transform={`translate(${W / 2} ${H / 2})`} aria-hidden="true"><path d="M-19 -13v-6h10 M9 -19h10v6 M19 13v6h-10 M-9 19h-10v-6"/><circle r="4"/></g>
    {specs.map(([name, value, a, b, x, y, axis]) => { const vertical = axis === 'v'; return <g className={`measure measure-${axis} measure-${name.toLowerCase()}`} key={name}>
      <path className="caliper-under" d={`M${a.x} ${a.y}L${b.x} ${b.y}`}/><path className="caliper-stem" d={`M${a.x} ${a.y}L${b.x} ${b.y}`}/>
      <path className="caliper" d={`M${a.x - (vertical ? 12 : 0)} ${a.y - (vertical ? 0 : 12)}l${vertical ? 24 : 0} ${vertical ? 0 : 24} M${b.x - (vertical ? 12 : 0)} ${b.y - (vertical ? 0 : 12)}l${vertical ? 24 : 0} ${vertical ? 0 : 24}`}/>
      <g className="measure-text" transform={`translate(${x} ${y})`}><text className="direction" y="-23">{name.toUpperCase()}</text><text className="value" y="13">{fmt(value)}<tspan> mm</tspan></text><path d="M-42 29H42"/></g>
    </g>; })}
  </g>;
}

function WholeCard({ report, explanation, side, photo, presentation, original, geometry, shapes, center, compact, onSelect, playing, reduced, replayKey, signalOffset, signalTotal, id, lastFindingId }) {
  const [focusedId, setFocusedId] = useState(null);
  const borders = useMemo(() => { if (!validQuad(geometry?.printedQuad)) return null; try { return measureSpeedsterCenteringBorders(geometry.printedQuad); } catch { return null; } }, [geometry]);
  const centering = explanation?.sides?.[side]?.centering;
  const edited = !original && Boolean(presentation);
  return <article className="study-card" data-side={side}><header><h2>{title(side)}</h2><span><i className="red-dot"/>{shapes.length} findings</span></header>
    <p className="presentation-note">{edited ? 'AI presentation · Measurements from original' : 'Original photograph · Saved measurements'}</p>
    <div className="finding-callout-stage"><svg className="card-stage" viewBox={calloutViewBox(side, compact)} role="group" aria-label={`${title(side)} photograph with saved defects and centering`}>
      <defs><filter id={`${id}-shadow`} x="-30%" y="-20%" width="160%" height="160%"><feDropShadow dx="0" dy="24" stdDeviation="23" floodColor="#102c34" floodOpacity=".12"/></filter></defs>
      <g filter={edited ? `url(#${id}-shadow)` : undefined}><image href={edited ? presentation : photo} width={W} height={H} preserveAspectRatio="none" aria-label={`${title(side)} ${edited ? 'AI presentation; alignment approximate; original available in inspection' : 'original saved photograph'}`}/></g>
      <g style={{ visibility: center ? 'visible' : 'hidden' }}><Instruments geometry={geometry} side={side} id={id} borders={borders}/></g>
      <g transform={`translate(${P} ${P})`} className="defect-layer">{shapes.filter(shape => shape.path && shape.bounds).map(({ finding, number, path, perimeter, bounds: b, scale }, index) => {
        const x = b.x + b.width / 2, y = b.y + b.height / 2, w = b.width, h = b.height;
        const key = `${id}-defect-${index}`, step = Math.max(1, Math.max(w, h) / 14), pad = Math.max(1.3, Math.max(w, h) * .045), tick = Math.max(.8, Math.max(w, h) * .018);
        return <g key={finding.id} role="button" tabIndex="0" aria-label={`Inspect ${title(side)} ${number}: ${pretty(finding.defectType)}`} data-finding-id={finding.id} aria-pressed={lastFindingId === finding.id} className="finding-hit" data-focused={focusedId === finding.id}
          onPointerEnter={() => setFocusedId(finding.id)} onPointerLeave={() => setFocusedId(null)} onFocus={() => setFocusedId(finding.id)} onBlur={() => setFocusedId(null)} onClick={() => onSelect(finding)} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); onSelect(finding); } }}>
          <defs><pattern id={`${key}-grid`} patternUnits="userSpaceOnUse" width={step} height={step}><path d={`M${step} 0H0V${step}`} className="defect-grid-line" strokeWidth={step * .1}/><circle r={step * .12} className="defect-grid-node"/></pattern></defs>
          <path d={path} className="exact-trace"/>
          <g transform={`translate(${x} ${y})`}><g className="breathing-trace" data-scale={scale} data-motion-finding={finding.id}><g transform={`translate(${-x} ${-y})`}>
            <path d={path} className="defect-wash"/><path d={path} fill={`url(#${key}-grid)`} className="defect-grid"/><path d={perimeter} className="defect-edge-under"/><path d={perimeter} className="defect-edge"/>
            <path className="defect-span" d={`M${b.x} ${b.y - pad}h${w} M${b.x} ${b.y - pad - tick}v${tick * 2} M${b.x + w} ${b.y - pad - tick}v${tick * 2} M${b.x + w + pad} ${b.y}v${h} M${b.x + w + pad - tick} ${b.y}h${tick * 2} M${b.x + w + pad - tick} ${b.y + h}h${tick * 2}`}/>
          </g></g></g><rect x={x - 45} y={y - 45} width="90" height="90" fill="transparent" className="finding-target"/>
        </g>;
      })}</g>
    </svg><FindingCallouts shapes={shapes} side={side} compact={compact} onSelect={onSelect} onFocus={setFocusedId} focusedId={focusedId} lastFindingId={lastFindingId} playing={playing} reduced={reduced} replayKey={replayKey} signalOffset={signalOffset} signalTotal={signalTotal}/></div>
    {borders && <div className="mobile-measurements" hidden={!center}>{[['Top', borders.topMm], ['Bottom', borders.bottomMm], ['Left', borders.leftMm], ['Right', borders.rightMm]].map(([name, value]) => <span key={name}><small>{name}</small><b>{fmt(value)} <em>mm</em></b></span>)}</div>}
    <div className="balances"><div><small>LEFT / RIGHT</small><b>{fmt(centering?.leftRightBalance?.[0])}<span> / </span>{fmt(centering?.leftRightBalance?.[1])}<em>%</em></b></div><div><small>TOP / BOTTOM</small><b>{fmt(centering?.topBottomBalance?.[0])}<span> / </span>{fmt(centering?.topBottomBalance?.[1])}<em>%</em></b></div><div className="centering-score"><small>CENTERING</small><b>{Number.isFinite(centering?.score) ? centering.score.toFixed(3) : '—'}<em>/ 10</em></b></div></div>
  </article>;
}

/** Display-only enhancement. Exact inspection remains in the existing explorer. */
export function ApprovedWholeCard({ report, explanation, images, geometry, photos, publication, activeSide, onChooseSide, onSelect, reduced = false, lastFinding = {}, controls, onControlsChange, motionState }) {
  const root = useRef(null), motion = useRef(null), defects = useRef([]);
  const token = useId().replaceAll(':', '');
  const { playing, original, center, sequence } = controls;
  const [compact, setCompact] = useState(false);
  const change = (key, value) => onControlsChange(previous => ({ ...previous, [key]: typeof value === 'function' ? value(previous[key]) : value }));
  const shapes = useMemo(() => Object.fromEntries(SIDES.map(side => [side, wholeCardShapes(report.findings, side)])), [report.findings]);
  const front = usePresentationImage(images?.FRONT?.presentation, { enabled: Boolean(photos.FRONT), side: 'FRONT', sourceSha256: report.inspection.front.imageSha256, publication });
  const back = usePresentationImage(images?.BACK?.presentation, { enabled: Boolean(photos.BACK), side: 'BACK', sourceSha256: report.inspection.back.imageSha256, publication });
  const presentations = { FRONT: front, BACK: back };
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 1100px)');
    const resize = () => setCompact(Boolean(query?.matches || root.current?.clientWidth > 0 && root.current.clientWidth < 1000));
    resize(); query?.addEventListener?.('change', resize);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize); if (root.current) observer?.observe(root.current);
    return () => { observer?.disconnect(); query?.removeEventListener?.('change', resize); };
  }, []);
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setOffscreen(!entries.some(entry => entry.isIntersecting)), { rootMargin: '40px' });
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!root.current) return;
    const context = gsap.context(() => {
      defects.current = Array.from(root.current.querySelectorAll('.breathing-trace')).map(element => gsap.to(element, { scale: Number(element.dataset.scale), svgOrigin: '0 0', duration: 2, ease: 'sine.inOut', repeat: -1, yoyo: true, paused: true }));
      const timeline = gsap.timeline({ repeat: -1, paused: true, defaults: { ease: 'power2.inOut' } }); motion.current = timeline;
      timeline.set('.axis-reveal-v', { attr: { height: 0 } }, 0).set('.axis-reveal-h', { attr: { width: 0 } }, 0)
        .set('.measure,.registration,.printed-frame,.center-lock,.head-v,.head-h', { opacity: 0 }, 0).set('.head-v', { y: 0 }, 0).set('.head-h', { x: 0 }, 0)
        .to('.registration', { opacity: .6, duration: .35 }, 0).to('.printed-frame', { opacity: .6, duration: .8 }, .25)
        .to('.head-v', { opacity: 1, duration: .15 }, .35).to('.axis-reveal-v', { attr: { height: CH }, duration: 1.4 }, .35).to('.head-v', { y: CH, duration: 1.4 }, .35)
        .to('.measure-top', { opacity: 1, duration: .35 }, .42).to('.measure-bottom', { opacity: 1, duration: .35 }, 1.55).to('.head-v', { opacity: 0, duration: .2 }, 1.65)
        .to('.head-h', { opacity: 1, duration: .15 }, 1.8).to('.axis-reveal-h', { attr: { width: CW }, duration: 1.35 }, 1.8).to('.head-h', { x: CW, duration: 1.35 }, 1.8)
        .to('.measure-left', { opacity: 1, duration: .35 }, 1.9).to('.measure-right', { opacity: 1, duration: .35 }, 2.95).to('.head-h', { opacity: 0, duration: .2 }, 3.05)
        .to('.center-lock', { opacity: .8, duration: .3 }, 3.15).to('.measure-h,.center-lock', { opacity: 0, duration: .35 }, 6.8).to('.axis-reveal-h', { attr: { width: 0 }, duration: .65 }, 6.85)
        .to('.measure-v', { opacity: 0, duration: .35 }, 7.35).to('.axis-reveal-v', { attr: { height: 0 }, duration: .65 }, 7.4).to('.registration,.printed-frame', { opacity: 0, duration: .4 }, 7.75).to({}, { duration: 1.45 }, 8.15);
      timeline.time(motionState.current.centering);
      defects.current.forEach(tween => tween.totalTime(motionState.current.defects[tween.targets()[0].dataset.motionFinding] ?? 0));
    }, root);
    return () => {
      motionState.current = { centering: motion.current?.time() ?? 0, defects: { ...motionState.current.defects, ...Object.fromEntries(defects.current.map(tween => [tween.targets()[0].dataset.motionFinding, tween.totalTime()])) } };
      context.revert(); motion.current = null; defects.current = [];
    };
  }, [shapes, compact, activeSide, motionState]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const update = () => {
      const run = playing && !reduced && !document.hidden && !offscreen;
      if (reduced) { motion.current?.pause().time(4); defects.current.forEach(tween => tween.pause().progress(.45)); }
      else { motion.current?.[run ? 'play' : 'pause'](); defects.current.forEach(tween => tween[run ? 'play' : 'pause']()); }
    };
    update(); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update);
  }, [playing, reduced, compact, activeSide, sequence, offscreen]);
  const replay = () => { if (!reduced) { motion.current?.restart(); defects.current.forEach(tween => tween.restart()); } onControlsChange(previous => ({ ...previous, playing: true, sequence: previous.sequence + 1 })); };
  const total = shapes.FRONT.length + shapes.BACK.length;
  return <div ref={root} className="rr-approved-whole" data-background={original ? 'original' : 'presentation'} data-compact={compact}>
    <nav className="study-toolbar" aria-label="Whole card controls"><div className="view-name">Whole card<span>Defects + centering</span></div><div className="actions">
      <button type="button" aria-pressed={original} disabled={!front && !back} onClick={() => change('original', value => !value)}>{original ? 'AI presentation' : 'Original photo'}</button>
      <button type="button" aria-pressed={center} onClick={() => change('center', value => !value)}>Centering {center ? 'on' : 'off'}</button><button type="button" onClick={replay}>↻ Replay</button>
      <button type="button" className="pause" disabled={reduced} onClick={() => change('playing', value => !value)}>{reduced ? 'Motion reduced' : playing ? 'Ⅱ Pause' : '▶ Play'}</button></div></nav>
    {compact && <div className="side-switch" role="group" aria-label="Whole card side">{SIDES.map(side => <button type="button" key={side} aria-pressed={side === activeSide} onClick={() => onChooseSide(side)}>{title(side)}<span>{shapes[side].length}</span></button>)}</div>}
    <section className="card-pair" aria-label="Centering and defects together">{(compact ? [activeSide] : SIDES).map(side => <WholeCard key={side} report={report} explanation={explanation} side={side} photo={photos[side]} presentation={presentations[side]} original={original} geometry={geometry?.[side]} shapes={shapes[side]} center={center} compact={compact} onSelect={onSelect} playing={playing && !offscreen} reduced={reduced} replayKey={sequence} signalOffset={compact || side === 'FRONT' ? 0 : shapes.FRONT.length} signalTotal={compact ? shapes[side].length : total} id={`whole-${token}-${side}`} lastFindingId={lastFinding[side]}/>)}</section>
    <footer className="study-notes"><span><i className="cyan-dot"/> Saved centering geometry <i className="red-dot"/> Saved defect traces</span><p>{!original && (front || back) ? 'AI presentation alignment is approximate. Measurements come from the original photographs; select a finding to inspect its original evidence.' : 'Select any finding to inspect its exact saved trace and measurements on the original photograph.'}</p></footer>
  </div>;
}
