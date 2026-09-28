import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sanitizeSpeedsterUnitQuad } from '@atlas/grading-core/geometry';
import { canDetectMissingPhysical, geometryBase, geometryStatus, printedQuadOnOriginal } from './geometry-actions.mjs';
import { gradientMapFromImage, snapSpeedsterPoint } from './gradient-snap';
import { useVerifiedImage, verifiedImageContentKey } from './verified-image.mjs';

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

const positiveDimension = value => Number.isSafeInteger(value) && value > 0;
const transportDescriptor = value => verifiedImageContentKey(value) && Number.isSafeInteger(value.byteCount)
  && typeof value.url === 'string' && value.url.length > 0;

/** This optional transport encodes the exact full-frame pixels losslessly.
 * The server qualifies that equality; the client verifies each encoded hash. */
export function reviewImageDisplay(canonical, frame = null) {
  const display = canonical?.display;
  return display && transportDescriptor(display) && display.mime === 'image/webp'
    && display.policyVersion === 'atlas-review-display-lossless-v1'
    && display.sourceSha256 === canonical.sha256 && /^[a-f0-9]{64}$/.test(canonical.sha256)
    && positiveDimension(display.width) && positiveDimension(display.height)
    && (!frame || display.width === frame.width && display.height === frame.height)
    ? display : null;
}

/** Small context only. It never supplies full-detail readiness or editor pixels. */
export function reviewImagePreview(canonical, frame = null) {
  const display = reviewImageDisplay(canonical, frame), preview = display?.preview ?? canonical?.preview;
  const sourceWidth = display?.width ?? frame?.width, sourceHeight = display?.height ?? frame?.height;
  if (!preview || !transportDescriptor(preview) || preview.mime !== 'image/jpeg'
    || (!display && preview.sourceSha256 !== canonical?.sha256)
    || !positiveDimension(sourceWidth) || !positiveDimension(sourceHeight)
    || !positiveDimension(preview.width) || !positiveDimension(preview.height)
    || Math.max(preview.width, preview.height) > 768
    || preview.width > sourceWidth || preview.height > sourceHeight) return null;
  const scale = Math.min(preview.width / sourceWidth, preview.height / sourceHeight);
  return Math.abs(preview.width - sourceWidth * scale) <= 1
    && Math.abs(preview.height - sourceHeight * scale) <= 1 ? preview : null;
}

/** Frame lineage is checked here; the shared loader verifies actual bytes. */
export function geometryImage(state, side, kind, images) {
  const source = state.sides[side];
  const prepared = kind === 'PRINTED';
  const frame = prepared ? source.prepared?.frame.rectified : source.image;
  const image = images?.[side]?.[prepared ? 'rectified' : 'original'];
  const expected = prepared ? frame?.sha256 : frame?.frameSha256;
  if (!image || !frame || image.sha256 !== expected) return null;
  if (prepared && (typeof image.url !== 'string' || !image.url.length)) return null;
  const display = prepared ? null : reviewImageDisplay(image, frame);
  return { ...(display ?? image), sourceSha256: expected, width: frame.width, height: frame.height,
    preview: prepared ? null : reviewImagePreview(image, frame),
    ...(prepared ? {} : {displayState:image.displayState,previewState:image.previewState}) };
}

export function geometryImageBinding(state, side, kind, images) {
  const image = geometryImage(state, side, kind, images);
  return image ? key({ card: state.cardId, side, kind, image: { sha256: image.sourceSha256, width: image.width, height: image.height },
    revision: kind === 'PHYSICAL' ? state.sides[side].imageRevision : state.sides[side].preparationRevision }) : null;
}

