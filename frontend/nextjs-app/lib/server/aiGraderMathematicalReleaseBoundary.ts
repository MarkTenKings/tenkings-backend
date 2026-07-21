import {
  AI_GRADER_REPORT_BUNDLE_V03_VERSION,
  aiGraderReportBundleV03Schema,
  type AiGraderReportBundleV03,
} from "@tenkings/shared";
import { aiGraderMathematicalReleaseEnvelopeIssue } from "../aiGraderMathematicalReportV1";

export { aiGraderMathematicalReleaseEnvelopeIssue } from "../aiGraderMathematicalReportV1";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export type AiGraderMathematicalBoundaryResult =
  | { success: true; bundle: AiGraderReportBundleV03 }
  | { success: false; message: string };

/** Strict schema validation also recomputes every formula, U95, deduction, cap, and four-element score. */
export function parseAiGraderMathematicalBoundaryBundle(value: unknown): AiGraderMathematicalBoundaryResult {
  if (!isRecord(value) || value.schemaVersion !== AI_GRADER_REPORT_BUNDLE_V03_VERSION) {
    return { success: false, message: "A strict Mathematical Grading V1 report bundle v0.3 is required." };
  }
  const parsed = aiGraderReportBundleV03Schema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "bundle"}: ${issue.message}`).join("; ");
    return { success: false, message: `Mathematical Grading V1 validation failed: ${detail}` };
  }
  return { success: true, bundle: parsed.data };
}

export function aiGraderMathematicalNormalizedEvidenceIssue(bundle: AiGraderReportBundleV03): string | undefined {
  const expectedWidth = bundle.calibrationProfile.normalizedWidthPx;
  const expectedHeight = bundle.calibrationProfile.normalizedHeightPx;
  const normalized = bundle.publicAssets.filter((asset) => asset.evidenceRole === "normalized_card");
  const valid = (side: "front" | "back") => normalized.filter((asset) => {
    const digest = asset.checksumSha256 ?? asset.sha256;
    return asset.side === side &&
      asset.contentType === "image/png" &&
      asset.widthPx === expectedWidth &&
      asset.heightPx === expectedHeight &&
      typeof digest === "string" && /^[a-f0-9]{64}$/i.test(digest) &&
      Number.isSafeInteger(asset.byteSize) && Number(asset.byteSize) > 0;
  });
  if (normalized.length !== 2 || valid("front").length !== 1 || valid("back").length !== 1) {
    return "Confirm Card requires one immutable normalized PNG for each side at the finalized calibration dimensions.";
  }
  return undefined;
}
