import type {
  AiGraderCaptureProfile,
  AiGraderLiveLightingStatus,
  AiGraderLocalReportHistory,
  AiGraderLocalStationPreviewStatus,
  AiGraderLocalStationStatus,
  AiGraderGradingContract,
  AiGraderMathematicalFindingReviewRequestV1,
  AiGraderMathematicalFindingReviewV1,
  AiGraderMathematicalGradingAuthorityV1,
  AiGraderMathematicalReviewAssetMetadataV1,
  AiGraderStationAction,
} from "./aiGraderLocalStation";
import {
  AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
  AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
  sanitizeAiGraderLocalStationStatusForDisplay,
} from "./aiGraderLocalStation";
import {
  AI_GRADER_WEB_REPORT_BUNDLE_V01_VERSION,
  AI_GRADER_WEB_REPORT_BUNDLE_V02_VERSION,
  type AiGraderStationReportBundle,
} from "./aiGraderReportBundle";
import {
  aiGraderMathematicalReleaseEnvelopeIssue,
  parseAiGraderMathematicalReportV1,
} from "./aiGraderMathematicalReportV1";
import type {
  AiGraderApprovedDesignReferenceOperatorAuthority,
  AiGraderExactDesignReferenceArtifact,
} from "./aiGraderDesignReferenceClient";

export const DEFAULT_AI_GRADER_STATION_BRIDGE_URL = "http://127.0.0.1:47652";
export const AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY = "tenkings.aiGraderStation.bridgeUrl";
export const AI_GRADER_STATION_TOKEN_STORAGE_KEY = "tenkings.aiGraderStation.stationToken";
export const AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_STORAGE_KEY = "tenkings.aiGraderStation.queuedOcrAttemptOwnerId";
export const AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_LOCK_PREFIX = "tenkings.aiGraderStation.queuedOcrAttemptOwner:";

const AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const AI_GRADER_QUEUED_OCR_BROWSER_OWNER_PATTERN = /^ocr-attempt-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type AiGraderQueuedOcrAttemptOwnerLockManager = {
  request(
    name: string,
    options:
      | { mode: "exclusive"; ifAvailable: true }
      | { mode: "exclusive"; signal: AbortSignal },
    callback: (lock: { name: string } | null) => void | Promise<void>,
  ): Promise<void>;
};

export type AiGraderQueuedOcrAttemptOwnerClaim = {
  attemptOwnerId: string;
  reusedPersistedOwner: boolean;
  release(): void;
};

type AiGraderQueuedOcrAttemptOwnerStorage = Pick<Storage, "getItem" | "setItem">;

function queuedOcrAttemptOwnerInitializationError(message: string) {
  return new Error("Queued OCR attempt owner initialization failed: " + message);
}

function queuedOcrAttemptOwnerLockName(attemptOwnerId: string) {
  return AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_LOCK_PREFIX + attemptOwnerId;
}

function createAiGraderQueuedOcrAttemptOwnerId(createUuid: () => string) {
  const attemptOwnerId = "ocr-attempt-" + createUuid().toLowerCase();
  if (!AI_GRADER_QUEUED_OCR_BROWSER_OWNER_PATTERN.test(attemptOwnerId)) {
    throw queuedOcrAttemptOwnerInitializationError("the browser could not create a safe owner UUID.");
  }
  return attemptOwnerId;
}

function tryAcquireAiGraderQueuedOcrAttemptOwnerLock(
  lockManager: AiGraderQueuedOcrAttemptOwnerLockManager,
  attemptOwnerId: string,
): Promise<Omit<AiGraderQueuedOcrAttemptOwnerClaim, "reusedPersistedOwner"> | null> {
  const lockName = queuedOcrAttemptOwnerLockName(attemptOwnerId);
  let releaseHeldLock: (() => void) | null = null;
  const holdUntilRelease = new Promise<void>((resolve) => {
    releaseHeldLock = resolve;
  });
  return new Promise((resolve, reject) => {
    let acquisitionSettled = false;
    let requestPromise: Promise<void>;
    try {
      requestPromise = Promise.resolve(lockManager.request(
        lockName,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) {
            if (!acquisitionSettled) {
              acquisitionSettled = true;
              resolve(null);
            }
            return;
          }
          if (lock.name !== lockName) {
            if (!acquisitionSettled) {
              acquisitionSettled = true;
              reject(new Error("the Web Lock manager returned a mismatched owner lock"));
            }
            return;
          }
          let released = false;
          const claim = {
            attemptOwnerId,
            release() {
              if (released) return;
              released = true;
              releaseHeldLock?.();
            },
          };
          if (!acquisitionSettled) {
            acquisitionSettled = true;
            resolve(claim);
          }
          await holdUntilRelease;
        },
      ));
    } catch (error) {
      acquisitionSettled = true;
      reject(error);
      return;
    }
    void requestPromise.then(
      () => {
        if (!acquisitionSettled) {
          acquisitionSettled = true;
          reject(new Error("the Web Lock manager completed without an owner-lock decision"));
        }
      },
      (error) => {
        if (!acquisitionSettled) {
          acquisitionSettled = true;
          reject(error);
        }
      },
    );
  });
}

export async function initializeAiGraderQueuedOcrAttemptOwner(input: {
  lockManager?: AiGraderQueuedOcrAttemptOwnerLockManager;
  storage?: AiGraderQueuedOcrAttemptOwnerStorage;
  navigationType?: string;
  createUuid?: () => string;
} = {}): Promise<AiGraderQueuedOcrAttemptOwnerClaim> {
  try {
    const browserWindow = typeof window === "undefined" ? undefined : window;
    const browserLockManager = browserWindow?.navigator?.locks as unknown as
      AiGraderQueuedOcrAttemptOwnerLockManager | undefined;
    const lockManager = input.lockManager ?? browserLockManager;
    if (!lockManager || typeof lockManager.request !== "function") {
      throw queuedOcrAttemptOwnerInitializationError(
        "the origin-scoped Web Locks API is unavailable; OCR will not be claimed.",
      );
    }
    const storage = input.storage ?? browserWindow?.sessionStorage;
    if (!storage) {
      throw queuedOcrAttemptOwnerInitializationError(
        "browser sessionStorage is unavailable; OCR will not be claimed.",
      );
    }
    const persistedAttemptOwnerId = storage.getItem(AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_STORAGE_KEY);
    if (
      typeof persistedAttemptOwnerId === "string" &&
      AI_GRADER_QUEUED_OCR_BROWSER_OWNER_PATTERN.test(persistedAttemptOwnerId)
    ) {
      const persistedClaim = await tryAcquireAiGraderQueuedOcrAttemptOwnerLock(
        lockManager,
        persistedAttemptOwnerId,
      );
      if (persistedClaim) {
        return { ...persistedClaim, reusedPersistedOwner: true };
      }
    }

    const createUuid = input.createUuid ?? (() => {
      if (typeof browserWindow?.crypto?.randomUUID !== "function") {
        throw queuedOcrAttemptOwnerInitializationError(
          "browser crypto.randomUUID is unavailable; OCR will not be claimed.",
        );
      }
      return browserWindow.crypto.randomUUID();
    });
    const attemptOwnerId = createAiGraderQueuedOcrAttemptOwnerId(createUuid);
    const generatedClaim = await tryAcquireAiGraderQueuedOcrAttemptOwnerLock(lockManager, attemptOwnerId);
    if (!generatedClaim) {
      throw queuedOcrAttemptOwnerInitializationError(
        "the fresh owner UUID lock is already held; OCR will not be claimed.",
      );
    }
    try {
      storage.setItem(AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_STORAGE_KEY, attemptOwnerId);
    } catch (error) {
      generatedClaim.release();
      throw error;
    }
    return { ...generatedClaim, reusedPersistedOwner: false };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Queued OCR attempt owner initialization failed:")
    ) {
      throw error;
    }
    const message = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "the browser owner claim could not be initialized";
    throw queuedOcrAttemptOwnerInitializationError(message + "; OCR will not be claimed.");
  }
}

