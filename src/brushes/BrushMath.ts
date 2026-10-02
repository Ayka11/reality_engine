import type { BrushFalloff, BrushOperation } from "./BrushContract";

export function brushFalloffWeight(
  distance: number,
  radius: number,
  falloff: BrushFalloff
): number {
  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(radius) ||
    distance < 0 ||
    radius <= 0 ||
    distance > radius
  ) {
    return 0;
  }

  switch (falloff) {
    case "gaussian": {
      const normalized = distance / radius;
      return Math.exp(-2.5 * normalized * normalized);
    }
    case "linear":
      return Math.max(0, 1 - distance / radius);
    case "constant":
      return 1;
    default: {
      const exhaustive: never = falloff;
      return exhaustive;
    }
  }
}

export function applyBrushOperation(
  current: number,
  value: number,
  operation: BrushOperation,
  weight: number,
  strength = 1
): number {
  if (![current, value, weight, strength].every(Number.isFinite)) {
    throw new RangeError("Brush operation inputs must be finite numbers.");
  }

  const w = Math.min(1, Math.max(0, weight));
  if (w === 0 || strength === 0) return current;

  const amount = Math.min(1, Math.max(0, strength * w));

  switch (operation) {
    case "add":
      return current + value * strength * w;
    case "set":
      return current + (value - current) * amount;
    case "scale":
      return current * (1 + (value - 1) * amount);
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}
