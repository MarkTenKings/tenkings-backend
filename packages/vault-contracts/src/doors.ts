import { z } from "zod";
import { isVaultDoorId, VAULT_DOOR_COUNT, VAULT_DOOR_MAP, VAULT_MAX_PROFILE_DOORS, type VaultDoorId } from "./doors-core";

export * from "./doors-core";

export const VaultDoorIdSchema: z.ZodType<VaultDoorId> = z.string().refine(isVaultDoorId, "Invalid stable Vault door ID") as unknown as z.ZodType<VaultDoorId>;

export const LegacyVaultDoorMappingSchema = z
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

/** Mapping is supplied explicitly; display order and labels never determine addresses. */
export const VaultDoorMappingSchema = z.array(z.object({
  doorId: VaultDoorIdSchema,
  controllerEndpointId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/).optional(),
  controllerChannel: z.number().int().min(1).max(VAULT_MAX_PROFILE_DOORS),
}).strict()).min(1).max(VAULT_MAX_PROFILE_DOORS).superRefine((mapping, context) => {
  const ids = new Set(mapping.map((entry) => entry.doorId));
  const addresses = new Set(mapping.map((entry) => `${entry.controllerEndpointId ?? "legacy"}:${entry.controllerChannel}`));
  if (ids.size !== mapping.length) context.addIssue({ code: "custom", message: "Door mapping IDs must be unique" });
  if (addresses.size !== mapping.length) context.addIssue({ code: "custom", message: "Controller endpoint/channel pairs must be unique" });
});
