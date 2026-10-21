import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Shell from './Shell';
import { api } from '../lib/client';
import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { approvedDate, approvedReportPath, archiveAccessFailure, gradedCardSubtitle, gradedCardTitle, recordedGrade } from '../lib/graded-cards-client.mjs';
import { cardHistoryPath, historyEventDetail, historyEventTitle, historyPhotoPath, historyReportPath, mergeCardHistory, readCardHistory } from '../lib/card-history-client.mjs';
import archive from './GradedCards.module.css';
import styles from './CardHistory.module.css';

function EvidencePhoto({ card }) {
  const [side, setSide] = useState('FRONT'), [failed, setFailed] = useState([]);
  const path = historyPhotoPath(card, side), available = path && !failed.includes(path);
  return <div className={styles.evidence}>
    <div className={styles.photo}>{available ? <a href={path} target="_blank" rel="noreferrer" aria-label={`Open approved ${side.toLowerCase()} photograph`}><img src={path} alt={`${gradedCardTitle(card)} · approved ${side.toLowerCase()} photograph`} onError={() => setFailed(previous => [...previous, path])}/></a>
      : <div className={styles.noPhoto}><span>ATLAS</span><p>Approved photograph unavailable</p><small>Open the grading workspace to inspect saved evidence.</small></div>}</div>
    <div className={styles.sideSwitch} role="group" aria-label="Photograph side">{['FRONT', 'BACK'].map(value => <button key={value} type="button" aria-pressed={side === value} onClick={() => setSide(value)}>{value === 'FRONT' ? 'Front' : 'Back'}</button>)}</div>
    <p className={styles.caption}>Approved grading photograph</p>
  </div>;
}

function HistoryTimeline({ data }) {
  return <section className={styles.timeline} aria-labelledby="timeline-heading">
    <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>PROVENANCE</p><h2 id="timeline-heading">The recorded history.</h2></div><span>Dates in UTC</span></div>
    <p className={styles.intro}>Saved Atlas events, newest record first. Earlier history may be unknown.</p>
    <ol>{data.history.events.map(event => { const path = historyReportPath(event, data.card.report?.publicToken); return <li key={event.eventId}>
      <span className={`${styles.dot} ${event.category === 'CUSTODY' ? styles.custodyDot : ''}`} aria-hidden="true"/>
      <div className={styles.eventTop}><time dateTime={event.occurredAt || event.recordedAt}>{approvedDate(event.occurredAt || event.recordedAt)}</time><span className={styles.recordType}>{event.verification === 'SUBMITTER_REPORTED' ? 'Submitter reported' : 'Verified record'}</span></div>
      <h3>{historyEventTitle(event)}</h3><p>{historyEventDetail(event)}</p>
      {event.occurredAt && event.occurredAt.slice(0, 10) !== event.recordedAt.slice(0, 10) && <p className={styles.recordedAt}>Recorded {approvedDate(event.recordedAt)}</p>}
      {path && <a className={styles.reportLink} href={path}>View this report version ↗</a>}
    </li>; })}</ol>
    {!data.history.events.length && <p className={styles.intro}>No recorded events are available for this card.</p>}
  </section>;
}

