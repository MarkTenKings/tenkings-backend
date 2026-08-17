import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CartPanel } from "../src/components/CartPanel";
import { DoorMap } from "../src/components/DoorMap";
import { PaidFlow } from "../src/components/PaidFlow";
import { PinEntry } from "../src/components/PinEntry";
import { ProductRail } from "../src/components/ProductRail";
import { StatusBanner } from "../src/components/StatusBanner";
import { doors, products, sale, snapshot } from "./fixtures";
import { click, renderReact } from "./render";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,dGVzdA==") } }));

afterEach(() => {
  document.body.replaceChildren();
});

describe("customer touchscreen components", () => {
  it("renders all 150 physical positions in fixed row-major order and retains unavailable cells", () => {
    const view = renderReact(
      <DoorMap doors={doors} selectedProductId="sports-25" disabled={false} animatedDoorId={null} onToggle={() => undefined} />,
    );
    const cells = [...view.container.querySelectorAll<HTMLElement>("[data-door-id]")];
    expect(cells).toHaveLength(150);
    expect(cells.slice(0, 7).map((cell) => cell.dataset.doorId)).toEqual(["X-01", "K-01", "I-01", "N-01", "G-01", "S-01", "X-02"]);
    expect(cells.at(-1)?.dataset.doorId).toBe("S-25");
    expect((view.container.querySelector('[data-door-id="X-02"]') as HTMLButtonElement).disabled).toBe(true);
    expect(view.container.querySelectorAll('[role="columnheader"]')).toHaveLength(6);
    view.unmount();
  });

  it("offers configured products, counts matching available doors, and delegates secure pick", async () => {
    const onPick = vi.fn();
    const view = renderReact(
      <ProductRail products={products} doors={doors} selectedProductId="sports-25" disabled={false} onSelect={() => undefined} onPick={onPick} pickBusy={false} />,
    );
    expect(view.container.textContent).toContain("3 available");
    expect(view.container.textContent).toContain("$25.00");
    await click(view.container.querySelector('[aria-label="Pick an available Sports Mystery Pack door for me"]'));
    expect(onPick).toHaveBeenCalledWith("sports-25");
    view.unmount();
  });

  it("renders mixed-cart tax and prevents checkout on exact conflict or provider limit", () => {
    const cart = [
      { doorId: doors[0].doorId, productId: "sports-25", productName: "Sports Mystery Pack", priceCents: 2500 },
      { doorId: doors[3].doorId, productId: "pokemon-50", productName: "Pokémon Mystery Pack", priceCents: 5000, conflict: true },
    ];
    const view = renderReact(
      <CartPanel cart={cart} subtotalCents={7500} taxCents={619} totalCents={8119} taxLabel="Tax · Los Angeles, CA" providerViolation="ITEM_LIMIT" disabled={false} busy={false} onRemove={() => undefined} onCheckout={() => undefined} />,
    );
    expect(view.container.textContent).toContain("$75.00");
    expect(view.container.textContent).toContain("$6.19");
    expect(view.container.textContent).toContain("$81.19");
    expect(view.container.textContent).toContain("Replace this door");
    expect((view.container.querySelector(".checkout-action") as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
  });

  it("renders the exact one-time OPEN DOORS group retry and removes it after use", () => {
    const onRetry = vi.fn();
    const eligible = snapshot({ publicState: "PAID_RESET_COUNTDOWN", activeSale: { ...sale, resetSecondsRemaining: 24 } });
    const view = renderReact(<PaidFlow snapshot={eligible} retryBusy={false} paymentBusy={false} doneBusy={false} onContinuePayment={() => undefined} onOpenDoors={onRetry} onDone={() => undefined} />);
    const retry = view.container.querySelector(".retry-action");
    expect(retry?.textContent).toBe("OPEN DOORS");
    expect(view.container.textContent).toContain("every original paid door");
    view.rerender(<PaidFlow snapshot={{ ...eligible, activeSale: { ...sale, retryAvailable: false, retryUsed: true, resetSecondsRemaining: 24 } }} retryBusy={false} paymentBusy={false} doneBusy={false} onContinuePayment={() => undefined} onOpenDoors={onRetry} onDone={() => undefined} />);
    expect(view.container.querySelector(".retry-action")).toBeNull();
    expect(view.container.textContent).toContain("Email");
    expect(view.container.textContent).toContain("Text message");
    expect(view.container.textContent).toContain("Phone call");
    expect(view.container.textContent).toContain("A1B2C3");
    view.unmount();
  });

  it("renders payment unknown with explicit do-not-pay-again language", () => {
    const view = renderReact(<StatusBanner state="PAYMENT_UNKNOWN" />);
    expect(view.container.textContent).toContain("Do not pay again");
    expect(view.container.textContent).toContain("remain protected");
    view.unmount();
  });

  it("never labels pending or unknown payment doors as paid", () => {
    for (const [publicState, paymentState] of [["PAYMENT_PENDING", "REQUESTED"], ["PAYMENT_UNKNOWN", "UNKNOWN"]] as const) {
      const unresolvedSale = { ...sale, state: publicState === "PAYMENT_PENDING" ? "PAYMENT_REQUESTED" as const : "PAYMENT_UNKNOWN" as const, paymentState };
      const view = renderReact(<PaidFlow snapshot={snapshot({ publicState, activeSale: unresolvedSale })} retryBusy={false} paymentBusy={false} doneBusy={false} onContinuePayment={() => undefined} onOpenDoors={() => undefined} onDone={() => undefined} />);
      expect(view.container.textContent).toContain("not proof of payment");
      expect(view.container.textContent).not.toContain("Paid total");
      expect(view.container.textContent).not.toContain("Your exact paid doors");
      view.unmount();
    }
  });

  it("keeps both declined and cancelled orders out of paid-door UI and offers an explicit safe return", async () => {
    for (const publicState of ["PAYMENT_DECLINED", "PAYMENT_CANCELLED"] as const) {
      const onDone = vi.fn();
      const terminalSale = {
        ...sale,
        state: publicState,
        paymentState: publicState === "PAYMENT_DECLINED" ? "DECLINED" as const : "CANCELLED" as const,
        paidDoorIds: [],
      };
      const view = renderReact(<PaidFlow snapshot={snapshot({ publicState, activeSale: terminalSale })} retryBusy={false} paymentBusy={false} doneBusy={false} onContinuePayment={() => undefined} onOpenDoors={() => undefined} onDone={onDone} />);
      expect(view.container.textContent).toContain(publicState === "PAYMENT_DECLINED" ? "No charge was completed" : "Your order was not paid");
      expect(view.container.textContent).not.toContain("Your exact paid doors");
      await click(view.container.querySelector(".return-shopping-action"));
      expect(onDone).toHaveBeenCalledTimes(1);
      view.unmount();
    }
  });

  it("requires a six-digit PIN before staff authentication", async () => {
    const authenticate = vi.fn(async () => undefined);
    const view = renderReact(<PinEntry busy={false} error={null} onAuthenticate={authenticate} onCancel={() => undefined} />);
    const user = view.container.querySelector('input[autocomplete="username"]') as HTMLInputElement;
    const pin = view.container.querySelector('input[inputmode="numeric"]') as HTMLInputElement;
    const submit = view.container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    act(() => {
      user.value = "restocker-1";
      user.dispatchEvent(new Event("input", { bubbles: true }));
      pin.value = "123456";
      pin.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(pin.maxLength).toBe(6);
    expect(pin.type).toBe("password");
    view.unmount();
  });
});
