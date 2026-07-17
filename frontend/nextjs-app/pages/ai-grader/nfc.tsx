import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  AiGraderNfcHelperError,
  acknowledgeAiGraderF8215Operation,
  clearAiGraderNfcHelperPairing,
  clearAiGraderNfcInitIdempotencyKey,
  getAiGraderNfcHelperStatus,
  getAiGraderF8215OperationStatus,
  getOrCreateAiGraderNfcInitIdempotencyKey,
  hasAiGraderNfcHelperPairing,
  pairAiGraderNfcHelper,
  prepareAiGraderF8215Job,
  readAiGraderNfcSelectedProfile,
  readAiGraderNfcInitIdempotencyKey,
  reconcileAiGraderF8215HostedActivation,
  writeAiGraderNfcTag,
  writeAiGraderNfcSelectedProfile,
  type AiGraderF8215CompletionEvidence,
  type AiGraderNfcSelectedProfile,
  type AiGraderNfcHelperStatus,
  type AiGraderNfcHelperWriteResult,
} from "../../lib/aiGraderNfcHelperClient";

type JsonRecord = Record<string, unknown>;
type Phase =
  | "loading"
  | "disabled"
  | "ready"
  | "awaiting_manual_start"
  | "verifying"
  | "writing"
  | "overwrite"
  | "active"
  | "error";

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
  activeAttemptId?: string | null;
  chipType?: "NTAG215" | "FEIJU_F8215" | null;
  securityMode?: "static_url_v1" | "ntag424_sun_v1" | null;
  registrationSemantics?: "registered_link" | "cryptographically_verified" | null;
  nfcSchemaReady: boolean;
  nfcProgrammingEnabled: boolean;
  nfcRequired: boolean;
  nfcAttemptTokenConfigured: boolean;
  nfcWorkstationAttestationConfigured: boolean;
  nfcWorkstationKeyCount: number;
  expectedNfcHelperProtocolVersion: string;
  canProgram: boolean;
  canAdmin: boolean;
};