export default function CardHistory({ staff, cardId, request = api }) {
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(''), [accessLost, setAccessLost] = useState(false), [refresh, setRefresh] = useState(0);
  const generation = useRef(0), current = useRef(null), mounted = useRef(false), load = useRef(null);
  const scope = `${staff.id}:${staff.role}:${staff.mode}:${cardId}`;
  async function read(cursor) {
    const token = ++generation.current;
    current.current?.abort(); const controller = new AbortController(); current.current = controller;
    if (cursor) setLoadingMore(true); else { setLoading(true); setData(null); }
    setError(''); setAccessLost(false);
    const active = () => mounted.current && token === generation.current && !controller.signal.aborted;
    try {
      const session = await request('session', { signal: controller.signal });
      if (!active()) return;
      if (session.staff?.id !== staff.id || session.staff?.role !== staff.role || session.staff?.mode !== staff.mode)
        throw Object.assign(new Error('Staff account changed'), { code: 'MANUAL_STAFF_CHANGED' });
      const next = readCardHistory(await request(cardHistoryPath(cardId, { cursor }), { signal: controller.signal }), cardId);
      if (!active()) return;
      // Validate before the React state updater so malformed pagination remains
      // a recoverable read error rather than an exception during rendering.
      const value = cursor ? mergeCardHistory(data, next) : next;
      setData(value);
    } catch (failure) {
      if (!active()) return;
      if (archiveAccessFailure(failure)) { setData(null); setAccessLost(true); setError('Your staff access needs to be checked. Sign in again to open this history.'); }
      else setError(failure?.status === 404 ? 'This approved card is unavailable to this account.' : 'The card history could not be read. Try again to load its saved records.');
    } finally { if (active()) { setLoading(false); setLoadingMore(false); } }
  }
  load.current = read;
  useEffect(() => {
    mounted.current = true;
    const invalidate = () => { generation.current++; current.current?.abort(); };
    const hide = () => { invalidate(); setData(null); setLoading(true); setError(''); };
    const show = event => { if (event.persisted) setRefresh(value => value + 1); };
    const endAccess = () => { hide(); setLoading(false); setLoadingMore(false); setAccessLost(true); setError('Your staff access needs to be checked. Sign in again to open this history.'); };
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show); window.addEventListener('atlas:verified-image-access-ended', endAccess);
    return () => { mounted.current = false; invalidate(); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); window.removeEventListener('atlas:verified-image-access-ended', endAccess); };
  }, [scope]);
  useEffect(() => { void load.current(); }, [scope, refresh]);
  const card = data?.card, report = approvedReportPath(card);
  return <Shell staff={staff} title="Card history" manual className={archive.shell}>
    <main className={`${archive.page} ${styles.page}`}>
      <div className={styles.navigation}><Link href="/graded-cards">← Graded cards</Link><button type="button" disabled={loading || loadingMore} onClick={() => setRefresh(value => value + 1)}>Refresh history ↻</button></div>
      {error && <div className={archive.errorBox} role="alert"><p>{error}</p>{accessLost ? <a href={STAFF_REAUTHENTICATE_PATH}>Sign in again</a> : <button type="button" onClick={() => void read(data?.history.nextCursor ?? undefined)}>Try again</button>}</div>}
      {loading ? <div className={archive.loading} role="status"><span className={archive.loadingMark} aria-hidden="true">A</span><p>Opening the saved history.</p></div> : data && <>
        <section className={styles.hero} aria-label="Card record">
          <EvidencePhoto key={`${card.cardId}:${card.approvalActionId}`} card={card}/>
          <div className={styles.identity}><p className={styles.eyebrow}>ONE CARD. ITS RECORDED STORY.</p><h1>{gradedCardTitle(card)}</h1><p className={styles.subtitle}>{gradedCardSubtitle(card)}</p><p className={styles.cert}>{card.certificateNumber}</p>
            <div className={styles.grade}><span>ATLAS</span><strong>{recordedGrade(card)}</strong><span>Approved<br/>{approvedDate(card.approvedAt)}</span></div>
            <div className={styles.actions}>{report && <a className={archive.primary} href={report}>View grade report ↗</a>}<Link href={`/manual/${cardId}`}>Open grading workspace ↗</Link></div>
            <div className={styles.facts}><div><span>Ownership</span><strong>Not recorded</strong><p>No verified owner is recorded yet.</p></div><div><span>Custody</span><strong>{data.custody.status === 'RECORDED' ? 'Handling history available' : 'Not recorded'}</strong><p>Current physical holder is unconfirmed.</p></div></div>
          </div>
        </section>
        <HistoryTimeline data={data}/>
        {data.history.nextCursor && !accessLost && <div className={archive.loadMore}><button className={archive.primary} type="button" disabled={loadingMore} onClick={() => void read(data.history.nextCursor)}>{loadingMore ? 'Loading history…' : 'Load earlier events'}</button></div>}
      </>}
    </main>
  </Shell>;
}
