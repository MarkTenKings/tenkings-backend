import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";

export default function RetiredAiGraderPerCardLabelPage() {
  const router = useRouter();
  const reportId = Array.isArray(router.query.reportId) ? router.query.reportId[0] : router.query.reportId;
  const publicReportHref = reportId ? `/ai-grader/reports/${encodeURIComponent(reportId)}` : null;

  return (
    <>
      <Head>
        <title>Ten Kings Label Printing Moved</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <main className="page">
        <section>
          <p className="eyebrow">Ten Kings AI Grader</p>
          <h1>Physical labels are managed by Label Sheets</h1>
          <p>
            The retired per-card label route is not production print authority. Approved Label V1 output is generated only from an
            authenticated, frozen label sheet and reserves its center circle for the physical NFC tag.
          </p>
          <div className="actions">
            <Link href="/ai-grader/labels/sheets">Open authenticated Label Sheets</Link>
            {publicReportHref ? <Link href={publicReportHref}>Open public card report</Link> : null}
          </div>
        </section>
      </main>
      <style jsx>{`
        .page {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background: #eef0ed;
          color: #171917;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        section {
          width: min(100%, 660px);
          padding: 30px;
          border: 1px solid #cdd2cc;
          border-radius: 8px;
          background: #ffffff;
        }
        .eyebrow {
          margin: 0 0 8px;
          color: #526056;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        h1 { margin: 0; font-size: clamp(28px, 5vw, 42px); line-height: 1.05; }
        section > p:not(.eyebrow) { margin: 18px 0 0; color: #4e554f; line-height: 1.6; }
        .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
        .actions :global(a) {
          min-height: 42px;
          display: inline-flex;
          align-items: center;
          padding: 9px 14px;
          border: 1px solid #1b211d;
          border-radius: 6px;
          background: #1b211d;
          color: #ffffff;
          font-weight: 750;
          text-decoration: none;
        }
        .actions :global(a + a) { background: #ffffff; color: #171917; }
      `}</style>
    </>
  );
}
