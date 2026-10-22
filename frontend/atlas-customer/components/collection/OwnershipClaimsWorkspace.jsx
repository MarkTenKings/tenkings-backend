import { useCallback, useEffect, useRef, useState } from 'react';
import { ownershipClaimsAccount, parseOwnershipClaimsPage, parseOwnershipClaimHistory } from '../../lib/ownership-claims-client.mjs';
import styles from './OwnershipClaimsWorkspace.module.css';

const LIMIT = 25;
const states = { PENDING: 'Pending', WITHDRAWN: 'Withdrawn', VERIFIED: 'Verified', REJECTED: 'Rejected' };
const reasons = {
  EVIDENCE_UNAVAILABLE: 'Evidence is unavailable.', EVIDENCE_EXPIRED: 'Evidence access has expired. This does not confirm deletion.',
  POLICY_CHANGED: 'The evidence belongs to an earlier review policy.', POLICY_UNAVAILABLE: 'The review policy is unavailable.',
  CARD_UNAVAILABLE: 'Card details are unavailable.', OWNERSHIP_CHANGED: 'The ownership record has changed.',
};
const actions = { submit_claim: 'Claim submitted', replace_evidence: 'Evidence replaced', withdraw_claim: 'Claim withdrawn', review_claim: 'Review decision recorded' };
const date = value => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

/** Isolated, disabled by default. Existing CustomerAuth supplies customer;
 * readPage is explicit fixture/future route wiring, never client authority.
 * No upload, download, claim, review, ownership or preference mutation exists. */
