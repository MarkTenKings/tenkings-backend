import Head from 'next/head';
import ReportGuidance from '../../components/ReportGuidance';
import Link from 'next/link';
import { publicHeaders, reportSelector } from '../../lib/server/policy.mjs';
import { runtime } from '../../lib/server/runtime.mjs';
import { ApprovedReportView } from '@atlas/manual-workspace/report-review';
import { useInspectionImages } from '../../components/useInspectionImages.mjs';
import ReportEntryNavigation from '../../components/ReportEntryNavigation';
export async function getServerSideProps(ctx) {
    publicHeaders(ctx.res);
    let selector;
    try { selector = reportSelector(ctx.params.token, ctx.query.v); }
    catch { return { notFound: true }; }
    try {
        const result = await runtime(ctx.req).read(selector);
        return result ? { props: result } : { notFound: true };
    } catch {
        ctx.res.statusCode = 503;
        return { props: { unavailable: true, unavailableReportPath: selector.version === null ? null : `/reports/${selector.token}?v=${selector.version}` } };
    }
}
export default function Report({ packet, publicHash, explanation, presentation, reportImages, unavailable, unavailableReportPath }) {
    const images = useInspectionImages(packet, publicHash, reportImages);
    if (unavailable) return <main className="public-page"><Head><title>ATLAS · Report unavailable</title></Head><ReportEntryNavigation reportPath={unavailableReportPath}/><Link className="atlas-brand" href="/" aria-label="ATLAS home"><img src="/brand/atlas-grading-logo.png" alt="ATLAS · Know what you have"/></Link><h1>This report is temporarily unavailable.</h1><p className="muted">Please try this link again later.</p></main>;
    const { identity } = packet.report;
    const path = `/reports/${packet.publicToken}?v=${packet.approvalVersion}`;
    return <main className="public-manual-report"><Head><title>{`${identity.playerName ?? identity.cardName} · ${packet.reportNumber} · ATLAS`}</title><meta name="robots" content="noindex,nofollow"/></Head>
            <ReportEntryNavigation reportPath={path}/>
            {packet.mode === 'LOCAL_FIXTURE' && <div className="demo-notice">SYNTHETIC DEMONSTRATION · This is not a physical card grade.</div>}
            <ApprovedReportView report={packet.report} explanation={explanation} images={images} geometry={packet.geometry} brandSrc="/brand/atlas-grading-logo.png" presentation={presentation}
                publication={{ publicToken: packet.publicToken, reportNumber: packet.reportNumber, version: packet.approvalVersion, approvedAt: packet.approvedAt, reportHash: publicHash, url: path }}/>
            <footer className="report-footer"><ReportGuidance reportKey={packet.publicToken}/><p>This is the saved human-approved report. Physical slab finishing and NFC are separate steps.</p></footer>
        </main>;
}
