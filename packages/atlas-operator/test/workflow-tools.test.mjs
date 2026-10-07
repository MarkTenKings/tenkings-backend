import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { operatorAdapters } from '../src/adapters.mjs';
import { parseToolCall } from '../src/responses.mjs';
import { RUNTIME_TOOLS } from '../src/runtime.mjs';
import { fixtureAnalysis } from '../../../frontend/atlas-app/lib/server/access/fixture-analysis.mjs';
import { measureSpeedsterCenteringBorders, calculateCenteringScore } from '@atlas/grading-core/scoring';

function fixture(name, args) {
    const analysis = fixtureAnalysis({ title: 'Synthetic workflow source', set: 'Fixture set' }, 'a'.repeat(64));
    const run = { id: randomUUID(), leaseOwner: randomUUID(), leaseFence: 1, revision: 1, evidenceHash: 'a'.repeat(64),
        manifestHash: 'b'.repeat(64), expectedAnalysisRevision: 1, specimenId: randomUUID() };
    const binding = { runId: run.id, evidenceHash: run.evidenceHash, manifestHash: run.manifestHash, expectedRevision: 1 };
    const call = { name, callId: 'call_workflow_fixture', args: { ...binding, ...args } }, attemptId = randomUUID();
    const snapshot = { run, call, attemptId, manifest: { assets: [], sourceHash: analysis.sourceHash, reportHash: analysis.reportHash } };
    const evidenceClient = { async read(claims, request) { assert.equal(request, null); return { claims, request }; },
        verify(receipt, claims, request) { assert.deepEqual(receipt, { claims, request }); return { image: null }; } };
    const adapters = operatorAdapters({ evidenceClient });
    return { analysis, snapshot, binding, adapters, async apply() {
        const prepared = await adapters[name].prepare(snapshot, {});
        return adapters[name].apply({ ...snapshot, attempt: { id: attemptId }, now: new Date(),
            tx: { staffAnalysisRevision: { findUnique: async () => analysis } } }, prepared);
    } };
}

test('runtime exposes only the concrete admitted workspace tools and rejects model-written coordinates or scores', () => {
    const f = fixture('measure_centering', { side: 'FRONT' });
    assert.deepEqual(Object.keys(f.adapters), [...RUNTIME_TOOLS]);
    const call = { name: 'measure_centering', call_id: 'call_measure', arguments: canonical({ ...f.binding, side: 'FRONT' }) };
    assert.equal(parseToolCall(call, f.binding, RUNTIME_TOOLS).name, 'measure_centering');
    for (const extra of [{ score: 10 }, { coordinates: [] }, { sourceOwnerId: 'another-user' }, { confirmed: true }])
        assert.throws(() => parseToolCall({ ...call, arguments: canonical({ ...f.binding, side: 'FRONT', ...extra }) }, f.binding, RUNTIME_TOOLS));
});

test('centering tool calls the original deterministic function over exact saved geometry', async () => {
    const f = fixture('measure_centering', { side: 'FRONT' }), before = structuredClone(f.analysis);
    const { result, images } = await f.apply();
    const source = JSON.parse(f.analysis.sourceCanonical), borders = measureSpeedsterCenteringBorders(source.capture.front.centeringQuad);
    assert.deepEqual(result.borders, borders); assert.equal(result.score, calculateCenteringScore(borders));
    assert.equal(result.sourceHash, f.analysis.sourceHash); assert.equal(result.reportHash, f.analysis.reportHash);
    assert.deepEqual(images, []); assert.deepEqual(f.analysis, before);
});

test('geometry inspection preserves missing corners and cannot invent preparation or human confirmation', async () => {
    const f = fixture('inspect_card_geometry', { side: 'BACK' }), { result } = await f.apply();
    assert.equal(result.corners, null); assert.equal(result.status, 'RECORDED_GEOMETRY');
    assert.equal(Object.hasOwn(result, 'prepared'), false); assert.equal(Object.hasOwn(result, 'confirmed'), false);
    assert.deepEqual(result.centeringQuad, JSON.parse(f.analysis.sourceCanonical).capture.back.centeringQuad);
});

test('finding inspection returns recorded measurement evidence without modifying or suppressing the source', async () => {
    const f = fixture('inspect_finding', { findingId: 'FRONT:fixture-1:SURFACE' }), before = structuredClone(f.analysis);
    const { result } = await f.apply(); assert.equal(result.finding.id, 'FRONT:fixture-1:SURFACE');
    assert.equal(result.finding.reviewResult, 'UNREVIEWED'); assert.equal(result.finding.measurement.areaMm2, 1);
    assert.deepEqual(f.analysis, before);
    const g = fixture('inspect_finding', { findingId: 'nonexistent' }); await assert.rejects(g.apply(), /ASTRA_FINDING_NOT_IN_REPORT/);
});

test('changed source hash or missing geometry cannot produce a deterministic measurement claim', async () => {
    const f = fixture('measure_centering', { side: 'FRONT' }); f.analysis.sourceCanonical += ' ';
    await assert.rejects(f.apply(), /ASTRA_STORED_EVIDENCE_INVALID/);
    const g = fixture('measure_centering', { side: 'FRONT' }), source = JSON.parse(g.analysis.sourceCanonical);
    delete source.capture.front.centeringQuad; g.analysis.sourceCanonical = canonical(source);
    g.analysis.sourceHash = digest(g.analysis.sourceCanonical); g.snapshot.manifest.sourceHash = g.analysis.sourceHash;
    await assert.rejects(g.apply(), /ASTRA_CENTERING_EVIDENCE_REQUIRED/);
});
