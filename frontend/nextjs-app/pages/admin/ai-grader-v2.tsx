import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import AppShell from "../../components/AppShell";
import { CaptureWorkspace, type SpeedsterCaptureBundle } from "../../components/ai-grader-v2/CaptureWorkspace";
import { ReviewWorkspace } from "../../components/ai-grader-v2/ReviewWorkspace";
import type {
  SpeedsterInMemoryTraceSave,
  SpeedsterTraceProposalInput,
} from "../../components/ai-grader-v2/DefectTraceEditor";
import SharedLabelEditor from "../../components/human-grade/SharedLabelEditor";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE,
  type HumanGradeLabelEditorValue,
} from "../../lib/humanGrade";
import type {
  SpeedsterDefectType,
  SpeedsterReviewFinding,
} from "../../lib/ai-grader-v2/contracts";
import { speedsterImageService } from "../../lib/ai-grader-v2/image-service";
import {
  SPEEDSTER_REVIEW_IMAGE_REFRESH_INTERVAL_MS,
  createCoalescedReviewImageRefresh,
  fetchSpeedsterReviewImageUrls,
  type SpeedsterReviewImageUrls,
} from "../../lib/ai-grader-v2/review-image-urls";
import {
  calculateSpeedsterReview,
  completeSpeedsterReview,
  speedsterDetectorViews,
  type SpeedsterReviewMeasurementAction,
} from "../../lib/ai-grader-v2/review";
import {
  decodeSpeedsterTraceRleV1,
  encodeSpeedsterTraceRleV1,
} from "../../lib/ai-grader-v2/trace-codec";
import {
  decodeSpeedsterTraceBitmapWireV1,
  encodeSpeedsterTraceBitmapWireV1,
} from "../../lib/ai-grader-v2/trace-bitmap-wire";
import {
  buildSpeedsterTraceProvenanceRevision,
  isNonEmptySpeedsterTrace,
} from "../../lib/ai-grader-v2/trace-editor";
import styles from "../../styles/AiGraderV2Admin.module.css";

type SpeedsterDraft = { id: string; cardProfile: "POKEMON" | "SPORTS" };
type SpeedsterReviewRemeasurementResult =
  | Readonly<{ applied: true }>
  | Readonly<{ applied: false; message: string }>;
type SpeedsterCompletion = {
  label: { certificateNumber: string; slot: number };
  publicReportSlug: string;
  learning: {
    catchUpStatus: string;
    ready: boolean;
    bankCursor: { completionOrder: number } | null;
    harvest: { admittedLessons: number; skippedLessons: number };
  };
};

