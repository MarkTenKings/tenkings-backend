import { parsePublicReport } from '@atlas/report-view/public-contract';
import { digest, unavailable } from './policy.mjs';
import { assertPublicPrivileges } from './privileges.mjs';
import { canonical } from '@atlas/service-bridge/protocol';
import { parseApprovedImageDescriptor } from '@atlas/service-bridge/public-media';
import { parseSpeedsterTraceRleV1, decodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { encodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';

export class PublicReportReader {
    constructor(client, config, media = null) { this.client = client; this.config = config; this.media = media; }
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
    async imageDescriptor({ token, version, side }) {
        if (!version || !['FRONT', 'BACK'].includes(side)) return null;
        const config = this.config;
        return this.client.$transaction(async tx => {
            await assertPublicPrivileges(tx);
            const rows = await tx.$queryRaw`SELECT * FROM atlas_staff.read_approved_image(${token}::text,${version}::integer,${side}::text,
                ${config.deploymentId}::text,${config.releaseSha}::text,${config.configHash}::text)`;
            if (!rows.length) return null;
            if (rows.length !== 1 || rows[0].mode !== config.mode || digest(rows[0].canonical) !== rows[0].digest) unavailable();
            const descriptor = parseApprovedImageDescriptor(JSON.parse(rows[0].canonical), config.mode);
            if (canonical(descriptor) !== rows[0].canonical) unavailable();
            return { descriptor, publicHash: rows[0].public_hash };
        }, { maxWait: 5000, timeout: 10_000 });
    }
    async image(selector) {
        const selected = await this.imageDescriptor(selector); if (!selected) return null;
        if (!this.media) unavailable();
        const bytes = Buffer.from(await this.media.read({ ...selector, publicHash: selected.publicHash, imageHash: selected.descriptor.sha256 }, selected.descriptor));
        if (bytes.length !== selected.descriptor.byteCount || digest(bytes) !== selected.descriptor.sha256
            || canonical(await this.imageDescriptor(selector)) !== canonical(selected)) unavailable();
        return { bytes, contentType: selected.descriptor.contentType };
    }
    async trace({ token, version, findingId }) {
        if (!version || typeof findingId !== 'string' || findingId.length < 1 || findingId.length > 180) return null;
        const config = this.config;
        return this.client.$transaction(async tx => {
            await assertPublicPrivileges(tx);
            const rows = await tx.$queryRaw`SELECT * FROM atlas_staff.read_approved_trace(${token}::text,${version}::integer,${findingId}::text,
                ${config.deploymentId}::text,${config.releaseSha}::text,${config.configHash}::text)`;
            if (!rows.length) return null;
            if (rows.length !== 1 || !['FRONT', 'BACK'].includes(rows[0].side)) unavailable();
            const trace = parseSpeedsterTraceRleV1(JSON.parse(rows[0].trace));
            return { side: rows[0].side, publicHash: rows[0].public_hash,
                traceWire: encodeSpeedsterTraceBitmapWireV1(decodeSpeedsterTraceRleV1(trace), trace.sha256) };
        }, { maxWait: 5000, timeout: 10_000 });
    }
}
