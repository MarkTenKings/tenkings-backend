import { useEffect, useRef, type KeyboardEvent } from "react";

interface IdleWarningDialogProps {
  secondsRemaining: number;
  busy: boolean;
  onKeepShopping: () => void;
}

export function IdleWarningDialog({ secondsRemaining, busy, onKeepShopping }: IdleWarningDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepShoppingRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    keepShoppingRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  const containFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [])];
    if (!focusable.length) return;
    event.preventDefault();
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : (current + 1) % focusable.length;
    focusable[next]?.focus();
  };

  return (
    <div className="idle-overlay" role="presentation">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-description" onKeyDown={containFocus}>
        <p className="eyebrow">Unpaid cart</p>
        <h2 id="idle-title">Still shopping?</h2>
        <p id="idle-description">This unpaid session will reset in <span aria-live="polite">{secondsRemaining}</span> seconds.</p>
        <button ref={keepShoppingRef} type="button" className="primary-action" disabled={busy} onClick={onKeepShopping}>
          {busy ? "Keeping cart…" : "Keep shopping"}
        </button>
      </div>
    </div>
  );
}
