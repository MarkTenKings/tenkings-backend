import React, { useMemo, useState } from "react";
import type { AiGraderPublishedDefectFindingV2, AiGraderReportBundleV03 } from "@tenkings/shared";
import AiGraderReportAdminEditor, {
  type AiGraderReportAdminEditorState,
} from "./AiGraderReportAdminEditor";
import type {
  AiGraderReportEditorialContent,
  AiGraderReportEditorialRevisionV1,
} from "../../lib/aiGraderReportRevision";

const ELEMENTS = ["centering", "corners", "edges", "surface"] as const;

function score(value: number) {
  return value.toFixed(2);
}

function label(value: string) {
  return value.replace(/_/g, " ");
}

function fullHash(value: string) {
  return value;
}

export type AiGraderMathematicalPublicNfc = {
  chipType: "NTAG215" | "FEIJU_F8215";
  nfcTagUrl: string;
};

export type AiGraderMathematicalPublicEnrichment = {
  linkage?: { cardAssetId?: string; itemId?: string };
  slabbedPhotos?: Array<{
    artifactId: string;
    side?: "front" | "back";
    publicUrl: string;
    checksumSha256: string;
  }>;
  valuation?: {
    status: string;
    searchQuery?: string;
    valuationMinor?: number;
    valuationCurrency?: string;
    resultSummary?: string;
    comps?: Array<{ title: string; url?: string; price?: string }>;
  } | null;
};

function FindingOverlay({ finding, imageUrl, overlayUrl, onSelect }: {
  finding: AiGraderPublishedDefectFindingV2;
  imageUrl?: string;
  overlayUrl?: string;
  onSelect: () => void;
}) {
  const shape = finding.geometry.shape;
  const interactiveShapeClassName =
    "cursor-pointer [fill:rgba(255,180,0,.06)] [stroke:#ffbe2e] [stroke-width:.8] [vector-effect:non-scaling-stroke] focus:outline-none focus:[stroke:white] focus:[stroke-width:1.4]";
  return (
    <figure>
      <div className="relative aspect-[5/7] overflow-hidden rounded border border-amber-700/40 bg-black">
        {imageUrl ? (
          <img className="h-full w-full object-contain" src={imageUrl} alt={`${finding.side} normalized card evidence`} />
        ) : (
          <div className="grid h-full place-items-center text-sm text-zinc-400">Exact normalized image unavailable</div>
        )}
        {overlayUrl ? (
          <img
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            src={overlayUrl}
            alt={`Exact immutable deduction overlay for finding ${finding.findingId}`}
          />
        ) : null}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`Interactive finding geometry for ${finding.findingId}`}>
          {shape.kind === "box" ? (
            <rect className={interactiveShapeClassName} x={shape.x * 100} y={shape.y * 100} width={shape.width * 100} height={shape.height * 100} role="button" aria-label={`Open finding ${finding.findingId}`} tabIndex={0} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }} />
          ) : (
            <polygon className={interactiveShapeClassName} points={shape.points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")} role="button" aria-label={`Open finding ${finding.findingId}`} tabIndex={0} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }} />
          )}
        </svg>
      </div>
      {overlayUrl ? <figcaption className="mt-2 text-xs"><a className="underline" href={overlayUrl}>Open exact immutable deduction overlay</a></figcaption> : null}
    </figure>
  );
}

