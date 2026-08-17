import { describe, expect, it } from "vitest";
import {
  checkoutFingerprint,
  checkoutIdempotencyKey,
  clearCheckoutIdempotencyKey,
  clearPaymentIdempotencyKey,
  paymentIdempotencyKey,
} from "../src/workflow/durableIntents";
import { MemoryStorage } from "./memoryStorage";

describe("durable browser intent metadata", () => {
  it("reuses the exact checkout idempotency key after a lost response and full reload", () => {
    const localStorage = new MemoryStorage();
    const fingerprint = checkoutFingerprint(3, "PRODUCTION", ["K-01", "X-01"] as never[]);
    const first = checkoutIdempotencyKey(fingerprint, localStorage, () => "11111111-1111-4111-8111-111111111111");
    const afterReload = checkoutIdempotencyKey(
      checkoutFingerprint(3, "PRODUCTION", ["X-01", "K-01"] as never[]),
      localStorage,
      () => "22222222-2222-4222-8222-222222222222",
    );
    expect(afterReload).toBe(first);
    expect(localStorage.getItem("ten-kings-vault:checkout-intent-v1")).toContain(first);
  });

  it("rotates checkout intent for different content and removes it only on explicit completion", () => {
    const localStorage = new MemoryStorage();
    const first = checkoutIdempotencyKey(checkoutFingerprint(3, "PRODUCTION", ["X-01"] as never[]), localStorage, () => "11111111-1111-4111-8111-111111111111");
    const changed = checkoutIdempotencyKey(checkoutFingerprint(3, "PRODUCTION", ["K-01"] as never[]), localStorage, () => "22222222-2222-4222-8222-222222222222");
    expect(changed).not.toBe(first);
    clearCheckoutIdempotencyKey(localStorage);
    expect(localStorage.getItem("ten-kings-vault:checkout-intent-v1")).toBeNull();
  });

  it("persists one payment key per durable sale and supports terminal cleanup", () => {
    const localStorage = new MemoryStorage();
    const saleId = "sale-1";
    const first = paymentIdempotencyKey(saleId, localStorage, () => "33333333-3333-4333-8333-333333333333");
    expect(paymentIdempotencyKey(saleId, localStorage, () => "44444444-4444-4444-8444-444444444444")).toBe(first);
    clearPaymentIdempotencyKey(saleId, localStorage);
    expect(paymentIdempotencyKey(saleId, localStorage, () => "44444444-4444-4444-8444-444444444444")).not.toBe(first);
  });
});
