/* eslint-disable @next/next/no-html-link-for-pages -- A full document sign-in return obtains a fresh session after access loss. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CollectionWorkspace from './CollectionWorkspace.jsx';
import OwnershipClaimsWorkspace from './OwnershipClaimsWorkspace.jsx';
import { createCollectionDisplayReader } from '../../lib/collection-display-client.mjs';
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
// Explicitly passed only when the server display hint is true. No request is
// made at import/construction; each existing client enforces its own boundary.
const browserRequest = (...args) => fetch(...args);

function CollectionSession({ customer, session, accessState, historyConfiguredForDisplay, displayReader, preferencesRequest, readCollection, readClaimsPage, readClaimHistory }) {
  const [selected, setSelected] = useState('collection'), [ended, setEnded] = useState(false);
  const active = useRef({ closed: false, ended: false });
  const latest = useRef(null), accountId = customer?.id;
  const view = historyConfiguredForDisplay === true ? selected : 'collection';
  latest.current = { customer, accountId, accessState, view, session, displayReader, preferencesRequest };
  // A same-session READY toggle cannot undo logout or a denied read.
  if (accessState !== 'READY') active.current.ended = true;
  const closeAccess = useCallback(() => {
    const now = latest.current;
    if (active.current.closed || now.customer !== customer || now.accountId !== accountId || now.customer?.id !== accountId || now.view !== view
      || now.session !== session || now.displayReader !== displayReader || now.preferencesRequest !== preferencesRequest) return;
    active.current.ended = true; setEnded(true);
  }, [customer, accountId, view, session, displayReader, preferencesRequest]);
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
        : <CollectionWorkspace customer={customer} accessState="READY" readPage={readCollection} onAccessLost={closeAccess}
          displayReader={displayReader} preferencesSession={session} preferencesRequest={preferencesRequest}/>}
  </div>;
}

/** Display availability is advisory; every GET still authorizes the current
 * account. Only the active view is mounted. Claims never populate collection. */
export default function CollectionAccountWorkspace({ customer, session = null, accessState = 'READY', historyConfiguredForDisplay = false,
  displayConfiguredForDisplay = false, preferencesConfiguredForDisplay = false,
  readCollection = readCollectionPage, readClaimsPage = readClaims, readClaimHistory = readHistory }) {
  const accountId = customer?.id, csrf = session?.csrf;
  const sessionValid = session?.customer === customer && ownershipClaimsAccount(accountId)
    && typeof csrf === 'string' && csrf.length > 0 && csrf.length <= 512;
  const display = displayConfiguredForDisplay === true && sessionValid;
  const preferences = preferencesConfiguredForDisplay === true && sessionValid;
  const displayReader = useMemo(() => display ? createCollectionDisplayReader({ fetcher: browserRequest }) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Reader lifetime must change with captured bootstrap authority even though construction is inert.
    [display, session, customer, accountId, csrf]);
  const scope = useRef({ customer, accountId, session, csrf, generation: 0 });
  if (scope.current.customer !== customer || scope.current.accountId !== accountId || scope.current.session !== session
    || scope.current.csrf !== csrf) {
    scope.current = { customer, accountId, session, csrf, generation: scope.current.generation + 1 };
  }
  return <CollectionSession key={scope.current.generation} customer={customer} session={sessionValid ? session : null} accessState={accessState}
    historyConfiguredForDisplay={historyConfiguredForDisplay} displayReader={displayReader} preferencesRequest={preferences ? browserRequest : null}
    readCollection={readCollection} readClaimsPage={readClaimsPage} readClaimHistory={readClaimHistory}/>;
}
