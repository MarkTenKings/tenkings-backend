import { VAULT_DOOR_MAP } from "@tenkings/vault-contracts/browser";
import type { KioskDoor, KioskPublicSnapshot, KioskSaleSummary } from "../src/types";

export const products = [
  { id: "sports-25", name: "Sports Mystery Pack", description: "Mystery sports pack", photoUrl: "https://example.test/sports.jpg", priceCents: 2500 as const, category: "SPORTS" as const, active: true },
  { id: "pokemon-50", name: "Pokémon Mystery Pack", description: "Mystery Pokémon pack", photoUrl: "https://example.test/pokemon.jpg", priceCents: 5000 as const, category: "POKEMON" as const, active: true },
];

export const doors: KioskDoor[] = VAULT_DOOR_MAP.map(({ doorId }, index) => ({
  doorId,
  state: index < 6 ? "AVAILABLE" : index === 6 ? "SERVICE_HOLD" : "EMPTY",
  productId: index < 3 ? "sports-25" : index < 6 ? "pokemon-50" : null,
  selected: index === 0,
}));

export const sale: KioskSaleSummary = {
  saleId: "11111111-1111-4111-8111-111111111111",
  supportReference: "A1B2C3",
  items: [{
    lineId: "22222222-2222-4222-8222-222222222222", doorId: doors[0].doorId, productId: "sports-25",
    productName: "Sports Mystery Pack", photoUrl: "https://example.test/sports.jpg", description: "Mystery sports pack",
    category: "SPORTS", priceCents: 2500, taxClass: "GENERAL",
  }],
  subtotalCents: 2500,
  taxCents: 206,
  totalCents: 2706,
  paidDoorIds: [doors[0].doorId],
  retryAvailable: true,
  retryUsed: false,
  state: "OPEN_COMMAND_TERMINAL",
  paymentState: "VEND_RESULT_PENDING",
  retrievalSecondsRemaining: 24,
  resetSecondsRemaining: null,
};

export function snapshot(overrides: Partial<KioskPublicSnapshot> = {}): KioskPublicSnapshot {
  return {
    stateVersion: "state-7",
    sequence: 7,
    mode: "PRODUCTION",
    publicState: "SHOPPING_WITH_CART",
    health: "READY",
    readinessReasons: [],
    serviceLocked: false,
    configVersion: 3,
    city: "Los Angeles",
    state: "CA",
    taxRateBasisPoints: 825,
    products,
    doors,
    cart: [{ doorId: doors[0].doorId, productId: "sports-25", productName: "Sports Mystery Pack", priceCents: 2500 }],
    providerLimits: { maxItems: 10, maxTotalCents: 50000 },
    support: { pageUrl: "https://support.tenkings.test/help", email: "help@tenkings.test", textNumber: "+15555550100", phoneNumber: "+15555550101", hours: "Daily 9am–5pm PT" },
    activeSale: null,
    idleSecondsRemaining: null,
    buildIdentity: { sourceCommit: "abcdef1234567", appVersion: "1.0.0-test" },
    reservationConflictDoorIds: [],
    preservedDoorIds: [],
    ...overrides,
  };
}
