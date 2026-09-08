import type { VaultMode } from "../types";

interface BrandHeaderProps {
  mode: VaultMode;
  location: string;
  online: boolean;
  onServiceGesture: () => void;
}

export function BrandHeader({ mode, location, online, onServiceGesture }: BrandHeaderProps) {
  return (
    <header className="brand-header">
      <div className="brand-mark">
        <span className="brand-crown" aria-hidden="true">♔</span>
        <span>
          <strong>TEN KINGS</strong>
          <small>THE VAULT</small>
        </span>
      </div>
      <button
        className="service-hot-corner"
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onServiceGesture}
      >
        <span className="sr-only">Service entry gesture target</span>
      </button>
      <div className="machine-meta" aria-live="polite">
        {mode === "CERTIFICATION" && <strong className="test-mode-pill">TEST MODE</strong>}
        <span className={online ? "status-dot online" : "status-dot offline"} aria-hidden="true" />
        <span>{online ? location : "Local service reconnecting"}</span>
      </div>
    </header>
  );
}
