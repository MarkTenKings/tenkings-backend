import type { VaultPublicState } from "../types";
import { statusContent } from "../workflow/statusContent";

interface StatusBannerProps {
  state: VaultPublicState;
  reasons?: readonly string[];
}

export function StatusBanner({ state, reasons = [] }: StatusBannerProps) {
  const content = statusContent(state);
  return (
    <section className={`status-banner tone-${content.tone}`} aria-live="polite" data-public-state={state}>
      <div>
        <p className="eyebrow">{content.eyebrow}</p>
        <h1>{content.title}</h1>
        <p>{content.message}</p>
      </div>
      {reasons.length > 0 && (
        <details className="readiness-details">
          <summary>Why shopping is paused</summary>
          <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
