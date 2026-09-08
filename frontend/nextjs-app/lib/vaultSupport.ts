import { isVaultDoorId, VAULT_MAX_PROFILE_DOORS } from "@tenkings/vault-contracts/browser";

export interface PublicVaultSupport {
  email: string;
  textNumber: string;
  phoneNumber: string;
  hours: string;
  reference: string | null;
  doorIds: string[];
}

/** Public support accepts presentation context only. It never looks up a sale or treats
 * user-supplied references/door IDs as payment, inventory, or command authority. */
export function publicVaultSupport(
  contacts: { email: string; textNumber: string; phoneNumber: string; hours: string },
  query: { ref?: string | string[]; doors?: string | string[] },
): PublicVaultSupport {
  const reference = typeof query.ref === "string" && /^[A-Z0-9-]{4,24}$/.test(query.ref) ? query.ref : null;
  const requested = typeof query.doors === "string" && query.doors.length <= VAULT_MAX_PROFILE_DOORS * 65 ? query.doors.split(",") : [];
  const doorIds = [...new Set(requested)].filter(isVaultDoorId).slice(0, VAULT_MAX_PROFILE_DOORS);
  return { email: contacts.email, textNumber: contacts.textNumber, phoneNumber: contacts.phoneNumber, hours: contacts.hours, reference, doorIds };
}

export function vaultSupportLinks(support: PublicVaultSupport) {
  const context = [support.reference ? `Vault reference: ${support.reference}` : "Vault support", support.doorIds.length ? `Reported doors: ${support.doorIds.join(", ")}` : ""].filter(Boolean).join("\n");
  return {
    email: `mailto:${support.email}?subject=${encodeURIComponent("Ten Kings Vault support")}&body=${encodeURIComponent(context)}`,
    text: `sms:${support.textNumber}?body=${encodeURIComponent(context)}`,
    call: `tel:${support.phoneNumber}`,
  };
}
