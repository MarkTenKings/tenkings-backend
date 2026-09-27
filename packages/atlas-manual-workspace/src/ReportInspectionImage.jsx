import React, { useEffect, useMemo, useRef, useState } from 'react';
import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { useVerifiedImage } from './verified-image.mjs';
import { INSPECTION_SIZE, fitInspectionScale, clampInspectionPan, zoomInspectionAt,
  resizeInspectionView, focusInspectionBounds, canonicalInspectionPoint } from './inspection-viewport.mjs';
import { reportFindingAt, reportFindingBounds, reportFindingMask, reportFindingRegions,
  reportMarkedSpan, reportSpanRuler, reportMeasurementPlacement, reportPinchView, reportMinimap, reportCropBounds, reportTraceSpans } from './report-review-ui.mjs';

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
      if (mask) for (const span of reportTraceSpans(mask)) context.fillRect(span.x, span.y, span.width, 1);
      else for (const region of reportFindingRegions(finding)) {
        context.beginPath();
        (region.canonicalContour ?? []).forEach((point, index) => context[index ? 'lineTo' : 'moveTo'](point.x * 1269, point.y * 1777));
        context.closePath(); context.fill();
      }
    }
  }, [findings, selected, visible]);
  return <canvas className="rr-mask" ref={canvas} width={1270} height={1778} aria-hidden="true"/>;
}

const dimension = value => Number.isFinite(value) ? (value !== 0 && Math.abs(value) < .0001 ? value.toExponential(2) : value.toLocaleString('en-US', { maximumFractionDigits: 4 })) : 'Unavailable';
const clampLabel = (value, limit, gutter = 28) => Math.max(gutter, Math.min(limit - gutter, value));
/** Labels stay in screen pixels while their leaders follow the verified card frame. */
function Blueprint({ finding, explanation, centering, policy, side, printed, view, size, scale, locatorBox, outside = false }) {
  const [regionIndex, setRegionIndex] = useState(0);
  useEffect(() => setRegionIndex(0), [finding?.id]);
  const project = point => ({ x: size.width / 2 + view.pan.x + (40 + point.x * 1270 - 675) * scale * view.zoom,
    y: size.height / 2 + view.pan.y + (40 + point.y * 1778 - 929) * scale * view.zoom });
  if (!finding) {
    if (outside || !printed) return null;
    let borders; try { borders = measureSpeedsterCenteringBorders(printed); } catch { return null; }
    const labels = [
      { p: { x: .5, y: printed[0].y / 2 }, label: `Top ${dimension(borders.topMm)} mm · ${dimension(centering?.topBottomBalance?.[0])}%` },
      { p: { x: (1 + printed[1].x) / 2, y: .5 }, label: `Right ${dimension(borders.rightMm)} mm · ${dimension(centering?.leftRightBalance?.[1])}%` },
      { p: { x: .5, y: (1 + printed[2].y) / 2 }, label: `Bottom ${dimension(borders.bottomMm)} mm · ${dimension(centering?.topBottomBalance?.[1])}%` },
      { p: { x: printed[3].x / 2, y: .5 }, label: `Left ${dimension(borders.leftMm)} mm · ${dimension(centering?.leftRightBalance?.[0])}%` },
    ];
    const effect = policy && centering && (10 - centering.score) * (side === 'FRONT' ? policy.frontWeight : policy.backWeight) * policy.categoryWeight;
    return <div className="rr-blueprint" aria-label={`${name(side)} centering measurements`}>{labels.map(({p, label}) => { const point = project(p); return <span className="rr-dimension-label" key={label} style={{left: clampLabel(point.x, size.width, 64), top: clampLabel(point.y, size.height)}}>{label}</span>; })}
      <div className="rr-centering-readout">Centering <b>{dimension(centering?.score)} / 10</b><span>{dimension(effect)} pts from unrounded grade · versus a perfect {name(side).toLowerCase()}</span></div>
    </div>;
  }
  if (finding.reviewResult === 'REMOVED') return null;
  const regions = reportFindingRegions(finding), region = regions[regionIndex] ?? regions[0], measured = region?.measurement;
  const effect = explanation?.regions?.find(value => value.zone === region?.zone);
  const box = reportFindingBounds(finding), span = reportMarkedSpan(finding), ruler = reportSpanRuler(span, project);
  if (!box || !measured) return null;
  const a = project(box), b = project({x:box.x+box.width,y:box.y+box.height});
  const position = reportMeasurementPlacement(size, [
    {x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y}, ...(ruler ? [ruler.bounds] : []),
    ...(locatorBox ? [locatorBox] : []), {x:0,y:0,width:size.width,height:36},
  ]);
  const callout = <div className={`rr-measure-callout${outside ? ' rr-measure-outside' : ''}`} style={outside ? undefined : {left:position?.x,top:position?.y}}
    onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
    <div className="rr-span-readout"><b>{span ? `${dimension(span.mm)} mm` : 'Unavailable'}</b> maximum marked span</div>
    <div className="rr-region-tabs">{regions.length===1?<span>{words(region.zone)}</span>:regions.map((value,index)=><button type="button" key={index} aria-pressed={regionIndex===index} onClick={()=>setRegionIndex(index)}>{words(value.zone)}</button>)}</div>
    <strong>{dimension(measured.areaMm2)} mm² <small>measured damage</small></strong>
    <p>{effect ? <><b>{dimension(effect.marginalOverallEffect)} pts</b> effect on unrounded grade</> : 'Grade effect unavailable'}</p>
    <small>Straight span of saved pixels. Region effects are not additive.</small>
  </div>;
  if (outside) return position ? null : callout;
  return <div className="rr-blueprint rr-defect-blueprint" aria-label={`${name(side)} finding dimensions and grade effect`}>
    {ruler && <svg width={size.width} height={size.height} aria-hidden="true"><path className="rr-ruler-contrast" d={ruler.path}/><path d={ruler.path}/></svg>}
    {position && callout}
  </div>;

}

