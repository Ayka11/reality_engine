/**
 * Shared display-only normalization for scientific WorldField values.
 *
 * These ranges are visualization reference scales, not physical clamps:
 * sampling, mutations, persistence, and simulation retain their original values.
 * Both Infinity terrain and the volumetric renderer must use this contract so
 * the same measurement maps to the same normalized intensity in either view.
 */
export const SCIENTIFIC_FIELD_DISPLAY_RANGES = {
  energy: 350,
  density: 1,
  information: 80,
  entropy: 0.15,
  temperature: 300,
  biology: 1,
} as const

export type NumericScientificField = keyof typeof SCIENTIFIC_FIELD_DISPLAY_RANGES

export function normalizeScientificFieldValue(
  field: NumericScientificField,
  value: unknown,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(1, value / SCIENTIFIC_FIELD_DISPLAY_RANGES[field]))
}
