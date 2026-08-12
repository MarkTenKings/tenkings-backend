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
import {
  SPEEDSTER_MAP_FILTER_POLICY_VERSION,
} from "../lib/ai-grader-v2/card-type-map-contracts";
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

function familyApplicability(identity: Pick<HumanGradeLabelEditorValue,
  "cardType" | "year" | "manufacturer" | "productSet" | "insert" | "parallel">) {
  const familyFields = [
    identity.year,
    identity.cardType === "SPORTS" ? identity.manufacturer : null,
    identity.productSet,
    identity.cardType === "SPORTS" ? identity.insert : null,
    identity.parallel,
  ].filter(Boolean);
  const parts = familyFields.length
    ? [identity.year, identity.cardType === "SPORTS" ? "Sports" : "Pokémon", ...familyFields.slice(1)].filter(Boolean)
    : [];
  return parts.length ? `all ${parts.join(" ")} cards` : "all cards matching this Year, Set, and Parallel";
}

function exactApplicability(identity: Pick<HumanGradeLabelEditorValue,
  "cardType" | "playerName" | "cardName" | "cardNumber">) {
  const name = identity.cardType === "SPORTS" ? identity.playerName : identity.cardName;
  const exact = [name, identity.cardNumber ? `#${identity.cardNumber}` : null].filter(Boolean).join(" ");
  return exact ? `this exact card only — ${exact}` : "this exact card only";
}

