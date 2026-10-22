import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Shell from './Shell';
import { LABEL_JIG_V1 } from '@atlas/finishing/label-sheet-geometry';
import { manualRequest, manualMessage } from '../lib/manual-client.mjs';
import { STAFF_BASE_PATH } from '../lib/routes.mjs';
import { createLabelSheetsClient, labelArtworkHref, labelName, labelSheetMessage, labelSheetName, labelSupportsPrintFormat, LABEL_PRINT_FORMATS } from '../lib/label-sheets-client.mjs';
import { buildNfcBatch, nfcBatchCsv, nfcBatchMessage } from '../lib/gototags-nfc-export.mjs';
import styles from './LabelSheets.module.css';

const mergePages = pages => {
  const unique = (field, key) => [...new Map(pages.flatMap(page => page[field] ?? []).map(value => [value[key], value])).values()];
  return { ...pages[0], sheets: unique('sheets', 'sheetId'), items: unique('items', 'itemId'), pending: unique('pending', 'itemId'), hasMore: pages.at(-1)?.hasMore, nextCursor: pages.at(-1)?.nextCursor };
};
const stateName = state => ({ OPEN: 'Draft', SEALED: 'Frozen', READY: 'Ready', PENDING_RENDER: 'Preparing label', NEEDS_LAYOUT: 'Preparation paused', SUPERSEDED: 'Approval changed', FAILED: 'Needs attention', PREPARING: 'Preparing file' })[state] ?? state;
const itemStateName = item => item?.state === 'NEEDS_LAYOUT' && item?.automaticLayoutRecoveryEligible ? 'Preparing label' : item?.state === 'SUPERSEDED' && item?.supersededReason === 'LAYOUT_RETRIED' ? 'Earlier preparation' : stateName(item?.state);
const stockName = sheet => sheet?.materialProfileId === 'atlas-v4-holo-v1' ? 'Holographic' : sheet?.materialProfileId === 'atlas-v4-gold-v1' ? 'Gold' : 'Assigned automatically';
const outputFor = (exports, profileId) => { const matching = exports?.filter(output => output.exportProfileId === profileId) ?? []; return matching.find(output => output.state === 'READY') ?? matching[0] ?? null; };
const describe = item => { const identity = item?.snapshot?.identity ?? item?.identity; return [identity?.year, identity?.manufacturer, identity?.productSet, identity?.cardNumber && `#${identity.cardNumber}`, identity?.parallel].filter(Boolean).join(' · '); };
const failureText = error => labelSheetMessage(error) ?? manualMessage(error);

