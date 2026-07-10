import React, { useMemo, useState } from "react";
import AiGraderDefectOverlay from "../AiGraderDefectOverlay";
import {
  cinematicConfidenceText,
  cinematicEvidenceImage,
  cinematicFindingLabel,
  cinematicFindingsForExactImage,
  cinematicMeasurementRows,
  type CinematicEvidenceMode,
  type CinematicFinding,
  type CinematicImage,
  type CinematicReport,
  type CinematicSide,
} from "../../../lib/aiGraderCinematicReport";
import styles from "./CinematicReport.module.css";

type Props = {
  report: CinematicReport;
  fixture?: boolean;
};

const SIDE_LABEL: Record<CinematicSide, string> = { front: "Front", back: "Back" };
const ELEMENT_LABEL: Record<NonNullable<CinematicReport["grade"]>["elements"][number]["key"], string> = {
  centering: "Centering",
  corners: "Corners",
  edges: "Edges",
  surface: "Surface",
};

function displayDate(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function EvidenceImage({ image, title }: { image: CinematicImage; title: string }) {
  return <img className={styles.evidenceImage} src={image.renderUrl} alt={title} />;
}

function FindingDetail({ finding }: { finding: CinematicFinding }) {
  const confidence = cinematicConfidenceText(finding.finding.confidence);
  const measurements = cinematicMeasurementRows(finding.measurements);
  return (
    <div className={styles.findingDetail} aria-live="polite">
      <p className={styles.findingKicker}>{finding.statusLabel}</p>
      <h3>{cinematicFindingLabel(finding)}</h3>
      <dl>
        <div><dt>Severity</dt><dd>{finding.finding.severity.band}</dd></div>
        {confidence ? <div><dt>Confidence</dt><dd>{confidence}</dd></div> : null}
        <div><dt>Review</dt><dd className={finding.statusLabel === "Confirmed" ? styles.confirmed : styles.candidate}>{finding.statusLabel}</dd></div>
        {measurements.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <p>{finding.finding.explanation}</p>
    </div>
  );
}

function CardStage({ report, side, onSide }: {
  report: CinematicReport;
  side: CinematicSide;
  onSide: (side: CinematicSide) => void;
}) {
  const availableSides = (["front", "back"] as const).filter((candidate) => report.images[candidate]?.trueView);
  const image = report.images[side]?.trueView;
  if (!image) return null;
  const title = report.title ? `${report.title} ${SIDE_LABEL[side]}` : `${SIDE_LABEL[side]} published card image`;
  return (
    <section className={styles.museum} aria-labelledby="cinematic-museum-title">
      <div className={styles.sectionHeading}>
        <p>The Museum</p>
        <h2 id="cinematic-museum-title">Published card evidence</h2>
      </div>
      {availableSides.length > 1 ? <div className={styles.toggle} role="group" aria-label="Published card side">
        {availableSides.map((candidate) => <button key={candidate} type="button" aria-pressed={side === candidate} onClick={() => onSide(candidate)}>{SIDE_LABEL[candidate]}</button>)}
      </div> : null}
      <div className={styles.cardStage}>
        <EvidenceImage image={image} title={title} />
      </div>
    </section>
  );
}

function ForensicLab({ report, initialSide }: { report: CinematicReport; initialSide: CinematicSide }) {
  const [side, setSide] = useState<CinematicSide>(initialSide);
  const [mode, setMode] = useState<CinematicEvidenceMode>("trueView");
  const sideData = report.images[side];
  const sideFindings = report.findings[side];
  const [selectedFindingId, setSelectedFindingId] = useState<string | undefined>();
  const selectedFinding = sideFindings.find((entry) => entry.finding.findingId === selectedFindingId) ?? sideFindings[0];
  const activeImage = useMemo(
    () => cinematicEvidenceImage(mode, sideData, selectedFinding),
    [mode, selectedFinding, sideData],
  );
  const availableModes = ([
    ["trueView", "True View", sideData?.trueView],
    ["heatmap", "Heatmap", selectedFinding?.heatmap ?? sideData?.heatmap],
    ["surfaceVision", "Surface Vision", sideData?.surfaceVision],
    ["directional", "Directional light", selectedFinding?.directional],
  ] as const).filter((entry) => Boolean(entry[2]));
  const matchingFindings = mode === "trueView" ? cinematicFindingsForExactImage(sideFindings, activeImage) : [];
  const availableSides = (["front", "back"] as const).filter((candidate) => report.images[candidate]?.trueView || report.findings[candidate].length);
  if (!availableSides.length) return null;
  const imageTitle = report.title ? `${report.title} ${SIDE_LABEL[side]} ${mode}` : `${SIDE_LABEL[side]} ${mode}`;
  return (
    <section className={styles.lab} aria-labelledby="cinematic-lab-title">
      <div className={styles.sectionHeading}>
        <p>The Forensic Laboratory</p>
        <h2 id="cinematic-lab-title">Evidence by normalized card side</h2>
      </div>
      <div className={styles.labControls}>
        <div className={styles.tabList} role="group" aria-label="Evidence mode">
          {availableModes.map(([value, label]) => <button
            type="button"
            key={value}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >{label}</button>)}
        </div>
        {availableSides.length > 1 ? <div className={styles.toggle} role="group" aria-label="Forensic card side">
          {availableSides.map((candidate) => <button key={candidate} type="button" aria-pressed={side === candidate} onClick={() => { setSide(candidate); setMode("trueView"); setSelectedFindingId(undefined); }}>{SIDE_LABEL[candidate]}</button>)}
        </div> : null}
      </div>
      <div className={styles.labGrid}>
        <div className={styles.inspectionFrame} role="tabpanel" aria-label={`${SIDE_LABEL[side]} ${mode} evidence`}>
          {activeImage ? matchingFindings.length ? <AiGraderDefectOverlay
            image={{ ...activeImage, fileName: imageTitle }}
            findings={matchingFindings.map((entry) => entry.finding)}
            selectedFindingId={selectedFinding?.finding.findingId}
            onSelectFinding={setSelectedFindingId}
          /> : <EvidenceImage image={activeImage} title={imageTitle} /> : null}
        </div>
        {sideFindings.length ? <aside className={styles.findingPanel} aria-label={`${SIDE_LABEL[side]} findings`}>
          <h3>Published findings</h3>
          <div className={styles.findingList}>
            {sideFindings.map((entry) => <button
              type="button"
              key={entry.finding.findingId}
              className={entry.finding.findingId === selectedFinding?.finding.findingId ? styles.selectedFinding : undefined}
              aria-pressed={entry.finding.findingId === selectedFinding?.finding.findingId}
              onClick={() => { setSelectedFindingId(entry.finding.findingId); setMode("trueView"); }}
            >{cinematicFindingLabel(entry)}{" \u00b7 "}{entry.statusLabel}</button>)}
          </div>
          {selectedFinding ? <FindingDetail finding={selectedFinding} /> : null}
        </aside> : null}
      </div>
    </section>
  );
}

export default function CinematicReport({ report, fixture = false }: Props) {
  const [museumSide, setMuseumSide] = useState<CinematicSide>(report.images.front?.trueView ? "front" : "back");
  const firstEvidenceSide: CinematicSide = report.images.front?.trueView || report.findings.front.length ? "front" : "back";
  const generatedDate = displayDate(report.generatedAt);
  const confidence = cinematicConfidenceText(report.grade?.confidenceScore);
  const hasMuseum = Boolean(report.images.front?.trueView || report.images.back?.trueView);
  const hasLab = hasMuseum || report.findings.front.length > 0 || report.findings.back.length > 0;
  return (
    <main className={styles.shell} data-cinematic-report data-cinematic-fixture={fixture ? "true" : undefined}>
      <div className={styles.nonCertified} role="status">{"AI Grade \u00b7 Not a certified claim"}</div>
      <section className={styles.vault} aria-labelledby="cinematic-title">
        <p className={styles.eyebrow}>Ten Kings · AI Grader</p>
        {report.title ? <h1 id="cinematic-title">{report.title}</h1> : <h1 id="cinematic-title">AI Grader report</h1>}
        {(report.set || report.cardNumber) ? <p className={styles.identity}>{[report.set, report.cardNumber].filter(Boolean).join(" \u00b7 ")}</p> : null}
        <div className={styles.vaultMeta}>
          {report.reportId ? <span>{"Report ID \u00b7 "}{report.reportId}</span> : null}
          {generatedDate && report.generatedAt ? <time dateTime={report.generatedAt}>{generatedDate}</time> : null}
        </div>
        {report.grade ? <div className={styles.scoreBlock}>
          <span>TK Score</span>
          <strong>{report.grade.tkScore}</strong>
          {confidence ? <small>{"Confidence \u00b7 "}{confidence}{report.grade.confidenceBand ? ` \u00b7 ${report.grade.confidenceBand}` : ""}</small> : null}
          {report.grade.reportLabelId ? <small>{"Report label ID \u00b7 "}{report.grade.reportLabelId}</small> : null}
        </div> : null}
      </section>

      {report.grade?.elements.length ? <section className={styles.elements} aria-labelledby="cinematic-elements-title">
        <div className={styles.sectionHeading}><p>Assessment</p><h2 id="cinematic-elements-title">Published grading elements</h2></div>
        <div className={styles.elementGrid}>
          {report.grade.elements.map((element) => <article key={element.key}>
            <span>{ELEMENT_LABEL[element.key]}</span>
            <strong>{Math.round(element.score * 100)}</strong>
            {element.confidence ? <small>{element.confidence}</small> : null}
            {element.explanation ? <p>{element.explanation}</p> : null}
          </article>)}
        </div>
      </section> : null}

      {hasMuseum ? <CardStage report={report} side={museumSide} onSide={setMuseumSide} /> : null}
      {hasLab ? <ForensicLab report={report} initialSide={firstEvidenceSide} /> : null}

      {report.notes.length ? <section className={styles.notes} aria-labelledby="cinematic-notes-title">
        <div className={styles.sectionHeading}><p>Report notes</p><h2 id="cinematic-notes-title">Published grading context</h2></div>
        <ul>{report.notes.map((note) => <li key={note.id}><strong>{note.title}</strong>{note.explanation ? <span>{note.explanation}</span> : null}</li>)}</ul>
      </section> : null}
    </main>
  );
}
