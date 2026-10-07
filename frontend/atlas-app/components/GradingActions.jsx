import { staffApiPath } from '../lib/routes.mjs';
import { useEffect, useRef, useState } from 'react';
import { api, approvalMessage } from '../lib/client';
import { Notice } from './Shell';
import { encodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { decodeSpeedsterTraceBitmapWireV1, encodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { applyCompletedSpeedsterTraceStroke, buildSpeedsterTraceProvenanceRevision, clipSpeedsterTraceToMaterial,
    createEmptySpeedsterTrace, isNonEmptySpeedsterTrace, rasterizeSpeedsterCanonicalContour } from '@atlas/grading-core/trace-editor';

const TYPES = ['FAINT_COLOR_VARIATION', 'VISIBLE_WHITENING', 'FRAYING', 'CHIPPING_EXPOSED_STOCK', 'LIFTING_DEFORMATION',
    'LIGHT_SCRATCH_SCUFF', 'VISIBLE_SCRATCH_PRINT_COATING_LOSS', 'DENT_MATERIAL_DAMAGE', 'PEELING_HEAVY_DAMAGE'];
const label = value => value.toLowerCase().replaceAll('_', ' ');
export default function GradingActions({ card, csrf, disabled, dirty, onAction, onRefresh }) {
    const [selectedId, select] = useState(''), [traceTarget, setTraceTarget] = useState(null);
    const findings = card.grading.reviewFindings ?? [], selected = findings.find(f => f.id === selectedId) ?? findings[0];
    const latest = card.grading.operations?.[0];
    const blocked = disabled || dirty || Boolean(card.grading.pendingOperations) || !card.grading.correctionsEnabled;
    return <details className="grading-actions" open={!card.grading.analysisRevision}><summary>Correct grading findings{Boolean(card.grading.pendingOperations) && ' · action needs attention'}</summary>
      <p>Every correction is measured again and saved as a new report revision.</p>
      {!card.grading.correctionsEnabled && <p className="muted">Grading corrections are not available for this card yet.</p>}
      {dirty && <Notice>Save your notes before changing a grading finding.</Notice>}
      {latest && <div className="operation-status" role="status"><strong>Latest grading action: {label(latest.state)}</strong>
        {latest.failureCode && <p>{approvalMessage(latest.failureCode)}</p>}
        {['DISPATCHED', 'UNKNOWN', 'RESERVED'].includes(latest.state) && <button type="button" disabled={disabled} onClick={() => onRefresh(latest.id)}>Check recorded result</button>}</div>}
      {!card.grading.analysisRevision ? <button className="primary" disabled={blocked} onClick={() => onAction({ type: 'INITIALIZE' })}>Run ATLAS grading</button> : <>
        {findings.length ? <><label htmlFor="grading-finding">Finding to review</label><select id="grading-finding" value={selected?.id ?? ''} disabled={disabled} onChange={e => select(e.target.value)}>
          {findings.map((f, i) => <option key={f.id} value={f.id}>{i + 1}. {label(f.side)} · {label(f.defectType)} · {label(f.reviewResult)}</option>)}</select>
          <FindingActions key={`${card.grading.analysisRevision}:${selected.id}`} finding={selected} disabled={blocked} onAction={onAction} onTrace={() => setTraceTarget({ finding: selected, side: selected.side })}/>
        </> : <p>No findings are included in this analysis.</p>}
        <div className="correction-buttons"><button type="button" disabled={blocked} onClick={() => setTraceTarget({ finding: null, side: 'FRONT' })}>Add front finding</button>
          <button type="button" disabled={blocked} onClick={() => setTraceTarget({ finding: null, side: 'BACK' })}>Add back finding</button></div>
      </>}
      {traceTarget && <TraceEditor key={`${card.grading.analysisRevision}:${traceTarget.finding?.id ?? traceTarget.side}`} card={card} csrf={csrf}
        {...traceTarget} disabled={disabled} onClose={() => setTraceTarget(null)} onSave={async action => { const accepted = await onAction(action); if (accepted) setTraceTarget(null); return accepted; }}/>} 
    </details>;
}
function FindingActions({ finding, disabled, onAction, onTrace }) {
    const [type, setType] = useState(finding.defectType), removed = finding.reviewResult === 'REMOVED';
    return <div className="finding-corrections"><div className="correction-buttons"><button type="button" disabled={disabled} onClick={() => onAction({ type: removed ? 'UNDO' : 'REMOVE', defectIds: [finding.id] })}>{removed ? 'Restore finding' : 'Remove finding'}</button>
      <button type="button" disabled={disabled || removed} onClick={onTrace}>Inspect / edit trace</button></div>
      <label htmlFor="correction-type">Defect type</label><div className="type-correction"><select id="correction-type" value={type} disabled={disabled || removed} onChange={e => setType(e.target.value)}>{TYPES.map(t => <option key={t} value={t}>{label(t)}</option>)}</select>
      <button type="button" disabled={disabled || removed || type === finding.defectType} onClick={() => onAction({ type: 'CHANGE_TYPE', defectId: finding.id, defectType: type })}>Save type correction</button></div></div>;
}
function outline(finding) {
    const result = createEmptySpeedsterTrace();
    for (const contour of (finding?.measurementRegions?.map(r => r.canonicalContour) ?? (finding?.canonicalContour ? [finding.canonicalContour] : []))) {
        const region = rasterizeSpeedsterCanonicalContour(contour); for (let i = 0; i < result.length; i++) if (region[i]) result[i] = 1;
    }
    return result;
}
function TraceEditor({ card, csrf, finding, side, disabled, onClose, onSave }) {
    const dialog = useRef(null), canvas = useRef(null), trace = useRef(outline(finding)), stroke = useRef(null), undo = useRef([]), provenance = useRef(null);
    const [loading, setLoading] = useState(Boolean(finding)), [imageLoaded, setImageLoaded] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
    const [tool, setTool] = useState('BRUSH'), [width, setWidth] = useState(5), [type, setType] = useState(finding?.defectType ?? 'LIGHT_SCRATCH_SCUFF');
    const [edits, setEdits] = useState(0);
    const safeCorner = ['SQUARE', 'ROUNDED_3_18_MM'].includes(card.grading.cornerShape);
    function paint() {
        if (!canvas.current) return;
        const context = canvas.current.getContext('2d'), data = context.createImageData(1270, 1778);
        for (let i = 0; i < trace.current.length; i++) if (trace.current[i]) { data.data[i * 4] = 255; data.data[i * 4 + 1] = 175; data.data[i * 4 + 2] = 40; data.data[i * 4 + 3] = 160; }
        context.putImageData(data, 0, 0);
    }
    useEffect(() => {
        dialog.current.showModal(); paint(); let active = true;
        if (finding) api(`cards/${card.id}/trace`, { csrf, body: { findingId: finding.id, analysisRevision: card.grading.analysisRevision, analysisHash: card.grading.analysisHash } })
            .then(result => { if (active) { trace.current = decodeSpeedsterTraceBitmapWireV1(result.traceWire); provenance.current = result.traceProvenance; setMessage('Loaded the saved pixel trace.'); paint(); } })
            .catch(e => { if (active) { if (e.code === 'TRACE_NOT_FOUND') setMessage('Starting from the saved finding outline.'); else setError(e.message); } })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);
    const blocked = disabled || loading || !imageLoaded || !safeCorner || Boolean(error) || Boolean(card.grading.pendingOperations);
    const point = event => { const rect = canvas.current.getBoundingClientRect(); return { x: Math.max(0, Math.min(1269, Math.round((event.clientX - rect.left) * 1270 / rect.width))),
        y: Math.max(0, Math.min(1777, Math.round((event.clientY - rect.top) * 1778 / rect.height))) }; };
    function begin(event) {
        if (blocked || stroke.current) return; event.preventDefault(); canvas.current.setPointerCapture(event.pointerId);
        stroke.current = { id: event.pointerId, points: [point(event)] };
    }
    function move(event) {
        if (stroke.current?.id !== event.pointerId) return;
        const next = point(event), previous = stroke.current.points.at(-1);
        if (stroke.current.points.length >= 5000) return;
        stroke.current.points.push(next);
        const context = canvas.current.getContext('2d'); context.save(); context.strokeStyle = 'rgba(255,175,40,.65)';
        context.globalCompositeOperation = tool === 'ERASER' ? 'destination-out' : 'source-over'; context.lineWidth = width;
        context.lineCap = 'round'; context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(next.x, next.y); context.stroke(); context.restore();
    }
    function finish(event) {
        if (stroke.current?.id !== event.pointerId) return;
        undo.current.push(trace.current); if (undo.current.length > 10) undo.current.shift();
        trace.current = clipSpeedsterTraceToMaterial(applyCompletedSpeedsterTraceStroke({ trace: trace.current, tool,
            points: stroke.current.points, strokeWidthPixels: width }).trace, card.grading.cornerShape);
        stroke.current = null; setEdits(n => n + 1); paint();
    }
    async function save() {
        if (blocked || !edits || !isNonEmptySpeedsterTrace(trace.current)) return;
        const rle = encodeSpeedsterTraceRleV1(trace.current), sourceViewId = finding?.sourceViewId ?? `${side}:ORIGINAL`;
        const traceProvenance = buildSpeedsterTraceProvenanceRevision({ sourceViewId,
            cropTransform: { version: 'speedster-canonical-crop-affine-v1', crop: { x: 0, y: 0, width: 1270, height: 1778 } },
            highlighterStrokes: provenance.current?.highlighterStrokes ?? [], priorTraceProvenance: provenance.current ?? undefined,
            finalTraceSha256: rle.sha256 });
        const accepted = await onSave({ type: 'TRACE_SAVE', side, findingId: finding?.id ?? null,
            trace: { traceWire: encodeSpeedsterTraceBitmapWireV1(trace.current, rle.sha256), traceProvenance,
                ...(!finding ? { id: `${side}:ATLAS:${crypto.randomUUID()}`, defectType: type, sourceViewId } : {}) } });
        if (!accepted) setMessage('The correction has not been confirmed. Close this editor and check the recorded grading action.');
    }
    return <dialog ref={dialog} className="trace-dialog" onClose={onClose}>
      <div className="trace-heading"><div><h2>{finding ? 'Edit finding trace' : 'Add a finding'} · {label(side)}</h2><p>Brush marks the affected material. Save measures it again before calculating the grade.</p></div><button onClick={() => dialog.current.close()}>Close ×</button></div>
      <div className="trace-toolbar"><label>Tool <select value={tool} onChange={e => setTool(e.target.value)} disabled={blocked}><option value="BRUSH">Brush</option><option value="ERASER">Eraser</option></select></label>
        <label>Brush width <input aria-label="Brush width in canonical pixels" type="range" min="1" max="40" value={width} onChange={e => setWidth(Number(e.target.value))} disabled={blocked}/><span>{(width / 20).toFixed(2)} mm</span></label>
        <button disabled={blocked || !undo.current.length} onClick={() => { trace.current = undo.current.pop(); setEdits(n => n + 1); paint(); }}>Undo stroke</button>
        {!finding && <label>Defect type <select value={type} onChange={e => setType(e.target.value)} disabled={blocked}>{TYPES.map(t => <option key={t} value={t}>{label(t)}</option>)}</select></label>}</div>
      {message && <p role="status">{message}</p>}{error && <Notice error>{error}</Notice>}{!safeCorner && <Notice error>The saved corner geometry is required before editing.</Notice>}
      <div className="trace-stage"><img src={staffApiPath(`evidence/${card.id}/${side}`)} alt={`Preserved ${label(side)} card image`} onLoad={() => setImageLoaded(true)} onError={() => setError('The source image could not be loaded. Close and reload the card.')}/>
        <canvas ref={canvas} width="1270" height="1778" aria-label="Canonical finding trace; draw using a pointer" onPointerDown={begin} onPointerMove={move} onPointerUp={finish}
          onPointerCancel={() => { stroke.current = null; paint(); }}/></div>
      <div className="trace-footer"><span>Original traces and earlier revisions are retained.</span><button className="primary" disabled={blocked || !edits || !isNonEmptySpeedsterTrace(trace.current)} onClick={save}>{disabled ? 'Measuring…' : 'Save and remeasure trace'}</button></div>
    </dialog>;
}
