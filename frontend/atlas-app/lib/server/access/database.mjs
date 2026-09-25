import { deny } from '../policy.mjs';
import { assertStaffPrivileges } from './privileges.mjs';
import { markAccessFailure } from '../api-failure.mjs';

/** The client stays inside the server adapter; routes receive named operations. */
export class StaffDatabase {
    constructor(client, config) { this.client = client; this.config = config; }
    async readTransaction(work) { return this.transaction(work, { shared: true }); }
    async transaction(work, { shared = false } = {}) {
        let phase = 'STAFF_BEGIN';
        try { return await this.client.$transaction(async tx => {
            phase = 'STAFF_PRIVILEGES';
            await assertStaffPrivileges(tx);
            // Authentication-only reads share the gate. Session/rate mutations
            // retain the exclusive gate, so uploads do not serialize every
            // unrelated card's read-only authentication transaction.
            phase = 'STAFF_GLOBAL_LOCK';
            if (shared) await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('atlas-staff-access-v1', 0))`;
            else await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1', 0))`;
            phase = 'STAFF_CONTROL';
            const controls = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_control()`;
            const control = controls[0], config = this.config;
            if (!control || !control.enabled || control.mode !== config.mode || control.origin !== config.origin
                || control.deploymentId !== config.deploymentId || control.releaseSha !== config.releaseSha
                || control.configHash !== config.configHash) deny(503, 'STAFF_ACCESS_NOT_ENABLED');
            const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            phase = 'STAFF_WORK';
            const result = await work({ tx, control, now });
            // Surface deferred errors before Prisma 5.22 can return a success
            // from a callback whose PostgreSQL COMMIT actually rolled back.
            phase = 'STAFF_COMMIT';
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            return result;
        }, { maxWait: 5000, timeout: 10_000 });
        } catch (error) { throw markAccessFailure(error, phase); }
    }
}
