import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonical, digest, parsePilotPolicy, requireBridge as check } from '@atlas/service-bridge/protocol';
import { sanitizeSpeedsterUnitQuad } from '@atlas/grading-core/geometry';
import { canonicalizeNewSpeedsterSessionIdentity } from '@atlas/grading-core/identity';
import { measureSpeedsterCenteringBorders, calculateCenteringBalance, calculateCenteringScore } from '@atlas/grading-core/scoring';
import { CAPTURE_TOOL_SCHEMAS, assertCaptureScope, selectedCapturePreparation } from './capture-protocol.mjs';
import { parseControlPolicy, toolsForRun } from './policy.mjs';
import { enqueueWorkspaceReportSuccessorInTransaction } from './ledger.mjs';

const uuid = z.uuidv4(), hash = z.string().regex(/^[a-f0-9]{64}$/), revision = z.number().int().positive().max(2147483646);
const side = z.enum(['FRONT', 'BACK']), quad = z.array(z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).length(4);
const sourceResult = z.strictObject({ requestId: uuid, cardId: uuid, captureHash: hash, claimFence: revision,
    action: z.enum(['PREPARE_SIDE', 'INITIALIZE_REPORT']), side: side.optional(), state: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN']),
    preparation: z.strictObject({ manifestHash: hash, width: z.number().int().min(2).max(16384), height: z.number().int().min(2).max(16384),
        sourceCorners: quad, matColor: z.enum(['BLACK', 'WHITE', 'MAGENTA']), centeringProposal: quad.nullable() }).optional(),
    specimenId: uuid.optional(), failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional() });
const sides = ['FRONT', 'BACK'];
const copy = value => JSON.parse(JSON.stringify(value)), same = (left, right) => canonical(left) === canonical(right);
const instant = value => value instanceof Date && Number.isFinite(+value);
const boundCard = card => ({ captureRevision: card.captureRevision, captureHash: card.captureHash,
    claimFence: card.claimFence, workflowRevision: card.revision });
const eventKey = requestId => `source-result_${requestId}`;
const safeError = error => /^[A-Z][A-Z0-9_]{0,79}$/.test(error?.code ?? '') ? error.code : 'ASTRA_SOURCE_OUTCOME_UNCONFIRMED';
function checked(text, contentHash, maximum = 262144) {
    check(typeof text === 'string' && Buffer.byteLength(text) <= maximum && hash.safeParse(contentHash).success
        && digest(text) === contentHash, 'ASTRA_SOURCE_RECORD_INVALID');
    let value; try { value = JSON.parse(text); } catch { check(false, 'ASTRA_SOURCE_RECORD_INVALID'); }
    check(value && typeof value === 'object' && !Array.isArray(value) && canonical(value) === text, 'ASTRA_SOURCE_RECORD_INVALID'); return value;
}
function record(row, fields) {
    const value = checked(row?.canonical, row?.contentHash);
    check(fields.every(key => value[key] === row[key]), 'ASTRA_SOURCE_RECORD_INVALID'); return value;
}
const cardRecord = row => record(row, ['id', 'creatorId', 'cohortId', 'revision', 'state', 'stage', 'specimenId']);
const operationRecord = row => record(row, ['id', 'actorId', 'operationId', 'cardId', 'action', 'inputHash']);
const scope = (card, run, machine) => ({ actorKind: 'MACHINE', actorId: card.claim.actorId, accessVersion: card.claim.accessVersion,
    controlRevision: card.claim.controlRevision, runId: run.id, runRevision: machine?.runRevision ?? run.revision,
    leaseFence: machine?.leaseFence ?? run.leaseFence, runControlRevision: machine?.runControlRevision ?? run.controlRevision });

/** Private, finite continuation of one already HUMAN-authorized Astra capture
 * run. It never claims a waiting card, invents a staff session, renews a permit,
 * approves a map/report, or changes costs. All external calls follow committed
 * immutable intent. Existing intent is status-only, including lost replies.
 * The injected source is the real signed private source service; authority is
 * its existing explicit private settings/current-identity DB authority.
 */
