import { z } from "zod";
import {
  AI_GRADER_DEFECT_FINDING_MAX_COUNT,
  aiGraderPublishedDefectFindingV1Schema,
  isSafeAiGraderPublicAssetId,
} from "./aiGraderDefectFindings";
import type { AiGraderReportBundleV03 } from "./aiGraderReportBundlesV03";

export const AI_GRADER_REPORT_BUNDLE_V01_VERSION = "ai-grader-report-bundle-v0.1" as const;
export const AI_GRADER_REPORT_BUNDLE_V02_VERSION = "ai-grader-report-bundle-v0.2" as const;

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "must be a safe public identifier");

const reportIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/, "must be a safe report identifier");

const safeTextSchema = (maxLength: number) => z
  .string()
  .trim()
  .min(1)
  .max(maxLength)
  .refine(
    (value) =>
      !/(?:data|blob|file):/i.test(value) &&
      !/[a-z]:[\\/]/i.test(value) &&
      !/\\\\/.test(value) &&
      !/(?:authorization\s*:|bearer\s+|api[_ -]?key\s*[=:]|password\s*[=:]|token\s*[=:]|secret\s*[=:]|credential\s*[=:])/i.test(value) &&
      !/[<>]/.test(value),
    "must be safe public text",
  );

const safeAssetIdSchema = z
  .string()
  .refine(isSafeAiGraderPublicAssetId, "must be a safe logical public asset ID");

function isSafePublishedUrl(value: string) {
  let decodedValue = value;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const nextValue = decodeURIComponent(decodedValue);
      if (nextValue === decodedValue) break;
      decodedValue = nextValue;
    } catch {
      return false;
    }
  }
  if (
    /(?:x-amz-(?:algorithm|credential|date|expires|security-token|signature|signedheaders)|x-goog-(?:algorithm|credential|date|expires|signature|signedheaders)|awsaccesskeyid)/i.test(decodedValue) ||
    /(?:^|[?&;])(?:sig|signature|token)=/i.test(decodedValue) ||
    /(?:^|[/_.-])presign(?:ed)?(?:[/_.-]|$)/i.test(decodedValue)
  ) {
    return false;
  }
  if (value.startsWith("/")) {
    return !value.startsWith("//") && !/[?#\\\u0000-\u001f\u007f]/.test(value);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
    if (
      !host ||
      !host.includes(".") && !host.includes(":") ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".lan") ||
      host.endsWith(".home") ||
      host.endsWith(".home.arpa")
    ) {
      return false;
    }

    const isPrivateIpv4 = (candidate: string) => {
      const octets = candidate.split(".");
      if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
      const [first, second] = octets.map(Number);
      return (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        first >= 224 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && (second === 0 || second === 168)) ||
        (first === 198 && (second === 18 || second === 19))
      );
    };
    if (isPrivateIpv4(host)) return false;

    if (host.includes(":")) {
      if (host === "::" || host === "::1" || host.startsWith("::ffff:")) return false;
      const expandedLoopback = host.split(":").map((part) => Number.parseInt(part || "0", 16));
      if (
        !host.includes("::") &&
        expandedLoopback.length === 8 &&
        expandedLoopback.slice(0, 7).every((part) => part === 0) &&
        expandedLoopback[7] <= 1
      ) {
        return false;
      }
      const mappedIpv4 = host.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
      if (mappedIpv4 && isPrivateIpv4(mappedIpv4)) return false;
      const firstHextet = Number.parseInt(host.split(":", 1)[0] || "0", 16);
      if ((firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const aiGraderSafePublishedUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(isSafePublishedUrl, "must be a stable public HTTPS or root-relative URL without credentials or query data");

const evidenceRoleSchema = z.enum([
  "normalized_card",
  "surface_heatmap",
  "surface_vision",
  "confidence_mask",
  "measurement_overlay",
  "deduction_overlay",
  "segmentation_mask",
  "illumination_mask",
  "common_mode_response",
  "outer_cut_contour",
  "printed_design_contour",
  "design_reference",
  "centering_overlay",
  "flat_field",
  "directional_channel",
  "roi_crop",
  "other_evidence",
]);

export const aiGraderPublishedAssetSchema = z
  .strictObject({
    id: safeAssetIdSchema,
    kind: identifierSchema.optional(),
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/, "must be a safe base file name")
      .optional(),
    contentType: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9.+-]*\/[A-Za-z0-9][A-Za-z0-9.+-]*(?:;\s*charset=[A-Za-z0-9._-]+)?$/)
      .optional(),
    storageKey: safeAssetIdSchema.optional(),
    publicUrl: aiGraderSafePublishedUrlSchema.optional(),
    byteSize: z.number().int().nonnegative().optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    side: z.enum(["front", "back"]).optional(),
    evidenceRole: evidenceRoleSchema.optional(),
    widthPx: z.number().int().positive().optional(),
    heightPx: z.number().int().positive().optional(),
  })
  .refine((asset) => (asset.widthPx === undefined) === (asset.heightPx === undefined), {
    message: "widthPx and heightPx must be published together",
  });