export async function waitForAiGraderQueuedOcrAttemptOwnerLock(input: {
  attemptOwnerId: string;
  signal: AbortSignal;
  lockManager?: AiGraderQueuedOcrAttemptOwnerLockManager;
}): Promise<Omit<AiGraderQueuedOcrAttemptOwnerClaim, "reusedPersistedOwner">> {
  if (!AI_GRADER_QUEUED_OCR_BROWSER_OWNER_PATTERN.test(input.attemptOwnerId)) {
    throw new Error(
      "Queued OCR orphan recovery failed: the persisted attempt owner is invalid; no terminal failure was written.",
    );
  }
  const browserWindow = typeof window === "undefined" ? undefined : window;
  const browserLockManager = browserWindow?.navigator?.locks as unknown as
    AiGraderQueuedOcrAttemptOwnerLockManager | undefined;
  const lockManager = input.lockManager ?? browserLockManager;
  if (!lockManager || typeof lockManager.request !== "function") {
    throw new Error(
      "Queued OCR orphan recovery failed: the origin-scoped Web Locks API is unavailable; no terminal failure was written.",
    );
  }
  try {
    const lockName = queuedOcrAttemptOwnerLockName(input.attemptOwnerId);
    let releaseHeldLock: (() => void) | null = null;
    const holdUntilRelease = new Promise<void>((resolve) => {
      releaseHeldLock = resolve;
    });
    return await new Promise((resolve, reject) => {
      let acquisitionSettled = false;
      let requestPromise: Promise<void>;
      try {
        requestPromise = Promise.resolve(lockManager.request(
          lockName,
          { mode: "exclusive", signal: input.signal },
          async (lock) => {
            if (!lock || lock.name !== lockName) {
              if (!acquisitionSettled) {
                acquisitionSettled = true;
                reject(new Error("the Web Lock manager returned a mismatched owner lock"));
              }
              return;
            }
            let released = false;
            const release = () => {
              if (released) return;
              released = true;
              input.signal.removeEventListener("abort", release);
              releaseHeldLock?.();
            };
            input.signal.addEventListener("abort", release, { once: true });
            if (input.signal.aborted) release();
            if (!acquisitionSettled) {
              acquisitionSettled = true;
              resolve({
                attemptOwnerId: input.attemptOwnerId,
                release,
              });
            }
            await holdUntilRelease;
          },
        ));
      } catch (error) {
        acquisitionSettled = true;
        reject(error);
        return;
      }
      void requestPromise.then(
        () => {
          if (!acquisitionSettled) {
            acquisitionSettled = true;
            reject(new Error("the Web Lock waiter completed without acquiring the owner lock"));
          }
        },
        (error) => {
          if (!acquisitionSettled) {
            acquisitionSettled = true;
            reject(error);
          }
        },
      );
    });
  } catch (error) {
    if (input.signal.aborted) throw error;
    const message = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "the exact owner lock could not be acquired";
    throw new Error(
      "Queued OCR orphan recovery failed: " + message + "; no terminal failure was written.",
    );
  }
}

function strictStationReportBundle(value: unknown): AiGraderStationReportBundle {
  const schemaVersion = value && typeof value === "object"
    ? (value as { schemaVersion?: unknown }).schemaVersion
    : undefined;
  if (schemaVersion === "ai-grader-report-bundle-v0.3") {
    const parsed = parseAiGraderMathematicalReportV1(value);
    if (!parsed) {
      throw new Error("The Dell returned a malformed Mathematical Grading V1 report. V0 fallback is prohibited; re-export the calibrated report after updating the helper.");
    }
    return parsed;
  }
  if (schemaVersion !== AI_GRADER_WEB_REPORT_BUNDLE_V01_VERSION && schemaVersion !== AI_GRADER_WEB_REPORT_BUNDLE_V02_VERSION) {
    throw new Error("The Dell returned an unsupported AI Grader report schema version.");
  }
  return value as AiGraderStationReportBundle;
}

function validateStationStatusReport(status: AiGraderLocalStationStatus): AiGraderLocalStationStatus {
  if (!status.reportBundle) return status;
  const reportBundle = strictStationReportBundle(status.reportBundle);
  if (reportBundle.schemaVersion === "ai-grader-report-bundle-v0.3" && status.productionRelease) {
    const issue = aiGraderMathematicalReleaseEnvelopeIssue(reportBundle, status.productionRelease);
    if (issue) throw new Error(`${issue} The station will not mix V0 workflow metadata with Mathematical Grading V1.`);
  }
  return { ...status, reportBundle };
}

export type AiGraderStationBridgeCallInput = {
  baseUrl: string;
  stationToken: string;
  action: AiGraderStationAction;
  body?: AiGraderStationBridgeActionRequestBody | Record<string, unknown>;
};

export type AiGraderStationBridgeActionRequestBody = {
  reportId?: string;
  operatorId?: string;
  warningsAccepted?: boolean;
  overrideReason?: string;
  captureProfile?: AiGraderCaptureProfile;
  captureTriggerAt?: string;
  captureTriggerMode?: "operator";
  geometryCaptureMode?: "detected_geometry";
  idempotencyKey?: string;
  expectedSessionId?: string;
  expectedReportId?: string;
  expectedSide?: "front" | "back";
  expectedSideEpoch?: string;
  expectedFrameId?: string;
  queueItemId?: string;
  gradingContract?: AiGraderGradingContract;
  mathematicalGradingAuthority?: AiGraderMathematicalGradingAuthorityV1;
  mathematicalReviewRequestSha256?: string;
  mathematicalFindingReviews?: AiGraderMathematicalFindingReviewV1[];
  gradingSessionId?: string;
  attemptOwnerId?: string;
  result?: Record<string, unknown>;
  failure?: {
    code: string;
    message: string;
  };
  publication?: {
    queueItemId: string;
    gradingSessionId: string;
    reportId: string;
    publicationStatus: "published";
    publishedAt: string;
  };
};

