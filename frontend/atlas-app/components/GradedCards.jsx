import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Shell from './Shell';
import ApprovedCardMedia from './ApprovedCardMedia';
import { api } from '../lib/client';
import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { orderDeskPagePath } from '../lib/order-desk-client.mjs';
import { approvedDate, approvedReportPath, archiveAccessFailure, gradedCardPath, gradedCardSubtitle, gradedCardTitle,
  gradedCardVariation, gradedCardsFormFilters, gradedCardsMessage, gradedCardsPath, mergeGradedCards, readGradedCardsPage, recordedGrade, submissionOrigin } from '../lib/graded-cards-client.mjs';
import styles from './GradedCards.module.css';

const emptyFilters = { q: '', category: '', from: '', to: '' };
const emptyPage = { cards: [], nextCursor: null };
const hasFilters = filters => Object.values(filters).some(Boolean);

function CardPhoto({ card, compact = false }) {
  return <ApprovedCardMedia card={card} compact={compact}/>;
}

function SubmissionReference({ card, enabled }) {
  if (!card.submission?.reference) return null;
  const path = enabled ? orderDeskPagePath(card.submission.orderId) : null;
  return path ? <Link href={path}>{card.submission.reference} ↗</Link> : <span>{card.submission.reference}</span>;
}

function GalleryCard({ card, orderLinks }) {
  const report = approvedReportPath(card), title = gradedCardTitle(card);
  return <article className={styles.galleryCard} aria-label={`${title}, certificate ${card.certificateNumber || 'not recorded'}`}>
    <CardPhoto key={`${card.cardId}:${card.approvalActionId}`} card={card}/>
    <div className={styles.metadata}>
      <Link href={gradedCardPath(card)} className={styles.titleLink}><h2>{title}</h2></Link>
      {gradedCardSubtitle(card) && <p className={styles.subtitle}>{gradedCardSubtitle(card)}</p>}
      {gradedCardVariation(card) && <p className={styles.variation}>{gradedCardVariation(card)}</p>}
      <p className={styles.certificate}>{card.certificateNumber || 'Certificate not recorded'}</p>
      <div className={styles.gradeLine}><strong>ATLAS <span>{recordedGrade(card)}</span></strong><span>Approved<br/>{approvedDate(card.approvedAt)}</span></div>
      <Link className={styles.primary} href={gradedCardPath(card)}>Open card <span aria-hidden="true">↗</span></Link>
      <div className={styles.cardLinks}>{report ? <a href={report}>View approved report ↗</a> : <span>Public report pending</span>}<span>{submissionOrigin(card)}</span></div>
      {card.submission?.reference && <div className={styles.submissionLink}><SubmissionReference card={card} enabled={orderLinks}/></div>}
    </div>
  </article>;
}

function CardsTable({ cards, orderLinks }) {
  return <div className={styles.tableScroll} tabIndex="0" role="region" aria-label="Graded cards table. Scroll horizontally for all columns."><table className={styles.table}>
    <thead><tr><th scope="col">Card &amp; certificate</th><th scope="col">ATLAS grade</th><th scope="col">Approved (UTC)</th><th scope="col">Approver</th><th scope="col">Review staff</th><th scope="col">Customer / submission</th><th scope="col">Origin / dealer</th><th scope="col">Report</th></tr></thead>
    <tbody>{cards.map(card => { const report = approvedReportPath(card); return <tr key={card.cardId}>
      <th scope="row"><div className={styles.tableCard}><CardPhoto key={`${card.cardId}:${card.approvalActionId}`} card={card} compact/><div><Link href={gradedCardPath(card)}>{gradedCardTitle(card)}</Link><small>{gradedCardSubtitle(card)}</small><small>{gradedCardVariation(card)}</small><code>{card.certificateNumber || 'Not recorded'}</code></div></div></th>
      <td><strong className={styles.tableGrade}>{recordedGrade(card)}</strong></td><td>{approvedDate(card.approvedAt)}</td><td>{card.approver?.name || 'Not recorded'}</td>
      <td>{card.reviewers?.length ? card.reviewers.map(person => person.name || 'Name not recorded').join(', ') : 'Not recorded'}</td>
      <td>{card.submission ? <>{card.submission.customer?.name || 'Name not recorded'}<small>{card.submission.reference ? <SubmissionReference card={card} enabled={orderLinks}/> : 'Reference not recorded'}</small></> : 'No linked submission'}</td>
      <td>{submissionOrigin(card)}</td><td>{report ? <a href={report}>Open report ↗</a> : 'Pending publication'}</td>
    </tr>; })}</tbody>
  </table></div>;
}

