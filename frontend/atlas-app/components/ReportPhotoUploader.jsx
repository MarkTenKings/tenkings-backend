import React, { useEffect, useRef, useState } from 'react';
import { manualRequest, manualMessage } from '../lib/manual-client.mjs';
import { createReportPhotoClient } from '../lib/report-photo-client.mjs';
import styles from './ReportPhotoUploader.module.css';

const messages = {
  PRESENTATION_SAVED_FILE_REQUIRED: 'Choose the same photo to resume its saved upload.',
  PRESENTATION_SAVED_FILE_MISMATCH: 'That is a different photo. Choose the original file for this saved upload.',
  PRESENTATION_PHOTO_TOO_LARGE: 'Choose a photo smaller than 64 MiB.',
  PRESENTATION_REQUEST_PENDING: 'Resume the saved photo before choosing another.',
  PRESENTATION_PENDING_INVALID: 'The saved upload cannot be read on this browser. Reload to check the published photo.',
  PRESENTATION_PENDING_CONFLICT: 'Another upload is saved for this card. Reload to check it.',
};

/** Mount only for a published human approval. Does not grant approval or alter evidence. */
export default function ReportPhotoUploader({ cardId, staffId, csrf, disabled = false, available = true, onChange }) {
  const client = useRef(null), generation = useRef(0), lock = useRef(false), retainedFile = useRef(null), changed = useRef(onChange);
  changed.current = onChange;
  const [current, setCurrent] = useState(null), [pending, setPending] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    const ownedGeneration = generation;
    const version = ++generation.current; client.current = null; lock.current = false; retainedFile.current = null;
    setCurrent(null); setPending(null); setError(''); setBusy('');
    if (!available) return;
    let owner;
    Promise.resolve().then(() => {
      owner = createReportPhotoClient({ cardId, staffId, storage: window.sessionStorage,
        request: (path, options = {}) => manualRequest(path, { ...options, csrf }) });
      if (generation.current !== version) return null;
      client.current = owner; return owner.read();
    }).then(value => { if (value && generation.current === version) { setCurrent(value); setPending(owner.pending()); } })
      .catch(failure => { if (generation.current === version) setError(messages[failure?.code] ?? manualMessage(failure)); });
    return () => { if (ownedGeneration.current === version) ownedGeneration.current++; if (client.current === owner) client.current = null; };
  }, [cardId, staffId, csrf, available]);
  async function perform(operation, label) {
    const owner = client.current, version = generation.current;
    if (!owner || lock.current || disabled) return;
    lock.current = true; setBusy(label); setError('');
    try {
      const value = await operation(owner);
      if (version === generation.current) { setCurrent(value); retainedFile.current = null; changed.current?.(value); }
    } catch (failure) {
      if (version === generation.current) setError(messages[failure?.code] ?? manualMessage(failure));
      if (failure?.status === 409) { try { const fresh = await owner.read(); if (version === generation.current) setCurrent(fresh); } catch { /* Keep the original saved request and error. */ } }
    }
    finally { if (version === generation.current) { lock.current = false; setBusy(''); try { setPending(owner.pending()); } catch { setError(messages.PRESENTATION_PENDING_INVALID); } } }
  }
  if (!available) return null;
  const photo = current?.presentation?.slabPhoto;
  return <section className={styles.panel} aria-label="Optional graded card photo"><div><p className={styles.eyebrow}>REPORT PRESENTATION · OPTIONAL</p><h3>Show the finished card.</h3><p>Add the real slab photo to the top of this approved report.</p></div>
    {photo && <div className={styles.photo}><img src={photo.url} alt={photo.alt}/><span>Published photo</span></div>}
    <div className={styles.actions}>
      <label className={styles.choose}>{pending ? 'Choose saved photo' : photo ? 'Replace photo' : 'Add slab photo'}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.HEIC,.heif,.HEIF"
        aria-label={pending ? 'Choose the same graded card photo to resume' : 'Choose optional graded card photo'} disabled={disabled || Boolean(busy) || !current || pending?.kind === 'remove'}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file || lock.current) return; retainedFile.current = file;
          void perform(owner => pending ? owner.resume(file) : owner.upload(file, current, 'Photograph of this graded card in its slab'), 'Saving photo…'); }}/></label>
      {pending && <button type="button" disabled={disabled || Boolean(busy)} onClick={() => void perform(owner => owner.resume(retainedFile.current), 'Checking saved photo…')}>Resume saved {pending.kind === 'remove' ? 'change' : 'upload'}</button>}
      {pending && current && (pending.input.approvalActionId !== current.approvalActionId || current.revision > pending.input.expectedRevision) && <button type="button" disabled={disabled || Boolean(busy)} onClick={() => void perform(owner => owner.reconcileSuperseded(), 'Checking current report…')}>Use current report</button>}
      {photo && !pending && <button type="button" disabled={disabled || Boolean(busy)} onClick={() => void perform(owner => owner.remove(current), 'Removing presentation photo…')}>Remove photo</button>}
      {!current && error && <button type="button" disabled={disabled || Boolean(busy)} onClick={() => void perform(owner => owner.read(), 'Checking photo status…')}>Check photo status</button>}
    </div>
    {busy && <p role="status">{busy}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
