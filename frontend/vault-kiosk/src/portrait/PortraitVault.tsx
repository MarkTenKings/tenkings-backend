import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Props as VaultProps } from "../cinematic/CinematicVault";
import type { KioskDoor } from "../types";
import { currentDoorLabel } from "../workflow/profileLayout";
import { formatMoney } from "../workflow/kioskWorkflow";
import { type SceneMetrics } from "../cinematic/experience";
import { PortraitWorld } from "./PortraitWorld";
import { ProductShelf } from "./ProductShelf";
import {
  CABINET,
  cabinetHeightForPitch,
  rowPitchForWidth,
  doorPosition,
  rowOf,
} from "./layout";
import "./portrait.css";
import { portraitDoors, portraitRevealIds } from "./profile";

export default function PortraitVault(p: VaultProps) {
  const productView = useRef<HTMLDivElement>(null),
    doorView = useRef<HTMLDivElement>(null),
    scrollView = useRef<HTMLDivElement>(null),
    reviewRef = useRef<HTMLDialogElement>(null),
    audio = useRef<AudioContext | null>(null);
  const initialized = useRef(false);
  const [rowPitch, setRowPitch] = useState<number>(CABINET.pitchY);
  const cabinetHeight = cabinetHeightForPitch(rowPitch);
  const [review, setReview] = useState(false),
    [settings, setSettings] = useState(false),
    [sound, setSound] = useState(false),
    [light, setLight] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [focused, setFocused] = useState<string | null>(null),
    [metrics, setMetrics] = useState<SceneMetrics | null>(null),
    [visibleRows, setVisibleRows] = useState([0, 5]);
  const synthetic = p.snapshot.machineProfile?.provenance === "SYNTHETIC";
  const doors = portraitDoors(p.snapshot, p.doors),
    sale = p.snapshot.activeSale,
    revealIds = portraitRevealIds(p.snapshot);
  const product = p.snapshot.products.find(
    (item) => item.id === p.selectedProductId,
  );
  const pokemon = product?.category === "POKEMON";
  const matching = doors.filter(
    (d) =>
      d.productId === p.selectedProductId &&
      (d.state === "AVAILABLE" || d.selected),
  );
  const label = (d: KioskDoor) =>
    sale?.items.find((item) => item.doorId === d.doorId)?.doorLabel ??
    currentDoorLabel(
      d.doorId,
      p.snapshot.configSchemaVersion,
      p.snapshot.machineProfile,
    );
  const canCheckout =
    !p.disabled &&
    p.cart.length > 0 &&
    !p.cart.some((l) => l.conflict) &&
    !p.violation &&
    p.total !== null;
  const totalLabel = p.total === null ? "—" : formatMoney(p.total);
  const jump = (row: number, instant = false) => {
    const scroll = scrollView.current;
    if (!scroll) return;
    const scale = scroll.clientWidth / CABINET.width;
    scroll.scrollTo({
      top: Math.max(
        0,
        row * rowPitchForWidth(scroll.clientWidth) * scale - scale * 0.35,
      ),
      behavior: reducedMotion || instant ? "instant" : "smooth",
    });
  };
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (!p.cart.length && !sale) {
      const first = p.snapshot.products.find(
        (item) =>
          item.active &&
          item.category === "POKEMON" &&
          item.priceCents === 10000,
      );
      if (first) p.onProduct(first.id);
    }
  }, []);
  useEffect(() => {
    const index = doors.findIndex((d) =>
      sale
        ? sale.items.some((item) => item.doorId === d.doorId)
        : d.productId === p.selectedProductId &&
          (d.state === "AVAILABLE" || d.selected),
    );
    if (index >= 0) jump(Math.max(0, rowOf(index) - 1));
    setFocused(null);
  }, [p.selectedProductId, sale?.saleId]);
  useEffect(() => {
    if (
      sale ||
      p.cart.length === 0 ||
      p.snapshot.publicState === "IDLE_WARNING"
    )
      setReview(false);
  }, [sale?.saleId, p.cart.length, p.snapshot.publicState]);
  useEffect(() => {
    if (review && !sale) reviewRef.current?.showModal();
    else reviewRef.current?.close();
  }, [review, Boolean(sale)]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  useEffect(() => {
    const el = scrollView.current;
    if (!el) return;
    const measure = () => {
      const logicalPitch = rowPitchForWidth(el.clientWidth);
      setRowPitch(logicalPitch);
      const pitch = (el.clientWidth / CABINET.width) * logicalPitch;
      setVisibleRows([
        Math.floor(el.scrollTop / pitch),
        Math.min(16, Math.floor((el.scrollTop + el.clientHeight) / pitch)),
      ]);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, []);
  function chime() {
    if (!sound) return;
    try {
      const ctx = audio.current ?? new AudioContext();
      audio.current = ctx;
      void ctx.resume();
      const g = ctx.createGain();
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.045, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(640, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + 0.1);
      o.connect(g);
      o.start();
      o.stop(ctx.currentTime + 0.17);
    } catch {}
  }
  function select(d: KioskDoor) {
    setFocused(d.doorId);
    chime();
    p.onDoor(d);
  }
  const remove = (id: string) => {
    const d = p.doors.find((item) => item.doorId === id);
    if (d) select(d);
  };
  const nextMatching = () => {
    const indices = doors.flatMap((d, i) =>
      matching.some((m) => m.doorId === d.doorId) ? [i] : [],
    );
    const next =
      indices.find((i) => rowOf(i) > visibleRows[0] + 1) ?? indices[0];
    if (next !== undefined) jump(Math.max(0, rowOf(next) - 1));
    chime();
  };
  return (
    <main className="portrait-page customer-shopping">
      <div
        className={`portrait-frame ${!sale ? "portrait-shopping" : ""}`}
        data-experience="portrait"
      >
        <PortraitWorld
          productView={productView}
          doorView={doorView}
          scrollView={scrollView}
          doors={doors}
          categories={Object.fromEntries(
            doors.map((d) => [
              d.doorId,
              sale?.items.find((item) => item.doorId === d.doorId)?.category ??
                p.snapshot.products.find((item) => item.id === d.productId)
                  ?.category,
            ]),
          )}
          productId={p.selectedProductId}
          pokemon={pokemon}
          shopping={!sale}
          revealIds={revealIds}
          focused={focused}
          reducedMotion={reducedMotion}
          light={light}
          onMetrics={setMetrics}
        />
        <section className="portrait-top" aria-label="Discover products">
          <header className="portrait-header">
            <div className="portrait-brand">
              <img
                src="./art/vault/ten-kings-logo.png"
                alt="Ten Kings Collectibles"
              />
              <span className="portrait-vault-title">THE VAULT</span>
            </div>
            <div className="portrait-tools">
              <button
                onClick={() => setSettings(!settings)}
                aria-label="Experience settings"
              >
                ☷
              </button>
            </div>
            <button
              className="portrait-service"
              aria-label="Service access"
              onClick={p.onService}
            />
          </header>
          {!sale && (
            <ProductShelf
              products={p.snapshot.products}
              selectedId={p.selectedProductId}
              disabled={p.disabled}
              reducedMotion={reducedMotion}
              onSelect={(id) => {
                p.onProduct(id);
                chime();
              }}
            />
          )}
          {sale && (
            <div
              className="portrait-sale portrait-payment-panel"
              data-state={p.snapshot.publicState}
              aria-label="Payment and collection"
            >
              <span className="portrait-kicker">
                03 / {revealIds.length ? "YOUR NEXT DISCOVERY" : "YOUR ORDER"}
              </span>
              {revealIds.length > 0 && (
                <h2 className="portrait-paid-title">It's yours.</h2>
              )}
              {p.paidFlow}
              {synthetic && <p className="portrait-simulation-note">
                Preview animation · No physical door is connected.
              </p>}
            </div>
          )}
        </section>
        <section className="portrait-bottom" aria-label="Choose a vault door">
          <div className="portrait-door-heading">
            <div>
              {sale && <span className="portrait-kicker">02 / YOUR DOORS</span>}
              <h2>
                {sale
                  ? revealIds.length
                    ? "Your collection awaits."
                    : ["PAYMENT_DECLINED", "PAYMENT_CANCELLED"].includes(
                          p.snapshot.publicState,
                        )
                      ? "Order not completed."
                      : "Your order’s doors."
                  : "Choose your door."}
              </h2>
            </div>
            <span className="portrait-match-count">
              <i />
              {sale ? sale.items.length : matching.length}{" "}
              {sale ? (revealIds.length ? "paid" : "in order") : "matching"}
            </span>
          </div>
          <div className="portrait-cabinet-toolbar">
            <p>
              <i className="key-gold" /> Matching <i className="key-selected" />{" "}
              Selected <i className="key-grey" /> Inactive
            </p>
          </div>
          <div className="portrait-cabinet">
            <div className="portrait-door-viewport" ref={doorView}>
              <div
                className="portrait-door-scroll"
                ref={scrollView}
                aria-label="Vault doors, scroll to explore all 17 rows"
                tabIndex={0}
              >
                <div
                  className="portrait-door-content"
                  style={{ aspectRatio: `${CABINET.width} / ${cabinetHeight}` }}
                >
                  {doors.map((d, i) => {
                    const pos = doorPosition(i, rowPitch),
                      paid = revealIds.includes(d.doorId),
                      match =
                        !sale &&
                        d.productId === p.selectedProductId &&
                        d.state === "AVAILABLE";
                    const disabled =
                        p.disabled || Boolean(sale) || (!d.selected && !match),
                      state = paid
                        ? "collect"
                        : d.conflict
                          ? "replace"
                          : d.selected
                            ? "selected"
                            : match
                              ? "available"
                              : d.state === "AVAILABLE"
                                ? "other pack"
                                : "unavailable";
                    const css = {
                      left: `${(pos.x / CABINET.width) * 100}%`,
                      top: `${(pos.y / cabinetHeight) * 100}%`,
                      width: `${(6 / CABINET.width) * 100}%`,
                      height: `${(2.5 / cabinetHeight) * 100}%`,
                    } as CSSProperties;
                    return (
                      <button
                        key={d.doorId}
                        className={`portrait-door ${match ? "is-matching" : ""} ${d.selected ? "is-selected" : ""} ${paid ? "is-paid" : ""} ${d.conflict ? "is-conflict" : ""}`}
                        style={css}
                        data-door-id={d.doorId}
                        data-state={state}
                        data-row={rowOf(i) + 1}
                        disabled={disabled}
                        aria-pressed={d.selected || paid}
                        aria-label={`Door ${label(d)}, ${state}`}
                        onClick={() => select(d)}
                        onPointerEnter={() => setFocused(d.doorId)}
                        onPointerLeave={() => setFocused(null)}
                        onPointerDown={() => setFocused(d.doorId)}
                        onFocus={() => setFocused(d.doorId)}
                        onBlur={() => setFocused(null)}
                      >
                        <strong>{label(d)}</strong>
                        <span>
                          {paid
                            ? "COLLECT ↗"
                            : d.selected
                              ? "✓ SELECTED"
                              : d.conflict
                                ? "REPLACE"
                                : match
                                  ? "SELECT"
                                  : state === "other pack"
                                    ? "OTHER PACK"
                                    : "UNAVAILABLE"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {matching.length === 0 && !sale && (
                <div className="portrait-sold-out" role="status">
                  This tier is sold out.
                  <span>Choose another price to explore.</span>
                </div>
              )}
            </div>
            <aside
              className="portrait-minimap"
              aria-label="Cabinet row navigation"
            >
              <span>MAP</span>
              <div className="portrait-mini-rows">
                {Array.from({ length: 17 }, (_, row) => (
                  <button
                    key={row}
                    className={
                      row >= visibleRows[0] && row <= visibleRows[1]
                        ? "in-view"
                        : ""
                    }
                    aria-label={`Go to row ${row + 1}`}
                    onClick={() => jump(row)}
                  >
                    <b>{String(row + 1).padStart(2, "0")}</b>
                    {doors.slice(row * 4, row * 4 + 4).map((d) => (
                      <i
                        key={d.doorId}
                        className={
                          revealIds.includes(d.doorId) || d.selected
                            ? "chosen"
                            : !sale &&
                                d.productId === p.selectedProductId &&
                                d.state === "AVAILABLE"
                              ? "match"
                              : ""
                        }
                      />
                    ))}
                  </button>
                ))}
              </div>
              <span>↕</span>
            </aside>
          </div>
          <div className="portrait-row-navigation">
            <span>
              ROWS {String(visibleRows[0] + 1).padStart(2, "0")}—
              {String(visibleRows[1] + 1).padStart(2, "0")} <i>/ 17</i>
            </span>
            <span className="portrait-swipe-hint">↕ Swipe to explore</span>
            <button
              disabled={!matching.length || Boolean(sale)}
              onClick={nextMatching}
            >
              Next matching ↓
            </button>
          </div>
          {!sale ? (
            <footer className="portrait-checkout">
              <div className="portrait-selection" aria-live="polite">
                <span className="portrait-kicker">YOUR SELECTION</span>
                <div>
                  {p.cart.length ? (
                    p.cart.map((line) => (
                      <button
                        key={line.doorId}
                        disabled={p.disabled}
                        onClick={() => remove(line.doorId)}
                        aria-label={`Remove door ${line.doorLabel ?? line.doorId}`}
                        className={line.conflict ? "is-conflict" : ""}
                      >
                        {line.doorLabel ?? line.doorId}
                        <span>{line.conflict ? "REPLACE" : "×"}</span>
                      </button>
                    ))
                  ) : (
                    <p>Tap a gold door to make it yours.</p>
                  )}
                </div>
              </div>
              <div className="portrait-checkout-row">
                <div>
                  <span>
                    {p.cart.length} {p.cart.length === 1 ? "pack" : "packs"} ·
                    total with tax
                  </span>
                  <strong>{totalLabel}</strong>
                </div>
                <button
                  className="portrait-primary"
                  disabled={!canCheckout}
                  onClick={() => {
                    setReview(true);
                    chime();
                  }}
                >
                  Review order <span>↗</span>
                </button>
              </div>
            </footer>
          ) : (
            <div className="portrait-collection-hud">
              <span className="portrait-kicker">
                {revealIds.length ? "YOUR PAID DOORS" : "DOORS IN THIS ORDER"}
              </span>
              <div>
                {sale.items.map((item) => {
                  const index = doors.findIndex(
                    (d) => d.doorId === item.doorId,
                  );
                  return (
                    <button
                      key={item.doorId}
                      disabled={index < 0}
                      onClick={() => jump(Math.max(0, rowOf(index) - 1))}
                    >
                      {item.doorLabel ?? item.doorId} <span>↗</span>
                    </button>
                  );
                })}
              </div>
              <small>
                {revealIds.length
                  ? "Collect from the highlighted doors."
                  : "Payment status appears above."}
              </small>
            </div>
          )}
        </section>
        <div className="portrait-status">
          <span>
            <i className={p.connected ? "online" : ""} />
            {p.connected ? (synthetic ? "PREVIEW B" : "THE VAULT") : "RECONNECTING"}
          </span>
          <span>{synthetic ? "TEST MODE · SIMULATED PAYMENT & UNLOCK" : p.snapshot.mode === "CERTIFICATION" ? "TEST MODE" : ""}</span>
        </div>
        {(p.notice || p.violation || !p.connected) && (
          <div className="portrait-toast" role="alert">
            {p.notice ??
              (p.violation
                ? "Order exceeds the payment limit. Remove a pack to continue."
                : "Reconnecting. Your selection is retained.")}
          </div>
        )}
        {settings && (
          <aside className="portrait-settings">
            <header>
              <strong>Experience settings</strong>
              <button
                onClick={() => setSettings(false)}
                aria-label="Close settings"
              >
                ×
              </button>
            </header>
            <button onClick={() => setSound(!sound)} aria-pressed={sound}>
              Selection sound <b>{sound ? "ON" : "OFF"}</b>
            </button>
            <button
              onClick={() => setReducedMotion(!reducedMotion)}
              aria-pressed={reducedMotion}
            >
              Reduce motion <b>{reducedMotion ? "ON" : "OFF"}</b>
            </button>
            <button onClick={() => setLight(!light)} aria-pressed={light}>
              Light rendering <b>{light ? "ON" : "AUTO"}</b>
            </button>
            <p>
              {metrics
                ? `${metrics.fps} FPS · ${metrics.p95} ms p95 · ${metrics.quality}`
                : "Measuring this browser…"}
            </p>
            <p>
              {synthetic ? "4 × 17 layout, 6 × 2.5-inch door faces. Test IDs occupy visual slots in inventory order. Printed positions and hardware addresses are not yet qualified. Four extra simulator doors are outside this 68-door comparison." : "Door positions and labels follow this machine’s configured profile."}
            </p>
            <p>Performance shown is for this browser.</p>
            {synthetic && <a href="?experience=cinematic">Open version A ↗</a>}
          </aside>
        )}
        <dialog
          aria-labelledby="portrait-review-title"
          className="portrait-review"
          ref={reviewRef}
          onCancel={() => setReview(false)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setReview(false);
          }}
        >
          <div className="portrait-review-inner">
            <button
              className="portrait-review-close"
              aria-label="Close order review"
              onClick={() => setReview(false)}
            >
              ×
            </button>
            <img
              src={`./art/vault/${p.snapshot.products.find((item) => item.id === p.cart[0]?.productId)?.category === "POKEMON" ? "pack-pokemon" : "pack-front"}.png`}
              alt="Ten Kings foil pack concept"
            />
            <span className="portrait-kicker">03 / MAKE IT YOURS</span>
            <h2 id="portrait-review-title">Your next discovery.</h2>
            <p>Confirm your packs and door numbers.</p>
            <ul>
              {p.cart.map((line) => (
                <li key={line.doorId}>
                  <b>{line.doorLabel ?? line.doorId}</b>
                  <span>
                    {line.productName}
                    {line.conflict && <em>Choose a replacement door</em>}
                  </span>
                  <strong>{formatMoney(line.priceCents)}</strong>
                </li>
              ))}
            </ul>
            <dl>
              <div>
                <dt>Subtotal</dt>
                <dd>{formatMoney(p.subtotal)}</dd>
              </div>
              <div>
                <dt>Tax</dt>
                <dd>{p.tax === null ? "Unavailable" : formatMoney(p.tax)}</dd>
              </div>
              <div className="portrait-review-total">
                <dt>Total</dt>
                <dd>{totalLabel}</dd>
              </div>
            </dl>
            <button
              className="portrait-primary"
              disabled={!canCheckout}
              onClick={p.onCheckout}
            >
              {p.busy === "checkout" ? "Reserving…" : `Pay ${totalLabel}`}{" "}
              <span>↗</span>
            </button>
            <small>{synthetic ? "Test checkout · No real charge" : p.snapshot.mode === "CERTIFICATION" ? "Test checkout" : "Complete payment on the card terminal."}</small>
            <button className="portrait-edit" onClick={() => setReview(false)}>
              Keep exploring
            </button>
          </div>
        </dialog>
        {p.idleDialog}
      </div>
    </main>
  );
}
