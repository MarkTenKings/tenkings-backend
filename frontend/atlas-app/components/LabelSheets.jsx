import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Shell from './Shell';
import { LABEL_JIG_V1 } from '@atlas/finishing/label-sheet-geometry';
import { manualRequest, manualMessage } from '../lib/manual-client.mjs';
import { STAFF_BASE_PATH } from '../lib/routes.mjs';
import { createLabelSheetsClient, labelArtworkHref, labelName, labelSheetMessage, labelSheetName } from '../lib/label-sheets-client.mjs';
import styles from './LabelSheets.module.css';

const mergePages = pages => {
  const unique = (field, key) => [...new Map(pages.flatMap(page => page[field] ?? []).map(value => [value[key], value])).values()];
  return { ...pages[0], sheets: unique('sheets', 'sheetId'), items: unique('items', 'itemId'), pending: unique('pending', 'itemId'), hasMore: pages.at(-1)?.hasMore, nextCursor: pages.at(-1)?.nextCursor };
};
const stateName = state => ({ OPEN: 'Draft', SEALED: 'Frozen', READY: 'Ready', PENDING_RENDER: 'Preparing label', NEEDS_LAYOUT: 'Needs layout', SUPERSEDED: 'Approval changed', FAILED: 'Needs attention', PREPARING: 'Preparing file' })[state] ?? state;
const stockName = sheet => sheet?.materialProfileId === 'atlas-v4-holo-v1' ? 'Holographic' : sheet?.materialProfileId === 'atlas-v4-gold-v1' ? 'Gold' : 'Stock not qualified';
const outputFor = exports => exports?.find(output => output.state === 'READY') ?? exports?.[0] ?? null;
const describe = item => { const identity = item?.snapshot?.identity ?? item?.identity; return [identity?.year, identity?.manufacturer, identity?.productSet, identity?.cardNumber && `#${identity.cardNumber}`, identity?.parallel].filter(Boolean).join(' · '); };
const failureText = error => labelSheetMessage(error) ?? manualMessage(error);

