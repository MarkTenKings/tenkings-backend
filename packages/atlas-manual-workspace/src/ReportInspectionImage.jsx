import React, { useEffect, useMemo, useRef, useState } from 'react';
import { speedsterTraceRleV1Spans } from '@atlas/grading-core/trace-codec';
import { useVerifiedImage } from './verified-image.mjs';
import { INSPECTION_SIZE, fitInspectionScale, clampInspectionPan, zoomInspectionAt,
  resizeInspectionView, focusInspectionBounds, canonicalInspectionPoint } from './inspection-viewport.mjs';
import { reportFindingAt, reportFindingBounds, reportFindingMask, reportFindingRegions } from './report-review-ui.mjs';

const name = side => side === 'FRONT' ? 'Front' : 'Back';
const words = value => value.toLowerCase().replaceAll('_', ' ');

function ReportMasks({ findings, selected, visible }) {
  const canvas = useRef(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d'); if (!context) return;
    context.clearRect(0, 0, 1270, 1778); if (!visible) return;
    for (const finding of findings) {
      if (finding.reviewResult === 'REMOVED') continue;
      context.fillStyle = finding.id === selected ? 'rgba(219,78,36,.64)' : 'rgba(238,170,45,.42)';
      const mask = reportFindingMask(finding);
      if (mask) for (const span of speedsterTraceRleV1Spans(mask)) context.fillRect(span.x, span.y, span.width, 1);
      else for (const region of reportFindingRegions(finding)) {
        context.beginPath();
        (region.canonicalContour ?? []).forEach((point, index) => context[index ? 'lineTo' : 'moveTo'](point.x * 1269, point.y * 1777));
        context.closePath(); context.fill();
      }
    }
  }, [findings, selected, visible]);
  return <canvas className="rr-mask" ref={canvas} width={1270} height={1778} aria-hidden="true"/>;
}

