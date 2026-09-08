import { VAULT_COLUMNS, VAULT_DOOR_MAP, VAULT_ROW_COUNT, type VaultMachineProfile } from "@tenkings/vault-contracts/browser";
import type { KioskDoor, VaultDoorId } from "../types";
import { useEffect, useId, useRef, useState } from "react";
import { profileCanvasSize } from "../workflow/profileLayout";

interface DoorMapProps {
  configSchemaVersion: 1 | 2 | null;
  machineProfile?: VaultMachineProfile | null;
  doors: readonly KioskDoor[];
  selectedProductId: string | null;
  disabled: boolean;
  animatedDoorId: VaultDoorId | null;
  paidDoorIds?: readonly VaultDoorId[];
  onToggle: (door: KioskDoor) => void;
  purpose?: "SHOPPING" | "RESTOCK";
}

function stateLabel(door: KioskDoor, matchesProduct: boolean): string {
  if (door.conflict) return "needs replacement";
  if (door.selected) return "selected";
  if (door.state !== "AVAILABLE" || !matchesProduct) return "unavailable";
  return "available";
}

export function DoorMap({ configSchemaVersion, machineProfile = null, doors, selectedProductId, disabled, animatedDoorId, paidDoorIds = [], onToggle, purpose = "SHOPPING" }: DoorMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [availableWidth, setAvailableWidth] = useState(0);
  useEffect(() => {
    const frame = mapRef.current;
    if (!frame) return;
    const measure = () => setAvailableWidth(frame.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [configSchemaVersion, machineProfile?.profileId, machineProfile?.revision]);
  useEffect(() => {
    if (animatedDoorId) mapRef.current?.querySelector<HTMLElement>(`[data-door-id="${animatedDoorId}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "auto" });
  }, [animatedDoorId]);
  const byId = new Map(doors.map((door) => [door.doorId, door]));
  const paid = new Set(paidDoorIds);
  const spatial = configSchemaVersion === 2 ? machineProfile : null;
  const canvas = spatial ? profileCanvasSize(spatial, availableWidth) : null;
  const cutoutLabels = { TOUCHSCREEN: "Touchscreen", PAYMENT_TERMINAL: "Payment terminal", PRODUCT_DISPLAY: "Product display", TV: "TV display", SERVICE: "Service area" };

  const doorButton = (doorId: VaultDoorId, labelText: string, rect?: { x: number; y: number; width: number; height: number }) => {
    const door = byId.get(doorId) ?? { doorId, productId: null, state: "DISABLED" as const, selected: false };
    const matchesProduct = selectedProductId !== null && door.productId === selectedProductId;
    const available = door.state === "AVAILABLE" && matchesProduct;
    const interactive = !disabled && (available || door.selected);
    return <button key={doorId} type="button"
      className={["door-cell", rect ? "spatial-door" : "", available ? "available" : "unavailable", door.selected ? "selected" : "", door.conflict ? "conflict" : "", animatedDoorId === doorId ? "pick-flash" : "", paid.has(doorId) ? "paid" : ""].filter(Boolean).join(" ")}
      style={rect && spatial ? { left: `${rect.x / spatial.display.width * 100}%`, top: `${rect.y / spatial.display.height * 100}%`, width: `${rect.width / spatial.display.width * 100}%`, height: `${rect.height / spatial.display.height * 100}%` } : undefined}
      disabled={!interactive} aria-label={`${labelText}, ${stateLabel(door, matchesProduct)}`} aria-pressed={door.selected}
      onClick={() => onToggle(door)} data-door-id={doorId} data-door-label={labelText}>
      <span className="door-code">{labelText}</span>
      <small>{purpose === "RESTOCK" ? door.selected ? "CURRENT" : available ? "PLANNED" : "—" : paid.has(doorId) ? "PAID" : door.selected ? "IN CART" : available ? "SELECT" : "—"}</small>
    </button>;
  };

  return (
    <section className="door-section" aria-labelledby={titleId}>
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">{purpose === "RESTOCK" ? "Pinned door positions" : "Step 2"}</p>
          <h2 id={titleId}>{purpose === "RESTOCK" ? "Restock cabinet map" : "Choose a gold door"}</h2>
        </div>
        <div className="door-legend" aria-label="Door legend">
          <span><i className="legend-dot available" />{purpose === "RESTOCK" ? "Planned group" : "Available"}</span>
          <span><i className="legend-dot selected" />{purpose === "RESTOCK" ? "Current door" : "Selected"}</span>
          <span><i className="legend-dot unavailable" />{purpose === "RESTOCK" ? "Other" : "Unavailable"}</span>
        </div>
      </div>
      <div className="door-map-frame" ref={mapRef} tabIndex={0} role="region" aria-label="Scrollable cabinet door map">
        {spatial && canvas ? <div className="spatial-door-map" role="group" aria-label="Configured cabinet door positions" style={canvas}>
          {spatial.display.cutouts.map((cutout) => <div key={cutout.id} className="profile-cutout" data-cutout-id={cutout.id} style={{ left: `${cutout.rect.x / spatial.display.width * 100}%`, top: `${cutout.rect.y / spatial.display.height * 100}%`, width: `${cutout.rect.width / spatial.display.width * 100}%`, height: `${cutout.rect.height / spatial.display.height * 100}%` }}><span>{cutoutLabels[cutout.kind]}</span></div>)}
          {spatial.doors.map((door) => doorButton(door.doorId, door.label, door.displayRect))}
        </div> : configSchemaVersion === 1 ? <div className="door-map" role="group" aria-label="Historical X K I N G S cabinet door positions">
          <div className="door-map-header" aria-hidden="true">
            <span className="row-number-heading" aria-hidden="true">Row</span>
            {VAULT_COLUMNS.map((column) => <span key={column}>{column}</span>)}
          </div>
          {Array.from({ length: VAULT_ROW_COUNT }, (_, rowIndex) => {
            const row = rowIndex + 1;
            const coordinates = VAULT_DOOR_MAP.slice(rowIndex * VAULT_COLUMNS.length, (rowIndex + 1) * VAULT_COLUMNS.length);
            return (
              <div className="door-row" key={row}>
                <span className="door-row-number" aria-hidden="true">{String(row).padStart(2, "0")}</span>
                {coordinates.map(({ doorId }) => doorButton(doorId, doorId))}
              </div>
            );
          })}
        </div> : <p className="critical-stop" role="alert">The configured door layout is unavailable. Door selection is blocked until the local service supplies a valid profile.</p>}
      </div>
      <p className="map-note">{spatial ? `${spatial.provenance === "SYNTHETIC" ? "Synthetic test layout" : "Configured layout"} · ${spatial.profileId} revision ${spatial.revision}. Positions and door sizes stay fixed; scroll the map to reach every label.` : configSchemaVersion === 1 ? "Historical cabinet layout: rows 01–25. Every position is retained." : "A layout cannot be inferred from door IDs."}</p>
    </section>
  );
}
