import { useCallback, useEffect, useRef, useState } from 'react';
import { ownershipClaimsAccount, parseOwnershipClaimsPage } from '../../lib/ownership-claims-client.mjs';
import styles from './OwnershipClaimsWorkspace.module.css';

const LIMIT = 25;
const decisions = { PENDING: 'Pending', VERIFIED: 'Verified', REJECTED: 'Rejected' };
const evidence = {
  AVAILABLE: ['Available', 'Evidence was available when this history was checked.'],
  EXPIRED: ['Expired', 'The evidence retention period has ended.'],
  POLICY_CHANGED: ['Policy changed', 'The evidence belongs to an earlier review policy.'],
  POLICY_UNAVAILABLE: ['Review unavailable', 'The evidence review policy is unavailable.'],
  UNAVAILABLE: ['Unavailable', 'Evidence is unavailable for this claim.'],
};
const date = value => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

/** Isolated, disabled by default. Existing CustomerAuth supplies customer;
 * readPage is explicit fixture/future route wiring, never client authority.
 * No upload, download, claim, review, ownership or preference mutation exists. */
export default function OwnershipClaimsWorkspace({ customer, accessState = 'READY', enabled = false, readPage = null, onAccessLost }) {
  const accountId = customer?.id;
  const [view, setView] = useState(null), [hidden, setHidden] = useState(false);
  const active = useRef({ generation: 0, controller: null, closed: false, deniedCustomer: null });
  const latest = useRef(null); latest.current = { customer, accessState, enabled, readPage, onAccessLost };
  const cancel = useCallback(() => { active.current.generation++; active.current.controller?.abort(); active.current.controller = null; }, []);
  const load = useCallback((afterClaimId = null) => {
    const scope = latest.current;
    // Old page buttons and replies cannot cancel or replace a new session's read.
    if (scope.customer !== customer || scope.readPage !== readPage || scope.enabled !== true || scope.accessState !== 'READY'
      || scope.customer?.id !== accountId || active.current.closed || active.current.deniedCustomer === customer || !ownershipClaimsAccount(accountId) || typeof readPage !== 'function') return;
    cancel();
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
    cancel(); setView(null);
    if (accessState !== 'READY') active.current.deniedCustomer = customer;
    if (enabled === true && accessState === 'READY') load();
    return cancel;
  }, [cancel, load, customer, accessState, enabled]);
  useEffect(() => {
    const hide = () => { active.current.closed = true; cancel(); setView(null); setHidden(true); };
    window.addEventListener('pagehide', hide);
    return () => { window.removeEventListener('pagehide', hide); cancel(); };
  }, [cancel]);
  const ended = hidden || accessState !== 'READY' || !ownershipClaimsAccount(customer?.id) || active.current.deniedCustomer === customer;
  const shown = !ended && enabled === true && view?.customer === customer && view?.accountId === accountId && view?.readPage === readPage ? view : null;
  const status = ended ? 'ENDED' : enabled !== true || typeof readPage !== 'function' ? 'DISABLED' : shown?.status ?? 'LOADING';
  return <section className={styles.workspace} aria-label="Ownership claim history">
    <header className={styles.heading}><p className={styles.eyebrow}>YOUR ACCOUNT</p><h1>Ownership claim history</h1>
      <p>Claims you submitted, their recorded decisions, and their current review availability.</p></header>
    {status !== 'READY' ? <div className={styles.notice}>
      <p role="status">{status === 'DISABLED' ? 'Claim history is not enabled.' : status === 'ENDED' ? 'Sign in again to view your claim history.'
        : status === 'LOADING' ? 'Loading your claim history…' : 'Your claim history is unavailable. Please try again.'}</p>
      {status === 'UNAVAILABLE' && <div className={styles.actions}><button type="button" onClick={() => load(shown?.afterClaimId ?? null)}>Try again</button>
        {shown?.afterClaimId && <button type="button" onClick={() => load()}>First page</button>}</div>}
    </div> : <>
      <div className={styles.notice}><p>A verified claim is a past decision. Current ownership is shown separately for each card.</p>
        <p className={styles.muted}>Checked <time dateTime={shown.snapshot.observedAt}>{date(shown.snapshot.observedAt)}</time>. This page shows up to {LIMIT} claims.</p></div>
      {shown.snapshot.claims.length === 0 ? <p className={styles.empty} role="status">{shown.afterClaimId ? 'No more claims on this page.' : 'No submitted claims were found.'}</p>
        : <ol className={styles.list}>{shown.snapshot.claims.map(claim => <li key={claim.claimId} className={styles.claim}>
          <div className={styles.claimHeading}><h2>{claim.card?.certificateNumber ?? 'Card details unavailable'}</h2><span className={styles.badge}>{decisions[claim.decision.state]}</span></div>
          <p className={styles.ownership}>{claim.currentlyOwnedByYou ? 'Current ownership is recorded to your account.' : 'No current ownership is recorded to your account.'}</p>
          {claim.reviewStatus === 'BLOCKED' && <p className={styles.blocked}>Review blocked{claim.card === null ? ': card details are unavailable.' : '.'}</p>}
          <dl className={styles.facts}><div><dt>Submitted</dt><dd><time dateTime={claim.submittedAt}>{date(claim.submittedAt)}</time></dd></div>
            {claim.decision.decidedAt && <div><dt>Decision recorded</dt><dd><time dateTime={claim.decision.decidedAt}>{date(claim.decision.decidedAt)}</time></dd></div>}
            <div><dt>Evidence</dt><dd>{evidence[claim.evidence.availability][0]}</dd></div>
            {claim.card && <div><dt>Published report</dt><dd>Version {claim.card.report.version}</dd></div>}
          </dl><p className={styles.muted}>{evidence[claim.evidence.availability][1]}</p>
          <p className={styles.reference}>Claim reference: {claim.claimId}</p>
        </li>)}</ol>}
      <nav className={styles.actions} aria-label="Claim history pages"><button type="button" onClick={() => load(shown.afterClaimId)}>Refresh page</button>
        {shown.afterClaimId && <button type="button" onClick={() => load()}>First page</button>}
        {shown.snapshot.nextClaimId && <button type="button" onClick={() => load(shown.snapshot.nextClaimId)}>Next page</button>}</nav>
    </>}
  </section>;
}
