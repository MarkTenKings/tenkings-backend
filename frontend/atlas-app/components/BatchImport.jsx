import React, { useEffect, useRef, useState } from 'react';
import { createBrowserIntakeJournal, createIntakeClient } from '@atlas/manual-intake/client';
import { createBatchImporter, createBrowserBatchImportJournal } from '../lib/batch-import.mjs';
import { manualRequest, manualMessage } from '../lib/manual-client.mjs';
import styles from './BatchGrading.module.css';

const copy = {
  BATCH_IMPORT_COUNT: 'Choose Front and Back photos for up to 50 cards.',
  BATCH_IMPORT_PAIR_NAMES: 'Name each pair card-name_front.jpg and card-name_back.jpg. Original HEIC, JPEG, PNG and WebP files are supported.',
  BATCH_IMPORT_MISSING_SIDE: 'Each card needs a matching Front and Back file.',
  BATCH_IMPORT_DUPLICATE_SIDE: 'Two files claim the same side. Give every physical card its own name.',
  BATCH_IMPORT_PENDING: 'Resume the saved import first.', BATCH_IMPORT_BUSY: 'This import is already open in another tab.',
  BATCH_IMPORT_STORAGE: 'The browser could not save these originals. Try a smaller batch.',
};
export default function BatchImport({ staff, onImported, enabled }) {
  const importer = useRef(null), [batch, setBatch] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false), notify = useRef(onImported); notify.current = onImported;
  useEffect(() => {
    let stopped = false, batchJournal, intakeJournal, owner;
    (async () => {
      const session = await manualRequest('/api/staff/session');
      if (stopped) return;
      if (session.staff?.id !== staff.id) throw { code: 'MANUAL_STAFF_CHANGED' };
      const request = (path, options = {}) => manualRequest(path, { ...options, csrf: session.csrf });
      batchJournal = createBrowserBatchImportJournal({ staffId: staff.id });
      intakeJournal = createBrowserIntakeJournal({ staffId: staff.id });
      owner = createBatchImporter({ request, intake: createIntakeClient({ request, journal: intakeJournal }), journal: batchJournal,
        onProgress: value => { if (!stopped) setBatch(value); } });
      importer.current = owner;
      const saved = await owner.read(); if (!stopped) { setBatch(saved); setReady(true); }
    })().catch(failure => { if (!stopped) setError(copy[failure.code] ?? manualMessage(failure)); });
    return () => { stopped = true; const drained=owner?.dispose(); if (importer.current === owner) importer.current = null;
      // Pending effects retain their durable journals. Closing IndexedDB while
      // they settle would turn cleanup into an interrupted-save failure.
      void Promise.resolve(drained).then(()=>Promise.all([batchJournal?.close(),intakeJournal?.close()]));
    };
  }, [staff.id]);
  async function act(work) {
    if (busy || !importer.current) return;
    setBusy(true); setError('');
    try {
      if (!navigator.locks) throw { code: 'BATCH_IMPORT_BUSY' };
      await navigator.locks.request(`atlas-batch-import:${staff.id}`, { ifAvailable: true }, async lock => {
        if (!lock) throw { code: 'BATCH_IMPORT_BUSY' }; await work(importer.current);
      });
    } catch (failure) { setError(copy[failure.code] ?? manualMessage(failure)); }
    finally { setBusy(false); }
  }
  const done = batch?.items.filter(item => item.done).length ?? 0, total = batch?.items.length ?? 0;
  return <section className={styles.importer} aria-label="Import photo pairs">
    <div className={styles.importHeading}><div><h2>Drop in a whole batch.</h2><p>Match filenames: <code>card-01_front</code> + <code>card-01_back</code></p></div>
      <label className={styles.fileButton}>Choose photos<input type="file" multiple accept="image/*,.heic,.heif" disabled={!ready || busy || total > done} onChange={event => { const files = [...event.target.files]; event.target.value = ''; if (files.length) void act(owner => owner.stage(files)); }}/></label>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {batch && <><div className={styles.pairRoster}>{batch.items.map(item => <div key={item.createId}><span>{item.done ? '✓' : item.code ? '!' : '·'}</span><strong>{item.label}</strong><small>{item.done ? 'Queued' : item.code ? 'Resume saved photos' : 'Front + Back'}</small></div>)}</div>
      <div className={styles.intakeBar}><span aria-live="polite">{done} / {total} queued</span><div>{!batch.items.some(item => item.started) && <button disabled={busy} onClick={() => void act(owner => owner.clearSelection())}>Clear selection</button>}{done < total && <button className={styles.primary} disabled={busy || !enabled} onClick={() => void act(async owner => { await owner.run(); await notify.current?.(); })}>{busy ? 'Uploading originals…' : batch.items.some(item => item.started) ? 'Resume import' : `Upload ${total} card pairs`}</button>}</div></div></>}
  </section>;
}