export function buildAiGraderCaptureProfileRequest(
  captureProfile: AiGraderCaptureProfile,
  gradingContract?: AiGraderGradingContract,
  mathematicalGradingAuthority?: AiGraderMathematicalGradingAuthorityV1,
) {
  if (gradingContract !== "mathematical_calibration_v1") {
    throw new Error(
      "Start New Card requires the explicit Mathematical Calibration V1 contract; Legacy V0 and omitted contracts are prohibited.",
    );
  }
  if (!mathematicalGradingAuthority) {
    throw new Error("Mathematical V1 Start New Card requires exact card and centering authority.");
  }
  return {
    captureProfile,
    gradingContract,
    mathematicalGradingAuthority,
  } satisfies AiGraderStationBridgeActionRequestBody;
}

export type AiGraderMathematicalCardIdentityDraftV1 = {
  title: string;
  tenantId: string;
  setId: string;
  programId: string;
  cardNumber: string;
  variantId: string | null;
  parallelId: string | null;
};

export type AiGraderMathematicalCenteringProfileV1 =
  | "printed_border_v1"
  | "registered_design_template_v1";

export type AiGraderPreparedRegisteredDesignReferenceV1 = {
  operatorAuthority: AiGraderApprovedDesignReferenceOperatorAuthority;
  artifact: AiGraderExactDesignReferenceArtifact;
};

function exactMathematicalIdentityField(value: string, label: string, maxLength = 191): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/ -]*$/.test(normalized)) {
    throw new Error("Mathematical V1 " + label + " is invalid.");
  }
  return normalized;
}

function exactMathematicalTitle(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 300 ||
      /[a-z]:[\\/]|(?:token|secret|bearer|authorization|presign|x-amz)/i.test(normalized)) {
    throw new Error("Mathematical V1 card title is invalid.");
  }
  return normalized;
}

function exactNullableMathematicalIdentityField(
  value: string | null,
  label: string,
): string | null {
  return value === null ? null : exactMathematicalIdentityField(value, label);
}

function registeredMathematicalCenteringAuthority(input: {
  side: "front" | "back";
  identity: AiGraderMathematicalGradingAuthorityV1["cardIdentity"];
  prepared: AiGraderPreparedRegisteredDesignReferenceV1 | undefined;
}): Extract<
  AiGraderMathematicalGradingAuthorityV1["sides"]["front"]["centering"],
  { profile: "registered_design_template_v1" }
> {
  if (!input.prepared) {
    throw new Error("Mathematical V1 " + input.side + " requires one exact active approved design reference.");
  }
  const authority = input.prepared.operatorAuthority;
  const reference = authority.mathematicalReference;
  const artifact = input.prepared.artifact;
  if (
    reference.tenantId !== input.identity.tenantId ||
    reference.setId !== input.identity.setId ||
    reference.programId !== input.identity.programId ||
    reference.cardNumber !== input.identity.cardNumber ||
    reference.variantId !== input.identity.variantId ||
    reference.parallelId !== input.identity.parallelId ||
    reference.side !== input.side ||
    reference.profile !== "registered_design_template_v1" ||
    authority.databaseReferenceId !== reference.designReferenceId ||
    artifact.referenceId !== authority.databaseReferenceId ||
    artifact.sha256 !== reference.artifactSha256 ||
    artifact.mimeType !== authority.artifactMimeType
  ) {
    throw new Error("The exact approved " + input.side + " design reference does not match this card authority.");
  }
  const extension = artifact.mimeType === "image/png" ? "png" : "jpg";
  const safeArtifactStem = reference.artifactId.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 180);
  const fileName = input.side + "-" + (safeArtifactStem || "approved-design-reference") + "." + extension;
  return {
    profile: "registered_design_template_v1",
    approvedReference: {
      tenantId: reference.tenantId,
      setId: reference.setId,
      programId: reference.programId,
      cardNumber: reference.cardNumber,
      variantId: reference.variantId,
      parallelId: reference.parallelId,
      referenceId: authority.databaseReferenceId,
      profile: "registered_design_template_v1",
      status: "approved",
      side: input.side,
      version: reference.version,
      artifactSha256: reference.artifactSha256,
      artifactWidthPx: reference.widthPx,
      artifactHeightPx: reference.heightPx,
      intendedDesignBoundary: {
        schemaVersion: "ai-grader-intended-design-boundary-v1",
        coordinateFrame: "design_reference_pixels",
        contour: authority.intendedDesignBoundaryPixels.contour.map((point) => [point[0], point[1]]),
      },
      approvedByUserId: reference.approvedBy,
      approvedAt: reference.approvedAt,
    },
    approvedDesignArtifact: {
      assetId: reference.artifactId,
      fileName,
      contentType: artifact.mimeType,
      sha256: artifact.sha256,
    },
  };
}

export function buildAiGraderMathematicalGradingAuthorityV1(input: {
  identity: AiGraderMathematicalCardIdentityDraftV1;
  profiles: Record<"front" | "back", AiGraderMathematicalCenteringProfileV1>;
  registeredDesignReferences?: Partial<Record<"front" | "back", AiGraderPreparedRegisteredDesignReferenceV1>>;
}): AiGraderMathematicalGradingAuthorityV1 {
  const cardIdentity: AiGraderMathematicalGradingAuthorityV1["cardIdentity"] = {
    title: exactMathematicalTitle(input.identity.title),
    sideCount: 2,
    tenantId: exactMathematicalIdentityField(input.identity.tenantId, "tenant ID"),
    setId: exactMathematicalIdentityField(input.identity.setId, "set ID"),
    programId: exactMathematicalIdentityField(input.identity.programId, "program ID"),
    cardNumber: exactMathematicalIdentityField(input.identity.cardNumber, "card number", 128),
    variantId: exactNullableMathematicalIdentityField(input.identity.variantId, "variant ID"),
    parallelId: exactNullableMathematicalIdentityField(input.identity.parallelId, "parallel ID"),
  };
  const centeringFor = (side: "front" | "back") =>
    input.profiles[side] === "printed_border_v1"
      ? { profile: "printed_border_v1" as const }
      : registeredMathematicalCenteringAuthority({
          side,
          identity: cardIdentity,
          prepared: input.registeredDesignReferences?.[side],
        });
  return {
    schemaVersion: "fixed_rig_mathematical_station_grading_authority_v1",
    cardIdentity,
    cardFormatId: "standard_trading_card_63_50x88_90_r3_18_v1",
    sides: {
      front: { centering: centeringFor("front") },
      back: { centering: centeringFor("back") },
    },
  };
}

export function buildAiGraderMathematicalAuthorityBindingRequest(
  mathematicalGradingAuthority: AiGraderMathematicalGradingAuthorityV1,
) {
  return { mathematicalGradingAuthority } satisfies AiGraderStationBridgeActionRequestBody;
}

