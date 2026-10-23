import { useCallback, useEffect, useRef, useState } from 'react';
import MyCollection from './MyCollection.jsx';
import CollectionCardMedia from './CollectionCardMedia.jsx';
import CollectionPreferences from './CollectionPreferences.jsx';
import { parseOwnerCollectionPage } from '../../lib/collection-contract.mjs';
import { readCollectionPage } from '../../lib/collection-client.mjs';
import { collectionDisplayBinding, collectionDisplayLabel, parseCollectionDisplay } from '../../lib/collection-display-contract.mjs';
import styles from './collection.module.css';

const LIMIT = 25;
const account = customer => typeof customer?.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(customer.id);

/** Parent supplies the existing CustomerAuth bootstrap customer. This component
 * requests only a read page; fixtures may inject a reader, never an authority.
 * Titles/media require a separately supplied exact-approval reader, absent by
 * default. Preference composition is separately explicit; no claim, transfer
 * or offer action is exposed. */
export default function CollectionWorkspace({ customer, accessState = 'READY', readPage = readCollectionPage, onAccessLost, displayReader = null, preferencesSession = null, preferencesRequest = null }) {
  const accountId = customer?.id;
  const displayRead=displayReader?.read;
  const preferencesCsrf=preferencesSession?.csrf;
  const latest = useRef(null); latest.current = { customer, accountId, accessState, readPage, onAccessLost, displayReader, displayRead, preferencesSession, preferencesRequest, preferencesCsrf };
  const [view, setView] = useState(null), [ended, setEnded] = useState(false);
  const [labels,setLabels]=useState(null);
  const active = useRef({ generation: 0, controller: null, ended: false, closed: false, deniedCustomer: null });
  const cancel = useCallback(() => { active.current.generation++; active.current.controller?.abort(); active.current.controller = null; }, []);
  const load = useCallback((afterCardId = null) => {
    const now = latest.current;
    if (now.customer !== customer || now.accountId !== accountId || now.customer?.id !== accountId || now.readPage !== readPage || now.displayReader !== displayReader || now.displayRead !== displayRead || now.preferencesSession !== preferencesSession || now.preferencesRequest !== preferencesRequest || now.preferencesCsrf !== preferencesCsrf || now.accessState !== 'READY'
      || !account(customer) || active.current.closed || active.current.ended || active.current.deniedCustomer === customer) return;
    cancel();
    const generation = active.current.generation, controller = new AbortController();
    active.current.controller = controller;
    setLabels(null); setView({ customer, accountId, readPage, displayReader, displayRead, preferencesSession, preferencesRequest, preferencesCsrf, generation, status: 'LOADING', afterCardId });
    const input = { accountId, afterCardId, limit: LIMIT, signal: controller.signal };
    const current = () => active.current.generation === generation && !controller.signal.aborted && !active.current.closed && !active.current.ended
      && active.current.deniedCustomer !== customer && latest.current.customer === customer && latest.current.accountId === accountId && latest.current.customer?.id === accountId
      && latest.current.readPage === readPage && latest.current.displayReader === displayReader && latest.current.displayRead === displayRead
      && latest.current.preferencesSession === preferencesSession && latest.current.preferencesRequest === preferencesRequest && latest.current.preferencesCsrf === preferencesCsrf && latest.current.accessState === 'READY';
    Promise.resolve().then(() => {
      if (!current()) return null;
      return readPage(input);
    }).then(value => {
      if (!current()) return;
      // Keep validation here as well as in the real network reader: fixture
      // injection must never bypass account, approval or pagination checks.
      const snapshot = parseOwnerCollectionPage(value, accountId, input);
      setView({ customer, accountId, readPage, displayReader, displayRead, preferencesSession, preferencesRequest, preferencesCsrf, generation, status: 'READY', afterCardId, snapshot });
    }).catch(error => {
      if (!current()) return;
      const denied = ['COLLECTION_ACCESS_ENDED', 'COLLECTION_ACCOUNT_MISMATCH', 'COLLECTION_OWNER_MISMATCH'].includes(error.code) || error.status === 401 || error.status === 403;
      if (denied) { active.current.deniedCustomer = customer; cancel(); }
      setView({ customer, accountId, readPage, displayReader, displayRead, preferencesSession, preferencesRequest, preferencesCsrf, generation, status: denied ? 'ENDED' : 'UNAVAILABLE', afterCardId });
      if (denied) latest.current.onAccessLost?.();
    });
  }, [cancel, customer, accountId, readPage, displayReader, displayRead, preferencesSession, preferencesRequest, preferencesCsrf]);
  useEffect(() => {
    const lifecycle = active.current; lifecycle.closed = false;
    const hide = () => { active.current.ended = true; cancel(); setView(null); setLabels(null); setEnded(true); };
    window.addEventListener('pagehide', hide);
    return () => { lifecycle.closed = true; window.removeEventListener('pagehide', hide); cancel(); };
  }, [cancel]);
  useEffect(() => {
    cancel(); setView(null); setLabels(null);
    if (accessState !== 'READY') active.current.deniedCustomer = customer;
    else load();
    return cancel;
  }, [cancel, load, customer, accessState]);
  // This identity comparison runs before effects, so neither the prior account
  // nor a replaced session's content survives even one render.
  const shown = !ended && active.current.deniedCustomer !== customer && accessState === 'READY' && account(customer)
    && view?.customer === customer && view?.accountId === accountId && view?.readPage === readPage && view?.displayReader === displayReader && view?.displayRead === displayRead
    && view?.preferencesSession === preferencesSession && view?.preferencesRequest === preferencesRequest && view?.preferencesCsrf === preferencesCsrf ? view : null;
  if (!shown || shown.status !== 'READY') {
    const status = ended || active.current.deniedCustomer === customer || accessState !== 'READY' || !account(customer) || shown?.status === 'ENDED' ? 'ENDED'
      : shown?.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'LOADING';
    return <section className={styles.workspace} aria-label="My Collection"><h1>My Collection</h1>
      <p role="status">{status === 'LOADING' ? 'Loading your collection…' : status === 'ENDED' ? 'Sign in again to open your collection.' : 'Your collection is unavailable. Please try again later.'}</p>
      {status === 'UNAVAILABLE' && <button type="button" onClick={() => load()}>Try again</button>}
    </section>;
  }
  const currentDisplay=()=>!active.current.closed&&!active.current.ended&&active.current.deniedCustomer!==customer
    &&active.current.generation===shown.generation&&latest.current.customer===customer&&latest.current.accountId===accountId&&customer.id===accountId
    &&latest.current.readPage===readPage&&latest.current.displayReader===displayReader&&latest.current.displayRead===displayRead
    &&latest.current.preferencesSession===preferencesSession&&latest.current.preferencesRequest===preferencesRequest&&latest.current.preferencesCsrf===preferencesCsrf&&latest.current.accessState==='READY';
  const displayEnded=()=>{if(!currentDisplay())return;active.current.deniedCustomer=customer;cancel();setView(null);setLabels(null);latest.current.onAccessLost?.();};
  const optional=displayReader&&typeof displayReader.read==='function'?{
    displays:labels?.view===shown?labels.values:{},
    renderCardMedia:card=><CollectionCardMedia accountId={accountId} card={card} reader={displayReader} onAccessLost={displayEnded} onDisplay={value=>{
      if(!currentDisplay())return;
      try { const display=parseCollectionDisplay(value,collectionDisplayBinding(card,accountId));
        setLabels(previous=>({view:shown,values:{...(previous?.view===shown?previous.values:{}),[card.cardId]:collectionDisplayLabel(display)}}));
      } catch(error) {if(error.code==='COLLECTION_DISPLAY_ACCESS_ENDED')displayEnded();}
    }}/>,
  }:{};
  const preferenceOptions=typeof preferencesRequest==='function'&&preferencesSession?.customer===customer&&typeof preferencesCsrf==='string'&&preferencesCsrf.length>0?{
    renderPreferences:()=> <CollectionPreferences session={preferencesSession} request={preferencesRequest} onAccessLost={displayEnded}/>,
    renderCardPreferences:card=> <CollectionPreferences session={preferencesSession} request={preferencesRequest} cardId={card.cardId} onAccessLost={displayEnded}/>,
  }:{};
  return <>
    <MyCollection key={`${customer.id}:${shown.generation}`} accountId={customer.id} snapshot={shown.snapshot} readOnly afterCardId={shown.afterCardId} {...optional} {...preferenceOptions}/>
    <div className={styles.workspace}><nav className={styles.toolbar} aria-label="Collection pages">
      <button type="button" onClick={() => load()}>Refresh collection</button>
      {shown.afterCardId && <button type="button" onClick={() => load()}>First page</button>}
      {shown.snapshot.nextCardId && <button type="button" onClick={() => load(shown.snapshot.nextCardId)}>Next page</button>}
    </nav>{preferenceOptions.renderPreferences&&<p className={styles.help}>Filtering, refreshing the collection or changing pages clears forms that leave this view. An unconfirmed save may still have been recorded; check it before leaving.</p>}</div>
  </>;
}
