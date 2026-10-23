import { useEffect, useRef, useState } from 'react';
import CardHistory from '../../components/CardHistory';
import Shell, { Unavailable } from '../../components/Shell';
import styles from '../../components/GradedCards.module.css';
import { historyCardId } from '../../lib/card-history-client.mjs';
import { cardHistoryCompScope, createCardHistoryCompCuration } from '../../lib/card-history-comp-curation.mjs';
import { createCardHistoryCompSearch } from '../../lib/card-history-comp-search.mjs';
import { pageAccess } from '../../lib/server/runtime.mjs';

export async function getServerSideProps(ctx) {
  const access = await pageAccess(ctx, { includeCompCuration: true, includeCompSearch: true });
  if (!access.props?.staff || access.props.unavailable || !access.props.manualEnabled) return access;
  const cardId = historyCardId(ctx.params?.cardId);
  return cardId ? { props: { ...access.props, cardId,
    compSearchEnabled: access.props.compSearchConfiguredForDisplay === true,
    compCurationConfiguredForDisplay: access.props.compCurationConfiguredForDisplay === true } } : { notFound: true };
}

const browserRequest = (...args) => fetch(...args);
export function CardHistoryCuration({ staff, cardId, enabled = false, compSearchEnabled = false }) {
  const latest = useRef(null), lifetime = useRef(null), ended = useRef(false);
  const [active, setActive] = useState(null);
  const searchLifetime = useRef(null), [searchActive, setSearchActive] = useState(null);
  const binding = cardHistoryCompScope(staff, cardId);
  latest.current = { staff, cardId, enabled, compSearchEnabled, binding };
  useEffect(() => {
    const context = { closed: false, composition: null };
    lifetime.current = context;
    const current = () => !context.closed && !ended.current && lifetime.current === context
      && latest.current.staff === staff && latest.current.cardId === cardId && latest.current.enabled === true
      && latest.current.binding === binding && cardHistoryCompScope(staff, cardId) === binding;
    const close = () => { context.closed = true; context.composition?.close(); };
    const hide = () => { ended.current = true; close(); setActive(null); };
    window.addEventListener('pagehide', hide);
    if (enabled === true && binding && current()) {
      context.composition = createCardHistoryCompCuration({ enabled: true, staff, cardId,
        fetchImpl: browserRequest, events: window, isCurrent: current });
      setActive({ context, current });
    } else setActive(null);
    return () => { close(); window.removeEventListener('pagehide', hide); };
  }, [staff, cardId, enabled, binding]);
  // Search has a separate opt-in and lifetime. Toggling it cannot replace the
  // curation transport or discard a pending curation decision.
  useEffect(() => {
    const context = { closed: false, composition: null };
    searchLifetime.current = context;
    const current = () => !context.closed && !ended.current && searchLifetime.current === context
      && latest.current.staff === staff && latest.current.cardId === cardId && latest.current.compSearchEnabled === true
      && latest.current.binding === binding && cardHistoryCompScope(staff, cardId) === binding;
    const close = () => { context.closed = true; context.composition?.close(); };
    const hide = () => { ended.current = true; close(); setSearchActive(null); };
    window.addEventListener('pagehide', hide);
    if (compSearchEnabled === true && binding && current()) {
      context.composition = createCardHistoryCompSearch({ enabled: true, staff, cardId,
        fetchImpl: browserRequest, events: window, isCurrent: current });
      setSearchActive({ context, current });
    } else setSearchActive(null);
    return () => { close(); window.removeEventListener('pagehide', hide); };
  }, [staff, cardId, compSearchEnabled, binding]);
  // Pure render fence removes old curation before its effect cleanup. A flag
  // toggle cannot reopen a page-hidden lifetime; ordinary rerenders keep the
  // same request capability and the unchanged CardHistory instance.
  const visible = active?.current() && active.context.composition.isCurrent();
  const searchVisible = searchActive?.current() && searchActive.context.composition.isCurrent();
  return <CardHistory staff={staff} cardId={cardId} compCurationEnabled={Boolean(visible)}
    compCurationRequest={visible ? active.context.composition.request : undefined}
    compSearchEnabled={Boolean(searchVisible)} compSearchRequest={searchVisible ? searchActive.context.composition.request : undefined}/>;
}

export default function CardHistoryPage({ staff, unavailable, accessFailure, manualEnabled, cardId, compCurationConfiguredForDisplay = false, compSearchEnabled = false }) {
  if (unavailable || !manualEnabled) return <Unavailable accessFailure={accessFailure ?? (!unavailable ? { kind: 'FEATURE_DISABLED' } : undefined)}/>;
  if (staff?.role !== 'REVIEWER') return <Shell staff={staff} title="Card details" manual className={styles.shell}>
    <main className={styles.page}><h1>Reviewer access required</h1><p>A reviewer staff account is required to open this card’s details.</p></main>
  </Shell>;
  return <CardHistoryCuration key={`${staff.id}:${staff.role}:${staff.mode}:${cardId}`} staff={staff} cardId={cardId}
    enabled={compCurationConfiguredForDisplay === true} compSearchEnabled={compSearchEnabled === true}/>;
}
