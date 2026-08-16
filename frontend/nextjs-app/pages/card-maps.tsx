import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import AppShell from "../components/AppShell";
import {
  CaptureWorkspace,
  type SpeedsterCaptureBundle,
  type SpeedsterCaptureInstrumentationEvent,
  type SpeedsterCaptureSaveResult,
} from "../components/ai-grader-v2/CaptureWorkspace";
import {
  SpeedsterTrainWorkspace,
  type SpeedsterTrainMapState,
  type SpeedsterTrainSource,
} from "../components/ai-grader-v2/SpeedsterTrainWorkspace";
import SharedLabelEditor from "../components/human-grade/SharedLabelEditor";
import { hasAdminAccess, hasAdminPhoneAccess } from "../constants/admin";
import { useSession } from "../hooks/useSession";
import { toCardMapOperatorMessage } from "../lib/ai-grader-v2/card-map-copy";
import {
  readSpeedsterCaptureRegistrationDraftForCommittedSession,
  removeSpeedsterCaptureRegistrationDraft,
  speedsterCaptureDraftMatchesCommittedSession,
  type SpeedsterCaptureRegistrationDraft,
} from "../lib/ai-grader-v2/capture-registration-draft";
import {
  SpeedsterIdentityValidationError,
  canonicalizeNewSpeedsterSessionIdentity,
  canonicalizeSpeedsterSessionIdentity,
  speedsterPokemonLayoutType,
  type SpeedsterSessionIdentity,
} from "../lib/ai-grader-v2/identity";
import { buildAdminHeaders } from "../lib/adminHeaders";
import {
  EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE,
  type HumanGradeLabelEditorValue,
} from "../lib/humanGrade";
import styles from "../styles/CardMaps.module.css";

type SpeedsterDraft = Readonly<{ id: string; cardProfile: "POKEMON" | "SPORTS" }>;
type SpeedsterCommittedCaptureRecovery = Readonly<{
  session: SpeedsterDraft & {
    workflowState: "CAPTURED";
    identity: unknown;
    capture: unknown;
    mapRevisionId?: string | null;
    mapRegistration?: unknown;
  };
  browserDraft: SpeedsterCaptureRegistrationDraft;
}>;

type MappedCardRevision = Readonly<{
  scope: "FAMILY" | "EXACT";
  keyGeneration: "EXACT_FROZEN" | "FAMILY_CURRENT" | "FAMILY_LEGACY" | "FAMILY_V2";
  layoutType: "POKEMON" | "TRAINER" | "ENERGY" | null;
  runtimeEligible: boolean;
  mapId: string;
  revisionId: string;
  version: number;
  revisionHash: string;
  mapSchemaVersion: string;
  filterPolicyVersion: string;
  createdAt: string;
}>;

type MappedSourceCard = Readonly<{
  sourceSessionId: string;
  cardProfile: "POKEMON" | "SPORTS";
  workflowState: "CAPTURED" | "COMPLETED";
  identity: SpeedsterSessionIdentity;
  lastMappedAt: string;
  revisions: readonly MappedCardRevision[];
}>;

type MappedCardLibraryState = Readonly<{
  ownerAuthKey: string | null;
  cards: readonly MappedSourceCard[];
  loading: boolean;
  error: string | null;
}>;

const EMPTY_MAPPED_SOURCE_CARDS: readonly MappedSourceCard[] = [];

