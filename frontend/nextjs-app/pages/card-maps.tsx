import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import AppShell from "../components/AppShell";
import {
  CaptureWorkspace,
  type SpeedsterCaptureBundle,
} from "../components/ai-grader-v2/CaptureWorkspace";
import {
  SpeedsterTrainWorkspace,
  type SpeedsterTrainMapState,
  type SpeedsterTrainSource,
} from "../components/ai-grader-v2/SpeedsterTrainWorkspace";
import SharedLabelEditor from "../components/human-grade/SharedLabelEditor";
import { hasAdminAccess, hasAdminPhoneAccess } from "../constants/admin";
import { useSession } from "../hooks/useSession";
import { SPEEDSTER_MAP_FILTER_POLICY_VERSION } from "../lib/ai-grader-v2/card-type-map-contracts";
import { toCardMapOperatorMessage } from "../lib/ai-grader-v2/card-map-copy";
import {
  SpeedsterIdentityValidationError,
  canonicalizeSpeedsterSessionIdentity,
  type SpeedsterSessionIdentity,
} from "../lib/ai-grader-v2/identity";
import { buildAdminHeaders } from "../lib/adminHeaders";
import {
  EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE,
  type HumanGradeLabelEditorValue,
} from "../lib/humanGrade";
import styles from "../styles/CardMaps.module.css";

type SpeedsterDraft = Readonly<{ id: string; cardProfile: "POKEMON" | "SPORTS" }>;

function printedIdentity(value: HumanGradeLabelEditorValue) {
  return canonicalizeSpeedsterSessionIdentity(
    value.cardType,
    value.cardType === "SPORTS"
      ? {
          playerName: value.playerName,
          year: value.year,
          manufacturer: value.manufacturer,
          productSet: value.productSet,
          parallel: value.parallel,
          insert: value.insert,
          cardNumber: value.cardNumber,
        }
      : {
          cardName: value.cardName,
          year: value.year,
          productSet: value.productSet,
          parallel: value.parallel,
          cardNumber: value.cardNumber,
        },
  );
}

function mapAction(map: SpeedsterTrainMapState) {
  return map.status === "LOADED" ? "EDIT CARD MAP" : "CREATE CARD MAP";
}