/** No edit/action callbacks: every control here changes only the displayed view. */
export function ReportInspectionImage({ side, descriptor, expectedHash, findings, selected, onSelect, expanded, hidden, onExpand, onReady,
  geometry, showFindingButtons = true, compact = false, layerOptions, findingsVisible, command, onViewChange, onActivate, cleanComparison = false, blueprint = true, explanation, centering, policy }) {
  const supplied = descriptor?.sha256 === expectedHash && descriptor?.url ? descriptor : null;
  const image = useVerifiedImage(supplied), [loaded, setLoaded] = useState(null);
  const ready = Boolean(supplied && image.url && loaded === image.url);
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } }), [size, setSize] = useState({ width: 400, height: 540 });
  const sizeRef = useRef(size), viewport = useRef(null), plane = useRef(null), gesture = useRef(null);
  const pointers = useRef(new Map()), viewRef = useRef(view); viewRef.current = view;
  const [localOverlays, setOverlays] = useState(true), [magnifier, setMagnifier] = useState(false), [lens, setLens] = useState(null);
  const [localLayers, setLayers] = useState({ physical: true, printed: true, centering: true });
  const [transition, setTransition] = useState(false);
  const layers = layerOptions ?? localLayers, overlays = findingsVisible ?? localOverlays;
  const bounds = useMemo(() => { let number = 0; return findings.map(finding => ({ finding,
    number: finding.reviewResult === 'REMOVED' ? null : ++number, bounds: reportFindingBounds(finding) })); }, [findings]);
  const selectedBounds = bounds.find(entry => entry.finding.id === selected?.id)?.bounds;
  const crop = reportCropBounds(selectedBounds), map = reportMinimap(view, size);
  const quad = value => Array.isArray(value) && value.length === 4 && value.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
  const physical = quad(geometry?.physicalQuad) ? geometry.physicalQuad : null, printed = quad(geometry?.printedQuad) ? geometry.printedQuad : null;
  const scale = fitInspectionScale(size), zoom = view.zoom;
  const focusedFinding = bounds.find(entry=>entry.finding.id===selected?.id)?.finding;
  const project = point => ({x:size.width/2+view.pan.x+(40+point.x*1270-675)*scale*zoom,y:size.height/2+view.pan.y+(40+point.y*1778-929)*scale*zoom});
  const spanRuler = focusedFinding && reportSpanRuler(reportMarkedSpan(focusedFinding),project);
  const projectedBox = selectedBounds && (()=>{const a=project(selectedBounds),b=project({x:selectedBounds.x+selectedBounds.width,y:selectedBounds.y+selectedBounds.height});return {x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y};})();
  const locatorWidth=Math.min(124,size.width*.4),locatorHeight=locatorWidth*1858/1350+4;
  const locatorBox = reportMeasurementPlacement(size,[...(projectedBox?[projectedBox]:[]),...(spanRuler?[spanRuler.bounds]:[])],locatorWidth,locatorHeight);

  const fit = () => { setView({ zoom: 1, pan: { x: 0, y: 0 } }); setLens(null); };
  const changeZoom = next => { setView(previous => zoomInspectionAt(previous, next, { x: size.width / 2, y: size.height / 2 }, size)); setLens(null); };
  useEffect(() => { onViewChange?.(side, zoom); }, [side, zoom, onViewChange]);
  useEffect(() => {
    if (!command || command.side !== side) return;
    setTransition(true);
    if (command.type === 'FIT') fit();
    if (command.type === 'ZOOM') changeZoom(command.zoom);
  }, [command]);
  useEffect(() => { onReady(side, ready, expectedHash); return () => onReady(side, false, expectedHash); }, [side, ready, expectedHash, onReady]);
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
    setTransition(true); setView(focusInspectionBounds(target.bounds, sizeRef.current)); setLens(null);
    viewport.current?.scrollIntoView?.({ block: typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches ? 'start' : 'nearest', behavior: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [selected, bounds, ready, hidden]);
  useEffect(() => {
    const element = viewport.current; if (!element?.addEventListener) return;
    const wheel = event => {
      if (!ready || gesture.current) return;
      event.preventDefault(); setTransition(false); onActivate?.(side); const box = element.getBoundingClientRect(), factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      setView(previous => zoomInspectionAt(previous, previous.zoom * Math.exp(-event.deltaY * factor * .002), { x: event.clientX - box.left, y: event.clientY - box.top }, size)); setLens(null);
    };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, [ready, size, onActivate, side]);
  const localPoint = event => { const box = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top }; };
  const beginGesture = () => {
    const points = [...pointers.current.values()];
    if (points.length >= 2) gesture.current = { kind: 'pinch', view: viewRef.current,
      midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y), moved: true };
    else if (points.length) gesture.current = { kind: 'pan', point: points[0], pan: viewRef.current.pan, moved: true };
    else gesture.current = null;
  };
  const pointerDown = event => {
    if (!ready || (event.pointerType !== 'touch' && event.button !== 0) || pointers.current.size >= 2) return;
    event.preventDefault(); setTransition(false); onActivate?.(side); viewport.current?.focus?.({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, localPoint(event)); beginGesture();
    if (pointers.current.size === 1) gesture.current.moved = false;
    setLens(null);
  };
  const pointerMove = event => {
    const current = gesture.current;
    if (current) {
      if (!pointers.current.has(event.pointerId)) return;
      const point = localPoint(event); pointers.current.set(event.pointerId, point);
      if (current.kind === 'pinch') { setView(reportPinchView(current, [...pointers.current.values()], size)); return; }
      const dx = point.x - current.point.x, dy = point.y - current.point.y;
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
    const current = gesture.current; if (!current || !pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (current.kind === 'pan' && !current.moved && overlays) {
      const finding = reportFindingAt(findings, canonicalInspectionPoint({ x: event.clientX, y: event.clientY }, plane.current?.getBoundingClientRect()));
      if (finding) onSelect(finding);
    }
    beginGesture();
  };
  const cancelPointer = event => { pointers.current.delete(event.pointerId); beginGesture(); setLens(null); };
  const keyboard = event => {
    if (!ready || event.target !== event.currentTarget || gesture.current) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '0', 'Home', 'Escape'].includes(event.key)) event.stopPropagation?.();
    setTransition(false);
    const moves = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
    if (moves[event.key]) { event.preventDefault(); const [x, y] = moves[event.key]; setView(previous => ({ ...previous, pan: clampInspectionPan({ x: previous.pan.x + x, y: previous.pan.y + y }, previous.zoom, size) })); }
    else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); changeZoom(zoom * (event.key === '-' ? 1 / 1.25 : 1.25)); }
    else if (event.key === '0' || event.key === 'Home') { event.preventDefault(); fit(); }
    else if (event.key === 'Escape') { setLens(null); if (expanded) onExpand(null); }
  };
  const locator = ready && zoom > 1 ? <button className={`rr-minimap${locatorBox ? '' : ' rr-locator-outside'}`} style={locatorBox ? {left:locatorBox.x,top:locatorBox.y,right:'auto',bottom:'auto',width:locatorWidth,height:locatorHeight,maxWidth:'none'} : {width:locatorWidth,height:locatorHeight,maxWidth:'none'}} type="button" aria-label={`Recenter ${name(side)} photograph; keyboard activation fits image`} onPointerDown={event => event.stopPropagation()} onClick={event => {
        if (!event.detail) { fit(); return; }
        const box = event.currentTarget.getBoundingClientRect(), x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
        setView(previous => ({ ...previous, pan: clampInspectionPan({ x: (.5 - x) * INSPECTION_SIZE.width * scale * previous.zoom, y: (.5 - y) * INSPECTION_SIZE.height * scale * previous.zoom }, previous.zoom, size) }));
      }}><img src={image.url} alt="" draggable={false}/><span style={{ left: `${map.x * 100}%`, top: `${map.y * 100}%`, width: `${map.width * 100}%`, height: `${map.height * 100}%` }}/></button> : null;
  return <section className={`rr-image-side${expanded ? ' rr-image-expanded' : ''}`} hidden={hidden} aria-label={`${name(side)} report image`}>
    {!compact && <><header><h3>{name(side)}</h3><button type="button" onClick={() => onExpand(expanded ? null : side)}>{expanded ? 'Return to pair' : 'Expand image'}</button></header>
    <div className="rr-image-tools"><label>Zoom <select aria-label={`${name(side)} report zoom`} value={zoom} disabled={!ready} onChange={event => changeZoom(Number(event.target.value))}>
      {[1, 2, 4, 8, 16, ...([1, 2, 4, 8, 16].includes(zoom) ? [] : [zoom])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value === 1 ? 'Fit' : `${Number(value.toFixed(1))}×`}</option>)}
    </select></label><button type="button" onClick={fit} disabled={!ready}>Fit image</button><button type="button" aria-pressed={!overlays} disabled={!ready} onClick={() => setOverlays(value => !value)}>{overlays ? 'Hide findings' : 'Show findings'}</button><button type="button" aria-pressed={magnifier} disabled={!ready} onClick={() => { setMagnifier(value => !value); setLens(null); }}>3× magnifier</button></div>
    <div className="rr-layer-tools" aria-label={`${name(side)} evidence layers`}>{[['physical', 'Card edge', physical], ['printed', 'Printed border', printed], ['centering', 'Centering guides', printed]].map(([key, label, available]) => <button key={key} type="button" aria-pressed={layers[key]} disabled={!ready || !available} onClick={() => setLayers(old => ({ ...old, [key]: !old[key] }))}>{label}</button>)}</div></>}
    <div className={`rr-synchronized-pair${cleanComparison && selectedBounds ? ' rr-show-clean' : ''}`}>
    <div className="rr-viewport" ref={viewport} tabIndex={0} role="group" aria-label={`${name(side)} report inspection`} onKeyDown={keyboard} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer} onPointerLeave={() => setLens(null)}>
      {image.url && <div className="rr-plane" ref={plane} data-transition={transition} style={{ width: INSPECTION_SIZE.width * scale * zoom, height: INSPECTION_SIZE.height * scale * zoom, transform: `translate(calc(-50% + ${view.pan.x}px), calc(-50% + ${view.pan.y}px))` }}>
        <img src={image.url} alt={`${name(side)} saved inspection photograph`} draggable={false} onLoad={event => setLoaded(event.currentTarget.naturalWidth === INSPECTION_SIZE.width && event.currentTarget.naturalHeight === INSPECTION_SIZE.height ? image.url : 'INVALID_DIMENSIONS')} onError={() => setLoaded('IMAGE_ERROR')}/>
        {ready && <div className="rr-card-plane"><ReportMasks findings={findings} selected={selected?.id} visible={overlays}/>
          <svg viewBox="0 0 1270 1778" className="rr-geometry-layers" aria-hidden="true">
            {layers.physical && physical && <polygon className="rr-physical-line" points={physical.map(p => `${p.x * 1270},${p.y * 1778}`).join(' ')}/>}
            {layers.printed && printed && <polygon className="rr-printed-line" points={printed.map(p => `${p.x * 1270},${p.y * 1778}`).join(' ')}/>}
            {layers.centering && printed && <g className="rr-centering-line"><path d="M635 0V1778 M0 889H1270"/>{printed.map((p, index) => { const q = printed[(index + 1) % 4], x = (p.x + q.x) / 2 * 1270, y = (p.y + q.y) / 2 * 1778; return <line key={index} x1={x} y1={y} x2={index % 2 ? index === 1 ? 1270 : 0 : x} y2={index % 2 ? y : index === 0 ? 0 : 1778}/>; })}</g>}
          </svg>
          {overlays && <svg viewBox="0 0 1270 1778" className="rr-finding-markers" aria-hidden="true">{bounds.filter(entry => entry.bounds && entry.finding.reviewResult !== 'REMOVED').map(({ finding, bounds: box }) => <g key={finding.id} className={selected?.id === finding.id ? 'rr-active-marker' : ''}>
            {selected?.id !== finding.id && <rect x={box.x * 1270} y={box.y * 1778} width={Math.max(1, box.width * 1270)} height={Math.max(1, box.height * 1778)}/>}
          </g>)}</svg>}
          {overlays && bounds.filter(entry => entry.bounds && entry.finding.reviewResult !== 'REMOVED').map(({ finding, bounds: box, number }) => <button type="button" key={finding.id} className={`rr-marker-button${selected?.id === finding.id ? ' rr-selected-pin' : ''}`}
            aria-label={`Inspect ${name(side)} finding ${number}: ${words(finding.defectType)}`} aria-pressed={selected?.id === finding.id}
            style={{ left: `${Math.min(1 - 16 / (1270 * scale * zoom), Math.max(16 / (1270 * scale * zoom), box.x)) * 100}%`, top: `${Math.min(1 - 16 / (1778 * scale * zoom), Math.max(16 / (1778 * scale * zoom), box.y)) * 100}%` }}
            onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onKeyDown={event => { if (!['[', ']'].includes(event.key)) event.stopPropagation(); }}
            onClick={event => { event.stopPropagation(); onSelect(finding); }}><span>{number}</span></button>)}
        </div>}
      </div>}
      {!ready && <p className="rr-image-status" role="status">{!supplied ? 'This report’s saved photograph is unavailable.' : image.error || loaded === 'IMAGE_ERROR' ? 'Could not verify the saved photograph. Reload images to try again.' : loaded === 'INVALID_DIMENSIONS' ? 'The saved photograph has unexpected dimensions. Reload images before continuing.' : 'Loading verified photograph…'}</p>}
      {ready && blueprint && <Blueprint finding={bounds.find(entry => entry.finding.id === selected?.id)?.finding} explanation={explanation} centering={layers.centering ? centering : null} policy={policy} side={side} printed={layers.centering ? printed : null} view={view} size={size} scale={scale} locatorBox={locatorBox}/>}
      {cleanComparison && selectedBounds && <span className="rr-photo-label">Measured trace</span>}
      {ready && magnifier && lens && <div className="rr-magnifier" aria-hidden="true" style={{ [lens.right ? 'right' : 'left']: 12, backgroundImage: `url("${image.url}")`, backgroundSize: `${INSPECTION_SIZE.width * scale * zoom * 3}px ${INSPECTION_SIZE.height * scale * zoom * 3}px`, backgroundPosition: `${90 - lens.x * INSPECTION_SIZE.width * scale * zoom * 3}px ${90 - lens.y * INSPECTION_SIZE.height * scale * zoom * 3}px` }}><span>3× · image only</span></div>}
      {locatorBox && locator}

    </div>
    {cleanComparison && selectedBounds && <div className="rr-viewport rr-clean-viewport" role="img" aria-label={`${name(side)} clean close-up; same photograph, zoom and position`}>
      {ready && <div className="rr-plane" data-transition={transition} style={{ width: INSPECTION_SIZE.width * scale * zoom, height: INSPECTION_SIZE.height * scale * zoom, transform: `translate(calc(-50% + ${view.pan.x}px), calc(-50% + ${view.pan.y}px))` }}><img src={image.url} alt={`${name(side)} unmarked defect close-up`} draggable={false}/></div>}
      <span className="rr-photo-label">Unmarked photograph · synchronized</span>
    </div>}
    </div>
    {!locatorBox && locator}
    {ready && blueprint && selectedBounds && <Blueprint outside finding={bounds.find(entry=>entry.finding.id===selected?.id)?.finding} explanation={explanation} policy={policy} side={side} view={view} size={size} scale={scale} locatorBox={locatorBox}/>}
    {!compact && <p className="rr-help">Drag to pan · pinch or scroll to zoom · arrow keys pan · + / − zoom · 0 fits. Magnification enlarges saved pixels.</p>}
    {!printed && <p className="rr-help">Border geometry is not available in this report view.</p>}
    {!compact && ready && crop && <figure className="rr-selected-crop"><div style={{ aspectRatio: `${crop.width} / ${crop.height}`, width: `min(100%, ${220 * crop.width / crop.height}px)` }}><img src={image.url} alt={`Detail from the verified ${name(side).toLowerCase()} photograph`} style={{ width: `${1350 / crop.width * 100}%`, height: `${1858 / crop.height * 100}%`, left: `${-crop.x / crop.width * 100}%`, top: `${-crop.y / crop.height * 100}%` }}/></div><figcaption>Selected area · the same verified photograph, without markings</figcaption></figure>}
    {showFindingButtons && <div className="rr-side-findings">{findings.filter(finding => finding.reviewResult !== 'REMOVED').map((finding, index) => <button type="button" key={finding.id} disabled={!ready} aria-pressed={selected?.id === finding.id} onClick={() => onSelect(finding)}>{name(side)} {index + 1} · {words(finding.defectType)}</button>)}{!findings.some(finding => finding.reviewResult !== 'REMOVED') && <p>No included findings on {name(side)}.</p>}</div>}
  </section>;
}
