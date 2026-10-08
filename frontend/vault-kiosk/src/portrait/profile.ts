import type { KioskDoor, KioskPublicSnapshot, VaultDoorId } from "../types";
import { cinematicPreviewAllowed, previewRevealIds } from "../cinematic/experience";
import { CABINET, cabinetDoors } from "./layout";

/** Read only the signed display rectangles to determine visual slots. Stable IDs
 * and controller addresses are never generated, relabeled, or inferred here. */
export function portraitProfileIds(snapshot: KioskPublicSnapshot): VaultDoorId[] | null {
  const profile = snapshot.machineProfile;
  if (snapshot.configSchemaVersion !== 2 || profile?.provenance !== "QUALIFIED" || !profile.evidence
    || profile.doors.length !== CABINET.columns * CABINET.rows || profile.display.cutouts.length) return null;
  const xs = [...new Set(profile.doors.map(door => door.displayRect.x))].sort((a, b) => a - b);
  const ys = [...new Set(profile.doors.map(door => door.displayRect.y))].sort((a, b) => a - b);
  if (xs.length !== CABINET.columns || ys.length !== CABINET.rows) return null;
  const first = profile.doors[0]!.displayRect;
  if (Math.abs(first.width / first.height - CABINET.faceWidth / CABINET.faceHeight) > 0.001) return null;
  const ordered: VaultDoorId[] = [];
  for (const y of ys) for (const x of xs) {
    const matches = profile.doors.filter(door => door.displayRect.x === x && door.displayRect.y === y);
    if (matches.length !== 1 || matches[0]!.displayRect.width !== first.width || matches[0]!.displayRect.height !== first.height) return null;
    ordered.push(matches[0]!.doorId);
  }
  const inventoryIds = new Set(snapshot.doors.map(door => door.doorId));
  if (inventoryIds.size !== ordered.length || snapshot.doors.length !== ordered.length || ordered.some(id => !inventoryIds.has(id))) return null;
  return ordered;
}

export function portraitExperienceAllowed(snapshot: KioskPublicSnapshot, search: string): boolean {
  const experience = new URLSearchParams(search).get("experience");
  if (experience === "portrait" && cinematicPreviewAllowed(snapshot, search)) return true;
  return (experience === null || experience === "portrait") && portraitProfileIds(snapshot) !== null;
}

export function portraitDoors(snapshot: KioskPublicSnapshot, doors: readonly KioskDoor[]): KioskDoor[] {
  if (snapshot.mode === "CERTIFICATION" && snapshot.machineProfile?.provenance === "SYNTHETIC") return cabinetDoors(doors);
  const ids = portraitProfileIds(snapshot);
  if (!ids || doors.length !== ids.length || new Set(doors.map(door => door.doorId)).size !== ids.length) return [];
  const byId = new Map(doors.map(door => [door.doorId, door]));
  return ids.every(id => byId.has(id)) ? ids.map(id => byId.get(id)!) : [];
}

export function portraitRevealIds(snapshot: KioskPublicSnapshot): VaultDoorId[] {
  if (snapshot.machineProfile?.provenance === "SYNTHETIC") return previewRevealIds(snapshot);
  const ids = portraitProfileIds(snapshot), sale = snapshot.activeSale;
  if (!ids || !sale?.authorizationDurable || !["RETRIEVAL", "GROUP_RETRY_AVAILABLE", "GROUP_RETRY_COMMITTED", "GROUP_RETRY_USED", "PAID_RESET_COUNTDOWN"].includes(snapshot.publicState)) return [];
  // This is an authorized collection presentation, not a door-open sensor claim.
  return sale.paidDoorIds.filter(id => ids.includes(id));
}
