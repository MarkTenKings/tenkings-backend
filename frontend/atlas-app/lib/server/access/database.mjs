import { deny } from '../policy.mjs';
import { assertStaffPrivileges } from './privileges.mjs';

/** The client stays inside the server adapter; routes receive named operations. */
export class StaffDatabase {
    constructor(client, config) { this.client = client; this.config = config; }
    async transaction(work) {
        return this.client.$transaction(async tx => {
            await assertStaffPrivileges(tx);
            // The initial small staff roster uses one short database gate. No
            // provider, image, file or other external work may run inside it.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1', 0))`;
            const controls = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_control()`;
            const control = controls[0], config = this.config;
            if (!control || !control.enabled || control.mode !== config.mode || control.origin !== config.origin
                || control.deploymentId !== config.deploymentId || control.releaseSha !== config.releaseSha
                || control.configHash !== config.configHash) deny(503, 'STAFF_ACCESS_NOT_ENABLED');
            const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            const result = await work({ tx, control, now });
            // Surface deferred errors before Prisma 5.22 can return a success
            // from a callback whose PostgreSQL COMMIT actually rolled back.
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            return result;
        }, { maxWait: 5000, timeout: 10_000 });
    }
}
