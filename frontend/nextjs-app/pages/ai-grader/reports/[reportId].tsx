import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import type { AiGraderReportBundleV03 } from "@tenkings/shared";
import AiGraderDefectOverlay from "../../../components/ai-grader/AiGraderDefectOverlay";
import AiGraderReportAdminEditor, {
  type AiGraderReportAdminEditorState,
} from "../../../components/ai-grader/AiGraderReportAdminEditor";
import AiGraderMathematicalReportV1, {
  type AiGraderMathematicalPublicEnrichment,
} from "../../../components/ai-grader/AiGraderMathematicalReportV1";
import { parseAiGraderMathematicalReportV1 } from "../../../lib/aiGraderMathematicalReportV1";
import {
  AI_GRADER_WEB_REPORT_BUNDLE_V01_VERSION,
  AI_GRADER_WEB_REPORT_BUNDLE_V02_VERSION,
  aiGraderReportDefectFindings,
  getAiGraderReportBundle,
  hasNoCertifiedClaim,
  hasNoFinalCertifiedClaims,
  isExplicitAiGraderSampleReportId,
  type AiGraderCompatibleReportBundle,
} from "../../../lib/aiGraderReportBundle";
import {
  findReportImage,
  findReportNormalizedCardImageByExactAssetId,
  reportImageAssets,
  type AiGraderRenderableReportImage,
} from "../../../lib/aiGraderReportImages";
import { defectFindingsForExactImage } from "../../../lib/aiGraderDefectFindings";
import {
  parseAiGraderReportEditorialRevisionV1,
  type AiGraderReportEditorialContent,
  type AiGraderReportEditorialRevisionV1,
} from "../../../lib/aiGraderReportRevision";

const ELEMENT_LABELS = ["centering", "corners", "edges", "surface"] as const;
const LAB_MODES = ["True View", "Surface Vision", "Heatmap", "Light Sweep", "Measurement", "Confidence", "Evidence Replay"] as const;
type LabMode = (typeof LAB_MODES)[number];
type LabSide = "front" | "back";
type FailedMachineReportShell = {
  reportId: string;
  title?: string;
  generatedAt?: string;
  sourceSchemaVersion: string;
};
type PublicNfcRegistration = {
  status: "active";
  registrationKind: "registered_link";
  publicTagId: string;
  chipType: "NTAG215" | "FEIJU_F8215";
  securityMode: "static_url_v1";
  nfcTagUrl: string;
};

function safePublicNfcRegistration(value: unknown): PublicNfcRegistration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const publicTagId = typeof row.publicTagId === "string" && /^[A-Za-z0-9_-]{32}$/.test(row.publicTagId)
    ? row.publicTagId
    : "";
  const expectedUrl = publicTagId ? `https://collect.tenkings.co/nfc/${publicTagId}` : "";
  if (
    row.status !== "active" ||
    row.registrationKind !== "registered_link" ||
    (row.chipType !== "NTAG215" && row.chipType !== "FEIJU_F8215") ||
    row.securityMode !== "static_url_v1" ||
    row.nfcTagUrl !== expectedUrl
  ) return null;
  return row as PublicNfcRegistration;
}

function safePublicEnrichment(value: unknown): AiGraderMathematicalPublicEnrichment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const safeUrl = (candidate: unknown) =>
    typeof candidate === "string" &&
    candidate.length <= 2048 &&
    (candidate.startsWith("/") || /^https:\/\/[^\s]+$/.test(candidate));
  const safeId = (candidate: unknown) =>
    typeof candidate === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(candidate);
  const linkage = row.linkage && typeof row.linkage === "object" && !Array.isArray(row.linkage)
    ? row.linkage as Record<string, unknown>
    : {};
  const slabbedPhotos = (Array.isArray(row.slabbedPhotos) ? row.slabbedPhotos : []).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const photo = entry as Record<string, unknown>;
    if (
      !safeId(photo.artifactId) ||
      !safeUrl(photo.publicUrl) ||
      typeof photo.checksumSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(photo.checksumSha256) ||
      (photo.side !== undefined && photo.side !== "front" && photo.side !== "back")
    ) return [];
    return [{
      artifactId: photo.artifactId as string,
      ...(photo.side === "front" || photo.side === "back" ? { side: photo.side as "front" | "back" } : {}),
      publicUrl: photo.publicUrl as string,
      checksumSha256: photo.checksumSha256,
    }];
  }).slice(0, 20);
  const rawValuation = row.valuation;
  const valuation = rawValuation && typeof rawValuation === "object" && !Array.isArray(rawValuation)
    ? (() => {
        const record = rawValuation as Record<string, unknown>;
        if (typeof record.status !== "string" || record.status.length > 128) return null;
        const comps = (Array.isArray(record.comps) ? record.comps : []).flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const comp = entry as Record<string, unknown>;
          if (typeof comp.title !== "string" || !comp.title || comp.title.length > 300) return [];
          if (comp.url !== undefined && !safeUrl(comp.url)) return [];
          if (comp.price !== undefined && (typeof comp.price !== "string" || comp.price.length > 64)) return [];
          return [{
            title: comp.title,
            ...(typeof comp.url === "string" ? { url: comp.url } : {}),
            ...(typeof comp.price === "string" ? { price: comp.price } : {}),
          }];
        }).slice(0, 100);
        return {
          status: record.status,
          ...(typeof record.searchQuery === "string" && record.searchQuery.length <= 500 ? { searchQuery: record.searchQuery } : {}),
          ...(typeof record.valuationMinor === "number" && Number.isInteger(record.valuationMinor) ? { valuationMinor: record.valuationMinor } : {}),
          ...(typeof record.valuationCurrency === "string" && record.valuationCurrency.length <= 16 ? { valuationCurrency: record.valuationCurrency } : {}),
          ...(typeof record.resultSummary === "string" && record.resultSummary.length <= 1000 ? { resultSummary: record.resultSummary } : {}),
          comps,
        };
      })()
    : null;
  return {
    linkage: {
      ...(safeId(linkage.cardAssetId) ? { cardAssetId: linkage.cardAssetId as string } : {}),
      ...(safeId(linkage.itemId) ? { itemId: linkage.itemId as string } : {}),
    },
    slabbedPhotos,
    valuation,
  };
}