function SideEditor({ state, side, kind, images, onEdit, onPrepare, onBackground, onAbsentBorder, onRefreshImages, onRetryDisplay, onActivity, onReady, preparing, locked, compact, renderEditActions, attention, learningAdvice }) {
  const slot = state.sides[side], status = geometryStatus(state).sides[side];
  const image = geometryImage(state, side, kind, images);
  const verified = useVerifiedImage(typeof image?.url === 'string' && image.url.length ? image : null, { cacheScope: JSON.stringify([state.cardId, side]) });
  const preview = useVerifiedImage(verified.url ? null : image?.preview);
  const [previewLoaded, setPreviewLoaded] = useState(null);
  const previewKey = verifiedImageContentKey(image?.preview);
  const showingPreview = !verified.url && preview.url && previewLoaded === previewKey;
  const current = (kind === 'PHYSICAL' ? slot.physical : slot.printed)?.quad ?? null;
  const canDetect = canDetectMissingPhysical(state, side);
  const base = geometryBase(state, side, kind);
  const [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [corner, setCorner] = useState(0), [snap, setSnap] = useState(true), [readyKey, setReadyKey] = useState(null);
  const [snapReady, setSnapReady] = useState(false), [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewport = useRef(null), [viewportSize,setViewportSize] = useState({width:360,height:500});
  useLayoutEffect(() => { if (!compact || !viewport.current) return; const observer=new ResizeObserver(([entry])=>setViewportSize({width:entry.contentRect.width,height:entry.contentRect.height})); observer.observe(viewport.current); return ()=>observer.disconnect(); },[compact]);
  const fitWidth=image ? Math.min(viewportSize.width,viewportSize.height*image.width/image.height) : 0;
  const area = useRef(null), drag = useRef(null), gradient = useRef(null);
  const imageKey = geometryImageBinding(state, side, kind, images);
  const loadedImageKey = imageKey === null ? null : `${imageKey}:${verifiedImageContentKey(image)}`;
  const ready = Boolean(verified.url && imageKey !== null && readyKey === loadedImageKey);
  const stale = Boolean(draft && key(draft.base) !== key(base));
  const quad = draft?.quad ?? current;
  const dirty = Boolean(draft);
  useEffect(() => { onActivity(side, dirty || busy); return () => onActivity(side, false); }, [side, dirty, busy, onActivity]);
  useEffect(() => { onReady(side, ready ? imageKey : null); }, [side, ready, imageKey, onReady]);
  useLayoutEffect(() => { gradient.current = null; setSnapReady(false); setReadyKey(null); setPan({ x: 0, y: 0 }); setZoom(1); drag.current = null; }, [loadedImageKey]);
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
    setBusy(canDetect ? 'DETECTING' : 'PREPARING'); setError('');
    try { await onPrepare(side); } catch { setError(canDetect
      ? 'Automatic edges could not be prepared. Your saved photo and the other side are retained. You can retry or place the physical edge manually.'
      : 'Preparation did not finish. The saved physical edge is retained.'); }
    finally { setBusy(false); }
  };
  const retryImagePreparation = async (preparationState, previewOnly = false) => {
    if (!onRetryDisplay || busy || locked || preparationState?.state !== 'FAILED' || !preparationState.retry) return;
    setBusy('PREPARING'); setError('');
    try { await onRetryDisplay({side, ...preparationState.retry}); }
    catch { setError(`${previewOnly ? 'Preview' : 'Full photo'} preparation was not restarted. Your original and saved work remain available; reload the image status before trying again.`); }
    finally { setBusy(false); }
  };
  const retryDisplay = () => retryImagePreparation(image?.displayState);
  const retryPreview = () => retryImagePreparation(image?.previewState, true);
  const changeBackground = async matColor => {
    if (!onBackground || !canDetect || busy || dirty || locked || preparing || matColor === slot.matColor) return;
    setBusy('DETECTING'); setError('');
    try { await onBackground({ side, base: geometryBase(state, side, 'SETTINGS'), matColor }); }
    catch { setError('Background detection could not finish. Your saved photo is retained. Retry detection or place the outline manually.'); }
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
  return <section className="am-side" aria-label={`${side === 'FRONT' ? 'Front' : 'Back'} geometry`} data-review-target={`geometry-${side}`} data-review-attention={Boolean(attention && (attention.reviewBoth || attention.kind === kind))} tabIndex={-1}>
    {attention && (attention.reviewBoth || attention.kind === kind) && <p className="mc-review-reason">{attention.message}</p>}
    <div className="am-side-heading"><h2>{side === 'FRONT' ? 'Front' : 'Back'}</h2><span>{busy ? busy === 'DETECTING' ? 'Detecting edges…' : busy === 'PREPARING' ? 'Preparing…' : 'Saving…' : dirty ? 'Unsaved adjustment' : preparing ? canDetect ? 'Detecting edges…' : 'Preparing…' : STATUS[status.stage]}</span></div>
    {!dirty && learningAdvice?.requiresHumanConfirmation === true && learningAdvice.frameSha256 === slot.image?.frameSha256
      && key(learningAdvice.nativeGeometry) === key({ physical: slot.physical?.quad ?? null, printed: slot.printed?.quad ?? null })
      && ['CANDIDATE','ABSTAIN'].includes(learningAdvice.status) && <p role="status">{learningAdvice.status === 'CANDIDATE'
        ? 'Reviewed geometry references support this proposed outline. Confirm it against this photo.'
        : 'Reviewed references do not resolve this outline. Check the physical edge and printed border manually.'}</p>}
    <div className="am-view-label">{kind === 'PHYSICAL' ? 'Original view' : 'Straightened view'}</div>
    <div ref={viewport} className="am-viewport" onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {image ? <div className="am-image-plane" ref={area} style={{ transform: `translate(${pan.x}%,${pan.y}%) scale(${zoom})`, aspectRatio: `${image.width}/${image.height}`, ...(compact ? {width:fitWidth,height:fitWidth*image.height/image.width} : {}) }}>
        {!verified.url && preview.url && <img className="am-context-preview" src={preview.url}
          alt={`${side === 'FRONT' ? 'Front' : 'Back'} card preview; full detail is loading`} draggable={false}
          onLoad={event => { const img = event.currentTarget; setPreviewLoaded(img.naturalWidth === image.preview.width && img.naturalHeight === image.preview.height ? previewKey : null); }}
          onError={() => setPreviewLoaded(null)} style={{ pointerEvents: 'none', visibility: showingPreview ? 'visible' : 'hidden' }}/>}
        {verified.url && <img key={loadedImageKey} src={verified.url} alt={`${side === 'FRONT' ? 'Front' : 'Back'} card, ${kind === 'PHYSICAL' ? 'oriented original' : 'straightened'}`} draggable={false}
          onLoad={async event => {
            const img = event.currentTarget;
            if (img.naturalWidth !== image.width || img.naturalHeight !== image.height) { setReadyKey(null); gradient.current = null; setSnapReady(false); onReady(side, null); setError('The displayed image does not match this outline. Reload the verified photo.'); return; }
            // Decode asynchronously before drawing the bounded snap raster.
            // Keep the reviewed sampling and snapping implementation exact.
            try { if (typeof img.decode === 'function') await img.decode(); }
            catch { if (img.isConnected !== false) { setReadyKey(null); onReady(side, null); setError('Photo unavailable. Your saved work is retained.'); } return; }
            if (img.isConnected === false) return;
            const map = gradientMapFromImage(img);
            gradient.current = map && map.width > 1 && map.height > 1 ? map : null;
            setSnapReady(Boolean(gradient.current)); setReadyKey(loadedImageKey); onReady(side, imageKey);
            setError(previous => /^(The displayed image|Photo unavailable)/.test(previous) ? '' : previous);
          }} onError={() => { setReadyKey(null); gradient.current = null; setSnapReady(false); onReady(side, null); setError('Photo unavailable. Your saved work is retained.'); }} />}
        {ready && <svg className="am-outlines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {physical && <polygon className={`am-physical ${kind === 'PHYSICAL' ? 'am-active' : ''}`} points={physical.map(p => `${p.x * 100},${p.y * 100}`).join(' ')} />}
          {printed && <polygon className={`am-printed ${kind === 'PRINTED' ? 'am-active' : ''}`} points={printed.map(p => `${p.x * 100},${p.y * 100}`).join(' ')} />}
        </svg>}
        {ready && quad?.map((point, index) => <button key={index} type="button" className={`am-handle ${corner === index ? 'am-selected' : ''}`}
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} disabled={inactive}
          aria-label={`${side} ${kind === 'PHYSICAL' ? 'physical edge' : 'printed border'} ${CORNERS[index]}`}
          onFocus={() => setCorner(index)} onPointerDown={event => { if (inactive || event.button !== 0) return; setCorner(index); drag.current = { pointerId: event.pointerId, corner: index }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
          onKeyDown={event => { const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }; const move = moves[event.key]; if (!move) return; event.preventDefault(); const step = event.shiftKey ? 10 : 1; setPoint(index, { x: point.x + move[0] * step / image.width, y: point.y + move[1] * step / image.height }); }} />)}
      </div> : <div className="am-empty">{kind === 'PRINTED' && slot.image
        ? slot.physical ? 'This side needs a current straightened image.'
          : 'The photo is saved. Detect the physical edge first to create the straightened view for printed-border review.'
        : 'Waiting for a verified photo.'}</div>}
    </div>
    {image && !verified.url && <div>
      {showingPreview && <p className="am-preview-caption">{verified.error ? 'Preview · Full detail is unavailable. Retry the full photo to edit.' : 'Preview · Full detail is loading. Editing becomes available when the full photo is verified.'}</p>}
      <p role={verified.error ? 'alert' : 'status'}>{image.displayState?.state==='PENDING' ? 'Preparing the full photo for precise editing. The preview is context only.' : image.displayState?.state==='FAILED' ? 'Full photo preparation failed. Your original and saved edits are retained. Retry preparation if available, or reload the current status.' : verified.error
        ? verified.error.code === 'VERIFIED_IMAGE_TIMEOUT'
          ? 'The saved photo is taking too long to download. Try loading it again; no new upload is needed.'
          : 'The saved photo could not be loaded or verified. Retry, or choose Reload images to renew access. Your saved work is retained.'
        : verified.progress?.phase === 'VERIFYING' ? 'Checking the saved photo…'
          : `Loading the saved photo${verified.progress?.totalBytes ? `… ${Math.min(99, Math.floor(100 * verified.progress.loadedBytes / verified.progress.totalBytes))}%` : '…'} No new upload is needed.`}</p>
      {image.displayState?.state==='FAILED' && image.displayState.retry && onRetryDisplay && <button type="button" disabled={busy||locked} onClick={retryDisplay}>Retry {side==='FRONT'?'Front':'Back'} display preparation</button>}
      {image.displayState && !transportDescriptor(image) && onRefreshImages && <button type="button" disabled={busy} onClick={onRefreshImages}>Reload {side==='FRONT'?'Front':'Back'} photo status</button>}
      {verified.error && <button type="button" onClick={verified.retry}>Retry {side === 'FRONT' ? 'Front' : 'Back'} photo</button>}
    </div>}
    {image?.previewState?.state==='FAILED' && image.previewState.retry && onRetryDisplay && <button type="button" disabled={busy||locked} onClick={retryPreview}>Retry {side==='FRONT'?'Front':'Back'} preview</button>}
    <div className="am-local-tools">
      <label>Zoom <select aria-label={`${side} zoom`} value={zoom} onChange={event => { setZoom(Number(event.target.value)); setPan({ x: 0, y: 0 }); }}><option value="1">Fit</option><option value="2">2×</option><option value="4">4×</option></select></label>
      {zoom > 1 && <div className="am-pan" aria-label={`${side} pan`}><button type="button" aria-label={`${side} pan left`} onClick={() => setPan(p => ({ ...p, x: Math.min((zoom - 1) * 50, p.x + 20) }))}>←</button><button type="button" aria-label={`${side} pan up`} onClick={() => setPan(p => ({ ...p, y: Math.min((zoom - 1) * 50, p.y + 20) }))}>↑</button><button type="button" aria-label={`${side} pan down`} onClick={() => setPan(p => ({ ...p, y: Math.max(-(zoom - 1) * 50, p.y - 20) }))}>↓</button><button type="button" aria-label={`${side} pan right`} onClick={() => setPan(p => ({ ...p, x: Math.max(-(zoom - 1) * 50, p.x - 20) }))}>→</button></div>}
      <label><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} disabled={!snapReady} /> Snap{!snapReady ? ' unavailable' : ''}</label>
    </div>
    {quad && <div className="am-coordinate-tools"><label>Corner <select aria-label={`${side} corner`} value={corner} onChange={event => setCorner(Number(event.target.value))}>{CORNERS.map((label, i) => <option value={i} key={i}>{label}</option>)}</select></label><span className="am-coordinate">{Math.round(quad[corner].x * (image?.width ?? 0))}, {Math.round(quad[corner].y * (image?.height ?? 0))} px</span><button type="button" disabled={inactive} aria-label={`${side} nudge left`} onClick={() => setPoint(corner, { ...quad[corner], x: quad[corner].x - 1 / image.width })}>←</button><button type="button" disabled={inactive} aria-label={`${side} nudge up`} onClick={() => setPoint(corner, { ...quad[corner], y: quad[corner].y - 1 / image.height })}>↑</button><button type="button" disabled={inactive} aria-label={`${side} nudge down`} onClick={() => setPoint(corner, { ...quad[corner], y: quad[corner].y + 1 / image.height })}>↓</button><button type="button" disabled={inactive} aria-label={`${side} nudge right`} onClick={() => setPoint(corner, { ...quad[corner], x: quad[corner].x + 1 / image.width })}>→</button></div>}
    {stale && <p role="alert">This side changed while you were editing. Your unsaved adjustment has been retained.</p>}
    {error && <p role="alert">{error}</p>}
    {canDetect && onBackground && <div className="am-local-tools"><label>Photo background <select aria-label={`${side} background mat`} value={slot.matColor} disabled={busy || dirty || locked || preparing} onChange={event => void changeBackground(event.target.value)}><option value="BLACK">Black</option><option value="WHITE">White</option><option value="MAGENTA">Magenta</option></select></label><small>Match the surface behind this photo. Changing it retries this side's edge detection.</small></div>}
    {kind==='PRINTED' && slot.printedAbsence && <p role="status">No printed border recorded. Centering and final approval remain unavailable until a supported borderless scoring rule exists. Findings are retained.</p>}
    <div className="am-side-actions">
      {kind==='PRINTED' && onAbsentBorder && !slot.printedAbsence && <button type="button" disabled={!ready||dirty||busy||locked} onClick={async()=>{setBusy(true);setError('');try{await onAbsentBorder({side,base:geometryBase(state,side,'PRINTED')});}catch(error){setError(message(error));}finally{setBusy(false);}}}>No printed border on this side</button>}
      {!dirty && canDetect && onPrepare && <button type="button" className="am-primary" onClick={prepare} disabled={busy || locked || preparing}>Detect edges automatically</button>}
      {!quad && <button type="button" onClick={start} disabled={!ready || busy || locked}>Start manual outline</button>}
      {dirty && (renderEditActions ?? (children=>children))(<><button type="button" className="am-primary" onClick={save} disabled={inactive || !onEdit}>Save outline</button><button type="button" disabled={busy || locked} onClick={() => { setDraft(null); setError(''); }}>Discard adjustment</button></>,side)}
      {!dirty && slot.physical && !slot.prepared && onPrepare && <button type="button" onClick={prepare} disabled={busy || locked || preparing}>Prepare this side</button>}
    </div>
    <div className="am-centering">{!draft && status.centering ? <><span>Left / right <strong>{status.centering.leftRightBalance.map(n => n.toFixed(1)).join(' / ')}</strong></span><span>Top / bottom <strong>{status.centering.topBottomBalance.map(n => n.toFixed(1)).join(' / ')}</strong></span></> : <span>Centering pending current saved borders</span>}</div>
  </section>;
}

/** Controlled manual component. Async callbacks must resolve only after the
 * authoritative save/readback and update `workspace`; rejected saves retain the
 * local draft. The host owns source verification, current version CAS, session
 * auth, persistence, automatic preparation and stage progression. */
export function PairedGeometryWorkspace({ readOnly = false, workspace, images, onEdit, onConfirm, onPrepare, onBackground, onAbsentBorder, onRefreshImages, onRetryDisplay, onEditingChange, preparingSides = {}, title = 'Edges & centering', saveStatus = '', renderReviewActions, renderEditActions, attention = [], attentionSelection, learningAdvice = {} }) {
  const status = geometryStatus(workspace);
  const [kind, setKind] = useState(attention[0]?.kind ?? 'PHYSICAL'), [activity, setActivity] = useState({ FRONT: false, BACK: false });
  const [loaded, setLoaded] = useState({ FRONT: null, BACK: null });
  const onReady = useCallback((side, binding) => setLoaded(previous => previous[side] === binding ? previous : { ...previous, [side]: binding }), []);
  const bothVisible = SIDES.every(side => { const binding = geometryImageBinding(workspace, side, kind, images); return binding !== null && loaded[side] === binding; });
  const [confirming, setConfirming] = useState(false), [error, setError] = useState('');
  const onActivity = useCallback((side, active) => setActivity(previous => previous[side] === active ? previous : { ...previous, [side]: active }), []);
  const editing = activity.FRONT || activity.BACK;
  const attentionKey = attention[0] ? `${attention[0].key}:${attention[0].kind}` : '';
  useEffect(() => { if (attention[0] && !editing && !confirming) setKind(attention[0].kind); }, [attentionKey, editing, confirming]);
  useEffect(() => {
    const selected = attention.find(issue => issue.key === attentionSelection?.key);
    if (selected && !editing && !confirming) setKind(selected.kind);
  }, [attentionSelection]);
  useEffect(() => { onEditingChange?.(editing || confirming); return () => onEditingChange?.(false); }, [editing, confirming, onEditingChange]);
  const confirm = async () => {
    if (readOnly || editing || confirming || !bothVisible || !status.canConfirmBoth || !onConfirm) return;
    setConfirming(true); setError('');
    try { await onConfirm({ actor: 'HUMAN', reviewed: true, base: { FRONT: geometryBase(workspace, 'FRONT', 'REVIEW'), BACK: geometryBase(workspace, 'BACK', 'REVIEW') } }); }
    catch { setError('Geometry was not confirmed. Review the current saved outlines and try again.'); }
    finally { setConfirming(false); }
  };
  return <div className="atlas-manual">
    <header className="am-header"><span className="am-brand">ATLAS</span><h1>{title}</h1><span>{saveStatus}</span></header>
    <div className="am-toolbar"><div className="am-tool-choice" aria-label="Geometry tool"><button type="button" disabled={editing || confirming} data-review-attention={attention.some(issue=>issue.kind==='PHYSICAL')} aria-pressed={kind === 'PHYSICAL'} onClick={() => setKind('PHYSICAL')}>Physical edge</button><button type="button" disabled={editing || confirming} data-review-attention={attention.some(issue=>issue.kind==='PRINTED'||issue.reviewBoth)} aria-pressed={kind === 'PRINTED'} onClick={() => setKind('PRINTED')}>Printed border</button></div><div className="am-legend"><span><i className="am-edge-key" />Physical edge</span><span><i className="am-border-key" />Printed border</span></div></div>
    <div className="am-pair">{SIDES.map(side => <SideEditor key={side} learningAdvice={learningAdvice?.[side]} attention={attention.find(issue=>issue.side===side)} compact={Boolean(renderReviewActions)} renderEditActions={renderEditActions} state={workspace} side={side} kind={kind} images={images} onEdit={onEdit} onPrepare={onPrepare} onBackground={onBackground} onAbsentBorder={onAbsentBorder} onRefreshImages={onRefreshImages} onRetryDisplay={onRetryDisplay} onActivity={onActivity} onReady={onReady} preparing={Boolean(preparingSides[side])} locked={confirming||readOnly} />)}</div>
    {renderReviewActions ? renderReviewActions({approve:confirm, disabled:readOnly || !bothVisible || !status.canConfirmBoth || editing || confirming || !onConfirm, busy:confirming, message:editing ? 'Save or cancel your outline.' : SIDES.some(side=>workspace.sides[side].printedAbsence) ? 'Borderless centering is unsupported. Findings remain saved; final approval is withheld.' : !bothVisible ? 'Waiting for both verified photographs. Full pixels are required for confirmation.' : 'Confirm both physical edges and printed borders.'}) : <footer className="am-footer"><span aria-live="polite">{editing ? 'Save or discard your adjustments before continuing.' : status.confirmed ? 'Both sides confirmed. Ready for defect inspection.' : 'Review the physical edge and printed border on both sides.'}</span><button type="button" className="am-primary" onClick={confirm} disabled={readOnly || !bothVisible || !status.canConfirmBoth || status.confirmed || editing || confirming || !onConfirm}>{confirming ? 'Confirming…' : 'Confirm both sides'}</button></footer>}
    {error && <p className="am-error" role="alert">{error}</p>}
  </div>;
}