function Artwork({ item, mode = 'preview', printFormat = 'foil', className = '' }) {
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const format = LABEL_PRINT_FORMATS[printFormat];
  const source = labelSupportsPrintFormat(item, printFormat) ? labelArtworkHref(item, STAFF_BASE_PATH, format[`${mode}Mode`]) : null;
  useEffect(() => { setFailed(false); setAttempt(0); }, [source]);
  if (!source) return <span className={styles.artPlaceholder}>{item?.state === 'READY' && !labelSupportsPrintFormat(item, printFormat) ? 'This format is not recorded for this label.' : itemStateName(item) || 'No label yet'}</span>;
  if (failed) return <button type="button" className={styles.artRetry} onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Retry label preview</button>;
  return <img key={`${source}:${attempt}`} className={className} src={source} alt={`${labelName(item)} · ${format.side.toLowerCase()} · ${mode === 'print' ? format.printCaption : 'material preview'}`} onError={() => setFailed(true)} loading="lazy"/>;
}
function ThumbnailArtwork({ item, printFormat }) {
  const source = labelSupportsPrintFormat(item, printFormat) ? labelArtworkHref(item, STAFF_BASE_PATH, LABEL_PRINT_FORMATS[printFormat].previewMode) : null;
  return source ? <img src={source} alt="" loading="lazy"/> : <span>No saved artwork</span>;
}
function ActionDialog({ kind, sheet, item, output, printFormat = 'foil', busy, onClose, onSubmit }) {
  const dialog = useRef(null), [slots, setSlots] = useState(sheet?.items?.map(value => value.slot) ?? []), [reason, setReason] = useState('');
  useEffect(() => { const element = dialog.current, previous = document.activeElement; element?.showModal(); return () => { element?.close(); previous?.focus?.(); }; }, []);
  return <dialog className={styles.dialog} ref={dialog} aria-labelledby="label-action-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className={styles.dialogTop}><span className={styles.eyebrow}>ATLAS LABELS</span><button type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button></div>
    <h2 id="label-action-title">{kind === 'export' ? `Freeze and export ${labelSheetName(sheet).toLowerCase()}?` : kind === 'print' ? 'Record your printed labels' : 'Request a replacement label'}</h2>
    {kind === 'export' ? <><p>This saves these {sheet.items.length} labels in their exact positions. New labels will fill the next compatible sheet.</p><div className={styles.dialogSummary}>{sheet.items.length} of 50 positions · {stockName(sheet)}<br/>310 × 400 mm transparent canvas<br/>{LABEL_PRINT_FORMATS[printFormat].label}<br/>800 ppi diagnostic export</div><p>Empty positions stay transparent. Downloading does not record a physical print.</p></> : kind === 'print' ? <><p>Select only the positions you have physically printed successfully from this export.</p><div className={styles.printSlots}>{sheet.items.map(value => <label key={value.itemId}><input type="checkbox" checked={slots.includes(value.slot)} onChange={event => setSlots(old => event.target.checked ? [...old, value.slot] : old.filter(slot => slot !== value.slot))}/><span>{value.slot}</span><span>{labelName(value)}</span></label>)}</div><p>{slots.length} successful positions will be recorded. Unchecked positions remain unreported.</p></> : <><p>The original label and sheet remain saved. A separate replacement uses this exact approved identity.</p><label className={styles.reason}>Reason<textarea maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="For example, damaged label"/></label><div className={styles.dialogSummary}>{labelName(item)} · {item.snapshot?.reportNumber}</div></>}
    <div className={styles.dialogActions}><button type="button" className={styles.button} disabled={busy} onClick={onClose}>Cancel</button><button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || kind === 'print' && slots.length === 0 || kind === 'reprint' && !reason.trim()} onClick={() => onSubmit({ slots, reason, output })}>{busy ? 'Saving…' : kind === 'export' ? 'Freeze & export' : kind === 'print' ? 'Record printed labels' : 'Request replacement'}</button></div>
  </dialog>;
}
function Mapping({ output }) {
  if (!output?.mapping) return null;
  const map = output.mapping;
  return <details className={styles.mapping}><summary>eufyMake import dimensions</summary><dl><dt>Canvas width</dt><dd>{map.intendedImportWidthMm ?? map.canvasWidthMm} mm</dd><dt>Canvas height</dt><dd>{map.intendedImportHeightMm ?? map.canvasHeightMm} mm</dd><dt>Position X / Y</dt><dd>{map.intendedImportXmm == null || map.intendedImportYmm == null ? 'Not calibrated' : `${map.intendedImportXmm} / ${map.intendedImportYmm} mm`}</dd><dt>Rotation</dt><dd>{map.rotationDeg ?? 0}°</dd><dt>Resolution</dt><dd>{map.pixelWidth} × {map.pixelHeight} px</dd></dl><p>Preserve the full transparent canvas. Verify the printer origin and material before physical use.</p></details>;
}
function LabelDetail({ item, slot, sheet, printFormat = 'foil', busy, readOnly, onIndividual, individualOutput, onReprint, children }) {
  const [mode, setMode] = useState('preview');
  const format = LABEL_PRINT_FORMATS[printFormat], formatAvailable = labelSupportsPrintFormat(item, printFormat);
  useEffect(() => setMode('preview'), [item?.itemId]);
  return <aside className={styles.selection} aria-label="Selected label"><div className={styles.selectionTop}><span>{slot ? `POSITION ${String(slot).padStart(2, '0')}` : 'APPROVED LABEL'}</span><span className={styles.badge}>{item ? itemStateName(item) : 'Empty'}</span></div>
    {item ? <><h2>{labelName(item)}</h2><p className={styles.description}>{describe(item)}</p><div className={`${styles.labelPreview} ${mode === 'print' ? styles.inkPreview : ''}`}><Artwork item={item} mode={mode} printFormat={printFormat}/></div><div className={styles.previewCaption}><span>{mode === 'preview' ? `${format.side} · material simulation · preview only` : format.printCaption}</span><span>68.342 × 20.082 mm</span></div><div className={styles.previewModes} aria-label="Artwork view"><button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Material preview</button><button type="button" aria-pressed={mode === 'print'} onClick={() => setMode('print')}>Print ink</button></div>
      <dl className={styles.metadata}><div><dt>Approved grade</dt><dd className={styles.grade}>{item.snapshot?.grade ?? item.grade ?? '—'} <small>/ 10</small></dd></div><div><dt>Report</dt><dd>{item.snapshot?.reportNumber || 'Published report'}{item.snapshot?.approvalVersion != null && <small> · v{item.snapshot.approvalVersion}</small>}</dd></div><div><dt>Sheet stock</dt><dd><i className={`${styles.stockDot} ${stockName(sheet) === 'Holographic' ? styles.holo : ''}`}/>{stockName(sheet)}</dd></div><div><dt>Label position</dt><dd>{slot ? `${slot} of 50` : 'Assigned when ready'}</dd></div></dl>
      <p className={styles.materialHelp}>{formatAvailable ? format.description : 'This format is not recorded for this saved label. Its original front formats remain available.'}</p>
      {item.state === 'NEEDS_LAYOUT' && <div className={styles.attention} role="status"><p>{item.automaticLayoutRecoveryEligible ? 'ATLAS is preparing this label automatically. It will appear here when ready.' : 'ATLAS could not prepare a printable label. The approved card is saved. This is a system issue; staff do not need to change the grade or recreate the card.'}</p></div>}
      <button type="button" className={`${styles.button} ${styles.wide}`} disabled={busy || readOnly || item.state !== 'READY' || !formatAvailable || individualOutput?.state === 'PREPARING'} onClick={() => onIndividual(item, individualOutput)}>{individualOutput?.state === 'PREPARING' ? 'Preparing 2400 ppi label…' : individualOutput?.state === 'READY' ? 'Download individual PNG ↓' : 'Prepare individual PNG'}</button>
      <p className={styles.smallCopy}>2400 ppi · {format.label}</p>
      {item.snapshot?.reportHref && <a className={styles.textLink} href={item.snapshot.reportHref} target="_blank" rel="noopener noreferrer">Open approved report ↗</a>}
      {item.state === 'READY' && <button type="button" className={styles.textButton} disabled={busy || readOnly} onClick={() => onReprint(item)}>Request replacement label</button>}
    </> : <><h2>Ready for the next label.</h2><div className={styles.emptyPreview}>Position {slot}</div><p className={styles.emptyCopy}>The next compatible, published label fills the next available position automatically. Empty positions stay transparent in the export.</p></>}{children}
  </aside>;
}

