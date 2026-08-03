import Head from "next/head";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import AppShell from "../../components/AppShell";
import { CaptureWorkspace, type SpeedsterCaptureBundle } from "../../components/ai-grader-v2/CaptureWorkspace";
import { ReviewWorkspace } from "../../components/ai-grader-v2/ReviewWorkspace";
import SharedLabelEditor from "../../components/human-grade/SharedLabelEditor";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE,
  type HumanGradeLabelEditorValue,
} from "../../lib/humanGrade";
import type {
  SpeedsterCardSide,
  SpeedsterDefectType,
  SpeedsterMeasuredDefect,
} from "../../lib/ai-grader-v2/contracts";
import { speedsterImageService } from "../../lib/ai-grader-v2/image-service";
import {
  calculateSpeedsterReview,
  correctSpeedsterDefectType,
  prepareSpeedsterCompletion,
  removeSpeedsterDefect,
  restoreSpeedsterDefect,
  scanSpeedsterCapture,
  speedsterDetectorViews,
} from "../../lib/ai-grader-v2/review";
import styles from "../../styles/AiGraderV2Admin.module.css";

type SpeedsterDraft = { id: string; cardProfile: "POKEMON" | "SPORTS" };
type SpeedsterCompletion = {
  label: { certificateNumber: string; slot: number };
  publicReportSlug: string;
};