export default function AiGraderMathematicalReportV1({
  bundle,
  nfc,
  enrichment,
  editorialRevision,
  onAdminEditorStateChange,
}: {
  bundle: AiGraderReportBundleV03;
  nfc?: AiGraderMathematicalPublicNfc | null;
  enrichment?: AiGraderMathematicalPublicEnrichment | null;
  editorialRevision?: AiGraderReportEditorialRevisionV1 | null;
  onAdminEditorStateChange?: (state: AiGraderReportAdminEditorState) => void;
}) {
  const [selectedSide, setSelectedSide] = useState<"front" | "back">("front");
  const [selectedFindingId, setSelectedFindingId] = useState<string>();
  const [selectedObservationKey, setSelectedObservationKey] = useState(
    "corners:front:top_left",
  );
  const [replayMode, setReplayMode] = useState<
    "true_view" | "surface_vision" | "heatmap" | "confidence" | "illumination" | "light_sweep"
  >("true_view");
  const [replayChannelIndex, setReplayChannelIndex] = useState(0);
  const finalGrade = bundle.productionRelease.finalGrade;
  const reviewedRevision = editorialRevision?.reportId === bundle.reportId
    ? editorialRevision
    : null;
  const reviewedContent = reviewedRevision?.content ?? {};
  const effectiveOverall = reviewedRevision?.calculation.overall ?? finalGrade.overall;
  const effectiveLabelGrade = reviewedRevision
    ? reviewedRevision.calculation.labelGrade.toFixed(1)
    : bundle.productionRelease.label.labelGradeText;
  const explanationField: Record<(typeof ELEMENTS)[number], keyof AiGraderReportEditorialContent> = {
    centering: "centeringExplanation",
    corners: "cornersExplanation",
    edges: "edgesExplanation",
    surface: "surfaceExplanation",
  };
  const assets = useMemo(() => new Map(bundle.publicAssets.map((asset) => [asset.id.toLowerCase(), asset])), [bundle.publicAssets]);
  const sideFindings = bundle.defectFindings.filter((finding) => finding.side === selectedSide);
  const selectedFinding = sideFindings.find((finding) => finding.findingId === selectedFindingId) ?? sideFindings[0];
  const selectedImage = selectedFinding ? assets.get(selectedFinding.evidence.trueViewAssetId.toLowerCase()) : undefined;
  const selectedOverlay = selectedFinding ? assets.get(selectedFinding.evidence.overlayAssetId.toLowerCase()) : undefined;
  const selectedSegmentation = selectedFinding ? assets.get(selectedFinding.evidence.segmentationMaskAssetId.toLowerCase()) : undefined;
  const selectedLedger = selectedFinding
    ? bundle.deductionLedger.entries.find((entry) => entry.findingId === selectedFinding.findingId)
    : undefined;
  const selectedMeasurement = selectedFinding && selectedLedger
    ? selectedFinding.measurements.find((measurement) =>
        measurement.measurementId === selectedLedger.measurementId)
    : undefined;
  const observations = [
    ...bundle.conditionObservationEvidence.corners,
    ...bundle.conditionObservationEvidence.edges,
  ];
  const selectedObservation = observations.find((observation) =>
    `${observation.element}:${observation.side}:${observation.location}` ===
      selectedObservationKey
  ) ?? observations[0];
  const sideAssets = bundle.publicAssets.filter((asset) => asset.side === selectedSide);
  const directionalAssets = sideAssets
    .filter((asset) => asset.evidenceRole === "directional_channel")
    .sort((left, right) => left.id.localeCompare(right.id));
  const replayAsset = replayMode === "light_sweep"
    ? directionalAssets[replayChannelIndex % Math.max(1, directionalAssets.length)]
    : sideAssets.find((asset) =>
        asset.evidenceRole === (
          replayMode === "true_view"
            ? "normalized_card"
            : replayMode === "heatmap"
              ? "surface_heatmap"
              : replayMode === "surface_vision"
                ? "surface_vision"
                : replayMode === "confidence"
                  ? "confidence_mask"
                  : "illumination_mask"
        )
      );
  const selectFinding = (findingId: string, side?: "front" | "back") => {
    if (side) setSelectedSide(side);
    setSelectedFindingId(findingId);
    if (typeof document !== "undefined") document.getElementById("v1-finding-inspector")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <main className="min-h-screen bg-[#f3f0e9] px-5 py-8 text-[#171512]">
      <AiGraderReportAdminEditor
        reportId={bundle.reportId}
        onStateChange={onAdminEditorStateChange}
      />
      <header className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-5 border-b border-black/15 pb-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.2em] text-amber-800">Ten Kings Mathematical Grading V1</p>
          <h1 className="mt-2 text-4xl font-bold">{reviewedContent.cardTitle ?? bundle.cardIdentity.title}</h1>
          <p className="mt-2 text-sm text-zinc-600">Report {bundle.reportId} · {new Date(bundle.generatedAt).toLocaleString()}</p>
          {reviewedRevision ? (
            <p className="mt-3 inline-flex rounded-full border border-emerald-700/30 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-900">
              Completed — human reviewed/admin adjudicated · revision {reviewedRevision.revision}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <strong className="block text-6xl tabular-nums">{score(effectiveOverall)}</strong>
          <span className="text-sm font-bold uppercase tracking-widest">Label {effectiveLabelGrade}</span>
          {reviewedRevision ? <small className="mt-2 block text-zinc-600">Immutable machine overall: {score(finalGrade.overall)}</small> : null}
        </div>
      </header>

      {reviewedContent.reportSummary || reviewedContent.strongestPositive || reviewedContent.strongestWarning ? (
        <section className="mx-auto mt-6 max-w-7xl rounded border border-emerald-800/20 bg-emerald-50/80 p-5">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-emerald-900">Effective human-reviewed report text</p>
          {reviewedContent.reportSummary ? <p className="mt-3 text-base leading-7">{reviewedContent.reportSummary}</p> : null}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {reviewedContent.strongestPositive ? <div><strong>Strongest positive</strong><p className="mt-1 text-sm">{reviewedContent.strongestPositive}</p></div> : null}
            {reviewedContent.strongestWarning ? <div><strong>Strongest warning</strong><p className="mt-1 text-sm">{reviewedContent.strongestWarning}</p></div> : null}
          </div>
        </section>
      ) : null}

      <section className="mx-auto mt-6 grid max-w-7xl gap-4 rounded border border-black/15 bg-white/80 p-5 text-sm md:grid-cols-2 lg:grid-cols-4" aria-label="Publication and collection linkages">
        <div>
          <strong className="block">Certificate</strong>
          <span>{bundle.productionRelease.label.certId}</span>
          <a className="mt-1 block underline" href={bundle.productionRelease.publication.publicReportUrl}>Open public report</a>
          <a className="mt-1 block underline" href={bundle.productionRelease.label.qrPayloadUrl}>Open QR destination</a>
        </div>
        <div>
          <strong className="block">Inventory linkage</strong>
          <span className="block">Card asset {enrichment?.linkage?.cardAssetId ?? bundle.cardIdentity.cardAssetId ?? "not linked"}</span>
          <span className="block">Item {enrichment?.linkage?.itemId ?? bundle.cardIdentity.itemId ?? "not linked"}</span>
        </div>
        <div>
          <strong className="block">NFC linkage</strong>
          {nfc ? <><span className="block">{nfc.chipType}</span><a className="underline" href={nfc.nfcTagUrl}>Open registered NFC link</a></> : <span>No active public NFC registration.</span>}
        </div>
        <div>
          <strong className="block">Slab photos and comps</strong>
          <span className="block">{enrichment?.slabbedPhotos?.length ?? 0} slab photo(s)</span>
          <span className="block">Comps {enrichment?.valuation?.status ?? "not run"}</span>
          {typeof enrichment?.valuation?.valuationMinor === "number" ? <span className="block">{enrichment.valuation.valuationCurrency ?? "USD"} {(enrichment.valuation.valuationMinor / 100).toFixed(2)}</span> : null}
        </div>
      </section>

      {enrichment?.slabbedPhotos?.length || enrichment?.valuation?.comps?.length ? (
        <section className="mx-auto mt-6 grid max-w-7xl gap-5 rounded border border-black/15 bg-white/80 p-6 lg:grid-cols-2">
          <article>
            <h2 className="text-2xl font-bold">Slab photos</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {enrichment.slabbedPhotos?.map((photo) => (
                <a className="overflow-hidden rounded border border-black/15" href={photo.publicUrl} key={photo.artifactId}>
                  <img className="aspect-[5/7] w-full bg-black object-contain" src={photo.publicUrl} alt={`${photo.side ?? "slabbed"} card photo`} />
                  <span className="block p-3 text-xs">
                    <strong>{photo.side ?? "slabbed card"}</strong>
                    <span className="mt-1 block break-all font-mono">{photo.artifactId}</span>
                    <span className="mt-1 block break-all font-mono">{fullHash(photo.checksumSha256)}</span>
                  </span>
                </a>
              )) ?? <p>No published slab photo.</p>}
            </div>
          </article>
          <article>
            <h2 className="text-2xl font-bold">Comparable sales</h2>
            <p className="mt-2 text-sm">{enrichment.valuation?.resultSummary ?? "No public comparable-sales summary."}</p>
            <ul className="mt-4 grid gap-3">
              {enrichment.valuation?.comps?.map((comp, index) => (
                <li className="rounded border border-black/15 p-3 text-sm" key={`${comp.title}:${index}`}>
                  <strong>{comp.title}</strong>
                  {comp.price ? <span className="ml-2">{comp.price}</span> : null}
                  {comp.url ? <a className="ml-2 underline" href={comp.url}>Open source</a> : null}
                </li>
              )) ?? <li>No published comparable sales.</li>}
            </ul>
          </article>
        </section>
      ) : null}

      <section className="mx-auto mt-6 grid max-w-7xl gap-4 md:grid-cols-4" aria-label="Required calibrated element scores">
        {ELEMENTS.map((element) => {
          const result = finalGrade.elements[element];
          const effectiveScore = reviewedRevision?.scores[element] ?? result.score;
          const reviewedExplanation = reviewedContent[explanationField[element]];
          return (
            <article className="rounded border border-black/15 bg-white/80 p-5" key={element}>
              <span className="text-xs font-bold uppercase tracking-widest text-amber-800">{element}</span>
              <strong className="mt-2 block text-4xl tabular-nums">{score(effectiveScore)}</strong>
              {reviewedRevision ? <small className="mt-1 block font-bold text-emerald-800">Human reviewed · machine {score(result.score)}</small> : null}
              {reviewedExplanation ? <p className="mt-3 rounded bg-emerald-50 p-3 text-sm text-emerald-950">{reviewedExplanation}</p> : null}
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <dt>Start</dt><dd className="text-right">{score(result.startingScore)}</dd>
                <dt>Front</dt><dd className="text-right">{score(result.frontScore)}</dd>
                <dt>Back</dt><dd className="text-right">{score(result.backScore)}</dd>
                <dt>Deduction</dt><dd className="text-right">-{score(result.aggregatePenalty)}</dd>
              </dl>
              <p className="mt-3 text-sm text-zinc-700">{result.formula}</p>
            </article>
          );
        })}
      </section>

      <section className="mx-auto mt-6 max-w-7xl rounded border border-black/15 bg-white/80 p-6">
        <h2 className="text-2xl font-bold">{reviewedRevision ? "Effective human-reviewed overall calculation" : "Overall calculation"}</h2>
        <p className="mt-2 font-mono text-sm">{reviewedRevision?.calculation.weightedFormula ?? finalGrade.weightedFormula}</p>
        <p className="mt-1 text-sm">
          Weights: centering {(reviewedRevision?.calculation.weights.centering ?? finalGrade.weights.centering).toFixed(2)}; corners {(reviewedRevision?.calculation.weights.corners ?? finalGrade.weights.corners).toFixed(2)}; edges {(reviewedRevision?.calculation.weights.edges ?? finalGrade.weights.edges).toFixed(2)}; surface {(reviewedRevision?.calculation.weights.surface ?? finalGrade.weights.surface).toFixed(2)}.
        </p>
        <p className="mt-2 font-mono text-sm">{reviewedRevision?.calculation.finalFormula ?? finalGrade.formula}</p>
        <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
          <div><dt>Weighted grade</dt><dd className="font-bold">{score(reviewedRevision?.calculation.weightedGrade ?? finalGrade.weightedGrade)}</dd></div>
          <div><dt>Weakest element</dt><dd className="font-bold">{reviewedRevision?.calculation.weakestElement ?? finalGrade.weakestElement} {score(reviewedRevision?.calculation.weakestScore ?? finalGrade.weakestScore)}</dd></div>
          <div><dt>Weakest cap</dt><dd className="font-bold">{score(reviewedRevision?.calculation.weakestElementCap ?? finalGrade.weakestElementCap)}</dd></div>
          <div><dt>Severe-defect cap</dt><dd className="font-bold">{(reviewedRevision?.calculation.applicableSevereDefectCap ?? finalGrade.applicableSevereDefectCap) === undefined ? "none" : score((reviewedRevision?.calculation.applicableSevereDefectCap ?? finalGrade.applicableSevereDefectCap) as number)}</dd></div>
        </dl>
        {reviewedRevision ? (
          <details className="mt-5 rounded border border-black/15 bg-zinc-50 p-4 text-sm">
            <summary className="cursor-pointer font-bold">Immutable machine calculation and original status</summary>
            <p className="mt-3 font-mono">{finalGrade.weightedFormula}</p>
            <p className="mt-2 font-mono">{finalGrade.formula}</p>
            <p className="mt-2">Machine overall {score(finalGrade.overall)}; weighted {score(finalGrade.weightedGrade)}; weakest {finalGrade.weakestElement} {score(finalGrade.weakestScore)}.</p>
            {reviewedRevision.adjudicatedMachineFailures.length ? <p className="mt-2">Adjudicated machine failures: {reviewedRevision.adjudicatedMachineFailures.join(", ")}.</p> : null}
          </details>
        ) : null}
      </section>

      <section className="mx-auto mt-6 max-w-7xl rounded border border-black/15 bg-white/80 p-6">
        <h2 className="text-2xl font-bold">Front, back, and location subscores</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr><th>Element</th><th>Side</th><th>Location</th><th>Score</th><th>Penalty</th><th>Confidence</th><th>Evidence</th></tr></thead>
            <tbody>
              {ELEMENTS.flatMap((element) => finalGrade.elements[element].locationScores.map((location) => (
                <tr className="border-t border-black/10" key={`${element}:${location.side}:${location.location}`}>
                  <td>{element}</td><td>{location.side}</td><td>{label(location.location)}</td>
                  <td>{score(location.score)}</td><td>-{score(location.penalty)}</td><td>{Math.round(location.confidence.score * 100)}%</td>
                  <td>
                    {element === "corners" || element === "edges" ? (
                      <button
                        className="underline"
                        type="button"
                        onClick={() => {
                          setSelectedObservationKey(`${element}:${location.side}:${location.location}`);
                          if (typeof document !== "undefined") document.getElementById("v1-observation-inspector")?.scrollIntoView({ behavior: "smooth" });
                        }}
                      >
                        Open ROI and masks
                      </button>
                    ) : "See centering evidence"}
                  </td>
                </tr>
              ))) }
            </tbody>
          </table>
        </div>
      </section>

      <section id="v1-observation-inspector" className="mx-auto mt-6 max-w-7xl rounded border border-black/15 bg-white/80 p-6">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-800">Independent corner and edge observations</p>
        <h2 className="mt-2 text-2xl font-bold">Every visible location has published measurement evidence</h2>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Corner and edge observation">
          {observations.map((observation) => {
            const key = `${observation.element}:${observation.side}:${observation.location}`;
            return (
              <button
                aria-pressed={key === selectedObservationKey}
                className={`rounded px-3 py-2 text-xs font-bold ${key === selectedObservationKey ? "bg-black text-white" : "border border-black/20"}`}
                key={key}
                type="button"
                onClick={() => setSelectedObservationKey(key)}
              >
                {observation.side} {label(observation.location)}
              </button>
            );
          })}
        </div>
        {selectedObservation ? (
          <>
            <dl className="mt-5 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt>Observation</dt><dd>{selectedObservation.element} / {selectedObservation.side} / {label(selectedObservation.location)}</dd></div>
              <div><dt>Score / exact deduction</dt><dd>{score(selectedObservation.score)} / -{score(selectedObservation.penalty)}</dd></div>
              <div><dt>Valid evidence</dt><dd>{Math.round(selectedObservation.validEvidenceCoverage * 100)}% / {selectedObservation.usableDirectionalChannelCount} channels</dd></div>
              <div><dt>Region</dt><dd className="break-all font-mono">{selectedObservation.regionId}</dd></div>
              <div><dt>Findings</dt><dd>{selectedObservation.findingIds.join(", ") || "none; zero deduction"}</dd></div>
              <div><dt>Measurements</dt><dd>{selectedObservation.measurementIds.join(", ") || "none; zero deduction"}</dd></div>
            </dl>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["ROI", selectedObservation.roiAssetId],
                ["Segmentation mask", selectedObservation.segmentationMaskAssetId],
                ["Confidence mask", selectedObservation.confidenceMaskAssetId],
                ["Illumination mask", selectedObservation.illuminationMaskAssetId],
              ].map(([assetLabel, assetId]) => {
                const asset = assets.get(assetId.toLowerCase());
                const hash = asset?.sha256 ?? asset?.checksumSha256;
                return (
                  <article className="overflow-hidden rounded border border-black/15" key={assetId}>
                    {asset?.publicUrl && asset.contentType?.startsWith("image/") ? (
                      <a href={asset.publicUrl}><img className="aspect-square w-full bg-black object-contain" src={asset.publicUrl} alt={`${assetLabel} for ${selectedObservation.side} ${selectedObservation.location}`} /></a>
                    ) : <div className="grid aspect-square place-items-center bg-zinc-100 p-3 text-center text-xs">Download-only binary evidence</div>}
                    <div className="p-3 text-xs">
                      <strong>{assetLabel}</strong>
                      <span className="mt-1 block break-all font-mono">{assetId}</span>
                      <span className="mt-1 block break-all font-mono">{hash ? fullHash(hash) : "hash unavailable"}</span>
                      {asset?.publicUrl ? <a className="mt-2 inline-block underline" href={asset.publicUrl}>Open exact evidence</a> : null}
                    </div>
                  </article>
                );
              })}
            </div>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-bold">Eight immutable directional channels</summary>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {selectedObservation.channelAssetIds.map((assetId) => {
                  const asset = assets.get(assetId.toLowerCase());
                  return <li className="break-all font-mono" key={assetId}>{asset?.publicUrl ? <a className="underline" href={asset.publicUrl}>{assetId}</a> : assetId}</li>;
                })}
              </ul>
            </details>
          </>
        ) : null}
      </section>

      <section id="v1-finding-inspector" className="mx-auto mt-6 grid max-w-7xl gap-5 rounded border border-black/15 bg-white/80 p-6 lg:grid-cols-[minmax(280px,420px)_1fr]">
        <div>
          <div className="mb-3 flex gap-2">
            {(["front", "back"] as const).map((side) => <button className={`rounded px-3 py-2 text-sm font-bold ${selectedSide === side ? "bg-black text-white" : "border border-black/20"}`} key={side} type="button" onClick={() => setSelectedSide(side)}>{side}</button>)}
          </div>
          {selectedFinding ? (
            <>
              <FindingOverlay finding={selectedFinding} imageUrl={selectedImage?.publicUrl} overlayUrl={selectedOverlay?.publicUrl} onSelect={() => selectFinding(selectedFinding.findingId)} />
              <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-label={`Exact immutable finding evidence for ${selectedFinding.findingId}`}>
                {([
                  ["Deduction overlay", selectedFinding.evidence.overlayAssetId, selectedOverlay],
                  ["Segmentation mask", selectedFinding.evidence.segmentationMaskAssetId, selectedSegmentation],
                ] as const).map(([assetLabel, assetId, asset]) => {
                  const hash = asset?.sha256 ?? asset?.checksumSha256;
                  return (
                    <article className="overflow-hidden rounded border border-black/15 bg-white" key={assetId}>
                      {asset?.publicUrl ? (
                        <a href={asset.publicUrl}>
                          <img className="aspect-square w-full bg-black object-contain" src={asset.publicUrl} alt={`Exact immutable ${assetLabel.toLowerCase()} for finding ${selectedFinding.findingId}`} />
                        </a>
                      ) : <div className="grid aspect-square place-items-center bg-zinc-100 p-3 text-center text-xs">Exact evidence unavailable</div>}
                      <div className="p-3 text-xs">
                        <strong>{assetLabel}</strong>
                        <span className="mt-1 block break-all font-mono">{assetId}</span>
                        <span className="mt-1 block break-all font-mono">{hash ? fullHash(hash) : "hash unavailable"}</span>
                        {asset?.publicUrl ? <a className="mt-2 inline-block underline" href={asset.publicUrl}>Open exact immutable {assetLabel.toLowerCase()}</a> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : <div className="rounded border p-8">No scored physical findings on this side.</div>}
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-amber-800">Exact overlay-to-finding linkage</p>
          <h2 className="mt-2 text-2xl font-bold">{selectedFinding ? `${label(selectedFinding.category)} · ${label(selectedFinding.location)}` : "No physical deduction"}</h2>
          {selectedFinding && selectedLedger ? (
            <>
              <p className="mt-3 text-zinc-700">{selectedFinding.explanation}</p>
              <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt>Finding / physical defect</dt><dd>{selectedFinding.findingId} / {selectedFinding.physicalDefectId}</dd></div>
                <div><dt>Primary grading category</dt><dd>{selectedFinding.primaryElement}; secondary evidence {selectedFinding.secondaryEvidenceCategories.map(label).join(", ") || "none"}</dd></div>
                <div><dt>Measurement</dt><dd>{selectedLedger.measuredMeasurement} {selectedLedger.unit}</dd></div>
                <div><dt>U95 / Grade-10 tolerance</dt><dd>{selectedLedger.u95} / {selectedLedger.grade10Tolerance} {selectedLedger.unit}</dd></div>
                {selectedMeasurement ? <div><dt>U95 components</dt><dd>{Object.entries(selectedMeasurement.uncertaintyComponentsU95).map(([name, value]) => `${label(name)} ${value}`).join("; ")}</dd></div> : null}
                <div><dt>Effective / reference</dt><dd>{selectedLedger.effectiveMeasurement} / {selectedLedger.referenceMeasurement} {selectedLedger.unit}</dd></div>
                <div><dt>Normalized severity</dt><dd>{selectedLedger.normalizedSeverity.toFixed(6)}</dd></div>
                <div><dt>Maximum / exact deduction</dt><dd>{score(selectedLedger.maximumDeduction)} / -{score(selectedLedger.deduction)}</dd></div>
                <div><dt>Deduction curve</dt><dd>{label(selectedLedger.curve)}</dd></div>
                <div className="sm:col-span-2"><dt>Exact substitution</dt><dd className="font-mono text-xs">{selectedLedger.measuredMeasurement} &lt;= max({selectedLedger.u95}, {selectedLedger.grade10Tolerance}) ? 0 : {selectedLedger.maximumDeduction} × clamp(max(0, {selectedLedger.measuredMeasurement} - {selectedLedger.u95}) / {selectedLedger.referenceMeasurement}, 0, 1) = {score(selectedLedger.deduction)}</dd></div>
                <div className="sm:col-span-2"><dt>Exact deduction formula</dt><dd className="font-mono text-xs">{selectedLedger.formula}</dd></div>
                <div><dt>Evidence quality</dt><dd>{selectedFinding.evidenceQuality}; {Math.round(selectedFinding.confidence * 100)}% confidence</dd></div>
                <div><dt>Human finding review</dt><dd>{label(selectedFinding.review.status)}{selectedFinding.review.reviewedAt ? ` at ${selectedFinding.review.reviewedAt}` : ""}</dd></div>
                <div><dt>Calibration</dt><dd>{selectedLedger.calibrationProfileId} / {selectedLedger.calibrationVersion}</dd></div>
                <div><dt>Algorithm / threshold</dt><dd>{selectedLedger.algorithmVersion} / {selectedLedger.thresholdSetId}</dd></div>
              </dl>
              <h3 className="mt-5 font-bold">All measurements</h3>
              <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>Kind</th><th>Measured</th><th>U95</th><th>Effective</th><th>Buffer</th><th>Coverage</th><th>Channels</th></tr></thead><tbody>
                {selectedFinding.measurements.map((measurement) => <tr className="border-t border-black/10" key={measurement.measurementId}><td>{label(measurement.kind)}</td><td>{measurement.measuredMeasurement} {measurement.unit}</td><td>{measurement.u95}</td><td>{measurement.effectiveMeasurement}</td><td>{measurement.grade10Buffer}</td><td>{Math.round(measurement.validEvidenceCoverage * 100)}%</td><td>{measurement.usableDirectionalChannelCount}</td></tr>)}
              </tbody></table></div>
              <div className="mt-4 flex flex-wrap gap-2">{selectedLedger.evidenceAssetIds.map((assetId) => { const asset = assets.get(assetId.toLowerCase()); return asset?.publicUrl ? <a className="rounded border border-black/20 px-2 py-1 text-xs underline" href={asset.publicUrl} key={assetId}>{asset.evidenceRole ?? assetId}</a> : <span className="rounded border px-2 py-1 text-xs" key={assetId}>{assetId}</span>; })}</div>
            </>
          ) : <p className="mt-3">A calibrated score of 10.00 has no measured physical deduction for this side.</p>}
        </div>
      </section>

      <section className="mx-auto mt-6 max-w-7xl rounded border border-black/15 bg-white/80 p-6">
        <h2 className="text-2xl font-bold">Measured finding ledger</h2>
        <p className="mt-2 text-sm">Each element starts at 10.00. Each physical defect appears once and links to its exact evidence.</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Finding</th><th>Element / category</th><th>Measurement</th><th>U95</th><th>Tolerance</th><th>Effective / reference</th><th>Curve</th><th>Deduction</th></tr></thead><tbody>
          {bundle.deductionLedger.entries.map((entry) => { const finding = bundle.defectFindings.find((item) => item.findingId === entry.findingId); return <tr className="border-t border-black/10" key={entry.findingId}><td><button className="underline" type="button" onClick={() => selectFinding(entry.findingId, finding?.side)}>{entry.findingId}</button></td><td>{entry.element} / {label(entry.category)}</td><td>{entry.measuredMeasurement} {entry.unit}</td><td>{entry.u95}</td><td>{entry.grade10Tolerance}</td><td>{entry.effectiveMeasurement} / {entry.referenceMeasurement}</td><td>{label(entry.curve)}</td><td>-{score(entry.deduction)}</td></tr>; })}
        </tbody></table></div>
      </section>

      <section className="mx-auto mt-6 grid max-w-7xl gap-5 lg:grid-cols-2">
        <article className="rounded border border-red-900/25 bg-red-50 p-6">
          <h2 className="text-2xl font-bold">Why Not 10?</h2>
          {reviewedContent.whyNot10 ? (
            <div className="mt-3 rounded border border-emerald-800/20 bg-emerald-50 p-4">
              <strong>Effective human-reviewed explanation</strong>
              <p className="mt-2 text-sm leading-6">{reviewedContent.whyNot10}</p>
            </div>
          ) : null}
          {reviewedRevision ? <p className="mt-4 text-xs font-bold uppercase tracking-wider text-zinc-600">Immutable machine reasons</p> : null}
          <div className="mt-3 grid gap-3">
            {finalGrade.whyNot10.length ? finalGrade.whyNot10.map((reason) => (
              <div className="rounded border border-red-900/20 bg-white p-3" key={reason.id}>
                <button className="block w-full text-left" type="button" onClick={() => reason.findingIds[0] && selectFinding(reason.findingIds[0], bundle.defectFindings.find((finding) => finding.findingId === reason.findingIds[0])?.side)}>
                  <strong>{reason.element}</strong>
                  <p className="mt-1 text-sm">{reason.explanation}</p>
                </button>
                <div className="mt-2 flex flex-wrap gap-2">
                  {reason.overlayAssetIds.map((assetId) => {
                    const asset = assets.get(assetId.toLowerCase());
                    return asset?.publicUrl
                      ? <a className="text-xs underline" href={asset.publicUrl} key={assetId}>Open overlay {assetId}</a>
                      : <span className="text-xs" key={assetId}>{assetId}</span>;
                  })}
                </div>
              </div>
            )) : <p>No physical condition defect measured beyond the certified U95/Grade-10 buffer.</p>}
          </div>
        </article>
        <article className="rounded border border-blue-900/25 bg-blue-50 p-6">
          <h2 className="text-2xl font-bold">Evidence-quality limitations</h2>
          <p className="mt-2 text-sm">These excluded or recovered pixels reduce confidence or require recapture. They deduct 0.00 and are not card damage.</p>
          <div className="mt-3 grid gap-3">
            {bundle.evidenceQualityLimitations.length ? bundle.evidenceQualityLimitations.map((item) => (
              <div className="rounded border border-blue-900/20 bg-white p-3" key={item.limitationId}>
                <strong>{item.side} · {label(item.classification)}</strong>
                <p className="mt-1 text-sm">{item.explanation}</p>
                <small>{Math.round(item.validEvidenceCoverage * 100)}% valid; deduction {score(item.deduction)}{item.recaptureRequired ? "; recapture required" : item.recoveredFromAlternateChannels ? "; recovered from alternate channels" : ""}</small>
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.evidenceAssetIds.map((assetId) => {
                    const asset = assets.get(assetId.toLowerCase());
                    return asset?.publicUrl
                      ? <a className="text-xs underline" href={asset.publicUrl} key={assetId}>Open illumination/confidence evidence</a>
                      : <span className="text-xs" key={assetId}>{assetId}</span>;
                  })}
                </div>
              </div>
            )) : <p>No evidence-quality limitation recorded.</p>}
          </div>
        </article>
      </section>

      <section className="mx-auto mt-6 max-w-7xl rounded border border-black/15 bg-white/80 p-6">
        <h2 className="text-2xl font-bold">Centering measurements</h2>
        <p className="mt-2 text-sm">Balance curve: {bundle.centeringEvidence.balanceCurve.map((point) => `${point.ratio}% = ${score(point.score)}`).join("; ")}.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {([bundle.centeringEvidence.front, bundle.centeringEvidence.back] as const).map((side) => {
            const designReference = bundle.designReferences.find((reference) =>
              reference.designReferenceId === side.registration.designReferenceId &&
              reference.artifactSha256 === side.registration.designReferenceSha256 &&
              reference.side === side.side
            );
            return (
            <article className="rounded border border-black/10 p-4" key={side.side}>
              <strong>{side.side} · {side.profile} · {score(side.score)}</strong>
              {[side.horizontal, side.vertical].map((axis) => (
                <dl className="mt-3 grid grid-cols-2 gap-1 text-sm" key={axis.axis}>
                  <dt>{axis.axis} margins</dt><dd>{axis.marginAPx}px / {axis.marginBPx}px · {axis.marginAMm}mm / {axis.marginBMm}mm</dd>
                  <dt>Balance / score</dt><dd>{axis.balanceRatio.toFixed(2)}% / {score(axis.score)}</dd>
                  <dt>Difference / U95 / tolerance</dt><dd>{axis.measuredDifferenceMm} / {axis.u95Mm} / {axis.grade10ToleranceMm} mm</dd>
                  <dt>U95 components</dt><dd>{Object.entries(axis.u95Components).map(([name, value]) => `${label(name)} ${value}`).join("; ")}{axis.boundaryFitU95Mm === undefined ? "" : `; boundary fit ${axis.boundaryFitU95Mm}`}</dd>
                </dl>
              ))}
              <dl className="mt-3 grid grid-cols-2 gap-1 text-sm">
                <dt>Registration transform</dt><dd>{side.registration.transformType}</dd>
                <dt>Transform matrix</dt><dd className="break-all font-mono">[{side.registration.transformMatrix.join(", ")}]</dd>
                <dt>Residual / confidence</dt><dd>{side.registration.registrationResidualPx}px / {Math.round(side.registration.confidence * 100)}%</dd>
                <dt>Inlier samples</dt><dd>{side.registration.inlierCount} / {Math.round(side.registration.inlierFraction * 100)}%</dd>
                <dt>Outer geometry frame</dt><dd>{side.outerCutGeometryEvidence.coordinateFrame}</dd>
                <dt>Observed outer contour</dt><dd>{side.outerCutGeometryEvidence.observedContourPointCount} points<br /><span className="break-all font-mono">{fullHash(side.outerCutGeometryEvidence.observedContourSha256)}</span></dd>
                <dt>Intended outer contour</dt><dd>{side.outerCutGeometryEvidence.intendedBoundaryProfileId} / {side.outerCutGeometryEvidence.intendedBoundaryProfileVersion}; {side.outerCutGeometryEvidence.intendedContourPointCount} points<br /><span className="break-all font-mono">{fullHash(side.outerCutGeometryEvidence.intendedContourSha256)}</span></dd>
                <dt>Observed-cut detector</dt><dd>{side.outerCutGeometryEvidence.observedContourDetectorId} / {side.outerCutGeometryEvidence.observedContourDetectorVersion}</dd>
                <dt>Boundary confidence / U95</dt><dd>{Math.round(side.outerCutGeometryEvidence.boundaryConfidence * 100)}% / {side.outerCutGeometryEvidence.boundaryU95Mm} mm</dd>
                <dt>Raw all-on cut source</dt><dd>{side.outerCutGeometryEvidence.rawAllOnAssetId}<br /><span className="break-all font-mono">{fullHash(side.outerCutGeometryEvidence.rawAllOnAssetSha256)}</span></dd>
                <dt>Normalized all-on source</dt><dd>{side.outerCutGeometryEvidence.normalizedAllOnAssetId}<br /><span className="break-all font-mono">{fullHash(side.outerCutGeometryEvidence.normalizedAllOnAssetSha256)}</span></dd>
                <dt>Raw scalar / transform</dt><dd><span className="break-all font-mono">{fullHash(side.outerCutGeometryEvidence.rawAllOnScalarPlaneSha256)}</span><br /><span className="break-all font-mono">{fullHash(side.outerCutGeometryEvidence.rawToNormalizedTransformSha256)}</span></dd>
                <dt>Observed artifact</dt><dd className="break-all font-mono">{fullHash(side.outerCutGeometryEvidence.observedArtifact.artifactSha256)}</dd>
                <dt>Geometry calibration</dt><dd>{side.outerCutGeometryEvidence.observedArtifact.calibrationProfileId} / {side.outerCutGeometryEvidence.observedArtifact.calibrationVersion}<br /><span className="break-all font-mono">{fullHash(side.outerCutGeometryEvidence.observedArtifact.calibrationSha256)}</span></dd>
                <dt>Geometry scale</dt><dd>{side.outerCutGeometryEvidence.observedArtifact.pixelsPerMmX} px/mm × {side.outerCutGeometryEvidence.observedArtifact.pixelsPerMmY} px/mm</dd>
                {side.registration.designReferenceId ? <><dt>Approved design reference</dt><dd>{side.registration.designReferenceId}{side.registrationEvidence ? ` v${side.registrationEvidence.designReferenceVersion}` : ""}<br /><span className="break-all font-mono">{side.registration.designReferenceSha256 ? fullHash(side.registration.designReferenceSha256) : "hash unavailable"}</span></dd></> : null}
                {designReference ? <>
                  <dt>Reference identity</dt><dd>{designReference.tenantId} / {designReference.setId} / {designReference.programId} / #{designReference.cardNumber} / {designReference.variantId ?? "base variant"} / {designReference.parallelId ?? "base parallel"}</dd>
                  <dt>Reference artifact</dt><dd>{designReference.artifactId} · {designReference.widthPx} × {designReference.heightPx}px<br /><span className="break-all font-mono">{fullHash(designReference.artifactSha256)}</span></dd>
                  <dt>Reference approval</dt><dd>v{designReference.version} · {designReference.approvedBy} · {designReference.approvedAt}</dd>
                </> : null}
                {side.registrationEvidence ? <>
                  <dt>Registration authority</dt><dd>{side.registrationEvidence.registrationAlgorithmVersion}<br />source <span className="break-all font-mono">{fullHash(side.registrationEvidence.normalizedSourceEvidenceSha256)}</span></dd>
                  <dt>Correspondence ledger</dt><dd>{side.registrationEvidence.correspondenceCount} points / {side.registrationEvidence.inlierCorrespondenceIds.length} inliers<br /><span className="break-all font-mono">{fullHash(side.registrationEvidence.correspondenceLedgerSha256)}</span></dd>
                  <dt>Registration hash</dt><dd className="break-all font-mono">{fullHash(side.registrationEvidence.registrationSha256)}</dd>
                </> : null}
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  side.outerCutContourAssetId,
                  side.printedDesignContourAssetId,
                  side.measurementOverlayAssetId,
                  side.registrationEvidence?.correspondenceLedgerAssetId,
                ].filter((assetId): assetId is string => Boolean(assetId)).map((assetId) => {
                  const asset = assets.get(assetId.toLowerCase());
                  return asset?.publicUrl
                    ? <a className="rounded border border-black/20 px-2 py-1 text-xs underline" href={asset.publicUrl} key={assetId}>{label(asset.evidenceRole ?? assetId)}</a>
                    : <span className="rounded border px-2 py-1 text-xs" key={assetId}>{assetId}</span>;
                })}
              </div>
            </article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto mt-6 max-w-7xl rounded border border-black/15 bg-white/80 p-6">
        <h2 className="text-2xl font-bold">Vision evidence replay</h2>
        <p className="mt-2 text-sm text-zinc-700">Switch among the exact normalized source, directional residual, heatmap, confidence and illumination evidence. The heatmap is a visualization only; deductions remain tied to the source measurements and channels.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["front", "back"] as const).map((side) => (
            <button className={`rounded px-3 py-2 text-sm font-bold ${selectedSide === side ? "bg-black text-white" : "border border-black/20"}`} key={side} type="button" onClick={() => { setSelectedSide(side); setReplayChannelIndex(0); }}>{side}</button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Vision evidence replay mode">
          {(["true_view", "surface_vision", "heatmap", "confidence", "illumination", "light_sweep"] as const).map((mode) => (
            <button
              aria-pressed={replayMode === mode}
              className={`rounded px-3 py-2 text-sm ${replayMode === mode ? "bg-amber-800 text-white" : "border border-black/20"}`}
              key={mode}
              type="button"
              onClick={() => setReplayMode(mode)}
            >
              {label(mode)}
            </button>
          ))}
        </div>
        {replayMode === "light_sweep" ? (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Directional light channel">
            {directionalAssets.map((asset, index) => (
              <button
                aria-pressed={index === replayChannelIndex}
                className={`rounded border px-2 py-1 text-xs ${index === replayChannelIndex ? "border-black bg-black text-white" : "border-black/20"}`}
                key={asset.id}
                type="button"
                onClick={() => setReplayChannelIndex(index)}
              >
                Channel {index + 1}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(300px,680px)_1fr]">
          {replayAsset?.publicUrl ? (
            <a href={replayAsset.publicUrl}><img className="max-h-[720px] w-full rounded bg-black object-contain" src={replayAsset.publicUrl} alt={`${selectedSide} ${label(replayMode)} evidence`} /></a>
          ) : <div className="grid aspect-[5/7] place-items-center rounded border bg-zinc-100">This evidence view is not published.</div>}
          <dl className="grid content-start gap-3 text-sm">
            <div><dt>Side / view</dt><dd>{selectedSide} / {label(replayMode)}</dd></div>
            <div><dt>Asset ID</dt><dd className="break-all font-mono">{replayAsset?.id ?? "unavailable"}</dd></div>
            <div><dt>Evidence role</dt><dd>{replayAsset?.evidenceRole ? label(replayAsset.evidenceRole) : "unavailable"}</dd></div>
            <div><dt>Immutable SHA-256</dt><dd className="break-all font-mono">{replayAsset ? fullHash(replayAsset.sha256 ?? replayAsset.checksumSha256 ?? "hash unavailable") : "unavailable"}</dd></div>
            <div><dt>Dimensions</dt><dd>{replayAsset?.widthPx && replayAsset.heightPx ? `${replayAsset.widthPx} x ${replayAsset.heightPx}px` : "not applicable"}</dd></div>
            {replayAsset?.publicUrl ? <div><a className="underline" href={replayAsset.publicUrl}>Open exact immutable evidence</a></div> : null}
          </dl>
        </div>
      </section>

      <section className="mx-auto mt-6 max-w-7xl rounded border border-black/15 bg-white/80 p-6">
        <h2 className="text-2xl font-bold">Published evidence replay</h2>
        <p className="mt-2 text-sm text-zinc-700">True View, Surface Vision, heatmaps, directional channels, masks, overlays, and ROI crops remain linked to their immutable source records.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bundle.publicAssets.map((asset) => {
            const hash = asset.sha256 ?? asset.checksumSha256;
            const isImage = Boolean(asset.publicUrl && (!asset.contentType || asset.contentType.startsWith("image/")));
            return (
              <article className="overflow-hidden rounded border border-black/15 bg-white" id={`asset-${asset.id}`} key={asset.id}>
                {isImage ? (
                  <a href={asset.publicUrl}>
                    <img className="aspect-[5/4] w-full bg-black object-contain" src={asset.publicUrl} alt={`${asset.side ?? "unscoped"} ${label(asset.evidenceRole ?? "evidence")} ${asset.id}`} />
                  </a>
                ) : (
                  <div className="grid aspect-[5/4] place-items-center bg-zinc-100 p-4 text-center text-sm text-zinc-600">Published binary evidence</div>
                )}
                <div className="p-3 text-xs">
                  <strong className="block text-sm">{label(asset.evidenceRole ?? asset.kind ?? "other evidence")}</strong>
                  <span>{asset.side ?? "both / calibration"} / {asset.id}</span>
                  <span className="mt-1 block break-all font-mono">{hash ? fullHash(hash) : "hash unavailable"}</span>
                  {asset.publicUrl ? <a className="mt-2 inline-block underline" href={asset.publicUrl}>Open exact evidence</a> : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto mt-6 max-w-7xl rounded border border-black/15 bg-white/80 p-6">
        <h2 className="text-2xl font-bold">Immutable grading provenance</h2>
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <div><dt>Threshold set</dt><dd>{bundle.gradingStandard.thresholdSetId}<br /><span className="break-all font-mono">{fullHash(bundle.gradingStandard.thresholdSetHash)}</span></dd></div>
          <div><dt>Algorithm</dt><dd>{bundle.gradingStandard.algorithmVersion}</dd></div>
          <div><dt>Calibration</dt><dd>{bundle.calibrationProfile.profileId} / {bundle.calibrationProfile.calibrationVersion}<br /><span className="break-all font-mono">{fullHash(bundle.calibrationProfile.artifactSha256)}</span></dd></div>
          <div><dt>Calibration bundle manifest</dt><dd>{bundle.calibrationBundleAuthority.schemaVersion}<br /><span className="break-all font-mono">{fullHash(bundle.calibrationBundleAuthority.bundleManifestSha256)}</span></dd></div>
          <div><dt>Physical source capture</dt><dd className="break-all font-mono">{fullHash(bundle.calibrationBundleAuthority.sourceCaptureManifestSha256)}</dd></div>
          <div><dt>Calibration member ledger</dt><dd className="break-all font-mono">{fullHash(bundle.calibrationBundleAuthority.memberLedgerSha256)}</dd></div>
          <div><dt>Scale / geometric uncertainty</dt><dd>{bundle.calibrationProfile.mmPerPixelX} x {bundle.calibrationProfile.mmPerPixelY} mm/px; lens {bundle.calibrationProfile.lensResidualPx}px; registration {bundle.calibrationProfile.normalizationRegistrationResidualPx}px; placement {bundle.calibrationProfile.repeatedPlacementU95Mm}mm; boundary {bundle.calibrationProfile.segmentationBoundaryU95Px}px</dd></div>
          <div><dt>Repeated-measurement U95</dt><dd>linear {bundle.calibrationProfile.measurementRepeatability.linearMm.u95}mm; area {bundle.calibrationProfile.measurementRepeatability.areaMm2.u95}mm²; relief {bundle.calibrationProfile.measurementRepeatability.reliefIndex.u95}; roughness {bundle.calibrationProfile.measurementRepeatability.roughnessIndex.u95}; color {bundle.calibrationProfile.measurementRepeatability.colorDeltaE.u95} ΔE</dd></div>
        </dl>
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer font-bold">Exact calibration bundle members ({bundle.calibrationBundleAuthority.members.length})</summary>
          <ul className="mt-3 grid gap-2">
            {bundle.calibrationBundleAuthority.members.map((member) => (
              <li className="rounded border border-black/10 p-2" key={`${member.role}:${"channelIndex" in member ? member.channelIndex : 0}:${member.fileName}`}>
                <strong>{label(member.role)}{"channelIndex" in member ? ` channel ${member.channelIndex}` : ""}</strong>
                <span className="ml-2">{member.fileName}</span>
                <span className="mt-1 block break-all font-mono text-xs">{fullHash(member.sha256)}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </main>
  );
}
