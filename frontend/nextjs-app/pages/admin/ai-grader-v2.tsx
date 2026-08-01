import Head from "next/head";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import AppShell from "../../components/AppShell";
import { CaptureWorkspace, type SpeedsterCaptureBundle } from "../../components/ai-grader-v2/CaptureWorkspace";
import SharedLabelEditor from "../../components/human-grade/SharedLabelEditor";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE,
  type HumanGradeLabelEditorValue,
} from "../../lib/humanGrade";
import styles from "../../styles/AiGraderV2Admin.module.css";

type SpeedsterDraft = { id: string; cardProfile: "POKEMON" | "SPORTS" };

export default function AiGraderV2AdminPage() {
  const { session, loading, ensureSession } = useSession();
  const [identity, setIdentity] = useState<HumanGradeLabelEditorValue>(EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE);
  const [draft, setDraft] = useState<SpeedsterDraft | null>(null);
  const [capture, setCapture] = useState<SpeedsterCaptureBundle | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("Enter the exact information that belongs on the Ten Kings label.");
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone],
  );

  const updateIdentity = (field: keyof HumanGradeLabelEditorValue, value: string) => {
    setIdentity((current) => ({ ...current, [field]: value }));
  };

  const createDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.token || working) return;
    setWorking(true);
    setMessage("Creating the Speedster card.");
    const { centeringGrade, cornersGrade, edgesGrade, surfaceGrade, ...printedIdentity } = identity;
    void centeringGrade; void cornersGrade; void edgesGrade; void surfaceGrade;
    try {
      const response = await fetch("/api/admin/ai-grader-v2/sessions", {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ cardProfile: identity.cardType, identity: printedIdentity }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        session?: SpeedsterDraft;
        message?: string;
      };
      if (!response.ok || !payload.session) throw new Error(payload.message ?? "Speedster card could not be created.");
      setDraft(payload.session);
      setMessage("Add one original Front and one original Back image.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Speedster card could not be created.");
    } finally {
      setWorking(false);
    }
  };

  const saveCapture = async (bundle: SpeedsterCaptureBundle) => {
    if (!session?.token || !draft) return;
    setWorking(true);
    setMessage("Saving the locked card geometry.");
    const compactSide = (side: SpeedsterCaptureBundle["front"]) => ({
      originalStorageKey: side.originalStorageKey,
      rectifiedStorageKey: side.rectifiedStorageKey,
      viewStorageKeys: side.viewStorageKeys,
      sourceCorners: side.sourceCorners,
      transform: side.transform,
      centeringQuad: side.centeringQuad,
      centeringBorders: side.centeringBorders,
    });
    try {
      const response = await fetch(`/api/admin/ai-grader-v2/sessions/${encodeURIComponent(draft.id)}`, {
        method: "PATCH",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          workflowState: "CAPTURED",
          capture: {
            cornerShape: bundle.cornerShape,
            front: compactSide(bundle.front),
            back: compactSide(bundle.back),
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Card geometry could not be saved.");
      setCapture(bundle);
      setMessage("Capture is locked and ready for the Ten Kings detector.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Card geometry could not be saved.");
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <AppShell background="black"><div className={styles.center}>Loading Speedster…</div></AppShell>;
  if (!session) {
    return <AppShell background="black"><div className={styles.center}><button onClick={() => void ensureSession()}>Sign in to Speedster</button></div></AppShell>;
  }
  if (!isAdmin) return <AppShell background="black"><div className={styles.center}>Admin access required.</div></AppShell>;

  return (
    <AppShell background="black" hideFooter>
      <Head><title>AI Grader V2 Speedster | Ten Kings</title><meta name="robots" content="noindex,nofollow" /></Head>
      <main className={styles.page}>
        <header className={styles.hero}>
          <div><span>TEN KINGS · AI GRADER V2</span><h1>Speedster</h1><p>{working ? "Racing · " : ""}{message}</p></div>
          <Link href="/admin">Admin Home</Link>
        </header>

        {!draft ? (
          <SharedLabelEditor
            mode="SPEEDSTER"
            value={identity}
            onChange={updateIdentity}
            onSubmit={createDraft}
            saving={working}
            certificateNumber="TKS-DRAFT"
          />
        ) : null}

        {draft && !capture ? (
          <CaptureWorkspace
            token={session.token}
            sessionId={draft.id}
            cardProfile={draft.cardProfile}
            onReady={(bundle) => void saveCapture(bundle)}
          />
        ) : null}

        {capture ? (
          <section className={styles.detectorReady}>
            <span>03 · DETECTOR</span>
            <h2>Card map ready.</h2>
            <p>The single active detector connects here next.</p>
          </section>
        ) : null}
      </main>
    </AppShell>
  );
}
