import { VAULT_COLUMNS, VAULT_DOOR_MAP, VAULT_ROW_COUNT } from "@tenkings/vault-contracts/browser";
import type { KioskDoor, VaultDoorId } from "../types";

interface DoorMapProps {
  doors: readonly KioskDoor[];
  selectedProductId: string | null;
  disabled: boolean;
  animatedDoorId: VaultDoorId | null;
  paidDoorIds?: readonly VaultDoorId[];
  onToggle: (door: KioskDoor) => void;
}

function stateLabel(door: KioskDoor, matchesProduct: boolean): string {
  if (door.conflict) return "needs replacement";
  if (door.selected) return "selected";
  if (door.state !== "AVAILABLE" || !matchesProduct) return "unavailable";
  return "available";
}

export function DoorMap({ doors, selectedProductId, disabled, animatedDoorId, paidDoorIds = [], onToggle }: DoorMapProps) {
  const byId = new Map(doors.map((door) => [door.doorId, door]));
  const paid = new Set(paidDoorIds);

  return (
    <section className="door-section" aria-labelledby="doors-title">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Step 2</p>
          <h2 id="doors-title">Choose a gold door</h2>
        </div>
        <div className="door-legend" aria-label="Door legend">
          <span><i className="legend-dot available" />Available</span>
          <span><i className="legend-dot selected" />Selected</span>
          <span><i className="legend-dot unavailable" />Unavailable</span>
        </div>
      </div>
      <div className="door-map-frame">
        <div className="door-map" role="grid" aria-rowcount={VAULT_ROW_COUNT} aria-colcount={VAULT_COLUMNS.length}>
          <div className="door-map-header" role="row">
            {VAULT_COLUMNS.map((column) => <span role="columnheader" key={column}>{column}</span>)}
          </div>
          {Array.from({ length: VAULT_ROW_COUNT }, (_, rowIndex) => {
            const row = rowIndex + 1;
            const coordinates = VAULT_DOOR_MAP.slice(rowIndex * VAULT_COLUMNS.length, (rowIndex + 1) * VAULT_COLUMNS.length);
            return (
              <div className="door-row" role="row" aria-rowindex={row} key={row}>
                {coordinates.map(({ doorId, column }) => {
                  const door = byId.get(doorId) ?? { doorId, productId: null, state: "DISABLED" as const, selected: false };
                  const matchesProduct = selectedProductId !== null && door.productId === selectedProductId;
                  const available = door.state === "AVAILABLE" && matchesProduct;
                  const interactive = !disabled && (available || door.selected);
                  const label = `${doorId}, ${stateLabel(door, matchesProduct)}`;
                  return (
                    <button
                      key={doorId}
                      role="gridcell"
                      type="button"
                      className={[
                        "door-cell",
                        available ? "available" : "unavailable",
                        door.selected ? "selected" : "",
                        door.conflict ? "conflict" : "",
                        animatedDoorId === doorId ? "pick-flash" : "",
                        paid.has(doorId) ? "paid" : "",
                      ].filter(Boolean).join(" ")}
                      disabled={!interactive}
                      aria-label={label}
                      aria-pressed={door.selected}
                      onClick={() => onToggle(door)}
                      data-door-id={doorId}
                    >
                      <span className="door-code"><b>{column}</b>{String(row).padStart(2, "0")}</span>
                      <small>{paid.has(doorId) ? "PAID" : door.selected ? "IN CART" : available ? "SELECT" : "—"}</small>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="map-note">The layout matches the physical cabinet: row 01 through row 25. Every position stays visible.</p>
    </section>
  );
}
