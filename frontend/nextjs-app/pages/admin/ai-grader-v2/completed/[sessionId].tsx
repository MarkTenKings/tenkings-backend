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
  status: { slabPhotosDone: boolean; nfcDone: boolean; compsDone: boolean; inventoryDone: boolean };
};

const SIDE_LABEL = { FRONT: "Front", BACK: "Back" } as const;

export default function CompletedSpeedsterCardPage() {
  const router = useRouter();
  const { session, loading, ensureSession } = useSession();
  const [card, setCard] = useState<CardWorkspace | null>(null);
  const [message, setMessage] = useState("Loading completed card.");
  const [uploading, setUploading] = useState<"FRONT" | "BACK" | null>(null);
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
              <small>FINISH STATUS</small>
              <div><span className={card.status.slabPhotosDone ? styles.done : undefined}>Slab photos</span><span className={card.status.nfcDone ? styles.done : undefined}>NFC</span><span className={card.status.compsDone ? styles.done : undefined}>Comps</span><span className={card.status.inventoryDone ? styles.done : undefined}>Inventory</span></div>
              <p>Label page {card.labelSheetNumber ?? "—"} · Slot {card.labelSlot ?? "—"}</p>
              <Link href="/admin/human-grade">Open label pages →</Link>
            </article>
          </section>

          <section className={styles.reportFrame}>
            <header><span>PUBLIC REPORT · LIVE PREVIEW</span><a href={`/ai-grader-v2/reports/${card.publicReportSlug}`} target="_blank" rel="noreferrer">Open report ↗</a></header>
            <iframe title="Public Speedster report" src={`/ai-grader-v2/reports/${card.publicReportSlug}`} />
          </section>
        </> : null}
      </main>
    </AppShell>
  );
}
