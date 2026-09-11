import { useEffect, useRef, useState } from 'react';
import { Notice } from './Shell';
import { PhotoPreview, ReportLink } from './WorkspaceShared';
import WorkspaceIcon from './WorkspaceIcon';
import { stageNames, workspaceCardPath, workspaceMessage, workspaceRequest } from '../lib/workspace-client.mjs';
import styles from './WorkspaceUi.module.css';

const stateLabel = { UNAVAILABLE: 'Awaiting connection', QUEUED: 'Astra is ready', RUNNING: 'Astra is working', PAUSE_REQUESTED: 'Finishing the current action', PAUSED: 'Astra is paused', TAKEN_OVER: 'Human at the controls', COMPLETED: 'Astra draft complete', NEEDS_ATTENTION: 'Astra needs attention', UNKNOWN: 'Astra needs attention', FAILED: 'Astra needs attention', WAITING_REVIEW: 'Ready for human review' };
const statusLabel = { PROPOSED: 'Proposal saved', REQUESTED: 'Requested', RECORDED: 'Saved', NEEDS_ATTENTION: 'Needs attention', APPLIED: 'Applied', UNKNOWN: 'Awaiting confirmation', UNAVAILABLE: 'Details unavailable' };
const clockTime = value => { const date = new Date(value); return Number.isFinite(+date) ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—'; };

export function operatorPresentation(control, card) {
    if (!control) return { label: card.operator?.kind === 'HUMAN' ? 'Human at the controls' : 'Connecting to Astra', tone: 'idle', description: 'Opening the saved activity for this card.' };
    const attention = ['NEEDS_ATTENTION', 'UNKNOWN', 'FAILED'].includes(control.state);
    if (attention) return { label: 'Astra needs attention', tone: 'attention', description: control.pending ? 'A saved action needs recovery. Your photos and earlier results are retained.' : 'Work has stopped at a recorded issue. Your card and its saved results are kept.' };
    if (control.state === 'WAITING_REVIEW' || card.state === 'HUMAN_REVIEW') return { label: 'Ready for human review', tone: 'complete', description: 'The draft is ready. A human reviewer makes the final call.' };
    const description = control.state === 'RUNNING' ? `${stageNames[card.stage] ?? 'Grading'} is in progress. ${control.mode === 'STEP' ? 'Astra will pause after this step.' : 'Astra continues through the grading stages.'}`
        : control.state === 'QUEUED' ? 'The next action is queued and will start when the operator is available.'
            : control.state === 'PAUSE_REQUESTED' ? 'Pause is saved. The action already in progress will settle first.'
                : control.state === 'PAUSED' ? 'Your progress is saved. Resume Astra whenever you are ready.'
                    : control.state === 'TAKEN_OVER' ? 'Manual grading is active. Astra’s original proposals remain available.'
                        : control.state === 'COMPLETED' ? 'Astra has finished this recorded run.'
                            : 'Astra will appear here after an operator starts.';
    return { label: stateLabel[control.state] ?? 'Checking saved state', tone: control.state === 'RUNNING' ? 'running' : control.state === 'COMPLETED' ? 'complete' : 'idle', description };
}

function SavedEvidence({ entry, card }) {
    const originals = ['read_original_photos', 'inspect_original'].includes(entry.type)
        ? [...new Set((entry.evidence ?? []).map(evidence => evidence.side).filter(side => ['FRONT', 'BACK'].includes(side)))] : [];
    return <>{originals.length > 0 && <div className={styles.activityPhotos}>{originals.map(side => <figure key={side}><PhotoPreview card={card} side={side} /><figcaption>{side === 'FRONT' ? 'Front' : 'Back'} original</figcaption></figure>)}</div>}
        {entry.evidence?.length > 0 && <div className={styles.inspectedEvidence}>{entry.evidence.map((evidence, index) => <span key={index}>{evidence.side === 'FRONT' ? 'Front' : 'Back'}{evidence.rect ? ` · ${evidence.rect.width} × ${evidence.rect.height} px region` : ' inspected'}</span>)}</div>}
        {entry.measurements && <div className={styles.activityMeasurements}><p><span>Centering · {entry.measurements.side === 'FRONT' ? 'Front' : 'Back'}</span><strong>{entry.measurements.score.toFixed(2)}</strong></p>{[['leftRightBalance', 'Left / right'], ['topBottomBalance', 'Top / bottom']].map(([key, label]) => Array.isArray(entry.measurements[key]) && <p key={key}><span>{label}</span><strong>{entry.measurements[key].map(value => `${Number(value.toFixed(1))}%`).join(' / ')}</strong></p>)}</div>}
    </>;
}

export default function WorkspaceActivity({ card, disabled, onControl, onObservedCard }) {
    const [snapshot, setSnapshot] = useState(null), [error, setError] = useState(''), [refreshing, setRefreshing] = useState(false), [watch, setWatch] = useState(true), [generation, setGeneration] = useState(0), [lastReadAt, setLastReadAt] = useState(null);
    const observed = useRef(onObservedCard); observed.current = onObservedCard;
    useEffect(() => {
        let active = true, timer; const controller = new AbortController();
        async function load() {
            setRefreshing(true); let failed = false;
            try {
                // Both are reads, ordered to avoid contending for the staff
                // authorization transaction with another request from this view.
                const latest = await workspaceRequest(workspaceCardPath(card.id), { signal: controller.signal });
                if (!active) return;
                if (latest.card?.id === card.id) observed.current?.(latest.card);
                const next = await workspaceRequest(`${workspaceCardPath(card.id)}/activity`, { signal: controller.signal });
                if (active) { setSnapshot({ ...next, cardId: card.id }); setLastReadAt(new Date().toISOString()); setError(''); }
            } catch (cause) { failed = true; if (active) setError(workspaceMessage(cause)); }
            finally { if (active) { setRefreshing(false); if (watch) timer = setTimeout(load, failed ? 8000 : 4000); } }
        }
        load(); return () => { active = false; clearTimeout(timer); controller.abort(); };
    }, [card.id, watch, generation]);
    const current = snapshot?.cardId === card.id ? snapshot : null, control = current?.control;
    const activity = [...(current?.activity ?? [])].sort((first, second) => Date.parse(second.at) - Date.parse(first.at));
    const presentation = operatorPresentation(control, card), pausedView = !watch || Boolean(error);
    const connection = error ? 'Updates interrupted' : !watch ? 'Updates paused' : current ? 'Live updates on' : 'Connecting';
    return <section className={`${styles.activity} ${styles[`activity${presentation.tone}`] ?? ''}`} aria-label="Astra controls and live activity">
        <div className={styles.controllerHeading}><div><p>ASTRA CONTROL</p><h2>Watch Astra</h2></div><label className={styles.liveToggle}><input type="checkbox" checked={watch} onChange={event => setWatch(event.target.checked)} aria-label="Keep activity updated" /><span aria-hidden="true" /></label></div>
        <div className={styles.connectionState}><span className={watch && !error && current ? styles.connectedDot : styles.disconnectedDot} aria-hidden="true" />{connection}<span className={styles.connectionMode}>{control?.mode === 'CONTINUOUS' ? 'Continuous' : control?.mode === 'STEP' ? 'Step mode' : 'Workspace'}</span></div>
        <div className={styles.operatorStatus}><div className={styles.operatorEmblem} aria-hidden="true"><span>A</span><i /><i /><i /><i /></div><div>{pausedView && <small>Last saved state</small>}<strong role="status">{presentation.label}</strong><p>{presentation.description}</p></div></div>
        <div className={styles.controllerReadout}><div><span>CURRENT STAGE</span><strong>{stageNames[card.stage] ?? 'Grading'}</strong></div><div><span>RECENT ACTIONS</span><strong>{current ? String(activity.length).padStart(2, '0') : '—'}</strong></div></div>
        {Boolean(control?.pending) && <div className={`${styles.pendingAction} ${presentation.tone === 'attention' ? styles.pendingAttention : ''}`}><WorkspaceIcon name={presentation.tone === 'attention' ? 'ATTENTION' : 'FEED'} /><p>{control?.canRecover ? 'Astra’s response is saved. Continue from that response to pick up where this card stopped.' : presentation.tone === 'attention' ? 'A previous action has not been confirmed. Recovery must finish before another action can start.' : `${control.pending === 1 ? 'One action is' : `${control.pending} actions are`} in progress. The saved result will appear in the feed.`}</p></div>}
        {control?.canRecover === true && <div className={styles.continueSaved}><button type="button" disabled={disabled} onClick={() => onControl('RECOVER')}><WorkspaceIcon name="PLAY" /><span>Continue Astra</span><span aria-hidden="true">→</span></button><p>Continue from the saved response</p></div>}
        <div className={styles.operatorControls}>{[['PAUSE', 'Pause Astra', 'canPause', 'PAUSE'], ['RESUME', 'Resume Astra', 'canResume', 'PLAY'], ['STEP', 'Run next step', 'canStep', 'STEP'], ['TAKE_OVER', 'Take over manually', 'canTakeOver', 'TAKE_OVER']].map(([action, label, capability, icon]) => <button type="button" key={action} className={action === 'RESUME' && control?.canResume ? styles.resumeControl : ''} disabled={disabled || control?.[capability] !== true || (['STEP', 'TAKE_OVER'].includes(action) && Boolean(control?.pending))} onClick={() => onControl(action)}><WorkspaceIcon name={icon} /><span>{label}</span></button>)}</div>
        <p className={styles.controllerHelp}>Pause saves your place after the current action. Manual takeover keeps Astra’s original proposals.</p>
        {error && <Notice error>{error}</Notice>}
        <div className={styles.feedHeading}><div><WorkspaceIcon name="FEED" /><h3>Activity feed</h3><span>{activity.length}</span></div><button type="button" aria-label="Refresh recorded activity" title="Refresh recorded activity" disabled={refreshing} onClick={() => setGeneration(value => value + 1)}><WorkspaceIcon name="REFRESH" /></button></div>
        <p className={styles.feedTimestamp}>{lastReadAt && current ? `Last synced ${clockTime(lastReadAt)}` : 'Waiting for the first saved update'}</p>
        {!activity.length ? <div className={styles.activityEmpty}><WorkspaceIcon name="INSPECTION" /><strong>{card.operator?.kind === 'ASTRA' ? 'Ready to watch the work unfold' : 'The next card starts here'}</strong><p>Saved inspections, image evidence and proposals appear here as Astra works.</p></div> : <ol className={styles.activityList}>{activity.map((entry, index) => <li key={entry.id} className={`${index === 0 ? styles.latestActivity : ''} ${entry.status === 'NEEDS_ATTENTION' || entry.status === 'UNKNOWN' ? styles.attentionActivity : ''}`}><div className={styles.activityMarker}><WorkspaceIcon name={entry.status === 'NEEDS_ATTENTION' || entry.status === 'UNKNOWN' ? 'ATTENTION' : entry.stage} /></div><article><div className={styles.activityMeta}><span>{entry.actor === 'ASTRA' ? 'Astra' : 'Human'} · {stageNames[entry.stage] ?? 'Grading'}</span><time dateTime={entry.at}>{clockTime(entry.at)}</time></div><strong>{entry.summary}</strong><SavedEvidence entry={entry} card={card} /><span className={styles.activityStatus}><i aria-hidden="true" />{statusLabel[entry.status] ?? 'Saved'}</span>{entry.proposal && <details className={styles.comparison}><summary>Original proposal{entry.decision ? ' + human decision' : ''}</summary><div><h3>Astra proposed</h3>{(entry.proposal.summary || entry.proposal.reason) && <p>{entry.proposal.summary || entry.proposal.reason}</p>}{entry.proposal.fields?.map(field => <p key={field.field}><strong>{field.field.replace(/([a-z])([A-Z])/g, '$1 $2')}: </strong>{field.value ?? 'Unknown'}</p>)}{entry.proposal.defectType && <p>{entry.proposal.defectType.toLowerCase().replaceAll('_', ' ')}</p>}{entry.proposal.side && <p>{entry.proposal.side === 'FRONT' ? 'Front' : 'Back'} physical boundary{entry.proposal.corners?.length === 4 ? ' · four corners saved' : ''}</p>}</div>{entry.decision ? <div><h3>Human decision</h3><p>{entry.decision.decision.toLowerCase().replaceAll('_', ' ')} · saved analysis {entry.decision.analysisRevision}</p><p>{entry.decision.reason}</p></div> : <p>Awaiting a recorded human decision.</p>}</details>}</article></li>)}</ol>}
        {card.specimenId && <div className={styles.activityReview}><WorkspaceIcon name="REVIEW" /><div><p>Review the draft and compare Astra’s proposals with your corrections.</p><ReportLink card={card} label="Open report review" /></div></div>}
    </section>;
}
