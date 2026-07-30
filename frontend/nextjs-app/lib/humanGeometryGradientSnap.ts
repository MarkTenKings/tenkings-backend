export type HumanGeometrySnapImageV1 = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type HumanGeometrySnapAxisV1 = "x" | "y";

export function snapHumanGeometryPointToGradientV1(
  image: HumanGeometrySnapImageV1 | null,
  position: { x: number; y: number },
  axis: HumanGeometrySnapAxisV1,
  searchRadiusPx = 12,
) {
  if (!image) return { ...position, distance: 0, strength: 0 };
  const luminance = (x: number, y: number) => {
    const boundedX = Math.max(0, Math.min(image.width - 1, Math.round(x)));
    const boundedY = Math.max(0, Math.min(image.height - 1, Math.round(y)));
    const index = (boundedY * image.width + boundedX) * 4;
    return (
      Number(image.data[index]) * 0.2126 +
      Number(image.data[index + 1]) * 0.7152 +
      Number(image.data[index + 2]) * 0.0722
    );
  };
  let best = { offset: 0, gradient: 0 };
  for (let offset = -searchRadiusPx; offset <= searchRadiusPx; offset += 1) {
    const x = position.x + (axis === "x" ? offset : 0);
    const y = position.y + (axis === "y" ? offset : 0);
    const gradient = axis === "x"
      ? Math.abs(luminance(x + 1, y) - luminance(x - 1, y))
      : Math.abs(luminance(x, y + 1) - luminance(x, y - 1));
    if (
      gradient > best.gradient ||
      (gradient === best.gradient && Math.abs(offset) < Math.abs(best.offset))
    ) {
      best = { offset, gradient };
    }
  }
  return {
    x: position.x + (axis === "x" ? best.offset : 0),
    y: position.y + (axis === "y" ? best.offset : 0),
    distance: Math.abs(best.offset),
    strength: Math.min(1, best.gradient / 64),
  };
}
