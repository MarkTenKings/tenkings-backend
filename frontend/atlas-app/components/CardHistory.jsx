import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Shell from './Shell';
import ApprovedCardMedia from './ApprovedCardMedia';
import StaffCompCuration from './StaffCompCuration';
import StaffCompSearch from './StaffCompSearch';
import { api } from '../lib/client';
import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { orderDeskPagePath } from '../lib/order-desk-client.mjs';
import { approvedDate, approvedReportPath, archiveAccessFailure, gradedCardSubtitle, gradedCardTitle, gradedCardVariation, recordedGrade, submissionOrigin } from '../lib/graded-cards-client.mjs';
import { cardHistoryPath, historyAuditRows, historyAuditTime, historyEventDetail, historyEventTitle, historyReportPath, mergeCardHistory, readCardHistory } from '../lib/card-history-client.mjs';
import { ATLAS_SPORTS_ATTRIBUTE_LABELS as sportsLabels } from '@atlas/grading-core/identity';
import { groupSoldReferences, saleAmountLabel, saleDateLabel, saleGradeLabel } from '@atlas/manual-workspace/sold-references';
import { rememberCardDetailReportClick } from '@atlas/site-router/report-entry';
import archive from './GradedCards.module.css';
import styles from './CardHistory.module.css';

const sections = [['overview', 'Overview'], ['report', 'Grade report'], ['comps', 'Sold comps'], ['history', 'History']];
const categories = { SPORTS: 'Sports', POKEMON: 'Pokémon' };
const gradeCategories = [['centering', 'Centering'], ['corners', 'Corners'], ['edges', 'Edges'], ['surface', 'Surface']];
const compCardKey = card => JSON.stringify([card?.cardId, card?.approvalActionId, card?.sourceRevision, card?.sourceHash, card?.mode,
  card?.report?.publicToken, card?.report?.version, card?.report?.publicHash, card?.report?.reportHash]);
const scoreLabel = (value, exact = false) => Number.isFinite(value) && value >= 0 && value <= 10
  ? exact ? String(value) : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value) : 'Not recorded';

function sportsIdentityRows(attributes) {
  if (!attributes) return [];
  return [
    ['Printed serial', attributes.serial.presence === 'PRESENT' ? attributes.serial.printed : sportsLabels[attributes.serial.presence]],
    ['Autograph', [sportsLabels[attributes.autograph.presence], attributes.autograph.presence === 'PRESENT' && `${sportsLabels[attributes.autograph.type]} · Presence is not authentication`].filter(Boolean).join(' · ')],
    ['Relic', sportsLabels[attributes.relic.presence]],
    ...attributes.relic.windows.map(window => [`Relic · ${window.position}`, [window.material || 'Material unknown', sportsLabels[window.use], window.manufacturerStatement && `“${window.manufacturerStatement}”`].filter(Boolean).join(' · ')]),
  ];
}

function Facts({ rows }) {
  return <dl className={styles.factList}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not recorded'}</dd></div>)}</dl>;
}

export function CardOverview({ card, custody, orderLinks }) {
  const identity = card.identity ?? {}, submission = card.submission;
  const orderPath = orderLinks && submission ? orderDeskPagePath(submission.orderId) : null;
  return <div className={styles.overviewGrid}>
    <section aria-labelledby="identity-heading"><p className={styles.eyebrow}>THE CARD</p><h2 id="identity-heading">Every detail, on record.</h2>
      <Facts rows={[
        ['Category', categories[identity.category]], ['Year', identity.year], ['Manufacturer', identity.manufacturer],
        ['Set', identity.productSet], ['Card number', identity.cardNumber], ['Parallel / variant', identity.parallel],
        ...(identity.insert ? [['Insert', identity.insert]] : []), ...sportsIdentityRows(identity.sportsAttributes),
      ]}/>
    </section>
    <div className={styles.contextColumn}>
      <section aria-labelledby="submission-heading"><p className={styles.eyebrow}>SUBMISSION</p><h2 id="submission-heading">Where its Atlas story began.</h2>
        {submission ? <><Facts rows={[
          ['Submission', orderPath ? <Link href={orderPath}>{submission.reference || 'Open recorded submission'} <span aria-hidden="true">↗</span></Link> : submission.reference],
          ['Submitted by', submission.customer?.name], ['Origin', submissionOrigin(card)],
        ]}/><p className={styles.note}>Submission details describe the recorded intake. They do not establish ownership.</p></>
          : <p className={styles.body}>No customer submission is linked to this card.</p>}
      </section>
      <section className={styles.provenanceSummary} aria-labelledby="ownership-heading"><h3 id="ownership-heading">Ownership &amp; custody</h3>
        <Facts rows={[
          ['Ownership', 'Not recorded'], ['Custody history', custody.status === 'RECORDED' ? 'Handling events recorded' : 'Not recorded'],
          ['Current physical holder', 'Unknown'],
          ...(custody.latestRecorded ? [['Last recorded handoff', `${historyEventDetail(custody.latestRecorded)} · ${historyAuditTime(custody.latestRecorded.occurredAt)}`]] : []),
        ]}/><p className={styles.note}>A verified owner and current physical holder have not been established in this record. A recorded handoff does not confirm present custody.</p>
      </section>
    </div>
  </div>;
}

