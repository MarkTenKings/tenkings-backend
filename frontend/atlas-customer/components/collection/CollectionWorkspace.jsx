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
export default function CollectionWorkspace({ customer, accessState = 'READY', readPage = readCollectionPage }) {
  const [view, setView] = useState(null), [ended, setEnded] = useState(false);
  const active = useRef({ generation: 0, controller: null, ended: false });
  const cancel = useCallback(() => { active.current.generation++; active.current.controller?.abort(); active.current.controller = null; }, []);
  const load = useCallback((afterCardId = null) => {
    cancel();
    if (!account(customer) || accessState !== 'READY' || active.current.ended) { setView(null); return; }
    const generation = active.current.generation, controller = new AbortController();
    active.current.controller = controller;
    setView({ customer, status: 'LOADING', afterCardId });
    const input = { accountId: customer.id, afterCardId, limit: LIMIT, signal: controller.signal };
    const current = () => active.current.generation === generation && !controller.signal.aborted && !active.current.ended;
    Promise.resolve().then(() => {
      if (!current()) return null;
      return readPage(input);
    }).then(value => {
      if (!current()) return;
      // Keep validation here as well as in the real network reader: fixture
      // injection must never bypass account, approval or pagination checks.
      const snapshot = parseOwnerCollectionPage(value, customer.id, input);
      setView({ customer, status: 'READY', afterCardId, snapshot });
    }).catch(error => {
      if (!current()) return;
      setView({ customer, status: error.code === 'COLLECTION_ACCESS_ENDED' || error.status === 401 || error.status === 403 ? 'ENDED' : 'UNAVAILABLE', afterCardId });
    });
  }, [cancel, customer, accessState, readPage]);
  useEffect(() => {
    load();
    return cancel;
  }, [cancel, load]);
  useEffect(() => {
    const hide = () => { active.current.ended = true; cancel(); setView(null); setEnded(true); };
    window.addEventListener('pagehide', hide);
    return () => { window.removeEventListener('pagehide', hide); cancel(); };
  }, [cancel]);
  // This identity comparison runs before effects, so neither the prior account
  // nor a replaced session's content survives even one render.
  const shown = !ended && accessState === 'READY' && account(customer) && view?.customer === customer ? view : null;
  if (!shown || shown.status !== 'READY') {
    const status = ended || accessState !== 'READY' || !account(customer) || shown?.status === 'ENDED' ? 'ENDED'
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
