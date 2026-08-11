"use client";

import { useMemo, useState } from "react";
import type {
  SpeedsterMapDesignBoundary,
  SpeedsterMapZone,
  SpeedsterMapZoneSemanticType,
} from "../../lib/ai-grader-v2/card-type-map-contracts";
import type {
  SpeedsterCardProfile,
  SpeedsterCardSide,
  SpeedsterPoint,
  SpeedsterQuad,
} from "../../lib/ai-grader-v2/contracts";
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

type Tool = "BOUNDARY" | "ANCHOR" | "ZONE";

const ZONE_TYPES: readonly Readonly<{ value: SpeedsterMapZoneSemanticType; label: string }>[] = [
  { value: "PRINT_TEXT", label: "Printed text" },
  { value: "PRINT_LOGO", label: "Printed logo" },
  { value: "PRINT_ARTWORK", label: "Printed artwork" },
  { value: "PRINT_BORDER", label: "Printed border" },
  { value: "PRINT_FOIL", label: "Foil / holographic print" },
  { value: "OTHER_PRINT_CONTEXT", label: "Other print context" },
];

const SIDE_LABEL: Record<SpeedsterCardSide, string> = { FRONT: "Front", BACK: "Back" };

function initialSide(side: SpeedsterCardSide, source: SpeedsterTrainSource, map: SpeedsterTrainMapState): SideDraft {
  const existing = side === "FRONT" ? map.editable?.front : map.editable?.back;
  if (existing) {
    return {
      designBoundary: existing.designBoundary,
      anchors: existing.anchors.map((anchor) => ({ ...anchor })),
      zones: existing.zones.map((zone) => ({ ...zone, polygon: zone.polygon.map((point) => ({ ...point })) })),
    };
  }
  const sourceSide = side === "FRONT" ? source.front : source.back;
  return { designBoundary: { kind: "QUAD", points: sourceSide.centeringQuad }, anchors: [], zones: [] };
}

function identityTitle(identity: SpeedsterSessionIdentity) {
  return "playerName" in identity ? identity.playerName : identity.cardName;
}

