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
}

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
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly scale = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private readonly color = new THREE.Color()
  private readonly highColor = new THREE.Color()

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
    this.controls.enableDamping = false
    this.controls.minDistance = 3
    this.controls.maxDistance = 100
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.target.set(0, 0, 0)
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

    const maximum = Math.max(0.000001, Math.abs(Number(frame.maximum) || 1))
    const palette = FIELD_PALETTES[Math.max(0, Math.min(FIELD_PALETTES.length - 1, frame.fieldIndex))]
      ?? FIELD_PALETTES[0]
    let renderedCells = 0
    let activeCells = 0
    const layerSeparation = 2.2
    const spacing = Math.max(1, Number(frame.spacing) || 1)

    for (let sliceIndex = 0; sliceIndex < frame.slices.length; sliceIndex++) {
      const slice = frame.slices[sliceIndex]
      const data = slice.data
      const layerY = ((slice.y - frame.view.sliceY) / spacing) * layerSeparation
      for (let py = 0; py < data.height; py++) {
        for (let px = 0; px < data.width; px++) {
          const sample = data.samples[py * data.width + px]
          if (!sample) continue

          const value = Number(sample[frame.property]) || 0
          const normalized = THREE.MathUtils.clamp(value / maximum, 0, 1)
          const cellHeight = 0.12 + normalized * 1.28
          const x = px - (data.width - 1) / 2
          const z = py - (data.height - 1) / 2

          this.position.set(x, layerY + cellHeight / 2, z)
          this.scale.set(0.82, cellHeight, 0.82)
          this.matrix.compose(this.position, this.quaternion, this.scale)
          this.mesh.setMatrixAt(renderedCells, this.matrix)

          this.color.setHex(palette[0]).lerp(this.highColor.setHex(palette[1]), normalized)
          this.mesh.setColorAt(renderedCells, this.color)
          renderedCells++
          if (normalized > 0.001) activeCells++
        }
      }
    }

    this.mesh.count = renderedCells
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
      slice => ((slice.y - frame.view.sliceY) / spacing) * layerSeparation,
    )
    const lowestLayer = layerOffsets.length ? Math.min(...layerOffsets) : 0
    this.gridHelper.position.y = lowestLayer - 0.14

    if (!this.cameraFramed) {
      const span = Math.max(frame.cols, frame.rows, frame.slices.length * 2.2, 6)
      this.camera.position.set(span * 1.15, span * 0.95 + 2, span * 1.25)
      this.controls.target.set(0, 0.15, 0)
      this.controls.update()
      this.cameraFramed = true
    }

    this.renderer.render(this.scene, this.camera)
    return {
      ...base,
      ready: renderedCells > 0,
      renderedCells,
      sampleCount: renderedCells,
      activeCells,
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
    }
  }

  private draw() {
    if (this.width < 1 || this.height < 1) return
    this.renderer.render(this.scene, this.camera)
  }
}
