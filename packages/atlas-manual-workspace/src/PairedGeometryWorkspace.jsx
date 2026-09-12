import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sanitizeSpeedsterUnitQuad } from '@atlas/grading-core/geometry';
import { geometryBase, geometryStatus, printedQuadOnOriginal } from './geometry-actions.mjs';
import { gradientMapFromImage, snapSpeedsterPoint } from './gradient-snap';

const SIDES = ['FRONT', 'BACK'];
const CORNERS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
const DIRECTIONS = [{ inwardX: 1, inwardY: 1 }, { inwardX: -1, inwardY: 1 }, { inwardX: -1, inwardY: -1 }, { inwardX: 1, inwardY: -1 }];
const clamp = value => Math.max(0, Math.min(1, value));
const key = value => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : entry);
const STATUS = { IMAGE: 'Waiting for photo', PHYSICAL: 'Place physical edge', PREPARATION: 'Needs preparation', PRINTED: 'Place printed border', REVIEW: 'Ready to review', CONFIRMED: 'Geometry confirmed' };
const message = error => /STALE/.test(error?.code ?? error?.message ?? '')
  ? 'This side changed. Your adjustment is retained; discard it to review the latest outline.'
  : 'The change was not confirmed saved. Your adjustment is retained.';

/** Caller-supplied URLs must resolve to these exact immutable frame hashes.
 * This check compares descriptors; it is not browser-side byte verification. */
export function geometryImage(state, side, kind, images) {
  const source = state.sides[side];
  const prepared = kind === 'PRINTED';
  const frame = prepared ? source.prepared?.frame.rectified : source.image;
  const image = images?.[side]?.[prepared ? 'rectified' : 'original'];
  const expected = prepared ? frame?.sha256 : frame?.frameSha256;
  return image && frame && image.sha256 === expected && typeof image.url === 'string' && image.url.length
    ? { ...image, width: frame.width, height: frame.height } : null;
}

function imageBinding(state, side, kind, images) {
  const image = geometryImage(state, side, kind, images);
  return image ? key({ card: state.cardId, side, kind, image, revision: kind === 'PHYSICAL' ? state.sides[side].imageRevision : state.sides[side].preparationRevision }) : null;
}

