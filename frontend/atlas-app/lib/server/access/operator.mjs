// Only a scalar pending count crosses into the human app. Machine requests,
// private continuation and dispatch credentials are not serving-role data.
export async function operatorPending(tx, specimenId) {
    const [{ count }] = await tx.$queryRaw`SELECT atlas_staff.operator_work_pending(${specimenId}::uuid) AS count`;
    return count;
}
