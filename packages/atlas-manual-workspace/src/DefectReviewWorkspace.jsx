import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeSpeedsterTraceRleV1, encodeSpeedsterTraceRleV1, speedsterTraceRleV1Spans } from '@atlas/grading-core/trace-codec';
import { decodeSpeedsterTraceBitmapWireV1, encodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { applyCompletedSpeedsterTraceStroke, buildSpeedsterTraceProvenanceRevision, clipSpeedsterTraceToEditorBounds,
  createEmptySpeedsterTrace, initializeSpeedsterHighlighterStrokes, isNonEmptySpeedsterTrace,
  rasterizeSpeedsterCanonicalContour } from '@atlas/grading-core/trace-editor';
import { defectBase, defectStatus, reviewedDefectFindingIds } from './defect-actions.mjs';
import { useVerifiedImage } from './verified-image.mjs';
import { astraReviewState, collectiveProposalReview, proposalFrameMatches, reviewedMemoryState, validProposalContour } from './astra-review-ui.mjs';
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
const name = side => side === 'FRONT' ? 'Front' : 'Back';
const key = value => JSON.stringify(value);
export const inspectionImageBinding = (workspace, side, image) => key({ card: workspace.cardId, frame: workspace.sides[side].frame, revision: workspace.sides[side].findingRevision, sha256: image?.inspection?.sha256 });
const maskOf = finding => finding.finalTrace ?? finding.detectorMask;
const regionsOf = finding => finding.measurementRegions ?? [{ zone: finding.zone, measurement: finding.measurement }];
const areaOf = finding => regionsOf(finding).reduce((sum, region) => sum + region.measurement.areaMm2, 0);

function inspectionBounds(target) {
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
function ExactFindingOverlay({shape,visible}) {
  return visible&&shape.path?<svg className="ad-exact-outline" viewBox="0 0 1270 1778" preserveAspectRatio="none" aria-hidden="true"><path d={shape.path}/></svg>:null;
}
function SelectedFindingCallout({anchor,view,size,scale,label,number}) {
  if(!anchor)return null;
  const x=size.width/2+view.pan.x+(40+anchor.x-INSPECTION_SIZE.width/2)*scale*view.zoom;
  const y=size.height/2+view.pan.y+(40+anchor.y-INSPECTION_SIZE.height/2)*scale*view.zoom;
  if(x<0||x>size.width||y<0||y>size.height)return null;
  const width=Math.min(205,Math.max(100,size.width-24)),left=Math.max(12,Math.min(size.width-width-12,x+28));
  const top=y>75?y-54:Math.min(size.height-42,y+26),edge=left>x?left:left+width;
  return <div className="ad-selected-callout" aria-label={`Finding ${number}: ${label}`}>
    <svg viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true"><path d={`M${x} ${y}L${edge} ${top+16}`}/><circle cx={x} cy={y} r="2"/></svg>
    <span style={{left,top,width}}><b>{number}</b>{label}</span>
  </div>;
}

function FindingOverlay({ findings, selected, trace, visible }) {
  const canvas = useRef(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, GRID.width, GRID.height);
    if (!visible) return;
    for (const finding of findings) {
      if (finding.reviewResult === 'REMOVED' || (trace && finding.id === selected)) continue;
      context.fillStyle = finding.id === selected ? 'rgba(217,72,34,.75)' : 'rgba(236,161,36,.45)';
      const mask = maskOf(finding);
      if (mask) for (const span of speedsterTraceRleV1Spans(mask)) context.fillRect(span.x, span.y, span.width, 1);
      else for (const region of finding.measurementRegions ?? [finding]) {
        context.beginPath();
        region.canonicalContour.forEach((p, i) => context[i ? 'lineTo' : 'moveTo'](p.x * 1269, p.y * 1777));
        context.closePath(); context.fill();
      }
    }
    if (trace) {
      const pixels = context.createImageData(GRID.width, GRID.height);
      for (let i = 0; i < trace.length; i++) if (trace[i]) {
        pixels.data[i * 4] = 224; pixels.data[i * 4 + 1] = 62; pixels.data[i * 4 + 2] = 35; pixels.data[i * 4 + 3] = 190;
      }
      // Paint this owned raster on a separate surface so other finding overlays survive.
      const layer = document.createElement('canvas'); layer.width = GRID.width; layer.height = GRID.height;
      layer.getContext('2d').putImageData(pixels, 0, 0); context.drawImage(layer, 0, 0);
    }
  }, [findings, selected, trace, visible]);
  return <canvas ref={canvas} className="ad-mask" width={GRID.width} height={GRID.height} aria-hidden="true" />;
}

function ProposalOverlay({ proposals, selected, visible }) {
  if (!visible) return null;
  return <svg className="ad-proposal-overlay" viewBox="0 0 1269 1777" aria-hidden="true">
    {proposals.filter(proposal => proposal.reviewStatus === 'UNREVIEWED' && validProposalContour(proposal)).map(proposal => <polygon key={proposal.id}
      className={proposal.id === selected ? 'ad-proposal-active' : ''}
      points={proposal.canonicalContour.map(point => `${point.x * 1269},${point.y * 1777}`).join(' ')} />)}
  </svg>;
}

