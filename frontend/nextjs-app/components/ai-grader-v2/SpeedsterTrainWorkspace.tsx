"use client";

import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  SpeedsterMapDesignBoundary,
  SpeedsterMapScope,
  SpeedsterMapZone,
  SpeedsterMapZoneContentType,
  SpeedsterMapZoneSemanticType,
  SpeedsterMapZoneV2,
} from "../../lib/ai-grader-v2/card-type-map-contracts";
import {
  SPEEDSTER_MAP_FILTER_PADDING_MM,
  isSpeedsterNondegenerateAnchorSet,
  isSpeedsterMapZoneV2,
  isSpeedsterSimplePolygon,
  isSpeedsterStrictConvexPolygon,
  speedsterDefaultFilterAuthority,
} from "../../lib/ai-grader-v2/card-type-map-contracts";
import type {
  SpeedsterCardProfile,
  SpeedsterCardSide,
  SpeedsterPoint,
  SpeedsterQuad,
} from "../../lib/ai-grader-v2/contracts";
import {
  gradientMapFromImage,
  snapSpeedsterPoint,
  type SpeedsterGradientMap,
} from "../../lib/ai-grader-v2/gradient-snap";
import type { SpeedsterSessionIdentity } from "../../lib/ai-grader-v2/identity";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  cardMapDraftEditableSide,
  cardMapDraftFileName,
  createCardMapDraft,
  parseCardMapDraft,
  serializeCardMapDraft,
  type CardMapDraftSide,
} from "../../lib/ai-grader-v2/card-map-draft";
import {
  toCardMapOperatorMessage,
  toCardMapSaveFailure,
} from "../../lib/ai-grader-v2/card-map-copy";
import styles from "./SpeedsterTrainWorkspace.module.css";

type EditableAnchor = Readonly<{ id: string; label: string; point: SpeedsterPoint }>;
type EditableSide = Readonly<{
  designBoundary: SpeedsterMapDesignBoundary;
  anchors: readonly EditableAnchor[];
  zones: readonly SpeedsterMapZone[];
}>;

export type SpeedsterTrainMapState = Readonly<{
  status: "MISSING" | "LOADED" | "INTEGRITY_ERROR";
  scope?: SpeedsterMapScope | null;
  name?: string;
  integrity?: Readonly<{
    code: "CARD_MAP_INTEGRITY_FAILURE";
    message: string;
  }> | null;
  revision: Readonly<{
    mapId: string;
    revisionId: string;
    version: number;
    revisionHash: string;
    displayIdentity: SpeedsterSessionIdentity;
    mapSchemaVersion: string;
    filterPolicyVersion: string;
    createdAt: string;
    sourceProvenance?: Readonly<{
      sourceSessionId: string;
      sourceIdentity: SpeedsterSessionIdentity;
    }>;
  }> | null;
  revisions: readonly Readonly<{
    revisionId: string;
    version: number;
    revisionHash: string;
    createdAt: string;
    sourceSessionId: string;
    authorAdminId: string;
    current: boolean;
  }>[];
  editable: Readonly<{ front: EditableSide; back: EditableSide }> | null;
}>;

export type SpeedsterTrainSource = Readonly<{
  sessionId: string;
  cardProfile: SpeedsterCardProfile;
  identity: SpeedsterSessionIdentity;
  front: Readonly<{
    rectifiedUrl: string;
    centeringQuad: SpeedsterQuad;
    originalStorageKey?: string;
    rectifiedStorageKey?: string;
    inspectionStorageKey?: string;
    evidenceSha256?: string | null;
    sourceEvidence?: Readonly<{
      originalStorageKey: string;
      rectifiedStorageKey: string;
      inspectionStorageKey: string;
      inspectionSha256: string;
    }>;
  }>;
  back: Readonly<{
    rectifiedUrl: string;
    centeringQuad: SpeedsterQuad;
    originalStorageKey?: string;
    rectifiedStorageKey?: string;
    inspectionStorageKey?: string;
    evidenceSha256?: string | null;
    sourceEvidence?: Readonly<{
      originalStorageKey: string;
      rectifiedStorageKey: string;
      inspectionStorageKey: string;
      inspectionSha256: string;
    }>;
  }>;
}>;

export type SpeedsterDualMapRevisionReceipt = Readonly<{
  scope: "FAMILY" | "EXACT";
  applicability: string;
  mapId: string;
  revisionId: string;
  version: number;
  revisionHash: string;
  matchKeyHash: string;
  sourceSessionId: string;
}>;

export type SpeedsterDualMapSaveResult = Readonly<{
  family: SpeedsterDualMapRevisionReceipt;
  exact: SpeedsterDualMapRevisionReceipt;
}>;

type SideDraft = {
  designBoundary: SpeedsterMapDesignBoundary;
  anchors: EditableAnchor[];
  zones: SpeedsterMapZoneV2[];
};

type SideEditorState = {
  map: SideDraft;
  boundaryPoints: SpeedsterPoint[];
  selectedZoneId: string | null;
  zoneDraft: {
    active: boolean;
    points: SpeedsterPoint[];
    semanticType: SpeedsterMapZoneSemanticType;
    contentType: SpeedsterMapZoneContentType;
    filterAuthority: boolean;
    filterAuthoritySource: "TYPE_DEFAULT" | "HUMAN_OVERRIDE";
    label: string;
  };
};

type Tool = "BOUNDARY" | "ANCHOR" | "ZONE";
type DragTarget = Readonly<{
  side: SpeedsterCardSide;
  pointerId: number;
  kind: "BOUNDARY" | "ANCHOR" | "ZONE" | "ZONE_DRAFT";
  index: number;
  zoneId?: string;
}>;

const ZONE_TYPES: readonly Readonly<{ value: SpeedsterMapZoneSemanticType; label: string }>[] = [
  { value: "PRINT_TEXT", label: "Printed text" },
  { value: "PRINT_LOGO", label: "Printed logo" },
  { value: "PRINT_ARTWORK", label: "Printed artwork" },
  { value: "PRINT_BORDER", label: "Printed border" },
  { value: "PRINT_FOIL", label: "Foil / holographic print" },
  { value: "OTHER_PRINT_CONTEXT", label: "Other print context" },
];

const CONTENT_TYPES: readonly Readonly<{ value: SpeedsterMapZoneContentType; label: string }>[] = [
  { value: "HEADER", label: "Header" },
  { value: "ARTWORK", label: "Artwork" },
  { value: "SPECIES_STRIP", label: "Species strip" },
  { value: "ATTACK", label: "Attack / rules" },
  { value: "STATS_BAR", label: "Stats bar" },
  { value: "ARTIST_AND_CARD_ID", label: "Artist + set/card ID" },
  { value: "FLAVOR_TEXT", label: "Flavor text" },
  { value: "COPYRIGHT", label: "Copyright" },
  { value: "OTHER", label: "Other content" },
];

