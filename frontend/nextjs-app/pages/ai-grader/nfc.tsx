import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  AiGraderNfcHelperError,
  clearAiGraderNfcHelperPairing,
  clearAiGraderNfcInitIdempotencyKey,
  classifyAiGraderNfcHelperWriteRecovery,
  getAiGraderNfcHelperStatus,
  getOrCreateAiGraderNfcInitIdempotencyKey,
  hasAiGraderNfcHelperPairing,
  pairAiGraderNfcHelper,
  readAiGraderNfcInitIdempotencyKey,
  waitForAiGraderNfcHelperIdle,
  writeAiGraderNfcTag,
  type AiGraderNfcHelperStatus,
  type AiGraderNfcHelperWriteResult,
} from "../../lib/aiGraderNfcHelperClient";

type JsonRecord = Record<string, unknown>;
type Phase = "loading" | "disabled" | "ready" | "recovering" | "writing" | "verifying" | "overwrite" | "active" | "error";
type WorkflowProfile = "ntag215_pcsc" | "feiju_manual_ios";

type HostedStatus = {
  status: "missing" | "reserved" | "programming" | "verified" | "active" | "revoked" | "unavailable" | "error";
  reportId: string;
  cardAssetId?: string | null;
  itemId?: string | null;
  certId?: string | null;
  cardTitle?: string | null;
  cardSet?: string | null;
  publicTagId?: string | null;
  nfcTagUrl?: string | null;
  chipType?: "NTAG215" | "FEIJU_PROPRIETARY_ISODEP" | null;
  securityMode?: "static_url_v1" | "ntag424_sun_v1" | "manual_ios_locked_static_url_v1" | null;
  registrationSemantics?: "registered_link" | "cryptographically_verified" | null;
  nfcSchemaReady: boolean;
  nfcProgrammingEnabled: boolean;
  nfcManualIosEnabled: boolean;
  nfcRequired: boolean;
  nfcAttemptTokenConfigured: boolean;
  nfcWorkstationAttestationConfigured: boolean;
  nfcWorkstationKeyCount: number;
  expectedNfcHelperProtocolVersion: string;
  canProgram: boolean;
  canManualIos: boolean;
  canAdmin: boolean;
  manualIosAttempt?: {
    attemptId: string;
    state: "awaiting_prelock_tap" | "awaiting_lock_confirmation" | "awaiting_postlock_tap" | "ready_to_complete" | "failed" | "expired" | "consumed";
    profileVersion: "feiju_iso_dep_ios_static_v1";
    qualificationProfile: "feiju_iso_dep_ios_static_v1";
    attemptExpiresAt: string;
    preLockTapObserved: boolean;
    lockStatusConfirmed: boolean;
    postLockTapObserved: boolean;
    writeProtectionEvidence?: "ios_read_only_status_observed";
    workstationOperationalAttestation: false;
    cryptographicTagAuthentication: false;
  };
};

type Reservation = {
  url: string;
  publicTagId: string;
  attemptId: string;
  attemptToken: string;
  attestationChallenge: string;
  chipType: "NTAG215";
  securityMode: "static_url_v1";
  reportId?: string;
  cardAssetId?: string;
  itemId?: string;
  certId?: string;
  linkage?: {
    reportId: string;
    cardAssetId: string;
    itemId: string;
    certId: string;
  };
};

type ManualIosReservation = {
  url: string;
  publicTagId: string;
  attemptId: string;
  reportId: string;
  cardAssetId: string;
  itemId: string;
  certId: string;
};
type PendingCompletion = {
  reservation: Reservation;
  write: AiGraderNfcHelperWriteResult;
  idempotencyKey: string;
};

