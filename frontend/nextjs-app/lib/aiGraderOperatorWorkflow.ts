import type { AiGraderStationProductionRelease } from "./aiGraderProductionRelease";
import type { AiGraderReportBundleV03 } from "@tenkings/shared";
import {
  isAiGraderReportBundleV03,
  type AiGraderLegacyReportBundle,
  type AiGraderStationReportBundle,
} from "./aiGraderReportBundle";
import { aiGraderMathematicalReleaseEnvelopeIssue } from "./aiGraderMathematicalReportV1";

const DEFAULT_PUBLIC_BASE_URL = "https://collect.tenkings.co";

export const AI_GRADER_NORMAL_OPERATOR_ACTION_LABELS = [
  "Review Report",
  "Publish to Ten Kings",
  "View Public Report",
  "Open Label Sheets",
  "Run eBay Comps",
  "Card History Reports",
] as const;

export type AiGraderPublishReadinessStatus =
  | "ready"
  | "published"
  | "not_ready_no_report"
  | "not_ready_insufficient_evidence"
  | "not_ready_missing_final_grade"
  | "not_ready_missing_label";

export type AiGraderPublishReadiness = {
  status: AiGraderPublishReadinessStatus;
  ready: boolean;
  published: boolean;
  message: string;
  reportId?: string;
  certId?: string;
  publicReportUrl?: string;
  labelPreviewUrl?: string;
  qrPayloadUrl?: string;
  failedGates: Array<{ id: string; label: string; reason: string }>;
};

export type AiGraderCompsReadinessStatus = "ready" | "not_ready_missing_grade" | "not_ready_missing_identity";

export type AiGraderCompsReadiness = {
  status: AiGraderCompsReadinessStatus;
  ready: boolean;
  message: string;
};

type CardIdentityLike = {
  title?: string;
  displayTitle?: string;
  set?: string;
  cardNumber?: string;
};