export function GradeSummary({ card, report }) {
  const summary = card.approvedSummary, available = summary?.state === 'AVAILABLE';
  return <section aria-labelledby="grade-heading">
    <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>THE APPROVED REPORT</p><h2 id="grade-heading">See what makes the grade.</h2></div><span className={styles.version}>Version {card.report?.version ?? 'not recorded'}</span></div>
    <p className={styles.body}>Open the saved report to inspect the approved photographs, findings and exact measurements.</p>
    {available ? <dl className={styles.subgrades}>{gradeCategories.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{scoreLabel(summary.subgrades?.[key])}</dd></div>)}</dl>
      : <p className={styles.unavailableNote}>Category scores are not available in this record. The saved report remains the source for grading details.</p>}
    <div className={styles.reportDetails}>
      <Facts rows={[
        ['Certificate', card.certificateNumber], ['ATLAS grade', recordedGrade(card)], ['Approved (UTC)', approvedDate(card.approvedAt)],
        ['Approved by', card.approver?.name],
        ...(card.reviewers?.length ? [['Review staff', card.reviewers.map(person => person.name || 'Name not recorded').join(', ')]] : []),
      ]}/>
      <div className={styles.reportCallout}><span className={styles.reportMark} aria-hidden="true">A</span><h3>The evidence, in full.</h3><p>Explore the findings in the report version saved with this approval.</p>
        {report ? <a className={archive.primary} href={report} referrerPolicy="no-referrer" rel="noreferrer" onClick={event => rememberCardDetailReportClick(event, report, card.cardId)}>Grade Report <span aria-hidden="true">↗</span></a> : <p className={styles.unavailableNote}>Public report publication is pending.</p>}
        <Link className={styles.workspaceLink} href={`/manual/${card.cardId}`}>Grading workspace <span aria-hidden="true">↗</span></Link>
      </div>
    </div>
    {available && <details className={styles.policy}><summary>Exact scores &amp; grading policy</summary><Facts rows={[
      ...gradeCategories.map(([key, label]) => [`${label} · exact`, scoreLabel(summary.subgrades?.[key], true)]),
      ['Scoring rule', summary.ruleVersion], ['Final-grade policy', summary.finalGradePolicy],
    ]}/><p className={styles.note}>Category tiles display up to two decimal places. The exact saved scores appear above; this page does not recalculate the approved grade.</p></details>}
  </section>;
}

