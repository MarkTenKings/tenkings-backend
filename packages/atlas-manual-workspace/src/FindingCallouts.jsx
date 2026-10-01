import React, { useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { calloutViewBox, calloutFrame, findingCalloutLayout, WHOLE_FRAME } from './whole-card-layout.mjs';

const SIDE_NAME = { FRONT: 'Front', BACK: 'Back' };
const fullName = finding => String(finding.defectType ?? finding.type ?? 'Finding')
  .toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
const shortName = finding => fullName(finding)
  .replace(/^Light scratch scuff$/, 'Scratch / scuff')
  .replace(/^Visible whitening$/, 'Whitening')
  .replace(/^Visible scratch print coating loss$/, 'Print coating loss');

/** Place directly after .card-stage inside .finding-callout-stage.
 * onFocus receives a finding ID or null; onSelect receives the original finding.
 * Pass signalOffset/signalTotal across the pair for one traveling signal at a
 * time. A single visible card can use the defaults. No measurements are inferred.
 */
export function FindingCallouts({ shapes, side, compact = false, onSelect, onFocus,
  focusedId = null, lastFindingId = null, playing = true, reduced = false, replayKey = 0,
  signalOffset = 0, signalTotal = shapes.length }) {
  const root = useRef(null);
  const motion = useRef({ entry: null, signal: null });
  const entryFinished = useRef(false);
  const visibility = useRef(true);
  const controls = useRef(() => {});
  const [width, setWidth] = useState(660);
  const [localFocus, setLocalFocus] = useState(null);
  const activeId = focusedId ?? localFocus;
  const layout = useMemo(() => findingCalloutLayout(shapes, side, width), [shapes, side, width]);
  const flow = compact || layout.flowing;
  const { x: viewX, y: viewY, width: viewWidth, height: viewHeight } = calloutFrame(side, compact);

  useEffect(() => {
    const element = root.current;
    if (!element || compact) return;
    const measure = () => {
      const next = element.getBoundingClientRect().width;
      if (next > 0) setWidth(current => Math.abs(current - next) > 1 ? next : current);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [compact, side]);

  useEffect(() => {
    if (!gsap || !root.current || reduced) return;
    entryFinished.current = false;
    const context = gsap.context(() => {
      const entry = gsap.timeline({ paused: true, onComplete: () => { entryFinished.current = true; controls.current(); } });
      const source = root.current.querySelectorAll('.fc-source-flash');
      const connections = root.current.querySelectorAll('.fc-leader-draw');
      const content = root.current.querySelectorAll('.fc-label-content');
      const accents = root.current.querySelectorAll('.fc-label-accent');
      if (source.length) entry.fromTo(source, { opacity: 0 }, { opacity: .85, duration: .16, stagger: { amount: .08 } }, 0)
        .to(source, { opacity: 0, duration: .25, stagger: { amount: .08 } }, .5);
      if (connections.length) entry.fromTo(connections, { strokeDashoffset: 1, opacity: .85 },
        { strokeDashoffset: 0, autoRound: false, duration: .44, stagger: { amount: .1 }, ease: 'power2.inOut' }, .14)
        .to(connections, { opacity: 0, duration: .2, stagger: { amount: .08 } }, .72);
      // Labels and their hit targets are present from the first frame. The
      // small finishing movement never gates reading, focus, or activation.
      entry.fromTo(content, { opacity: .78, x: side === 'FRONT' ? 3 : -3 },
        { opacity: 1, x: 0, duration: .2, stagger: { amount: .12 }, ease: 'power2.out' }, .55)
        .fromTo(accents, { scaleX: 0 }, { scaleX: 1, duration: .2, stagger: { amount: .12 }, ease: 'power2.out' }, .58);
      motion.current.entry = entry;
      if (!playing) { entry.progress(1).pause(); entryFinished.current = true; }

      const signals = [...root.current.querySelectorAll('.fc-leader-signal')];
      if (signals.length) {
        const total = Math.max(signalTotal, signalOffset + signals.length, 1);
        const slot = 1.8, cycle = total * slot;
        const signal = gsap.timeline({ paused: true, repeat: -1 });
        signals.forEach((element, index) => {
          const at = (signalOffset + index) * slot + .12;
          signal.set(element, { opacity: 0, strokeDashoffset: 0 }, at)
            .to(element, { opacity: .85, duration: .12 }, at)
            .to(element, { strokeDashoffset: -.95, autoRound: false, duration: 1.08, ease: 'none' }, at)
            .to(element, { opacity: 0, duration: .18 }, at + .9);
        });
        signal.to({}, { duration: .01 }, cycle - .01);
        // Both side components share the GSAP clock. Their non-overlapping
        // slots stay aligned even if React mounts them in separate effects.
        signal.time(gsap.globalTimeline.time() % cycle);
        motion.current.signal = signal;
      }
    }, root);
    controls.current();
    return () => { context.revert(); motion.current = { entry: null, signal: null }; };
  }, [layout, flow, reduced, replayKey, side, signalOffset, signalTotal]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const update = () => {
      const run = playing && !reduced && !document.hidden && visibility.current;
      motion.current.entry?.[run ? 'play' : 'pause']();
      const signal = motion.current.signal;
      if (signal) {
        if (run && !activeId && entryFinished.current) {
          // Rejoin the shared clock after hover, tab hiding, or offscreen
          // suspension; independent pauses must not create duplicate signals.
          signal.time(gsap.globalTimeline.time() % signal.duration()).play();
        } else signal.pause();
      }
      root.current?.setAttribute('data-signal-muted', String(Boolean(activeId) || reduced));
    };
    controls.current = update;
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [playing, reduced, activeId, layout, replayKey, flow, signalOffset, signalTotal]);

  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      visibility.current = entries.some(entry => entry.isIntersecting);
      controls.current();
    }, { rootMargin: '40px' });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [flow]);

  const focus = id => { setLocalFocus(id); onFocus?.(id); };
  const leave = event => { if (!event.currentTarget.contains(document.activeElement)) focus(null); };
  if (!shapes.length) return null;

  return <div ref={root} className={`finding-callouts${flow ? ' finding-callouts-flow' : ''}`}
    data-side={side} data-signal-muted={Boolean(activeId) || reduced}>
    {!flow && <svg className="fc-leaders" viewBox={calloutViewBox(side, compact)} aria-hidden="true" focusable="false">
      {layout.items.map(item => {
        const position = layout.positions.get(item.finding.id);
        if (!position) return null;
        return <g key={item.finding.id} className={`fc-connection${activeId === item.finding.id ? ' is-active' : ''}`} data-finding-id={item.finding.id}>
          <path d={item.path} transform={`translate(${WHOLE_FRAME.padding} ${WHOLE_FRAME.padding})`} className="fc-source-flash"/>
          <path d={item.path} transform={`translate(${WHOLE_FRAME.padding} ${WHOLE_FRAME.padding})`} className="fc-source-focus"/>
          <path d={position.path} className="fc-leader-under"/>
          <path d={position.path} className="fc-leader-base"/>
          <path d={position.path} pathLength="1" className="fc-leader-draw"/>
          <path d={position.path} pathLength="1" className="fc-leader-signal"/>
          <path d={`M${side === 'FRONT' ? position.x + position.width : position.x} ${position.y - 10}v20`} className="fc-terminal"/>
        </g>;
      })}
    </svg>}
    <div className="fc-labels" role="group" aria-label={`${SIDE_NAME[side]} finding callouts`}>
      {layout.items.map(item => {
        const position = layout.positions.get(item.finding.id), b = item.bounds;
        const active = activeId === item.finding.id;
        const style = flow || !position ? undefined : {
          left: `${(position.x - viewX) / viewWidth * 100}%`,
          top: `${(position.y - viewY) / viewHeight * 100}%`,
          width: `${position.width / viewWidth * 100}%`,
        };
        return <button type="button" className={`fc-label${active ? ' is-active' : ''}`} key={item.finding.id} style={style}
          data-finding-id={item.finding.id} aria-pressed={lastFindingId === item.finding.id}
          aria-label={`Inspect ${SIDE_NAME[side]} ${item.number}: ${fullName(item.finding)}`}
          onPointerEnter={() => focus(item.finding.id)} onPointerLeave={leave}
          onFocus={() => focus(item.finding.id)} onBlur={() => focus(null)}
          onClick={() => onSelect?.(item.finding)}>
          <span className="fc-label-content">
            <svg className="fc-icon" viewBox={b ? `${b.x - 1} ${b.y - 1} ${Math.max(1, b.width) + 2} ${Math.max(1, b.height) + 2}` : '0 0 24 24'} aria-hidden="true" focusable="false"><path d={item.path}/></svg>
            <span className="fc-number">{SIDE_NAME[side]} {item.number}<span className="fc-arrow" aria-hidden="true">↗</span></span>
            <span className="fc-name">{shortName(item.finding)}</span>
          </span>
          <span className="fc-label-accent" aria-hidden="true"/>
        </button>;
      })}
    </div>
  </div>;
}

export default FindingCallouts;