function DualCreationSummary({ identity }: Readonly<{ identity: HumanGradeLabelEditorValue }>) {
  return (
    <section className={styles.dualCreation} aria-label="Maps created by one save">
      <strong>Saving creates both:</strong>
      <span><b>Family Card Map</b> — {familyApplicability(identity)}</span>
      <span><b>Exact Source Map</b> — {exactApplicability(identity)}</span>
      <p>The same reviewed Front/Back geometry starts both complete maps. Exact replaces Family for this source card; the maps never merge.</p>
    </section>
  );
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
  const [message, setMessage] = useState("One completed authoring save creates both the Family and Exact Source maps.");
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
    setMessage("Loading the completed-card source and current editing baseline.");
    const loadSource = async (scope: "EXACT" | "FAMILY") => {
      const response = await fetch(
        `/api/admin/ai-grader-v2/maps/source?sessionId=${encodeURIComponent(sessionId)}&scope=${scope}`,
        { headers: buildAdminHeaders(session.token), cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({})) as {
        source?: SpeedsterTrainSource;
        map?: SpeedsterTrainMapState;
        message?: string;
      };
      if (!response.ok || !payload.source || !payload.map) {
        throw new Error(payload.message ?? "Completed-card CARD MAP source could not be loaded.");
      }
      return payload;
    };
    void loadSource("EXACT")
      .then(async (exact) => exact.map?.status === "MISSING" ? loadSource("FAMILY") : exact)
      .then((payload) => {
        if (!active || !payload.source || !payload.map) return;
        setSource(payload.source);
        setMap(payload.map);
        setMessage(payload.map.status === "INTEGRITY_ERROR"
          ? "RECOVER CARD MAP · The invalid prior revision is excluded; source imagery is available for draft import and a new atomic Family + Exact save."
          : `${mapAction(payload.map)} · One save will create both Family and Exact Source revisions.`);
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
    setMessage("Creating the exact source-card workspace for Family + Exact authoring.");
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
        `/api/admin/ai-grader-v2/maps/current?sessionId=${encodeURIComponent(payload.session.id)}&scope=EFFECTIVE`,
        { headers: buildAdminHeaders(session.token), cache: "no-store" },
      );
      const mapPayload = await mapResponse.json().catch(() => ({})) as {
        map?: SpeedsterTrainMapState;
        message?: string;
      };
      if (!mapResponse.ok || !mapPayload.map) {
        throw new Error(mapPayload.message ?? "Current Card Map baseline could not be loaded.");
      }
      setDraft(payload.session);
      setDraftIdentity(exactIdentity);
      setMap(mapPayload.map);
      setMessage(`${mapAction(mapPayload.map)} · Add this card's exact Front and Back source images; the final save creates both maps.`);
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
    setMessage("Saving this card's exact Front and Back source imagery and provenance.");
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
      const localSource: SpeedsterTrainSource = {
        sessionId: draft.id,
        cardProfile: draft.cardProfile,
        identity: draftIdentity,
        front: {
          rectifiedUrl: bundle.front.rectifiedUrl,
          centeringQuad: bundle.front.centeringQuad,
          originalStorageKey: bundle.front.originalStorageKey,
          rectifiedStorageKey: bundle.front.rectifiedStorageKey,
          inspectionStorageKey: bundle.front.inspectionStorageKey,
        },
        back: {
          rectifiedUrl: bundle.back.rectifiedUrl,
          centeringQuad: bundle.back.centeringQuad,
          originalStorageKey: bundle.back.originalStorageKey,
          rectifiedStorageKey: bundle.back.rectifiedStorageKey,
          inspectionStorageKey: bundle.back.inspectionStorageKey,
        },
      };
      const sourceResponse = await fetch(
        `/api/admin/ai-grader-v2/maps/source?sessionId=${encodeURIComponent(draft.id)}&scope=EXACT`,
        { headers: buildAdminHeaders(session.token), cache: "no-store" },
      );
      const sourcePayload = await sourceResponse.json().catch(() => ({})) as {
        source?: SpeedsterTrainSource;
        message?: string;
      };
      setSource(sourceResponse.ok && sourcePayload.source ? sourcePayload.source : localSource);
      setMessage(sourceResponse.ok && sourcePayload.source
        ? `${map ? mapAction(map) : "CREATE CARD MAP"} · Exact Front and Back source evidence and hashes are ready for dual authoring.`
        : `${map ? mapAction(map) : "CREATE CARD MAP"} · Source capture is preserved. Stable image keys are exportable; evidence hashes will be verified by the server on save.`);
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
            <span>ONE AUTHORING FLOW · TWO COMPLETE MAPS</span>
            <h1 id="card-maps-heading">CARD MAPS</h1>
            <p>Author Front and Back once. Saving atomically creates a Family Card Map for matching cards and an Exact Source Map for this card.</p>
            <p className={styles.cardMapsStatus} role="status" aria-live="polite">{message}</p>
            <button className={styles.cardMapsCta} type="button" onClick={focusNewCard}>CREATE CARD MAP</button>
          </div>
        </section>

        {sessionId ? (
          <section className={styles.workflowPanel} aria-labelledby="existing-card-map-heading">
            <span>COMPLETED CARD · SOURCE PROVENANCE</span>
            <h2 id="existing-card-map-heading">{map ? mapAction(map) : "CARD MAP"}</h2>
            <p>{sessionId}</p>
            <DualCreationSummary
              identity={source ? {
                ...EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE,
                cardType: source.cardProfile,
                ...source.identity,
                playerName: "playerName" in source.identity ? source.identity.playerName : "",
                cardName: "cardName" in source.identity ? source.identity.cardName : "",
                manufacturer: "manufacturer" in source.identity ? source.identity.manufacturer : "",
                insert: "insert" in source.identity ? source.identity.insert ?? "" : "",
                parallel: source.identity.parallel ?? "",
                cardNumber: source.identity.cardNumber ?? "",
              } : identity}
            />
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
              <span>EXACT SOURCE IDENTITY · DUAL MAP CREATION</span>
              <h2 id="new-card-map-heading">NEW CARD MAP</h2>
              <p>Enter the exact source card printed identity. One completed save creates both required map revisions.</p>
            </header>
            <DualCreationSummary identity={identity} />
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
                <span>{map.status === "LOADED"
                  ? `${map.scope ?? "Existing"} revision ${map.revision?.version} loaded as the editing baseline.`
                  : "Ready for first Family + Exact creation after Front/Back source capture."}</span>
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
            activeMapScope={map.status === "LOADED" ? map.scope ?? null : null}
            activeMapName={map.status === "LOADED" ? map.name ?? null : null}
            onReady={(bundle) => void saveCapture(bundle)}
          />
        ) : null}

        {source && map ? (
          <SpeedsterTrainWorkspace
            key={source.sessionId}
            token={session.token}
            source={source}
            initialMap={map}
            onSaved={(maps) => {
              setMessage(
                `Family r${maps.family.version} and Exact r${maps.exact.version} saved atomically. Exact applies only to this source; Family applies to matching siblings.`,
              );
            }}
          />
        ) : null}
      </main>
    </AppShell>
  );
}