export const aiGraderCalibrationProfileSchema = z
  .strictObject({
    isCalibrated: z.boolean(),
    coordinateFrame: z.literal("normalized_card_portrait_pixels").optional(),
    calibrationVersion: identifierSchema.optional(),
    mmPerPixelX: z.number().finite().positive().optional(),
    mmPerPixelY: z.number().finite().positive().optional(),
  })
  .superRefine((profile, context) => {
    if (!profile.isCalibrated) {
      for (const key of ["coordinateFrame", "calibrationVersion", "mmPerPixelX", "mmPerPixelY"] as const) {
        if (profile[key] !== undefined) {
          context.addIssue({ code: "custom", path: [key], message: "must be absent until calibration is finalized" });
        }
      }
      return;
    }
    if (!profile.coordinateFrame) {
      context.addIssue({ code: "custom", path: ["coordinateFrame"], message: "is required when calibration is finalized" });
    }
    if (!profile.calibrationVersion) {
      context.addIssue({ code: "custom", path: ["calibrationVersion"], message: "is required when calibration is finalized" });
    }
    if (profile.mmPerPixelX === undefined) {
      context.addIssue({ code: "custom", path: ["mmPerPixelX"], message: "is required when calibration is finalized" });
    }
    if (profile.mmPerPixelY === undefined) {
      context.addIssue({ code: "custom", path: ["mmPerPixelY"], message: "is required when calibration is finalized" });
    }
  });

const elementScoreSchema = z.strictObject({
  score: z.number().finite().min(1).max(10),
  confidence: z.enum(["low", "medium", "high"]),
  explanation: safeTextSchema(500),
});

const gradeImpactReasonSchema = z.strictObject({
  id: identifierSchema,
  category: identifierSchema,
  side: z.enum(["front", "back", "both"]),
  severity: safeTextSchema(64),
  confidence: safeTextSchema(64),
  explanation: safeTextSchema(500),
  evidenceRefs: z.array(safeAssetIdSchema).max(64).optional(),
  findingIds: z.array(identifierSchema).max(AI_GRADER_DEFECT_FINDING_MAX_COUNT).optional(),
});

const whyNot10Schema = z.strictObject({
  id: identifierSchema,
  title: safeTextSchema(200),
  explanation: safeTextSchema(500),
  evidenceRefs: z.array(safeAssetIdSchema).max(64).optional(),
});

const finalGradeSchema = z.strictObject({
  status: z.enum(["final_ai_grader_grade_v0", "insufficient_evidence"]).optional(),
  overall: z.number().finite().min(1).max(10),
  elements: z.strictObject({
    centering: elementScoreSchema.optional(),
    corners: elementScoreSchema.optional(),
    edges: elementScoreSchema.optional(),
    surface: elementScoreSchema.optional(),
  }),
  confidence: z.strictObject({
    score: z.number().finite().min(0).max(1),
    band: z.enum(["low", "medium", "high"]),
    warnings: z.array(safeTextSchema(500)).max(100).optional(),
  }),
  gradeImpactReasons: z.array(gradeImpactReasonSchema).max(100).optional(),
  whyNot10: z.array(whyNot10Schema).max(100).optional(),
  finalGradeComputed: z.literal(true).optional(),
  certifiedClaim: z.literal(false).optional(),
});

