import type { FieldSampler } from './FieldSampler'
import type { ScientificFieldSample } from './FieldSampler'
import { MATERIAL_AIR_CLASS } from './WorldGenerator'

export const WORLD_FIELD_METRIC_FIELDS = [
  'energy', 'density', 'information', 'entropy', 'temperature', 'biology', 'material',
] as const

export type WorldFieldMetricName = typeof WORLD_FIELD_METRIC_FIELDS[number]
export type WorldFieldMetricPoint = { tick: number; value: number }
export type WorldFieldMetricStats = {
  count: number
  invalid: number
  min: number | null
  max: number | null
  mean: number | null
  standardDeviation: number | null
  categoryCounts?: Record<string, number>
}

export const MATERIAL_METRIC_CATEGORY_COUNT = MATERIAL_AIR_CLASS + 1
const emptyMaterialCategoryCounts = (): Record<string, number> =>
  Object.fromEntries(Array.from({ length: MATERIAL_METRIC_CATEGORY_COUNT }, (_, code) => [String(code), 0]))
const isMaterialCategory = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MATERIAL_METRIC_CATEGORY_COUNT
const cloneMetricStats = (stats: WorldFieldMetricStats): WorldFieldMetricStats => ({
  ...stats,
  ...(stats.categoryCounts ? { categoryCounts: { ...stats.categoryCounts } } : {}),
})
const emptyMetricStats = (field: WorldFieldMetricName): WorldFieldMetricStats => field === 'material'
  ? { count: 0, invalid: 0, min: null, max: null, mean: null, standardDeviation: null, categoryCounts: emptyMaterialCategoryCounts() }
  : { count: 0, invalid: 0, min: 0, max: 0, mean: 0, standardDeviation: 0 }
export type WorldFieldMetricBounds = {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
}
export type WorldFieldMetricResolution = { x: number; y: number; z: number }
export type WorldFieldProfileAxis = 'x' | 'y' | 'z'
export type WorldFieldProfilePoint = {
  coordinate: number
  position: { x: number; y: number; z: number }
  values: Record<WorldFieldMetricName, number | null>
  validity: Record<WorldFieldMetricName, boolean>
}
export type WorldFieldProfile = {
  axis: WorldFieldProfileAxis
  count: number
  points: WorldFieldProfilePoint[]
  stats: Record<WorldFieldMetricName, WorldFieldMetricStats>
}

/**
 * Samples the active FieldSampler provider into bounded, tick-indexed metrics.
 * It deliberately uses the public world-space sampling API rather than reading
 * legacy simulation buffers or provider internals.
 */
export class WorldFieldMetrics {
  private readonly capacity: number
  private readonly history = new Map<WorldFieldMetricName, WorldFieldMetricPoint[]>()
  private latestStats = new Map<WorldFieldMetricName, WorldFieldMetricStats>()
  private readonly materialCategoryHistory: Array<{ tick: number; counts: Record<string, number> }> = []