function Artwork({ item, mode = 'preview', className = '' }) {
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const source = labelArtworkHref(item, STAFF_BASE_PATH, mode);
  useEffect(() => { setFailed(false); setAttempt(0); }, [source]);
  if (!source) return <span className={styles.artPlaceholder}>{stateName(item?.state) || 'No label yet'}</span>;
  if (failed) return <button type="button" className={styles.artRetry} onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Retry label preview</button>;
  return <img key={`${source}:${attempt}`} className={className} src={source} alt={`${labelName(item)} · ${mode === 'print' ? 'true print ink' : 'material preview'}`} onError={() => setFailed(true)} loading="lazy"/>;
}
function ActionDialog({ kind, sheet, item, output, busy, onClose, onSubmit }) {
  const dialog = useRef(null), [slots, setSlots] = useState(sheet?.items?.map(value => value.slot) ?? []), [reason, setReason] = useState('');
  useEffect(() => { const element = dialog.current, previous = document.activeElement; element?.showModal(); return () => { element?.close(); previous?.focus?.(); }; }, []);
  return <dialog className={styles.dialog} ref={dialog} aria-labelledby="label-action-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className={styles.dialogTop}><span className={styles.eyebrow}>ATLAS LABELS</span><button type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button></div>
    <h2 id="label-action-title">{kind === 'export' ? `Freeze and export ${labelSheetName(sheet).toLowerCase()}?` : kind === 'print' ? 'Record your printed labels' : 'Request a replacement label'}</h2>
    {kind === 'export' ? <><p>This saves these {sheet.items.length} labels in their exact positions. New labels will fill the next compatible sheet.</p><div className={styles.dialogSummary}>{sheet.items.length} of 50 positions · {stockName(sheet)}<br/>310 × 400 mm transparent canvas<br/>800 ppi diagnostic export</div><p>Empty positions stay transparent. Downloading does not record a physical print.</p></> : kind === 'print' ? <><p>Select only the positions you have physically printed successfully from this export.</p><div className={styles.printSlots}>{sheet.items.map(value => <label key={value.itemId}><input type="checkbox" checked={slots.includes(value.slot)} onChange={event => setSlots(old => event.target.checked ? [...old, value.slot] : old.filter(slot => slot !== value.slot))}/><span>{value.slot}</span><span>{labelName(value)}</span></label>)}</div><p>{slots.length} successful positions will be recorded. Unchecked positions remain unreported.</p></> : <><p>The original label and sheet remain saved. A separate replacement uses this exact approved identity.</p><label className={styles.reason}>Reason<textarea maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="For example, damaged label"/></label><div className={styles.dialogSummary}>{labelName(item)} · {item.snapshot?.reportNumber}</div></>}
    <div className={styles.dialogActions}><button type="button" className={styles.button} disabled={busy} onClick={onClose}>Cancel</button><button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || kind === 'print' && slots.length === 0 || kind === 'reprint' && !reason.trim()} onClick={() => onSubmit({ slots, reason, output })}>{busy ? 'Saving…' : kind === 'export' ? 'Freeze & export' : kind === 'print' ? 'Record printed labels' : 'Request replacement'}</button></div>
  </dialog>;
}
function Mapping({ output }) {
  if (!output?.mapping) return null;
  const map = output.mapping;
  return <details className={styles.mapping}><summary>eufyMake import dimensions</summary><dl><dt>Canvas width</dt><dd>{map.intendedImportWidthMm ?? map.canvasWidthMm} mm</dd><dt>Canvas height</dt><dd>{map.intendedImportHeightMm ?? map.canvasHeightMm} mm</dd><dt>Position X / Y</dt><dd>{map.intendedImportXmm == null || map.intendedImportYmm == null ? 'Not calibrated' : `${map.intendedImportXmm} / ${map.intendedImportYmm} mm`}</dd><dt>Rotation</dt><dd>{map.rotationDeg ?? 0}°</dd><dt>Resolution</dt><dd>{map.pixelWidth} × {map.pixelHeight} px</dd></dl><p>Preserve the full transparent canvas. Verify the printer origin and material before physical use.</p></details>;
}
function LabelDetail({ item, slot, sheet, busy, readOnly, onIndividual, individualOutput, onReprint, children }) {
  const [mode, setMode] = useState('preview');
  useEffect(() => setMode('preview'), [item?.itemId]);
  return <aside className={styles.selection} aria-label="Selected label"><div className={styles.selectionTop}><span>{slot ? `POSITION ${String(slot).padStart(2, '0')}` : 'APPROVED LABEL'}</span><span className={styles.badge}>{item ? stateName(item.state) : 'Empty'}</span></div>
    {item ? <><h2>{labelName(item)}</h2><p className={styles.description}>{describe(item)}</p><div className={`${styles.labelPreview} ${mode === 'print' ? styles.inkPreview : ''}`}><Artwork item={item} mode={mode}/></div><div className={styles.previewCaption}><span>{mode === 'preview' ? 'Material simulation · preview only' : 'True ink · transparent openings'}</span><span>68.342 × 20.082 mm</span></div><div className={styles.previewModes} aria-label="Artwork view"><button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Material preview</button><button type="button" aria-pressed={mode === 'print'} onClick={() => setMode('print')}>Print ink</button></div>
      <dl className={styles.metadata}><div><dt>Approved grade</dt><dd className={styles.grade}>{item.snapshot?.grade ?? item.grade ?? '—'} <small>/ 10</small></dd></div><div><dt>Report</dt><dd>{item.snapshot?.reportNumber || 'Published report'}{item.snapshot?.approvalVersion != null && <small> · v{item.snapshot.approvalVersion}</small>}</dd></div><div><dt>Sheet stock</dt><dd><i className={`${styles.stockDot} ${stockName(sheet) === 'Holographic' ? styles.holo : ''}`}/>{stockName(sheet)}</dd></div><div><dt>Label position</dt><dd>{slot ? `${slot} of 50` : 'Waiting for allocation'}</dd></div></dl>
      <p className={styles.materialHelp}>Material is separate from the grade. The preview shows the substrate through the clear artwork.</p>
      {item.state === 'NEEDS_LAYOUT' && <p className={styles.attention}>The full approved identity needs a reviewed layout. The saved grade is unchanged.</p>}
      <button type="button" className={`${styles.button} ${styles.wide}`} disabled={busy || readOnly || item.state !== 'READY' || individualOutput?.state === 'PREPARING'} onClick={() => onIndividual(item, individualOutput)}>{individualOutput?.state === 'PREPARING' ? 'Preparing 2400 ppi label…' : individualOutput?.state === 'READY' ? 'Download individual PNG ↓' : 'Prepare individual PNG'}</button>
      <p className={styles.smallCopy}>2400 ppi · individual label · transparent print artwork</p>
      {item.snapshot?.reportHref && <a className={styles.textLink} href={item.snapshot.reportHref} target="_blank" rel="noopener noreferrer">Open approved report ↗</a>}
      {item.state === 'READY' && <button type="button" className={styles.textButton} disabled={busy || readOnly} onClick={() => onReprint(item)}>Request replacement label</button>}
    </> : <><h2>Ready for the next label.</h2><div className={styles.emptyPreview}>Position {slot}</div><p className={styles.emptyCopy}>The next compatible, published label fills the next available position automatically. Empty positions stay transparent in the export.</p></>}{children}
  </aside>;
}

