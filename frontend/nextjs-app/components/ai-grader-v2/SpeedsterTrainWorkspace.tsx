"use client";

import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  SpeedsterMapDesignBoundary,
  SpeedsterMapZone,
  SpeedsterMapZoneSemanticType,
} from "../../lib/ai-grader-v2/card-type-map-contracts";
import {
  isSpeedsterNondegenerateAnchorSet,
  isSpeedsterSimplePolygon,
  isSpeedsterStrictConvexPolygon,
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
import styles from "./SpeedsterTrainWorkspace.module.css";

type EditableAnchor = Readonly<{ id: string; label: string; point: SpeedsterPoint }>;
type EditableSide = Readonly<{
  designBoundary: SpeedsterMapDesignBoundary;
  anchors: readonly EditableAnchor[];
  zones: readonly SpeedsterMapZone[];
}>;

export type SpeedsterTrainMapState = Readonly<{
  status: "MISSING" | "LOADED";
  revision: Readonly<{
    mapId: string;
    revisionId: string;
    version: number;
    revisionHash: string;
    displayIdentity: SpeedsterSessionIdentity;
    mapSchemaVersion: string;
    filterPolicyVersion: string;
    createdAt: string;
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
  front: Readonly<{ rectifiedUrl: string; centeringQuad: SpeedsterQuad }>;
  back: Readonly<{ rectifiedUrl: string; centeringQuad: SpeedsterQuad }>;
}>;

type SideDraft = {
  designBoundary: SpeedsterMapDesignBoundary;
  anchors: EditableAnchor[];
  zones: SpeedsterMapZone[];
};

type SideEditorState = {
  map: SideDraft;
  boundaryPoints: SpeedsterPoint[];
  selectedZoneId: string | null;
  zoneDraft: {
    active: boolean;
    points: SpeedsterPoint[];
    semanticType: SpeedsterMapZoneSemanticType;
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

function cloneSide(side: SideDraft): SideDraft {
  return {
    designBoundary: cloneBoundary(side.designBoundary),
    anchors: side.anchors.map((anchor) => ({ ...anchor, point: { ...anchor.point } })),
    zones: side.zones.map((zone) => ({ ...zone, polygon: clonePoints(zone.polygon) })),
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
    zoneDraft: { active: false, points: [], semanticType: "PRINT_TEXT", label: "Print zone" },
  };
}

function identityTitle(identity: SpeedsterSessionIdentity) {
  return "playerName" in identity ? identity.playerName : identity.cardName;
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

function nextZoneId(side: SpeedsterCardSide, zones: readonly SpeedsterMapZone[]) {
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
  onSaved: (map: SpeedsterTrainMapState) => void;
  onCancel?: () => void;
}>) {
  const [map, setMap] = useState(initialMap);
  const [side, setSide] = useState<SpeedsterCardSide>("FRONT");
  const [frontEditor, setFrontEditor] = useState<SideEditorState>(() => initialEditor("FRONT", source, initialMap));
  const [backEditor, setBackEditor] = useState<SideEditorState>(() => initialEditor("BACK", source, initialMap));
  const [undoBySide, setUndoBySide] = useState<Record<SpeedsterCardSide, SideEditorState[]>>({ FRONT: [], BACK: [] });
  const [tool, setTool] = useState<Tool>("BOUNDARY");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(
    map.status === "LOADED"
      ? map.editable
        ? `Loaded exact card map revision ${map.revision?.version}. Editing saves and activates a new immutable revision.`
        : `Loaded exact card map revision ${map.revision?.version}. Edit this current copy to save a coordinate-safe new revision.`
      : "No exact card map exists. Saving creates and immediately activates revision 1.",
  );
  const activeHandle = useRef<DragTarget | null>(null);
  const gradientMaps = useRef<Partial<Record<SpeedsterCardSide, SpeedsterGradientMap | null>>>({});
  const textEditKey = useRef<string | null>(null);
  const active = side === "FRONT" ? frontEditor : backEditor;
  const sourceSide = side === "FRONT" ? source.front : source.back;
  const selectedZone = active.map.zones.find((zone) => zone.id === active.selectedZoneId) ?? null;
  const readiness = useMemo(() => ({
    FRONT: sideReadiness(frontEditor),
    BACK: sideReadiness(backEditor),
  }), [backEditor, frontEditor]);
  const ready = readiness.FRONT.ready && readiness.BACK.ready;

  const editorFor = (candidate: SpeedsterCardSide) => candidate === "FRONT" ? frontEditor : backEditor;
  const setEditor = (
    candidate: SpeedsterCardSide,
    next: SideEditorState | ((current: SideEditorState) => SideEditorState),
  ) => {
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
        zones: current.map.zones.map((zone) => zone.id === current.selectedZoneId ? { ...zone, semanticType } : zone),
      },
    } : {
      ...current,
      zoneDraft: { ...current.zoneDraft, semanticType },
    });
  };

  const beginZone = () => {
    if (active.zoneDraft.active) return;
    pushUndo(side);
    setEditor(side, (current) => ({
      ...current,
      selectedZoneId: null,
      zoneDraft: { active: true, points: [], semanticType: "PRINT_TEXT", label: "Print zone" },
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
          polygon: clonePoints(current.zoneDraft.points),
        }],
      },
      selectedZoneId: id,
      zoneDraft: { active: false, points: [], semanticType: "PRINT_TEXT", label: "Print zone" },
    }));
  };

  const cancelZone = () => {
    if (!active.zoneDraft.active) return;
    pushUndo(side);
    setEditor(side, (current) => ({
      ...current,
      selectedZoneId: current.map.zones[0]?.id ?? null,
      zoneDraft: { active: false, points: [], semanticType: "PRINT_TEXT", label: "Print zone" },
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
    setMessage("Saving and immediately activating the immutable card map revision.");
    try {
      const response = await fetch("/api/admin/ai-grader-v2/maps/save", {
        method: "POST",
        headers: buildAdminHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ sessionId: source.sessionId, front: frontEditor.map, back: backEditor.map }),
      });
      const payload = await response.json().catch(() => ({})) as { map?: SpeedsterTrainMapState; message?: string };
      if (!response.ok || !payload.map) throw new Error(payload.message ?? "Card map could not be saved.");
      setMap(payload.map);
      setMessage(`Revision ${payload.map.revision?.version} is active now for this exact card identity.`);
      onSaved(payload.map);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Card map could not be saved.");
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
        body: JSON.stringify({ sessionId: source.sessionId, revisionId }),
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
      onSaved(payload.map);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Card map version could not be restored.");
    } finally {
      setWorking(false);
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
          <span>CARD MAP · EXACT CARD TYPE</span>
          <h2>{identityTitle(source.identity)}</h2>
          <p>{message}</p>
        </div>
        <div className={styles.mapIdentity}>
          <strong>{map.status === "LOADED" ? `MAP r${map.revision?.version}` : "NO EXACT MAP"}</strong>
          <code>{map.revision?.revisionHash.slice(0, 12) ?? "new revision"}</code>
        </div>
      </header>

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
            alt={`${SIDE_LABEL[side]} TRAIN reference`}
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
              <p>The gold quad starts from the saved/proposed printed-border centering correction. It is not a defect box. Drag TL, TR, BR, or BL to adjust only that corner.</p>
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
              <p>Fully contained Detector or Memory findings inside these printed-content zones are filtered. Partial overlap remains in review, and Smart Marks always remain.</p>
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
                      <span>{zone.label}</span><small>{ZONE_TYPES.find((type) => type.value === zone.semanticType)?.label}</small>
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
          <p><b>Gold</b> printed boundary · <b>Cyan</b> registration anchors · <b>Magenta</b> printed-content zones</p>
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
        </div>
        {onCancel ? <button type="button" onClick={onCancel} disabled={working}>Close Card Map</button> : null}
        <button type="button" onClick={() => void save()} disabled={!ready || working}>
          {working ? "Saving…" : map.status === "LOADED" ? "Save + activate new revision" : "Save + activate card map"}
        </button>
      </footer>

      {map.revisions.length ? (
        <section className={styles.history}>
          <h3>Immutable revision history</h3>
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