export function buildAiGraderMathematicalFindingReviewSubmission(input: {
  request: AiGraderMathematicalFindingReviewRequestV1;
  dispositions: Record<string, "confirmed" | "adjusted" | undefined>;
  reviewedAt?: string;
  operatorId?: string;
  warningsAccepted?: boolean;
  overrideReason?: string;
}) {
  const reviewedAt = input.reviewedAt
    ? new Date(input.reviewedAt).toISOString()
    : new Date().toISOString();
  if (!Number.isFinite(Date.parse(reviewedAt))) {
    throw new Error("Mathematical finding review timestamp is invalid.");
  }
  const expectedIds = new Set(input.request.findings.map((finding) => finding.findingId));
  const suppliedIds = Object.entries(input.dispositions)
    .filter((entry): entry is [string, "confirmed" | "adjusted"] =>
      entry[1] === "confirmed" || entry[1] === "adjusted")
    .map(([findingId]) => findingId);
  if (suppliedIds.some((findingId) => !expectedIds.has(findingId)) ||
      suppliedIds.length !== expectedIds.size ||
      new Set(suppliedIds).size !== suppliedIds.length) {
    throw new Error("Every exact Mathematical finding requires one confirmed or adjusted disposition.");
  }
  const mathematicalFindingReviews = input.request.findings.map((finding): AiGraderMathematicalFindingReviewV1 => {
    const status = input.dispositions[finding.findingId];
    if (status !== "confirmed" && status !== "adjusted") {
      throw new Error("Finding " + finding.findingId + " has no exact operator disposition.");
    }
    return {
      findingId: finding.findingId,
      reviewRequestSha256: input.request.artifactSha256,
      status,
      reviewedAt,
    };
  });
  return {
    mathematicalReviewRequestSha256: input.request.artifactSha256,
    mathematicalFindingReviews,
    ...(input.operatorId ? { operatorId: input.operatorId } : {}),
    ...(typeof input.warningsAccepted === "boolean" ? { warningsAccepted: input.warningsAccepted } : {}),
    ...(input.overrideReason ? { overrideReason: input.overrideReason } : {}),
  } satisfies AiGraderStationBridgeActionRequestBody;
}

export function buildAiGraderDetectedGeometryCaptureRequest(input: {
  captureTriggerAt: string;
  captureTriggerMode: "operator";
}) {
  return {
    ...input,
    geometryCaptureMode: "detected_geometry" as const,
  } satisfies AiGraderStationBridgeActionRequestBody;
}

function exactRapidQueueIdentity(input: {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
}) {
  const normalized = {
    queueItemId: input.queueItemId.trim(),
    gradingSessionId: input.gradingSessionId.trim(),
    reportId: input.reportId.trim(),
  };
  for (const [label, value] of Object.entries(normalized)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value)) {
      throw new Error("Rapid Capture " + label + " is invalid.");
    }
  }
  return normalized;
}

function exactQueuedOcrAttemptOwnerId(value: string) {
  if (typeof value !== "string" || !AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_PATTERN.test(value)) {
    throw new Error("Queued OCR attemptOwnerId is invalid.");
  }
  return value;
}

export function buildAiGraderRapidQueueActivationRequest(input: {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
}) {
  return exactRapidQueueIdentity(input) satisfies AiGraderStationBridgeActionRequestBody;
}

export function buildAiGraderQueuedOcrClaimRequest(input: {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  attemptOwnerId: string;
}) {
  return {
    ...exactRapidQueueIdentity(input),
    attemptOwnerId: exactQueuedOcrAttemptOwnerId(input.attemptOwnerId),
  } satisfies AiGraderStationBridgeActionRequestBody;
}

export function buildAiGraderQueuedOcrCompletionRequest(input: {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  attemptOwnerId: string;
  result: unknown;
}) {
  const identity = exactRapidQueueIdentity(input);
  if (!input.result || typeof input.result !== "object" || Array.isArray(input.result)) {
    throw new Error("Queued OCR completion result is invalid.");
  }
  const result = input.result as Record<string, unknown>;
  if (result.queueItemId !== identity.queueItemId ||
      result.gradingSessionId !== identity.gradingSessionId ||
      result.reportId !== identity.reportId) {
    throw new Error("Queued OCR completion result identity is invalid.");
  }
  return {
    ...identity,
    attemptOwnerId: exactQueuedOcrAttemptOwnerId(input.attemptOwnerId),
    result,
  } satisfies AiGraderStationBridgeActionRequestBody;
}

const AI_GRADER_QUEUED_OCR_FAILURE_CODES = new Set([
  "AI_GRADER_OCR_GOOGLE_CONFIG_MISSING",
  "AI_GRADER_OCR_GOOGLE_PROVIDER_FAILED",
  "AI_GRADER_OCR_GOOGLE_FRONT_FAILED",
  "AI_GRADER_OCR_GOOGLE_BACK_FAILED",
  "AI_GRADER_OCR_OPENAI_CONFIG_MISSING",
  "AI_GRADER_OCR_OPENAI_TIMEOUT",
  "AI_GRADER_OCR_OPENAI_NETWORK",
  "AI_GRADER_OCR_OPENAI_NON_2XX",
  "AI_GRADER_OCR_OPENAI_REFUSAL",
  "AI_GRADER_OCR_OPENAI_SCHEMA_FAILED",
  "AI_GRADER_OCR_CATALOG_FAILED",
  "AI_GRADER_OCR_INTERNAL_FAILED",
  "AI_GRADER_OCR_NORMALIZED_EVIDENCE_MISSING",
  "AI_GRADER_OCR_NORMALIZED_EVIDENCE_INVALID",
  "AI_GRADER_OCR_IDENTITY_MISMATCH",
  "AI_GRADER_OCR_INTERRUPTED",
]);

export function buildAiGraderQueuedOcrFailureRequest(input: {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  attemptOwnerId: string;
  failure: { code: string; message: string };
}) {
  const identity = exactRapidQueueIdentity(input);
  const code = input.failure.code.trim();
  const message = input.failure.message.trim();
  if (!AI_GRADER_QUEUED_OCR_FAILURE_CODES.has(code) || !message || message.length > 500) {
    throw new Error("Queued OCR terminal failure evidence is invalid.");
  }
  return {
    ...identity,
    attemptOwnerId: exactQueuedOcrAttemptOwnerId(input.attemptOwnerId),
    failure: { code, message },
  } satisfies AiGraderStationBridgeActionRequestBody;
}

export function buildAiGraderRapidPublicationEvidence(input: {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  publishedAt: string;
}) {
  const identity = exactRapidQueueIdentity(input);
  if (!Number.isFinite(Date.parse(input.publishedAt)) || new Date(input.publishedAt).toISOString() !== input.publishedAt) {
    throw new Error("Rapid Capture publication timestamp is invalid.");
  }
  return {
    ...identity,
    publication: {
      ...identity,
      publicationStatus: "published" as const,
      publishedAt: input.publishedAt,
    },
  } satisfies AiGraderStationBridgeActionRequestBody;
}

const AI_GRADER_MATHEMATICAL_BINARY_MAX_BYTES = 64 * 1024 * 1024;

function exactBridgeIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(normalized)) {
    throw new Error(label + " is invalid.");
  }
  return normalized;
}