function printedIdentity(value: HumanGradeLabelEditorValue) {
  return canonicalizeNewSpeedsterSessionIdentity(
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
          layoutType: value.layoutType,
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

function mappedCardName(card: MappedSourceCard) {
  return card.cardProfile === "SPORTS" && "playerName" in card.identity
    ? card.identity.playerName
    : card.cardProfile === "POKEMON" && "cardName" in card.identity
      ? card.identity.cardName
      : "Mapped source card";
}

function mappedCardPokemonLayout(card: MappedSourceCard) {
  if (card.cardProfile !== "POKEMON") return null;
  const identityLayout = speedsterPokemonLayoutType(card.identity);
  return identityLayout ?? card.revisions.find((revision) => (
    revision.scope === "FAMILY" && revision.runtimeEligible && revision.layoutType
  ))?.layoutType ?? null;
}

function mappedCardIdentity(card: MappedSourceCard) {
  const identity = card.identity;
  return card.cardProfile === "SPORTS" && "playerName" in identity
    ? [identity.year, identity.manufacturer, identity.productSet, identity.insert, identity.parallel, identity.cardNumber ? `#${identity.cardNumber}` : null]
        .filter(Boolean).join(" · ")
    : card.cardProfile === "POKEMON" && "cardName" in identity
      ? [identity.year, "Pokémon", mappedCardPokemonLayout(card), identity.productSet, identity.parallel, identity.cardNumber ? `#${identity.cardNumber}` : null]
          .filter(Boolean).join(" · ")
      : "Identity unavailable";
}

function mappedCardSearchText(card: MappedSourceCard) {
  return [card.cardProfile, mappedCardName(card), mappedCardIdentity(card), ...card.revisions.flatMap((revision) => [
    revision.scope,
    revision.keyGeneration,
    revision.layoutType,
    revision.runtimeEligible ? "runtime eligible" : "historical only not runtime eligible",
  ])]
    .join(" ")
    .toLocaleLowerCase("en-US");
}

function familyApplicability(identity: Pick<HumanGradeLabelEditorValue,
  "cardType" | "layoutType" | "year" | "manufacturer" | "productSet" | "insert" | "parallel">) {
  const familyFields = [
    identity.year,
    identity.cardType === "POKEMON" ? identity.layoutType : null,
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
  const [captureMapLookupFailed, setCaptureMapLookupFailed] = useState(false);
  const [source, setSource] = useState<SpeedsterTrainSource | null>(null);
  const [mappedCardLibrary, setMappedCardLibrary] = useState<MappedCardLibraryState>({
    ownerAuthKey: null,
    cards: [],
    loading: false,
    error: null,
  });
  const [mappedCardQuery, setMappedCardQuery] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("One completed authoring save creates both the Family and Exact Source maps.");
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [captureDraftCleanupFailure, setCaptureDraftCleanupFailure] = useState<Readonly<{
    sessionId: string;
    message: string;
  }> | null>(null);
  const [committedCaptureRecovery, setCommittedCaptureRecovery] = useState<SpeedsterCommittedCaptureRecovery | null>(null);
  const identitySectionRef = useRef<HTMLElement>(null);
  const captureSaveInFlight = useRef(false);
  const mappedCardsRequestGeneration = useRef(0);
  const mappedCardsAbortController = useRef<AbortController | null>(null);
  const sessionId = typeof router.query.sessionId === "string" ? router.query.sessionId : null;
  const captureDraftId = typeof router.query.captureDraftId === "string" ? router.query.captureDraftId : null;
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone],
  );
  const mappedCardsAuthKey = isAdmin && session?.token && !sessionId
    ? `${session.user.id}\u0000${session.token}`
    : null;
  const mappedCards = mappedCardLibrary.ownerAuthKey === mappedCardsAuthKey
    ? mappedCardLibrary.cards
    : EMPTY_MAPPED_SOURCE_CARDS;
  const mappedCardsLoading = Boolean(mappedCardsAuthKey) && (
    mappedCardLibrary.ownerAuthKey !== mappedCardsAuthKey || mappedCardLibrary.loading
  );
  const mappedCardsError = mappedCardLibrary.ownerAuthKey === mappedCardsAuthKey
    ? mappedCardLibrary.error
    : null;
  const visibleMappedCards = useMemo(() => {
    const query = mappedCardQuery.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    return query ? mappedCards.filter((card) => mappedCardSearchText(card).includes(query)) : mappedCards;
  }, [mappedCardQuery, mappedCards]);
  const loadMappedCards = useCallback(async () => {
    const requestGeneration = mappedCardsRequestGeneration.current + 1;
    mappedCardsRequestGeneration.current = requestGeneration;
    mappedCardsAbortController.current?.abort();
    mappedCardsAbortController.current = null;
    const token = session?.token;
    const ownerAuthKey = isAdmin && token && !sessionId ? `${session.user.id}\u0000${token}` : null;
    if (!token || !ownerAuthKey) {
      setMappedCardLibrary({ ownerAuthKey: null, cards: [], loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    mappedCardsAbortController.current = controller;
    setMappedCardLibrary({ ownerAuthKey, cards: [], loading: true, error: null });
    try {
      const response = await fetch("/api/admin/ai-grader-v2/maps/list", {
        headers: buildAdminHeaders(token),
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as {
        cards?: readonly MappedSourceCard[];
        message?: string;
      };
      if (!response.ok || !Array.isArray(payload.cards)) {
        throw new Error(payload.message ?? "Existing Card Maps could not be loaded.");
      }
      if (requestGeneration !== mappedCardsRequestGeneration.current || controller.signal.aborted) return;
      setMappedCardLibrary({ ownerAuthKey, cards: payload.cards, loading: false, error: null });
    } catch (error) {
      if (requestGeneration !== mappedCardsRequestGeneration.current || controller.signal.aborted) return;
      setMappedCardLibrary({
        ownerAuthKey,
        cards: [],
        loading: false,
        error: toCardMapOperatorMessage(
          error instanceof Error ? error.message : "Existing Card Maps could not be loaded.",
        ),
      });
    } finally {
      if (requestGeneration === mappedCardsRequestGeneration.current
        && mappedCardsAbortController.current === controller) {
        mappedCardsAbortController.current = null;
      }
    }
  }, [isAdmin, session?.token, session?.user.id, sessionId]);
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
    void loadMappedCards();
    return () => {
      mappedCardsRequestGeneration.current += 1;
      mappedCardsAbortController.current?.abort();
      mappedCardsAbortController.current = null;
    };
  }, [loadMappedCards]);

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

  useEffect(() => {
    if (!router.isReady || sessionId || !captureDraftId || !session?.token || !isAdmin || draft || source) return;
    let cancelled = false;
    void (async () => {
      setWorking(true);
      setWorkflowError(null);
      setMessage("Loading the preserved Card Maps capture session. Resume remains an explicit choice.");
      try {
        const sessionResponse = await fetch(
          `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(captureDraftId)}`,
          { headers: buildAdminHeaders(session.token!), cache: "no-store" },
        );
        const sessionPayload = await sessionResponse.json().catch(() => ({})) as {
          session?: SpeedsterDraft & {
            workflowState?: string;
            identity?: unknown;
            capture?: unknown;
            mapRevisionId?: string | null;
            mapRegistration?: unknown;
          };
          message?: string;
        };
        if (!sessionResponse.ok || !sessionPayload.session) {
          throw new Error(sessionPayload.message ?? "Preserved Card Maps capture session could not be loaded.");
        }
        const committed = sessionPayload.session.workflowState === "CAPTURED";
        if (sessionPayload.session.workflowState !== "DRAFT" && !committed) {
          throw new Error("The preserved Card Maps session is neither DRAFT nor a reconcilable CAPTURED session. No browser draft was deleted.");
        }
        let committedBrowserDraft: SpeedsterCaptureRegistrationDraft | null = null;
        if (committed) {
          committedBrowserDraft = readSpeedsterCaptureRegistrationDraftForCommittedSession(window.localStorage, {
            surface: "CARD_MAPS",
            sessionId: captureDraftId,
            cardProfile: sessionPayload.session.cardProfile,
          });
          if (!committedBrowserDraft
            || !speedsterCaptureDraftMatchesCommittedSession(committedBrowserDraft, sessionPayload.session)) {
            throw new Error("The server reports CAPTURED, but its exact capture/map binding does not match the preserved Card Maps browser draft. Nothing was cleared or resumed; inspect the conflicting evidence.");
          }
        }
        const restoredIdentity = canonicalizeSpeedsterSessionIdentity(
          sessionPayload.session.cardProfile,
          sessionPayload.session.identity,
        );
        let restoredMap: SpeedsterTrainMapState;
        let restoredMapLookupFailed = false;
        try {
          const mapResponse = await fetch(
            `/api/admin/ai-grader-v2/maps/current?sessionId=${encodeURIComponent(captureDraftId)}&scope=EFFECTIVE`,
            { headers: buildAdminHeaders(session.token!), cache: "no-store" },
          );
          const mapPayload = await mapResponse.json().catch(() => ({})) as {
            map?: SpeedsterTrainMapState;
            message?: string;
          };
          if (!mapResponse.ok || !mapPayload.map) {
            throw new Error(mapPayload.message ?? "The Card Map binding for this preserved draft is unavailable.");
          }
          restoredMap = mapPayload.map;
        } catch {
          restoredMapLookupFailed = true;
          restoredMap = { status: "MISSING", scope: null, name: "", revision: null, revisions: [], editable: null };
        }
        if (cancelled) return;
        setDraft(sessionPayload.session);
        setDraftIdentity(restoredIdentity);
        setMap(restoredMap);
        setCaptureMapLookupFailed(restoredMapLookupFailed);
        if (committed && committedBrowserDraft) {
          setCommittedCaptureRecovery({
            session: sessionPayload.session as SpeedsterCommittedCaptureRecovery["session"],
            browserDraft: committedBrowserDraft,
          });
          setMessage("Server save is verified as committed and exactly matches the preserved Card Maps Front/Back capture and map binding. Choose Continue to authoring or keep the browser draft; nothing was cleared automatically.");
        } else setMessage(restoredMapLookupFailed
          ? "Preserved Card Maps capture loaded, but Card Map lookup failed. Resume remains strict and explicit; no map authority was guessed."
          : "Preserved Card Maps capture loaded. Choose Resume or Discard; nothing was applied automatically.");
      } catch (error) {
        if (!cancelled) {
          const failure = toCardMapOperatorMessage(
            error instanceof Error ? error.message : "Preserved Card Maps capture could not be loaded.",
          );
          setWorkflowError(failure);
          setMessage(failure);
        }
      } finally {
        if (!cancelled) setWorking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [captureDraftId, draft, isAdmin, router.isReady, session?.token, sessionId, source]);

  const updateIdentity = (field: keyof HumanGradeLabelEditorValue, value: string) => {
    setIdentity((current) => field === "cardType"
      ? {
          ...current,
          cardType: value as HumanGradeLabelEditorValue["cardType"],
          playerName: "",
          cardName: "",
          layoutType: "",
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
      void router.replace(
        { pathname: "/card-maps", query: { captureDraftId: payload.session.id }, hash: "new-card-map" },
        undefined,
        { shallow: true },
      );
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

  const saveCapture = async (
    bundle: SpeedsterCaptureBundle,
    clearPreservedBrowserDraft: () => boolean = () => true,
  ): Promise<SpeedsterCaptureSaveResult> => {
    if (!session?.token || !draft || !draftIdentity) {
      return { saved: false, message: "CARD MAP source cannot save without its active draft identity." };
    }
    if (captureSaveInFlight.current) {
      return { saved: false, message: "CARD MAP source save is already in progress." };
    }
    captureSaveInFlight.current = true;
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
      const frontRegistration = bundle.front.mapRegistration;
      const backRegistration = bundle.back.mapRegistration;
      const submittedRegistration = Boolean(frontRegistration && backRegistration);
      const exactFilterPolicyVersion = map?.status === "LOADED"
        ? map.revision?.filterPolicyVersion
        : null;
      if (submittedRegistration && !exactFilterPolicyVersion) {
        throw new Error("CARD MAP source registration cannot save without the immutable loaded revision filter policy.");
      }
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
          ...(submittedRegistration ? {
            mapBinding: {
              revisionId: frontRegistration!.mapRevisionId,
              filterPolicyVersion: exactFilterPolicyVersion,
              registration: {
                front: frontRegistration!,
                back: backRegistration!,
              },
            },
          } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "CARD MAP source could not be saved.");
      clearPreservedBrowserDraft();
      void router.replace({ pathname: "/card-maps", hash: "new-card-map" }, undefined, { shallow: true });
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
      try {
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
      } catch {
        setSource(localSource);
        setMessage(`${map ? mapAction(map) : "CREATE CARD MAP"} · Source capture is preserved. Stable image keys are exportable; evidence hashes will be verified by the server on save.`);
      }
      return { saved: true };
    } catch (error) {
      const failure = toCardMapOperatorMessage(
        error instanceof Error ? error.message : "CARD MAP source could not be saved.",
      );
      setWorkflowError(failure);
      setMessage(failure);
      return { saved: false, message: failure };
    } finally {
      captureSaveInFlight.current = false;
      setWorking(false);
    }
  };

  const continueCommittedCardMapCapture = useCallback(async () => {
    if (!committedCaptureRecovery || !session?.token || working) return;
    setWorking(true);
    setWorkflowError(null);
    setMessage("Loading the exact server-saved Card Map source before clearing the obsolete browser draft.");
    try {
      const response = await fetch(
        `/api/admin/ai-grader-v2/maps/source?sessionId=${encodeURIComponent(committedCaptureRecovery.session.id)}&scope=EXACT`,
        { headers: buildAdminHeaders(session.token), cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({})) as {
        source?: SpeedsterTrainSource;
        map?: SpeedsterTrainMapState;
        message?: string;
      };
      if (!response.ok || !payload.source) {
        throw new Error(payload.message ?? "The committed Card Map source could not be loaded.");
      }
      setSource(payload.source);
      if (payload.map) setMap(payload.map);
      try {
        removeSpeedsterCaptureRegistrationDraft(window.localStorage, committedCaptureRecovery.session.id);
      } catch {
        const failure = "Committed Card Maps capture resumed, but the obsolete browser draft could not be cleared. Use the visible Retry cleanup action.";
        setCaptureDraftCleanupFailure({ sessionId: committedCaptureRecovery.session.id, message: failure });
      }
      setCommittedCaptureRecovery(null);
      void router.replace({ pathname: "/card-maps", hash: "new-card-map" }, undefined, { shallow: true });
      setMessage("Verified committed Front + Back source loaded. Continue dual Family + Exact authoring; no capture was repeated.");
    } catch (error) {
      const failure = toCardMapOperatorMessage(
        `${error instanceof Error ? error.message : "Committed Card Maps capture could not continue."} The preserved browser draft remains intact.`,
      );
      setWorkflowError(failure);
      setMessage(failure);
    } finally {
      setWorking(false);
    }
  }, [committedCaptureRecovery, router, session?.token, working]);

  const reportCaptureInstrumentation = useCallback((event: SpeedsterCaptureInstrumentationEvent) => {
    const token = session?.token;
    const sourceSessionId = draft?.id;
    if (!token || !sourceSessionId) return false;
    return fetch(
      `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(sourceSessionId)}/instrumentation`,
      {
        method: "POST",
        headers: buildAdminHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          eventId: event.eventId ?? crypto.randomUUID(),
          eventType: event.eventType,
          clientStartedAt: new Date(event.startedAtMs).toISOString(),
          clientEndedAt: new Date(event.endedAtMs).toISOString(),
          ...(event.details ? { details: event.details } : {}),
        }),
        keepalive: true,
      },
    ).then((response) => response.ok).catch(() => false);
  }, [draft?.id, session?.token]);

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
            <div className={styles.cardMapsActions}>
              {!captureDraftId ? (
                <button className={styles.cardMapsCta} type="button" onClick={focusNewCard}>CREATE CARD MAP</button>
              ) : null}
              {!sessionId ? <a href="#existing-card-maps">VIEW EXISTING MAPS</a> : null}
            </div>
          </div>
        </section>

        {captureDraftCleanupFailure ? (
          <section className={styles.mapState} role="alert">
            <strong>BROWSER DRAFT CLEANUP REQUIRED</strong>
            <span>{captureDraftCleanupFailure.message}</span>
            <button type="button" onClick={() => {
              try {
                removeSpeedsterCaptureRegistrationDraft(window.localStorage, captureDraftCleanupFailure.sessionId);
                setCaptureDraftCleanupFailure(null);
                setWorkflowError(null);
                setMessage("The obsolete browser Card Maps capture draft was cleared explicitly.");
              } catch {
                setWorkflowError("The obsolete browser capture draft still could not be cleared. Server-saved work is intact; retry this cleanup action.");
              }
            }}>RETRY CLEARING BROWSER DRAFT</button>
          </section>
        ) : null}

        {committedCaptureRecovery ? (
          <section className={styles.mapState} role="alert">
            <strong>CAPTURE SAVE COMMITTED · EXPLICIT RECONCILIATION</strong>
            <span>The server Front + Back source exactly matches the preserved browser capture and map binding. Nothing was recaptured or cleared automatically.</span>
            <button type="button" disabled={working} onClick={() => void continueCommittedCardMapCapture()}>
              {working ? "LOADING COMMITTED SOURCE…" : "CONTINUE TO MAP AUTHORING"}
            </button>
            <button type="button" disabled={working} onClick={() => {
              setMessage("Committed Card Maps capture remains verified. The preserved browser draft was kept by explicit operator choice.");
            }}>KEEP BROWSER DRAFT FOR NOW</button>
          </section>
        ) : null}

        {captureDraftId && !draft && !committedCaptureRecovery ? (
          <section className={styles.mapState} role="alert">
            <strong>CARD MAP CAPTURE RECOVERY BLOCKED</strong>
            <span>{workflowError ?? message} The browser draft remains intact. Fresh map capture and authoring are unavailable on this recovery URL.</span>
            <Link href="/card-maps">LEAVE RECOVERY AND START FROM THE BASE ROUTE</Link>
          </section>
        ) : null}

        {!sessionId ? (
          <section id="existing-card-maps" className={styles.libraryPanel} aria-labelledby="existing-card-maps-heading">
            <header className={styles.libraryHeader}>
              <div>
                <span>SAVED MAP SOURCES · CARD MAPS ONLY</span>
                <h2 id="existing-card-maps-heading">EXISTING CARD MAPS</h2>
                <p>Only source cards with a saved active Card Map appear here. Open one to create its next immutable Family + Exact revisions.</p>
              </div>
              <label className={styles.librarySearch}>
                <span>Search existing Card Maps</span>
                <input
                  aria-label="Search existing Card Maps"
                  type="search"
                  value={mappedCardQuery}
                  onInput={(event) => setMappedCardQuery(event.currentTarget.value)}
                  onChange={() => undefined}
                  placeholder="Name, set, parallel, or card number"
                />
              </label>
            </header>

            <p className={styles.libraryStatus} role="status" aria-live="polite">
              {mappedCardsLoading
                ? "Loading saved Card Maps…"
                : `${visibleMappedCards.length} of ${mappedCards.length} mapped source ${mappedCards.length === 1 ? "card" : "cards"}`}
            </p>

            {mappedCardsError ? (
              <div className={styles.libraryError} role="alert">
                <p>{mappedCardsError}</p>
                <button type="button" onClick={() => void loadMappedCards()}>RETRY</button>
              </div>
            ) : null}

            {!mappedCardsLoading && !mappedCardsError && visibleMappedCards.length === 0 ? (
              <div className={styles.libraryEmpty}>
                <strong>{mappedCards.length ? "NO MATCHING CARD MAPS" : "NO CARD MAPS YET"}</strong>
                <span>{mappedCards.length
                  ? "Try a different card name, set, parallel, or card number."
                  : "Create and save a Card Map; its exact source card will appear here."}</span>
              </div>
            ) : null}

            {!mappedCardsError && visibleMappedCards.length ? (
              <div className={styles.libraryGrid}>
                {visibleMappedCards.map((card) => (
                  <article className={styles.libraryCard} key={card.sourceSessionId}>
                    <div className={styles.libraryCardTopline}>
                      <span>{card.cardProfile === "POKEMON" ? "POKÉMON" : "SPORTS"}</span>
                      <span>{card.workflowState === "COMPLETED" ? "COMPLETED SOURCE" : "MAP SOURCE"}</span>
                    </div>
                    <h3>{mappedCardName(card)}</h3>
                    <p>{mappedCardIdentity(card)}</p>
                    <div className={styles.libraryRevisions} aria-label="Current Card Map revisions">
                      {(["FAMILY", "EXACT"] as const).map((scope) => {
                        const revision = card.revisions.find((candidate) => (
                          candidate.scope === scope && candidate.runtimeEligible
                        ));
                        return (
                          <span key={scope}>
                            {revision
                              ? `${scope} r${revision.version}${revision.layoutType ? ` · ${revision.layoutType}` : ""}`
                              : `${scope} · NOT CURRENT FROM THIS SOURCE`}
                          </span>
                        );
                      })}
                      {card.revisions.filter((revision) => !revision.runtimeEligible).map((revision) => (
                        <span key={`${revision.keyGeneration}:${revision.revisionId}`}>
                          {revision.keyGeneration === "FAMILY_LEGACY"
                            ? `FAMILY LEGACY r${revision.version} · HISTORICAL ONLY · NOT RUNTIME ELIGIBLE`
                            : `${revision.scope} r${revision.version} · HISTORICAL ONLY · NOT RUNTIME ELIGIBLE`}
                        </span>
                      ))}
                    </div>
                    <div className={styles.libraryCardFooter}>
                      <time dateTime={card.lastMappedAt}>
                        Updated {new Date(card.lastMappedAt).toLocaleDateString()}
                      </time>
                      <Link href={`/card-maps?sessionId=${encodeURIComponent(card.sourceSessionId)}`}>
                        EDIT CARD MAP
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

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
                layoutType: source.cardProfile === "POKEMON"
                  ? speedsterPokemonLayoutType(source.identity) ?? source.familyLayoutType ?? ""
                  : "",
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
        ) : !captureDraftId || draft ? (
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
                  requirePokemonLayoutType
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
        ) : null}

        {!sessionId && draft && map && !source && !committedCaptureRecovery ? (
          <CaptureWorkspace
            token={session.token}
            sessionId={draft.id}
            cardProfile={draft.cardProfile}
            draftSurface="CARD_MAPS"
            activeMapRevisionId={map.revision?.revisionId ?? null}
            activeMapScope={map.status === "LOADED" ? map.scope ?? null : null}
            activeMapName={map.status === "LOADED" ? map.name ?? null : null}
            mapBindingStatus={map.status === "LOADED" ? "LOADED"
              : map.status === "INTEGRITY_ERROR" ? "INTEGRITY_ERROR"
                : captureMapLookupFailed ? "LOOKUP_FAILED" : "NO_MAP"}
            mapLookupFailed={captureMapLookupFailed}
            onReady={saveCapture}
            onDraftCleanupFailure={(failure) => {
              setCaptureDraftCleanupFailure({ sessionId: draft.id, message: failure });
              setWorkflowError(failure);
              setMessage(failure);
            }}
            onInstrumentationEvent={reportCaptureInstrumentation}
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
              void loadMappedCards();
            }}
          />
        ) : null}
      </main>
    </AppShell>
  );
}
