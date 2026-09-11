import test from 'node:test';
import assert from 'node:assert/strict';
import { projectWorkspaceTiming } from '../lib/workspace-timing.mjs';
const at = seconds => new Date(Date.UTC(2026, 8, 10) + seconds * 1000).toISOString();
const stage = (seconds, value, active = true, reason = null) => ({ at: at(seconds), kind: 'STAGE', stage: value, active, reason });
test('card clock excludes queue time and human-review waiting, resumes only on pickup', () => {
    const events = [stage(10, 'PHOTOS'), stage(20, 'IDENTITY'), stage(50, 'REPORT'), stage(70, 'REVIEW', false, 'HUMAN_REVIEW')];
    const waiting = projectWorkspaceTiming({ asOf: at(370), events });
    assert.equal(waiting.totalActiveMs, 60000); assert.equal(waiting.runningSince, null);
    assert.equal(waiting.pausedReason, 'HUMAN_REVIEW');
    assert.equal(waiting.stages.find(s => s.stage === 'IDENTITY').activeMs, 30000);
    assert.equal(waiting.stages.find(s => s.stage === 'CENTERING').measured, false);
    const resumed = projectWorkspaceTiming({ asOf: at(410), events: [...events, stage(400, 'REVIEW')] });
    assert.equal(resumed.totalActiveMs, 70000); assert.equal(resumed.activeStage, 'REVIEW');
    assert.equal(resumed.stages.find(s => s.stage === 'REVIEW').activeMs, 10000);
});
test('pause, recovery and completion preserve earlier intervals across reloads', () => {
    const events = [stage(10, 'PHOTOS'), { at: at(15), kind: 'PAUSE', reason: 'NEEDS_ATTENTION' },
        { at: at(200), kind: 'RESUME' }, stage(210, 'IDENTITY'), stage(220, 'REVIEW', false, 'HUMAN_REVIEW'),
        stage(240, 'REVIEW'), stage(250, 'FINISHING', false, 'COMPLETED')];
    const timing = projectWorkspaceTiming({ asOf: at(1000), events });
    assert.equal(timing.totalActiveMs, 35000); assert.equal(timing.runningSince, null);
    assert.equal(timing.stages.find(s => s.stage === 'PHOTOS').activeMs, 15000);
    assert.equal(timing.stages.find(s => s.stage === 'REVIEW').completedAt, at(250));
    assert.deepEqual(timing, projectWorkspaceTiming({ asOf: at(1000), events: JSON.parse(JSON.stringify(events)) }));
});
test('expired worker lease stops extrapolating active time', () => {
    const timing = projectWorkspaceTiming({ asOf: at(90), events: [stage(10, 'IDENTITY')], leaseRequired: true, leaseExpiresAt: at(30) });
    assert.equal(timing.totalActiveMs, 20000); assert.equal(timing.pausedReason, 'NEEDS_ATTENTION');
});
test('empty, out-of-order and malformed event histories do not invent completion', () => {
    assert.equal(projectWorkspaceTiming({ asOf: at(99) }).totalActiveMs, 0);
    assert.equal(projectWorkspaceTiming({ asOf: at(40), events: [stage(30, 'IDENTITY'), stage(10, 'PHOTOS')] }).totalActiveMs, 30000);
    assert.throws(() => projectWorkspaceTiming({ asOf: at(40), events: [stage(1, 'MADE_UP')] }), /TIMING_UNAVAILABLE/);
});
