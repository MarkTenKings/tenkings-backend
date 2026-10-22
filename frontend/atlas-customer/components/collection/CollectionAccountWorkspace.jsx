/* eslint-disable @next/next/no-html-link-for-pages -- A full document sign-in return obtains a fresh session after access loss. */
import { useCallback, useEffect, useRef, useState } from 'react';
import CollectionWorkspace from './CollectionWorkspace.jsx';
import OwnershipClaimsWorkspace from './OwnershipClaimsWorkspace.jsx';
import { readCollectionPage } from '../../lib/collection-client.mjs';
import { createOwnershipClaimsReader, createOwnershipClaimHistoryReader, ownershipClaimsAccount } from '../../lib/ownership-claims-client.mjs';
import { createOwnershipClaimsTransport } from '../../lib/ownership-claims-transport.mjs';
import styles from './CollectionAccountWorkspace.module.css';

// Inert construction. Only these two GET functions reach the mounted history;
// no proof configuration, storage target or mutation capability is passed on.
const { listClaims, listHistory } = createOwnershipClaimsTransport({
  fetchImpl: (...args) => fetch(...args), csrf: () => { throw Error('READ_ONLY_COLLECTION'); },
});
const readClaims = createOwnershipClaimsReader(listClaims);
const readHistory = createOwnershipClaimHistoryReader(listHistory);

function CollectionSession({ customer, accessState, historyConfiguredForDisplay, readCollection, readClaimsPage, readClaimHistory }) {
  const [selected, setSelected] = useState('collection'), [ended, setEnded] = useState(false);
  const active = useRef({ closed: false, ended: false });
  const latest = useRef(null), accountId = customer?.id;
  const view = historyConfiguredForDisplay === true ? selected : 'collection';
  latest.current = { customer, accountId, accessState, view };
  // A same-session READY toggle cannot undo logout or a denied read.
  if (accessState !== 'READY') active.current.ended = true;
  const closeAccess = useCallback(() => {
    const now = latest.current;
    if (active.current.closed || now.customer !== customer || now.accountId !== accountId || now.customer?.id !== accountId || now.view !== view) return;
    active.current.ended = true; setEnded(true);
  }, [customer, accountId, view]);
  useEffect(() => {
    const lifecycle = active.current;
    // React StrictMode replays setup after cleanup. Reopen only the mounted
    // lifetime; a denied/page-hidden session remains ended.
    lifecycle.closed = false;
    const hide = () => { lifecycle.ended = true; setEnded(true); };
    window.addEventListener('pagehide', hide);
    return () => { lifecycle.closed = true; window.removeEventListener('pagehide', hide); };
  }, []);
  useEffect(() => { if (historyConfiguredForDisplay !== true) setSelected('collection'); }, [historyConfiguredForDisplay]);
  const closed = ended || active.current.ended || !ownershipClaimsAccount(accountId);
  const select = next => {
    const now = latest.current;
    if (closed || active.current.closed || active.current.ended || now.customer !== customer || now.accountId !== accountId
      || now.accessState !== 'READY' || now.view !== view) return;
    setSelected(next);
  };
  return <div className={styles.hub}>
    {historyConfiguredForDisplay === true && <nav className={styles.switcher} aria-label="Collection views">
      <button type="button" aria-pressed={view === 'collection'} disabled={closed} onClick={() => select('collection')}>Current collection</button>
      <button type="button" aria-pressed={view === 'history'} disabled={closed} onClick={() => select('history')}>Ownership claim history</button>
    </nav>}
    {closed ? <section className={styles.notice} aria-label="Collection access"><h1>Collection access ended</h1>
      <p role="status">Sign in again to view your collection and claim history.</p><a href="/account/collection">Return to sign in</a></section>
      : view === 'history' ? <OwnershipClaimsWorkspace customer={customer} enabled accessState="READY"
        readPage={readClaimsPage} readHistory={readClaimHistory} onAccessLost={closeAccess}/>
        : <CollectionWorkspace customer={customer} accessState="READY" readPage={readCollection} onAccessLost={closeAccess}/>}
  </div>;
}

/** Display availability is advisory; every GET still authorizes the current
 * account. Only the active view is mounted. Claims never populate collection. */
export default function CollectionAccountWorkspace({ customer, accessState = 'READY', historyConfiguredForDisplay = false,
  readCollection = readCollectionPage, readClaimsPage = readClaims, readClaimHistory = readHistory }) {
  const scope = useRef({ customer, accountId: customer?.id, generation: 0 });
  if (scope.current.customer !== customer || scope.current.accountId !== customer?.id) {
    scope.current = { customer, accountId: customer?.id, generation: scope.current.generation + 1 };
  }
  return <CollectionSession key={scope.current.generation} customer={customer} accessState={accessState}
    historyConfiguredForDisplay={historyConfiguredForDisplay} readCollection={readCollection}
    readClaimsPage={readClaimsPage} readClaimHistory={readClaimHistory}/>;
}
