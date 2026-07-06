import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import {
  getAiGraderReportBundle,
  hasNoCertifiedClaim,
  hasNoFinalCertifiedClaims,
  type AiGraderReportBundle,
} from "../../../lib/aiGraderReportBundle";
import { findReportImage, reportImageAssets, type AiGraderRenderableReportImage } from "../../../lib/aiGraderReportImages";

const ELEMENT_LABELS = ["centering", "corners", "edges", "surface"] as const;
const LAB_MODES = ["True View", "Surface Vision", "Heatmap", "Light Sweep", "Measurement", "Confidence", "Evidence Replay"];

function scoreText(score?: number) {
  return typeof score === "number" ? score.toFixed(score % 1 === 0 ? 0 : 2) : "Pending";
}

function sourceChannelsText(candidate: unknown) {
  const channels =
    typeof candidate === "object" && candidate !== null && "sourceChannels" in candidate && Array.isArray(candidate.sourceChannels)
      ? candidate.sourceChannels
      : [];
  return channels.length ? channels.map(String).join(", ") : "see evidence refs";
}

export default function AiGraderReportViewerPage() {
  const router = useRouter();
  const fallbackBundle = getAiGraderReportBundle(router.query.reportId);
  const [persistedBundle, setPersistedBundle] = useState<AiGraderReportBundle | null>(null);
  const [publicLookupError, setPublicLookupError] = useState<string | null>(null);
  const bundle = persistedBundle ?? fallbackBundle;
  const story = bundle.provisionalGrade;
  const productionRelease = bundle.productionRelease;
  const finalGrade = productionRelease?.finalGrade;
  const provisionalGateRows = story?.gates?.results ?? [];
  const noClaims = hasNoCertifiedClaim(bundle);
  const noFinalClaims = hasNoFinalCertifiedClaims(bundle);
  const primaryCandidate = story?.gradeImpactCandidates?.[0];
  const impactCandidate = productionRelease?.finalGrade.gradeImpactReasons[0] ?? primaryCandidate;
  const slabbedPhotos = Array.isArray(productionRelease?.slabbedPhotoContract.photos)
    ? productionRelease?.slabbedPhotoContract.photos
    : [];
  const compsContract = productionRelease?.ebayCompsContract;
  const isSampleFallback = !persistedBundle && bundle.reportStatus === "missing_report_data";
  const reportIsFinal = productionRelease?.finalGradeComputed === true;
  const images = reportImageAssets(bundle);
  const frontTrueView =
    findReportImage(images, ["front", "all-on", "portrait"]) ??
    findReportImage(images, ["front", "accepted"]) ??
    findReportImage(images, ["front"]);
  const backTrueView =
    findReportImage(images, ["back", "all-on", "portrait"]) ??
    findReportImage(images, ["back", "accepted"]) ??
    findReportImage(images, ["back"]);
  const galleryImages = [
    frontTrueView,
    backTrueView,
    ...images.filter((asset) => asset.renderUrl !== frontTrueView?.renderUrl && asset.renderUrl !== backTrueView?.renderUrl),
  ].filter((asset): asset is AiGraderRenderableReportImage => Boolean(asset)).slice(0, 36);

  useEffect(() => {
    if (!router.isReady) return;
    const reportId = Array.isArray(router.query.reportId) ? router.query.reportId[0] : router.query.reportId;
    if (!reportId || reportId === "sample-pr45" || reportId === "sample-final-v0") return;
    setPublicLookupError(null);
    fetch(`/api/ai-grader/reports/${encodeURIComponent(reportId)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.ok === true && payload.bundle) {
          setPersistedBundle(payload.bundle);
          return;
        }
        setPublicLookupError("This report was not resolved from persisted production storage.");
      })
      .catch(() => {
        setPublicLookupError("Persisted production report lookup failed.");
      });
    return;
  }, [router.isReady, router.query.reportId]);

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
            <strong>{reportIsFinal ? "Final AI-Grader Report V0 - Not Certified" : "Provisional Diagnostic - Not Certified - No Final Grade"}</strong>
          </div>
        </header>

        {publicLookupError || isSampleFallback ? (
          <section className="local-status warn">
            <strong>{persistedBundle ? "Published report bundle loaded" : "Published report not found"}</strong>
            <p>
              {publicLookupError ??
                "This route is open, but the generated report bundle was not resolved from persisted production storage."}
            </p>
          </section>
        ) : null}

        <section className="hero">
          <div className="grade-panel">
            <p className="eyebrow">{reportIsFinal ? "Final AI-Grader Grade V0" : "Provisional Diagnostic Grade"}</p>
            <strong>{scoreText(finalGrade?.overall ?? story?.overall)}</strong>
            <span>Confidence {finalGrade?.confidence.band ?? story?.confidence?.band ?? "pending"}</span>
            <p>
              {reportIsFinal
                ? "This is the Ten Kings AI-Grader final report V0. It creates label-ready data and a QR report URL, but it is not a certified grading claim."
                : "This is a controlled provisional diagnostic output. It is not a certified Ten Kings grade and it does not create a label, QR certificate, or final certificate."}
            </p>
          </div>
          <div className="card-stage" aria-label="front card visual placeholder">
            {frontTrueView?.renderUrl ? (
              <img className="card-photo" src={frontTrueView.renderUrl} alt="Front true view evidence" />
            ) : (
              <div className="card-visual">
                <span>Front True View</span>
                <em>Basler analysis imagery unavailable</em>
              </div>
            )}
            <div className="callout c1">Centering {scoreText(finalGrade?.elements.centering?.score ?? story?.elementScores?.centering?.score)}</div>
            <div className="callout c2">Corners {scoreText(finalGrade?.elements.corners?.score ?? story?.elementScores?.corners?.score)}</div>
            <div className="callout c3">Edges {scoreText(finalGrade?.elements.edges?.score ?? story?.elementScores?.edges?.score)}</div>
            <div className="callout c4">Surface {scoreText(finalGrade?.elements.surface?.score ?? story?.elementScores?.surface?.score)}</div>
          </div>
        </section>

        <section className="evidence-gallery">
          <div className="section-head">
            <p className="eyebrow">Published Evidence Images</p>
            <h2>Front/back Basler evidence and report artifacts</h2>
            <p>{images.length ? `${images.length} image asset(s) are attached to this production report.` : "No public image assets are attached to this report bundle."}</p>
          </div>
          {galleryImages.length ? (
            <div className="image-grid">
              {galleryImages.map((asset) => (
                <figure key={asset.renderUrl}>
                  <img src={asset.renderUrl} alt={asset.fileName ?? asset.id ?? "AI Grader evidence image"} loading="lazy" />
                  <figcaption>{asset.fileName ?? asset.id ?? "evidence image"}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <div className="missing-assets">Published report bundle has no rendered image assets.</div>
          )}
        </section>

        {productionRelease ? (
          <section className="production">
            <div className="section-head">
              <p className="eyebrow">Production Release V0</p>
              <h2>Final report, label data, and QR report URL</h2>
            </div>
            <div className="production-grid">
              <article>
                <span>Public Report URL</span>
                <strong>{productionRelease.publication.publicReportUrl}</strong>
              </article>
              <article>
                <span>Cert / Report ID</span>
                <strong>{productionRelease.label.certId}</strong>
              </article>
              <article>
                <span>Label Grade</span>
                <strong>{productionRelease.label.labelGradeText}</strong>
              </article>
              <article>
                <span>Certified Claim</span>
                <strong>{productionRelease.certifiedClaim ? "Unexpected" : "Disabled"}</strong>
              </article>
              <article>
                <span>Slab Photos</span>
                <strong>{slabbedPhotos.length ? `${slabbedPhotos.length} attached` : productionRelease.slabbedPhotoContract.status}</strong>
              </article>
              <article>
                <span>Valuation</span>
                <strong>{compsContract?.status ?? "not_run"}</strong>
              </article>
            </div>
            <div className="gate-list">
              {productionRelease.gates.map((gate) => (
                <article key={gate.id} className={gate.status}>
                  <span>{gate.status.replace("_", " ")}</span>
                  <strong>{gate.label}</strong>
                  <p>{gate.reason}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {productionRelease ? (
          <section className="production">
            <div className="section-head">
              <p className="eyebrow">Slab Photos and Valuation</p>
              <h2>Customer visual layer and operator-triggered comps</h2>
            </div>
            <div className="production-grid">
              {slabbedPhotos.length ? (
                slabbedPhotos.map((photo, index) => {
                  const record = typeof photo === "object" && photo !== null ? (photo as Record<string, unknown>) : {};
                  return (
                    <article key={`${record.side ?? "photo"}-${index}`}>
                      <span>{String(record.side ?? "photo")}</span>
                      <strong>{String(record.kind ?? "slabbed color photo")}</strong>
                      {typeof record.publicUrl === "string" ? <p>{record.publicUrl}</p> : null}
                    </article>
                  );
                })
              ) : (
                <article>
                  <span>Slabbed color photos</span>
                  <strong>{productionRelease.slabbedPhotoContract.status}</strong>
                  <p>{productionRelease.slabbedPhotoContract.note}</p>
                </article>
              )}
              <article>
                <span>eBay comps</span>
                <strong>{compsContract?.status ?? "not_run"}</strong>
                <p>
                  {compsContract?.searchQuery
                    ? `Query: ${compsContract.searchQuery}`
                    : compsContract?.note ?? "Operator-triggered comps have not been run."}
                </p>
              </article>
              <article>
                <span>Valuation</span>
                <strong>
                  {typeof compsContract?.valuationMinor === "number"
                    ? `$${(compsContract.valuationMinor / 100).toFixed(2)}`
                    : "pending"}
                </strong>
                <p>{Array.isArray(compsContract?.compsRefs) ? `${compsContract?.compsRefs.length} comp ref(s)` : "No comps attached."}</p>
              </article>
            </div>
          </section>
        ) : null}

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
            <p>{impactCandidate ? `${impactCandidate.id}: ${impactCandidate.explanation}` : "No anomaly candidate available."}</p>
          </article>
        </section>

        {provisionalGateRows.length ? (
          <section className="production">
            <div className="section-head">
              <p className="eyebrow">Evidence Gates</p>
              <h2>Publish and grade readiness</h2>
              <p>Failed gates explain why a provisional or final report is blocked. Accepted warnings reduce confidence.</p>
            </div>
            <div className="gate-list">
              {provisionalGateRows.map((gate, index) => (
                <article key={gate.gate ?? `gate-${index}`} className={gate.status ?? "unknown"}>
                  <span>{String(gate.status ?? "unknown").replace("_", " ")}</span>
                  <strong>{gate.gate ?? `Gate ${index + 1}`}</strong>
                  <p>{gate.summary ?? "No gate summary recorded."}</p>
                  {gate.evidenceRefs?.length ? <small>{gate.evidenceRefs.join(", ")}</small> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

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
              {frontTrueView?.renderUrl ? <img className="lab-image" src={frontTrueView.renderUrl} alt="Vision Lab front true view" /> : null}
              {backTrueView?.renderUrl ? <img className="lab-image back" src={backTrueView.renderUrl} alt="Vision Lab back true view" /> : null}
              {!frontTrueView?.renderUrl && !backTrueView?.renderUrl ? (
                <div className="viewer-card">
                  <span>True View</span>
                  <strong>{bundle.visionLab.trueViewRefs.length ? "Front/back imagery referenced" : "True View unavailable"}</strong>
                </div>
              ) : null}
              <div className="marker">Surface candidate</div>
            </div>
            <aside className="evidence">
              <h3>Evidence Replay</h3>
              {impactCandidate ? (
                <dl>
                  <dt>Candidate</dt>
                  <dd>{impactCandidate.id}</dd>
                  <dt>Severity</dt>
                  <dd>{impactCandidate.severity}</dd>
                  <dt>Source channels</dt>
                  <dd>{sourceChannelsText(impactCandidate)}</dd>
                  <dt>Evidence</dt>
                  <dd>{impactCandidate.evidenceRefs.join(", ")}</dd>
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
              const finalResult = finalGrade?.elements[element];
              return (
                <article key={element}>
                  <span>{element}</span>
                  <strong>{scoreText(finalResult?.score ?? result?.score)}</strong>
                  <p>{finalResult?.explanation ?? result?.explanation ?? "Insufficient evidence."}</p>
                  <em>{finalResult?.confidence ?? result?.confidence ?? "pending"} confidence</em>
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
            <dt>Report source</dt>
            <dd>{persistedBundle ? "persisted read-only report endpoint" : "fixture/sample fallback"}</dd>
            <dt>Front evidence</dt>
            <dd>{bundle.evidenceReferences.frontEvidenceRefs.join(", ") || "missing"}</dd>
            <dt>Back evidence</dt>
            <dd>{bundle.evidenceReferences.backEvidenceRefs.join(", ") || "missing"}</dd>
            <dt>Published image assets</dt>
            <dd>{images.length ? `${images.length} image(s)` : "missing"}</dd>
            <dt>Ruler calibration</dt>
            <dd>{JSON.stringify(bundle.rulerCalibration ?? {})}</dd>
            <dt>Final/certified claims</dt>
            <dd>{noClaims ? (reportIsFinal ? "final AI-Grader V0 present; certified claim disabled" : "none generated") : "unexpected certified claim flag present"}</dd>
            <dt>Legacy provisional-only flags</dt>
            <dd>{noFinalClaims ? "provisional only" : "final report data present"}</dd>
            <dt>Label data</dt>
            <dd>{productionRelease ? `${productionRelease.label.status} (${productionRelease.label.qrPayloadUrl})` : "not generated"}</dd>
            <dt>DB/storage publication</dt>
            <dd>{productionRelease ? `${productionRelease.publication.storageMode}; DB writes ${productionRelease.publication.dbWritesPerformed}` : "not generated"}</dd>
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
        .local-status,
        .hero,
        .production,
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
        .local-status {
          max-width: 1260px;
          margin: 0 auto 20px;
          border: 1px solid rgba(35, 118, 75, 0.24);
          background: rgba(226, 247, 235, 0.82);
          border-radius: 8px;
          padding: 14px 16px;
          color: #17442a;
        }
        .local-status.warn {
          border-color: rgba(166, 92, 20, 0.3);
          background: rgba(255, 244, 220, 0.92);
          color: #68400e;
        }
        .local-status p {
          margin-top: 5px;
          line-height: 1.45;
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
        .production,
        .evidence-gallery,
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
        .card-photo {
          width: min(520px, 72%);
          max-height: 470px;
          object-fit: contain;
          border: 1px solid rgba(10, 10, 10, 0.18);
          border-radius: 8px;
          background: #111;
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.18);
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
        .production {
          padding: 24px;
        }
        .evidence-gallery {
          padding: 24px;
        }
        .image-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 14px;
        }
        .image-grid figure {
          margin: 0;
          border: 1px solid rgba(26, 24, 20, 0.1);
          border-radius: 8px;
          overflow: hidden;
          background: #171614;
        }
        .image-grid img {
          display: block;
          width: 100%;
          aspect-ratio: 4 / 3;
          object-fit: contain;
          background: #111;
        }
        .image-grid figcaption {
          min-height: 38px;
          padding: 8px;
          color: #554e42;
          background: #fffaf0;
          font-size: 11px;
          line-height: 1.25;
          overflow-wrap: anywhere;
        }
        .missing-assets {
          border: 1px dashed rgba(142, 45, 45, 0.4);
          border-radius: 8px;
          padding: 18px;
          color: #8e2d2d;
          background: #fff4f4;
          font-weight: 800;
        }
        .production-grid,
        .gate-list {
          display: grid;
          gap: 12px;
        }
        .production-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          margin-bottom: 16px;
        }
        .production-grid article,
        .gate-list article {
          border: 1px solid rgba(20, 20, 20, 0.1);
          background: rgba(255, 255, 255, 0.7);
          border-radius: 8px;
          padding: 14px;
          overflow-wrap: anywhere;
        }
        .production-grid span,
        .gate-list span {
          color: #8a6a27;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .production-grid strong,
        .gate-list strong {
          display: block;
          margin-top: 8px;
        }
        .gate-list {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
        .gate-list article.fail {
          border-color: rgba(142, 45, 45, 0.45);
          background: rgba(255, 232, 232, 0.8);
        }
        .gate-list article.accepted_warning {
          border-color: rgba(185, 127, 33, 0.45);
          background: rgba(255, 244, 220, 0.8);
        }
        .gate-list article.pass {
          border-color: rgba(35, 118, 75, 0.26);
          background: rgba(226, 247, 235, 0.78);
        }
        .gate-list p {
          margin-top: 8px;
          color: #514c44;
          line-height: 1.45;
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
        .lab-image {
          position: absolute;
          inset: 24px auto 24px 32px;
          width: min(46%, 440px);
          height: calc(100% - 48px);
          object-fit: contain;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 8px;
          background: #10100f;
        }
        .lab-image.back {
          left: auto;
          right: 32px;
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
          .production-grid,
          .gate-list,
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
          .card-photo {
            display: block;
            width: 100%;
            margin: 0 auto 12px;
          }
          .lab-image,
          .lab-image.back {
            position: static;
            width: 100%;
            height: auto;
            margin-bottom: 12px;
          }
        }
      `}</style>
    </>
  );
}
