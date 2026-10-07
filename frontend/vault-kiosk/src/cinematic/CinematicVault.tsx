import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  KioskCartLine,
  KioskDoor,
  KioskPublicSnapshot,
  VaultDoorId,
} from "../types";
import { currentDoorLabel } from "../workflow/profileLayout";
import {
  formatMoney,
  type ProviderLimitViolation,
} from "../workflow/kioskWorkflow";
import {
  galleryDoors,
  previewRevealIds,
  type RenderQuality,
  type SceneMetrics,
} from "./experience";
import { VaultScene } from "./VaultScene";
import "./cinematic.css";

export interface Props {
  snapshot: KioskPublicSnapshot;
  doors: KioskDoor[];
  cart: KioskCartLine[];
  selectedProductId: string | null;
  disabled: boolean;
  busy: string | null;
  connected: boolean;
  subtotal: number;
  tax: number | null;
  total: number | null;
  violation: ProviderLimitViolation;
  notice: string | null;
  paidFlow: ReactNode;
  idleDialog: ReactNode;
  onProduct: (id: string) => void;
  onDoor: (door: KioskDoor) => void;
  onCheckout: () => void;
  onService: () => void;
}
function Crown() {
  return (
    <svg viewBox="0 0 36 30" fill="none" aria-hidden="true">
      <path
        d="m4 8 8 6 6-11 6 11 8-6-4 16H8L4 8Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M9 28h18M18 9v9" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="18" cy="3" r="1.5" fill="currentColor" />
    </svg>
  );
}
function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