export default function OwnershipClaimsWorkspace({ customer, accessState = 'READY', enabled = false, readPage = null, readHistory = null, onAccessLost }) {
  const accountId = customer?.id;
  const [view, setView] = useState(null), [hidden, setHidden] = useState(false), [history, setHistory] = useState(null);
  const active = useRef({ generation: 0, controller: null, closed: false, deniedCustomer: null, historyGeneration: 0, historyController: null, revisions: new Map() });
  const latest = useRef(null); latest.current = { customer, accessState, enabled, readPage, readHistory, onAccessLost, view, history };
  const cancelHistory = useCallback(() => { active.current.historyGeneration++; active.current.historyController?.abort(); active.current.historyController = null; }, []);
  const cancel = useCallback(() => { active.current.generation++; active.current.controller?.abort(); active.current.controller = null; cancelHistory(); }, [cancelHistory]);
  const load = useCallback((afterClaimId = null) => {
    const scope = latest.current;
    // Old page buttons and replies cannot cancel or replace a new session's read.
    if (scope.customer !== customer || scope.readPage !== readPage || scope.enabled !== true || scope.accessState !== 'READY'
      || scope.customer?.id !== accountId || active.current.closed || active.current.deniedCustomer === customer || !ownershipClaimsAccount(accountId) || typeof readPage !== 'function') return;
    cancel(); setHistory(null); active.current.revisions.clear();
    const generation = active.current.generation, controller = new AbortController(); active.current.controller = controller;
    const current = () => active.current.generation === generation && !controller.signal.aborted && !active.current.closed
      && latest.current.customer === customer && latest.current.customer?.id === accountId && latest.current.readPage === readPage && latest.current.enabled === true
      && latest.current.accessState === 'READY' && active.current.deniedCustomer !== customer;
    setView({ customer, accountId, readPage, status: 'LOADING', afterClaimId });
    const input = { accountId, afterClaimId, limit: LIMIT, signal: controller.signal };
    Promise.resolve().then(() => current() ? readPage(input) : null).then(value => {
      if (!current()) return;
      const snapshot = parseOwnershipClaimsPage(value, accountId, { afterClaimId, limit: LIMIT });
      setView({ customer, accountId, readPage, status: 'READY', afterClaimId, snapshot });
    }).catch(error => {
      if (!current()) return;
      const ended = error.code === 'OWNERSHIP_CLAIMS_ACCESS_ENDED' || error.status === 401 || error.status === 403;
      if (ended) { active.current.deniedCustomer = customer; cancel(); }
      setView({ customer, accountId, readPage, status: ended ? 'ENDED' : 'UNAVAILABLE', afterClaimId });
      if (ended) latest.current.onAccessLost?.();
    });
  }, [cancel, customer, accountId, readPage]);
  useEffect(() => {
    cancel(); setView(null); setHistory(null);
    if (accessState !== 'READY') active.current.deniedCustomer = customer;
    if (enabled === true && accessState === 'READY') load();
    return cancel;
  }, [cancel, load, customer, accessState, enabled]);
  useEffect(() => {
    const hide = () => { active.current.closed = true; cancel(); setView(null); setHistory(null); setHidden(true); };
    window.addEventListener('pagehide', hide);
    return () => { window.removeEventListener('pagehide', hide); cancel(); };
  }, [cancel]);
  useEffect(() => { cancelHistory(); setHistory(null); return cancelHistory; }, [cancelHistory, readHistory]);
  const loadHistory = (row, afterRevision = 0) => {
    const scope = latest.current;
    if (scope.customer !== customer || scope.customer?.id !== accountId || scope.readPage !== readPage || scope.readHistory !== readHistory
      || scope.enabled !== true || scope.accessState !== 'READY' || active.current.closed || active.current.deniedCustomer === customer
      || scope.view !== view || typeof readHistory !== 'function' || view?.status !== 'READY' || view.customer !== customer || view.accountId !== accountId) return;
    cancelHistory();
    const generation = active.current.historyGeneration, pageGeneration = active.current.generation, controller = new AbortController();
    active.current.historyController = controller;
    const current = () => active.current.historyGeneration === generation && active.current.generation === pageGeneration
      && !controller.signal.aborted && !active.current.closed && active.current.deniedCustomer !== customer
      && latest.current.customer === customer && latest.current.customer?.id === accountId && latest.current.readPage === readPage
      && latest.current.readHistory === readHistory && latest.current.enabled === true && latest.current.accessState === 'READY';
    const context = { customer, accountId, readPage, readHistory, claimId: row.claimId, afterRevision };
    setHistory({ ...context, status: 'LOADING' });
    Promise.resolve().then(() => current() ? readHistory({ accountId, claimId: row.claimId, afterRevision, limit: LIMIT, signal: controller.signal }) : null).then(value => {
      if (!current()) return;
      const snapshot = parseOwnershipClaimHistory(value, accountId, { claimId: row.claimId, afterRevision, limit: LIMIT });
      if (snapshot.claim.cardId !== row.cardId || snapshot.claim.claimRevision < Math.max(row.claimRevision, active.current.revisions.get(row.claimId) ?? 0)
        || snapshot.claim.claimRevision === row.claimRevision && (snapshot.claim.state !== row.state || snapshot.claim.bundleId !== row.bundleId)) throw Error('OWNERSHIP_CLAIMS_UNAVAILABLE');
      active.current.revisions.set(row.claimId, snapshot.claim.claimRevision);
      setView(previous => ({ ...previous, currentChecks: { ...previous.currentChecks, [row.claimId]: snapshot.observedAt },
        snapshot: { ...previous.snapshot, claims: previous.snapshot.claims.map(c => c.claimId === row.claimId ? snapshot.claim : c) } }));
      setHistory({ ...context, status: 'READY', snapshot });
    }).catch(error => {
      if (!current()) return;
      const ended = error.code === 'OWNERSHIP_CLAIMS_ACCESS_ENDED' || error.status === 401 || error.status === 403;
      if (ended) { active.current.deniedCustomer = customer; cancel(); setView(null); setHistory(null); latest.current.onAccessLost?.(); }
      else setHistory({ ...context, status: 'UNAVAILABLE' });
    });
  };
  const ended = hidden || accessState !== 'READY' || !ownershipClaimsAccount(customer?.id) || active.current.deniedCustomer === customer;
  const shown = !ended && enabled === true && view?.customer === customer && view?.accountId === accountId && view?.readPage === readPage ? view : null;
  const status = ended ? 'ENDED' : enabled !== true || typeof readPage !== 'function' ? 'DISABLED' : shown?.status ?? 'LOADING';
  const shownHistory = status === 'READY' && history?.customer === customer && history.accountId === accountId
    && history.readPage === readPage && history.readHistory === readHistory ? history : null;
  return <section className={styles.workspace} aria-label="Ownership claim history">
    <header className={styles.heading}><p className={styles.eyebrow}>YOUR ACCOUNT</p><h1>Ownership claim history</h1>
      <p>Your claims, their current state, and their recorded changes.</p></header>
    {status !== 'READY' ? <div className={styles.notice}>
      <p role="status">{status === 'DISABLED' ? 'Claim history is not enabled.' : status === 'ENDED' ? 'Sign in again to view your claim history.'
        : status === 'LOADING' ? 'Loading your claim history…' : 'Your claim history is unavailable. Please try again.'}</p>
      {status === 'UNAVAILABLE' && <div className={styles.actions}><button type="button" onClick={() => load(shown?.afterClaimId ?? null)}>Try again</button>
        {shown?.afterClaimId && <button type="button" onClick={() => load()}>First page</button>}</div>}
    </div> : <>
      <div className={styles.notice}><p>A verified claim records a review decision. Current ownership is shown separately for each card.</p>
        <p className={styles.muted}>List checked <time dateTime={shown.snapshot.observedAt}>{date(shown.snapshot.observedAt)}</time>. This page shows up to {LIMIT} claims.</p></div>
      {shown.snapshot.claims.length === 0 ? <p className={styles.empty} role="status">{shown.afterClaimId ? 'No more claims on this page.' : 'No submitted claims were found.'}</p>
        : <ol className={styles.list}>{shown.snapshot.claims.map(row => {
          const detail = shownHistory?.claimId === row.claimId ? shownHistory : null;
          const claim = detail?.status === 'READY' ? detail.snapshot.claim : row;
          return <li key={claim.claimId} className={styles.claim} data-claim-row={claim.claimId}>
            <div className={styles.claimHeading}><h2>{claim.card?.certificateNumber ?? 'Card details unavailable'}</h2><span className={styles.badge}>{states[claim.state]}</span></div>
            <p className={styles.ownership}>{claim.currentlyOwnedByYou ? 'Current ownership is recorded to your account.' : 'No current ownership is recorded to your account.'}</p>
            <dl className={styles.facts}><div><dt>Current claim revision</dt><dd>{claim.claimRevision}</dd></div>
              <div><dt>Current evidence reference</dt><dd className={styles.reference}>{claim.bundleId ?? 'No v2 evidence bundle recorded'}</dd></div>
              {claim.card && <div><dt>Published report</dt><dd>Version {claim.card.report.version}</dd></div>}
            </dl>
            {claim.blockedReasons.length > 0 && <div className={styles.blocked}><p>{claim.state === 'PENDING' ? 'Review blocked' : 'Current evidence and card availability'}</p>
              {claim.blockedReasons.map(reason => <p key={reason}>{reasons[reason]}</p>)}</div>}
            {shown.currentChecks?.[claim.claimId] && <p className={styles.muted}>Current state checked <time dateTime={shown.currentChecks[claim.claimId]}>{date(shown.currentChecks[claim.claimId])}</time>.</p>}
            <p className={styles.reference}>Claim reference: {claim.claimId}</p>
            {typeof readHistory === 'function' && <div className={styles.actions}><button type="button" onClick={() => loadHistory(claim)}>View recorded changes</button></div>}
            {detail && <section className={styles.history} aria-label="Recorded claim changes">
              <h3>Recorded changes</h3>
              {detail.status !== 'READY' ? <><p role="status">{detail.status === 'LOADING' ? 'Loading recorded changes…' : 'Recorded changes are unavailable. Please try again.'}</p>
                {detail.status === 'UNAVAILABLE' && <button type="button" onClick={() => loadHistory(row, detail.afterRevision)}>Try history again</button>}</>
                : <><p>Submitted <time dateTime={detail.snapshot.submittedAt}>{date(detail.snapshot.submittedAt)}</time>.</p>
                  <p className={styles.muted}>Current state checked <time dateTime={detail.snapshot.observedAt}>{date(detail.snapshot.observedAt)}</time>. Past actions below do not replace the current state above.</p>
                  {detail.snapshot.origin === 'LEGACY_V1' && <p>This claim began before v2 history. Only recorded v2 changes are shown.</p>}
                  {detail.snapshot.transitions.length === 0 ? <p>No recorded v2 changes on this page.</p> : <ol className={styles.transitions}>{detail.snapshot.transitions.map(entry => <li key={entry.claimRevision}>
                    <h4>{actions[entry.action]}</h4><p>Revision {entry.claimRevision} · {states[entry.state]}</p>
                    <p><time dateTime={entry.occurredAt}>{date(entry.occurredAt)}</time></p>
                    <p className={styles.reference}>Evidence reference at this action: {entry.bundleId ?? 'No v2 evidence bundle recorded'}</p>
                  </li>)}</ol>}
                  <nav className={styles.actions} aria-label="Recorded changes pages">
                    {detail.afterRevision > 0 && <button type="button" onClick={() => loadHistory(claim)}>First changes</button>}
                    {detail.snapshot.nextRevision !== null && <button type="button" onClick={() => loadHistory(claim, detail.snapshot.nextRevision)}>Next changes</button>}
                  </nav></>}
              <div className={styles.actions}><button type="button" onClick={() => { if (latest.current.history === detail && latest.current.customer === customer && latest.current.customer?.id === accountId) { cancelHistory(); setHistory(null); } }}>Close changes</button></div>
            </section>}
          </li>;
        })}</ol>}
      <nav className={styles.actions} aria-label="Claim history pages"><button type="button" onClick={() => load(shown.afterClaimId)}>Refresh page</button>
        {shown.afterClaimId && <button type="button" onClick={() => load()}>First page</button>}
        {shown.snapshot.nextClaimId && <button type="button" onClick={() => load(shown.snapshot.nextClaimId)}>Next page</button>}</nav>
    </>}
  </section>;
}
