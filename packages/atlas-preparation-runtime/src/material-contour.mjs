// Intersect the projected photographic silhouette with the canonical card.
// Clamping vertices separately can collapse several corner samples to one point
// or change the boundary between samples. Keep actual segment intersections.
// The caller still validates the resulting simple, clockwise material polygon.
const SAME_POINT_EPSILON = 1e-12;
const samePoint = (a, b) => Math.abs(a.x - b.x) <= SAME_POINT_EPSILON
  && Math.abs(a.y - b.y) <= SAME_POINT_EPSILON;

function adjacentDistinct(points) {
  const result = [];
  for (const point of points) if (!result.length || !samePoint(point, result.at(-1))) result.push(point);
  if (result.length > 1 && samePoint(result[0], result.at(-1))) result.pop();
  return result;
}

export function clipMaterialContourToCard(points) {
  // Preserve previously valid, wholly contained projections byte for byte.
  if (points.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return points;
  let polygon = points;
  for (const [axis, bound, direction] of [['x', 0, 1], ['x', 1, -1], ['y', 0, 1], ['y', 1, -1]]) {
    const output = [], other = axis === 'x' ? 'y' : 'x';
    if (!polygon.length) break;
    let previous = polygon.at(-1), previousInside = (previous[axis] - bound) * direction >= 0;
    for (const current of polygon) {
      const currentInside = (current[axis] - bound) * direction >= 0;
      if (currentInside !== previousInside) {
        const fraction = (bound - previous[axis]) / (current[axis] - previous[axis]);
        output.push({ [axis]: bound, [other]: previous[other] + fraction * (current[other] - previous[other]) });
      }
      if (currentInside) output.push(current);
      previous = current; previousInside = currentInside;
    }
    // Only remove zero-length adjacent intersections. Nonadjacent duplicates,
    // disconnected intersections and other invalid topology remain rejected by
    // the existing material-contour validator; never replace them with a hull.
    polygon = adjacentDistinct(output);
  }
  return polygon;
}
