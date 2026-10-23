import { useEffect, useRef, useState } from 'react';
import { createStaffCompCurationController } from '../lib/staff-comp-curation-controller.mjs';
import { curationStaff } from '../lib/staff-comp-curation-client.mjs';
import { compCurationCard, assertCompCurationBinding, createSavedCompEntryReader } from '../lib/staff-comp-curation-entry.mjs';
import styles from './StaffCompCuration.module.css';

const reasons = {
  IDENTITY_NOT_CONFIRMED: 'Card identity is not confirmed.', MATCH_EVIDENCE_UNRESOLVED: 'Match evidence is incomplete.',
  MULTI_CARD_OR_REPRODUCTION: 'Multiple cards or a reproduction.', LISTING_SOURCE_UNAVAILABLE: 'Original listing is unavailable.',
  ACCEPTED_OFFER_UNDISCLOSED: 'The accepted offer amount was not disclosed.', SOLD_AMOUNT_UNAVAILABLE: 'Sold amount is unavailable.',
  CURRENCY_UNAVAILABLE: 'Currency is not recorded.', SALE_DATE_UNAVAILABLE: 'Sale date is not recorded.',
  SALE_DATE_IN_FUTURE: 'Recorded sale date is in the future.', SALE_OUTSIDE_RECENCY_WINDOW: 'Sale is outside the review window.',
  GRADE_EVIDENCE_UNRESOLVED: 'Grade evidence is incomplete.', GRADE_DESIGNATION_UNCONFIRMED: 'Grade designation is not confirmed.',
  DUPLICATE_LISTING: 'This sale is already represented in the pool.',
};
const outcomeText = { SELECTED: 'Private selection saved', SKIP: 'Skipped for now', NO_SUITABLE_COMPS: 'No suitable comps recorded' };
const empty = phase => ({ phase, state: null, receipt: null, pending: null });
function signature(staff, card) {
  try { return JSON.stringify({ staff: curationStaff(staff), card: compCurationCard(card) }); } catch { return null; }
}
function money(row) {
  if (row.priceMinor === null || row.currency === null) return 'Amount unavailable';
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: row.currency });
  return formatter.format(row.priceMinor / 10 ** formatter.resolvedOptions().maximumFractionDigits);
}

/** Inactive by default. The host supplies an authorized Card History snapshot
 * and an explicitly configured same-origin Response transport (cookies/CSRF).
 * No route, fetch fallback, acquisition, report edit or asking-price writer.
 * Host access loss must set accessState=ENDED immediately, before logout I/O. */
