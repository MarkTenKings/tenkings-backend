import type {
  AiGraderDefectFindingPoint,
  AiGraderDefectFindingShape,
  AiGraderDefectFindingV1,
} from "@tenkings/shared";

export type { AiGraderDefectFindingV1 } from "@tenkings/shared";

export function normalizedPointToPercent(point: AiGraderDefectFindingPoint) {
  return { x: point.x * 100, y: point.y * 100 };
}

export function defectFindingShapeBounds(shape: AiGraderDefectFindingShape) {
  if (shape.type === "box") {
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  }
  const xs = shape.points.map((point) => point.x);
  const ys = shape.points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

export function defectFindingPolygonPoints(shape: Extract<AiGraderDefectFindingShape, { type: "polygon" }>) {
  return shape.points
    .map(normalizedPointToPercent)
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}

export function defectFindingLabel(finding: AiGraderDefectFindingV1) {
  const category = finding.category.replace(/_/g, " ");
  return `AI-detected provisional ${finding.side} ${category} finding, ${finding.severity.band} severity, ${Math.round(finding.confidence * 100)}% confidence, review ${finding.review.status}`;
}

export function defectFindingsForExactImage(findings: AiGraderDefectFindingV1[], assetId: string | undefined) {
  if (!assetId) return [];
  return findings.filter((finding) => finding.evidence.trueViewAssetId === assetId);
}

export function objectContainProjection(imageWidth: number, imageHeight: number, containerAspect = 2.5 / 3.5) {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0 || containerAspect <= 0) {
    return { x: 0, y: 0, width: 100, height: 100 };
  }
  const imageAspect = imageWidth / imageHeight;
  if (imageAspect > containerAspect) {
    const height = (containerAspect / imageAspect) * 100;
    return { x: 0, y: (100 - height) / 2, width: 100, height };
  }
  const width = (imageAspect / containerAspect) * 100;
  return { x: (100 - width) / 2, y: 0, width, height: 100 };
}