async function bridgeFailure(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => ({})) as {
    message?: unknown;
    error?: { message?: unknown };
  };
  const message = typeof payload.message === "string" && payload.message.trim()
    ? payload.message.trim()
    : typeof payload.error?.message === "string" && payload.error.message.trim()
      ? payload.error.message.trim()
      : fallback;
  return new Error(message);
}

async function browserSha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Browser SHA-256 verification is unavailable.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export type AiGraderStagedMathematicalDesignReferenceV1 = {
  side: "front" | "back";
  referenceId: string;
  assetId: string;
  sha256: string;
  byteSize: number;
  contentType: "image/png" | "image/jpeg";
  stagedAt: string;
  createNew: true;
};

export async function stageAiGraderMathematicalDesignReference(input: {
  baseUrl: string;
  stationToken: string;
  sessionId: string;
  side: "front" | "back";
  authority: AiGraderMathematicalGradingAuthorityV1;
  artifact: AiGraderExactDesignReferenceArtifact;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderStagedMathematicalDesignReferenceV1> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) throw new Error("AI Grader station bridge token is required.");
  const sessionId = exactBridgeIdentifier(input.sessionId, "Mathematical V1 session ID");
  const centering = input.authority.sides[input.side].centering;
  if (centering.profile !== "registered_design_template_v1") {
    throw new Error("Only a registered-template side may stage exact design-reference bytes.");
  }
  if (
    input.artifact.referenceId !== centering.approvedReference.referenceId ||
    input.artifact.sha256 !== centering.approvedDesignArtifact.sha256 ||
    input.artifact.mimeType !== centering.approvedDesignArtifact.contentType ||
    input.artifact.bytes.byteLength < 24 ||
    input.artifact.bytes.byteLength > AI_GRADER_MATHEMATICAL_BINARY_MAX_BYTES
  ) {
    throw new Error("The staged design-reference bytes do not match the exact session authority.");
  }
  const body = input.artifact.bytes.slice().buffer as ArrayBuffer;
  const response = await fetchImpl(
    baseUrl + "/mathematical-v1/design-reference-artifacts/" + input.side,
    {
      method: "POST",
      headers: {
        "content-type": input.artifact.mimeType,
        "x-ai-grader-station-token": input.stationToken,
        "x-ai-grader-session-id": sessionId,
        "x-ai-grader-side": input.side,
        "x-ai-grader-reference-id": centering.approvedReference.referenceId,
        "x-ai-grader-sha256": input.artifact.sha256,
      },
      body,
    },
  );
  if (!response.ok) {
    throw await bridgeFailure(response, "The exact Mathematical V1 design reference could not be staged.");
  }
  const payload = await response.json().catch(() => ({})) as {
    ok?: unknown;
    result?: Record<string, unknown>;
  };
  const result = payload.result;
  if (
    payload.ok !== true ||
    !result ||
    result.side !== input.side ||
    result.referenceId !== centering.approvedReference.referenceId ||
    result.assetId !== centering.approvedDesignArtifact.assetId ||
    result.sha256 !== input.artifact.sha256 ||
    result.byteSize !== input.artifact.bytes.byteLength ||
    result.contentType !== input.artifact.mimeType ||
    typeof result.stagedAt !== "string" ||
    !Number.isFinite(Date.parse(result.stagedAt)) ||
    result.createNew !== true
  ) {
    throw new Error("The design-reference staging response did not preserve its exact authority.");
  }
  return {
    side: input.side,
    referenceId: centering.approvedReference.referenceId,
    assetId: centering.approvedDesignArtifact.assetId,
    sha256: input.artifact.sha256,
    byteSize: input.artifact.bytes.byteLength,
    contentType: input.artifact.mimeType,
    stagedAt: new Date(result.stagedAt).toISOString(),
    createNew: true,
  };
}

export type AiGraderMathematicalReviewAssetRequirementV1 = {
  side: "front" | "back";
  metadata: AiGraderMathematicalReviewAssetMetadataV1;
};

export function aiGraderMathematicalReviewAssetKey(
  requirement: AiGraderMathematicalReviewAssetRequirementV1,
): string {
  return requirement.side + ":" + requirement.metadata.assetId + ":" + requirement.metadata.sha256;
}

export function collectAiGraderMathematicalReviewAssets(
  request: AiGraderMathematicalFindingReviewRequestV1,
): AiGraderMathematicalReviewAssetRequirementV1[] {
  const assets = new Map<string, AiGraderMathematicalReviewAssetRequirementV1>();
  for (const finding of request.findings) {
    const metadata = [
      finding.trueView,
      ...finding.directionalChannels,
      finding.reviewEvidence.roi,
      finding.reviewEvidence.segmentationMask,
      finding.reviewEvidence.confidenceMask,
      finding.reviewEvidence.illuminationMask,
    ];
    for (const entry of metadata) {
      const requirement = { side: finding.side, metadata: entry };
      const identity = finding.side + ":" + entry.assetId;
      const existing = assets.get(identity);
      if (existing && aiGraderMathematicalReviewAssetKey(existing) !== aiGraderMathematicalReviewAssetKey(requirement)) {
        throw new Error("Mathematical review asset identity " + identity + " has conflicting immutable metadata.");
      }
      assets.set(identity, requirement);
    }
  }
  return [...assets.values()];
}

export type AiGraderFetchedMathematicalReviewAssetV1 = {
  side: "front" | "back";
  metadata: AiGraderMathematicalReviewAssetMetadataV1;
  blob: Blob;
};

export async function fetchAiGraderMathematicalReviewAsset(input: {
  baseUrl: string;
  stationToken: string;
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  requirement: AiGraderMathematicalReviewAssetRequirementV1;
  signal?: AbortSignal;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderFetchedMathematicalReviewAssetV1> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) throw new Error("AI Grader station bridge token is required.");
  const identity = exactRapidQueueIdentity(input);
  const metadata = input.requirement.metadata;
  const response = await fetchImpl(
    baseUrl + "/mathematical-v1/review-assets?queueItemId=" + encodeURIComponent(identity.queueItemId) +
      "&gradingSessionId=" + encodeURIComponent(identity.gradingSessionId) +
      "&reportId=" + encodeURIComponent(identity.reportId) +
      "&assetId=" + encodeURIComponent(metadata.assetId),
    {
      method: "GET",
      headers: { "x-ai-grader-station-token": input.stationToken },
      signal: input.signal,
    },
  );
  if (!response.ok) {
    throw await bridgeFailure(response, "The exact Mathematical V1 review asset could not be read.");
  }
  const contentLength = Number(response.headers.get("content-length"));
  const widthPx = Number(response.headers.get("x-ai-grader-width-px"));
  const heightPx = Number(response.headers.get("x-ai-grader-height-px"));
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength !== metadata.byteSize ||
    contentLength <= 0 ||
    contentLength > AI_GRADER_MATHEMATICAL_BINARY_MAX_BYTES ||
    response.headers.get("content-type") !== metadata.contentType ||
    response.headers.get("x-ai-grader-asset-id") !== metadata.assetId ||
    response.headers.get("x-ai-grader-sha256") !== metadata.sha256 ||
    response.headers.get("x-ai-grader-queue-item-id") !== identity.queueItemId ||
    response.headers.get("x-ai-grader-grading-session-id") !== identity.gradingSessionId ||
    response.headers.get("x-ai-grader-report-id") !== identity.reportId ||
    response.headers.get("x-ai-grader-side") !== input.requirement.side ||
    response.headers.get("x-ai-grader-evidence-role") !== metadata.evidenceRole ||
    widthPx !== metadata.widthPx ||
    heightPx !== metadata.heightPx
  ) {
    throw new Error("The Mathematical review asset response headers do not match the exact pending request.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== metadata.byteSize || await browserSha256Hex(bytes) !== metadata.sha256) {
    throw new Error("The Mathematical review asset body does not match its exact SHA-256 and byte authority.");
  }
  return {
    side: input.requirement.side,
    metadata,
    blob: new Blob([bytes], { type: metadata.contentType }),
  };
}