const SIDE_LABEL: Record<SpeedsterCardSide, string> = { FRONT: "Front", BACK: "Back" };
const BOUNDARY_LABELS = ["TL", "TR", "BR", "BL"] as const;
const BOUNDARY_DIRECTIONS = [
  { inwardX: 1, inwardY: 1 },
  { inwardX: -1, inwardY: 1 },
  { inwardX: -1, inwardY: -1 },
  { inwardX: 1, inwardY: -1 },
] as const;
const UNDO_LIMIT = 20;

function clonePoints(points: readonly SpeedsterPoint[]) {
  return points.map((point) => ({ ...point }));
}

function cloneBoundary(boundary: SpeedsterMapDesignBoundary): SpeedsterMapDesignBoundary {
  return boundary.kind === "FULL_BLEED"
    ? { kind: "FULL_BLEED" }
    : { kind: "QUAD", points: clonePoints(boundary.points) as unknown as SpeedsterQuad };
}

function inferredContentType(zone: SpeedsterMapZone): SpeedsterMapZoneContentType {
  if (isSpeedsterMapZoneV2(zone)) return zone.contentType;
  const label = zone.label.toLowerCase();
  if (zone.semanticType === "PRINT_ARTWORK") return "ARTWORK";
  if (/copyright|nintendo|game freak/.test(label)) return "COPYRIGHT";
  if (/artist|card id|set\/card|card number/.test(label)) return "ARTIST_AND_CARD_ID";
  if (/species|description/.test(label)) return "SPECIES_STRIP";
  if (/attack|rules|damage|text/.test(label)) return "ATTACK";
  if (/stats|weakness|resistance|retreat/.test(label)) return "STATS_BAR";
  if (/name|hp|type|header/.test(label)) return "HEADER";
  return "OTHER";
}

function upgradeZone(zone: SpeedsterMapZone): SpeedsterMapZoneV2 {
  if (isSpeedsterMapZoneV2(zone)) return { ...zone, polygon: clonePoints(zone.polygon) };
  return {
    ...zone,
    polygon: clonePoints(zone.polygon),
    contentType: inferredContentType(zone),
    filterAuthority: speedsterDefaultFilterAuthority(zone.semanticType),
    filterAuthoritySource: "TYPE_DEFAULT",
    filterPaddingMm: SPEEDSTER_MAP_FILTER_PADDING_MM,
    proposalSource: "HUMAN",
    proposalConfidence: null,
  };
}

function cloneSide(side: EditableSide | SideDraft): SideDraft {
  return {
    designBoundary: cloneBoundary(side.designBoundary),
    anchors: side.anchors.map((anchor) => ({ ...anchor, point: { ...anchor.point } })),
    zones: side.zones.map(upgradeZone),
  };
}

function cloneEditor(editor: SideEditorState): SideEditorState {
  return {
    map: cloneSide(editor.map),
    boundaryPoints: clonePoints(editor.boundaryPoints),
    selectedZoneId: editor.selectedZoneId,
    zoneDraft: {
      ...editor.zoneDraft,
      points: clonePoints(editor.zoneDraft.points),
    },
  };
}

function initialSide(side: SpeedsterCardSide, source: SpeedsterTrainSource, map: SpeedsterTrainMapState): SideDraft {
  const existing = side === "FRONT" ? map.editable?.front : map.editable?.back;
  if (existing) return cloneSide(existing);
  const sourceSide = side === "FRONT" ? source.front : source.back;
  return { designBoundary: { kind: "QUAD", points: sourceSide.centeringQuad }, anchors: [], zones: [] };
}

function initialEditor(side: SpeedsterCardSide, source: SpeedsterTrainSource, map: SpeedsterTrainMapState): SideEditorState {
  const initial = initialSide(side, source, map);
  return {
    map: initial,
    boundaryPoints: initial.designBoundary.kind === "QUAD" ? clonePoints(initial.designBoundary.points) : [],
    selectedZoneId: initial.zones[0]?.id ?? null,
    zoneDraft: {
      active: false,
      points: [],
      semanticType: "PRINT_TEXT",
      contentType: "OTHER",
      filterAuthority: true,
      filterAuthoritySource: "TYPE_DEFAULT",
      label: "Print zone",
    },
  };
}

function editorFromDraft(side: CardMapDraftSide): SideEditorState {
  const map = cardMapDraftEditableSide(side);
  return {
    map: cloneSide(map),
    boundaryPoints: map.designBoundary.kind === "QUAD" ? clonePoints(map.designBoundary.points) : [],
    selectedZoneId: map.zones[0]?.id ?? null,
    zoneDraft: {
      active: false,
      points: [],
      semanticType: "PRINT_TEXT",
      contentType: "OTHER",
      filterAuthority: true,
      filterAuthoritySource: "TYPE_DEFAULT",
      label: "Print zone",
    },
  };
}

function recoverySide(side: SideDraft): CardMapDraftSide {
  return {
    designBoundary: cloneBoundary(side.designBoundary),
    anchors: side.anchors.map((anchor) => ({ ...anchor, point: { ...anchor.point } })),
    zones: side.zones.map((zone) => ({
      id: zone.id,
      label: zone.label,
      semanticType: zone.semanticType,
      contentType: zone.contentType,
      filterAuthority: zone.filterAuthority,
      filterAuthoritySource: zone.filterAuthoritySource,
      filterPaddingMm: zone.filterPaddingMm,
      proposalSource: zone.proposalSource,
      proposalConfidence: zone.proposalConfidence,
      polygon: clonePoints(zone.polygon),
    })),
  };
}

function identityTitle(identity: SpeedsterSessionIdentity) {
  return "playerName" in identity ? identity.playerName : identity.cardName;
}

function familyMapName(identity: SpeedsterSessionIdentity) {
  return [
    identity.year,
    "manufacturer" in identity ? "Sports" : "Pokémon",
    "manufacturer" in identity ? identity.manufacturer : null,
    identity.productSet,
    "insert" in identity ? identity.insert : null,
    identity.parallel,
  ].filter(Boolean).join(" ");
}

function exactMapName(identity: SpeedsterSessionIdentity) {
  return [identityTitle(identity), identity.cardNumber ? `#${identity.cardNumber}` : null]
    .filter(Boolean).join(" ");
}

function likelyCardSpecificPoint(point: SpeedsterPoint) {
  return point.y >= 0.2 && point.y <= 0.58 && point.x >= 0.18 && point.x <= 0.82;
}

