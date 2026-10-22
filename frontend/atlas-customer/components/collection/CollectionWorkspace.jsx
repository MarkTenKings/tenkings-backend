import { useCallback, useEffect, useRef, useState } from 'react';
import MyCollection from './MyCollection.jsx';
import { parseOwnerCollectionPage } from '../../lib/collection-contract.mjs';
import { readCollectionPage } from '../../lib/collection-client.mjs';
import styles from './collection.module.css';

const LIMIT = 25;
const account = customer => typeof customer?.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(customer.id);

/** Parent supplies the existing CustomerAuth bootstrap customer. This component
 * requests only a read page; fixtures may inject a reader, never an authority.
 * Titles/media require a separate authorized exact-approval reader and are
 * deliberately absent. No settings, claim, transfer or offer writer is exposed. */
export default function CollectionWorkspace({ customer, accessState = 'READY', readPage = readCollectionPage, onAccessLost }) {
  const accountId = customer?.id;
  const latest = useRef(null); latest.current = { customer, accountId, accessState, readPage, onAccessLost };
  const [view, setView] = useState(null), [ended, setEnded] = useState(false);
  const active = useRef({ generation: 0, controller: null, ended: false, closed: false, deniedCustomer: null });
  const cancel = useCallback(() => { active.current.generation++; active.current.controller?.abort(); active.current.controller = null; }, []);
  const load = useCallback((afterCardId = null) => {
    const now = latest.current;
    if (now.customer !== customer || now.accountId !== accountId || now.customer?.id !== accountId || now.readPage !== readPage || now.accessState !== 'READY'
      || !account(customer) || active.current.closed || active.current.ended || active.current.deniedCustomer === customer) return;
    cancel();
    const generation = active.current.generation, controller = new AbortController();
    active.current.controller = controller;
    setView({ customer, accountId, readPage, status: 'LOADING', afterCardId });
    const input = { accountId, afterCardId, limit: LIMIT, signal: controller.signal };
    const current = () => active.current.generation === generation && !controller.signal.aborted && !active.current.closed && !active.current.ended
      && active.current.deniedCustomer !== customer && latest.current.customer === customer && latest.current.accountId === accountId && latest.current.customer?.id === accountId
      && latest.current.readPage === readPage && latest.current.accessState === 'READY';
    Promise.resolve().then(() => {
      if (!current()) return null;
      return readPage(input);
    }).then(value => {
      if (!current()) return;
      // Keep validation here as well as in the real network reader: fixture
      // injection must never bypass account, approval or pagination checks.
      const snapshot = parseOwnerCollectionPage(value, accountId, input);
      setView({ customer, accountId, readPage, status: 'READY', afterCardId, snapshot });
    }).catch(error => {
      if (!current()) return;
      const denied = ['COLLECTION_ACCESS_ENDED', 'COLLECTION_ACCOUNT_MISMATCH', 'COLLECTION_OWNER_MISMATCH'].includes(error.code) || error.status === 401 || error.status === 403;
      if (denied) { active.current.deniedCustomer = customer; cancel(); }
      setView({ customer, accountId, readPage, status: denied ? 'ENDED' : 'UNAVAILABLE', afterCardId });
      if (denied) latest.current.onAccessLost?.();
    });
  }, [cancel, customer, accountId, readPage]);
  useEffect(() => {
    const lifecycle = active.current; lifecycle.closed = false;
    const hide = () => { active.current.ended = true; cancel(); setView(null); setEnded(true); };
    window.addEventListener('pagehide', hide);
    return () => { lifecycle.closed = true; window.removeEventListener('pagehide', hide); cancel(); };
  }, [cancel]);
  useEffect(() => {
    cancel(); setView(null);
    if (accessState !== 'READY') active.current.deniedCustomer = customer;
    else load();
    return cancel;
  }, [cancel, load, customer, accessState]);
  // This identity comparison runs before effects, so neither the prior account
  // nor a replaced session's content survives even one render.
  const shown = !ended && active.current.deniedCustomer !== customer && accessState === 'READY' && account(customer)
    && view?.customer === customer && view?.accountId === accountId && view?.readPage === readPage ? view : null;
  if (!shown || shown.status !== 'READY') {
    const status = ended || active.current.deniedCustomer === customer || accessState !== 'READY' || !account(customer) || shown?.status === 'ENDED' ? 'ENDED'
      : shown?.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'LOADING';
    return <section className={styles.workspace} aria-label="My Collection"><h1>My Collection</h1>
      <p role="status">{status === 'LOADING' ? 'Loading your collection…' : status === 'ENDED' ? 'Sign in again to open your collection.' : 'Your collection is unavailable. Please try again later.'}</p>
      {status === 'UNAVAILABLE' && <button type="button" onClick={() => load()}>Try again</button>}
    </section>;
  }
  return <>
    <MyCollection key={`${customer.id}:${shown.afterCardId ?? 'first'}`} accountId={customer.id} snapshot={shown.snapshot} readOnly afterCardId={shown.afterCardId}/>
    <div className={styles.workspace}><nav className={styles.toolbar} aria-label="Collection pages">
      <button type="button" onClick={() => load()}>Refresh collection</button>
      {shown.afterCardId && <button type="button" onClick={() => load()}>First page</button>}
      {shown.snapshot.nextCardId && <button type="button" onClick={() => load(shown.snapshot.nextCardId)}>Next page</button>}
    </nav></div>
  </>;
}
