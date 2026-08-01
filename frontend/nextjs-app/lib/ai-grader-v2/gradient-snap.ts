import type { SpeedsterPoint } from "./contracts";

export type SpeedsterGradientMap = {
  x: Float32Array;
  y: Float32Array;
  width: number;
  height: number;
};

export type SpeedsterSnapOptions = {
  inwardX: -1 | 1;
  inwardY: -1 | 1;
  radius?: number;
  sampleStart?: number;
  sampleLength?: number;
  minimumStrength?: number;
};

const MAX_SOBEL = 1020;

export function buildSpeedsterGradientMap(image: ImageData): SpeedsterGradientMap {
  const { width, height, data } = image;
  const gray = new Float32Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const pixel = index * 4;
    gray[index] = 0.299 * data[pixel] + 0.587 * data[pixel + 1] + 0.114 * data[pixel + 2];
  }

  const x = new Float32Array(width * height);
  const y = new Float32Array(width * height);
  for (let row = 1; row < height - 1; row += 1) {
    for (let column = 1; column < width - 1; column += 1) {
      const index = row * width + column;
      x[index] = Math.abs(
        -gray[index - width - 1] - 2 * gray[index - 1] - gray[index + width - 1]
        + gray[index - width + 1] + 2 * gray[index + 1] + gray[index + width + 1],
      );
      y[index] = Math.abs(
        -gray[index - width - 1] - 2 * gray[index - width] - gray[index - width + 1]
        + gray[index + width - 1] + 2 * gray[index + width] + gray[index + width + 1],
      );
    }
  }
  return { x, y, width, height };
}

export function gradientMapFromImage(image: HTMLImageElement): SpeedsterGradientMap | null {
  const scale = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return buildSpeedsterGradientMap(context.getImageData(0, 0, canvas.width, canvas.height));
  } catch {
    return null;
  }
}

function axisStrength(
  values: Float32Array,
  map: SpeedsterGradientMap,
  fixed: number,
  origin: number,
  direction: -1 | 1,
  sampleStart: number,
  sampleLength: number,
  vertical: boolean,
): number {
  let total = 0;
  let count = 0;
  const step = Math.max(1, Math.round(sampleLength / 32));
  for (let distance = sampleStart; distance <= sampleLength; distance += step) {
    const column = Math.round(vertical ? fixed : origin + direction * distance);
    const row = Math.round(vertical ? origin + direction * distance : fixed);
    if (column < 1 || column >= map.width - 1 || row < 1 || row >= map.height - 1) continue;
    total += Math.min(MAX_SOBEL, values[row * map.width + column]) / MAX_SOBEL;
    count += 1;
  }
  return count === 0 ? 0 : total / count;
}

function snapAxis(
  values: Float32Array,
  map: SpeedsterGradientMap,
  fixed: number,
  origin: number,
  direction: -1 | 1,
  radius: number,
  sampleStart: number,
  sampleLength: number,
  minimumStrength: number,
  vertical: boolean,
): number {
  let bestPosition = fixed;
  let bestStrength = minimumStrength;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const position = fixed + offset;
    const strength = axisStrength(
      values,
      map,
      position,
      origin,
      direction,
      sampleStart,
      sampleLength,
      vertical,
    ) * (1 - 0.35 * Math.abs(offset) / radius);
    if (strength > bestStrength) {
      bestStrength = strength;
      bestPosition = position;
    }
  }
  return bestPosition;
}

export function snapSpeedsterPoint(
  map: SpeedsterGradientMap | null,
  point: SpeedsterPoint,
  options: SpeedsterSnapOptions,
): SpeedsterPoint {
  if (!map) return point;
  const radius = options.radius ?? 12;
  const sampleStart = options.sampleStart ?? 30;
  const sampleLength = options.sampleLength ?? 120;
  const minimumStrength = options.minimumStrength ?? 0.08;
  const x = point.x * (map.width - 1);
  const y = point.y * (map.height - 1);
  const snappedX = snapAxis(
    map.x,
    map,
    x,
    y,
    options.inwardY,
    radius,
    sampleStart,
    sampleLength,
    minimumStrength,
    true,
  );
  const snappedY = snapAxis(
    map.y,
    map,
    y,
    x,
    options.inwardX,
    radius,
    sampleStart,
    sampleLength,
    minimumStrength,
    false,
  );
  return {
    x: Math.min(1, Math.max(0, snappedX / (map.width - 1))),
    y: Math.min(1, Math.max(0, snappedY / (map.height - 1))),
  };
}