const productionReleaseSchema = z.strictObject({
  finalGrade: finalGradeSchema,
  label: z.strictObject({
    certId: safeTextSchema(128),
    labelGradeText: safeTextSchema(64),
    publicReportUrl: aiGraderSafePublishedUrlSchema,
    qrPayloadUrl: aiGraderSafePublishedUrlSchema,
  }),
  publication: z.strictObject({
    publicReportUrl: aiGraderSafePublishedUrlSchema,
  }),
});

const cardIdentitySchema = z.strictObject({
  title: safeTextSchema(300),
  sideCount: z.literal(2),
  cardAssetId: identifierSchema.optional(),
  itemId: identifierSchema.optional(),
  set: safeTextSchema(300).optional(),
  cardNumber: safeTextSchema(128).optional(),
});

const optionalLegacyPublicFields = {
  gradingSessionId: identifierSchema.optional(),
  reportStatus: safeTextSchema(64).optional(),
  finalStatus: safeTextSchema(64).optional(),
  finalGradeComputed: z.boolean().optional(),
  labelGenerated: z.boolean().optional(),
  qrGenerated: z.boolean().optional(),
  certificateGenerated: z.literal(false).optional(),
  warnings: z.array(safeTextSchema(500)).max(100).optional(),
  limitations: z.array(safeTextSchema(500)).max(100).optional(),
};

/**
 * Read-only compatibility for historical V0.1 payloads. V0.1 predates the
 * strict grade contract and is intentionally passthrough so stored reports
 * remain readable; new report production must use a current write schema.
 */
export const aiGraderLegacyReportBundleV01ReadSchema = z
  .object({
    schemaVersion: z.literal(AI_GRADER_REPORT_BUNDLE_V01_VERSION),
    generatedAt: z.string().datetime({ offset: true }),
    reportId: reportIdSchema,
    certifiedClaim: z.literal(false),
  })
  .passthrough();

/** @deprecated Historical V0.1 read compatibility only. */
export const aiGraderReportBundleV01Schema = aiGraderLegacyReportBundleV01ReadSchema;