function anchorQuadrant(point: SpeedsterPoint) {
  return `${point.y < 0.5 ? "TOP" : "BOTTOM"}-${point.x < 0.5 ? "LEFT" : "RIGHT"}`;
}

function familySafetyWarnings(front: SideEditorState, back: SideEditorState) {
  const warnings: string[] = [];
  const anchors = [...front.map.anchors, ...back.map.anchors];
  const unsafeAnchors = anchors.filter((anchor) => likelyCardSpecificPoint(anchor.point)).length;
  const unsafeZones = [...front.map.zones, ...back.map.zones].filter((zone) => (
    zone.semanticType === "PRINT_ARTWORK" || zone.polygon.some(likelyCardSpecificPoint)
  )).length;
  const missingQuadrantSides = [front, back].filter((editor) => (
    new Set(editor.map.anchors.map((anchor) => anchorQuadrant(anchor.point))).size < 4
  )).length;
  if (unsafeAnchors) warnings.push(`${unsafeAnchors} anchor${unsafeAnchors === 1 ? "" : "s"}`);
  if (unsafeZones) warnings.push(`${unsafeZones} zone${unsafeZones === 1 ? "" : "s"}`);
  if (missingQuadrantSides) warnings.push(`${missingQuadrantSides} side${missingQuadrantSides === 1 ? "" : "s"} without one anchor per quadrant`);
  return warnings;
}

function polygonPoints(points: readonly SpeedsterPoint[]) {
  return points.map((point) => `${point.x * 1000},${point.y * 1400}`).join(" ");
}

function unitPoint(event: ReactPointerEvent<Element>): SpeedsterPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
  };
}

function sideReadiness(editor: SideEditorState) {
  const boundary = editor.map.designBoundary.kind === "FULL_BLEED"
    || (editor.boundaryPoints.length === 4 && isSpeedsterStrictConvexPolygon(editor.boundaryPoints));
  const anchors = isSpeedsterNondegenerateAnchorSet(editor.map.anchors.map((anchor) => anchor.point));
  const zones = editor.map.zones.length > 0 && editor.map.zones.every((zone) => (
    Boolean(zone.label.trim()) && isSpeedsterSimplePolygon(zone.polygon)
  ));
  return { ready: boundary && anchors && zones, boundary, anchors, zones };
}

function nextZoneId(side: SpeedsterCardSide, zones: readonly SpeedsterMapZoneV2[]) {
  const prefix = `${side.toLowerCase()}-zone-`;
  const existing = new Set(zones.map((zone) => zone.id));
  let number = 1;
  while (existing.has(`${prefix}${number}`)) number += 1;
  return `${prefix}${number}`;
}

