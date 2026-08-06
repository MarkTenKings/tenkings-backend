import type { SpeedsterPoint } from "./contracts";

export type SpeedsterSelectionBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function speedsterSelectionBox(
  start: SpeedsterPoint,
  end: SpeedsterPoint,
): SpeedsterSelectionBox {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

export function speedsterSelectionIds(
  markers: readonly { id: string; point: SpeedsterPoint }[],
  box: SpeedsterSelectionBox,
): string[] {
  return markers.flatMap(({ id, point }) => (
    point.x >= box.left && point.x <= box.right &&
    point.y >= box.top && point.y <= box.bottom
      ? [id]
      : []
  ));
}
