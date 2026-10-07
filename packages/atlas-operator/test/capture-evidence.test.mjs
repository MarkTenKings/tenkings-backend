import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { OperatorEvidenceBridge, operatorEvidenceClient, signOperatorEvidenceRequest,
    verifyOperatorEvidenceRequest } from '@atlas/service-bridge/operator-evidence';
import { createOperatorImagePacket, OPERATOR_IMAGE_DECODER } from '@atlas/service-bridge/operator-images';
import { syntheticPng } from '../../atlas-contracts/test/fixtures.mjs';

function fixture() {
    const runtimeHash = 'f'.repeat(64), config = { mode: 'LOCAL_FIXTURE', origin: 'https://capture.example.test',
        deploymentId: 'synthetic', releaseSha: '0'.repeat(40), configHash: 'b'.repeat(64), clientKeyHash: 'c'.repeat(64),
        gradingPolicyHash: 'd'.repeat(64), runtimeHash, key: randomBytes(32) };
    const now = new Date(), later = new Date(+now + 60_000), id = randomUUID(), cohortId = randomUUID(), runId = randomUUID();
    const originals = {}, operations = new Map(), bytes = new Map(), assets = [], captureSides = {}, pointers = {};
    const source = { sourceType: 'SPEEDSTER', sourceId: `atlas-${id}`, sourceOwnerId: `atlas-staff-${randomUUID()}` };
    const row = body => ({ ...body, canonical: canonical(body), contentHash: digest(canonical(body)) });
    for (const [index, side] of ['FRONT', 'BACK'].entries()) {
        const buffer = syntheticPng(8,10,index ? 40 : 150), uploadId = randomUUID(), verificationId = randomUUID();
        const descriptor = { objectRef: `atlas/synthetic/${id}/${side}.png`, sha256: digest(buffer), byteCount: buffer.length,
            contentType: 'image/png', width: 8, height: 10, versionId: 'synthetic-v1' };
        const upload = { id: uploadId, cardId: id, side, sourceId: source.sourceId, sourceOwnerId: source.sourceOwnerId,
            objectRef: descriptor.objectRef, sha256: descriptor.sha256, byteCount: descriptor.byteCount, contentType: descriptor.contentType };
        originals[side] = descriptor; pointers[side] = { uploadId, verificationId }; captureSides[side] = { uploadId, ...descriptor };
        operations.set(uploadId, row({ id: uploadId, cardId: id, action: 'upload-plan', result: { upload } }));
        operations.set(verificationId, row({ id: verificationId, cardId: id, action: 'upload-complete', result: { uploadId, verification: descriptor } }));
        assets.push({ assetId: randomUUID(), side, view: 'ORIGINAL', ...Object.fromEntries(['sha256','byteCount','width','height','contentType'].map(k => [k,descriptor[k]])) });
        bytes.set(descriptor.objectRef, buffer);
    }
    const captureHash = digest(canonical({ source, captureRevision: 2, sides: captureSides }));
    const claim = { id: randomUUID(), kind: 'ASTRA', runId, fence: 2, captureHash, captureRevision: 2, workflowRevision: 3 };
    const card = { id, creatorId: randomUUID(), cohortId, revision: 3, state: 'IN_PROGRESS', stage: 'PHOTOS', specimenId: null,
        source, captureHash, captureRevision: 2, claimFence: 2, claim, sides: pointers,
        identity: { category: 'SPORTS' }, workspace: { cornerShape: 'SQUARE' } };
    const manifest = { version: 'atlas-operator-capture-manifest-v1', phase: 'CAPTURE_REVIEW', runId, workspaceCardId: id,
        claimId: claim.id, claimFence: 2, captureRevision: 2, workflowRevision: 3, evidenceHash: captureHash,
        identity: { category: 'SPORTS' }, cornerShape: 'SQUARE', assets };
    const policy = { pilotId: randomUUID(), captureTools: ['read_original_photos', 'inspect_region', 'propose_capture_identity'],
        tools: ['read_card_report'], expiresAt: later.toISOString() };
    const budget = { version: 'atlas-workspace-bridge-policy-v1', pilotId: policy.pilotId,
        workspaceCardIds: [id, ...Array.from({ length: 9 }, randomUUID)], expiresAt: later.toISOString() };
    const run = { id: runId, state: 'WAITING_TOOL', phase: 'CAPTURE_REVIEW', workspaceCardId: id, specimenId: null,
        expectedAnalysisRevision: 0, expectedReviewRevision: 0, runtimeHash, policyHash: digest(canonical(policy)),
        gradingPolicyHash: config.gradingPolicyHash, leaseOwner: randomUUID(), leaseFence: 1, revision: 1, leaseMode: 'WORK',
        leaseExpiresAt: later, deadlineAt: later, pilotId: policy.pilotId, evidenceHash: captureHash,
        manifestCanonical: canonical(manifest), manifestHash: digest(canonical(manifest)), controlState: 'RUNNING' };
    const binding = { runId, expectedRevision: 1, evidenceHash: captureHash, manifestHash: run.manifestHash };
    const call = { type: 'function_call', call_id: 'call_originals', name: 'read_original_photos', arguments: canonical(binding) };
    const receiptId = randomUUID(), receipt = { body: { model: 'gpt-6-astra', status: 'completed', service_tier: 'default', output: [call] } };
    const attempt = { id: randomUUID(), runId, state: 'RECEIVED', runRevision: 1, leaseFence: 1,
        usageCeilingMicroUsd: 10n, usageEnvelopeExceeded: false, resultReceiptId: receiptId };
    const controls = { StaffOperatorImageControl: { ...config, enabled: true },
        StaffOperatorControl: { enabled: true, mode: config.mode, configHash: runtimeHash, policyHash: run.policyHash, policyCanonical: canonical(policy) },
        StaffGradingBridgeControl: { enabled: true, mode: config.mode, gradingPolicyHash: config.gradingPolicyHash, policyCanonical: canonical(budget), policyHash: digest(canonical(budget)) },
        StaffControl: { enabled: true, mode: config.mode, gradingPolicyHash: config.gradingPolicyHash },
        StaffWorkspaceControl: { enabled: true, astraEnabled: true, mode: config.mode, releaseSha: config.releaseSha, expiresAt: later, cohortId } };
    const queries = [], tx = { $executeRaw: async () => {}, $queryRaw: async (strings, ...values) => {
        const sql = strings.join(''); queries.push(sql);
        if (sql.includes('clock_timestamp')) return [{ now }];
        for (const [name, value] of Object.entries(controls)) if (sql.includes(`"${name}"`)) return [value];
        if (sql.includes('"StaffOperatorRun"') || sql.includes('lock_workspace_private_run')) return [run];
        if (sql.includes('"StaffWorkspaceCard"') || sql.includes('lock_workspace_private_card')) return [row(card)];
        if (sql.includes('"StaffWorkspaceOperation"')) return [operations.get(values[0])];
        if (sql.includes('"StaffOperatorAttempt"')) return [attempt];
        if (sql.includes('"StaffOperatorReceipt"')) { const text = canonical(receipt); return [{ canonical: text, hash: digest(text) }]; }
        throw new Error(`Unexpected report/source read: ${sql}`);
    } };
    let reads = 0, mutate = () => {};
    const ports = { async loadCapture(_tx, value) { return { captureHash: value.workspace.captureHash, originals: value.originals }; },
        async readCapture(descriptor) { reads++; mutate(); return bytes.get(descriptor.objectRef); },
        async render({ sourceBytes, asset, request }) { assert.equal(digest(sourceBytes),asset.sha256);
            return createOperatorImagePacket({ imageId: randomUUID(), request, asset, orientation: 1, decoder: OPERATOR_IMAGE_DECODER, bytes: sourceBytes }); } };
    const bridge = new OperatorEvidenceBridge({ config, client: { $transaction: work => work(tx) }, ports });
    const scope = { runId, owner: run.leaseOwner, fence: 1, revision: 1, attemptId: attempt.id, callId: call.call_id };
    const request = { ...binding, assetId: assets[0].assetId, sourceSha256: assets[0].sha256, side: 'FRONT',
        purpose: 'OVERVIEW', rect: { x: 0, y: 0, width: 8, height: 10 } };
    const claims = req => { const signed = signOperatorEvidenceRequest(config,scope,req); return verifyOperatorEvidenceRequest(config,signed.body,signed.signature); };
    return { card, run, originals, assets, controls, operations, call, scope, request, claims, queries, bridge, ports, config,
        mutateOnRead(work) { mutate = work; }, get reads() { return reads; } };
}

