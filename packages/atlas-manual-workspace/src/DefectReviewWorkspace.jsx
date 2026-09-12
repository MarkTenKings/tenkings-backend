import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeSpeedsterTraceRleV1, encodeSpeedsterTraceRleV1, speedsterTraceRleV1Spans } from '@atlas/grading-core/trace-codec';
import { decodeSpeedsterTraceBitmapWireV1, encodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { applyCompletedSpeedsterTraceStroke, buildSpeedsterTraceProvenanceRevision, clipSpeedsterTraceToEditorBounds,
  createEmptySpeedsterTrace, initializeSpeedsterHighlighterStrokes, isNonEmptySpeedsterTrace,
  panelPointToCanonicalPixel, rasterizeSpeedsterCanonicalContour } from '@atlas/grading-core/trace-editor';
import { defectBase, defectStatus } from './defect-actions.mjs';
import { useVerifiedImage } from './verified-image.mjs';

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

function DefectSide({ workspace, side, image, onEdit, onInspect, onRetry, onDiscardPending, onReady, onActivity, locked }) {
  const slot = workspace.sides[side], base = defectBase(workspace, side), currentBase = key(base);
  const descriptor = image?.inspection;
  const binding = inspectionImageBinding(workspace, side, image);
  const supplied = descriptor?.url && descriptor.sha256 === slot.frame.inspectionImageSha256;
  const verified = useVerifiedImage(supplied ? descriptor : null);
  const [loaded, setLoaded] = useState(null), [selected, setSelected] = useState(null), [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 }), [showMasks, setShowMasks] = useState(true);
  const [tool, setTool] = useState('BRUSH'), [brush, setBrush] = useState(4), [newType, setNewType] = useState('LIGHT_SCRATCH_SCUFF');
  const [stroke, setStroke] = useState([]), strokeRef = useRef(null), plane = useRef(null);
  const ready = Boolean(supplied && verified.url && loaded === binding);
  const stale = Boolean(editor && editor.baseKey !== currentBase);
  const pending = Boolean(slot.pending), disabled = busy || locked || pending || !ready;
  const pendingAction = slot.pending?.action;
  const pendingTrace = useMemo(() => pendingAction?.type === 'TRACE_SAVE' ? decodeSpeedsterTraceBitmapWireV1(pendingAction.trace.traceWire) : null, [pendingAction]);
  const finding = slot.findings.find(entry => entry.id === selected);
  const inspected = Boolean(slot.inspection);
  useEffect(() => { onReady(side, ready ? binding : null); }, [side, ready, binding, onReady]);
  useEffect(() => { onActivity(side, Boolean(editor || busy)); }, [side, editor, busy, onActivity]);
  useEffect(() => {
    if (!editor && selected && !slot.findings.some(entry => entry.id === selected)) setSelected(null);
  }, [slot.findings, selected, editor]);
  const perform = async callback => {
    setBusy(true); setError('');
    try { await callback(); return true; }
    catch { setError('The change was not confirmed saved. Your current work is retained.'); return false; }
    finally { setBusy(false); }
  };
  const edit = action => perform(() => onEdit({ side, base, actor: 'HUMAN', action }));
  const start = target => {
    if (disabled || editor) return;
    const mask = target && maskOf(target);
    let trace = createEmptySpeedsterTrace();
    if (mask) trace = decodeSpeedsterTraceRleV1(mask);
    else if (target?.canonicalContour) trace = rasterizeSpeedsterCanonicalContour(target.canonicalContour);
    setSelected(target?.id ?? null); setShowMasks(true); setError('');
    setEditor({ trace, base, baseKey: currentBase, findingId: target?.id ?? null,
      sourceViewId: target?.sourceViewId ?? `${side}:inspection`,
      provenance: target?.traceProvenance, cropTransform: target?.traceProvenance?.cropTransform ?? FULL_CROP, id: target?.id ?? crypto.randomUUID(), undo: [] });
  };
  const point = event => {
    const box = plane.current.getBoundingClientRect();
    return panelPointToCanonicalPixel({ x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }, FULL_CROP);
  };
  const finishStroke = () => {
    const captured = strokeRef.current; strokeRef.current = null; setStroke([]);
    const points = captured?.points;
    if (!points?.length || !editor || stale || disabled) return;
    const next = applyCompletedSpeedsterTraceStroke({ trace: editor.trace, points, tool: captured.tool, strokeWidthPixels: captured.brush }).trace;
    const clipped = clipSpeedsterTraceToEditorBounds(next, editor.cropTransform, slot.cornerShape);
    setEditor(previous => ({ ...previous, trace: clipped, undo: [...previous.undo.slice(-19), previous.trace] }));
  };
  const saveTrace = async () => {
    if (!editor || stale || disabled || !isNonEmptySpeedsterTrace(editor.trace)) return;
    const rle = encodeSpeedsterTraceRleV1(editor.trace);
    const traceProvenance = buildSpeedsterTraceProvenanceRevision({ sourceViewId: editor.sourceViewId,
      cropTransform: editor.cropTransform, highlighterStrokes: initializeSpeedsterHighlighterStrokes(editor.provenance),
      priorTraceProvenance: editor.provenance, finalTraceSha256: rle.sha256 });
    const trace = { traceWire: encodeSpeedsterTraceBitmapWireV1(editor.trace, rle.sha256), traceProvenance,
      ...(editor.findingId === null ? { id: editor.id, defectType: newType, sourceViewId: editor.sourceViewId } : {}) };
    const saved = await perform(() => onEdit({ side, base: editor.base, actor: 'HUMAN',
      action: { type: 'TRACE_SAVE', side, findingId: editor.findingId, trace } }));
    if (saved) { setSelected(editor.id); setEditor(null); }
  };
  return <section className="am-side ad-side" aria-label={`${name(side)} defects`}>
    <div className="am-side-heading"><h2>{name(side)}</h2><span>{busy ? 'Saving…' : editor ? 'Unsaved trace' : pending ? 'Measurement pending' : inspected ? 'Inspected' : 'Inspect this side'}</span></div>
    <p className="am-view-label">Inspection image · card area</p>
    <div className="ad-viewport">
      {supplied ? <div ref={plane} className="ad-plane" style={{ transform: `translate(${pan.x}%,${pan.y}%) scale(${zoom})` }}
        onPointerDown={event => {
          if (!editor || stale || disabled || event.button !== 0) return;
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          strokeRef.current = { points: [point(event)], tool, brush }; setStroke(strokeRef.current.points);
        }} onPointerMove={event => {
          if (!strokeRef.current) return; strokeRef.current.points.push(point(event)); setStroke([...strokeRef.current.points]);
        }} onPointerUp={finishStroke} onPointerCancel={() => { strokeRef.current = null; setStroke([]); }}>
        {verified.url && <img key={binding} src={verified.url} alt={`${name(side)} inspection image`} draggable="false"
          onLoad={event => setLoaded(event.currentTarget.naturalWidth === 1350 && event.currentTarget.naturalHeight === 1858 ? binding : null)}
          onError={() => setLoaded(null)} />}
        <FindingOverlay findings={slot.findings} selected={pendingTrace ? pendingAction.findingId ?? pendingAction.trace.id : selected} trace={editor?.trace ?? pendingTrace} visible={showMasks} />
        {stroke.length > 0 && <svg className="ad-stroke" viewBox="0 0 1269 1777" aria-hidden="true"><polyline
          points={stroke.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={strokeRef.current?.tool === 'ERASER' ? '#ffffff' : '#df3f24'}
          strokeWidth={strokeRef.current?.brush ?? brush} strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </div> : <div className="am-empty">Inspection image unavailable.</div>}
    </div>
    {!ready && supplied && <p role={verified.error ? 'alert' : 'status'}>{verified.error ? 'Inspection image unavailable or its bytes did not match. Your trace is retained.' : 'Waiting for the current verified inspection image.'}</p>}
    <div className="am-local-tools">
      <label>Zoom <select disabled={stroke.length > 0 || busy} aria-label={`${name(side)} defect zoom`} value={zoom} onChange={event => { setZoom(Number(event.target.value)); setPan({ x: 0, y: 0 }); }}>
        <option value="1">Fit</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option>
      </select></label>
      <label><input type="checkbox" disabled={Boolean(editor)} checked={showMasks} onChange={event => setShowMasks(event.target.checked)} />Show findings</label>
      {zoom > 1 && <div className="am-pan" aria-label={`${name(side)} defect pan`}>
        {[[1, 0, 'Left', '←'], [0, 1, 'Up', '↑'], [0, -1, 'Down', '↓'], [-1, 0, 'Right', '→']].map(([x, y, label, symbol]) =>
          <button disabled={stroke.length > 0 || busy} key={label} aria-label={`Pan ${name(side)} ${label.toLowerCase()}`} onClick={() => setPan(p => ({ x: p.x + x * 20, y: p.y + y * 20 }))}>{symbol}</button>)}
      </div>}
    </div>
    {editor ? <div className="ad-trace-tools">
      {stale && <p role="alert">This side changed while you were drawing. Discard this trace to use its latest saved version.</p>}
      {editor.findingId === null && <label>Defect type <select value={newType} onChange={event => setNewType(event.target.value)} disabled={busy}>
        {Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>}
      <div className="am-local-tools"><button disabled={busy || stroke.length > 0} aria-pressed={tool === 'BRUSH'} onClick={() => setTool('BRUSH')}>Brush</button><button disabled={busy || stroke.length > 0} aria-pressed={tool === 'ERASER'} onClick={() => setTool('ERASER')}>Eraser</button>
        <label>Width <select disabled={busy || stroke.length > 0} aria-label={`${name(side)} brush width`} value={brush} onChange={event => setBrush(Number(event.target.value))}>
          {[1, 2, 4, 8, 16, 32].map(width => <option key={width} value={width}>{width} px</option>)}
        </select></label><button disabled={busy || stroke.length > 0 || !editor.undo.length} onClick={() => setEditor(previous => ({ ...previous, trace: previous.undo.at(-1), undo: previous.undo.slice(0, -1) }))}>Undo stroke</button></div>
      <div className="am-side-actions"><button className="am-primary" disabled={disabled || stale || stroke.length > 0 || !isNonEmptySpeedsterTrace(editor.trace)} onClick={saveTrace}>Save trace</button>
        <button disabled={busy} onClick={() => { strokeRef.current = null; setStroke([]); setEditor(null); setError(''); }}>Discard trace</button></div>
    </div> : <>
      <div className="am-side-actions"><button disabled={disabled || !onEdit} onClick={() => start(null)}>Add finding</button>
        {pending && onRetry && <button disabled={busy || locked} onClick={() => perform(() => onRetry(side))}>Retry measurement</button>}
        {pending && onDiscardPending && <button disabled={busy || locked} onClick={() => perform(() => onDiscardPending({ side, base }))}>Discard pending change</button>}
      </div>
      <ul className="ad-findings" aria-label={`${name(side)} findings`}>
        {slot.findings.map((entry, index) => <li key={entry.id} className={`${selected === entry.id ? 'ad-selected' : ''} ${entry.reviewResult === 'REMOVED' ? 'ad-removed' : ''}`}>
          <button className="ad-finding-name" aria-pressed={selected === entry.id} onClick={() => setSelected(entry.id)}>{index + 1}. {TYPES[entry.defectType]}</button>
          <span>{entry.reviewResult === 'REMOVED' ? 'Removed' : `${areaOf(entry).toFixed(3)} mm² · ${regionsOf(entry).map(r => r.zone.toLowerCase()).join(', ')}`}</span>
        </li>)}
      </ul>
      {!slot.findings.length && <p className="ad-muted">No findings yet. Inspect the image and add any damage you can see.</p>}
      {finding && <div className="ad-finding-tools">
        <label>Defect type <select aria-label={`${name(side)} finding type`} disabled={disabled || finding.reviewResult === 'REMOVED' || !onEdit} value={finding.defectType}
          onChange={event => edit({ type: 'CHANGE_TYPE', defectId: finding.id, defectType: event.target.value })}>
          {Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <div className="am-side-actions"><button disabled={disabled || finding.reviewResult === 'REMOVED' || !onEdit} onClick={() => start(finding)}>Edit trace</button>
          <button disabled={disabled || !onEdit} onClick={() => edit({ type: finding.reviewResult === 'REMOVED' ? 'UNDO' : 'REMOVE', defectIds: [finding.id] })}>{finding.reviewResult === 'REMOVED' ? 'Restore finding' : 'Remove finding'}</button></div>
      </div>}
      <div className="ad-inspect"><label><input type="checkbox" aria-label={`I inspected ${name(side)}`} checked={inspected} disabled={disabled || inspected || !onInspect}
        onChange={() => perform(() => onInspect({ side, base, actor: 'HUMAN', inspected: true }))} />I inspected {name(side)} and corrected its findings.</label></div>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

/** Controlled human review. Callbacks must authenticate, durably save/read back,
 * and then update workspace. Full masks remain in verified artifact storage;
 * browser state and a checked descriptor are not approval or storage authority. */
export function DefectReviewWorkspace({ workspace, images, onEdit, onInspect, onConfirm, onRetry, onDiscardPending, onContinue, onEditingChange, saveStatus = '', grade }) {
  const [activity, setActivity] = useState({}), [ready, setReady] = useState({}), [confirming, setConfirming] = useState(false), [error, setError] = useState('');
  const status = defectStatus(workspace);
  const onActivity = useCallback((side, value) => setActivity(previous => previous[side] === value ? previous : { ...previous, [side]: value }), []);
  const onReady = useCallback((side, value) => setReady(previous => previous[side] === value ? previous : { ...previous, [side]: value }), []);
  const editing = SIDES.some(side => activity[side]);
  useEffect(() => { onEditingChange?.(editing || confirming); return () => onEditingChange?.(false); }, [editing, confirming, onEditingChange]);
  const currentImagesReady = SIDES.every(side => images?.[side]?.inspection?.sha256 === workspace.sides[side].frame.inspectionImageSha256
    && ready[side] === inspectionImageBinding(workspace, side, images?.[side]));
  const confirm = async () => {
    if (!status.canConfirm || !currentImagesReady || editing || confirming || !onConfirm) return;
    setConfirming(true); setError('');
    try { await onConfirm({ base: { FRONT: defectBase(workspace, 'FRONT'), BACK: defectBase(workspace, 'BACK') }, actor: 'HUMAN', reviewed: true }); }
    catch { setError('Findings were not confirmed saved. Review the current state and try again.'); }
    finally { setConfirming(false); }
  };
  return <div className="atlas-manual ad-workspace">
    <header className="am-header"><span className="am-brand">ATLAS</span><h1>Defects & condition</h1><span>{saveStatus}</span></header>
    <div className="am-toolbar"><span>Inspect both sides. Correct, remove or trace findings before confirming.</span>{grade && <strong>Draft grade {grade}</strong>}</div>
    <div className="am-pair">{SIDES.map(side => <DefectSide key={`${workspace.cardId}:${side}`} workspace={workspace} side={side} image={images?.[side]}
      onEdit={onEdit} onInspect={onInspect} onRetry={onRetry} onDiscardPending={onDiscardPending} onReady={onReady} onActivity={onActivity} locked={confirming} />)}</div>
    <footer className="am-footer"><span>{editing ? 'Save or discard your trace before continuing.' : status.confirmed ? 'Findings confirmed. Final report approval is a separate step.' : 'Confirm the corrected list after inspecting both sides.'}</span>
      {status.confirmed && onContinue ? <button className="am-primary" onClick={onContinue} disabled={editing || confirming || !currentImagesReady}>Review draft report</button>
        : <button className="am-primary" onClick={confirm} disabled={!status.canConfirm || !currentImagesReady || editing || confirming || !onConfirm}>{confirming ? 'Confirming…' : 'Confirm findings'}</button>}
    </footer>{error && <p className="am-error" role="alert">{error}</p>}
  </div>;
}
