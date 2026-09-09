import { staffApiPath } from '../lib/routes.mjs';
import Link from 'next/link';
import { useState } from 'react';
import Shell, { Notice, Unavailable } from '../components/Shell';
import { useStaffResource } from '../lib/client';
import { pageAccess } from '../lib/server/runtime.mjs';
export function getServerSideProps(ctx) { return pageAccess(ctx); }
export const stateNames = { IN_REVIEW: 'In review', NEEDS_EVIDENCE: 'Needs evidence', READY_FOR_HUMAN: 'Ready for human review', HUMAN_APPROVED: 'Report approved' };
export default function Grading({ unavailable, staff }) { return unavailable ? <Unavailable /> : <Queue staff={staff}/>; }
function Queue({ staff }) {
    const resource = useStaffResource('cards');
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('ALL');
    const cards = resource.data?.cards ?? [];
    const visible = cards.filter(c => (filter === 'ALL' || c.disposition === filter) && `${c.title} ${c.set} ${c.id}`.toLowerCase().includes(query.toLowerCase()));
    return <Shell staff={staff}><main className="main-content">
    <div className="page-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h1>Review queue<span className="count">{cards.length}</span></h1><p className="muted">Review the graded report, make corrections and approve the final version.</p></div><span className="quiet-label">ASSIGNED TO YOU</span></div>
    <div className="summary-grid">{[['ALL', 'Assigned cards'], ['IN_REVIEW', 'In review'], ['NEEDS_EVIDENCE', 'Needs evidence'], ['READY_FOR_HUMAN', 'Ready for human review'], ['HUMAN_APPROVED', 'Report approved']].map(([key, name]) => <button key={key} onClick={() => setFilter(key)} className={`summary-card ${filter === key ? 'selected' : ''}`} aria-pressed={filter === key}><span>{name}</span><strong>{key === 'ALL' ? cards.length : cards.filter(c => c.disposition === key).length}</strong><i>{key === 'NEEDS_EVIDENCE' ? '↗' : '→'}</i></button>)}</div>
    <section className="queue-panel"><div className="panel-heading"><h2>{filter === 'ALL' ? 'All assigned cards' : stateNames[filter]}</h2><label className="search"><span aria-hidden="true">⌕</span><input aria-label="Search cards" placeholder="Search cards…" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
      {resource.loading ? <div className="empty-state" role="status">Loading your queue…</div> : resource.error ? <div className="empty-state"><Notice error>{resource.error}</Notice>{resource.signedOut ? <Link href="/">Sign in again</Link> : <button onClick={resource.reload}>Retry</button>}</div> : !visible.length ? <div className="empty-state"><h3>No cards here</h3><p>Try another filter or search.</p><button className="text-button" onClick={() => { setFilter('ALL'); setQuery(''); }}>Show all assigned cards</button></div> : <div className="queue-table"><div className="queue-columns"><span>CARD</span><span>EVIDENCE</span><span>STATUS</span><span /></div>{visible.map(card => <Link key={card.id} className="queue-row" href={`/cards/${card.id}`}><div className="card-name"><img src={staffApiPath(`evidence/${card.id}/FRONT`)} alt={`${card.title} front`} width="45" height="63"/><div><strong>{card.title}</strong><span>{card.set}</span><small>{card.id.toUpperCase()}{card.number ? ` · ${card.number}` : ''}</small></div></div><div className="evidence-count"><span className={card.evidenceComplete ? 'complete-dot' : 'warning-dot'}/>{card.evidenceComplete ? 'Front + Back' : 'Back missing'}</div><div><span className={`status-pill ${card.disposition.toLowerCase()}`}>{stateNames[card.disposition]}</span></div><span className="row-arrow" aria-hidden="true">↗</span></Link>)}</div>}
    </section>
    <p className="queue-note"><span>◇</span> Report approval records the final human review. Label, NFC and slab finishing are tracked separately.</p>
  </main></Shell>;
}
