import { digest, unavailable } from './policy.mjs';
import { canonical } from '@atlas/service-bridge/protocol';
import { parseSpeedsterTraceRleV1, decodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { encodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';
import { parseReportPresentation } from '@atlas/report-view/presentation-contract';
import { parseInspectionAccess } from '@atlas/service-bridge/inspection-access';
import { parseReportImages } from '@atlas/report-view/report-images-contract';

export class PublicReportReader {
    constructor(config, manual) { if (typeof manual?.read !== 'function') unavailable(); this.config = config; this.manual = manual; }
    async manualReport({ token, version }) {
        const result = await this.manual.read({ kind: 'REPORT', token, version, side: null, findingId: null });
        if (!result) return null;
        const packet = parsePublicManualReport(result.packet);
        if (packet.mode !== this.config.mode || packet.publicToken !== token || version !== null && packet.approvalVersion !== version
            || digest(JSON.stringify(packet)) !== result.publicHash) unavailable();
        let presentation = null;
        try { if (result.presentation) presentation = parseReportPresentation(result.presentation,
            { publicToken: token, approvalVersion: packet.approvalVersion, publicHash: result.publicHash }); } catch { /* Optional presentation cannot replace or suppress the verified grading packet. */ }
        let reportImages = null;
        try { if (result.reportImages) reportImages = parseReportImages(result.reportImages, { packet, publicHash: result.publicHash }); }
        catch { /* A failed optional derivative never suppresses the approved report. */ }
        return { packet, publicHash: result.publicHash, explanation: explainAtlasManualReport(packet.report),
            ...(presentation ? { presentation } : {}), ...(reportImages ? { reportImages } : {}) };
    }
    async reportImage({ token, version, side, outputSha256 }) {
        if (!version || !['FRONT', 'BACK'].includes(side)
            || !/^[a-f0-9]{64}$/.test(outputSha256 ?? '')) return null;
        const selected = (await this.manualReport({ token, version }))?.reportImages?.images?.[side];
        if (!selected || selected.sha256 !== outputSha256) return null;
        const found = await this.manual.read({ kind: 'REPORT_IMAGE', token, version, side, findingId: null, outputSha256 });
        if (!found) return null;
        const bytes = Buffer.from(found);
        if (bytes.length !== selected.byteCount || digest(bytes) !== selected.sha256) unavailable();
        // A replacement or retirement during the object read cannot serve stale
        // presentation content, just as with original approved photographs.
        const current = (await this.manualReport({ token, version }))?.reportImages?.images?.[side];
        if (!current || canonical(current) !== canonical(selected)) return null;
        return { bytes, contentType: selected.contentType };
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
    async read(selector) {
        return this.manualReport(selector);
    }
    async imageDescriptor({ token, version, side }) {
        if (!version || !['FRONT', 'BACK'].includes(side)) return null;
        const manual = await this.manualReport({ token, version });
        return manual ? { descriptor: manual.packet.images[side], publicHash: manual.publicHash } : null;
    }
    async image(selector) {
        const selected = await this.imageDescriptor(selector); if (!selected) return null;
        const found = await this.manual.read({ kind: 'IMAGE', ...selector, findingId: null });
        if (!found) unavailable();
        const bytes = Buffer.from(found);
        if (bytes.length !== selected.descriptor.byteCount || digest(bytes) !== selected.descriptor.sha256
            || canonical(await this.imageDescriptor(selector)) !== canonical(selected)) unavailable();
        return { bytes, contentType: selected.descriptor.contentType };
    }
    async imageAccess({ token, version, side }) {
        if (!version || !['FRONT', 'BACK'].includes(side)) return null;
        const found = await this.manual.read({ kind: 'IMAGE_ACCESS', token, version, side, findingId: null });
        // The private reader verifies the immutable approved packet and its
        // exact media, then rechecks current publication authority before reply.
        return found ? parseInspectionAccess(found, { publicToken: token, approvalVersion: version, side }) : null;
    }
    async trace({ token, version, findingId }) {
        if (!version || typeof findingId !== 'string' || findingId.length < 1 || findingId.length > 180) return null;
        const manual = await this.manualReport({ token, version });
        const finding = manual?.packet.report.findings.find(value => value.id === findingId), trace = finding?.finalTrace ?? finding?.detectorMask;
        if (!trace) return null;
        // This trace is already exact approved packet content; no second private
        // read or draft lookup can accidentally substitute a newer edit.
        return { side: finding.side, publicHash: manual.publicHash,
            traceWire: encodeSpeedsterTraceBitmapWireV1(decodeSpeedsterTraceRleV1(parseSpeedsterTraceRleV1(trace)), trace.sha256) };
    }
}