export function createWorkspaceSourceRunner({ client, authority, source, operatorConfig,
    enqueueSuccessor = enqueueWorkspaceReportSuccessorInTransaction, authorizeCommand }) {
    check(client && typeof client.$transaction === 'function'
        && ['controls', 'current', 'loadInTransaction', 'recheck'].every(name => typeof authority?.[name] === 'function')
        && ['prepare', 'finalize', 'status'].every(name => typeof source?.[name] === 'function')
        && operatorConfig && typeof enqueueSuccessor === 'function'
        && (authorizeCommand === undefined || typeof authorizeCommand === 'function'), 'ASTRA_SOURCE_CONFIGURATION_REQUIRED');
    const transaction = work => client.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
        const result = await work(tx); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return result;
    }, { maxWait: 5000, timeout: 10000 });
    async function operation(tx, id) {
        uuid.parse(id); const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceOperation" WHERE id=${id}::uuid`;
        return operationRecord(row);
    }
    async function resultEvent(tx, card, requestId) {
        const key = eventKey(requestId);
        const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceOperation"
            WHERE "actorId"=${card.claim.actorId}::uuid AND "operationId"=${key}`;
        if (!row) return null;
        const event = operationRecord(row); check(event.cardId === card.id && event.action === 'MACHINE_SOURCE_RESULT'
            && event.result?.actor === 'MACHINE' && event.result.requestId === requestId
            && event.result.runId === card.claim.runId && event.result.captureHash === card.captureHash
            && event.result.claimFence === card.claimFence, 'ASTRA_SOURCE_RESULT_CHANGED'); return event;
    }
    async function insertOperation(tx, event) {
        const text = canonical(event); check(Buffer.byteLength(text) <= 262144, 'ASTRA_SOURCE_RECORD_INVALID');
        await tx.$executeRaw`INSERT INTO atlas_staff."StaffWorkspaceOperation"
            (id,"actorId","operationId","cardId",action,"inputHash",canonical,"contentHash","createdAt")
            VALUES(${event.id}::uuid,${event.actorId}::uuid,${event.operationId},${event.cardId}::uuid,${event.action},${event.inputHash},
                ${text},${digest(text)},(${new Date(event.createdAt)}::timestamptz AT TIME ZONE 'UTC'))`;
    }
    async function updateCard(tx, previous, next, now) {
        check(next.revision === previous.revision + 1 && same(next.claim, previous.claim) && same(next.source, previous.source)
            && next.captureHash === previous.captureHash && next.captureRevision === previous.captureRevision
            && next.claimFence === previous.claimFence && next.specimenId === previous.specimenId, 'ASTRA_SOURCE_SCOPE_CHANGED');
        const text = canonical(next); check(Buffer.byteLength(text) <= 262144, 'ASTRA_SOURCE_RECORD_INVALID');
        const changed = await tx.$executeRaw`UPDATE atlas_staff."StaffWorkspaceCard" SET revision=${next.revision},state=${next.state},stage=${next.stage},
            canonical=${text},"contentHash"=${digest(text)},"updatedAt"=(${now}::timestamptz AT TIME ZONE 'UTC')
            WHERE id=${previous.id}::uuid AND revision=${previous.revision}`;
        check(changed === 1, 'ASTRA_SOURCE_SCOPE_CHANGED');
    }
    async function load(tx, runId) {
        const privateContext = await authority.controls(tx), { now, staff, source: sourceControl, workspace: workspaceControl } = privateContext;
        const [control] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperatorControl" WHERE id='active'`;
        const [bridge] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active'`;
        check(control?.enabled && ['mode', 'releaseSha', 'buildHash', 'configHash', 'providerBindingHash'].every(key => control[key] === operatorConfig[key]),
            'ASTRA_NOT_ENABLED');
        const policy = parseControlPolicy(checked(control.policyCanonical, control.policyHash)), budget = parsePilotPolicy(checked(bridge?.policyCanonical, bridge?.policyHash));
        check(instant(now) && bridge?.enabled && bridge.mode === control.mode && staff.mode === control.mode
            && staff.gradingPolicyHash === bridge.gradingPolicyHash && policy.pilotId === budget.pilotId && budget.pilotId === sourceControl.pilotId
            && budget.version === 'atlas-workspace-bridge-policy-v1' && +new Date(policy.expiresAt) > +now && +new Date(budget.expiresAt) > +now
            && workspaceControl.claimsEnabled && workspaceControl.astraEnabled && workspaceControl.preparationEnabled, 'ASTRA_PILOT_NOT_ACTIVE');
        const [{ count }] = await tx.$queryRaw`SELECT atlas_staff.operator_workspace_count(${budget.pilotId}::uuid) AS count`;
        check(count === budget.workspaceCardIds.length, 'ASTRA_WORKSPACE_ROSTER_INCOMPLETE');
        const [run] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_private_run(${runId}::uuid)`;
        check(run && run.id === runId && run.phase === 'CAPTURE_REVIEW' && run.state === 'PREPARATION_READY'
            && run.runtimeHash === operatorConfig.configHash && run.policyHash === control.policyHash && run.gradingPolicyHash === bridge.gradingPolicyHash
            && run.pilotId === policy.pilotId && budget.workspaceCardIds.includes(run.workspaceCardId)
            && instant(run.deadlineAt) && run.deadlineAt > now, 'ASTRA_CAPTURE_PREPARATION_NOT_CURRENT');
        toolsForRun(policy, run);
        const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceCard" WHERE id=${run.workspaceCardId}::uuid FOR UPDATE`;
        const card = cardRecord(row);
        // A completed handoff is recovered through the existing successor's
        // immutable job/admission/result checks, without another source call.
        if (card.claim?.kind === 'ASTRA' && card.claim.runId !== runId) {
            const [successorRow] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceOperation"
                WHERE "cardId"=${card.id}::uuid AND action='MACHINE_REPORT_SUCCESSOR'
                AND canonical::jsonb->'result'->>'captureRunId'=${runId}`;
            const saved = operationRecord(successorRow);
            check(saved.actorId === card.claim.actorId && saved.result?.captureRunId === runId
                && saved.result.reportRunId === card.claim.runId && saved.result.claimFence === card.claimFence, 'ASTRA_SOURCE_SCOPE_CHANGED');
            const successor = await enqueueSuccessor(tx, operatorConfig, { requestId: saved.result.sourceRequestId });
            return { successor, card, run, now };
        }
        const manifest = assertCaptureScope(run, card, checked(run.manifestCanonical, run.manifestHash));
        const pending = card.workspace?.pending, intent = pending ? await operation(tx, pending.requestId) : null;
        const request = { ...(pending ? { requestId: pending.requestId } : {}), cardId: card.id,
            scope: scope(card, run, intent?.result?.payload?.machine), binding: pending?.binding ?? boundCard(card) };
        const current = await authority.current(tx, request);
        check(current.identity.id === card.claim.actorId && current.identity.accessVersion === card.claim.accessVersion
            && current.staff.revision === card.claim.controlRevision && same(current.card, card), 'ASTRA_SOURCE_SCOPE_CHANGED');
        const [{ count: pendingAttempts }] = await tx.$queryRaw`SELECT count(*) AS count FROM atlas_staff."StaffOperatorAttempt"
            WHERE "runId"=${runId}::uuid AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN')`;
        check(Number(pendingAttempts) === 0, 'ASTRA_SOURCE_WORK_UNRESOLVED');
        const [selected] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperatorStep"
            WHERE "runId"=${runId}::uuid AND revision=${run.revision} AND "toolName"='submit_capture_preparation'`;
        check(selected?.runId === runId && selected.revision === run.revision, 'ASTRA_SOURCE_SELECTION_CHANGED');
        const submitted = CAPTURE_TOOL_SCHEMAS.submit_capture_preparation.parse(checked(selected.requestCanonical, selected.requestHash));
        const output = checked(selected.resultCanonical, selected.resultHash);
        check(submitted.runId === runId && submitted.evidenceHash === run.evidenceHash && submitted.manifestHash === run.manifestHash
            && submitted.expectedRevision + 1 === run.revision && same(output.binding, { runId, evidenceHash: run.evidenceHash,
                manifestHash: run.manifestHash, expectedRevision: run.revision }), 'ASTRA_SOURCE_SELECTION_CHANGED');
        const images = await tx.$queryRaw`SELECT i.canonical,i.hash FROM atlas_staff."StaffOperatorImage" i
            JOIN atlas_staff."StaffOperatorImageDelivery" d ON d."imageId"=i."imageId"
            WHERE i."runId"=${runId}::uuid AND d."attemptId"=${selected.attemptId}::uuid`;
        const delivered = images.map(row => checked(row.canonical, row.hash).asset);
        for (const asset of manifest.assets) check(['sha256', 'byteCount', 'contentType', 'width', 'height'].every(key =>
            asset[key] === current.originals[asset.side].verification[key])
            && delivered.some(value => value.assetId === asset.assetId && value.sha256 === asset.sha256 && value.side === asset.side),
        'ASTRA_SOURCE_ORIGINALS_CHANGED');
        const selection = await selectedCapturePreparation({ call: { name: 'submit_capture_preparation', args: submitted },
            run: { ...run, revision: run.revision - 1 }, manifest, tx: { staffOperatorStep: {
                async findUnique({ where }) { const [value] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperatorStep" WHERE id=${where.id}::uuid`; return value; },
            } } }, async (_data, refs) => check(refs.every(ref => manifest.assets.some(asset => asset.assetId === ref.assetId
                && asset.sha256 === ref.sha256 && asset.side === ref.side) && delivered.some(asset => asset.assetId === ref.assetId
                    && asset.sha256 === ref.sha256 && asset.side === ref.side)), 'ASTRA_SOURCE_EVIDENCE_UNDELIVERED'));
        check(same(selection, output.result), 'ASTRA_SOURCE_SELECTION_CHANGED');
        if (intent) {
            check(intent.action === 'MACHINE_SOURCE_ACTION' && intent.id === request.requestId && intent.actorId === card.claim.actorId
                && intent.cardId === card.id && intent.result.actor === 'MACHINE' && intent.result.phase === 'REQUESTED'
                && intent.result.requestId === request.requestId && intent.result.accessVersion === card.claim.accessVersion
                && intent.result.action === pending.action && intent.result.payload.side === pending.side
                && same(intent.result.binding, pending.binding), 'ASTRA_SOURCE_INTENT_CHANGED');
            const authorized = await authority.loadInTransaction(request, tx); await authority.recheck(request, authorized, tx);
        }
        return { tx, now, run, card, selected, selection, request, intent };
    }
    async function retain(runId, commandId) {
        return transaction(async tx => {
            const context = await load(tx, runId), { card, run, now, selection, selected, intent } = context;
            if (context.successor) return { done: 'READY', reportRunId: context.successor.id };
            // The fixed private dispatcher checks its saved human command under
            // this same lock. A later STEP cannot be consumed by an older call.
            if (authorizeCommand) await authorizeCommand(tx, { run, card, intent, commandId });
            if (intent) return { ...context, dispatch: false };
            if (run.controlState !== 'RUNNING' || run.executionMode === 'STEP' && run.stepBudget !== 1)
                return { done: run.controlState === 'TAKEN_OVER' ? 'TAKEN_OVER' : 'PAUSED' };
            check(['CONTINUOUS', 'STEP'].includes(run.executionMode), 'ASTRA_CONTROL_INVALID');
            let action = 'INITIALIZE_REPORT', chosen;
            for (const candidate of [...sides, 'PAIR']) {
                const kind = candidate === 'PAIR' ? 'INITIALIZE_REPORT' : 'PREPARE_SIDE';
                const operationId = `source_${digest(canonical({ runId, selectionResultHash: selected.resultHash, action: kind, side: candidate }))}`;
                const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceOperation"
                    WHERE "actorId"=${card.claim.actorId}::uuid AND "operationId"=${operationId}`;
                if (!row) { action = kind; chosen = { side: candidate === 'PAIR' ? undefined : candidate, operationId }; break; }
                const prior = operationRecord(row), outcome = await resultEvent(tx, card, prior.id);
                check(prior.action === 'MACHINE_SOURCE_ACTION' && prior.result.payload.machine.runId === runId
                    && prior.result.payload.machine.selectionResultHash === selected.resultHash, 'ASTRA_SOURCE_INTENT_CHANGED');
                if (!outcome || outcome.result.state !== 'SUCCEEDED') return { done: 'NEEDS_ATTENTION' };
            }
            check(chosen, 'ASTRA_SOURCE_SUCCESSOR_UNCONFIRMED');
            const { category, ...identity } = selection.identity;
            try { canonicalizeNewSpeedsterSessionIdentity(category, identity); }
            catch { check(false, 'ASTRA_SOURCE_IDENTITY_REQUIRED'); }
            const machine = { runId, runRevision: run.revision, leaseFence: run.leaseFence, runControlRevision: run.controlRevision,
                selectionStepId: selected.id, selectionResultHash: selected.resultHash };
            if (run.executionMode === 'STEP') {
                const rows = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceOperation"
                    WHERE "cardId"=${card.id}::uuid AND "actorId"=${card.claim.actorId}::uuid AND action='OPERATOR_CONTROL'
                    AND canonical::jsonb#>>'{result,action}'='STEP'
                    AND canonical::jsonb#>>'{result,runId}'=${runId}
                    AND canonical::jsonb#>>'{result,runControlRevision}'=${String(run.controlRevision)}`;
                check(rows.length === 1, 'ASTRA_SOURCE_STEP_PERMIT_REQUIRED'); const permit = operationRecord(rows[0]);
                check(permit.result.runId === runId && permit.result.runControlRevision === run.controlRevision
                    && permit.result.claimFence === card.claimFence && permit.result.control.mode === 'STEP'
                    && permit.result.control.state === 'RUNNING' && +new Date(permit.createdAt) >= +new Date(selected.createdAt), 'ASTRA_SOURCE_STEP_PERMIT_REQUIRED');
                machine.permitOperationId = permit.id;
            }
            const requestId = randomUUID(), next = { ...card, revision: card.revision + 1, stage: 'PREPARATION',
                workspace: copy(card.workspace ?? {}), updatedAt: now.toISOString() }, binding = boundCard(next);
            const payload = { ...(chosen.side ? { side: chosen.side } : {}), machine };
            next.workspace.pending = { requestId, operationId: chosen.operationId, action, ...(chosen.side ? { side: chosen.side } : {}), binding };
            next.workspace.machineCapture = { actor: 'MACHINE', runId, selectionStepId: selected.id, selectionResultHash: selected.resultHash,
                manifestHash: run.manifestHash, identity: selection.identity, cornerShape: selection.cornerShape, boundaries: selection.boundaries };
            const event = { id: requestId, actorId: card.claim.actorId, operationId: chosen.operationId, cardId: card.id, action: 'MACHINE_SOURCE_ACTION',
                inputHash: digest(canonical({ action, cardId: card.id, input: { payload, binding } })), createdAt: now.toISOString(),
                result: { actor: 'MACHINE', actorId: card.claim.actorId, accessVersion: card.claim.accessVersion,
                    requestId, action, payload, binding, phase: 'REQUESTED', revision: next.revision } };
            await updateCard(tx, card, next, now); await insertOperation(tx, event);
            const request = { requestId, cardId: card.id, scope: scope(card, run, machine), binding };
            const authorized = await authority.loadInTransaction(request, tx); await authority.recheck(request, authorized, tx);
            const [permit] = await tx.$queryRaw`SELECT * FROM atlas_staff.claim_workspace_source_permit(${requestId}::uuid)`;
            check(permit?.state === 'ACTIVE' && permit.requestId === requestId && permit.runId === runId
                && permit.runControlRevision === machine.runControlRevision && permit.claimFence === card.claimFence
                && permit.captureHash === card.captureHash, 'ASTRA_SOURCE_PERMIT_CHANGED');
            return { ...context, card: next, request, intent: event, dispatch: true };
        });
    }
    function validatedReply(saved, value) {
        const result = sourceResult.parse(value), { request, intent, selection } = saved;
        check(result.requestId === request.requestId && result.cardId === request.cardId && result.captureHash === request.binding.captureHash
            && result.claimFence === request.binding.claimFence && result.action === intent.result.action
            && result.side === intent.result.payload.side, 'ASTRA_SOURCE_RESULT_CHANGED');
        if (result.state === 'SUCCEEDED' && result.action === 'PREPARE_SIDE') {
            const proposal = selection.boundaries.find(value => value.side === result.side), prepared = result.preparation;
            check(prepared && prepared.width * prepared.height <= 64 * 1024 * 1024 && same(prepared.sourceCorners, proposal.corners)
                && prepared.matColor === proposal.matColor && sanitizeSpeedsterUnitQuad(prepared.sourceCorners)
                && prepared.centeringProposal && sanitizeSpeedsterUnitQuad(prepared.centeringProposal)
                && result.specimenId === undefined && result.failureCode === undefined, 'ASTRA_SOURCE_PREPARATION_UNCONFIRMED');
        } else check(result.preparation === undefined, 'ASTRA_SOURCE_RESULT_CHANGED');
        if (result.state === 'SUCCEEDED' && result.action === 'INITIALIZE_REPORT') check(result.specimenId === request.cardId, 'ASTRA_SOURCE_INITIALIZATION_UNCONFIRMED');
        return result;
    }
    async function callSource(method, saved, signal) {
        signal?.throwIfAborted();
        const controller = new AbortController(); let timer;
        const abort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abort, { once: true });
        const stopped = new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => {
            const error = new Error('Astra source outcome is unconfirmed.'); error.code = 'ASTRA_SOURCE_OUTCOME_UNCONFIRMED'; reject(error);
        }, { once: true }));
        const remaining = Math.min(210000, +saved.run.deadlineAt - +saved.now);
        check(Number.isFinite(remaining) && remaining > 0, 'ASTRA_PILOT_NOT_ACTIVE');
        timer = setTimeout(() => controller.abort(), remaining);
        try { return await Promise.race([source[method](saved.request, { signal: controller.signal }), stopped]); }
        finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }
    async function settle(saved, reply) {
        if (reply.state === 'PENDING') return { state: 'HELD', code: 'ASTRA_SOURCE_PENDING' };
        return transaction(async tx => {
            const context = await load(tx, saved.run.id);
            if (context.successor) return { state: 'READY', reportRunId: context.successor.id };
            const { card, run, now, selected } = context, prior = await resultEvent(tx, card, saved.request.requestId);
            if (prior) {
                check(same(Object.fromEntries(Object.keys(reply).filter(key => key !== 'cardId').map(key => [key, reply[key]])),
                    Object.fromEntries(Object.keys(reply).filter(key => key !== 'cardId').map(key => [key, prior.result[key]]))), 'ASTRA_SOURCE_RESULT_CHANGED');
                if (reply.state !== 'SUCCEEDED') return { state: 'NEEDS_ATTENTION', code: reply.failureCode ?? 'ASTRA_SOURCE_OUTCOME_UNCONFIRMED' };
            } else {
                check(context.intent?.id === saved.request.requestId && same(context.request.binding, saved.request.binding)
                    && same(context.intent.result, saved.intent.result), 'ASTRA_SOURCE_SCOPE_CHANGED');
                const next = { ...card, revision: card.revision + 1, workspace: copy(card.workspace ?? {}), updatedAt: now.toISOString() };
                if (reply.state === 'SUCCEEDED' && reply.action === 'PREPARE_SIDE') {
                    const prepared = reply.preparation, inner = prepared.centeringProposal, bordersMm = measureSpeedsterCenteringBorders(inner);
                    const ratio = pair => pair.map(number => Number(number.toFixed(2))).join(' / ');
                    next.workspace.preparation = { ...next.workspace.preparation, [reply.side]: { ...prepared, status: 'PREPARED', actor: 'MACHINE',
                        corners: prepared.sourceCorners, requestId: saved.request.requestId, selectionStepId: selected.id } };
                    next.workspace.centering = { ...next.workspace.centering, [reply.side]: { actor: 'MACHINE', status: 'ADOPTED_FROM_WORKER',
                        outer: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], inner,
                        preparationHash: prepared.manifestHash, bordersMm, ratios: { leftRight: ratio(calculateCenteringBalance(bordersMm.leftMm, bordersMm.rightMm)),
                            topBottom: ratio(calculateCenteringBalance(bordersMm.topMm, bordersMm.bottomMm)) }, score: calculateCenteringScore(bordersMm),
                        requestId: saved.request.requestId, selectedAt: now.toISOString() } };
                    delete next.workspace.pending; next.state = 'IN_PROGRESS'; next.attention = null;
                    next.stage = sides.every(side => next.workspace.preparation[side]?.status === 'PREPARED') ? 'CENTERING' : 'PREPARATION';
                } else if (reply.state !== 'SUCCEEDED') {
                    next.state = 'NEEDS_ATTENTION'; next.attention = 'Astra needs a human review of this source action.';
                    next.workspace.lastFailure = { requestId: saved.request.requestId, action: reply.action,
                        code: reply.failureCode ?? 'ASTRA_SOURCE_OUTCOME_UNCONFIRMED' };
                    if (reply.state === 'FAILED') delete next.workspace.pending;
                }
                const result = { ...copy(reply), actor: 'MACHINE', runId: run.id, selectionStepId: selected.id,
                    selectionResultHash: selected.resultHash, revision: next.revision }; delete result.cardId;
                await updateCard(tx, card, next, now);
                await insertOperation(tx, { id: randomUUID(), actorId: card.claim.actorId, operationId: eventKey(saved.request.requestId),
                    cardId: card.id, action: 'MACHINE_SOURCE_RESULT', inputHash: digest(canonical({ requestId: saved.request.requestId })),
                    result, createdAt: now.toISOString() });
            }
            await tx.$executeRaw`SELECT atlas_staff.finish_workspace_source_permit(${saved.request.requestId}::uuid,${reply.state})`;
            if (reply.state === 'SUCCEEDED' && reply.action === 'INITIALIZE_REPORT') {
                const successor = await enqueueSuccessor(tx, operatorConfig, { requestId: saved.request.requestId });
                return { state: 'READY', reportRunId: successor.id };
            }
            return reply.state === 'SUCCEEDED' ? { state: run.executionMode === 'STEP' || run.controlState !== 'RUNNING' ? 'PAUSED' : 'ACTION_COMPLETE' }
                : { state: 'NEEDS_ATTENTION', code: reply.failureCode ?? 'ASTRA_SOURCE_OUTCOME_UNCONFIRMED' };
        });
    }
    return { async run(input) {
        const { runId, commandId } = z.strictObject({ runId: uuid, signal: z.instanceof(AbortSignal).optional(),
            ...(authorizeCommand ? { commandId: uuid } : {}) }).parse(input);
        let actions = 0;
        for (let ordinal = 0; ordinal < 3; ordinal++) {
            if (input.signal?.aborted) return { runId, state: 'STOPPED', actions, code: 'ASTRA_RUNNER_STOPPED' };
            let saved;
            try {
                saved = await retain(runId, commandId);
                if (saved.done) return { runId, state: saved.done, actions, ...(saved.reportRunId ? { reportRunId: saved.reportRunId } : {}) };
                const method = saved.dispatch ? saved.intent.result.action === 'PREPARE_SIDE' ? 'prepare' : 'finalize' : 'status';
                if (saved.dispatch) actions++;
                const reply = validatedReply(saved, await callSource(method, saved, input.signal));
                const result = await settle(saved, reply);
                if (result.state !== 'ACTION_COMPLETE') return { runId, actions, ...result };
            } catch (error) { return { runId, state: 'HELD', actions, code: safeError(error),
                ...(saved?.request?.requestId ? { requestId: saved.request.requestId } : {}) }; }
        }
        return { runId, state: 'HELD', actions, code: 'ASTRA_SOURCE_BOUND_REACHED' };
    } };
}