export const aiGraderReportBundleV02Schema = z
  .strictObject({
    schemaVersion: z.literal(AI_GRADER_REPORT_BUNDLE_V02_VERSION),
    generatedAt: z.string().datetime({ offset: true }),
    reportId: reportIdSchema,
    certifiedClaim: z.literal(false),
    cardIdentity: cardIdentitySchema,
    productionRelease: productionReleaseSchema,
    calibrationProfile: aiGraderCalibrationProfileSchema.optional(),
    defectFindings: z.array(aiGraderPublishedDefectFindingV1Schema).max(AI_GRADER_DEFECT_FINDING_MAX_COUNT),
    assets: z.array(aiGraderPublishedAssetSchema).max(500).optional(),
    publicAssets: z.array(aiGraderPublishedAssetSchema).max(500).optional(),
    geometry: z.record(z.string(), z.unknown()).optional(),
    geometryCaptureDecisions: z.record(z.string(), z.unknown()).optional(),
    captureTiming: z.record(z.string(), z.unknown()).optional(),
    ocrPrefill: z.record(z.string(), z.unknown()).optional(),
    ...optionalLegacyPublicFields,
  })
  .superRefine((bundle, context) => {
    const findingsById = new Map<string, (typeof bundle.defectFindings)[number]>();
    bundle.defectFindings.forEach((finding, index) => {
      const canonicalId = finding.findingId.toLowerCase();
      if (findingsById.has(canonicalId)) {
        context.addIssue({
          code: "custom",
          path: ["defectFindings", index, "findingId"],
          message: "must be unique case-insensitively",
        });
      } else {
        findingsById.set(canonicalId, finding);
      }
    });

    const selectedAssets = bundle.publicAssets ?? bundle.assets ?? [];
    const assetIds = new Set<string>();
    const assetsById = new Map<string, (typeof selectedAssets)[number]>();
    selectedAssets.forEach((asset, index) => {
      const canonicalId = asset.id.toLowerCase();
      if (assetIds.has(canonicalId)) {
        context.addIssue({
          code: "custom",
          path: [bundle.publicAssets !== undefined ? "publicAssets" : "assets", index, "id"],
          message: "must be unique case-insensitively",
        });
      }
      assetIds.add(canonicalId);
      assetsById.set(canonicalId, asset);
    });

    const assetSourcePath = bundle.publicAssets !== undefined ? "publicAssets" : "assets";
    bundle.defectFindings.forEach((finding, findingIndex) => {
      const evidence = finding.evidence;
      const references = [
        ["trueViewAssetId", evidence.trueViewAssetId],
        ["heatmapAssetId", evidence.heatmapAssetId],
        ["maskAssetId", evidence.maskAssetId],
        ...evidence.channelAssetIds.map((assetId, index) => [`channelAssetIds.${index}`, assetId]),
        ...evidence.roiAssetIds.map((assetId, index) => [`roiAssetIds.${index}`, assetId]),
      ] as Array<[string, string | undefined]>;
      references.forEach(([path, assetId]) => {
        if (assetId && !assetIds.has(assetId.toLowerCase())) {
          context.addIssue({
            code: "custom",
            path: ["defectFindings", findingIndex, "evidence", ...path.split(".")],
            message: `must reference an asset in bundle.${assetSourcePath}`,
          });
        }
      });

      const requireEvidenceAsset = (
        path: Array<string | number>,
        assetId: string | undefined,
        evidenceRole: (typeof evidenceRoleSchema)["_output"],
      ) => {
        if (!assetId) return;
        const asset = assetsById.get(assetId.toLowerCase());
        if (!asset) return;
        if (asset.side !== finding.side || asset.evidenceRole !== evidenceRole) {
          context.addIssue({
            code: "custom",
            path: ["defectFindings", findingIndex, "evidence", ...path],
            message: `must reference a ${finding.side} ${evidenceRole} asset`,
          });
        }
      };
      requireEvidenceAsset(["trueViewAssetId"], evidence.trueViewAssetId, "normalized_card");
      requireEvidenceAsset(["heatmapAssetId"], evidence.heatmapAssetId, "surface_heatmap");
      requireEvidenceAsset(["maskAssetId"], evidence.maskAssetId, "confidence_mask");
      evidence.channelAssetIds.forEach((assetId, index) => {
        requireEvidenceAsset(["channelAssetIds", index], assetId, "directional_channel");
      });
      evidence.roiAssetIds.forEach((assetId, index) => {
        requireEvidenceAsset(["roiAssetIds", index], assetId, "roi_crop");
      });

      if (!finding.measurements) return;
      const trueViewAsset = assetsById.get(finding.evidence.trueViewAssetId.toLowerCase());
      if (!trueViewAsset?.widthPx || !trueViewAsset.heightPx) {
        context.addIssue({
          code: "custom",
          path: ["defectFindings", findingIndex, "measurements"],
          message: "physical measurements require normalized true-view pixel dimensions",
        });
      }
      const calibration = bundle.calibrationProfile;
      if (!calibration?.isCalibrated || !calibration.calibrationVersion) {
        context.addIssue({
          code: "custom",
          path: ["defectFindings", findingIndex, "measurements"],
          message: "physical measurements require a finalized, versioned calibration profile",
        });
      } else if (finding.measurements.calibrationVersion !== calibration.calibrationVersion) {
        context.addIssue({
          code: "custom",
          path: ["defectFindings", findingIndex, "measurements", "calibrationVersion"],
          message: "must match calibrationProfile.calibrationVersion",
        });
      }
      if (
        trueViewAsset?.widthPx &&
        trueViewAsset.heightPx &&
        calibration?.isCalibrated &&
        calibration.mmPerPixelX !== undefined &&
        calibration.mmPerPixelY !== undefined
      ) {
        const shape = finding.geometry.shape;
        const bounds = shape.kind === "box"
          ? { width: shape.width, height: shape.height }
          : {
              width: Math.max(...shape.points.map((point) => point.x)) - Math.min(...shape.points.map((point) => point.x)),
              height: Math.max(...shape.points.map((point) => point.y)) - Math.min(...shape.points.map((point) => point.y)),
            };
        const horizontalMm = bounds.width * trueViewAsset.widthPx * calibration.mmPerPixelX;
        const verticalMm = bounds.height * trueViewAsset.heightPx * calibration.mmPerPixelY;
        const roundMeasurement = (value: number) => Math.round(value * 10_000) / 10_000;
        const expected = {
          lengthMm: roundMeasurement(Math.max(horizontalMm, verticalMm)),
          widthMm: roundMeasurement(Math.min(horizontalMm, verticalMm)),
        };
        for (const key of ["lengthMm", "widthMm"] as const) {
          const actual = finding.measurements[key];
          if (actual !== undefined && actual !== expected[key]) {
            context.addIssue({
              code: "custom",
              path: ["defectFindings", findingIndex, "measurements", key],
              message: "must equal the publish-time projection from fraction geometry, normalized image dimensions, and calibration",
            });
          }
        }
      }
    });

    (bundle.productionRelease.finalGrade.gradeImpactReasons ?? []).forEach((reason, reasonIndex) => {
      (reason.findingIds ?? []).forEach((findingId, findingIdIndex) => {
        if (!findingsById.has(findingId.toLowerCase())) {
          context.addIssue({
            code: "custom",
            path: ["productionRelease", "finalGrade", "gradeImpactReasons", reasonIndex, "findingIds", findingIdIndex],
            message: "must reference an existing published findingId",
          });
        }
      });
    });
  });

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectLegacyV02ScoresForStrictValidation(value: unknown): unknown {
  if (!isJsonObject(value) || !isJsonObject(value.productionRelease)) return value;
  const productionRelease = value.productionRelease;
  if (!isJsonObject(productionRelease.finalGrade)) return value;
  const finalGrade = productionRelease.finalGrade;
  const projectScore = (score: unknown) =>
    typeof score === "number" && Number.isFinite(score) && score >= 0 && score < 1 ? 1 : score;
  const elements = isJsonObject(finalGrade.elements)
    ? Object.fromEntries(
        Object.entries(finalGrade.elements).map(([key, element]) => [
          key,
          isJsonObject(element) ? { ...element, score: projectScore(element.score) } : element,
        ]),
      )
    : finalGrade.elements;
  return {
    ...value,
    productionRelease: {
      ...productionRelease,
      finalGrade: {
        ...finalGrade,
        overall: projectScore(finalGrade.overall),
        elements,
      },
    },
  };
}