export default function AiGraderV2AdminPage() {
  const { session, loading, ensureSession } = useSession();
  const [identity, setIdentity] = useState<HumanGradeLabelEditorValue>(EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE);
  const [draft, setDraft] = useState<SpeedsterDraft | null>(null);
  const [capture, setCapture] = useState<SpeedsterCaptureBundle | null>(null);
  const [defects, setDefects] = useState<SpeedsterReviewFinding[] | null>(null);
  const [lastRemovedDefectId, setLastRemovedDefectId] = useState<string | null>(null);
  const [completion, setCompletion] = useState<SpeedsterCompletion | null>(null);
  const [reviewImageUrls, setReviewImageUrls] = useState<SpeedsterReviewImageUrls | null>(null);
  const [initializeFailed, setInitializeFailed] = useState(false);
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
  const sourceImageUrls = useMemo(() => {
    if (reviewImageUrls) {
      return Object.fromEntries(([
        "FRONT",
        "BACK",
      ] as const).flatMap((side) => Object.entries(reviewImageUrls[side].views)
        .map(([view, imageUrl]) => [`${side}:${view}`, imageUrl])));
    }
    return capture ? Object.fromEntries([
      ...speedsterDetectorViews(capture.front),
      ...speedsterDetectorViews(capture.back),
    ].map(({ id, imageUrl }) => [id, imageUrl])) : {};
  }, [capture, reviewImageUrls]);
  const reviewActive = Boolean(capture && review && defects !== null && !completion);
  const imageErrorRetryUsed = useRef(false);
  const refreshReviewImages = useMemo(() => {
    if (!session?.token || !draft?.id) return null;
    return createCoalescedReviewImageRefresh(async () => {
      const urls = await fetchSpeedsterReviewImageUrls({ token: session.token!, sessionId: draft.id });
      setReviewImageUrls(urls);
      return urls;
    });
  }, [draft?.id, session?.token]);

  const silentlyRefreshReviewImages = useCallback(() => {
    imageErrorRetryUsed.current = false;
    void refreshReviewImages?.().catch(() => undefined);
  }, [refreshReviewImages]);

  const retryReviewImagesOnce = useCallback(() => {
    if (imageErrorRetryUsed.current) return;
    imageErrorRetryUsed.current = true;
    void refreshReviewImages?.().catch(() => undefined);
  }, [refreshReviewImages]);

  useEffect(() => {
    setReviewImageUrls(null);
    imageErrorRetryUsed.current = false;
  }, [draft?.id]);

  useEffect(() => {
    if (!reviewActive || !refreshReviewImages) return;
    silentlyRefreshReviewImages();
    const timer = window.setInterval(
      silentlyRefreshReviewImages,
      SPEEDSTER_REVIEW_IMAGE_REFRESH_INTERVAL_MS,
    );
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") silentlyRefreshReviewImages();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshReviewImages, reviewActive, silentlyRefreshReviewImages]);

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

  const initializeReview = useCallback(async () => {
    if (!session?.token || !draft) throw new Error("Speedster detector state cannot initialize without its draft.");
    setInitializeFailed(false);
    setMessage("SAM 3 is scanning the server-owned Front and Back card views.");
    const initializeResponse = await fetch(
      `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(draft.id)}/review-action`,
      {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ action: { type: "INITIALIZE" } }),
      },
    );
    const initialized = (await initializeResponse.json().catch(() => ({}))) as {
      reviewedDefects?: SpeedsterReviewFinding[];
      message?: string;
    };
    if (!initializeResponse.ok || !initialized.reviewedDefects) {
      throw new Error(initialized.message ?? "Speedster detector state could not be initialized.");
    }
    setDefects(initialized.reviewedDefects);
    setMessage("SAM 3 scan complete. Review the measured card map.");
  }, [draft, session?.token]);

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
      await initializeReview();
    } catch (error) {
      setInitializeFailed(true);
      setMessage(error instanceof Error ? error.message : "Card geometry could not be saved.");
    } finally {
      setWorking(false);
    }
  };

  const runReviewRemeasurement = async (
    action: SpeedsterReviewMeasurementAction,
    pendingMessage: string,
    successMessage: string,
    fallbackErrorMessage: string,
  ): Promise<SpeedsterReviewRemeasurementResult> => {
    if (!session?.token || !draft || !capture || !defects || working) {
      return { applied: false, message: fallbackErrorMessage };
    }
    setWorking(true);
    setMessage(pendingMessage);
    try {
      const wireAction = action.type === "TRACE_SAVE"
        ? (() => {
            const { finalTrace, ...trace } = action.trace;
            return {
              ...action,
              trace: {
                ...trace,
                traceWire: encodeSpeedsterTraceBitmapWireV1(
                  decodeSpeedsterTraceRleV1(finalTrace),
                  finalTrace.sha256,
                ),
              },
            };
          })()
        : action;
      const response = await fetch(
        `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(draft.id)}/review-action`,
        {
          method: "POST",
          headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
          body: JSON.stringify({ action: wireAction }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        reviewedDefects?: SpeedsterReviewFinding[];
        message?: string;
      };
      if (!response.ok || !payload.reviewedDefects) {
        throw new Error(payload.message ?? "Measured review changes could not be saved to the draft.");
      }
      setDefects(payload.reviewedDefects);
      setMessage(successMessage);
      return { applied: true };
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : fallbackErrorMessage;
      setMessage(failureMessage);
      return { applied: false, message: failureMessage };
    } finally {
      setWorking(false);
    }
  };

  const loadTrace = useCallback(async (findingId: string) => {
    if (!session?.token || !draft) return null;
    try {
      const response = await fetch(
        `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(draft.id)}/review-action?findingId=${encodeURIComponent(findingId)}`,
        {
          method: "GET",
          headers: buildAdminHeaders(session.token),
          cache: "no-store",
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { traceWire?: unknown };
      if (!response.ok || !payload.traceWire) return null;
      return encodeSpeedsterTraceRleV1(decodeSpeedsterTraceBitmapWireV1(payload.traceWire));
    } catch {
      return null;
    }
  }, [draft, session?.token]);

  const traceProposal = async (input: SpeedsterTraceProposalInput): Promise<Uint8Array | null> => {
    if (!session?.token || !draft) return null;
    const currentTraceWire = isNonEmptySpeedsterTrace(input.visibleTrace)
      ? (() => {
          const rle = encodeSpeedsterTraceRleV1(input.visibleTrace);
          return encodeSpeedsterTraceBitmapWireV1(input.visibleTrace, rle.sha256);
        })()
      : null;
    const proposal = await speedsterImageService.traceProposal(session.token, {
      sessionId: draft.id,
      side: input.target.side,
      findingId: input.target.findingId,
      stroke: {
        canonicalPoints: input.canonicalPoints,
        strokeWidthPixels: input.strokeWidthPixels,
        strokeWidthMm: input.strokeWidthMm,
        cropTransformVersion: input.cropTransform.version,
      },
      currentTraceWire,
    });
    return decodeSpeedsterTraceBitmapWireV1(proposal.traceWire);
  };

  const saveTrace = async (input: SpeedsterInMemoryTraceSave): Promise<boolean | string> => {
    const finalTrace = encodeSpeedsterTraceRleV1(input.trace);
    const traceProvenance = buildSpeedsterTraceProvenanceRevision({
      sourceViewId: input.target.sourceViewId,
      cropTransform: input.cropTransform,
      highlighterStrokes: input.highlighterStrokes,
      priorTraceProvenance: input.priorTraceProvenance,
      finalTraceSha256: finalTrace.sha256,
    });
    const newFindingId = input.target.findingId
      ? null
      : `${input.target.side}:smart-${crypto.randomUUID()}`;
    const action: SpeedsterReviewMeasurementAction = input.target.findingId
      ? {
          type: "TRACE_SAVE",
          side: input.target.side,
          findingId: input.target.findingId,
          trace: { finalTrace, traceProvenance },
        }
      : {
          type: "TRACE_SAVE",
          side: input.target.side,
          findingId: null,
          trace: {
            id: newFindingId as string,
            defectType: "FAINT_COLOR_VARIATION",
            sourceViewId: input.target.sourceViewId,
            finalTrace,
            traceProvenance,
          },
        };
    const measurement = await runReviewRemeasurement(
      action,
      "Measuring the saved trace.",
      "Trace measured. Select its defect type if needed.",
      "Trace measurement failed. The visible trace remains editable.",
    );
    if (!measurement.applied) throw new Error(measurement.message);
    return newFindingId ?? true;
  };

  const completeGrade = async () => {
    if (!session?.token || !draft || !review || working) return;
    setWorking(true);
    setMessage("Completing the grade and adding its label to the print queue.");
    try {
      const response = await fetch(
        `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(draft.id)}/complete-label`,
        {
          method: "POST",
          headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
          body: JSON.stringify({}),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as SpeedsterCompletion & { message?: string };
      if (!response.ok || !payload.label || !payload.publicReportSlug) {
        throw new Error(payload.message ?? "Speedster grade could not be completed.");
      }
      setDefects(completeSpeedsterReview(defects ?? []));
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
            {initializeFailed ? (
              <button type="button" disabled={working} onClick={() => {
                if (working) return;
                setWorking(true);
                void initializeReview()
                  .catch((error) => {
                    setInitializeFailed(true);
                    setMessage(error instanceof Error ? error.message : "Speedster detector state could not be initialized.");
                  })
                  .finally(() => setWorking(false));
              }}>Retry server scan</button>
            ) : null}
          </section>
        ) : null}

        {capture && review && defects !== null && !completion ? (
          <ReviewWorkspace
            cornerShape={capture.cornerShape}
            masterImageUrls={reviewImageUrls ? {
              FRONT: reviewImageUrls.FRONT.master,
              BACK: reviewImageUrls.BACK.master,
            } : { FRONT: capture.front.inspectionUrl, BACK: capture.back.inspectionUrl }}
            inspectionFrames={{ FRONT: capture.front.inspectionFrame, BACK: capture.back.inspectionFrame }}
            sourceImageUrls={sourceImageUrls}
            defects={review.defects.filter((defect) => defect.reviewResult !== "REMOVED")}
            grade={review.grade}
            canUndo={lastRemovedDefectId !== null}
            onRemoveDefect={(defectId) => {
              const removed = defects.find((defect) => defect.id === defectId);
              if (!removed) return;
              void runReviewRemeasurement(
                { type: "REMOVE", defectId },
                "Removing the finding and recalculating its card measurements.",
                "Finding removed from grading and saved as reviewer feedback.",
                "Finding removal measurement failed.",
              ).then((applied) => {
                if (applied) setLastRemovedDefectId(removed.id);
              });
            }}
            onUndo={() => {
              if (!lastRemovedDefectId) return;
              void runReviewRemeasurement(
                { type: "UNDO", defectId: lastRemovedDefectId },
                "Restoring the finding and recalculating its card measurements.",
                "Last removed finding restored.",
                "Finding restore measurement failed.",
              ).then((applied) => {
                if (applied) setLastRemovedDefectId(null);
              });
            }}
            onDefectTypeChange={(defectId: string, defectType: SpeedsterDefectType) => {
              void runReviewRemeasurement(
                { type: "CHANGE_TYPE", defectId, defectType },
                "Changing the defect type and recalculating its card measurements.",
                "Defect type and grade math updated.",
                "Defect type measurement failed.",
              );
            }}
            onTraceProposal={traceProposal}
            onTraceSave={saveTrace}
            onTraceLoad={loadTrace}
            onImageError={retryReviewImagesOnce}
            onComplete={() => void completeGrade()}
          />
        ) : null}

        {completion ? (
          <section className={styles.completePanel}>
            <span>04 · COMPLETE</span>
            <h2>{completion.label.certificateNumber}</h2>
            <p>Label queue slot {completion.label.slot} · Grade {review?.grade.overall.displayGrade.toFixed(1)}</p>
            <p>
              Memory {completion.learning.ready ? "ready" : completion.learning.catchUpStatus.toLowerCase()}
              {" · "}{completion.learning.harvest.admittedLessons} lessons saved
              {" · "}{completion.learning.harvest.skippedLessons} skipped
              {" · cursor "}{completion.learning.bankCursor?.completionOrder ?? "none"}
            </p>
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
