import type { KioskDoor } from "../types";

// Owner-confirmed face geometry. These coordinates are visual only, never controller addresses.
export const CABINET = {
  columns: 4,
  rows: 17,
  faceWidth: 6,
  faceHeight: 2.5,
  pitchX: 6.4,
  pitchY: 2.9,
  width: 26,
  inset: 0.4,
} as const;
export const cabinetDoors = (doors: readonly KioskDoor[]) =>
  doors.slice(0, CABINET.columns * CABINET.rows);
export const rowOf = (index: number) => Math.floor(index / CABINET.columns);
export const rowPitchForWidth = (width: number) =>
  Math.max(CABINET.pitchY, 46 / (Math.max(1, width) / CABINET.width));
export const doorPosition = (
  index: number,
  pitch: number = CABINET.pitchY,
) => ({
  x: CABINET.inset + (index % CABINET.columns) * CABINET.pitchX,
  y: CABINET.inset + rowOf(index) * pitch,
});
export const cabinetHeightForPitch = (pitch: number) =>
  CABINET.rows * pitch + CABINET.inset;
