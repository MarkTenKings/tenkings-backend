import { z } from "zod";
import { VAULT_DOOR_COUNT, VAULT_DOOR_ID_PATTERN, VAULT_DOOR_MAP, type VaultDoorId } from "./doors-core";

export * from "./doors-core";

export const VaultDoorIdSchema: z.ZodType<VaultDoorId> = z.string().regex(VAULT_DOOR_ID_PATTERN) as unknown as z.ZodType<VaultDoorId>;

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
