import { useEffect, useRef, useState } from 'react';
import { Notice } from './Shell';
import { ReportLink } from './WorkspaceShared';
import { stageNames, workspaceCardPath, workspaceMessage, workspaceRequest } from '../lib/workspace-client.mjs';
import styles from './WorkspaceUi.module.css';

const stateLabel = { UNAVAILABLE: 'Astra awaiting connection', QUEUED: 'Astra queued', RUNNING: 'Astra running', PAUSE_REQUESTED: 'Pause requested · settling work', PAUSED: 'Astra paused', TAKEN_OVER: 'Human has taken over', COMPLETED: 'Astra draft complete' };
const statusLabel = { PROPOSED: 'Proposed', REQUESTED: 'Requested', RECORDED: 'Recorded', NEEDS_ATTENTION: 'Needs attention', APPLIED: 'Applied' };
export default function WorkspaceActivity({ card, disabled, onControl, onObservedCard }) {
    const [snapshot, setSnapshot] = useState(null), [error, setError] = useState(''), [refreshing, setRefreshing] = useState(false), [watch, setWatch] = useState(true), [generation, setGeneration] = useState(0);
    const observed = useRef(onObservedCard); observed.current = onObservedCard;
    useEffect(() => {
        let active = true, timer; const controller = new AbortController();
        async function load() {
            setRefreshing(true);
            try {
                const [next, latest] = await Promise.all([workspaceRequest(`${workspaceCardPath(card.id)}/activity`, { signal: controller.signal }), workspaceRequest(workspaceCardPath(card.id), { signal: controller.signal })]);
                if (active) { setSnapshot(next); setError(''); if (latest.card?.id === card.id) observed.current?.(latest.card); }
            } catch (cause) { if (active) setError(workspaceMessage(cause)); }
            finally { if (active) { setRefreshing(false); if (watch) timer = setTimeout(load, 6000); } }
        }
        load(); return () => { active = false; clearTimeout(timer); controller.abort(); };
    }, [card.id, watch, generation]);
    const control = snapshot?.control, activity = snapshot?.activity ?? [];
    return <section className={styles.activity}><div className={styles.panelHeading}><div><p className="eyebrow">RECORDED ACTIVITY</p><h2>Watch Astra</h2></div><label className={styles.check}><input type="checkbox" checked={watch} onChange={event => setWatch(event.target.checked)} /><span>Keep updated</span></label></div>
        <div className={styles.operatorStatus}><span className={styles.operatorSymbol}>A</span><div><strong>{stateLabel[control?.state] ?? 'Loading recorded work…'}</strong><p>{control?.mode === 'STEP' ? 'One admitted step at a time' : control?.mode === 'CONTINUOUS' ? 'Continuous operation' : 'Activity appears after an operator starts.'}</p></div></div>
        {Boolean(control?.pending) && <Notice>{control.pending} recorded {control.pending === 1 ? 'request is' : 'requests are'} still pending. Takeover and new steps wait for the recorded outcome.</Notice>}
        <div className={styles.operatorControls}>{[['PAUSE', 'Pause Astra', 'canPause'], ['RESUME', 'Resume Astra', 'canResume'], ['STEP', 'Run next step', 'canStep'], ['TAKE_OVER', 'Take over manually', 'canTakeOver']].map(([action, label, capability]) => <button type="button" key={action} disabled={disabled || control?.[capability] !== true || (['STEP', 'TAKE_OVER'].includes(action) && Boolean(control?.pending))} onClick={() => onControl(action)}>{label}</button>)}</div>
        <p className={styles.help}>Pause stops new work. Taking over preserves machine proposals and waits for in-flight work to settle.</p>
        {error && <Notice error>{error}</Notice>}<button type="button" className="text-button" disabled={refreshing} onClick={() => setGeneration(value => value + 1)}>{refreshing ? 'Reading saved activity…' : 'Refresh recorded activity'}</button>
        {!activity.length ? <p className={styles.activityEmpty}>No recorded Astra actions yet. This view shows saved inspections, proposals and report changes as they become available.</p> : <ol className={styles.activityList}>{activity.map(entry => <li key={entry.id}><div className={styles.activityMarker} /><article><div className={styles.activityMeta}><span>{entry.actor === 'ASTRA' ? 'Astra' : 'Human'} · {stageNames[entry.stage] ?? 'Grading'}</span><time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div><strong>{entry.summary}</strong><span className={styles.activityStatus}>{statusLabel[entry.status] ?? 'Recorded'}</span>{entry.evidence?.length > 0 && <div className={styles.inspectedEvidence}>{entry.evidence.map((evidence, index) => <p key={index}>{evidence.side === 'FRONT' ? 'Front' : 'Back'} inspected{evidence.rect && ` · region ${evidence.rect.width} × ${evidence.rect.height} px at ${evidence.rect.x}, ${evidence.rect.y}`}</p>)}</div>}{entry.proposal && <details className={styles.comparison}><summary>Original proposal{entry.decision ? ' and human decision' : ''}</summary><div><h3>Astra proposed</h3><p>{entry.proposal.summary || entry.proposal.reason}</p>{entry.proposal.fields?.map(field => <p key={field.field}><strong>{field.field.replace(/([a-z])([A-Z])/g, '$1 $2')}: </strong>{field.value ?? 'Unknown'}</p>)}{entry.proposal.defectType && <p>{entry.proposal.defectType.toLowerCase().replaceAll('_', ' ')}</p>}</div>{entry.decision ? <div><h3>Human decision</h3><p>{entry.decision.decision.toLowerCase().replaceAll('_', ' ')} · saved analysis {entry.decision.analysisRevision}</p><p>{entry.decision.reason}</p></div> : <p>Awaiting a recorded human decision.</p>}</details>}</article></li>)}</ol>}
        {card.specimenId && <div className={styles.activityReview}><p>Review findings against their original proposals and save corrections in the report workspace.</p><ReportLink card={card} label="Compare and correct report" /></div>}
    </section>;
}
