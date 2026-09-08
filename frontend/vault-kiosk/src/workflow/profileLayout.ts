import { VAULT_DOOR_MAP, type VaultMachineProfile } from "@tenkings/vault-contracts/browser";
import type { VaultDoorId } from "../types";

export interface DisplayDoorIdentity { doorId: VaultDoorId; label: string }

/** Legacy geometry is selected only by its explicit schema version. */
export function displayDoorIdentities(schemaVersion: 1 | 2 | null | undefined, profile?: VaultMachineProfile | null): readonly DisplayDoorIdentity[] {
  if (schemaVersion === 1) return VAULT_DOOR_MAP.map(({ doorId }) => ({ doorId, label: doorId }));
  return schemaVersion === 2 && profile ? profile.doors : [];
}

export function currentDoorLabel(doorId: VaultDoorId, schemaVersion: 1 | 2 | null, profile: VaultMachineProfile | null): string {
  return displayDoorIdentities(schemaVersion, profile).find((door) => door.doorId === doorId)?.label ?? doorId;
}

/** Resolve explicit operator text; never uppercase or infer an ID from its position. */
export function resolveObservedDoors(input: string, identities: readonly DisplayDoorIdentity[]): VaultDoorId[] | null {
  if (!input.trim()) return [];
  const ids: VaultDoorId[] = [];
  for (const token of input.split(",").map((part) => part.trim())) {
    if (!token) return null;
    const candidates = identities.filter((door) => door.doorId === token || door.label === token);
    if (candidates.length !== 1 || ids.includes(candidates[0].doorId)) return null;
    ids.push(candidates[0].doorId);
  }
  return ids;
}

/** Uniform scaling preserves positions, proportions and cutouts, including narrow doors. */
export function profileCanvasSize(profile: VaultMachineProfile, availableWidth: number) {
  const minimumScale = Math.max(...profile.doors.map((door) => {
    const characters = Array.from(door.label).length;
    const labelWidth = Math.max(48, Math.min(characters, 16) * 12 + 12);
    const labelHeight = Math.max(48, Math.ceil(characters / 16) * 18 + 18);
    return Math.max(labelWidth / door.displayRect.width, labelHeight / door.displayRect.height);
  }));
  const width = Math.max(availableWidth, profile.display.width * minimumScale);
  return { width, height: width * profile.display.height / profile.display.width };
}
