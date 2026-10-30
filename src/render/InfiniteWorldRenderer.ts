import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { InfiniteChunkManager } from '../infinity/ChunkManager'
import { WorldGenerator, BIOME_ID, type WorldChunk } from '../infinity/WorldGenerator'
import { TerrainDeformationField, type TerrainBrushMode, type TerrainDeformationSnapshot } from '../infinity/TerrainDeformationField'
import { worldViewContract } from '../infinity/WorldViewContract'
import { buildWaterDepthMaskFromHeightField, buildWaterSurfaceMeshData } from '../infinity/WaterSurfaceMesh'
import { worldToChunk, WORLD_CHUNK_SIZE, type ChunkCoord } from '../infinity/WorldCoordinate'
import { WorldObjectManager } from '../infinity/ObjectManager'
import { lodForDistance, lodResolution, type LODLevel } from '../infinity/LODManager'
import { WorldPersistence } from '../infinity/WorldPersistence'
import { chunkKey } from '../infinity/WorldCoordinate'
import { WorldEditHistory, type WorldEdit } from '../infinity/WorldEditHistory'
import type { WorldObject, WorldObjectKind } from '../infinity/WorldObject'
import { FieldSampler } from '../infinity/FieldSampler'
import { GeneratorFieldProvider } from '../infinity/ScientificFieldProvider'
import { MutableWorldFieldProvider, type WorldFieldMutation } from '../infinity/MutableWorldFieldProvider'
import { LegacySculptRuntimeAdapter } from '../infinity/LegacySculptRuntimeAdapter'
import { AuthoritativeSculptTransactionCoordinator } from '../infinity/AuthoritativeSculptTransactionCoordinator'
import type { LegacyVoxelCoordinate } from '../infinity/LegacyScientificFieldBridge'
import { runtimeProvenance } from '../infinity/RuntimeProvenance'
import { WorldDecisionLayer, DEFAULT_DECISION_WEIGHTS, type RouteProfile } from '../infinity/WorldDecisionLayer'
import { WorldConstructionContract } from '../infinity/WorldConstructionContract'
import { isBelowWorldWaterSurface, resolveBridgeDeckHeight, resolveWorldWaterLevel, restoreWorldSurfaceProvider, serializeWorldSurfaceProvider, type WorldSurfaceProvider, type WorldSurfaceProviderSnapshot } from '../infinity/WorldSurfaceProvider'
import { DecisionGraph } from '../infinity/DecisionGraph'
import { WorldObjectSpatialIndex } from '../infinity/WorldObjectSpatialIndex'
import { FieldModulatedPhysics } from '../infinity/FieldModulatedPhysics'
import { LawPhysicsContract } from '../infinity/LawPhysicsContract'
import { createPhysicsInteractionRecord, type PhysicsInteractionType } from '../infinity/PhysicsInteractionRecord'
import { PhysicsInteractionLog } from '../infinity/PhysicsInteractionLog'
import { RuntimeDiagnostics } from '../infinity/RuntimeDiagnostics'
import { createExperimentProtocol } from '../infinity/ExperimentProtocol'
import { ExperimentRunner, type ExperimentSnapshot } from '../infinity/ExperimentRunner'
import { compareExperiments, type ExperimentComparison } from '../infinity/ExperimentComparison'
import { ExperimentCatalog } from '../infinity/ExperimentCatalog'
import { analyzeExperiments, type ExperimentAnalysis } from '../infinity/ExperimentAnalysis'
import { calculateStatisticalAnalysis, type StatisticalExperimentAnalysis } from '../infinity/ExperimentStatistics'
import { WorldAssetRuntime } from '../worldLibrary/WorldAssetRuntime'
import { biomePopulationEngine } from '../worldLibrary/BiomePopulationEngine'
import { worldResourceEconomy } from '../worldLibrary/WorldResourceEconomy'
import { civilizationRuntime, type CivilizationType } from '../worldLibrary/CivilizationRuntime'
import { productionInfrastructureRuntime } from '../worldLibrary/ProductionInfrastructureRuntime'
import { resolveWorldLibraryEntry, resourceVisualKind, visualKindToWorldObject } from '../worldLibrary/WorldLibraryAdapter'

