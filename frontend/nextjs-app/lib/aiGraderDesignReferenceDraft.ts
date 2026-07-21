export function parseAiGraderIntendedDesignBoundaryDraft(
  value: string,
  widthPx: number,
  heightPx: number,
) {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (!Number.isSafeInteger(widthPx) || widthPx < 1 || !Number.isSafeInteger(heightPx) || heightPx < 1) {
    throw new Error("Artifact width and height must be positive integers before defining its print boundary.");
  }
  if (parsed.schemaVersion !== "ai-grader-intended-design-boundary-v1" || parsed.coordinateFrame !== "design_reference_pixels") {
    throw new Error("The intended boundary must declare the exact V1 schema and design_reference_pixels frame.");
  }
  if (!Array.isArray(parsed.contour) || parsed.contour.length < 4 || parsed.contour.length > 64) {
    throw new Error("The intended boundary contour must contain 4-64 measured pixel points.");
  }
  const contour = parsed.contour.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2 || !point.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) {
      throw new Error(`Boundary contour point ${index + 1} must be one finite [x,y] pixel pair.`);
    }
    const [x, y] = point as [number, number];
    if (x < 0 || x > widthPx || y < 0 || y > heightPx) {
      throw new Error(`Boundary contour point ${index + 1} lies outside the exact artifact dimensions.`);
    }
    return [x, y] as const;
  });
  const twiceArea = Math.abs(contour.reduce((sum, point, index) => {
    const next = contour[(index + 1) % contour.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0));
  if (twiceArea < 2) throw new Error("The intended boundary contour must enclose a measurable non-zero area.");
  return { ...parsed, contour };
}
