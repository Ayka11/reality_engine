/**
 * Shared scientific-field display palettes.
 *
 * Colors are display-only. Numeric normalization is defined separately by
 * ScientificFieldDisplay so the same field value and normalized intensity map
 * to the same color in 2D, Infinity terrain, and volumetric rendering.
 * Material remains categorical and Height remains a geometry-derived mode.
 */
export const SCIENTIFIC_FIELD_PALETTES = {
  energy: [0x183d9b, 0xffad42],
  density: [0x082d31, 0x75f4c1],
  information: [0x35105e, 0xbdb5ff],
  entropy: [0x270b18, 0xff526d],
  temperature: [0x153d7a, 0xffe16b],
  biology: [0x0d4c29, 0xa1ff65],
} as const

export type ScientificPaletteField = keyof typeof SCIENTIFIC_FIELD_PALETTES

export function scientificFieldPaletteColor(
  field: ScientificPaletteField,
  normalized: number,
): readonly [number, number, number] {
  const [low, high] = SCIENTIFIC_FIELD_PALETTES[field]
  const t = Number.isFinite(normalized) ? Math.max(0, Math.min(1, normalized)) : 0
  const channel = (shift: number) => {
    const a = (low >> shift) & 0xff
    const b = (high >> shift) & 0xff
    return Math.round(a + (b - a) * t)
  }
  return [channel(16), channel(8), channel(0)]
}

export function scientificFieldPaletteHex(
  field: ScientificPaletteField,
  normalized: number,
): number {
  const [red, green, blue] = scientificFieldPaletteColor(field, normalized)
  return (red << 16) | (green << 8) | blue
}

/**
 * Equal-weight composite of the valid numeric scientific dimensions.
 * Values are already normalized with ScientificFieldDisplay; missing or
 * non-finite dimensions are excluded, while measured zero remains valid.
 * Returned channels are sRGB bytes for canvas diagnostics and Three.js hex.
 */
export function scientificFieldCompositeColor(
  values: Partial<Record<ScientificPaletteField, number | null | undefined>>,
): readonly [number, number, number] | null {
  let red = 0, green = 0, blue = 0, count = 0
  for (const field of Object.keys(SCIENTIFIC_FIELD_PALETTES) as ScientificPaletteField[]) {
    const value = values[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const [r, g, b] = scientificFieldPaletteColor(field, value)
    red += r
    green += g
    blue += b
    count++
  }
  return count > 0
    ? [Math.round(red / count), Math.round(green / count), Math.round(blue / count)]
    : null
}

export function scientificFieldCompositeHex(
  values: Partial<Record<ScientificPaletteField, number | null | undefined>>,
): number | null {
  const color = scientificFieldCompositeColor(values)
  return color ? (color[0] << 16) | (color[1] << 8) | color[2] : null
}