test('private capture evidence reads exact retained original keys without specimen or human session', async () => {
    const f = fixture(), response = await f.bridge.read(f.claims(f.request)), value = JSON.parse(response.text);
    assert.equal(value.phase, 'CAPTURE_REVIEW'); assert.equal(value.sourceHash, f.card.captureHash); assert.equal(f.reads, 1);
    assert.equal(Object.hasOwn(value.scope, 'sessionHash'), false); assert.equal(Object.hasOwn(value.scope, 'actorId'), false);
    assert.equal(f.queries.some(sql => sql.includes('"StaffSpecimen"') || sql.includes('"StaffAnalysisRevision"')), false);
    const client = operatorEvidenceClient(f.config);
    assert.equal(client.verify({ value, signature: response.signature }, f.scope, f.request, f.run).image.sha256, f.assets[0].sha256);
});

test('missing private capture ports fail explicitly before reading an object', async () => {
    const f = fixture(); delete f.ports.loadCapture;
    await assert.rejects(f.bridge.read(f.claims(f.request)), /ASTRA_CAPTURE_EVIDENCE_NOT_CONFIGURED/); assert.equal(f.reads, 0);
});

test('source byte read followed by takeover or changed capture cannot deliver late pixels', async () => {
    for (const mutate of [f => { f.card.claimFence++; }, f => { f.card.claim.kind = 'HUMAN'; }, f => { f.card.captureHash = 'a'.repeat(64); },
        f => { f.controls.StaffWorkspaceControl.astraEnabled = false; }]) {
        const f = fixture(); f.mutateOnRead(() => mutate(f));
        await assert.rejects(f.bridge.read(f.claims(f.request)), /ASTRA_CAPTURE_SCOPE_CHANGED/); assert.equal(f.reads, 1);
    }
});

