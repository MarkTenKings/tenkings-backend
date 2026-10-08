import { useEffect, useRef } from "react";

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
    const focusDialog = () => {
      if (keepShoppingRef.current && !keepShoppingRef.current.disabled) keepShoppingRef.current.focus();
      else dialogRef.current?.focus();
    };
    const containFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }
      if (event.key !== "Tab") return;
      event.preventDefault();
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [])];
      if (!focusable.length) { dialogRef.current?.focus(); return; }
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : (current + 1) % focusable.length;
      focusable[next]?.focus();
    };
    const restoreContainment = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) focusDialog();
    };
    focusDialog();
    document.addEventListener("keydown", containFocus, true);
    document.addEventListener("focusin", restoreContainment);
    return () => {
      document.removeEventListener("keydown", containFocus, true);
      document.removeEventListener("focusin", restoreContainment);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <div className="idle-overlay" role="presentation">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-description">
        <p className="eyebrow">Unpaid cart</p>
        <h2 id="idle-title">Still shopping?</h2>
        <p id="idle-description">This unpaid session will reset in <span aria-live="polite">{secondsRemaining}</span> seconds.</p>
        <button ref={keepShoppingRef} type="button" className="primary-action" disabled={busy} onClick={onKeepShopping}>
          {busy ? "Keeping cart…" : "CONTINUE SHOPPING"}
        </button>
      </div>
    </div>
  );
}