export default function CardMapsPage() {
  const router = useRouter();
  const { session, loading, ensureSession } = useSession();
  const [identity, setIdentity] = useState<HumanGradeLabelEditorValue>(EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<SpeedsterDraft | null>(null);
  const [draftIdentity, setDraftIdentity] = useState<SpeedsterSessionIdentity | null>(null);
  const [map, setMap] = useState<SpeedsterTrainMapState | null>(null);
  const [source, setSource] = useState<SpeedsterTrainSource | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("Create a new exact CARD MAP or open one from a completed card.");
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const identitySectionRef = useRef<HTMLElement>(null);
  const sessionId = typeof router.query.sessionId === "string" ? router.query.sessionId : null;
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone],
  );

  const focusNewCard = useCallback(() => {
    if (sessionId) {
      void router.push("/card-maps#new-card-map");
      return;
    }
    identitySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const input = identitySectionRef.current?.querySelector<HTMLInputElement>("input");
    (input ?? identitySectionRef.current)?.focus();
  }, [router, sessionId]);

  useEffect(() => {
    if (sessionId || typeof window === "undefined" || window.location.hash !== "#new-card-map") return;
    const frame = window.requestAnimationFrame(focusNewCard);
    return () => window.cancelAnimationFrame(frame);
  }, [focusNewCard, sessionId]);

  useEffect(() => {
    if (!session?.token || !sessionId || !isAdmin) return;
    let active = true;
    setSource(null);
    setMap(null);
    setWorkflowError(null);
    setMessage("Loading the exact completed-card CARD MAP source.");
    void fetch(
      `/api/admin/ai-grader-v2/maps/source?sessionId=${encodeURIComponent(sessionId)}`,
      { headers: buildAdminHeaders(session.token), cache: "no-store" },
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as {
          source?: SpeedsterTrainSource;
          map?: SpeedsterTrainMapState;
          message?: string;
        };
        if (!response.ok || !payload.source || !payload.map) {
          throw new Error(payload.message ?? "Completed-card CARD MAP source could not be loaded.");
        }
        if (!active) return;
        setSource(payload.source);
        setMap(payload.map);
        setMessage(`${mapAction(payload.map)} · Completed card ${sessionId}.`);
      })
      .catch((error) => {
        if (!active) return;
        const failure = toCardMapOperatorMessage(
          error instanceof Error ? error.message : "Completed-card CARD MAP source could not be loaded.",
        );
        setWorkflowError(failure);
        setMessage(failure);
      });
    return () => { active = false; };
  }, [isAdmin, session?.token, sessionId]);

  const updateIdentity = (field: keyof HumanGradeLabelEditorValue, value: string) => {
    setIdentity((current) => field === "cardType"
      ? {
          ...current,
          cardType: value as HumanGradeLabelEditorValue["cardType"],
          playerName: "",
          cardName: "",
          manufacturer: "",
          insert: "",
        }
      : { ...current, [field]: value });
    setWorkflowError(null);
    setFieldErrors((current) => {
      if (field === "cardType") return {};
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const createDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.token || working || sessionId) return;
    setWorking(true);
    setFieldErrors({});
    setWorkflowError(null);
    setMessage("Creating the exact CARD MAP source.");
    try {
      const exactIdentity = printedIdentity(identity);
      const response = await fetch("/api/admin/ai-grader-v2/sessions", {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ cardProfile: identity.cardType, identity: exactIdentity }),
      });
      const payload = await response.json().catch(() => ({})) as {
        session?: SpeedsterDraft;
        message?: string;
        fields?: Record<string, string>;
      };
      if (!response.ok || !payload.session) {
        if (payload.fields) setFieldErrors(payload.fields);
        throw new Error(payload.message ?? "CARD MAP source could not be created.");
      }
      const mapResponse = await fetch(
        `/api/admin/ai-grader-v2/maps/current?sessionId=${encodeURIComponent(payload.session.id)}`,
        { headers: buildAdminHeaders(session.token), cache: "no-store" },
      );
      const mapPayload = await mapResponse.json().catch(() => ({})) as {
        map?: SpeedsterTrainMapState;
        message?: string;
      };
      if (!mapResponse.ok || !mapPayload.map) {
        throw new Error(mapPayload.message ?? "Exact CARD MAP state could not be loaded.");
      }
      setDraft(payload.session);
      setDraftIdentity(exactIdentity);
      setMap(mapPayload.map);
      setMessage(`${mapAction(mapPayload.map)} · Add exact Front and Back source images.`);
    } catch (error) {
      if (error instanceof SpeedsterIdentityValidationError) setFieldErrors(error.fields);
      const failure = toCardMapOperatorMessage(
        error instanceof Error ? error.message : "CARD MAP source could not be created.",
      );
      setWorkflowError(failure);
      setMessage(failure);
    } finally {
      setWorking(false);
    }
  };

  const saveCapture = async (bundle: SpeedsterCaptureBundle) => {
    if (!session?.token || !draft || !draftIdentity || working) return;
    setWorking(true);
    setWorkflowError(null);
    setMessage("Saving the exact Front and Back CARD MAP source.");
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
          ...(bundle.front.mapRegistration && bundle.back.mapRegistration ? {
            mapBinding: {
              revisionId: bundle.front.mapRegistration.mapRevisionId,
              filterPolicyVersion: SPEEDSTER_MAP_FILTER_POLICY_VERSION,
              registration: {
                front: bundle.front.mapRegistration,
                back: bundle.back.mapRegistration,
              },
            },
          } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "CARD MAP source could not be saved.");
      setSource({
        sessionId: draft.id,
        cardProfile: draft.cardProfile,
        identity: draftIdentity,
        front: { rectifiedUrl: bundle.front.rectifiedUrl, centeringQuad: bundle.front.centeringQuad },
        back: { rectifiedUrl: bundle.back.rectifiedUrl, centeringQuad: bundle.back.centeringQuad },
      });
      setMessage(`${map ? mapAction(map) : "CREATE CARD MAP"} · Exact Front and Back source saved.`);
    } catch (error) {
      const failure = toCardMapOperatorMessage(
        error instanceof Error ? error.message : "CARD MAP source could not be saved.",
      );
      setWorkflowError(failure);
      setMessage(failure);
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <AppShell background="black"><div className={styles.center}>Loading CARD MAPS…</div></AppShell>;
  if (!session) {
    return <AppShell background="black"><div className={styles.center}><button type="button" onClick={() => void ensureSession()}>Sign in to CARD MAPS</button></div></AppShell>;
  }
  if (!isAdmin) return <AppShell background="black"><div className={styles.center}>Admin access required.</div></AppShell>;

  return (
    <AppShell background="black" hideFooter>
      <Head><title>Card Maps | Ten Kings</title><meta name="robots" content="noindex,nofollow" /></Head>
      <main className={styles.page}>
        <nav className={styles.topNav} aria-label="Card Maps navigation">
          <Link href="/admin">Admin Home</Link>
          <Link href="/admin/ai-grader-v2">AI Grader V2</Link>
          <Link href="/admin/ai-grader-v2/completed">Completed cards</Link>
        </nav>

        <section className={styles.cardMapsPanel} aria-labelledby="card-maps-heading">
          <div className={styles.cardMapsVisual} aria-hidden="true">
            <div className={`${styles.mapCard} ${styles.mapCardRear}`}>
              <span className={styles.mapCardFrame} />
              <span className={styles.mapCardCrosshair} />
            </div>
            <div className={`${styles.mapCard} ${styles.mapCardFront}`}>
              <span className={styles.mapCardFrame} />
              <span className={styles.mapCardCrosshair} />
              <span className={styles.mapCardNode} />
              <span className={`${styles.mapCardNode} ${styles.mapCardNodeRight}`} />
              <span className={`${styles.mapCardNode} ${styles.mapCardNodeBottom}`} />
            </div>
            <span className={styles.mapScanLine} />
            <span className={styles.mapSignal} />
          </div>
          <div className={styles.cardMapsContent}>
            <span>EXACT CARD IDENTITY CONTROL</span>
            <h1 id="card-maps-heading">CARD MAPS</h1>
            <p>Create or edit the exact Front and Back CARD MAP for one exact card identity.</p>
            <p className={styles.cardMapsStatus} role="status" aria-live="polite">{message}</p>
            <button className={styles.cardMapsCta} type="button" onClick={focusNewCard}>CREATE CARD MAP</button>
          </div>
        </section>

        {sessionId ? (
          <section className={styles.workflowPanel} aria-labelledby="existing-card-map-heading">
            <span>COMPLETED CARD · EXACT SESSION</span>
            <h2 id="existing-card-map-heading">{map ? mapAction(map) : "CARD MAP"}</h2>
            <p>{sessionId}</p>
            {workflowError ? (
              <div className={styles.localError} role="alert">
                <p>{workflowError}</p>
                <Link href={`/admin/ai-grader-v2/completed/${encodeURIComponent(sessionId)}`}>FIX CARD IDENTITY</Link>
              </div>
            ) : null}
          </section>
        ) : (
          <section
            id="new-card-map"
            ref={identitySectionRef}
            className={styles.identitySection}
            aria-labelledby="new-card-map-heading"
            tabIndex={-1}
          >
            <header>
              <span>EXACT CARD IDENTITY</span>
              <h2 id="new-card-map-heading">NEW CARD MAP</h2>
              <p>Enter the printed identity, then continue to the exact Front and Back source.</p>
            </header>
            {!draft ? (
              <>
                <SharedLabelEditor
                  mode="SPEEDSTER"
                  value={identity}
                  onChange={updateIdentity}
                  onSubmit={createDraft}
                  certificateNumber="TKS-CARD-MAP"
                  fieldErrors={fieldErrors}
                  saving={working}
                  primaryActionLabel="CONTINUE TO FRONT + BACK"
                />
                {workflowError ? <p className={styles.localError} role="alert">{workflowError}</p> : null}
              </>
            ) : map ? (
              <div className={styles.mapState} role="status">
                <strong>{mapAction(map)}</strong>
                <span>{map.status === "LOADED" ? `Exact revision ${map.revision?.version} loaded.` : "No exact CARD MAP exists yet."}</span>
              </div>
            ) : null}
          </section>
        )}

        {!sessionId && draft && map && !source ? (
          <CaptureWorkspace
            token={session.token}
            sessionId={draft.id}
            cardProfile={draft.cardProfile}
            activeMapRevisionId={map.revision?.revisionId ?? null}
            onReady={(bundle) => void saveCapture(bundle)}
          />
        ) : null}

        {source && map ? (
          <SpeedsterTrainWorkspace
            key={source.sessionId}
            token={session.token}
            source={source}
            initialMap={map}
            onSaved={(nextMap) => {
              setMap(nextMap);
              setMessage(`${mapAction(nextMap)} · Revision ${nextMap.revision?.version} is active.`);
            }}
          />
        ) : null}
      </main>
    </AppShell>
  );
}
