/**
 * Chunk-aware Three.js PBR renderer.
 * Supports field-colored layer mode, per-material PBR mode, and height-gradient mode.
 * Features: multi-material instanced meshes, particle system, time-of-day lighting,
 *   camera presets (orbit/top/iso/street/fly), fog control, z-slice cutting plane.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  NF, F, GRID_W, GRID_H, GRID_D, CX, CY, CZ, CHUNK_FLOATS, decodeChunkKey,
} from '../core/ChunkGrid'
import {
  classifyVoxel, getMat, blendEnergyGlow, lerpPalette, LAYER_PALS,
  type MatType,
} from './VoxelMaterials'

// Field lookup (layer index → F.* index, and display max)
const LAYER_FIELD = [F.E, F.D, F.I, F.S, F.T, F.BIO]
const LAYER_MAX   = [1000, 1, 500, 1, 800, 1]

const MAT_TYPES: MatType[] = ['rock','metal','organic','energy','crystal','water','plasma','road','neural']

export class ChunkRenderer {
  renderer: THREE.WebGLRenderer
  scene:    THREE.Scene
  camera:   THREE.PerspectiveCamera
  controls: OrbitControls

  // Internal shadow copy of all chunks (for full rebuilds on mode/layer change)
  private shadowChunks = new Map<number, Float32Array>()

  // Layer-colored single instanced mesh
  private layerMesh!: THREE.InstancedMesh

  // Per-material meshes for material mode
  private matMeshes = new Map<MatType, THREE.InstancedMesh>()
  private matCounts = new Map<MatType, number>()

  // Agent mesh
  private agentMesh!: THREE.InstancedMesh

  // Particle systems
  private smokePts!:  THREE.Points
  private sparkPts!:  THREE.Points

  // Lights
  private sunLight!:  THREE.DirectionalLight
  private fillLight!: THREE.DirectionalLight
  private ambLight!:  THREE.AmbientLight
  private sceneFog!:  THREE.FogExp2

  private dummy = new THREE.Object3D()
  private col3  = new THREE.Color()

  private readonly MAX_INST     = 800_000
  private readonly PER_MAT_INST = Math.floor(800_000 / MAT_TYPES.length)
  private readonly VOXEL_THRESH = 0.8

  // Public state
  layer         = 0
  matMode: 'field' | 'material' | 'height' = 'field'
  zSlice        = GRID_D - 1
  showParticles = true
  showAgents    = true
  emissiveMult  = 1.5
  voxelSize     = 0.88

  private camPreset: 'orbit' | 'top' | 'iso' | 'street' | 'fly' = 'orbit'
  private flyAngle  = 0

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = false

    this.scene = new THREE.Scene()
    this.sceneFog = new THREE.FogExp2(0x060810, 0.005)
    this.scene.fog = this.sceneFog
    this.scene.background = new THREE.Color(0x060810)

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1400)
    this.camera.position.set(GRID_W * 0.9, GRID_W * 0.55, GRID_H * 0.85)

    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.target.set(GRID_W / 2, 14, GRID_H / 2)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.07
    this.controls.minDistance   = 8
    this.controls.maxDistance   = 700

    this._setupLights()
    this._setupMeshes()
    this._setupParticles()
    this._setupGround()
    this._setupResize()
  }

  // ── Lights ──────────────────────────────────────────────────────────────────

  private _setupLights() {
    this.ambLight = new THREE.AmbientLight(0x111128, 1.5)
    this.scene.add(this.ambLight)

    this.sunLight = new THREE.DirectionalLight(0xfff8e8, 3.5)
    this.sunLight.position.set(GRID_W, GRID_W * 1.4, GRID_H * 0.5)
    this.scene.add(this.sunLight)

    this.fillLight = new THREE.DirectionalLight(0x1a3060, 0.7)
    this.fillLight.position.set(-GRID_W * 0.5, GRID_W, GRID_H * 0.3)
    this.scene.add(this.fillLight)

    const rim = new THREE.DirectionalLight(0x301560, 0.4)
    rim.position.set(0, -50, GRID_H)
    this.scene.add(rim)
  }

  // ── Meshes ───────────────────────────────────────────────────────────────────

  private _setupMeshes() {
    const geo = new THREE.BoxGeometry(this.voxelSize, this.voxelSize, this.voxelSize)

    // ── Layer mesh (field-colored, custom emissive shader) ──
    const layerMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: .65, metalness: .08,
    })
    const emMult = this.emissiveMult.toFixed(2)
    layerMat.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec3 vEmi;\n' + shader.vertexShader.replace(
        '#include <color_vertex>',
        `#include <color_vertex>
         float b = dot(vColor.rgb, vec3(.3,.59,.11));
         vEmi = vColor.rgb * pow(b, 1.6) * ${emMult};`,
      )
      shader.fragmentShader = 'varying vec3 vEmi;\n' + shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `totalEmissiveRadiance = vEmi;`,
      )
    }
    this.layerMesh = new THREE.InstancedMesh(geo, layerMat, this.MAX_INST)
    this.layerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.layerMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.MAX_INST * 3), 3,
    )
    this.layerMesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    this.layerMesh.count = 0
    this.scene.add(this.layerMesh)

    // ── Per-material meshes (PBR-correct, separate draw call per mat) ──
    for (const type of MAT_TYPES) {
      const vm = getMat(type)
      const mat = new THREE.MeshStandardMaterial({
        vertexColors:       true,
        roughness:          vm.rough,
        metalness:          vm.metal,
        transparent:        vm.transparent,
        opacity:            vm.alpha,
        emissive:           new THREE.Color(vm.emissR, vm.emissG, vm.emissB),
        emissiveIntensity:  vm.emissStr,
        ...(vm.transparent ? { depthWrite: false } : {}),
      })
      const mesh = new THREE.InstancedMesh(geo, mat, this.PER_MAT_INST)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(this.PER_MAT_INST * 3), 3,
      )
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
      mesh.count   = 0
      mesh.visible = false
      this.scene.add(mesh)
      this.matMeshes.set(type, mesh)
      this.matCounts.set(type, 0)
    }

    // ── Agent mesh ──
    const aGeo = new THREE.SphereGeometry(0.55, 8, 6)
    const aMat = new THREE.MeshStandardMaterial({
      emissive: new THREE.Color(0, 1, 0.25), emissiveIntensity: 2.5,
      roughness: 0.4, color: 0x001008,
    })
    this.agentMesh = new THREE.InstancedMesh(aGeo, aMat, 200)
    this.agentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.agentMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(200 * 3), 3)
    this.agentMesh.count = 0
    this.scene.add(this.agentMesh)
  }

  private _setupParticles() {
    // Smoke — slow-rising, grey, industrial atmosphere
    const sGeo = new THREE.BufferGeometry()
    const sPos = new Float32Array(1200 * 3)
    for (let i = 0; i < 1200; i++) {
      sPos[i * 3]     = Math.random() * GRID_W
      sPos[i * 3 + 1] = Math.random() * GRID_D * 1.8
      sPos[i * 3 + 2] = Math.random() * GRID_H
    }
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3))
    this.smokePts = new THREE.Points(sGeo, new THREE.PointsMaterial({
      color: 0x8888aa, size: 0.45, transparent: true, opacity: 0.28, sizeAttenuation: true,
    }))
    this.scene.add(this.smokePts)

    // Sparks — fast-rising, orange, energy zones
    const spGeo = new THREE.BufferGeometry()
    const spPos = new Float32Array(400 * 3)
    for (let i = 0; i < 400; i++) {
      spPos[i * 3]     = Math.random() * GRID_W
      spPos[i * 3 + 1] = Math.random() * GRID_D
      spPos[i * 3 + 2] = Math.random() * GRID_H
    }
    spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3))
    this.sparkPts = new THREE.Points(spGeo, new THREE.PointsMaterial({
      color: 0xffaa44, size: 0.22, transparent: true, opacity: 0.6, sizeAttenuation: true,
    }))
    this.scene.add(this.sparkPts)
  }

  private _setupGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color: 0x040408, roughness: .98, metalness: .02 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.set(GRID_W / 2, -0.9, GRID_H / 2)
    this.scene.add(ground)

    const grid = new THREE.GridHelper(420, 42, 0x0d0d20, 0x080814)
    grid.position.set(GRID_W / 2, -0.85, GRID_H / 2)
    ;(grid.material as THREE.Material).opacity     = 0.45
    ;(grid.material as THREE.Material).transparent = true
    this.scene.add(grid)
  }

  private _setupResize() {
    const parent = this.canvas.parentElement!
    new ResizeObserver(() => {
      const w = parent.clientWidth, h = parent.clientHeight
      if (w < 1 || h < 1) return
      this.renderer.setSize(w, h, false)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }).observe(parent)
    const w = parent.clientWidth || 800, h = parent.clientHeight || 600
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  // ── Worker frame integration ─────────────────────────────────────────────────

  /** Decode dirty-chunk ArrayBuffer from worker, update shadow map, rebuild. */
  applyWorkerFrame(ab: ArrayBuffer) {
    const u32 = new Uint32Array(ab)
    const f32 = new Float32Array(ab)
    const numChunks = u32[0]
    let offset = 1
    for (let c = 0; c < numChunks; c++) {
      const key   = u32[offset]
      const start = offset + 1
      this.shadowChunks.set(key, f32.slice(start, start + CHUNK_FLOATS))
      offset += 1 + CHUNK_FLOATS
    }
    this._rebuild()
  }

  private _rebuild() {
    if (this.matMode === 'material') this._rebuildMaterial()
    else this._rebuildLayer()
    this._animateParticles()
  }

  // ── Rebuild: field / height mode ─────────────────────────────────────────────

  private _rebuildLayer() {
    this.layerMesh.visible = true
    for (const m of this.matMeshes.values()) m.visible = false

    const fi  = LAYER_FIELD[this.layer] ?? F.E
    const mx  = LAYER_MAX[this.layer]   ?? 1000
    const pal = LAYER_PALS[this.layer]  ?? LAYER_PALS[0]
    let cnt   = 0

    for (const [key, chunk] of this.shadowChunks) {
      const [cx, cy, cz] = decodeChunkKey(key)
      const bx = cx * CX, by = cy * CY, bz = cz * CZ
      if (bz > this.zSlice) continue

      for (let lz = 0; lz < CZ && (bz + lz) <= this.zSlice; lz++)
      for (let ly = 0; ly < CY; ly++)
      for (let lx = 0; lx < CX; lx++) {
        const base = (lz * CY * CX + ly * CX + lx) * NF
        const v = chunk[base + fi]
        if (v < this.VOXEL_THRESH || cnt >= this.MAX_INST) continue

        const t = Math.min(v / mx, 1)
        let r: number, g: number, b: number

        if (this.matMode === 'height') {
          // Height gradient: blue (low z) → red (high z)
          const hz = Math.min((bz + lz) / GRID_D, 1)
          r = Math.round(hz * 255)
          g = Math.round(Math.sin(hz * Math.PI) * 180)
          b = Math.round((1 - hz) * 255)
        } else {
          ;[r, g, b] = lerpPalette(pal, t)
        }

        this.dummy.position.set(bx + lx, (bz + lz) * 0.9, by + ly)
        this.dummy.updateMatrix()
        this.layerMesh.setMatrixAt(cnt, this.dummy.matrix)
        this.col3.setRGB(r / 255, g / 255, b / 255)
        this.layerMesh.setColorAt!(cnt, this.col3)
        cnt++
      }
    }

    this.layerMesh.count = cnt
    this.layerMesh.instanceMatrix.needsUpdate = true
    if (this.layerMesh.instanceColor) this.layerMesh.instanceColor.needsUpdate = true
  }

  // ── Rebuild: material mode ────────────────────────────────────────────────────

  private _rebuildMaterial() {
    this.layerMesh.visible = false
    this.matCounts.forEach((_, k) => this.matCounts.set(k, 0))

    for (const [key, chunk] of this.shadowChunks) {
      const [cx, cy, cz] = decodeChunkKey(key)
      const bx = cx * CX, by = cy * CY, bz = cz * CZ
      if (bz > this.zSlice) continue

      for (let lz = 0; lz < CZ && (bz + lz) <= this.zSlice; lz++)
      for (let ly = 0; ly < CY; ly++)
      for (let lx = 0; lx < CX; lx++) {
        const base = (lz * CY * CX + ly * CX + lx) * NF
        const E = chunk[base + F.E]   || 0
        const D = chunk[base + F.D]   || 0
        const I = chunk[base + F.I]   || 0
        const S = chunk[base + F.S]   || 0
        const T = chunk[base + F.T]   || 0
        const B = chunk[base + F.BIO] || 0
        if (E < 0.5 && D < 0.05) continue

        const type = classifyVoxel(E, D, I, S, T, B)
        const mesh = this.matMeshes.get(type)
        if (!mesh) continue
        const cnt = this.matCounts.get(type) || 0
        if (cnt >= this.PER_MAT_INST) continue

        const vm = blendEnergyGlow(getMat(type), E)
        this.dummy.position.set(bx + lx, (bz + lz) * 0.9, by + ly)
        this.dummy.updateMatrix()
        mesh.setMatrixAt(cnt, this.dummy.matrix)
        this.col3.setRGB(
          Math.min(1, vm.r + vm.emissR * vm.emissStr * 0.12),
          Math.min(1, vm.g + vm.emissG * vm.emissStr * 0.12),
          Math.min(1, vm.b + vm.emissB * vm.emissStr * 0.12),
        )
        mesh.setColorAt!(cnt, this.col3)
        this.matCounts.set(type, cnt + 1)
      }
    }

    for (const [type, mesh] of this.matMeshes) {
      const cnt = this.matCounts.get(type) || 0
      mesh.count   = cnt
      mesh.visible = cnt > 0
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  // ── Agents ────────────────────────────────────────────────────────────────────

  updateAgents(agents: Array<{ x: number; y: number; z: number; alive: boolean; color?: string }>) {
    const alive = agents.filter(a => a.alive).slice(0, 200)
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i]
      this.dummy.position.set(a.x, a.z * 0.9 + 1.6, a.y)
      this.dummy.scale.setScalar(0.7 + Math.sin(Date.now() * 0.003 + i) * 0.12)
      this.dummy.updateMatrix()
      this.agentMesh.setMatrixAt(i, this.dummy.matrix)
      const hex = a.color?.replace('#', '') ?? '40c060'
      this.col3.setRGB(
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
      )
      this.agentMesh.setColorAt!(i, this.col3)
    }
    this.agentMesh.count = alive.length
    this.agentMesh.visible = this.showAgents && alive.length > 0
    this.agentMesh.instanceMatrix.needsUpdate = true
    if (this.agentMesh.instanceColor) this.agentMesh.instanceColor.needsUpdate = true
  }

  // ── Particles ─────────────────────────────────────────────────────────────────

  private _animateParticles() {
    this.smokePts.visible = this.showParticles
    this.sparkPts.visible = this.showParticles
    if (!this.showParticles) return

    const sPos  = this.smokePts.geometry.attributes.position.array as Float32Array
    const spPos = this.sparkPts.geometry.attributes.position.array as Float32Array

    for (let i = 0; i < sPos.length / 3; i++) {
      sPos[i * 3 + 1] += 0.035 + Math.random() * 0.02
      sPos[i * 3]     += (Math.random() - 0.5) * 0.06
      sPos[i * 3 + 2] += (Math.random() - 0.5) * 0.06
      if (sPos[i * 3 + 1] > GRID_D * 2) {
        sPos[i * 3]     = Math.random() * GRID_W
        sPos[i * 3 + 1] = 0
        sPos[i * 3 + 2] = Math.random() * GRID_H
      }
    }
    for (let i = 0; i < spPos.length / 3; i++) {
      spPos[i * 3 + 1] += 0.09 + Math.random() * 0.07
      spPos[i * 3]     += (Math.random() - 0.5) * 0.12
      spPos[i * 3 + 2] += (Math.random() - 0.5) * 0.12
      if (spPos[i * 3 + 1] > GRID_D) {
        spPos[i * 3]     = Math.random() * GRID_W
        spPos[i * 3 + 1] = 0
        spPos[i * 3 + 2] = Math.random() * GRID_H
      }
    }
    this.smokePts.geometry.attributes.position.needsUpdate = true
    this.sparkPts.geometry.attributes.position.needsUpdate = true
  }

  // ── Atmosphere ────────────────────────────────────────────────────────────────

  setTimeOfDay(h: number) {
    const skyColors: [number, THREE.Color][] = [
      [0,  new THREE.Color(0x020205)],  // midnight
      [5,  new THREE.Color(0x0a0505)],  // pre-dawn
      [7,  new THREE.Color(0x150805)],  // dawn
      [10, new THREE.Color(0x060810)],  // morning
      [14, new THREE.Color(0x080c18)],  // noon
      [19, new THREE.Color(0x0a0608)],  // dusk
      [21, new THREE.Color(0x050308)],  // evening
      [24, new THREE.Color(0x020205)],  // midnight
    ]
    let sky = new THREE.Color(0x060810)
    for (let i = 0; i < skyColors.length - 1; i++) {
      const [h0, c0] = skyColors[i]
      const [h1, c1] = skyColors[i + 1]
      if (h >= h0 && h <= h1) {
        sky = c0.clone().lerp(c1, (h - h0) / (h1 - h0))
        break
      }
    }
    this.scene.background = sky
    this.sceneFog.color.copy(sky)

    const arc  = ((h / 24) * Math.PI * 2) - Math.PI * 0.5
    const sR   = GRID_W * 0.9
    const sH   = Math.max(10, Math.sin(arc) * GRID_W * 1.3)
    this.sunLight.position.set(Math.cos(arc) * sR, sH, Math.sin(arc) * sR * 0.5)

    const dayFrac = Math.max(0, Math.sin((h / 24) * Math.PI))
    this.sunLight.intensity = 3.5 * Math.max(0.05, dayFrac)
    const warm = (h > 9 && h < 19) ? 0.06 : 0
    this.sunLight.color.setRGB(1, 0.97 - warm, 0.9 - warm * 0.5)
    this.ambLight.intensity  = 0.5 + dayFrac * 1.0
    this.fillLight.intensity = 0.5 + dayFrac * 0.3
    this.renderer.toneMappingExposure = (h > 6 && h < 20) ? 1.1 : 0.75
  }

  setFogDensity(d: number) { this.sceneFog.density = d }

  // ── Camera presets ────────────────────────────────────────────────────────────

  setCameraPreset(preset: 'orbit' | 'top' | 'iso' | 'street' | 'fly') {
    this.camPreset = preset
    this.controls.enabled = (preset === 'orbit')
    const CX2 = GRID_W / 2, CZ2 = GRID_H / 2

    switch (preset) {
      case 'top':
        this.camera.position.set(CX2, 200, CZ2)
        this.camera.lookAt(CX2, 0, CZ2)
        break
      case 'iso':
        this.camera.position.set(GRID_W * 1.2, GRID_W * 0.65, GRID_H * 1.1)
        this.controls.target.set(CX2, 10, CZ2)
        break
      case 'street':
        this.camera.position.set(CX2, 5, CZ2 - 28)
        this.camera.lookAt(CX2, 8, CZ2)
        break
      case 'fly':
        this.flyAngle = 0
        break
      case 'orbit':
        this.controls.enabled = true
        break
    }
  }

  private _updateFlyCamera(dt: number) {
    if (this.camPreset !== 'fly') return
    this.flyAngle += dt * 0.22
    const r = GRID_W * 0.72, cx = GRID_W / 2, cz = GRID_H / 2
    const h = GRID_W * 0.38 + Math.sin(this.flyAngle * 0.18) * 22
    this.camera.position.set(
      cx + Math.cos(this.flyAngle) * r, h, cz + Math.sin(this.flyAngle) * r,
    )
    this.camera.lookAt(cx, 14, cz)
  }

  // ── Public controls ────────────────────────────────────────────────────────────

  setLayer(layer: number) {
    this.layer = layer
    if (this.matMode !== 'material') this._rebuildLayer()
  }

  setMatMode(mode: 'field' | 'material' | 'height') {
    this.matMode = mode
    this._rebuild()
  }

  setZSlice(z: number) {
    this.zSlice = Math.max(0, Math.min(GRID_D - 1, Math.round(z)))
    this._rebuild()
  }

  render(dt = 0.016) {
    this._updateFlyCamera(dt)
    if (this.controls.enabled) this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  get instanceCount(): number { return this.layerMesh.count }
}
