import { parsePublicReport } from '@atlas/report-view/public-contract';
import { digest, unavailable } from './policy.mjs';
import { assertPublicPrivileges } from './privileges.mjs';

export class PublicReportReader {
    constructor(client, config) { this.client = client; this.config = config; }
    async read({ token, version }) {
        const config = this.config;
        return this.client.$transaction(async tx => {
            await assertPublicPrivileges(tx);
            const rows = await tx.$queryRaw`SELECT * FROM atlas_staff.read_approved_report(${token}::text,${version}::integer,
                ${config.deploymentId}::text,${config.releaseSha}::text,${config.configHash}::text)`;
            if (!rows.length) return null;
            if (rows.length !== 1 || digest(rows[0].canonical) !== rows[0].digest) unavailable();
            const packet = parsePublicReport(JSON.parse(rows[0].canonical));
            if (packet.mode !== config.mode || packet.publicToken !== token || (version !== null && packet.approvalVersion !== version)) unavailable();
            return { packet, publicHash: rows[0].digest };
        }, { maxWait: 5000, timeout: 10_000 });
    }
}