export function SpeedsterTrainWorkspace({
  token,
  source,
  initialMap,
  onSaved,
  onCancel,
}: Readonly<{
  token: string;
  source: SpeedsterTrainSource;
  initialMap: SpeedsterTrainMapState;
  onSaved: (maps: SpeedsterDualMapSaveResult) => void;
  onCancel?: () => void;
}>) {
  const [map, setMap] = useState(initialMap);
  const [side, setSide] = useState<SpeedsterCardSide>("FRONT");
  const [frontEditor, setFrontEditor] = useState<SideEditorState>(() => initialEditor("FRONT", source, initialMap));
  const [backEditor, setBackEditor] = useState<SideEditorState>(() => initialEditor("BACK", source, initialMap));
  const [undoBySide, setUndoBySide] = useState<Record<SpeedsterCardSide, SideEditorState[]>>({ FRONT: [], BACK: [] });
  const [tool, setTool] = useState<Tool>("BOUNDARY");
  const [working, setWorking] = useState(false);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<SpeedsterDualMapSaveResult | null>(null);
  const [recoverableSnapshot, setRecoverableSnapshot] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [message, setMessage] = useState(
    map.status === "LOADED"
      ? map.editable
        ? `Loaded ${map.scope ?? "existing"} revision ${map.revision?.version} as the editing baseline. One save creates new Family and Exact revisions.`
        : `Loaded ${map.scope ?? "existing"} revision ${map.revision?.version}. Edit this source copy to create new Family and Exact revisions.`
      : map.status === "INTEGRITY_ERROR"
        ? "The prior map failed integrity verification and was not loaded. Source imagery is preserved for draft recovery and a new atomic Family + Exact save."
        : "Ready to create the first Family and Exact Source maps from this draft.",
  );
  const activeHandle = useRef<DragTarget | null>(null);
  const gradientMaps = useRef<Partial<Record<SpeedsterCardSide, SpeedsterGradientMap | null>>>({});
  const textEditKey = useRef<string | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);
  const active = side === "FRONT" ? frontEditor : backEditor;
  const sourceSide = side === "FRONT" ? source.front : source.back;
  const selectedZone = active.map.zones.find((zone) => zone.id === active.selectedZoneId) ?? null;
  const readiness = useMemo(() => ({
    FRONT: sideReadiness(frontEditor),
    BACK: sideReadiness(backEditor),
  }), [backEditor, frontEditor]);
  const ready = readiness.FRONT.ready && readiness.BACK.ready;
  const baselineScope = map.scope ?? null;
  const familyName = familyMapName(source.identity);
  const exactName = exactMapName(source.identity);
  const safetyWarnings = useMemo(() => (
    familySafetyWarnings(frontEditor, backEditor)
  ), [backEditor, frontEditor]);
  const recovery = useMemo(() => {
    try {
      const draft = createCardMapDraft({
        source,
        front: recoverySide(frontEditor.map),
        back: recoverySide(backEditor.map),
      });
      return { draft, serialized: serializeCardMapDraft(draft), error: null };
    } catch (error) {
      return {
        draft: null,
        serialized: null,
        error: error instanceof Error ? error.message : "Card Map draft could not be prepared for recovery.",
      };
    }
  }, [backEditor.map, frontEditor.map, source]);
  const recoveryCurrent = Boolean(recovery.serialized && recovery.serialized === recoverableSnapshot);

  const editorFor = (candidate: SpeedsterCardSide) => candidate === "FRONT" ? frontEditor : backEditor;
  const setEditor = (
    candidate: SpeedsterCardSide,
    next: SideEditorState | ((current: SideEditorState) => SideEditorState),
  ) => {
    setSaveSuccess(null);
    setRecoveryError(null);
    const setter = candidate === "FRONT" ? setFrontEditor : setBackEditor;
    setter(next);
  };
  const pushUndo = (candidate: SpeedsterCardSide, snapshot = editorFor(candidate)) => {
    setUndoBySide((current) => ({
      ...current,
      [candidate]: [...current[candidate], cloneEditor(snapshot)].slice(-UNDO_LIMIT),
    }));
  };
  const undo = () => {
    const stack = undoBySide[side];
    const prior = stack[stack.length - 1];
    if (!prior || working) return;
    setEditor(side, cloneEditor(prior));
    setUndoBySide((current) => ({ ...current, [side]: current[side].slice(0, -1) }));
    setMessage(`${SIDE_LABEL[side]} card map restored to its prior local edit.`);
  };

  const addPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (working) return;
    const nextPoint = unitPoint(event);
    if (
      tool === "BOUNDARY"
      && active.map.designBoundary.kind === "QUAD"
      && active.boundaryPoints.length < 4
    ) {
      pushUndo(side);
      setEditor(side, (current) => {
        const boundaryPoints = [...current.boundaryPoints, nextPoint];
        return {
          ...current,
          boundaryPoints,
          map: boundaryPoints.length === 4 ? {
            ...current.map,
            designBoundary: { kind: "QUAD", points: boundaryPoints as unknown as SpeedsterQuad },
          } : current.map,
        };
      });
      return;
    }
    if (tool === "ANCHOR" && active.map.anchors.length < 4) {
      pushUndo(side);
      const number = active.map.anchors.length + 1;
      setEditor(side, (current) => ({
        ...current,
        map: {
          ...current.map,
          anchors: [...current.map.anchors, {
            id: `${side.toLowerCase()}-anchor-${number}`,
            label: `Anchor ${number}`,
            point: nextPoint,
          }],
        },
      }));
      return;
    }
    if (tool === "ZONE" && active.zoneDraft.active && active.zoneDraft.points.length < 64) {
      pushUndo(side);
      setEditor(side, (current) => ({
        ...current,
        zoneDraft: { ...current.zoneDraft, points: [...current.zoneDraft.points, nextPoint] },
      }));
    }
  };

  const beginDrag = (
    event: ReactPointerEvent<SVGGElement>,
    target: Omit<DragTarget, "pointerId">,
  ) => {
    if (working) return;
    event.preventDefault();
    event.stopPropagation();
    pushUndo(target.side);
    activeHandle.current = { ...target, pointerId: event.pointerId };
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
  };

  const moveHandle = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = activeHandle.current;
    if (!drag || drag.side !== side || drag.pointerId !== event.pointerId) return;
    const draggedPoint = unitPoint(event);
    setEditor(side, (current) => {
      if (drag.kind === "BOUNDARY") {
        const boundaryPoints = clonePoints(current.boundaryPoints);
        boundaryPoints[drag.index] = snapSpeedsterPoint(
          gradientMaps.current[side] ?? null,
          draggedPoint,
          { ...BOUNDARY_DIRECTIONS[drag.index], sampleStart: 4, sampleLength: 90 },
        );
        return {
          ...current,
          boundaryPoints,
          map: {
            ...current.map,
            designBoundary: { kind: "QUAD", points: boundaryPoints as unknown as SpeedsterQuad },
          },
        };
      }
      if (drag.kind === "ANCHOR") {
        return {
          ...current,
          map: {
            ...current.map,
            anchors: current.map.anchors.map((anchor, index) => (
              index === drag.index ? { ...anchor, point: draggedPoint } : anchor
            )),
          },
        };
      }
      if (drag.kind === "ZONE_DRAFT") {
        return {
          ...current,
          zoneDraft: {
            ...current.zoneDraft,
            points: current.zoneDraft.points.map((point, index) => index === drag.index ? draggedPoint : point),
          },
        };
      }
      return {
        ...current,
        map: {
          ...current.map,
          zones: current.map.zones.map((zone) => zone.id === drag.zoneId ? {
            ...zone,
            polygon: zone.polygon.map((point, index) => index === drag.index ? draggedPoint : point),
          } : zone),
        },
      };
    });
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (activeHandle.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activeHandle.current = null;
  };

  const startTextEdit = (key: string) => {
    if (textEditKey.current === key) return;
    pushUndo(side);
    textEditKey.current = key;
  };

  const updateZoneLabel = (label: string) => {
    setEditor(side, (current) => current.selectedZoneId ? {
      ...current,
      map: {
        ...current.map,
        zones: current.map.zones.map((zone) => zone.id === current.selectedZoneId ? { ...zone, label } : zone),
      },
    } : {
      ...current,
      zoneDraft: { ...current.zoneDraft, label },
    });
  };

  const updateZoneType = (semanticType: SpeedsterMapZoneSemanticType) => {
    pushUndo(side);
    setEditor(side, (current) => current.selectedZoneId ? {
      ...current,
      map: {
        ...current.map,
        zones: current.map.zones.map((zone) => zone.id === current.selectedZoneId ? {
          ...zone,
          semanticType,
          filterAuthority: speedsterDefaultFilterAuthority(semanticType),
          filterAuthoritySource: "TYPE_DEFAULT" as const,
        } : zone),
      },
    } : {
      ...current,
      zoneDraft: {
        ...current.zoneDraft,
        semanticType,
        filterAuthority: speedsterDefaultFilterAuthority(semanticType),
        filterAuthoritySource: "TYPE_DEFAULT",
      },
    });
  };

  const updateContentType = (contentType: SpeedsterMapZoneContentType) => {
    pushUndo(side);
    setEditor(side, (current) => current.selectedZoneId ? {
      ...current,
      map: {
        ...current.map,
        zones: current.map.zones.map((zone) => zone.id === current.selectedZoneId
          ? { ...zone, contentType }
          : zone),
      },
    } : { ...current, zoneDraft: { ...current.zoneDraft, contentType } });
  };

  const updateFilterAuthority = (filterAuthority: boolean) => {
    pushUndo(side);
    setEditor(side, (current) => current.selectedZoneId ? {
      ...current,
      map: {
        ...current.map,
        zones: current.map.zones.map((zone) => zone.id === current.selectedZoneId ? {
          ...zone,
          filterAuthority,
          filterAuthoritySource: "HUMAN_OVERRIDE" as const,
        } : zone),
      },
    } : {
      ...current,
      zoneDraft: {
        ...current.zoneDraft,
        filterAuthority,
        filterAuthoritySource: "HUMAN_OVERRIDE",
      },
    });
  };

  const beginZone = () => {
    if (active.zoneDraft.active) return;
    pushUndo(side);
    setEditor(side, (current) => ({
      ...current,
      selectedZoneId: null,
      zoneDraft: {
        active: true,
        points: [],
        semanticType: "PRINT_TEXT",
        contentType: "OTHER",
        filterAuthority: true,
        filterAuthoritySource: "TYPE_DEFAULT",
        label: "Print zone",
      },
    }));
  };

  const saveZone = () => {
    if (!active.zoneDraft.active || !isSpeedsterSimplePolygon(active.zoneDraft.points)) return;
    pushUndo(side);
    const id = nextZoneId(side, active.map.zones);
    setEditor(side, (current) => ({
      ...current,
      map: {
        ...current.map,
        zones: [...current.map.zones, {
          id,
          label: current.zoneDraft.label.trim() || "Print zone",
          semanticType: current.zoneDraft.semanticType,
          contentType: current.zoneDraft.contentType,
          filterAuthority: current.zoneDraft.filterAuthority,
          filterAuthoritySource: current.zoneDraft.filterAuthoritySource,
          filterPaddingMm: SPEEDSTER_MAP_FILTER_PADDING_MM,
          proposalSource: "HUMAN",
          proposalConfidence: null,
          polygon: clonePoints(current.zoneDraft.points),
        }],
      },
      selectedZoneId: id,
      zoneDraft: {
        active: false,
        points: [],
        semanticType: "PRINT_TEXT",
        contentType: "OTHER",
        filterAuthority: true,
        filterAuthoritySource: "TYPE_DEFAULT",
        label: "Print zone",
      },
    }));
  };

  const cancelZone = () => {
    if (!active.zoneDraft.active) return;
    pushUndo(side);
    setEditor(side, (current) => ({
      ...current,
      selectedZoneId: current.map.zones[0]?.id ?? null,
      zoneDraft: {
        active: false,
        points: [],
        semanticType: "PRINT_TEXT",
        contentType: "OTHER",
        filterAuthority: true,
        filterAuthoritySource: "TYPE_DEFAULT",
        label: "Print zone",
      },
    }));
  };

  const removeSelectedZone = () => {
    if (!selectedZone) return;
    pushUndo(side);
    setEditor(side, (current) => {
      const zones = current.map.zones.filter((zone) => zone.id !== current.selectedZoneId);
      return { ...current, map: { ...current.map, zones }, selectedZoneId: zones[0]?.id ?? null };
    });
  };

  const save = async () => {
    if (!ready || working) return;
    setWorking(true);
    setSaveFailure(null);
    setSaveSuccess(null);
    setMessage("Saving both immutable Card Map revisions in one transaction.");
    try {
      const response = await fetch("/api/admin/ai-grader-v2/maps/save", {
        method: "POST",
        headers: buildAdminHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          sessionId: source.sessionId,
          front: frontEditor.map,
          back: backEditor.map,
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        maps?: SpeedsterDualMapSaveResult;
        message?: string;
        code?: string;
        diagnostics?: unknown;
      };
      if (!response.ok || !payload.maps?.family || !payload.maps.exact) {
        const failure = toCardMapSaveFailure(payload, "Family + Exact Card Maps could not be saved.");
        setSaveFailure(failure);
        setMessage(failure);
        return;
      }
      setSaveSuccess(payload.maps);
      setMessage(
        `Saved Family r${payload.maps.family.version} and Exact r${payload.maps.exact.version}. Both are active and complete; they never merge.`,
      );
      onSaved(payload.maps);
    } catch (error) {
      const failure = toCardMapOperatorMessage(
        error instanceof Error ? error.message : "Family + Exact Card Maps could not be saved.",
      ).slice(0, 360);
      setSaveFailure(failure);
      setMessage(failure);
    } finally {
      setWorking(false);
    }
  };

  const restore = async (revisionId: string) => {
    if (working) return;
    setWorking(true);
    setMessage("Restoring the selected version as a new immediately active revision.");
    try {
      const response = await fetch("/api/admin/ai-grader-v2/maps/restore", {
        method: "POST",
        headers: buildAdminHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ sessionId: source.sessionId, revisionId, scope: baselineScope ?? "EXACT" }),
      });
      const payload = await response.json().catch(() => ({})) as { map?: SpeedsterTrainMapState; message?: string };
      if (!response.ok || !payload.map) throw new Error(payload.message ?? "Card map version could not be restored.");
      setMap(payload.map);
      if (payload.map.editable) {
        setFrontEditor(initialEditor("FRONT", source, payload.map));
        setBackEditor(initialEditor("BACK", source, payload.map));
        setUndoBySide({ FRONT: [], BACK: [] });
      }
      setMessage(`Restored content is active as new revision ${payload.map.revision?.version}.`);
    } catch (error) {
      setMessage(toCardMapOperatorMessage(
        error instanceof Error ? error.message : "Card map version could not be restored.",
      ));
    } finally {
      setWorking(false);
    }
  };

  const exportDraft = () => {
    setRecoveryError(null);
    if (!recovery.draft || !recovery.serialized) {
      setRecoveryError(recovery.error ?? "Card Map draft could not be prepared for export.");
      return;
    }
    const url = URL.createObjectURL(new Blob([recovery.serialized], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = cardMapDraftFileName(recovery.draft);
    link.click();
    URL.revokeObjectURL(url);
    setRecoverableSnapshot(recovery.serialized);
    setMessage("Current Family + Exact Card Map draft exported. Continue editing or save when ready.");
  };

  const importDraft = async (file: File | undefined) => {
    if (!file || working) return;
    setRecoveryError(null);
    try {
      if (file.size > 2_000_000) throw new Error("Card Map draft file exceeds the 2 MB recovery limit.");
      const imported = parseCardMapDraft(await file.text(), source);
      setFrontEditor(editorFromDraft(imported.sides.front));
      setBackEditor(editorFromDraft(imported.sides.back));
      setUndoBySide({ FRONT: [], BACK: [] });
      setSide("FRONT");
      setSaveFailure(null);
      setSaveSuccess(null);
      const serialized = serializeCardMapDraft(imported);
      setRecoverableSnapshot(serialized);
      setMessage(
        `Draft imported without saving: Front ${imported.sides.front.zones.length} zones · Back ${imported.sides.back.zones.length} zones.`,
      );
    } catch (error) {
      setRecoveryError(toCardMapOperatorMessage(
        error instanceof Error ? error.message : "Card Map draft could not be imported.",
      ).slice(0, 360));
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  };

  const renderGeometry = (candidate: SpeedsterCardSide, editor: SideEditorState, interactive: boolean) => {
    const candidateSelectedZone = editor.map.zones.find((zone) => zone.id === editor.selectedZoneId) ?? null;
    return (
      <>
        {editor.map.designBoundary.kind === "QUAD" ? (
          <polygon className={styles.boundary} points={polygonPoints(editor.boundaryPoints)} />
        ) : <rect className={styles.fullBleed} x="2" y="2" width="996" height="1396" />}
        {editor.map.zones.map((zone) => (
          <polygon
            key={zone.id}
            className={interactive && zone.id === editor.selectedZoneId ? styles.selectedZone : styles.zone}
            points={polygonPoints(zone.polygon)}
          />
        ))}
        {editor.zoneDraft.active && editor.zoneDraft.points.length > 1 ? (
          editor.zoneDraft.points.length >= 3
            ? <polygon className={styles.zoneDraft} points={polygonPoints(editor.zoneDraft.points)} />
            : <polyline className={styles.zoneDraft} points={polygonPoints(editor.zoneDraft.points)} />
        ) : null}
        {editor.map.anchors.map((anchor, index) => (
          <g key={anchor.id} className={styles.anchor}>
            <circle cx={anchor.point.x * 1000} cy={anchor.point.y * 1400} r="20" />
            <text x={anchor.point.x * 1000 + 28} y={anchor.point.y * 1400 - 20}>A{index + 1}</text>
          </g>
        ))}
        {interactive && tool === "BOUNDARY" && editor.map.designBoundary.kind === "QUAD" ? editor.boundaryPoints.map((point, index) => (
          <g
            key={`boundary-${index}`}
            className={`${styles.dragHandle} ${styles.boundaryHandle}`}
            aria-label={`${SIDE_LABEL[candidate]} Printed Boundary ${BOUNDARY_LABELS[index]}`}
            onPointerDown={(event) => beginDrag(event, { side: candidate, kind: "BOUNDARY", index })}
          >
            <circle className={styles.handleHit} cx={point.x * 1000} cy={point.y * 1400} r="42" />
            <circle className={styles.handleRing} cx={point.x * 1000} cy={point.y * 1400} r="22" />
            <text x={point.x * 1000 + 30} y={point.y * 1400 - 24}>{BOUNDARY_LABELS[index]}</text>
          </g>
        )) : null}
        {interactive && tool === "ANCHOR" ? editor.map.anchors.map((anchor, index) => (
          <g
            key={`handle-${anchor.id}`}
            className={`${styles.dragHandle} ${styles.anchorHandle}`}
            aria-label={`${SIDE_LABEL[candidate]} Registration Anchor A${index + 1}`}
            onPointerDown={(event) => beginDrag(event, { side: candidate, kind: "ANCHOR", index })}
          >
            <circle className={styles.handleHit} cx={anchor.point.x * 1000} cy={anchor.point.y * 1400} r="42" />
            <circle className={styles.handleRing} cx={anchor.point.x * 1000} cy={anchor.point.y * 1400} r="22" />
          </g>
        )) : null}
        {interactive && tool === "ZONE" && candidateSelectedZone ? candidateSelectedZone.polygon.map((point, index) => (
          <g
            key={`${candidateSelectedZone.id}-vertex-${index}`}
            className={`${styles.dragHandle} ${styles.zoneHandle}`}
            aria-label={`${SIDE_LABEL[candidate]} Printed-Content Zone ${candidateSelectedZone.label} vertex ${index + 1}`}
            onPointerDown={(event) => beginDrag(event, { side: candidate, kind: "ZONE", zoneId: candidateSelectedZone.id, index })}
          >
            <circle className={styles.handleHit} cx={point.x * 1000} cy={point.y * 1400} r="36" />
            <circle className={styles.handleRing} cx={point.x * 1000} cy={point.y * 1400} r="17" />
          </g>
        )) : null}
        {interactive && tool === "ZONE" && editor.zoneDraft.active ? editor.zoneDraft.points.map((point, index) => (
          <g
            key={`zone-draft-${index}`}
            className={`${styles.dragHandle} ${styles.zoneHandle}`}
            aria-label={`${SIDE_LABEL[candidate]} New Printed-Content Zone vertex ${index + 1}`}
            onPointerDown={(event) => beginDrag(event, { side: candidate, kind: "ZONE_DRAFT", index })}
          >
            <circle className={styles.handleHit} cx={point.x * 1000} cy={point.y * 1400} r="36" />
            <circle className={styles.handleRing} cx={point.x * 1000} cy={point.y * 1400} r="17" />
          </g>
        )) : null}
      </>
    );
  };

  const readinessText = (candidate: SpeedsterCardSide) => {
    const state = readiness[candidate];
    const editor = editorFor(candidate);
    return [
      `${SIDE_LABEL[candidate]} boundary ${editor.map.designBoundary.kind === "FULL_BLEED" ? "full bleed" : `${editor.boundaryPoints.length}/4`} ${state.boundary ? "ready" : "invalid"}`,
      `anchors ${editor.map.anchors.length}/4${state.anchors ? " ready" : ""}`,
      `zones ${editor.map.zones.length}${state.zones ? " ready" : " invalid"}`,
      state.ready ? "READY" : "NEEDS WORK",
    ].join(" · ");
  };

  return (
    <section className={styles.workspace} aria-label="Speedster card map workspace">
      <header className={styles.header}>
        <div>
          <span>CARD MAP · FAMILY + EXACT</span>
          <h2>{identityTitle(source.identity)}</h2>
          <p>{message}</p>
        </div>
        <div className={styles.mapIdentity}>
          <strong>{map.status === "LOADED"
            ? `${baselineScope ?? "EXISTING"} r${map.revision?.version} EDITING BASELINE`
            : "FIRST FAMILY + EXACT CREATION"}</strong>
          <small>{exactName}</small>
          <code>{map.revision?.revisionHash.slice(0, 12) ?? "new dual revision"}</code>
        </div>
      </header>

      <section className={styles.applicability} aria-label="Card map applicability">
        <strong>Saving creates both complete maps atomically</strong>
        <span>Family Card Map — {familyName} — applies to all matching cards.</span>
        <span>Exact Source Map — {exactName} — applies only to this exact source card.</span>
        <p>The same human-authored Front/Back geometry starts both maps. Exact replaces Family when it applies; maps never merge. Use one shared frame or layout landmark in each quadrant so the Family map registers matching sibling cards safely.</p>
      </section>

      <aside className={styles.familyWarning} role="status">
        <strong>V2 PADDED FILTERING · OWNER-AUTHORIZED</strong>
        <p>Saving creates new immutable Family and Exact v2 revisions with explicit per-zone filter authority and fixed 0.6 mm physical-card padding while retaining strict full-contour containment. The 50-card replay remains inconclusive—not passed—and activation is proceeding under the owner&apos;s 2026-08-12 waiver with sole-grader review and the removed-findings audit as the safety net. Prior v1 revisions remain unchanged and restorable.</p>
      </aside>

      {map.status === "INTEGRITY_ERROR" ? (
        <aside className={styles.familyWarning} role="alert">
          <strong>PRIOR MAP INTEGRITY ERROR · SAFE REPAIR MODE</strong>
          <p>{toCardMapOperatorMessage(map.integrity?.message ?? "The prior Card Map failed integrity verification.")} It is not an editing baseline and will not be rewritten. Import or review the retained draft, then save new immutable Family + Exact revisions atomically.</p>
        </aside>
      ) : null}

      {safetyWarnings.length ? (
        <aside className={styles.familyWarning} role="status">
          <strong>CHECK FAMILY LANDMARKS</strong>
          <p>Location caution: {safetyWarnings.join(" · ")} may overlap artwork or other card-specific content. Player/card name, HP, and card number are also unsafe. Shared frame/layout landmarks remain safe, including at the top or bottom, with one anchor per quadrant. This warning does not block saving.</p>
        </aside>
      ) : null}

      <section className={styles.recoveryPanel} aria-label="Card Map draft recovery">
        <div>
          <strong>{recoveryCurrent ? "CURRENT DRAFT RECOVERABLE" : "EXPORT CURRENT DRAFT"}</strong>
          <p>{recoveryCurrent
            ? "This exact normalized draft is already present in an exported or imported recovery file."
            : "Export before saving or whenever you want a durable recovery point. A failed save never clears this editor."}</p>
        </div>
        <button type="button" onClick={exportDraft} disabled={!recovery.draft}>Export Card Map Draft</button>
        <button type="button" onClick={() => importInput.current?.click()} disabled={working}>Import Card Map Draft</button>
        <input
          ref={importInput}
          className={styles.fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Choose Card Map draft file"
          onChange={(event) => void importDraft(event.target.files?.[0])}
        />
        {recoveryError ? <p className={styles.recoveryError} role="alert">{recoveryError}</p> : null}
      </section>

      <div className={styles.sideTabs}>
        {(["FRONT", "BACK"] as const).map((candidate) => (
          <button key={candidate} type="button" aria-pressed={side === candidate} onClick={() => {
            activeHandle.current = null;
            textEditKey.current = null;
            setSide(candidate);
          }}>{SIDE_LABEL[candidate]}</button>
        ))}
      </div>

      <div className={styles.editorGrid}>
        <div className={styles.imageStage} onPointerDown={addPoint}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sourceSide.rectifiedUrl}
            alt={`${SIDE_LABEL[side]} card map reference`}
            crossOrigin="anonymous"
            draggable={false}
            onLoad={(event) => {
              gradientMaps.current[side] = gradientMapFromImage(event.currentTarget);
            }}
          />
          <svg
            viewBox="0 0 1000 1400"
            preserveAspectRatio="none"
            aria-label={`Editable ${side} card map geometry`}
            onPointerMove={moveHandle}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {renderGeometry(side, active, true)}
          </svg>
        </div>

        <aside className={styles.controls}>
          <div className={styles.toolTabs}>
            <button type="button" aria-pressed={tool === "BOUNDARY"} onClick={() => setTool("BOUNDARY")}>Printed Boundary</button>
            <button type="button" aria-pressed={tool === "ANCHOR"} onClick={() => setTool("ANCHOR")}>Registration Anchors</button>
            <button type="button" aria-pressed={tool === "ZONE"} onClick={() => setTool("ZONE")}>Printed-Content Zones</button>
          </div>
          <button
            type="button"
            className={styles.undoButton}
            disabled={!undoBySide[side].length || working}
            onClick={undo}
          >
            Undo last {SIDE_LABEL[side]} edit
          </button>
          {tool === "BOUNDARY" ? (
            <div className={styles.controlBlock}>
              <strong>{active.map.designBoundary.kind === "FULL_BLEED" ? "Full bleed" : "Four-point printed boundary"}</strong>
              <p>The gold quad is the saved Card Map boundary, or starts from the proposed printed-border centering correction for a new map. It is not a defect box. Drag TL, TR, BR, or BL to adjust only that corner.</p>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={active.map.designBoundary.kind === "FULL_BLEED"}
                onClick={() => {
                  pushUndo(side);
                  setEditor(side, (current) => ({ ...current, boundaryPoints: [] }));
                }}
              >
                Reset {SIDE_LABEL[side]} boundary
              </button>
              <label className={styles.fullBleedToggle}>
                <input
                  type="checkbox"
                  checked={active.map.designBoundary.kind === "FULL_BLEED"}
                  onChange={(event) => {
                    pushUndo(side);
                    if (event.target.checked) {
                      setEditor(side, (current) => ({
                        ...current,
                        boundaryPoints: [],
                        map: { ...current.map, designBoundary: { kind: "FULL_BLEED" } },
                      }));
                    } else {
                      setEditor(side, (current) => ({
                        ...current,
                        boundaryPoints: clonePoints(sourceSide.centeringQuad),
                        map: { ...current.map, designBoundary: { kind: "QUAD", points: sourceSide.centeringQuad } },
                      }));
                    }
                  }}
                />
                Full-bleed / no printed boundary
              </label>
            </div>
          ) : tool === "ANCHOR" ? (
            <div className={styles.controlBlock}>
              <strong>{active.map.anchors.length}/4 registration anchors</strong>
              <p>Choose four distinctive, high-contrast internal printed landmarks spread across the design. They register this boundary and its zones onto another copy. Click to add missing A1–A4; drag an existing anchor to correct it.</p>
            </div>
          ) : (
            <div className={styles.controlBlock}>
              <p>Content type describes layout only. Filter authority is separate. When authority is On, a Detector or Memory contour fully inside the 0.6 mm padded filter area is removed from normal review and grading. Partial overlap and every Smart Mark remain.</p>
              <div className={styles.zoneHeader}>
                <strong>{active.map.zones.length} saved zone{active.map.zones.length === 1 ? "" : "s"}</strong>
                <button type="button" disabled={active.zoneDraft.active} onClick={beginZone}>New Zone</button>
              </div>
              {active.map.zones.length ? (
                <div className={styles.zoneList} aria-label={`${SIDE_LABEL[side]} Printed-Content Zones`}>
                  {active.map.zones.map((zone) => (
                    <button
                      key={zone.id}
                      type="button"
                      aria-pressed={!active.zoneDraft.active && zone.id === active.selectedZoneId}
                      onClick={() => setEditor(side, (current) => ({
                        ...current,
                        selectedZoneId: zone.id,
                        zoneDraft: { ...current.zoneDraft, active: false, points: [] },
                      }))}
                    >
                      <span>{zone.label}</span><small>{CONTENT_TYPES.find((type) => type.value === zone.contentType)?.label} · filter {zone.filterAuthority ? "ON" : "OFF"}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              {selectedZone || active.zoneDraft.active ? (
                <>
                  <label>Zone type<select
                    value={selectedZone?.semanticType ?? active.zoneDraft.semanticType}
                    onChange={(event) => updateZoneType(event.target.value as SpeedsterMapZoneSemanticType)}
                  >
                    {ZONE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select></label>
                  <label>Content type<select
                    value={selectedZone?.contentType ?? active.zoneDraft.contentType}
                    onChange={(event) => updateContentType(event.target.value as SpeedsterMapZoneContentType)}
                  >
                    {CONTENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select></label>
                  <label className={styles.fullBleedToggle}>
                    <input
                      type="checkbox"
                      checked={selectedZone?.filterAuthority ?? active.zoneDraft.filterAuthority}
                      onChange={(event) => updateFilterAuthority(event.target.checked)}
                    />
                    Filter authority
                  </label>
                  <p>{(selectedZone?.filterAuthority ?? active.zoneDraft.filterAuthority)
                    ? "ON — a fully contained Detector or Memory finding may be removed from normal review and grading. Partial overlap and Smart Marks remain."
                    : "OFF — this is a descriptive content zone only and never filters a finding."}</p>
                  <label>Zone name<input
                    value={selectedZone?.label ?? active.zoneDraft.label}
                    maxLength={80}
                    onFocus={() => startTextEdit(`${side}:${selectedZone?.id ?? "draft"}:label`)}
                    onBlur={() => { textEditKey.current = null; }}
                    onChange={(event) => updateZoneLabel(event.target.value)}
                  /></label>
                </>
              ) : null}
              {active.zoneDraft.active ? (
                <>
                  <strong>{active.zoneDraft.points.length} draft polygon points</strong>
                  <p>Click around the printed content in perimeter order, then drag any draft vertex for precision.</p>
                  <button type="button" disabled={!isSpeedsterSimplePolygon(active.zoneDraft.points)} onClick={saveZone}>Add Printed-Content Zone</button>
                  <button type="button" onClick={cancelZone}>Cancel new zone</button>
                </>
              ) : selectedZone ? (
                <>
                  <strong>{selectedZone.polygon.length} draggable vertices</strong>
                  <button type="button" onClick={removeSelectedZone}>Remove selected zone</button>
                </>
              ) : null}
            </div>
          )}
        </aside>
      </div>

      <section className={styles.preview} aria-label="Composed card map preview">
        <header>
          <div><span>COMPOSED MAP PREVIEW</span><h3>Front + Back</h3></div>
          <p><b>Gold</b> printed boundary · <b>Cyan</b> registration anchors · <b>Magenta</b> content zones · filter authority is explicit per zone</p>
        </header>
        <div className={styles.previewGrid}>
          {(["FRONT", "BACK"] as const).map((candidate) => {
            const editor = editorFor(candidate);
            const candidateSource = candidate === "FRONT" ? source.front : source.back;
            return (
              <article key={candidate}>
                <strong>{SIDE_LABEL[candidate]}</strong>
                <div className={styles.previewCard}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={candidateSource.rectifiedUrl} alt={`${SIDE_LABEL[candidate]} composed card map`} draggable={false} />
                  <svg viewBox="0 0 1000 1400" preserveAspectRatio="none" aria-label={`${candidate} composed card map preview`}>
                    {renderGeometry(candidate, editor, false)}
                  </svg>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.readiness}>
          {(["FRONT", "BACK"] as const).map((candidate) => (
            <strong key={candidate} className={readiness[candidate].ready ? styles.readyStatus : styles.pendingStatus}>
              {readinessText(candidate)}
            </strong>
          ))}
          <strong className={recoveryCurrent ? styles.readyStatus : styles.pendingStatus}>
            Recovery · {recoveryCurrent ? "CURRENT DRAFT EXPORTED / IMPORTED" : "EXPORT RECOMMENDED"}
          </strong>
        </div>
        <section className={styles.saveSummary} aria-label="Card Map save summary">
          <strong>ONE ATOMIC SAVE</strong>
          <span>Family identity · {familyName}</span>
          <span>Exact source · {exactName}</span>
          <span>Front · {readiness.FRONT.ready ? "READY" : "NEEDS WORK"} · {frontEditor.map.zones.length} zones</span>
          <span>Back · {readiness.BACK.ready ? "READY" : "NEEDS WORK"} · {backEditor.map.zones.length} zones</span>
          <span>Recovery · {recoveryCurrent ? "current draft exported/imported" : "current draft not yet exported"}</span>
        </section>
        {saveFailure ? (
          <section className={styles.saveFailure} role="alert">
            <strong>SAVE FAILED — YOUR FULL DRAFT IS STILL HERE</strong>
            <p>{saveFailure}</p>
            <button type="button" onClick={() => void save()} disabled={working}>Retry</button>
            <button type="button" onClick={exportDraft} disabled={!recovery.draft}>Export Draft</button>
          </section>
        ) : null}
        {saveSuccess ? (
          <section className={styles.saveSuccess} role="status" aria-label="Created Card Map revisions">
            <strong>FAMILY + EXACT MAPS SAVED ATOMICALLY</strong>
            <span>Family r{saveSuccess.family.version} · {saveSuccess.family.revisionId} · {saveSuccess.family.revisionHash.slice(0, 12)} · {saveSuccess.family.applicability}</span>
            <span>Exact r{saveSuccess.exact.version} · {saveSuccess.exact.revisionId} · {saveSuccess.exact.revisionHash.slice(0, 12)} · {saveSuccess.exact.applicability}</span>
            <p>Exact applies only to this source card and replaces Family completely. Family applies to matching sibling cards. They never merge.</p>
          </section>
        ) : null}
        {onCancel ? <button type="button" onClick={onCancel} disabled={working}>Close Card Map</button> : null}
        <button type="button" onClick={() => void save()} disabled={!ready || working}>
          {working ? "SAVING FAMILY + EXACT MAPS…" : "SAVE FAMILY + EXACT MAPS"}
        </button>
      </footer>

      {map.revisions.length ? (
        <section className={styles.history}>
          <h3>{baselineScope ?? "Existing"} immutable revision history</h3>
          {map.revisions.map((revision) => (
            <div key={revision.revisionId}>
              <span>r{revision.version} · {revision.revisionHash.slice(0, 12)}</span>
              {revision.current
                ? <strong>ACTIVE</strong>
                : <button type="button" disabled={working} onClick={() => void restore(revision.revisionId)}>Restore as new active revision</button>}
            </div>
          ))}
        </section>
      ) : null}
    </section>
  );
}
