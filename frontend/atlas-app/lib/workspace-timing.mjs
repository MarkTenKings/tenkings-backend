import { WORKSPACE_STAGES } from './workspace-contract.mjs';

const reasons = new Set(['HUMAN_REVIEW', 'PAUSED', 'NEEDS_ATTENTION', 'COMPLETED']);
const time = value => { const result = Date.parse(value); return Number.isFinite(result) ? result : null; };
/** Reconstruct active work from persisted workflow transitions. Reading a card
 * never starts a timer. Missing historical stage measurements remain unknown. */
export function projectWorkspaceTiming({ asOf, events = [], leaseExpiresAt = null, leaseRequired = false }) {
    const end = time(asOf);
    if (end === null || !Array.isArray(events) || events.length > 1024) throw new Error('WORKSPACE_TIMING_UNAVAILABLE');
    const stages = new Map(WORKSPACE_STAGES.map(stage => [stage, { stage, activeMs: 0, measured: false, completedAt: null }]));
    const sorted = events.map((event, index) => {
        const at = time(event.at);
        if (at === null || !['STAGE', 'PAUSE', 'RESUME'].includes(event.kind)
            || event.kind === 'STAGE' && (typeof event.active !== 'boolean' || !stages.has(event.stage))
            || event.stage != null && !stages.has(event.stage)
            || event.reason != null && !reasons.has(event.reason)) throw new Error('WORKSPACE_TIMING_UNAVAILABLE');
        return { ...event, at, index };
    }).filter(event => event.at <= end).sort((a, b) => a.at - b.at || (a.order ?? a.index) - (b.order ?? b.index));
    let currentStage = null, active = false, cursor = null, totalActiveMs = 0, pausedReason = null, startedAt = null;
    const add = until => {
        if (cursor !== null && active && currentStage) {
            const duration = Math.max(0, until - cursor);
            stages.get(currentStage).activeMs += duration;
            stages.get(currentStage).measured = true;
            totalActiveMs += duration;
        }
        cursor = until;
    };
    for (const event of sorted) {
        add(event.at);
        if (event.kind === 'STAGE') {
            if (event.stage) {
                const nextIndex = WORKSPACE_STAGES.indexOf(event.stage);
                if (currentStage && nextIndex > WORKSPACE_STAGES.indexOf(currentStage))
                    for (let i = 0; i < nextIndex; i++) stages.get(WORKSPACE_STAGES[i]).completedAt ??= new Date(event.at).toISOString();
                currentStage = event.stage;
            }
            active = event.active === true; pausedReason = active ? null : event.reason ?? null;
            if (active) startedAt ??= new Date(event.at).toISOString();
        } else if (event.kind === 'PAUSE') { active = false; pausedReason = event.reason ?? 'PAUSED'; }
        else if (currentStage) { active = true; pausedReason = null; }
    }
    let through = end;
    const leaseEnd = time(leaseExpiresAt);
    if (active && leaseRequired && (leaseEnd === null || leaseEnd < end)) {
        through = Math.max(cursor ?? end, leaseEnd ?? cursor ?? end);
        add(through); active = false; pausedReason = 'NEEDS_ATTENTION';
    } else add(end);
    return { version: 'atlas-workspace-timing-v1', asOf: new Date(end).toISOString(), startedAt,
        totalActiveMs, runningSince: active && currentStage ? new Date(end).toISOString() : null,
        activeStage: active ? currentStage : null, currentStage, pausedReason, stages: [...stages.values()] };
}
