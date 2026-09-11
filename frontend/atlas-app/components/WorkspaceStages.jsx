import { useEffect, useRef, useState } from 'react';
import { stageNames, stageOrder } from '../lib/workspace-client.mjs';
import WorkspaceIcon from './WorkspaceIcon';
import styles from './WorkspaceUi.module.css';

const MAX_LIVE_EXTENSION_MS = 20_000;
const duration = value => Number.isFinite(value) && value >= 0 ? value : null;
const validInstant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function formatActiveDuration(milliseconds) {
    if (duration(milliseconds) === null) return '—';
    const seconds = Math.floor(milliseconds / 1000), hours = Math.floor(seconds / 3600);
    return `${hours ? `${hours}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// Durations arrive already calculated through asOf. A short local display tick
// never becomes saved timing, nor does it keep counting through a lost feed.
export function useWorkspaceClock(timing) {
    const [extension, setExtension] = useState(0);
    const running = validInstant(timing?.asOf) && validInstant(timing?.runningSince)
        && duration(timing?.totalActiveMs) !== null && !timing?.pausedReason;
    useEffect(() => {
        setExtension(0);
        if (!running) return undefined;
        const clock = () => globalThis.performance?.now() ?? Date.now(), received = clock();
        const timer = setInterval(() => setExtension(Math.min(MAX_LIVE_EXTENSION_MS, Math.max(0, clock() - received))), 1000);
        return () => clearInterval(timer);
    }, [timing?.asOf, timing?.runningSince, timing?.totalActiveMs, timing?.pausedReason, running]);
    const delta = running ? extension : 0;
    return { totalMs: duration(timing?.totalActiveMs) === null ? null : timing.totalActiveMs + delta,
        extensionMs: delta, running, stale: running && extension >= MAX_LIVE_EXTENSION_MS };
}

export default function WorkspaceStages({ card, selectedStage = card.stage, onSelectStage, timing = card.timing, followLive, onFollowLiveChange }) {
    const clock = useWorkspaceClock(timing);
    const rail = useRef(null);
    useEffect(() => {
        const container = rail.current;
        if (!container) return undefined;
        const align = () => {
            const selected = container.querySelector('button[aria-pressed="true"]');
            if (!selected || container.scrollWidth <= container.clientWidth) return;
            const frame = container.getBoundingClientRect(), tile = selected.getBoundingClientRect();
            container.scrollTo({ left: container.scrollLeft + tile.left - frame.left - (container.clientWidth - tile.width) / 2, behavior: 'auto' });
        };
        align();
        if (typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver(align); observer.observe(container);
        return () => observer.disconnect();
    }, [selectedStage]);
    const records = new Map((Array.isArray(timing?.stages) ? timing.stages : []).map(value => [value.stage, value]));
    const completed = stageOrder.filter(stage => validInstant(records.get(stage)?.completedAt));
    const waitingForReview = timing?.pausedReason === 'HUMAN_REVIEW' || card.state === 'HUMAN_REVIEW' && !clock.running;
    const clockState = clock.stale ? 'Waiting for update' : waitingForReview ? 'Paused · awaiting reviewer'
        : timing?.pausedReason === 'NEEDS_ATTENTION' ? 'Paused · needs attention'
            : clock.running ? 'Active grading time' : card.state === 'APPROVED' ? 'Total grading time'
                : timing?.pausedReason ? 'Clock paused' : clock.totalMs === null ? 'Timing not yet recorded' : 'Recorded active time';
    return <section className={styles.journey} aria-label="Card grading progress and timing">
        <div className={styles.journeyHeading}>
            <div><p className={styles.journeyEyebrow}>CARD JOURNEY</p><div className={styles.journeyTitle}><h2>{stageNames[card.stage] ?? 'Grading'}<span>{waitingForReview ? 'Ready for your review' : card.operator?.kind === 'ASTRA' ? 'Astra at the controls' : card.operator?.kind === 'HUMAN' ? 'Human at the controls' : 'Every detail, accounted for'}</span></h2></div></div>
            <div className={styles.journeyTools}>
                {onFollowLiveChange && card.operator?.kind === 'ASTRA' && <label className={styles.followControl}><input type="checkbox" checked={Boolean(followLive)} onChange={event => onFollowLiveChange(event.target.checked)} /><span>Follow Astra</span></label>}
                <div className={`${styles.cardClock} ${waitingForReview || timing?.pausedReason ? styles.clockPaused : ''}`}><WorkspaceIcon name={clock.running && !clock.stale ? 'CLOCK' : 'PAUSE'} /><div><span>{clockState}</span><strong aria-label={`${clockState}: ${formatActiveDuration(clock.totalMs)}`}>{formatActiveDuration(clock.totalMs)}</strong></div></div>
            </div>
        </div>
        <nav ref={rail} className={styles.stageRail} aria-label="Card grading stages"><ol>{stageOrder.map((stage, index) => {
            const recorded = records.get(stage), done = completed.includes(stage), current = card.stage === stage, selected = selectedStage === stage;
            const elapsed = recorded?.measured === false ? null : duration(recorded?.activeMs), stageMs = elapsed === null ? null : elapsed + (timing?.activeStage === stage ? clock.extensionMs : 0);
            const state = done ? 'Completed' : current ? waitingForReview ? 'Ready for review' : 'Current stage' : 'Not completed';
            return <li key={stage} className={`${styles.stageStop} ${done ? styles.stageDone : ''} ${current ? styles.stageCurrent : ''} ${selected ? styles.stageSelected : ''}`}>
                <button type="button" aria-current={current ? 'step' : undefined} aria-pressed={selected} aria-label={`${index + 1}. ${stageNames[stage]} · ${state}`} onClick={() => onSelectStage?.(stage)}>
                    <span className={styles.stageTop}><span className={styles.stageNumber}>{String(index + 1).padStart(2, '0')}</span><WorkspaceIcon name={done ? 'CHECK' : stage} /></span>
                    <strong>{stageNames[stage]}</strong><span className={styles.stageState}>{done ? 'Complete' : current ? waitingForReview ? 'Ready' : 'Current' : 'Upcoming'}</span>
                </button>
                <span className={styles.stageTrack} aria-hidden="true"><i /></span>
                <span className={styles.stageDuration} title={recorded?.measured === false ? 'Included in workflow; separate stage timing was not recorded.' : undefined}><span>{formatActiveDuration(stageMs)}</span>{current && clock.running && !clock.stale && <span className={styles.durationLive}>active</span>}</span>
            </li>;
        })}</ol></nav>
        <div className={styles.journeyFooter}><span><i aria-hidden="true" />{completed.length} of 8 stages completed</span><p>{waitingForReview ? 'Astra’s draft is ready. Time resumes when a reviewer picks up this card.' : 'Active time includes work on this card. Time waiting for human review is excluded.'}</p>{selectedStage !== card.stage && <button type="button" onClick={() => onSelectStage?.(card.stage)}>View current stage <span aria-hidden="true">→</span></button>}</div>
    </section>;
}
