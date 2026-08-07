import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import {
  acknowledgeTenKingsV2NfcDiscard,
  acknowledgeTenKingsV2NfcSuccess,
  AiGraderNfcHelperError,
  consumeAiGraderNfcLauncherFragment,
  getAiGraderNfcHelperStatus,
  getTenKingsV2NfcOperationStatus,
  hasAiGraderNfcHelperPairing,
  pairAiGraderNfcHelper,
  prepareTenKingsV2NfcOperation,
  type AiGraderNfcHelperStatus,
  type TenKingsV2NfcLocalOperation,
} from "../../lib/aiGraderNfcHelperClient";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  claimTenKingsV2AutomaticTerminalAttempt,
  reconcileMissingTenKingsV2LocalOperation,
  tenKingsV2ClosingRecovery,
  tenKingsV2ExactKeySetMatches,
  tenKingsV2HelperSignerAllowed,
  tenKingsV2LocalOperationMatchesStored,
  tenKingsV2MayClearUnstartedExpiredProvisional,
  tenKingsV2NfcRecoveryDecision,
  tenKingsV2PermanentCompletionRejection,
  tenKingsV2ProvisionalRecoveryAction,
  type TenKingsV2NfcRecoveryCardFact,
} from "../../lib/tenKingsV2NfcBrowserState";
import styles from "../../styles/NfcV2.module.css";

type Card = {
  id: string;
  publicToken: string;
  permanentUrl: string;
  lifecycleState: string;
  category: string;
  displayName: string;
  year: string;
  manufacturer: string | null;
  productSet: string;
  parallel: string | null;
  cardNumber: string | null;
  certificateNumber: string | null;
  grade: string;
  nfcVerifiedAt: string | null;
  nfcVerifiedByWorkstationId: string | null;
};

type Readiness = {
  configured: boolean;
  programmingEnabled: boolean;
  currentJobSigningKeyId: string | null;
  trustedJobSigningKeyIds: string[];
  trustedJobSigningKeyCount: number;
  workstationKeyIds: string[];
  workstationKeyCount: number;
  expectedHelperVersion: string;
  expectedHelperProtocolVersion: string;
  expectedHelperCapability: string;
  v1Compatible: boolean;
};

type StoredOperation = {
  cardId: string;
  job: Record<string, string>;
  jobEnvelopeSha256: string;
  helperPrepared: boolean;
  automaticTerminalAttempts: string[];
  discardAcknowledgement?: {
    jobEnvelopeSha256: string;
    acknowledgementNonce: string;
    phase: "failed" | "uncertain" | "completed_unrecorded";
  };
};
const STORED_OPERATION = "tenkings.nfc.v2.activeOperation.v1";
const SHA256 = /^[a-f0-9]{64}$/;

const readStoredOperation = (): StoredOperation | null => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORED_OPERATION) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    if (
      typeof row.cardId !== "string" ||
      !row.job || typeof row.job !== "object" || Array.isArray(row.job) ||
      Object.values(row.job).some((value) => typeof value !== "string") ||
      (row.job as Record<string, unknown>).cardId !== row.cardId ||
      typeof row.jobEnvelopeSha256 !== "string" || !SHA256.test(row.jobEnvelopeSha256) ||
      typeof row.helperPrepared !== "boolean" ||
      !Array.isArray(row.automaticTerminalAttempts) ||
      row.automaticTerminalAttempts.length > 4 ||
      row.automaticTerminalAttempts.some((value) => typeof value !== "string" || value.length > 120)
    ) return null;
    const discard = row.discardAcknowledgement;
    if (discard !== undefined) {
      if (!discard || typeof discard !== "object" || Array.isArray(discard)) return null;
      const acknowledgement = discard as Record<string, unknown>;
      if (
        acknowledgement.jobEnvelopeSha256 !== row.jobEnvelopeSha256 ||
        typeof acknowledgement.acknowledgementNonce !== "string" ||
        !/^[A-Za-z0-9_-]{32}$/.test(acknowledgement.acknowledgementNonce) ||
        (acknowledgement.phase !== "failed" && acknowledgement.phase !== "uncertain" && acknowledgement.phase !== "completed_unrecorded")
      ) return null;
    }
    return row as StoredOperation;
  } catch {
    return null;
  }
};

const safeMessage = (error: unknown) => error instanceof Error ? error.message : "The NFC operation stopped safely.";

class HostedNfcError extends Error {
  constructor(public readonly code: string | null, public readonly status: number, message: string) {
    super(message);
    this.name = "HostedNfcError";
  }
}

