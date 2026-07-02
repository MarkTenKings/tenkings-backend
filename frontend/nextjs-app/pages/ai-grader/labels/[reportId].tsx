import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { getAiGraderReportBundle, type AiGraderReportBundle } from "../../../lib/aiGraderReportBundle";

export default function AiGraderLabelPreviewPage() {
  const router = useRouter();
  const fallbackBundle = getAiGraderReportBundle(router.query.reportId ?? "sample-final-v0");
  const [persistedBundle, setPersistedBundle] = useState<AiGraderReportBundle | null>(null);
  const bundle = persistedBundle ?? fallbackBundle;
  const release = bundle.productionRelease;
  const label = release?.label;
  const gradeText = label?.labelGradeText ?? "PENDING";
  const reportId = label?.reportId ?? bundle.reportId;
  const qrPayloadUrl = label?.qrPayloadUrl ?? `/ai-grader/reports/${reportId}`;
  const certId = label?.certId ?? reportId;

  useEffect(() => {
    if (!router.isReady) return;
    const nextReportId = Array.isArray(router.query.reportId) ? router.query.reportId[0] : router.query.reportId;
    if (!nextReportId || nextReportId === "sample-final-v0" || nextReportId === "sample-pr45") return;
    fetch(`/api/ai-grader/reports/${encodeURIComponent(nextReportId)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.ok === true && payload.bundle) {
          setPersistedBundle(payload.bundle);
        }
      })
      .catch(() => undefined);
  }, [router.isReady, router.query.reportId]);

  return (
    <>
      <Head>
        <title>Ten Kings AI Grader Label Preview</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="page">
        <section className="label" aria-label="Ten Kings AI Grader label preview">
          <div className="brand">Ten Kings AI Grader</div>
          <div className="grade">{gradeText}</div>
          <dl>
            <dt>Report ID</dt>
            <dd>{reportId}</dd>
            <dt>Cert/Report ID</dt>
            <dd>{certId}</dd>
            <dt>QR URL</dt>
            <dd>{qrPayloadUrl}</dd>
          </dl>
          <p>AI-Grader Report V0. Certification claim disabled until approved.</p>
        </section>
        <aside>
          <h1>Print-Ready Label Preview</h1>
          <p>
            This preview renders label-ready data for the AI Grader production workflow. It is not a printer integration,
            certificate, or certified grading claim.
          </p>
          <p>{persistedBundle ? "Loaded from persisted report data." : "Using local fixture/report fallback until persisted data is available."}</p>
        </aside>
      </main>
      <style jsx>{`
        .page {
          min-height: 100vh;
          display: grid;
          grid-template-columns: minmax(340px, 3.5in) minmax(0, 1fr);
          gap: 36px;
          align-items: center;
          padding: 40px;
          background: #f3efe5;
          color: #12110f;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .label {
          width: 3.5in;
          min-height: 2.1in;
          box-sizing: border-box;
          padding: 0.18in;
          border: 1px solid #171512;
          background: #fffaf0;
          border-radius: 8px;
          box-shadow: 0 28px 80px rgba(40, 32, 18, 0.16);
        }
        .brand {
          color: #8b6c2d;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }
        .grade {
          margin-top: 8px;
          font-size: 54px;
          line-height: 0.95;
          font-weight: 950;
        }
        dl {
          display: grid;
          grid-template-columns: 0.9in minmax(0, 1fr);
          gap: 5px 8px;
          margin: 10px 0 0;
          font-size: 10px;
        }
        dt {
          color: #6e6047;
          font-weight: 900;
          text-transform: uppercase;
        }
        dd {
          margin: 0;
          overflow-wrap: anywhere;
        }
        .label p {
          margin: 12px 0 0;
          padding-top: 8px;
          border-top: 1px solid #ddd0af;
          color: #7a2b2b;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        aside {
          max-width: 600px;
        }
        h1 {
          margin: 0;
          font-size: 42px;
          letter-spacing: 0;
        }
        aside p {
          margin: 14px 0 0;
          color: #5c574f;
          line-height: 1.55;
        }
        @media (max-width: 820px) {
          .page {
            grid-template-columns: 1fr;
            padding: 20px;
          }
          .label {
            width: min(3.5in, 100%);
          }
        }
      `}</style>
    </>
  );
}
