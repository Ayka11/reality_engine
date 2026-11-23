import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

type FieldSample = Record<string, unknown> & {
  x?: number
  y?: number
  z?: number
}

type VolumeSlice = {
  y: number
  data: {
    width: number
    height: number
    samples: Array<FieldSample | null>
  }
}

export type WorldFieldVolumeFrame = {
  slices: VolumeSlice[]
  view: {
    center: { x: number; y: number; z: number }
    sliceY: number
    visibleRadius: number
  }
  fieldIndex: number
  fieldName: string
  property: string
  maximum: number
  cols: number
  rows: number
  spacing: number
}

export type WorldFieldVolumeResult = {
  ready: boolean
  reason?: string
  renderer: 'three-webgl-instanced-volume'
  true3D: true
  renderedCells: number
  sampleCount: number
  activeCells: number
  slices: number
  meshInstances: number
  drawCalls: number
  triangles: number
  field: string
  volume: {
    sampleCount: number
    renderedCells: number
    invalidSamples: number
    duplicateCoordinates: number
    activeCells: number
    activeRatio: number
    invalidFieldValues: number
    fieldValues: { min: number; max: number; mean: number; standardDeviation: number }
    fieldProfiles: Record<string, FieldDistribution>
    uniqueLayers: number
    min: { x: number; y: number; z: number }
    max: { x: number; y: number; z: number }
    layerSpacing: { min: number; max: number; mean: number; irregular: boolean }
    bounds: { width: number; height: number; depth: number }
  }
}

type FieldDistribution = {
  sampleCount: number
  invalidValues: number
  activeCells: number
  activeRatio: number
  min: number
  max: number
  mean: number
  standardDeviation: number
}

const SCIENTIFIC_FIELD_KEYS = [
  'energy', 'density', 'information', 'entropy', 'temperature', 'biology',
] as const

const createEmptyFieldDistributions = (): Record<string, FieldDistribution> =>
  Object.fromEntries(SCIENTIFIC_FIELD_KEYS.map(key => [key, {
    sampleCount: 0,
    invalidValues: 0,
    activeCells: 0,
    activeRatio: 0,
    min: 0,
    max: 0,
    mean: 0,
    standardDeviation: 0,
  }]))

const finiteNumericValue = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const FIELD_PALETTES: ReadonlyArray<readonly [number, number]> = [
  [0x183d9b, 0xffad42],
  [0x082d31, 0x75f4c1],
  [0x35105e, 0xbdb5ff],
  [0x270b18, 0xff526d],
  [0x153d7a, 0xffe16b],
  [0x0d4c29, 0xa1ff65],
]

/**
 * Actual 3D field preview built from samples read from the authoritative WorldField.
 * Instances are voxels in a WebGL scene, not a 2D projection painted onto a canvas.
 */