function SalePhoto({ sale }) {
  const [failed, setFailed] = useState(false);
  return <div className={styles.salePhoto}>{sale.imageUrl && !failed ? <img src={sale.imageUrl} alt={`Listing photograph: ${sale.title}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : <span>Photo<br/>unavailable</span>}</div>;
}

export function SavedComparables({ card }) {
  const saved = card.savedComparables, sales = saved?.state === 'SAVED' ? saved.sales : [], groups = groupSoldReferences(sales);
  const [selected, setSelected] = useState('all');
  const group = groups.find(value => value.key === selected);
  const visible = (group ? group.candidates : sales).slice().sort((a, b) => (Date.parse(b.soldAt) || 0) - (Date.parse(a.soldAt) || 0));
  return <section aria-labelledby="comps-heading">
    <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>SAVED MARKET REFERENCES</p><h2 id="comps-heading">A look at recorded sales.</h2></div>{saved?.state === 'SAVED' && <span className={styles.version}>{sales.length} saved {sales.length === 1 ? 'sale' : 'sales'}</span>}</div>
    {saved?.state !== 'SAVED' ? <div className={styles.emptySection}><h3>No saved selection is available.</h3><p>Sold references appear here when a selection has been saved to this report. This does not mean no comparable sales exist.</p></div>
      : <><p className={styles.body}>The eBay sold listings saved with this report. Grading companies, grades and variants remain distinct; these references do not set this card’s value.</p>
        <div className={styles.compsToolbar}><p>Recorded {approvedDate(saved.observedAt)} <span>· Dates in UTC</span></p>{groups.length > 1 && <label><span>Show</span><select value={group ? selected : 'all'} onChange={event => setSelected(event.target.value)}><option value="all">All saved references ({sales.length})</option>{groups.map(value => <option key={value.key} value={value.key}>{value.label} · {value.identityLabel} ({value.candidates.length})</option>)}</select></label>}</div>
        {visible.length ? <ol className={styles.sales}>{visible.map(sale => <li key={sale.id}>
          <SalePhoto sale={sale}/><div className={styles.saleDescription}><p className={styles.saleGrade}>{saleGradeLabel(sale)}</p><h3>{sale.listingUrl ? <a href={sale.listingUrl} target="_blank" rel="noreferrer">{sale.title} <span aria-hidden="true">↗</span></a> : sale.title}</h3>
            <p className={styles.saleDate}>{sale.soldAt ? `Sold ${saleDateLabel(sale.soldAt)}` : 'Sale date unavailable'}</p>{[sale.language, sale.printing, sale.variant].some(Boolean) && <p className={styles.saleIdentity}>{[sale.language, sale.printing, sale.variant].filter(Boolean).join(' · ')}</p>}
            {sale.identityStatus !== 'MATCH' && <p className={styles.matchNote}>{sale.identityStatus === 'DIFFERENT' ? 'Identity differs from this card.' : 'Identity match is unconfirmed.'}</p>}
          </div><div className={styles.saleAmount}><strong>{saleAmountLabel(sale)}</strong>{sale.priceBasis === 'sold' && sale.currency && <span>{sale.currency} · disclosed sale price</span>}</div>
        </li>)}</ol> : <div className={styles.emptySection}><h3>No sales in the saved selection.</h3><p>This report currently has an empty selection of sold references.</p></div>}
      </>}
  </section>;
}

export function HistoryTimeline({ data }) {
  return <section className={styles.timeline} aria-labelledby="timeline-heading">
    <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>PROVENANCE</p><h2 id="timeline-heading">The recorded history.</h2></div><span className={styles.version}>Dates in UTC</span></div>
    <p className={styles.body}>Saved Atlas events, newest record first. Earlier history may be unknown.</p>
    <ol>{data.history.events.map(event => { const path = historyReportPath(event, data.card.report?.publicToken); return <li key={event.eventId}>
      <span className={`${styles.dot} ${event.category === 'CUSTODY' ? styles.custodyDot : ''}`} aria-hidden="true"/>
      <div className={styles.eventTop}><time dateTime={event.occurredAt || event.recordedAt}>{approvedDate(event.occurredAt || event.recordedAt)}</time><span className={styles.recordType}>{event.verification === 'SUBMITTER_REPORTED' ? 'Submitter reported' : 'Verified record'}</span></div>
      <h3>{historyEventTitle(event)}</h3><p>{historyEventDetail(event)}</p>
      {event.occurredAt && event.occurredAt.slice(0, 10) !== event.recordedAt.slice(0, 10) && <p className={styles.recordedAt}>Recorded {approvedDate(event.recordedAt)}</p>}
      <details className={styles.auditDetails}>
        <summary aria-label={`Record details: ${historyEventDetail(event)}`}>Record details</summary>
        <dl className={styles.auditFacts}>{historyAuditRows(event).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? 'Not recorded'}</dd></div>)}</dl>
        {!event.source && <p className={styles.auditNote}>Source details were not recorded in this history response.</p>}
      </details>
      {path && <a className={styles.reportLink} href={path} referrerPolicy="no-referrer" rel="noreferrer" onClick={event => rememberCardDetailReportClick(event, path, data.card.cardId)}>View this report version <span aria-hidden="true">↗</span></a>}
    </li>; })}</ol>
    {!data.history.events.length && <p className={styles.unavailableNote}>No recorded events are available for this card.</p>}
  </section>;
}

export default function CardHistory({ staff, cardId, request = api, compCurationEnabled = false, compCurationRequest, compSearchEnabled = false, compSearchRequest }) {
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(''), [accessLost, setAccessLost] = useState(false), [refresh, setRefresh] = useState(0);
  const [section, setSection] = useState('overview'), [dataScope, setDataScope] = useState('');
  const [compRefresh, setCompRefresh] = useState(0), [, setCompBlocked] = useState(false);
  const compSelection = useRef({ key: null, pending: false, queued: null, lastReady: null });
  const generation = useRef(0), current = useRef(null), mounted = useRef(false), load = useRef(null), compContext = useRef(null);
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
      // Validate before the React state updater so malformed pagination stays recoverable.
      const value = cursor ? mergeCardHistory(data, next) : next;
      setDataScope(scope); setData(value);
    } catch (failure) {
      if (!active()) return;
      if (archiveAccessFailure(failure)) { setData(null); setAccessLost(true); setError('Your staff access needs to be checked. Sign in again to open this card.'); }
      else if (failure?.status === 404) { setData(null); setError('This approved card is unavailable to this account.'); }
      else setError('The card could not be read. Try again to load its saved records.');
    } finally { if (active()) { setLoading(false); setLoadingMore(false); } }
  }
  load.current = read;
  useEffect(() => {
    mounted.current = true;
    const invalidate = () => { generation.current++; current.current?.abort(); };
    const hide = () => { invalidate(); setData(null); setLoading(true); setError(''); };
    const show = event => { if (event.persisted) setRefresh(value => value + 1); };
    const endAccess = () => { hide(); setLoading(false); setLoadingMore(false); setAccessLost(true); setError('Your staff access needs to be checked. Sign in again to open this card.'); };
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show); window.addEventListener('atlas:verified-image-access-ended', endAccess);
    return () => { mounted.current = false; invalidate(); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); window.removeEventListener('atlas:verified-image-access-ended', endAccess); };
  }, [scope]);
  useEffect(() => { setSection('overview'); }, [scope]);
  useEffect(() => { void load.current(); }, [scope, refresh]);
  const visible = dataScope === scope ? data : null, card = visible?.card, report = approvedReportPath(card);
  const compOwner = { generation: generation.current, staff, actor: `${staff.id}:${staff.role}:${staff.mode}`, card, cardKey: compCardKey(card),
    request: compCurationRequest, searchRequest: compSearchRequest, enabled: compCurationEnabled || compSearchEnabled, section };
  compContext.current = compOwner;
  const selectionKey = `${scope}:${compOwner.cardKey}`;
  if (compSelection.current.key !== selectionKey) compSelection.current = { key: selectionKey, pending: false, queued: null, lastReady: null };
  function compCurrent() {
    const now = compContext.current;
    return !(!mounted.current || generation.current !== compOwner.generation || now.staff !== compOwner.staff || now.actor !== compOwner.actor
      || `${staff.id}:${staff.role}:${staff.mode}` !== compOwner.actor || now.card !== compOwner.card || compCardKey(card) !== compOwner.cardKey
      || now.cardKey !== compOwner.cardKey || now.request !== compOwner.request || now.searchRequest !== compOwner.searchRequest || now.enabled !== true || now.section !== 'comps');
  }
  function endCompAccess() {
    if (!compCurrent()) return;
    generation.current++; current.current?.abort(); setData(null); setLoading(false); setLoadingMore(false); setAccessLost(true);
    setError('Your staff access needs to be checked. Sign in again to open this card.');
  }
  function flushCompPool() {
    const selection = compSelection.current;
    if (!compCurrent() || selection.key !== selectionKey || selection.pending || !selection.queued) return;
    selection.lastReady = selection.queued; selection.queued = null; setCompRefresh(value => value + 1);
  }
  function compPoolReady(value) {
    if (!compCurrent() || value.approvalActionId !== card?.approvalActionId) return;
    const selection = compSelection.current;
    if (selection.key !== selectionKey || selection.lastReady === value.previewId) return;
    selection.queued = value.previewId; flushCompPool();
  }
  function compPendingChanged(value) {
    if (!compCurrent() || compSelection.current.key !== selectionKey) return;
    compSelection.current.pending = value === true; setCompBlocked(value === true); flushCompPool();
  }
  function selectWithKeyboard(event, index) {
    const next = event.key === 'ArrowRight' ? (index + 1) % sections.length : event.key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setSection(sections[next][0]); event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
  }
  return <Shell staff={staff} title={card ? `${gradedCardTitle(card)} · Card details` : 'Card details'} manual className={archive.shell}>
    <main className={`${archive.page} ${styles.page}`}>
      <div className={styles.navigation}><Link href="/graded-cards"><span aria-hidden="true">←</span> Graded cards</Link><button type="button" disabled={loading || loadingMore} onClick={() => setRefresh(value => value + 1)}>Refresh record <span aria-hidden="true">↻</span></button></div>
      {error && <div className={archive.errorBox} role="alert"><p>{error}</p>{accessLost ? <a href={STAFF_REAUTHENTICATE_PATH}>Sign in again</a> : <button type="button" onClick={() => void read(visible?.history.nextCursor ?? undefined)}>Try again</button>}</div>}
      {loading ? <div className={archive.loading} role="status"><span className={archive.loadingMark} aria-hidden="true">A</span><p>Opening the saved card.</p></div> : visible && <>
        <section className={styles.hero} aria-label="Card details">
          <div className={styles.heroMedia}><ApprovedCardMedia key={`${card.cardId}:${card.approvalActionId}`} card={card} mode="detail"/></div>
          <div className={styles.identity}><p className={styles.eyebrow}>{categories[card.identity?.category] || 'ATLAS ARCHIVE'}</p><h1>{gradedCardTitle(card)}</h1>
            {gradedCardSubtitle(card) && <p className={styles.subtitle}>{gradedCardSubtitle(card)}</p>}{gradedCardVariation(card) && <p className={styles.variation}>{gradedCardVariation(card)}</p>}
            <p className={styles.certificate}><span>Certificate</span><strong>{card.certificateNumber || 'Not recorded'}</strong></p>
            <div className={styles.grade}>
              <div className={styles.award}><span>ATLAS GRADE</span><strong>{recordedGrade(card)}</strong></div>
              {report ? <a className={styles.reportTile} href={report} aria-label="Grade Report" referrerPolicy="no-referrer" rel="noreferrer" onClick={event => rememberCardDetailReportClick(event, report, card.cardId)}>
                <svg className={styles.reportPaper} viewBox="0 0 126 146" fill="none" aria-hidden="true"><path className={styles.paperOutline} d="M8 1H102L125 24V138A7 7 0 0 1 118 145H8A7 7 0 0 1 1 138V8A7 7 0 0 1 8 1Z"/><path className={styles.paperFold} d="M102 1V17A7 7 0 0 0 109 24H125"/><path className={styles.paperLines} d="M20 34H51M20 43H66M20 52H58"/></svg>
                <span className={styles.reportTileLabel}>Grade<br/>Report <span aria-hidden="true">↗</span></span>
              </a> : <p className={styles.unavailableNote}>Public report publication is pending.</p>}
            </div>
          </div>
        </section>
        <div className={styles.tabs} role="tablist" aria-label="Card details">{sections.map(([id, label], index) => <button type="button" key={id} role="tab" id={`card-tab-${id}`} aria-controls={`card-panel-${id}`} aria-selected={section === id} tabIndex={section === id ? 0 : -1} onKeyDown={event => selectWithKeyboard(event, index)} onClick={() => setSection(id)}>{label}</button>)}</div>
        {sections.map(([id]) => <div key={id} id={`card-panel-${id}`} role="tabpanel" aria-labelledby={`card-tab-${id}`} hidden={section !== id} tabIndex={0} className={styles.panel}>
          {section === id && (id === 'overview' ? <CardOverview card={card} custody={visible.custody} orderLinks={staff.customerOperationsEnabled === true}/>
            : id === 'report' ? <GradeSummary card={card} report={report}/>
              : id === 'comps' ? <><SavedComparables key={card.approvalActionId} card={card}/>
                {compSearchEnabled === true && typeof compSearchRequest === 'function' && <StaffCompSearch
                  key={`search:${card.cardId}:${card.approvalActionId}`} staff={staff} card={card} enabled request={compSearchRequest}
                  accessState={accessLost ? 'ENDED' : 'READY'} isSelectionPending={() => !compCurrent() || compSelection.current.pending}
                  onReady={compPoolReady} onAccessLost={endCompAccess}/>}
                {compCurationEnabled === true && typeof compCurationRequest === 'function' && <StaffCompCuration
                  key={`${card.cardId}:${card.approvalActionId}`} staff={staff} card={card} enabled accessState={accessLost ? 'ENDED' : 'READY'}
                  request={compCurationRequest} onAccessLost={endCompAccess} refreshToken={compRefresh} onPendingChange={compPendingChanged}/>}</>
                : <><HistoryTimeline data={visible}/>{visible.history.nextCursor && !accessLost && <div className={styles.loadMore}><button className={archive.primary} type="button" disabled={loadingMore} onClick={() => void read(visible.history.nextCursor)}>{loadingMore ? 'Loading history…' : 'Load earlier events'}</button></div>}</>)}
        </div>)}
        <p className={styles.recordNote}>This archive preserves recorded approvals and their evidence. Ownership, physical custody and later transactions require their own records.</p>
      </>}
    </main>
  </Shell>;
}
