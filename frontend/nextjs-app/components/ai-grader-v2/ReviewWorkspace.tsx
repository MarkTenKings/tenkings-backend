"use client";

import { useState } from "react";
import type {
  SpeedsterCardSide,
  SpeedsterDefectType,
  SpeedsterMeasuredDefect,
} from "../../lib/ai-grader-v2/contracts";
import type { calculateSpeedsterGrade } from "../../lib/ai-grader-v2/scoring";
import type { SpeedsterInspectionFrame } from "../../lib/ai-grader-v2/inspection-frame";
import { DefectEvidenceViewer } from "./DefectEvidenceViewer";
import { GradeSummary } from "./GradeSummary";
import styles from "./ReviewWorkspace.module.css";

type ReviewWorkspaceProps = {
  masterImageUrls: Readonly<Record<SpeedsterCardSide, string>>;
  inspectionFrames: Readonly<Record<SpeedsterCardSide, SpeedsterInspectionFrame>>;
  sourceImageUrls: Readonly<Record<string, string>>;
  defects: readonly SpeedsterMeasuredDefect[];
  grade: ReturnType<typeof calculateSpeedsterGrade>;
  canUndo: boolean;
  onRemoveDefect: (defectId: string) => void;
  onUndo: () => void;
  onDefectTypeChange: (defectId: string, defectType: SpeedsterDefectType) => void;
  onSmartMark: (side: SpeedsterCardSide, box: { x: number; y: number; width: number; height: number }) => void;
  onComplete: () => void;
};

export function ReviewWorkspace({
  masterImageUrls,
  inspectionFrames,
  sourceImageUrls,
  defects,
  grade,
  canUndo,
  onRemoveDefect,
  onUndo,
  onDefectTypeChange,
  onSmartMark,
  onComplete,
}: ReviewWorkspaceProps) {
  const [side, setSide] = useState<SpeedsterCardSide>("FRONT");

  return (
    <section className={styles.workspace}>
      <header className={styles.header}>
        <div><span>03 · HUMAN REVIEW</span><h1>Review only what needs attention.</h1></div>
        <div className={styles.sides}>
          {canUndo ? <button type="button" onClick={onUndo}>Undo remove</button> : null}
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
        masterImageUrl={masterImageUrls[side]}
        magnifyImageUrl={sourceImageUrls[`${side}:ORIGINAL`]}
        inspectionFrame={inspectionFrames[side]}
        sourceImageUrls={sourceImageUrls}
        side={side}
        defects={defects}
        readOnly={false}
        onRemoveDefect={onRemoveDefect}
        onDefectTypeChange={onDefectTypeChange}
        onSmartMark={(box) => onSmartMark(side, box)}
      />

      <GradeSummary grade={grade} />
      <button type="button" className={styles.complete} onClick={onComplete}>
        Complete grade <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}

export type { ReviewWorkspaceProps };