function scoreText(score?: number) {
  return typeof score === "number" ? score.toFixed(score % 1 === 0 ? 0 : 2) : "Pending";
}

const ELEMENT_EXPLANATION_FIELD: Record<
  (typeof ELEMENT_LABELS)[number],
  keyof AiGraderReportEditorialContent
> = {
  centering: "centeringExplanation",
  corners: "cornersExplanation",
  edges: "edgesExplanation",
  surface: "surfaceExplanation",
};

function ComingSoonReportWall({
  reportId,
  onAdminEditorStateChange,
}: {
  reportId: string;
  onAdminEditorStateChange: (state: AiGraderReportAdminEditorState) => void;
}) {
  return (
    <>
      <Head>
        <title>Ten Kings Grading Report — Coming Soon</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="grid min-h-screen place-items-center bg-[#11100e] px-6 py-16 text-[#f8f1df]">
        <section className="w-full max-w-2xl rounded-2xl border border-amber-200/25 bg-gradient-to-b from-amber-100/10 to-black/10 p-10 text-center shadow-2xl">
          <p className="text-xs font-black uppercase tracking-[.28em] text-amber-300">Ten Kings AI Grader</p>
          <h1 className="mt-5 text-5xl font-black sm:text-7xl">Coming Soon</h1>
          <p className="mx-auto mt-5 max-w-lg text-base leading-7 text-stone-300">
            This grading report is not public yet. Its permanent report URL and linked NFC identity stay unchanged.
          </p>
          <p className="mt-7 break-all font-mono text-xs text-stone-500">Report {reportId}</p>
        </section>
      </main>
      <AiGraderReportAdminEditor reportId={reportId} onStateChange={onAdminEditorStateChange} />
    </>
  );
}

function HumanAdjudicatedMachineFailureReport({
  shell,
  failure,
  revision,
  onAdminEditorStateChange,
}: {
  shell: FailedMachineReportShell;
  failure: string;
  revision: AiGraderReportEditorialRevisionV1 | null;
  onAdminEditorStateChange: (state: AiGraderReportAdminEditorState) => void;
}) {
  const content = revision?.content ?? {};
  return (
    <>
      <Head>
        <title>{content.cardTitle ?? shell.title ?? "Ten Kings AI Grader Report"}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="min-h-screen bg-[#f3f0e9] px-5 py-8 text-[#171512]">
        <AiGraderReportAdminEditor reportId={shell.reportId} onStateChange={onAdminEditorStateChange} />
        <header className="mx-auto flex max-w-5xl flex-wrap items-start justify-between gap-5 border-b border-black/15 pb-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-amber-800">Ten Kings AI Grader</p>
            <h1 className="mt-2 text-4xl font-bold">{content.cardTitle ?? shell.title ?? "AI Grader Report"}</h1>
            <p className="mt-2 text-sm text-zinc-600">Report {shell.reportId}{shell.generatedAt ? ` · ${new Date(shell.generatedAt).toLocaleString()}` : ""}</p>
          </div>
          {revision ? (
            <div className="text-right">
              <strong className="block text-6xl tabular-nums">{revision.calculation.overall.toFixed(2)}</strong>
              <span className="text-sm font-bold uppercase tracking-widest">Label {revision.calculation.labelGrade.toFixed(1)}</span>
            </div>
          ) : null}
        </header>

        {revision ? (
          <>
            <section className="mx-auto mt-6 max-w-5xl rounded border border-emerald-800/25 bg-emerald-50 p-5">
              <strong className="text-lg text-emerald-950">Completed — human reviewed/admin adjudicated</strong>
              <p className="mt-2 leading-6 text-emerald-950">
                An authenticated administrator explicitly completed all four required scores. This is not a calibrated machine-V1 completion; the original failed machine result remains preserved below.
              </p>
              {content.reportSummary ? <p className="mt-4 border-t border-emerald-900/15 pt-4 leading-7">{content.reportSummary}</p> : null}
            </section>

            <section className="mx-auto mt-6 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Human-reviewed element scores">
              {ELEMENT_LABELS.map((element) => (
                <article className="rounded border border-black/15 bg-white/80 p-5" key={element}>
                  <span className="text-xs font-bold uppercase tracking-widest text-amber-800">{element}</span>
                  <strong className="mt-2 block text-4xl tabular-nums">{revision.scores[element].toFixed(2)}</strong>
                  <small className="mt-1 block font-bold text-emerald-800">Human reviewed/admin adjudicated</small>
                  {content[ELEMENT_EXPLANATION_FIELD[element]] ? <p className="mt-3 text-sm leading-6">{content[ELEMENT_EXPLANATION_FIELD[element]]}</p> : null}
                </article>
              ))}
            </section>

            <section className="mx-auto mt-6 max-w-5xl rounded border border-black/15 bg-white/80 p-6">
              <h2 className="text-2xl font-bold">Effective overall formula</h2>
              <p className="mt-3 font-mono text-sm">{revision.calculation.weightedFormula}</p>
              <p className="mt-2 font-mono text-sm">{revision.calculation.finalFormula}</p>
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-4">
                <div><dt>Weighted</dt><dd className="font-bold">{revision.calculation.weightedGrade.toFixed(2)}</dd></div>
                <div><dt>Weakest element</dt><dd className="font-bold">{revision.calculation.weakestElement} {revision.calculation.weakestScore.toFixed(2)}</dd></div>
                <div><dt>Weakest cap</dt><dd className="font-bold">{revision.calculation.weakestElementCap.toFixed(2)}</dd></div>
                <div><dt>Severe-defect cap</dt><dd className="font-bold">{revision.calculation.applicableSevereDefectCap?.toFixed(2) ?? "none in source"}</dd></div>
              </dl>
            </section>

            {content.strongestPositive || content.strongestWarning || content.whyNot10 ? (
              <section className="mx-auto mt-6 grid max-w-5xl gap-4 sm:grid-cols-2">
                {content.strongestPositive ? <article className="rounded border border-black/15 bg-white/80 p-5"><strong>Strongest positive</strong><p className="mt-2">{content.strongestPositive}</p></article> : null}
                {content.strongestWarning ? <article className="rounded border border-black/15 bg-white/80 p-5"><strong>Strongest warning</strong><p className="mt-2">{content.strongestWarning}</p></article> : null}
                {content.whyNot10 ? <article className="rounded border border-black/15 bg-white/80 p-5 sm:col-span-2"><strong>Why not 10?</strong><p className="mt-2">{content.whyNot10}</p></article> : null}
              </section>
            ) : null}
          </>
        ) : null}

        <section className="mx-auto mt-6 max-w-5xl rounded border border-red-900/25 bg-red-50 p-6" role={revision ? undefined : "alert"}>
          <strong>{revision ? "Immutable original machine failure" : "Mathematical machine report incomplete"}</strong>
          <p className="mt-2 leading-6">{failure}</p>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt>Source contract</dt><dd className="font-mono">{shell.sourceSchemaVersion}</dd></div>
            <div><dt>Machine status</dt><dd className="font-bold">failed — preserved</dd></div>
          </dl>
          {revision?.adjudicatedMachineFailures.length ? <p className="mt-3 text-sm">Adjudicated machine failures: {revision.adjudicatedMachineFailures.join(", ")}.</p> : null}
        </section>
      </main>
    </>
  );
}

