/* eslint-disable @next/next/no-img-element */
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../../../components/AppShell";
import SharedLabelEditor from "../../../../components/human-grade/SharedLabelEditor";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../../constants/admin";
import { useSession } from "../../../../hooks/useSession";
import { buildAdminHeaders } from "../../../../lib/adminHeaders";
import {
  sha256BrowserBlob,
  uploadAiGraderArtifactDirectly,
} from "../../../../lib/aiGraderDirectUpload";
import {
  SpeedsterIdentityValidationError,
  canonicalizeSpeedsterSessionIdentity,
} from "../../../../lib/ai-grader-v2/identity";
import {
  EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE,
  type HumanGradeLabelEditorValue,
} from "../../../../lib/humanGrade";
import styles from "../../../../styles/AiGraderV2PostGrade.module.css";

type CardWorkspace = {
  id: string;
  cardProfile: "SPORTS" | "POKEMON";
  authoritativeIdentity: {
    playerName?: string | null;
    cardName?: string | null;
    layoutType?: "POKEMON" | "TRAINER" | "ENERGY" | null;
    year: string | null;
    manufacturer?: string | null;
    productSet: string | null;
    parallel: string | null;
    insert?: string | null;
    cardNumber: string | null;
  };
  publicReportSlug: string;
  certificateNumber: string | null;
  labelSheetNumber: number | null;
  labelSlot: number | null;
  linkedLabel: {
    id: string;
    source: "HUMAN" | "SPEEDSTER";
    certificateNumber: string | null;
    grade: string;
    sheetNumber: number;
    slot: number;
  } | null;
  labelPreviewPath: string | null;
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

function identityEditorValue(card: CardWorkspace): HumanGradeLabelEditorValue {
  return {
    ...EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE,
    cardType: card.cardProfile,
    playerName: card.authoritativeIdentity.playerName ?? "",
    cardName: card.authoritativeIdentity.cardName ?? "",
    layoutType: card.authoritativeIdentity.layoutType ?? "",
    year: card.authoritativeIdentity.year ?? "",
    manufacturer: card.authoritativeIdentity.manufacturer ?? "",
    productSet: card.authoritativeIdentity.productSet ?? "",
    parallel: card.authoritativeIdentity.parallel ?? "",
    insert: card.authoritativeIdentity.insert ?? "",
    cardNumber: card.authoritativeIdentity.cardNumber ?? "",
  };
}

export default function CompletedSpeedsterCardPage() {
  const router = useRouter();
  const { session, loading, ensureSession } = useSession();
  const [card, setCard] = useState<CardWorkspace | null>(null);
  const [message, setMessage] = useState("Loading completed card.");
  const [uploading, setUploading] = useState<"FRONT" | "BACK" | null>(null);
  const [acting, setActing] = useState<"UPDATE_IDENTITY" | "VOID_CARD" | null>(null);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [identityForm, setIdentityForm] = useState<HumanGradeLabelEditorValue>(
    EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE,
  );
  const [identityErrors, setIdentityErrors] = useState<Record<string, string>>({});
  const [labelPreviewUrl, setLabelPreviewUrl] = useState<string | null>(null);
  const [labelPreviewLoading, setLabelPreviewLoading] = useState(false);
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
    setMessage("Completed card loaded. Post-grading tools remain separate from grade authority.");
  }, [isAdmin, session?.token, sessionId]);

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Completed card could not be loaded.")); }, [load]);

  useEffect(() => {
    if (!card?.labelPreviewPath || !session?.token) {
      setLabelPreviewUrl(null);
      return;
    }
    let active = true;
    let nextUrl: string | null = null;
    setLabelPreviewLoading(true);
    setLabelPreviewUrl(null);
    void fetch(card.labelPreviewPath, {
      headers: buildAdminHeaders(session.token),
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { message?: string };
          throw new Error(payload.message ?? "The linked label could not be rendered.");
        }
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        nextUrl = URL.createObjectURL(blob);
        setLabelPreviewUrl(nextUrl);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "The linked label could not be rendered.");
      })
      .finally(() => {
        if (active) setLabelPreviewLoading(false);
      });
    return () => {
      active = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [card?.labelPreviewPath, card?.linkedLabel, session?.token]);

  const uploadSlab = async (side: "FRONT" | "BACK", file: File) => {
    if (!session?.token || !sessionId || uploading) return;
    setUploading(side);
    setMessage(`Uploading ${SIDE_LABEL[side].toLowerCase()} slab photo.`);
    try {
      const contentType = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
      const checksumSha256 = await sha256BrowserBlob(file);
      const planResponse = await fetch(`/api/admin/ai-grader-v2/completed/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "SLAB_PLAN",
          side,
          contentType,
          byteSize: file.size,
          checksumSha256,
        }),
      });
      const plan = await planResponse.json().catch(() => ({})) as {
        storageKey?: string;
        uploadUrl?: string;
        uploadMethod?: string;
        uploadHeaders?: Record<string, string>;
        byteSize?: number;
        checksumSha256?: string;
        message?: string;
      };
      if (!planResponse.ok
        || !plan.storageKey
        || !plan.uploadUrl
        || plan.uploadMethod !== "PUT"
        || plan.byteSize !== file.size
        || plan.checksumSha256 !== checksumSha256) {
        throw new Error(plan.message ?? "Slab upload could not start.");
      }
      await uploadAiGraderArtifactDirectly({
        purpose: "speedster-slab-photo",
        uploadUrl: plan.uploadUrl,
        uploadMethod: plan.uploadMethod,
        uploadHeaders: plan.uploadHeaders,
        contentType,
        checksumSha256,
        body: file,
      });
      const completeResponse = await fetch(`/api/admin/ai-grader-v2/completed/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "SLAB_COMPLETE",
          side,
          storageKey: plan.storageKey,
          contentType,
          byteSize: file.size,
          checksumSha256,
        }),
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

  const runVoidAction = async (reason: string) => {
    if (!session?.token || !sessionId || acting) return;
    setActing("VOID_CARD");
    setMessage("Voiding erroneous card.");
    try {
      const response = await fetch(`/api/admin/ai-grader-v2/completed/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "VOID_CARD", reason }),
      });
      const payload = await response.json().catch(() => ({})) as { card?: CardWorkspace; message?: string };
      if (!response.ok || !payload.card) throw new Error(payload.message ?? "Permanent card action failed.");
      setCard(payload.card);
      setMessage("Card voided and removed from every public page and active list.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Permanent card action failed.");
    } finally {
      setActing(null);
    }
  };

  const requestVoid = () => {
    const reason = window.prompt("Why is this card erroneous?")?.trim();
    if (!reason || !window.confirm("Void this card? It will disappear from every public page and active list.")) return;
    void runVoidAction(reason);
  };

  const openIdentityEditor = () => {
    if (!card?.labelPreviewPath) return;
    setIdentityForm(identityEditorValue(card));
    setIdentityErrors({});
    setEditingIdentity(true);
    setMessage("Editing the authoritative Speedster session identity.");
  };

  const saveIdentity = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!card || !session?.token || !sessionId || acting) return;
    setIdentityErrors({});
    setActing("UPDATE_IDENTITY");
    setMessage("Saving one authoritative identity correction.");
    try {
      const identity = canonicalizeSpeedsterSessionIdentity(
        card.cardProfile,
        card.cardProfile === "SPORTS"
          ? {
              playerName: identityForm.playerName,
              year: identityForm.year,
              manufacturer: identityForm.manufacturer,
              productSet: identityForm.productSet,
              parallel: identityForm.parallel,
              insert: identityForm.insert,
              cardNumber: identityForm.cardNumber,
            }
          : {
              cardName: identityForm.cardName,
              ...(identityForm.layoutType ? { layoutType: identityForm.layoutType } : {}),
              year: identityForm.year,
              productSet: identityForm.productSet,
              parallel: identityForm.parallel,
              cardNumber: identityForm.cardNumber,
            },
      );
      const response = await fetch(`/api/admin/ai-grader-v2/completed/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "UPDATE_IDENTITY", identity }),
      });
      const payload = await response.json().catch(() => ({})) as {
        card?: CardWorkspace;
        message?: string;
        fields?: Record<string, string>;
      };
      if (!response.ok || !payload.card) {
        if (payload.fields) setIdentityErrors(payload.fields);
        throw new Error(payload.message ?? "Authoritative identity could not be saved.");
      }
      setCard(payload.card);
      setIdentityForm(identityEditorValue(payload.card));
      setEditingIdentity(false);
      setMessage("Authoritative session, linked label, and any existing permanent card are synchronized.");
    } catch (error) {
      if (error instanceof SpeedsterIdentityValidationError) setIdentityErrors(error.fields);
      setMessage(error instanceof Error ? error.message : "Authoritative identity could not be saved.");
    } finally {
      setActing(null);
    }
  };

  const updateIdentityForm = (field: keyof HumanGradeLabelEditorValue, value: string) => {
    if (field === "cardType") return;
    setIdentityForm((current) => ({ ...current, [field]: value }));
    setIdentityErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
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
          <section className={styles.identityLabelGrid}>
            <article className={styles.identityPanel}>
              <small>AUTHORITATIVE SPEEDSTER IDENTITY</small>
              <h2>{card.authoritativeIdentity.playerName ?? card.authoritativeIdentity.cardName ?? "Identity incomplete"}</h2>
              <p>{[
                card.authoritativeIdentity.year,
                card.authoritativeIdentity.layoutType ? `${card.authoritativeIdentity.layoutType} layout` : null,
                card.authoritativeIdentity.manufacturer,
                card.authoritativeIdentity.productSet,
                card.authoritativeIdentity.parallel,
                card.authoritativeIdentity.insert,
                card.authoritativeIdentity.cardNumber ? `#${card.authoritativeIdentity.cardNumber.replace(/^#/, "")}` : null,
              ].filter(Boolean).join(" · ")}</p>
              <div className={styles.identityActions}>
                <button
                  type="button"
                  disabled={Boolean(acting) || !card.labelPreviewPath}
                  onClick={openIdentityEditor}
                >
                  Edit authoritative identity
                </button>
                {sessionId ? (
                  <button
                    type="button"
                    onClick={() => void router.push(`/card-maps?sessionId=${encodeURIComponent(sessionId)}`)}
                  >
                    CARD MAP
                  </button>
                ) : null}
                {!card.labelPreviewPath ? (
                  <span>No exact linked Speedster label. Editing is unavailable; none will be created or repaired here.</span>
                ) : null}
              </div>
            </article>
            <article className={styles.labelPanel}>
              <header>
                <div><small>LINKED HUMAN GRADE LABEL · EXACT RENDER</small><strong>{card.linkedLabel?.certificateNumber ?? "Unavailable"}</strong></div>
                {card.linkedLabel ? <span>Grade {card.linkedLabel.grade}</span> : null}
              </header>
              {labelPreviewUrl ? (
                <iframe
                  title={`Exact linked Human Grade label ${card.linkedLabel?.certificateNumber ?? ""}`}
                  src={`${labelPreviewUrl}#toolbar=0&navpanes=0&view=FitH`}
                />
              ) : (
                <div className={styles.labelPlaceholder}>
                  {labelPreviewLoading ? "Rendering exact saved label…" : "Exact linked label unavailable."}
                </div>
              )}
            </article>
          </section>

          {editingIdentity ? (
            <div className={styles.identityEditor}>
              <SharedLabelEditor
                mode="SPEEDSTER"
                value={identityForm}
                onChange={updateIdentityForm}
                onSubmit={saveIdentity}
                onCancel={() => setEditingIdentity(false)}
                certificateNumber={card.certificateNumber ?? "TKH-ISSUED"}
                fieldErrors={identityErrors}
                saving={acting === "UPDATE_IDENTITY"}
                editing
                lockCardType
                primaryActionLabel="Save Authoritative Identity"
              />
            </div>
          ) : null}

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
