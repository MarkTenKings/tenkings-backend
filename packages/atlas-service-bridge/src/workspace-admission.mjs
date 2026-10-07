import { canonical, digest, requireBridge as check } from './protocol.mjs';

/** Private source composition only. The original ports validate signed
 * preparation and project its unchanged evidence; the definer creates the
 * specimen, empty review, assignment, source receipt and workspace link once. */
export async function admitWorkspaceSource({ client, authority, ports, sourceConfigHash, transaction: existing, authorized: retainedAuthority }, request) {
    const authorized = retainedAuthority ?? await authority.load(request);
    const persist = async tx => {
        await tx.$executeRaw`SELECT atlas_staff.lock_workspace_private_controls()`;
        await authority.recheck(request, authorized, tx);
        const [prior] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceAdmission" WHERE "requestId"=${request.requestId}::uuid`;
        if (prior) {
            check(prior.cardId === request.cardId && prior.sourceConfigHash === sourceConfigHash
                && prior.actorId === request.scope.actorId, 'WORKSPACE_SOURCE_ADMISSION_CHANGED'); return prior;
        }
        const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_private_card(${request.cardId}::uuid)`;
        check(row && digest(row.canonical) === row.contentHash, 'WORKSPACE_SOURCE_ADMISSION_CHANGED');
        const card = JSON.parse(row.canonical); check(canonical(card) === row.canonical, 'WORKSPACE_SOURCE_ADMISSION_CHANGED');
        const source = await ports.loadSource(tx, { ...card.source, id: card.id });
        check(source.id === card.source.sourceId && source.createdByUserId === card.source.sourceOwnerId
            && source.workflowState === 'CAPTURED' && source.updatedAt instanceof Date, 'SOURCE_REVISION_CHANGED');
        await ports.assertSourceAdmission(source);
        const sourceRevision = source.updatedAt.toISOString(), sourceHash = digest(canonical(ports.reportSource(source)));
        const evidenceCanonical = canonical(await ports.sourceEvidence(source, sourceRevision)), evidenceHash = digest(evidenceCanonical);
        const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
        const [control] = await tx.$queryRaw`SELECT "gradingPolicyHash" FROM atlas_staff."StaffControl" WHERE id='active'`;
        const actorKind = request.scope.actorKind === 'MACHINE' ? 'MACHINE' : 'HUMAN';
        const admissionCanonical = canonical({ version: 'atlas-workspace-source-admission-v1', requestId: request.requestId,
            workspaceCardId: card.id, actorKind, captureHash: card.captureHash, claimFence: card.claimFence,
            sourceRevision, sourceHash, evidenceHash, sourceConfigHash, gradingPolicyHash: control.gradingPolicyHash,
            preparation: await ports.sourceAdmission(source) });
        const reviewCanonical = canonical({ revision: 1, evidenceRevision: 1, evidenceHash, observations: { FRONT: '', BACK: '' },
            reviewedSides: [], identityReviewed: false, disposition: 'IN_REVIEW', savedAt: null, savedBy: null });
        const packet = canonical({ ...await ports.sourceTitle(source), sourceRevision, sourceHash, sourceConfigHash,
            evidenceCanonical, evidenceHash, admissionCanonical, admissionHash: digest(admissionCanonical), reviewCanonical,
            workspaceCanonical: canonical({ ...card, specimenId: card.id, revision: card.revision + 1, updatedAt: now.toISOString() }) });
        const sessionHash = actorKind === 'HUMAN' ? request.scope.sessionHash : null;
        const [saved] = await tx.$queryRaw`SELECT * FROM atlas_staff.admit_workspace_source(${request.requestId}::uuid,${sessionHash},${packet})`;
        check(saved?.requestId === request.requestId && saved.specimenId === card.id, 'WORKSPACE_SOURCE_ADMISSION_CHANGED');
        return saved;
    };
    if (existing) return persist(existing);
    return client.$transaction(async tx => {
        const saved = await persist(tx); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return saved;
    }, { maxWait: 5000, timeout: 10000 });
}