function sourceChannelsText(candidate: unknown) {
  const channels =
    typeof candidate === "object" && candidate !== null && "sourceChannels" in candidate && Array.isArray(candidate.sourceChannels)
      ? candidate.sourceChannels
      : [];
  return channels.length ? channels.map(String).join(", ") : "see evidence refs";
}

function labImageForMode(
  images: AiGraderRenderableReportImage[],
  mode: LabMode,
  side: LabSide,
  candidate: unknown
) {
  if (mode === "True View") {
    return (
      findReportImage(images, [side, "all-on", "portrait"]) ??
      findReportImage(images, [side, "accepted"]) ??
      findReportImage(images, [side])
    );
  }
  if (mode === "Surface Vision") {
    return findReportImage(images, [side, "surface", "vision"]) ?? findReportImage(images, [side, "surface"]);
  }
  if (mode === "Heatmap") {
    return findReportImage(images, [side, "heatmap"]) ?? findReportImage(images, [side, "anomaly"]);
  }
  if (mode === "Light Sweep") {
    return findReportImage(images, [side, "channel"]) ?? findReportImage(images, [side, "light"]);
  }
  if (mode === "Measurement") {
    return findReportImage(images, [side, "overlay"]) ?? findReportImage(images, [side, "roi"]) ?? findReportImage(images, [side, "measurement"]);
  }
  if (mode === "Confidence") {
    return findReportImage(images, [side, "confidence"]) ?? findReportImage(images, [side, "normal"]);
  }
  const refs =
    typeof candidate === "object" && candidate !== null && "evidenceRefs" in candidate && Array.isArray(candidate.evidenceRefs)
      ? candidate.evidenceRefs.map(String)
      : [];
  return refs.map((ref) => findReportImage(images, [side, ref])).find(Boolean) ?? findReportImage(images, [side]);
}