export type AiGraderStationBridgeHealth = {
  ok: boolean;
  bridgeVersion: string;
  reportProducerContractVersion: string;
  mode: "mock" | "real";
  localOnly: true;
  tokenRequired: true;
  pairingAvailable?: boolean;
  pairingCodeExpiresAt?: string;
  hardwareActionsEnabled: boolean;
  allowedOrigins: string[];
};

export type AiGraderStationBridgePairingResult = {
  bridgeUrl: string;
  stationToken: string;
  localOnly: true;
  tokenStorage: "browser_localStorage_only";
  hardwareActionsEnabled: boolean;
};

export type AiGraderStationPreviewFrame = {
  blob: Blob;
  contentType: string;
  byteLength: number;
  frameIndex?: number;
  capturedAt?: string;
  sessionId?: string;
  side?: "front" | "back";
  sideEpoch?: string;
  frameId?: string;
};

export type AiGraderStationPreviewStreamState = {
  statusCode: 409;
  code?: string;
  message: string;
  previewStatus?: AiGraderLocalStationPreviewStatus;
};

export type AiGraderStationPreviewStreamResult = {
  kind: "eof" | "abort" | "authoritative_state";
};

export type AiGraderStationPreviewStreamHandlers = {
  signal?: AbortSignal;
  onOpen?: (contentType: string) => void;
  onFrame?: (frame: AiGraderStationPreviewFrame) => void;
  onEof?: () => void;
  onAbort?: () => void;
  onState?: (state: AiGraderStationPreviewStreamState) => void;
  onError?: (error: Error) => void;
};

export function normalizeAiGraderStationBridgeUrl(input: string) {
  const trimmed = input.trim() || DEFAULT_AI_GRADER_STATION_BRIDGE_URL;
  const url = new URL(trimmed);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "http:") {
    throw new Error("AI Grader station bridge URL must use http:// loopback.");
  }
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]") {
    throw new Error("AI Grader station bridge URL must point to localhost or 127.0.0.1.");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function actionPath(action: AiGraderStationAction) {
  if (action === "status") return "/status";
  if (action === "latest-report") return "/latest-report";
  if (action === "session-manifest") return "/session-manifest";
  return `/actions/${encodeURIComponent(action)}`;
}

export async function fetchAiGraderStationBridgeHealth(
  input: { baseUrl: string },
  fetchImpl: typeof fetch = fetch
): Promise<AiGraderStationBridgeHealth> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  const response = await fetchImpl(`${baseUrl}/health`, { method: "GET" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? payload.error?.message ?? "AI Grader local station bridge health check failed.");
  }
  if (payload.bridgeVersion !== AI_GRADER_LOCAL_STATION_BRIDGE_VERSION) {
    const runningVersion = typeof payload.bridgeVersion === "string" && payload.bridgeVersion.trim()
      ? payload.bridgeVersion.trim()
      : "unknown";
    throw new Error(
      `Dell local bridge update/restart required. Atomic Front Capture expects ${AI_GRADER_LOCAL_STATION_BRIDGE_VERSION}; the running bridge is ${runningVersion}. Stop before hardware, perform the documented Dell helper maintenance update, preserve its protected local configuration, and restart it through the existing Ten Kings AI Grader Station Startup shortcut.`,
    );
  }
  if (payload.reportProducerContractVersion !== AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION) {
    throw new Error(
      `Dell report producer update/restart required. Launch the Ten Kings AI Grader Station desktop shortcut, then re-export the existing report. No hardware recapture is required.`,
    );
  }
  if (payload.mode !== "real" || payload.hardwareActionsEnabled !== true) {
    throw new Error("The production AI Grader station requires the real paired Dell helper. Contract or mock preview cannot operate the capture road.");
  }
  return payload as AiGraderStationBridgeHealth;
}

export async function pairAiGraderStationBridge(
  input: { baseUrl: string; pairingCode: string },
  fetchImpl: typeof fetch = fetch
): Promise<AiGraderStationBridgePairingResult> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  const pairingCode = input.pairingCode.trim();
  if (!pairingCode) {
    throw new Error("AI Grader station bridge pairing code is required.");
  }
  const response = await fetchImpl(`${baseUrl}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingCode }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? payload.error?.message ?? "AI Grader local station bridge pairing failed.");
  }
  const result = payload.result as AiGraderStationBridgePairingResult | undefined;
  if (!result?.stationToken?.trim()) {
    throw new Error("AI Grader local station bridge pairing did not return a usable local token.");
  }
  return result;
}

export async function callAiGraderStationBridge(
  input: AiGraderStationBridgeCallInput,
  fetchImpl: typeof fetch = fetch
): Promise<AiGraderLocalStationStatus> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) {
    throw new Error("AI Grader station bridge token is required.");
  }
  const method = input.action === "status" || input.action === "latest-report" || input.action === "session-manifest" ? "GET" : "POST";
  const response = await fetchImpl(`${baseUrl}${actionPath(input.action)}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-ai-grader-station-token": input.stationToken,
    },
    body: method === "POST" ? JSON.stringify(input.body ?? {}) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? payload.error?.message ?? "AI Grader local station bridge request failed.");
  }
  return sanitizeAiGraderLocalStationStatusForDisplay(
    validateStationStatusReport(payload.result as AiGraderLocalStationStatus),
  );
}

async function bridgeGetJson<T>(
  input: { baseUrl: string; stationToken: string; path: string },
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) {
    throw new Error("AI Grader station bridge token is required.");
  }
  const response = await fetchImpl(`${baseUrl}${input.path}`, {
    method: "GET",
    headers: {
      "x-ai-grader-station-token": input.stationToken,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? payload.error?.message ?? "AI Grader local station bridge request failed.");
  }
  return payload.result as T;
}

export async function fetchAiGraderStationPreviewStatus(input: {
  baseUrl: string;
  stationToken: string;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLocalStationPreviewStatus> {
  return bridgeGetJson<AiGraderLocalStationPreviewStatus>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: "/preview/status",
  }, fetchImpl);
}