type WriteRecovery = "definite_prewrite" | "uncertain" | "not_retryable" | null;
type AdminMutationRequest = { publicTagId: string; reason: string; idempotencyKey: string };

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function errorMessage(error: unknown) {
  if (error instanceof AiGraderNfcHelperError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : "The NFC operation failed safely.";
}

function reservationFrom(value: unknown): Reservation {
  const row = record(value);
  const linkage = record(row.linkage ?? row.expectedLinkage);
  const result: Reservation = {
    url: typeof row.url === "string" ? row.url : typeof row.nfcTagUrl === "string" ? row.nfcTagUrl : "",
    publicTagId: typeof row.publicTagId === "string" ? row.publicTagId : "",
    attemptId: typeof row.attemptId === "string" ? row.attemptId : "",
    attemptToken: typeof row.attemptToken === "string" ? row.attemptToken : typeof row.token === "string" ? row.token : "",
    attestationChallenge: typeof row.attestationChallenge === "string" ? row.attestationChallenge : "",
    chipType: "NTAG215",
    securityMode: "static_url_v1",
    reportId: typeof row.reportId === "string" ? row.reportId : undefined,
    cardAssetId: typeof row.cardAssetId === "string" ? row.cardAssetId : undefined,
    itemId: typeof row.itemId === "string" ? row.itemId : undefined,
    certId: typeof row.certId === "string" ? row.certId : undefined,
    linkage:
      typeof linkage.reportId === "string" &&
      typeof linkage.cardAssetId === "string" &&
      typeof linkage.itemId === "string" &&
      typeof linkage.certId === "string"
        ? {
            reportId: linkage.reportId,
            cardAssetId: linkage.cardAssetId,
            itemId: linkage.itemId,
            certId: linkage.certId,
          }
        : undefined,
  };
  if (
    !result.url ||
    !result.publicTagId ||
    !result.attemptId ||
    !result.attemptToken ||
    !/^[A-Za-z0-9_-]{43}$/.test(result.attestationChallenge) ||
    result.url !== `https://collect.tenkings.co/nfc/${result.publicTagId}`
  ) {
    throw new Error("The hosted NFC reservation response was incomplete or unsafe.");
  }
  return result;
}

function manualIosReservationFrom(value: unknown, hosted: HostedStatus | null, reportId: string): ManualIosReservation {
  const row = record(value);
  const attempt = record(row.manualIosAttempt);
  const result = {
    url: typeof row.expectedNdefUrl === "string" ? row.expectedNdefUrl : typeof row.nfcTagUrl === "string" ? row.nfcTagUrl : "",
    publicTagId: typeof row.publicTagId === "string" ? row.publicTagId : "",
    attemptId: typeof row.attemptId === "string" ? row.attemptId : typeof attempt.attemptId === "string" ? attempt.attemptId : "",
    reportId: typeof row.reportId === "string" ? row.reportId : reportId,
    cardAssetId: typeof row.cardAssetId === "string" ? row.cardAssetId : hosted?.cardAssetId ?? "",
    itemId: typeof row.itemId === "string" ? row.itemId : hosted?.itemId ?? "",
    certId: typeof row.certId === "string" ? row.certId : hosted?.certId ?? "",
  };
  if (
    !/^nfc_ios_attempt_[A-Za-z0-9_-]{43}$/.test(result.attemptId) ||
    !/^[A-Za-z0-9_-]{32}$/.test(result.publicTagId) ||
    result.url !== `https://collect.tenkings.co/nfc/${result.publicTagId}` ||
    !result.reportId || !result.cardAssetId || !result.itemId || !result.certId
  ) throw new Error("The hosted Feiju reservation response was incomplete or unsafe.");
  return result;
}
function assertSignedReadback(reservation: Reservation, write: AiGraderNfcHelperWriteResult) {
  const attestation = write.operationalAttestation;
  if (
    (write.readerResultCode !== "write_verified_pcsc_readback" && write.readerResultCode !== "already_programmed_exact") ||
    write.normalizedUrl !== reservation.url ||
    write.chipType !== "NTAG215" ||
    !/^[a-f0-9]{64}$/.test(write.uidFingerprintSha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(write.readbackPayloadSha256 ?? "") ||
    !attestation ||
    attestation.schemaVersion !== "ai-grader-nfc-helper-attestation-v1" ||
    attestation.algorithm !== "ecdsa-p256-sha256-p1363" ||
    attestation.attestationChallenge !== reservation.attestationChallenge ||
    !/^[a-f0-9]{64}$/.test(attestation.workstationKeyId) ||
    !/^[A-Za-z0-9_-]{86}$/.test(attestation.signature) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(attestation.observedAt)
  ) {
    throw new Error("The NFC helper did not return a complete signed PC/SC readback.");
  }
  return write;
}

export default function AiGraderNfcProgrammingPage() {
  const router = useRouter();
  const { session, loading: sessionLoading, ensureSession } = useSession();
  const reportId = useMemo(() => {
    const value = Array.isArray(router.query.reportId) ? router.query.reportId[0] : router.query.reportId;
    return typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : "";
  }, [router.query.reportId]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [workflowProfile, setWorkflowProfile] = useState<WorkflowProfile>("ntag215_pcsc");
  const [message, setMessage] = useState("Loading the published NFC task.");
  const [hosted, setHosted] = useState<HostedStatus | null>(null);
  const [helper, setHelper] = useState<AiGraderNfcHelperStatus | null>(null);
  const [paired, setPaired] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [pending, setPending] = useState<PendingCompletion | null>(null);
  const [manualReservation, setManualReservation] = useState<ManualIosReservation | null>(null);
  const [overwriteDigest, setOverwriteDigest] = useState<string | null>(null);
  const [writeIdempotencyKey, setWriteIdempotencyKey] = useState<string | null>(null);
  const [localRetrySequence, setLocalRetrySequence] = useState(0);
  const [writeRecovery, setWriteRecovery] = useState<WriteRecovery>(null);
  const [storedAttemptAvailable, setStoredAttemptAvailable] = useState(false);
  const [replacementRequest, setReplacementRequest] = useState<AdminMutationRequest | null>(null);
  const [revocationRequest, setRevocationRequest] = useState<AdminMutationRequest | null>(null);
  const [reason, setReason] = useState("");
  const programmingReady = Boolean(
    hosted?.nfcSchemaReady &&
    hosted.nfcProgrammingEnabled &&
    hosted.nfcAttemptTokenConfigured &&
    hosted.nfcWorkstationAttestationConfigured &&
    hosted.nfcWorkstationKeyCount > 0,
  );
  const manualIosReady = Boolean(
    hosted?.nfcSchemaReady && hosted.nfcProgrammingEnabled && hosted.nfcManualIosEnabled,
  );

  useEffect(() => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    const code = new URLSearchParams(hash).get("aiGraderNfcPair")?.trim() ?? "";
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(code)) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setPairingCode(code);
    setMessage("One-time workstation pairing is ready after hosted programming readiness is confirmed.");
  }, []);

  const hostedRequest = useCallback(
    async (action: "status" | "init" | "complete" | "revoke" | "replace" | "manual-ios/init" | "manual-ios/confirm-lock" | "manual-ios/complete" | "manual-ios/replace", body?: JsonRecord) => {
      const active = await ensureSession();
      const response = await fetch(
        action === "status"
          ? `/api/admin/ai-grader/nfc/status?reportId=${encodeURIComponent(reportId)}`
          : `/api/admin/ai-grader/nfc/${action}`,
        {
          method: action === "status" ? "GET" : "POST",
          headers: buildAdminHeaders(active.token, body ? { "content-type": "application/json" } : {}),
          cache: "no-store",
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      const payload = record(await response.json().catch(() => ({})));
      if (!response.ok || payload.ok !== true) {
        const error = new Error(typeof payload.message === "string" ? payload.message : "The hosted NFC request failed.");
        error.name = typeof payload.code === "string" ? payload.code : "AI_GRADER_NFC_REQUEST_FAILED";
        throw error;
      }
      return payload.result;
    },
    [ensureSession, reportId],
  );

  const refresh = useCallback(async () => {
    if (!reportId) return;
    const result = (await hostedRequest("status")) as HostedStatus;
    setHosted(result);
    if (!result.nfcSchemaReady) {
      setHelper(null);
      setPhase("disabled");
      setMessage("NFC persistence is unavailable until the approved database migration is applied.");
      return;
    }
    if (!result.cardAssetId || !result.itemId || !result.certId) {
      setHelper(null);
      setPhase("error");
      setMessage("This NFC task is not linked to one exact published CardAsset, Item, and certificate.");
      return;
    }
    if (result.status === "active") {
      clearAiGraderNfcInitIdempotencyKey(reportId);
      setStoredAttemptAvailable(false);
      setReservation(null);
      setPending(null);
      setOverwriteDigest(null);
      setWriteIdempotencyKey(null);
      setWriteRecovery(null);
      setReplacementRequest(null);
      setManualReservation(null);
      setPhase("active");
      setMessage("NFC is verified and active for this published report.");
      return;
    }
    if (!result.nfcProgrammingEnabled) {
      setHelper(null);
      setPhase("disabled");
      setMessage("NFC programming is disabled by server policy. Status and administrator revocation remain available.");
      return;
    }
    if (workflowProfile === "feiju_manual_ios") {
      setHelper(null);
      setPaired(false);
      setReservation(null);
      setPending(null);
      if (!result.nfcManualIosEnabled) {
        setPhase("disabled");
        setMessage("The Feiju iPhone-assisted NFC workflow is disabled by server policy.");
        return;
      }
      if (result.chipType && result.chipType !== "FEIJU_PROPRIETARY_ISODEP" && result.status !== "revoked") {
        setPhase("error");
        setMessage("This open NFC registration belongs to the NTAG215 workstation profile.");
        return;
      }
      if (result.manualIosAttempt && result.publicTagId && result.nfcTagUrl) {
        setManualReservation(manualIosReservationFrom(result, result, reportId));
      } else {
        setManualReservation(null);
      }
      setPhase("ready");
      const state = result.manualIosAttempt?.state;
      setMessage(
        state === "awaiting_prelock_tap"
          ? "Write the exact URL with NFC Tools, then open it with a normal iPhone background tap."
          : state === "awaiting_lock_confirmation"
            ? "The pre-lock tap was observed. Lock the tag in NFC Tools and confirm it reports Writable: No."
            : state === "awaiting_postlock_tap"
              ? "Writable: No was confirmed. Remove and present the tag again for the final background tap."
              : state === "ready_to_complete"
                ? "Both exact URL taps and consumer write protection are recorded. Complete activation."
                : "Reserve a Feiju iPhone-assisted registered link when one unused tag is ready.",
      );
      return;
    }
    setManualReservation(null);
    if (result.chipType && result.chipType !== "NTAG215" && result.status !== "revoked") {
      setHelper(null);
      setPhase("error");
      setMessage("This open NFC registration belongs to the Feiju iPhone-assisted profile.");
      return;
    }
    if (!result.nfcAttemptTokenConfigured || !result.nfcWorkstationAttestationConfigured || result.nfcWorkstationKeyCount < 1) {
      setHelper(null);
      setPhase("disabled");
      setMessage("NFC programming is enabled but its server token or approved workstation key allowlist is not ready.");
      return;
    }
    const hasStoredAttempt = Boolean(readAiGraderNfcInitIdempotencyKey(reportId));
    setStoredAttemptAvailable(hasStoredAttempt);
    const isPaired = hasAiGraderNfcHelperPairing();
    setPaired(isPaired);
    if (isPaired) {
      try {
        const helperStatus = await getAiGraderNfcHelperStatus();
        if (helperStatus.helperProtocolVersion !== result.expectedNfcHelperProtocolVersion) {
          throw new Error("The NFC workstation helper protocol is out of date. Update it before programming.");
        }
        if (hasStoredAttempt && helperStatus.busy) setWriteRecovery("uncertain");
        setHelper(helperStatus);
      } catch (error) {
        setHelper(null);
        setPhase("error");
        setMessage(errorMessage(error));
        return;
      }
    }
    setPhase("ready");
    setMessage(
      hasStoredAttempt
        ? "A current hosted attempt is available. Use Retry Current Attempt; no second attempt will be allocated."
        : "Place one blank NTAG215 on the reader, then program the registered report link.",
    );
  }, [hostedRequest, reportId, workflowProfile]);

  useEffect(() => {
    if (!router.isReady || sessionLoading) return;
    if (!reportId) {
      setPhase("error");
      setMessage("Open this workstation route from a specific published Finish item.");
      return;
    }
    if (!session?.token) {
      setPhase("ready");
      setMessage("Use the normal Ten Kings sign-in to open this NFC task.");
      return;
    }
    void refresh().catch((error) => {
      setPhase("error");
      setMessage(errorMessage(error));
    });
  }, [refresh, reportId, router.isReady, session?.token, sessionLoading]);

  const completeHosted = useCallback(
    async (completion: PendingCompletion) => {
      const linkage = completion.reservation.linkage ?? {
        reportId: completion.reservation.reportId ?? reportId,
        cardAssetId: completion.reservation.cardAssetId ?? hosted?.cardAssetId ?? "",
        itemId: completion.reservation.itemId ?? hosted?.itemId ?? "",
        certId: completion.reservation.certId ?? hosted?.certId ?? "",
      };
      setPhase("verifying");
      setMessage("Verifying exact PC/SC readback with the hosted report authority.");
      await hostedRequest("complete", {
        ...linkage,
        publicTagId: completion.reservation.publicTagId,
        attemptId: completion.reservation.attemptId,
        attemptToken: completion.reservation.attemptToken,
        idempotencyKey: completion.idempotencyKey,
        chipType: completion.write.chipType,
        normalizedUrl: completion.write.normalizedUrl,
        uidFingerprintSha256: completion.write.uidFingerprintSha256,
        readbackPayloadSha256: completion.write.readbackPayloadSha256,
        readerResultCode: completion.write.readerResultCode,
        helperProtocolVersion: completion.write.helperProtocolVersion,
        operationalAttestation: completion.write.operationalAttestation,
      });
      clearAiGraderNfcInitIdempotencyKey(reportId);
      setPending(null);
      setReservation(null);
      setOverwriteDigest(null);
      setWriteIdempotencyKey(null);
      setWriteRecovery(null);
      await refresh();
    },
    [hosted?.cardAssetId, hosted?.certId, hosted?.itemId, hostedRequest, refresh, reportId],
  );

  const writeReservation = useCallback(
    async (
      currentReservation: Reservation,
      idempotency: string,
      overwriteConfirmation?: { confirmed: true; observedPayloadSha256: string },
    ) => {
      setReservation(currentReservation);
      setWriteIdempotencyKey(idempotency);
      setPending(null);
      setPhase("writing");
      setMessage("Writing the NDEF URL, then reading the full payload back from the NTAG215.");
      try {
        const write = await writeAiGraderNfcTag({
          attemptId: currentReservation.attemptId,
          idempotencyKey: idempotency,
          publicTagId: currentReservation.publicTagId,
          attestationChallenge: currentReservation.attestationChallenge,
          url: currentReservation.url,
          ...(overwriteConfirmation ? { overwriteConfirmation } : {}),
        });
        if (write.overwriteRequired) {
          if (
            write.operationalAttestation ||
            !write.observedPayloadSha256 ||
            !/^[a-f0-9]{64}$/.test(write.observedPayloadSha256)
          ) {
            throw new Error("The NFC helper returned an invalid overwrite challenge.");
          }
          setOverwriteDigest(write.observedPayloadSha256);
          setWriteRecovery(null);
          setPhase("overwrite");
          setMessage("This tag contains a different NDEF payload. Confirm once to overwrite this exact observed content.");
          return;
        }
        assertSignedReadback(currentReservation, write);
        const completion = {
          reservation: currentReservation,
          write,
          idempotencyKey: `complete-${currentReservation.attemptId}`,
        };
        setPending(completion);
        setWriteRecovery(null);
        await completeHosted(completion);
      } catch (error) {
        setWriteRecovery(classifyAiGraderNfcHelperWriteRecovery(error));
        throw error;
      }
    },
    [completeHosted],
  );

  const program = async () => {
    try {
      if (!hosted?.nfcProgrammingEnabled) throw new Error("NFC programming is disabled by server policy.");
      if (!programmingReady) {
        throw new Error("NFC programming is not fully configured.");
      }
      if (!paired) throw new Error("Pair the dedicated NFC helper first.");
      const initIdempotencyKey = getOrCreateAiGraderNfcInitIdempotencyKey(reportId);
      setStoredAttemptAvailable(true);
      const currentReservation = reservationFrom(
        await hostedRequest("init", { reportId, idempotencyKey: initIdempotencyKey }),
      );
      setReservation(currentReservation);
      setLocalRetrySequence(0);
      const localKey = `write-${currentReservation.attemptId}-try-0`;
      await writeReservation(currentReservation, localKey);
    } catch (error) {
      if (error instanceof Error && error.name === "AI_GRADER_NFC_ATTEMPT_EXPIRED") {
        clearAiGraderNfcInitIdempotencyKey(reportId);
        setStoredAttemptAvailable(false);
        setReservation(null);
        setWriteIdempotencyKey(null);
      }
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const pair = async () => {
    try {
      if (!hosted?.nfcProgrammingEnabled) throw new Error("NFC programming is disabled by server policy.");
      if (!programmingReady) throw new Error("NFC programming is not fully configured.");
      setMessage("Pairing this browser with the loopback-only NFC helper.");
      const status = await pairAiGraderNfcHelper(pairingCode);
      if (status.helperProtocolVersion !== hosted.expectedNfcHelperProtocolVersion) {
        throw new Error("The NFC workstation helper protocol is out of date. Update it before programming.");
      }
      setHelper(status);
      setPaired(true);
      setPairingCode("");
      setPhase("ready");
      setMessage("NFC helper paired. Place one blank NTAG215 on the reader.");
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const startManualIos = async () => {
    try {
      if (!manualIosReady) throw new Error("The Feiju iPhone-assisted NFC workflow is disabled or unavailable.");
      const idempotency = getOrCreateAiGraderNfcInitIdempotencyKey(reportId);
      const result = await hostedRequest("manual-ios/init", { reportId, idempotencyKey: idempotency });
      setManualReservation(manualIosReservationFrom(result, hosted, reportId));
      setPhase("ready");
      setMessage("Copy the exact URL into NFC Tools, write one URI record, then close NFC Tools and tap the tag normally.");
      await refresh();
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const confirmManualIosLock = async () => {
    const current = manualReservation;
    if (!current) return;
    try {
      await hostedRequest("manual-ios/confirm-lock", {
        reportId: current.reportId,
        cardAssetId: current.cardAssetId,
        itemId: current.itemId,
        certId: current.certId,
        publicTagId: current.publicTagId,
        attemptId: current.attemptId,
        writableNoConfirmed: true,
      });
      setPhase("ready");
      setMessage("Writable: No is recorded. Remove the tag from the phone field, then tap it normally again to open the exact URL.");
      await refresh();
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const completeManualIos = async () => {
    const current = manualReservation;
    if (!current) return;
    try {
      setPhase("verifying");
      setMessage("Activating the write-protected registered NFC link after both exact URL taps.");
      await hostedRequest("manual-ios/complete", {
        ...current,
        normalizedUrl: current.url,
        idempotencyKey: `complete-${current.attemptId}`,
      });
      clearAiGraderNfcInitIdempotencyKey(reportId);
      setManualReservation(null);
      await refresh();
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const copyManualIosUrl = async () => {
    if (!manualReservation) return;
    try {
      await navigator.clipboard.writeText(manualReservation.url);
      setMessage("Exact Ten Kings URL copied. In NFC Tools, write one URL/URI record only.");
    } catch {
      setMessage("Copy was unavailable. Select the exact URL shown below without changing it.");
    }
  };
  const replace = async () => {
    try {
      const normalizedReason = reason.trim();
      const oldPublicTagId = hosted?.publicTagId ?? "";
      if (normalizedReason.length < 8) throw new Error("Enter a replacement reason of at least 8 characters.");
      if (!/^[A-Za-z0-9_-]{32}$/.test(oldPublicTagId)) throw new Error("The exact NFC registration to replace is unavailable.");
      const attemptIdempotencyKey = getOrCreateAiGraderNfcInitIdempotencyKey(reportId);
      setStoredAttemptAvailable(true);
      const request = replacementRequest ?? {
        publicTagId: oldPublicTagId,
        reason: normalizedReason,
        idempotencyKey: attemptIdempotencyKey,
      };
      if (
        request.publicTagId !== oldPublicTagId ||
        request.reason !== normalizedReason ||
        request.idempotencyKey !== attemptIdempotencyKey
      ) {
        throw new Error("Retry the exact same replacement identity and reason, or reload the current status.");
      }
      setReplacementRequest(request);
      if (workflowProfile === "feiju_manual_ios") {
        const result = await hostedRequest("manual-ios/replace", {
          reportId,
          replacedPublicTagId: request.publicTagId,
          reason: request.reason,
          idempotencyKey: request.idempotencyKey,
        });
        setReason("");
        setManualReservation(manualIosReservationFrom(result, hosted, reportId));
        await refresh();
        return;
      }
      const reservation = reservationFrom(
        await hostedRequest("replace", {
          reportId,
          replacedPublicTagId: request.publicTagId,
          reason: request.reason,
          idempotencyKey: request.idempotencyKey,
        }),
      );
      setReason("");
      setReservation(reservation);
      setLocalRetrySequence(0);
      await writeReservation(reservation, `write-${reservation.attemptId}-try-0`);
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const revoke = async () => {
    try {
      const normalizedReason = reason.trim();
      const publicTagId = hosted?.publicTagId ?? "";
      if (normalizedReason.length < 8) throw new Error("Enter a revocation reason of at least 8 characters.");
      if (!/^[A-Za-z0-9_-]{32}$/.test(publicTagId)) throw new Error("The exact NFC registration to revoke is unavailable.");
      const request = revocationRequest ?? {
        publicTagId,
        reason: normalizedReason,
        idempotencyKey: `nfc-revoke-${crypto.randomUUID()}`,
      };
      if (request.publicTagId !== publicTagId || request.reason !== normalizedReason) {
        throw new Error("Retry the exact same revocation identity and reason, or reload the current status.");
      }
      setRevocationRequest(request);
      await hostedRequest("revoke", {
        reportId,
        reason: request.reason,
        idempotencyKey: request.idempotencyKey,
      });
      clearAiGraderNfcInitIdempotencyKey(reportId);
      setStoredAttemptAvailable(false);
      setReservation(null);
      setPending(null);
      setWriteIdempotencyKey(null);
      setWriteRecovery(null);
      setReason("");
      setRevocationRequest(null);
      await refresh();
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const confirmOverwrite = async () => {
    if (!reservation || !overwriteDigest) return;
    try {
      const localKey = `write-${reservation.attemptId}-overwrite-${overwriteDigest.slice(0, 12)}`;
      await writeReservation(
        reservation,
        localKey,
        { confirmed: true, observedPayloadSha256: overwriteDigest },
      );
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const retryHostedVerification = async () => {
    if (!pending) return;
    try {
      await completeHosted(pending);
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const retryCurrentAttempt = async () => {
    if (writeRecovery === "not_retryable") return;
    try {
      if (!hosted?.nfcProgrammingEnabled) throw new Error("NFC programming is disabled by server policy.");
      if (!programmingReady) throw new Error("NFC programming is not fully configured.");
      if (!paired) throw new Error("Pair the dedicated NFC helper first.");
      if (pending) {
        await completeHosted(pending);
        return;
      }

      let currentReservation = reservation;
      if (!currentReservation) {
        const initIdempotencyKey = readAiGraderNfcInitIdempotencyKey(reportId);
        if (!initIdempotencyKey) throw new Error("No current NFC attempt is available to retry.");
        currentReservation = reservationFrom(await hostedRequest("init", { reportId, idempotencyKey: initIdempotencyKey }));
        setReservation(currentReservation);
        setLocalRetrySequence(0);
      }

      setPhase("recovering");
      setMessage("Keep the same physical tag on the reader while recovering this hosted attempt without allocating or rewriting another tag identity.");
      if (writeRecovery === "uncertain") {
        const status = await waitForAiGraderNfcHelperIdle();
        setHelper(status);
      }
      const nextSequence = writeRecovery === "definite_prewrite" ? localRetrySequence + 1 : localRetrySequence;
      if (nextSequence > 3) throw new Error("The current NFC attempt reached its bounded local retry limit.");
      setLocalRetrySequence(nextSequence);
      const localKey =
        writeRecovery === "uncertain" && writeIdempotencyKey
          ? writeIdempotencyKey
          : `write-${currentReservation.attemptId}-try-${nextSequence}`;
      await writeReservation(currentReservation, localKey);
    } catch (error) {
      if (error instanceof Error && error.name === "AI_GRADER_NFC_ATTEMPT_EXPIRED") {
        clearAiGraderNfcInitIdempotencyKey(reportId);
        setStoredAttemptAvailable(false);
        setReservation(null);
        setWriteIdempotencyKey(null);
      }
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const busy = phase === "writing" || phase === "verifying" || phase === "recovering" || phase === "loading";
  const manualState = hosted?.manualIosAttempt?.state;
  const canRetryCurrentAttempt =
    workflowProfile === "ntag215_pcsc" &&
    !pending &&
    programmingReady &&
    (reservation !== null || storedAttemptAvailable) &&
    (phase === "error" || phase === "ready") &&
    writeRecovery !== "not_retryable";

  return (
    <>
      <Head><title>Program NFC | Ten Kings AI Grader</title><meta name="robots" content="noindex,nofollow" /></Head>
      <main className="shell">
        <header>
          <div><p className="eyebrow">Ten Kings AI Grader</p><h1>Program slab NFC</h1></div>
          <Link href={`/ai-grader/finish${reportId ? `?reportId=${encodeURIComponent(reportId)}` : ""}`}>Back to Finish</Link>
        </header>

        <section className={`notice ${phase}`} aria-live="polite">
          <strong>{phase === "active" ? "Verified / active" : phase.replace(/_/g, " ")}</strong>
          <span>{message}</span>
        </section>
        <section className="profile-select">
          <label>Programming profile
            <select
              value={workflowProfile}
              onChange={(event) => {
                setWorkflowProfile(event.target.value as WorkflowProfile);
                setReservation(null);
                setPending(null);
                setManualReservation(null);
                setOverwriteDigest(null);
                setWriteRecovery(null);
                setPhase("loading");
                setMessage("Loading the selected NFC workflow.");
              }}
            >
              <option value="ntag215_pcsc">NTAG215 -- workstation PC/SC</option>
              <option value="feiju_manual_ios">Feiju -- iPhone assisted</option>
            </select>
          </label>
          <p>{workflowProfile === "feiju_manual_ios" ? "The Feiju profile is a write-protected registered static URL. It is clonable and is not cryptographic tag authentication." : "The NTAG215 profile preserves the approved workstation PC/SC helper and signed readback workflow."}</p>
        </section>

        <section className="grid">
          <article>
            <p className="eyebrow">Published authority</p>
            <h2>{hosted?.reportId ?? (reportId || "No report selected")}</h2>
            <dl>
              <dt>Card</dt><dd>{hosted?.cardTitle ?? "Loading"}{hosted?.cardSet ? ` - ${hosted.cardSet}` : ""}</dd>
              <dt>Certificate</dt><dd>{hosted?.certId ?? "Loading"}</dd>
              <dt>NFC state</dt><dd>{hosted?.status ?? "Loading"}</dd>
              <dt>Chip / mode</dt><dd>{hosted?.chipType ? `${hosted.chipType} / ${hosted.securityMode}` : "NTAG215 / static_url_v1"}</dd>
              <dt>Security meaning</dt><dd>Registered link - not cryptographic authentication</dd>
              <dt>Database schema</dt><dd>{hosted?.nfcSchemaReady ? "Ready" : "Unavailable"}</dd>
              <dt>Programming policy</dt><dd>{hosted?.nfcProgrammingEnabled ? "Enabled" : "Disabled"}</dd>
              <dt>Inventory policy</dt><dd>{hosted?.nfcRequired ? "NFC required" : "NFC not required"}</dd>
              <dt>Workstation trust</dt><dd>{hosted?.nfcWorkstationAttestationConfigured ? `${hosted.nfcWorkstationKeyCount} approved key${hosted.nfcWorkstationKeyCount === 1 ? "" : "s"}` : "Not configured"}</dd>
            </dl>
            {hosted?.nfcTagUrl ? <a href={hosted.nfcTagUrl} target="_blank" rel="noreferrer">Open registered tap page</a> : null}
          </article>

          <article>
            <p className="eyebrow">{workflowProfile === "feiju_manual_ios" ? "iPhone-assisted workflow" : "Dedicated workstation helper"}</p>
            <h2>{workflowProfile === "feiju_manual_ios" ? manualIosReady ? "NFC Tools on iPhone" : "Manual iPhone workflow disabled" : !programmingReady ? hosted?.nfcProgrammingEnabled ? "Programming not configured" : "Programming disabled" : paired ? helper?.readerConnected ? "Reader connected" : "Paired / reader unavailable" : "Pair workstation"}</h2>
            {workflowProfile === "feiju_manual_ios" ? (
              <p>No PC reader, UID, helper attestation, or proprietary Feiju command is used. NFC Tools by Wakdev writes and locks the exact server-reserved URL.</p>
            ) : !programmingReady ? (
              <p>The browser will not contact the loopback helper while hosted programming is disabled or incomplete.</p>
            ) : paired ? (
              <>
                <dl>
                  <dt>PC/SC</dt><dd>{helper?.pcscReady ? "Ready" : "Not ready"}</dd>
                  <dt>Tag</dt><dd>{helper?.tagState ?? "unknown"}</dd>
                  <dt>Reader</dt><dd>{helper?.readerModel ?? "ACR1552U-compatible PC/SC reader"}</dd>
                  <dt>Helper</dt><dd>{helper?.helperProtocolVersion ?? "Checking"}</dd>
                </dl>
                <button type="button" className="secondary" onClick={() => { clearAiGraderNfcHelperPairing(); setPaired(false); setHelper(null); }}>Forget local pairing</button>
              </>
            ) : (
              <div className="pair">
                <label>Pairing code<input value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} autoComplete="off" /></label>
                <button type="button" disabled={!programmingReady} onClick={() => void pair()}>Pair NFC helper</button>
              </div>
            )}
          </article>
        </section>

        {workflowProfile === "feiju_manual_ios" ? (
          <section className="manual-ios">
            <div><p className="eyebrow">Feiju -- iPhone assisted</p><h2>One unused Feiju tag / one report</h2></div>
            <ol>
              <li className={manualState && manualState !== "awaiting_prelock_tap" ? "done" : ""}>Reserve and copy the exact Ten Kings URL.</li>
              <li className={hosted?.manualIosAttempt?.preLockTapObserved ? "done" : ""}>In NFC Tools, write exactly one URL record. Close the app and use a normal background tap.</li>
              <li className={hosted?.manualIosAttempt?.lockStatusConfirmed ? "done" : ""}>NFC Tools &gt; Other &gt; Lock a tag. Confirm only after NFC Tools reports Writable: No.</li>
              <li className={hosted?.manualIosAttempt?.postLockTapObserved ? "done" : ""}>Remove the tag from the phone field, then use a final normal background tap to the same URL.</li>
              <li className={hosted?.status === "active" ? "done" : ""}>Complete and activate the write-protected registered NFC link.</li>
            </ol>
            {manualReservation ? (
              <div className="manual-url">
                <code>{manualReservation.url}</code>
                <button type="button" className="secondary" onClick={() => void copyManualIosUrl()}>Copy exact URL</button>
              </div>
            ) : null}
            <div className="manual-actions">
              {!manualReservation && hosted?.status !== "active" ? <button type="button" disabled={!manualIosReady || busy || !hosted?.canManualIos} onClick={() => void startManualIos()}>Reserve Feiju link</button> : null}
              {manualReservation ? <button type="button" className="secondary" onClick={() => void refresh()}>Refresh tap evidence</button> : null}
              {manualReservation && manualState === "awaiting_lock_confirmation" ? <button type="button" onClick={() => void confirmManualIosLock()}>Confirm Writable: No</button> : null}
              {manualReservation && manualState === "ready_to_complete" ? <button type="button" onClick={() => void completeManualIos()}>Complete registration</button> : null}
            </div>
            <p className="manual-warning">Do not attempt an alternate-URL overwrite on a real report tag. The destructive discrimination test was completed only on the sacrificial qualification sample.</p>
          </section>
        ) : (
          <section className="program">
          <div><p className="eyebrow">One tag / one report</p><h2>Place one blank NTAG215</h2><p>The helper writes only the exact Ten Kings URL, verifies full readback, and never locks or configures the tag.</p></div>
          <button
            type="button"
            className="primary"
            disabled={
              busy ||
              !paired ||
              hosted?.status === "active" ||
              !hosted?.canProgram ||
              !programmingReady ||
              storedAttemptAvailable
            }
            onClick={() => void program()}
          >
            {phase === "writing" ? "Writing" : phase === "verifying" ? "Verifying" : "Program NFC"}
          </button>
        </section>
        )}

        {phase === "overwrite" && reservation && overwriteDigest ? (
          <section className="danger">
            <div><strong>Different content detected</strong><p>Overwrite only this exact observed payload. The existing content is not silently reassigned.</p></div>
            <button type="button" onClick={() => void confirmOverwrite()}>Confirm overwrite once</button>
          </section>
        ) : null}

        {pending && phase === "error" && pending.write.normalizedUrl ? (
          <button type="button" className="secondary retry" onClick={() => void retryHostedVerification()}>Retry hosted verification</button>
        ) : null}

        {canRetryCurrentAttempt ? (
          <button type="button" className="secondary retry" onClick={() => void retryCurrentAttempt()}>Retry Current Attempt</button>
        ) : null}

        {hosted?.canAdmin && hosted.publicTagId && hosted.status !== "missing" ? (
          <section className="admin-actions">
            <label>Required audit reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={240} /></label>
            {(workflowProfile === "feiju_manual_ios" ? manualIosReady : programmingReady) ? <button type="button" className="secondary" onClick={() => void replace()}>{workflowProfile === "feiju_manual_ios" ? hosted.status === "revoked" ? "Reserve authorized replacement" : "Revoke and reserve replacement" : hosted.status === "revoked" ? "Program authorized replacement" : "Revoke and program replacement"}</button> : null}
            {hosted.status !== "revoked" ? <button type="button" className="danger-button" onClick={() => void revoke()}>Revoke NFC link</button> : null}
          </section>
        ) : null}

        <footer>{workflowProfile === "feiju_manual_ios" ? "The Feiju workflow produces a write-protected registered NFC link. It is a clonable static URL and does not prove cryptographic authenticity." : "NTAG215 provides a convenient registered identity link. It does not prove that a chip, slab, or card is cryptographically authentic."}</footer>
      </main>
      <style jsx>{`
        :global(body){margin:0;background:#f4f1e9;color:#171612;font-family:Inter,system-ui,sans-serif}.shell{max-width:1120px;margin:0 auto;padding:32px 22px 64px}header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:24px}h1{font-family:Georgia,serif;font-size:42px;margin:4px 0}h2{font-family:Georgia,serif;margin:6px 0 16px}.eyebrow{text-transform:uppercase;letter-spacing:.15em;font-size:12px;font-weight:800;color:#7d6019}.notice{display:flex;gap:14px;padding:16px 18px;border:1px solid #d6c99f;background:#fff9df;margin-bottom:20px}.notice.active{background:#eaf6ed;border-color:#8fb69a}.notice.error{background:#fff0ed;border-color:#d99b90}.profile-select{display:flex;align-items:end;gap:18px;padding:18px;background:#fff;border:1px solid #d8d2c5;margin-bottom:18px}.profile-select label{max-width:360px}.profile-select p{margin:0;color:#655f55}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.grid article,.program,.admin-actions{background:#fff;border:1px solid #d8d2c5;padding:22px;box-shadow:0 8px 24px #3a2d1010}dl{display:grid;grid-template-columns:130px 1fr;gap:9px;margin:18px 0}dt{color:#766f62}dd{margin:0;font-weight:700;overflow-wrap:anywhere}button{border:0;border-radius:4px;padding:12px 17px;background:#1b1a16;color:white;font-weight:800;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.secondary{background:#ded8ca;color:#26231c}.primary{font-size:18px;min-width:190px;background:#9b731e}.program{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:18px}.program p{max-width:680px}.pair{display:flex;align-items:end;gap:10px}label{display:grid;gap:7px;font-weight:800;flex:1}input,select{padding:11px;border:1px solid #bdb4a3;border-radius:3px;font:inherit}.danger,.admin-actions{display:flex;gap:16px;align-items:center;margin-top:18px;padding:18px;background:#fff4ee;border:1px solid #d5997f}.danger div{flex:1}.danger-button,.danger button{background:#922f20}.retry{margin-top:18px}.manual-ios{margin-top:18px;padding:22px;background:#fff;border:1px solid #d8d2c5}.manual-ios ol{display:grid;gap:10px;padding-left:24px}.manual-ios li.done{color:#2f6d3e;font-weight:800}.manual-url{display:flex;align-items:center;gap:12px;padding:14px;background:#f5f2e9;overflow-wrap:anywhere}.manual-url code{flex:1}.manual-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.manual-warning{padding:12px;background:#fff4ee;color:#6d2e21}.admin-actions label{min-width:260px}footer{margin-top:28px;padding-top:18px;border-top:1px solid #cfc7b9;color:#655f55}a{color:#77520c;font-weight:800}@media(max-width:760px){.profile-select,.manual-url{align-items:stretch;flex-direction:column}.grid{grid-template-columns:1fr}.program,.danger,.admin-actions,header{align-items:stretch;flex-direction:column}h1{font-size:34px}.pair{align-items:stretch;flex-direction:column}}
      `}</style>
    </>
  );
}
