import { parsePublicReport } from '@atlas/report-view/public-contract';
import { digest, unavailable } from './policy.mjs';
import { assertPublicPrivileges } from './privileges.mjs';
import { canonical } from '@atlas/service-bridge/protocol';
import { parseApprovedImageDescriptor } from '@atlas/service-bridge/public-media';
import { parseSpeedsterTraceRleV1, decodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { encodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';
import { parseReportPresentation } from '@atlas/report-view/presentation-contract';

export class PublicReportReader {
    constructor(client, config, media = null, manual = null) { if (!client && (!manual || media)) unavailable(); this.client = client; this.config = config; this.media = media; this.manual = manual; }
    async manualReport({ token, version }) {
        if (!this.manual) return null;
        const result = await this.manual.read({ kind: 'REPORT', token, version, side: null, findingId: null });
        if (!result) return null;
        const packet = parsePublicManualReport(result.packet);
        if (packet.mode !== this.config.mode || packet.publicToken !== token || version !== null && packet.approvalVersion !== version
            || digest(JSON.stringify(packet)) !== result.publicHash) unavailable();
        let presentation = null;
        try { if (result.presentation) presentation = parseReportPresentation(result.presentation,
            { publicToken: token, approvalVersion: packet.approvalVersion, publicHash: result.publicHash }); } catch { /* Optional presentation cannot replace or suppress the verified grading packet. */ }
        return { packet, publicHash: result.publicHash, explanation: explainAtlasManualReport(packet.report), ...(presentation ? { presentation } : {}) };
    }
    async presentationImage({ token, version, revision }) {
        const report = await this.manualReport({ token, version }), extra = report?.presentation;
        if (!extra?.slabPhoto || extra.revision !== revision) return null;
        const found = await this.manual.read({ kind: 'PRESENTATION_IMAGE', token, version, side: null, findingId: null, presentationRevision: revision });
        if (!found) return null;
        const bytes = Buffer.from(found);
        if (bytes.length !== extra.slabPhoto.byteCount || digest(bytes) !== extra.slabPhoto.sha256) unavailable();
        return { bytes, contentType: extra.slabPhoto.contentType };
    }
    async read({ token, version }) {
        const config = this.config;
        const legacy = this.client ? await this.client.$transaction(async tx => {
            await assertPublicPrivileges(tx);
            const rows = await tx.$queryRaw`SELECT * FROM atlas_staff.read_approved_report(${token}::text,${version}::integer,
                ${config.deploymentId}::text,${config.releaseSha}::text,${config.configHash}::text)`;
            if (!rows.length) return null;
            if (rows.length !== 1 || digest(rows[0].canonical) !== rows[0].digest) unavailable();
            const packet = parsePublicReport(JSON.parse(rows[0].canonical));
            if (packet.mode !== config.mode || packet.publicToken !== token || (version !== null && packet.approvalVersion !== version)) unavailable();
            return { packet, publicHash: rows[0].digest };
        }, { maxWait: 5000, timeout: 10_000 }) : null;
        return legacy ?? this.manualReport({ token, version });
    }
    async imageDescriptor({ token, version, side }) {
        if (!version || !['FRONT', 'BACK'].includes(side)) return null;
        const config = this.config;
        const legacy = this.client ? await this.client.$transaction(async tx => {
            await assertPublicPrivileges(tx);
            const rows = await tx.$queryRaw`SELECT * FROM atlas_staff.read_approved_image(${token}::text,${version}::integer,${side}::text,
                ${config.deploymentId}::text,${config.releaseSha}::text,${config.configHash}::text)`;
            if (!rows.length) return null;
            if (rows.length !== 1 || rows[0].mode !== config.mode || digest(rows[0].canonical) !== rows[0].digest) unavailable();
            const descriptor = parseApprovedImageDescriptor(JSON.parse(rows[0].canonical), config.mode);
            if (canonical(descriptor) !== rows[0].canonical) unavailable();
            return { descriptor, publicHash: rows[0].public_hash };
        }, { maxWait: 5000, timeout: 10_000 }) : null;
        if (legacy) return legacy;
        const manual = await this.manualReport({ token, version });
        return manual ? { descriptor: manual.packet.images[side], publicHash: manual.publicHash, manual: true } : null;
    }
    async image(selector) {
        const selected = await this.imageDescriptor(selector); if (!selected) return null;
        if (!(selected.manual ? this.manual : this.media)) unavailable();
        const found = selected.manual ? await this.manual.read({ kind: 'IMAGE', ...selector, findingId: null })
            : await this.media.read({ ...selector, publicHash: selected.publicHash, imageHash: selected.descriptor.sha256 }, selected.descriptor);
        if (!found) unavailable();
        const bytes = Buffer.from(found);
        if (bytes.length !== selected.descriptor.byteCount || digest(bytes) !== selected.descriptor.sha256
            || canonical(await this.imageDescriptor(selector)) !== canonical(selected)) unavailable();
        return { bytes, contentType: selected.descriptor.contentType };
    }
    async trace({ token, version, findingId }) {
        if (!version || typeof findingId !== 'string' || findingId.length < 1 || findingId.length > 180) return null;
        const config = this.config;
        const legacy = this.client ? await this.client.$transaction(async tx => {
            await assertPublicPrivileges(tx);
            const rows = await tx.$queryRaw`SELECT * FROM atlas_staff.read_approved_trace(${token}::text,${version}::integer,${findingId}::text,
                ${config.deploymentId}::text,${config.releaseSha}::text,${config.configHash}::text)`;
            if (!rows.length) return null;
            if (rows.length !== 1 || !['FRONT', 'BACK'].includes(rows[0].side)) unavailable();
            const trace = parseSpeedsterTraceRleV1(JSON.parse(rows[0].trace));
            return { side: rows[0].side, publicHash: rows[0].public_hash,
                traceWire: encodeSpeedsterTraceBitmapWireV1(decodeSpeedsterTraceRleV1(trace), trace.sha256) };
        }, { maxWait: 5000, timeout: 10_000 }) : null;
        if (legacy) return legacy;
        const manual = await this.manualReport({ token, version });
        const finding = manual?.packet.report.findings.find(value => value.id === findingId), trace = finding?.finalTrace ?? finding?.detectorMask;
        if (!trace) return null;
        // This trace is already exact approved packet content; no second private
        // read or draft lookup can accidentally substitute a newer edit.
        return { side: finding.side, publicHash: manual.publicHash,
            traceWire: encodeSpeedsterTraceBitmapWireV1(decodeSpeedsterTraceRleV1(parseSpeedsterTraceRleV1(trace)), trace.sha256) };
    }
}