const permanentCompletionRejection = (error: unknown) =>
  error instanceof HostedNfcError &&
  tenKingsV2PermanentCompletionRejection(error.status, error.code);

export default function TenKingsNfcV2Page() {
  const router = useRouter();
  const { session, loading, ensureSession } = useSession();
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [helper, setHelper] = useState<AiGraderNfcHelperStatus | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [results, setResults] = useState<Card[]>([]);
  const [query, setQuery] = useState("");
  const [operation, setOperation] = useState<TenKingsV2NfcLocalOperation | null>(null);
  const [job, setJob] = useState<Record<string, string> | null>(null);
  const [freshConfirmed, setFreshConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Choose a permanent V2 card to begin.");
  const [launcherReady, setLauncherReady] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [completedUnrecorded, setCompletedUnrecorded] = useState(false);
  const [pollRevision, setPollRevision] = useState(0);
  const [storedPointerBlocked, setStoredPointerBlocked] = useState(false);
  const [recoveryCardUnavailable, setRecoveryCardUnavailable] = useState(false);
  const pairingCodeRef = useRef("");
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone],
  );
  const selectedCardId = typeof router.query.card === "string" ? router.query.card : "";

  const hosted = useCallback(async <T,>(path: string, init?: RequestInit) => {
    if (!session?.token) throw new Error("Sign in to use NFC V2.");
    const response = await fetch(`/api/v2/admin/nfc/${path}`, {
      cache: "no-store",
      ...init,
      headers: buildAdminHeaders(session.token, init?.body ? { "Content-Type": "application/json" } : undefined),
    });
    const payload = await response.json().catch(() => ({})) as T & { message?: string; code?: string };
    if (!response.ok) throw new HostedNfcError(
      typeof payload.code === "string" ? payload.code : null,
      response.status,
      payload.message ?? "NFC V2 request failed.",
    );
    return payload;
  }, [session?.token]);

  const loadCard = useCallback(async (cardId: string) => {
    const payload = await hosted<{ card: Card }>(`card?cardId=${encodeURIComponent(cardId)}`);
    setCard(payload.card);
    setRecoveryCardUnavailable(false);
    setResults([]);
    setMessage(payload.card.nfcVerifiedAt ? "This card has a verified informational NFC fact. You may write the same permanent URL to a replacement tag." : "Card ready. NFC is optional and does not affect its grade or inventory state.");
    return payload.card;
  }, [hosted]);

  const loadRecoveryCard = useCallback(async (cardId: string) => {
    try {
      return await loadCard(cardId);
    } catch (error) {
      if (!(error instanceof HostedNfcError) || error.status !== 404) throw error;
      setCard(null);
      setResults([]);
      setRecoveryCardUnavailable(true);
      return null;
    }
  }, [loadCard]);

  const loadRecoveryCardFact = useCallback(async (cardId: string) => {
    const payload = await hosted<{ fact: TenKingsV2NfcRecoveryCardFact | null }>("recovery-card-fact", {
      method: "POST",
      body: JSON.stringify({ cardId }),
    });
    if (payload.fact !== null && payload.fact.id !== cardId) {
      throw new Error("The hosted NFC recovery fact did not match the exact saved card identity.");
    }
    return payload.fact;
  }, [hosted]);

  const decideMissingHelperRecovery = useCallback(async (stored: StoredOperation, helperStatusErrorCode: string) => {
    const withoutCard = tenKingsV2NfcRecoveryDecision(stored, {
      localOperation: null,
      helperStatusErrorCode,
      cardFact: null,
      ordinaryCard: null,
    });
    if (withoutCard === "CLEAR_DISCARD_ACK") {
      return { decision: withoutCard, recoveryFact: null, authoritativeCard: null };
    }
    const [recoveryFact, authoritativeCard] = await Promise.all([
      loadRecoveryCardFact(stored.cardId),
      loadRecoveryCard(stored.cardId),
    ]);
    return {
      decision: tenKingsV2NfcRecoveryDecision(stored, {
        localOperation: null,
        helperStatusErrorCode,
        cardFact: recoveryFact,
        ordinaryCard: authoritativeCard,
      }),
      recoveryFact,
      authoritativeCard,
    };
  }, [loadRecoveryCard, loadRecoveryCardFact]);

  useEffect(() => {
    const launch = consumeAiGraderNfcLauncherFragment({
      hash: window.location.hash,
      pathname: window.location.pathname,
      search: window.location.search,
      replaceUrl: (url) => window.history.replaceState(null, "", url),
    });
    pairingCodeRef.current = launch.pairingCode;
    setLauncherReady(true);
  }, []);

  useEffect(() => {
    if (!session?.token || !isAdmin || !launcherReady) return;
    void (async () => {
      try {
        const status = await hosted<{ readiness: Readiness }>("status");
        setReadiness(status.readiness);
        const rawStored = window.localStorage.getItem(STORED_OPERATION);
        const stored = readStoredOperation();
        if (rawStored !== null && !stored) {
          setStoredPointerBlocked(true);
          throw new Error("The protected NFC browser pointer is invalid. It was preserved and must be reviewed before another job can be issued.");
        }
        if (hasAiGraderNfcHelperPairing()) {
          setHelper(await getAiGraderNfcHelperStatus());
        } else if (pairingCodeRef.current) {
          setHelper(await pairAiGraderNfcHelper(pairingCodeRef.current));
          pairingCodeRef.current = "";
        }
        if (stored) {
          setJob(stored.job);
          try {
            // The helper is the physical-operation authority. Recover it before
            // asking the hosted non-VOID card endpoint about this old pointer.
            const local = await getTenKingsV2NfcOperationStatus(stored.jobEnvelopeSha256);
            if (tenKingsV2NfcRecoveryDecision(stored, {
              localOperation: local,
              helperStatusErrorCode: null,
              cardFact: null,
              ordinaryCard: null,
            }) !== "RECOVER_EXACT_LOCAL") {
              throw new Error("Recovered helper state does not match the exact issued card and job.");
            }
            if (!stored.helperPrepared) {
              window.localStorage.setItem(STORED_OPERATION, JSON.stringify({ ...stored, helperPrepared: true } satisfies StoredOperation));
            }
            setOperation(local);
            const authoritativeCard = await loadRecoveryCard(stored.cardId);
            if (
              authoritativeCard &&
              local.phase === "completed" &&
              reconcileMissingTenKingsV2LocalOperation(stored, {
                id: authoritativeCard.id,
                nfcVerifiedAt: authoritativeCard.nfcVerifiedAt,
              }) === "verified"
            ) {
              await acknowledgeTenKingsV2NfcSuccess(local.jobEnvelopeSha256);
              window.localStorage.removeItem(STORED_OPERATION);
              setJob(null);
              setOperation(null);
              setMessage("Hosted NFC verification was already saved. Exact protected workstation cleanup completed during recovery.");
              return;
            }
            const recoveredAttemptKey = `${local.jobEnvelopeSha256}:${local.phase}`;
            if (stored.automaticTerminalAttempts.includes(recoveredAttemptKey)) {
              setTerminalError("The earlier automatic terminal request did not finish visibly.");
              setMessage("Protected NFC terminal state recovered. Use Retry this exact operation; no automatic loop will run.");
            } else if (!authoritativeCard) {
              setMessage("The original card is missing or voided. The exact protected tag operation is still shown below; finish its bounded recovery, then discard the tag if hosted recording is permanently rejected.");
            } else {
              setMessage(local.phase === "completed" ? "Verified local result recovered. Completing the hosted card fact now." : "Protected NFC operation recovered after reload.");
            }
          } catch (error) {
            if (error instanceof AiGraderNfcHelperError && error.code === "v2_nfc_job_not_found") {
              const { decision, authoritativeCard } = await decideMissingHelperRecovery(stored, error.code);
              if (decision === "CLEAR_VERIFIED" || decision === "CLEAR_DISCARD_ACK") {
                window.localStorage.removeItem(STORED_OPERATION);
                setJob(null);
                setOperation(null);
                setMessage(decision === "CLEAR_VERIFIED"
                  ? "NFC verification was already saved. The completed local operation was safely cleaned up."
                  : "The explicitly acknowledged failed tag was already cleaned up. The stale browser pointer was safely removed.");
              } else if (decision === "PREPARE_EXACT_JOB") {
                if (!authoritativeCard) throw new Error("The card became unavailable before exact-job recovery. The helper was not contacted.");
                let resumed: TenKingsV2NfcLocalOperation;
                try {
                  resumed = await prepareTenKingsV2NfcOperation(stored.job);
                } catch (prepareError) {
                  if (
                    prepareError instanceof AiGraderNfcHelperError &&
                    tenKingsV2MayClearUnstartedExpiredProvisional(stored, {
                      helperStatusErrorCode: error.code,
                      helperPrepareErrorCode: prepareError.code,
                      localOperation: null,
                      now: new Date(),
                    })
                  ) {
                    window.localStorage.removeItem(STORED_OPERATION);
                    setStoredPointerBlocked(false);
                    setJob(null);
                    setOperation(null);
                    setMessage("The helper proved the exact signed job was absent and expired before preparation, so the unstarted browser pointer was removed.");
                    return;
                  }
                  throw prepareError;
                }
                if (tenKingsV2ProvisionalRecoveryAction(stored, resumed) !== "ACCEPT_EXACT_HELPER_STATE") {
                  throw new Error("The helper did not resume the exact issued NFC job.");
                }
                window.localStorage.setItem(STORED_OPERATION, JSON.stringify({ ...stored, helperPrepared: true } satisfies StoredOperation));
                setOperation(resumed);
                setMessage("The exact issued NFC job was safely resumed after the earlier response was lost.");
              } else {
                if (!authoritativeCard) {
                  setCard(null);
                  setResults([]);
                  setRecoveryCardUnavailable(true);
                  setFreshConfirmed(false);
                  setMessage("The saved card is missing or voided and has no exact discard or hosted verification proof. Recovery is blocked; the helper was not prepared and the browser pointer remains preserved.");
                  return;
                }
                throw new Error("The exact helper-404 recovery facts did not authorize preparation. Browser state was preserved for admin review.");
              }
            } else {
              throw error;
            }
          }
          return;
        }
        if (selectedCardId) await loadCard(selectedCardId);
      } catch (error) {
        setMessage(safeMessage(error));
      }
    })();
  }, [decideMissingHelperRecovery, hosted, isAdmin, launcherReady, loadCard, loadRecoveryCard, selectedCardId, session?.token]);

  const completeHosted = useCallback(async (activeJob: Record<string, string>, local: TenKingsV2NfcLocalOperation) => {
    if (!local.result) return;
    setBusy(true);
    setTerminalError(null);
    try {
      const completed = await hosted<{ outcome: string; nfcVerifiedAt: string }>("complete", {
        method: "POST",
        body: JSON.stringify({ job: activeJob, result: local.result }),
      });
      await acknowledgeTenKingsV2NfcSuccess(local.jobEnvelopeSha256);
      window.localStorage.removeItem(STORED_OPERATION);
      setStoredPointerBlocked(false);
      setOperation(null);
      setJob(null);
      setFreshConfirmed(false);
      setCompletedUnrecorded(false);
      if (card) await loadCard(card.id);
      setMessage(completed.outcome === "UPDATED" ? "NFC verified. The permanent card URL was read back and permanently locked." : "NFC result safely replayed. The existing verification fact was unchanged.");
    } catch (error) {
      setTerminalError(safeMessage(error));
      setCompletedUnrecorded(permanentCompletionRejection(error));
      setMessage(permanentCompletionRejection(error)
        ? `${safeMessage(error)} No card row or ownership history was changed. You may retry, or explicitly remove and discard this completed but unrecorded tag.`
        : `${safeMessage(error)} The signed result is preserved. Use Retry; transient failures never default to discard.`);
    } finally {
      setBusy(false);
    }
  }, [card, hosted, loadCard]);

  const finishSuccessCleanup = useCallback(async (local: TenKingsV2NfcLocalOperation) => {
    setBusy(true);
    setTerminalError(null);
    try {
      await acknowledgeTenKingsV2NfcSuccess(local.jobEnvelopeSha256);
      window.localStorage.removeItem(STORED_OPERATION);
      setStoredPointerBlocked(false);
      setOperation(null);
      setJob(null);
      setFreshConfirmed(false);
      if (card) await loadCard(card.id);
      setMessage("NFC verification was already saved. Protected workstation cleanup is complete.");
    } catch (error) {
      setTerminalError(safeMessage(error));
      setMessage(`${safeMessage(error)} Cleanup remains protected and will resume after reload.`);
    } finally {
      setBusy(false);
    }
  }, [card, loadCard]);

  const finishDiscardCleanup = useCallback(async (
    local: TenKingsV2NfcLocalOperation,
    explicitPhase?: "failed" | "uncertain" | "completed_unrecorded",
  ) => {
    if (!local.discardAcknowledgementNonce) return;
    const closing = tenKingsV2ClosingRecovery(local.phase);
    const phase = explicitPhase ?? (closing?.kind === "discard" ? closing.phase : local.phase);
    if (phase !== "failed" && phase !== "uncertain" && phase !== "completed_unrecorded") return;
    setBusy(true);
    try {
      const stored = readStoredOperation();
      if (!stored || stored.jobEnvelopeSha256 !== local.jobEnvelopeSha256) {
        throw new Error("The protected browser operation does not match this discard acknowledgement.");
      }
      window.localStorage.setItem(STORED_OPERATION, JSON.stringify({
        ...stored,
        discardAcknowledgement: {
          jobEnvelopeSha256: local.jobEnvelopeSha256,
          acknowledgementNonce: local.discardAcknowledgementNonce,
          phase,
        },
      } satisfies StoredOperation));
      await acknowledgeTenKingsV2NfcDiscard({
        jobEnvelopeSha256: local.jobEnvelopeSha256,
        acknowledgementNonce: local.discardAcknowledgementNonce,
        phase,
      });
      window.localStorage.removeItem(STORED_OPERATION);
      setStoredPointerBlocked(false);
      setOperation(null);
      setJob(null);
      setFreshConfirmed(false);
      setCompletedUnrecorded(false);
      setMessage(phase === "completed_unrecorded"
        ? "Completed but unrecorded tag discarded. No NFC verification row or ownership history was created."
        : "Discard acknowledged. The failed tag was not recorded. Select a fresh tag only when you are ready to begin a new operation.");
    } catch (error) {
      setMessage(`${safeMessage(error)} Cleanup remains protected and will resume after reload.`);
    } finally {
      setBusy(false);
    }
  }, []);

  const claimAutomaticTerminalAttempt = useCallback((local: TenKingsV2NfcLocalOperation) => {
    const stored = readStoredOperation();
    if (!stored || !tenKingsV2LocalOperationMatchesStored(stored, local)) return false;
    const claim = claimTenKingsV2AutomaticTerminalAttempt(stored, local.phase);
    if (!claim.claimed) return false;
    window.localStorage.setItem(STORED_OPERATION, JSON.stringify({
      ...stored,
      automaticTerminalAttempts: claim.attempts,
    } satisfies StoredOperation));
    return true;
  }, []);

  useEffect(() => {
    if (!operation || !job || busy) return;
    if (operation.phase === "completed") {
      if (claimAutomaticTerminalAttempt(operation)) {
        void completeHosted(job, operation);
      }
      return;
    }
    const closing = tenKingsV2ClosingRecovery(operation.phase);
    if (closing?.kind === "success") {
      if (claimAutomaticTerminalAttempt(operation)) {
        void finishSuccessCleanup(operation);
      }
      return;
    }
    if (closing?.kind === "discard") {
      if (claimAutomaticTerminalAttempt(operation)) {
        void finishDiscardCleanup(operation);
      }
      return;
    }
    if (operation.phase === "failed" || operation.phase === "uncertain") {
      setMessage("NFC tag failed. Remove and discard it, then acknowledge below. Do not try this tag again.");
      return;
    }
    pollingRef.current = setTimeout(() => {
      void getTenKingsV2NfcOperationStatus(operation.jobEnvelopeSha256)
        .then((next) => {
          setPollError(null);
          setOperation(next);
        })
        .catch((error) => {
          setPollError(safeMessage(error));
          setMessage(`${safeMessage(error)} Polling will continue for this exact operation.`);
          pollingRef.current = setTimeout(() => setPollRevision((value) => value + 1), 1200);
        });
    }, 1200);
    return () => { if (pollingRef.current) clearTimeout(pollingRef.current); };
  }, [busy, claimAutomaticTerminalAttempt, completeHosted, finishDiscardCleanup, finishSuccessCleanup, job, operation, pollRevision]);

  const retryCurrent = async () => {
    if (!operation || !job || busy) return;
    if (operation.phase === "completed") return completeHosted(job, operation);
    const closing = tenKingsV2ClosingRecovery(operation.phase);
    if (closing?.kind === "success") return finishSuccessCleanup(operation);
    if (closing?.kind === "discard") return finishDiscardCleanup(operation);
    setPollError(null);
    setBusy(true);
    try {
      setOperation(await getTenKingsV2NfcOperationStatus(operation.jobEnvelopeSha256));
    } catch (error) {
      setPollError(safeMessage(error));
      setMessage(safeMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    setBusy(true);
    try {
      const payload = await hosted<{ cards: Card[] }>(`cards?q=${encodeURIComponent(query.trim())}`);
      setResults(payload.cards);
      setMessage(payload.cards.length ? "Select the exact permanent card." : "No matching permanent V2 cards found.");
    } catch (error) {
      setMessage(safeMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const prepare = async () => {
    if (!card || !freshConfirmed || operation) return;
    setBusy(true);
    try {
      if (window.localStorage.getItem(STORED_OPERATION) !== null) {
        throw new Error("Recover the existing protected NFC job before issuing another one.");
      }
      const issued = await hosted<{ job: Record<string, string>; jobEnvelopeSha256: string }>("issue", {
        method: "POST",
        body: JSON.stringify({ cardId: card.id }),
      });
      if (!SHA256.test(issued.jobEnvelopeSha256) || issued.job.cardId !== card.id) {
        throw new Error("The hosted NFC issue response did not match the selected permanent card.");
      }
      const provisional = {
        cardId: card.id,
        job: issued.job,
        jobEnvelopeSha256: issued.jobEnvelopeSha256,
        helperPrepared: false,
        automaticTerminalAttempts: [],
      } satisfies StoredOperation;
      // Persist the exact server-issued pointer before contacting the helper. A
      // lost prepare response can then only resume this same digest.
      window.localStorage.setItem(STORED_OPERATION, JSON.stringify(provisional));
      setStoredPointerBlocked(false);
      setJob(issued.job);
      const local = await prepareTenKingsV2NfcOperation(issued.job);
      if (tenKingsV2ProvisionalRecoveryAction(provisional, local) !== "ACCEPT_EXACT_HELPER_STATE") {
        throw new Error("The helper prepared a different NFC job than the hosted issue response.");
      }
      window.localStorage.setItem(STORED_OPERATION, JSON.stringify({
        ...provisional,
        helperPrepared: true,
      } satisfies StoredOperation));
      setOperation(local);
      setMessage("GoToTags is prepared. Click Start Encoding once in GoToTags, then place the one fresh F8215 on the reader.");
    } catch (error) {
      setMessage(`${safeMessage(error)} The exact issued job pointer is preserved; use Retry exact issued job.`);
    } finally {
      setBusy(false);
    }
  };

  const retryProvisionalPrepare = async () => {
    const stored = readStoredOperation();
    if (!stored || operation || busy) return;
    setBusy(true);
    try {
      let local: TenKingsV2NfcLocalOperation;
      try {
        local = await getTenKingsV2NfcOperationStatus(stored.jobEnvelopeSha256);
      } catch (error) {
        if (!(error instanceof AiGraderNfcHelperError) || error.code !== "v2_nfc_job_not_found") throw error;
        const { decision, authoritativeCard } = await decideMissingHelperRecovery(stored, error.code);
        if (decision === "CLEAR_VERIFIED" || decision === "CLEAR_DISCARD_ACK") {
          window.localStorage.removeItem(STORED_OPERATION);
          setStoredPointerBlocked(false);
          setJob(null);
          setOperation(null);
          setMessage(decision === "CLEAR_VERIFIED"
            ? "NFC verification and protected cleanup were already completed."
            : "The exact acknowledged discard and protected cleanup were already completed.");
          return;
        }
        if (decision !== "PREPARE_EXACT_JOB") {
          if (!authoritativeCard) {
            setCard(null);
            setResults([]);
            setRecoveryCardUnavailable(true);
            setFreshConfirmed(false);
            setMessage("The saved card is missing or voided and has no exact discard or hosted verification proof. Recovery is blocked; the helper was not prepared and the browser pointer remains preserved.");
            return;
          }
          throw new Error("The exact helper-404 recovery facts did not authorize preparation.");
        }
        if (!authoritativeCard) throw new Error("The card became unavailable before exact-job recovery. The helper was not contacted.");
        if (recoveryCardUnavailable) {
          setRecoveryCardUnavailable(false);
          setFreshConfirmed(false);
          setMessage("The exact card is recordable again. Confirm one fresh unused F8215 before retrying this saved job; no helper preparation occurred during the recheck.");
          return;
        }
        try {
          local = await prepareTenKingsV2NfcOperation(stored.job);
        } catch (prepareError) {
          if (
            prepareError instanceof AiGraderNfcHelperError &&
            tenKingsV2MayClearUnstartedExpiredProvisional(stored, {
              helperStatusErrorCode: error.code,
              helperPrepareErrorCode: prepareError.code,
              localOperation: null,
              now: new Date(),
            })
          ) {
            window.localStorage.removeItem(STORED_OPERATION);
            setStoredPointerBlocked(false);
            setJob(null);
            setOperation(null);
            setMessage("The helper proved the exact signed job was absent and expired before preparation, so the unstarted browser pointer was removed.");
            return;
          }
          throw prepareError;
        }
      }
      if (tenKingsV2ProvisionalRecoveryAction(stored, local) !== "ACCEPT_EXACT_HELPER_STATE") {
        throw new Error("The helper did not resume the exact issued NFC job.");
      }
      window.localStorage.setItem(STORED_OPERATION, JSON.stringify({ ...stored, helperPrepared: true } satisfies StoredOperation));
      setJob(stored.job);
      setOperation(local);
      setMessage("The exact issued NFC job is recovered and protected.");
    } catch (error) {
      setMessage(`${safeMessage(error)} The issued pointer remains preserved; do not issue another job.`);
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (operation) await finishDiscardCleanup(operation);
  };

  const discardCompletedUnrecorded = async () => {
    if (operation?.phase === "completed" && completedUnrecorded) {
      await finishDiscardCleanup(operation, "completed_unrecorded");
    }
  };

  if (loading) return <AppShell background="black"><div className={styles.center}>Loading NFC V2…</div></AppShell>;
  if (!session) return <AppShell background="black"><div className={styles.center}><button onClick={() => void ensureSession()}>Sign in to NFC V2</button></div></AppShell>;
  if (!isAdmin) return <AppShell background="black"><div className={styles.center}>Admin access required.</div></AppShell>;

  const helperReady = Boolean(
    helper &&
    helper.helperVersion === readiness?.expectedHelperVersion &&
    helper.helperProtocolVersion === readiness?.expectedHelperProtocolVersion &&
    helper.tenKingsV2NfcEnabled === true &&
    helper.tenKingsV2NfcCapability === readiness?.expectedHelperCapability &&
    readiness.currentJobSigningKeyId &&
    tenKingsV2ExactKeySetMatches(helper.tenKingsV2TrustedJobSigningKeyIds, readiness.trustedJobSigningKeyIds) &&
    tenKingsV2HelperSignerAllowed(helper.tenKingsV2WorkstationKeyId, readiness.workstationKeyIds) &&
    helper.goToTagsReady &&
    !helper.busy &&
    readiness?.configured &&
    readiness.programmingEnabled,
  );
  const provisionalPending = Boolean(job && !operation);
  const recoveryWorkspace = Boolean(card || operation || provisionalPending);

  return (
    <AppShell background="black" brandVariant="collectibles" hideFooter>
      <Head><title>Ten Kings NFC</title><meta name="robots" content="noindex,nofollow" /></Head>
      <main className={styles.page}>
        <header className={styles.header}>
          <div><span className={styles.eyebrow}>TEN KINGS · CARD FINISHING</span><h1>NFC</h1><p>Write one permanent V2 card URL to one F8215 tag. NFC is always optional.</p></div>
          <nav><Link href="/admin/ai-grader-v2/completed">Completed cards</Link><Link href="/admin">Admin</Link></nav>
        </header>

        <div className={styles.statusBar} role="status" aria-live="polite">
          <span className={readiness?.configured && readiness.programmingEnabled ? styles.good : styles.bad}>HOSTED {readiness?.configured && readiness.programmingEnabled ? "READY" : "OFF"}</span>
          <span className={helper ? styles.good : styles.bad}>WORKSTATION {helper ? "CONNECTED" : "OFF"}</span>
          <span className={helper?.goToTagsReady ? styles.good : styles.bad}>GOTOTAGS {helper?.goToTagsReady ? "READY" : "OFF"}</span>
          <p>{message}</p>
        </div>

        {!recoveryWorkspace ? (
          <section className={styles.lookup} aria-labelledby="lookup-title">
            <div><span>01</span><h2 id="lookup-title">Choose a card</h2><p>Search by certificate, permanent token, player, card name, or card number.</p></div>
            <form onSubmit={(event) => { event.preventDefault(); void search(); }}>
              <label htmlFor="card-search">Permanent V2 card</label>
              <div><input id="card-search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={160} autoComplete="off" /><button disabled={busy || !query.trim()}>Find card</button></div>
            </form>
            {results.length ? <ul className={styles.results}>{results.map((result) => <li key={result.id}><button onClick={() => void router.replace(`/admin/nfc?card=${encodeURIComponent(result.id)}`)}><strong>{result.displayName}</strong><span>{result.year} · {result.productSet} · {result.parallel ?? "Base"}</span><small>{result.certificateNumber} · Grade {result.grade}</small></button></li>)}</ul> : null}
          </section>
        ) : (
          <div className={styles.workspace}>
            <section className={styles.cardPanel} aria-labelledby="selected-card-title">
              <span className={styles.step}>01 · PERMANENT CARD</span>
              {card ? <>
                <h2 id="selected-card-title">{card.displayName}</h2>
                <p>{card.year} · {card.manufacturer ? `${card.manufacturer} · ` : ""}{card.productSet}</p>
                <dl><div><dt>Variant</dt><dd>{card.parallel ?? "Base"}</dd></div><div><dt>Card</dt><dd>{card.cardNumber ?? "—"}</dd></div><div><dt>Grade</dt><dd>{card.grade}</dd></div><div><dt>Certificate</dt><dd>{card.certificateNumber ?? "—"}</dd></div></dl>
                <a href={card.permanentUrl} target="_blank" rel="noreferrer">{card.permanentUrl} ↗</a>
                {card.nfcVerifiedAt ? <div className={styles.verified}>NFC verified · {new Date(card.nfcVerifiedAt).toLocaleString()}</div> : null}
                {!operation ? <button className={styles.quiet} onClick={() => { setCard(null); setFreshConfirmed(false); void router.replace("/admin/nfc"); }}>Change card</button> : null}
              </> : <>
                <h2 id="selected-card-title">Recover protected operation</h2>
                <p>The saved card <strong>{job?.cardId ?? "unknown"}</strong> is missing or voided. Its row is not required to recover the exact physical tag operation.</p>
                {recoveryCardUnavailable ? <div className={styles.verified}>CARD UNAVAILABLE · RECOVERY ONLY</div> : null}
              </>}
            </section>

            <section className={styles.programPanel} aria-labelledby="program-title">
              <span className={styles.step}>02 · F8215</span><h2 id="program-title">Program the tag</h2>
              {!operation ? <>
                {recoveryCardUnavailable && provisionalPending ? <>
                  <p className={styles.help}>Do not take out, place, write, or lock a tag. This saved card is unavailable, so helper preparation is blocked. This control only rechecks the exact saved recovery facts.</p>
                  <button className={styles.quiet} disabled={busy} onClick={() => void retryProvisionalPrepare()}>{busy ? "Rechecking…" : "Recheck exact saved recovery"}</button>
                </> : <>
                  <ol><li>Take exactly one unused F8215 from controlled inventory.</li><li>Keep it off the reader until GoToTags asks for it.</li><li>Failed or uncertain tags are removed and discarded.</li></ol>
                  <label className={styles.confirm}><input type="checkbox" checked={freshConfirmed} onChange={(event) => setFreshConfirmed(event.target.checked)} /><span>I have one fresh unused F8215, and it is not on the reader.</span></label>
                  {provisionalPending
                    ? <button className={styles.primary} disabled={!freshConfirmed || !helper || busy} onClick={() => void retryProvisionalPrepare()}>{busy ? "Recovering…" : "Retry exact issued job"}</button>
                    : <button className={styles.primary} disabled={!freshConfirmed || !helperReady || busy || storedPointerBlocked} onClick={() => void prepare()}>{busy ? "Preparing…" : "Confirm Fresh F8215 & Prepare"}</button>}
                </>}
                {storedPointerBlocked ? <p className={styles.help}>The preserved browser pointer is invalid. Do not issue or program another tag until an admin reviews that exact local pointer.</p> : null}
                {!helperReady ? <p className={styles.help}>Open this screen from the approved NFC workstation shortcut. Hosted V2, helper V4, idle shared gate, and GoToTags must all be ready.</p> : null}
              </> : <>
                <div className={styles.phase}><span>{operation.phase.replaceAll("_", " ")}</span><div className={styles.pulse} aria-hidden="true" /></div>
                {operation.phase === "awaiting_manual_start" || operation.phase === "preparing" ? <p>Click <strong>Start Encoding</strong> once in GoToTags. Then place the fresh tag on the ACR1552U and leave it in place through readback and permanent lock.</p> : null}
                {operation.phase === "completed" ? <p>Exact URL readback and permanent lock verified. Saving the three informational facts.</p> : null}
                {operation.phase === "closing_success" ? <p>The hosted verification is saved. Protected workstation cleanup is resuming.</p> : null}
                {operation.phase === "closing_discard_failed" || operation.phase === "closing_discard_uncertain" ? <p>The discard is acknowledged. Protected workstation cleanup is resuming.</p> : null}
                {operation.phase === "closing_discard_completed_unrecorded" ? <p>The completed-but-unrecorded discard is acknowledged. Protected workstation cleanup is resuming.</p> : null}
                {operation.phase === "failed" || operation.phase === "uncertain" ? <button className={styles.discard} disabled={busy || !operation.discardAcknowledgementNonce} onClick={() => void discard()}>I removed and discarded this failed tag</button> : null}
                {(terminalError || pollError) ? <button className={styles.primary} disabled={busy} onClick={() => void retryCurrent()}>Retry this exact operation</button> : null}
                {operation.phase === "completed" && completedUnrecorded ? <button className={styles.discard} disabled={busy || !operation.discardAcknowledgementNonce} onClick={() => void discardCompletedUnrecorded()}>I removed and discarded this completed but unrecorded tag</button> : null}
              </>}
            </section>
          </div>
        )}

        <footer className={styles.disclaimer}><strong>Registered Ten Kings NFC link</strong><span>The static link is not proof of chip, slab, card authenticity, or ownership.</span></footer>
      </main>
    </AppShell>
  );
}
