import type { VaultPublicState } from "../types";

export interface StatusContent {
  eyebrow: string;
  title: string;
  message: string;
  tone: "neutral" | "gold" | "success" | "warning" | "critical";
}

export const PUBLIC_STATES: readonly VaultPublicState[] = [
  "BOOTING", "UPDATING", "NO_VALID_CACHED_CONFIG", "CLOSED", "MAINTENANCE", "ATTRACT",
  "SHOPPING_EMPTY", "SHOPPING_WITH_CART", "PRODUCT_SOLD_OUT", "ALL_PRODUCTS_SOLD_OUT",
  "RESERVATION_CONFLICT", "CHECKOUT_REVALIDATING", "PROVIDER_LIMIT_EXCEEDED",
  "CONTROLLER_NOT_READY", "NAYAX_UNAVAILABLE", "PAYMENT_STARTING", "PAYMENT_PENDING",
  "PAYMENT_DECLINED", "PAYMENT_CANCELLED", "PAYMENT_UNKNOWN", "PAYMENT_APPROVED_DURABLE",
  "UNLOCK_QUEUED", "RETRIEVAL", "GROUP_RETRY_AVAILABLE", "GROUP_RETRY_COMMITTED",
  "GROUP_RETRY_USED", "SUPPORT_REQUIRED", "PAID_RESET_COUNTDOWN", "IDLE_WARNING",
  "RESETTING", "SERVICE_ENTRY", "SERVICE_LOCKED",
];

export const STATUS_CONTENT: Record<VaultPublicState, StatusContent> = {
  BOOTING: { eyebrow: "Starting securely", title: "The Vault is waking up", message: "Please wait while this machine verifies its local state.", tone: "neutral" },
  UPDATING: { eyebrow: "Update in progress", title: "Preparing the latest experience", message: "Shopping will return after the local update is verified.", tone: "neutral" },
  NO_VALID_CACHED_CONFIG: { eyebrow: "Temporarily unavailable", title: "Configuration check required", message: "No valid machine configuration is available. Ten Kings staff have been notified.", tone: "critical" },
  CLOSED: { eyebrow: "Currently closed", title: "The Vault will return soon", message: "Please check the posted location hours.", tone: "neutral" },
  MAINTENANCE: { eyebrow: "Staff service", title: "The Vault is being prepared", message: "Shopping is paused while Ten Kings staff service this machine.", tone: "gold" },
  ATTRACT: { eyebrow: "Ten Kings", title: "Choose your mystery pack", message: "Sports and Pokémon packs. Pick a product, then choose an available gold door.", tone: "gold" },
  SHOPPING_EMPTY: { eyebrow: "Build your cart", title: "Select a gold door", message: "Choose a product, then select any available matching door.", tone: "gold" },
  SHOPPING_WITH_CART: { eyebrow: "Your selection", title: "Add another or check out", message: "Mix products in one cart and pay once when you are ready.", tone: "gold" },
  PRODUCT_SOLD_OUT: { eyebrow: "Product unavailable", title: "That selection is sold out", message: "Choose another product to continue shopping.", tone: "warning" },
  ALL_PRODUCTS_SOLD_OUT: { eyebrow: "Sold out", title: "The Vault is empty for now", message: "Ten Kings staff are preparing the next restock.", tone: "warning" },
  RESERVATION_CONFLICT: { eyebrow: "Cart needs review", title: "A selected door is no longer available", message: "Your other selections are still here. Replace or remove only the marked item.", tone: "warning" },
  CHECKOUT_REVALIDATING: { eyebrow: "Securing your order", title: "Checking doors and totals", message: "Please wait. Do not start another checkout.", tone: "gold" },
  PROVIDER_LIMIT_EXCEEDED: { eyebrow: "Cart limit", title: "This cart is over the payment limit", message: "Remove a marked item, then try checkout again. Your remaining selections stay in the cart.", tone: "warning" },
  CONTROLLER_NOT_READY: { eyebrow: "Temporarily unavailable", title: "Door control is not ready", message: "No payment has started. Please wait for Ten Kings staff.", tone: "critical" },
  NAYAX_UNAVAILABLE: { eyebrow: "Payment unavailable", title: "Checkout is paused", message: "No payment has started. Please try again when the payment terminal is ready.", tone: "warning" },
  PAYMENT_STARTING: { eyebrow: "Starting payment", title: "Follow the payment terminal", message: "Keep this order on screen while the terminal starts.", tone: "gold" },
  PAYMENT_PENDING: { eyebrow: "Payment in progress", title: "Complete payment on the terminal", message: "Please wait for confirmation and do not pay again.", tone: "gold" },
  PAYMENT_DECLINED: { eyebrow: "Payment not approved", title: "No charge was completed", message: "You may return to your cart and choose another payment method on the terminal.", tone: "warning" },
  PAYMENT_CANCELLED: { eyebrow: "Payment cancelled", title: "Your order was not paid", message: "Return to shopping whenever you are ready.", tone: "neutral" },
  PAYMENT_UNKNOWN: { eyebrow: "Checking payment", title: "Do not pay again", message: "We are reconciling the terminal response. Your selected doors remain protected.", tone: "critical" },
  PAYMENT_APPROVED_DURABLE: { eyebrow: "Payment authorized", title: "Your order is secured", message: "The local service is preparing the paid door commands.", tone: "success" },
  UNLOCK_QUEUED: { eyebrow: "Order secured", title: "Doors are unlocking", message: "Unlock commands were queued for the exact doors in your paid order.", tone: "success" },
  RETRIEVAL: { eyebrow: "Collect your order", title: "Take your packs", message: "Use the highlighted paid door numbers below. The software cannot verify physical retrieval.", tone: "success" },
  GROUP_RETRY_AVAILABLE: { eyebrow: "Need another unlock command?", title: "Your paid doors can be retried once", message: "OPEN DOORS sends one second command to every original paid door—never to another door.", tone: "warning" },
  GROUP_RETRY_COMMITTED: { eyebrow: "Retry recorded", title: "Doors are unlocking again", message: "A second command was committed for every original paid door. This action cannot be repeated.", tone: "gold" },
  GROUP_RETRY_USED: { eyebrow: "Retry used", title: "Collect your packs", message: "The one paid-door retry has been used. Contact Ten Kings support if you still need help.", tone: "warning" },
  SUPPORT_REQUIRED: { eyebrow: "Ten Kings support", title: "We are here to help", message: "Use your short support reference and paid door numbers. Do not share payment details.", tone: "critical" },
  PAID_RESET_COUNTDOWN: { eyebrow: "Order complete", title: "This screen will reset", message: "Your payment and order records remain safely stored after the display clears.", tone: "success" },
  IDLE_WARNING: { eyebrow: "Still shopping?", title: "Touch to keep this cart", message: "Only an unpaid shopping session can time out. Payment and recovery screens never do.", tone: "warning" },
  RESETTING: { eyebrow: "Thank you", title: "Preparing for the next guest", message: "Please wait for the welcome screen.", tone: "neutral" },
  SERVICE_ENTRY: { eyebrow: "Staff access", title: "Individual PIN required", message: "Every service action is role-scoped and audited.", tone: "gold" },
  SERVICE_LOCKED: { eyebrow: "Service locked", title: "Customer checkout is paused", message: "Authorized Ten Kings staff must safely exit service mode.", tone: "critical" },
};

export function statusContent(state: VaultPublicState): StatusContent {
  return STATUS_CONTENT[state];
}

export function assertSafeNoSensorLanguage(content: string): boolean {
  return !/\b(opened|dispensed|delivered|received)\b/i.test(content);
}
