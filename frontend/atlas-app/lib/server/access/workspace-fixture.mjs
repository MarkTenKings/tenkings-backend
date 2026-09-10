/** Explicit owned-local fixture adapters. Never release or optical evidence. */
import { appendFileSync, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonical } from '../review-contract.mjs';
import { deny, hash } from '../policy.mjs';
import { readWorkspaceRecord } from './workspace-store.mjs';
import { createWorkspaceRuntime, workspaceRuntimeSettings } from './workspace-runtime.mjs';

export const WORKSPACE_FIXTURE_UPLOAD_ORIGIN = 'https://workspace-uploads.example.test';
const check = condition => { if (!condition) deny(503, 'LOCAL_WORKSPACE_FIXTURE_UNAVAILABLE'); };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function localWorkspaceFixture({ auth, review, staffConfig, env }) {
    check(env.NODE_ENV === 'development' && env.ATLAS_LOCAL_POSTGRES === '1'
        && env.ATLAS_LOCAL_WORKSPACE_FIXTURE === '1' && staffConfig.mode === 'LOCAL_FIXTURE');
    const configPath = realpathSync(env.ATLAS_LOCAL_POSTGRES_FILE), directory = dirname(configPath);
    check(/^\/private\/tmp\/atlas-staff-db-[A-Za-z0-9]+\/web-config\.json$/.test(configPath));
    const owner = JSON.parse(readFileSync(join(directory, 'ownership.json'), 'utf8'));
    const manifestPath = join(directory, 'workspace-assets.json'), info = statSync(manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    check(info.uid === process.getuid() && (info.mode & 0o077) === 0 && owner.createdByHarness
        && manifest.nonce === owner.nonce && manifest.syntheticOnly === true && manifest.assets.length === 20);
    const event = value => appendFileSync(join(directory, 'workspace-source-events.jsonl'), JSON.stringify(value) + '\n', { mode: 0o600 });
    const assetBytes = asset => {
        check(/^(original|prepared)-[0-9]{2}-(FRONT|BACK)\.png$/.test(asset.file));
        const bytes = readFileSync(join(directory, 'workspace-assets', asset.file));
        check(hash(bytes) === asset.sha256 && bytes.length === asset.byteCount); return bytes;
    };
    const uploadPath = id => { check(uuid.test(id)); return join(directory, 'workspace-objects', id); };
    async function bound(request) {
        return auth.database.transaction(async context => {
            const session = await context.tx.staffSession.findUnique({ where: { tokenHash: request.scope.sessionHash } });
            const current = session && await auth.current(context, session.tokenHash, session.browserHash);
            check(current?.identity.id === request.scope.actorId && context.control.revision === request.scope.controlRevision);
            const card = readWorkspaceRecord(await context.tx.staffWorkspaceCard.findUnique({ where: { id: request.cardId } }));
            check(card && card.captureHash === request.binding.captureHash && card.captureRevision === request.binding.captureRevision
                && card.claimFence === request.binding.claimFence && card.revision === request.binding.workflowRevision);
            if (!request.requestId) return { card };
            const operation = await context.tx.staffWorkspaceOperation.findUnique({ where: { id: request.requestId } });
            check(operation && hash(operation.canonical) === operation.contentHash);
            const saved = JSON.parse(operation.canonical);
            check(saved.cardId === card.id && saved.actorId === current.identity.id && saved.result.phase === 'REQUESTED'
                && card.workspace.pending?.requestId === saved.id && canonical(saved.result.binding) === canonical(request.binding));
            return { card, saved };
        });
    }
    const receiptPath = request => { check(uuid.test(request.requestId)); return join(directory, 'workspace-results', `${request.requestId}.json`); };
    const ports = {
        storage: {
            async grant({ upload }) {
                check(manifest.assets.some(asset => asset.sha256 === upload.sha256 && asset.byteCount === upload.byteCount));
                const plan = `${uploadPath(upload.id)}.json`;
                if (existsSync(plan)) check(canonical(JSON.parse(readFileSync(plan, 'utf8'))) === canonical(upload));
                else writeFileSync(plan, JSON.stringify(upload), { mode: 0o600, flag: 'wx' });
                return { id: upload.id, method: 'PUT', url: `${WORKSPACE_FIXTURE_UPLOAD_ORIGIN}/${upload.id}`,
                    headers: { 'Content-Type': upload.contentType, 'If-None-Match': '*' }, expiresAt: new Date(Date.now() + 60_000).toISOString() };
            },
            async verify({ upload }) {
                const bytes = readFileSync(uploadPath(upload.id)), asset = manifest.assets.find(value => value.sha256 === hash(bytes));
                check(asset && upload.sha256 === asset.sha256 && upload.byteCount === bytes.length && upload.contentType === 'image/png');
                return { objectRef: upload.objectRef, sha256: asset.sha256, byteCount: bytes.length, contentType: 'image/png', width: asset.width, height: asset.height };
            },
            async read({ upload }) { return readFileSync(uploadPath(upload.id)); },
        },
        source: {
            async prepare(request) {
                const { card, saved } = await bound(request), side = saved.result.payload.side;
                check(saved.result.action === 'PREPARE_SIDE' && ['FRONT', 'BACK'].includes(side));
                const plan = JSON.parse(readFileSync(`${uploadPath(card.sides[side].uploadId)}.json`, 'utf8'));
                const original = manifest.assets.find(value => value.sha256 === plan.sha256), asset = original.prepared;
                assetBytes(asset);
                const preparation = card.workspace.preparation[side];
                const result = { requestId: request.requestId, cardId: card.id, action: 'PREPARE_SIDE', state: 'SUCCEEDED', side,
                    captureHash: request.binding.captureHash, claimFence: request.binding.claimFence,
                    preparation: { manifestHash: hash(canonical({ syntheticOnly: true, request, asset })), width: 1270, height: 1778,
                        sourceCorners: preparation.corners, matColor: preparation.matColor,
                        centeringProposal: [{ x: .05, y: .05 }, { x: .95, y: .05 }, { x: .95, y: .95 }, { x: .05, y: .95 }] } };
                check(!existsSync(receiptPath(request)));
                writeFileSync(receiptPath(request), JSON.stringify({ request, result, asset }), { mode: 0o600, flag: 'wx' });
                writeFileSync(join(directory, 'workspace-results', `${card.id}-${side}.json`), JSON.stringify({ request, result, asset }), { mode: 0o600 });
                event({ event: 'SYNTHETIC_PREPARATION', requestId: request.requestId, side });
                if (side === 'FRONT') throw new Error('Owned fixture: result saved before transport interruption');
                return result;
            },
            async resolveMap(request) {
                const { card, saved } = await bound(request); check(saved.result.action === 'RESOLVE_MAP' && card.claim?.kind === 'HUMAN');
                const result = { requestId: request.requestId, cardId: card.id, action: 'RESOLVE_MAP', state: 'SUCCEEDED', captureHash: request.binding.captureHash,
                    claimFence: request.binding.claimFence, map: { status: 'LOOKUP_FAILED', name: null, scope: null, version: null,
                        registration: { FRONT: 'MISSING', BACK: 'MISSING' }, bindingReady: false, canRegister: false } };
                writeFileSync(receiptPath(request), JSON.stringify({ request, result }), { mode: 0o600, flag: 'wx' });
                writeFileSync(join(directory, 'workspace-results', `${card.id}-map.json`), JSON.stringify({ request, result }), { mode: 0o600 });
                event({ event: 'SYNTHETIC_MAP_LOOKUP_FAILURE', requestId: request.requestId }); return result;
            },
            async continueWithoutMap(request) {
                const { card, saved } = await bound(request), failure = JSON.parse(readFileSync(join(directory, 'workspace-results', `${card.id}-map.json`), 'utf8'));
                check(saved.result.action === 'CONTINUE_WITHOUT_MAP' && saved.result.payload.confirmed === true && card.claim?.kind === 'HUMAN'
                    && failure.result.map.status === 'LOOKUP_FAILED' && card.workspace.map?.status === 'LOOKUP_FAILED');
                const result = { requestId: request.requestId, cardId: card.id, action: 'CONTINUE_WITHOUT_MAP', state: 'SUCCEEDED', captureHash: request.binding.captureHash,
                    claimFence: request.binding.claimFence, map: { ...failure.result.map, status: 'HUMAN_REVIEW_WITHOUT_MAP' } };
                writeFileSync(receiptPath(request), JSON.stringify({ request, result }), { mode: 0o600, flag: 'wx' });
                event({ event: 'SYNTHETIC_HUMAN_MAP_DECISION', requestId: request.requestId, operationId: saved.operationId });
                throw new Error('Owned fixture: explicit human decision saved before lost response');
            },
            async status(request) {
                await bound(request);
                const saved = JSON.parse(readFileSync(receiptPath(request), 'utf8'));
                check(canonical(saved.request) === canonical(request));
                event({ event: 'SYNTHETIC_STATUS_READ', requestId: request.requestId }); return saved.result;
            },
            async readPrepared(request) {
                await bound(request); check(['FRONT', 'BACK'].includes(request.side));
                const saved = JSON.parse(readFileSync(join(directory, 'workspace-results', `${request.cardId}-${request.side}.json`), 'utf8'));
                check(saved.result.preparation.manifestHash === request.manifestHash);
                const bytes = assetBytes(saved.asset); return { bytes, contentType: 'image/png', sha256: hash(bytes), byteCount: bytes.length };
            },
            async finalize(request) {
                await bound(request);
                return { requestId: request.requestId, cardId: request.cardId, action: 'INITIALIZE_REPORT', state: 'FAILED',
                    captureHash: request.binding.captureHash, claimFence: request.binding.claimFence, failureCode: 'SYNTHETIC_FIXTURE_HAS_NO_OPTICAL_REPORT' };
            },
        },
    };
    return createWorkspaceRuntime({ auth, review, staffConfig, env: {}, settings: workspaceRuntimeSettings({}, staffConfig), ports });
}