type TerrainPatch = { group: THREE.Group; chunk: WorldChunk; lod: number; edgeLodSignature: string }
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
  generator: WorldGenerator
  chunks: InfiniteChunkManager
  private readonly objectSpatialIndex = new WorldObjectSpatialIndex()
  readonly objects = new WorldObjectManager(this.objectSpatialIndex)
  persistence: WorldPersistence
  history = new WorldEditHistory()
  readonly fieldSampler: FieldSampler
  readonly authoritativeField: MutableWorldFieldProvider
  readonly legacySculptRuntimeAdapter: LegacySculptRuntimeAdapter
  readonly authoritativeSculptTransactions: AuthoritativeSculptTransactionCoordinator
  terrainDeformations: TerrainDeformationField
  decisionLayer: WorldDecisionLayer
  constructionContract: WorldConstructionContract
  readonly decisionGraph = new DecisionGraph()
  readonly fieldPhysics = new FieldModulatedPhysics()
  readonly lawPhysicsContract: LawPhysicsContract
  readonly physicsInteractionLog = new PhysicsInteractionLog()
  readonly runtimeDiagnostics = new RuntimeDiagnostics()
  readonly experimentRunner = new ExperimentRunner()
  readonly experimentCatalog = new ExperimentCatalog()
  readonly worldAssetRuntime: WorldAssetRuntime

  private patches = new Map<string, TerrainPatch>()
  private objectMeshes = new Map<string, ObjectMesh>()
  private waterMeshes = new Map<string, THREE.Mesh>()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private selectedObjectId: string | null = null
  private selectedKind: WorldObjectKind = 'tree'
  private objectTool: 'navigate' | 'select' | 'place' | 'erase' = 'navigate'
  private terrainBrushMode: 'raise' | 'lower' | null = null
  private terrainBrushRadius = 8
  private terrainBrushStrength = 1
  private saveTimer: number | null = null
  private readonly storageKey: string
  private readonly pointerHandler: (e: PointerEvent) => void
  private readonly pointerUpHandler: (e: PointerEvent) => void
  private readonly pointerMoveHandler: (e: PointerEvent) => void
  private readonly contextMenuHandler: (e: MouseEvent) => void
  private readonly keyDownHandler: (e: KeyboardEvent) => void
  private readonly keyUpHandler: (e: KeyboardEvent) => void
  private pointerDownX = 0
  private pointerDownY = 0
  private pointerDownTime = 0
  private readonly transformControls: TransformControls
  private gizmoBefore: WorldObject | null = null
  private transformDragging = false
  private readonly selectionMarker = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true, transparent: true, opacity: 0.9 })
  )
  private readonly hoverMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 0.85, 32),
    new THREE.MeshBasicMaterial({ color: 0xffff66, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  )
  private readonly terrainGroup = new THREE.Group()
  private analyticalOverlayMode: 'suitability' | 'flood' | 'slope' | null = null
  private analyticalOverlayMesh?: THREE.Points
  private enabled = true
  private currentPixelRatio = 1
  private readonly maxPixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
  private adaptiveFrameCount = 0
  private adaptiveFrameTimeMs = 0
  private lastAdaptiveFrameMs = 0
  private simulationRunning = false
  private lastCenter: ChunkCoord | null = null
  private worldY = 45
  private worldPosition = new THREE.Vector3(28, 45, 52)

  getWorldPosition() { return this.worldPosition.clone() }

  setSimulationRunning(running: boolean) {
    this.simulationRunning = Boolean(running)
  }

  isSimulationRunning() {
    return this.simulationRunning
  }

  private worldToLocal(position: THREE.Vector3): THREE.Vector3 {
    return position.clone().sub(this.worldAnchor)
  }

  private syncWorldPositionFromControls(): void {
    // OrbitControls works in rebased render coordinates; simulation/LOD use absolute world coordinates.
    this.worldPosition.copy(this.controls.target).add(this.worldAnchor)
  }

  applyAuthoritativeFieldMutation(input: Parameters<MutableWorldFieldProvider['apply']>[0]) {
    const event = runtimeProvenance.record(input.kind === 'composer' ? 'world-state' : input.kind, {
      ...input.metadata,
      mutationKind: input.kind,
      x: input.x,
      y: input.y,
      z: input.z,
      radius: input.radius,
    })
    const mutation = this.authoritativeField.apply({
      ...input,
      metadata: { ...(input.metadata ?? {}), provenanceEventId: event.id },
    })
    this.refreshTerrainPatches()
    this.persistAuthoritativeFieldState()
    return mutation
  }

  getAuthoritativeFieldState() {
    return {
      field: this.authoritativeField.getState(),
      provenance: runtimeProvenance.getTrace(),
    }
  }

  private persistAuthoritativeFieldState(): boolean {
    const saved = this.persistence.saveFieldState(this.authoritativeField.serialize())
    if (!saved) {
      console.warn('[persistence] Authoritative field changed in memory but could not be saved to localStorage')
    }
    return saved
  }

  applyLegacySculptStroke(
    tool: 'inject' | 'paint' | 'erase' | 'noise' | 'stamp' | 'erode' | 'smooth' | 'pattern',
    cell: LegacyVoxelCoordinate,
    radius: number,
    strength: number,
    options: {
      fields?: Partial<{ energy: number; density: number; temperature: number; bio: number; information: number; entropy: number }>
      noiseScale?: number
      seed?: number
      period?: number
      smartBrush?: 'Volcano' | 'Forest' | 'Ocean' | 'Crystal' | 'Storm' | 'Life Cluster' | 'Radiation' | 'Civilization Seed'
      selectedLegacyZ?: number
    } = {},
  ): WorldFieldMutation {
    const metadata = {
      source: 'legacy-sculpt-runtime',
      legacyTool: tool,
      legacyCoordinate: { ...cell },
    }
    const transaction = this.authoritativeSculptTransactions.commit(() => {
      switch (tool) {
        case 'inject': return this.legacySculptRuntimeAdapter.inject(cell, radius, strength, options.fields ?? {}, metadata)
        case 'paint': return this.legacySculptRuntimeAdapter.paint(cell, radius, strength, options.fields ?? {}, metadata)
        case 'erase': return this.legacySculptRuntimeAdapter.erase(cell, radius, strength, metadata)
        case 'noise': return this.legacySculptRuntimeAdapter.noise(cell, radius, strength, options.noiseScale ?? 10, options.seed ?? 1337, options.fields ?? {}, metadata)
        case 'pattern': return this.legacySculptRuntimeAdapter.pattern(cell, radius, strength, options.noiseScale ?? 10, options.fields ?? {}, metadata)
        case 'stamp': return this.legacySculptRuntimeAdapter.stamp(cell, radius, strength, options.period ?? 4, metadata)
        case 'erode': return this.legacySculptRuntimeAdapter.erode(cell, radius, strength, metadata)
        case 'smooth': return this.legacySculptRuntimeAdapter.smooth(cell, radius, strength, metadata)
        default: throw new Error(`Unsupported legacy sculpt tool: ${tool}`)
      }
    })
    this.refreshTerrainPatches()
    this.persistAuthoritativeFieldState()
    return transaction.mutation
  }

  applyLegacySmartBrush(
    name: 'Volcano' | 'Forest' | 'Ocean' | 'Crystal' | 'Storm' | 'Life Cluster' | 'Radiation' | 'Civilization Seed',
    cell: LegacyVoxelCoordinate,
    radius: number,
    selectedLegacyZ?: number,
    options: { strength?: number } = {},
  ): WorldFieldMutation {
    const transaction = this.authoritativeSculptTransactions.commit(() =>
      this.legacySculptRuntimeAdapter.smartBrush(name, cell, radius, selectedLegacyZ, {
        source: 'legacy-sculpt-runtime',
        legacyTool: 'smart-brush',
        legacyCoordinate: { ...cell },
      }, options.strength ?? 1),
    )
    this.refreshTerrainPatches()
    this.persistAuthoritativeFieldState()
    return transaction.mutation
  }
  undoLegacySculptAuthoritative() {
    const transaction = this.authoritativeSculptTransactions.undo()
    if (transaction) {
      this.refreshTerrainPatches()
      this.persistAuthoritativeFieldState()
    }
    return transaction
  }

  redoLegacySculptAuthoritative() {
    const transaction = this.authoritativeSculptTransactions.redo()
    if (transaction) {
      this.refreshTerrainPatches()
      this.persistAuthoritativeFieldState()
    }
    return transaction
  }

  getLegacySculptAuthoritativeHistory() {
    return {
      undo: this.authoritativeSculptTransactions.historyLength,
      redo: this.authoritativeSculptTransactions.redoLength,
    }
  }

  private worldAnchor = new THREE.Vector3(0, 0, 0)
  private flyMode = true
  private readonly keys = new Set<string>()
  private readonly flySpeed = 90
  private readonly recenterDistance = 512
  private readonly patchResolution = 16
  private snapToGrid = 1
  private readonly lodDistance = 96
  private readonly sun: THREE.DirectionalLight
  private readonly hemi: THREE.HemisphereLight
  private materialMode: 'field' | 'material' | 'height' = 'height'
  // Functional vertex presentation: the underlying terrain mesh remains raycastable,
  // while points + restrained wireframe expose elevation and chunk topology.
  private terrainStyle: 'vertex' | 'surface' = 'surface'
  private readonly terrainMaterials = new Set<THREE.MeshStandardMaterial>()
  private physicsParticlePoints: THREE.Points | null = null
  private physicsParticlePositions = new Float32Array(0)
  private physicsParticleVelocities = new Float32Array(0)
  private physicsParticleColors = new Float32Array(0)
  private showParticles = false
  private readonly materializedConsequenceEvents = new Set<string>()

  constructor(canvas: HTMLCanvasElement, seed = 'reality-engine-infinity-v1') {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.currentPixelRatio = this.maxPixelRatio
    this.renderer.setPixelRatio(this.currentPixelRatio)
    this.renderer.setSize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), false)
    this.renderer.shadowMap.enabled = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping

    this.scene.add(this.terrainGroup)
    this.worldAssetRuntime = new WorldAssetRuntime(this.scene)
    this.generator = new WorldGenerator(seed)
    this.terrainDeformations = new TerrainDeformationField(seed)
    worldViewContract.setSeed(seed)
    this.authoritativeField = new MutableWorldFieldProvider(new GeneratorFieldProvider(this.generator))
    this.fieldSampler = new FieldSampler(this.generator, this.authoritativeField)
    this.persistence = new WorldPersistence(seed)
    const persistedSurface = this.persistence.loadSurfaceProviderState<WorldSurfaceProviderSnapshot>()
    if (persistedSurface) {
      const restoredSurface = restoreWorldSurfaceProvider(persistedSurface)
      if (restoredSurface) {
        this.fieldSampler.setSurfaceProvider(restoredSurface)
        worldViewContract.setSeed(restoredSurface.seed)
      } else {
        this.persistence.deleteSurfaceProviderState()
        console.warn('[persistence] Invalid world surface snapshot was rejected; generator-backed surface restored')
      }
    }
    this.legacySculptRuntimeAdapter = new LegacySculptRuntimeAdapter((mutation) => {
      const committed = this.authoritativeField.apply(mutation)
      runtimeProvenance.record('brush', {
        mutationId: committed.id,
        mutation: committed,
        runtime: 'infinite-world-authoritative-field',
      })
      return committed
    })
    this.authoritativeSculptTransactions = new AuthoritativeSculptTransactionCoordinator(this.authoritativeField)
    this.decisionLayer = new WorldDecisionLayer(this.fieldSampler, DEFAULT_DECISION_WEIGHTS, () => (window as any).getRealityLawState?.() ?? null, (x, z) => this.sampleTerrainHeight(x, z))
    this.constructionContract = new WorldConstructionContract(this.decisionLayer)
    this.lawPhysicsContract = new LawPhysicsContract(() => (window as any).getRealityLawState?.() ?? null)
    this.storageKey = `reality-engine-world:${seed}:objects`
    const persistedTerrain = this.persistence.loadTerrainDeformationState<TerrainDeformationSnapshot>()
    if (persistedTerrain) {
      try { this.terrainDeformations.restore(persistedTerrain) } catch { this.persistence.deleteTerrainDeformationState() }
    }
    const persistedField = this.persistence.loadFieldState<ReturnType<MutableWorldFieldProvider['serialize']>>()
    if (persistedField) {
      try {
        this.authoritativeField.restore(persistedField)
      } catch {
        this.persistence.deleteFieldState()
      }
    }
    this.chunks = new InfiniteChunkManager(this.generator, { radius: 2, verticalRadius: 0, maxLoaded: 25, maxNewPerUpdate: 4 })

    this.camera.position.set(38, this.worldY, 62)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.485
    this.controls.minDistance = 2
    this.controls.maxDistance = 2000
    this.controls.enablePan = true
    this.controls.screenSpacePanning = true
    this.controls.panSpeed = 1.1
    this.controls.rotateSpeed = 0.85
    this.controls.zoomSpeed = 1.3
    this.controls.addEventListener('change', () => this.syncWorldPositionFromControls())
    this.updateControlButtons()
    this.flyMode = false

    this.pointerHandler = (e: PointerEvent) => {
      this.pointerDownX = e.clientX
      this.pointerDownY = e.clientY
      this.pointerDownTime = performance.now()
      if (this.objectTool === 'navigate' && e.button === 0) {
        canvas.style.cursor = 'grabbing'
      }
    }
    this.pointerUpHandler = (e: PointerEvent) => {
      if (this.terrainBrushMode) {
        canvas.style.cursor = 'crosshair'
      } else if (this.objectTool === 'navigate') {
        canvas.style.cursor = 'grab'
      } else if (this.objectTool === 'place') {
        canvas.style.cursor = 'crosshair'
      } else if (this.objectTool === 'erase') {
        canvas.style.cursor = 'not-allowed'
      } else {
        canvas.style.cursor = 'default'
      }
      if (e.button !== 0 || this.flyMode || !this.controls.enabled) return
      if (e.shiftKey || this.keys.has('Space')) return
      const distance = Math.hypot(e.clientX - this.pointerDownX, e.clientY - this.pointerDownY)
      const elapsed = performance.now() - this.pointerDownTime
      if (distance <= 5 && elapsed <= 450) this.handlePointer(e.clientX, e.clientY)
    }
    this.pointerMoveHandler = (e: PointerEvent) => {
      // In Fly mode, drag the left mouse button to look around. OrbitControls
      // are intentionally disabled in first-person mode, so this is the direct look path.
      if (this.flyMode && (e.buttons & 1) !== 0) {
        const deltaX = e.clientX - this.pointerDownX
        const deltaY = e.clientY - this.pointerDownY
        this.pointerDownX = e.clientX
        this.pointerDownY = e.clientY
        if (deltaX !== 0 || deltaY !== 0) this.rotateFlyCamera(deltaX, deltaY)
        return
      }
      if (this.objectTool === 'place' || this.terrainBrushMode) {
        this.pickAtScreen(e.clientX, e.clientY)
      } else if (this.hoverMarker.visible) {
        this.hoverMarker.visible = false
      }
    }

    this.contextMenuHandler = (e: MouseEvent) => e.preventDefault()
    canvas.addEventListener('contextmenu', this.contextMenuHandler)
    canvas.addEventListener('pointerdown', this.pointerHandler)
    canvas.addEventListener('pointerup', this.pointerUpHandler)
    canvas.addEventListener('pointermove', this.pointerMoveHandler)

    this.transformControls = new TransformControls(this.camera, canvas)
    this.transformControls.setMode('translate')
    this.transformControls.setSpace('world')
    ;(this.transformControls as any).visible = false
    this.scene.add(this.transformControls as unknown as THREE.Object3D)
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.transformDragging = Boolean((event as { value: boolean }).value)
      this.controls.enabled = this.enabled && !this.transformDragging && !this.flyMode
      if (this.transformDragging) {
        const object = this.getSelectedObject()
        this.gizmoBefore = object ? { ...object } : null
      } else if (this.gizmoBefore) {
        const object = this.getSelectedObject()
        if (object) this.history.push({ type: 'transform', before: this.gizmoBefore, after: { ...object } })
        this.gizmoBefore = null
        this.scheduleSave()
      }
    })
    this.transformControls.addEventListener('objectChange', () => this.syncSelectedFromGizmo())

    this.keyDownHandler = (e: KeyboardEvent) => {
      if (!this.enabled) return
      const tgt = e.target
      if (tgt instanceof HTMLInputElement || tgt instanceof HTMLTextAreaElement || (tgt instanceof HTMLElement && tgt.isContentEditable)) return
      if (['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE'].includes(e.code)) {
        this.keys.add(e.code)
      }
      if (e.code === 'Space' || e.key === 'Shift') {
        if (this.objectTool !== 'navigate') {
          this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN
          this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
        }
      }
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) {
        this.focusSelection()
      }
      if (e.key === '+' || e.key === '=') {
        this.zoom(1)
      }
      if (e.key === '-' || e.key === '_') {
        this.zoom(-1)
      }
    }
    this.keyUpHandler = (e: KeyboardEvent) => {
      this.keys.delete(e.code)
      if (e.code === 'Space' || e.key === 'Shift') {
        this.updateControlButtons()
      }
    }
    window.addEventListener('keydown', this.keyDownHandler)
    window.addEventListener('keyup', this.keyUpHandler)

    this.controls.target.set(16, 10, 16)
    this.controls.update()
    this.worldPosition.copy(this.controls.target).add(this.worldAnchor)
    // Startup restores the latest autosaved field; the explicit Load action uses the saved checkpoint.
    this.loadWorld({ restoreFieldCheckpoint: false })

    this.hemi = new THREE.HemisphereLight(0xb9d8ff, 0x35402f, 1.6)
    this.scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2)
    this.sun.position.set(300, 500, 180)
    this.scene.add(this.sun)

    const water = new THREE.MeshBasicMaterial({ color: 0x2b78b5, transparent: true, opacity: 0.48 })
    void water

    this.selectionMarker.visible = false
    this.scene.add(this.selectionMarker)
    this.hoverMarker.rotation.x = -Math.PI / 2
    this.hoverMarker.visible = false
    this.scene.add(this.hoverMarker)

    this.scene.background = new THREE.Color(0x9bb8d6)
    this.scene.fog = new THREE.Fog(0x9bb8d6, 180, 900)
    this.initPhysicsParticleSystem(700)
  }

  private persistTerrainDeformationState() {
    const saved = this.persistence.saveTerrainDeformationState(this.terrainDeformations.serialize())
    if (!saved) {
      console.warn('[persistence] Terrain deformation autosave failed; edits remain in memory but may not survive reload')
    }
    return saved
  }

  private scheduleSave() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null
      this.saveWorld({ checkpoint: false })
    }, 150)
  }

  saveWorld(options: { checkpoint?: boolean } = {}) {
    // Explicit Save creates a stable checkpoint; autosave must not move that checkpoint.
    const fieldSnapshot = this.authoritativeField.serialize()
    this.persistAuthoritativeFieldState()
    this.persistTerrainDeformationState()
    if (options.checkpoint !== false) {
      const fieldCheckpointSaved = this.persistence.saveFieldCheckpoint(fieldSnapshot)
      if (!fieldCheckpointSaved) {
        console.warn('[persistence] Authoritative field checkpoint failed; saved field edits may not survive reload')
      }
      const checkpointSaved = this.persistence.saveTerrainDeformationCheckpoint(this.terrainDeformations.serialize())
      if (!checkpointSaved) {
        console.warn('[persistence] Terrain deformation checkpoint failed; saved terrain edits may not survive reload')
      }
    }
    const objects = this.objects.values()
    const groups = new Map<string, WorldObject[]>()
    for (const object of objects) {
      const { cx, cy, cz } = this.persistence.chunkForObject(object)
      const key = chunkKey(cx, cy, cz)
      const list = groups.get(key) ?? []
      list.push(object)
      groups.set(key, list)
    }
    const failedPersistenceOperations: string[] = []
    for (const key of this.persistence.knownChunks()) {
      if (!groups.has(key)) {
        const [cx, cy, cz] = key.split(',').map(Number)
        if (!this.persistence.deleteChunk(cx, cy, cz)) {
          failedPersistenceOperations.push(`delete chunk ${key}`)
        }
      }
    }
    for (const [key, list] of groups) {
      const [cx, cy, cz] = key.split(',').map(Number)
      if (!this.persistence.saveChunk(cx, cy, cz, list)) {
        failedPersistenceOperations.push(`save chunk ${key}`)
      }
    }
    if (failedPersistenceOperations.length > 0) {
      console.warn(
        `[persistence] World object persistence incomplete (${failedPersistenceOperations.join(', ')}); object changes may not survive reload`,
      )
    }
    return objects.length
  }

  loadWorld(options: { restoreFieldCheckpoint?: boolean } = {}) {
    // Explicit Load restores the last manual checkpoint; startup can opt into the latest autosave.
    const checkpoint = options.restoreFieldCheckpoint === false
      ? null
      : this.persistence.loadFieldCheckpoint<ReturnType<MutableWorldFieldProvider['serialize']>>()
    const persistedField = checkpoint ?? this.persistence.loadFieldState<ReturnType<MutableWorldFieldProvider['serialize']>>()
    const terrainSnapshot = options.restoreFieldCheckpoint === false
      ? this.persistence.loadTerrainDeformationState<TerrainDeformationSnapshot>()
      : this.persistence.loadTerrainDeformationCheckpoint<TerrainDeformationSnapshot>()
        ?? this.persistence.loadTerrainDeformationState<TerrainDeformationSnapshot>()
    if (terrainSnapshot) {
      try {
        this.terrainDeformations.restore(terrainSnapshot)
        this.refreshTerrainPatches()
      } catch (error) {
        console.warn('[persistence] Could not restore terrain deformation state', error)
      }
    } else if (options.restoreFieldCheckpoint !== false) {
      this.terrainDeformations.clear()
      this.refreshTerrainPatches()
    }
    if (persistedField) {
      try {
        this.authoritativeField.restore(persistedField)
        this.persistAuthoritativeFieldState()
        this.refreshTerrainPatches()
      } catch (error) {
        console.warn('[persistence] Could not restore authoritative field state', error)
      }
    }
    this.objects.clear()
    this.objectSpatialIndex.clear()
    let count = 0
    for (const key of this.persistence.knownChunks({ recoverOrphans: true })) {
      const [cx, cy, cz] = key.split(',').map(Number)
      for (const object of this.persistence.loadChunk(cx, cy, cz)) {
        this.objects.add(object)
        this.objectSpatialIndex.upsert(object)
        count++
      }
    }
    this.syncObjects()
    this.selectedObjectId = null
    this.transformControls.detach()
    ;(this.transformControls as any).visible = false
    this.selectionMarker.visible = false
    return count
  }

  clearSavedWorld() {
    const cleared = this.persistence.clear()
    if (!cleared) {
      console.warn('[persistence] Could not remove every saved world record; some objects or edits may return after reload')
    }
    this.terrainDeformations.clear()
    this.refreshTerrainPatches()
    this.objects.clear()
    this.objectSpatialIndex.clear()
    this.syncObjects()
    this.selectedObjectId = null
    this.transformControls.detach()
    ;(this.transformControls as any).visible = false
    this.selectionMarker.visible = false
  }

  reseed(newSeed: string) {
    for (const [, patch] of this.patches) {
      this.scene.remove(patch.group)
      patch.group.traverse(obj => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => m.dispose())
      })
    }
    this.patches.clear()
    this.waterMeshes.clear()
    this.terrainMaterials.clear()
    this.lastCenter = null

    this.clearSavedWorld()

    this.generator = new WorldGenerator(newSeed)
    this.fieldSampler.setGenerator(this.generator)
    // The procedural generator may be reseeded independently; the current
    // authored surface continues to own the world/view identity until reset.
    worldViewContract.setSeed(this.fieldSampler.surfaceProvider.seed)
    this.authoritativeField.setBase(new GeneratorFieldProvider(this.generator))
    this.authoritativeField.clear()
    this.terrainDeformations = new TerrainDeformationField(newSeed)
    this.authoritativeSculptTransactions.clear()
    this.fieldSampler.setProvider(this.authoritativeField)
    this.rebuildDecisionLayer()
    this.persistence = new WorldPersistence(newSeed)
    this.persistActiveSurfaceProvider()
    this.chunks = new InfiniteChunkManager(this.generator, { radius: 2, verticalRadius: 0, maxLoaded: 25, maxNewPerUpdate: 4 })
    this.history = new WorldEditHistory()

    const targetWorld = new THREE.Vector3(16, this.sampleTerrainHeight(16, 16), 16)
    const targetLocal = this.worldToLocal(targetWorld)
    this.controls.target.copy(targetLocal)
    this.camera.position.copy(targetLocal).add(new THREE.Vector3(48, 36, 48))
    this.camera.lookAt(targetLocal)
    this.controls.update()
    this.worldPosition.copy(targetWorld)

    // Terrain streaming is intentionally deferred to the render loop. Reseeding
    // is a UI transaction and must not synchronously build the entire visible
    // terrain before the Composer can return control to the browser.
  }

  dispose() {
    // A disposed renderer may still be referenced by the app's frame loop; disable its work first.
    this.enabled = false
    this.controls.enabled = false
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.renderer.domElement.removeEventListener('contextmenu', this.contextMenuHandler)
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerHandler)
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUpHandler)
    this.renderer.domElement.removeEventListener('pointermove', this.pointerMoveHandler)
    window.removeEventListener('keydown', this.keyDownHandler)
    window.removeEventListener('keyup', this.keyUpHandler)
    this.controls.dispose()
    this.transformControls.dispose()
    this.scene.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => m.dispose())
    })
    this.renderer.dispose()
  }

  private rebuildDecisionLayer() {
    const weights = this.decisionLayer?.weights ?? DEFAULT_DECISION_WEIGHTS
    this.decisionLayer = new WorldDecisionLayer(
      this.fieldSampler,
      weights,
      () => (window as any).getRealityLawState?.() ?? null,
      (x, z) => this.sampleTerrainHeight(x, z),
    )
    this.constructionContract = new WorldConstructionContract(this.decisionLayer)
  }

  /**
   * Select a surface source for rendering and construction without replacing
   * the authoritative scientific-field provider or moving existing objects.
   */
  setWorldSurfaceProvider(provider: WorldSurfaceProvider) {
    this.fieldSampler.setSurfaceProvider(provider)
    worldViewContract.setSeed(provider.seed)
    this.rebuildDecisionLayer()
    this.refreshTerrainPatches()
    const persistence = this.persistActiveSurfaceProvider()
    return { id: provider.id, version: provider.version, seed: provider.seed, persistence }
  }

  resetWorldSurfaceProviderToGenerator() {
    this.fieldSampler.resetSurfaceProviderToGenerator()
    const provider = this.fieldSampler.surfaceProvider
    worldViewContract.setSeed(provider.seed)
    this.rebuildDecisionLayer()
    this.refreshTerrainPatches()
    const cleared = this.persistence.deleteSurfaceProviderState()
    if (!cleared) console.warn('[persistence] Could not remove the saved world-surface override; it may return after reload')
    return { id: provider.id, version: provider.version, seed: provider.seed, persistence: cleared ? 'cleared' : 'failed' }
  }

  setEnabled(value: boolean) {
    this.enabled = value
    this.controls.enabled = value && !this.flyMode && !this.transformDragging
  }

  get isEnabled() { return this.enabled }
  get worldSeed(): string { return this.fieldSampler.surfaceProvider.seed }

  getWorldEnvironment() {
    const x = this.worldPosition.x
    const z = this.worldPosition.z
    const y = this.sampleTerrainHeight(x, z)
    const surface = this.fieldSampler.surfaceProvider.sampleSurface(x, z, y)
    const step = 2
    const hL = this.sampleTerrainHeight(x - step, z)
    const hR = this.sampleTerrainHeight(x + step, z)
    const hD = this.sampleTerrainHeight(x, z - step)
    const hU = this.sampleTerrainHeight(x, z + step)
    const dx = (hR - hL) / (step * 2)
    const dz = (hU - hD) / (step * 2)
    const slope = Math.min(1, Math.sqrt(dx * dx + dz * dz) / 3)
    // Use the authoritative field provider so committed brush/composer mutations affect environment-driven systems.
    const field = this.fieldSampler.sample(x, y, z)
    const radiation = Math.max(0, Math.min(1, field.entropy * 8))
    const stability = Math.max(0, Math.min(1, 1 - field.entropy * 8))
    const maximumElevation = this.fieldSampler.surfaceProvider.maximumElevation
    return {
      temperature: surface.temperature,
      moisture: surface.moisture,
      elevation: typeof maximumElevation === 'number' && Number.isFinite(maximumElevation) && maximumElevation > 0
        ? y / maximumElevation
        : y,
      slope,
      radiation,
      stability,
      biome: `biome.${surface.biome}`,
      worldPosition: { x, y, z },
    }
  }

  hasSemanticElement(semanticId: string): boolean {
    const objects = this.objects.values()
    const entry = semanticId.split('.').pop() || semanticId
    const kindMap: Record<string, WorldObjectKind> = {
      tree: 'tree', oak: 'tree', pine: 'tree', palm: 'tree', cactus: 'tree',
      grass: 'custom', mushroom: 'custom',
      rock: 'rock', granite: 'rock', basalt: 'rock', stone: 'rock', iron: 'rock', 'ore-vein': 'rock',
      crystal: 'crystal',
      river: 'water', lake: 'water', ocean: 'water', waterfall: 'water',
      house: 'building', tower: 'building', temple: 'building', 'research-station': 'building',
      road: 'road', bridge: 'bridge', harbor: 'building',
      village: 'landmark', town: 'landmark', city: 'landmark', megacity: 'landmark',
      'gravity-well': 'gravity_well', 'entropy-sink': 'entropy_sink',
      'quantum-emitter': 'quantum_emitter', 'force-field': 'force_field', 'resonance-node': 'metalaw',
    }
    const kind = kindMap[entry]
    if (!kind) return false
    return objects.some((object) => object.kind === kind && (
      object.properties.semanticEntryId === semanticId || object.properties.semanticId === semanticId
    ))
  }

  getRuntimeStats() {
    return {
      objects: this.objects.size,
      loadedChunks: this.patches.size,
      targetChunks: this.chunks.size,
      world: { ...this.worldCoordinates },
      camera: {
        worldX: this.worldPosition.x,
        worldY: this.worldPosition.y,
        worldZ: this.worldPosition.z,
      },
    }
  }

  /** Coarse, allocation-light health check of the actual materialized terrain meshes. */
  getTerrainMeshDiagnostics() {
    const patches = [...this.patches.values()]
    let terrainMeshPatches = 0
    let vertexCount = 0
    let triangleCount = 0
    let invalidGeometryPatches = 0

    for (const patch of patches) {
      const mesh = patch.group.children.find(child => child.userData?.terrain) as THREE.Mesh | undefined
      const geometry = mesh?.geometry
      const position = geometry?.getAttribute('position')
      const index = geometry?.index
      if (!position || !index || position.count < 3 || index.count < 3 || index.count % 3 !== 0) {
        invalidGeometryPatches++
        continue
      }
      terrainMeshPatches++
      vertexCount += position.count
      triangleCount += index.count / 3
    }

    return {
      loadedChunks: patches.length,
      terrainMeshPatches,
      vertexCount,
      triangleCount,
      invalidGeometryPatches,
    }
  }

  focusGeneratedRegion(padding = 1.35) {
    const objects = this.objects.values()
    if (!objects.length) {
      this.resetCameraView()
      return { objects: 0, radius: 0 }
    }

    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    for (const object of objects) {
      minX = Math.min(minX, object.x)
      maxX = Math.max(maxX, object.x)
      minY = Math.min(minY, object.y)
      maxY = Math.max(maxY, object.y + 8 * object.scale)
      minZ = Math.min(minZ, object.z)
      maxZ = Math.max(maxZ, object.z)
    }

    const centerX = (minX + maxX) * 0.5
    const centerZ = (minZ + maxZ) * 0.5
    const centerY = this.sampleTerrainHeight(centerX, centerZ)
    const radius = Math.max(24, Math.hypot(maxX - minX, maxZ - minZ) * 0.5)
    const distance = Math.min(1800, Math.max(70, radius * 2.25 * padding))

    const targetWorld = new THREE.Vector3(centerX, centerY, centerZ)
    const targetLocal = this.worldToLocal(targetWorld)
    this.controls.target.copy(targetLocal)
    this.camera.position.copy(targetLocal).add(new THREE.Vector3(distance, distance * 0.62, distance))
    this.camera.lookAt(targetLocal)
    this.controls.update()
    this.worldPosition.copy(targetWorld)
    // Terrain/object synchronization is handled by the render loop. Keeping
    // focusGeneratedRegion non-blocking prevents Composer from freezing the UI.

    return { objects: objects.length, radius, center: { x: centerX, y: centerY, z: centerZ } }
  }
  updateControlButtons() {
    const canvas = this.renderer.domElement
    if (this.terrainBrushMode) {
      this.controls.mouseButtons = {
        LEFT: -1 as any,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
      }
      canvas.style.cursor = 'crosshair'
    } else if (this.objectTool === 'navigate') {
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }
      canvas.style.cursor = 'grab'
    } else {
      this.controls.mouseButtons = {
        LEFT: -1 as any,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
      }
      canvas.style.cursor = this.objectTool === 'place' ? 'crosshair' : (this.objectTool === 'erase' ? 'not-allowed' : 'default')
    }
  }

  setTerrainBrushSettings(radius: number, strength: number) {
    if (!Number.isFinite(radius) || radius < 1 || radius > 64) throw new RangeError('Terrain brush radius must be between 1 and 64')
    if (!Number.isFinite(strength) || strength <= 0 || strength > 8) throw new RangeError('Terrain brush strength must be between 0 and 8')
    this.terrainBrushRadius = radius
    this.terrainBrushStrength = strength
  }

  setTerrainBrushMode(mode: 'raise' | 'lower' | null) {
    this.terrainBrushMode = mode
    if (mode) {
      this.flyMode = false
      this.controls.enabled = this.enabled && !this.transformDragging
    }
    this.updateControlButtons()
  }

  setObjectTool(tool: 'navigate' | 'select' | 'place' | 'erase') {
    this.terrainBrushMode = null
    this.objectTool = tool
    this.updateControlButtons()
    if (tool !== 'select') {
      this.transformControls.detach()
      ;(this.transformControls as any).visible = false
      this.selectionMarker.visible = false
    }
  }
  setObjectKind(kind: WorldObjectKind) { this.selectedKind = kind }
  getObjectTool() { return this.objectTool }
  getObjectKind() { return this.selectedKind }
  get worldCoordinates() {
    return { x: this.worldPosition.x, y: this.worldPosition.y, z: this.worldPosition.z }
  }
  setFlyMode(enabled: boolean) {
    this.flyMode = enabled
    this.controls.enabled = this.enabled && !enabled && !this.transformDragging
  }

  zoom(delta: number) {
    const target = this.controls.target
    const offset = this.camera.position.clone().sub(target)
    const dist = offset.length()
    const factor = delta > 0 ? 0.78 : 1.28
    const newDist = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, dist * factor))
    offset.setLength(newDist)
    this.camera.position.copy(target).add(offset)
    this.controls.update()
  }

  turnAround(deltaTheta: number, deltaPhi = 0) {
    const target = this.controls.target
    const offset = this.camera.position.clone().sub(target)
    const spherical = new THREE.Spherical().setFromVector3(offset)
    spherical.theta += deltaTheta
    spherical.phi = Math.max(0.08, Math.min(Math.PI * 0.485, spherical.phi + deltaPhi))
    offset.setFromSpherical(spherical)
    this.camera.position.copy(target).add(offset)
    this.controls.update()
  }

  getAnalyticalOverlayMode() { return this.analyticalOverlayMode }
  getPatchResolution() { return this.patchResolution }

  /** Diagnostics for verifying that rendered water coverage matches generator data. */
  getTerrainWaterDiagnostics() {
    let expectedWaterQuads = 0
    for (const patch of this.patches.values()) {
      for (const depth of patch.chunk.water) if (depth > 0) expectedWaterQuads++
    }
    let actualWaterQuads = 0
    for (const mesh of this.waterMeshes.values()) {
      actualWaterQuads += (mesh.geometry.index?.count ?? 0) / 6
    }
    return {
      loadedChunks: this.patches.size,
      chunksWithWater: this.waterMeshes.size,
      expectedWaterQuads,
      actualWaterQuads,
      maxWaterQuads: this.patches.size * WORLD_CHUNK_SIZE * WORLD_CHUNK_SIZE,
    }
  }
  getLodDistance() { return this.lodDistance }

  pan(deltaX: number, deltaZ: number) {
    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() > 0.001) forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    const shift = new THREE.Vector3().addScaledVector(right, deltaX).addScaledVector(forward, deltaZ)
    this.camera.position.add(shift)
    this.controls.target.add(shift)
    this.controls.update()
    this.syncWorldPositionFromControls()
  }

  focusSelection() {
    const obj = this.getSelectedObject()
    const targetWorld = obj ? new THREE.Vector3(obj.x, obj.y, obj.z) : new THREE.Vector3(16, 12, 16)
    const targetLocal = this.worldToLocal(targetWorld)
    this.controls.target.copy(targetLocal)
    this.camera.position.copy(targetLocal).add(new THREE.Vector3(38, 28, 38))
    this.camera.lookAt(targetLocal)
    this.controls.update()
    this.worldPosition.copy(targetWorld)
  }

  resetCameraView() {
    this.flyMode = false
    this.controls.enabled = this.enabled && !this.transformDragging
    const targetWorld = new THREE.Vector3(16, this.sampleTerrainHeight(16, 16), 16)
    const targetLocal = this.worldToLocal(targetWorld)
    this.controls.target.copy(targetLocal)
    this.camera.position.copy(targetLocal).add(new THREE.Vector3(48, 36, 48))
    this.camera.lookAt(targetLocal)
    this.controls.update()
    this.worldPosition.copy(targetWorld)
  }

  setCameraPreset(preset: 'top' | 'front' | 'orbit' | 'iso' | 'street' | 'fly') {
    const targetWorld = new THREE.Vector3(
      this.worldPosition.x,
      this.sampleTerrainHeight(this.worldPosition.x, this.worldPosition.z),
      this.worldPosition.z,
    )
    const targetLocal = this.worldToLocal(targetWorld)
    this.controls.target.copy(targetLocal)

    if (preset === 'fly') {
      // Fly uses first-person movement rather than OrbitControls. Keep the
      // camera/world position in the same absolute coordinate frame.
      this.flyMode = true
      this.controls.enabled = false
      this.worldPosition.copy(targetWorld).add(new THREE.Vector3(0, 8, 0))
      this.camera.position.copy(this.worldToLocal(this.worldPosition))
      this.camera.lookAt(this.camera.position.clone().add(new THREE.Vector3(0, 0, -30)))
      this.controls.target.copy(this.camera.position).add(new THREE.Vector3(0, 0, -30))
      return
    }

    this.flyMode = false
    this.controls.enabled = this.enabled && !this.transformDragging
    if (preset === 'top') {
      this.camera.position.copy(targetLocal).add(new THREE.Vector3(0, 220, 0.01))
    } else if (preset === 'front') {
      this.camera.position.copy(targetLocal).add(new THREE.Vector3(0, 24, 90))
    } else if (preset === 'street') {
      this.camera.position.copy(targetLocal).add(new THREE.Vector3(0, 3, 12))
    } else if (preset === 'iso') {
      this.camera.position.copy(targetLocal).add(new THREE.Vector3(110, 85, 110))
    } else {
      this.camera.position.copy(targetLocal).add(new THREE.Vector3(48, 36, 48))
    }
    this.camera.lookAt(targetLocal)
    this.controls.update()
    this.worldPosition.copy(targetWorld)
  }


  setMaterialMode(mode: 'field' | 'material' | 'height') {
    this.materialMode = mode
    this.refreshTerrainPatches()
  }

  setTimeOfDay(hours: number) {
    const h = ((hours % 24) + 24) % 24
    const daylight = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI))
    const azimuth = ((h - 6) / 24) * Math.PI * 2
    this.sun.position.set(Math.cos(azimuth) * 420, 80 + daylight * 520, Math.sin(azimuth) * 420)
    this.sun.intensity = 0.15 + daylight * 2.1
    this.hemi.intensity = 0.35 + daylight * 1.25

    let skyCol: number
    if (daylight < 0.05) {
      skyCol = 0x070918
      this.sun.color.setHex(0x5070a0)
    } else if (daylight < 0.35) {
      skyCol = h < 12 ? 0xcc7755 : 0xc05544
      this.sun.color.setHex(0xffaa77)
    } else {
      skyCol = 0x8eb4db
      this.sun.color.setHex(0xffffff)
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.setHex(skyCol)
    }
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setHex(skyCol)
    }
  }

  setFogDensity(value: number) {
    const density = Math.max(0, Math.min(0.06, value))
    const fog = this.scene.fog
    if (fog instanceof THREE.Fog) {
      fog.near = 90 + (0.06 - density) * 900
      fog.far = 260 + (0.06 - density) * 11000
    }
  }

  getMaterialMode() { return this.materialMode }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private chunkCenter(): ChunkCoord {
    const w = worldToChunk(this.worldPosition.x, 0, this.worldPosition.z)
    return w.chunk
  }

  private terrainEdgeLodSignature(chunk: WorldChunk): string {
    return [
      this.patches.get(`${chunk.cx - 1},${chunk.cy},${chunk.cz}`)?.lod ?? 'x',
      this.patches.get(`${chunk.cx + 1},${chunk.cy},${chunk.cz}`)?.lod ?? 'x',
      this.patches.get(`${chunk.cx},${chunk.cy},${chunk.cz - 1}`)?.lod ?? 'x',
      this.patches.get(`${chunk.cx},${chunk.cy},${chunk.cz + 1}`)?.lod ?? 'x',
    ].join(':')
  }

  private snappedTerrainEdgeHeight(
    chunk: WorldChunk,
    edge: 'west' | 'east' | 'north' | 'south',
    alongIndex: number,
    resolution: number,
    neighborResolution: number,
  ): number {
    const ratio = resolution / neighborResolution
    if (!Number.isInteger(ratio) || ratio < 2) {
      const x = edge === 'west' ? 0 : edge === 'east' ? WORLD_CHUNK_SIZE : alongIndex * WORLD_CHUNK_SIZE / resolution
      const z = edge === 'north' ? 0 : edge === 'south' ? WORLD_CHUNK_SIZE : alongIndex * WORLD_CHUNK_SIZE / resolution
      return this.sampleTerrainHeight(chunk.cx * WORLD_CHUNK_SIZE + x, chunk.cz * WORLD_CHUNK_SIZE + z)
    }
    const lower = Math.floor(alongIndex / ratio) * ratio
    const upper = Math.min(resolution, lower + ratio)
    const sampleAt = (index: number) => {
      const along = index * WORLD_CHUNK_SIZE / resolution
      const x = edge === 'west' ? 0 : edge === 'east' ? WORLD_CHUNK_SIZE : along
      const z = edge === 'north' ? 0 : edge === 'south' ? WORLD_CHUNK_SIZE : along
      return this.sampleTerrainHeight(chunk.cx * WORLD_CHUNK_SIZE + x, chunk.cz * WORLD_CHUNK_SIZE + z)
    }
    const lowerHeight = sampleAt(lower)
    if (upper === lower) return lowerHeight
    const upperHeight = sampleAt(upper)
    const t = (alongIndex - lower) / (upper - lower)
    return lowerHeight + (upperHeight - lowerHeight) * t
  }

  private buildTerrainPatch(chunk: WorldChunk, lod = 1): THREE.Group {
    const group = new THREE.Group()
    const geometry = new THREE.BufferGeometry()
    const resolution = lodResolution(lod as LODLevel)
    const scale = WORLD_CHUNK_SIZE / resolution
    const n = resolution + 1
    const positions = new Float32Array(n * n * 3)
    const normals = new Float32Array(n * n * 3)
    const colors = new Float32Array(n * n * 3)
    const indices: number[] = []

    const originX = chunk.cx * WORLD_CHUNK_SIZE
    const originZ = chunk.cz * WORLD_CHUNK_SIZE
    const neighborResolution = (dx: number, dz: number) => {
      const neighbor = this.patches.get(`${chunk.cx + dx},${chunk.cy},${chunk.cz + dz}`)
      if (!neighbor) return null
      const neighborResolution = lodResolution(neighbor.lod as LODLevel)
      return neighborResolution < resolution && resolution % neighborResolution === 0
        ? neighborResolution
        : null
    }
    const westResolution = neighborResolution(-1, 0)
    const eastResolution = neighborResolution(1, 0)
    const northResolution = neighborResolution(0, -1)
    const southResolution = neighborResolution(0, 1)

    const sample = (gx: number, gz: number) => {
      const lx = Math.min(WORLD_CHUNK_SIZE - 1, Math.floor(gx))
      const lz = Math.min(WORLD_CHUNK_SIZE - 1, Math.floor(gz))
      return chunk.heights[lz * WORLD_CHUNK_SIZE + lx]
    }

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x
        const gx = x * scale
        const gz = z * scale
        let h = this.sampleTerrainHeight(originX + gx, originZ + gz)
        // When this edge is finer than a loaded neighbor, place its border on the
        // neighbor's piecewise-linear edge. This eliminates T-junction cracks
        // without disabling distance-based LOD for the interior of either chunk.
        if (x === 0 && westResolution !== null) {
          h = this.snappedTerrainEdgeHeight(chunk, 'west', z, resolution, westResolution)
        } else if (x === resolution && eastResolution !== null) {
          h = this.snappedTerrainEdgeHeight(chunk, 'east', z, resolution, eastResolution)
        }
        if (z === 0 && northResolution !== null) {
          h = this.snappedTerrainEdgeHeight(chunk, 'north', x, resolution, northResolution)
        } else if (z === resolution && southResolution !== null) {
          h = this.snappedTerrainEdgeHeight(chunk, 'south', x, resolution, southResolution)
        }
        positions[i * 3] = originX + gx
        positions[i * 3 + 1] = h
        positions[i * 3 + 2] = originZ + gz

        const hL = this.sampleTerrainHeight(originX + gx - 1, originZ + gz)
        const hR = this.sampleTerrainHeight(originX + gx + 1, originZ + gz)
        const hD = this.sampleTerrainHeight(originX + gx, originZ + gz - 1)
        const hU = this.sampleTerrainHeight(originX + gx, originZ + gz + 1)
        const normal = new THREE.Vector3(hL - hR, 2, hD - hU).normalize()
        normals[i * 3] = normal.x
        normals[i * 3 + 1] = normal.y
        normals[i * 3 + 2] = normal.z

        const biome = this.fieldSampler.surfaceProvider.sampleSurface(originX + gx, originZ + gz, h).biome
        const color = new THREE.Color(BIOME_COLORS[BIOME_ID[biome]])
        const slope = Math.max(0, 1 - normal.y)
        color.offsetHSL(0, 0, -slope * 0.18)

        if (this.materialMode === 'field') {
          // Field mode visualizes the same authoritative scientific field used by physics and construction.
          const field = this.fieldSampler.sample(originX + gx, h, originZ + gz)
          const density = Math.max(0, Math.min(1, field.density))
          const information = Math.max(0, Math.min(1, field.information / 70))
          color.setHSL(0.68 - density * 0.68, 0.84, 0.3 + information * 0.28)
        } else if (this.materialMode === 'height') {
          const t = Math.max(0, Math.min(1, (h + 20) / 120))
          color.setHSL(0.68 - t * 0.68, 0.82, 0.28 + t * 0.34)
        }

        colors[i * 3] = color.r
        colors[i * 3 + 1] = color.g
        colors[i * 3 + 2] = color.b
      }
    }

    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
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
    // Derive normals from the final indexed surface, including LOD-snapped edge heights.
    // Sampling the unsnapped generator here creates lighting normals that disagree with
    // the actual border geometry and can accentuate seams between neighboring LOD patches.
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
    this.terrainMaterials.add(material)
    if (this.materialMode === 'material') {
      material.vertexColors = false
      material.color.set(0x8a8f98)
      material.roughness = 0.72
      material.metalness = 0.08
    } else if (this.materialMode === 'height') {
      material.roughness = 0.88
    }
    const mesh = new THREE.Mesh(geometry, material)
    mesh.userData.terrain = true
    group.add(mesh)

    if (this.terrainStyle === 'vertex') {
      const vertexMaterial = new THREE.PointsMaterial({
        color: 0xd8e6ff,
        size: 1.8,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.72,
      })
      const vertices = new THREE.Points(geometry, vertexMaterial)
      vertices.name = 'terrain-vertices'
      vertices.userData.terrainOverlay = true
      group.add(vertices)

      const wireMaterial = new THREE.LineBasicMaterial({
        color: 0x90a9d8,
        transparent: true,
        opacity: 0.22,
      })
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), wireMaterial)
      wire.name = 'terrain-wireframe'
      wire.userData.terrainOverlay = true
      group.add(wire)
    }

    const waterKey = `${chunk.cx},${chunk.cy},${chunk.cz}`
    const surfaceProvider = this.fieldSampler.surfaceProvider
    const waterLevel = this.getWorldWaterLevel()
    let waterData: ReturnType<typeof buildWaterSurfaceMeshData> | null = null
    if (waterLevel !== null) {
      let water: Float32Array | null = null
      if (this.terrainDeformations.hasDeformationsInChunk(chunk.cx, chunk.cz, WORLD_CHUNK_SIZE)) {
        // Provider masks are cached for the immutable baseline. Once terrain is
        // sculpted, derive current wet cells from the exact height sampler used
        // by terrain geometry so raised land dries and lowered land floods.
        water = buildWaterDepthMaskFromHeightField({
          cx: chunk.cx,
          cz: chunk.cz,
          seaLevel: waterLevel,
          sampleHeight: (x, z) => this.sampleTerrainHeight(x, z),
        })
      } else if (surfaceProvider.getWaterMaskForChunk) {
        water = surfaceProvider.getWaterMaskForChunk(chunk)
      } else {
        water = new Float32Array(WORLD_CHUNK_SIZE * WORLD_CHUNK_SIZE)
        const originX = chunk.cx * WORLD_CHUNK_SIZE
        const originZ = chunk.cz * WORLD_CHUNK_SIZE
        for (let z = 0; z < WORLD_CHUNK_SIZE; z++) {
          for (let x = 0; x < WORLD_CHUNK_SIZE; x++) {
            const sample = surfaceProvider.sampleSurface(originX + x, originZ + z)
            const depth = sample.waterDepth
            water[z * WORLD_CHUNK_SIZE + x] = Number.isFinite(depth) ? Math.max(0, depth) : 0
          }
        }
      }
      if (water) waterData = buildWaterSurfaceMeshData({ cx: chunk.cx, cz: chunk.cz, water }, waterLevel)
    }

    if (waterData && waterData.wetCellCount > 0) {
      const waterGeometry = new THREE.BufferGeometry()
      waterGeometry.setAttribute('position', new THREE.BufferAttribute(waterData.positions, 3))
      waterGeometry.setIndex(waterData.indices)
      waterGeometry.computeBoundingSphere()
      const waterMaterial = new THREE.MeshBasicMaterial({
        color: 0x2b78b5, transparent: true, opacity: 0.42, depthWrite: false,
      })
      const water = new THREE.Mesh(waterGeometry, waterMaterial)
      group.add(water)
      this.waterMeshes.set(waterKey, water)
    } else {
      // Do not leave a prior mesh reference when this patch is rebuilt for a dry chunk or non-sea surface.
      this.waterMeshes.delete(waterKey)
    }
    group.position.set(-this.worldAnchor.x, -this.worldAnchor.y, -this.worldAnchor.z)

    void sample
    return group
  }

  private refreshTerrainPatches() {
    for (const [key, patch] of this.patches) {
      this.scene.remove(patch.group)
      patch.group.traverse(obj => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => { m.dispose(); this.terrainMaterials.delete(m as THREE.MeshStandardMaterial) })
        else if (mesh.material) { mesh.material.dispose(); this.terrainMaterials.delete(mesh.material as THREE.MeshStandardMaterial) }
      })
      const group = this.buildTerrainPatch(patch.chunk, patch.lod)
      this.patches.set(key, { group, chunk: patch.chunk, lod: patch.lod, edgeLodSignature: this.terrainEdgeLodSignature(patch.chunk) })
      this.scene.add(group)
    }
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

  private desiredLod(chunk: WorldChunk): number {
    const cx = chunk.cx * WORLD_CHUNK_SIZE + WORLD_CHUNK_SIZE * 0.5
    const cz = chunk.cz * WORLD_CHUNK_SIZE + WORLD_CHUNK_SIZE * 0.5
    const dx = cx - this.worldPosition.x
    const dz = cz - this.worldPosition.z
    return lodForDistance(Math.hypot(dx, dz) / WORLD_CHUNK_SIZE)
  }

  private updateTerrainLod() {
    for (const [key, patch] of this.patches) {
      const lod = this.desiredLod(patch.chunk)
      const edgeLodSignature = this.terrainEdgeLodSignature(patch.chunk)
      if (lod === patch.lod && edgeLodSignature === patch.edgeLodSignature) continue
      this.scene.remove(patch.group)
      patch.group.traverse(obj => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
        else if (mesh.material) mesh.material.dispose()
      })
      const group = this.buildTerrainPatch(patch.chunk, lod)
      this.patches.set(key, { group, chunk: patch.chunk, lod, edgeLodSignature: this.terrainEdgeLodSignature(patch.chunk) })
      this.scene.add(group)
    }
  }

  private syncChunks() {
    const center = this.chunkCenter()
    const centerChanged = !this.lastCenter || center.cx !== this.lastCenter.cx || center.cz !== this.lastCenter.cz
    this.lastCenter = center
    // ChunkManager is deliberately budgeted: keep asking for the current target
    // every frame so remaining terrain chunks can materialize incrementally.
    // This prevents one Composer/Quick Generate transaction from monopolizing
    // the browser thread while preserving the same visible target set.
    const delta = this.chunks.update(center)

    for (const chunk of delta.loaded) {
      const key = `${chunk.cx},${chunk.cy},${chunk.cz}`
      if (!this.patches.has(key)) {
        const lod = this.desiredLod(chunk)
        const group = this.buildTerrainPatch(chunk, lod)
        this.patches.set(key, { group, chunk, lod, edgeLodSignature: this.terrainEdgeLodSignature(chunk) })
        this.scene.add(group)
      }
    }
    for (const key of delta.unloaded) this.removeChunk(key)
    if (centerChanged || delta.loaded.length > 0 || delta.unloaded.length > 0) this.syncObjects()
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
      case 'building': {
        // Procedural building silhouette: a low-rise body plus a smaller roof volume.
        // Scale remains controlled by WorldObject.scale, while local proportions
        // make generated districts visually distinguishable from rocks/landmarks.
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(4.5, 6, 4.5),
          mat(0x8b9099)
        )
        body.position.y = 3

        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(3.8, 1.1, 3.8),
          mat(0x565b66)
        )
        roof.position.y = 6.45

        const crown = new THREE.Mesh(
          new THREE.BoxGeometry(1.4, 1.4, 1.4),
          mat(0xa9afb8)
        )
        crown.position.y = 7.65

        g.add(body, roof, crown)
        mesh = g
        break
      }
      case 'road': {
        const pavement = new THREE.Mesh(
          new THREE.BoxGeometry(6, 0.12, 24),
          mat(0x3e4145)
        )
        pavement.position.y = 0.08
        const centerLine = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.035, 20),
          mat(0xb7b28a)
        )
        centerLine.position.y = 0.17
        g.add(pavement, centerLine)
        mesh = g
        break
      }
      case 'bridge': {
        const deck = new THREE.Mesh(
          new THREE.BoxGeometry(8, 0.6, 22),
          mat(0x6a5540)
        )
        deck.position.y = 0.35
        const railL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 22), mat(0x383838))
        const railR = railL.clone()
        railL.position.set(-3.6, 1.0, 0)
        railR.position.set(3.6, 1.0, 0)
        g.add(deck, railL, railR)
        mesh = g
        break
      }
      case 'water':
        // River/water segments are elongated along their local Z axis.
        // The object rotationY supplied by hydrology aligns each segment to the flow.
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(3.2, 0.3, 8),
          new THREE.MeshBasicMaterial({ color: 0x2b78b5, transparent: true, opacity: 0.65 })
        )
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
      case 'metalaw': {
        // Simulated Physics Object: MetaLaw Core with gyroscopic rule rings
        const core = new THREE.Mesh(
          new THREE.DodecahedronGeometry(1.2, 0),
          new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.2, metalness: 0.8, emissive: 0x553300 })
        )
        core.position.y = 2.2
        const ring1 = new THREE.Mesh(
          new THREE.TorusGeometry(1.8, 0.08, 8, 32),
          new THREE.MeshStandardMaterial({ color: 0x90caf9, emissive: 0x1565c0, roughness: 0.3 })
        )
        ring1.position.y = 2.2
        ring1.rotation.x = Math.PI / 3
        const ring2 = new THREE.Mesh(
          new THREE.TorusGeometry(2.3, 0.06, 8, 32),
          new THREE.MeshStandardMaterial({ color: 0xffb74d, emissive: 0xe65100, roughness: 0.3 })
        )
        ring2.position.y = 2.2
        ring2.rotation.y = Math.PI / 4
        g.add(core, ring1, ring2)
        mesh = g
        break
      }
      case 'gravity_well': {
        // Simulated Physics Object: Gravitational Singularity with accretion disk
        const core = new THREE.Mesh(
          new THREE.SphereGeometry(1.0, 16, 16),
          new THREE.MeshStandardMaterial({ color: 0x050010, roughness: 0.1, emissive: 0x220044 })
        )
        core.position.y = 2.4
        const disk = new THREE.Mesh(
          new THREE.RingGeometry(1.2, 2.8, 32),
          new THREE.MeshBasicMaterial({ color: 0x9c27b0, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
        )
        disk.position.y = 2.4
        disk.rotation.x = -Math.PI / 2.2
        g.add(core, disk)
        mesh = g
        break
      }
      case 'entropy_sink': {
        // Simulated Physics Object: Cryogenic Thermodynamic Damper
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 0.8, 4.2, 6),
          new THREE.MeshStandardMaterial({ color: 0x4dd0e1, roughness: 0.15, metalness: 0.6, emissive: 0x004d40 })
        )
        pillar.position.y = 2.1
        const cap = new THREE.Mesh(
          new THREE.OctahedronGeometry(1.0, 0),
          new THREE.MeshStandardMaterial({ color: 0xe0f7fa, roughness: 0.1, emissive: 0x00838f })
        )
        cap.position.y = 4.4
        g.add(pillar, cap)
        mesh = g
        break
      }
      case 'quantum_emitter': {
        // Simulated Physics Object: Quantum Coherence Emitter
        const emitter = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.3, 0),
          new THREE.MeshStandardMaterial({ color: 0x69f0ae, roughness: 0.2, emissive: 0x00c853, metalness: 0.5 })
        )
        emitter.position.y = 2.2
        const beacon = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.6, 12, 16),
          new THREE.MeshBasicMaterial({ color: 0xb9f6ca, transparent: true, opacity: 0.35 })
        )
        beacon.position.y = 6.0
        g.add(emitter, beacon)
        mesh = g
        break
      }
      case 'force_field': {
        // Simulated Physics Object: Kinetic & Wave Shield Barrier
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(3.6, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshStandardMaterial({
            color: 0x00e5ff,
            transparent: true,
            opacity: 0.42,
            roughness: 0.1,
            metalness: 0.1,
            side: THREE.DoubleSide,
            emissive: 0x006064
          })
        )
        dome.position.y = 0.05
        mesh = dome
        break
      }
      default:
        mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat(0xc0c0c0))
        ;(mesh as THREE.Mesh).position.y = 1
    }

    if (mesh !== g) g.add(mesh)
    g.userData.objectId = object.id
    g.position.set(object.x - this.worldAnchor.x, object.y - this.worldAnchor.y, object.z - this.worldAnchor.z)
    g.rotation.y = object.rotationY
    g.scale.setScalar(s)
    return g
  }

  private syncPersistentObjects() {
    const center = this.chunkCenter()
    const radius = this.chunks.radius + 1
    const desired = new Set<string>()
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = center.cx + dx
        const cz = center.cz + dz
        const key = chunkKey(cx, 0, cz)
        desired.add(key)
        if (this.persistence.isLoaded(cx, 0, cz)) continue
        const objects = this.persistence.loadChunk(cx, 0, cz)
        for (const object of objects) {
          if (!this.objects.get(object.id)) {
            this.objects.add(object)
            this.objectSpatialIndex.upsert(object)
          }
        }
      }
    }
    for (const key of this.persistence.loadedChunks()) {
      if (!desired.has(key)) {
        const [cx, cy, cz] = key.split(',').map(Number)
        this.persistence.unloadChunk(cx, cy, cz)
      }
    }
  }

  private syncObjects() {
    // Camera coordinates are rebased around worldAnchor after Infinite World recentering.
    // Visibility queries must therefore use the stable world-space position.
    const center = this.worldPosition
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

  selectAtScreen(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const meshes = [...this.objectMeshes.values()].map(e => e.group)
    const hit = this.raycaster.intersectObjects(meshes, true)[0]
    if (!hit) {
      this.selectedObjectId = null
      this.transformControls.detach()
      ;(this.transformControls as any).visible = false
      this.selectionMarker.visible = false
      return null
    }
    let node: THREE.Object3D | null = hit.object
    while (node && !this.objectMeshes.has(node.userData.objectId)) node = node.parent
    const id = node?.userData.objectId as string | undefined
    if (!id) return null
    const entry = this.objectMeshes.get(id)
    if (!entry) return null
    this.selectedObjectId = id
    const selectedGroup = entry.group
    this.transformControls.attach(selectedGroup)
    ;(this.transformControls as any).visible = true
    this.selectionMarker.position.set(
      entry.object.x - this.worldAnchor.x,
      entry.object.y - this.worldAnchor.y + 1.5,
      entry.object.z - this.worldAnchor.z,
    )
    this.selectionMarker.scale.setScalar(Math.max(1, entry.object.scale * 2))
    this.selectionMarker.visible = true
    return entry.object
  }

  setTransformMode(mode: 'translate' | 'rotate' | 'scale') {
    this.transformControls.setMode(mode)
  }

  private syncSelectedFromGizmo() {
    if (!this.selectedObjectId) return
    const entry = this.objectMeshes.get(this.selectedObjectId)
    if (!entry) return
    const object = this.objects.updateTransform(this.selectedObjectId, {
      x: entry.group.position.x + this.worldAnchor.x,
      y: entry.group.position.y + this.worldAnchor.y,
      z: entry.group.position.z + this.worldAnchor.z,
      rotationY: entry.group.rotation.y,
      scale: entry.group.scale.x,
    })
    if (!object) return
    entry.object = object
    this.selectionMarker.position.set(entry.group.position.x, entry.group.position.y + 1.5, entry.group.position.z)
    this.selectionMarker.scale.setScalar(Math.max(1, object.scale * 2))
  }

  async loadExternalAsset(
    assetId: string,
    sourceUrl: string,
    semanticEntryId?: string,
    scale = 1,
  ) {
    const x = this.worldPosition.x
    const z = this.worldPosition.z
    return this.worldAssetRuntime.load(assetId, sourceUrl, {
      semanticEntryId,
      x,
      y: this.sampleTerrainHeight(x, z),
      z,
      scale,
    })
  }

  populateExternalBiome(
    environment: Parameters<typeof biomePopulationEngine.plan>[0],
    radius = 100,
    density = 1,
    seed = 1,
  ) {
    const plan = biomePopulationEngine.plan(environment)
    worldResourceEconomy.seedFromBiome(plan.biomeId, Math.max(0.25, density))
    const results: Array<{ semanticEntryId: string; layer: string; count: number; status: string }> = []

    for (const rule of plan.rules) {
      if (rule.layer !== 'visual' && rule.layer !== 'biological') {
        results.push({ semanticEntryId: rule.semanticEntryId, layer: rule.layer, count: 0, status: 'delegated' })
        continue
      }

      const count = Math.max(1, Math.min(rule.maxCount,
        Math.round((rule.minCount + rule.maxCount) * 0.5 * density * rule.weight)))
      const placed = this.worldAssetRuntime.scatterSemantic(
        rule.semanticEntryId,
        {
          minX: this.worldPosition.x - radius,
          maxX: this.worldPosition.x + radius,
          minZ: this.worldPosition.z - radius,
          maxZ: this.worldPosition.z + radius,
        },
        count,
        seed + results.length,
        rule.scale,
      )

      placed.forEach((instance) => {
        const worldX = instance.position.x
        const worldZ = instance.position.z
        const worldY = this.sampleTerrainHeight(worldX, worldZ)
        instance.position.y = worldY
        instance.userData.worldPosition = { x: worldX, y: worldY, z: worldZ }
      })
      results.push({
        semanticEntryId: rule.semanticEntryId,
        layer: rule.layer,
        count: placed.length,
        status: placed.length ? 'materialized' : 'no-runtime-asset',
      })
    }

    return { biomeId: plan.biomeId, byLayer: plan.byLayer, results, reason: plan.reason }
  }

  materializeSettlementTier(tier: 'village' | 'town' | 'city' | 'megacity', x = this.worldPosition.x, z = this.worldPosition.z) {
    const radius = tier === 'village' ? 90 : tier === 'town' ? 125 : tier === 'city' ? 180 : 240
    const buildings = tier === 'village' ? 5 : tier === 'town' ? 12 : tier === 'city' ? 28 : 55
    const roadSpacing = tier === 'village' ? 22 : tier === 'town' ? 18 : tier === 'city' ? 14 : 11

    if (tier === 'village' || tier === 'town') {
      this.generateSettlementV2(x, z, radius, buildings)
    } else {
      this.generateCityPlan(x, z, radius, buildings)
    }

    this.buildRoad(x - radius * 0.55, z, x + radius * 0.55, z, roadSpacing)
    if (tier !== 'village') {
      this.buildRoad(x, z - radius * 0.55, x, z + radius * 0.55, roadSpacing)
    }
    if (tier === 'city' || tier === 'megacity') {
      this.placeScaled('building', x + radius * 0.22, z + radius * 0.18, tier === 'megacity' ? 2 : 1.4)
      this.placeScaled('building', x - radius * 0.22, z - radius * 0.18, tier === 'megacity' ? 1.8 : 1.2)
    }
    if (tier === 'megacity') {
      this.placeScaled('quantum_emitter', x, z, 1.5)
    }

    this.syncObjects()
    this.scheduleSave()
    return { tier, radius, buildings, roadSpacing }
  }

  tickWorldSimulation(id: string, tier: Parameters<typeof civilizationRuntime.evaluate>[1] = 'village', delta = 1) {
    const environment = this.getWorldEnvironment()
    const productionState = productionInfrastructureRuntime.get(id)
    const impact = productionState?.environmentalImpact
    if (impact) {
      environment.moisture = Math.max(0, Math.min(1, environment.moisture + impact.moistureDelta))
      environment.radiation = Math.max(0, Math.min(1, environment.radiation + impact.radiationDelta))
      environment.stability = Math.max(0, Math.min(1, environment.stability + impact.stabilityDelta))
    }
    productionInfrastructureRuntime.applyEnvironmentalState(id, environment)
    const before = productionInfrastructureRuntime.get(id)
    const civilization = civilizationRuntime.evaluate(id, tier)
    const production = productionInfrastructureRuntime.get(id) ?? productionInfrastructureRuntime.evaluate(civilization)
    const next = productionInfrastructureRuntime.tick(id, delta) ?? production
    const addedRoads = Math.max(0, next.infrastructure.roads - (before?.infrastructure.roads ?? production.infrastructure.roads))
    const addedCapacity = Math.max(0, next.infrastructure.capacity - (before?.infrastructure.capacity ?? production.infrastructure.capacity))
    const materialized = (addedRoads || addedCapacity)
      ? this.materializeInfrastructureExpansion(id, addedRoads, addedCapacity)
      : { id, addedRoads: 0, addedBuildings: 0 }
    const consequenceMaterialized = this.materializeEventConsequences(id, next.consequences ?? [])
    return {
      id,
      civilization: next.civilization,
      production: next,
      infrastructure: next.infrastructure,
      materialized,
      consequenceMaterialized,
      layers: ['visual', 'biological', 'resource', 'infrastructure', 'civilization'],
    }
  }

  materializeEventConsequences(_id: string, consequences: Array<{ eventId: string; actions: Array<{ type: string; civilization?: string; tier?: string; visualKinds?: string[] }> }>) {
    const materialized: Array<{ eventId: string; action: string; result?: unknown }> = []
    const x = this.worldPosition.x
    const z = this.worldPosition.z
    for (const consequence of consequences) {
      if (this.materializedConsequenceEvents.has(consequence.eventId)) continue
      let didMaterialize = false
      for (const action of consequence.actions) {
        if (action.type !== 'visual-transition') continue
        didMaterialize = true
        if (action.tier === 'village' || action.tier === 'town' || action.tier === 'city' || action.tier === 'megacity') {
          materialized.push({ eventId: consequence.eventId, action: action.type, result: this.materializeSettlementTier(action.tier, x, z) })
        } else if (action.civilization === 'post-scarcity') {
          this.generateCityPlan(x, z, 240, 41)
          this.placeScaled('quantum_emitter', x, z, 1.5)
          this.syncObjects()
          this.scheduleSave()
          materialized.push({ eventId: consequence.eventId, action: action.type, result: { civilization: action.civilization, form: 'post-scarcity-city' } })
        } else if (action.civilization === 'industrial') {
          this.generateCityPlan(x, z, 190, 31)
          this.syncObjects()
          this.scheduleSave()
          materialized.push({ eventId: consequence.eventId, action: action.type, result: { civilization: action.civilization, form: 'industrial-city' } })
        } else if (action.civilization === 'agricultural') {
          this.generateSettlementV2(x, z, 150, 6)
          this.syncObjects()
          this.scheduleSave()
          materialized.push({ eventId: consequence.eventId, action: action.type, result: { civilization: action.civilization, form: 'agricultural-settlement' } })
        }
      }
      if (didMaterialize) this.materializedConsequenceEvents.add(consequence.eventId)
    }
    return materialized
  }

  materializeInfrastructureExpansion(id: string, addedRoads: number, addedCapacity: number) {
    if (addedRoads <= 0 && addedCapacity <= 0) return { id, addedRoads: 0, addedBuildings: 0 }

    const x = this.worldPosition.x
    const z = this.worldPosition.z
    const radius = Math.max(40, Math.min(260, 55 + Math.sqrt(Math.max(0, addedCapacity)) * 1.8))
    const roads = Math.min(12, Math.max(1, addedRoads))
    for (let i = 0; i < roads; i++) {
      const angle = (i / Math.max(1, roads)) * Math.PI * 2
      const ex = x + Math.cos(angle) * radius
      const ez = z + Math.sin(angle) * radius
      this.buildRoad(x, z, ex, ez, 14)
    }

    const addedBuildings = Math.min(10, Math.max(0, Math.floor(addedCapacity / 180)))
    for (let i = 0; i < addedBuildings; i++) {
      const angle = (i * 2.399963) % (Math.PI * 2)
      const distance = 25 + (i % 5) * 14
      const bx = x + Math.cos(angle) * distance
      const bz = z + Math.sin(angle) * distance
      this.placeScaled('building', bx, bz, 0.9 + (i % 3) * 0.15)
    }

    this.syncObjects()
    this.scheduleSave()
    return { id, addedRoads: roads, addedBuildings }
  }

  populateCivilization(id: string, tier: Parameters<typeof civilizationRuntime.evaluate>[1] = 'village', radius = 120) {
    const state = civilizationRuntime.evaluate(id, tier)
    const x = this.worldPosition.x
    const z = this.worldPosition.z
    const result: { id: string; type: CivilizationType; blockedBy: string[]; generated: string[] } = {
      id,
      type: state.type,
      blockedBy: [...state.blockedBy],
      generated: [],
    }

    if (state.type === 'agricultural') {
      this.generateSettlementV2(x, z, Math.min(radius, 150), 6)
      this.buildRoad(x - radius * 0.5, z, x + radius * 0.5, z, 18)
      result.generated.push('settlement', 'road-network')
    } else if (state.type === 'industrial') {
      this.generateCityPlan(x, z, Math.min(radius, 190), 31)
      this.buildRoad(x - radius * 0.65, z, x + radius * 0.65, z, 14)
      this.buildRoad(x, z - radius * 0.65, x, z + radius * 0.65, 14)
      result.generated.push('industrial-city', 'road-network')
    } else {
      this.generateCityPlan(x, z, Math.min(radius, 240), 41)
      this.buildRoad(x - radius * 0.7, z, x + radius * 0.7, z, 12)
      this.buildRoad(x, z - radius * 0.7, x, z + radius * 0.7, 12)
      this.placeScaled('quantum_emitter', x, z, 1.5)
      result.generated.push('post-scarcity-city', 'road-network', 'quantum-emitter')
    }

    this.syncObjects()
    this.scheduleSave()
    return result
  }

  populateBiome(
    environment: Parameters<typeof biomePopulationEngine.plan>[0],
    radius = 100,
    density = 1,
    seed = 1,
  ) {
    const plan = biomePopulationEngine.plan(environment)
    worldResourceEconomy.seedFromBiome(plan.biomeId, Math.max(0.25, density))
    const results: Array<{ semanticEntryId: string; layer: string; count: number; mode: string }> = []

    for (const rule of plan.rules) {
      const source = this.worldAssetRuntime.getSemanticSource(rule.semanticEntryId)
      if (source && (rule.layer === 'visual' || rule.layer === 'biological')) {
        const count = Math.max(1, Math.min(rule.maxCount,
          Math.round((rule.minCount + rule.maxCount) * 0.5 * density * rule.weight)))
        const placed = this.worldAssetRuntime.scatterSemantic(
          rule.semanticEntryId,
          {
            minX: this.worldPosition.x - radius,
            maxX: this.worldPosition.x + radius,
            minZ: this.worldPosition.z - radius,
            maxZ: this.worldPosition.z + radius,
          },
          count,
          seed + results.length,
          rule.scale,
        )
        placed.forEach((instance) => {
          const x = instance.position.x
          const z = instance.position.z
          const y = this.sampleTerrainHeight(x, z)
          instance.position.y = y
          instance.userData.worldPosition = { x, y, z }
        })
        results.push({ semanticEntryId: rule.semanticEntryId, layer: rule.layer, count: placed.length, mode: 'external-asset' })
        continue
      }

      const angle = (results.length * 2.399963) % (Math.PI * 2)
      const x = this.worldPosition.x + Math.cos(angle) * radius * 0.55
      const z = this.worldPosition.z + Math.sin(angle) * radius * 0.55
      let count = 0
      const entry = resolveWorldLibraryEntry(rule.semanticEntryId)

      if (rule.layer === 'resource') {
        const visual = entry ? resourceVisualKind(entry) : null
        if (visual) {
          this.scatter(visual, x - 35, z - 35, x + 35, z + 35, Math.min(0.08, 0.025 * density * rule.weight))
          count = 1
        } else if (rule.semanticEntryId === 'resource.water') {
          this.placeScaled('water', x, z, 1)
          count = 1
        }
      } else if (rule.layer === 'infrastructure') {
        if (rule.semanticEntryId === 'infrastructure.road') {
          this.buildRoad(x - radius * 0.55, z, x + radius * 0.55, z, 16)
          this.buildRoad(x, z - radius * 0.55, x, z + radius * 0.55, 16)
          this.syncObjects()
          this.scheduleSave()
          count = 1
        } else if (rule.semanticEntryId === 'infrastructure.bridge') {
          this.placeScaled('bridge', x, z, 1)
          count = 1
        } else if (rule.semanticEntryId === 'infrastructure.harbor') {
          this.placeScaled('building', x, z, 1.25)
          count = 1
        } else if (rule.semanticEntryId === 'infrastructure.power-grid') {
          this.placeScaled('building', x, z, 1.1)
          count = 1
        } else if (rule.semanticEntryId === 'settlement.city' || rule.semanticEntryId === 'settlement.megacity') {
          this.generateCityPlan(x, z, rule.semanticEntryId === 'settlement.megacity' ? 240 : 180, 31)
          count = 1
        } else if (rule.semanticEntryId === 'settlement.town' || rule.semanticEntryId === 'settlement.village') {
          this.generateSettlementV2(x, z, rule.semanticEntryId === 'settlement.town' ? 150 : 110, 5)
          count = 1
        } else if (entry) {
          const visual = visualKindToWorldObject(entry)
          if (visual) {
            this.placeScaled(visual, x, z, rule.scale)
            count = 1
          }
        }
      } else if (rule.layer === 'civilization') {
        if (rule.semanticEntryId === 'civilization.industrial') {
          this.generateCityPlan(x, z, 190, 31)
          count = 1
        } else if (rule.semanticEntryId === 'civilization.post-scarcity') {
          this.generateCityPlan(x, z, 240, 41)
          this.placeScaled('quantum_emitter', x, z, 1.5)
          count = 1
        } else if (rule.semanticEntryId === 'civilization.agricultural') {
          this.generateSettlementV2(x, z, 150, 6)
          count = 1
        }
      } else if (rule.layer === 'biological') {
        this.placeScaled('spawn', x, z, rule.scale)
        count = 1
      } else if (rule.layer === 'visual' && entry) {
        const visual = visualKindToWorldObject(entry)
        if (visual) {
          this.scatter(visual, x - radius, z - radius, x + radius, z + radius, Math.min(0.08, 0.02 * density * rule.weight))
          count = 1
        }
      }

      results.push({ semanticEntryId: rule.semanticEntryId, layer: rule.layer, count, mode: 'procedural-fallback' })
    }

    return { biomeId: plan.biomeId, byLayer: plan.byLayer, results, reason: plan.reason }
  }

  scatterExternalSemantic(
    semanticEntryId: string,
    count: number,
    radius = 70,
    seed = 1,
    scale = 1,
  ) {
    const x = this.worldPosition.x
    const z = this.worldPosition.z
    const instances = this.worldAssetRuntime.scatterSemantic(
      semanticEntryId,
      { minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius },
      count,
      seed,
      scale,
    )
    instances.forEach((instance) => {
      const worldX = instance.position.x
      const worldZ = instance.position.z
      const worldY = this.sampleTerrainHeight(worldX, worldZ)
      instance.position.y = worldY
      instance.userData.worldPosition = { x: worldX, y: worldY, z: worldZ }
    })
    return instances.length
  }

  removeExternalAsset(assetId: string) {
    return this.worldAssetRuntime.remove(assetId)
  }

  getExternalAssetStats() {
    return this.worldAssetRuntime.stats()
  }

  getSelectedObject() {
    return this.selectedObjectId ? this.objects.get(this.selectedObjectId) ?? null : null
  }

  transformSelected(patch: Partial<Pick<WorldObject, 'x'|'y'|'z'|'rotationY'|'scale'>>) {
    if (!this.selectedObjectId) return null
    const before = this.objects.get(this.selectedObjectId)
    if (!before) return null
    const object = this.objects.updateTransform(this.selectedObjectId, patch)
    if (!object) return null
    this.history.push({ type: 'transform', before, after: object })
    this.scheduleSave()
    const entry = this.objectMeshes.get(object.id)
    if (entry) {
      entry.object = object
      entry.group.position.set(object.x - this.worldAnchor.x, object.y - this.worldAnchor.y, object.z - this.worldAnchor.z)
      entry.group.rotation.y = object.rotationY
      entry.group.scale.setScalar(Math.max(0.1, object.scale))
    }
    this.selectionMarker.position.set(object.x - this.worldAnchor.x, object.y - this.worldAnchor.y + 1.5, object.z - this.worldAnchor.z)
    this.selectionMarker.scale.setScalar(Math.max(1, object.scale * 2))
    return object
  }

  private applyHistoryEdit(edit: WorldEdit, reverse: boolean) {
    if (edit.type === 'add') {
      if (reverse) { this.objects.remove(edit.object.id); this.objectSpatialIndex.remove(edit.object.id) }
      else { this.objects.add(edit.object); this.objectSpatialIndex.upsert(edit.object) }
    } else if (edit.type === 'remove') {
      if (reverse) { this.objects.add(edit.object); this.objectSpatialIndex.upsert(edit.object) }
      else { this.objects.remove(edit.object.id); this.objectSpatialIndex.remove(edit.object.id) }
    } else {
      const object = reverse ? edit.before : edit.after
      this.objects.remove(object.id)
      this.objectSpatialIndex.remove(object.id)
      this.objects.add(object)
      this.objectSpatialIndex.upsert(object)
    }
    this.syncObjects()
    this.scheduleSave()
  }

  undo() {
    const edit = this.history.undo()
    if (!edit) return null
    this.applyHistoryEdit(edit, true)
    return edit
  }

  redo() {
    const edit = this.history.redo()
    if (!edit) return null
    this.applyHistoryEdit(edit, false)
    return edit
  }

  getEditHistoryState() {
    return { canUndo: this.history.canUndo, canRedo: this.history.canRedo }
  }

  getTransformMode() { return this.transformControls.mode }
  setSnapToGrid(size: number) { this.snapToGrid = Math.max(0.1, size) }
  getSnapToGrid() { return this.snapToGrid }

  private sampleTerrainHeight(x: number, z: number) {
    const provider = this.fieldSampler.surfaceProvider
    const surface = provider.sampleSurface(x, z)
    if (!Number.isFinite(surface.height)) throw new RangeError('World surface height must be finite')
    const deformedHeight = surface.height + this.terrainDeformations.sampleDelta(x, z)
    const minimum = typeof provider.minimumElevation === 'number' && Number.isFinite(provider.minimumElevation)
      ? provider.minimumElevation
      : Number.NEGATIVE_INFINITY
    const maximum = typeof provider.maximumElevation === 'number' && Number.isFinite(provider.maximumElevation)
      ? provider.maximumElevation
      : Number.POSITIVE_INFINITY
    if (minimum > maximum) throw new RangeError('World surface minimum elevation exceeds maximum elevation')
    return Math.max(minimum, Math.min(maximum, deformedHeight))
  }

  private persistActiveSurfaceProvider(): 'stored' | 'unsupported' | 'failed' {
    const snapshot = serializeWorldSurfaceProvider(this.fieldSampler.surfaceProvider)
    if (!snapshot) {
      if (!this.persistence.deleteSurfaceProviderState()) {
        console.warn('[persistence] Could not clear stale world-surface override; a previous built-in surface may return after reload')
        return 'failed'
      }
      return 'unsupported'
    }
    if (!this.persistence.saveSurfaceProviderState(snapshot)) {
      console.warn('[persistence] World-surface snapshot could not be saved; the selected surface may not survive reload')
      return 'failed'
    }
    return 'stored'
  }

  private getWorldWaterLevel(): number | null {
    return resolveWorldWaterLevel(this.fieldSampler.surfaceProvider)
  }

  private isBelowWaterSurface(height: number, clearance = 0.25): boolean {
    return isBelowWorldWaterSurface(this.fieldSampler.surfaceProvider, height, clearance)
  }

  private bridgeDeckHeight(startHeight: number, endHeight: number, clearance = 0.45): number {
    return resolveBridgeDeckHeight(this.fieldSampler.surfaceProvider, startHeight, endHeight, clearance)
  }

  /** Apply a real heightfield deformation, independent of scientific density/entropy fields. */
  sculptTerrainAt(x: number, z: number, radius: number, strength: number, mode: TerrainBrushMode) {
    const changed = this.terrainDeformations.applyBrush(x, z, radius, strength, mode)
    if (changed > 0) {
      this.refreshTerrainPatches()
      this.persistTerrainDeformationState()
    }
    return { changed, canUndo: this.terrainDeformations.canUndo, canRedo: this.terrainDeformations.canRedo }
  }

  undoTerrainSculpt() {
    if (!this.terrainDeformations.undo()) return false
    this.refreshTerrainPatches()
    this.persistTerrainDeformationState()
    return true
  }

  redoTerrainSculpt() {
    if (!this.terrainDeformations.redo()) return false
    this.refreshTerrainPatches()
    this.persistTerrainDeformationState()
    return true
  }

  private terrainY(x: number, z: number) { return this.sampleTerrainHeight(x, z) }

  snapWorld(x: number, y: number, z: number, kind: WorldObjectKind) {
    const s = this.snapToGrid
    const sx = Math.round(x / s) * s
    const sz = Math.round(z / s) * s
    const ground = this.terrainY(sx, sz)
    const waterLevel = this.fieldSampler.surfaceProvider.waterLevel
    const sy = kind === 'water'
      ? (typeof waterLevel === 'number' && Number.isFinite(waterLevel) ? waterLevel : y)
      : (Math.abs(y - ground) < 8 ? ground : y)
    return { x: sx, y: sy, z: sz }
  }

  deleteSelected() {
    if (!this.selectedObjectId) return null
    const id = this.selectedObjectId
    const object = this.objects.get(id)
    if (object) {
      this.objects.remove(id)
      this.objectSpatialIndex.remove(id)
      this.history.push({ type: 'remove', object: { ...object } })
    }
    const entry = this.objectMeshes.get(id)
    if (entry) {
      this.scene.remove(entry.group)
      entry.group.traverse(obj => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => m.dispose())
      })
      this.objectMeshes.delete(id)
    }
    this.selectedObjectId = null
    this.transformControls.detach()
    ;(this.transformControls as any).visible = false
    this.selectionMarker.visible = false
    this.scheduleSave()
    return object ?? null
  }

  handlePointer(clientX: number, clientY: number) {
    if (this.terrainBrushMode) {
      const point = this.pickAtScreen(clientX, clientY)
      return point ? this.sculptTerrainAt(point.x, point.z, this.terrainBrushRadius, this.terrainBrushStrength, this.terrainBrushMode) : null
    }
    if (this.objectTool === 'place') return this.placeAtScreen(this.selectedKind, clientX, clientY)
    if (this.objectTool === 'erase') return this.eraseAtScreen(clientX, clientY)
    return this.selectAtScreen(clientX, clientY)
  }

  pickAtScreen(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const terrainMeshes: THREE.Object3D[] = []
    for (const patch of this.patches.values()) {
      patch.group.traverse(obj => {
        if (obj instanceof THREE.Mesh && obj.userData.terrain) terrainMeshes.push(obj)
      })
    }
    const hit = this.raycaster.intersectObjects(terrainMeshes, false)[0]
    if (!hit) {
      this.hoverMarker.visible = false
      return null
    }
    const worldX = hit.point.x + this.worldAnchor.x
    const worldY = hit.point.y + this.worldAnchor.y
    const worldZ = hit.point.z + this.worldAnchor.z
    this.hoverMarker.position.set(hit.point.x, hit.point.y + 0.08, hit.point.z)
    this.hoverMarker.visible = true
    return { x: worldX, y: worldY, z: worldZ }
  }

  placeAtScreen(kind: WorldObjectKind, clientX: number, clientY: number, scale = 1) {
    const point = this.pickAtScreen(clientX, clientY)
    return point ? this.place(kind, point.x, point.z, point.y, scale) : null
  }

  eraseAtScreen(clientX: number, clientY: number, radius = 2) {
    const point = this.pickAtScreen(clientX, clientY)
    return point ? this.erase(point.x, point.y, point.z, radius) : []
  }

  private lawGateForBuild(kind: WorldObjectKind, x: number, z: number) {
    return this.constructionContract.authorize(kind, x, z)
  }

  /**
   * Unambiguous helper for generated/preset placements where the fourth
   * argument is a size multiplier, not a world-space height.
   * Screen placement keeps using place(..., y, scale) explicitly.
   */
  placeScaled(kind: WorldObjectKind, x: number, z: number, scale = 1) {
    return this.place(kind, x, z, undefined, scale)
  }

  place(kind: WorldObjectKind, x: number, z: number, y?: number, scale = 1) {
    const lawGate = this.lawGateForBuild(kind, x, z)
    if (!lawGate.allowed) return null
    const snapped = this.snapWorld(x, y ?? this.sampleTerrainHeight(x, z), z, kind)
    x = snapped.x
    z = snapped.z
    y = snapped.y
    const ground = y
    const object = this.objects.add({
      kind, x, y: ground, z,
      rotationY: 0, scale, seed: 0, properties: {
        lawPenalty: lawGate.decision?.laws.penalty ?? 0,
        activeLawProcesses: lawGate.decision?.laws.activeProcesses.join(',') ?? '',
      },
    })
    this.objectSpatialIndex.upsert(object)
    this.history.push({ type: 'add', object: { ...object } })
    this.syncObjects()
    this.scheduleSave()
    return object
  }

  erase(x: number, y: number, z: number, radius = 2) {
    const removed = this.objects.query({
      minX: x - radius, maxX: x + radius,
      minY: y - radius, maxY: y + radius,
      minZ: z - radius, maxZ: z + radius,
    })
    for (const object of removed) {
      this.objects.remove(object.id)
      this.objectSpatialIndex.remove(object.id)
      this.history.push({ type: 'remove', object: { ...object } })
    }
    this.syncObjects()
    this.scheduleSave()
    return removed.map(o => o.id)
  }

  analyzeRoute(x0: number, z0: number, x1: number, z1: number, samples = 32) {
    const result: Array<{ x: number; z: number; y: number; slope: number; water: boolean }> = []
    const count = Math.max(2, Math.floor(samples))
    let previousY = this.sampleTerrainHeight(x0, z0)
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1)
      const x = x0 + (x1 - x0) * t
      const z = z0 + (z1 - z0) * t
      const y = this.sampleTerrainHeight(x, z)
      const distance = Math.max(1, Math.hypot(x1 - x0, z1 - z0) / (count - 1))
      const slope = Math.abs(y - previousY) / distance
      result.push({ x, z, y, slope, water: this.isBelowWaterSurface(y) })
      previousY = y
    }
    return result
  }

  optimizeRoute(x0: number, z0: number, x1: number, z1: number, gridSize = 12, profile: RouteProfile = 'balanced') {
    const step = Math.max(4, gridSize)
    const start = { x: Math.round(x0 / step), z: Math.round(z0 / step) }
    const goal = { x: Math.round(x1 / step), z: Math.round(z1 / step) }
    const key = (x: number, z: number) => `${x},${z}`
    const open = new Set([key(start.x, start.z)])
    const came = new Map<string, string>()
    const g = new Map<string, number>([[key(start.x, start.z), 0]])
    const f = new Map<string, number>([[key(start.x, start.z), 0]])
    const heuristic = (x: number, z: number) => Math.hypot(goal.x - x, goal.z - z)
    const limit = 2500
    let iterations = 0
    while (open.size && iterations++ < limit) {
      let currentKey = ''
      let best = Infinity
      for (const k of open) {
        const value = f.get(k) ?? Infinity
        if (value < best) { best = value; currentKey = k }
      }
      if (!currentKey) break
      const [cx, cz] = currentKey.split(',').map(Number)
      if (cx === goal.x && cz === goal.z) {
        const path: Array<{ x: number; z: number; y: number; water: boolean; slope: number }> = []
        let cursor = currentKey
        while (true) {
          const [px, pz] = cursor.split(',').map(Number)
          const wx = px * step
          const wz = pz * step
          const y = this.sampleTerrainHeight(wx, wz)
          path.push({ x: wx, z: wz, y, water: this.isBelowWaterSurface(y), slope: 0 })
          const previous = came.get(cursor)
          if (!previous) break
          cursor = previous
        }
        path.reverse()
        for (let i = 1; i < path.length; i++) {
          const d = Math.max(1, Math.hypot(path[i].x - path[i-1].x, path[i].z - path[i-1].z))
          path[i].slope = Math.abs(path[i].y - path[i-1].y) / d
        }
        return path
      }
      open.delete(currentKey)
      const neighbors = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]
      for (const [dx, dz] of neighbors) {
        const nx = cx + dx
        const nz = cz + dz
        const wx = nx * step
        const wz = nz * step
        const decision = this.decisionLayer.routeCost(
          wx, wz, cx * step, cz * step, profile,
        )
        const terrainCost = decision.cost
        const diagonal = dx !== 0 && dz !== 0 ? 1.414 : 1
        const tentative = (g.get(currentKey) ?? Infinity) + terrainCost * diagonal
        const nk = key(nx, nz)
        if (tentative < (g.get(nk) ?? Infinity)) {
          came.set(nk, currentKey)
          g.set(nk, tentative)
          f.set(nk, tentative + heuristic(nx, nz))
          open.add(nk)
        }
      }
    }
    return []
  }

  buildSmartRoute(x0: number, z0: number, x1: number, z1: number, spacing = 12) {
    const route = this.optimizeRoute(x0, z0, x1, z1, spacing)
    const created: WorldObject[] = []
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i]
      const b = route[i + 1]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const length = Math.hypot(dx, dz)
      const rotationY = Math.atan2(dx, dz)
      const crossesWater = a.water || b.water
      const steep = Math.max(a.slope, b.slope) > 0.45
      const kind: WorldObjectKind = crossesWater ? 'bridge' : 'road'
      const segmentX = (a.x + b.x) * 0.5
      const segmentZ = (a.z + b.z) * 0.5
      const lawGate = this.lawGateForBuild(kind, segmentX, segmentZ)
      if (!lawGate.allowed) continue
      const y = crossesWater ? this.bridgeDeckHeight(a.y, b.y) : (a.y + b.y) * 0.5 + 0.08
      const object = this.objects.add({
        kind, x: segmentX, y, z: segmentZ,
        rotationY, scale: Math.max(0.5, length / 12),
        seed: i, properties: {
          route: 'smart', water: crossesWater, steep,
          lawPenalty: lawGate.decision?.laws.penalty ?? 0,
          activeLawProcesses: lawGate.decision?.laws.activeProcesses.join(',') ?? '',
        },
      })
      created.push(object)
      this.objectSpatialIndex.upsert(object)
      this.history.push({ type: 'add', object: { ...object } })
    }
    this.syncObjects()
    this.scheduleSave()
    return { route, objects: created, summary: {
      segments: created.length,
      bridges: created.filter(o => o.kind === 'bridge').length,
      roads: created.filter(o => o.kind === 'road').length,
      maxSlope: Math.max(...route.map(p => p.slope)),
    } }
  }

  buildRoad(x0: number, z0: number, x1: number, z1: number, spacing = 12) {
    const dx = x1 - x0
    const dz = z1 - z0
    const length = Math.hypot(dx, dz)
    const count = Math.max(1, Math.ceil(length / Math.max(2, spacing)))
    const rotationY = Math.atan2(dx, dz)
    const created: WorldObject[] = []
    for (let i = 0; i <= count; i++) {
      const t = i / count
      const x = x0 + dx * t
      const z = z0 + dz * t
      const lawGate = this.lawGateForBuild('road', x, z)
      if (!lawGate.allowed) continue
      const y = this.sampleTerrainHeight(x, z) + 0.08
      const object = this.objects.add({
        kind: 'road', x, y, z, rotationY, scale: Math.max(0.5, spacing / 12),
        seed: i, properties: {
          segment: i, roadLength: length,
          lawPenalty: lawGate.decision?.laws.penalty ?? 0,
          activeLawProcesses: lawGate.decision?.laws.activeProcesses.join(',') ?? '',
        },
      })
      created.push(object)
      this.objectSpatialIndex.upsert(object)
      this.history.push({ type: 'add', object: { ...object } })
    }
    this.syncObjects()
    this.scheduleSave()
    return created
  }

  explainBuildDecision(x: number, z: number) {
    const zone = this.buildZoneCost(x, z)
    const hydro = this.analyzeHydrology(x, z, 24, 9)
    const scientificDecision = this.decisionLayer.explainBuildDecision(x, z)
    this.decisionGraph.addDecision(scientificDecision)
    const reasons: string[] = []
    if (zone.floodRisk > 0.6) reasons.push('high flood risk')
    else if (zone.floodRisk > 0.3) reasons.push('moderate flood risk')
    if (zone.slopeRisk > 0.6) reasons.push('high slope risk')
    else if (zone.slopeRisk > 0.3) reasons.push('moderate slope risk')
    if (zone.river) reasons.push('river corridor')
    if (!reasons.length) reasons.push('low terrain risk')
    return {
      position:{x,z,y:zone.y},
      suitability:Math.max(0, 1 - zone.cost),
      cost:zone.cost,
      slope:zone.slope,
      floodRisk:zone.floodRisk,
      river:zone.river,
      localRiverCandidates:hydro.rivers.length,
      scientific: zone.scientific,
      decisionComponents: zone.decisionComponents,
      decisionRecord: scientificDecision,
      reasons,
    }
  }

  setAnalyticalOverlay(mode: 'suitability' | 'flood' | 'slope' | null) {
    this.analyticalOverlayMode = mode
    if (this.analyticalOverlayMesh) {
      this.terrainGroup.remove(this.analyticalOverlayMesh)
      this.analyticalOverlayMesh.geometry.dispose()
      const material = this.analyticalOverlayMesh.material
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material.dispose()
      this.analyticalOverlayMesh = undefined
    }
    if (!mode) return
    const data = this.buildAnalyticalOverlay(this.worldCoordinates.x, this.worldCoordinates.z, 160, 33, mode)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3))
    const colors: number[] = []
    for (const value of data.values) {
      const v = Math.max(0, Math.min(1, value))
      colors.push(1 - v, v, 0.18)
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    const material = new THREE.PointsMaterial({ size: 2.4, vertexColors: true, transparent: true, opacity: 0.58, depthWrite: false })
    const points = new THREE.Points(geometry, material)
    points.userData.kind = 'analytical-overlay'
    this.terrainGroup.add(points)
    this.analyticalOverlayMesh = points
  }

  buildAnalyticalOverlay(cx: number, cz: number, radius = 160, samples = 33, mode: 'suitability' | 'flood' | 'slope' = 'suitability') {
    const n = Math.max(9, Math.floor(samples))
    const step = (radius * 2) / (n - 1)
    const positions: number[] = []
    const values: number[] = []
    for (let ix = 0; ix < n; ix++) for (let iz = 0; iz < n; iz++) {
      const x = cx - radius + ix * step
      const z = cz - radius + iz * step
      const zone = this.buildZoneCost(x, z)
      let value = 0
      if (mode === 'flood') value = zone.floodRisk
      else if (mode === 'slope') value = zone.slopeRisk
      else value = 1 - zone.cost
      positions.push(x, this.sampleTerrainHeight(x, z) + 0.12, z)
      values.push(Math.max(0, Math.min(1, value)))
    }
    return { center:{x:cx,z:cz}, radius, samples:n, mode, positions, values }
  }

  analyzeWatershed(cx: number, cz: number, radius = 220, samples = 41) {
    const hydro = this.analyzeHydrology(cx, cz, radius, samples)
    const cells = hydro.samples
    const waterLevel = this.getWorldWaterLevel()
    const basins: Array<{x:number;z:number;y:number;flow:number;basin:number}> = []
    for (const cell of cells) {
      const e = 6
      const neighbors = [
        {x: cell.x + e, z: cell.z},
        {x: cell.x - e, z: cell.z},
        {x: cell.x, z: cell.z + e},
        {x: cell.x, z: cell.z - e},
      ]
      let lowest = cell.y
      for (const n of neighbors) lowest = Math.min(lowest, this.sampleTerrainHeight(n.x, n.z))
      const basin = waterLevel === null ? 0 : Math.round((lowest - waterLevel) / 4)
      basins.push({ x: cell.x, z: cell.z, y: cell.y, flow: cell.flow, basin })
    }
    const floodRisk = basins.map((cell) => ({
      ...cell,
      risk: waterLevel !== null && cell.y <= waterLevel + 4
        ? Math.min(1, cell.flow / 12 + 0.35)
        : Math.min(1, cell.flow / 24),
    }))
    return { center:{x:cx,z:cz}, radius, samples:floodRisk }
  }

  buildZoneCost(x: number, z: number) {
    const y = this.sampleTerrainHeight(x, z)
    const waterLevel = this.getWorldWaterLevel()
    const hydro = this.analyzeHydrology(x, z, 16, 7)
    const river = hydro.rivers.length > 0
    const floodRisk = waterLevel !== null && y <= waterLevel + 4 ? 0.7 : river ? 0.45 : 0
    const decision = this.decisionLayer.buildZoneCost(x, z)
    const slopeRisk = Math.min(1, decision.buildability.slope / 0.5)
    const legacyTerrainCost = slopeRisk * 0.5 + floodRisk * 0.5
    return {
      x, z, y, slope: decision.buildability.slope, river, floodRisk, slopeRisk,
      cost: Math.max(0, Math.min(1, legacyTerrainCost * 0.65 + decision.cost * 0.35)),
      decisionCost: decision.cost,
      buildability: decision.buildability,
      scientific: decision.buildability.field,
      decisionComponents: decision.components,
      laws: decision.laws,
    }
  }

  analyzeHydrology(cx: number, cz: number, radius = 220, samples = 41) {
    const n = Math.max(9, Math.floor(samples))
    const step = (radius * 2) / (n - 1)
    const waterLevel = this.getWorldWaterLevel()
    const cells: Array<{x:number;z:number;y:number;flow:number;river:boolean}> = []
    for (let ix = 0; ix < n; ix++) for (let iz = 0; iz < n; iz++) {
      const x = cx - radius + ix * step
      const z = cz - radius + iz * step
      const y = this.sampleTerrainHeight(x, z)
      const e = Math.max(2, step * 0.5)
      const gx = this.sampleTerrainHeight(x + e, z) - this.sampleTerrainHeight(x - e, z)
      const gz = this.sampleTerrainHeight(x, z + e) - this.sampleTerrainHeight(x, z - e)
      const downhill = Math.max(0, -gx) + Math.max(0, -gz)
      const basin = waterLevel === null ? 0 : Math.max(0, waterLevel + 8 - y)
      const flow = basin * 0.35 + downhill * 0.8
      cells.push({x,z,y,flow,river: waterLevel !== null && flow > 8 && y > waterLevel})
    }
    const rivers = cells.filter((c) => c.river).sort((a,b) => b.flow-a.flow)
    return { center:{x:cx,z:cz}, radius, samples:cells, rivers }
  }

  generateRiverGeometry(path: Array<{x:number;z:number;y:number}>, width = 5) {
    const geometry = new THREE.BufferGeometry()
    if (path.length < 2) return geometry
    const positions: number[] = []
    const indices: number[] = []
    for (let i = 0; i < path.length; i++) {
      const p = path[i]
      const next = path[Math.min(path.length - 1, i + 1)]
      const dx = next.x - p.x
      const dz = next.z - p.z
      const len = Math.max(0.001, Math.hypot(dx, dz))
      const nx = -dz / len
      const nz = dx / len
      const half = width * 0.5
      positions.push(p.x + nx * half, p.y + 0.04, p.z + nz * half)
      positions.push(p.x - nx * half, p.y + 0.04, p.z - nz * half)
    }
    for (let i = 0; i < path.length - 1; i++) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    return geometry
  }

  buildRiverMeshes(cx: number, cz: number, radius = 220, sources = 6, width = 5) {
    const traces = this.generateRiverTraces(cx, cz, radius, sources)
    const meshes: THREE.Mesh[] = []
    for (const path of traces) {
      const mesh = new THREE.Mesh(
        this.generateRiverGeometry(path, width),
        new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.72, roughness: 0.15, metalness: 0.05 })
      )
      mesh.userData.kind = 'river'
      this.terrainGroup.add(mesh)
      meshes.push(mesh)
    }
    return { traces, meshes }
  }

  traceRiverSource(x: number, z: number, maxSteps = 160, step = 8) {
    const path: Array<{x:number;z:number;y:number}> = []
    const waterLevel = this.getWorldWaterLevel()
    let px = x
    let pz = z
    let previousY = this.sampleTerrainHeight(px, pz)
    for (let i = 0; i < maxSteps; i++) {
      const y = this.sampleTerrainHeight(px, pz)
      path.push({ x: px, z: pz, y })
      if (waterLevel !== null && y <= waterLevel + 0.5) break
      const e = Math.max(2, step * 0.35)
      const dx = this.sampleTerrainHeight(px + e, pz) - this.sampleTerrainHeight(px - e, pz)
      const dz = this.sampleTerrainHeight(px, pz + e) - this.sampleTerrainHeight(px, pz - e)
      const length = Math.hypot(dx, dz)
      if (length < 0.05) break
      const nx = px - (dx / length) * step
      const nz = pz - (dz / length) * step
      const nextY = this.sampleTerrainHeight(nx, nz)
      if (nextY > previousY + 0.25) break
      px = nx
      pz = nz
      previousY = nextY
    }
    return path
  }

  generateRiverTraces(cx: number, cz: number, radius = 220, sources = 6) {
    const waterLevel = this.getWorldWaterLevel()
    if (waterLevel === null) return []
    const candidates = this.analyzeHydrology(cx, cz, radius, 41).rivers
      .filter((r) => r.y > waterLevel + 12)
      .slice(0, Math.max(1, sources))
    const traces: Array<Array<{x:number;z:number;y:number}>> = []
    for (const source of candidates) {
      const path = this.traceRiverSource(source.x, source.z)
      if (path.length > 2) traces.push(path)
    }
    return traces
  }

  generateRiverNetwork(cx: number, cz: number, radius = 220, samples = 41) {
    const hydro = this.analyzeHydrology(cx, cz, radius, samples)
    const waterLevel = this.getWorldWaterLevel()
    const created: WorldObject[] = []
    const selected = this.generateRiverTraces(cx, cz, radius, 6)

    // Render actual river traces as connected water segments rather than isolated
    // disks. This makes River Network visibly read as a river in the 3D world.
    let segmentId = 0
    for (const trace of selected) {
      for (let p = 0; p < trace.length - 1; p += 2) {
        const a = trace[p]
        const b = trace[Math.min(p + 2, trace.length - 1)]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const length = Math.max(3, Math.hypot(dx, dz))
        const water = this.constructionContract.materialize('water', (a.x + b.x) * 0.5, (a.z + b.z) * 0.5, (gate) => this.objects.add({
          kind: 'water',
          x: (a.x + b.x) * 0.5,
          y: waterLevel === null ? (a.y + b.y) * 0.5 - 0.15 : Math.max(waterLevel, (a.y + b.y) * 0.5 - 0.15),
          z: (a.z + b.z) * 0.5,
          rotationY: Math.atan2(dx, dz),
          scale: Math.max(0.6, Math.min(8, length / 8)),
          seed: segmentId++,
          properties: {
            hydrology: 'river', flow: Math.max(1, length), segment: true,
            lawPenalty: gate.decision?.laws.penalty ?? 0,
            activeLawProcesses: gate.decision?.laws.activeProcesses.join(',') ?? '',
          },
        }))
        if (!water) continue
        created.push(water)
        this.objectSpatialIndex.upsert(water)
        this.history.push({ type: 'add', object: { ...water } })
      }
    }
    this.syncObjects()
    this.scheduleSave()
    return {hydro, objects:created}
  }

  analyzeBuildZone(cx: number, cz: number, radius = 160, samples = 25) {
    const result: Array<{ x:number; z:number; y:number; slope:number; water:boolean; score:number }> = []
    const n = Math.max(5, Math.floor(samples))
    const step = (radius * 2) / (n - 1)
    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        const x = cx - radius + ix * step
        const z = cz - radius + iz * step
        const y = this.sampleTerrainHeight(x, z)
        const e = Math.max(1, step * 0.5)
        const gx = this.sampleTerrainHeight(x + e, z) - this.sampleTerrainHeight(x - e, z)
        const gz = this.sampleTerrainHeight(x, z + e) - this.sampleTerrainHeight(x, z - e)
        const slope = Math.hypot(gx, gz) / (2 * e)
        const water = this.isBelowWaterSurface(y)
        const elevationPenalty = Math.abs(y - this.fieldSampler.surfaceProvider.referenceBuildElevation) / 30
        const slopePenalty = Math.min(1, slope / 0.45)
        const score = water ? 0 : Math.max(0, 1 - slopePenalty) * Math.max(0, 1 - elevationPenalty)
        result.push({ x, z, y, slope, water, score })
      }
    }
    result.sort((a, b) => b.score - a.score)
    return {
      center: { x: cx, z: cz },
      radius,
      samples: result,
      best: result[0] ?? null,
      buildable: result.filter((cell) => cell.score > 0.45),
    }
  }

  planCity(cx: number, cz: number, radius = 180, samples = 31) {
    const analysis = this.analyzeBuildZone(cx, cz, radius, samples)
    if (!analysis.best) return null
    const hub = analysis.best
    const candidates = analysis.buildable.filter((cell) =>
      Math.hypot(cell.x - hub.x, cell.z - hub.z) > radius * 0.18
    )
    const districts: Array<{ x:number; z:number; y:number; score:number; role:string }> = []
    const desired = Math.min(8, Math.max(4, Math.floor(radius / 30)))
    for (let i = 0; i < desired && candidates.length; i++) {
      const targetAngle = (i / desired) * Math.PI * 2
      let best = candidates[0]
      let bestValue = -Infinity
      for (const cell of candidates) {
        const distance = Math.hypot(cell.x - hub.x, cell.z - hub.z)
        const angle = Math.atan2(cell.z - hub.z, cell.x - hub.x)
        const angleDiff = Math.abs(Math.atan2(Math.sin(angle - targetAngle), Math.cos(angle - targetAngle)))
        const separation = Math.min(1, distance / radius)
        const zone = this.buildZoneCost(cell.x, cell.z)
        const decision = this.decisionLayer.analyzeBuildability(cell.x, cell.z)
        const value =
          decision.score +
          separation * 0.25 -
          angleDiff * 0.15 -
          zone.cost * 0.35
        if (value > bestValue) { bestValue = value; best = cell }
      }
      districts.push({ x: best.x, z: best.z, y: best.y, score: best.score, role: i % 3 === 0 ? 'civic' : i % 3 === 1 ? 'residential' : 'mixed' })
      for (let j = candidates.length - 1; j >= 0; j--) {
        if (Math.hypot(candidates[j].x - best.x, candidates[j].z - best.z) < radius * 0.22) candidates.splice(j, 1)
      }
    }
    return { hub, districts, analysis }
  }

  generateCityPlan(cx: number, cz: number, radius = 180, samples = 31) {
    const plan = this.planCity(cx, cz, radius, samples)
    if (!plan) return null
    const created: WorldObject[] = []
    const hubObject = this.objects.add({
      kind: 'landmark', x: plan.hub.x, y: plan.hub.y, z: plan.hub.z,
      rotationY: 0, scale: 2, seed: 0,
      properties: { city: 'hub', role: 'civic' },
    })
    created.push(hubObject)
    this.objectSpatialIndex.upsert(hubObject)
    this.history.push({ type: 'add', object: { ...hubObject } })
    for (let i = 0; i < plan.districts.length; i++) {
      const d = plan.districts[i]
      const route = this.optimizeRoute(plan.hub.x, plan.hub.z, d.x, d.z, 12, 'balanced')
      for (let j = 0; j < route.length - 1; j++) {
        const a = route[j], b = route[j + 1]
        const hydro = this.analyzeHydrology((a.x + b.x) * 0.5, (a.z + b.z) * 0.5, 18, 9)
        const localRiver = hydro.rivers.length > 0
        const water = a.water || b.water || localRiver
        const kind: WorldObjectKind = water ? 'bridge' : 'road'
        const segmentX = (a.x + b.x) * 0.5
        const segmentZ = (a.z + b.z) * 0.5
        const lawGate = this.lawGateForBuild(kind, segmentX, segmentZ)
        if (!lawGate.allowed) continue
        const object = this.objects.add({
          kind,
          x: segmentX,
          y: water ? this.bridgeDeckHeight(a.y, b.y) : (a.y + b.y) * 0.5 + 0.08,
          z: segmentZ,
          rotationY: Math.atan2(b.x - a.x, b.z - a.z),
          scale: Math.max(0.5, Math.hypot(b.x - a.x, b.z - a.z) / 12),
          seed: i * 1000 + j,
          properties: {
            city: 'corridor', district: i, role: d.role,
            lawPenalty: lawGate.decision?.laws.penalty ?? 0,
            activeLawProcesses: lawGate.decision?.laws.activeProcesses.join(',') ?? '',
          },
        })
        created.push(object)
    this.objectSpatialIndex.upsert(object)
        this.history.push({ type: 'add', object: { ...object } })
      }
      const count = d.role === 'civic' ? 3 : 5
      for (let k = 0; k < count; k++) {
        const angle = (k / count) * Math.PI * 2
        const distance = d.role === 'civic' ? 12 : 18
        const x = d.x + Math.cos(angle) * distance
        const z = d.z + Math.sin(angle) * distance
        const construction = this.constructionContract.authorize('building', x, z)
        // The authoritative construction contract must gate generated structures too.
        if (!construction.allowed || !construction.decision) continue
        const siteDecision = this.decisionLayer.buildZoneCost(x, z, Math.hypot(x - plan.hub.x, z - plan.hub.z))
        // Keep the distance-aware city-planning score after applying the shared construction gate.
        if (siteDecision.buildability.score < 0.2 || siteDecision.laws.penalty >= 0.25) continue
        const y = siteDecision.buildability.elevation
        const building = this.objects.add({
          kind: 'building', x, y, z,
          rotationY: angle,
          scale: d.role === 'civic' ? 1.1 : 0.8,
          seed: i * 100 + k,
          properties: {
            city: 'district', district: i, role: d.role,
            buildability: siteDecision.buildability.score,
            scientificField: siteDecision.buildability.field.information,
            lawPenalty: siteDecision.laws.penalty,
            activeLawProcesses: siteDecision.laws.activeProcesses.join(','),
          },
        })
        created.push(building)
    this.objectSpatialIndex.upsert(building)
        this.history.push({ type: 'add', object: { ...building } })
      }
    }
    this.syncObjects()
    this.scheduleSave()
    return { plan, objects: created }
  }

  generateSettlementV2(cx: number, cz: number, radius = 120, blocks = 4) {
    const created: WorldObject[] = []
    const seed = this.worldSeed
    const blockCount = Math.max(2, Math.floor(blocks))
    const ringRadius = radius * 0.62
    const centerDecision = this.decisionLayer.analyzeBuildability(cx, cz)
    const centerY = centerDecision.elevation
    const hub = this.objects.add({
      kind: 'landmark', x: cx, y: centerY, z: cz,
      rotationY: 0, scale: 1.5, seed: 0,
      properties: { settlement: 'hub', seed },
    })
    created.push(hub)
    this.objectSpatialIndex.upsert(hub)
    this.history.push({ type: 'add', object: { ...hub } })

    for (let i = 0; i < blockCount; i++) {
      const angle = (i / blockCount) * Math.PI * 2
      const bx = cx + Math.cos(angle) * ringRadius
      const bz = cz + Math.sin(angle) * ringRadius
      const route = this.optimizeRoute(cx, cz, bx, bz, 12, 'low-impact')
      if (route.length < 2) continue

      for (let s = 0; s < route.length - 1; s++) {
        const a = route[s]
        const b = route[s + 1]
        const length = Math.hypot(b.x - a.x, b.z - a.z)
        const kind: WorldObjectKind = a.water || b.water ? 'bridge' : 'road'
        const segmentX = (a.x + b.x) * 0.5
        const segmentZ = (a.z + b.z) * 0.5
        const lawGate = this.lawGateForBuild(kind, segmentX, segmentZ)
        if (!lawGate.allowed) continue
        const object = this.objects.add({
          kind,
          x: segmentX,
          y: kind === 'bridge' ? this.bridgeDeckHeight(a.y, b.y) : (a.y + b.y) * 0.5 + 0.08,
          z: segmentZ,
          rotationY: Math.atan2(b.x - a.x, b.z - a.z),
          scale: Math.max(0.5, length / 12),
          seed: s,
          properties: {
            settlement: 'road', block: i,
            lawPenalty: lawGate.decision?.laws.penalty ?? 0,
            activeLawProcesses: lawGate.decision?.laws.activeProcesses.join(',') ?? '',
          },
        })
        created.push(object)
    this.objectSpatialIndex.upsert(object)
        this.history.push({ type: 'add', object: { ...object } })
      }

      const inner = ringRadius * 0.52
      for (let b = 0; b < 4; b++) {
        const lateral = (b - 1.5) * 16
        const tangentX = Math.cos(angle + Math.PI / 2) * lateral
        const tangentZ = Math.sin(angle + Math.PI / 2) * lateral
        const px = bx + tangentX
        const pz = bz + tangentZ
        const construction = this.constructionContract.authorize('building', px, pz)
        // Settlement growth must pass the authoritative construction contract.
        if (!construction.allowed || !construction.decision) continue
        const siteDecision = this.decisionLayer.buildZoneCost(px, pz, Math.hypot(px - cx, pz - cz))
        // Preserve the settlement's distance-aware placement constraints as well.
        if (siteDecision.buildability.score < 0.2 || siteDecision.laws.penalty >= 0.25) continue
        const py = siteDecision.buildability.elevation
        const building = this.objects.add({
          kind: 'building', x: px, y: py, z: pz,
          rotationY: angle + Math.PI / 2,
          scale: 0.8 + ((i + b) % 3) * 0.15,
          seed: i * 100 + b,
          properties: {
            settlement: 'block', block: i, slot: b, innerRadius: inner,
            buildability: siteDecision.buildability.score,
            scientificField: siteDecision.buildability.field.information,
            lawPenalty: siteDecision.laws.penalty,
            activeLawProcesses: siteDecision.laws.activeProcesses.join(','),
          },
        })
        created.push(building)
    this.objectSpatialIndex.upsert(building)
        this.history.push({ type: 'add', object: { ...building } })
      }
    }

    this.syncObjects()
    this.scheduleSave()
    return created
  }

  generateSettlement(cx: number, cz: number, radius = 80, count = 12) {
    const created: WorldObject[] = []
    const seed = this.worldSeed
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.fieldSampler.sample(cx + i, 0, cz).entropy * 4
      const radial = radius * (0.35 + (i % 5) / 8)
      const x = cx + Math.cos(angle) * radial
      const z = cz + Math.sin(angle) * radial
      const construction = this.constructionContract.authorize('building', x, z)
      if (!construction.allowed || !construction.decision) continue
      const siteDecision = this.decisionLayer.buildZoneCost(x, z, Math.hypot(x - cx, z - cz))
      if (siteDecision.buildability.score < 0.2 || siteDecision.laws.penalty >= 0.25) continue
      const y = siteDecision.buildability.elevation
      const building = this.objects.add({
        kind: 'building', x, y, z,
        rotationY: Math.atan2(cx - x, cz - z),
        scale: 0.75 + (i % 4) * 0.12,
        seed: i,
        properties: {
          settlement: 'generated', seed,
          buildability: siteDecision.buildability.score,
          scientificField: siteDecision.buildability.field.information,
          lawPenalty: siteDecision.laws.penalty,
          activeLawProcesses: siteDecision.laws.activeProcesses.join(','),
        },
      })
      created.push(building)
    this.objectSpatialIndex.upsert(building)
      this.history.push({ type: 'add', object: { ...building } })
    }
    if (created.length > 1) {
      const hub = created[0]
      for (let i = 1; i < created.length; i++) {
        const b = created[i]
        const road = this.buildRoad(hub.x, hub.z, b.x, b.z, 16)
        created.push(...road)
      }
    }
    this.syncObjects()
    this.scheduleSave()
    return created
  }

  scatter(kind: WorldObjectKind, x0: number, z0: number, x1: number, z1: number, density = 0.15) {
    const candidates = this.objects.scatter(this.worldSeed, kind, x0, z0, x1, z1, 32, density)
    const created: WorldObject[] = []
    for (const object of candidates) {
      const lawGate = this.lawGateForBuild(kind, object.x, object.z)
      if (!lawGate.allowed) {
        this.objects.remove(object.id)
        continue
      }
      const updated = this.objects.update(object.id, {
        y: this.sampleTerrainHeight(object.x, object.z),
        properties: {
          ...object.properties,
          lawPenalty: lawGate.decision?.laws.penalty ?? 0,
          activeLawProcesses: lawGate.decision?.laws.activeProcesses.join(',') ?? '',
        },
      })
      if (!updated) continue
      this.objectSpatialIndex.upsert(updated)
      this.history.push({ type: 'add', object: updated })
      created.push(updated)
    }
    this.syncObjects()
    this.scheduleSave()
    return created
  }

  private rotateFlyCamera(deltaX: number, deltaY: number) {
    const direction = this.camera.getWorldDirection(new THREE.Vector3())
    let yaw = Math.atan2(-direction.x, -direction.z)
    let pitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1))
    const sensitivity = 0.002
    yaw -= deltaX * sensitivity
    pitch = THREE.MathUtils.clamp(
      pitch - deltaY * sensitivity,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01,
    )
    this.camera.rotation.order = 'YXZ'
    this.camera.rotation.set(pitch, yaw, 0)
    const forward = this.camera.getWorldDirection(new THREE.Vector3())
    this.controls.target.copy(this.camera.position).addScaledVector(forward, 30)
  }

  private updateFly(dt: number) {
    if (!this.flyMode) return
    const direction = new THREE.Vector3()
    if (this.keys.has('KeyW')) direction.z -= 1
    if (this.keys.has('KeyS')) direction.z += 1
    if (this.keys.has('KeyA')) direction.x -= 1
    if (this.keys.has('KeyD')) direction.x += 1
    if (this.keys.has('Space')) direction.y += 1
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) direction.y -= 1
    if (direction.lengthSq() === 0) return
    direction.normalize().multiplyScalar(this.flySpeed * dt)
    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize()
    const up = this.camera.up.clone()
    this.worldPosition.addScaledVector(right, direction.x)
    this.worldPosition.addScaledVector(forward, -direction.z)
    this.worldPosition.addScaledVector(up, direction.y)
    this.camera.position.set(
      this.worldPosition.x - this.worldAnchor.x,
      this.worldPosition.y - this.worldAnchor.y,
      this.worldPosition.z - this.worldAnchor.z,
    )
    this.controls.target.copy(this.camera.position).add(forward.multiplyScalar(30))
  }

  private maybeRecenter() {
    const distance = Math.hypot(
      this.worldPosition.x - this.worldAnchor.x,
      this.worldPosition.y - this.worldAnchor.y,
      this.worldPosition.z - this.worldAnchor.z,
    )
    if (distance < this.recenterDistance) return
    const old = this.worldAnchor.clone()
    this.worldAnchor.copy(this.worldPosition)
    this.worldAnchor.y = 0
    const shift = this.worldAnchor.clone().sub(old)
    for (const patch of this.patches.values()) patch.group.position.sub(shift)
    for (const entry of this.objectMeshes.values()) {
      entry.group.position.set(
        entry.object.x - this.worldAnchor.x,
        entry.object.y - this.worldAnchor.y,
        entry.object.z - this.worldAnchor.z,
      )
    }
    this.camera.position.sub(shift)
    this.controls.target.sub(shift)
  }

  private updateOrbitKeyboard(dt: number) {
    if (this.flyMode || !this.controls.enabled || this.keys.size === 0) return
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 160 : 75) * dt
    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() > 0.001) forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()

    const move = new THREE.Vector3()
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.addScaledVector(forward, speed)
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.addScaledVector(forward, -speed)
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move.addScaledVector(right, -speed)
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.addScaledVector(right, speed)

    if (move.lengthSq() > 0) {
      this.camera.position.add(move)
      this.controls.target.add(move)
      this.syncWorldPositionFromControls()
    }

    if (this.keys.has('KeyQ')) {
      this.turnAround(1.8 * dt, 0)
    }
    if (this.keys.has('KeyE')) {
      this.turnAround(-1.8 * dt, 0)
    }
  }

  render(dt = 0.016) {
    if (!this.enabled) return
    const frameStart = this.runtimeDiagnostics.beginFrame()

    // Cinema Mode camera track interpolation if defined
    const cc = (window as any).cinemaCamera
    if ((window as any).currentAppMode === 'cinema' && cc && typeof cc.x === 'number' && typeof cc.y === 'number' && typeof cc.z === 'number') {
      this.camera.position.set(cc.x, cc.y, cc.z)
      if (typeof cc.fov === 'number' && Math.abs(this.camera.fov - cc.fov) > 0.1) {
        this.camera.fov = cc.fov
        this.camera.updateProjectionMatrix()
      }
    } else if (this.flyMode) {
      this.updateFly(dt)
    } else {
      this.updateOrbitKeyboard(dt)
      if (this.controls.enabled) this.controls.update()
    }

    this.maybeRecenter()

    const chunkStart = performance.now()
    this.syncChunks()
    this.syncPersistentObjects()
    this.syncObjects()
    this.runtimeDiagnostics.recordChunkSync(performance.now() - chunkStart)

    if (this.simulationRunning) this.animatePhysicsObjects(dt)

    const physicsStart = performance.now()
    this.updatePhysicsParticles(dt)
    this.runtimeDiagnostics.recordPhysics(
      performance.now() - physicsStart,
      this.physicsFrameInteractions,
      this.physicsFrameQueries,
    )

    this.worldAssetRuntime.rebase(this.worldAnchor)
    this.worldAssetRuntime.updateVisibility(this.camera, 650, 500)

    const lodStart = performance.now()
    this.updateTerrainLod()
    this.runtimeDiagnostics.recordTerrainLod(performance.now() - lodStart)

    this.renderer.render(this.scene, this.camera)
    this.runtimeDiagnostics.recordFrame(frameStart)

    // Adapt backing-buffer resolution slowly to sustained load, not single-frame spikes.
    const frameTimeMs = performance.now() - frameStart
    this.adaptiveFrameCount += 1
    this.adaptiveFrameTimeMs += frameTimeMs
    if (this.adaptiveFrameCount >= 45) {
      const averageFrameMs = this.adaptiveFrameTimeMs / this.adaptiveFrameCount
      let nextRatio = this.currentPixelRatio
      if (averageFrameMs > 28) nextRatio = Math.max(1, this.currentPixelRatio - 0.25)
      else if (averageFrameMs < 15) nextRatio = Math.min(this.maxPixelRatio, this.currentPixelRatio + 0.25)
      if (nextRatio !== this.currentPixelRatio) {
        this.currentPixelRatio = nextRatio
        this.renderer.setPixelRatio(nextRatio)
      }
      this.lastAdaptiveFrameMs = averageFrameMs
      this.adaptiveFrameCount = 0
      this.adaptiveFrameTimeMs = 0
    }
  }

  private initPhysicsParticleSystem(count = 700) {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    const vel = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const idx = i * 3
      pos[idx] = (Math.random() - 0.5) * 220
      pos[idx + 1] = 5 + Math.random() * 25
      pos[idx + 2] = (Math.random() - 0.5) * 220

      vel[idx] = (Math.random() - 0.5) * 2.5
      vel[idx + 1] = (Math.random() - 0.5) * 0.8
      vel[idx + 2] = (Math.random() - 0.5) * 2.5

      col[idx] = 0.5 + Math.random() * 0.5
      col[idx + 1] = 0.7 + Math.random() * 0.3
      col[idx + 2] = 1.0
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))

    const mat = new THREE.PointsMaterial({
      size: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    this.physicsParticlePoints = new THREE.Points(geo, mat)
    this.physicsParticlePositions = pos
    this.physicsParticleVelocities = vel
    this.physicsParticleColors = col
    this.scene.add(this.physicsParticlePoints)
  }

  private physicsFrameQueries = 0
  private physicsFrameInteractions = 0

  private updatePhysicsParticles(dt: number) {
    this.physicsFrameQueries = 0
    this.physicsFrameInteractions = 0
    if (!this.simulationRunning || !this.physicsParticlePoints || !this.showParticles) return
    const pos = this.physicsParticlePositions
    const vel = this.physicsParticleVelocities
    const col = this.physicsParticleColors
    const count = pos.length / 3
    const camX = this.worldPosition.x
    const camZ = this.worldPosition.z
    const physicsKinds = new Set<WorldObjectKind>(['metalaw', 'gravity_well', 'entropy_sink', 'quantum_emitter', 'force_field'])

    for (let i = 0; i < count; i++) {
      const idx = i * 3
      let px = pos[idx]
      let py = pos[idx + 1]
      let pz = pos[idx + 2]

      let vx = vel[idx]
      let vy = vel[idx + 1]
      let vz = vel[idx + 2]

      // Natural atmospheric drift
      vx *= 0.985
      vy *= 0.985
      vz *= 0.985
      vy += 0.25 * dt

      // Query only nearby physics objects through the chunk-local spatial index.
      const worldX = px + this.worldAnchor.x
      const worldZ = pz + this.worldAnchor.z
      this.physicsFrameQueries++
      const nearbyObjects = this.objectSpatialIndex.queryRadius(worldX, py, worldZ, 160, physicsKinds)
      for (const obj of nearbyObjects) {
        const dx = obj.x - worldX
        const dz = obj.z - worldZ
        const distSq = dx * dx + dz * dz
        const rad = obj.scale * 38

        if (distSq < rad * rad) {
          const dist = Math.sqrt(distSq) || 0.1
          const factor = (1 - dist / rad)

          const field = this.fieldSampler.sample(worldX, py, worldZ)
          const modulation = this.lawPhysicsContract.apply(this.fieldPhysics.modulation(field))

          const interactionType: PhysicsInteractionType =
            obj.kind === 'gravity_well' ? 'gravity' :
            obj.kind === 'entropy_sink' ? 'entropy' :
            obj.kind === 'quantum_emitter' ? 'quantum' :
            obj.kind === 'force_field' ? 'force-field' : 'metalaw'
          const magnitude = factor
          if (magnitude > 0.15) {
            this.physicsFrameInteractions++
            this.physicsInteractionLog.add(createPhysicsInteractionRecord(
              interactionType,
              obj.kind,
              obj.id,
              i,
              { x: worldX, y: py, z: worldZ },
              field,
              modulation,
              magnitude,
            ))
          }

          if (obj.kind === 'gravity_well') {
            // Gravitational singularity: pull inward & spin accretion
            const pull = factor * modulation.gravity * dt
            vx += (dx / dist) * pull - (dz / dist) * pull * 0.85
            vz += (dz / dist) * pull + (dx / dist) * pull * 0.85
            col[idx] = 0.85; col[idx + 1] = 0.25; col[idx + 2] = 1.0 // purple accretion
          } else if (obj.kind === 'entropy_sink') {
            // Thermodynamic damper: freeze velocity and turn cryogenic
            vx *= modulation.entropyDamping
            vy *= modulation.entropyDamping
            vz *= modulation.entropyDamping
            col[idx] = 0.25; col[idx + 1] = 0.9; col[idx + 2] = 1.0 // ice cyan
          } else if (obj.kind === 'quantum_emitter') {
            // Coherence core: vertical resonance beam lift
            vy += factor * modulation.quantumLift * dt
            col[idx] = 0.15; col[idx + 1] = 1.0; col[idx + 2] = 0.45 // radiant emerald
          } else if (obj.kind === 'force_field') {
            // Barrier: deflect outward
            const push = factor * modulation.forcePush * dt
            vx -= (dx / dist) * push
            vz -= (dz / dist) * push
            col[idx] = 0.0; col[idx + 1] = 0.85; col[idx + 2] = 1.0 // barrier cyan
          } else if (obj.kind === 'metalaw') {
            // MetaLaw node: harmonic gyroscopic orbital flow
            vx += -(dz / dist) * factor * modulation.metaLawOrbit * dt
            vz += (dx / dist) * factor * modulation.metaLawOrbit * dt
            col[idx] = 1.0; col[idx + 1] = 0.88; col[idx + 2] = 0.2 // golden law
          }
        }
      }

      px += vx * dt
      py += vy * dt
      pz += vz * dt

      // Area boundary wrap
      if (Math.abs(px - camX) > 135) px = camX - Math.sign(px - camX) * 130
      if (Math.abs(pz - camZ) > 135) pz = camZ - Math.sign(pz - camZ) * 130
      if (py > 65) py = 4
      if (py < 2) { py = 2; vy = Math.abs(vy) * 0.5 + 2 }

      pos[idx] = px
      pos[idx + 1] = py
      pos[idx + 2] = pz

      vel[idx] = vx
      vel[idx + 1] = vy
      vel[idx + 2] = vz
    }

    const geo = this.physicsParticlePoints.geometry
    geo.attributes.position.needsUpdate = true
    geo.attributes.color.needsUpdate = true
  }

  setShowParticles(visible: boolean) {
    this.showParticles = visible
    if (this.physicsParticlePoints) {
      this.physicsParticlePoints.visible = visible
    }
  }

  getShowParticles(): boolean {
    return this.showParticles
  }

  private animatePhysicsObjects(dt: number) {
    if (this.objectMeshes.size === 0) return
    for (const entry of this.objectMeshes.values()) {
      const kind = entry.object.kind
      const group = entry.group
      if (kind === 'metalaw' && group.children.length >= 3) {
        group.children[1].rotation.z += 1.2 * dt
        group.children[2].rotation.x += 0.9 * dt
      } else if (kind === 'gravity_well' && group.children.length >= 2) {
        group.children[1].rotation.z += 2.2 * dt
      } else if (kind === 'entropy_sink' && group.children.length >= 2) {
        group.children[1].rotation.y += 0.8 * dt
      } else if (kind === 'quantum_emitter' && group.children.length >= 2) {
        group.children[0].rotation.y += 1.5 * dt
        group.children[0].rotation.x += 0.8 * dt
      } else if (kind === 'force_field') {
        const t = performance.now() * 0.002
        group.scale.setScalar(entry.object.scale * (1 + 0.015 * Math.sin(t * 3)))
      }
    }
  }

  startExperiment(metadata: Record<string, string | number | boolean> = {}) {
    const provider = this.fieldSampler.registry.getActive()
    const surfaceProvider = this.fieldSampler.surfaceProvider
    const protocol = createExperimentProtocol({
      experimentId: `exp-${Date.now().toString(36)}`,
      world: {
        seed: this.generator.seed,
        generatorVersion: 'world-generator-v1',
        surface: {
          seed: surfaceProvider.seed,
          providerId: surfaceProvider.id,
          providerVersion: surfaceProvider.version,
        },
      },
      field: {
        providerId: provider?.id ?? 'unknown',
        providerVersion: provider?.version ?? 'unknown',
      },
      decision: { version: this.decisionLayer.version, weights: this.decisionLayer.weights },
      physics: { version: this.fieldPhysics.version, parameters: this.fieldPhysics.parameters },
      metadata,
    })
    return this.experimentRunner.start(protocol)
  }

  recordExperimentResult(name: string, value: unknown) {
    this.experimentRunner.record(name, value)
  }

  finishExperiment(status: 'completed' | 'aborted' = 'completed'): ExperimentSnapshot {
    this.recordExperimentResult('runtime', this.getRuntimeDiagnostics())
    this.recordExperimentResult('physicsInteractions', this.physicsInteractionLog.recent(500))
    this.recordExperimentResult('decisionGraph', this.decisionGraph.snapshot())
    const snapshot = this.experimentRunner.finish(status)
    this.experimentCatalog.add(snapshot)
    return snapshot
  }

  compareExperiments(left: ExperimentSnapshot, right: ExperimentSnapshot): ExperimentComparison {
    return compareExperiments(left, right)
  }

  getExperiment(experimentId: string) {
    return this.experimentCatalog.get(experimentId)
  }

  getRecentExperiments(limit = 20) {
    return this.experimentCatalog.recent(limit)
  }

  getExperimentCatalogSnapshot() {
    return this.experimentCatalog.snapshot()
  }

  analyzeExperiments(groupBy: 'seed' | 'provider' | 'physics' | 'decision' = 'provider'): ExperimentAnalysis {
    return analyzeExperiments(this.experimentCatalog.list(), groupBy)
  }

  analyzeExperimentStatistics(groupBy: 'seed' | 'provider' | 'physics' | 'decision' = 'provider'): StatisticalExperimentAnalysis {
    return calculateStatisticalAnalysis(this.analyzeExperiments(groupBy))
  }

  getRuntimeDiagnostics() {
    return {
      ...this.runtimeDiagnostics.snapshot(
        this.getLoadedChunkCount(),
        this.objectMeshes.size,
        this.physicsParticlePositions.length / 3,
      ),
      pixelRatio: this.currentPixelRatio,
      maxPixelRatio: this.maxPixelRatio,
      adaptiveFrameMs: this.lastAdaptiveFrameMs,
      enabled: this.enabled,
    }
  }

  getPhysicsInteractionSnapshot(limit = 100) {
    return this.physicsInteractionLog.recent(limit)
  }

  clearPhysicsInteractionLog() {
    this.physicsInteractionLog.clear()
  }

  getDecisionGraphSnapshot() {
    return this.decisionGraph.snapshot()
  }

  clearDecisionGraph() {
    this.decisionGraph.clear()
  }

  getLoadedChunkCount() { return this.patches.size }
  getObjectCount() { return this.objects.size }
  getStorageKey() { return this.storageKey }
}
