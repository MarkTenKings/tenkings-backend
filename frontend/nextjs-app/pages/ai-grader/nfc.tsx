import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  AiGraderNfcHelperError,
  clearAiGraderNfcHelperPairing,
  getAiGraderNfcHelperStatus,
  hasAiGraderNfcHelperPairing,
  pairAiGraderNfcHelper,
  writeAiGraderNfcTag,
  type AiGraderNfcHelperStatus,
  type AiGraderNfcHelperWriteResult,
} from "../../lib/aiGraderNfcHelperClient";

type JsonRecord = Record<string, unknown>;
type Phase = "loading" | "ready" | "writing" | "verifying" | "overwrite" | "active" | "error";

type HostedStatus = {
  status: "missing" | "reserved" | "programming" | "verified" | "active" | "revoked" | "error";
  reportId: string;
  cardAssetId?: string | null;
  itemId?: string | null;
  certId?: string | null;
  cardTitle?: string | null;
  cardSet?: string | null;
  publicTagId?: string | null;
  nfcTagUrl?: string | null;
  chipType?: "NTAG215" | null;
  securityMode?: "static_url_v1" | "ntag424_sun_v1" | null;
  registrationSemantics?: "registered_link" | "cryptographically_verified" | null;
};

type Reservation = {
  url: string;
  publicTagId: string;
  attemptId: string;
  attemptToken: string;
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

type PendingCompletion = {
  reservation: Reservation;
  write: AiGraderNfcHelperWriteResult;
  idempotencyKey: string;
};

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
    result.url !== `https://collect.tenkings.co/nfc/${result.publicTagId}`
  ) {
    throw new Error("The hosted NFC reservation response was incomplete or unsafe.");
  }
  return result;
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
  const [paired, setPaired] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [pending, setPending] = useState<PendingCompletion | null>(null);
  const [overwriteDigest, setOverwriteDigest] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    const code = new URLSearchParams(hash).get("aiGraderNfcPair")?.trim() ?? "";
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(code)) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setPairingCode(code);
    setMessage("Completing one-time trust pairing with the loopback NFC helper.");
    void pairAiGraderNfcHelper(code)
      .then((status) => {
        setHelper(status);
        setPaired(true);
        setPairingCode("");
        setPhase("ready");
        setMessage("NFC helper paired. Place one blank NTAG215 on the reader.");
      })
      .catch((error) => {
        setPhase("error");
        setMessage(errorMessage(error));
      });
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
    const isPaired = hasAiGraderNfcHelperPairing();
    setPaired(isPaired);
    if (isPaired) {
      try {
        setHelper(await getAiGraderNfcHelperStatus());
      } catch (error) {
        setHelper(null);
        setMessage(errorMessage(error));
      }
    }
    setPhase(result.status === "active" ? "active" : "ready");
    if (result.status === "active") setMessage("NFC is verified and active for this published report.");
    else setMessage("Place one blank NTAG215 on the reader, then program the registered report link.");
  }, [hostedRequest, reportId]);

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
      });
      setPending(null);
      setOverwriteDigest(null);
      await refresh();
    },
    [hosted?.cardAssetId, hosted?.certId, hosted?.itemId, hostedRequest, refresh, reportId],
  );

  const writeReservation = useCallback(
    async (reservation: Reservation, overwriteConfirmation?: { confirmed: true; observedPayloadSha256: string }) => {
      const idempotency = overwriteConfirmation
        ? `write-${reservation.attemptId}-overwrite-${overwriteConfirmation.observedPayloadSha256.slice(0, 12)}`
        : `write-${reservation.attemptId}`;
      setPhase("writing");
      setMessage("Writing the NDEF URL, then reading the full payload back from the NTAG215.");
      const write = await writeAiGraderNfcTag({
        attemptId: reservation.attemptId,
        idempotencyKey: idempotency,
        url: reservation.url,
        ...(overwriteConfirmation ? { overwriteConfirmation } : {}),
      });
      if (write.overwriteRequired) {
        if (!write.observedPayloadSha256 || !/^[a-f0-9]{64}$/.test(write.observedPayloadSha256)) {
          throw new Error("The NFC helper returned an invalid overwrite challenge.");
        }
        setPending({ reservation, write, idempotencyKey: `complete-${reservation.attemptId}` });
        setOverwriteDigest(write.observedPayloadSha256);
        setPhase("overwrite");
        setMessage("This tag contains a different NDEF payload. Confirm once to overwrite this exact observed content.");
        return;
      }
      const completion = { reservation, write, idempotencyKey: `complete-${reservation.attemptId}` };
      setPending(completion);
      await completeHosted(completion);
    },
    [completeHosted],
  );

  const program = async () => {
    try {
      if (!paired) throw new Error("Pair the dedicated NFC helper first.");
      const reservation = reservationFrom(
        await hostedRequest("init", { reportId, idempotencyKey: `init-${reportId}-${crypto.randomUUID()}` }),
      );
      await writeReservation(reservation);
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const pair = async () => {
    try {
      setMessage("Pairing this browser with the loopback-only NFC helper.");
      const status = await pairAiGraderNfcHelper(pairingCode);
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

  const replace = async () => {
    try {
      if (reason.trim().length < 8) throw new Error("Enter a replacement reason of at least 8 characters.");
      const reservation = reservationFrom(
        await hostedRequest("replace", {
          reportId,
          replacedPublicTagId: hosted?.publicTagId,
          reason: reason.trim(),
          idempotencyKey: `replace-${reportId}-${crypto.randomUUID()}`,
        }),
      );
      setReason("");
      await writeReservation(reservation);
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const revoke = async () => {
    try {
      if (reason.trim().length < 8) throw new Error("Enter a revocation reason of at least 8 characters.");
      await hostedRequest("revoke", {
        reportId,
        reason: reason.trim(),
        idempotencyKey: `revoke-${reportId}-${crypto.randomUUID()}`,
      });
      setReason("");
      await refresh();
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const confirmOverwrite = async () => {
    if (!pending || !overwriteDigest) return;
    try {
      await writeReservation(pending.reservation, {
        confirmed: true,
        observedPayloadSha256: overwriteDigest,
      });
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

  const busy = phase === "writing" || phase === "verifying" || phase === "loading";

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
            </dl>
            {hosted?.nfcTagUrl ? <a href={hosted.nfcTagUrl} target="_blank" rel="noreferrer">Open registered tap page</a> : null}
          </article>

          <article>
            <p className="eyebrow">Dedicated workstation helper</p>
            <h2>{paired ? helper?.readerConnected ? "Reader connected" : "Paired / reader unavailable" : "Pair workstation"}</h2>
            {paired ? (
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
                <button type="button" onClick={() => void pair()}>Pair NFC helper</button>
              </div>
            )}
          </article>
        </section>

        <section className="program">
          <div><p className="eyebrow">One tag / one report</p><h2>Place one blank NTAG215</h2><p>The helper writes only the exact Ten Kings URL, verifies full readback, and never locks or configures the tag.</p></div>
          <button type="button" className="primary" disabled={busy || !paired || hosted?.status === "active"} onClick={() => void program()}>
            {phase === "writing" ? "Writing" : phase === "verifying" ? "Verifying" : "Program NFC"}
          </button>
        </section>

        {phase === "overwrite" && pending && overwriteDigest ? (
          <section className="danger">
            <div><strong>Different content detected</strong><p>Overwrite only this exact observed payload. The existing content is not silently reassigned.</p></div>
            <button type="button" onClick={() => void confirmOverwrite()}>Confirm overwrite once</button>
          </section>
        ) : null}

        {pending && phase === "error" && pending.write.normalizedUrl ? (
          <button type="button" className="secondary retry" onClick={() => void retryHostedVerification()}>Retry hosted verification</button>
        ) : null}

        {hosted?.status === "active" || hosted?.status === "revoked" ? (
          <section className="admin-actions">
            <label>Required audit reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={240} /></label>
            {hosted.status === "active" ? <button type="button" className="secondary" onClick={() => void replace()}>Revoke and program replacement</button> : null}
            {hosted.status === "active" ? <button type="button" className="danger-button" onClick={() => void revoke()}>Revoke NFC link</button> : null}
          </section>
        ) : null}

        <footer>NTAG215 provides a convenient registered identity link. It does not prove that a chip, slab, or card is cryptographically authentic.</footer>
      </main>
      <style jsx>{`
        :global(body){margin:0;background:#f4f1e9;color:#171612;font-family:Inter,system-ui,sans-serif}.shell{max-width:1120px;margin:0 auto;padding:32px 22px 64px}header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:24px}h1{font-family:Georgia,serif;font-size:42px;margin:4px 0}h2{font-family:Georgia,serif;margin:6px 0 16px}.eyebrow{text-transform:uppercase;letter-spacing:.15em;font-size:12px;font-weight:800;color:#7d6019}.notice{display:flex;gap:14px;padding:16px 18px;border:1px solid #d6c99f;background:#fff9df;margin-bottom:20px}.notice.active{background:#eaf6ed;border-color:#8fb69a}.notice.error{background:#fff0ed;border-color:#d99b90}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.grid article,.program,.admin-actions{background:#fff;border:1px solid #d8d2c5;padding:22px;box-shadow:0 8px 24px #3a2d1010}dl{display:grid;grid-template-columns:130px 1fr;gap:9px;margin:18px 0}dt{color:#766f62}dd{margin:0;font-weight:700;overflow-wrap:anywhere}button{border:0;border-radius:4px;padding:12px 17px;background:#1b1a16;color:white;font-weight:800;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.secondary{background:#ded8ca;color:#26231c}.primary{font-size:18px;min-width:190px;background:#9b731e}.program{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:18px}.program p{max-width:680px}.pair{display:flex;align-items:end;gap:10px}label{display:grid;gap:7px;font-weight:800;flex:1}input{padding:11px;border:1px solid #bdb4a3;border-radius:3px;font:inherit}.danger,.admin-actions{display:flex;gap:16px;align-items:center;margin-top:18px;padding:18px;background:#fff4ee;border:1px solid #d5997f}.danger div{flex:1}.danger-button,.danger button{background:#922f20}.retry{margin-top:18px}.admin-actions label{min-width:260px}footer{margin-top:28px;padding-top:18px;border-top:1px solid #cfc7b9;color:#655f55}a{color:#77520c;font-weight:800}@media(max-width:760px){.grid{grid-template-columns:1fr}.program,.danger,.admin-actions,header{align-items:stretch;flex-direction:column}h1{font-size:34px}.pair{align-items:stretch;flex-direction:column}}
      `}</style>
    </>
  );
}