export default function LabelSheets({ staff, embedded = false, initialCardId = null }) {
  const client = useRef(null), owner = useRef(null), selected = useRef(null), readSequence = useRef(0), reading = useRef(false), mutating = useRef(false), cursors = useRef([0]), requestedCard = useRef(initialCardId), layoutReconciliations = useRef(new Map()), preparingSelection = useRef(null);
  const [listing, setListing] = useState(null), [sheet, setSheet] = useState(null), [sheetId, setSheetId] = useState(null), [slot, setSlot] = useState(1);
  const [printFormat, setPrintFormat] = useState('foil');
  const [tab, setTab] = useState('sheets'), [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [selectedItemId, setSelectedItemId] = useState(null);
  const [error, setError] = useState(''), [actionError, setActionError] = useState(''), [detailError, setDetailError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [pending, setPending] = useState(null);
  const [dialog, setDialog] = useState(null), [download, setDownload] = useState(null), [message, setMessage] = useState(''), [itemExports, setItemExports] = useState({}), [reload, setReload] = useState(0), [paging, setPaging] = useState(false);
  const nfcRequest = useRef(null);
  const [nfcBatch, setNfcBatch] = useState(null), [nfcSelected, setNfcSelected] = useState([]), [nfcBusy, setNfcBusy] = useState(false), [nfcError, setNfcError] = useState(''), [nfcMessage, setNfcMessage] = useState('');
  const readOnly = staff.role !== 'REVIEWER', selectionKey = `atlas-label-sheets:${staff.id}:selection`;
  const refresh = useCallback(async (currentOwner = owner.current) => {
    if (!client.current || reading.current) return;
    reading.current = true;
    try {
      const currentClient = client.current;
      let result = mergePages(await Promise.all(cursors.current.map(cursor => currentClient.list({ cursor }))));
      if (owner.current !== currentOwner) return;
      setListing(result); setError('');
      const priorSelection = preparingSelection.current;
      if (priorSelection) {
        const items = [...result.items ?? [], ...result.pending ?? []];
        const predecessor = items.find(value => value.itemId === priorSelection);
        if (predecessor?.layoutRetryItemId && items.some(value => value.itemId === predecessor.layoutRetryItemId)) setSelectedItemId(predecessor.layoutRetryItemId);
      }
      // Reconcile only an already-saved legacy layout request. New labels and
      // recovery are server-owned; exports, replacements and print records
      // always retain their explicit staff gesture.
      const saved = currentClient.pending();
      if (saved?.kind === 'layout-retry' && !readOnly && !mutating.current) {
        const attempts = layoutReconciliations.current.get(saved.body.requestId) ?? 0;
        if (attempts < 3) {
          layoutReconciliations.current.set(saved.body.requestId, attempts + 1);
          mutating.current = true; setBusy(true);
          try {
            const reply = await currentClient.resume();
            if (owner.current !== currentOwner) return;
            setSelectedItemId(reply.result.itemId); setActionError('');
            result = mergePages(await Promise.all(cursors.current.map(cursor => currentClient.list({ cursor }))));
            if (owner.current === currentOwner) setListing(result);
          } catch (failure) {
            if (owner.current === currentOwner) {
              // Only the API client's definite reply can clear a journal. A
              // missing/deleted source or completed successor needs no action.
              setActionError(''); // The retained request banner reports unresolved outcomes.
            }
          } finally {
            if (owner.current === currentOwner) { mutating.current = false; setBusy(false); }
          }
          if (owner.current !== currentOwner) return;
        }
      }
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
  }, [initialCardId, readOnly]);
  useEffect(() => {
    const token = {}; owner.current = token; client.current = null; reading.current = false; mutating.current = false; cursors.current = [0]; layoutReconciliations.current = new Map(); preparingSelection.current = null; requestedCard.current = initialCardId; setPaging(false); setActionError('');
    nfcRequest.current = null; setNfcBatch(null); setNfcSelected([]); setNfcBusy(false); setNfcError(''); setNfcMessage('');
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
  const prepareNfc = async (download = false) => {
    if (nfcRequest.current || !client.current || readOnly) return;
    const token = owner.current, currentClient = client.current, requestToken = {};
    const expected = nfcBatch, selectedItems = [...nfcSelected];
    nfcRequest.current = requestToken; setNfcBusy(true); setNfcError(''); setNfcMessage('');
    try {
      // Read-only GETs deliberately do not use run(), resume(), or pending print intents.
      const session = await manualRequest('/api/staff/session');
      if (owner.current !== token) return;
      if (session.staff?.id !== staff.id) throw { code: 'MANUAL_STAFF_CHANGED' };
      const pages = await Promise.all([...cursors.current].map(cursor => currentClient.list({ cursor })));
      if (owner.current !== token) return;
      const current = mergePages(pages), details = [];
      // Bound concurrent transactions while retaining every loaded sheet, including frozen ones.
      for (let i = 0; i < current.sheets.length; i += 4) {
        details.push(...await Promise.all(current.sheets.slice(i, i + 4).map(value => currentClient.sheet(value.sheetId))));
        if (owner.current !== token) return;
      }
      const confirmedSession = await manualRequest('/api/staff/session');
      if (owner.current !== token) return;
      if (confirmedSession.staff?.id !== staff.id) throw { code: 'MANUAL_STAFF_CHANGED' };
      const fresh = { ...buildNfcBatch(details), hasMore: Boolean(current.hasMore) };
      setNfcBatch(fresh);
      if (!download || !expected || JSON.stringify(fresh.rows) !== JSON.stringify(expected.rows)) {
        // Preserve deliberate exclusions; a newly arrived card needs selection
        // after the first review instead of silently joining a refreshed batch.
        setNfcSelected(fresh.rows.filter(row => !expected || selectedItems.includes(row.itemId)).map(row => row.itemId));
        if (download) setNfcError(nfcBatchMessage({ code: 'NFC_BATCH_CHANGED' }));
        return;
      }
      const csv = nfcBatchCsv(fresh, selectedItems), link = document.createElement('a');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      try {
        link.href = url; link.download = `atlas-nfc-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
        document.body.appendChild(link); link.click();
      } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setNfcMessage(`CSV download requested for ${selectedItems.length} card${selectedItems.length === 1 ? '' : 's'}. Import it once into GoToTags. Encoding results are shown in GoToTags; ATLAS has not recorded NFC completion.`);
    } catch (failure) {
      if (owner.current === token) { setNfcBatch(null); setNfcSelected([]); setNfcError(nfcBatchMessage(failure) ?? failureText(failure)); }
    } finally {
      if (owner.current === token && nfcRequest.current === requestToken) { nfcRequest.current = null; setNfcBusy(false); }
    }
  };
  const run = async operation => {
    if (mutating.current || !client.current || readOnly) return;
    const token = owner.current; mutating.current = true; setBusy(true); setError(''); setActionError(''); setMessage(''); setDownload(null);
    try {
      const reply = await operation(client.current);
      if (owner.current !== token) return;
      if (reply.kind === 'download' || reply.kind === 'individual-download') {
        setDownload(reply.result);
        // The client has verified this signed URL and saved export profile.
        // Start only this explicit download gesture; preparation and polling
        // never enter this branch. Keep the link available if the browser blocks it.
        const link = document.createElement('a');
        try {
          link.href = reply.result.url; link.download = ''; link.rel = 'noopener noreferrer';
          document.body.appendChild(link); link.click();
          setMessage('Download requested. If it did not start, use the download link below.');
        } finally { link.remove(); }
      }
      else if (reply.kind === 'individual-export') { setItemExports(old => ({ ...old, [`${reply.itemId ?? reply.result.itemId}:${reply.result.exportProfileId}`]: reply.result })); setMessage('Individual export saved.'); }
      else if (reply.kind === 'layout-retry') { setSelectedItemId(reply.result.itemId); setTab('labels'); setMessage('Label preparation is continuing automatically.'); }
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
  useEffect(() => { preparingSelection.current = tab === 'labels' && ['NEEDS_LAYOUT', 'PENDING_RENDER'].includes(currentItem?.state) ? currentItem.itemId : null; }, [tab, currentItem?.itemId, currentItem?.state]);
  const currentSheet = tab === 'sheets' ? sheet : listing?.sheets.find(value => value.sheetId === currentItem?.sheetId) ?? currentItem;
  const profiles = LABEL_PRINT_FORMATS[printFormat];
  const availableFormats = Object.fromEntries(Object.keys(LABEL_PRINT_FORMATS).map(key => [key, tab === 'sheets'
    ? !LABEL_PRINT_FORMATS[key].requiresApprovedB || Boolean(sheet?.items.length) && sheet.items.every(item => labelSupportsPrintFormat(item, key))
    : labelSupportsPrintFormat(currentItem, key)]));
  const formatAvailable = availableFormats[printFormat];
  const individualOutput = itemExports[`${currentItem?.itemId}:${profiles.individual}`] ?? outputFor(currentItem?.exports ?? summaries.find(value => value.itemId === currentItem?.itemId)?.exports, profiles.individual);
  const output = outputFor(sheet?.exports, profiles.sheet), sheetCurrent = sheet && !sheet.containsSuperseded && sheet.items.every(value => value.state === 'READY'), canWrite = !busy && !pending && !readOnly;
  useEffect(() => {
    if (individualOutput?.state !== 'PREPARING' || !currentItem?.itemId) return;
    const token = owner.current, itemId = currentItem.itemId, exportId = individualOutput.exportId;
    const timer = setInterval(() => { if (document.visibilityState === 'hidden') return; void client.current?.readLabelExport(itemId, exportId).then(result => { if (owner.current === token) setItemExports(old => ({ ...old, [`${itemId}:${result.exportProfileId}`]: result })); }).catch(failure => { if (owner.current === token) setError(failureText(failure)); }); }, 3000);
    return () => clearInterval(timer);
  }, [individualOutput?.exportId, individualOutput?.state, currentItem?.itemId]);
  const individualAction = (item, result) => { setSelectedItemId(item.itemId); void run(api => result?.state === 'READY' ? api.downloadLabel(item, result) : api.exportLabel(item, profiles.individual)); };
  const automaticReconciliation = pending?.kind === 'layout-retry' && !readOnly && (layoutReconciliations.current.get(pending.body.requestId) ?? 0) < 3;
  const main = <main className={styles.page} aria-label="ATLAS labels">
    <header className={styles.heading}><div><p className={styles.eyebrow}>FINISHING</p><h1>Labels</h1><p className={styles.intro}>Approved cards, ready for the next sheet.</p></div><div className={styles.automatic}><i/><div><strong>Fills automatically</strong><span>Starts after grade approval</span></div></div></header>
    <section className={styles.printFormat} aria-label="Print file format"><label>Print file<select value={printFormat} disabled={busy || Boolean(dialog)} onChange={event => { if (!availableFormats[event.target.value]) return; setPrintFormat(event.target.value); setDownload(null); setMessage(''); }}>{Object.entries(LABEL_PRINT_FORMATS).map(([key, value]) => <option key={key} value={key} disabled={!availableFormats[key]}>{value.label}</option>)}</select></label><p>{formatAvailable ? profiles.description : 'This saved selection has no artwork for this format. Choose an original front format to view or print it.'}</p></section>
    {(error || actionError) && <div role="alert" className={styles.error}><p>{error || actionError}</p><button type="button" disabled={busy} onClick={() => client.current ? void refresh().catch(failure => setError(failureText(failure))) : setReload(value => value + 1)}>Refresh labels</button>{/session|sign in|account changed/i.test(error || actionError) && <a href={`${STAFF_BASE_PATH}?reauthenticate=1`}>Sign in again</a>}<Link href="/station">Open existing NFC tools ↗</Link></div>}
    {pending && <div className={styles.attention} role="status"><p>{pending.kind === 'layout-retry' ? automaticReconciliation ? 'ATLAS is checking a saved label request automatically.' : 'ATLAS could not confirm a saved label request. Your approved cards are unchanged.' : <>A saved {pending.kind.includes('download') ? 'download' : pending.kind.includes('export') ? 'export' : pending.kind === 'print' ? 'print confirmation' : 'replacement'} request needs to finish.</>}</p>{!automaticReconciliation && <button type="button" className={styles.button} disabled={busy || readOnly} onClick={() => void run(api => api.resume())}>{busy ? 'Checking saved request…' : pending.kind === 'layout-retry' ? 'Check connection again' : 'Retry saved request'}</button>}</div>}
    {message && <p className={styles.message} role="status">{message}</p>}
    {listing && initialCardId && !allItems.some(value => value.cardId === initialCardId) && <p className={styles.attention} role="status">This card’s label is not in the loaded results yet. {listing.hasMore ? 'Load older sheets and labels to check its saved status.' : 'It will appear here when its published label is prepared.'}</p>}
    {download && <div className={styles.download} role="status"><a className={`${styles.button} ${styles.primary}`} href={download.url} download rel="noopener noreferrer">Download {Object.values(LABEL_PRINT_FORMATS).find(format => [format.sheet, format.individual].includes(download.exportProfileId))?.label ?? 'saved'} PNG ↓</a><p>If the download did not start, use this link. It expires {new Date(download.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Request it again if needed.</p></div>}
    {listing && <section className={styles.nfcBatch} aria-labelledby="nfc-batch-title">
      <div className={styles.nfcHeading}><div><h2 id="nfc-batch-title">NFC batch · GoToTags</h2><p>One chip per current approved card, in sheet and position order. Replacement labels are excluded.</p></div><button type="button" className={styles.button} disabled={nfcBusy || readOnly} onClick={() => void prepareNfc()}>{nfcBusy ? 'Checking approved labels…' : nfcBatch ? 'Refresh NFC batch' : 'Prepare NFC batch'}</button></div>
      {nfcError && <p className={styles.error} role="alert">{nfcError}</p>}
      {nfcMessage && <p className={styles.message} role="status">{nfcMessage}</p>}
      {nfcBatch && <>
        <p className={styles.nfcScope}>{nfcBatch.rows.length} current card{nfcBatch.rows.length === 1 ? '' : 's'} on the loaded sheets · {nfcSelected.length} selected. {nfcBatch.hasMore ? 'Older sheets are not included. Load older sheets below, then refresh this batch to include them.' : 'All listed sheets checked.'} Uncheck any card already encoded. After refreshing, select any newly added cards you want to encode.</p>
        {nfcBatch.rows.length > 0 ? <><ol className={styles.nfcRows} aria-label="NFC encoding order">{nfcBatch.rows.map(row => <li key={row.itemId}>
          <label><input type="checkbox" checked={nfcSelected.includes(row.itemId)} disabled={nfcBusy} onChange={event => { setNfcSelected(old => event.target.checked ? [...old, row.itemId] : old.filter(id => id !== row.itemId)); setNfcMessage(''); }}/><span><strong>{row.name}</strong><small>{labelSheetName({ number: row.sheetNumber })} · Position {row.slot} · {row.reportNumber} · v{row.approvalVersion} · Grade {row.grade}</small><small>GoToTags ID: {row.correlationId}</small></span></label>
          <a href={row.reportHref} target="_blank" rel="noopener noreferrer">Approved report ↗</a>
        </li>)}</ol><div className={styles.nfcInstructions}><ol><li>Download the checked cards, then import the CSV into a new GoToTags <strong>Variable Encode NFC Tags</strong> operation.</li><li>Keep this order, enable verification and automatic selection of the next tag. The file requests permanent locking for every chip.</li><li>Place one chip on the reader, wait for GoToTags success, remove it and pair it with the matching card before placing the next chip. Save the GoToTags operation to retain its progress.</li></ol><p>Do not import the same CSV twice or restart completed rows. Downloading does not record encoding, locking or physical printing in ATLAS.</p></div><button type="button" className={`${styles.button} ${styles.primary}`} disabled={nfcBusy || readOnly || !nfcSelected.length} onClick={() => void prepareNfc(true)}>Download NFC batch CSV</button></> : <p className={styles.nfcScope}>No current original labels are ready in these sheets.</p>}
        {nfcBatch.excluded.length > 0 && <details className={styles.nfcExcluded}><summary>{nfcBatch.excluded.length} label{nfcBatch.excluded.length === 1 ? '' : 's'} excluded</summary><ul>{nfcBatch.excluded.map(row => <li key={row.itemId}>{labelSheetName({ number: row.sheetNumber })}, position {row.slot}: {row.name} — {row.reason}</li>)}</ul></details>}
      </>}
    </section>}
    <nav className={styles.tabs} aria-label="Label views"><button type="button" aria-current={tab === 'sheets' ? 'page' : undefined} onClick={() => setTab('sheets')}>Print sheets <span>{listing?.sheets.length ?? '—'}</span></button><button type="button" aria-current={tab === 'labels' ? 'page' : undefined} onClick={() => setTab('labels')}>Individual labels <span>{listing ? allItems.length : '—'}</span></button></nav>
    {loading && !listing ? <div className={styles.empty} role="status">Loading your saved labels…</div> : !listing ? <div className={styles.empty}><h2>Labels are unavailable.</h2><p>Your approved reports remain saved. Refresh to try again.</p></div> : tab === 'sheets' ? listing.sheets.length ? <div className={styles.workspace}>
      <aside className={styles.rail} aria-label="Saved sheets"><div className={styles.caption}><h2>Your sheets</h2><span>{listing.sheets.filter(value => value.state === 'OPEN').length} draft</span></div><div className={styles.sheetList}>{listing.sheets.map(value => <button type="button" key={value.sheetId} className={styles.sheetItem} aria-current={sheetId === value.sheetId ? 'true' : undefined} onClick={() => void selectSheet(value.sheetId)}><span className={styles.sheetTop}><strong>{labelSheetName(value)}</strong><small>{stateName(value.state)}</small></span><span className={styles.sheetCount}>{value.occupied}<small> / 50 labels</small></span><span className={styles.progress}><span style={{ width: `${value.occupied / 50 * 100}%` }}/></span><span className={styles.stock}><i className={`${styles.stockDot} ${stockName(value) === 'Holographic' ? styles.holo : ''}`}/>{stockName(value)}</span></button>)}</div><p className={styles.railFoot}>Up to 50 labels per sheet.<br/>Export at any count.<br/>New sheets open automatically.</p></aside>
      <section className={styles.inspector} aria-label="Sheet positions"><header className={styles.sheetHeading}><div><div className={styles.inlineTitle}><h2>{labelSheetName(listing.sheets.find(value => value.sheetId === sheetId))}</h2>{sheet && <span className={styles.badge}>{stateName(sheet.state)}</span>}</div><p>{sheet ? `${sheet.items.length} labels · ${50 - sheet.items.length} empty positions` : 'Loading saved positions…'}</p></div></header>
        {detailError ? <div role="alert" className={styles.error}><p>{detailError}</p><button type="button" onClick={() => void selectSheet(sheetId)}>Retry sheet</button></div> : !sheet ? <div className={styles.empty} role="status">Loading this sheet…</div> : <><div className={styles.jigStage}><div className={styles.jigTop}><span>{LABEL_JIG_V1.plate.widthMm} × {LABEL_JIG_V1.plate.heightMm} mm</span><span>TOP ↑</span></div><div className={styles.jig} role="group" aria-label="50-position sheet preview">{LABEL_JIG_V1.slots.map(position => {
          const item = sheet.items.find(value => value.slot === position.slot);
          return <button type="button" key={position.slot} className={`${styles.slot} ${item ? styles.filled : styles.emptySlot}`} aria-label={`Position ${position.slot}, row ${position.row}, column ${position.column}${item ? `, ${labelName(item)}, grade ${item.snapshot?.grade ?? 'unavailable'}` : ', empty'}`} aria-pressed={slot === position.slot} onClick={() => setSlot(position.slot)} style={{ left: `${position.xMm / LABEL_JIG_V1.plate.widthMm * 100}%`, top: `${position.yMm / LABEL_JIG_V1.plate.heightMm * 100}%`, width: `${position.widthMm / LABEL_JIG_V1.plate.widthMm * 100}%`, height: `${position.heightMm / LABEL_JIG_V1.plate.heightMm * 100}%` }}><span className={styles.slotNumber}>{position.slot}</span>{item && <span className={styles.slotArtwork} style={{ width: `${LABEL_JIG_V1.blank.widthMm / position.widthMm * 100}%`, height: `${LABEL_JIG_V1.blank.heightMm / position.heightMm * 100}%` }}><ThumbnailArtwork item={item} printFormat={printFormat}/></span>}</button>;
        })}<span className={styles.jigCaption}>ATLAS · 50 POSITION JIG</span></div><div className={styles.legend}><span><i/> Filled</span><span>▯ Empty · stays transparent</span><span>↻ 90° clockwise</span></div></div><div className={styles.positionControls}><button type="button" disabled={slot === 1} aria-label="Previous position" onClick={() => setSlot(value => value - 1)}>←</button><label>Position <select value={slot} onChange={event => setSlot(Number(event.target.value))} aria-label="Select sheet position">{LABEL_JIG_V1.slots.map(position => <option key={position.slot} value={position.slot}>{position.slot} of 50</option>)}</select></label><button type="button" disabled={slot === 50} aria-label="Next position" onClick={() => setSlot(value => value + 1)}>→</button><span>Row {Math.floor((slot - 1) / 10) + 1} · Column {(slot - 1) % 10 + 1}</span></div></>}
      </section>
      <LabelDetail item={currentItem} slot={slot} sheet={sheet} printFormat={printFormat} busy={!canWrite} readOnly={readOnly} onIndividual={individualAction} individualOutput={individualOutput} onReprint={item => setDialog({ kind: 'reprint', item })} ><div className={styles.sheetActions}>{sheet?.containsSuperseded && <p className={styles.attention}>A report approval on this sheet changed. Its saved history is retained; use the current approval’s label before printing.</p>}<p className={styles.actionTitle}>{sheet?.state === 'SEALED' ? 'This sheet is frozen.' : 'Ready when you are.'}</p><p className={styles.actionCopy}>{sheet?.state === 'SEALED' ? 'The saved labels and positions stay fixed. New labels go to the next compatible sheet.' : 'Export a partial sheet now, or let it fill to 50. Export freezes these positions.'}</p><button type="button" className={`${styles.button} ${styles.primary} ${styles.wide}`} disabled={!canWrite || !sheetCurrent || !formatAvailable || !sheet.items.length || output?.state === 'PREPARING'} onClick={() => output?.state === 'READY' ? void run(api => api.downloadSheet(sheet, output)) : setDialog({ kind: 'export', sheet, printFormat })}>{output?.state === 'PREPARING' ? 'Preparing sheet file…' : output?.state === 'READY' ? 'Download sheet PNG ↓' : output?.state === 'FAILED' ? 'Retry sheet export' : 'Export this sheet'}</button>{output?.state === 'FAILED' && <p className={styles.attention}>Export needs attention. The frozen sheet is retained.</p>}<p className={styles.smallCopy}>Diagnostic export · printer origin and material need qualification.</p>{output?.state === 'READY' && <><button type="button" className={`${styles.button} ${styles.wide}`} disabled={!canWrite || !sheetCurrent} onClick={() => setDialog({ kind: 'print', sheet, output })}>Record printed labels</button><p className={styles.smallCopy}>{sheet.printEvents?.length ? `${sheet.printEvents.length} saved physical print confirmation${sheet.printEvents.length === 1 ? '' : 's'}` : 'Physical printing has not been recorded.'}</p></>}<Mapping output={output}/></div></LabelDetail>
    </div> : <div className={styles.empty}><span aria-hidden="true">▦</span><h2>Your first sheet starts here.</h2><p>Published labels appear automatically when their artwork is ready. {pendingItems.length > 0 ? `${pendingItems.length} label${pendingItems.length === 1 ? ' is' : 's are'} preparing or need attention.` : 'No labels are ready yet.'}</p>{pendingItems.length > 0 && <button type="button" className={styles.button} onClick={() => setTab('labels')}>View individual labels</button>}</div> : <><div className={styles.labelToolbar}><label className={styles.search}><span>Search labels</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or report number"/></label><label className={styles.filter}>Show <select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All labels</option><option value="OPEN">On draft sheets</option><option value="SEALED">On frozen sheets</option><option value="waiting">Preparing / attention</option></select></label></div><div className={styles.individualWorkspace}><section className={styles.individualList} aria-label="Individual labels">{individualItems.map(item => <button type="button" key={item.itemId} className={styles.labelRow} aria-pressed={currentItem?.itemId === item.itemId} onClick={() => setSelectedItemId(item.itemId)}><span className={styles.rowArtwork}>{item.state === 'READY' ? <ThumbnailArtwork item={item} printFormat={printFormat}/> : itemStateName(item)}</span><span><strong>{labelName(item)}</strong><small>{describe(item)}</small><small>{item.snapshot?.reportNumber}{item.snapshot?.approvalVersion != null ? ` · v${item.snapshot.approvalVersion}` : ''}</small></span><span className={styles.rowLocation}>{item.slot ? <>{labelSheetName(listing.sheets.find(value => value.sheetId === item.sheetId))}<strong>Position {item.slot}</strong></> : itemStateName(item)}</span></button>)}{!individualItems.length && <div className={styles.empty}><h2>{search ? 'No matching labels.' : 'No labels in this view.'}</h2><p>{search ? 'Try another name or report number.' : 'Ready labels and any preparation issues appear here.'}</p></div>}</section><LabelDetail item={currentItem} slot={currentItem?.slot} sheet={currentSheet} printFormat={printFormat} busy={!canWrite} readOnly={readOnly} individualOutput={individualOutput} onIndividual={individualAction} onReprint={item => setDialog({ kind: 'reprint', item })} /></div></>}
    {listing?.hasMore && <p className={styles.attention}>Showing {allItems.length} saved labels. <button type="button" className={styles.button} disabled={paging} onClick={() => void loadMore()}>{paging ? 'Loading older labels…' : 'Load older sheets & labels'}</button></p>}
    <footer className={styles.footer}><span>Saved label artwork · Front / Back · Gold / Holographic stock</span><span>Export and physical printing are recorded separately.</span></footer>
    {dialog && <ActionDialog key={`${dialog.kind}:${dialog.item?.itemId ?? sheetId}`} {...dialog} sheet={dialog.sheet ?? sheet} busy={busy} onClose={() => setDialog(null)} onSubmit={({ slots, reason }) => void run(api => dialog.kind === 'export' ? api.exportSheet(dialog.sheet, LABEL_PRINT_FORMATS[dialog.printFormat].sheet) : dialog.kind === 'print' ? api.recordPrint(dialog.sheet, dialog.output, slots) : api.reprint(dialog.item, reason))}/>}
  </main>;
  return embedded ? main : <Shell staff={staff} manual title="Labels">{main}</Shell>;
}
