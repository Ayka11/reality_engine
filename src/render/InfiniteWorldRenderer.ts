import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { InfiniteChunkManager } from '../infinity/ChunkManager'
import { WorldGenerator, BIOME_ID, type WorldChunk } from '../infinity/WorldGenerator'
import { worldToChunk, WORLD_CHUNK_SIZE, type ChunkCoord } from '../infinity/WorldCoordinate'
import { WorldObjectManager } from '../infinity/ObjectManager'
import { OBJECT_CATALOG } from '../infinity/ObjectCatalog'
import type { WorldObject, WorldObjectKind } from '../infinity/WorldObject'

type TerrainPatch = { group: THREE.Group; chunk: WorldChunk }
type ObjectMesh = { object: WorldObject; group: THREE.Group }

const BIOME_COLORS: Record<number, number> = {
  [BIOME_ID.ocean]: 0x244f86,
  [BIOME_ID.coast]: 0x8d9f61,
  [BIOME_ID.plains]: 0x6e9a4d,
  [BIOME_ID.forest]: 0x2f6b3d,
  [BIOME_ID.desert]: 0xc9a35c,
  [BIOME_ID.tundra]: 0x9aa7a0,
  [BIOME_ID.mountain]: 0x74746f,
  [BIOME_ID.alpine]: 0xd7d9d5,
}

