import Image from "next/image";
import type { FormEvent } from "react";
import crownAsset from "../../assets/ai-grader-label-v1/ten-kings-crown-2026-monochrome-v1.png";
import type { HumanGradeLabelEditorValue } from "../../lib/humanGrade";
import styles from "./SharedLabelEditor.module.css";

type SharedLabelEditorProps = {
  mode: "HUMAN" | "SPEEDSTER";
  value: HumanGradeLabelEditorValue;
  onChange: (field: keyof HumanGradeLabelEditorValue, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel?: () => void;
  certificateNumber?: string;
  calculatedGrade?: string | null;
  fieldErrors?: Record<string, string>;
  saving?: boolean;
  editing?: boolean;
  primaryActionLabel?: string;
  subgradeAriaLabel?: string;
  lockCardType?: boolean;
};

const SUBGRADE_FIELDS = [
  ["centeringGrade", "CTR", "Centering"],
  ["cornersGrade", "CRN", "Corners"],
  ["edgesGrade", "EDG", "Edges"],
  ["surfaceGrade", "SUR", "Surface"],
] as const;

export default function SharedLabelEditor({
  mode,
  value,
  onChange,
  onSubmit,
  onCancel,
  certificateNumber = "TKH-AUTO",
  calculatedGrade = null,
  fieldErrors = {},
  saving = false,
  editing = false,
  primaryActionLabel,
  subgradeAriaLabel = "Calculated grade and human subgrades",
  lockCardType = false,
}: SharedLabelEditorProps) {
  const isHuman = mode === "HUMAN";
  const primaryLabel = primaryActionLabel ?? (
    isHuman ? (editing ? "Save Changes" : "Save Graded Card") : "Continue to Photos"
  );

  return (
    <section className={`${styles.root} composer-card`}>
      <div className="composer-heading">
        <div>
          <p className="eyebrow">{
            isHuman
              ? (editing ? "Edit Label" : "New Label")
              : (editing ? "Edit Speedster Identity" : "New Speedster Card")
          }</p>
          <h2>Enter printed card information</h2>
        </div>
        <div className="type-switch" aria-label="Card type">
          {(["SPORTS", "POKEMON"] as const).map((cardType) => (
            <button
              key={cardType}
              type="button"
              className={value.cardType === cardType ? "selected" : ""}
              onClick={() => onChange("cardType", cardType)}
              disabled={lockCardType}
            >
              {cardType === "SPORTS" ? "Sports" : "Pokémon"}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={onSubmit}>
        <div className="label-composer" aria-label="Ten Kings human-grade label editor">
          <div className="brand-third">
            <Image src={crownAsset} alt="" priority />
            <strong>TEN KINGS</strong>
            <span className="certificate-preview">{certificateNumber}</span>
          </div>
          <div className="identity-third">
            <label className="primary-field">
              <span>{value.cardType === "SPORTS" ? "Player Name" : "Card Name"}</span>
              <input
                value={value.cardType === "SPORTS" ? value.playerName : value.cardName}
                onChange={(event) =>
                  onChange(value.cardType === "SPORTS" ? "playerName" : "cardName", event.target.value)
                }
                placeholder={value.cardType === "SPORTS" ? "PLAYER NAME" : "CARD NAME"}
                autoFocus
              />
            </label>
            <div className="metadata-fields">
              <label>
                <span>Year</span>
                <input value={value.year} onChange={(event) => onChange("year", event.target.value)} placeholder="YEAR" />
              </label>
              {value.cardType === "SPORTS" ? (
                <label>
                  <span>Manufacturer</span>
                  <input
                    value={value.manufacturer}
                    onChange={(event) => onChange("manufacturer", event.target.value)}
                    placeholder="MANUFACTURER"
                  />
                </label>
              ) : null}
              <label>
                <span>{value.cardType === "SPORTS" ? "Product / Set" : "Set"}</span>
                <input
                  value={value.productSet}
                  onChange={(event) => onChange("productSet", event.target.value)}
                  placeholder={value.cardType === "SPORTS" ? "PRODUCT / SET" : "SET"}
                />
              </label>
            </div>
            <div className="descriptor-fields">
              <label>
                <span>Parallel</span>
                <input value={value.parallel} onChange={(event) => onChange("parallel", event.target.value)} placeholder="PARALLEL" />
              </label>
              {value.cardType === "SPORTS" ? (
                <label>
                  <span>Insert</span>
                  <input value={value.insert} onChange={(event) => onChange("insert", event.target.value)} placeholder="INSERT" />
                </label>
              ) : null}
              <label className="card-number-field">
                <span>Card Number</span>
                <input value={value.cardNumber} onChange={(event) => onChange("cardNumber", event.target.value)} placeholder="#CARD" />
              </label>
            </div>
          </div>
          <div className="grade-third">
            <div className="compact-grade-summary" aria-label={subgradeAriaLabel}>
              <output className="compact-final-grade" aria-label="Calculated Final Grade" aria-live="polite">
                {isHuman ? calculatedGrade ?? "—" : "—"}
              </output>
              {isHuman ? (
                <div className="compact-subgrade-grid">
                  {SUBGRADE_FIELDS.map(([field, code, label]) => (
                    <label className="compact-subgrade-field" key={field}>
                      <span className="compact-subgrade-code" aria-hidden="true">{code}</span>
                      <span className="compact-subgrade-equals" aria-hidden="true">=</span>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        step="0.1"
                        inputMode="decimal"
                        required
                        value={value[field]}
                        onChange={(event) => onChange(field, event.target.value)}
                        placeholder="—"
                        aria-label={label}
                        style={{ width: `${Math.max(1.2, value[field].length * 0.62)}em` }}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {Object.keys(fieldErrors).length ? (
          <div className="field-errors" role="alert">
            {Object.entries(fieldErrors).map(([field, error]) => <span key={field}>{error}</span>)}
          </div>
        ) : null}

        <div className="form-actions">
          {onCancel ? <button type="button" className="cancel-button" onClick={onCancel} disabled={saving}>Cancel</button> : null}
          <button type="submit" className="save-button" disabled={saving}>
            {saving ? (isHuman || editing ? "Saving…" : "Preparing…") : primaryLabel}
          </button>
        </div>
      </form>
    </section>
  );
}