function trim(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function publicBase(baseUrl = DEFAULT_PUBLIC_BASE_URL) {
  return baseUrl.replace(/\/+$/, "");
}

export function buildAiGraderPublicReportUrl(reportId: string, baseUrl = DEFAULT_PUBLIC_BASE_URL) {
  return `${publicBase(baseUrl)}/ai-grader/reports/${encodeURIComponent(reportId)}`;
}

export function buildAiGraderLabelPreviewUrl(_reportId: string, baseUrl = DEFAULT_PUBLIC_BASE_URL) {
  return `${publicBase(baseUrl)}/ai-grader/labels/sheets`;
}

function releaseFrom(bundle?: AiGraderStationReportBundle | null, release?: AiGraderStationProductionRelease | null) {
  if (isAiGraderReportBundleV03(bundle)) return release ?? null;
  return release ?? (bundle?.productionRelease as AiGraderStationProductionRelease | undefined) ?? null;
}

export function buildAiGraderPublishReadiness(input: {
  bundle?: AiGraderStationReportBundle | null;
  productionRelease?: AiGraderStationProductionRelease | null;
  published?: boolean;
  publicBaseUrl?: string;
}): AiGraderPublishReadiness {
  const release = releaseFrom(input.bundle, input.productionRelease);
  const mathematicalBundle = isAiGraderReportBundleV03(input.bundle) ? input.bundle : null;
  const legacyBundle = mathematicalBundle ? null : input.bundle as AiGraderLegacyReportBundle | null | undefined;
  const reportId = trim(release?.reportId) || trim(input.bundle?.reportId);
  const certId = trim(release?.label?.certId);
  const plannedPublicReportUrl =
    trim(release?.publication?.publicReportUrl) ||
    trim(release?.label?.publicReportUrl) ||
    (reportId ? buildAiGraderPublicReportUrl(reportId, input.publicBaseUrl) : undefined);
  const plannedQrPayloadUrl = trim(release?.label?.qrPayloadUrl) || trim(release?.publication?.qrPayloadUrl) || plannedPublicReportUrl;
  const publishedPublicReportUrl = input.published === true ? plannedPublicReportUrl : undefined;
  const publishedQrPayloadUrl = input.published === true ? plannedQrPayloadUrl : undefined;
  const publishedLabelPreviewUrl = input.published === true && reportId ? buildAiGraderLabelPreviewUrl(reportId, input.publicBaseUrl) : undefined;
  const releaseFailedGates = (release?.gates ?? [])
    .filter((gate) => gate.status === "fail")
    .map((gate) => ({
      id: gate.id,
      label: gate.label ?? gate.id,
      reason: gate.reason,
    }));
  const provisionalFailedGates = (legacyBundle?.provisionalGrade?.gates?.results ?? [])
    .filter((gate) => gate.status === "fail")
    .map((gate) => ({
      id: trim(gate.gate) || "provisional_gate",
      label: trim(gate.gate) || "Provisional evidence gate",
      reason: trim(gate.summary) || "Provisional evidence gate failed.",
    }));
  const failedGates = [...releaseFailedGates, ...provisionalFailedGates];
  const published = input.published === true;

  if (!input.bundle && !release) {
    return {
      status: "not_ready_no_report",
      ready: false,
      published,
      message: "No report bundle is ready yet.",
      failedGates,
    };
  }

  if (published) {
    return {
      status: "published",
      ready: true,
      published: true,
      message: "Published to Ten Kings storage and public report routes.",
      reportId,
      certId,
      publicReportUrl: publishedPublicReportUrl,
      labelPreviewUrl: publishedLabelPreviewUrl,
      qrPayloadUrl: publishedQrPayloadUrl,
      failedGates,
    };
  }

  const insufficient =
    legacyBundle?.reportStatus === "insufficient_evidence" ||
    release?.reportStatus === "insufficient_evidence" ||
    release?.finalGrade?.status === "insufficient_evidence";
  if (insufficient || failedGates.length > 0) {
    return {
      status: "not_ready_insufficient_evidence",
      ready: false,
      published,
      message: "Report has insufficient evidence; review the failed or blocked gates before publishing.",
      reportId,
      certId,
      failedGates,
    };
  }

  const mathematicalEnvelopeIssue = mathematicalBundle
    ? aiGraderMathematicalReleaseEnvelopeIssue(mathematicalBundle, release)
    : undefined;
  const finalGradeComputed = mathematicalBundle
    ? release?.finalGradeComputed === true && !mathematicalEnvelopeIssue
    : legacyBundle?.finalGradeComputed === true || release?.finalGradeComputed === true;
  if (!finalGradeComputed) {
    return {
      status: "not_ready_missing_final_grade",
      ready: false,
      published,
      message: mathematicalEnvelopeIssue ?? "Final AI-Grader grade has not been computed yet.",
      reportId,
      certId,
      failedGates,
    };
  }

  const labelReady = release?.label?.status === "label_data_ready" && Boolean(plannedQrPayloadUrl);
  if (!labelReady) {
    return {
      status: "not_ready_missing_label",
      ready: false,
      published,
      message: "Label and QR data are not ready yet.",
      reportId,
      certId,
      failedGates,
    };
  }

  return {
    status: "ready",
    ready: true,
    published,
    message: "Ready to publish to Ten Kings storage and generate the public report/label links.",
    reportId,
    certId,
    failedGates,
  };
}

export function buildAiGraderCompsReadiness(input: {
  bundle?: AiGraderStationReportBundle | null;
  productionRelease?: AiGraderStationProductionRelease | AiGraderReportBundleV03["productionRelease"] | AiGraderStationReportBundle["productionRelease"] | null;
  selectedCard?: CardIdentityLike | null;
}): AiGraderCompsReadiness {
  const mathematicalBundle = isAiGraderReportBundleV03(input.bundle) ? input.bundle : null;
  const release = mathematicalBundle
    ? input.productionRelease
    : releaseFrom(input.bundle, input.productionRelease as AiGraderStationProductionRelease | null | undefined);
  if (!mathematicalBundle && (release as AiGraderStationProductionRelease | null)?.finalGradeComputed !== true) {
    return {
      status: "not_ready_missing_grade",
      ready: false,
      message: "Final grade is required before eBay comps can run.",
    };
  }
  const identity: CardIdentityLike = input.selectedCard ?? input.bundle?.cardIdentity ?? {};
  const title = trim(identity.title) || trim(identity.displayTitle);
  const set = trim(identity.set);
  const cardNumber = trim(identity.cardNumber);
  if (!title && (!set || !cardNumber)) {
    return {
      status: "not_ready_missing_identity",
      ready: false,
      message: "Card identity is required before eBay comps can run.",
    };
  }
  return {
    status: "ready",
    ready: true,
    message: "Ready to run sold-comps lookup through the Ten Kings comps pipeline.",
  };
}

export function aiGraderOperatorStepCopy(stepId: string) {
  if (stepId === "calculate_final_grade" || stepId === "finalize_publish_report" || stepId === "label_data_ready") {
    return {
      label: "Review Report",
      operatorAction: "Review the generated report, then publish when the report is ready.",
    };
  }
  return null;
}
