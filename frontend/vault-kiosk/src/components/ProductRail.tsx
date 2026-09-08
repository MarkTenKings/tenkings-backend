import type { KioskDoor, KioskProduct } from "../types";
import { useState } from "react";
import { formatMoney } from "../workflow/kioskWorkflow";

// Bundled media has no network dependency and never blocks selecting a product.
const PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="156" height="184" viewBox="0 0 156 184"><rect width="156" height="184" rx="16" fill="#17130d"/><path d="M30 57l24 20 24-38 24 38 24-20-12 62H42z" fill="#d9ae4a"/><text x="78" y="150" text-anchor="middle" font-family="Georgia,serif" font-size="16" fill="#fff8df">TEN KINGS</text></svg>')}`;

function ProductImage({ product }: { product: KioskProduct }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <img src={failedUrl === product.photoUrl ? PLACEHOLDER : product.photoUrl} alt="" draggable={false}
    onError={() => setFailedUrl(product.photoUrl)} />;
}

interface ProductRailProps {
  products: readonly KioskProduct[];
  doors: readonly KioskDoor[];
  selectedProductId: string | null;
  disabled: boolean;
  onSelect: (productId: string) => void;
  onPick: (productId: string) => void;
  pickBusy: boolean;
  animationBusy?: boolean;
}

export function ProductRail({ products, doors, selectedProductId, disabled, onSelect, onPick, pickBusy, animationBusy = false }: ProductRailProps) {
  return (
    <section className="product-section" aria-labelledby="products-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Step 1</p>
          <h2 id="products-title">Choose a pack</h2>
        </div>
        <p>Sports or Pokémon · one payment</p>
      </div>
      <div className="product-rail" role="list">
        {products.filter((product) => product.active).map((product) => {
          const count = doors.filter((door) => door.productId === product.id && door.state === "AVAILABLE").length;
          const pickableCount = doors.filter((door) => door.productId === product.id && door.state === "AVAILABLE" && !door.selected).length;
          const selected = selectedProductId === product.id;
          return (
            <article className={`product-card ${selected ? "selected" : ""}`} key={product.id} role="listitem">
              <button
                type="button"
                className="product-select"
                aria-pressed={selected}
                disabled={disabled || count === 0}
                onClick={() => onSelect(product.id)}
              >
                <ProductImage product={product} />
                <span className="product-copy">
                  <small>{product.category === "POKEMON" ? "Pokémon" : "Sports"}</small>
                  <strong>{product.name}</strong>
                  <span>{formatMoney(product.priceCents)}</span>
                  <em>{count > 0 ? `${count} available` : "Sold out"}</em>
                </span>
              </button>
              <button
                type="button"
                className="pick-button"
                disabled={disabled || pickBusy || animationBusy || pickableCount === 0}
                onClick={() => onPick(product.id)}
                aria-label={`Pick an available ${product.name} door for me`}
              >
                {pickBusy && selected ? "Choosing…" : "Pick for me"}
              </button>
            </article>
          );
        })}
      </div>
      {products.find((product) => product.id === selectedProductId)?.description && (
        <p className="selected-product-description">{products.find((product) => product.id === selectedProductId)?.description}</p>
      )}
    </section>
  );
}
