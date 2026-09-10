import { requireBridge } from './protocol.mjs';

// The fresh-photo cohort has ten verified workspaces before any of them has a
// report. Its later specimen is resolved by the database's exact source link.
export async function pilotSubject(tx, policy, card) {
    if (policy.version === 'atlas-grading-bridge-policy-v1')
        return policy.specimenIds.includes(card.id) ? { specimenId: card.id, workspaceCardId: null } : null;
    const [row] = await tx.$queryRaw`SELECT atlas_staff.workspace_pilot_subject(${policy.pilotId}::uuid,${card.id}::uuid) AS id`;
    return row?.id && policy.workspaceCardIds.includes(row.id) ? { specimenId: card.id, workspaceCardId: row.id } : null;
}

export async function requireTenPilotCards(tx, policy, sourceType) {
    const [row] = policy.version === 'atlas-workspace-bridge-policy-v1'
        ? await tx.$queryRaw`SELECT atlas_staff.operator_workspace_count(${policy.pilotId}::uuid) AS count`
        : await tx.$queryRaw`SELECT count(*)::int AS count FROM atlas_staff."StaffSpecimen"
            WHERE id::text = ANY(${policy.specimenIds}::text[]) AND "sourceType"=${sourceType}`;
    requireBridge(row?.count === 10, 'PILOT_TEN_CARDS_REQUIRED');
}

export async function pilotUsage(tx, policy, card) {
    const subject = await pilotSubject(tx, policy, card);
    requireBridge(subject, 'PILOT_NOT_ACTIVE');
    const [usage] = subject.workspaceCardId
        ? await tx.$queryRaw`SELECT * FROM atlas_staff.workspace_pilot_budget_usage(${policy.pilotId}::uuid,${subject.workspaceCardId}::uuid)`
        : await tx.$queryRaw`SELECT * FROM atlas_staff.pilot_budget_usage(${policy.pilotId}::uuid,${card.id}::uuid)`;
    requireBridge(usage, 'PILOT_NOT_ACTIVE'); return usage;
}