export default function CinematicVault(p: Props) {
  const [page, setPage] = useState(0),
    [review, setReview] = useState(false),
    [details, setDetails] = useState(false);
  const [focused, setFocused] = useState<VaultDoorId | null>(null),
    [settings, setSettings] = useState(false);
  const [sound, setSound] = useState(false),
    [quality, setQuality] = useState<RenderQuality>("auto");
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [metrics, setMetrics] = useState<SceneMetrics | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const reviewRef = useRef<HTMLDialogElement>(null);
  const product = p.snapshot.products.find(
    (item) => item.id === p.selectedProductId,
  );
  const categories = [
    ...new Set(
      p.snapshot.products
        .filter((item) => item.active)
        .map((item) => item.category),
    ),
  ];
  const choices = p.snapshot.products
    .filter((item) => item.active && item.category === product?.category)
    .sort((a, b) => a.priceCents - b.priceCents);
  const candidates = galleryDoors(p.doors, p.selectedProductId);
  const sale = p.snapshot.activeSale;
  const saleKey = sale?.saleId;
  const revealIds = previewRevealIds(p.snapshot);
  const pageCount = Math.max(1, Math.ceil(candidates.length / 3));
  const safePage = Math.min(page, pageCount - 1);
  const saleGallery = sale
    ? p.doors.filter(
        (door) =>
          door.productId === sale.items[0]?.productId ||
          sale.items.some((item) => item.doorId === door.doorId),
      )
    : [];
  const salePage = sale
    ? Math.max(
        0,
        Math.floor(
          saleGallery.findIndex(
            (door) => door.doorId === sale.items[0]?.doorId,
          ) / 3,
        ),
      )
    : 0;
  const sceneDoors = (
    sale
      ? saleGallery.slice(salePage * 3, salePage * 3 + 3)
      : candidates.slice(safePage * 3, safePage * 3 + 3)
  ).map((door) => ({
    ...door,
    selected: door.selected || revealIds.includes(door.doorId),
    label:
      sale?.items.find((item) => item.doorId === door.doorId)?.doorLabel ??
      currentDoorLabel(
        door.doorId,
        p.snapshot.configSchemaVersion,
        p.snapshot.machineProfile,
      ),
  }));
  const available = candidates.filter(
    (door) => door.state === "AVAILABLE" || door.selected,
  ).length;
  const conflicts = p.cart.some((line) => line.conflict);
  const mayCheckout =
    !p.disabled &&
    p.cart.length > 0 &&
    !conflicts &&
    !p.violation &&
    p.total !== null;
  useEffect(() => {
    setPage(0);
    setFocused(null);
    setDetails(false);
  }, [p.selectedProductId]);
  useEffect(() => {
    setReview(false);
  }, [saleKey]);
  useEffect(() => {
    if (p.snapshot.publicState === "IDLE_WARNING") setReview(false);
  }, [p.snapshot.publicState]);
  useEffect(() => {
    if (p.cart.length === 0) setReview(false);
  }, [p.cart.length]);
  useEffect(() => {
    if (review && !sale) {
      reviewRef.current?.showModal();
    } else reviewRef.current?.close();
  }, [review, Boolean(sale)]);
  useEffect(
    () => () => {
      void audioRef.current?.close();
    },
    [],
  );
  const chime = () => {
    if (!sound) return;
    try {
      const audio = audioRef.current ?? new AudioContext();
      audioRef.current = audio;
      void audio.resume();
      const gain = audio.createGain();
      gain.connect(audio.destination);
      gain.gain.setValueAtTime(0.035, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.2);
      for (const frequency of [440, 660]) {
        const osc = audio.createOscillator();
        osc.type = "sine";
        osc.frequency.value = frequency;
        osc.connect(gain);
        osc.start();
        osc.stop(audio.currentTime + 0.21);
      }
    } catch {
      /* Sound is optional; it never affects a transaction. */
    }
  };
  const choose = (door: KioskDoor) => {
    setFocused(door.doorId);
    chime();
    p.onDoor(door);
  };
  const remove = (line: KioskCartLine) => {
    const door = p.doors.find((d) => d.doorId === line.doorId);
    if (door) p.onDoor(door);
  };
  const changeCategory = (category: string) => {
    const next =
      p.snapshot.products.find(
        (item) =>
          item.active &&
          item.category === category &&
          item.priceCents === product?.priceCents,
      ) ??
      p.snapshot.products.find(
        (item) => item.active && item.category === category,
      );
    if (next) p.onProduct(next.id);
  };
  const totalLabel = p.total === null ? "Checking tax…" : formatMoney(p.total);

  return (
    <main
      className={`cinematic-vault customer-shopping ${sale ? "cinematic-paid" : ""} ${reducedMotion ? "reduce-motion" : ""}`}
      data-experience="cinematic"
      data-mode={p.snapshot.mode}
    >
      <div className="vault-atmosphere" />
      <VaultScene
        doors={sceneDoors}
        focused={focused}
        revealIds={revealIds}
        disabled={p.disabled || Boolean(sale) || review}
        review={review}
        reducedMotion={reducedMotion}
        quality={quality}
        onSelect={choose}
        onFocus={setFocused}
        onMetrics={setMetrics}
      />
      <header className="vault-hud">
        <div className="vault-wordmark">
          <span className="vault-emblem">
            <Crown />
          </span>
          <span>
            TEN KINGS<small>THE VAULT</small>
          </span>
        </div>
        <nav className="vault-progress" aria-label="Purchase progress">
          {["Discover", "Select a door", "Checkout", "Collect"].map(
            (name, index) => (
              <span
                key={name}
                aria-current={
                  (sale ? 3 : review ? 2 : 1) === index ? "step" : undefined
                }
                className={
                  (sale ? 3 : review ? 2 : 1) === index ? "active" : ""
                }
              >
                <b>0{index + 1}</b>
                {name}
              </span>
            ),
          )}
        </nav>
        <div className="vault-tools">
          <a className="vault-compare-link" href="?experience=portrait" aria-label="Compare portrait version B">A / B</a>
          <span className="preview-indicator">
            <i />
            PLAYABLE PREVIEW
          </span>
          <button
            type="button"
            className="vault-icon-button"
            onClick={() => setSettings(!settings)}
            aria-expanded={settings}
            aria-label="Experience settings"
          >
            ☷
          </button>
        </div>
        <button
          type="button"
          className="service-hot-corner"
          tabIndex={-1}
          aria-hidden="true"
          onClick={p.onService}
        />
      </header>
      {!sale && (
        <>
          <section
            className="vault-discover"
            aria-label="Discover your collection"
          >
            <p className="vault-kicker">
              <span /> ACCESS SOMETHING EXTRAORDINARY
            </p>
            <h1>
              Your next
              <br />
              <em>great find.</em>
            </h1>
            <p className="vault-intro">
              Choose your collection.
              <br />
              Make a door yours.
            </p>
            <div
              className="collection-switch"
              role="group"
              aria-label="Collection"
            >
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  disabled={p.disabled}
                  aria-pressed={category === product?.category}
                  onClick={() => changeCategory(category)}
                >
                  {category === "POKEMON" ? "Pokémon" : "Sports"}
                  <span>{category === product?.category ? "↗" : ""}</span>
                </button>
              ))}
            </div>
            <div className="tier-heading">
              <span>CHOOSE YOUR TIER</span>
              <span>USD</span>
            </div>
            <div className="vault-tiers" role="group" aria-label="Price tier">
              {choices.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-label={`${item.name}, ${formatMoney(item.priceCents)}`}
                  aria-pressed={item.id === product?.id}
                  disabled={p.disabled}
                  onClick={() => p.onProduct(item.id)}
                >
                  {formatMoney(item.priceCents).replace(/\.00$/, "")}
                  <span>
                    {item.id === product?.id ? "SELECTED" : "PER PACK"}
                  </span>
                </button>
              ))}
            </div>
            <button
              className="product-detail-toggle"
              type="button"
              onClick={() => setDetails(!details)}
              aria-expanded={details}
            >
              <span>
                <b>
                  {product?.category === "POKEMON" ? "Pokémon" : "Sports"}{" "}
                  mystery pack
                </b>
                <small>
                  {available} doors available ·{" "}
                  {product ? formatMoney(product.priceCents) : "—"} + tax
                </small>
              </span>
              <span aria-hidden="true">{details ? "−" : "+"}</span>
            </button>
            {details && (
              <div className="vault-product-details">
                <img
                  src="./art/vault/pack-front.png"
                  alt="Ten Kings black and gold concept pack artwork"
                />
                <p>
                  <b>{product?.name}</b>
                  {product?.description}
                  <small>Concept packaging shown.</small>
                </p>
              </div>
            )}
            <div className="vault-instruction">
              <span className="touch-symbol" aria-hidden="true">
                ◎
              </span>
              <p>
                Touch a metal door to select it.
                <small>Its number stays with your order.</small>
              </p>
            </div>
          </section>
          <div className="gallery-heading">
            <div>
              <span className="vault-kicker">THE DOOR GALLERY</span>
              <p>
                {product?.category === "POKEMON" ? "Pokémon" : "Sports"}{" "}
                collection <span>/</span>{" "}
                {product
                  ? formatMoney(product.priceCents).replace(/\.00$/, "")
                  : "—"}
              </p>
            </div>
            <span className="gallery-status">
              <i />
              {p.cart.length ? `${p.cart.length} selected` : "Choose your door"}
            </span>
          </div>
          <div className="gallery-navigation">
            <p>
              <span>
                {String(safePage * 3 + 1).padStart(2, "0")}—
                {String(Math.min(candidates.length, safePage * 3 + 3)).padStart(
                  2,
                  "0",
                )}
              </span>{" "}
              / {String(candidates.length).padStart(2, "0")} doors
              <span className="gallery-view-note">Collection view</span>
            </p>
            <div>
              <button
                type="button"
                disabled={p.disabled || safePage === 0}
                onClick={() => {
                  setPage(safePage - 1);
                  setFocused(null);
                  chime();
                }}
                aria-label="Previous doors"
              >
                ←
              </button>
              <button
                type="button"
                disabled={p.disabled || safePage >= pageCount - 1}
                onClick={() => {
                  setPage(safePage + 1);
                  setFocused(null);
                  chime();
                }}
                aria-label="Next doors"
              >
                →
              </button>
            </div>
          </div>
          {available === 0 && (
            <p className="gallery-empty" role="status">
              This tier is sold out. Choose another tier to explore.
            </p>
          )}
          <footer className="vault-checkout-hud">
            <div className="selection-summary">
              <span className="vault-kicker">YOUR SELECTION</span>
              <div className="selection-chips">
                {p.cart.length ? (
                  p.cart.map((line) => (
                    <button
                      type="button"
                      disabled={p.disabled}
                      key={line.doorId}
                      className={line.conflict ? "conflict" : ""}
                      onClick={() => remove(line)}
                      aria-label={`Remove door ${line.doorLabel ?? line.doorId}`}
                    >
                      <span>{line.doorLabel ?? line.doorId}</span>
                      <small>
                        {line.conflict
                          ? "REPLACE"
                          : formatMoney(line.priceCents)}
                      </small>
                      <i>×</i>
                    </button>
                  ))
                ) : (
                  <p>The next discovery is yours to choose.</p>
                )}
              </div>
            </div>
            <div className="selection-total">
              <small>
                {p.cart.length} {p.cart.length === 1 ? "pack" : "packs"} · total
                with tax
              </small>
              <strong>{totalLabel}</strong>
            </div>
            <button
              className="vault-primary review-action"
              type="button"
              disabled={!mayCheckout}
              onClick={() => {
                setReview(true);
                chime();
              }}
            >
              Review order <Arrow />
            </button>
          </footer>
        </>
      )}
      {sale && (
        <section
          className="vault-sale-panel"
          aria-label="Payment and collection"
        >
          {revealIds.length > 0 && (
            <div className="collection-headline">
              <span className="vault-kicker">
                A NEW ADDITION TO YOUR COLLECTION
              </span>
              <h1>
                It’s <em>yours.</em>
              </h1>
            </div>
          )}
          {p.paidFlow}
          <p className="preview-reveal-note">
            Preview animation. No physical door is connected.
          </p>
        </section>
      )}
      <div className="vault-bottom-line">
        <span>
          <i className={p.connected ? "is-online" : ""} />
          {p.connected
            ? "LOCAL SERVICE CONNECTED"
            : "RECONNECTING · ACTIONS PAUSED"}
        </span>
        <span>TEST MODE · SIMULATED PAYMENT &amp; UNLOCK</span>
        <span>TEN KINGS / EST. FOR COLLECTORS</span>
      </div>
      {(p.notice || p.violation) && (
        <div className="vault-toast" role="alert">
          {p.notice ??
            "This order exceeds the payment limit. Remove a pack to continue."}
        </div>
      )}
      {!p.connected && (
        <div className="vault-toast" role="status">
          Reconnecting to the vault. Your order is retained.
        </div>
      )}
      {settings && (
        <aside className="experience-settings">
          <div className="settings-heading">
            <strong>Experience settings</strong>
            <button
              type="button"
              aria-label="Close settings"
              onClick={() => setSettings(false)}
            >
              ×
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSound(!sound)}
            aria-pressed={sound}
          >
            Selection sound <b>{sound ? "ON" : "OFF"}</b>
          </button>
          <button
            type="button"
            onClick={() => setReducedMotion(!reducedMotion)}
            aria-pressed={reducedMotion}
          >
            Reduce motion <b>{reducedMotion ? "ON" : "OFF"}</b>
          </button>
          <label>
            Rendering{" "}
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as RenderQuality)}
            >
              <option value="auto">Automatic</option>
              <option value="rich">Rich lighting</option>
              <option value="light">Lightweight</option>
            </select>
          </label>
          <p>
            {metrics
              ? `${metrics.fps} fps · p95 ${metrics.p95} ms · ${metrics.draws} draws · ${metrics.scale.toFixed(2)}× render scale`
              : "Measuring this browser…"}
            <small>
              Local browser measurement. SER5 qualification is still pending.
            </small>
          </p>
          <p>
            This is a three-door art-direction preview over synthetic inventory.
            Door numbers are exact; gallery positions are not a physical cabinet
            map.
          </p>
        </aside>
      )}
      <dialog
        className="vault-review-dialog"
        ref={reviewRef}
        onCancel={() => setReview(false)}
        aria-labelledby="review-title"
      >
        <div className="review-art">
          <img
            src="./art/vault/pack-front.png"
            alt="Ten Kings mystery collection concept packaging"
          />
          <span>THE VAULT COLLECTION</span>
        </div>
        <div className="review-content">
          <button
            className="review-close"
            type="button"
            aria-label="Back to doors"
            disabled={p.busy !== null}
            onClick={() => setReview(false)}
          >
            ×
          </button>
          <p className="vault-kicker">YOUR NEXT DISCOVERY</p>
          <h2 id="review-title">Make it yours.</h2>
          <p className="review-subtitle">
            Check your doors. One payment for your order.
          </p>
          <ul className="review-lines">
            {p.cart.map((line) => (
              <li key={line.doorId}>
                <strong>{line.doorLabel ?? line.doorId}</strong>
                <span>
                  {line.productName}
                  <small>
                    {line.conflict
                      ? "Unavailable — remove and choose another door"
                      : "Your exact selected door"}
                  </small>
                </span>
                <b>{formatMoney(line.priceCents)}</b>
                <button
                  type="button"
                  disabled={p.disabled}
                  onClick={() => remove(line)}
                  aria-label={`Remove door ${line.doorLabel ?? line.doorId} from order`}
                >
                  ×
                </button>
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
              <dd>{p.tax === null ? "Checking…" : formatMoney(p.tax)}</dd>
            </div>
            <div className="review-total">
              <dt>Total</dt>
              <dd>{totalLabel}</dd>
            </div>
          </dl>
          {(p.notice || conflicts || p.violation) && (
            <p role="alert" className="review-error">
              {p.notice ??
                (conflicts
                  ? "Remove the unavailable door before continuing."
                  : "This order exceeds the payment limit.")}
            </p>
          )}
          <button
            type="button"
            className="vault-primary checkout-action"
            disabled={!mayCheckout}
            onClick={p.onCheckout}
          >
            {p.busy === "checkout"
              ? "Securing your order…"
              : `Pay ${totalLabel}`}
            <Arrow />
          </button>
          <p className="review-test-note">Test payment · no charge to a card</p>
          <button
            type="button"
            className="review-back"
            disabled={p.busy !== null}
            onClick={() => setReview(false)}
          >
            ← Keep exploring
          </button>
        </div>
      </dialog>
      {p.idleDialog}
    </main>
  );
}