function DefectSide({ workspace, side, image, onEdit, onRetry, onDiscardPending, onReady, onActivity, locked, astra, onReviewProposal, expanded, hidden, onExpand, renderEditActions, initialInspection, onInspectionChange, onReviewFinding, focusedReview }) {
  const slot = workspace.sides[side], base = defectBase(workspace, side), currentBase = key(base);
  const descriptor = image?.inspection;
  const binding = inspectionImageBinding(workspace, side, image);
  const supplied = descriptor?.url && descriptor.sha256 === slot.frame.inspectionImageSha256;
  const verified = useVerifiedImage(supplied ? descriptor : null);
  const [loaded, setLoaded] = useState(null), [selected, setSelected] = useState(initialInspection?.side === side && initialInspection.imageSha256 === slot.frame.inspectionImageSha256 ? initialInspection.findingId : null), [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } }), [showMasks, setShowMasks] = useState(true);
  const { zoom, pan } = view;
  const [viewportSize, setViewportSize] = useState({ width: 400, height: 560 });
  const viewportSizeRef = useRef(viewportSize);
  const [magnifier, setMagnifier] = useState(false), [lens, setLens] = useState(null);
  const [panMode, setPanMode] = useState(false), [spacePan, setSpacePan] = useState(false), [hideOverlays, setHideOverlays] = useState(false), [peek, setPeek] = useState(false);
  const [inspecting, setInspecting] = useState('');
  const [cleanView,setCleanView]=useState(false),[comparison,setComparison]=useState(false);
  const [tool, setTool] = useState('BRUSH'), [brush, setBrush] = useState(4), [newType, setNewType] = useState('LIGHT_SCRATCH_SCUFF');
  const [stroke, setStroke] = useState([]), strokeRef = useRef(null), plane = useRef(null);
  const viewport = useRef(null), pointerPan = useRef(null);
  const [selectedProposal, setSelectedProposal] = useState(null), [showProposals, setShowProposals] = useState(true), busyRef = useRef(false);
  const ready = Boolean(supplied && verified.url && loaded === binding);
  const stale = Boolean(editor && editor.baseKey !== currentBase);
  const pending = Boolean(slot.pending), disabled = busy || locked || pending || !ready;
  const pendingAction = slot.pending?.action;
  const pendingTrace = useMemo(() => pendingAction?.type === 'TRACE_SAVE' ? decodeSpeedsterTraceBitmapWireV1(pendingAction.trace.traceWire) : null, [pendingAction]);
  const finding = slot.findings.find(entry => entry.id === selected);
  const focusedShape=useMemo(()=>focusedReview?exactTraceShape(finding,editor?.trace??pendingTrace):null,[Boolean(focusedReview),finding,editor?.trace,pendingTrace]);
  const savedBounds=useMemo(()=>{
    if(!focusedReview||!finding||finding.geometryExclusion)return null;
    const bounds=inspectionBounds(finding);
    return bounds&&Object.values(bounds).every(Number.isFinite)&&bounds.x>=0&&bounds.y>=0&&bounds.width>0&&bounds.height>0&&bounds.x+bounds.width<=1&&bounds.y+bounds.height<=1?bounds:null;
  },[Boolean(focusedReview),finding]);
  const proposals = astra?.enabled && Array.isArray(astra.proposals) ? astra.proposals.filter(proposal => proposal.side === side) : [];
  const proposalsCurrent = astra?.status === 'READY' && proposalFrameMatches(workspace, astra, side);
  const proposalDisabled = disabled || Boolean(editor) || !proposalsCurrent || !onReviewProposal;
  const inspected = Boolean(slot.inspection);
  const scale = fitInspectionScale(viewportSize), overlaysVisible = !hideOverlays && !peek && !(focusedReview&&cleanView);
  const EvidenceWrap=focusedReview?'div':React.Fragment;
  const planeStyle={width:INSPECTION_SIZE.width*scale*zoom,height:INSPECTION_SIZE.height*scale*zoom,transform:`translate(-50%,-50%) translate(${pan.x}px,${pan.y}px)`};
  const viewingDisabled = !ready || busy || stroke.length > 0;
  const fit = () => { setView({ zoom: 1, pan: { x: 0, y: 0 } }); setLens(null); setInspecting(''); };
  const changeZoom = (next, anchor = { x: viewportSize.width / 2, y: viewportSize.height / 2 }) => {
    setView(previous => zoomInspectionAt(previous, next, anchor, viewportSize)); setLens(null);
  };
  const moveView = delta => { setView(previous => ({ ...previous, pan: clampInspectionPan({ x: previous.pan.x + delta.x, y: previous.pan.y + delta.y }, previous.zoom, viewportSize) })); setLens(null); };
  useEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      const next = { width: element.clientWidth, height: element.clientHeight };
      const previousSize = viewportSizeRef.current;
      if (previousSize.width === next.width && previousSize.height === next.height) return;
      viewportSizeRef.current = next;
      setViewportSize(next);
      setView(previous => resizeInspectionView(previous, previousSize, next)); setLens(null);
      // A resize ends only an in-flight gesture; completed unsaved trace pixels remain.
      pointerPan.current = null; strokeRef.current = null; setStroke([]);
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = viewport.current;
    if (!element?.addEventListener) return;
    const wheel = event => {
      if (!ready || busy || strokeRef.current || pointerPan.current) return;
      event.preventDefault();
      const box = element.getBoundingClientRect(), factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportSize.height : 1;
      setView(previous => zoomInspectionAt(previous, previous.zoom * Math.exp(-event.deltaY * factor * .002),
        { x: event.clientX - box.left, y: event.clientY - box.top }, viewportSize)); setLens(null);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [ready, busy, viewportSize]);
  useEffect(() => { onReady(side, ready ? binding : null); }, [side, ready, binding, onReady]);
  useEffect(() => { onActivity(side, Boolean(editor || busy)); }, [side, editor, busy, onActivity]);
  useEffect(() => {
    if (!editor && selected && !slot.findings.some(entry => entry.id === selected)) setSelected(null);
  }, [slot.findings, selected, editor]);
  const perform = async callback => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true); setError('');
    try { await callback(); return true; }
    catch { setError('The change was not confirmed saved. Your current work is retained.'); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const edit = action => perform(() => onEdit({ side, base, actor: 'HUMAN', action }));
  const start = target => {
    if (disabled || editor) return;
    const mask = target && maskOf(target);
    let trace = createEmptySpeedsterTrace();
    if (mask) trace = decodeSpeedsterTraceRleV1(mask);
    else if (target?.canonicalContour) trace = rasterizeSpeedsterCanonicalContour(target.canonicalContour);
    setSelected(target?.id ?? null); setShowMasks(true); setCleanView(false); setError('');
    setEditor({ trace, base, baseKey: currentBase, findingId: target?.id ?? null,
      sourceViewId: target?.sourceViewId ?? `${side}:inspection`,
      provenance: target?.traceProvenance, cropTransform: target?.traceProvenance?.cropTransform ?? FULL_CROP, id: target?.id ?? crypto.randomUUID(), undo: [] });
  };
  const restored = useRef(false);
  useEffect(() => {
    if (!ready || restored.current || initialInspection?.side !== side) return;
    restored.current = true;
    if (initialInspection.imageSha256 !== slot.frame.inspectionImageSha256) {
      setError('The photograph changed. Select the finding again in its current image.'); return;
    }
    if (initialInspection.view && initialInspection.size)
      setView(resizeInspectionView(initialInspection.view, initialInspection.size, viewportSizeRef.current));
    if (initialInspection.intent === 'ADD') start(null);
  }, [ready, initialInspection, side]);
  useEffect(() => {
    if (!hidden && ready) onInspectionChange?.({side, findingId:selected, imageSha256:slot.frame.inspectionImageSha256, view, size:viewportSize});
  }, [side, selected, view, viewportSize, hidden, ready, slot.frame.inspectionImageSha256, onInspectionChange]);
  const reviewProposal = (proposal, action) => {
    if (proposalDisabled || proposal.reviewStatus !== 'UNREVIEWED' || !validProposalContour(proposal) || !TYPES[proposal.defectType]) return;
    return perform(() => onReviewProposal({ side, base, actor: 'HUMAN', analysisId: astra.analysisId, proposalId: proposal.id, action }));
  };
  const correctProposal = proposal => {
    if (proposalDisabled || proposal.reviewStatus !== 'UNREVIEWED' || !validProposalContour(proposal) || !TYPES[proposal.defectType]) return;
    setSelected(null); setSelectedProposal(proposal.id); setNewType(proposal.defectType); setShowMasks(true); setCleanView(false); setError('');
    const trace = clipSpeedsterTraceToEditorBounds(rasterizeSpeedsterCanonicalContour(proposal.canonicalContour), FULL_CROP, slot.cornerShape);
    setEditor({ trace, base, baseKey: currentBase, findingId: null, sourceViewId: `${side}:inspection`,
      cropTransform: FULL_CROP, id: crypto.randomUUID(), undo: [],
      proposal: { analysisId: astra.analysisId, proposalId: proposal.id } });
  };
  const point = event => canonicalInspectionPoint({ x: event.clientX, y: event.clientY }, plane.current?.getBoundingClientRect());
  const finishStroke = () => {
    const captured = strokeRef.current; strokeRef.current = null; setStroke([]);
    const points = captured?.points;
    if (!points?.length || !editor || stale || disabled) return;
    const next = applyCompletedSpeedsterTraceStroke({ trace: editor.trace, points, tool: captured.tool, strokeWidthPixels: captured.brush }).trace;
    const clipped = clipSpeedsterTraceToEditorBounds(next, editor.cropTransform, slot.cornerShape);
    setEditor(previous => ({ ...previous, trace: clipped, undo: [...previous.undo.slice(-19), previous.trace] }));
  };
  const inspectTarget = (target, kind, index) => {
    if (viewingDisabled || target.geometryExclusion || (kind === 'suggestion' && !proposalsCurrent)) return;
    const bounds = inspectionBounds(target); if (!bounds) return;
    // Focusing is display-only, even when another finding has an unsaved trace.
    if (kind === 'suggestion') setSelectedProposal(target.id);
    else if (!editor) setSelected(target.id);
    setView(focusInspectionBounds(bounds, viewportSize)); setLens(null);
    setInspecting(`${name(side)} ${kind} ${index + 1}`);
    viewport.current?.scrollIntoView?.({ block: 'nearest', behavior: focusedReview?'auto':typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth' });
    viewport.current?.focus?.({ preventScroll: true });
  };
  const pointerDown = event => {
    if (!ready || busy || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault(); event.stopPropagation?.(); viewport.current?.focus?.({ preventScroll: true });
    if (!editor || panMode || spacePan) {
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerPan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pan };
      setLens(null); return;
    }
    if (stale || disabled) return;
    const first = point(event); if (!first) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    strokeRef.current = { id: event.pointerId, points: [first], tool, brush }; setStroke(strokeRef.current.points);
  };
  const pointerMove = event => {
    if (pointerPan.current) {
      const start = pointerPan.current;
      if (event.pointerId !== undefined && event.pointerId !== start.id) return;
      setView(previous => ({ ...previous, pan: clampInspectionPan({ x: start.pan.x + event.clientX - start.x,
        y: start.pan.y + event.clientY - start.y }, previous.zoom, viewportSize) })); return;
    }
    if (strokeRef.current) {
      if (event.pointerId !== undefined && event.pointerId !== strokeRef.current.id) return;
      const next = point(event);
      if (!next) { finishStroke(); return; }
      strokeRef.current.points.push(next); setStroke([...strokeRef.current.points]);
    }
    if (magnifier && ready && viewport.current && plane.current) {
      const box = viewport.current.getBoundingClientRect(), imageBox = plane.current.getBoundingClientRect();
      setLens({ x: event.clientX - box.left, y: event.clientY - box.top, imageX: event.clientX - imageBox.left,
        imageY: event.clientY - imageBox.top, width: imageBox.width, height: imageBox.height });
    }
  };
  const ownsPointer = event => event?.pointerId === undefined || event.pointerId === (pointerPan.current ?? strokeRef.current)?.id;
  const pointerUp = event => { if (ownsPointer(event)) { pointerPan.current = null; finishStroke(); } };
  const cancelPointer = event => { if (ownsPointer(event)) { pointerPan.current = null; strokeRef.current = null; setStroke([]); setLens(null); } };
  const commitTrace = async () => {
    const rle = encodeSpeedsterTraceRleV1(editor.trace);
    const traceProvenance = buildSpeedsterTraceProvenanceRevision({ sourceViewId: editor.sourceViewId,
      cropTransform: editor.cropTransform, highlighterStrokes: initializeSpeedsterHighlighterStrokes(editor.provenance),
      priorTraceProvenance: editor.provenance, finalTraceSha256: rle.sha256 });
    const trace = { traceWire: encodeSpeedsterTraceBitmapWireV1(editor.trace, rle.sha256), traceProvenance,
      ...(editor.findingId === null ? { id: editor.id, defectType: newType, sourceViewId: editor.sourceViewId } : {}) };
    await (editor.proposal
      ? onReviewProposal({ side, base: editor.base, actor: 'HUMAN', ...editor.proposal, action: 'TRACE_SAVE', trace })
      : onEdit({ side, base: editor.base, actor: 'HUMAN', action: { type: 'TRACE_SAVE', side, findingId: editor.findingId, trace } }));
    setSelected(editor.id); setEditor(null);
    return editor.id;
  };
  const saveTrace = () => {
    if (!editor || stale || disabled || !isNonEmptySpeedsterTrace(editor.trace)) return;
    return perform(commitTrace);
  };
  const resumeSavedTrace = Boolean(editor && pendingAction?.type==='TRACE_SAVE' && onRetry
    && (pendingAction.findingId??pendingAction.trace.id)===editor.id
    && pendingAction.trace.traceWire.rleSha256===encodeSpeedsterTraceRleV1(editor.trace).sha256);
  const observationBlock=Boolean(focusedReview?.unresolvedObservations&&!finding&&!editor);
  const focusedDisabled=observationBlock||busy||locked||!ready||(!resumeSavedTrace&&(pending||stale))||stroke.length>0||!focusedReview?.imagesReady||Boolean(editor&&!isNonEmptySpeedsterTrace(editor.trace));
  const approveFocused = () => {
    if (focusedDisabled) return;
    const inspectionHashes=Object.fromEntries(SIDES.map(value=>[value,workspace.sides[value].frame.inspectionImageSha256]));
    return perform(async()=>{
      let findingId=finding?.reviewResult!=='REMOVED'?finding?.id:null;
      if(resumeSavedTrace){await onRetry(side);findingId=editor.id;setSelected(editor.id);setEditor(null);}
      else if(editor)findingId=await commitTrace();
      await focusedReview.onApprove({side,findingId,inspectionHashes});
    });
  };
  useEffect(()=>{
    if (!focusedReview || editor || !ready) return;
    const target=slot.findings.find(value=>value.id===focusedReview.findingId);
    setSelected(target?.id??null);setCleanView(false);
    if(target && !(initialInspection?.findingId===target.id&&initialInspection.view&&initialInspection.imageSha256===slot.frame.inspectionImageSha256)){const bounds=inspectionBounds(target);if(bounds)setView(focusInspectionBounds(bounds,viewportSizeRef.current));}
    // Adding a trace can leave the next parent selection unchanged. Resume
    // that controlled selection when the local editor closes as well.
  },[focusedReview?.findingId,ready,Boolean(editor)]);
  const reviewTaskStatus=busy?'Saving & checking':error||stale?'Needs attention':!ready||!focusedReview?.imagesReady?'Verifying photographs':pending?'Measurement required':editor?'Unsaved trace':observationBlock?'Observation review required':'Human review required';
  const reviewTaskTitle=editor?(editor.findingId===null?'Trace visible damage':'Correct this finding'):observationBlock?'Resolve original observations':finding?'Review this finding':`Inspect ${name(side)} findings`;
  const reviewTaskCopy=busy?'Your decision is being saved and the measurements checked.':error?error:stale?'This side changed while you were drawing. Your trace is retained; cancel it to use the current saved version.':!ready||!focusedReview?.imagesReady?'Both full photographs must be verified before approval.':pending?'Finish the pending measurement before reviewing another finding. Your saved change is retained.':editor?'Mark only visible damage. Approve saves and measures your trace before recording your review.':observationBlock?'Inspect each original observation below. Add a trace for visible damage. The original observation stays pending until a supported review decision is recorded; reject only a false observation.':finding?'Compare the red trace with the photograph. Adjust or reject it if needed, then approve your decision.':'Inspect this side for damage, then check the other side. Add a finding for anything you can see before approving.';
  const findingTypeControl=finding&&<label>Defect type <select aria-label={`${name(side)} finding type`} disabled={disabled || Boolean(editor) || finding.reviewResult === 'REMOVED' || !onEdit} value={finding.defectType}
    onChange={event => edit({ type: 'CHANGE_TYPE', defectId: finding.id, defectType: event.target.value })}>
    {Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
  </select></label>;
  const findingActions=finding&&<>
    {!focusedReview && onReviewFinding && finding.reviewResult!=='REMOVED' && <button disabled={disabled || reviewedDefectFindingIds(workspace,side).includes(finding.id)} onClick={()=>perform(()=>onReviewFinding(finding))}>{reviewedDefectFindingIds(workspace,side).includes(finding.id)?'Decision saved':'Accept finding'}</button>}
    <button disabled={disabled || finding.reviewResult === 'REMOVED' || !onEdit} onClick={() => start(finding)}>Edit trace</button>
    <button disabled={disabled || !onEdit || Boolean(finding.geometryExclusion)} onClick={() => { if (!finding.geometryExclusion) return edit({ type: finding.reviewResult === 'REMOVED' ? 'UNDO' : 'REMOVE', defectIds: [finding.id] }); }}>{finding.reviewResult === 'REMOVED' ? 'Restore finding' : 'Reject finding'}</button>
  </>;
  const addFindingAction=<button disabled={disabled || !onEdit} onClick={() => start(null)}>Add finding</button>;
  const savedMeasurement=Boolean(editor||pending);
  const viewTools=<>
    {focusedReview&&!editor&&finding&&<div className="ad-focused-type-control">{findingTypeControl}</div>}
    <div className="am-local-tools ad-view-tools" aria-label={`${name(side)} inspection controls`}>
      <label>Zoom <select disabled={viewingDisabled} aria-label={`${name(side)} defect zoom`} value={zoom} onChange={event => changeZoom(Number(event.target.value))}>
        {[1, 2, 4, 8, 16, ...([1, 2, 4, 8, 16].includes(zoom) ? [] : [zoom])].sort((a, b) => a - b).map(value =>
          <option key={value} value={value}>{value === 1 ? 'Fit' : `${Number(value.toFixed(1))}×`}</option>)}
      </select></label>
      <button disabled={viewingDisabled || zoom <= 1} aria-label={`Zoom out ${name(side)}`} onClick={() => changeZoom(zoom / 1.5)}>−</button>
      <button disabled={viewingDisabled || zoom >= MAX_INSPECTION_ZOOM} aria-label={`Zoom in ${name(side)}`} onClick={() => changeZoom(zoom * 1.5)}>+</button>
      <button disabled={viewingDisabled} onClick={fit}>Fit image</button>
      {!focusedReview && <button disabled={stroke.length > 0} aria-label={expanded ? 'Return to paired inspection' : `Expand ${name(side)} inspection`} onClick={onExpand}>{expanded ? 'Return to pair' : 'Expand image'}</button>}
      <label><input type="checkbox" checked={magnifier} disabled={!ready} onChange={event => { setMagnifier(event.target.checked); setLens(null); }} />3× magnifier</label>
      <label><input type="checkbox" checked={hideOverlays} onChange={event => setHideOverlays(event.target.checked)} />Hide overlays</label>
      {editor && <button disabled={stroke.length > 0} aria-pressed={panMode} onClick={() => setPanMode(previous => !previous)}>Pan image</button>}
    </div>
    <div className="am-local-tools ad-overlay-tools">
      <label><input type="checkbox" checked={showMasks} onChange={event => setShowMasks(event.target.checked)} />Show findings</label>
      {astra?.enabled && <label><input type="checkbox" checked={showProposals} onChange={event => setShowProposals(event.target.checked)} />Show ATLAS suggestions</label>}
      {zoom > 1 && <div className="am-pan" aria-label={`${name(side)} defect pan`}>
        {[[1, 0, 'Left', '←'], [0, 1, 'Up', '↑'], [0, -1, 'Down', '↓'], [-1, 0, 'Right', '→']].map(([x, y, label, symbol]) =>
          <button disabled={viewingDisabled} key={label} aria-label={`Pan ${name(side)} ${label.toLowerCase()}`} onClick={() => moveView({ x: x * 80, y: y * 80 })}>{symbol}</button>)}
      </div>}
    </div>
    <p className="ad-view-help">Scroll to zoom · drag to pan{editor ? ' with Pan image or hold Space' : ''} · hold H to hide outlines</p>
  </>;
  return <section className={`am-side ad-side${expanded ? ' ad-expanded' : ''}`} hidden={hidden} aria-label={`${name(side)} defects`}>
    <div className="am-side-heading"><h2>{name(side)}</h2><span>{busy ? 'Saving…' : editor ? 'Unsaved trace' : pending ? 'Measurement pending' : inspected ? 'Inspected' : 'Inspect this side'}</span></div>
    <div className="ad-inspection-panel">
    {focusedReview?<div className="ad-focused-viewbar"><span className="ad-orientation">{name(side)} <small>{cleanView?'Clean':'Marked'}</small></span>
      <div><button type="button" disabled={!ready||busy||Boolean(editor)||stroke.length>0} aria-pressed={cleanView} onClick={()=>setCleanView(value=>!value)}>{cleanView?'Marked photo':'Clean photo'}</button>
      <button type="button" disabled={!ready||busy||stroke.length>0} aria-pressed={comparison} onClick={()=>{if(!comparison)setCleanView(false);setComparison(value=>!value);}}>{comparison?'Single view':'Compare'}</button>
      <details className="ad-focused-tools"><summary>Tools</summary><div className="ad-focused-tool-panel">{viewTools}</div></details></div></div>:viewTools}
    <EvidenceWrap {...(focusedReview?{className:`ad-evidence-grid${comparison?' ad-compare':''}`}:{})}>
    <div ref={viewport} className={`ad-viewport${editor && !panMode && !spacePan ? ' ad-drawing' : ''}`} tabIndex={0} role="region" aria-label={`${name(side)} image inspection`}
      onPointerDown={event => { if (event.target === event.currentTarget && (!editor || panMode || spacePan)) pointerDown(event); }}
      onPointerMove={event => { if (event.target === event.currentTarget) pointerMove(event); }} onPointerUp={pointerUp} onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}
      onPointerLeave={() => setLens(null)} onBlur={() => { setSpacePan(false); setPeek(false); }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || strokeRef.current || pointerPan.current) return;
        if (event.key === ' ') { event.preventDefault(); setSpacePan(true); }
        else if (event.key.toLowerCase() === 'h') { event.preventDefault(); setPeek(true); }
        else if (!viewingDisabled) {
          const deltas = { ArrowLeft: { x: 80, y: 0 }, ArrowRight: { x: -80, y: 0 }, ArrowUp: { x: 0, y: 80 }, ArrowDown: { x: 0, y: -80 } };
          if (deltas[event.key]) { event.preventDefault(); moveView(deltas[event.key]); }
          else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); changeZoom(event.key === '-' ? zoom / 1.5 : zoom * 1.5); }
          else if (event.key === 'Home' || event.key === '0') { event.preventDefault(); fit(); }
        }
      }} onKeyUp={event => { if (event.key === ' ') setSpacePan(false); if (event.key.toLowerCase() === 'h') setPeek(false); }}>
      {supplied ? <div ref={plane} className="ad-plane" style={planeStyle}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelPointer}>
        {verified.url && <img key={binding} src={verified.url} alt={`${name(side)} inspection image`} draggable="false"
          onLoad={event => setLoaded(event.currentTarget.naturalWidth === 1350 && event.currentTarget.naturalHeight === 1858 ? binding : null)}
          onError={() => setLoaded(null)} />}
        <div className="ad-card-plane">
        {focusedReview?<ExactFindingOverlay shape={focusedShape} visible={showMasks&&overlaysVisible&&ready}/>:<FindingOverlay findings={slot.findings} selected={pendingTrace ? pendingAction.findingId ?? pendingAction.trace.id : selected} trace={editor?.trace ?? pendingTrace} visible={showMasks && overlaysVisible && ready} />}
        {!focusedReview&&<ProposalOverlay proposals={proposals} selected={selectedProposal} visible={showProposals && overlaysVisible && proposalsCurrent && ready && !editor} />}
        {overlaysVisible && stroke.length > 0 && <svg className="ad-stroke" viewBox="0 0 1269 1777" aria-hidden="true"><polyline
          points={stroke.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={strokeRef.current?.tool === 'ERASER' ? '#ffffff' : '#df3f24'}
          strokeWidth={strokeRef.current?.brush ?? brush} strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
      </div> : <div className="am-empty">Inspection image unavailable.</div>}
      {focusedReview&&finding&&!editor&&!pending&&showMasks&&overlaysVisible&&ready&&<SelectedFindingCallout anchor={focusedShape.anchor} view={view} size={viewportSize} scale={scale} label={TYPES[finding.defectType]} number={(focusedReview.navigation?.index??slot.findings.findIndex(value=>value.id===finding.id))+1}/>}
      {!focusedReview && magnifier && lens && ready && <div className="ad-magnifier" aria-hidden="true" style={{
        [lens.x > viewportSize.width / 2 ? 'left' : 'right']: 12,
        backgroundImage: `url("${verified.url}")`, backgroundSize: `${lens.width * 3}px ${lens.height * 3}px`,
        backgroundPosition: `${100 - lens.imageX * 3}px ${100 - lens.imageY * 3}px`,
      }}><span>3× · image only</span></div>}
    </div>
    {focusedReview&&comparison&&<div className="ad-clean-viewport" role="region" aria-label={`${name(side)} clean comparison`}>
      <span className="ad-clean-label">{name(side)} · Clean</span>
      {ready?<div className="ad-plane ad-clean-plane" style={planeStyle}><img src={verified.url} alt={`${name(side)} clean inspection image`} draggable="false"/></div>:<div className="am-empty">Verifying the same inspection photo…</div>}
    </div>}
    </EvidenceWrap>
    <p className="ad-focus-status" role="status">{inspecting ? `Inspecting ${inspecting} · ` : ''}Full image includes space around every card edge.</p>
    {!ready && supplied && <p role={verified.error ? 'alert' : 'status'}>{verified.error ? 'Inspection image unavailable or its bytes did not match. Your trace is retained.' : 'Waiting for the current verified inspection image.'}</p>}
    </div>
    <div className="ad-review-panel">
    {focusedReview&&<section className="atlas-review-task" aria-label="Your review"><span className="atlas-review-eyebrow">Your review</span><h3>{reviewTaskTitle}</h3><span className="atlas-review-status" role="status">{reviewTaskStatus}</span><p>{reviewTaskCopy}</p></section>}
    {focusedReview&&magnifier&&<div className="ad-inspector-precision" aria-label="Finding precision view"><strong>Precision view · 3×</strong>{lens&&ready?<div className="ad-magnifier" aria-hidden="true" style={{backgroundImage:`url("${verified.url}")`,backgroundSize:`${lens.width*3}px ${lens.height*3}px`,backgroundPosition:`${100-lens.imageX*3}px ${100-lens.imageY*3}px`}}><span>Photograph · no overlays</span></div>:<p>Move over the photograph to inspect its detail.</p>}</div>}
    {focusedReview?.renderObservations?.({side,onTrace:()=>start(null),disabled:disabled||Boolean(editor)})}
    {focusedReview&&finding&&<section className="ad-focused-measurements" aria-label="Selected finding measurements">
      <div className="ad-focused-finding-title"><span>Finding {(focusedReview.navigation?.index??slot.findings.findIndex(value=>value.id===finding.id))+1} · {name(side)}</span><h3>{TYPES[finding.defectType]}</h3></div>
      <dl><div><dt>{savedMeasurement?'Saved area':'Measured area'}</dt><dd>{areaOf(finding).toLocaleString('en-US',{maximumFractionDigits:6})} <small>mm²</small></dd></div>
        {savedBounds&&<div><dt>{savedMeasurement?'Saved region bounds':'Region bounds'}</dt><dd>{(savedBounds.width*63.5).toLocaleString('en-US',{maximumFractionDigits:3})} × {(savedBounds.height*88.9).toLocaleString('en-US',{maximumFractionDigits:3})} <small>mm</small></dd></div>}
        {regionsOf(finding).map((region,index)=><div key={`${region.zone}:${index}`}><dt>{savedMeasurement?'Saved ':''}{region.zone.toLowerCase()}</dt><dd>{region.measurement.pixelCount!==undefined?`${region.measurement.pixelCount.toLocaleString('en-US')} px`: `${region.measurement.areaMm2.toLocaleString('en-US',{maximumFractionDigits:6})} mm²`}</dd></div>)}</dl>
      {!editor&&<div className="am-side-actions ad-focused-finding-actions">{addFindingAction}{findingActions}</div>}
      {savedMeasurement&&<p>Saved measurements · updated after {editor?'Approve':'measurement finishes'}</p>}
    </section>}{disabled && !editor && <p role="status">{pending?'This change is saved; measurement must finish before another edit. Retry measurement below.':busy?'Saving your decision…':locked?'Finish the current save before editing.':'Full photo verification is required before adding or changing a finding.'}</p>}
    {editor ? <div className="ad-trace-tools">
      {editor.proposal && <p className="ad-proposal-note">Correcting an ATLAS suggestion. Save the trace to add your corrected finding.</p>}
      {stale && <p role="alert">This side changed while you were drawing. Discard this trace to use its latest saved version.</p>}
      {editor.findingId === null && <label>Defect type <select value={newType} onChange={event => setNewType(event.target.value)} disabled={busy}>
        {Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>}
      <div className="am-local-tools"><button disabled={busy || stroke.length > 0} aria-pressed={tool === 'BRUSH'} onClick={() => setTool('BRUSH')}>Brush</button><button disabled={busy || stroke.length > 0} aria-pressed={tool === 'ERASER'} onClick={() => setTool('ERASER')}>Eraser</button>
        <label>Width <select disabled={busy || stroke.length > 0} aria-label={`${name(side)} brush width`} value={brush} onChange={event => setBrush(Number(event.target.value))}>
          {[1, 2, 4, 8, 16, 32].map(width => <option key={width} value={width}>{width} px</option>)}
        </select></label><button disabled={busy || stroke.length > 0 || !editor.undo.length} onClick={() => setEditor(previous => ({ ...previous, trace: previous.undo.at(-1), undo: previous.undo.slice(0, -1) }))}>Undo stroke</button></div>
      {(renderEditActions ?? (children=>children))(<div className="am-side-actions">{!focusedReview && <button className="am-primary" disabled={disabled || stale || stroke.length > 0 || !isNonEmptySpeedsterTrace(editor.trace)} onClick={saveTrace}>Save trace</button>}
        <button disabled={busy} onClick={() => { strokeRef.current = null; setStroke([]); setSelected(focusedReview?.findingId??editor.findingId); setEditor(null); setError(''); }}>Cancel trace</button></div>,side)}
    </div> : (!focusedReview||!finding||pending)&&<div className="am-side-actions">{(!focusedReview||!finding)&&addFindingAction}
        {pending && onRetry && <button disabled={busy || locked} onClick={() => perform(() => onRetry(side))}>Retry measurement</button>}
        {pending && onDiscardPending && <button disabled={busy || locked} onClick={() => perform(() => onDiscardPending({ side, base }))}>Discard pending change</button>}
      </div>}
      {!focusedReview&&<ul className="ad-findings" aria-label={`${name(side)} findings`}>
        {slot.findings.filter(entry=>!focusedReview || entry.id===selected).map((entry, index) => <li key={entry.id} className={`${selected === entry.id ? 'ad-selected' : ''} ${entry.reviewResult === 'REMOVED' ? 'ad-removed' : ''}`}>
          <button className="ad-finding-name" disabled={Boolean(editor)} aria-pressed={selected === entry.id} onClick={() => setSelected(entry.id)}>{index + 1}. {TYPES[entry.defectType]}</button>
          <span>{entry.geometryExclusion ? 'Removed · retained in previous image frame' : entry.reviewResult === 'REMOVED' ? 'Removed' : `${areaOf(entry).toFixed(3)} mm² · ${regionsOf(entry).map(r => r.zone.toLowerCase()).join(', ')}`}</span>
          <button className="ad-inspect-target" disabled={viewingDisabled || Boolean(entry.geometryExclusion)} aria-label={`Inspect ${name(side)} finding ${index + 1}`} onClick={() => inspectTarget(entry, 'finding', index)}>Inspect finding</button>
        </li>)}
      </ul>}
      {!editor && <>
      {!slot.findings.length && <p className="ad-muted">No findings yet. Inspect the image and add any damage you can see.</p>}
      {finding && (!focusedReview||finding.geometryExclusion) && <div className="ad-finding-tools">
        {finding.geometryExclusion && <p>This removed observation is retained in its previous image frame. Add a new trace to restore this finding on the current photograph.</p>}
        {!focusedReview&&<>{findingTypeControl}<div className="am-side-actions">{findingActions}</div></>}
      </div>}

    </>}
    {astra?.enabled && proposals.length > 0 && <section className="ad-proposals" aria-label={`${name(side)} ATLAS suggestions`}>
      <div className="ad-proposal-heading"><h3>ATLAS suggestions</h3><span>Blue outlines · review required</span></div>
      {!proposalsCurrent && <p className="ad-muted">These suggestions cannot be added from this analysis. Your saved findings are unchanged.</p>}
      <ul className="ad-proposal-list">{proposals.map((proposal, index) => {
        const unreviewed = proposal.reviewStatus === 'UNREVIEWED', valid = validProposalContour(proposal) && TYPES[proposal.defectType];
        return <li key={proposal.id} className={selectedProposal === proposal.id ? 'ad-proposal-selected' : ''}>
          <button className="ad-finding-name" aria-pressed={selectedProposal === proposal.id} onClick={() => setSelectedProposal(proposal.id)}>
            {index + 1}. {TYPES[proposal.defectType] ?? 'Unrecognized suggestion'}</button>
          <span className="ad-proposal-result">{{ UNREVIEWED: 'Unreviewed', ACCEPTED: 'Accepted', CORRECTED: 'Corrected', REJECTED: 'Rejected' }[proposal.reviewStatus] ?? 'Review status unavailable'}</span>
          {proposal.observation && <p>{proposal.observation}</p>}
          {proposal.uncertainty && <p className="ad-muted">Uncertainty: {{ LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' }[proposal.uncertainty] ?? proposal.uncertainty}</p>}
          {!valid && <p className="ad-muted">This suggestion has no usable outline or type. Add a finding manually if needed.</p>}
          <button className="ad-inspect-target" disabled={viewingDisabled || !validProposalContour(proposal) || !proposalsCurrent}
            aria-label={`Inspect ${name(side)} suggestion ${index + 1}`} onClick={() => inspectTarget(proposal, 'suggestion', index)}>Inspect suggestion</button>
          {unreviewed && <div className="am-side-actions">
            <button disabled={proposalDisabled || !valid} onClick={() => reviewProposal(proposal, 'ACCEPT')}>Accept suggestion</button>
            <button disabled={proposalDisabled || !valid} onClick={() => correctProposal(proposal)}>Correct trace</button>
            <button disabled={proposalDisabled || !valid} onClick={() => reviewProposal(proposal, 'REJECT')}>Reject suggestion</button>
          </div>}
        </li>;
      })}</ul>
    </section>}
    {error && <p role="alert">{error}</p>}
    {focusedReview && !hidden && focusedReview.renderActions({approve:approveFocused,disabled:focusedDisabled,busy, message:resumeSavedTrace?'Trace saved · Approve retries measurement, then reviews the finding.':editor?'Approve saves this trace and reviews the finding.':focusedReview.message})}
    </div>
  </section>;
}

/** Controlled human review. Callbacks must authenticate, durably save/read back,
 * and then update workspace. Full masks remain in verified artifact storage;
 * browser state and a checked descriptor are not approval or storage authority. */
export function DefectReviewWorkspace({ readOnly = false, workspace, images, onEdit, onInspectBoth, onConfirm, onRetry, onDiscardPending, onContinue, onEditingChange, saveStatus = '', grade, renderReviewActions, renderEditActions, initialInspection, onInspectionChange, onReturn, onReviewFinding, focusedReview, onReadyChange,
  astra, attentionMessage, onAnalyzeDefects, onRefreshAnalysis, onResumeAnalysis, onReplaceAnalysis, onReviewProposal, reviewedMemory, onRetryReviewedMemory }) {
  const [activity, setActivity] = useState({}), [ready, setReady] = useState({}), [confirming, setConfirming] = useState(false), [error, setError] = useState('');
  const [expandedSide, setExpandedSide] = useState(focusedReview?.side ?? initialInspection?.side ?? null);
  useEffect(()=>{if(focusedReview?.side)setExpandedSide(focusedReview.side);},[focusedReview?.side]);
  const status = defectStatus(workspace);
  const [unknownAnalysis, setUnknownAnalysis] = useState(null);
  const analysisKey = key({ analysisId: astra?.analysisId, status: astra?.status });
  const analysis = astraReviewState(workspace, unknownAnalysis === analysisKey ? { ...astra, status: 'UNKNOWN' } : astra), memory = reviewedMemoryState(reviewedMemory);
  const collective = collectiveProposalReview(workspace, astra);
  const reportReady = status.confirmed && collective.unresolvedCount === 0;
  const [requesting, setRequesting] = useState(false), [recoveringMemory, setRecoveringMemory] = useState(false);
  const requestRef = useRef(false), memoryRef = useRef(false), confirmRef = useRef(false);
  const onActivity = useCallback((side, value) => setActivity(previous => previous[side] === value ? previous : { ...previous, [side]: value }), []);
  const onReady = useCallback((side, value) => setReady(previous => previous[side] === value ? previous : { ...previous, [side]: value }), []);
  const editing = SIDES.some(side => activity[side]);
  useEffect(() => { onEditingChange?.(editing || confirming); return () => onEditingChange?.(false); }, [editing, confirming, onEditingChange]);
  const currentImagesReady = SIDES.every(side => images?.[side]?.inspection?.sha256 === workspace.sides[side].frame.inspectionImageSha256
    && ready[side] === inspectionImageBinding(workspace, side, images?.[side]));
  useEffect(()=>{onReadyChange?.(currentImagesReady);},[currentImagesReady,onReadyChange]);
  const navigation=focusedReview?.navigation;
  const navigationItems=navigation?.items??[];
  const navigationIndex=Number.isInteger(navigation?.index)?navigation.index:-1;
  const navigationTotal=navigation?.total??navigationItems.length;
  const navigationLocked=editing||confirming||!status.settled;
  const previousDisabled=navigationLocked||navigationIndex<=0||!navigation?.onPrevious;
  const nextDisabled=navigationLocked||navigationIndex>=navigationTotal-1||navigationTotal===0||!navigation?.onNext;
  const previousFinding=()=>{if(!previousDisabled)navigation.onPrevious();};
  const nextFinding=()=>{if(!nextDisabled)navigation.onNext();};
  const jumpFinding=id=>{if(!navigationLocked&&navigation?.onSelect&&navigationItems.some(item=>item.id===id))navigation.onSelect(id);};
  const inspectBoth = async () => {
    if (readOnly || !status.settled || status.canConfirm || !currentImagesReady || editing || confirmRef.current || !onInspectBoth) return;
    confirmRef.current = true; setConfirming(true); setError('');
    try { await onInspectBoth(); }
    catch { setError('Inspection was not saved for both sides. Try the confirmation box again.'); }
    finally { confirmRef.current = false; setConfirming(false); }
  };
  const confirm = async () => {
    if (readOnly || !status.canConfirm || !currentImagesReady || !collective.ready || editing || confirmRef.current || !onConfirm) return;
    confirmRef.current = true;
    setConfirming(true); setError('');
    try { await onConfirm({ base: { FRONT: defectBase(workspace, 'FRONT'), BACK: defectBase(workspace, 'BACK') }, actor: 'HUMAN', reviewed: true,
      ...(collective.proposalReview ? { proposalReview: collective.proposalReview } : {}) }); }
    catch { setError('Findings were not confirmed saved. Review the current state and try again.'); }
    finally { confirmRef.current = false; setConfirming(false); }
  };
  const requestAnalysis = async (mode = 'START') => {
    if ((readOnly && mode !== 'REFRESH') || requestRef.current || confirming || (['START', 'REPLACE'].includes(mode) && astra?.requestAvailable === false) || (mode === 'START' && (!analysis.mayRequest || astra?.followLatest || !currentImagesReady || editing || !onAnalyzeDefects))
      || (mode === 'REFRESH' && !onRefreshAnalysis) || (mode === 'RESUME' && (!astra?.resumeAvailable || !onResumeAnalysis))
      || (mode === 'REPLACE' && (analysis.status !== 'UNKNOWN' || !astra?.replacement || astra.backgroundAccepted
        || !currentImagesReady || editing || !onReplaceAnalysis))) return;
    requestRef.current = true; setRequesting(mode); setError('');
    try {
      if (mode === 'REFRESH') await onRefreshAnalysis();
      else if (mode === 'RESUME') await onResumeAnalysis();
      else if (mode === 'REPLACE') await onReplaceAnalysis({ base: { FRONT: defectBase(workspace, 'FRONT'), BACK: defectBase(workspace, 'BACK') }, actor: 'HUMAN' });
      else await onAnalyzeDefects({ base: { FRONT: defectBase(workspace, 'FRONT'), BACK: defectBase(workspace, 'BACK') }, actor: 'HUMAN' });
      setUnknownAnalysis(null);
    } catch { setUnknownAnalysis(analysisKey); setError('The analysis result was not confirmed. Your manual findings and current trace are retained.'); }
    finally { requestRef.current = false; setRequesting(false); }
  };
  const recoverMemory = async () => {
    if (readOnly || memoryRef.current || !memory?.mayRecover || !onRetryReviewedMemory) return;
    memoryRef.current = true; setRecoveringMemory(true); setError('');
    try { await onRetryReviewedMemory(); }
    catch { setError('The reviewed example save is not confirmed. Your findings remain available.'); }
    finally { memoryRef.current = false; setRecoveringMemory(false); }
  };
  return <div className={`atlas-manual ad-workspace${focusedReview?' ad-focused':''}`}>
    <header className="am-header"><span className="am-brand">ATLAS</span><h1>Defects & condition</h1><span>{saveStatus}</span></header>
    {readOnly&&<p role="status">Read-only review. Ask a reviewer to save or confirm changes.</p>}
    {!focusedReview && <div className="am-toolbar">{onReturn&&<button type="button" disabled={editing||confirming||!status.settled} onClick={onReturn}>Return to findings review</button>}<span>{analysis.enabled ? 'Run ATLAS’s initial inspection, then review and correct its findings on both sides.' : 'Inspect both sides. Correct, remove or trace findings before confirming.'}</span>{grade && <strong>Draft grade {grade}</strong>}</div>}
    {!focusedReview && analysis.enabled && <section className="ad-astra" aria-label="ATLAS defect assistance" data-review-target="analysis" data-review-attention={Boolean(attentionMessage)} tabIndex={-1}>
      {attentionMessage && <p className="mc-review-reason">{attentionMessage}</p>}
      <div><h2>ATLAS defect assistance</h2><p role="status">{requesting ? requesting === 'REFRESH' ? 'Checking the saved ATLAS analysis…' : 'Sending the card to ATLAS for its initial inspection…' : analysis.message}</p>
        {analysis.status === 'READY' && <p>{collective.unresolvedCount} suggestions remaining for confirmation · {collective.rejectedCount} rejected suggestions</p>}
        {Array.isArray(astra?.limitations) && astra.limitations.some(value => typeof value === 'string' && value) && <ul className="ad-analysis-limitations" aria-label="ATLAS image limitations">
          {astra.limitations.filter(value => typeof value === 'string' && value).slice(0,8).map((value,index) => <li key={index}>{value}</li>)}
        </ul>}
      </div>
      <div className="am-side-actions"><button disabled={readOnly || requesting || confirming || editing || !currentImagesReady || !analysis.mayRequest || astra?.followLatest || !onAnalyzeDefects}
        onClick={() => requestAnalysis()}>Find defects with ATLAS</button>
        {(['RUNNING', 'UNKNOWN'].includes(analysis.status) || astra?.followLatest) && onRefreshAnalysis && <button disabled={requesting || confirming} onClick={() => requestAnalysis('REFRESH')}>Check analysis status</button>}
        {astra?.resumeAvailable && onResumeAnalysis && <button disabled={readOnly || requesting || confirming} onClick={() => requestAnalysis('RESUME')}>Retry saved analysis</button>}
        {analysis.status === 'UNKNOWN' && astra?.replacement && !astra.backgroundAccepted && onReplaceAnalysis && <button
          disabled={readOnly || requesting || confirming || editing || !currentImagesReady || astra?.requestAvailable === false} onClick={() => requestAnalysis('REPLACE')}>Start a new ATLAS analysis</button>}
      </div>
    </section>}
    {focusedReview&&navigation&&<nav className="ad-focused-navigation" aria-label="Finding navigation" tabIndex={0} onKeyDown={event=>{
      if(event.target!==event.currentTarget)return;
      if(event.key==='ArrowLeft'){event.preventDefault();previousFinding();}
      if(event.key==='ArrowRight'){event.preventDefault();nextFinding();}
    }}><button type="button" disabled={previousDisabled} onClick={previousFinding}>Previous finding</button>
      <span aria-live="polite">{navigationIndex>=0?`Finding ${navigationIndex+1} of ${navigationTotal}`:'Inspect this side'}</span>
      <label><span className="ad-jump-label">Jump to finding</span><select aria-label="Jump to finding" value={focusedReview.findingId??''} disabled={navigationLocked||!navigation?.onSelect||!navigationItems.length} onChange={event=>jumpFinding(event.target.value)}>
        {!focusedReview.findingId&&<option value="">Choose a finding</option>}{navigationItems.map((item,index)=><option key={item.id} value={item.id}>{index+1} · {name(item.side)} · {item.label}</option>)}
      </select></label><button type="button" disabled={nextDisabled} onClick={nextFinding}>Next finding</button></nav>}
    {expandedSide && <div className="ad-expanded-switch" aria-label="Expanded inspection side">{SIDES.map(side => <button key={side}
      aria-pressed={expandedSide === side} disabled={Boolean(focusedReview&&editing)} onClick={() => focusedReview?.onSideSelect?focusedReview.onSideSelect(side):setExpandedSide(side)}>Inspect {name(side)}</button>)}</div>}
    <div className={`am-pair${expandedSide ? ' ad-expanded-pair' : ''}`}>{SIDES.map(side => <DefectSide key={`${workspace.cardId}:${side}`} workspace={workspace} side={side} image={images?.[side]}
      onEdit={onEdit} onRetry={onRetry} onDiscardPending={onDiscardPending} onReady={onReady} onActivity={onActivity} locked={confirming||readOnly}
      astra={astra} onReviewProposal={onReviewProposal} expanded={expandedSide === side} hidden={Boolean(expandedSide && expandedSide !== side)}
      focusedReview={focusedReview?{...focusedReview,imagesReady:currentImagesReady}:undefined} renderEditActions={renderEditActions} initialInspection={initialInspection} onInspectionChange={onInspectionChange} onReviewFinding={onReviewFinding} onExpand={() => setExpandedSide(previous => previous === side ? null : side)} />)}</div>
    {memory && <div className="ad-memory" aria-label="Reviewed example memory"><p role="status">{recoveringMemory ? 'Checking the saved reviewed examples…' : memory.message}</p>
      {memory.mayRecover && onRetryReviewedMemory && <button disabled={readOnly || recoveringMemory || confirming} onClick={recoverMemory}>
        {memory.status === 'FAILED' ? 'Retry saving examples' : 'Check example save'}</button>}
    </div>}
    {!focusedReview && (renderReviewActions ? renderReviewActions({
      approve:reportReady && onContinue ? onContinue : confirm,
      disabled:readOnly || editing || confirming || !currentImagesReady || !status.canConfirm || !collective.ready, busy:confirming,
      message:editing ? 'Save or discard your trace.' : collective.unresolvedCount ? `Approve accepts ${collective.unresolvedCount} remaining suggestions.` : 'Confirm corners, edges and surface.',
      inspection:<label className="mc-rapid-inspection"><input type="checkbox" aria-label="I inspected both Front and Back" checked={status.canConfirm} disabled={readOnly || status.canConfirm || !status.settled || !currentImagesReady || editing || confirming || !onInspectBoth} onChange={inspectBoth}/><span>I inspected both Front and Back</span></label>
    }) : <footer className="am-footer ad-confirm-footer">
      <label className={`ad-confirm-inspection${status.canConfirm ? ' ad-confirmed' : ''}`}>
        <input type="checkbox" aria-label="I inspected both Front and Back" checked={status.canConfirm}
          disabled={readOnly || status.canConfirm || !status.settled || !currentImagesReady || editing || confirming || !onInspectBoth} onChange={inspectBoth}/>
        <span><strong>{confirming && !status.canConfirm ? 'Saving inspection…' : 'I inspected both Front and Back'}</strong><small>Including corners, edges and surface. My corrections are saved.</small></span>
      </label><span>{editing ? 'Save or discard your trace before continuing.' : collective.unresolvedCount > 0
      ? collective.ready ? `After reviewing Front and Back, Confirm accepts all ${collective.unresolvedCount} remaining displayed suggestions and preserves your corrections and rejections. Final report approval stays separate.`
        : 'Reload images to refresh the saved suggestion list before confirming. Your corrections are retained.'
      : reportReady ? 'Findings confirmed. Final report approval is a separate step.' : status.canConfirm ? 'Inspection saved. Confirm findings to continue.' : 'Check the inspection box above, then confirm findings.'}</span>
      {reportReady && onContinue ? <button className="am-primary" onClick={onContinue} disabled={editing || confirming || !currentImagesReady}>Review draft report</button>
        : <button className="am-primary" onClick={confirm} disabled={readOnly || !status.canConfirm || !currentImagesReady || !collective.ready || editing || confirming || !onConfirm}>{confirming ? 'Confirming…' : collective.unresolvedCount ? `Confirm findings & accept ${collective.unresolvedCount} suggestions` : 'Confirm findings'}</button>}
    </footer>)}{error && <p className="am-error" role="alert">{error}</p>}
  </div>;
}