function polygonPoints(points: readonly SpeedsterPoint[]) {
  return points.map((point) => `${point.x * 1000},${point.y * 1400}`).join(" ");
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
  const [front, setFront] = useState<SideDraft>(() => initialSide("FRONT", source, initialMap));
  const [back, setBack] = useState<SideDraft>(() => initialSide("BACK", source, initialMap));
  const [frontBoundaryPoints, setFrontBoundaryPoints] = useState<SpeedsterPoint[]>(() => {
    const boundary = initialSide("FRONT", source, initialMap).designBoundary;
    return boundary.kind === "QUAD" ? [...boundary.points] : [];
  });
  const [backBoundaryPoints, setBackBoundaryPoints] = useState<SpeedsterPoint[]>(() => {
    const boundary = initialSide("BACK", source, initialMap).designBoundary;
    return boundary.kind === "QUAD" ? [...boundary.points] : [];
  });
  const [tool, setTool] = useState<Tool>("BOUNDARY");
  const [zonePoints, setZonePoints] = useState<SpeedsterPoint[]>([]);
  const [zoneType, setZoneType] = useState<SpeedsterMapZoneSemanticType>("PRINT_TEXT");
  const [zoneLabel, setZoneLabel] = useState("Print zone");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(
    map.status === "LOADED"
      ? map.editable
        ? `Loaded exact map revision ${map.revision?.version}. Editing will save and activate a new immutable revision.`
        : `Loaded exact map revision ${map.revision?.version}. Draw on this current copy to save a coordinate-safe new revision.`
      : "No exact map exists. Saving creates and immediately activates revision 1.",
  );
  const active = side === "FRONT" ? front : back;
  const sourceSide = side === "FRONT" ? source.front : source.back;
  const activeBoundaryPoints = side === "FRONT" ? frontBoundaryPoints : backBoundaryPoints;
  const setActive = (next: SideDraft | ((current: SideDraft) => SideDraft)) => {
    const setter = side === "FRONT" ? setFront : setBack;
    setter(next);
  };
  const setActiveBoundaryPoints = side === "FRONT" ? setFrontBoundaryPoints : setBackBoundaryPoints;
  const ready = useMemo(
    () => (
      (front.designBoundary.kind === "FULL_BLEED" || frontBoundaryPoints.length === 4) &&
      (back.designBoundary.kind === "FULL_BLEED" || backBoundaryPoints.length === 4) &&
      front.anchors.length === 4 && back.anchors.length === 4 &&
      front.zones.length > 0 && back.zones.length > 0
    ),
    [back.anchors.length, back.designBoundary.kind, back.zones.length, backBoundaryPoints.length,
      front.anchors.length, front.designBoundary.kind, front.zones.length, frontBoundaryPoints.length],
  );

  const addPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    if (working) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextPoint = {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
    if (tool === "BOUNDARY") {
      if (active.designBoundary.kind === "FULL_BLEED" || activeBoundaryPoints.length >= 4) return;
      const next = [...activeBoundaryPoints, nextPoint];
      setActiveBoundaryPoints(next);
      if (next.length === 4) {
        setActive({ ...active, designBoundary: { kind: "QUAD", points: next as unknown as SpeedsterQuad } });
      }
      return;
    }
    if (tool === "ANCHOR") {
      if (active.anchors.length >= 4) return;
      const number = active.anchors.length + 1;
      setActive({
        ...active,
        anchors: [...active.anchors, { id: `${side.toLowerCase()}-anchor-${number}`, label: `Anchor ${number}`, point: nextPoint }],
      });
      return;
    }
    setZonePoints((current) => current.length < 64 ? [...current, nextPoint] : current);
  };

  const saveZone = () => {
    if (zonePoints.length < 3) return;
    const number = active.zones.length + 1;
    setActive({
      ...active,
      zones: [...active.zones, {
        id: `${side.toLowerCase()}-zone-${number}`,
        label: zoneLabel.trim() || `Print zone ${number}`,
        semanticType: zoneType,
        polygon: zonePoints,
      }],
    });
    setZonePoints([]);
    setZoneLabel("Print zone");
  };

  const save = async () => {
    if (!ready || working) return;
    setWorking(true);
    setMessage("Saving and immediately activating the immutable TRAIN map revision.");
    try {
      const response = await fetch("/api/admin/ai-grader-v2/maps/save", {
        method: "POST",
        headers: buildAdminHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ sessionId: source.sessionId, front, back }),
      });
      const payload = await response.json().catch(() => ({})) as { map?: SpeedsterTrainMapState; message?: string };
      if (!response.ok || !payload.map) throw new Error(payload.message ?? "TRAIN map could not be saved.");
      setMap(payload.map);
      setMessage(`Revision ${payload.map.revision?.version} is active now for this exact card identity.`);
      onSaved(payload.map);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TRAIN map could not be saved.");
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
      if (!response.ok || !payload.map) throw new Error(payload.message ?? "TRAIN map version could not be restored.");
      setMap(payload.map);
      if (payload.map.editable) {
        const nextFront = initialSide("FRONT", source, payload.map);
        const nextBack = initialSide("BACK", source, payload.map);
        setFront(nextFront);
        setBack(nextBack);
        setFrontBoundaryPoints(nextFront.designBoundary.kind === "QUAD" ? [...nextFront.designBoundary.points] : []);
        setBackBoundaryPoints(nextBack.designBoundary.kind === "QUAD" ? [...nextBack.designBoundary.points] : []);
      }
      setMessage(`Restored content is active as new revision ${payload.map.revision?.version}.`);
      onSaved(payload.map);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TRAIN map version could not be restored.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className={styles.workspace} aria-label="Speedster TRAIN map workspace">
      <header className={styles.header}>
        <div>
          <span>TRAIN · EXACT CARD TYPE</span>
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
            setSide(candidate);
            setZonePoints([]);
          }}>{SIDE_LABEL[candidate]}</button>
        ))}
      </div>

      <div className={styles.editorGrid}>
        <div className={styles.imageStage} onPointerDown={addPoint}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sourceSide.rectifiedUrl} alt={`${SIDE_LABEL[side]} TRAIN reference`} draggable={false} />
          <svg viewBox="0 0 1000 1400" preserveAspectRatio="none" aria-hidden="true">
            {active.designBoundary.kind === "QUAD" ? (
              activeBoundaryPoints.length >= 3
                ? <polygon className={styles.boundary} points={polygonPoints(activeBoundaryPoints)} />
                : activeBoundaryPoints.length >= 2
                  ? <polyline className={styles.boundary} points={polygonPoints(activeBoundaryPoints)} />
                  : null
            ) : <rect className={styles.fullBleed} x="2" y="2" width="996" height="1396" />}
            {active.designBoundary.kind === "QUAD" ? activeBoundaryPoints.map((point, index) => (
              <circle key={`boundary-${index}`} className={styles.boundaryPoint} cx={point.x * 1000} cy={point.y * 1400} r="17" />
            )) : null}
            {active.zones.map((zone) => <polygon key={zone.id} className={styles.zone} points={polygonPoints(zone.polygon)} />)}
            {zonePoints.length > 1 ? <polyline className={styles.zoneDraft} points={polygonPoints(zonePoints)} /> : null}
            {active.anchors.map((anchor, index) => (
              <g key={anchor.id} className={styles.anchor}>
                <circle cx={anchor.point.x * 1000} cy={anchor.point.y * 1400} r="20" />
                <text x={anchor.point.x * 1000 + 28} y={anchor.point.y * 1400 - 20}>{index + 1}</text>
              </g>
            ))}
          </svg>
        </div>

        <aside className={styles.controls}>
          <div className={styles.toolTabs}>
            <button type="button" aria-pressed={tool === "BOUNDARY"} onClick={() => setTool("BOUNDARY")}>Boundary</button>
            <button type="button" aria-pressed={tool === "ANCHOR"} onClick={() => setTool("ANCHOR")}>Anchors</button>
            <button type="button" aria-pressed={tool === "ZONE"} onClick={() => setTool("ZONE")}>Zones</button>
          </div>
          {tool === "BOUNDARY" ? (
            <div className={styles.controlBlock}>
              <strong>{active.designBoundary.kind === "FULL_BLEED" ? "Full bleed" : `${activeBoundaryPoints.length}/4 human boundary points`}</strong>
              <p>Set the four printed-design corners for this side in order around the card.</p>
              <button type="button" disabled={active.designBoundary.kind === "FULL_BLEED"} onClick={() => setActiveBoundaryPoints([])}>
                Reset {SIDE_LABEL[side]} boundary
              </button>
            </div>
          ) : tool === "ANCHOR" ? (
            <div className={styles.controlBlock}>
              <strong>{active.anchors.length}/4 human anchors</strong>
              <p>Place four unmistakable printed-design points. They register this map to each current copy.</p>
              <button type="button" onClick={() => setActive({ ...active, anchors: [] })}>Reset {SIDE_LABEL[side]} anchors</button>
            </div>
          ) : (
            <div className={styles.controlBlock}>
              <label>Zone type<select value={zoneType} onChange={(event) => setZoneType(event.target.value as SpeedsterMapZoneSemanticType)}>
                {ZONE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select></label>
              <label>Zone name<input value={zoneLabel} maxLength={80} onChange={(event) => setZoneLabel(event.target.value)} /></label>
              <strong>{zonePoints.length} polygon points</strong>
              <button type="button" disabled={zonePoints.length < 3} onClick={saveZone}>Add classified zone</button>
              <button type="button" disabled={!zonePoints.length} onClick={() => setZonePoints([])}>Clear draft points</button>
              <button type="button" disabled={!active.zones.length} onClick={() => setActive({ ...active, zones: [] })}>Reset {SIDE_LABEL[side]} zones</button>
            </div>
          )}
          <label className={styles.fullBleedToggle}>
            <input
              type="checkbox"
              checked={active.designBoundary.kind === "FULL_BLEED"}
              onChange={(event) => {
                if (event.target.checked) {
                  setActiveBoundaryPoints([]);
                  setActive({ ...active, designBoundary: { kind: "FULL_BLEED" } });
                } else {
                  setActiveBoundaryPoints([...sourceSide.centeringQuad]);
                  setActive({ ...active, designBoundary: { kind: "QUAD", points: sourceSide.centeringQuad } });
                }
              }}
            />
            Full-bleed / no printed boundary
          </label>
          <p className={styles.boundaryNote}>The saved human boundary starts from the existing centering correction. Full bleed records no invented printed border.</p>
        </aside>
      </div>

      <footer className={styles.footer}>
        <div>
          <strong>Front boundary {front.designBoundary.kind === "FULL_BLEED" ? "full bleed" : `${frontBoundaryPoints.length}/4`} · {front.anchors.length}/4 anchors · {front.zones.length} zones</strong>
          <strong>Back boundary {back.designBoundary.kind === "FULL_BLEED" ? "full bleed" : `${backBoundaryPoints.length}/4`} · {back.anchors.length}/4 anchors · {back.zones.length} zones</strong>
        </div>
        {onCancel ? <button type="button" onClick={onCancel} disabled={working}>Close TRAIN</button> : null}
        <button type="button" onClick={() => void save()} disabled={!ready || working}>
          {working ? "Saving…" : map.status === "LOADED" ? "Save + activate new revision" : "Save + activate map"}
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
