import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Shell, { Notice, Unavailable } from '../components/Shell';
import { PhotoPreview, Readiness, RecoveryNotice, StateBadge } from '../components/WorkspaceShared';
import { useGradingQueue } from '../lib/useGradingQueue';
import { useWorkspaceMutation } from '../lib/useWorkspaceMutation';
import { queueCards, stageNames, stateNames, verifiedSide, workspaceCardPath } from '../lib/workspace-client.mjs';
import { pageAccess } from '../lib/server/runtime.mjs';
import styles from '../components/WorkspaceUi.module.css';
export { stateNames } from '../lib/workspace-client.mjs';
export function getServerSideProps(ctx) { return pageAccess(ctx); }
export default function Grading({ unavailable, staff }) { return unavailable ? <Unavailable /> : <Queue staff={staff} />; }
function Queue({ staff }) {
    const router = useRouter(), { resource, assigned } = useGradingQueue(staff.id);
    const [query, setQuery] = useState(''), [cards, setCards] = useState([]);
    const filter = Object.hasOwn(stateNames, router.query.queue) ? router.query.queue : 'WAITING';
    useEffect(() => { if (resource.data) setCards(resource.data.cards ?? []); }, [resource.data]);
    const mutation = useWorkspaceMutation({ staffId: staff.id, cardId: 'queue', csrf: resource.session?.csrf,
        onCard: card => setCards(previous => previous.map(value => value.id === card.id ? card : value)) });
    const existing = new Set(cards.map(card => card.specimenId).filter(Boolean));
    const historicStates = { IN_REVIEW: 'IN_PROGRESS', NEEDS_EVIDENCE: 'NEEDS_ATTENTION', READY_FOR_HUMAN: 'HUMAN_REVIEW', HUMAN_APPROVED: 'APPROVED' };
    const historic = (assigned.data?.cards ?? []).filter(card => !existing.has(card.id)).map(card => ({ ...card, legacyReview: true, state: historicStates[card.disposition] ?? 'IN_PROGRESS', subtitle: card.set, stage: card.disposition === 'HUMAN_APPROVED' ? 'FINISHING' : 'REVIEW', specimenId: card.id }));
    const all = [...cards, ...historic], visible = queueCards(all, filter, query), disabled = mutation.busy || Boolean(mutation.pending) || !mutation.ready;
    const assignedIncomplete = assigned.loading || assigned.error || assigned.signedOut;
    const queueIncomplete = state => resource.loading || resource.error || resource.signedOut
        || (Object.values(historicStates).includes(state) && assignedIncomplete);
    async function claim(card, operator) {
        if (disabled || card.legacyReview || card.state !== 'WAITING') return;
        const claimed = await mutation.mutate(`${workspaceCardPath(card.id)}/claim`, { expectedRevision: card.revision, operator, ...(operator === 'ASTRA' ? { mode: 'STEP' } : {}) }, card.id);
        if (claimed) router.push(`/workspace/${claimed.id}`);
    }
    return <Shell staff={staff} title="Grading workspace"><main className="main-content">
        <div className={styles.queueHeading}><div><p className="eyebrow">GRADING WORKSPACE</p><h1>Every card, from first photo to approval.</h1><p className="muted">Choose a ready card to grade, watch work in progress, or review a finished draft.</p></div>{staff.role !== 'OBSERVER' && <Link className="primary" href="/add-cards">+ Add cards</Link>}</div>
        <div className={styles.queueTabs} aria-label="Grading queues">{Object.entries(stateNames).map(([state, title]) => <Link key={state} href={`/grading?queue=${state}`} className={`${styles.queueTab} ${filter === state ? styles.selected : ''}`} aria-current={filter === state ? 'page' : undefined}><span>{title}</span><strong>{queueIncomplete(state) ? '—' : all.filter(card => card.state === state).length}</strong></Link>)}</div>
        <RecoveryNotice mutation={mutation} />
        <section className={styles.queuePanel}><div className={styles.panelHeading}><div><h2>{stateNames[filter]}</h2><p className={styles.help}>{filter === 'WAITING' ? 'Verified photo pairs, ready for one human or Astra to claim.' : filter === 'HUMAN_REVIEW' ? 'Completed drafts awaiting explicit human report approval.' : filter === 'DRAFT' ? 'Incomplete photo pairs stay here until both originals are verified.' : filter === 'APPROVED' ? 'Human-approved reports. Label, NFC and slab finishing remain separate.' : filter === 'NEEDS_ATTENTION' ? 'Cards with a recorded request for evidence or operator attention.' : 'Watch the current operator without taking control.'}</p></div><label className="search"><span aria-hidden="true">⌕</span><input aria-label="Search cards" placeholder="Search card names…" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
            {resource.loading ? <div className="empty-state" role="status">Loading saved cards…</div> : resource.error ? <div className="empty-state"><Notice error>{resource.error}</Notice>{resource.signedOut ? <Link href="/?reauthenticate=1">Sign in again</Link> : <button onClick={resource.reload}>Reload workspace</button>}</div> : !visible.length && queueIncomplete(filter) ? <div className="empty-state" role="status">{assigned.loading ? "Loading assigned reports…" : "Assigned reports have not loaded. This queue may contain additional cards."}</div> : !visible.length ? <div className={styles.emptyQueue}><span aria-hidden="true">◇</span><h3>{query ? 'No cards match that search' : `No cards in ${stateNames[filter].toLowerCase()}`}</h3><p>{filter === 'WAITING' || filter === 'DRAFT' ? 'Add new Front and Back photographs, verify them, then confirm each physical card’s pair.' : 'Cards appear here when their recorded workflow reaches this stage.'}</p>{query ? <button type="button" onClick={() => setQuery('')}>Clear search</button> : staff.role !== 'OBSERVER' && <Link href="/add-cards" className="primary">Add the first photo pair <span>→</span></Link>}</div> : <div className={styles.queueRows}>{visible.map(card => <article className={styles.queueRow} key={`${card.legacyReview ? 'report' : 'workspace'}:${card.id}`}><Link className={styles.queueCardTitle} href={card.legacyReview ? `/cards/${card.id}` : `/workspace/${card.id}`}><div className={styles.queueThumbnail}>{card.legacyReview ? <span aria-hidden="true">◇</span> : <PhotoPreview card={card} side="FRONT" />}</div><div><strong>{card.title}</strong><p>{card.subtitle || (card.legacyReview ? 'Assigned report' : 'Fresh photo card')}</p><small>{card.legacyReview ? (card.evidenceComplete ? 'Front + Back available' : 'Evidence needs attention') : `${verifiedSide(card, 'FRONT') ? 'Front verified' : 'Front needed'} · ${verifiedSide(card, 'BACK') ? 'Back verified' : 'Back needed'}`}</small></div></Link><div className={styles.queueOwnership}><StateBadge state={card.state} /><span>{card.operator ? `${card.operator.kind === 'ASTRA' ? 'Astra' : card.operator.name || 'Human grader'} · ${stageNames[card.stage]}` : stageNames[card.stage]}</span>{card.attention && <small>{typeof card.attention === 'string' ? card.attention : card.attention.message}</small>}</div><div className={styles.queueRowActions}>{!card.legacyReview && card.state === 'WAITING' && <><button type="button" disabled={disabled || card.capabilities?.humanClaim !== true} onClick={() => claim(card, 'HUMAN')}>Grade this card</button><button type="button" disabled={disabled || card.capabilities?.astraClaim !== true} onClick={() => claim(card, 'ASTRA')}>Start Astra · step mode</button></>}<Link href={card.legacyReview ? `/cards/${card.id}` : `/workspace/${card.id}`}>{card.state === 'HUMAN_REVIEW' ? 'Review report' : card.state === 'IN_PROGRESS' ? 'Open / watch' : 'Open card'} ↗</Link></div></article>)}</div>}
        </section>
        {(assigned.error || assigned.signedOut) && <Notice error>Existing assigned reports could not be loaded. {assigned.error || 'Your session ended. Sign in again to continue.'} {assigned.signedOut ? <Link href="/?reauthenticate=1">Sign in again</Link> : <button type="button" onClick={assigned.reload}>Reload assigned reports</button>}</Notice>}
        <Readiness readiness={resource.data?.readiness} />
        <p className={styles.queueNote}>A completed grading draft enters Human review. Only an explicit human approval publishes the exact saved report.</p>
    </main></Shell>;
}
