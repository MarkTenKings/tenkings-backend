import { useEffect, useRef, useState } from "react";
import type { KioskProduct } from "../types";
import { formatMoney } from "../workflow/kioskWorkflow";

type Collection = "ALL" | KioskProduct["category"];

// Match verified packaging by category AND price, never by a filename or SKU slug.
export function productArtwork(product: KioskProduct) {
  const category = product.category === "POKEMON" ? "pokemon" : "sports";
  const photographed = product.priceCents !== 25000;
  return {
    src: photographed
      ? `./art/vault/products/${category}-${product.priceCents / 100}.png`
      : `./art/vault/${category === "pokemon" ? "pack-pokemon" : "pack-front"}.png`,
    concept: !photographed,
    spacious: product.priceCents === 10000,
  };
}

export function ProductShelf({
  products,
  selectedId,
  disabled,
  reducedMotion,
  onSelect,
}: {
  products: KioskProduct[];
  selectedId: string | null;
  disabled: boolean;
  reducedMotion: boolean;
  onSelect: (id: string) => void;
}) {
  const [collection, setCollection] = useState<Collection>("ALL");
  const [edges, setEdges] = useState({ start: true, end: false });
  const shelf = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    left: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const selected = products.find((p) => p.id === selectedId);
  const choices = products
    .filter(
      (p) => p.active && (collection === "ALL" || p.category === collection),
    )
    .sort(
      (a, b) =>
        a.priceCents - b.priceCents || a.category.localeCompare(b.category),
    );
  const reveal = (button: HTMLElement, behavior: ScrollBehavior) => {
    const el = shelf.current;
    if (!el) return;
    const b = button.getBoundingClientRect(),
      r = el.getBoundingClientRect();
    if (b.left < r.left + 12 || b.right > r.right - 12)
      el.scrollTo({
        left: button.offsetLeft - (el.clientWidth - button.clientWidth) / 2,
        behavior,
      });
  };
  useEffect(() => {
    const button = shelf.current?.querySelector<HTMLElement>(
      '[aria-pressed="true"]',
    );
    if (button) reveal(button, "instant");
  }, [selectedId, collection]);
  useEffect(() => {
    const el = shelf.current;
    if (!el) return;
    const measure = () =>
      setEdges({
        start: el.scrollLeft <= 2,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
      });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    el.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [collection, products.length]);
  const chooseCollection = (next: Collection) => {
    setCollection(next);
    if (next !== "ALL" && selected?.category !== next) {
      const nextProduct =
        products.find(
          (p) =>
            p.active &&
            p.category === next &&
            p.priceCents === selected?.priceCents,
        ) ?? products.find((p) => p.active && p.category === next);
      if (nextProduct) onSelect(nextProduct.id);
    }
  };
  const move = (direction: number) =>
    shelf.current?.scrollBy({
      left: direction * shelf.current.clientWidth * 0.7,
      behavior: reducedMotion ? "instant" : "smooth",
    });
  return (
    <div className={`portrait-shelf ${reducedMotion ? "is-still" : ""}`}>
      <div className="portrait-shelf-toolbar">
        <nav className="portrait-collections" aria-label="Product collection">
          {(["ALL", "SPORTS", "POKEMON"] as const).map((category) => (
            <button
              key={category}
              aria-pressed={collection === category}
              disabled={disabled}
              onClick={() => chooseCollection(category)}
            >
              {category === "ALL"
                ? "All packs"
                : category === "SPORTS"
                  ? "Sports"
                  : "Pokémon"}
            </button>
          ))}
        </nav>
        <div className="portrait-shelf-arrows">
          <button
            aria-label="Previous products"
            disabled={disabled || edges.start}
            onClick={() => move(-1)}
          >
            ‹
          </button>
          <button
            aria-label="More products"
            disabled={disabled || edges.end}
            onClick={() => move(1)}
          >
            ›
          </button>
        </div>
      </div>
      <div
        className="portrait-product-shelf"
        ref={shelf}
        role="group"
        aria-label="Choose a pack, swipe to browse"
        onPointerDown={(event) => {
          suppressClick.current = false;
          if (event.pointerType !== "mouse" || event.button !== 0) return;
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            left: event.currentTarget.scrollLeft,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const gesture = drag.current;
          if (!gesture || gesture.id !== event.pointerId) return;
          const delta = event.clientX - gesture.x;
          if (!gesture.moved && Math.abs(delta) < 8) return;
          gesture.moved = true;
          suppressClick.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.classList.add("is-dragging");
          event.currentTarget.scrollLeft = gesture.left - delta;
        }}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.classList.remove("is-dragging");
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          drag.current = null;
          event.currentTarget.classList.remove("is-dragging");
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        {choices.map((product) => {
          const art = productArtwork(product),
            chosen = product.id === selectedId;
          return (
            <button
              key={product.id}
              className="portrait-product-card"
              data-product-id={product.id}
              aria-label={`${product.category === "POKEMON" ? "Pokémon" : "Sports"} Mystery Pack, ${formatMoney(product.priceCents)}`}
              aria-pressed={chosen}
              disabled={disabled}
              onClick={() => onSelect(product.id)}
              onFocus={(event) =>
                reveal(
                  event.currentTarget,
                  reducedMotion ? "instant" : "smooth",
                )
              }
              onKeyDown={(event) => {
                if (
                  !["ArrowRight", "ArrowLeft", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const buttons = Array.from(
                  shelf.current?.querySelectorAll<HTMLButtonElement>(
                    ".portrait-product-card",
                  ) ?? [],
                );
                const index = buttons.indexOf(event.currentTarget);
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : Math.max(
                          0,
                          Math.min(
                            buttons.length - 1,
                            index + (event.key === "ArrowRight" ? 1 : -1),
                          ),
                        );
                buttons[next]?.focus();
              }}
            >
              <span className="portrait-pack-stage">
                <span className="portrait-pack-halo" />
                <img
                  className={art.spacious ? "has-art-margin" : ""}
                  src={art.src}
                  alt=""
                  draggable={false}
                />
                {art.concept && (
                  <small className="portrait-pack-concept">Preview art</small>
                )}
                <span className="portrait-pack-check" aria-hidden="true">
                  ✓
                </span>
              </span>
              <span className="portrait-pack-info">
                <span className="portrait-pack-name">
                  {product.category === "POKEMON" ? "Pokémon" : "Sports"}{" "}
                  Mystery Pack
                </span>
                <strong>
                  {formatMoney(product.priceCents).replace(/\.00$/, "")}
                </strong>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
