import type { KioskDoor, KioskProduct } from "../types";
import { formatMoney } from "../workflow/kioskWorkflow";

interface ProductRailProps {
  products: readonly KioskProduct[];
  doors: readonly KioskDoor[];
  selectedProductId: string | null;
  disabled: boolean;
  onSelect: (productId: string) => void;
  onPick: (productId: string) => void;
  pickBusy: boolean;
}

export function ProductRail({ products, doors, selectedProductId, disabled, onSelect, onPick, pickBusy }: ProductRailProps) {
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
                <img src={product.photoUrl} alt="" draggable={false} />
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
                disabled={disabled || pickBusy || count === 0}
                onClick={() => onPick(product.id)}
                aria-label={`Pick an available ${product.name} door for me`}
              >
                {pickBusy && selected ? "Choosing…" : "Pick for me"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