export class WorldFieldVolumeRenderer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500)
  readonly controls: OrbitControls

  private readonly geometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.58,
    metalness: 0.08,
  })
  private mesh: THREE.InstancedMesh | null = null
  private meshCapacity = 0
  private gridHelper: THREE.GridHelper | null = null
  private gridSize = 0
  private width = 0
  private height = 0
  private cameraFramed = false
  private cameraInteracted = false
  private lastFramedRadius = 0
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly scale = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private readonly color = new THREE.Color()
  private readonly highColor = new THREE.Color()
  private volumeDiagnostics = {
    sampleCount: 0,
    renderedCells: 0,
    invalidSamples: 0,
    duplicateCoordinates: 0,
    activeCells: 0,
    activeRatio: 0,
    invalidFieldValues: 0,
    fieldValues: { min: 0, max: 0, mean: 0, standardDeviation: 0 },
    fieldProfiles: createEmptyFieldDistributions(),
    uniqueLayers: 0,
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
    layerSpacing: { min: 0, max: 0, mean: 0, irregular: false },
    bounds: { width: 0, height: 0, depth: 0 },
  }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x050812, 1)
    this.scene.background = new THREE.Color(0x050812)
    this.scene.fog = new THREE.Fog(0x050812, 34, 120)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enabled = true
    this.controls.enableRotate = true
    this.controls.enableZoom = true
    this.controls.enablePan = true
    this.controls.enableDamping = false
    this.controls.minDistance = 3
    this.controls.maxDistance = 100
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.target.set(0, 0, 0)
    this.controls.addEventListener('start', () => {
      this.cameraInteracted = true
    })
    this.controls.addEventListener('change', () => this.draw())

    this.scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x253149, 2.1))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
    keyLight.position.set(10, 18, 12)
    this.scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0x6e9dff, 0.65)
    fillLight.position.set(-12, 8, -8)
    this.scene.add(fillLight)

    this.resize()
  }

  resize(): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false

    const width = Math.max(1, Math.floor(rect.width))
    const height = Math.max(1, Math.floor(rect.height))
    if (width !== this.width || height !== this.height) {
      this.width = width
      this.height = height
      this.renderer.setSize(width, height, false)
    }

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    return true
  }

  render(frame: WorldFieldVolumeFrame): WorldFieldVolumeResult {
    this.volumeDiagnostics = {
      sampleCount: 0,
      renderedCells: 0,
      invalidSamples: 0,
      duplicateCoordinates: 0,
      activeCells: 0,
      activeRatio: 0,
      invalidFieldValues: 0,
      fieldValues: { min: 0, max: 0, mean: 0, standardDeviation: 0 },
      fieldProfiles: createEmptyFieldDistributions(),
      uniqueLayers: 0,
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
      layerSpacing: { min: 0, max: 0, mean: 0, irregular: false },
      bounds: { width: 0, height: 0, depth: 0 },
    }
    const base = {
      renderer: 'three-webgl-instanced-volume' as const,
      true3D: true as const,
      renderedCells: 0,
      sampleCount: 0,
      activeCells: 0,
      slices: frame.slices.length,
      meshInstances: 0,
      drawCalls: 0,
      triangles: 0,
      field: frame.fieldName,
      volume: {
        ...this.volumeDiagnostics,
        min: { ...this.volumeDiagnostics.min },
        max: { ...this.volumeDiagnostics.max },
        layerSpacing: { ...this.volumeDiagnostics.layerSpacing },
        bounds: { ...this.volumeDiagnostics.bounds },
      },
    }

    if (!this.resize()) return { ...base, ready: false, reason: 'zero-layout' }

    const capacity = frame.slices.reduce(
      (total, slice) => total + (slice.data.samples?.length ?? 0),
      0,
    )
    if (capacity <= 0) {
      if (this.mesh) this.mesh.count = 0
      return { ...base, ready: false, reason: 'no-field-samples' }
    }

    if (!this.mesh || this.meshCapacity < capacity) {
      if (this.mesh) {
        this.scene.remove(this.mesh)
        this.mesh.dispose()
      }
      this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity)
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.meshCapacity = capacity
      this.scene.add(this.mesh)
    }

    const selectedFieldIndex = Number.isInteger(frame.fieldIndex) && frame.fieldIndex >= 0 && frame.fieldIndex < SCIENTIFIC_FIELD_KEYS.length
      ? frame.fieldIndex
      : -1
    const fieldMaxima = SCIENTIFIC_FIELD_KEYS.map(key => {
      let observed = 0
      for (const slice of frame.slices) {
        for (const sample of slice.data.samples ?? []) {
          const value = finiteNumericValue(sample?.[key])
          if (value !== null) observed = Math.max(observed, Math.abs(value))
        }
      }
      return Math.max(observed, 1e-9)
    })
    const maximum = Math.max(0.000001, Math.abs(Number(frame.maximum) || fieldMaxima[selectedFieldIndex >= 0 ? selectedFieldIndex : 0]))
    const palette = FIELD_PALETTES[selectedFieldIndex >= 0 ? selectedFieldIndex : 0]
    let renderedCells = 0
    let activeCells = 0
    let sampleCount = 0
    let invalidSamples = 0
    let invalidFieldValues = 0
    let fieldValueMin = Number.POSITIVE_INFINITY
    let fieldValueMax = Number.NEGATIVE_INFINITY
    let fieldValueMean = 0
    let fieldValueM2 = 0
    const fieldProfileAccumulators = Object.fromEntries(SCIENTIFIC_FIELD_KEYS.map(key => [key, {
      sampleCount: 0, invalidValues: 0, activeCells: 0,
      min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY,
      mean: 0, m2: 0,
    }]))
    let duplicateCoordinates = 0
    const coordinateKeys = new Set<string>()
    const layerCoordinates = new Set<number>()
    const bounds = {
      minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY, maxZ: Number.NEGATIVE_INFINITY,
    }
    // The samples are taken in world coordinates by FieldSampler. Render them
    // in a normalized local volume so X/Z cell spacing and Y slice spacing use
    // the same coordinate contract instead of an arbitrary visual layer offset.
    const spacing = Math.max(1, Number(frame.spacing) || 1)
    const cellWidth = (Math.max(1, Number(frame.view.visibleRadius) * 2)) / Math.max(1, frame.cols)
    const cellDepth = (Math.max(1, Number(frame.view.visibleRadius) * 2)) / Math.max(1, frame.rows)
    const cellSize = 0.96
    const centerY = Number.isFinite(frame.view.sliceY) ? frame.view.sliceY : 0
    const localBounds = {
      minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY, maxZ: Number.NEGATIVE_INFINITY,
    }

    for (let sliceIndex = 0; sliceIndex < frame.slices.length; sliceIndex++) {
      const slice = frame.slices[sliceIndex]
      const data = slice.data
      for (let py = 0; py < data.height; py++) {
        for (let px = 0; px < data.width; px++) {
          const sample = data.samples[py * data.width + px]
          if (!sample) continue
          sampleCount++

          // Do not reconstruct positions from array indices: the sample's
          // world-space coordinates are authoritative and remain aligned with
          // the shared WorldViewContract even when the view is panned.
          const sampleX = finiteNumericValue(sample.x)
          const sampleZ = finiteNumericValue(sample.z)
          // FieldSampler.sampleWorld() records the sampled Y plane in sample.y.
          // The independent volumetric coordinate belongs to the slice descriptor.
          const sliceY = finiteNumericValue(slice.y)
          if (sampleX === null || sampleZ === null || sliceY === null) {
            invalidSamples++
            continue
          }
          const coordinateKey = `${sampleX}|${sliceY}|${sampleZ}`
          if (coordinateKeys.has(coordinateKey)) duplicateCoordinates++
          else coordinateKeys.add(coordinateKey)
          layerCoordinates.add(sliceY)
          bounds.minX = Math.min(bounds.minX, sampleX)
          bounds.maxX = Math.max(bounds.maxX, sampleX)
          bounds.minY = Math.min(bounds.minY, sliceY)
          bounds.maxY = Math.max(bounds.maxY, sliceY)
          bounds.minZ = Math.min(bounds.minZ, sampleZ)
          bounds.maxZ = Math.max(bounds.maxZ, sampleZ)

          for (const key of SCIENTIFIC_FIELD_KEYS) {
            const profile = fieldProfileAccumulators[key]
            const rawFieldValue = finiteNumericValue(sample[key])
            if (rawFieldValue === null) {
              profile.invalidValues++
              continue
            }
            profile.sampleCount++
            profile.min = Math.min(profile.min, rawFieldValue)
            profile.max = Math.max(profile.max, rawFieldValue)
            const delta = rawFieldValue - profile.mean
            profile.mean += delta / profile.sampleCount
            profile.m2 += delta * (rawFieldValue - profile.mean)
            if (Math.abs(rawFieldValue) > 0.001) profile.activeCells++
          }
          const selectedRawValue = selectedFieldIndex >= 0 ? finiteNumericValue(sample[SCIENTIFIC_FIELD_KEYS[selectedFieldIndex]]) : 0
          const finiteValues = SCIENTIFIC_FIELD_KEYS.map(key => finiteNumericValue(sample[key]))
          const validValues = finiteValues.filter((value): value is number => value !== null)
          const compositeStrength = validValues.length
            ? finiteValues.reduce((sum, value, index) => sum + (value !== null ? Math.abs(value) / fieldMaxima[index] : 0), 0) / validValues.length
            : 0
          const rawValue = selectedFieldIndex >= 0 ? selectedRawValue : compositeStrength
          const value = rawValue !== null ? rawValue : 0
          if (selectedFieldIndex >= 0 && rawValue === null) invalidFieldValues++
          fieldValueMin = Math.min(fieldValueMin, value)
          fieldValueMax = Math.max(fieldValueMax, value)
          const valueCount = renderedCells + 1
          const valueDelta = value - fieldValueMean
          fieldValueMean += valueDelta / valueCount
          fieldValueM2 += valueDelta * (value - fieldValueMean)
          const normalized = selectedFieldIndex >= 0
            ? THREE.MathUtils.clamp(Math.abs(value) / maximum, 0, 1)
            : THREE.MathUtils.clamp(compositeStrength, 0, 1)
          const x = (sampleX - frame.view.center.x) / cellWidth
          const y = (sliceY - centerY) / spacing
          const z = (sampleZ - frame.view.center.z) / cellDepth
          localBounds.minX = Math.min(localBounds.minX, x)
          localBounds.maxX = Math.max(localBounds.maxX, x)
          localBounds.minY = Math.min(localBounds.minY, y)
          localBounds.maxY = Math.max(localBounds.maxY, y)
          localBounds.minZ = Math.min(localBounds.minZ, z)
          localBounds.maxZ = Math.max(localBounds.maxZ, z)

          this.position.set(x, y, z)
          this.scale.set(cellWidth > 0 ? cellSize : 0, cellSize, cellDepth > 0 ? cellSize : 0)
          this.matrix.compose(this.position, this.quaternion, this.scale)
          this.mesh.setMatrixAt(renderedCells, this.matrix)

          if (selectedFieldIndex >= 0) {
            this.color.setHex(palette[0]).lerp(this.highColor.setHex(palette[1]), normalized)
          } else {
            let red = 0, green = 0, blue = 0, weight = 0
            for (let field = 0; field < SCIENTIFIC_FIELD_KEYS.length; field++) {
              const fieldValue = finiteNumericValue(sample[SCIENTIFIC_FIELD_KEYS[field]])
              if (fieldValue === null) continue
              const contribution = THREE.MathUtils.clamp(Math.abs(fieldValue) / fieldMaxima[field], 0, 1)
              if (contribution <= 0) continue
              const colors = FIELD_PALETTES[field]
              this.highColor.setHex(colors[0]).lerp(this.color.setHex(colors[1]), contribution)
              red += this.highColor.r * contribution
              green += this.highColor.g * contribution
              blue += this.highColor.b * contribution
              weight += contribution
            }
            if (weight > 0) this.color.setRGB(red / weight, green / weight, blue / weight)
            else this.color.setHex(0x182235)
          }
          this.mesh.setColorAt(renderedCells, this.color)
          renderedCells++
          if (normalized > 0.001) activeCells++
        }
      }
    }

    this.mesh.count = renderedCells
    const sortedLayers = [...layerCoordinates].sort((a, b) => a - b)
    const layerGaps = sortedLayers.slice(1).map((value, index) => value - sortedLayers[index])
    const minLayerGap = layerGaps.length ? Math.min(...layerGaps) : 0
    const maxLayerGap = layerGaps.length ? Math.max(...layerGaps) : 0
    const meanLayerGap = layerGaps.length ? layerGaps.reduce((sum, value) => sum + value, 0) / layerGaps.length : 0
    const finiteBounds = renderedCells > 0
    this.volumeDiagnostics = {
      sampleCount,
      renderedCells,
      invalidSamples,
      duplicateCoordinates,
      activeCells,
      activeRatio: renderedCells ? activeCells / renderedCells : 0,
      invalidFieldValues,
      fieldValues: {
        min: renderedCells ? fieldValueMin : 0,
        max: renderedCells ? fieldValueMax : 0,
        mean: renderedCells ? fieldValueMean : 0,
        standardDeviation: renderedCells ? Math.sqrt(fieldValueM2 / renderedCells) : 0,
      },
      fieldProfiles: Object.fromEntries(SCIENTIFIC_FIELD_KEYS.map(key => {
        const profile = fieldProfileAccumulators[key]
        return [key, {
          sampleCount: profile.sampleCount,
          invalidValues: profile.invalidValues,
          activeCells: profile.activeCells,
          activeRatio: profile.sampleCount ? profile.activeCells / profile.sampleCount : 0,
          min: profile.sampleCount ? profile.min : 0,
          max: profile.sampleCount ? profile.max : 0,
          mean: profile.sampleCount ? profile.mean : 0,
          standardDeviation: profile.sampleCount ? Math.sqrt(profile.m2 / profile.sampleCount) : 0,
        }]
      })),
      uniqueLayers: sortedLayers.length,
      min: finiteBounds ? { x: bounds.minX, y: bounds.minY, z: bounds.minZ } : { x: 0, y: 0, z: 0 },
      max: finiteBounds ? { x: bounds.maxX, y: bounds.maxY, z: bounds.maxZ } : { x: 0, y: 0, z: 0 },
      layerSpacing: {
        min: minLayerGap,
        max: maxLayerGap,
        mean: meanLayerGap,
        irregular: layerGaps.length > 1 && maxLayerGap - minLayerGap > 1e-6,
      },
      bounds: finiteBounds ? {
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
        depth: bounds.maxZ - bounds.minZ,
      } : { width: 0, height: 0, depth: 0 },
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true

    const gridSize = Math.max(8, Math.max(frame.cols, frame.rows) + 2)
    if (!this.gridHelper || this.gridSize !== gridSize) {
      if (this.gridHelper) {
        this.scene.remove(this.gridHelper)
        this.gridHelper.geometry.dispose()
        const material = this.gridHelper.material
        if (Array.isArray(material)) material.forEach(item => item.dispose())
        else material.dispose()
      }
      this.gridHelper = new THREE.GridHelper(gridSize, gridSize, 0x405779, 0x273650)
      this.gridSize = gridSize
      this.scene.add(this.gridHelper)
    }
    const layerOffsets = frame.slices.map(
      slice => (slice.y - centerY) / spacing,
    )
    const lowestLayer = layerOffsets.length ? Math.min(...layerOffsets) : 0
    this.gridHelper.position.y = lowestLayer - 0.14

    if (renderedCells > 0) {
      const center = new THREE.Vector3(
        (localBounds.minX + localBounds.maxX) / 2,
        (localBounds.minY + localBounds.maxY) / 2,
        (localBounds.minZ + localBounds.maxZ) / 2,
      )
      const halfWidth = (localBounds.maxX - localBounds.minX) / 2 + cellSize
      const halfHeight = (localBounds.maxY - localBounds.minY) / 2 + cellSize
      const halfDepth = (localBounds.maxZ - localBounds.minZ) / 2 + cellSize
      const radius = Math.max(1, Math.hypot(halfWidth, halfHeight, halfDepth))
      const shouldFrame = !this.cameraFramed ||
        (!this.cameraInteracted && radius > this.lastFramedRadius * 1.25)
      if (shouldFrame) {
        const verticalHalfFov = THREE.MathUtils.degToRad(this.camera.fov / 2)
        const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(0.1, this.camera.aspect))
        const limitingHalfFov = Math.max(0.05, Math.min(verticalHalfFov, horizontalHalfFov))
        const distance = Math.min(this.controls.maxDistance, Math.max(
          this.controls.minDistance,
          (radius / Math.sin(limitingHalfFov)) * 1.18,
        ))
        const direction = new THREE.Vector3(1, 0.82, 1).normalize()
        this.controls.target.copy(center)
        this.camera.position.copy(center).addScaledVector(direction, distance)
        this.camera.near = Math.max(0.1, distance / 100)
        this.camera.far = Math.max(500, distance * 8)
        this.camera.updateProjectionMatrix()
        this.controls.update()
        this.lastFramedRadius = radius
        this.cameraFramed = true
      }
    }

    this.renderer.render(this.scene, this.camera)
    return {
      ...base,
      ready: renderedCells > 0,
      renderedCells,
      sampleCount,
      activeCells,
      volume: {
        ...this.volumeDiagnostics,
        min: { ...this.volumeDiagnostics.min },
        max: { ...this.volumeDiagnostics.max },
        layerSpacing: { ...this.volumeDiagnostics.layerSpacing },
        bounds: { ...this.volumeDiagnostics.bounds },
      },
      meshInstances: this.mesh.count,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      ...(renderedCells > 0 ? {} : { reason: 'no-valid-field-samples' }),
    }
  }

  diagnostics() {
    return {
      renderer: 'three-webgl-instanced-volume',
      true3D: true,
      canvasWidth: this.renderer.domElement.width,
      canvasHeight: this.renderer.domElement.height,
      meshInstances: this.mesh?.count ?? 0,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      volume: {
        ...this.volumeDiagnostics,
        min: { ...this.volumeDiagnostics.min },
        max: { ...this.volumeDiagnostics.max },
        bounds: { ...this.volumeDiagnostics.bounds },
        layerSpacing: { ...this.volumeDiagnostics.layerSpacing },
      },
    }
  }

  /**
   * Return detached input/camera state for browser acceptance and support
   * diagnostics. Never expose OrbitControls, Camera, Vector3 or live Three.js
   * objects through the browser-facing renderer facade.
   */
  interactionDiagnostics() {
    const position = this.camera.position
    const target = this.controls.target
    return {
      enabled: this.controls.enabled,
      rotating: this.controls.enableRotate,
      zooming: this.controls.enableZoom,
      panning: this.controls.enablePan,
      cameraPosition: [position.x, position.y, position.z] as [number, number, number],
      target: [target.x, target.y, target.z] as [number, number, number],
      distance: position.distanceTo(target),
    }
  }

  private draw() {
    if (this.width < 1 || this.height < 1) return
    this.renderer.render(this.scene, this.camera)
  }
}