/** Read-only archive. Search and pagination are server queries; mounting this
 * screen never starts grading, publishes a report or dispatches a provider. */
export default function GradedCards({ staff, request = api }) {
  const [draft, setDraft] = useState(emptyFilters), [filters, setFilters] = useState(emptyFilters), [view, setView] = useState('gallery');
  const [savedPage, setPage] = useState(emptyPage), [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(''), [filterError, setFilterError] = useState(''), [accessLost, setAccessLost] = useState(false), [refresh, setRefresh] = useState(0);
  const generation = useRef(0), controller = useRef(null), mounted = useRef(false), load = useRef(null);
  const scope = `${staff.id}:${staff.role}:${staff.mode}`;
  // Hide the previous account's rows and media in this render, before effects
  // run or a replacement session/read resolves. Scope and rows commit together.
  const page = savedPage.scope === scope ? savedPage : emptyPage;
  const reading = loading || savedPage.scope !== scope;

  async function read({ cursor = null } = {}) {
    const token = ++generation.current;
    controller.current?.abort(); const active = new AbortController(); controller.current = active;
    if (cursor) setLoadingMore(true); else { setLoading(true); setPage({ ...emptyPage, scope }); }
    setError(''); setAccessLost(false);
    try {
      const session = await request('session', { signal: active.signal });
      if (session.staff?.id !== staff.id || session.staff?.role !== staff.role || session.staff?.mode !== staff.mode)
        throw Object.assign(new Error('Staff account changed'), { code: 'MANUAL_STAFF_CHANGED' });
      if (!mounted.current || token !== generation.current || active.signal.aborted) return;
      const result = readGradedCardsPage(await request(gradedCardsPath({ ...filters, ...(cursor ? { cursor } : {}) }), { signal: active.signal }));
      if (!mounted.current || token !== generation.current || active.signal.aborted) return;
      setPage(previous => ({ ...result, scope, cards: cursor && previous.scope === scope ? mergeGradedCards(previous.cards, result.cards) : result.cards }));
    } catch (failure) {
      if (!mounted.current || token !== generation.current || active.signal.aborted) return;
      if (archiveAccessFailure(failure)) { setAccessLost(true); setPage({ ...emptyPage, scope }); }
      setError(gradedCardsMessage(failure));
    } finally {
      if (mounted.current && token === generation.current) { setLoading(false); setLoadingMore(false); }
    }
  }
  load.current = read;
  useEffect(() => {
    mounted.current = true; setPage({ ...emptyPage, scope }); setError(''); setAccessLost(false);
    const invalidate = () => { generation.current++; controller.current?.abort(); };
    const hide = () => { invalidate(); setPage({ ...emptyPage, scope }); setLoading(true); };
    const show = event => { if (event.persisted) setRefresh(value => value + 1); };
    const endAccess = () => { hide(); setLoading(false); setLoadingMore(false); setAccessLost(true); setError(gradedCardsMessage({ status: 401 })); };
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show); window.addEventListener('atlas:verified-image-access-ended', endAccess);
    return () => { mounted.current = false; invalidate(); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); window.removeEventListener('atlas:verified-image-access-ended', endAccess); };
  }, [scope]);
  useEffect(() => { void load.current(); }, [scope, filters, refresh]);
  function apply(event) {
    event.preventDefault();
    try { const submitted = gradedCardsFormFilters(new FormData(event.currentTarget)); setDraft(submitted); setFilters(submitted); setFilterError(''); }
    catch (failure) { setFilterError(gradedCardsMessage(failure)); }
  }
  function clear() { setDraft(emptyFilters); setFilters({ ...emptyFilters }); setFilterError(''); }
  const change = (name, value) => setDraft(previous => ({ ...previous, [name]: value }));
  return <Shell staff={staff} title="Graded cards" manual className={styles.shell}>
    <main className={styles.page}>
      <header className={styles.heading}><div><p className={styles.eyebrow}>THE ATLAS ARCHIVE</p><h1>Graded cards</h1><p>Approved grades. Saved evidence. Every detail in reach.</p></div><button type="button" className={styles.refresh} disabled={reading || loadingMore} onClick={() => setRefresh(value => value + 1)}>Refresh archive ↻</button></header>
      <form className={styles.filters} onSubmit={apply} aria-label="Filter graded cards">
        <div className={styles.searchRow}><label className={styles.search}><span>Search graded cards</span><input name="q" type="search" value={draft.q} maxLength="120" onChange={event => change('q', event.target.value)} placeholder="Card, certificate, customer, order, or staff…"/></label><button className={styles.primary} type="submit">Search</button></div>
        <div className={styles.filterRow}><label>Category<select name="category" value={draft.category} onChange={event => change('category', event.target.value)}><option value="">All cards</option><option value="SPORTS">Sports</option><option value="POKEMON">Pokémon</option></select></label><label>Approved from<input name="from" type="date" value={draft.from} onChange={event => change('from', event.target.value)}/></label><label>Approved through<input name="to" type="date" value={draft.to} onChange={event => change('to', event.target.value)}/></label><button type="submit" className={styles.apply}>Apply filters</button>{(hasFilters(draft) || hasFilters(filters)) && <button type="button" className={styles.clear} onClick={clear}>Clear filters</button>}<span className={styles.dateNote}>Approval dates use UTC.</span></div>
        {filterError && <p className={styles.error} role="alert">{filterError}</p>}
      </form>
      <div className={styles.toolbar}><p role="status" aria-live="polite">{reading ? 'Loading approved cards…' : error && !page.cards.length ? 'Archive unavailable' : `${page.cards.length} ${page.cards.length === 1 ? 'card' : 'cards'} loaded${page.nextCursor ? ' · More available' : ''}`}<span>Newest approval first</span></p><div className={styles.viewSwitch} role="group" aria-label="Card view"><button type="button" aria-pressed={view === 'gallery'} onClick={() => setView('gallery')}>Gallery</button><button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button></div></div>
      {error && <div className={styles.errorBox} role="alert"><p>{error}</p>{accessLost ? <a href={STAFF_REAUTHENTICATE_PATH}>Sign in again</a> : <button type="button" onClick={() => void read({ cursor: page.cards.length ? page.nextCursor : null })}>Try again</button>}</div>}
      {reading ? <div className={styles.loading} aria-label="Loading graded-card archive"><span className={styles.loadingMark} aria-hidden="true">A</span><p>Opening the saved archive.</p></div> : !error && page.cards.length === 0 ? <section className={styles.empty}><span aria-hidden="true">A</span><h2>{hasFilters(filters) ? 'No cards match these filters.' : 'Your approved cards belong here.'}</h2><p>{hasFilters(filters) ? 'Try another name, certificate, submission reference, or approval date.' : 'When a card receives final human approval, its saved grade and report appear in this archive.'}</p>{hasFilters(filters) ? <button onClick={clear}>Clear filters</button> : <Link className={styles.primary} href="/batch?tab=REVIEW">Open review queue ↗</Link>}</section>
        : page.cards.length > 0 && (view === 'gallery' ? <section className={styles.grid} aria-label="Graded card gallery">{page.cards.map(card => <GalleryCard key={card.cardId} card={card} orderLinks={staff.customerOperationsEnabled && staff.role === 'REVIEWER'}/>)}</section> : <CardsTable cards={page.cards} orderLinks={staff.customerOperationsEnabled && staff.role === 'REVIEWER'}/>)}
      {page.nextCursor && !reading && !accessLost && <div className={styles.loadMore}><button className={styles.primary} disabled={loadingMore} onClick={() => void read({ cursor: page.nextCursor })}>{loadingMore ? 'Loading more cards…' : 'Load more cards'}</button></div>}
    </main>
  </Shell>;
}