type Reservation = {
  url: string;
  publicTagId: string;
  attemptId: string;
  attemptToken: string;
  attestationChallenge: string;
  attemptExpiresAt: string;
  chipType: "NTAG215" | "FEIJU_F8215";
  securityMode: "static_url_v1";
  programmingProfile: "ntag215_direct_pcsc_v1" | "gototags_manual_start_v1";
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

type PendingCompletion = {
  reservation: Reservation;
  write: AiGraderNfcHelperWriteResult & {
    securityMode?: "static_url_v1";
    programmingProfile?: "ntag215_direct_pcsc_v1" | "gototags_manual_start_v1";
    adapterIdentity?: "gototags_desktop";
    adapterVersion?: "4.37.0.1";
    writeProtectionState?: "permanently_read_only_verified";
  };
  idempotencyKey: string;
};

type AdminMutationRequest = { publicTagId: string; reason: string; idempotencyKey: string };

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function errorMessage(error: unknown) {
  if (error instanceof AiGraderNfcHelperError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : "The NFC operation failed safely.";
}

function reservationFrom(value: unknown, selectedProfile: AiGraderNfcSelectedProfile): Reservation {
  const row = record(value);
  const linkage = record(row.linkage ?? row.expectedLinkage);
  const result: Reservation = {
    url: typeof row.url === "string" ? row.url : typeof row.nfcTagUrl === "string" ? row.nfcTagUrl : "",
    publicTagId: typeof row.publicTagId === "string" ? row.publicTagId : "",
    attemptId: typeof row.attemptId === "string" ? row.attemptId : "",
    attemptToken: typeof row.attemptToken === "string" ? row.attemptToken : typeof row.token === "string" ? row.token : "",
    attestationChallenge: typeof row.attestationChallenge === "string" ? row.attestationChallenge : "",
    attemptExpiresAt: typeof row.attemptExpiresAt === "string" ? row.attemptExpiresAt : "",
    chipType: row.chipType === "FEIJU_F8215" ? "FEIJU_F8215" : "NTAG215",
    securityMode: "static_url_v1",
    programmingProfile:
      row.programmingProfile === "gototags_manual_start_v1"
        ? "gototags_manual_start_v1"
        : "ntag215_direct_pcsc_v1",
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
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result.attemptExpiresAt) ||
    !/^[A-Za-z0-9_-]{43}$/.test(result.attestationChallenge) ||
    result.url !== `https://collect.tenkings.co/nfc/${result.publicTagId}` ||
    (selectedProfile === "NTAG215_DIRECT_PCSC" &&
      (result.chipType !== "NTAG215" || result.programmingProfile !== "ntag215_direct_pcsc_v1")) ||
    (selectedProfile === "FEIJU_F8215_GOTOTAGS_MANUAL_START" &&
      (result.chipType !== "FEIJU_F8215" || result.programmingProfile !== "gototags_manual_start_v1"))
  ) {
    throw new Error("The hosted NFC reservation response was incomplete or unsafe.");
  }
  return result;
}

function assertF8215Completion(reservation: Reservation, evidence: AiGraderF8215CompletionEvidence) {
  const attestation = evidence.operationalAttestation;
  if (
    reservation.chipType !== "FEIJU_F8215" ||
    evidence.helperProtocolVersion !== "tenkings-ai-grader-nfc-loopback-v2" ||
    evidence.chipType !== "FEIJU_F8215" ||
    evidence.securityMode !== "static_url_v1" ||
    evidence.programmingProfile !== "gototags_manual_start_v1" ||
    evidence.adapterIdentity !== "gototags_desktop" ||
    evidence.adapterVersion !== "4.37.0.1" ||
    evidence.normalizedUrl !== reservation.url ||
    evidence.writeProtectionState !== "permanently_read_only_verified" ||
    evidence.readerResultCode !== "write_locked_verified_gototags_readback" ||
    !/^[a-f0-9]{64}$/.test(evidence.uidFingerprintSha256) ||
    !/^[a-f0-9]{64}$/.test(evidence.readbackPayloadSha256) ||
    attestation.schemaVersion !== "ai-grader-nfc-helper-attestation-v2" ||
    attestation.attestationChallenge !== reservation.attestationChallenge ||
    attestation.algorithm !== "ecdsa-p256-sha256-p1363" ||
    !/^[a-f0-9]{64}$/.test(attestation.workstationKeyId) ||
    !/^[A-Za-z0-9_-]{86}$/.test(attestation.signature)
  ) {
    throw new Error("The NFC helper did not return complete signed F8215 lock and readback evidence.");
  }
  return evidence;
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
  const [message, setMessage] = useState("Loading the published NFC task.");
  const [hosted, setHosted] = useState<HostedStatus | null>(null);
  const [helper, setHelper] = useState<AiGraderNfcHelperStatus | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<AiGraderNfcSelectedProfile>("NTAG215_DIRECT_PCSC");
  const [paired, setPaired] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [pending, setPending] = useState<PendingCompletion | null>(null);
  const [overwriteDigest, setOverwriteDigest] = useState<string | null>(null);
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
  const selectedFeiju = selectedProfile === "FEIJU_F8215_GOTOTAGS_MANUAL_START";
  const selectedProfileReady = Boolean(
    programmingReady &&
    (!selectedFeiju || helper?.goToTagsReady),
  );

  useEffect(() => {
    setSelectedProfile(readAiGraderNfcSelectedProfile());
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    const code = new URLSearchParams(hash).get("aiGraderNfcPair")?.trim() ?? "";
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(code)) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setPairingCode(code);
    setMessage("One-time workstation pairing is ready after hosted programming readiness is confirmed.");
  }, []);

  const hostedRequest = useCallback(
    async (action: "status" | "init" | "complete" | "revoke" | "replace", body?: JsonRecord) => {
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
      const isPaired = hasAiGraderNfcHelperPairing();
      setPaired(isPaired);
      if (result.chipType === "FEIJU_F8215") {
        if (!isPaired) {
          setPhase("error");
          setMessage("The hosted F8215 registration is active, but exact local cleanup is pending. Pair this workstation; the local recovery identity was preserved.");
          return;
        }
        try {
          await reconcileAiGraderF8215HostedActivation(result as HostedStatus & { status: "active" });
        } catch (error) {
          setPhase("error");
          setMessage(`${errorMessage(error)} The hosted registration remains active and the local recovery identity was preserved.`);
          return;
        }
      }
      clearAiGraderNfcInitIdempotencyKey(reportId);
      setStoredAttemptAvailable(false);
      setReservation(null);
      setPending(null);
      setOverwriteDigest(null);
      setReplacementRequest(null);
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
        : selectedProfile === "FEIJU_F8215_GOTOTAGS_MANUAL_START"
          ? "Keep the tag off the reader. Prepare the exact F8215 job first."
          : "Place one blank NTAG215 on the reader, then program the registered report link.",
    );
  }, [hostedRequest, reportId, selectedProfile]);

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
        securityMode: completion.write.securityMode ?? completion.reservation.securityMode,
        programmingProfile: completion.write.programmingProfile ?? completion.reservation.programmingProfile,
        normalizedUrl: completion.write.normalizedUrl,
        uidFingerprintSha256: completion.write.uidFingerprintSha256,
        readbackPayloadSha256: completion.write.readbackPayloadSha256,
        readerResultCode: completion.write.readerResultCode,
        helperProtocolVersion: completion.write.helperProtocolVersion,
        ...(completion.reservation.chipType === "FEIJU_F8215"
          ? {
              adapterIdentity: completion.write.adapterIdentity,
              adapterVersion: completion.write.adapterVersion,
              writeProtectionState: completion.write.writeProtectionState,
            }
          : {}),
        operationalAttestation: completion.write.operationalAttestation,
      });
      if (completion.reservation.chipType === "FEIJU_F8215") {
        const acknowledged = await acknowledgeAiGraderF8215Operation(completion.reservation.attemptId);
        if (!acknowledged.cleaned) throw new Error("The completed local F8215 job could not be cleaned safely.");
      }
      clearAiGraderNfcInitIdempotencyKey(reportId);
      setPending(null);
      setReservation(null);
      setOverwriteDigest(null);
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
        await completeHosted(completion);
      } catch (error) {
        throw error;
      }
    },
    [completeHosted],
  );

  const beginReservation = useCallback(
    async (currentReservation: Reservation) => {
      setReservation(currentReservation);
      if (currentReservation.chipType === "FEIJU_F8215") {
        setPending(null);
        setPhase("loading");
        setMessage("Preparing one protected report-specific F8215 operation. Keep the tag off the reader.");
        const prepared = await prepareAiGraderF8215Job({
          attemptId: currentReservation.attemptId,
          idempotencyKey: `prepare-${currentReservation.attemptId}`,
          publicTagId: currentReservation.publicTagId,
          attestationChallenge: currentReservation.attestationChallenge,
          url: currentReservation.url,
          attemptExpiresAt: currentReservation.attemptExpiresAt,
        });
        const acceptedPhase = ["awaiting_manual_start", "completed"].includes(prepared.phase);
        if (
          prepared.helperProtocolVersion !== "tenkings-ai-grader-nfc-loopback-v2" ||
          prepared.attemptId !== currentReservation.attemptId ||
          prepared.chipType !== "FEIJU_F8215" ||
          prepared.programmingProfile !== "gototags_manual_start_v1" ||
          !acceptedPhase
        ) {
          throw new Error("The local helper did not prepare the exact F8215 job.");
        }
        if (prepared.phase === "completed") {
          setPhase("verifying");
          setMessage("The local F8215 operation completed. Verifying and activating this same hosted attempt.");
        } else {
          setPhase("awaiting_manual_start");
          setMessage("GoToTags opened. Click Start Encoding once, then place one fresh F8215 tag on the reader.");
        }
        return;
      }
      const localKey = `write-${currentReservation.attemptId}-try-0`;
      await writeReservation(currentReservation, localKey);
    },
    [writeReservation],
  );

  useEffect(() => {
    if (
      !reservation ||
      reservation.chipType !== "FEIJU_F8215" ||
      !paired ||
      pending ||
      !["awaiting_manual_start", "verifying"].includes(phase)
    ) return;
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const status = await getAiGraderF8215OperationStatus(reservation.attemptId);
        if (cancelled) return;
        if (
          status.helperProtocolVersion !== "tenkings-ai-grader-nfc-loopback-v2" ||
          status.attemptId !== reservation.attemptId ||
          status.chipType !== "FEIJU_F8215" ||
          status.programmingProfile !== "gototags_manual_start_v1"
        ) throw new Error("The local F8215 operation status did not match this hosted attempt.");
        if (status.phase === "completed") {
          if (!status.terminal || !status.evidence) throw new Error("The local F8215 completion evidence was incomplete.");
          const evidence = assertF8215Completion(reservation, status.evidence);
          const completion: PendingCompletion = {
            reservation,
            write: evidence,
            idempotencyKey: `complete-${reservation.attemptId}`,
          };
          setPhase("verifying");
          setMessage("Write, exact URL verification, permanent locking, and final readback passed. Activating the registration.");
          setPending(completion);
          await completeHosted(completion);
          return;
        }
        if (status.phase === "failed" || status.phase === "uncertain" || status.terminal) {
          throw new Error(
            status.phase === "uncertain"
              ? "The F8215 result is uncertain. Keep this exact tag separated and recover this same attempt; do not start another tag."
              : `The F8215 job failed safely${status.errorCode ? ` (${status.errorCode})` : ""}.`,
          );
        }
      } catch (error) {
        if (!cancelled) {
          setPhase("error");
          setMessage(errorMessage(error));
          return;
        }
      } finally {
        inFlight = false;
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1_000);
    };
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [completeHosted, paired, pending, phase, reservation]);

  const program = async () => {
    try {
      if (!hosted?.nfcProgrammingEnabled) throw new Error("NFC programming is disabled by server policy.");
      if (!programmingReady) {
        throw new Error("NFC programming is not fully configured.");
      }
      if (selectedFeiju && !helper?.goToTagsReady) {
        throw new Error(`The F8215 workstation adapter is not ready${helper?.goToTagsErrorCode ? ` (${helper.goToTagsErrorCode})` : ""}.`);
      }
      if (!paired) throw new Error("Pair the dedicated NFC helper first.");
      const initIdempotencyKey = getOrCreateAiGraderNfcInitIdempotencyKey(reportId);
      setStoredAttemptAvailable(true);
      const currentReservation = reservationFrom(
        await hostedRequest("init", {
          reportId,
          idempotencyKey: initIdempotencyKey,
          ...(selectedProfile === "FEIJU_F8215_GOTOTAGS_MANUAL_START"
            ? {
                chipType: "FEIJU_F8215",
                programmingProfile: "gototags_manual_start_v1",
                operatorFreshInventoryConfirmation: "operator_fresh_inventory_confirmation_v1",
              }
            : { chipType: "NTAG215", programmingProfile: "ntag215_direct_pcsc_v1" }),
        }),
        selectedProfile,
      );
      await beginReservation(currentReservation);
    } catch (error) {
      if (error instanceof Error && error.name === "AI_GRADER_NFC_ATTEMPT_EXPIRED") {
        clearAiGraderNfcInitIdempotencyKey(reportId);
        setStoredAttemptAvailable(false);
        setReservation(null);
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
      setMessage(
        selectedFeiju
          ? "NFC helper paired. Keep the F8215 tag off the reader until the protected job opens."
          : "NFC helper paired. Place one blank NTAG215 on the reader.",
      );
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const replace = async () => {
    try {
      if (!selectedProfileReady) {
        throw new Error(selectedFeiju ? "The F8215 workstation adapter is not ready." : "NFC programming is not fully configured.");
      }
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
      const reservation = reservationFrom(
        await hostedRequest("replace", {
          reportId,
          replacedPublicTagId: request.publicTagId,
          reason: request.reason,
          idempotencyKey: request.idempotencyKey,
          ...(selectedProfile === "FEIJU_F8215_GOTOTAGS_MANUAL_START"
            ? {
                chipType: "FEIJU_F8215",
                programmingProfile: "gototags_manual_start_v1",
                operatorFreshInventoryConfirmation: "operator_fresh_inventory_confirmation_v1",
              }
            : { chipType: "NTAG215", programmingProfile: "ntag215_direct_pcsc_v1" }),
        }),
        selectedProfile,
      );
      setReason("");
      await beginReservation(reservation);
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

  const busy = ["writing", "verifying", "loading"].includes(phase);
  const f8215TerminalEvidenceReceived = selectedFeiju && (phase === "verifying" || phase === "active");
  const f8215Progress = [
    { label: "Waiting for GoToTags Start", complete: f8215TerminalEvidenceReceived, current: phase === "awaiting_manual_start" },
    { label: "Verified, permanently locked, and read back", complete: f8215TerminalEvidenceReceived, current: false },
    { label: "Activating registration", complete: phase === "active", current: phase === "verifying" },
  ];

  return (
    <>
      <Head><title>Program NFC | Ten Kings AI Grader</title><meta name="robots" content="noindex,nofollow" /></Head>
      <main className="shell">
        <header>
          <div><p className="eyebrow">Ten Kings AI Grader</p><h1>Program slab NFC</h1></div>
          <Link href={`/ai-grader/finish${reportId ? `?reportId=${encodeURIComponent(reportId)}` : ""}`}>Back to Finish</Link>
        </header>

        <section className={`notice ${phase}`} aria-live="polite">
          {phase === "active" ? <span className="success-check" aria-hidden="true">✓</span> : null}
          <strong>{phase === "active" ? "Verified / active" : phase.replace(/_/g, " ")}</strong>
          <span>{message}</span>
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
            <p className="eyebrow">Dedicated workstation helper</p>
            <h2>{!programmingReady ? hosted?.nfcProgrammingEnabled ? "Programming not configured" : "Programming disabled" : paired ? helper?.readerConnected ? "Reader connected" : "Paired / reader unavailable" : "Pair workstation"}</h2>
            {!programmingReady ? (
              <p>The browser will not contact the loopback helper while hosted programming is disabled or incomplete.</p>
            ) : paired ? (
              <>
                <dl>
                  <dt>PC/SC</dt><dd>{helper?.pcscReady ? "Ready" : "Not ready"}</dd>
                  <dt>Tag</dt><dd>{helper?.tagState ?? "unknown"}</dd>
                  <dt>Reader</dt><dd>{helper?.readerModel ?? "ACR1552U-compatible PC/SC reader"}</dd>
                  <dt>Helper</dt><dd>{helper?.helperProtocolVersion ?? "Checking"}</dd>
                  <dt>F8215 adapter</dt><dd>{helper?.goToTagsReady ? "Ready" : `Unavailable${helper?.goToTagsErrorCode ? ` (${helper.goToTagsErrorCode})` : ""}`}</dd>
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

        <section className="profile-select">
          <div>
            <p className="eyebrow">Supported tag profile</p>
            <h2>Choose the tag being programmed</h2>
          </div>
          <select
            aria-label="NFC tag profile"
            value={selectedProfile}
            disabled={busy || storedAttemptAvailable || hosted?.status === "active"}
            onChange={(event) => {
              const next = event.target.value === "FEIJU_F8215_GOTOTAGS_MANUAL_START"
                ? "FEIJU_F8215_GOTOTAGS_MANUAL_START"
                : "NTAG215_DIRECT_PCSC";
              setSelectedProfile(next);
              writeAiGraderNfcSelectedProfile(next);
              setMessage(
                next === "FEIJU_F8215_GOTOTAGS_MANUAL_START"
                  ? "Keep the tag off the reader. Prepare the exact F8215 job first."
                  : "Place one blank NTAG215 on the reader, then program the registered report link.",
              );
            }}
          >
            <option value="NTAG215_DIRECT_PCSC">NTAG215 — native helper</option>
            <option value="FEIJU_F8215_GOTOTAGS_MANUAL_START">
              Feiju F8215 — GoToTags
            </option>
          </select>
        </section>

        <section className="program">
          <div>
            <p className="eyebrow">One tag / one report</p>
            <h2>{selectedFeiju ? "Keep the fresh F8215 tag off the reader" : "Place one blank NTAG215"}</h2>
            <p>
              {selectedFeiju
                ? "Prepare opens one exact report-specific GoToTags job. In GoToTags, click Start Encoding once and then place the fresh tag. The job writes, verifies, permanently locks, and verifies again. Permanent locking cannot be undone."
                : "The helper writes only the exact Ten Kings URL, verifies full readback, and never locks or configures the tag."}
            </p>
            {selectedFeiju ? (
              <ul className="fresh-sop">
                <li>Take exactly one unused F8215 from the controlled unused-tag supply.</li>
                <li>Keep it off the reader until GoToTags requests it.</li>
                <li>Never return a failed, interrupted, uncertain, previously presented, written, or locked tag to unused inventory.</li>
                <li>Put every failed or uncertain tag in the separate quarantine container.</li>
                <li>This confirmation is an audited operator inventory assertion. Ten Kings and GoToTags do not electronically prove blankness.</li>
              </ul>
            ) : null}
          </div>
          <button
            type="button"
            className="primary"
            disabled={
              busy ||
              !paired ||
              hosted?.status === "active" ||
              !hosted?.canProgram ||
              !selectedProfileReady ||
              storedAttemptAvailable
            }
            onClick={() => void program()}
          >
            {phase === "writing"
              ? "Writing"
              : phase === "verifying"
                ? "Verifying"
                : phase === "awaiting_manual_start"
                  ? "Waiting for GoToTags Start"
                  : selectedFeiju
                    ? "Confirm Fresh F8215 & Prepare"
                    : "Program NFC"}
          </button>
        </section>

        {selectedFeiju && reservation ? (
          <ol className="f8215-progress" aria-label="F8215 NFC job progress">
            {f8215Progress.map((step) => (
              <li key={step.label} className={step.complete ? "complete" : step.current ? "current" : "pending"} aria-current={step.current ? "step" : undefined}>
                <span aria-hidden="true">{step.complete ? "✓" : step.current ? "●" : "○"}</span>{step.label}
              </li>
            ))}
          </ol>
        ) : null}

        {phase === "overwrite" && reservation && overwriteDigest ? (
          <section className="danger">
            <div><strong>Different content detected</strong><p>Overwrite only this exact observed payload. The existing content is not silently reassigned.</p></div>
            <button type="button" onClick={() => void confirmOverwrite()}>Confirm overwrite once</button>
          </section>
        ) : null}

        {pending && phase === "error" && pending.write.normalizedUrl ? (
          <button type="button" className="secondary retry" onClick={() => void retryHostedVerification()}>Retry hosted verification</button>
        ) : null}


        {hosted?.canAdmin && hosted.publicTagId && hosted.status !== "missing" ? (
          <section className="admin-actions">
            <label>Required audit reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={240} /></label>
            {programmingReady ? <button type="button" className="secondary" onClick={() => void replace()}>{hosted.status === "revoked" ? "Program authorized replacement" : "Revoke and program replacement"}</button> : null}
            {hosted.status !== "revoked" ? <button type="button" className="danger-button" onClick={() => void revoke()}>Revoke NFC link</button> : null}
          </section>
        ) : null}

        <footer>A registered NFC link is a convenient identity link. F8215 adds permanent consumer write protection; neither profile proves that a chip, slab, or card is cryptographically authentic.</footer>
      </main>
      <style jsx>{`
        :global(body){margin:0;background:#f4f1e9;color:#171612;font-family:Inter,system-ui,sans-serif}.shell{max-width:1120px;margin:0 auto;padding:32px 22px 64px}header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:24px}h1{font-family:Georgia,serif;font-size:42px;margin:4px 0}h2{font-family:Georgia,serif;margin:6px 0 16px}.eyebrow{text-transform:uppercase;letter-spacing:.15em;font-size:12px;font-weight:800;color:#7d6019}.notice{display:flex;align-items:center;gap:14px;padding:16px 18px;border:1px solid #d6c99f;background:#fff9df;margin-bottom:20px}.notice.active{background:#eaf6ed;border-color:#5c9f6c}.notice.error{background:#fff0ed;border-color:#d99b90}.success-check{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:#16813a;color:#fff;font-size:34px;font-weight:900}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.grid article,.program,.profile-select,.admin-actions{background:#fff;border:1px solid #d8d2c5;padding:22px;box-shadow:0 8px 24px #3a2d1010}dl{display:grid;grid-template-columns:130px 1fr;gap:9px;margin:18px 0}dt{color:#766f62}dd{margin:0;font-weight:700;overflow-wrap:anywhere}button{border:0;border-radius:4px;padding:12px 17px;background:#1b1a16;color:white;font-weight:800;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.secondary{background:#ded8ca;color:#26231c}.primary{font-size:18px;min-width:220px;background:#9b731e}.program,.profile-select{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:18px}.program p{max-width:680px}.fresh-sop{max-width:700px;padding-left:20px;color:#4e483e}.fresh-sop li{margin:5px 0}.profile-select select{min-width:300px;padding:12px;border:1px solid #bdb4a3;background:#fff;font:inherit;font-weight:800}.f8215-progress{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0 0;padding:16px 18px;list-style:none;background:#fff;border:1px solid #d8d2c5}.f8215-progress li{display:flex;align-items:center;gap:8px;color:#716a5e;font-weight:750}.f8215-progress .complete{color:#16813a}.f8215-progress .current{color:#77520c}.pair{display:flex;align-items:end;gap:10px}label{display:grid;gap:7px;font-weight:800;flex:1}input{padding:11px;border:1px solid #bdb4a3;border-radius:3px;font:inherit}.danger,.admin-actions{display:flex;gap:16px;align-items:center;margin-top:18px;padding:18px;background:#fff4ee;border:1px solid #d5997f}.danger div{flex:1}.danger-button,.danger button{background:#922f20}.retry{margin-top:18px}.admin-actions label{min-width:260px}footer{margin-top:28px;padding-top:18px;border-top:1px solid #cfc7b9;color:#655f55}a{color:#77520c;font-weight:800}@media(max-width:760px){.grid{grid-template-columns:1fr}.program,.profile-select,.danger,.admin-actions,header{align-items:stretch;flex-direction:column}.profile-select select{min-width:0;width:100%}.f8215-progress{grid-template-columns:1fr}h1{font-size:34px}.pair{align-items:stretch;flex-direction:column}}
      `}</style>
    </>
  );
}