export class InfiniteWorldRenderer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100000)
  readonly controls: OrbitControls
  readonly generator: WorldGenerator
  readonly chunks: InfiniteChunkManager
  readonly objects = new WorldObjectManager()

  private patches = new Map<string, TerrainPatch>()
  private objectMeshes = new Map<string, ObjectMesh>()
  private waterMeshes = new Map<string, THREE.Mesh>()
  private dummy = new THREE.Object3D()
  private enabled = true
  private lastCenter: ChunkCoord | null = null
  private worldY = 45
  private readonly patchResolution = 16
  private readonly patchScale = WORLD_CHUNK_SIZE / this.patchResolution

  constructor(canvas: HTMLCanvasElement, seed = 'reality-engine-infinity-v1') {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), false)
    this.renderer.shadowMap.enabled = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping

    this.generator = new WorldGenerator(seed)
    this.chunks = new InfiniteChunkManager(this.generator, { radius: 3, verticalRadius: 0, maxLoaded: 49 })

    this.camera.position.set(28, this.worldY, 52)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.minDistance = 6
    this.controls.maxDistance = 240
    this.controls.target.set(16, 10, 16)

    const hemi = new THREE.HemisphereLight(0xb9d8ff, 0x35402f, 1.6)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(300, 500, 180)
    this.scene.add(sun)

    const water = new THREE.MeshBasicMaterial({ color: 0x2b78b5, transparent: true, opacity: 0.48 })
    void water

    this.scene.background = new THREE.Color(0x9bb8d6)
    this.scene.fog = new THREE.Fog(0x9bb8d6, 180, 900)
  }

  setEnabled(value: boolean) {
    this.enabled = value
    this.controls.enabled = value
  }

  get isEnabled() { return this.enabled }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private chunkCenter(): ChunkCoord {
    const w = worldToChunk(this.camera.position.x, 0, this.camera.position.z)
    return w.chunk
  }

  private buildTerrainPatch(chunk: WorldChunk): THREE.Group {
    const group = new THREE.Group()
    const geometry = new THREE.BufferGeometry()
    const n = this.patchResolution + 1
    const positions = new Float32Array(n * n * 3)
    const normals = new Float32Array(n * n * 3)
    const colors = new Float32Array(n * n * 3)
    const indices: number[] = []

    const originX = chunk.cx * WORLD_CHUNK_SIZE
    const originZ = chunk.cz * WORLD_CHUNK_SIZE

    const sample = (gx: number, gz: number) => {
      const lx = Math.min(WORLD_CHUNK_SIZE - 1, Math.floor(gx))
      const lz = Math.min(WORLD_CHUNK_SIZE - 1, Math.floor(gz))
      return chunk.heights[lz * WORLD_CHUNK_SIZE + lx]
    }

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x
        const gx = x * this.patchScale
        const gz = z * this.patchScale
        const h = this.generator.sampleHeight(originX + gx, originZ + gz)
        positions[i * 3] = originX + gx
        positions[i * 3 + 1] = h
        positions[i * 3 + 2] = originZ + gz

        const hL = this.generator.sampleHeight(originX + gx - 1, originZ + gz)
        const hR = this.generator.sampleHeight(originX + gx + 1, originZ + gz)
        const hD = this.generator.sampleHeight(originX + gx, originZ + gz - 1)
        const hU = this.generator.sampleHeight(originX + gx, originZ + gz + 1)
        const normal = new THREE.Vector3(hL - hR, 2, hD - hU).normalize()
        normals[i * 3] = normal.x
        normals[i * 3 + 1] = normal.y
        normals[i * 3 + 2] = normal.z

        const biome = this.generator.sampleClimate(originX + gx, originZ + gz, h).biome
        const color = new THREE.Color(BIOME_COLORS[BIOME_ID[biome]])
        const slope = Math.max(0, 1 - normal.y)
        color.offsetHSL(0, 0, -slope * 0.18)
        colors[i * 3] = color.r
        colors[i * 3 + 1] = color.g
        colors[i * 3 + 2] = color.b
      }
    }

    for (let z = 0; z < this.patchResolution; z++) {
      for (let x = 0; x < this.patchResolution; x++) {
        const a = z * n + x
        const b = a + 1
        const c = a + n
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setIndex(indices)
    geometry.computeBoundingSphere()

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
    const mesh = new THREE.Mesh(geometry, material)
    group.add(mesh)

    const waterGeometry = new THREE.PlaneGeometry(WORLD_CHUNK_SIZE, WORLD_CHUNK_SIZE)
    waterGeometry.rotateX(-Math.PI / 2)
    const waterMaterial = new THREE.MeshBasicMaterial({ color: 0x2b78b5, transparent: true, opacity: 0.42, depthWrite: false })
    const water = new THREE.Mesh(waterGeometry, waterMaterial)
    water.position.set(originX + WORLD_CHUNK_SIZE / 2, this.generator.seaLevel + 0.05, originZ + WORLD_CHUNK_SIZE / 2)
    group.add(water)
    this.waterMeshes.set(`${chunk.cx},${chunk.cy},${chunk.cz}`, water)

    void sample
    return group
  }

  private removeChunk(key: string) {
    const patch = this.patches.get(key)
    if (!patch) return
    patch.group.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
      else if (mesh.material) mesh.material.dispose()
    })
    this.scene.remove(patch.group)
    this.patches.delete(key)
    this.waterMeshes.delete(key)
  }

  private syncChunks() {
    const center = this.chunkCenter()
    if (this.lastCenter && center.cx === this.lastCenter.cx && center.cz === this.lastCenter.cz) return
    this.lastCenter = center
    const delta = this.chunks.update(center)

    for (const chunk of delta.loaded) {
      const key = `${chunk.cx},${chunk.cy},${chunk.cz}`
      if (!this.patches.has(key)) {
        const group = this.buildTerrainPatch(chunk)
        this.patches.set(key, { group, chunk })
        this.scene.add(group)
      }
    }
    for (const key of delta.unloaded) this.removeChunk(key)
    this.syncObjects()
  }

  private makeObject(object: WorldObject): THREE.Group {
    const g = new THREE.Group()
    const s = Math.max(0.1, object.scale)
    let mesh: THREE.Object3D

    const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
    switch (object.kind) {
      case 'tree': {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.4, 7), mat(0x6b4728))
        trunk.position.y = 1.2
        const crown = new THREE.Mesh(new THREE.ConeGeometry(1.25, 3.4, 8), mat(0x2d713b))
        crown.position.y = 3.25
        g.add(trunk, crown)
        mesh = g
        break
      }
      case 'rock':
        mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1.1, 0), mat(0x777b7b))
        break
      case 'crystal':
        mesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.25, 0), mat(0x8a6de0))
        break
      case 'building':
        mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 4), mat(0x8b9099))
        ;(mesh as THREE.Mesh).position.y = 2.5
        break
      case 'road':
        mesh = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 24), mat(0x3e4145))
        ;(mesh as THREE.Mesh).position.y = 0.08
        break
      case 'bridge':
        mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 0.6, 22), mat(0x6a5540))
        ;(mesh as THREE.Mesh).position.y = 0.35
        break
      case 'water':
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.3, 24), new THREE.MeshBasicMaterial({ color: 0x2b78b5, transparent: true, opacity: 0.65 }))
        ;(mesh as THREE.Mesh).position.y = 0.15
        break
      case 'spawn':
        mesh = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.12, 8, 32), mat(0xf0d45c))
        ;(mesh as THREE.Mesh).rotation.x = Math.PI / 2
        break
      case 'landmark':
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 5, 8), mat(0xb8b1a1))
        ;(mesh as THREE.Mesh).position.y = 2.5
        break
      default:
        mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat(0xc0c0c0))
        ;(mesh as THREE.Mesh).position.y = 1
    }

    if (mesh !== g) g.add(mesh)
    g.position.set(object.x, object.y, object.z)
    g.rotation.y = object.rotationY
    g.scale.setScalar(s)
    return g
  }

  private syncObjects() {
    const center = this.camera.position
    const range = (this.chunks.radius + 1) * WORLD_CHUNK_SIZE
    const visible = this.objects.query({
      minX: center.x - range, maxX: center.x + range,
      minZ: center.z - range, maxZ: center.z + range,
    })
    const keep = new Set<string>()
    for (const object of visible) {
      keep.add(object.id)
      if (!this.objectMeshes.has(object.id)) {
        const group = this.makeObject(object)
        this.objectMeshes.set(object.id, { object, group })
        this.scene.add(group)
      }
    }
    for (const [id, entry] of this.objectMeshes) {
      if (!keep.has(id)) {
        this.scene.remove(entry.group)
        entry.group.traverse(obj => {
          const mesh = obj as THREE.Mesh
          if (mesh.geometry) mesh.geometry.dispose()
          if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => m.dispose())
        })
        this.objectMeshes.delete(id)
      }
    }
  }

  place(kind: WorldObjectKind, x: number, z: number, y?: number, scale = 1) {
    const ground = y ?? this.generator.sampleHeight(x, z)
    const object = this.objects.add({
      kind, x, y: ground, z,
      rotationY: 0, scale, seed: 0, properties: {},
    })
    this.syncObjects()
    return object
  }

  erase(x: number, y: number, z: number, radius = 2) {
    const removed = this.objects.query({
      minX: x - radius, maxX: x + radius,
      minY: y - radius, maxY: y + radius,
      minZ: z - radius, maxZ: z + radius,
    })
    for (const object of removed) this.objects.remove(object.id)
    this.syncObjects()
    return removed.map(o => o.id)
  }

  scatter(kind: WorldObjectKind, x0: number, z0: number, x1: number, z1: number, density = 0.15) {
    const objects = this.objects.scatter(this.generator.seed, kind, x0, z0, x1, z1, 32, density)
    for (const object of objects) object.y = this.generator.sampleHeight(object.x, object.z)
    this.syncObjects()
    return objects
  }

  render(dt = 0.016) {
    if (!this.enabled) return
    this.controls.update()
    this.syncChunks()
    this.syncObjects()
    this.renderer.render(this.scene, this.camera)
    void dt
  }

  getLoadedChunkCount() { return this.patches.size }
  getObjectCount() { return this.objects.size }
}
