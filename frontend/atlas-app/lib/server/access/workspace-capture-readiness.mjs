import { BoundaryError } from '../policy.mjs';

const codes = new Set(['WORKSPACE_ASTRA_NOT_ADMITTED', 'WORKSPACE_ASTRA_NOT_READY']);
export function captureReadiness(value) {
    if (value?.ready === true && value.code === null) return { ready: true, code: null };
    return { ready: false, code: value?.ready === false && codes.has(value.code) ? value.code : 'WORKSPACE_ASTRA_NOT_READY' };
}

/** Scalar projection through the existing granted read RPC. No private control
 * rows, pilot roster or run admission is exposed to the serving role. */
export async function readCaptureReadiness(context, card) {
    const [row] = await context.databaseTx.$queryRaw`SELECT atlas_staff.read_workspace_operator_control(${card.id}::uuid) AS control`;
    return captureReadiness(row?.control?.captureReadiness);
}

export function requireCaptureReadiness(value) {
    const result = captureReadiness(value);
    // Only call before any claim/run insertion. The same NOT_READY code after
    // a committed claim cannot establish that dispatch did not occur.
    if (!result.ready) throw Object.assign(new BoundaryError(409, result.code), { outcome: 'NOT_DISPATCHED' });
}
