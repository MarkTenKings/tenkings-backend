import React, { useEffect, useMemo, useRef, useState } from 'react';
import { decodeSpeedsterTraceRleV1, encodeSpeedsterTraceRleV1, speedsterTraceRleV1Spans } from '@atlas/grading-core/trace-codec';
import { decodeSpeedsterTraceBitmapWireV1, encodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { applyCompletedSpeedsterTraceStroke, buildSpeedsterTraceProvenanceRevision, clipSpeedsterTraceToEditorBounds,
  createEmptySpeedsterTrace, initializeSpeedsterHighlighterStrokes, isNonEmptySpeedsterTrace,
  rasterizeSpeedsterCanonicalContour } from '@atlas/grading-core/trace-editor';
import { defectBase } from './defect-actions.mjs';
import { useVerifiedImage } from './verified-image.mjs';
import { astraReviewState, proposalFrameMatches, validProposalContour } from './astra-review-ui.mjs';
import { INSPECTION_SIZE, MAX_INSPECTION_ZOOM, fitInspectionScale, clampInspectionPan, zoomInspectionAt,
  resizeInspectionView, focusInspectionBounds, canonicalInspectionPoint } from './inspection-viewport.mjs';

export { reviewedMemoryState } from './astra-review-ui.mjs';

const SIDES = ['FRONT', 'BACK'];
const GRID = { width: 1270, height: 1778 };
const FULL_CROP = { version: 'speedster-canonical-crop-affine-v1', crop: { x: 0, y: 0, width: 1269, height: 1777 } };
const TYPES = {
  FAINT_COLOR_VARIATION: 'Faint color variation', VISIBLE_WHITENING: 'Visible whitening', FRAYING: 'Fraying',
  CHIPPING_EXPOSED_STOCK: 'Chipping / exposed stock', LIFTING_DEFORMATION: 'Lifting / deformation',
  LIGHT_SCRATCH_SCUFF: 'Light scratch / scuff', VISIBLE_SCRATCH_PRINT_COATING_LOSS: 'Scratch / coating loss',
  DENT_MATERIAL_DAMAGE: 'Dent / material damage', PEELING_HEAVY_DAMAGE: 'Peeling / heavy damage',
};
const needsProposalRedraw = proposal => proposal?.measurementHold === 'OUTSIDE_CARD_FRAME';
const name = side => side === 'FRONT' ? 'Front' : 'Back';
const key = value => JSON.stringify(value);
export const inspectionImageBinding = (workspace, side, image) => key({ card: workspace.cardId, frame: workspace.sides[side].frame, revision: workspace.sides[side].findingRevision, sha256: image?.inspection?.sha256 });
const maskOf = finding => finding.geometryExclusion ? null : finding.finalTrace ?? finding.detectorMask;
const regionsOf = finding => finding.geometryExclusion ? [] : finding.measurementRegions ?? [{ zone: finding.zone, measurement: finding.measurement }];
const areaOf = finding => regionsOf(finding).reduce((sum, region) => sum + region.measurement.areaMm2, 0);

function inspectionBounds(target) {
  if (target.geometryExclusion) return null;
  const mask = maskOf(target);
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  const include = (px, py) => { x = Math.min(x, px); y = Math.min(y, py); right = Math.max(right, px); bottom = Math.max(bottom, py); };
  if (mask) for (const span of speedsterTraceRleV1Spans(mask)) {
    include(span.x / GRID.width, span.y / GRID.height);
    include((span.x + span.width) / GRID.width, (span.y + 1) / GRID.height);
  }
  else for (const point of target.measurementRegions?.flatMap(region => region.canonicalContour ?? []) ?? target.canonicalContour ?? []) include(point.x, point.y);
  return Number.isFinite(x) ? { x, y, width: right - x, height: bottom - y } : null;
}

/** Pixel-cell edges from the actual canonical mask, including holes and disconnected islands. */
function exactTraceShape(finding, trace) {
  if(trace&&!isNonEmptySpeedsterTrace(trace))return {path:'',anchor:null};
  if(!trace&&(finding?.reviewResult==='REMOVED'||finding?.geometryExclusion))return {path:'',anchor:null};
  const mask=trace?encodeSpeedsterTraceRleV1(trace):finding&&maskOf(finding);
  if(mask){
    const rows=new Map();let anchor=null;
    for(const span of speedsterTraceRleV1Spans(mask)){
      if(!anchor)anchor={x:span.x+span.width/2,y:span.y};
      if(!rows.has(span.y))rows.set(span.y,[]);rows.get(span.y).push([span.x,span.x+span.width]);
    }
    const paths=[];
    const exposed=(x,end,neighbors,y)=>{
      let start=x;
      for(const [a,b] of neighbors??[]){if(b<=start)continue;if(a>=end)break;if(a>start)paths.push(`M${start} ${y}H${Math.min(a,end)}`);start=Math.max(start,b);if(start>=end)break;}
      if(start<end)paths.push(`M${start} ${y}H${end}`);
    };
    for(const [y,spans] of rows)for(const [x,end] of spans){
      paths.push(`M${x} ${y}V${y+1}`,`M${end} ${y}V${y+1}`);
      exposed(x,end,rows.get(y-1),y);exposed(x,end,rows.get(y+1),y+1);
    }
    return {path:paths.join(''),anchor};
  }
  const contours=(finding?.measurementRegions??(finding?[finding]:[])).map(region=>region.canonicalContour).filter(points=>points?.length);
  return {path:contours.map(points=>points.map((p,i)=>`${i?'L':'M'}${p.x*1269} ${p.y*1777}`).join('')+'Z').join(''),
    anchor:contours[0]?.[0]?{x:contours[0][0].x*1269,y:contours[0][0].y*1777}:null};
}
/** One side, one camera. Markings come directly from the saved canonical masks. */
function SideReview({ workspace, side, image, findingId, onSelectFinding, onEdit, onRetry, onDiscardPending,
  onReadyChange, onEditingChange, onInspectionChange, readOnly, disabled, astra, onReviewProposal, renderEditActions, renderReviewActions }) {
  const slot = workspace.sides[side], base = defectBase(workspace, side), baseKey = key(base);
  const descriptor = image?.inspection, binding = inspectionImageBinding(workspace, side, image);
  const supplied = Boolean(descriptor?.url && descriptor.sha256 === slot.frame.inspectionImageSha256);
  const verified = useVerifiedImage(supplied ? descriptor : null);
  const [loaded, setLoaded] = useState({}), [comparison, setComparison] = useState(true);
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const [size, setSize] = useState({ width: 400, height: 560 }), sizeRef = useRef(size);
  const viewport = useRef(null), cleanViewport = useRef(null), plane = useRef(null);
  const gestures = useRef(new Map()), gestureStart = useRef(null), strokeRef = useRef(null);
  const [editor, setEditor] = useState(null), [stroke, setStroke] = useState([]);
  const [tool, setTool] = useState('BRUSH'), [brush, setBrush] = useState(4), [newType, setNewType] = useState('LIGHT_SCRATCH_SCUFF');
  const [panMode, setPanMode] = useState(false), [spacePan, setSpacePan] = useState(false), [peek, setPeek] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), busyRef = useRef(false);
  const ready = Boolean(supplied && verified.url && loaded.marked === binding && (!comparison || loaded.clean === binding));
  const pending = Boolean(slot.pending), stale = Boolean(editor && editor.baseKey !== baseKey);
  const locked = Boolean(disabled || readOnly), editDisabled = locked || busy || pending || !ready;
  const findings = slot.findings.filter(entry => entry.reviewResult !== 'REMOVED' && !entry.geometryExclusion);
  const historical = slot.findings.filter(entry => entry.reviewResult === 'REMOVED' || entry.geometryExclusion);
  const finding = findings.find(entry => entry.id === findingId) ?? null;
  const pendingAction = slot.pending?.action;
  const pendingTrace = useMemo(() => pendingAction?.type === 'TRACE_SAVE' ? decodeSpeedsterTraceBitmapWireV1(pendingAction.trace.traceWire) : null, [pendingAction]);
  const currentTrace = editor?.trace ?? pendingTrace;
  const traceId = editor?.findingId ?? (pendingTrace ? pendingAction.findingId ?? pendingAction.trace.id : null);
  const shapes = useMemo(() => findings.map((entry, index) => ({ finding: entry, number: index + 1, ...exactTraceShape(entry) })), [slot.findings]);
  const draftShape = useMemo(() => currentTrace ? exactTraceShape(null, currentTrace) : null, [currentTrace]);
  const bounds = useMemo(() => finding && inspectionBounds(finding), [finding]);
  const proposalsCurrent = astra?.status === 'READY' && proposalFrameMatches(workspace, astra, side);
  const proposals = astra?.enabled && proposalsCurrent ? (astra.proposals ?? []).filter(proposal => proposal.side === side && proposal.reviewStatus === 'UNREVIEWED') : [];
  const viewingDisabled = !ready || busy || stroke.length > 0;
  const scale = fitInspectionScale(size) * view.zoom;
  const planeStyle = { width: INSPECTION_SIZE.width * scale, height: INSPECTION_SIZE.height * scale,
    transform: `translate(-50%,-50%) translate(${view.pan.x}px,${view.pan.y}px)` };
  const choose = target => {
    if (editor || viewingDisabled) return;
    onSelectFinding?.(target ? { ...target, side } : null);
    const region = target && inspectionBounds(target);
    setView(region ? focusInspectionBounds(region, sizeRef.current) : { zoom: 1, pan: { x: 0, y: 0 } });
  };
  const fit = () => {
    if (viewingDisabled) return;
    setView({ zoom: 1, pan: { x: 0, y: 0 } });
    if (!editor) onSelectFinding?.(null);
  };
  const zoom = (value, anchor = { x: size.width / 2, y: size.height / 2 }) => setView(previous => zoomInspectionAt(previous, value, anchor, sizeRef.current));
  const move = delta => setView(previous => ({ ...previous,
    pan: clampInspectionPan({ x: previous.pan.x + delta.x, y: previous.pan.y + delta.y }, previous.zoom, sizeRef.current) }));
  useEffect(() => { onReadyChange?.(ready); }, [ready, binding, onReadyChange]);
  useEffect(() => {
    onEditingChange?.(Boolean(editor || busy));
    return () => onEditingChange?.(false);
  }, [Boolean(editor), busy, onEditingChange]);
  useEffect(() => {
    if (ready) onInspectionChange?.({ side, findingId, imageSha256: slot.frame.inspectionImageSha256, view, size });
  }, [side, findingId, ready, view, size, slot.frame.inspectionImageSha256, onInspectionChange]);
  useEffect(() => {
    if (editor) return;
    const target = findings.find(entry => entry.id === findingId), region = target && inspectionBounds(target);
    setView(region ? focusInspectionBounds(region, sizeRef.current) : { zoom: 1, pan: { x: 0, y: 0 } });
  }, [findingId]);
  useEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const resize = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      if (!next.width || !next.height || next.width === sizeRef.current.width && next.height === sizeRef.current.height) return;
      const before = sizeRef.current; sizeRef.current = next; setSize(next);
      setView(previous => resizeInspectionView(previous, before, next));
      gestures.current.clear(); gestureStart.current = null; strokeRef.current = null; setStroke([]);
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const elements = [viewport.current, cleanViewport.current].filter(Boolean);
    const listeners = elements.map(element => {
      const wheel = event => {
        if (!ready || busy || strokeRef.current || gestures.current.size) return;
        event.preventDefault();
        const rect = element.getBoundingClientRect(), factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? sizeRef.current.height : 1;
        const anchor = { x: (event.clientX - rect.left) * sizeRef.current.width / rect.width, y: (event.clientY - rect.top) * sizeRef.current.height / rect.height };
        setView(previous => zoomInspectionAt(previous, previous.zoom * Math.exp(-event.deltaY * factor * .002), anchor, sizeRef.current));
      };
      element.addEventListener('wheel', wheel, { passive: false }); return [element, wheel];
    });
    return () => listeners.forEach(([element, wheel]) => element.removeEventListener('wheel', wheel));
  }, [ready, busy, comparison]);
  const perform = async action => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); return true; }
    catch { setError('The change was not confirmed saved. Your current work is retained.'); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const edit = action => {
    if (editDisabled || editor || !onEdit) return;
    return perform(async () => { await onEdit({ side, base, actor: 'HUMAN', action }); if (action.type === 'REMOVE') onSelectFinding?.(null); });
  };
  const start = target => {
    if (editDisabled || editor || !onEdit) return;
    const mask = target && maskOf(target);
    const trace = mask ? decodeSpeedsterTraceRleV1(mask) : createEmptySpeedsterTrace();
    setError(''); setPeek(false); setPanMode(false);
    setEditor({ trace, base, baseKey, findingId: target?.id ?? null, sourceViewId: target?.sourceViewId ?? `${side}:inspection`,
      provenance: target?.traceProvenance, cropTransform: target?.traceProvenance?.cropTransform ?? FULL_CROP, id: target?.id ?? crypto.randomUUID(), undo: [] });
  };
  const correctProposal = proposal => {
    if (editDisabled || editor || !onReviewProposal || !TYPES[proposal.defectType] || !validProposalContour(proposal) && !needsProposalRedraw(proposal)) return;
    const trace = needsProposalRedraw(proposal) ? createEmptySpeedsterTrace() : clipSpeedsterTraceToEditorBounds(rasterizeSpeedsterCanonicalContour(proposal.canonicalContour), FULL_CROP, slot.cornerShape);
    setNewType(proposal.defectType); setError(''); setPeek(false); setPanMode(false);
    setEditor({ trace, base, baseKey, findingId: null, sourceViewId: `${side}:inspection`, cropTransform: FULL_CROP, id: crypto.randomUUID(), undo: [],
      proposal: { analysisId: astra.analysisId, proposalId: proposal.id } });
  };
  const reviewProposal = (proposal, action) => {
    if (editDisabled || editor || !onReviewProposal || !TYPES[proposal.defectType] || action === 'ACCEPT' && (needsProposalRedraw(proposal) || !validProposalContour(proposal))) return;
    return perform(() => onReviewProposal({ side, base, actor: 'HUMAN', analysisId: astra.analysisId, proposalId: proposal.id, action }));
  };
  const point = event => canonicalInspectionPoint({ x: event.clientX, y: event.clientY }, plane.current?.getBoundingClientRect());
  const finishStroke = () => {
    const captured = strokeRef.current; strokeRef.current = null; setStroke([]);
    if (!captured?.points.length || !editor || stale || editDisabled) return;
    const next = applyCompletedSpeedsterTraceStroke({ trace: editor.trace, points: captured.points, tool: captured.tool, strokeWidthPixels: captured.brush }).trace;
    const trace = clipSpeedsterTraceToEditorBounds(next, editor.cropTransform, slot.cornerShape);
    setEditor(previous => ({ ...previous, trace, undo: [...previous.undo.slice(-19), previous.trace] }));
  };
  const gesturePoint = (event, clean) => {
    const rect = (clean ? cleanViewport : viewport).current.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * sizeRef.current.width / rect.width, y: (event.clientY - rect.top) * sizeRef.current.height / rect.height };
  };
  const rebaseGesture = () => {
    const values = [...gestures.current.values()];
    gestureStart.current = { points: values, view };
  };
  const pointerDown = (event, clean = false) => {
    if (!ready || busy || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation?.();
    const element = (clean ? cleanViewport : viewport).current; element?.focus?.({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    gestures.current.set(event.pointerId, gesturePoint(event, clean));
    if (gestures.current.size > 1) { strokeRef.current = null; setStroke([]); rebaseGesture(); return; }
    if (!clean && editor && !panMode && !spacePan) {
      if (stale || editDisabled) return;
      const first = point(event); if (!first) return;
      strokeRef.current = { id: event.pointerId, points: [first], tool, brush }; setStroke([first]); return;
    }
    rebaseGesture();
  };
  const pointerMove = (event, clean = false) => {
    if (!gestures.current.has(event.pointerId)) return;
    gestures.current.set(event.pointerId, gesturePoint(event, clean));
    const values = [...gestures.current.values()], initial = gestureStart.current;
    if (values.length > 1 && initial?.points.length > 1) {
      const middle = points => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
      const before = middle(initial.points), after = middle(values);
      const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const next = zoomInspectionAt(initial.view, initial.view.zoom * distance(values) / Math.max(1, distance(initial.points)), before, sizeRef.current);
      setView({ ...next, pan: clampInspectionPan({ x: next.pan.x + after.x - before.x, y: next.pan.y + after.y - before.y }, next.zoom, sizeRef.current) }); return;
    }
    if (strokeRef.current?.id === event.pointerId) {
      const next = point(event); if (!next) { finishStroke(); return; }
      strokeRef.current.points.push(next); setStroke([...strokeRef.current.points]); return;
    }
    if (initial?.points.length === 1) setView({ ...initial.view, pan: clampInspectionPan({
      x: initial.view.pan.x + values[0].x - initial.points[0].x, y: initial.view.pan.y + values[0].y - initial.points[0].y,
    }, initial.view.zoom, sizeRef.current) });
  };
  const pointerEnd = (event, cancel = false) => {
    if (event && !gestures.current.has(event.pointerId)) return;
    if (!cancel) finishStroke(); else { strokeRef.current = null; setStroke([]); }
    if (event) gestures.current.delete(event.pointerId); else gestures.current.clear();
    gestureStart.current = null;
    if (gestures.current.size) rebaseGesture();
  };
  const keyDown = event => {
    if (event.target !== event.currentTarget || strokeRef.current || gestures.current.size) return;
    if (event.key === ' ') { event.preventDefault(); setSpacePan(true); }
    else if (event.key.toLowerCase() === 'h') { event.preventDefault(); setPeek(true); }
    else if (!viewingDisabled) {
      const moves = { ArrowLeft: { x: 80, y: 0 }, ArrowRight: { x: -80, y: 0 }, ArrowUp: { x: 0, y: 80 }, ArrowDown: { x: 0, y: -80 } };
      if (moves[event.key]) { event.preventDefault(); move(moves[event.key]); }
      else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); zoom(event.key === '-' ? view.zoom / 1.5 : view.zoom * 1.5); }
      else if (['Home', '0'].includes(event.key)) { event.preventDefault(); fit(); }
    }
  };
  const pointerProps = clean => ({
    onPointerDown: event => pointerDown(event, clean), onPointerMove: event => pointerMove(event, clean),
    onPointerUp: event => pointerEnd(event), onPointerCancel: event => pointerEnd(event, true), onLostPointerCapture: event => pointerEnd(event, true),
    onKeyDown: keyDown, onKeyUp: event => { if (event.key === ' ') setSpacePan(false); if (event.key.toLowerCase() === 'h') setPeek(false); },
    onBlur: () => { setSpacePan(false); setPeek(false); },
  });
  const resumeSavedTrace = Boolean(editor && pendingAction?.type === 'TRACE_SAVE' && onRetry
    && (pendingAction.findingId ?? pendingAction.trace.id) === editor.id
    && pendingAction.trace.traceWire.rleSha256 === encodeSpeedsterTraceRleV1(editor.trace).sha256);
  const canSave = Boolean(editor && !locked && ready && !busy && !stroke.length && (resumeSavedTrace || !stale && !pending) && isNonEmptySpeedsterTrace(editor.trace));
  const saveTrace = () => {
    if (!canSave) return;
    return perform(async () => {
      if (resumeSavedTrace) await onRetry(side);
      else {
        const rle = encodeSpeedsterTraceRleV1(editor.trace);
        const traceProvenance = buildSpeedsterTraceProvenanceRevision({ sourceViewId: editor.sourceViewId, cropTransform: editor.cropTransform,
          highlighterStrokes: initializeSpeedsterHighlighterStrokes(editor.provenance), priorTraceProvenance: editor.provenance, finalTraceSha256: rle.sha256 });
        const trace = { traceWire: encodeSpeedsterTraceBitmapWireV1(editor.trace, rle.sha256), traceProvenance,
          ...(editor.findingId === null ? { id: editor.id, defectType: newType, sourceViewId: editor.sourceViewId } : {}) };
        if (editor.proposal) await onReviewProposal({ side, base: editor.base, actor: 'HUMAN', ...editor.proposal, action: 'TRACE_SAVE', trace });
        else await onEdit({ side, base: editor.base, actor: 'HUMAN', action: { type: 'TRACE_SAVE', side, findingId: editor.findingId, trace } });
      }
      setEditor(null); setError('');
    });
  };
  const imageLoaded = pane => event => {
    const valid = event.currentTarget.naturalWidth === INSPECTION_SIZE.width && event.currentTarget.naturalHeight === INSPECTION_SIZE.height;
    setLoaded(previous => ({ ...previous, [pane]: valid ? binding : null }));
  };
  const actionsDisabled = locked || busy || Boolean(editor) || pending || !ready;
  return <section className="ad-side-review" aria-label={`${name(side)} defects`}>
    <header className="ad-review-toolbar">
      <div><h2>{name(side)} findings</h2><span>{findings.length} {findings.length === 1 ? 'finding' : 'findings'}</span></div>
      <div className="ad-photo-controls" aria-label={`${name(side)} photograph controls`}>
        <button type="button" aria-pressed={comparison} disabled={busy || stroke.length > 0} onClick={() => setComparison(value => !value)}>Side-by-side</button>
        <button type="button" disabled={viewingDisabled} onClick={fit}>Fit</button>
        <button type="button" aria-label={`Zoom out ${name(side)}`} disabled={viewingDisabled || view.zoom <= 1} onClick={() => zoom(view.zoom / 1.5)}>−</button>
        <output aria-label={`${name(side)} zoom`}>{Number(view.zoom.toFixed(1))}×</output>
        <button type="button" aria-label={`Zoom in ${name(side)}`} disabled={viewingDisabled || view.zoom >= MAX_INSPECTION_ZOOM} onClick={() => zoom(view.zoom * 1.5)}>+</button>
      </div>
    </header>
    <div className="ad-review-body">
      <div className="ad-inspection-panel">
        <div className={`ad-evidence-grid${comparison ? ' ad-compare' : ''}`}>
          <div ref={viewport} className={`ad-viewport${editor && !panMode && !spacePan ? ' ad-drawing' : ''}`} tabIndex={0} role="region" aria-label={`${name(side)} image inspection`} {...pointerProps(false)}>
            <span className="ad-pane-label">{name(side)} · Marked</span>
            {verified.url ? <div ref={plane} className="ad-plane" style={planeStyle}>
              <img key={`${binding}:marked`} src={verified.url} alt={`${name(side)} inspection image`} draggable="false" onLoad={imageLoaded('marked')} onError={() => setLoaded(previous => ({ ...previous, marked: null }))}/>
              <div className="ad-card-plane">
                {ready && !peek && <svg className="ad-exact-traces" viewBox="0 0 1270 1778" role="group" aria-label={`${name(side)} all finding markings`}>
                  {shapes.filter(shape => shape.path && !(currentTrace && shape.finding.id === traceId)).map(shape => <g key={shape.finding.id} role="button" tabIndex={editor ? -1 : 0}
                    aria-label={`Inspect ${name(side)} finding ${shape.number}: ${TYPES[shape.finding.defectType]}`} aria-pressed={shape.finding.id === findingId} aria-disabled={Boolean(editor)} data-finding-id={shape.finding.id}
                    onPointerDown={event => event.stopPropagation()} onClick={() => choose(shape.finding)} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); choose(shape.finding); } }}>
                    <path className="ad-trace-hit" d={shape.path}/><path className="ad-exact-trace" d={shape.path}/>
                    {view.zoom < 2 && shape.anchor && <g className="ad-trace-number"><circle cx={shape.anchor.x} cy={shape.anchor.y} r="27"/><text x={shape.anchor.x} y={shape.anchor.y}>{shape.number}</text></g>}
                  </g>)}
                  {draftShape?.path && <path className="ad-exact-trace ad-draft-trace" d={draftShape.path}/>}
                  {!editor && proposals.filter(validProposalContour).map(proposal => <polygon key={proposal.id} className="ad-proposal-outline" points={proposal.canonicalContour.map(p => `${p.x * 1269},${p.y * 1777}`).join(' ')}/>)}
                </svg>}
                {stroke.length > 0 && <svg className="ad-stroke" viewBox="0 0 1269 1777" aria-hidden="true"><polyline points={stroke.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={tool === 'ERASER' ? '#fff' : '#df2344'} strokeWidth={strokeRef.current?.brush ?? brush} strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
            </div> : <div className="ad-photo-empty">{verified.error ? 'Photograph unavailable.' : supplied ? 'Verifying photograph…' : 'Inspection photograph unavailable.'}</div>}
          </div>
          {comparison && <div ref={cleanViewport} className="ad-viewport ad-clean-viewport" tabIndex={0} role="region" aria-label={`${name(side)} clean comparison`} {...pointerProps(true)}>
            <span className="ad-pane-label">{name(side)} · Clean</span>
            {verified.url ? <div className="ad-plane ad-clean-plane" style={planeStyle}><img key={`${binding}:clean`} src={verified.url} alt={`${name(side)} clean inspection image`} draggable="false" onLoad={imageLoaded('clean')} onError={() => setLoaded(previous => ({ ...previous, clean: null }))}/></div> : <div className="ad-photo-empty">Verifying photograph…</div>}
          </div>}
        </div>
        <div className="ad-view-help"><span>Scroll or pinch to zoom · drag either photo to pan</span><div aria-label={`Pan ${name(side)} photograph`}>{[['←',80,0,'left'],['↑',0,80,'up'],['↓',0,-80,'down'],['→',-80,0,'right']].map(([label,x,y,direction]) => <button key={direction} type="button" disabled={viewingDisabled || view.zoom <= 1} aria-label={`Pan ${name(side)} ${direction}`} onClick={() => move({ x, y })}>{label}</button>)}</div></div>
        {!ready && <p className="ad-status" role={verified.error ? 'alert' : 'status'}>{verified.error ? 'The saved photograph could not be verified.' : 'Verifying the current photograph.'}{verified.error && <button type="button" onClick={verified.retry}>Retry photograph</button>}</p>}
      </div>
      <aside className="ad-review-panel" aria-label={`${name(side)} findings and corrections`}>
        <div className="ad-list-heading"><strong>All {name(side).toLowerCase()} findings</strong><button type="button" disabled={editDisabled || Boolean(editor) || !onEdit} onClick={() => start(null)}>Add finding</button></div>
        <ol className="ad-findings" aria-label={`${name(side)} findings`}>{shapes.map(({ finding: entry, number }) => <li key={entry.id}><button type="button" className="ad-finding-name" aria-pressed={entry.id === findingId} disabled={viewingDisabled || Boolean(editor)} onClick={() => choose(entry)} aria-label={`Inspect ${name(side)} finding ${number}`}><b>{number}</b><span><strong>{TYPES[entry.defectType]}</strong><small>{areaOf(entry).toLocaleString('en-US', { maximumFractionDigits: 6 })} mm² · {regionsOf(entry).map(region => region.zone.toLowerCase()).join(', ')}</small></span></button></li>)}</ol>
        {!findings.length && <p className="ad-status">{astra?.enabled && !['READY','STALE'].includes(astra.status) ? 'AI inspection has not completed. No saved findings on this side.' : `No findings recorded on ${name(side).toLowerCase()}.`} Add any visible damage.</p>}
        {finding && !editor && <section className="ad-finding-details" aria-label="Selected finding measurements"><h3>{TYPES[finding.defectType]}</h3><dl><div><dt>Measured area</dt><dd>{areaOf(finding).toLocaleString('en-US', { maximumFractionDigits: 6 })} mm²</dd></div>{bounds && <div><dt>Region bounds</dt><dd>{(bounds.width * 63.5).toFixed(3)} × {(bounds.height * 88.9).toFixed(3)} mm</dd></div>}</dl>
          <label>Defect type<select aria-label={`${name(side)} finding type`} value={finding.defectType} disabled={editDisabled || !onEdit} onChange={event => edit({ type: 'CHANGE_TYPE', defectId: finding.id, defectType: event.target.value })}>{Object.entries(TYPES).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="ad-edit-actions"><button type="button" disabled={editDisabled || !onEdit} onClick={() => start(finding)}>Edit trace</button><button type="button" disabled={editDisabled || !onEdit} onClick={() => edit({ type: 'REMOVE', defectIds: [finding.id] })}>Remove finding</button></div>
        </section>}
        {editor && <section className="ad-trace-tools" aria-label={`${name(side)} trace editor`}><h3>{editor.findingId ? 'Correct trace' : 'Add finding'}</h3><p>Trace visible damage on the marked photo.</p>
          {editor.findingId === null && <label>Defect type<select aria-label={`${name(side)} new finding type`} value={newType} disabled={busy} onChange={event => setNewType(event.target.value)}>{Object.entries(TYPES).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          <div className="ad-edit-actions"><button type="button" disabled={busy || stroke.length > 0} aria-pressed={tool === 'BRUSH'} onClick={() => setTool('BRUSH')}>Brush</button><button type="button" disabled={busy || stroke.length > 0} aria-pressed={tool === 'ERASER'} onClick={() => setTool('ERASER')}>Eraser</button><button type="button" disabled={busy || stroke.length > 0} aria-pressed={panMode} onClick={() => setPanMode(value => !value)}>Pan image</button></div>
          <label>Width<select aria-label={`${name(side)} brush width`} disabled={busy || stroke.length > 0} value={brush} onChange={event => setBrush(Number(event.target.value))}>{[1,2,4,8,16,32].map(width => <option key={width} value={width}>{width} px</option>)}</select></label>
          <button type="button" disabled={busy || stroke.length > 0 || !editor.undo.length} onClick={() => setEditor(previous => ({ ...previous, trace: previous.undo.at(-1), undo: previous.undo.slice(0,-1) }))}>Undo stroke</button>
          {stale && !busy && !resumeSavedTrace && <p role="alert">The saved side changed. Your trace is retained; cancel it to use the current version.</p>}
          {(renderEditActions ?? (children => children))(<div className="ad-edit-actions"><button type="button" className="ad-save-trace" disabled={!canSave} onClick={saveTrace}>{busy ? 'Saving…' : 'Save trace'}</button><button type="button" disabled={busy} onClick={() => { strokeRef.current = null; gestures.current.clear(); setStroke([]); setEditor(null); setError(''); }}>Cancel trace</button></div>, side)}
        </section>}
        {pending && !busy && <div className="ad-pending" role="status"><p>Measurement pending. Your change is retained.</p>{onRetry && <button type="button" disabled={locked} onClick={() => perform(() => onRetry(side))}>Retry measurement</button>}{onDiscardPending && <button type="button" disabled={locked} onClick={() => perform(() => onDiscardPending({ side, base }))}>Discard pending change</button>}</div>}
        {proposals.length > 0 && <details className="ad-proposals"><summary>Additional suggestions ({proposals.length})</summary><ul>{proposals.map(proposal => <li key={proposal.id}><strong>{TYPES[proposal.defectType] ?? 'Unrecognized suggestion'}</strong><div className="ad-edit-actions"><button type="button" disabled={editDisabled || Boolean(editor) || !onReviewProposal || !validProposalContour(proposal) || needsProposalRedraw(proposal)} onClick={() => reviewProposal(proposal, 'ACCEPT')}>Add suggestion</button><button type="button" disabled={editDisabled || Boolean(editor) || !onReviewProposal} onClick={() => correctProposal(proposal)}>Correct trace</button><button type="button" disabled={editDisabled || Boolean(editor) || !onReviewProposal} onClick={() => reviewProposal(proposal, 'REJECT')}>Dismiss suggestion</button></div></li>)}</ul></details>}
        {historical.length > 0 && <details className="ad-history"><summary>Removed / excluded ({historical.length})</summary><ul>{historical.map(entry => <li key={entry.id}><span>{TYPES[entry.defectType]}{entry.geometryExclusion ? ' · Earlier outline' : ''}</span>{!entry.geometryExclusion && <button type="button" disabled={editDisabled || Boolean(editor) || !onEdit} onClick={() => edit({ type: 'UNDO', defectIds: [entry.id] })}>Restore finding</button>}</li>)}</ul></details>}
        {error && <p role="alert">{error}</p>}
      </aside>
    </div>
    {renderReviewActions?.({ disabled: actionsDisabled, busy, message: busy ? 'Saving and measuring…' : editor ? 'Save or cancel the trace.' : pending ? 'Finish the pending measurement.' : !ready ? 'Verifying the photograph…' : `${name(side)} · ${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}` })}
  </section>;
}

/** The host owns front/back progression and the deliberate durable approval. */
export function DefectReviewWorkspace({ workspace, images, side = 'FRONT', onSideChange, findingId = null, onSelectFinding,
  onEdit, onRetry, onDiscardPending, onEditingChange, onReadyChange, onInspectionChange, renderEditActions, renderReviewActions,
  readOnly = false, disabled = false, astra, onReviewProposal, onAnalyzeDefects, onRefreshAnalysis, onResumeAnalysis, onReplaceAnalysis }) {
  const [analysisBusy, setAnalysisBusy] = useState(false), [analysisError, setAnalysisError] = useState('');
  const analysisInFlight = useRef(false);
  const analysis = astraReviewState(workspace, astra);
  async function runAnalysis(work) {
    if (analysisInFlight.current || !work) return;
    analysisInFlight.current = true; setAnalysisBusy(true); setAnalysisError('');
    try { await work(); } catch { setAnalysisError('Could not update AI inspection. Check its status or continue reviewing.'); }
    finally { analysisInFlight.current = false; setAnalysisBusy(false); }
  }
  const [editing, setEditing] = useState(false);
  const activityChanged = React.useCallback(value => { setEditing(value); onEditingChange?.(value); }, [onEditingChange]);
  return <div className="atlas-manual ad-workspace">
    {analysis.enabled && analysis.status !== 'READY' && <section className="ad-analysis-status" aria-label="AI inspection status">
      <p role="status">{analysis.message}</p>
      <div>{analysis.mayRequest && onAnalyzeDefects && <button type="button" disabled={analysisBusy || editing || disabled || readOnly} onClick={() => runAnalysis(onAnalyzeDefects)}>{analysis.status === 'IDLE' ? 'Run AI inspection' : 'Retry AI inspection'}</button>}
        {['RUNNING','UNKNOWN'].includes(analysis.status) || astra.followLatest ? <>
          {onRefreshAnalysis && <button type="button" disabled={analysisBusy} onClick={() => runAnalysis(onRefreshAnalysis)}>Check AI status</button>}
          {astra.resumeAvailable && onResumeAnalysis && <button type="button" disabled={analysisBusy || editing || disabled || readOnly} onClick={() => runAnalysis(onResumeAnalysis)}>Continue AI inspection</button>}
          {astra.replacement && !astra.backgroundAccepted && astra.requestAvailable !== false && onReplaceAnalysis && <button type="button" disabled={analysisBusy || editing || disabled || readOnly} onClick={() => runAnalysis(onReplaceAnalysis)}>Start new AI inspection</button>}
        </> : null}</div>
      {analysisError && <p role="alert">{analysisError}</p>}
    </section>}
    <nav className="ad-side-navigation" aria-label="Findings side">{SIDES.map(value => <button type="button" key={value} aria-pressed={side === value} disabled={editing || disabled} onClick={() => { if (side !== value) { onReadyChange?.(false); onSideChange?.(value); } }}>{name(value)}</button>)}</nav>
    <SideReview key={`${workspace.cardId}:${side}`} workspace={workspace} side={side} image={images?.[side]} findingId={findingId} onSelectFinding={onSelectFinding}
      onEdit={onEdit} onRetry={onRetry} onDiscardPending={onDiscardPending} onReadyChange={onReadyChange} onEditingChange={activityChanged}
      onInspectionChange={onInspectionChange} readOnly={readOnly} disabled={disabled} astra={astra} onReviewProposal={onReviewProposal}
      renderEditActions={renderEditActions} renderReviewActions={renderReviewActions}/>
  </div>;
}
