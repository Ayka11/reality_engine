import { CELL_FIELDS } from "./CellState";

/**
 * Reject invalid geometry before typed-array allocation. Grid dimensions and
 * the derived field-buffer length must remain exact safe integers.
 */
export function validateGridDimensions(
  width: number,
  height: number,
  depth: number,
  gridName: string,
): number {
  if (![width, height, depth].every(Number.isSafeInteger) ||
      width <= 0 || height <= 0 || depth <= 0) {
    throw new RangeError(`${gridName} dimensions must be positive safe integers`);
  }

  const size = width * height * depth;
  const bufferLength = size * CELL_FIELDS;
  if (!Number.isSafeInteger(size) || size <= 0 ||
      !Number.isSafeInteger(bufferLength) || bufferLength <= 0) {
    throw new RangeError(`${gridName} dimensions exceed the supported typed-buffer index range`);
  }
  return size;
}
