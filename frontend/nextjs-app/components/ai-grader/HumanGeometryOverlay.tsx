import React from "react";
import type {
  AiGraderHumanGeometrySideV1,
} from "@tenkings/shared";

type Props = {
  geometry: AiGraderHumanGeometrySideV1;
  showCandidates?: boolean;
  showRegions?: boolean;
  showEdgeRegions?: boolean;
  showSurfaceRegion?: boolean;
  showCorners?: boolean;
  activeCorner?: keyof AiGraderHumanGeometrySideV1["physicalCorners"];
  onBorderPointerDown?: (
    edge: keyof AiGraderHumanGeometrySideV1["printedBorders"],
    event: React.PointerEvent<SVGLineElement>,
  ) => void;
  onCornerPointerDown?: (
    corner: keyof AiGraderHumanGeometrySideV1["physicalCorners"],
    event: React.PointerEvent<SVGGElement>,
  ) => void;
};

const polygonPoints = (points: Array<{ x: number; y: number }>) =>
  points.map((point) => `${point.x},${point.y}`).join(" ");

export default function HumanGeometryOverlay({
  geometry,
  showCandidates = false,
  showRegions = true,
  showEdgeRegions,
  showSurfaceRegion,
  showCorners = true,
  activeCorner,
  onBorderPointerDown,
  onCornerPointerDown,
}: Props) {
  const renderEdgeRegions = showEdgeRegions ?? showRegions;
  const renderSurfaceRegion = showSurfaceRegion ?? showRegions;
  return (
    <svg
      viewBox="0 0 1200 1680"
      width="100%"
      height="100%"
      aria-label="Confirmed card geometry overlay"
      role="img"
    >
      {renderSurfaceRegion ? (
          <polygon
            points={polygonPoints(geometry.derivedRegions.surfaceRegion)}
            fill="rgba(83, 211, 160, 0.09)"
            stroke="rgba(83, 211, 160, 0.6)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
      ) : null}
      {renderEdgeRegions ? (
        <>
          {(["top", "right", "bottom", "left"] as const).map((edge) => (
            <polygon
              key={edge}
              points={polygonPoints(geometry.derivedRegions.edgeBands[edge])}
              fill="rgba(252, 188, 72, 0.2)"
              stroke="rgba(252, 188, 72, 0.9)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </>
      ) : null}
      {(["top", "right", "bottom", "left"] as const).map((edge) => {
        const border = geometry.printedBorders[edge];
        return (
          <g key={edge}>
            {showCandidates ? border.candidates.map((candidate) => (
              <line
                key={candidate.id}
                x1={candidate.line.start.x}
                y1={candidate.line.start.y}
                x2={candidate.line.end.x}
                y2={candidate.line.end.y}
                stroke={
                  border.selectedCandidateId === candidate.id
                    ? border.reviewed
                      ? "rgba(91, 255, 157, 0.82)"
                      : "rgba(225, 189, 104, 0.92)"
                    : "rgba(248, 243, 231, 0.28)"
                }
                strokeDasharray="8 8"
                strokeWidth={border.selectedCandidateId === candidate.id ? 3 : 2}
                vectorEffect="non-scaling-stroke"
              />
            )) : null}
            <line
              x1={border.finalLine.start.x}
              y1={border.finalLine.start.y}
              x2={border.finalLine.end.x}
              y2={border.finalLine.end.y}
              stroke={border.reviewed ? "#5bff9d" : "#ffbd45"}
              strokeWidth="4"
              vectorEffect="non-scaling-stroke"
              style={{ cursor: onBorderPointerDown ? "grab" : "default" }}
              onPointerDown={(event) => onBorderPointerDown?.(edge, event)}
            />
          </g>
        );
      })}
      {showCorners ? (["top_left", "top_right", "bottom_right", "bottom_left"] as const).map((corner) => {
        const tool = geometry.physicalCorners[corner];
        const radiusX = Math.abs(tool.vertex.x - tool.horizontalTangent.x);
        const radiusY = Math.abs(tool.vertex.y - tool.verticalTangent.y);
        const centerX = tool.vertex.x +
          (corner === "top_right" || corner === "bottom_right" ? -radiusX : radiusX);
        const centerY = tool.vertex.y +
          (corner === "bottom_left" || corner === "bottom_right" ? -radiusY : radiusY);
        return (
          <g
            key={corner}
            onPointerDown={(event) => onCornerPointerDown?.(corner, event)}
            style={{ cursor: onCornerPointerDown ? "grab" : "default" }}
          >
            {tool.toolType === "rounded_3_18_mm" ? (
              <ellipse
                cx={centerX}
                cy={centerY}
                rx={radiusX}
                ry={radiusY}
                fill="none"
                stroke={tool.reviewed ? "#5bff9d" : "#ffbd45"}
                strokeWidth={activeCorner === corner ? 5 : 3}
                strokeDasharray="8 5"
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <path
                d={`M ${tool.horizontalTangent.x} ${tool.horizontalTangent.y} L ${tool.vertex.x} ${tool.vertex.y} L ${tool.verticalTangent.x} ${tool.verticalTangent.y}`}
                fill="none"
                stroke={tool.reviewed ? "#5bff9d" : "#ffbd45"}
                strokeWidth={activeCorner === corner ? 6 : 4}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <circle
              cx={tool.vertex.x}
              cy={tool.vertex.y}
              r={activeCorner === corner ? 11 : 8}
              fill={tool.reviewed ? "#5bff9d" : "#ffbd45"}
              stroke="#000"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      }) : null}
    </svg>
  );
}