/** No edit/action callbacks: every control here changes only the displayed view. */
export function ReportInspectionImage({ side, descriptor, expectedHash, findings, selected, onSelect, expanded, hidden, onExpand, onReady }) {
  const supplied = descriptor?.sha256 === expectedHash && descriptor?.url ? descriptor : null;
  const image = useVerifiedImage(supplied), [loaded, setLoaded] = useState(null);
  const ready = Boolean(supplied && image.url && loaded === image.url);
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } }), [size, setSize] = useState({ width: 400, height: 540 });
  const sizeRef = useRef(size), viewport = useRef(null), plane = useRef(null), gesture = useRef(null);
  const [overlays, setOverlays] = useState(true), [magnifier, setMagnifier] = useState(false), [lens, setLens] = useState(null);
  const bounds = useMemo(() => findings.map(finding => ({ finding, bounds: reportFindingBounds(finding) })), [findings]);
  const scale = fitInspectionScale(size), zoom = view.zoom;
  const fit = () => { setView({ zoom: 1, pan: { x: 0, y: 0 } }); setLens(null); };
  const changeZoom = next => { setView(previous => zoomInspectionAt(previous, next, { x: size.width / 2, y: size.height / 2 }, size)); setLens(null); };
  useEffect(() => { onReady(side, ready); return () => onReady(side, false); }, [side, ready, onReady]);
  useEffect(() => {
    const element = viewport.current; if (!element || typeof ResizeObserver === 'undefined') return;
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      const next = { width: element.clientWidth, height: element.clientHeight }, previous = sizeRef.current;
      if (next.width === previous.width && next.height === previous.height) return;
      sizeRef.current = next; setSize(next); setView(value => resizeInspectionView(value, previous, next)); gesture.current = null; setLens(null);
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!ready || hidden || !selected) return;
    const target = bounds.find(entry => entry.finding.id === selected.id);
    if (!target?.bounds) return;
    setView(focusInspectionBounds(target.bounds, sizeRef.current)); setLens(null);
    viewport.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [selected, bounds, ready, hidden]);
  useEffect(() => {
    const element = viewport.current; if (!element?.addEventListener) return;
    const wheel = event => {
      if (!ready || gesture.current) return;
      event.preventDefault(); const box = element.getBoundingClientRect(), factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      setView(previous => zoomInspectionAt(previous, previous.zoom * Math.exp(-event.deltaY * factor * .002), { x: event.clientX - box.left, y: event.clientY - box.top }, size)); setLens(null);
    };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, [ready, size]);
  const pointerDown = event => {
    if (!ready || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault(); viewport.current?.focus?.({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: view.pan, moved: false }; setLens(null);
  };
  const pointerMove = event => {
    const current = gesture.current;
    if (current) {
      if (current.id !== event.pointerId) return;
      const dx = event.clientX - current.x, dy = event.clientY - current.y;
      if (Math.hypot(dx, dy) > 4) current.moved = true;
      if (current.moved) setView(previous => ({ ...previous, pan: clampInspectionPan({ x: current.pan.x + dx, y: current.pan.y + dy }, previous.zoom, size) }));
      return;
    }
    if (!ready || !magnifier) return;
    const box = plane.current?.getBoundingClientRect(); if (!box) return;
    const x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
    setLens(x >= 0 && y >= 0 && x <= 1 && y <= 1 ? { x, y, right: event.clientX - viewport.current.getBoundingClientRect().left < size.width / 2 } : null);
  };
  const pointerUp = event => {
    const current = gesture.current; if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!current.moved && overlays) {
      const finding = reportFindingAt(findings, canonicalInspectionPoint({ x: event.clientX, y: event.clientY }, plane.current?.getBoundingClientRect()));
      if (finding) onSelect(finding);
    }
  };
  const keyboard = event => {
    if (!ready || event.target !== event.currentTarget || gesture.current) return;
    const moves = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
    if (moves[event.key]) { event.preventDefault(); const [x, y] = moves[event.key]; setView(previous => ({ ...previous, pan: clampInspectionPan({ x: previous.pan.x + x, y: previous.pan.y + y }, previous.zoom, size) })); }
    else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); changeZoom(zoom * (event.key === '-' ? 1 / 1.25 : 1.25)); }
    else if (event.key === '0' || event.key === 'Home') { event.preventDefault(); fit(); }
    else if (event.key === 'Escape') { setLens(null); if (expanded) onExpand(null); }
  };
  return <section className={`rr-image-side${expanded ? ' rr-image-expanded' : ''}`} hidden={hidden} aria-label={`${name(side)} report image`}>
    <header><h3>{name(side)}</h3><button type="button" onClick={() => onExpand(expanded ? null : side)}>{expanded ? 'Return to pair' : 'Expand image'}</button></header>
    <div className="rr-image-tools"><label>Zoom <select aria-label={`${name(side)} report zoom`} value={zoom} disabled={!ready} onChange={event => changeZoom(Number(event.target.value))}>
      {[1, 2, 4, 8, 16, ...([1, 2, 4, 8, 16].includes(zoom) ? [] : [zoom])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value === 1 ? 'Fit' : `${Number(value.toFixed(1))}×`}</option>)}
    </select></label><button type="button" onClick={fit} disabled={!ready}>Fit image</button><button type="button" aria-pressed={!overlays} disabled={!ready} onClick={() => setOverlays(value => !value)}>{overlays ? 'Hide findings' : 'Show findings'}</button><button type="button" aria-pressed={magnifier} disabled={!ready} onClick={() => { setMagnifier(value => !value); setLens(null); }}>3× magnifier</button></div>
    <div className="rr-viewport" ref={viewport} tabIndex={0} role="group" aria-label={`${name(side)} report inspection`} onKeyDown={keyboard} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { gesture.current = null; setLens(null); }} onLostPointerCapture={() => { gesture.current = null; }} onPointerLeave={() => setLens(null)}>
      {image.url && <div className="rr-plane" ref={plane} style={{ width: INSPECTION_SIZE.width * scale * zoom, height: INSPECTION_SIZE.height * scale * zoom, transform: `translate(calc(-50% + ${view.pan.x}px), calc(-50% + ${view.pan.y}px))` }}>
        <img src={image.url} alt={`${name(side)} saved inspection photograph`} draggable={false} onLoad={event => setLoaded(event.currentTarget.naturalWidth === INSPECTION_SIZE.width && event.currentTarget.naturalHeight === INSPECTION_SIZE.height ? image.url : 'INVALID_DIMENSIONS')} onError={() => setLoaded('IMAGE_ERROR')}/>
        {ready && <div className="rr-card-plane"><ReportMasks findings={findings} selected={selected?.id} visible={overlays}/>
          {overlays && <svg viewBox="0 0 1270 1778" className="rr-finding-markers" aria-hidden="true">{bounds.filter(entry => entry.bounds && entry.finding.reviewResult !== 'REMOVED').map(({ finding, bounds: box }) => <g key={finding.id} className={selected?.id === finding.id ? 'rr-active-marker' : ''}>
            <rect x={box.x * 1270} y={box.y * 1778} width={Math.max(1, box.width * 1270)} height={Math.max(1, box.height * 1778)}/>
          </g>)}</svg>}
        </div>}
      </div>}
      {!ready && <p className="rr-image-status" role="status">{!supplied ? 'This report’s saved photograph is unavailable.' : image.error || loaded === 'IMAGE_ERROR' ? 'Could not verify the saved photograph. Reload images to try again.' : loaded === 'INVALID_DIMENSIONS' ? 'The saved photograph has unexpected dimensions. Reload images before continuing.' : 'Loading verified photograph…'}</p>}
      {ready && magnifier && lens && <div className="rr-magnifier" aria-hidden="true" style={{ [lens.right ? 'right' : 'left']: 12, backgroundImage: `url("${image.url}")`, backgroundSize: `${INSPECTION_SIZE.width * scale * zoom * 3}px ${INSPECTION_SIZE.height * scale * zoom * 3}px`, backgroundPosition: `${90 - lens.x * INSPECTION_SIZE.width * scale * zoom * 3}px ${90 - lens.y * INSPECTION_SIZE.height * scale * zoom * 3}px` }}><span>3× · image only</span></div>}
    </div>
    <p className="rr-help">Click a marked defect or its finding below. Drag to pan; scroll to zoom. Arrow keys pan; + / − zoom; 0 fits.</p>
    <div className="rr-side-findings">{findings.filter(finding => finding.reviewResult !== 'REMOVED').map((finding, index) => <button type="button" key={finding.id} disabled={!ready} aria-pressed={selected?.id === finding.id} onClick={() => onSelect(finding)}>{name(side)} {index + 1} · {words(finding.defectType)}</button>)}{!findings.some(finding => finding.reviewResult !== 'REMOVED') && <p>No included findings on {name(side)}.</p>}</div>
  </section>;
}