test('capture image requests cannot substitute an original side/key or a report tool', async () => {
    const f = fixture(); await assert.rejects(f.bridge.read(f.claims({ ...f.request, side: 'BACK' })), /ASTRA_IMAGE_NOT_IN_MANIFEST/);
    assert.equal(f.reads, 0);
    f.call.name = 'read_card_report'; await assert.rejects(f.bridge.read(f.claims(f.request)), /ASTRA_TOOL_NOT_READY/);
    const g = fixture(); g.ports.loadCapture = async (_tx, input) => ({ captureHash: input.workspace.captureHash,
        originals: { ...input.originals, FRONT: { ...input.originals.FRONT, objectRef: 'other-key' } } });
    await assert.rejects(g.bridge.read(g.claims(g.request)), /ASTRA_CAPTURE_SOURCE_CHANGED/); assert.equal(g.reads, 0);
});

test('changed immutable verification and paused/stale run cannot authorize capture evidence', async () => {
    const f = fixture(), key = f.card.sides.FRONT.verificationId;
    const row = f.operations.get(key); row.canonical = row.canonical.replace('image/png','image/jpeg');
    await assert.rejects(f.bridge.read(f.claims(f.request)), /ASTRA_STORED_EVIDENCE_INVALID/);
    for (const update of [{ controlState: 'PAUSED' }, { leaseFence: 2 }, { state: 'PREPARATION_READY' }]) {
        const g = fixture(); Object.assign(g.run,update);
        await assert.rejects(g.bridge.read(g.claims(g.request)), /ASTRA_LEASE_STALE/); assert.equal(g.reads, 0);
    }
});
