export interface FixedRigPrincipalExtentsV1 {
  length: number;
  width: number;
}

/**
 * Measures a connected component along its principal axes without expanding
 * an unbounded pixel array into function arguments.
 */
export function measureFixedRigPrincipalExtentsV1(
  pixels: readonly number[],
  imageWidth: number,
  unitX: number,
  unitY: number,
): FixedRigPrincipalExtentsV1 {
  if (!pixels.length) return { length: 0, width: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const pixel of pixels) {
    sumX += (pixel % imageWidth) * unitX;
    sumY += Math.floor(pixel / imageWidth) * unitY;
  }
  const meanX = sumX / pixels.length;
  const meanY = sumY / pixels.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const pixel of pixels) {
    const dx = (pixel % imageWidth) * unitX - meanX;
    const dy = Math.floor(pixel / imageWidth) * unitY - meanY;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const perpendicular = { x: -axis.y, y: axis.x };
  let alongMinimum = Number.POSITIVE_INFINITY;
  let alongMaximum = Number.NEGATIVE_INFINITY;
  let acrossMinimum = Number.POSITIVE_INFINITY;
  let acrossMaximum = Number.NEGATIVE_INFINITY;
  for (const pixel of pixels) {
    const x = (pixel % imageWidth) * unitX;
    const y = Math.floor(pixel / imageWidth) * unitY;
    const along = x * axis.x + y * axis.y;
    const across = x * perpendicular.x + y * perpendicular.y;
    alongMinimum = Math.min(alongMinimum, along);
    alongMaximum = Math.max(alongMaximum, along);
    acrossMinimum = Math.min(acrossMinimum, across);
    acrossMaximum = Math.max(acrossMaximum, across);
  }
  const alongExtent = alongMaximum - alongMinimum +
    Math.hypot(unitX * axis.x, unitY * axis.y);
  const acrossExtent = acrossMaximum - acrossMinimum +
    Math.hypot(unitX * perpendicular.x, unitY * perpendicular.y);
  return {
    length: Math.max(alongExtent, acrossExtent),
    width: Math.min(alongExtent, acrossExtent),
  };
}