async function bridgePostJson<T>(
  input: {
    baseUrl: string;
    stationToken: string;
    path: string;
    body?: Record<string, unknown>;
    keepalive?: boolean;
    assertionHeaders?: Record<string, string>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) {
    throw new Error("AI Grader station bridge token is required.");
  }
  const response = await fetchImpl(`${baseUrl}${input.path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ai-grader-station-token": input.stationToken,
      ...(input.assertionHeaders ?? {}),
    },
    body: JSON.stringify(input.body ?? {}),
    keepalive: input.keepalive,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? payload.error?.message ?? "AI Grader local station bridge request failed.");
  }
  return payload.result as T;
}

export async function fetchAiGraderLiveLightingStatus(input: {
  baseUrl: string;
  stationToken: string;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLiveLightingStatus> {
  return bridgeGetJson<AiGraderLiveLightingStatus>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: "/lighting/status",
  }, fetchImpl);
}

export async function applyAiGraderLiveLighting(input: {
  baseUrl: string;
  stationToken: string;
  enabled: boolean;
  dutyPercent: number;
  channels: number[];
  reason?: string;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLiveLightingStatus> {
  return bridgePostJson<AiGraderLiveLightingStatus>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: "/lighting/apply",
    body: {
      enabled: input.enabled,
      dutyPercent: input.dutyPercent,
      channels: input.channels,
      reason: input.reason ?? "browser live lighting apply",
    },
  }, fetchImpl);
}

export async function heartbeatAiGraderLiveLighting(input: {
  baseUrl: string;
  stationToken: string;
  reason?: string;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLiveLightingStatus> {
  return bridgePostJson<AiGraderLiveLightingStatus>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: "/lighting/heartbeat",
    body: { reason: input.reason ?? "browser live lighting heartbeat" },
  }, fetchImpl);
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left, 0);
  joined.set(right, left.length);
  return joined;
}

function indexOfBytes(buffer: Uint8Array, target: Uint8Array, from = 0) {
  if (!target.length) return -1;
  for (let index = Math.max(0, from); index <= buffer.length - target.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < target.length; offset += 1) {
      if (buffer[index + offset] !== target[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return index;
  }
  return -1;
}

function headerValue(headerText: string, name: string) {
  const pattern = new RegExp(`^${name}:\\s*(.+)$`, "im");
  return headerText.match(pattern)?.[1]?.trim();
}

function boundaryFromContentType(contentType: string) {
  return contentType.match(/boundary="?([^";]+)"?/i)?.[1] ?? "tenkings-ai-grader-preview";
}

export async function openAiGraderStationPreviewStream(
  input: {
    baseUrl: string;
    stationToken: string;
  },
  handlers: AiGraderStationPreviewStreamHandlers = {},
  fetchImpl: typeof fetch = fetch
): Promise<AiGraderStationPreviewStreamResult> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) {
    throw new Error("AI Grader station bridge token is required.");
  }
  try {
  const response = await fetchImpl(`${baseUrl}/preview/stream`, {
    method: "GET",
    headers: {
      "x-ai-grader-station-token": input.stationToken,
    },
    signal: handlers.signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    let payload: Record<string, any> = {};
    let message = "AI Grader preview stream could not be opened.";
    try {
      payload = JSON.parse(text) as Record<string, any>;
      message = payload.message ?? payload.error?.message ?? message;
    } catch {
      if (text.trim()) message = text.trim();
    }
    const authoritativeStateCodes = new Set([
      "AI_GRADER_QUEUE_REVIEW_ACTIVE",
      "AI_GRADER_CAPTURE_LOCK_HELD",
      "AI_GRADER_PREVIEW_PAUSED_FOR_GRADING_SESSION",
    ]);
    const previewResult = payload.result && typeof payload.result === "object"
      ? payload.result as Partial<AiGraderLocalStationPreviewStatus>
      : undefined;
    const authoritativePreviewState =
      response.status === 409 &&
      typeof payload.code === "string" &&
      authoritativeStateCodes.has(payload.code) &&
      previewResult &&
      new Set(["paused_for_capture", "stopped", "error"]).has(String(previewResult.status)) &&
      new Set(["capture_action", "released"]).has(String(previewResult.cameraOwnership));
    if (authoritativePreviewState) {
      handlers.onState?.({
        statusCode: 409,
        code: payload.code.slice(0, 80),
        message: message.slice(0, 240),
        previewStatus: previewResult as AiGraderLocalStationPreviewStatus,
      });
      return { kind: "authoritative_state" };
    }
    throw new Error(message);
  }

  const contentType = response.headers.get("content-type") ?? "";
  handlers.onOpen?.(contentType);
  const boundaryBytes = new TextEncoder().encode(`--${boundaryFromContentType(contentType)}`);
  const headerEndBytes = new TextEncoder().encode("\r\n\r\n");
  const crlfBytes = new TextEncoder().encode("\r\n");
  const decoder = new TextDecoder("ascii");
  const reader = response.body.getReader();
  let buffer = new Uint8Array();
  let expectedLength: number | null = null;
  let currentContentType = "image/jpeg";
  let currentFrameIndex: number | undefined;
  let currentCapturedAt: string | undefined;
  let currentSessionId: string | undefined;
  let currentSide: "front" | "back" | undefined;
  let currentSideEpoch: string | undefined;
  let currentFrameId: string | undefined;

  const parseAvailableFrames = () => {
    while (true) {
      if (expectedLength === null) {
        const boundaryIndex = indexOfBytes(buffer, boundaryBytes);
        if (boundaryIndex < 0) {
          if (buffer.length > boundaryBytes.length) buffer = buffer.slice(buffer.length - boundaryBytes.length);
          return;
        }
        if (boundaryIndex > 0) buffer = buffer.slice(boundaryIndex);
        const headerEndIndex = indexOfBytes(buffer, headerEndBytes);
        if (headerEndIndex < 0) return;
        const headerText = decoder.decode(buffer.slice(0, headerEndIndex));
        const lengthValue = Number(headerValue(headerText, "Content-Length"));
        if (!Number.isInteger(lengthValue) || lengthValue <= 0) {
          buffer = buffer.slice(headerEndIndex + headerEndBytes.length);
          continue;
        }
        currentContentType = headerValue(headerText, "Content-Type") ?? "image/jpeg";
        const frameIndexValue = Number(headerValue(headerText, "X-AI-Grader-Frame-Index"));
        currentFrameIndex = Number.isFinite(frameIndexValue) ? frameIndexValue : undefined;
        currentCapturedAt = headerValue(headerText, "X-AI-Grader-Captured-At");
        currentSessionId = headerValue(headerText, "X-AI-Grader-Session-Id");
        const side = headerValue(headerText, "X-AI-Grader-Preview-Side");
        currentSide = side === "front" || side === "back" ? side : undefined;
        currentSideEpoch = headerValue(headerText, "X-AI-Grader-Preview-Epoch");
        currentFrameId = headerValue(headerText, "X-AI-Grader-Frame-Id");
        expectedLength = lengthValue;
        buffer = buffer.slice(headerEndIndex + headerEndBytes.length);
      }
      if (buffer.length < expectedLength) return;
      const frameBytes = buffer.slice(0, expectedLength);
      buffer = buffer.slice(expectedLength);
      if (indexOfBytes(buffer, crlfBytes) === 0) buffer = buffer.slice(crlfBytes.length);
      handlers.onFrame?.({
        blob: new Blob([frameBytes], { type: currentContentType }),
        contentType: currentContentType,
        byteLength: frameBytes.length,
        frameIndex: currentFrameIndex,
        capturedAt: currentCapturedAt,
        sessionId: currentSessionId,
        side: currentSide,
        sideEpoch: currentSideEpoch,
        frameId: currentFrameId,
      });
      expectedLength = null;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      buffer = concatBytes(buffer, value);
      parseAvailableFrames();
    }
  }
  if (handlers.signal?.aborted) {
    handlers.onAbort?.();
    return { kind: "abort" };
  }
  handlers.onEof?.();
  return { kind: "eof" };
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error("AI Grader preview stream failed.");
    if (normalized.name === "AbortError" || handlers.signal?.aborted) {
      handlers.onAbort?.();
      return { kind: "abort" };
    }
    handlers.onError?.(normalized);
    throw normalized;
  }
}

export async function fetchAiGraderStationReportBundle(input: {
  baseUrl: string;
  stationToken: string;
  reportId: string;
  includeAssetBodies?: boolean;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderStationReportBundle> {
  const query = input.includeAssetBodies ? "?includeAssetBodies=1" : "";
  const result = await bridgeGetJson<{ reportId: string; bundle: unknown; source: string }>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: `/reports/${encodeURIComponent(input.reportId)}/bundle${query}`,
  }, fetchImpl);
  return strictStationReportBundle(result.bundle);
}

export async function fetchAiGraderStationReportAsset(input: {
  baseUrl: string;
  stationToken: string;
  reportId: string;
  assetId: string;
}, fetchImpl: typeof fetch = fetch): Promise<{ bytes: ArrayBuffer; contentType: string; byteSize: number; checksumSha256?: string }> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) {
    throw new Error("AI Grader station bridge token is required.");
  }
  const response = await fetchImpl(
    `${baseUrl}/reports/${encodeURIComponent(input.reportId)}/asset?assetId=${encodeURIComponent(input.assetId)}`,
    {
      method: "GET",
      headers: {
        "x-ai-grader-station-token": input.stationToken,
      },
    }
  );
  if (!response.ok) {
    let message = `AI Grader local station asset fetch failed with HTTP ${response.status}.`;
    try {
      const payload = await response.json();
      message = payload.message ?? message;
    } catch {
      const text = await response.text().catch(() => "");
      if (text.trim()) message = text.trim();
    }
    throw new Error(message);
  }
  const bytes = await response.arrayBuffer();
  return {
    bytes,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    byteSize: bytes.byteLength,
    checksumSha256: response.headers.get("x-ai-grader-sha256") ?? undefined,
  };
}

export type AiGraderQueuedOcrDescriptor = {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  status: "eligible" | "in_flight";
  images: Array<{
    side: "front" | "back";
    artifactRole: "normalized_card";
    fileName: string;
    mimeType: "image/png";
    checksumSha256: string;
    byteSize: number;
    widthPx: 1200;
    heightPx: 1680;
  }>;
};

export async function fetchAiGraderQueuedOcrDescriptor(input: {
  baseUrl: string;
  stationToken: string;
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderQueuedOcrDescriptor> {
  const identity = exactRapidQueueIdentity(input);
  return bridgeGetJson<AiGraderQueuedOcrDescriptor>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: "/rapid-queue/" + encodeURIComponent(identity.queueItemId) +
      "/ocr?gradingSessionId=" + encodeURIComponent(identity.gradingSessionId) +
      "&reportId=" + encodeURIComponent(identity.reportId),
  }, fetchImpl);
}

export async function fetchAiGraderQueuedOcrAsset(input: {
  baseUrl: string;
  stationToken: string;
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  side: "front" | "back";
}, fetchImpl: typeof fetch = fetch): Promise<{
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  side: "front" | "back";
  bytes: ArrayBuffer;
  contentType: string;
  byteSize: number;
  checksumSha256?: string;
}> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  const identity = exactRapidQueueIdentity(input);
  if (!input.stationToken.trim()) throw new Error("AI Grader station bridge token is required.");
  const response = await fetchImpl(
    baseUrl + "/rapid-queue/" + encodeURIComponent(identity.queueItemId) +
      "/ocr/asset?gradingSessionId=" + encodeURIComponent(identity.gradingSessionId) +
      "&reportId=" + encodeURIComponent(identity.reportId) +
      "&side=" + input.side,
    {
      method: "GET",
      headers: { "x-ai-grader-station-token": input.stationToken },
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message ?? "Queued OCR " + input.side + " asset fetch failed with HTTP " + response.status + ".");
  }
  const headerIdentity = {
    queueItemId: response.headers.get("x-ai-grader-queue-item-id"),
    gradingSessionId: response.headers.get("x-ai-grader-grading-session-id"),
    reportId: response.headers.get("x-ai-grader-report-id"),
    side: response.headers.get("x-ai-grader-side"),
  };
  if (headerIdentity.queueItemId !== identity.queueItemId ||
      headerIdentity.gradingSessionId !== identity.gradingSessionId ||
      headerIdentity.reportId !== identity.reportId ||
      headerIdentity.side !== input.side) {
    throw new Error("Queued OCR asset response identity mismatch.");
  }
  const bytes = await response.arrayBuffer();
  return {
    ...identity,
    side: input.side,
    bytes,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    byteSize: bytes.byteLength,
    checksumSha256: response.headers.get("x-ai-grader-sha256") ?? undefined,
  };
}

export async function fetchAiGraderStationReportHtml(
  input: {
    baseUrl: string;
    stationToken: string;
    reportId: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) {
    throw new Error("AI Grader station bridge token is required.");
  }
  const response = await fetchImpl(`${baseUrl}/reports/${encodeURIComponent(input.reportId)}/html`, {
    method: "GET",
    headers: {
      "x-ai-grader-station-token": input.stationToken,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let message = "AI Grader local station report could not be opened.";
    try {
      const payload = JSON.parse(text);
      message = payload.message ?? payload.error?.message ?? message;
    } catch {
      if (text.trim()) message = text.trim();
    }
    throw new Error(message);
  }
  return text;
}

export async function fetchAiGraderStationReportHistory(input: {
  baseUrl: string;
  stationToken: string;
}): Promise<AiGraderLocalReportHistory> {
  return bridgeGetJson<AiGraderLocalReportHistory>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: "/report-history",
  });
}

export function aiGraderStationReportHtmlBridgeUrl(input: {
  baseUrl: string;
  reportId: string;
}) {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  return `${baseUrl}/reports/${encodeURIComponent(input.reportId)}/html`;
}
