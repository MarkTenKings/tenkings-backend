import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/client';
import { archiveAccessFailure } from '../lib/graded-cards-client.mjs';
import { createSavedArchiveFilters, savedArchiveFiltersMessage } from '../lib/graded-cards-saved-filters.mjs';
import styles from './GradedCardsSavedFilters.module.css';

export default function GradedCardsSavedFilters({ staff, filters, view, inputVersion, enabled, onApply, onAccessLost, request = api }) {
  const scope = `${staff.id}:${staff.role}:${staff.mode}`;
  const [saved, setSaved] = useState(null), [form, setForm] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const live = useRef(null), active = useRef(null), store = useRef(null), mounted = useRef(false), reload = useRef(null);
  live.current = { scope, enabled, filters, view, inputVersion, onApply, onAccessLost };
  const visible = enabled && saved?.scope === scope;
  const presets = visible ? saved.presets : [], name = enabled && form?.scope === scope ? form.name : '', selected = visible && form?.scope === scope ? form.selected : '';
  const ready = visible && !busy;
  function cancel() { active.current?.abort(); active.current = null; }
  function begin() { cancel(); const operation = new AbortController(); active.current = operation; setBusy(true); setError(''); return operation; }
  const current = operation => mounted.current && active.current === operation && !operation.signal.aborted
    && live.current.scope === scope && live.current.enabled;
  const unchanged = snapshot => !snapshot || (snapshot.filters === live.current.filters && snapshot.view === live.current.view
    && (!Object.hasOwn(snapshot, 'inputVersion') || snapshot.inputVersion === live.current.inputVersion));
  async function authorize(operation, snapshot = null) {
    const session = await request('session', { signal: operation.signal });
    if (!current(operation) || !unchanged(snapshot))
      throw Object.assign(new Error('Canceled'), { code: 'SAVED_FILTER_CANCELED' });
    if (session.staff?.id !== staff.id || session.staff?.role !== staff.role || session.staff?.mode !== staff.mode)
      throw Object.assign(new Error('Staff changed'), { code: 'SAVED_FILTER_ACCESS_ENDED' });
    return () => current(operation) && unchanged(snapshot);
  }
  function failed(operation, failure) {
    if (!current(operation) || failure?.code === 'SAVED_FILTER_CANCELED') return;
    if (archiveAccessFailure(failure) || failure?.code === 'SAVED_FILTER_ACCESS_ENDED') {
      setSaved(null); setForm(null); live.current.onAccessLost?.();
    }
    setError(savedArchiveFiltersMessage(failure));
  }
  function finish(operation) { if (active.current === operation) { active.current = null; if (mounted.current) setBusy(false); } }
  async function load() {
    if (!live.current.enabled || staff.role !== 'REVIEWER') return;
    const operation = begin(); setSaved(null);
    try {
      const stillCurrent = await authorize(operation); if (!stillCurrent()) return;
      const next = createSavedArchiveFilters({ staff, storage: window.localStorage, locks: window.navigator?.locks });
      const rows = next.read(); store.current = next; setSaved({ scope, presets: rows });
      setForm(previous => ({ scope, name: previous?.scope === scope ? previous.name : '', selected: rows.some(row => row.id === previous?.selected) ? previous.selected : '' }));
    } catch (failure) { failed(operation, failure); }
    finally { finish(operation); }
  }
  reload.current = load;
  useEffect(() => {
    mounted.current = true; store.current = null; setSaved(null); setForm(null); setError(''); setBusy(false);
    if (enabled) void reload.current();
    const hide = () => { cancel(); setSaved(null); setForm(null); setBusy(false); setError(''); };
    const show = () => { if (document.visibilityState !== 'hidden') void reload.current(); };
    const visibility = () => { if (document.visibilityState === 'hidden') hide(); else show(); };
    const changed = event => { if (event.key === null || event.key === store.current?.key) { hide(); show(); } };
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show); window.addEventListener('storage', changed);
    window.addEventListener('atlas:verified-image-access-ended', hide); document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false; cancel(); store.current = null;
      window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); window.removeEventListener('storage', changed);
      window.removeEventListener('atlas:verified-image-access-ended', hide); document.removeEventListener('visibilitychange', visibility);
    };
  }, [scope, enabled]);
  async function act(kind) {
    if (!ready || !store.current) return;
    const operation = begin(), snapshot = { filters, view }, storage = store.current;
    try {
      if (kind === 'save') {
        const rows = await storage.create({ name, ...snapshot }, () => authorize(operation, snapshot));
        if (current(operation)) { setSaved({ scope, presets: rows }); setForm({ scope, name: '', selected: rows.at(-1).id }); }
      } else if (kind === 'delete') {
        const rows = await storage.remove(selected, () => authorize(operation));
        if (current(operation)) { setSaved({ scope, presets: rows }); setForm({ scope, name, selected: '' }); }
      } else {
        const stillCurrent = await authorize(operation, { ...snapshot, inputVersion }); if (!stillCurrent()) return;
        // A second tab may have removed this entry since the menu was loaded.
        const row = storage.read().find(item => item.id === selected);
        if (!row) throw Object.assign(new Error('Changed'), { code: 'SAVED_FILTER_CHANGED' });
        live.current.onApply(row.filters, row.view);
      }
    } catch (failure) { failed(operation, failure); }
    finally { finish(operation); }
  }
  if (staff.role !== 'REVIEWER') return null;
  return <section className={styles.saved} aria-label="Saved archive filters">
    <div className={styles.heading}><h2>Saved filters</h2><p>Saved in this browser for this staff account, not synced. Avoid customer details on shared devices.</p></div>
    <div className={styles.controls}>
      <label>Filter name<input value={name} maxLength={48} disabled={!ready} onChange={event => setForm({ scope, name: event.target.value, selected })}/></label>
      <button type="button" disabled={!ready || !name.trim()} onClick={() => void act('save')}>Save applied filters</button>
      <label>Saved filter<select value={selected} disabled={!ready || !presets.length} onChange={event => setForm({ scope, name, selected: event.target.value })}><option value="">Choose a saved filter</option>{presets.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <button type="button" disabled={!ready || !selected} onClick={() => void act('apply')}>Apply saved filter</button>
      <button type="button" disabled={!ready || !selected} onClick={() => void act('delete')}>Delete saved filter</button>
    </div>
    {busy && <p role="status">Checking saved filters…</p>}
    {error && <p role="alert">{error} <button type="button" disabled={busy || !enabled} onClick={() => void load()}>Reload saved filters</button></p>}
  </section>;
}
