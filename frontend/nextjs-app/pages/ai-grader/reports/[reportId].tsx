import Head from "next/head";
import { useRouter } from "next/router";
import { getAiGraderReportBundle, hasNoFinalCertifiedClaims } from "../../../lib/aiGraderReportBundle";

const ELEMENT_LABELS = ["centering", "corners", "edges", "surface"] as const;
const LAB_MODES = ["True View", "Surface Vision", "Heatmap", "Light Sweep", "Measurement", "Confidence", "Evidence Replay"];

function scoreText(score?: number) {
  return typeof score === "number" ? score.toFixed(score % 1 === 0 ? 0 : 2) : "Pending";
}

export default function AiGraderReportViewerPage() {
  const router = useRouter();
  const bundle = getAiGraderReportBundle(router.query.reportId);
  const story = bundle.provisionalGrade;
  const noClaims = hasNoFinalCertifiedClaims(bundle);
  const primaryCandidate = story?.gradeImpactCandidates?.[0];

  return (
    <>
      <Head>
        <title>Ten Kings AI Grader Report</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="report-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Ten Kings AI Grader</p>
            <h1>{bundle.cardIdentity.title ?? "AI Grader Report"}</h1>
          </div>
          <div className="meta">
            <span>Report {bundle.reportId}</span>
            <span>{new Date(bundle.generatedAt).toLocaleString()}</span>
            <strong>Provisional Diagnostic - Not Certified - No Final Grade</strong>
          </div>
        </header>

        <section className="hero">
          <div className="grade-panel">
            <p className="eyebrow">Provisional Diagnostic Grade</p>
            <strong>{scoreText(story?.overall)}</strong>
            <span>Confidence {story?.confidence?.band ?? "pending"}</span>
            <p>
              This is a controlled provisional diagnostic output. It is not a certified Ten Kings grade and it does not create a
              label, QR certificate, or final certificate.
            </p>
          </div>
          <div className="card-stage" aria-label="front card visual placeholder">
            <div className="card-visual">
              <span>Front True View</span>
              <em>Basler analysis imagery</em>
            </div>
            <div className="callout c1">Centering {scoreText(story?.elementScores?.centering?.score)}</div>
            <div className="callout c2">Corners {scoreText(story?.elementScores?.corners?.score)}</div>
            <div className="callout c3">Edges {scoreText(story?.elementScores?.edges?.score)}</div>
            <div className="callout c4">Surface {scoreText(story?.elementScores?.surface?.score)}</div>
          </div>
        </section>

        <section className="summary">
          <article>
            <span>Strongest Positive</span>
            <p>{story?.gradeStory?.strongestPositiveFinding ?? "No positive finding computed."}</p>
          </article>
          <article>
            <span>Strongest Warning</span>
            <p>{story?.gradeStory?.strongestWarning ?? bundle.warnings[0]}</p>
          </article>
          <article>
            <span>Top Candidate</span>
            <p>{primaryCandidate ? `${primaryCandidate.id}: ${primaryCandidate.explanation}` : "No anomaly candidate available."}</p>
          </article>
        </section>

        <section className="vision-lab">
          <div className="section-head">
            <p className="eyebrow">Ten Kings Vision Lab</p>
            <h2>Interactive forensic inspection shell</h2>
            <p>V0 renders report-bundle data and gracefully handles missing public assets. Every visual claim links back to evidence references.</p>
          </div>
          <div className="lab-layout">
            <aside>
              {LAB_MODES.map((mode) => (
                <button key={mode} type="button" className={mode === "True View" ? "active" : ""}>
                  {mode}
                </button>
              ))}
            </aside>
            <div className="lab-canvas">
              <div className="viewer-card">
                <span>True View</span>
                <strong>{bundle.visionLab.trueViewRefs.length ? "Front/back imagery referenced" : "True View unavailable"}</strong>
              </div>
              <div className="marker">Surface candidate</div>
            </div>
            <aside className="evidence">
              <h3>Evidence Replay</h3>
              {primaryCandidate ? (
                <dl>
                  <dt>Candidate</dt>
                  <dd>{primaryCandidate.id}</dd>
                  <dt>Severity</dt>
                  <dd>{primaryCandidate.severity}</dd>
                  <dt>Source channels</dt>
                  <dd>{primaryCandidate.sourceChannels?.join(", ") ?? "pending"}</dd>
                  <dt>Evidence</dt>
                  <dd>{primaryCandidate.evidenceRefs.join(", ")}</dd>
                </dl>
              ) : (
                <p>No candidate details available.</p>
              )}
            </aside>
          </div>
        </section>

        <section className="elements">
          <div className="section-head">
            <p className="eyebrow">Element Diagnostics</p>
            <h2>Provisional scoring by element</h2>
          </div>
          <div className="element-grid">
            {ELEMENT_LABELS.map((element) => {
              const result = story?.elementScores?.[element];
              return (
                <article key={element}>
                  <span>{element}</span>
                  <strong>{scoreText(result?.score)}</strong>
                  <p>{result?.explanation ?? "Insufficient evidence."}</p>
                  <em>{result?.confidence ?? "pending"} confidence</em>
                </article>
              );
            })}
          </div>
        </section>

        <section className="why">
          <div className="section-head">
            <p className="eyebrow">Why Not 10?</p>
            <h2>Grade-impact reasons</h2>
          </div>
          <div className="why-list">
            {(story?.whyNot10 ?? []).map((reason) => (
              <article key={reason.id}>
                <strong>{reason.title}</strong>
                <p>{reason.explanation}</p>
                <span>{reason.evidenceRefs.join(", ")}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="appendix">
          <div>
            <p className="eyebrow">Technical Appendix</p>
            <h2>Bundle and safety status</h2>
          </div>
          <dl>
            <dt>Local report path</dt>
            <dd>{bundle.reportHtmlPath ?? "not provided"}</dd>
            <dt>Front evidence</dt>
            <dd>{bundle.evidenceReferences.frontPackageDir ?? "missing"}</dd>
            <dt>Back evidence</dt>
            <dd>{bundle.evidenceReferences.backPackageDir ?? "missing"}</dd>
            <dt>Ruler calibration</dt>
            <dd>{JSON.stringify(bundle.rulerCalibration ?? {})}</dd>
            <dt>Final/certified claims</dt>
            <dd>{noClaims ? "none generated" : "unexpected claim flag present"}</dd>
          </dl>
          <ul>
            {bundle.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>
      </main>

      <style jsx>{`
        .report-shell {
          min-height: 100vh;
          background: #f3f0e9;
          color: #151514;
          padding: 28px;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .topbar,
        .hero,
        .summary,
        .vision-lab,
        .elements,
        .why,
        .appendix {
          max-width: 1260px;
          margin: 0 auto 20px;
        }
        .topbar {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-start;
        }
        .eyebrow {
          margin: 0 0 8px;
          color: #8a6a27;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }
        h1,
        h2,
        h3,
        p {
          margin: 0;
        }
        h1 {
          font-size: 38px;
          letter-spacing: 0;
        }
        h2 {
          font-size: 24px;
          letter-spacing: 0;
        }
        .meta {
          display: grid;
          gap: 8px;
          text-align: right;
          color: #5b564d;
          font-size: 13px;
        }
        .meta strong {
          border: 1px solid #8e2d2d;
          color: #8e2d2d;
          padding: 7px 10px;
          border-radius: 999px;
        }
        .hero {
          display: grid;
          grid-template-columns: 340px minmax(0, 1fr);
          gap: 20px;
          min-height: 520px;
        }
        .grade-panel,
        .card-stage,
        .summary article,
        .vision-lab,
        .elements,
        .why,
        .appendix {
          border: 1px solid rgba(20, 20, 20, 0.12);
          background: rgba(255, 255, 255, 0.72);
          border-radius: 8px;
          box-shadow: 0 22px 70px rgba(55, 45, 25, 0.1);
        }
        .grade-panel {
          padding: 26px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .grade-panel strong {
          display: block;
          font-size: 86px;
          line-height: 0.95;
        }
        .grade-panel span {
          margin-top: 12px;
          color: #6f5c35;
          font-weight: 800;
          text-transform: uppercase;
        }
        .grade-panel p {
          margin-top: 18px;
          color: #5c574f;
          line-height: 1.6;
        }
        .card-stage {
          position: relative;
          display: grid;
          place-items: center;
          padding: 34px;
          overflow: hidden;
        }
        .card-visual {
          width: min(310px, 58vw);
          aspect-ratio: 2.5 / 3.5;
          border: 1px solid rgba(10, 10, 10, 0.24);
          border-radius: 8px;
          background:
            linear-gradient(90deg, rgba(255,255,255,0.08), rgba(0,0,0,0.08)),
            repeating-linear-gradient(0deg, #c9c4ba, #c9c4ba 2px, #b7b1a6 2px, #b7b1a6 4px);
          display: grid;
          place-items: center;
          text-align: center;
          color: #171615;
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.18);
        }
        .card-visual span {
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .card-visual em {
          display: block;
          margin-top: 8px;
          font-size: 12px;
          font-style: normal;
          color: #5d5750;
        }
        .callout {
          position: absolute;
          width: 160px;
          border: 1px solid rgba(20, 20, 20, 0.16);
          background: rgba(255, 255, 255, 0.86);
          border-radius: 8px;
          padding: 10px;
          font-size: 13px;
          font-weight: 800;
        }
        .c1 { left: 28px; top: 110px; }
        .c2 { right: 28px; top: 110px; }
        .c3 { left: 28px; bottom: 110px; }
        .c4 { right: 28px; bottom: 110px; }
        .summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }
        .summary article {
          padding: 18px;
        }
        .summary span,
        .elements article span {
          color: #8a6a27;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .summary p {
          margin-top: 10px;
          color: #35312b;
          line-height: 1.5;
        }
        .vision-lab,
        .elements,
        .why,
        .appendix {
          padding: 24px;
        }
        .section-head {
          margin-bottom: 18px;
        }
        .section-head p:not(.eyebrow) {
          margin-top: 8px;
          color: #5c574f;
        }
        .lab-layout {
          display: grid;
          grid-template-columns: 190px minmax(0, 1fr) 260px;
          gap: 16px;
          min-height: 460px;
        }
        .lab-layout aside {
          display: grid;
          align-content: start;
          gap: 8px;
        }
        .lab-layout button {
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          color: #eee7dc;
          border-radius: 8px;
          padding: 11px 12px;
          text-align: left;
          font-weight: 800;
        }
        .lab-layout button.active {
          background: #d7b86f;
          color: #111;
        }
        .lab-canvas,
        .lab-layout aside {
          border-radius: 8px;
          background: #11110f;
          color: #eee7dc;
          padding: 14px;
        }
        .lab-canvas {
          position: relative;
          display: grid;
          place-items: center;
        }
        .viewer-card {
          width: min(250px, 48vw);
          aspect-ratio: 2.5 / 3.5;
          border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: 8px;
          display: grid;
          place-items: center;
          text-align: center;
          background: #2b2a27;
        }
        .viewer-card span {
          display: block;
          color: #d7b86f;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
        }
        .viewer-card strong {
          display: block;
          max-width: 180px;
          font-size: 18px;
        }
        .marker {
          position: absolute;
          right: 18%;
          bottom: 28%;
          border: 1px solid #f16f4b;
          background: rgba(241, 111, 75, 0.18);
          color: #ffd9ca;
          padding: 7px 9px;
          border-radius: 8px;
          font-size: 12px;
        }
        .evidence dl {
          display: grid;
          gap: 8px;
          margin: 14px 0 0;
        }
        .evidence dt {
          color: #9d968b;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }
        .evidence dd {
          margin: 0;
          overflow-wrap: anywhere;
        }
        .element-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }
        .element-grid article,
        .why-list article {
          border: 1px solid rgba(20, 20, 20, 0.1);
          background: rgba(255, 255, 255, 0.68);
          border-radius: 8px;
          padding: 16px;
        }
        .element-grid strong {
          display: block;
          margin-top: 8px;
          font-size: 36px;
        }
        .element-grid p,
        .why-list p {
          margin-top: 8px;
          color: #514c44;
          line-height: 1.5;
        }
        .element-grid em,
        .why-list span {
          display: block;
          margin-top: 10px;
          color: #776f63;
          font-size: 12px;
          font-style: normal;
        }
        .why-list {
          display: grid;
          gap: 12px;
        }
        .appendix dl {
          display: grid;
          grid-template-columns: 190px minmax(0, 1fr);
          gap: 10px 14px;
        }
        .appendix dt {
          color: #776f63;
          font-weight: 800;
        }
        .appendix dd {
          margin: 0;
          overflow-wrap: anywhere;
        }
        .appendix li {
          margin-top: 6px;
        }
        @media (max-width: 980px) {
          .topbar,
          .hero,
          .summary,
          .lab-layout,
          .element-grid,
          .appendix dl {
            grid-template-columns: 1fr;
          }
          .meta {
            text-align: left;
          }
          .hero {
            min-height: auto;
          }
          .callout {
            position: static;
            margin-top: 8px;
            width: auto;
          }
          .card-stage {
            display: block;
          }
          .card-visual {
            margin: 0 auto 12px;
          }
        }
      `}</style>
    </>
  );
}
