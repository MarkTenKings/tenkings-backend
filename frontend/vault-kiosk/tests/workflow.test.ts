import { describe, expect, it } from "vitest";
import { calculateCartTotals, createSupportUrl, mayIdleTimeout, mayShowOpenDoors, preserveCartConflicts, providerLimitViolation, staffOperationsForRole, VIEWPORT_TEST_CASES } from "../src/workflow/kioskWorkflow";
import { assertSafeNoSensorLanguage, PUBLIC_STATES, statusContent } from "../src/workflow/statusContent";
import { sale, snapshot } from "./fixtures";

describe("public workflow language", () => {
  it("defines safe visible copy for every public state", () => {
    expect(PUBLIC_STATES).toHaveLength(32);
    for (const state of PUBLIC_STATES) {
      const content = statusContent(state);
      expect(content.title.length).toBeGreaterThan(2);
      expect(assertSafeNoSensorLanguage(`${content.title} ${content.message}`), state).toBe(true);
    }
  });

  it("never idle-times out payment, recovery, retrieval, support, or staff state", () => {
    expect(mayIdleTimeout("SHOPPING_WITH_CART")).toBe(true);
    expect(mayIdleTimeout("IDLE_WARNING")).toBe(true);
    for (const state of ["PAYMENT_PENDING", "PAYMENT_UNKNOWN", "RETRIEVAL", "GROUP_RETRY_AVAILABLE", "SUPPORT_REQUIRED", "SERVICE_LOCKED"] as const) {
      expect(mayIdleTimeout(state), state).toBe(false);
    }
  });
});

describe("cart, tax, conflict, and provider limits", () => {
  const cart = [
    { doorId: "X-01" as never, productId: "a", productName: "Sports", priceCents: 2500 },
    { doorId: "K-01" as never, productId: "b", productName: "Pokémon", priceCents: 5000 },
  ];

  it("shows the shared half-up subtotal basis-point result", () => {
    expect(calculateCartTotals(cart, 825)).toEqual({ subtotalCents: 7500, taxCents: 619, totalCents: 8119 });
    expect(calculateCartTotals(cart, null)).toEqual({ subtotalCents: 7500, taxCents: null, totalCents: null });
  });

  it("preserves valid cart lines and marks exact conflicts", () => {
    const result = preserveCartConflicts(cart, ["K-01"]);
    expect(result).toHaveLength(2);
    expect(result[0].conflict).toBe(false);
    expect(result[1].conflict).toBe(true);
  });

  it("blocks item and total limits without splitting a charge", () => {
    expect(providerLimitViolation(cart, 8119, { maxItems: 1, maxTotalCents: 50000 })).toBe("ITEM_LIMIT");
    expect(providerLimitViolation(cart, 8119, { maxItems: 5, maxTotalCents: 8000 })).toBe("TOTAL_LIMIT");
    expect(providerLimitViolation(cart, 8119, { maxItems: 5, maxTotalCents: 9000 })).toBeNull();
  });
});

describe("retry, support, roles, and scaling contracts", () => {
  it("offers OPEN DOORS only once in the exact eligible state", () => {
    expect(mayShowOpenDoors("GROUP_RETRY_AVAILABLE", sale)).toBe(true);
    expect(mayShowOpenDoors("PAID_RESET_COUNTDOWN", { ...sale, resetSecondsRemaining: 24 })).toBe(true);
    expect(mayShowOpenDoors("RETRIEVAL", sale)).toBe(false);
    expect(mayShowOpenDoors("GROUP_RETRY_AVAILABLE", { ...sale, retryUsed: true })).toBe(false);
  });

  it("builds a QR-safe support link from only the opaque reference and paid doors", () => {
    const state = snapshot();
    const url = new URL(createSupportUrl(state.support!, sale.supportReference, sale.paidDoorIds));
    expect(url.searchParams.get("ref")).toBe("A1B2C3");
    expect(url.searchParams.get("doors")).toBe("X-01");
    expect(url.search).not.toMatch(/provider|payment|user|phone/i);
  });

  it("keeps staff operations role-scoped", () => {
    expect(staffOperationsForRole("RESTOCKER").map((item) => item.permission)).toEqual(["RESTOCK_RUN"]);
    expect(staffOperationsForRole("TECHNICIAN").some((item) => item.permission === "CERTIFICATION_COLLECT")).toBe(true);
    expect(staffOperationsForRole("TECHNICIAN").some((item) => item.permission === "FINANCIAL_RESOLVE")).toBe(false);
    expect(staffOperationsForRole("ADMIN").some((item) => item.permission === "ENROLLMENT_MANAGE")).toBe(true);
  });

  it("declares the required viewport and Windows scaling proxies", () => {
    expect(VIEWPORT_TEST_CASES[0]).toEqual({ width: 720, height: 1280, scale: 1 });
    expect(VIEWPORT_TEST_CASES.at(-1)).toEqual({ width: 1080, height: 1920, scale: 1 });
    expect(VIEWPORT_TEST_CASES.map((item) => item.scale)).toContain(1.25);
    expect(VIEWPORT_TEST_CASES.map((item) => item.scale)).toContain(1.5);
  });
});
