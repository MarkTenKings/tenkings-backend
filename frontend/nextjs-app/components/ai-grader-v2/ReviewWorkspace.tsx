"use client";

import { useState } from "react";
import type {
  SpeedsterCardSide,
  SpeedsterDefectType,
  SpeedsterReviewFinding,
} from "../../lib/ai-grader-v2/contracts";
import type { calculateSpeedsterGrade } from "../../lib/ai-grader-v2/scoring";
import type { SpeedsterInspectionFrame } from "../../lib/ai-grader-v2/inspection-frame";
import type { SpeedsterMapRegistration } from "../../lib/ai-grader-v2/card-type-map-contracts";
import type { SpeedsterTraceRleV1 } from "../../lib/ai-grader-v2/trace-codec";
import {
  DefectEvidenceViewer,
} from "./DefectEvidenceViewer";
import type {
  SpeedsterInMemoryTraceSave,
  SpeedsterTraceCornerShape,
  SpeedsterTraceProposalInput,
  SpeedsterTraceSaveResult,
} from "./DefectTraceEditor";
import { GradeSummary } from "./GradeSummary";
import styles from "./ReviewWorkspace.module.css";

type ReviewWorkspaceProps = {
  masterImageUrls: Readonly<Record<SpeedsterCardSide, string>>;
  inspectionFrames: Readonly<Record<SpeedsterCardSide, SpeedsterInspectionFrame>>;
  sourceImageUrls: Readonly<Record<string, string>>;
  cornerShape: SpeedsterTraceCornerShape;
  defects: readonly SpeedsterReviewFinding[];
  mapRegistrations?: Readonly<Record<SpeedsterCardSide, SpeedsterMapRegistration>>;
  grade: ReturnType<typeof calculateSpeedsterGrade>;
  busy: boolean;
  canUndo: boolean;
  onRemoveDefects: (defectIds: readonly string[]) => boolean | Promise<boolean>;
  onUndo: () => void;
  onDefectTypeChange: (defectId: string, defectType: SpeedsterDefectType) => void;
  onTraceProposal?: (
    input: SpeedsterTraceProposalInput,
  ) => Uint8Array | null | void | Promise<Uint8Array | null | void>;
  onTraceSave?: (
    input: SpeedsterInMemoryTraceSave,
  ) => SpeedsterTraceSaveResult | Promise<SpeedsterTraceSaveResult>;
  onTraceLoad?: (findingId: string) => Promise<SpeedsterTraceRleV1 | null>;
  onImageError?: () => void;
  onComplete: () => void;
};

export function ReviewWorkspace({
  masterImageUrls,
  inspectionFrames,
  sourceImageUrls,
  cornerShape,
  defects,
  mapRegistrations,
  grade,
  busy,
  canUndo,
  onRemoveDefects,
  onUndo,
  onDefectTypeChange,
  onTraceProposal,
  onTraceSave,
  onTraceLoad,
  onImageError,
  onComplete,
}: ReviewWorkspaceProps) {
  const [side, setSide] = useState<SpeedsterCardSide>("FRONT");

  return (
    <section className={styles.workspace}>
      <header className={styles.header}>
        <div><span>03 · HUMAN REVIEW</span><h1>Review only what needs attention.</h1></div>
        <div className={styles.sides}>
          {canUndo ? <button type="button" disabled={busy} onClick={onUndo}>Undo remove</button> : null}
          {(["FRONT", "BACK"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={side === value ? styles.active : undefined}
              onClick={() => setSide(value)}
            >{value === "FRONT" ? "Front" : "Back"}</button>
          ))}
        </div>
      </header>

      <DefectEvidenceViewer
        key={side}
        masterImageUrl={masterImageUrls[side]}
        magnifyImageUrl={sourceImageUrls[`${side}:ORIGINAL`]}
        inspectionFrame={inspectionFrames[side]}
        sourceImageUrls={sourceImageUrls}
        cornerShape={cornerShape}
        side={side}
        defects={defects}
        mapRegistration={mapRegistrations?.[side]}
        readOnly={false}
        busy={busy}
        onRemoveDefects={onRemoveDefects}
        onDefectTypeChange={onDefectTypeChange}
        onTraceProposal={onTraceProposal}
        onTraceSave={onTraceSave}
        onTraceLoad={onTraceLoad}
        onImageError={onImageError}
      />

      <GradeSummary grade={grade} />
      <button type="button" className={styles.complete} disabled={busy} onClick={onComplete}>
        {busy ? "Saving review…" : "Complete grade"} <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}

export type { ReviewWorkspaceProps };
