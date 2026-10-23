import { useEffect, useRef, useState } from 'react';
import { createStaffCompSearchController } from '../lib/staff-comp-search-controller.mjs';
import { compCurationCard } from '../lib/staff-comp-curation-entry.mjs';
import { curationStaff } from '../lib/staff-comp-curation-client.mjs';
import styles from './StaffCompSearch.module.css';

const signature = (staff, card) => { try { return JSON.stringify([curationStaff(staff), compCurationCard(card)]); } catch { return null; } };
export default function StaffCompSearch({ staff, card, request, enabled = false, accessState = 'READY', isSelectionPending, onReady, onAccessLost }) {
  const [view, setView] = useState(null), latest = useRef(null), owner = useRef(null), ended = useRef(false);
  const key = signature(staff, card);
  latest.current = { staff, card, request, enabled, accessState, key, isSelectionPending, onReady, onAccessLost };
  useEffect(() => {
    const context = { closed: false, control: null, timer: null, polls: 0 }; owner.current = context;
    const current = () => !context.closed && !ended.current && owner.current === context && latest.current.enabled === true
      && latest.current.accessState === 'READY' && latest.current.staff === staff && latest.current.card === card
      && latest.current.request === request && latest.current.key === key && signature(staff, card) === key;
    context.current = current;
    const close = () => { context.closed = true; clearTimeout(context.timer); context.control?.close(); };
    const end = () => { if (!current()) return; ended.current = true; close(); setView(null); latest.current.onAccessLost?.(); };
    const hide = () => { ended.current = true; close(); setView(null); };
    window.addEventListener('pagehide', hide);
    if (enabled && request && key && current()) {
      context.control = createStaffCompSearchController({ staff, card, request, storage: window.sessionStorage, isCurrent: current,
        canSearch: () => current() && typeof latest.current.isSelectionPending === 'function' && !latest.current.isSelectionPending(),
        onAccessLost: end, onReady: value => { if (current()) latest.current.onReady?.(value); },
        onChange(value) {
          if (!current()) return; setView({ context, ...value }); clearTimeout(context.timer);
          if (value.phase === 'READY' && ['QUEUED', 'SEARCHING', 'PENDING'].includes(value.status?.state) && context.polls < 40) {
            context.timer = setTimeout(() => { if (current()) { context.polls++; void context.control.read(); } }, 3000);
          }
        },
      });
      void context.control.read();
    }
    return () => { window.removeEventListener('pagehide', hide); close(); };
  }, [staff, card, request, enabled, accessState, key]);
  if (!enabled || !request) return null;
  const visible = view?.context?.current(), state = visible ? view.status : null;
  const busy = !visible || ['READING', 'STARTING'].includes(view.phase), waiting = ['QUEUED', 'SEARCHING', 'PENDING'].includes(state?.state);
  const blocked = accessState !== 'READY' || ended.current || typeof isSelectionPending !== 'function' || isSelectionPending();
  const uncertain = visible && (view.pending || state?.state === 'UNKNOWN'), canStart = !busy && !blocked && !uncertain && !waiting && state?.refreshable;
  function act(kind) { const context = view?.context; if (!context?.current() || busy || (kind !== 'read' && blocked)) return; context.polls = 0; void context.control[kind](); }
  return <section className={styles.panel} aria-label="Search eBay sold comps">
    <div className={styles.heading}><div><p className={styles.eyebrow}>Optional · Revisit anytime</p><h3>Find recent eBay sales</h3></div><span className={styles.badge}>Staff search</span></div>
    <p className={styles.intro}>Start a search when you want fresh sold listings for this approved card. Choosing comps is optional and does not change its grade.</p>
    <p className={styles.status} role="status">{ended.current || accessState !== 'READY' ? 'Access ended. Sign in again.' : busy ? view?.phase === 'STARTING' ? 'Submitting this search…' : 'Checking saved search…'
      : view.error === 'SELECTION_PENDING' || blocked ? 'Resolve the pending selection before starting a search.'
      : view.error === 'APPROVAL_CHANGED' ? 'The approved card changed. Reopen Card Detail before searching.'
      : view.error ? uncertain ? 'The search response is unconfirmed. Check its status or retry the same request.' : 'Saved search status could not be read. Try checking again.'
      : waiting ? state.stage === 'READING_PHOTOS' ? 'Listings found. Reviewing their photos…' : 'Finding sold listings…'
      : state?.state === 'UNKNOWN' ? 'This search needs reconciliation. A new search is blocked.'
      : state?.state === 'READY' ? `${state.count} saved listing${state.count === 1 ? '' : 's'} ready for review.`
      : state?.retrySavedResponse ? 'Saved listings need processing recovery. Resume them without buying another search.'
      : state?.state === 'NOT_REQUESTED' ? 'No saved search for this approval.' : 'Search is currently unavailable.'}</p>
    <div className={styles.actions}>
      <button className={styles.primary} disabled={!canStart} onClick={() => act('start')}>{state?.retrySavedResponse ? 'Resume saved search' : 'Search fresh eBay sales'}</button>
      <button disabled={busy || ended.current || accessState !== 'READY'} onClick={() => act('read')}>Check saved search</button>
      {uncertain && state?.state !== 'UNKNOWN' && <button disabled={busy || blocked} onClick={() => act('retry')}>Retry this same request</button>}
    </div>
    <p className={styles.note}>Opening this panel and checking status do not start a paid search. A search keeps existing selections and published references intact.</p>
  </section>;
}
