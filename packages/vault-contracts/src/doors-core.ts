export const VAULT_COLUMNS = ["X", "K", "I", "N", "G", "S"] as const;
export const VAULT_ROW_COUNT = 25;
export const VAULT_DOOR_COUNT = VAULT_COLUMNS.length * VAULT_ROW_COUNT;
export const VAULT_DOOR_ID_PATTERN = /^(X|K|I|N|G|S)-(0[1-9]|1[0-9]|2[0-5])$/;
/** Defensive parser/resource bound, not a cabinet design or qualified hardware capacity. */
export const VAULT_MAX_PROFILE_DOORS = 256;
export const VAULT_STABLE_DOOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isVaultDoorId(value: unknown): value is VaultDoorId {
  return typeof value === "string" && VAULT_STABLE_DOOR_ID_PATTERN.test(value)
    && !["constructor", "prototype", "__proto__"].includes(value.toLowerCase());
}

declare const vaultDoorBrand: unique symbol;
export type VaultDoorId = string & { readonly [vaultDoorBrand]: "VaultDoorId" };

export interface VaultDoorCoordinate {
  doorId: VaultDoorId;
  column: (typeof VAULT_COLUMNS)[number];
  row: number;
  /** Simulator/default logical channel. A qualified physical map remains G-02 evidence. */
  logicalChannel: number;
}

export function formatDoorId(column: (typeof VAULT_COLUMNS)[number], row: number): VaultDoorId {
  if (!Number.isInteger(row) || row < 1 || row > VAULT_ROW_COUNT) {
    throw new RangeError(`Vault door row must be an integer from 1 through ${VAULT_ROW_COUNT}`);
  }
  return `${column}-${String(row).padStart(2, "0")}` as VaultDoorId;
}

export function parseDoorId(value: string): VaultDoorCoordinate {
  if (!VAULT_DOOR_ID_PATTERN.test(value)) throw new Error("Invalid Vault door ID");
  const doorId = value as VaultDoorId;
  const [column, rowText] = doorId.split("-") as [(typeof VAULT_COLUMNS)[number], string];
  const row = Number(rowText);
  const columnIndex = VAULT_COLUMNS.indexOf(column);
  return { doorId, column, row, logicalChannel: (row - 1) * VAULT_COLUMNS.length + columnIndex + 1 };
}

/** Historical v1 display order only. New profiles supply their own stable IDs and geometry. */
export const VAULT_DOOR_MAP: readonly VaultDoorCoordinate[] = Object.freeze(
  Array.from({ length: VAULT_ROW_COUNT }, (_, rowIndex) =>
    VAULT_COLUMNS.map((column) => {
      const row = rowIndex + 1;
      return Object.freeze({
        doorId: formatDoorId(column, row),
        column,
        row,
        logicalChannel: rowIndex * VAULT_COLUMNS.length + VAULT_COLUMNS.indexOf(column) + 1,
      });
    }),
  ).flat(),
);

export const SIMULATOR_DOOR_MAPPING = Object.freeze(
  VAULT_DOOR_MAP.map(({ doorId, logicalChannel }) => ({ doorId, controllerChannel: logicalChannel })),
);
