// Display-only transforms. The measured card remains on its existing canonical grid.
export const CARD_SIZE = Object.freeze({ width: 1270, height: 1778 });
export const INSPECTION_SIZE = Object.freeze({ width: 1350, height: 1858, padding: 40 });
export const MAX_INSPECTION_ZOOM = 16;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function fitInspectionScale(viewport, gutter = 16) {
  return Math.max(.001, Math.min((viewport.width - gutter * 2) / INSPECTION_SIZE.width,
    (viewport.height - gutter * 2) / INSPECTION_SIZE.height));
}

export function clampInspectionPan(pan, zoom, viewport) {
  const scale = fitInspectionScale(viewport) * zoom;
  const limit = dimension => Math.max(0, (INSPECTION_SIZE[dimension] * scale - viewport[dimension]) / 2 + 16);
  return { x: clamp(pan.x, -limit('width'), limit('width')), y: clamp(pan.y, -limit('height'), limit('height')) };
}

export function zoomInspectionAt(view, requestedZoom, anchor, viewport) {
  const zoom = clamp(requestedZoom, 1, MAX_INSPECTION_ZOOM), ratio = zoom / view.zoom;
  const x = anchor.x - viewport.width / 2, y = anchor.y - viewport.height / 2;
  return { zoom, pan: clampInspectionPan({ x: x - (x - view.pan.x) * ratio, y: y - (y - view.pan.y) * ratio }, zoom, viewport) };
}

/** Normalized canonical bounds, including edge findings, focus within the full inspection image. */
export function focusInspectionBounds(bounds, viewport) {
  const scale = fitInspectionScale(viewport);
  const width = Math.max(96, bounds.width * CARD_SIZE.width);
  const height = Math.max(96, bounds.height * CARD_SIZE.height);
  const zoom = clamp(Math.min(viewport.width * .55 / (width * scale), viewport.height * .55 / (height * scale)), 1, MAX_INSPECTION_ZOOM);
  const x = INSPECTION_SIZE.padding + (bounds.x + bounds.width / 2) * CARD_SIZE.width;
  const y = INSPECTION_SIZE.padding + (bounds.y + bounds.height / 2) * CARD_SIZE.height;
  return { zoom, pan: clampInspectionPan({ x: (INSPECTION_SIZE.width / 2 - x) * scale * zoom,
    y: (INSPECTION_SIZE.height / 2 - y) * scale * zoom }, zoom, viewport) };
}

/** Client point against the rendered full image. Margin clicks never become edge strokes. */
export function canonicalInspectionPoint(point, imageRect) {
  if (!imageRect?.width || !imageRect?.height) return null;
  const x = (point.x - imageRect.left) / imageRect.width * INSPECTION_SIZE.width - INSPECTION_SIZE.padding;
  const y = (point.y - imageRect.top) / imageRect.height * INSPECTION_SIZE.height - INSPECTION_SIZE.padding;
  if (x < 0 || y < 0 || x > CARD_SIZE.width || y > CARD_SIZE.height) return null;
  return { x: Math.round(x / CARD_SIZE.width * (CARD_SIZE.width - 1)), y: Math.round(y / CARD_SIZE.height * (CARD_SIZE.height - 1)) };
}