  constructor(private readonly sampler: Pick<FieldSampler, 'sample'>, capacity = 2000, private readonly maxSamples = 250_000) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Metric history capacity must be a positive safe integer')
    if (!Number.isSafeInteger(maxSamples) || maxSamples < 1) throw new RangeError('Metric sample limit must be a positive safe integer')
    this.capacity = capacity
    for (const field of WORLD_FIELD_METRIC_FIELDS) {
      this.history.set(field, [])
      this.latestStats.set(field, emptyMetricStats(field))
    }
  }

  sample(tick: number, bounds: WorldFieldMetricBounds, resolution: WorldFieldMetricResolution): Record<WorldFieldMetricName, WorldFieldMetricStats> {
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError('Metric tick must be a non-negative safe integer')
    const coordinates = [bounds?.min?.x, bounds?.min?.y, bounds?.min?.z, bounds?.max?.x, bounds?.max?.y, bounds?.max?.z]
    if (!coordinates.every(Number.isFinite) ||
        bounds.min.x > bounds.max.x || bounds.min.y > bounds.max.y || bounds.min.z > bounds.max.z) {
      throw new RangeError('Metric bounds must be finite and ordered')
    }
    const dimensions = [resolution?.x, resolution?.y, resolution?.z]
    if (!dimensions.every(value => Number.isSafeInteger(value) && value >= 1)) {
      throw new RangeError('Metric resolution must contain positive safe integers')
    }
    const total = resolution.x * resolution.y * resolution.z
    if (!Number.isSafeInteger(total) || total > this.maxSamples) {
      throw new RangeError(`Metric sample count exceeds configured limit (${this.maxSamples})`)
    }

    const accumulators = new Map<WorldFieldMetricName, { count: number; invalid: number; min: number; max: number; mean: number; m2: number; categoryCounts: Record<string, number> | null }>()
    for (const field of WORLD_FIELD_METRIC_FIELDS) accumulators.set(field, {
      count: 0, invalid: 0, min: Infinity, max: -Infinity, mean: 0, m2: 0,
      categoryCounts: field === 'material' ? emptyMaterialCategoryCounts() : null,
    })

    const coordinate = (min: number, max: number, index: number, count: number) =>
      count === 1 ? (min + max) / 2 : min + (max - min) * index / (count - 1)

    for (let iz = 0; iz < resolution.z; iz++) {
      const z = coordinate(bounds.min.z, bounds.max.z, iz, resolution.z)
      for (let iy = 0; iy < resolution.y; iy++) {
        const y = coordinate(bounds.min.y, bounds.max.y, iy, resolution.y)
        for (let ix = 0; ix < resolution.x; ix++) {
          const x = coordinate(bounds.min.x, bounds.max.x, ix, resolution.x)
          const sample = this.sampler.sample(x, y, z)
          for (const field of WORLD_FIELD_METRIC_FIELDS) {
            const accumulator = accumulators.get(field)!
            const raw = (sample as ScientificFieldSample)[field]
            if (typeof raw !== 'number' || !Number.isFinite(raw) || (field === 'material' && !isMaterialCategory(raw))) {
              accumulator.invalid++
              continue
            }
            accumulator.count++
            if (field === 'material') {
              const counts = accumulator.categoryCounts as Record<string, number>
              counts[String(raw)]++
            } else {
              accumulator.min = Math.min(accumulator.min, raw)
              accumulator.max = Math.max(accumulator.max, raw)
              const delta = raw - accumulator.mean
              accumulator.mean += delta / accumulator.count
              accumulator.m2 += delta * (raw - accumulator.mean)
            }
          }
        }
      }
    }

    const result = {} as Record<WorldFieldMetricName, WorldFieldMetricStats>
    for (const field of WORLD_FIELD_METRIC_FIELDS) {
      const accumulator = accumulators.get(field)!
      const stats: WorldFieldMetricStats = field === 'material'
        ? { count: accumulator.count, invalid: accumulator.invalid, min: null, max: null, mean: null,
            standardDeviation: null, categoryCounts: { ...(accumulator.categoryCounts as Record<string, number>) } }
        : { count: accumulator.count, invalid: accumulator.invalid,
            min: accumulator.count ? accumulator.min : 0, max: accumulator.count ? accumulator.max : 0,
            mean: accumulator.count ? accumulator.mean : 0,
            standardDeviation: accumulator.count ? Math.sqrt(accumulator.m2 / accumulator.count) : 0 }
      result[field] = cloneMetricStats(stats)
      this.latestStats.set(field, cloneMetricStats(stats))
      const series = this.history.get(field)!
      if (field !== 'material' && stats.count && stats.mean !== null) {
        series.push({ tick, value: stats.mean })
        if (series.length > this.capacity) series.splice(0, series.length - this.capacity)
      }
      if (field === 'material') {
        this.materialCategoryHistory.push({ tick, counts: { ...(stats.categoryCounts ?? emptyMaterialCategoryCounts()) } })
        if (this.materialCategoryHistory.length > this.capacity) this.materialCategoryHistory.splice(0, this.materialCategoryHistory.length - this.capacity)
      }
    }
    return result
  }

  /**
   * Samples one spatial line through the center of the supplied bounds.
   * The two non-selected coordinates remain fixed at their bounds midpoint.
   * This is an explicit inspection operation and never runs in the render loop.
   */
  sampleProfile(axis: WorldFieldProfileAxis, bounds: WorldFieldMetricBounds, resolution: number): WorldFieldProfile {
    if (axis !== 'x' && axis !== 'y' && axis !== 'z') throw new RangeError('Profile axis must be x, y, or z')
    const coordinates = [bounds?.min?.x, bounds?.min?.y, bounds?.min?.z, bounds?.max?.x, bounds?.max?.y, bounds?.max?.z]
    if (!coordinates.every(Number.isFinite) ||
        bounds.min.x > bounds.max.x || bounds.min.y > bounds.max.y || bounds.min.z > bounds.max.z) {
      throw new RangeError('Profile bounds must be finite and ordered')
    }
    if (!Number.isSafeInteger(resolution) || resolution < 1 || resolution > this.maxSamples) {
      throw new RangeError(`Profile resolution must be between 1 and configured sample limit (${this.maxSamples})`)
    }

    const center = {
      x: bounds.min.x + (bounds.max.x - bounds.min.x) / 2,
      y: bounds.min.y + (bounds.max.y - bounds.min.y) / 2,
      z: bounds.min.z + (bounds.max.z - bounds.min.z) / 2,
    }
    const min = bounds.min[axis]
    const max = bounds.max[axis]
    const accumulators = new Map<WorldFieldMetricName, { count: number; invalid: number; min: number; max: number; mean: number; m2: number; categoryCounts: Record<string, number> | null }>()
    for (const field of WORLD_FIELD_METRIC_FIELDS) accumulators.set(field, {
      count: 0, invalid: 0, min: Infinity, max: -Infinity, mean: 0, m2: 0,
      categoryCounts: field === 'material' ? emptyMaterialCategoryCounts() : null,
    })
    const points: WorldFieldProfilePoint[] = []

    for (let index = 0; index < resolution; index++) {
      const coordinate = resolution === 1 ? min + (max - min) / 2 : min + (max - min) * index / (resolution - 1)
      const position = { ...center, [axis]: coordinate }
      const sample = this.sampler.sample(position.x, position.y, position.z) as ScientificFieldSample
      const values = {} as Record<WorldFieldMetricName, number | null>
      const validity = {} as Record<WorldFieldMetricName, boolean>
      for (const field of WORLD_FIELD_METRIC_FIELDS) {
        const raw = sample[field]
        const valid = typeof raw === 'number' && Number.isFinite(raw) && (field !== 'material' || isMaterialCategory(raw))
        validity[field] = valid
        values[field] = valid ? raw : null
        const accumulator = accumulators.get(field)!
        if (!valid) {
          accumulator.invalid++
          continue
        }
        accumulator.count++
        if (field === 'material') {
          const counts = accumulator.categoryCounts as Record<string, number>
          counts[String(raw)]++
        } else {
          accumulator.min = Math.min(accumulator.min, raw)
          accumulator.max = Math.max(accumulator.max, raw)
          const delta = raw - accumulator.mean
          accumulator.mean += delta / accumulator.count
          accumulator.m2 += delta * (raw - accumulator.mean)
        }
      }
      points.push({ coordinate, position, values, validity })
    }

    const stats = {} as Record<WorldFieldMetricName, WorldFieldMetricStats>
    for (const field of WORLD_FIELD_METRIC_FIELDS) {
      const accumulator = accumulators.get(field)!
      stats[field] = field === 'material'
        ? { count: accumulator.count, invalid: accumulator.invalid, min: null, max: null, mean: null,
            standardDeviation: null, categoryCounts: { ...(accumulator.categoryCounts as Record<string, number>) } }
        : { count: accumulator.count, invalid: accumulator.invalid,
            min: accumulator.count ? accumulator.min : 0, max: accumulator.count ? accumulator.max : 0,
            mean: accumulator.count ? accumulator.mean : 0,
            standardDeviation: accumulator.count ? Math.sqrt(accumulator.m2 / accumulator.count) : 0 }
    }
    return { axis, count: points.length, points, stats }
  }

  exportProfileCSV(profile: WorldFieldProfile): string {
    if (!profile || (profile.axis !== 'x' && profile.axis !== 'y' && profile.axis !== 'z') ||
        !Array.isArray(profile.points) || profile.count !== profile.points.length) {
      throw new TypeError('A valid world field profile is required for CSV export')
    }
    const headers = [
      'axis', 'coordinate', 'x', 'y', 'z',
      ...WORLD_FIELD_METRIC_FIELDS,
      ...WORLD_FIELD_METRIC_FIELDS.map(field => field + '_valid'),
    ]
    const format = (value: number | null): string =>
      typeof value === 'number' && Number.isFinite(value) ? value.toFixed(6) : ''
    const rows = [headers.join(',')]
    for (const point of profile.points) {
      const coordinates = [point.coordinate, point.position?.x, point.position?.y, point.position?.z]
      if (!coordinates.every(value => typeof value === 'number' && Number.isFinite(value))) {
        throw new TypeError('Profile CSV contains a non-finite coordinate')
      }
      rows.push([
        profile.axis,
        ...coordinates.map(value => format(value as number)),
        ...WORLD_FIELD_METRIC_FIELDS.map(field => format(point.values?.[field] ?? null)),
        ...WORLD_FIELD_METRIC_FIELDS.map(field => point.validity?.[field] === true ? 'true' : 'false'),
      ].join(','))
    }
    return rows.join('\n')
  }

  getStats(field: WorldFieldMetricName): WorldFieldMetricStats {
    const stats = this.latestStats.get(field)
    if (!stats) throw new RangeError(`Unknown world field metric: ${field}`)
    return cloneMetricStats(stats)
  }

  getSeries(field: WorldFieldMetricName, limit = 200): WorldFieldMetricPoint[] {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Series limit must be a non-negative safe integer')
    const series = this.history.get(field)
    if (!series) throw new RangeError(`Unknown world field metric: ${field}`)
    return (limit === 0 ? [] : series.slice(-limit)).map(point => ({ ...point }))
  }

  snapshot(): Record<WorldFieldMetricName, WorldFieldMetricStats> {
    const result = {} as Record<WorldFieldMetricName, WorldFieldMetricStats>
    for (const field of WORLD_FIELD_METRIC_FIELDS) result[field] = this.getStats(field)
    return result
  }

  exportCSV(): string {
    const numericFields = WORLD_FIELD_METRIC_FIELDS.filter(field => field !== 'material')
    const materialColumns = Array.from({ length: MATERIAL_METRIC_CATEGORY_COUNT }, (_, code) => `material_${code}_count`)
    const rows = ['tick,' + [...numericFields, ...materialColumns].join(',')]
    const ticks = [...new Set([...numericFields.flatMap(field => this.history.get(field)!.map(point => point.tick)), ...this.materialCategoryHistory.map(point => point.tick)])].sort((a, b) => a - b)
    const byField = new Map(numericFields.map(field => [field, new Map(this.history.get(field)!.map(point => [point.tick, point.value]))]))
    const byMaterialTick = new Map(this.materialCategoryHistory.map(point => [point.tick, point.counts]))
    for (const tick of ticks) {
      const counts = byMaterialTick.get(tick) ?? emptyMaterialCategoryCounts()
      rows.push([String(tick), ...numericFields.map(field => byField.get(field)!.has(tick) ? byField.get(field)!.get(tick)!.toFixed(6) : ''),
        ...Array.from({ length: MATERIAL_METRIC_CATEGORY_COUNT }, (_, code) => String(counts[String(code)] ?? 0))].join(','))
    }
    return rows.join('\n')
  }

  clear(): void {
    for (const series of this.history.values()) series.length = 0
    for (const field of WORLD_FIELD_METRIC_FIELDS) this.latestStats.set(field, emptyMetricStats(field))
    this.materialCategoryHistory.length = 0
  }
}
