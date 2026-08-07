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
  reconcileMissingTenKingsV2LocalOperation,
  tenKingsV2ClosingRecovery,
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
  discardAcknowledgement?: {
    jobEnvelopeSha256: string;
    acknowledgementNonce: string;
    phase: "failed" | "uncertain";
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
      typeof row.jobEnvelopeSha256 !== "string" || !SHA256.test(row.jobEnvelopeSha256)
    ) return null;
    const discard = row.discardAcknowledgement;
    if (discard !== undefined) {
      if (!discard || typeof discard !== "object" || Array.isArray(discard)) return null;
      const acknowledgement = discard as Record<string, unknown>;
      if (
        acknowledgement.jobEnvelopeSha256 !== row.jobEnvelopeSha256 ||
        typeof acknowledgement.acknowledgementNonce !== "string" ||
        !/^[A-Za-z0-9_-]{32}$/.test(acknowledgement.acknowledgementNonce) ||
        (acknowledgement.phase !== "failed" && acknowledgement.phase !== "uncertain")
      ) return null;
    }
    return row as StoredOperation;
  } catch {
    return null;
  }
};

const safeMessage = (error: unknown) => error instanceof Error ? error.message : "The NFC operation stopped safely.";

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
    const payload = await response.json().catch(() => ({})) as T & { message?: string };
    if (!response.ok) throw new Error(payload.message ?? "NFC V2 request failed.");
    return payload;
  }, [session?.token]);

  const loadCard = useCallback(async (cardId: string) => {
    const payload = await hosted<{ card: Card }>(`card?cardId=${encodeURIComponent(cardId)}`);
    setCard(payload.card);
    setResults([]);
    setMessage(payload.card.nfcVerifiedAt ? "This card has a verified informational NFC fact. You may write the same permanent URL to a replacement tag." : "Card ready. NFC is optional and does not affect its grade or inventory state.");
    return payload.card;
  }, [hosted]);

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
        if (selectedCardId) await loadCard(selectedCardId);
        if (hasAiGraderNfcHelperPairing()) {
          setHelper(await getAiGraderNfcHelperStatus());
        } else if (pairingCodeRef.current) {
          setHelper(await pairAiGraderNfcHelper(pairingCodeRef.current));
          pairingCodeRef.current = "";
        }
        const stored = readStoredOperation();
        if (stored) {
          setJob(stored.job);
          if (!selectedCardId || selectedCardId !== stored.cardId) await loadCard(stored.cardId);
          try {
            const local = await getTenKingsV2NfcOperationStatus(stored.jobEnvelopeSha256);
            setOperation(local);
            setMessage(local.phase === "completed" ? "Verified local result recovered. Completing the hosted card fact now." : "Protected NFC operation recovered after reload.");
          } catch (error) {
            if (error instanceof AiGraderNfcHelperError && error.code === "v2_nfc_job_not_found") {
              const authoritativeCard = await loadCard(stored.cardId);
              const reconciliation = reconcileMissingTenKingsV2LocalOperation(stored, authoritativeCard);
              if (reconciliation === "verified" || reconciliation === "discard_acknowledged") {
                window.localStorage.removeItem(STORED_OPERATION);
                setJob(null);
                setOperation(null);
                setMessage(reconciliation === "verified"
                  ? "NFC verification was already saved. The completed local operation was safely cleaned up."
                  : "The explicitly acknowledged failed tag was already cleaned up. The stale browser pointer was safely removed.");
              } else {
                throw new Error("The local NFC operation is missing, but hosted verification is not new enough to prove completion. Browser state was preserved for admin review.");
              }
            } else {
              throw error;
            }
          }
        }
      } catch (error) {
        setMessage(safeMessage(error));
      }
    })();
  }, [hosted, isAdmin, launcherReady, loadCard, selectedCardId, session?.token]);

  const completeHosted = useCallback(async (activeJob: Record<string, string>, local: TenKingsV2NfcLocalOperation) => {
    if (!local.result) return;
    setBusy(true);
    try {
      const completed = await hosted<{ outcome: string; nfcVerifiedAt: string }>("complete", {
        method: "POST",
        body: JSON.stringify({ job: activeJob, result: local.result }),
      });
      await acknowledgeTenKingsV2NfcSuccess(local.jobEnvelopeSha256);
      window.localStorage.removeItem(STORED_OPERATION);
      setOperation(null);
      setJob(null);
      setFreshConfirmed(false);
      if (card) await loadCard(card.id);
      setMessage(completed.outcome === "UPDATED" ? "NFC verified. The permanent card URL was read back and permanently locked." : "NFC result safely replayed. The existing verification fact was unchanged.");
    } catch (error) {
      setMessage(`${safeMessage(error)} The signed result is preserved and can be replayed after reload.`);
    } finally {
      setBusy(false);
    }
  }, [card, hosted, loadCard]);

  const finishSuccessCleanup = useCallback(async (local: TenKingsV2NfcLocalOperation) => {
    setBusy(true);
    try {
      await acknowledgeTenKingsV2NfcSuccess(local.jobEnvelopeSha256);
      window.localStorage.removeItem(STORED_OPERATION);
      setOperation(null);
      setJob(null);
      setFreshConfirmed(false);
      if (card) await loadCard(card.id);
      setMessage("NFC verification was already saved. Protected workstation cleanup is complete.");
    } catch (error) {
      setMessage(`${safeMessage(error)} Cleanup remains protected and will resume after reload.`);
    } finally {
      setBusy(false);
    }
  }, [card, loadCard]);

  const finishDiscardCleanup = useCallback(async (local: TenKingsV2NfcLocalOperation) => {
    if (!local.discardAcknowledgementNonce) return;
    const closing = tenKingsV2ClosingRecovery(local.phase);
    const phase = closing?.kind === "discard" ? closing.phase : local.phase;
    if (phase !== "failed" && phase !== "uncertain") return;
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
      setOperation(null);
      setJob(null);
      setFreshConfirmed(false);
      setMessage("Discard acknowledged. The failed tag was not recorded. Select a fresh tag only when you are ready to begin a new operation.");
    } catch (error) {
      setMessage(`${safeMessage(error)} Cleanup remains protected and will resume after reload.`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!operation || !job || busy) return;
    if (operation.phase === "completed") {
      void completeHosted(job, operation);
      return;
    }
    const closing = tenKingsV2ClosingRecovery(operation.phase);
    if (closing?.kind === "success") {
      void finishSuccessCleanup(operation);
      return;
    }
    if (closing?.kind === "discard") {
      void finishDiscardCleanup(operation);
      return;
    }
    if (operation.phase === "failed" || operation.phase === "uncertain") {
      setMessage("NFC tag failed. Remove and discard it, then acknowledge below. Do not try this tag again.");
      return;
    }
    pollingRef.current = setTimeout(() => {
      void getTenKingsV2NfcOperationStatus(operation.jobEnvelopeSha256)
        .then(setOperation)
        .catch((error) => setMessage(safeMessage(error)));
    }, 1200);
    return () => { if (pollingRef.current) clearTimeout(pollingRef.current); };
  }, [busy, completeHosted, finishDiscardCleanup, finishSuccessCleanup, job, operation]);

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
      const issued = await hosted<{ job: Record<string, string> }>("issue", {
        method: "POST",
        body: JSON.stringify({ cardId: card.id }),
      });
      const local = await prepareTenKingsV2NfcOperation(issued.job);
      window.localStorage.setItem(STORED_OPERATION, JSON.stringify({
        cardId: card.id,
        job: issued.job,
        jobEnvelopeSha256: local.jobEnvelopeSha256,
      } satisfies StoredOperation));
      setJob(issued.job);
      setOperation(local);
      setMessage("GoToTags is prepared. Click Start Encoding once in GoToTags, then place the one fresh F8215 on the reader.");
    } catch (error) {
      setMessage(safeMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (operation) await finishDiscardCleanup(operation);
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
    helper.tenKingsV2TrustedJobSigningKeyIds &&
    helper.tenKingsV2TrustedJobSigningKeyIds.length === readiness.trustedJobSigningKeyIds.length &&
    [...helper.tenKingsV2TrustedJobSigningKeyIds].sort().every(
      (keyId, index) => keyId === [...readiness.trustedJobSigningKeyIds].sort()[index],
    ) &&
    helper.goToTagsReady &&
    !helper.busy &&
    readiness?.configured &&
    readiness.programmingEnabled,
  );

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

        {!card ? (
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
              <h2 id="selected-card-title">{card.displayName}</h2>
              <p>{card.year} · {card.manufacturer ? `${card.manufacturer} · ` : ""}{card.productSet}</p>
              <dl><div><dt>Variant</dt><dd>{card.parallel ?? "Base"}</dd></div><div><dt>Card</dt><dd>{card.cardNumber ?? "—"}</dd></div><div><dt>Grade</dt><dd>{card.grade}</dd></div><div><dt>Certificate</dt><dd>{card.certificateNumber ?? "—"}</dd></div></dl>
              <a href={card.permanentUrl} target="_blank" rel="noreferrer">{card.permanentUrl} ↗</a>
              {card.nfcVerifiedAt ? <div className={styles.verified}>NFC verified · {new Date(card.nfcVerifiedAt).toLocaleString()}</div> : null}
              {!operation ? <button className={styles.quiet} onClick={() => { setCard(null); setFreshConfirmed(false); void router.replace("/admin/nfc"); }}>Change card</button> : null}
            </section>

            <section className={styles.programPanel} aria-labelledby="program-title">
              <span className={styles.step}>02 · F8215</span><h2 id="program-title">Program the tag</h2>
              {!operation ? <>
                <ol><li>Take exactly one unused F8215 from controlled inventory.</li><li>Keep it off the reader until GoToTags asks for it.</li><li>Failed or uncertain tags are removed and discarded.</li></ol>
                <label className={styles.confirm}><input type="checkbox" checked={freshConfirmed} onChange={(event) => setFreshConfirmed(event.target.checked)} /><span>I have one fresh unused F8215, and it is not on the reader.</span></label>
                <button className={styles.primary} disabled={!freshConfirmed || !helperReady || busy} onClick={() => void prepare()}>{busy ? "Preparing…" : "Confirm Fresh F8215 & Prepare"}</button>
                {!helperReady ? <p className={styles.help}>Open this screen from the approved NFC workstation shortcut. Hosted V2, helper V4, idle shared gate, and GoToTags must all be ready.</p> : null}
              </> : <>
                <div className={styles.phase}><span>{operation.phase.replaceAll("_", " ")}</span><div className={styles.pulse} aria-hidden="true" /></div>
                {operation.phase === "awaiting_manual_start" || operation.phase === "preparing" ? <p>Click <strong>Start Encoding</strong> once in GoToTags. Then place the fresh tag on the ACR1552U and leave it in place through readback and permanent lock.</p> : null}
                {operation.phase === "completed" ? <p>Exact URL readback and permanent lock verified. Saving the three informational facts.</p> : null}
                {operation.phase === "closing_success" ? <p>The hosted verification is saved. Protected workstation cleanup is resuming.</p> : null}
                {operation.phase === "closing_discard_failed" || operation.phase === "closing_discard_uncertain" ? <p>The discard is acknowledged. Protected workstation cleanup is resuming.</p> : null}
                {operation.phase === "failed" || operation.phase === "uncertain" ? <button className={styles.discard} disabled={busy || !operation.discardAcknowledgementNonce} onClick={() => void discard()}>I removed and discarded this failed tag</button> : null}
              </>}
            </section>
          </div>
        )}

        <footer className={styles.disclaimer}><strong>Registered Ten Kings NFC link</strong><span>The static link is not proof of chip, slab, card authenticity, or ownership.</span></footer>
      </main>
    </AppShell>
  );
}