export default function AiGraderV2AdminPage() {
  const { session, loading, ensureSession } = useSession();
  const [identity, setIdentity] = useState<HumanGradeLabelEditorValue>(EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE);
  const [draft, setDraft] = useState<SpeedsterDraft | null>(null);
  const [capture, setCapture] = useState<SpeedsterCaptureBundle | null>(null);
  const [defects, setDefects] = useState<SpeedsterMeasuredDefect[] | null>(null);
  const [lastRemovedDefect, setLastRemovedDefect] = useState<SpeedsterMeasuredDefect | null>(null);
  const [detectorVersion, setDetectorVersion] = useState<string | null>(null);
  const [completion, setCompletion] = useState<SpeedsterCompletion | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("Enter the exact information that belongs on the Ten Kings label.");
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone],
  );
  const review = useMemo(
    () => capture ? calculateSpeedsterReview(capture, defects ?? []) : null,
    [capture, defects],
  );
  const sourceImageUrls = useMemo(() => capture ? Object.fromEntries([
    ...speedsterDetectorViews(capture.front),
    ...speedsterDetectorViews(capture.back),
  ].map(({ id, imageUrl }) => [id, imageUrl])) : {}, [capture]);

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
      inspectionStorageKey: side.inspectionStorageKey,
      inspectionFrame: side.inspectionFrame,
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
      const scanned = await scanSpeedsterCapture({
        capture: bundle,
        detect: (request) => speedsterImageService.detect(session.token, request),
        onSide: (side) => setMessage(`SAM 3 is scanning the ${side === "FRONT" ? "Front" : "Back"} card views.`),
      });
      setDetectorVersion(scanned.detectorVersion);
      setDefects(scanned.defects);
      setMessage("SAM 3 scan complete. Review the measured card map.");
    } catch (error) {
      setCapture(null);
      setMessage(error instanceof Error ? error.message : "Card geometry could not be saved.");
    } finally {
      setWorking(false);
    }
  };

  const smartMark = async (
    side: SpeedsterCardSide,
    box: { x: number; y: number; width: number; height: number },
  ) => {
    if (!session?.token || !capture || working) return;
    setWorking(true);
    setMessage("Measuring the Smart-Mark.");
    const id = `${side}:smart-${crypto.randomUUID()}`;
    try {
      const measured = await speedsterImageService.measure(session.token, {
        side,
        cornerShape: capture.cornerShape,
        marks: [{
          id,
          defectType: "FAINT_COLOR_VARIATION",
          sourceViewId: `${side}:ORIGINAL`,
          canonicalContour: [
            { x: box.x, y: box.y },
            { x: box.x + box.width, y: box.y },
            { x: box.x + box.width, y: box.y + box.height },
            { x: box.x, y: box.y + box.height },
          ],
        }],
      });
      const added = measured.defects.map((defect) => ({
        ...defect,
        origin: "SMART_MARK" as const,
        reviewResult: "SMART_MARKED" as const,
      }));
      if (!added.length) throw new Error("Speedster did not return the Smart-Mark measurement.");
      setDefects((current) => [...(current ?? []), ...added]);
      setMessage("Smart-Mark measured. Select its defect type if needed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Smart-Mark measurement failed.");
    } finally {
      setWorking(false);
    }
  };

  const completeGrade = async () => {
    if (!session?.token || !draft || !review || working) return;
    setWorking(true);
    setMessage("Completing the grade and adding its label to the print queue.");
    const prepared = prepareSpeedsterCompletion(review.defects, review.grade, detectorVersion!);
    try {
      const response = await fetch(
        `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(draft.id)}/complete-label`,
        {
          method: "POST",
          headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
          body: JSON.stringify(prepared.body),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as SpeedsterCompletion & { message?: string };
      if (!response.ok || !payload.label || !payload.publicReportSlug) {
        throw new Error(payload.message ?? "Speedster grade could not be completed.");
      }
      setDefects(prepared.completedDefects);
      setCompletion(payload);
      setMessage("Grade complete. The public evidence report and label are ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Speedster grade could not be completed.");
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
          <nav><Link href="/admin/ai-grader-v2/completed">Completed cards</Link><Link href="/admin">Admin Home</Link></nav>
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

        {capture && defects === null ? (
          <section className={styles.statusPanel}>
            <span>03 · SAM 3</span>
            <h2>Scanning card views.</h2>
            <p>Every finding lands on one measured card map.</p>
          </section>
        ) : null}

        {capture && review && defects !== null && !completion ? (
          <ReviewWorkspace
            masterImageUrls={{ FRONT: capture.front.inspectionUrl, BACK: capture.back.inspectionUrl }}
            inspectionFrames={{ FRONT: capture.front.inspectionFrame, BACK: capture.back.inspectionFrame }}
            sourceImageUrls={sourceImageUrls}
            defects={review.defects.filter((defect) => defect.reviewResult !== "REMOVED")}
            grade={review.grade}
            canUndo={lastRemovedDefect !== null}
            onRemoveDefect={(defectId) => {
              const removed = defects.find((defect) => defect.id === defectId);
              if (!removed) return;
              setLastRemovedDefect(removed);
              setDefects(removeSpeedsterDefect(defects, defectId));
              setMessage("Finding removed from grading and saved as reviewer feedback.");
            }}
            onUndo={() => {
              if (!lastRemovedDefect) return;
              setDefects((current) => current
                ? restoreSpeedsterDefect(current, lastRemovedDefect)
                : current);
              setLastRemovedDefect(null);
              setMessage("Last removed finding restored.");
            }}
            onDefectTypeChange={(defectId: string, defectType: SpeedsterDefectType) => {
              setDefects((current) => current
                ? correctSpeedsterDefectType(current, defectId, defectType)
                : current);
              setMessage("Defect type and grade math updated.");
            }}
            onSmartMark={(side, box) => void smartMark(side, box)}
            onComplete={() => void completeGrade()}
          />
        ) : null}

        {completion ? (
          <section className={styles.completePanel}>
            <span>04 · COMPLETE</span>
            <h2>{completion.label.certificateNumber}</h2>
            <p>Label queue slot {completion.label.slot} · Grade {review?.grade.overall.displayGrade.toFixed(1)}</p>
            <Link href={`/ai-grader-v2/reports/${completion.publicReportSlug}`}>
              Open public evidence report →
            </Link>
            <Link href="/admin/ai-grader-v2/completed">Open completed cards →</Link>
            <Link href="/admin/ai-grader-v2" onClick={(event) => {
              event.preventDefault();
              window.location.assign("/admin/ai-grader-v2");
            }}>Next card →</Link>
          </section>
        ) : null}
      </main>
    </AppShell>
  );
}