export default function AiGraderReportViewerPage() {
  const router = useRouter();
  const requestedReportId = Array.isArray(router.query.reportId)
    ? router.query.reportId[0] ?? ""
    : router.query.reportId ?? "";
  const fallbackBundle = getAiGraderReportBundle(router.query.reportId);
  const [persistedBundle, setPersistedBundle] = useState<AiGraderCompatibleReportBundle | null>(null);
  const [persistedMathematicalBundle, setPersistedMathematicalBundle] = useState<AiGraderReportBundleV03 | null>(null);
  const [strictMathematicalFailure, setStrictMathematicalFailure] = useState<string | null>(null);
  const [failedMachineShell, setFailedMachineShell] = useState<FailedMachineReportShell | null>(null);
  const [editorialRevision, setEditorialRevision] = useState<AiGraderReportEditorialRevisionV1 | null>(null);
  const [comingSoon, setComingSoon] = useState(false);
  const [publicReportResolved, setPublicReportResolved] = useState(false);
  const [publicRefreshToken, setPublicRefreshToken] = useState(0);
  const [publicLookupError, setPublicLookupError] = useState<string | null>(null);
  const [publicNfcRegistration, setPublicNfcRegistration] = useState<PublicNfcRegistration | null>(null);
  const [publicEnrichment, setPublicEnrichment] = useState<AiGraderMathematicalPublicEnrichment | null>(null);
  const [selectedLabMode, setSelectedLabMode] = useState<LabMode>("True View");
  const [selectedLabSide, setSelectedLabSide] = useState<LabSide>("front");
  const [selectedFindingId, setSelectedFindingId] = useState<string | undefined>();
  const bundle = persistedBundle ?? fallbackBundle;
  const mathematicalBundle = persistedMathematicalBundle ?? parseAiGraderMathematicalReportV1(bundle);
  const reviewedRevision = editorialRevision?.reportId === requestedReportId
    ? editorialRevision
    : null;
  const reviewedContent = reviewedRevision?.content ?? {};
  const story = bundle.provisionalGrade;
  const productionRelease = bundle.productionRelease;
  const finalGrade = productionRelease?.finalGrade;
  const provisionalGateRows = story?.gates?.results ?? [];
  const noClaims = hasNoCertifiedClaim(bundle);
  const noFinalClaims = hasNoFinalCertifiedClaims(bundle);
  const primaryCandidate = story?.gradeImpactCandidates?.[0];
  const impactCandidate = productionRelease?.finalGrade.gradeImpactReasons?.[0] ?? primaryCandidate;
  const slabbedPhotoContract = productionRelease?.slabbedPhotoContract;
  const slabbedPhotos = Array.isArray(slabbedPhotoContract?.photos)
    ? slabbedPhotoContract.photos
    : [];
  const compsContract = productionRelease?.ebayCompsContract;
  const productionGates = productionRelease?.gates ?? [];
  const isMissingGeneratedReport = !persistedBundle && bundle.reportStatus === "missing_report_data";
  const reportSource = persistedBundle
    ? "persisted read-only report endpoint"
    : isExplicitAiGraderSampleReportId(router.query.reportId)
      ? "explicit sample fixture"
      : "not found in persisted production storage";
  const reportIsFinal = productionRelease?.finalGradeComputed === true || bundle.finalGradeComputed === true;
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
  const sideDefectFindings = aiGraderReportDefectFindings(bundle).filter((finding) => finding.side === selectedLabSide);
  const selectedFinding = sideDefectFindings.find((finding) => finding.findingId === selectedFindingId) ?? sideDefectFindings[0];
  const exactFindingImage = findReportNormalizedCardImageByExactAssetId(
    images,
    selectedFinding?.evidence.trueViewAssetId,
    selectedLabSide,
  );
  const exactImageFindings = defectFindingsForExactImage(sideDefectFindings, selectedFinding?.evidence.trueViewAssetId);
  const findingOverlayMode = selectedLabMode === "True View" || selectedLabMode === "Evidence Replay";
  const missingExactFindingEvidence = Boolean(findingOverlayMode && selectedFinding && !exactFindingImage);
  const selectedLabAsset =
    missingExactFindingEvidence
      ? undefined
      : findingOverlayMode && exactFindingImage
      ? exactFindingImage
      : labImageForMode(images, selectedLabMode, selectedLabSide, impactCandidate);
  const selectedLabModeAvailable = Boolean(selectedLabAsset?.renderUrl);

  const handleAdminEditorStateChange = useCallback((state: AiGraderReportAdminEditorState) => {
    const currentRevisionIdentity = editorialRevision
      ? `${editorialRevision.sourceBundleSha256}:${editorialRevision.revision}`
      : null;
    const incomingRevisionIdentity = state.editorialRevision
      ? `${state.editorialRevision.sourceBundleSha256}:${state.editorialRevision.revision}`
      : null;
    const revisionChanged = incomingRevisionIdentity !== null &&
      incomingRevisionIdentity !== currentRevisionIdentity;
    setEditorialRevision(state.editorialRevision);
    if (state.visibilityStatus === "coming_soon") {
      setComingSoon(true);
      setPublicReportResolved(true);
      return;
    }
    if (revisionChanged) {
      setComingSoon(false);
      setPublicReportResolved(false);
      setPublicRefreshToken((current) => current + 1);
      return;
    }
    if (comingSoon) {
      setComingSoon(false);
      setPublicReportResolved(false);
      setPublicRefreshToken((current) => current + 1);
    }
  }, [comingSoon, editorialRevision]);

  useEffect(() => {
    if (!router.isReady) return;
    const reportId = Array.isArray(router.query.reportId) ? router.query.reportId[0] : router.query.reportId;
    if (!reportId) return;
    const controller = new AbortController();
    setPublicReportResolved(false);
    setPersistedBundle(null);
    setPersistedMathematicalBundle(null);
    setStrictMathematicalFailure(null);
    setFailedMachineShell(null);
    setEditorialRevision(null);
    setComingSoon(false);
    setPublicLookupError(null);
    setPublicNfcRegistration(null);
    setPublicEnrichment(null);
    if (isExplicitAiGraderSampleReportId(reportId)) {
      setPublicReportResolved(true);
      return;
    }
    fetch(`/api/ai-grader/reports/${encodeURIComponent(reportId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (
          response.ok &&
          payload.ok === true &&
          payload.reportId === reportId &&
          payload.reportVisibility === "coming_soon" &&
          payload.comingSoon === true &&
          !("bundle" in payload)
        ) {
          setComingSoon(true);
          setPublicReportResolved(true);
          return;
        }
        if (
          response.ok &&
          payload.ok === true &&
          payload.reportId === reportId &&
          payload.reportVisibility === "public" &&
          payload.comingSoon === false &&
          payload.machineFailure &&
          typeof payload.machineFailure === "object" &&
          !Array.isArray(payload.machineFailure) &&
          payload.machineFailure.failed === true &&
          !("bundle" in payload)
        ) {
          const failure = payload.machineFailure as Record<string, unknown>;
          const parsedEditorialRevision = parseAiGraderReportEditorialRevisionV1(
            payload.editorialRevision,
            reportId,
          );
          const failureCodes = Array.isArray(failure.codes) && failure.codes.every(
            (code) => typeof code === "string" && code.length > 0 && code.length <= 160,
          )
            ? failure.codes as string[]
            : null;
          const revisionFailureCodes = parsedEditorialRevision
            ? [...parsedEditorialRevision.adjudicatedMachineFailures].sort()
            : [];
          if (
            !parsedEditorialRevision ||
            typeof failure.sourceReportSchemaVersion !== "string" ||
            failure.sourceReportSchemaVersion !== parsedEditorialRevision.sourceReportSchemaVersion ||
            !failureCodes ||
            JSON.stringify([...failureCodes].sort()) !== JSON.stringify(revisionFailureCodes) ||
            typeof failure.message !== "string" ||
            !failure.message.trim() ||
            failure.message.length > 1_000
          ) {
            setStrictMathematicalFailure("The machine report is incomplete and no exact source-bound human adjudication is available. The failed Mathematical V1 result remains unavailable.");
            setPublicReportResolved(true);
            return;
          }
          setEditorialRevision(parsedEditorialRevision);
          setFailedMachineShell({
            reportId,
            ...(parsedEditorialRevision.content.cardTitle
              ? { title: parsedEditorialRevision.content.cardTitle }
              : {}),
            sourceSchemaVersion: failure.sourceReportSchemaVersion,
          });
          setStrictMathematicalFailure(failure.message.trim());
          setPublicReportResolved(true);
          return;
        }
        if (response.ok && payload.ok === true && payload.bundle) {
          if (payload.reportVisibility !== "public" || payload.comingSoon !== false) {
            setPublicLookupError("This report returned an invalid public visibility contract.");
            setPublicReportResolved(true);
            return;
          }
          const parsedEditorialRevision = payload.editorialRevision === null
            ? null
            : parseAiGraderReportEditorialRevisionV1(payload.editorialRevision, reportId);
          if (payload.editorialRevision !== null && !parsedEditorialRevision) {
            setStrictMathematicalFailure("The saved human-reviewed report revision failed its exact formula or source-binding contract. The machine report will not be substituted as the effective result.");
            setPublicReportResolved(true);
            return;
          }
          setEditorialRevision(parsedEditorialRevision);
          if (payload.bundle.schemaVersion === "ai-grader-report-bundle-v0.3") {
            const strictBundle = parseAiGraderMathematicalReportV1(payload.bundle);
            if (!strictBundle) {
              setPersistedBundle(null);
              setPersistedMathematicalBundle(null);
              setPublicNfcRegistration(null);
              setPublicEnrichment(null);
              setStrictMathematicalFailure("This Mathematical Grading V1 report failed its strict formula, calibration, deduction, or evidence contract. A legacy V0 report will not be substituted.");
              setPublicReportResolved(true);
              return;
            }
            setPersistedBundle(null);
            setPersistedMathematicalBundle(strictBundle);
          } else if (
            payload.bundle.schemaVersion === AI_GRADER_WEB_REPORT_BUNDLE_V01_VERSION ||
            payload.bundle.schemaVersion === AI_GRADER_WEB_REPORT_BUNDLE_V02_VERSION
          ) {
            setPersistedMathematicalBundle(null);
            setPersistedBundle(payload.bundle);
          } else {
            setPersistedBundle(null);
            setPersistedMathematicalBundle(null);
            setPublicNfcRegistration(null);
            setPublicEnrichment(null);
            setStrictMathematicalFailure("This report declares an unsupported schema version. No legacy or sample report will be substituted.");
            setPublicReportResolved(true);
            return;
          }
          setPublicNfcRegistration(safePublicNfcRegistration(payload.nfcRegistration));
          setPublicEnrichment(safePublicEnrichment(payload.enrichment));
          setPublicReportResolved(true);
          return;
        }
        if (
          !response.ok &&
          typeof payload.code === "string" &&
          (payload.code === "AI_GRADER_MACHINE_REPORT_INVALID" ||
            payload.code.startsWith("AI_GRADER_OPERATOR_REVIEW_"))
        ) {
          setStrictMathematicalFailure(
            typeof payload.message === "string" && payload.message.length <= 1_000
              ? payload.message
              : "The machine report is incomplete and no valid human-reviewed completion is available.",
          );
          setPublicReportResolved(true);
          return;
        }
        setPersistedBundle(null);
        setPersistedMathematicalBundle(null);
        setPublicNfcRegistration(null);
        setPublicEnrichment(null);
        setPublicLookupError(payload.message ?? "This report was not resolved from persisted production storage.");
        setPublicReportResolved(true);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setPersistedBundle(null);
        setPersistedMathematicalBundle(null);
        setPublicNfcRegistration(null);
        setPublicEnrichment(null);
        setPublicLookupError("Persisted production report lookup failed.");
        setPublicReportResolved(true);
      });
    return () => controller.abort();
  }, [publicRefreshToken, router.isReady, router.query.reportId]);

  if (!publicReportResolved) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f3f0e9] p-8 text-[#171512]">
        <p className="text-sm font-bold uppercase tracking-widest text-amber-800">Loading exact report state…</p>
        {requestedReportId ? <AiGraderReportAdminEditor reportId={requestedReportId} onStateChange={handleAdminEditorStateChange} /> : null}
      </main>
    );
  }

  if (comingSoon && requestedReportId) {
    return (
      <ComingSoonReportWall
        reportId={requestedReportId}
        onAdminEditorStateChange={handleAdminEditorStateChange}
      />
    );
  }

  if (mathematicalBundle) {
    return (
      <AiGraderMathematicalReportV1
        bundle={mathematicalBundle}
        nfc={publicNfcRegistration}
        enrichment={publicEnrichment}
        editorialRevision={reviewedRevision}
        onAdminEditorStateChange={handleAdminEditorStateChange}
      />
    );
  }

  if (strictMathematicalFailure) {
    if (failedMachineShell) {
      return (
        <HumanAdjudicatedMachineFailureReport
          shell={failedMachineShell}
          failure={strictMathematicalFailure}
          revision={reviewedRevision}
          onAdminEditorStateChange={handleAdminEditorStateChange}
        />
      );
    }
    return (
      <main className="report-shell">
        {requestedReportId ? <AiGraderReportAdminEditor reportId={requestedReportId} onStateChange={handleAdminEditorStateChange} /> : null}
        <section className="local-status warn" role="alert">
          <strong>AI Grader report unavailable</strong>
          <p>{strictMathematicalFailure}</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <Head>
        <title>{reviewedContent.cardTitle ?? bundle.cardIdentity.title ?? "Ten Kings AI Grader Report"}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="report-shell">
        {requestedReportId ? <AiGraderReportAdminEditor reportId={requestedReportId} onStateChange={handleAdminEditorStateChange} /> : null}
        <header className="topbar">
          <div>
            <p className="eyebrow">Ten Kings AI Grader</p>
            <h1>{reviewedContent.cardTitle ?? bundle.cardIdentity.title ?? "AI Grader Report"}</h1>
            {reviewedRevision ? <span className="human-reviewed-badge">Completed — human reviewed/admin adjudicated · revision {reviewedRevision.revision}</span> : null}
          </div>
          <div className="meta">
            <span>Report {bundle.reportId}</span>
            <span>{new Date(bundle.generatedAt).toLocaleString()}</span>
            <strong>{reportIsFinal ? "Final AI-Grader Report V0 - Not Certified" : "Provisional Diagnostic - Not Certified - No Final Grade"}</strong>
          </div>
        </header>

        {publicLookupError || isMissingGeneratedReport ? (
          <section className="local-status warn">
            <strong>{persistedBundle ? "Published report bundle loaded" : "Published report not found"}</strong>
            <p>
              {publicLookupError ??
                "This generated report ID has no published DB/storage record. No sample report data is being substituted."}
            </p>
          </section>
        ) : null}

        <section className="hero">
          <div className="grade-panel">
            <p className="eyebrow">{reviewedRevision ? "Effective Human-Reviewed Grade" : reportIsFinal ? "Final AI-Grader Grade V0" : "Provisional Diagnostic Grade"}</p>
            <strong>{scoreText(reviewedRevision?.calculation.overall ?? finalGrade?.overall ?? story?.overall)}</strong>
            <span>{reviewedRevision ? "Admin adjudicated" : `Confidence ${finalGrade?.confidence.band ?? story?.confidence?.band ?? "pending"}`}</span>
            {reviewedRevision ? <small className="machine-value">Immutable machine overall: {scoreText(finalGrade?.overall ?? story?.overall)}</small> : null}
            <p>
              {reviewedContent.reportSummary ?? (reportIsFinal
                ? "This is the Ten Kings AI-Grader final report V0. It creates label-ready data and a QR report URL, but it is not a certified grading claim."
                : "This is a controlled provisional diagnostic output. It is not a certified Ten Kings grade and it does not create a label, QR certificate, or final certificate.")}
            </p>
          </div>
          <section className="vision-lab hero-lab">
            <div className="section-head">
            <p className="eyebrow">Ten Kings Vision Lab</p>
            <h2>Interactive forensic inspection shell</h2>
            <p>V0 renders report-bundle data and gracefully handles missing public assets. Every visual claim links back to evidence references.</p>
          </div>
          <div className="lab-layout">
            <aside>
              <div className="mode-list" role="group" aria-label="Vision Lab evidence mode">
              {LAB_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={mode === selectedLabMode}
                  className={mode === selectedLabMode ? "active" : ""}
                  disabled={
                    !(
                      ((mode === "True View" || mode === "Evidence Replay") && (exactFindingImage?.renderUrl || selectedFinding)) ||
                      labImageForMode(images, mode, selectedLabSide, impactCandidate)?.renderUrl
                    )
                  }
                  onClick={() => setSelectedLabMode(mode)}
                >
                  {mode}
                </button>
              ))}
              </div>
              <div className="side-switch" role="group" aria-label="Vision Lab card side">
                <button type="button" aria-pressed={selectedLabSide === "front"} className={selectedLabSide === "front" ? "active" : ""} onClick={() => setSelectedLabSide("front")}>
                  Front
                </button>
                <button type="button" aria-pressed={selectedLabSide === "back"} className={selectedLabSide === "back" ? "active" : ""} onClick={() => setSelectedLabSide("back")}>
                  Back
                </button>
              </div>
            </aside>
            <div id="vision-lab-panel" className="lab-canvas">
              {selectedLabAsset?.renderUrl && findingOverlayMode && exactFindingImage && exactImageFindings.length ? (
                <AiGraderDefectOverlay
                  image={exactFindingImage}
                  findings={exactImageFindings}
                  selectedFindingId={selectedFinding?.findingId}
                  onSelectFinding={setSelectedFindingId}
                />
              ) : selectedLabAsset?.renderUrl ? (
                <img className="lab-image selected" src={selectedLabAsset.renderUrl} alt={`Vision Lab ${selectedLabSide} ${selectedLabMode}`} />
              ) : (
                <div className="viewer-card">
                  <span>{selectedLabMode}</span>
                  <strong>{missingExactFindingEvidence ? "Normalized finding evidence unavailable" : selectedLabModeAvailable ? "Evidence referenced" : "Mode unavailable"}</strong>
                </div>
              )}
            </div>
            <aside className="evidence">
              <h3>{selectedLabMode}</h3>
              <dl>
                <dt>Side</dt>
                <dd>{selectedLabSide}</dd>
                <dt>Image</dt>
                <dd>{selectedLabAsset?.fileName ?? selectedLabAsset?.id ?? "unavailable"}</dd>
              </dl>
              {impactCandidate ? (
                <dl>
                  <dt>Candidate</dt>
                  <dd>{impactCandidate.id}</dd>
                  <dt>Severity</dt>
                  <dd>{impactCandidate.severity}</dd>
                  <dt>Source channels</dt>
                  <dd>{sourceChannelsText(impactCandidate)}</dd>
                  <dt>Evidence</dt>
                  <dd>{(impactCandidate.evidenceRefs ?? []).join(", ")}</dd>
                </dl>
              ) : (
                <p>No candidate details available.</p>
              )}
              {sideDefectFindings.length ? (
                <div className="finding-list" aria-label={`${selectedLabSide} defect findings`}>
                  <h3>Provisional findings</h3>
                  {sideDefectFindings.map((finding, index) => (
                    <button
                      type="button"
                      key={finding.findingId}
                      className={finding.findingId === selectedFinding?.findingId ? "active" : ""}
                      aria-pressed={finding.findingId === selectedFinding?.findingId}
                      onClick={() => setSelectedFindingId(finding.findingId)}
                    >
                      {index + 1}. {finding.category.replace(/_/g, " ")} / {finding.severity.band} / {finding.review.status}
                    </button>
                  ))}
                  <p>{selectedFinding?.explanation}</p>
                  <small>{selectedFinding ? `${Math.round(selectedFinding.confidence * 100)}% detector confidence; ${selectedFinding.review.status}` : ""}</small>
                  {missingExactFindingEvidence ? <strong className="finding-unavailable">Exact normalized-card evidence is unavailable; no overlay is shown.</strong> : null}
                </div>
              ) : null}
            </aside>
            </div>
          </section>
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
                <strong>
                  <a href={productionRelease.publication.publicReportUrl} target="_blank" rel="noreferrer">
                    Open public report
                  </a>
                </strong>
              </article>
              <article>
                <span>Cert / Report ID</span>
                <strong>{productionRelease.label.certId}</strong>
              </article>
              <article>
                <span>Label Grade</span>
                <strong>{reviewedRevision ? reviewedRevision.calculation.labelGrade.toFixed(1) : productionRelease.label.labelGradeText}</strong>
                {reviewedRevision ? <small>Immutable machine label: {productionRelease.label.labelGradeText}</small> : null}
              </article>
              <article>
                <span>Certified Claim</span>
                <strong>{productionRelease.certifiedClaim ? "Unexpected" : "Disabled"}</strong>
              </article>
              {publicNfcRegistration ? (
                <article>
                  <span>NFC registration</span>
                  <strong>Registered Ten Kings NFC link</strong>
                  <p>
                    Linked to this Ten Kings AI Grader report. This {publicNfcRegistration.chipType === "FEIJU_F8215" ? "write-protected F8215" : "NTAG215"} link is not cryptographic authentication.
                  </p>
                  <a href={publicNfcRegistration.nfcTagUrl}>Open registered NFC link</a>
                </article>
              ) : null}
              {slabbedPhotoContract ? (
                <article>
                  <span>Slab Photos</span>
                  <strong>{slabbedPhotos.length ? `${slabbedPhotos.length} attached` : slabbedPhotoContract.status}</strong>
                </article>
              ) : null}
              {compsContract ? (
                <article>
                  <span>Valuation</span>
                  <strong>{compsContract.status}</strong>
                </article>
              ) : null}
            </div>
            {productionGates.length ? <div className="gate-list">
              {productionGates.map((gate) => (
                <article key={gate.id} className={gate.status}>
                  <span>{gate.status.replace("_", " ")}</span>
                  <strong>{gate.label}</strong>
                  <p>{gate.reason}</p>
                </article>
              ))}
            </div> : null}
          </section>
        ) : null}

        {productionRelease && (slabbedPhotoContract || compsContract) ? (
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
                      {typeof record.publicUrl === "string" ? (
                        <p>
                          <a href={record.publicUrl} target="_blank" rel="noreferrer">
                            Open storage-backed image
                          </a>
                        </p>
                      ) : null}
                    </article>
                  );
                })
              ) : slabbedPhotoContract ? (
                <article>
                  <span>Slabbed color photos</span>
                  <strong>{slabbedPhotoContract.status}</strong>
                  <p>{slabbedPhotoContract.note}</p>
                </article>
              ) : null}
              {compsContract ? <article>
                <span>eBay comps</span>
                <strong>{compsContract.status}</strong>
                <p>
                  {compsContract.searchQuery
                    ? `Query: ${compsContract.searchQuery}`
                    : compsContract.note}
                </p>
              </article> : null}
              {compsContract ? <article>
                <span>Valuation</span>
                <strong>
                  {typeof compsContract.valuationMinor === "number"
                    ? `$${(compsContract.valuationMinor / 100).toFixed(2)}`
                    : "pending"}
                </strong>
                <p>{Array.isArray(compsContract.compsRefs) ? `${compsContract.compsRefs.length} comp ref(s)` : "No comps attached."}</p>
              </article> : null}
            </div>
          </section>
        ) : null}

        <section className="summary">
          <article>
            <span>Strongest Positive</span>
            <p>{reviewedContent.strongestPositive ?? story?.gradeStory?.strongestPositiveFinding ?? "No positive finding computed."}</p>
            {reviewedContent.strongestPositive ? <small>Human-reviewed text; immutable machine narrative remains in report provenance.</small> : null}
          </article>
          <article>
            <span>Strongest Warning</span>
            <p>{reviewedContent.strongestWarning ?? story?.gradeStory?.strongestWarning ?? bundle.warnings?.[0]}</p>
            {reviewedContent.strongestWarning ? <small>Human-reviewed text; immutable machine narrative remains in report provenance.</small> : null}
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

        <section className="elements">
          <div className="section-head">
            <p className="eyebrow">Element Diagnostics</p>
            <h2>Provisional scoring by element</h2>
          </div>
          <div className="element-grid">
            {ELEMENT_LABELS.map((element) => {
              const result = story?.elementScores?.[element];
              const finalResult = finalGrade?.elements?.[element];
              const machineScore = finalResult?.score ?? result?.score;
              const reviewedExplanation = reviewedContent[ELEMENT_EXPLANATION_FIELD[element]];
              return (
                <article key={element}>
                  <span>{element}</span>
                  <strong>{scoreText(reviewedRevision?.scores[element] ?? machineScore)}</strong>
                  {reviewedRevision ? <small className="effective-value">Human reviewed · immutable machine {scoreText(machineScore)}</small> : null}
                  <p>{reviewedExplanation ?? finalResult?.explanation ?? result?.explanation ?? "Insufficient evidence."}</p>
                  {reviewedExplanation ? (
                    <details>
                      <summary>Immutable machine explanation</summary>
                      <p>{finalResult?.explanation ?? result?.explanation ?? "Insufficient machine evidence."}</p>
                    </details>
                  ) : null}
                  <em>{finalResult?.confidence ?? result?.confidence ?? "pending"} confidence</em>
                </article>
              );
            })}
          </div>
        </section>

        {reviewedRevision ? (
          <section className="production reviewed-calculation">
            <div className="section-head">
              <p className="eyebrow">Effective Human-Reviewed Calculation</p>
              <h2>Four required scores update the overall grade dynamically</h2>
              <p>{reviewedRevision.calculation.weightedFormula}</p>
            </div>
            <div className="production-grid">
              <article><span>Effective overall</span><strong>{scoreText(reviewedRevision.calculation.overall)}</strong></article>
              <article><span>Weighted grade</span><strong>{scoreText(reviewedRevision.calculation.weightedGrade)}</strong></article>
              <article><span>Weakest element</span><strong>{reviewedRevision.calculation.weakestElement} {scoreText(reviewedRevision.calculation.weakestScore)}</strong></article>
              <article><span>Weakest-element cap</span><strong>{scoreText(reviewedRevision.calculation.weakestElementCap)}</strong></article>
            </div>
            <p className="formula">{reviewedRevision.calculation.finalFormula}</p>
            <details className="machine-provenance">
              <summary>Immutable original machine result and adjudicated failures</summary>
              <p>Machine overall: {scoreText(finalGrade?.overall ?? story?.overall)}. The source report and all evidence remain unchanged.</p>
              {reviewedRevision.adjudicatedMachineFailures.length ? <p>Adjudicated failures: {reviewedRevision.adjudicatedMachineFailures.join(", ")}.</p> : null}
            </details>
          </section>
        ) : null}

        <section className="why">
          <div className="section-head">
            <p className="eyebrow">Why Not 10?</p>
            <h2>Grade-impact reasons</h2>
          </div>
          {reviewedContent.whyNot10 ? (
            <article className="effective-why">
              <strong>Effective human-reviewed explanation</strong>
              <p>{reviewedContent.whyNot10}</p>
            </article>
          ) : null}
          {reviewedRevision ? <p className="machine-reasons-label">Immutable machine reasons</p> : null}
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
            <dd>{reportSource}</dd>
            {bundle.evidenceReferences?.frontEvidenceRefs?.length ? (
              <>
                <dt>Front evidence</dt>
                <dd>{bundle.evidenceReferences.frontEvidenceRefs.join(", ")}</dd>
              </>
            ) : null}
            {bundle.evidenceReferences?.backEvidenceRefs?.length ? (
              <>
                <dt>Back evidence</dt>
                <dd>{bundle.evidenceReferences.backEvidenceRefs.join(", ")}</dd>
              </>
            ) : null}
            <dt>Published image assets</dt>
            <dd>{images.length ? `${images.length} image(s)` : "missing"}</dd>
            <dt>Ruler calibration</dt>
            <dd>{JSON.stringify(bundle.rulerCalibration ?? {})}</dd>
            <dt>Final/certified claims</dt>
            <dd>{noClaims ? (reportIsFinal ? "final AI-Grader V0 present; certified claim disabled" : "none generated") : "unexpected certified claim flag present"}</dd>
            <dt>Legacy provisional-only flags</dt>
            <dd>{noFinalClaims ? "provisional only" : "final report data present"}</dd>
            <dt>Label data</dt>
            <dd>{productionRelease ? (productionRelease.label.status ? `${productionRelease.label.status} (${productionRelease.label.qrPayloadUrl})` : productionRelease.label.qrPayloadUrl) : "not generated"}</dd>
            {productionRelease?.publication.storageMode || productionRelease?.publication.dbWritesPerformed !== undefined ? (
              <>
                <dt>DB/storage publication</dt>
                <dd>{`${productionRelease.publication.storageMode ?? ""}${productionRelease.publication.storageMode ? "; " : ""}DB writes ${productionRelease.publication.dbWritesPerformed}`}</dd>
              </>
            ) : null}
          </dl>
          <ul>
            {(bundle.limitations ?? []).map((limitation) => (
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
        .human-reviewed-badge {
          display: inline-block;
          margin-top: 10px;
          border: 1px solid rgba(27, 111, 63, 0.28);
          border-radius: 999px;
          background: #e9f7ed;
          color: #18562d;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
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
          grid-template-columns: 320px minmax(0, 1fr);
          gap: 20px;
          min-height: 620px;
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
        .grade-panel .machine-value {
          display: block;
          margin-top: 8px;
          color: #6d665b;
          font-size: 12px;
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
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 14px;
        }
        .image-grid figure {
          grid-column: span 2;
          margin: 0;
          border: 1px solid rgba(26, 24, 20, 0.1);
          border-radius: 8px;
          overflow: hidden;
          background: #171614;
        }
        .image-grid figure:nth-child(-n + 2) {
          grid-column: span 3;
        }
        .image-grid img {
          display: block;
          width: 100%;
          aspect-ratio: 4 / 3;
          object-fit: contain;
          background: #111;
        }
        .image-grid figure:nth-child(-n + 2) img {
          aspect-ratio: 2.5 / 3.5;
          max-height: 680px;
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
        .production-grid a {
          color: #5f4516;
          text-decoration-thickness: 2px;
          text-underline-offset: 3px;
          overflow-wrap: anywhere;
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
        .summary small {
          display: block;
          margin-top: 8px;
          color: #267044;
          font-size: 11px;
        }
        .vision-lab,
        .elements,
        .why,
        .appendix {
          padding: 24px;
        }
        .hero-lab {
          max-width: none;
          min-width: 0;
          margin: 0;
          padding: 20px;
        }
        .hero-lab .section-head {
          margin-bottom: 14px;
        }
        .hero-lab .lab-layout {
          grid-template-columns: 150px minmax(0, 1fr) 210px;
          gap: 12px;
          min-height: 430px;
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
        .mode-list {
          display: grid;
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
        .lab-layout button:disabled {
          cursor: not-allowed;
          opacity: 0.46;
        }
        .side-switch {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-top: 10px;
        }
        .side-switch button {
          text-align: center;
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
        .lab-image.selected {
          position: static;
          width: min(92%, 720px);
          height: calc(100% - 48px);
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
        .finding-list {
          display: grid;
          gap: 8px;
          margin-top: 16px;
          padding-top: 14px;
          border-top: 1px solid rgba(255, 255, 255, 0.14);
        }
        .finding-list button {
          padding: 9px 10px;
          font-size: 12px;
          text-transform: capitalize;
        }
        .finding-list p,
        .finding-list small {
          color: #c9c2b7;
          line-height: 1.45;
        }
        .finding-unavailable {
          color: #ffb7a3;
          font-size: 12px;
          line-height: 1.45;
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
        .element-grid .effective-value {
          display: block;
          margin-top: 2px;
          color: #267044;
          font-size: 11px;
          font-weight: 900;
        }
        .element-grid details {
          margin-top: 10px;
          border-top: 1px solid rgba(20, 20, 20, 0.1);
          padding-top: 9px;
          color: #625c52;
          font-size: 11px;
        }
        .element-grid summary,
        .machine-provenance summary {
          cursor: pointer;
          font-weight: 900;
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
        .reviewed-calculation {
          border-color: rgba(27, 111, 63, 0.24);
          background: rgba(233, 247, 237, 0.78);
        }
        .reviewed-calculation .formula {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 12px;
        }
        .machine-provenance {
          margin-top: 16px;
          border: 1px solid rgba(20, 20, 20, 0.12);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.6);
          padding: 12px 14px;
          font-size: 12px;
        }
        .machine-provenance p {
          margin-top: 8px;
        }
        .effective-why {
          margin-bottom: 14px;
          border: 1px solid rgba(27, 111, 63, 0.24);
          border-radius: 8px;
          background: #e9f7ed;
          padding: 16px;
        }
        .effective-why p {
          margin-top: 8px;
          line-height: 1.55;
        }
        .machine-reasons-label {
          margin: 0 0 10px;
          color: #71695d;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
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
          .hero-lab .lab-layout {
            grid-template-columns: 1fr;
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
          .image-grid {
            grid-template-columns: 1fr;
          }
          .image-grid figure,
          .image-grid figure:nth-child(-n + 2) {
            grid-column: span 1;
          }
        }
      `}</style>
    </>
  );
}
