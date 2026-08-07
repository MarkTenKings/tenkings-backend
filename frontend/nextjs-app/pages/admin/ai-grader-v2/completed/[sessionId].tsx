/* eslint-disable @next/next/no-img-element */
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../../constants/admin";
import { useSession } from "../../../../hooks/useSession";
import { buildAdminHeaders } from "../../../../lib/adminHeaders";
import styles from "../../../../styles/AiGraderV2PostGrade.module.css";

type CardWorkspace = {
  id: string;
  publicReportSlug: string;
  certificateNumber: string | null;
  labelSheetNumber: number | null;
  labelSlot: number | null;
  slabPhotos: { front: string | null; back: string | null };
  status: { slabPhotosDone: boolean };
  permanentCard: {
    id: string;
    publicToken: string;
    lifecycleState: string;
    nfcVerifiedAt: string | null;
  } | null;
};

const SIDE_LABEL = { FRONT: "Front", BACK: "Back" } as const;

export default function CompletedSpeedsterCardPage() {
  const router = useRouter();
  const { session, loading, ensureSession } = useSession();
  const [card, setCard] = useState<CardWorkspace | null>(null);
  const [message, setMessage] = useState("Loading completed card.");
  const [uploading, setUploading] = useState<"FRONT" | "BACK" | null>(null);
  const [acting, setActing] = useState<"RESYNC_IDENTITY" | "VOID_CARD" | null>(null);
  const inputRefs = {
    FRONT: useRef<HTMLInputElement>(null),
    BACK: useRef<HTMLInputElement>(null),
  };
  const sessionId = typeof router.query.sessionId === "string" ? router.query.sessionId : null;
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone],
  );

  const load = useCallback(async () => {
    if (!session?.token || !sessionId || !isAdmin) return;
    const response = await fetch(`/api/admin/ai-grader-v2/completed/${encodeURIComponent(sessionId)}`, {
      headers: buildAdminHeaders(session.token),
    });
    const payload = await response.json().catch(() => ({})) as { card?: CardWorkspace; message?: string };
    if (!response.ok || !payload.card) throw new Error(payload.message ?? "Completed card could not be loaded.");
    setCard(payload.card);
    setMessage("Post-grading tools stay separate from the grading engine.");
  }, [isAdmin, session?.token, sessionId]);

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Completed card could not be loaded.")); }, [load]);

  const uploadSlab = async (side: "FRONT" | "BACK", file: File) => {
    if (!session?.token || !sessionId || uploading) return;
    setUploading(side);
    setMessage(`Uploading ${SIDE_LABEL[side].toLowerCase()} slab photo.`);
    try {
      const contentType = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
      const planResponse = await fetch(`/api/admin/ai-grader-v2/completed/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "SLAB_PLAN", side, contentType }),
      });
      const plan = await planResponse.json().catch(() => ({})) as { storageKey?: string; uploadUrl?: string; message?: string };
      if (!planResponse.ok || !plan.storageKey || !plan.uploadUrl) throw new Error(plan.message ?? "Slab upload could not start.");
      const upload = await fetch(plan.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
      if (!upload.ok) throw new Error("Slab photo could not be uploaded.");
      const completeResponse = await fetch(`/api/admin/ai-grader-v2/completed/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "SLAB_COMPLETE", side, storageKey: plan.storageKey }),
      });
      const complete = await completeResponse.json().catch(() => ({})) as { card?: CardWorkspace; message?: string };
      if (!completeResponse.ok || !complete.card) throw new Error(complete.message ?? "Slab photo could not be attached.");
      setCard(complete.card);
      setMessage(`${SIDE_LABEL[side]} slab photo attached to the public report.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Slab photo could not be uploaded.");
    } finally {
      setUploading(null);
    }
  };

  const runCardAction = async (action: "RESYNC_IDENTITY" | "VOID_CARD", reason?: string) => {
    if (!session?.token || !sessionId || acting) return;
    setActing(action);
    setMessage(action === "VOID_CARD" ? "Voiding erroneous card." : "Re-syncing identity from Speedster.");
    try {
      const response = await fetch(`/api/admin/ai-grader-v2/completed/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify(action === "VOID_CARD" ? { action, reason } : { action }),
      });
      const payload = await response.json().catch(() => ({})) as { card?: CardWorkspace; message?: string };
      if (!response.ok || !payload.card) throw new Error(payload.message ?? "Permanent card action failed.");
      setCard(payload.card);
      setMessage(action === "VOID_CARD" ? "Card voided and removed from every public page and active list." : "Identity re-synced from the authoritative Speedster session.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Permanent card action failed.");
    } finally {
      setActing(null);
    }
  };

  const requestVoid = () => {
    const reason = window.prompt("Why is this card erroneous?")?.trim();
    if (!reason || !window.confirm("Void this card? It will disappear from every public page and active list.")) return;
    void runCardAction("VOID_CARD", reason);
  };

  if (loading) return <AppShell background="black"><div className={styles.center}>Loading Speedster…</div></AppShell>;
  if (!session) return <AppShell background="black"><div className={styles.center}><button onClick={() => void ensureSession()}>Sign in to Speedster</button></div></AppShell>;
  if (!isAdmin) return <AppShell background="black"><div className={styles.center}>Admin access required.</div></AppShell>;

  return (
    <AppShell background="black" hideFooter>
      <Head><title>{card?.certificateNumber ?? "Completed card"} | Speedster</title><meta name="robots" content="noindex,nofollow" /></Head>
      <main className={styles.page}>
        <header className={styles.workspaceHeader}>
          <div><span>TEN KINGS · POST GRADING</span><h1>{card?.certificateNumber ?? "Completed card"}</h1><p>{message}</p></div>
          <nav><Link href="/admin/ai-grader-v2/completed">All cards</Link><Link href="/admin/human-grade">Label pages</Link></nav>
        </header>

        {card ? <>
          <section className={styles.toolGrid}>
            {(["FRONT", "BACK"] as const).map((side) => {
              const image = card.slabPhotos[side.toLowerCase() as "front" | "back"];
              return (
                <article className={styles.slabTool} key={side}>
                  <small>SLAB · {side}</small>
                  {image ? <img src={image} alt={`${SIDE_LABEL[side]} sealed slab`} /> : <div className={styles.emptySlab}>{SIDE_LABEL[side]}</div>}
                  <input
                    ref={inputRefs[side]}
                    hidden
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void uploadSlab(side, file);
                    }}
                  />
                  <button type="button" disabled={Boolean(uploading)} onClick={() => inputRefs[side].current?.click()}>
                    {uploading === side ? "Uploading…" : image ? `Replace ${SIDE_LABEL[side]}` : `Add ${SIDE_LABEL[side]}`}
                  </button>
                </article>
              );
            })}
            <article className={styles.finishTools}>
              <small>PERMANENT CARD</small>
              <div>
                <span className={card.status.slabPhotosDone ? styles.done : undefined}>Slab photos</span>
                {card.permanentCard ? <span className={styles.done}>{card.permanentCard.lifecycleState}</span> : null}
                {card.permanentCard?.nfcVerifiedAt ? <span className={styles.done}>NFC verified</span> : null}
              </div>
              <p>Label page {card.labelSheetNumber ?? "—"} · Slot {card.labelSlot ?? "—"}</p>
              {card.permanentCard ? <>
                <Link href={`/admin/comps?card=${encodeURIComponent(card.permanentCard.id)}&from=${encodeURIComponent(`/admin/ai-grader-v2/completed/${sessionId}`)}`}>Open Sold Comps</Link>
                {card.permanentCard.lifecycleState !== "VOID" ? (
                  <Link href={`/admin/nfc?card=${encodeURIComponent(card.permanentCard.id)}`}>
                    Open NFC →
                  </Link>
                ) : null}
                <button
                  type="button"
                  disabled={Boolean(acting)}
                  onClick={() => void runCardAction("RESYNC_IDENTITY")}
                >
                  {acting === "RESYNC_IDENTITY" ? "Re-syncing…" : "Re-sync identity from session"}
                </button>
                {card.permanentCard.lifecycleState !== "VOID" ? (
                  <button type="button" disabled={Boolean(acting)} onClick={requestVoid}>
                    {acting === "VOID_CARD" ? "Voiding…" : "Void erroneous card"}
                  </button>
                ) : null}
              </> : <p>Permanent V2 card unavailable.</p>}
              <Link href="/admin/human-grade">Open label pages →</Link>
            </article>
          </section>

          {card.permanentCard && card.permanentCard.lifecycleState !== "VOID" ? (
            <section className={styles.reportFrame}>
              <header><span>PERMANENT CARD · LIVE PREVIEW</span><a href={`/c/${card.permanentCard.publicToken}`} target="_blank" rel="noreferrer">Open card ↗</a></header>
              <iframe title="Permanent Ten Kings card" src={`/c/${card.permanentCard.publicToken}`} />
            </section>
          ) : null}
        </> : null}
      </main>
    </AppShell>
  );
}