function SideEditor({ state, side, kind, images, onEdit, onPrepare, onActivity, onReady, preparing, locked }) {
  const slot = state.sides[side], status = geometryStatus(state).sides[side];
  const image = geometryImage(state, side, kind, images);
  const current = (kind === 'PHYSICAL' ? slot.physical : slot.printed)?.quad ?? null;
  const base = geometryBase(state, side, kind);
  const [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [corner, setCorner] = useState(0), [snap, setSnap] = useState(true), [readyKey, setReadyKey] = useState(null);
  const [snapReady, setSnapReady] = useState(false), [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const area = useRef(null), drag = useRef(null), gradient = useRef(null);
  const imageKey = imageBinding(state, side, kind, images);
  const ready = imageKey !== null && readyKey === imageKey;
  const stale = Boolean(draft && key(draft.base) !== key(base));
  const quad = draft?.quad ?? current;
  const dirty = Boolean(draft);
  useEffect(() => { onActivity(side, dirty || busy); return () => onActivity(side, false); }, [side, dirty, busy, onActivity]);
  useLayoutEffect(() => { gradient.current = null; setSnapReady(false); setReadyKey(null); setPan({ x: 0, y: 0 }); setZoom(1); drag.current = null; }, [imageKey]);
  const setPoint = (index, point, useSnap = false) => {
    if (!ready || busy || locked || stale || !quad) return;
    let nextPoint = { x: clamp(point.x), y: clamp(point.y) };
    if (useSnap && snap && snapReady) nextPoint = snapSpeedsterPoint(gradient.current, nextPoint, {
      ...DIRECTIONS[index], sampleStart: kind === 'PRINTED' ? 4 : slot.cornerShape === 'ROUNDED_3_18_MM' ? 30 : 8,
      sampleLength: kind === 'PRINTED' ? 90 : 125,
    });
    const next = quad.map((p, i) => i === index ? nextPoint : { ...p });
    if (!sanitizeSpeedsterUnitQuad(next)) { setError('That move would cross or collapse the outline. The last valid shape is retained.'); return; }
    onActivity(side, true); setDraft({ quad: next, base: draft?.base ?? base }); setError('');
  };
  const start = () => {
    if (!ready || busy || locked || stale) return;
    onActivity(side, true); setDraft({ quad: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }], base });
    setError('');
  };
  const save = async () => {
    if (!draft || stale || busy || locked || !onEdit || !ready) return;
    setBusy(true); setError('');
    try { await onEdit({ side, kind, base: draft.base, quad: draft.quad, actor: 'HUMAN', proposal: null }); setDraft(null); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  };
  const prepare = async () => {
    if (!onPrepare || busy || dirty || locked || preparing) return;
    setBusy('PREPARING'); setError('');
    try { await onPrepare(side); } catch { setError('Preparation did not finish. The saved physical edge is retained.'); }
    finally { setBusy(false); }
  };
  let physical = kind === 'PHYSICAL' ? quad : slot.prepared ? [{ x: 0, y: 0 }, { x: 1269 / 1270, y: 0 }, { x: 1269 / 1270, y: 1777 / 1778 }, { x: 0, y: 1777 / 1778 }] : null;
  let printed = kind === 'PRINTED' ? quad : slot.prepared && slot.printed && !draft ? printedQuadOnOriginal(state, side) : null;
  const pointerMove = event => {
    if (!drag.current || drag.current.pointerId !== event.pointerId || !area.current) return;
    const rect = area.current.getBoundingClientRect();
    setPoint(drag.current.corner, { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }, true);
  };
  const inactive = busy || locked || stale || !ready;
  return <section className="am-side" aria-label={`${side === 'FRONT' ? 'Front' : 'Back'} geometry`}>
    <div className="am-side-heading"><h2>{side === 'FRONT' ? 'Front' : 'Back'}</h2><span>{busy ? busy === 'PREPARING' ? 'Preparing…' : 'Saving…' : dirty ? 'Unsaved adjustment' : preparing ? 'Preparing…' : STATUS[status.stage]}</span></div>
    <div className="am-view-label">{kind === 'PHYSICAL' ? 'Original view' : 'Straightened view'}</div>
    <div className="am-viewport" onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {image ? <div className="am-image-plane" ref={area} style={{ transform: `translate(${pan.x}%,${pan.y}%) scale(${zoom})`, aspectRatio: `${image.width}/${image.height}` }}>
        <img key={imageKey} src={image.url} alt={`${side === 'FRONT' ? 'Front' : 'Back'} card, ${kind === 'PHYSICAL' ? 'oriented original' : 'straightened'}`} draggable={false}
          onLoad={event => {
            const img = event.currentTarget;
            if (img.naturalWidth !== image.width || img.naturalHeight !== image.height) { setReadyKey(null); gradient.current = null; setSnapReady(false); onReady(side, null); setError('The displayed image does not match this outline. Reload the verified photo.'); return; }
            const map = gradientMapFromImage(img);
            gradient.current = map && map.width > 1 && map.height > 1 ? map : null;
            setSnapReady(Boolean(gradient.current)); setReadyKey(imageKey); onReady(side, imageKey);
            setError(previous => /^(The displayed image|Photo unavailable)/.test(previous) ? '' : previous);
          }} onError={() => { setReadyKey(null); gradient.current = null; setSnapReady(false); onReady(side, null); setError('Photo unavailable. Your saved work is retained.'); }} />
        {ready && <svg className="am-outlines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {physical && <polygon className={`am-physical ${kind === 'PHYSICAL' ? 'am-active' : ''}`} points={physical.map(p => `${p.x * 100},${p.y * 100}`).join(' ')} />}
          {printed && <polygon className={`am-printed ${kind === 'PRINTED' ? 'am-active' : ''}`} points={printed.map(p => `${p.x * 100},${p.y * 100}`).join(' ')} />}
        </svg>}
        {ready && quad?.map((point, index) => <button key={index} type="button" className={`am-handle ${corner === index ? 'am-selected' : ''}`}
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} disabled={inactive}
          aria-label={`${side} ${kind === 'PHYSICAL' ? 'physical edge' : 'printed border'} ${CORNERS[index]}`}
          onFocus={() => setCorner(index)} onPointerDown={event => { if (inactive || event.button !== 0) return; setCorner(index); drag.current = { pointerId: event.pointerId, corner: index }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
          onKeyDown={event => { const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }; const move = moves[event.key]; if (!move) return; event.preventDefault(); const step = event.shiftKey ? 10 : 1; setPoint(index, { x: point.x + move[0] * step / image.width, y: point.y + move[1] * step / image.height }); }} />)}
      </div> : <div className="am-empty">{kind === 'PRINTED' && slot.physical ? 'This side needs a current straightened image.' : 'Waiting for a verified photo.'}</div>}
    </div>
    <div className="am-local-tools">
      <label>Zoom <select aria-label={`${side} zoom`} value={zoom} onChange={event => { setZoom(Number(event.target.value)); setPan({ x: 0, y: 0 }); }}><option value="1">Fit</option><option value="2">2×</option><option value="4">4×</option></select></label>
      {zoom > 1 && <div className="am-pan" aria-label={`${side} pan`}><button type="button" aria-label={`${side} pan left`} onClick={() => setPan(p => ({ ...p, x: Math.min((zoom - 1) * 50, p.x + 20) }))}>←</button><button type="button" aria-label={`${side} pan up`} onClick={() => setPan(p => ({ ...p, y: Math.min((zoom - 1) * 50, p.y + 20) }))}>↑</button><button type="button" aria-label={`${side} pan down`} onClick={() => setPan(p => ({ ...p, y: Math.max(-(zoom - 1) * 50, p.y - 20) }))}>↓</button><button type="button" aria-label={`${side} pan right`} onClick={() => setPan(p => ({ ...p, x: Math.max(-(zoom - 1) * 50, p.x - 20) }))}>→</button></div>}
      <label><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} disabled={!snapReady} /> Snap{!snapReady ? ' unavailable' : ''}</label>
    </div>
    {quad && <div className="am-coordinate-tools"><label>Corner <select aria-label={`${side} corner`} value={corner} onChange={event => setCorner(Number(event.target.value))}>{CORNERS.map((label, i) => <option value={i} key={i}>{label}</option>)}</select></label><span className="am-coordinate">{Math.round(quad[corner].x * (image?.width ?? 0))}, {Math.round(quad[corner].y * (image?.height ?? 0))} px</span><button type="button" disabled={inactive} aria-label={`${side} nudge left`} onClick={() => setPoint(corner, { ...quad[corner], x: quad[corner].x - 1 / image.width })}>←</button><button type="button" disabled={inactive} aria-label={`${side} nudge up`} onClick={() => setPoint(corner, { ...quad[corner], y: quad[corner].y - 1 / image.height })}>↑</button><button type="button" disabled={inactive} aria-label={`${side} nudge down`} onClick={() => setPoint(corner, { ...quad[corner], y: quad[corner].y + 1 / image.height })}>↓</button><button type="button" disabled={inactive} aria-label={`${side} nudge right`} onClick={() => setPoint(corner, { ...quad[corner], x: quad[corner].x + 1 / image.width })}>→</button></div>}
    {stale && <p role="alert">This side changed while you were editing. Your unsaved adjustment has been retained.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="am-side-actions">
      {!quad && <button type="button" onClick={start} disabled={!ready || busy || locked}>Start manual outline</button>}
      {dirty && <><button type="button" className="am-primary" onClick={save} disabled={inactive || !onEdit}>Save outline</button><button type="button" disabled={busy || locked} onClick={() => { setDraft(null); setError(''); }}>Discard adjustment</button></>}
      {!dirty && slot.physical && !slot.prepared && onPrepare && <button type="button" onClick={prepare} disabled={busy || locked || preparing}>Prepare this side</button>}
    </div>
    <div className="am-centering">{!draft && status.centering ? <><span>Left / right <strong>{status.centering.leftRightBalance.map(n => n.toFixed(1)).join(' / ')}</strong></span><span>Top / bottom <strong>{status.centering.topBottomBalance.map(n => n.toFixed(1)).join(' / ')}</strong></span></> : <span>Centering pending current saved borders</span>}</div>
  </section>;
}

/** Controlled manual component. Async callbacks must resolve only after the
 * authoritative save/readback and update `workspace`; rejected saves retain the
 * local draft. The host owns source verification, current version CAS, session
 * auth, persistence, automatic preparation and stage progression. */
export function PairedGeometryWorkspace({ workspace, images, onEdit, onConfirm, onPrepare, onEditingChange, preparingSides = {}, title = 'Edges & centering', saveStatus = '' }) {
  const status = geometryStatus(workspace);
  const [kind, setKind] = useState('PHYSICAL'), [activity, setActivity] = useState({ FRONT: false, BACK: false });
  const [loaded, setLoaded] = useState({ FRONT: null, BACK: null });
  const onReady = useCallback((side, binding) => setLoaded(previous => previous[side] === binding ? previous : { ...previous, [side]: binding }), []);
  const bothVisible = SIDES.every(side => { const binding = imageBinding(workspace, side, kind, images); return binding !== null && loaded[side] === binding; });
  const [confirming, setConfirming] = useState(false), [error, setError] = useState('');
  const onActivity = useCallback((side, active) => setActivity(previous => previous[side] === active ? previous : { ...previous, [side]: active }), []);
  const editing = activity.FRONT || activity.BACK;
  useEffect(() => { onEditingChange?.(editing || confirming); return () => onEditingChange?.(false); }, [editing, confirming, onEditingChange]);
  const confirm = async () => {
    if (editing || confirming || !bothVisible || !status.canConfirmBoth || !onConfirm) return;
    setConfirming(true); setError('');
    try { await onConfirm({ actor: 'HUMAN', reviewed: true, base: { FRONT: geometryBase(workspace, 'FRONT', 'REVIEW'), BACK: geometryBase(workspace, 'BACK', 'REVIEW') } }); }
    catch { setError('Geometry was not confirmed. Review the current saved outlines and try again.'); }
    finally { setConfirming(false); }
  };
  return <div className="atlas-manual">
    <header className="am-header"><span className="am-brand">ATLAS</span><h1>{title}</h1><span>{saveStatus}</span></header>
    <div className="am-toolbar"><div className="am-tool-choice" aria-label="Geometry tool"><button type="button" disabled={editing || confirming} aria-pressed={kind === 'PHYSICAL'} onClick={() => setKind('PHYSICAL')}>Physical edge</button><button type="button" disabled={editing || confirming} aria-pressed={kind === 'PRINTED'} onClick={() => setKind('PRINTED')}>Printed border</button></div><div className="am-legend"><span><i className="am-edge-key" />Physical edge</span><span><i className="am-border-key" />Printed border</span></div></div>
    <div className="am-pair">{SIDES.map(side => <SideEditor key={side} state={workspace} side={side} kind={kind} images={images} onEdit={onEdit} onPrepare={onPrepare} onActivity={onActivity} onReady={onReady} preparing={Boolean(preparingSides[side])} locked={confirming} />)}</div>
    <footer className="am-footer"><span aria-live="polite">{editing ? 'Save or discard your adjustments before continuing.' : status.confirmed ? 'Both sides confirmed. Ready for defect inspection.' : 'Review the physical edge and printed border on both sides.'}</span><button type="button" className="am-primary" onClick={confirm} disabled={!bothVisible || !status.canConfirmBoth || status.confirmed || editing || confirming || !onConfirm}>{confirming ? 'Confirming…' : 'Confirm both sides'}</button></footer>
    {error && <p className="am-error" role="alert">{error}</p>}
  </div>;
}