export default function StaffCompCuration({ staff, card, enabled = false, accessState = 'READY', request, onAccessLost,
  refreshToken = 0, onPendingChange }) {
  const [view, setView] = useState(null), [draft, setDraft] = useState(null), [reload, setReload] = useState(0);
  const live = useRef(null), owner = useRef(null), closed = useRef(null);
  const key = signature(staff, card);
  live.current = { staff, card, key, request, enabled, accessState, onAccessLost, reload, refreshToken, onPendingChange };
  useEffect(() => {
    const context = { staff, card, key, request, reload, refreshToken: live.current.refreshToken,
      abort: new AbortController(), cancelled: false, control: null, selectedIds: [], page: 0, blocked: false };
    owner.current = context;
    const current = () => {
      const now = live.current;
      return !context.cancelled && owner.current === context && now.staff === staff && now.card === card && now.request === request
        && now.reload === reload && now.enabled && now.accessState === 'READY' && closed.current !== staff
        && key !== null && now.key === key && signature(staff, card) === key;
    };
    context.current = current;
    context.block = value => {
      if (!current() || context.blocked === value) return;
      context.blocked = value; live.current.onPendingChange?.(value);
    };
    context.publish = value => {
      if (!current()) return;
      if (value.phase === 'CONFIRMED') { context.selectedIds = []; setDraft(null); }
      context.block(Boolean(context.selectedIds.length || value.pending || ['LOADING', 'SAVING', 'RECONCILING'].includes(value.phase)));
      setView({ context, ...value });
    };
    context.stop = () => { if (context.cancelled) return; context.block(false); context.cancelled = true; context.abort.abort(); context.control?.dispose(); };
    const endAccess = () => {
      if (!current()) return;
      closed.current = staff; context.stop(); setDraft(null); setView({ context, ...empty('ENDED') }); live.current.onAccessLost?.();
    };
    context.endAccess = endAccess;
    const pagehide = () => { if (current()) { closed.current = staff; context.stop(); setDraft(null); setView({ context, ...empty('ENDED') }); } };
    window.addEventListener('pagehide', pagehide);
    if (accessState !== 'READY') closed.current = staff;
    if (enabled && typeof request === 'function' && key && current()) {
      setDraft(null); context.publish(empty('LOADING'));
      const binding = compCurationCard(card), actor = curationStaff(staff);
      void createSavedCompEntryReader({ request })({ staff, card, signal: context.abort.signal }).then(entry => {
        if (!current()) { context.stop(); return; }
        if (!entry.input) { context.publish(empty('POOL_NOT_READY')); return; }
        context.control = createStaffCompCurationController({ staff, cardId: binding.cardId, input: entry.input, request,
          onAccessLost: endAccess,
          onChange(value) {
            if (!current()) { context.stop(); return; }
            try {
              if (value.state) assertCompCurationBinding(value.state, binding, actor.mode);
              if (value.receipt) assertCompCurationBinding(value.receipt, binding, actor.mode);
              context.publish(value);
            } catch { context.stop(); setDraft(null); setView({ context, ...empty('CHANGED') }); }
          },
        });
        return context.control.load();
      }).catch(error => {
        if (!current()) return;
        if (error.code === 'COMP_ACCESS_ENDED') endAccess();
        else context.publish(empty(error.code === 'COMP_ENTRY_CHANGED' ? 'CHANGED' : 'UNAVAILABLE'));
      });
    }
    return () => { window.removeEventListener('pagehide', pagehide); context.stop(); };
  }, [staff, card, key, request, enabled, accessState, reload]);

  // A newly saved search pool must not replace an unsaved choice or the
  // original request used to reconcile an uncertain save.
  useEffect(() => {
    const context = owner.current;
    if (!context?.current() || context.refreshToken === refreshToken || context.blocked || context.control?.snapshot().pending) return;
    context.refreshToken = refreshToken; setReload(value => value + 1);
  }, [refreshToken, view, draft]);

  const context = view?.context;
  const ended = accessState !== 'READY' || closed.current === staff;
  const configured = enabled && typeof request === 'function';
  // Render fence precedes effects. Old DOM handlers independently check the
  // same captured context before delegating to the existing controller.
  const visible = configured && !ended && key && context?.current();
  const phase = !configured ? 'DISABLED' : ended ? 'ENDED' : !key ? 'CHANGED' : visible ? view.phase
    : context === owner.current && view?.phase === 'CHANGED' ? 'CHANGED' : 'LOADING';
  const state = visible ? view.state : null, receipt = visible ? view.receipt : null;
  const rows = state?.preview?.candidates ?? [];
  const selectedIds = draft && draft.context === context ? draft.selectedIds : [];
  const page = draft && draft.context === context ? draft.page : 0, pages = Math.max(1, Math.ceil(rows.length / 20));
  const selected = rows.filter(row => selectedIds.includes(row.id)), first = selected[0];
  function act(work) {
    if (!context?.current() || context.control && !context.control.assertScope(staff)) { context?.stop(); return; }
    const failed = () => {
      if (context.current()) context.publish({ ...context.control?.snapshot(), error: 'COMP_ACTION_UNAVAILABLE' });
    };
    // Run admission synchronously so another retained button handler cannot
    // start a search between the click and React's next render.
    try { void Promise.resolve(work()).catch(failed); } catch { failed(); }
  }
  function toggle(row) {
    act(() => {
      if (context.control.snapshot().phase !== 'READY' || !row.eligible) return;
      const ids = context.selectedIds, prior = rows.find(candidate => ids.includes(candidate.id));
      if (!ids.includes(row.id) && (ids.length >= 5 || prior && (prior.group !== row.group || prior.currency !== row.currency))) return;
      context.selectedIds = ids.includes(row.id) ? ids.filter(id => id !== row.id) : [...ids, row.id];
      context.block(context.selectedIds.length > 0);
      setDraft({ context, page: context.page, selectedIds: context.selectedIds });
    });
  }
  function movePage(direction) { act(() => {
    context.page = Math.max(0, Math.min(pages - 1, context.page + direction));
    setDraft({ context, page: context.page, selectedIds: context.selectedIds });
  }); }
  function decide(outcome) { act(() => context.control.decide({ requestId: crypto.randomUUID(), outcome,
    selectedIds: outcome === 'SELECTED' ? context.selectedIds : [], reviewedIds: outcome === 'SELECTED' ? context.selectedIds : [] })); }
  const refresh = () => act(() => { if (!context.blocked && !context.control?.snapshot().pending) setReload(value => value + 1); });
  const busy = ['LOADING', 'SAVING', 'RECONCILING'].includes(phase);
  return <section className={styles.panel} aria-label="Private comp selection">
    <header className={styles.header}><div><p className={styles.eyebrow}>Optional · Staff only</p><h3>Private comp selection</h3></div><span className={styles.badge}>Local proposal</span></header>
    <p className={styles.intro}>Review up to five saved sold listings. This private decision leaves the published report and grade unchanged. The seller sets the asking price.</p>
    {phase === 'DISABLED' ? <p className={styles.notice}>Private comp selection is not enabled for this workspace.</p>
      : phase === 'ENDED' ? <p className={styles.notice} role="status">Access ended. Sign in again to review saved evidence.</p>
      : <>
        <p className={styles.guidance}>Price guidance is unavailable while data rights and the pricing policy await approval. Recorded sale amounts below are evidence, not an asking price.</p>
        {busy && <p className={styles.notice} role="status">{phase === 'SAVING' ? 'Saving the private decision…' : phase === 'RECONCILING' ? 'Checking the exact saved decision…' : 'Reading saved evidence…'}</p>}
        {phase === 'POOL_NOT_READY' && <div className={styles.notice}><p>The saved pool is not ready. No search has been started.</p><button onClick={refresh}>Check saved evidence</button></div>}
        {['UNAVAILABLE', 'CHANGED'].includes(phase) && <div className={styles.notice} role="status"><p>{phase === 'CHANGED' ? 'The approval or evidence context could not be verified. Refresh the Card Detail before continuing.' : 'Saved evidence could not be read. No empty result is assumed.'}</p>{phase === 'UNAVAILABLE' && <button onClick={refresh}>Retry saved evidence</button>}</div>}
        {(phase === 'UNRESOLVED' || busy && visible && view.pending) && <div className={styles.notice} role="status"><strong>Save outcome not confirmed</strong><p>A lost response does not establish whether the decision was saved. Keep this view open to check or retry the same request.</p>
          <div className={styles.actions}><button disabled={busy} onClick={() => act(() => context.control.reconcile())}>Check recorded decision</button><button disabled={busy} onClick={() => act(() => context.control.retry())}>Retry this same save</button></div>
        </div>}
        {phase === 'READY' && <>
          {state.selection && <p className={styles.notice}>Previously recorded: {outcomeText[state.selection.outcome].toLowerCase()} · revision {state.selection.revision}. Choose deliberately to record a new decision.</p>}
          {state.availability === 'NO_SAVED_POOL' ? <p className={styles.notice}>No saved pool is available for this approval. You can skip or record that no suitable comps are available.</p>
            : state.availability === 'POLICY_REQUIRED' ? <p className={styles.notice}>Comp review policy is unavailable. You can skip or record no suitable comps; sales cannot be selected.</p>
            : <>
              <div className={styles.summary}><strong>{selectedIds.length} of 5 selected</strong><span>Keep one grade group and currency per decision.</span></div>
              <p className={styles.small}>Saved evidence observed {state.preview.source.observedAt.slice(0, 10)}. {state.policy.recencyDays === null
                ? 'Recorded sale dates are shown below; no age cutoff is applied to this private evidence.'
                : `Review window: ${state.policy.recencyDays} days, evaluated ${state.preview.policy.asOf.slice(0, 10)}.`}</p>
              {rows.length === 0 && <p className={styles.notice}>The saved pool contains no listings.</p>}
              <ol className={styles.sales} start={page * 20 + 1}>{rows.slice(page * 20, page * 20 + 20).map((row, index) => {
                const checked = selectedIds.includes(row.id), incompatible = first && (first.group !== row.group || first.currency !== row.currency);
                const disabled = !row.eligible || !checked && (selectedIds.length >= 5 || incompatible);
                const help = `comp-${card.cardId}-${page * 20 + index}`;
                return <li key={row.id} className={`${styles.sale} ${checked ? styles.selected : ''}`}>
                  <div className={styles.saleTop}><strong>{row.title}</strong><span className={styles.amount}>{money(row)}</span></div>
                  <p className={styles.small}>{row.group} · {row.soldAt ? `Sold ${row.soldAt.slice(0, 10)}` : 'Sale date unavailable'}</p>
                  <div className={styles.rowActions}><label className={styles.check}><input type="checkbox" checked={checked} disabled={Boolean(disabled)} aria-describedby={help} onChange={() => toggle(row)}/>Use this reviewed sale</label>{row.listingUrl && <a href={row.listingUrl} target="_blank" rel="noreferrer noopener">View listing<span className={styles.srOnly}>: {row.title}</span></a>}</div>
                  <p id={help} className={styles.reason}>{row.reasonCodes.map(reason => reasons[reason]).join(' ') || (incompatible ? 'Choose the same grade group and currency as your selection.' : !checked && selectedIds.length >= 5 ? 'Five sales selected. Remove one to choose this sale.' : 'Review the listing before selecting it.')}</p>
                </li>;
              })}</ol>
              {pages > 1 && <nav className={styles.pagination} aria-label="Saved sale pages"><button disabled={page === 0} onClick={() => movePage(-1)}>Previous sales</button><span>Page {page + 1} of {pages}</span><button disabled={page + 1 >= pages} onClick={() => movePage(1)}>Next sales</button></nav>}
            </>}
          <div className={styles.actions}><button className={styles.primary} disabled={selectedIds.length === 0 || state.availability !== 'READY'} onClick={() => decide('SELECTED')}>Save private selection</button><button onClick={() => decide('SKIP')}>Skip for now</button><button onClick={() => decide('NO_SUITABLE_COMPS')}>No suitable comps</button></div>
        </>}
        {phase === 'CONFIRMED' && receipt && <div className={styles.confirmed} role="status"><strong>{outcomeText[receipt.outcome]}</strong><p>Revision {receipt.revision} · {receipt.selected.length} sale{receipt.selected.length === 1 ? '' : 's'} selected. Published report comps are unchanged.</p>{receipt.selected.length > 0 && <ul>{receipt.selected.map(row => <li key={row.id}>{row.title} · {money(row)}</li>)}</ul>}<button onClick={refresh}>Review saved evidence</button></div>}
        {visible && view.error === 'COMP_ACTION_UNAVAILABLE' && <p className={styles.notice} role="alert">This action could not be started. Review the current state before continuing.</p>}
      </>}
  </section>;
}