export default function LabelSheets({ staff, embedded = false, initialCardId = null }) {
  const client = useRef(null), owner = useRef(null), selected = useRef(null), readSequence = useRef(0), reading = useRef(false), mutating = useRef(false), cursors = useRef([0]), requestedCard = useRef(initialCardId);
  const [listing, setListing] = useState(null), [sheet, setSheet] = useState(null), [sheetId, setSheetId] = useState(null), [slot, setSlot] = useState(1);
  const [tab, setTab] = useState('sheets'), [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [selectedItemId, setSelectedItemId] = useState(null);
  const [error, setError] = useState(''), [actionError, setActionError] = useState(''), [detailError, setDetailError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [pending, setPending] = useState(null);
  const [dialog, setDialog] = useState(null), [download, setDownload] = useState(null), [message, setMessage] = useState(''), [itemExports, setItemExports] = useState({}), [reload, setReload] = useState(0), [paging, setPaging] = useState(false);
  const readOnly = staff.role !== 'REVIEWER', selectionKey = `atlas-label-sheets:${staff.id}:selection`;
  const refresh = useCallback(async (currentOwner = owner.current) => {
    if (!client.current || reading.current) return;
    reading.current = true;
    try {
      const currentClient = client.current, result = mergePages(await Promise.all(cursors.current.map(cursor => currentClient.list({ cursor }))));
      if (owner.current !== currentOwner) return;
      setListing(result); setError('');
      let id = selected.current;
      const requestedItem = requestedCard.current && [...result.items ?? [], ...result.pending ?? []].find(value => value.cardId === requestedCard.current);
      if (requestedItem) {
        requestedCard.current = null; setSelectedItemId(requestedItem.itemId);
        if (requestedItem.sheetId && result.sheets.some(value => value.sheetId === requestedItem.sheetId)) { id = requestedItem.sheetId; selected.current = id; setSheetId(id); setSlot(requestedItem.slot ?? 1); setSheet(null); setTab('sheets'); }
        else setTab('labels');
      }
      if (!result.sheets.some(value => value.sheetId === id)) {
        const matching = result.items?.find(value => value.cardId === initialCardId);
        id = matching?.sheetId ?? result.sheets.find(value => value.state === 'OPEN')?.sheetId ?? result.sheets[0]?.sheetId ?? null;
        if (matching?.slot) setSlot(matching.slot);
        selected.current = id; setSheetId(id); setSheet(null);
      }
      setPending(currentClient.pending());
      if (id) {
        const sequence = ++readSequence.current;
        try {
          const detail = await currentClient.sheet(id);
          if (owner.current === currentOwner && selected.current === id && sequence === readSequence.current) { setSheet(detail); setDetailError(''); }
        } catch (failure) { if (owner.current === currentOwner && selected.current === id && sequence === readSequence.current) { setSheet(null); setDetailError(failureText(failure)); } }
      }
    } finally { if (owner.current === currentOwner) { reading.current = false; setLoading(false); } }
  }, [initialCardId]);
  useEffect(() => {
    const token = {}; owner.current = token; client.current = null; reading.current = false; mutating.current = false; cursors.current = [0]; requestedCard.current = initialCardId; setPaging(false); setActionError('');
    setListing(null); setSheet(null); setLoading(true); setError(''); setPending(null); setBusy(false); setDownload(null); setDialog(null); setItemExports({}); setMessage(''); setDetailError('');
    try { const saved = JSON.parse(localStorage.getItem(selectionKey) || 'null'); selected.current = saved?.sheetId ?? null; setSheetId(selected.current); setSlot(Number.isInteger(saved?.slot) && saved.slot >= 1 && saved.slot <= 50 ? saved.slot : 1); } catch { selected.current = null; setSheetId(null); }
    void (async () => {
      const session = await manualRequest('/api/staff/session');
      if (owner.current !== token) return;
      if (session.staff?.id !== staff.id) throw { code: 'MANUAL_STAFF_CHANGED' };
      client.current = createLabelSheetsClient({ staffId: staff.id, csrf: session.csrf, request: manualRequest, storage: localStorage });
      await refresh(token);
    })().catch(failure => { if (owner.current === token) { setError(failureText(failure)); setLoading(false); } });
    const timer = setInterval(() => { if (owner.current === token && document.visibilityState !== 'hidden' && !mutating.current) void refresh(token).catch(failure => { if (owner.current === token) setError(failureText(failure)); }); }, 5000);
    return () => { clearInterval(timer); if (owner.current === token) { owner.current = null; client.current = null; readSequence.current++; } };
  }, [staff.id, selectionKey, refresh, reload]);
  useEffect(() => { if (sheetId) try { localStorage.setItem(selectionKey, JSON.stringify({ sheetId, slot })); } catch { /* Selection is optional; durable mutation storage is checked separately. */ } }, [selectionKey, sheetId, slot]);
  const loadMore = async () => {
    if (paging || listing?.nextCursor == null || !client.current) return;
    const token = owner.current, cursor = listing.nextCursor; setPaging(true);
    try { const page = await client.current.list({ cursor }); if (owner.current === token) { cursors.current = [...new Set([...cursors.current, cursor])]; setListing(old => mergePages([old, page])); } }
    catch (failure) { if (owner.current === token) setError(failureText(failure)); }
    finally { if (owner.current === token) setPaging(false); }
  };
  const selectSheet = async id => {
    const token = owner.current, currentClient = client.current, sequence = ++readSequence.current;
    selected.current = id; setSheetId(id); setSlot(1); setSheet(null); setDetailError(''); setDownload(null);
    try { const detail = await currentClient.sheet(id); if (owner.current === token && selected.current === id && readSequence.current === sequence) setSheet(detail); }
    catch (failure) { if (owner.current === token && selected.current === id && readSequence.current === sequence) setDetailError(failureText(failure)); }
  };
  const run = async operation => {
    if (mutating.current || !client.current || readOnly) return;
    const token = owner.current; mutating.current = true; setBusy(true); setError(''); setActionError(''); setMessage(''); setDownload(null);
    try {
      const reply = await operation(client.current);
      if (owner.current !== token) return;
      if (reply.kind === 'download' || reply.kind === 'individual-download') { setDownload(reply.result); setMessage('Your saved print file is ready to download.'); }
      else if (reply.kind === 'individual-export') { setItemExports(old => ({ ...old, [reply.itemId ?? reply.result.itemId]: reply.result })); setMessage('Individual export saved.'); }
      else setMessage(reply.kind === 'print' ? 'Your physical print confirmation is saved.' : reply.kind === 'reprint' ? 'Replacement label requested. The original is retained.' : 'The sheet is frozen. Its export is saved separately from physical printing.');
      setDialog(null);
      await refresh(token);
    } catch (failure) {
      if (owner.current === token) { setDialog(null); await refresh(token).catch(() => {}); setActionError(failureText(failure)); }
    } finally {
      if (owner.current === token) { try { setPending(client.current.pending()); } catch (failure) { setError(failureText(failure)); } mutating.current = false; setBusy(false); }
    }
  };
  const summaries = listing?.items ?? [], pendingItems = listing?.pending ?? [];
  const allItems = [...summaries, ...pendingItems.filter(value => !summaries.some(item => item.itemId === value.itemId))];
  const individualItems = allItems.filter(item => (!search || `${labelName(item)} ${item.snapshot?.reportNumber ?? ''} ${describe(item)}`.toLowerCase().includes(search.toLowerCase())) && (filter === 'all' || filter === 'waiting' ? filter === 'all' || item.state !== 'READY' : listing?.sheets.find(value => value.sheetId === item.sheetId)?.state === filter));
  const currentItem = tab === 'sheets' ? sheet?.items.find(value => value.slot === slot) : individualItems.find(value => value.itemId === selectedItemId) ?? individualItems[0];
  const currentSheet = tab === 'sheets' ? sheet : listing?.sheets.find(value => value.sheetId === currentItem?.sheetId) ?? currentItem;
  const individualOutput = itemExports[currentItem?.itemId] ?? outputFor(currentItem?.exports ?? summaries.find(value => value.itemId === currentItem?.itemId)?.exports);
  const output = outputFor(sheet?.exports), sheetCurrent = sheet && !sheet.containsSuperseded && sheet.items.every(value => value.state === 'READY'), canWrite = !busy && !pending && !readOnly;
  useEffect(() => {
    if (individualOutput?.state !== 'PREPARING' || !currentItem?.itemId) return;
    const token = owner.current, itemId = currentItem.itemId, exportId = individualOutput.exportId;
    const timer = setInterval(() => { if (document.visibilityState === 'hidden') return; void client.current?.readLabelExport(itemId, exportId).then(result => { if (owner.current === token) setItemExports(old => ({ ...old, [itemId]: result })); }).catch(failure => { if (owner.current === token) setError(failureText(failure)); }); }, 3000);
    return () => clearInterval(timer);
  }, [individualOutput?.exportId, individualOutput?.state, currentItem?.itemId]);
  const individualAction = (item, result) => { setSelectedItemId(item.itemId); void run(api => result?.state === 'READY' ? api.downloadLabel(item, result) : api.exportLabel(item)); };
  const main = <main className={styles.page} aria-label="ATLAS labels">
    <header className={styles.heading}><div><p className={styles.eyebrow}>FINISHING</p><h1>Labels</h1><p className={styles.intro}>Approved cards, ready for the next sheet.</p></div><div className={styles.automatic}><i/><div><strong>Fills automatically</strong><span>After publication + label ready</span></div></div></header>
    {(error || actionError) && <div role="alert" className={styles.error}><p>{error || actionError}</p><button type="button" disabled={busy} onClick={() => client.current ? void refresh().catch(failure => setError(failureText(failure))) : setReload(value => value + 1)}>Refresh labels</button>{/session|sign in|account changed/i.test(error || actionError) && <a href={`${STAFF_BASE_PATH}?reauthenticate=1`}>Sign in again</a>}<Link href="/station">Open existing NFC tools ↗</Link></div>}
    {pending && <div className={styles.attention} role="status"><p>A saved {pending.kind.includes('download') ? 'download' : pending.kind.includes('export') ? 'export' : pending.kind === 'print' ? 'print confirmation' : 'replacement'} request needs to finish.</p><button type="button" className={styles.button} disabled={busy || readOnly} onClick={() => void run(api => api.resume())}>{busy ? 'Checking saved request…' : 'Retry saved request'}</button></div>}
    {message && <p className={styles.message} role="status">{message}</p>}
    {listing && initialCardId && !allItems.some(value => value.cardId === initialCardId) && <p className={styles.attention} role="status">This card’s label is not in the loaded results yet. {listing.hasMore ? 'Load older sheets and labels to check its saved status.' : 'It will appear here when its published label is prepared.'}</p>}
    {download && <div className={styles.download} role="status"><a className={`${styles.button} ${styles.primary}`} href={download.url} download rel="noopener noreferrer">Download saved PNG ↓</a><p>This link expires {new Date(download.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Request it again if needed.</p></div>}
    <nav className={styles.tabs} aria-label="Label views"><button type="button" aria-current={tab === 'sheets' ? 'page' : undefined} onClick={() => setTab('sheets')}>Print sheets <span>{listing?.sheets.length ?? '—'}</span></button><button type="button" aria-current={tab === 'labels' ? 'page' : undefined} onClick={() => setTab('labels')}>Individual labels <span>{listing ? allItems.length : '—'}</span></button></nav>
    {loading && !listing ? <div className={styles.empty} role="status">Loading your saved labels…</div> : !listing ? <div className={styles.empty}><h2>Labels are unavailable.</h2><p>Your approved reports remain saved. Refresh to try again.</p></div> : tab === 'sheets' ? listing.sheets.length ? <div className={styles.workspace}>
      <aside className={styles.rail} aria-label="Saved sheets"><div className={styles.caption}><h2>Your sheets</h2><span>{listing.sheets.filter(value => value.state === 'OPEN').length} draft</span></div><div className={styles.sheetList}>{listing.sheets.map(value => <button type="button" key={value.sheetId} className={styles.sheetItem} aria-current={sheetId === value.sheetId ? 'true' : undefined} onClick={() => void selectSheet(value.sheetId)}><span className={styles.sheetTop}><strong>{labelSheetName(value)}</strong><small>{stateName(value.state)}</small></span><span className={styles.sheetCount}>{value.occupied}<small> / 50 labels</small></span><span className={styles.progress}><span style={{ width: `${value.occupied / 50 * 100}%` }}/></span><span className={styles.stock}><i className={`${styles.stockDot} ${stockName(value) === 'Holographic' ? styles.holo : ''}`}/>{stockName(value)}</span></button>)}</div><p className={styles.railFoot}>Up to 50 labels per sheet.<br/>Export at any count.<br/>New sheets open automatically.</p></aside>
      <section className={styles.inspector} aria-label="Sheet positions"><header className={styles.sheetHeading}><div><div className={styles.inlineTitle}><h2>{labelSheetName(listing.sheets.find(value => value.sheetId === sheetId))}</h2>{sheet && <span className={styles.badge}>{stateName(sheet.state)}</span>}</div><p>{sheet ? `${sheet.items.length} labels · ${50 - sheet.items.length} empty positions` : 'Loading saved positions…'}</p></div></header>
        {detailError ? <div role="alert" className={styles.error}><p>{detailError}</p><button type="button" onClick={() => void selectSheet(sheetId)}>Retry sheet</button></div> : !sheet ? <div className={styles.empty} role="status">Loading this sheet…</div> : <><div className={styles.jigStage}><div className={styles.jigTop}><span>{LABEL_JIG_V1.plate.widthMm} × {LABEL_JIG_V1.plate.heightMm} mm</span><span>TOP ↑</span></div><div className={styles.jig} role="group" aria-label="50-position sheet preview">{LABEL_JIG_V1.slots.map(position => {
          const item = sheet.items.find(value => value.slot === position.slot);
          return <button type="button" key={position.slot} className={`${styles.slot} ${item ? styles.filled : styles.emptySlot}`} aria-label={`Position ${position.slot}, row ${position.row}, column ${position.column}${item ? `, ${labelName(item)}, grade ${item.snapshot?.grade ?? 'unavailable'}` : ', empty'}`} aria-pressed={slot === position.slot} onClick={() => setSlot(position.slot)} style={{ left: `${position.xMm / LABEL_JIG_V1.plate.widthMm * 100}%`, top: `${position.yMm / LABEL_JIG_V1.plate.heightMm * 100}%`, width: `${position.widthMm / LABEL_JIG_V1.plate.widthMm * 100}%`, height: `${position.heightMm / LABEL_JIG_V1.plate.heightMm * 100}%` }}><span className={styles.slotNumber}>{position.slot}</span>{item && <span className={styles.slotArtwork} style={{ width: `${LABEL_JIG_V1.blank.widthMm / position.widthMm * 100}%`, height: `${LABEL_JIG_V1.blank.heightMm / position.heightMm * 100}%` }}><img src={labelArtworkHref(item, STAFF_BASE_PATH)} alt="" loading="lazy"/></span>}</button>;
        })}<span className={styles.jigCaption}>ATLAS · 50 POSITION JIG</span></div><div className={styles.legend}><span><i/> Filled</span><span>▯ Empty · stays transparent</span><span>↻ 90° clockwise</span></div></div><div className={styles.positionControls}><button type="button" disabled={slot === 1} aria-label="Previous position" onClick={() => setSlot(value => value - 1)}>←</button><label>Position <select value={slot} onChange={event => setSlot(Number(event.target.value))} aria-label="Select sheet position">{LABEL_JIG_V1.slots.map(position => <option key={position.slot} value={position.slot}>{position.slot} of 50</option>)}</select></label><button type="button" disabled={slot === 50} aria-label="Next position" onClick={() => setSlot(value => value + 1)}>→</button><span>Row {Math.floor((slot - 1) / 10) + 1} · Column {(slot - 1) % 10 + 1}</span></div></>}
      </section>
      <LabelDetail item={currentItem} slot={slot} sheet={sheet} busy={!canWrite} readOnly={readOnly} onIndividual={individualAction} individualOutput={individualOutput} onReprint={item => setDialog({ kind: 'reprint', item })}><div className={styles.sheetActions}>{sheet?.containsSuperseded && <p className={styles.attention}>A report approval on this sheet changed. Its saved history is retained; use the current approval’s label before printing.</p>}<p className={styles.actionTitle}>{sheet?.state === 'SEALED' ? 'This sheet is frozen.' : 'Ready when you are.'}</p><p className={styles.actionCopy}>{sheet?.state === 'SEALED' ? 'The saved labels and positions stay fixed. New labels go to the next compatible sheet.' : 'Export a partial sheet now, or let it fill to 50. Export freezes these positions.'}</p><button type="button" className={`${styles.button} ${styles.primary} ${styles.wide}`} disabled={!canWrite || !sheetCurrent || !sheet.items.length || output?.state === 'PREPARING'} onClick={() => output?.state === 'READY' ? void run(api => api.downloadSheet(sheet, output)) : setDialog({ kind: 'export', sheet })}>{output?.state === 'PREPARING' ? 'Preparing sheet file…' : output?.state === 'READY' ? 'Download sheet PNG ↓' : output?.state === 'FAILED' ? 'Retry sheet export' : 'Export this sheet'}</button>{output?.state === 'FAILED' && <p className={styles.attention}>Export needs attention. The frozen sheet is retained.</p>}<p className={styles.smallCopy}>Diagnostic export · printer origin and material need qualification.</p>{output?.state === 'READY' && <><button type="button" className={`${styles.button} ${styles.wide}`} disabled={!canWrite || !sheetCurrent} onClick={() => setDialog({ kind: 'print', sheet, output })}>Record printed labels</button><p className={styles.smallCopy}>{sheet.printEvents?.length ? `${sheet.printEvents.length} saved physical print confirmation${sheet.printEvents.length === 1 ? '' : 's'}` : 'Physical printing has not been recorded.'}</p></>}<Mapping output={output}/></div></LabelDetail>
    </div> : <div className={styles.empty}><span aria-hidden="true">▦</span><h2>Your first sheet starts here.</h2><p>Published labels appear automatically when their artwork is ready. {pendingItems.length > 0 ? `${pendingItems.length} label${pendingItems.length === 1 ? ' is' : 's are'} preparing or need attention.` : 'No labels are ready yet.'}</p>{pendingItems.length > 0 && <button type="button" className={styles.button} onClick={() => setTab('labels')}>View individual labels</button>}</div> : <><div className={styles.labelToolbar}><label className={styles.search}><span>Search labels</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or report number"/></label><label className={styles.filter}>Show <select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All labels</option><option value="OPEN">On draft sheets</option><option value="SEALED">On frozen sheets</option><option value="waiting">Preparing / attention</option></select></label></div><div className={styles.individualWorkspace}><section className={styles.individualList} aria-label="Individual labels">{individualItems.map(item => <button type="button" key={item.itemId} className={styles.labelRow} aria-pressed={currentItem?.itemId === item.itemId} onClick={() => setSelectedItemId(item.itemId)}><span className={styles.rowArtwork}>{item.state === 'READY' ? <img src={labelArtworkHref(item, STAFF_BASE_PATH)} alt="" loading="lazy"/> : stateName(item.state)}</span><span><strong>{labelName(item)}</strong><small>{describe(item)}</small><small>{item.snapshot?.reportNumber}{item.snapshot?.approvalVersion != null ? ` · v${item.snapshot.approvalVersion}` : ''}</small></span><span className={styles.rowLocation}>{item.slot ? <>{labelSheetName(listing.sheets.find(value => value.sheetId === item.sheetId))}<strong>Position {item.slot}</strong></> : stateName(item.state)}</span></button>)}{!individualItems.length && <div className={styles.empty}><h2>{search ? 'No matching labels.' : 'No labels in this view.'}</h2><p>{search ? 'Try another name or report number.' : 'Ready labels and any preparation issues appear here.'}</p></div>}</section><LabelDetail item={currentItem} slot={currentItem?.slot} sheet={currentSheet} busy={!canWrite} readOnly={readOnly} individualOutput={individualOutput} onIndividual={individualAction} onReprint={item => setDialog({ kind: 'reprint', item })}/></div></>}
    {listing?.hasMore && <p className={styles.attention}>Showing {allItems.length} saved labels. <button type="button" className={styles.button} disabled={paging} onClick={() => void loadMore()}>{paging ? 'Loading older labels…' : 'Load older sheets & labels'}</button></p>}
    <footer className={styles.footer}><span>V4 artwork · Gold / Holographic stock</span><span>Export and physical printing are recorded separately.</span></footer>
    {dialog && <ActionDialog key={`${dialog.kind}:${dialog.item?.itemId ?? sheetId}`} {...dialog} sheet={dialog.sheet ?? sheet} busy={busy} onClose={() => setDialog(null)} onSubmit={({ slots, reason }) => void run(api => dialog.kind === 'export' ? api.exportSheet(dialog.sheet) : dialog.kind === 'print' ? api.recordPrint(dialog.sheet, dialog.output, slots) : api.reprint(dialog.item, reason))}/>}
  </main>;
  return embedded ? main : <Shell staff={staff} manual title="Labels">{main}</Shell>;
}
