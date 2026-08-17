import { z } from "zod";

export const VAULT_COLUMNS = ["X", "K", "I", "N", "G", "S"] as const;
export const VAULT_ROW_COUNT = 25;
export const VAULT_DOOR_COUNT = VAULT_COLUMNS.length * VAULT_ROW_COUNT;
export const VAULT_DOOR_ID_PATTERN = /^(X|K|I|N|G|S)-(0[1-9]|1[0-9]|2[0-5])$/;

export const VaultDoorIdSchema = z.string().regex(VAULT_DOOR_ID_PATTERN).brand<"VaultDoorId">();
export type VaultDoorId = z.infer<typeof VaultDoorIdSchema>;

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
  return VaultDoorIdSchema.parse(`${column}-${String(row).padStart(2, "0")}`);
}

export function parseDoorId(value: string): VaultDoorCoordinate {
  const doorId = VaultDoorIdSchema.parse(value);
  const [column, rowText] = doorId.split("-") as [(typeof VAULT_COLUMNS)[number], string];
  const row = Number(rowText);
  const columnIndex = VAULT_COLUMNS.indexOf(column);
  return { doorId, column, row, logicalChannel: (row - 1) * VAULT_COLUMNS.length + columnIndex + 1 };
}

/** Canonical physical display order: row 01 X..S, then row 02 X..S, through row 25. */
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

export const VaultDoorMappingSchema = z
  .array(
    z.object({
      doorId: VaultDoorIdSchema,
      controllerChannel: z.number().int().min(1).max(VAULT_DOOR_COUNT),
    }),
  )
  .length(VAULT_DOOR_COUNT)
  .superRefine((mapping, context) => {
    const ids = new Set(mapping.map((entry) => entry.doorId));
    const channels = new Set(mapping.map((entry) => entry.controllerChannel));
    if (ids.size !== VAULT_DOOR_COUNT || VAULT_DOOR_MAP.some(({ doorId }) => !ids.has(doorId))) {
      context.addIssue({ code: "custom", message: "Door mapping must contain every canonical door exactly once" });
    }
    if (channels.size !== VAULT_DOOR_COUNT) {
      context.addIssue({ code: "custom", message: "Controller channels must be unique" });
    }
  });

export const SIMULATOR_DOOR_MAPPING = Object.freeze(
  VAULT_DOOR_MAP.map(({ doorId, logicalChannel }) => ({ doorId, controllerChannel: logicalChannel })),
);