/**
 * Explicit read-only compatibility for V0.2 reports written before the
 * 1.00 minimum became universal. Validation uses the current structural and
 * security contract while preserving the stored 0.00-0.99 values verbatim.
 */
export const aiGraderLegacyReportBundleV02ReadSchema = z
  .unknown()
  .superRefine((value, context) => {
    if (!aiGraderReportBundleV02Schema.safeParse(projectLegacyV02ScoresForStrictValidation(value)).success) {
      context.addIssue({
        code: "custom",
        message: "must be a structurally valid historical AI Grader report bundle v0.2",
      });
    }
  })
  .transform((value) => value as z.infer<typeof aiGraderReportBundleV02Schema>);

declare const require: (moduleId: string) => {
  aiGraderReportBundleV03Schema: z.ZodType<AiGraderReportBundleV03>;
};

const aiGraderReportBundleV03LazySchema: z.ZodType<AiGraderReportBundleV03> = z.lazy(
  () => require("./aiGraderReportBundlesV03").aiGraderReportBundleV03Schema,
);

export const aiGraderReportBundleSchema = z.union([
  aiGraderReportBundleV01Schema,
  aiGraderReportBundleV02Schema,
  aiGraderReportBundleV03LazySchema,
]);

export const aiGraderReportBundleReadSchema = z.union([
  aiGraderLegacyReportBundleV01ReadSchema,
  aiGraderLegacyReportBundleV02ReadSchema,
  aiGraderReportBundleV03LazySchema,
]);

export type AiGraderPublishedAsset = z.infer<typeof aiGraderPublishedAssetSchema>;
export type AiGraderCalibrationProfile = z.infer<typeof aiGraderCalibrationProfileSchema>;
export type AiGraderReportBundleV01 = z.infer<typeof aiGraderReportBundleV01Schema>;
export type AiGraderReportBundleV02 = z.infer<typeof aiGraderReportBundleV02Schema>;
export type AiGraderReportBundle = AiGraderReportBundleV01 | AiGraderReportBundleV02 | AiGraderReportBundleV03;
