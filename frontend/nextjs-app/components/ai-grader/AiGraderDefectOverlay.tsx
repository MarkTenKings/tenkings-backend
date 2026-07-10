import React, { useState, type KeyboardEvent, type SyntheticEvent } from "react";
import type { AiGraderRenderableReportImage } from "../../lib/aiGraderReportImages";
import {
  defectFindingLabel,
  defectFindingPolygonPoints,
  objectContainProjection,
  type AiGraderDefectFindingV1,
} from "../../lib/aiGraderDefectFindings";

type Props = {
  image: AiGraderRenderableReportImage;
  findings: AiGraderDefectFindingV1[];
  selectedFindingId?: string;
  onSelectFinding?: (findingId: string) => void;
};

function markerClass(finding: AiGraderDefectFindingV1, selectedFindingId: string | undefined) {
  return [
    "finding-marker",
    `severity-${finding.severity.band}`,
    `review-${finding.review.status}`,
    finding.findingId === selectedFindingId ? "selected" : "",
  ].filter(Boolean).join(" ");
}

export default function AiGraderDefectOverlay({ image, findings, selectedFindingId, onSelectFinding }: Props) {
  const [loadedImage, setLoadedImage] = useState<{
    renderUrl: string;
    projection: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const projection = loadedImage?.renderUrl === image.renderUrl ? loadedImage.projection : null;
  const imageFailed = failedImageUrl === image.renderUrl;
  const onImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth <= 0 || naturalHeight <= 0) {
      setLoadedImage(null);
      setFailedImageUrl(image.renderUrl);
      return;
    }
    setLoadedImage({
      renderUrl: image.renderUrl,
      projection: objectContainProjection(naturalWidth, naturalHeight),
    });
    setFailedImageUrl(null);
  };
  const selectOnKey = (event: KeyboardEvent<SVGElement>, findingId: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectFinding?.(findingId);
  };

  return (
    <div className="defect-overlay" aria-label="Normalized card with AI-detected provisional findings">
      <img
        src={image.renderUrl}
        alt={image.fileName ?? image.id ?? "Normalized card evidence"}
        draggable={false}
        onLoad={onImageLoad}
        onError={() => {
          setLoadedImage(null);
          setFailedImageUrl(image.renderUrl);
        }}
      />
      {projection ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`${findings.length} provisional finding overlays`}>
        <g transform={`translate(${projection.x} ${projection.y}) scale(${projection.width / 100} ${projection.height / 100})`}>
        {findings.map((finding) => {
          const label = defectFindingLabel(finding);
          const shape = finding.geometry.shape;
          if (shape.type === "box") {
            return (
              <rect
                key={finding.findingId}
                className={markerClass(finding, selectedFindingId)}
                x={shape.x * 100}
                y={shape.y * 100}
                width={shape.width * 100}
                height={shape.height * 100}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-pressed={finding.findingId === selectedFindingId}
                vectorEffect="non-scaling-stroke"
                onClick={() => onSelectFinding?.(finding.findingId)}
                onKeyDown={(event) => selectOnKey(event, finding.findingId)}
              >
                <title>{label}</title>
              </rect>
            );
          }
          return (
            <polygon
              key={finding.findingId}
              className={markerClass(finding, selectedFindingId)}
              points={defectFindingPolygonPoints(shape)}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={finding.findingId === selectedFindingId}
              vectorEffect="non-scaling-stroke"
              onClick={() => onSelectFinding?.(finding.findingId)}
              onKeyDown={(event) => selectOnKey(event, finding.findingId)}
            >
              <title>{label}</title>
            </polygon>
          );
        })}
        </g>
      </svg> : null}
      {imageFailed ? <p className="image-error" role="status">Defect evidence image unavailable.</p> : null}
      <style jsx>{`
        .defect-overlay {
          position: relative;
          width: min(100%, 520px);
          aspect-ratio: 2.5 / 3.5;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 6px;
          background: #090909;
        }
        img,
        svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }
        img {
          display: block;
          object-fit: contain;
        }
        svg {
          overflow: visible;
        }
        .image-error {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          margin: 0;
          padding: 1rem;
          color: #d6d6d6;
          font-size: 0.85rem;
          text-align: center;
        }
        .finding-marker {
          cursor: pointer;
          fill: rgba(245, 182, 66, 0.18);
          stroke: #f5b642;
          stroke-width: 2;
          transition: fill 120ms ease, stroke-width 120ms ease;
        }
        .finding-marker:hover,
        .finding-marker:focus,
        .finding-marker.selected {
          fill: rgba(255, 255, 255, 0.2);
          stroke: #ffffff;
          stroke-width: 3;
          outline: none;
        }
        .finding-marker:focus-visible {
          fill: rgba(125, 211, 252, 0.24);
          stroke: #7dd3fc;
          stroke-width: 4;
          filter: drop-shadow(0 0 2px #050505);
        }
        .severity-low {
          fill: rgba(70, 190, 120, 0.16);
          stroke: #55c982;
        }
        .severity-high {
          fill: rgba(238, 84, 66, 0.2);
          stroke: #ff6652;
        }
        .review-confirmed {
          stroke-dasharray: none;
        }
        .review-unreviewed {
          stroke-dasharray: 4 3;
        }
        .review-rejected {
          opacity: 0.42;
          stroke-dasharray: 5 4;
        }
        .review-rejected:focus-visible {
          opacity: 1;
        }
        .review-adjusted {
          stroke-dasharray: 8 3;
        }
      `}</style>
    </div>
  );
}
