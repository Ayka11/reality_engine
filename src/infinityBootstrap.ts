import { InfiniteWorldRenderer } from './render/InfiniteWorldRenderer'
import { findWorldLibraryEntries, resolveWorldLibraryEntry, worldLibrary } from './worldLibrary'
import type { WorldObjectKind } from './infinity/WorldObject'

export type DockPosition = 'top' | 'left' | 'right' | 'float'

export function bootstrapInfiniteWorld() {
  const existing = (window as any).infiniteWorld
  if (existing) return existing
  const canvas = document.getElementById('c3d') as HTMLCanvasElement | null
  if (!canvas) return null
  const seed = (window as any).worldSeed || 'reality-seed-1'
  const world = new InfiniteWorldRenderer(canvas, seed)
  ;(window as any).infiniteWorld = world
  ;(window as any).infiniteWorldControls = world
  ;(window as any).worldLibrary = worldLibrary
  ;(window as any).worldLibraryStats = () => worldLibrary.stats()
  ;(window as any).worldLibrarySearch = (tags: string[] = [], category?: string) =>
    findWorldLibraryEntries(tags, category as any)
  ;(window as any).worldLibraryGet = (id: string) => resolveWorldLibraryEntry(id)
  ;(window as any).infinityStats = () => ({ ...world.getRuntimeStats(), library: worldLibrary.stats() })
  ;(window as any).focusGeneratedWorld = () => {
    const result = world.focusGeneratedRegion()
    world.render(0)
    syncWorldUI()
    return result
  }

  // ── 3D Controls Bindings on window (ensures Right Panel controls always work) ───
  const isField3DActive = () => document.getElementById('c3dField')?.style.display !== 'none'
  ;(window as any).setCameraPreset = (p: string) => {
    if (isField3DActive() && (window as any).fieldSetCameraPreset) {
      ;(window as any).fieldSetCameraPreset(p)
      return
    }
    const map: Record<string, 'orbit' | 'top' | 'front' | 'iso'> = {
      orbit: 'orbit',
      top: 'top',
      iso: 'iso',
      street: 'front',
      front: 'front',
      fly: 'orbit',
    }
    if (p === 'fly') {
      world.setFlyMode(true)
      return
    }
    world.setFlyMode(false)
    world.setCameraPreset(map[p] ?? 'orbit')
  }
  ;(window as any).setTimeOfDay = (h: number) => {
    if (isField3DActive() && (window as any).fieldSetTimeOfDay) return (window as any).fieldSetTimeOfDay(h)
    world.setTimeOfDay(h)
  }
  ;(window as any).setFogDensity = (d: number) => {
    if (isField3DActive() && (window as any).fieldSetFogDensity) return (window as any).fieldSetFogDensity(d)
    world.setFogDensity(d)
  }
  ;(window as any).setMatMode = (m: string) => {
    if (isField3DActive() && (window as any).fieldSetMatMode) return (window as any).fieldSetMatMode(m)
    world.setMaterialMode(m as 'field' | 'material' | 'height')
  }

  // ── Camera Manipulation Shortcuts on window ───────────────────────────────
  ;(window as any).infinityZoom = (delta: number) => world.zoom(delta)
  ;(window as any).infinityTurn = (dH: number, dV = 0) => world.turnAround(dH, dV)
  ;(window as any).infinityPan = (dx: number, dz: number) => world.pan(dx, dz)
  ;(window as any).infinityFocus = () => world.focusSelection()
  ;(window as any).infinityResetCamera = () => world.resetCameraView()
  ;(window as any).infinitySetPreset = (p: 'top' | 'front' | 'orbit' | 'iso') => world.setCameraPreset(p)
  ;(window as any).infinitySetFlyMode = (fly: boolean) => world.setFlyMode(fly)
  ;(window as any).setShowParticles = (v: boolean) => {
    if (isField3DActive() && (window as any).fieldSetShowParticles) return (window as any).fieldSetShowParticles(v)
    world.setShowParticles(v)
  }
  ;(window as any).getShowParticles = () => world.getShowParticles()

  ;(window as any).cinemaFlyover = (durationMs = 8000) => {
    world.setFlyMode(false)
    const startX = world.worldPosition.x - 90
    const startZ = world.worldPosition.z - 90
    const endX = startX + 180
    const endZ = startZ + 180
    const startTime = performance.now()
    const animateFlyover = (now: number) => {
      const elapsed = now - startTime
      const t = Math.min(1, elapsed / durationMs)
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
      const curX = startX + (endX - startX) * ease
      const curZ = startZ + (endZ - startZ) * ease
      const curY = 32 + Math.sin(ease * Math.PI) * 18
      world.camera.position.set(curX, curY, curZ)
      world.controls.target.set(curX + 35, 12, curZ + 35)
      world.controls.update()
      if (t < 1) requestAnimationFrame(animateFlyover)
    }
    requestAnimationFrame(animateFlyover)
  }

  ;(window as any).cinemaOrbitHero = (durationMs = 7000) => {
    world.setFlyMode(false)
    const target = world.controls.target.clone()
    const radius = 65
    const startTime = performance.now()
    const animateOrbit = (now: number) => {
      const elapsed = now - startTime
      const t = Math.min(1, elapsed / durationMs)
      const angle = t * Math.PI * 2
      world.camera.position.set(
        target.x + Math.cos(angle) * radius,
        target.y + 24 + Math.sin(t * Math.PI) * 8,
        target.z + Math.sin(angle) * radius
      )
      world.controls.target.copy(target)
      world.controls.update()
      if (t < 1) requestAnimationFrame(animateOrbit)
    }
    requestAnimationFrame(animateOrbit)
  }

  // ── Scientific & Spatial Analysis APIs on window ───────────────────────────
  ;(window as any).infinityAnalyzeHydrology = (x: number, z: number, radius = 220, samples = 41) =>
    world.analyzeHydrology(x, z, radius, samples)
  ;(window as any).infinityAnalyzeWatershed = (x: number, z: number, radius = 220, samples = 41) =>
    world.analyzeWatershed(x, z, radius, samples)
  ;(window as any).infinityBuildZoneCost = (x: number, z: number) =>
    world.buildZoneCost(x, z)
  ;(window as any).infinityBuildAnalyticalOverlay = (x: number, z: number, radius = 160, samples = 33, mode: 'suitability' | 'flood' | 'slope' = 'suitability') =>
    world.buildAnalyticalOverlay(x, z, radius, samples, mode)
  ;(window as any).infinitySetAnalyticalOverlay = (mode: 'suitability' | 'flood' | 'slope' | null) =>
    world.setAnalyticalOverlay(mode)
  ;(window as any).infinityExplainBuildDecision = (x: number, z: number) =>
    world.explainBuildDecision(x, z)
  ;(window as any).infinityGenerateRiverNetwork = (x: number, z: number, radius = 220, samples = 41) =>
    world.generateRiverNetwork(x, z, radius, samples)
  ;(window as any).infinityTraceRiverSource = (x: number, z: number, maxSteps = 160, step = 8) =>
    world.traceRiverSource(x, z, maxSteps, step)
  ;(window as any).infinityGenerateRiverTraces = (x: number, z: number, radius = 220, sources = 6) =>
    world.generateRiverTraces(x, z, radius, sources)
  ;(window as any).infinityBuildRiverMeshes = (x: number, z: number, radius = 220, sources = 6, width = 5) =>
    world.buildRiverMeshes(x, z, radius, sources, width)
  ;(window as any).infinityPlanCity = (x: number, z: number, radius = 180, samples = 31) =>
    world.planCity(x, z, radius, samples)
  ;(window as any).infinityGenerateCityPlan = (x: number, z: number, radius = 180, samples = 31) =>
    world.generateCityPlan(x, z, radius, samples)
  ;(window as any).infinityAnalyzeRoute = (x0: number, z0: number, x1: number, z1: number, samples = 32) =>
    world.analyzeRoute(x0, z0, x1, z1, samples)
  ;(window as any).infinityBuildSmartRoute = (x0: number, z0: number, x1: number, z1: number, spacing = 12) =>
    world.buildSmartRoute(x0, z0, x1, z1, spacing)
  ;(window as any).infinityOptimizeRoute = (x0: number, z0: number, x1: number, z1: number, gridSize = 12) =>
    world.optimizeRoute(x0, z0, x1, z1, gridSize)
  ;(window as any).infinityStorageKey = () =>
    world.getStorageKey()
  ;(window as any).infinityHandlePointer = (clientX: number, clientY: number) =>
    world.handlePointer(clientX, clientY)
  ;(window as any).infinityStats = () => ({
    loadedChunks: world.getLoadedChunkCount(),
    objects: world.getObjectCount(),
    camera: {
      x: Math.round(world.camera.position.x),
      y: Math.round(world.camera.position.y),
      z: Math.round(world.camera.position.z),
      worldX: Math.round(world.worldCoordinates.x),
      worldY: Math.round(world.worldCoordinates.y),
      worldZ: Math.round(world.worldCoordinates.z),
    },
  })

  // ── World Builder Bridge on window ─────────────────────────────────────────
  const updateObjInspector = (obj: any) => {
    const el = document.getElementById('objInspector')
    if (!el) return
    if (!obj) {
      el.innerHTML = '<span style="font-size:9.5px;color:var(--sub)">Click an object in 3D to inspect and edit</span>'
      return
    }
    const kindNames: Record<string, string> = {
      tree: '🌲 Forest Canopy',
      rock: '🪨 Geological Formation',
      crystal: '💎 Resonant Crystal',
      water: '💧 Water Reservoir',
      building: '🏛️ Architecture / Structure',
      road: '🛣️ Paved Infrastructure',
      bridge: '🌉 Span Bridge',
      landmark: '🚩 Survey Landmark',
      spawn: '📍 Entity Spawn Beacon',
      custom: '📦 Custom Geometry',
      gravity_well: '🌀 Gravitational Singularity',
      entropy_sink: '❄️ Thermodynamic Damper',
      quantum_emitter: '⚛️ Quantum Coherence Core',
      metalaw: '📜 MetaLaw Node',
      force_field: '🛡️ Kinetic Force Barrier',
    }
    const isPhysics = ['gravity_well', 'entropy_sink', 'quantum_emitter', 'metalaw', 'force_field'].includes(obj.kind)
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
        <b style="font-size:10px;color:#c0b8f8">${kindNames[obj.kind] || obj.kind}</b>
        <span style="font-size:8.5px;font-family:monospace;color:var(--sub)">#${obj.id.slice(-6)}</span>
      </div>
      <div style="font-size:8.5px;color:var(--sub);font-family:monospace;margin-bottom:3px">
        Pos: (${obj.x.toFixed(1)}, ${obj.y.toFixed(1)}, ${obj.z.toFixed(1)})
      </div>
      <div style="font-size:8.5px;color:var(--sub);font-family:monospace;margin-bottom:4px">
        Scale: ${obj.scale.toFixed(2)}x · Rot: ${((obj.rotationY * 180) / Math.PI).toFixed(0)}°
      </div>
      ${isPhysics ? `
        <div style="background:rgba(124,111,205,0.12);border:0.5px solid rgba(124,111,205,0.3);border-radius:4px;padding:4px 6px;margin:3px 0 5px;font-size:8.5px;color:#a09af0">
          <div>⚡ <b>Simulated Physics Object</b></div>
          <div style="color:var(--tx);margin-top:1px">Rule: ${obj.kind.replace('_', ' ').toUpperCase()} Active</div>
          <div style="color:var(--sub)">Field radius: ${(obj.scale * 45).toFixed(0)}m</div>
        </div>
      ` : ''}
      <div style="display:flex;gap:3px;margin-top:4px">
        <button class="pill on" style="flex:1;font-size:8.5px;padding:2px 4px" onclick="window.infinityFocus&&window.infinityFocus()">⛶ Focus</button>
        <button class="pill" style="flex:1;font-size:8.5px;padding:2px 4px;color:#e06060;border-color:#502020" onclick="window.builderDeleteSelected&&window.builderDeleteSelected()">🗑️ Del</button>
        <button class="pill" style="flex:1;font-size:8.5px;padding:2px 4px" onclick="window.builderDeselect&&window.builderDeselect()">✕ Desel</button>
      </div>
    `
  }

  const notifyBuilder = () => {
    updateObjInspector(world.getSelectedObject())
    document.dispatchEvent(new CustomEvent('builderUpdated'))
  }

  ;(window as any).builderGetState = () => ({
    tool: world.getObjectTool(),
    kind: world.getObjectKind(),
    transformMode: world.getTransformMode(),
    snap: world.getSnapToGrid(),
    objectCount: world.getObjectCount(),
    selected: world.getSelectedObject(),
    overlay: world.getAnalyticalOverlayMode(),
  })

  ;(window as any).builderSetTool = (t: 'navigate' | 'select' | 'place' | 'erase') => {
    world.setObjectTool(t)
    notifyBuilder()
  }

  ;(window as any).builderSetKind = (k: WorldObjectKind) => {
    world.setObjectKind(k)
    world.setObjectTool('place')
    notifyBuilder()
  }

  ;(window as any).builderSetTransform = (m: 'translate' | 'rotate' | 'scale') => {
    world.setTransformMode(m)
    world.setObjectTool('select')
    notifyBuilder()
  }

  ;(window as any).builderSetSnap = (snap: number) => {
    world.setSnapToGrid(snap)
    notifyBuilder()
  }

  ;(window as any).builderDeleteSelected = () => {
    world.deleteSelected()
    notifyBuilder()
  }

  ;(window as any).builderDeselect = () => {
    ;(world as any).selectedObjectId = null
    ;(world as any).transformControls.detach()
    ;(world as any).selectionMarker.visible = false
    notifyBuilder()
  }

  ;(window as any).builderFocus = () => {
    world.focusSelection()
    notifyBuilder()
  }

  ;(window as any).builderUndo = () => {
    world.undo()
    notifyBuilder()
  }

  ;(window as any).builderRedo = () => {
    world.redo()
    notifyBuilder()
  }

  ;(window as any).builderSave = () => {
    world.saveWorld()
    notifyBuilder()
  }

  ;(window as any).builderClear = () => {
    world.clearSavedWorld()
    notifyBuilder()
  }

  ;(window as any).builderGenerateSettlement = () => {
    const x = world.worldCoordinates.x || 16, z = world.worldCoordinates.z || 16
    world.generateSettlementV2(x, z, 120, 4)
    notifyBuilder()
  }

  ;(window as any).builderGenerateCityPlan = () => {
    const x = world.worldCoordinates.x || 16, z = world.worldCoordinates.z || 16
    world.generateCityPlan(x, z, 180, 31)
    notifyBuilder()
  }

  ;(window as any).builderGenerateRivers = () => {
    const x = world.worldCoordinates.x || 16, z = world.worldCoordinates.z || 16
    world.generateRiverNetwork(x, z, 220, 41)
    notifyBuilder()
  }

  ;(window as any).builderSmartRoute = () => {
    const x = world.worldCoordinates.x || 16, z = world.worldCoordinates.z || 16
    world.buildSmartRoute(x - 120, z - 120, x + 120, z + 120, 12)
    notifyBuilder()
  }

  ;(window as any).builderScatter = (kind: WorldObjectKind, density = 0.1) => {
    const x = world.worldCoordinates.x || 16, z = world.worldCoordinates.z || 16
    world.scatter(kind, x - 100, z - 100, x + 100, z + 100, density)
    notifyBuilder()
  }

  ;(window as any).builderSetOverlay = (mode: 'suitability' | 'flood' | 'slope' | null) => {
    world.setAnalyticalOverlay(mode)
    notifyBuilder()
  }

  // ── Sync UI Controls with 3D State ─────────────────────────────────────────
  const syncWorldUI = (timeOfDay: number, fogDensity: number, matMode: 'field' | 'material' | 'height') => {
    const todVal = document.getElementById('todVal')
    if (todVal) todVal.textContent = Math.round(timeOfDay) + 'h'
    const todSlider = document.querySelector('input[type=range][min="0"][max="24"]') as HTMLInputElement | null
    if (todSlider) todSlider.value = String(timeOfDay)

    const fogVal = document.getElementById('fogVal')
    if (fogVal) fogVal.textContent = fogDensity.toFixed(3)
    const fogSlider = document.querySelector('input[type=range][min="0"][max="0.06"]') as HTMLInputElement | null
    if (fogSlider) fogSlider.value = String(fogDensity)

    const matPills = document.querySelectorAll('#matFieldPill,#matMaterialPill,#matHeightPill')
    matPills.forEach(p => p.classList.remove('on'))
    if (matMode === 'field') document.getElementById('matFieldPill')?.classList.add('on')
    else if (matMode === 'material') document.getElementById('matMaterialPill')?.classList.add('on')
    else if (matMode === 'height') document.getElementById('matHeightPill')?.classList.add('on')

    const topMatBtns = document.querySelectorAll('#matField,#matMaterial,#matHeight')
    topMatBtns.forEach(b => b.classList.remove('active'))
    if (matMode === 'field') document.getElementById('matField')?.classList.add('active')
    else if (matMode === 'material') document.getElementById('matMaterial')?.classList.add('active')
    else if (matMode === 'height') document.getElementById('matHeight')?.classList.add('active')
  }

  // ── High-Fidelity Integral Reality Composer Integration ────────────────────
  ;(window as any).infinityApplyComposer = (config: { phi: string; fields: string; complexity: string; spacetime: string }) => {
    const phi = config.phi || 'Harmonic'
    const fields = config.fields || 'Balanced'
    const complexity = config.complexity || 'Emergent'
    const spacetime = config.spacetime || 'Standard'

    // All four Composer dimensions now drive the visible Infinite World.
    const newSeed = `reality-${phi}-${fields}-${complexity}-${spacetime}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
    world.reseed(newSeed)

    const x = 16
    const z = 16

    const fieldScale: Record<string, { density: number; energy: number; info: number }> = {
      'Energy Dominant': { density: 0.55, energy: 1.5, info: 0.65 },
      'Information Dense': { density: 0.8, energy: 0.9, info: 1.5 },
      'Balanced': { density: 1.0, energy: 1.0, info: 1.0 },
      'Mass Dominant': { density: 1.6, energy: 0.65, info: 0.45 },
      'Sparse': { density: 0.35, energy: 0.75, info: 1.25 },
      'Pure Info': { density: 0.25, energy: 0.5, info: 1.8 },
    }
    const fs = fieldScale[fields] ?? fieldScale.Balanced

    const complexityScale: Record<string, { radius: number; structures: number; density: number }> = {
      'Stable': { radius: 90, structures: 3, density: 0.65 },
      'Emergent': { radius: 120, structures: 5, density: 1.0 },
      'Explosive': { radius: 165, structures: 9, density: 1.55 },
      'Collapsing': { radius: 75, structures: 2, density: 0.4 },
      'Oscillating': { radius: 145, structures: 7, density: 1.2 },
    }
    const cs = complexityScale[complexity] ?? complexityScale.Emergent

    let tod = 14
    let fog = 0.012
    let mat: 'field' | 'material' | 'height' = 'field'

    // Φ: base archetype.
    if (phi === 'Void') {
      tod = 0.5; fog = 0.004; mat = 'material'
      world.scatter('rock', x - 120, z - 120, x + 120, z + 120, 0.04 * fs.density)
      world.scatter('crystal', x - 90, z - 90, x + 90, z + 90, 0.03 * fs.info)
      world.place('gravity_well', x, z, 1.4)
    } else if (phi === 'Living') {
      world.scatter('tree', x - 140, z - 140, x + 140, z + 140, 0.10 * fs.density)
      world.scatter('tree', x - 70, z - 70, x + 70, z + 70, 0.05 * fs.info)
      world.scatter('rock', x - 100, z - 100, x + 100, z + 100, 0.04 * fs.density)
      world.place('quantum_emitter', x + 25, z + 25, 1.2)
    } else if (phi === 'Chaotic') {
      tod = 18.5; fog = 0.024; mat = 'height'
      world.scatter('rock', x - 130, z - 130, x + 130, z + 130, 0.10 * fs.density)
      world.scatter('crystal', x - 90, z - 90, x + 90, z + 90, 0.07 * fs.info)
      world.place('gravity_well', x, z, 1.7)
      world.place('entropy_sink', x + 40, z - 40, 1.2)
    } else if (phi === 'Crystalline') {
      tod = 8.5; fog = 0.007
      world.scatter('crystal', x - 130, z - 130, x + 130, z + 130, 0.10 * fs.info)
      world.scatter('rock', x - 90, z - 90, x + 90, z + 90, 0.04 * fs.density)
      world.place('entropy_sink', x, z, 1.4)
      world.place('metalaw', x + 45, z + 45, 1.2)
    } else if (phi === 'Resonant') {
      tod = 15.5; fog = 0.010
      world.scatter('crystal', x - 110, z - 110, x + 110, z + 110, 0.06 * fs.info)
      world.place('quantum_emitter', x + 30, z + 20, 1.2)
      world.place('metalaw', x - 25, z - 25, 1.0)
    } else {
      // Harmonic.
      world.scatter('tree', x - 110, z - 110, x + 110, z + 110, 0.07 * fs.density)
      world.scatter('rock', x - 80, z - 80, x + 80, z + 80, 0.04 * fs.density)
      world.place('metalaw', x - 25, z - 25, 1.0)
    }

    // ρ·E·I: field balance.
    if (fields === 'Energy Dominant') {
      world.place('gravity_well', x + 55, z - 45, 1.0 + 0.3 * fs.energy)
    } else if (fields === 'Mass Dominant') {
      world.scatter('rock', x - 150, z - 150, x + 150, z + 150, 0.08 * fs.density)
      world.generateCityPlan(x, z, cs.radius, 21)
    } else if (fields === 'Information Dense' || fields === 'Pure Info') {
      world.scatter('crystal', x - 150, z - 150, x + 150, z + 150, 0.06 * fs.info)
      world.generateRiverNetwork(x, z, Math.max(160, cs.radius + 60), 31)
    } else {
      world.generateRiverNetwork(x, z, Math.max(140, cs.radius + 40), 31)
    }

    // C: structural complexity.
    world.generateSettlementV2(x, z, cs.radius, cs.structures)
    if (complexity === 'Explosive') {
      world.place('gravity_well', x - 55, z + 55, 1.4)
      world.place('quantum_emitter', x + 60, z - 60, 1.2)
    } else if (complexity === 'Collapsing') {
      world.place('entropy_sink', x + 35, z - 30, 1.4)
    } else if (complexity === 'Oscillating') {
      world.place('force_field', x + 55, z + 20, 1.0)
      world.place('quantum_emitter', x - 60, z - 45, 1.0)
    }

    // dτ·dV: temporal and spatial regime.
    if (spacetime === 'Slow Time') {
      tod = 7; fog = 0.018
    } else if (spacetime === 'Fractal Space') {
      fog = 0.006
      world.scatter('crystal', x - 180, z - 180, x + 180, z + 180, 0.04 * fs.info)
    } else if (spacetime === 'High Radiation') {
      tod = 17.5; fog = 0.028
      world.place('entropy_sink', x + 75, z + 10, 1.3)
      world.place('gravity_well', x - 70, z + 35, 1.1)
    } else if (spacetime === 'Meteor Zone') {
      tod = 16; fog = 0.020
      world.place('gravity_well', x - 80, z - 55, 1.2)
      world.place('force_field', x + 75, z + 55, 1.0)
    } else if (spacetime === 'Frozen Topology') {
      tod = 6; fog = 0.022; mat = 'material'
      world.place('entropy_sink', x + 45, z + 35, 1.5)
    }

    world.setTimeOfDay(tod)
    world.setFogDensity(fog)
    world.setMaterialMode(mat)
    world.setObjectTool('navigate')

    // Frame the generated region so Compose/Quick Generate immediately reveals
    // the newly created world instead of leaving the camera at an unrelated point.
    world.focusGeneratedRegion()

    // Force an immediate resize/render after generation. This is important when
    // Compose/Quick Generate switches the canvas from a hidden tab to the 3D view.
    const parent = canvas.parentElement
    if (parent) {
      world.resize(Math.max(1, parent.clientWidth), Math.max(1, parent.clientHeight))
    }
    world.render(0)

    syncWorldUI(tod, fog, mat)
    notifyBuilder()

    const plog = document.getElementById('plog')
    if (plog) {
      plog.textContent = `✦ Infinite Reality: Φ=${phi} · ρ·E·I=${fields} · C=${complexity} · dτ·dV=${spacetime}`
    }

    const stats = world.getRuntimeStats()
    return {
      ...stats.world,
      objects: stats.objects,
      loadedChunks: stats.loadedChunks,
    }
  }

  // ── DYNAMIC, DRAGGABLE INFINITY SCALE & WORLD BUILDER TOOLBAR ──────────────
  const wrap = canvas.parentElement
  if (wrap) {
    document.getElementById('infiniteWorldTools')?.remove()
    document.getElementById('workspaceBuilderDock')?.remove()
    document.getElementById('workspaceNavHUD')?.remove()
    document.getElementById('dockGhostPreview')?.remove()

    // Persistent docking state: 'top' | 'left' | 'right' | 'float'
    let dockPos: DockPosition = 'top'
    // World Tools is a workspace toolbar: keep it in the upper panel by default.
    // Legacy left/right/float preferences are normalized to top for the current UI.
    if (localStorage.getItem('infinity_dock_pos') !== 'top') {
      localStorage.setItem('infinity_dock_pos', 'top')
    }
    let isOpen = localStorage.getItem('infinity_dock_open') !== 'false'
    let activeTab: 'camera' | 'objects' | 'persist' | 'analysis' | 'display' = 'objects'
    let eraseRadius = 4

    let floatLeft = parseInt(localStorage.getItem('infinity_dock_float_x') || '40', 10)
    let floatTop = parseInt(localStorage.getItem('infinity_dock_float_y') || '60', 10)

    // Ghost indicator for drag-to-dock zones
    const ghost = document.createElement('div')
    ghost.id = 'dockGhostPreview'
    ghost.style.cssText =
      'position:absolute;display:none;pointer-events:none;z-index:22;border:2px dashed #7c6fcd;border-radius:10px;background:rgba(124,111,205,0.12);transition:all .15s;'
    wrap.appendChild(ghost)

    const container = document.createElement('div')
    container.id = 'infiniteWorldTools'
    wrap.appendChild(container)

    const showGhostZone = (zone: 'top' | 'left' | 'right' | null) => {
      if (!zone) {
        ghost.style.display = 'none'
        return
      }
      ghost.style.display = 'block'
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (zone === 'top') {
        ghost.style.left = '16px'
        ghost.style.top = '10px'
        ghost.style.width = `${w - 32}px`
        ghost.style.height = '85px'
        ghost.style.right = 'auto'
        ghost.style.bottom = 'auto'
      } else if (zone === 'left') {
        ghost.style.left = '12px'
        ghost.style.top = '10px'
        ghost.style.width = '290px'
        ghost.style.height = `${h - 20}px`
        ghost.style.right = 'auto'
        ghost.style.bottom = 'auto'
      } else if (zone === 'right') {
        ghost.style.left = `${w - 302}px`
        ghost.style.top = '10px'
        ghost.style.width = '290px'
        ghost.style.height = `${h - 20}px`
        ghost.style.right = 'auto'
        ghost.style.bottom = 'auto'
      }
    }

    const updateContainerStyle = () => {
      if (!isOpen) {
        // Minimized floating trigger pill
        if (dockPos === 'left') {
          container.style.cssText = `
            position: absolute;
            top: 10px;
            left: 12px;
            z-index: 30;
            pointer-events: auto;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          `
        } else if (dockPos === 'right') {
          container.style.cssText = `
            position: absolute;
            top: 10px;
            right: 12px;
            z-index: 30;
            pointer-events: auto;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          `
        } else if (dockPos === 'top') {
          container.style.cssText = `
            position: absolute;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 30;
            pointer-events: auto;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          `
        } else {
          // 'float' position
          container.style.cssText = `
            position: absolute;
            top: ${floatTop}px;
            left: ${floatLeft}px;
            z-index: 30;
            pointer-events: auto;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          `
        }
        return
      }

      // Open expanded styling based on dock position
      if (dockPos === 'top') {
        container.style.cssText = `
          position: absolute;
          top: 10px;
          left: 14px;
          right: 14px;
          max-width: 980px;
          margin: 0 auto;
          z-index: 25;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        `
      } else if (dockPos === 'left') {
        container.style.cssText = `
          position: absolute;
          top: 10px;
          left: 12px;
          bottom: 12px;
          width: 290px;
          z-index: 25;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        `
      } else if (dockPos === 'right') {
        container.style.cssText = `
          position: absolute;
          top: 10px;
          right: 12px;
          bottom: 12px;
          width: 290px;
          z-index: 25;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        `
      } else {
        // 'float' position
        container.style.cssText = `
          position: absolute;
          top: ${floatTop}px;
          left: ${floatLeft}px;
          width: 310px;
          max-height: calc(100vh - 120px);
          z-index: 32;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          box-shadow: 0 12px 48px rgba(0,0,0,0.7);
        `
      }
    }

    const setPosition = (newPos: DockPosition) => {
      // Keep World Tools in the upper workspace; floating/side placements
      // made the narrow sidebar compete with the actual World panel.
      dockPos = 'top'
      localStorage.setItem('infinity_dock_pos', 'top')
      if (newPos !== 'top') return render()
      render()
    }
    ;(window as any).setInfinityDockPosition = setPosition

    const setOpen = (open: boolean) => {
      isOpen = open
      localStorage.setItem('infinity_dock_open', String(open))
      render()
      const tbBtn = document.getElementById('btnToggleWorldTools')
      if (tbBtn) tbBtn.classList.toggle('active', isOpen)
    }
    ;(window as any).toggleWorldToolbar = (force?: boolean) => {
      setOpen(typeof force === 'boolean' ? force : !isOpen)
    }

    const kinds: { id: WorldObjectKind; label: string }[] = [
      { id: 'tree', label: '🌲 Tree' },
      { id: 'rock', label: '🪨 Rock' },
      { id: 'crystal', label: '💎 Crystal' },
      { id: 'water', label: '💧 Water' },
      { id: 'building', label: '🏛️ Building' },
      { id: 'road', label: '🛣️ Road' },
      { id: 'bridge', label: '🌉 Bridge' },
      { id: 'landmark', label: '🚩 Landmark' },
      { id: 'gravity_well', label: '🌀 Gravity' },
      { id: 'entropy_sink', label: '❄️ Sink' },
      { id: 'quantum_emitter', label: '⚛️ Quantum' },
      { id: 'metalaw', label: '📜 MetaLaw' },
      { id: 'force_field', label: '🛡️ Shield' },
    ]

    const render = () => {
      updateContainerStyle()

      const state = (window as any).builderGetState?.() || {
        tool: 'navigate',
        kind: 'tree',
        transformMode: 'translate',
        snap: 0,
        objectCount: 0,
        selected: null,
        overlay: null,
      }
      const stats = (window as any).infinityStats?.() || {
        loadedChunks: 0,
        objects: 0,
        camera: { x: 0, y: 0, z: 0, worldX: 0, worldY: 0, worldZ: 0 },
      }

      // Minimized Floating Pill
      if (!isOpen) {
        container.innerHTML = `
          <div style="display: flex; align-items: center; gap: 6px; padding: 4px 12px; background: rgba(13, 15, 26, 0.94); backdrop-filter: blur(14px); border: 1px solid rgba(124, 111, 205, 0.45); border-radius: 20px; box-shadow: 0 4px 24px rgba(0,0,0,0.6); font-size: 11px; color: var(--tx);">
            <span style="color: #a09af0; font-weight: 600; cursor: move;" id="miniDragHandle" title="Drag to reposition">⠿ 🌍 World Tools</span>
            <span style="color: var(--sub);">·</span>
            <span style="font-family: monospace; color: #40c080;">${state.tool.toUpperCase()}${state.tool === 'place' ? ` (${state.kind})` : ''}</span>
            <button id="dockTriggerOpen" style="cursor: pointer; background: #1a1830; border: 0.5px solid var(--accent); color: #a09af0; border-radius: 12px; padding: 2px 10px; font-size: 10px; font-weight: 500;">▾ Open</button>
            <span style="font-size: 8.5px; color: var(--sub);">TOP WORKSPACE</span>
          </div>
        `
        document.getElementById('dockTriggerOpen')?.addEventListener('click', () => setOpen(true))

        const miniHandle = document.getElementById('miniDragHandle')
        if (miniHandle) {
          let isDragging = false
          let startX = 0, startY = 0
          let initLeft = 0, initTop = 0
          miniHandle.addEventListener('pointerdown', (e: PointerEvent) => {
            isDragging = true
            miniHandle.style.cursor = 'grabbing'
            startX = e.clientX
            startY = e.clientY
            const rect = container.getBoundingClientRect()
            const wrapRect = wrap.getBoundingClientRect()
            initLeft = rect.left - wrapRect.left
            initTop = rect.top - wrapRect.top
            miniHandle.setPointerCapture(e.pointerId)
            e.preventDefault()
          })
          miniHandle.addEventListener('pointermove', (e: PointerEvent) => {
            if (!isDragging) return
            const dx = e.clientX - startX
            const dy = e.clientY - startY
            const wrapRect = wrap.getBoundingClientRect()
            const curX = e.clientX - wrapRect.left
            const curY = e.clientY - wrapRect.top
            if (curY < 85) {
              showGhostZone('top')
            } else if (curX < 140) {
              showGhostZone('left')
            } else if (curX > wrapRect.width - 140) {
              showGhostZone('right')
            } else {
              showGhostZone(null)
            }
            floatLeft = Math.max(10, Math.min(wrapRect.width - 240, initLeft + dx))
            floatTop = Math.max(10, Math.min(wrapRect.height - 40, initTop + dy))
            container.style.transition = 'none'
            container.style.left = `${floatLeft}px`
            container.style.top = `${floatTop}px`
            container.style.transform = 'none'
          })
          const onMiniDragEnd = (e: PointerEvent) => {
            if (!isDragging) return
            isDragging = false
            miniHandle.style.cursor = 'move'
            showGhostZone(null)
            const wrapRect = wrap.getBoundingClientRect()
            const curX = e.clientX - wrapRect.left
            const curY = e.clientY - wrapRect.top
            if (curY < 85) {
              setPosition('top')
            } else if (curX < 140) {
              setPosition('left')
            } else if (curX > wrapRect.width - 140) {
              setPosition('right')
            } else {
              dockPos = 'float'
              localStorage.setItem('infinity_dock_pos', 'float')
              localStorage.setItem('infinity_dock_float_x', String(floatLeft))
              localStorage.setItem('infinity_dock_float_y', String(floatTop))
              render()
            }
          }
          miniHandle.addEventListener('pointerup', onMiniDragEnd)
          miniHandle.addEventListener('pointercancel', onMiniDragEnd)
        }
        return
      }

      // Drag Handle & Header Controls
      const headerHTML = `
        <div id="infinityDragHandle" style="cursor: grab; display: flex; align-items: center; justify-content: space-between; border-bottom: 0.5px solid rgba(255,255,255,0.08); padding-bottom: 6px; margin-bottom: 6px; user-select: none;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="color: #8e8aa8; font-size: 11px; cursor: grab;" title="Drag to move or dock">⠿</span>
            <b style="color: #c8c3ff; font-size: 11px;">🌍 Infinity Scale & World Tools</b>
            <span style="font-size: 9px; color: #8e8aa8; font-family: monospace;">${stats.loadedChunks} chunks · ${state.objectCount} obj · (X:${stats.camera.worldX}, Z:${stats.camera.worldZ})</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <span style="font-size: 8.5px; color: var(--sub); padding: 2px 5px;">TOP WORKSPACE</span>
            <!-- Close / Collapse Button -->
            <button id="dockCloseBtn" style="cursor: pointer; background: #1a1828; border: 0.5px solid var(--border); color: var(--sub); border-radius: 6px; padding: 2px 8px; font-size: 10px;" title="Collapse Toolbar">▲ Close</button>
          </div>
        </div>
      `

      // ── RENDERING FOR TOP PANEL ─────────────────────────────────────────────
      if (dockPos === 'top') {
        container.innerHTML = `
          <div style="pointer-events: auto; width: 100%; background: rgba(13, 15, 26, 0.94); backdrop-filter: blur(14px); border: 1px solid rgba(124, 111, 205, 0.35); border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.6); padding: 8px 12px; display: flex; flex-direction: column; gap: 6px;">
            ${headerHTML}

            <!-- ROW 1: PRIMARY TOOL MODES, SNAPPING, AND SHORTCUT ACTIONS -->
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
              <!-- Mode Switcher -->
              <div style="display: flex; align-items: center; gap: 3px; background: #0a0a14; padding: 2px 4px; border-radius: 8px; border: 0.5px solid var(--border);">
                <button class="pill ${state.tool === 'navigate' ? 'on' : ''}" id="topToolNav" style="font-size: 10px; padding: 3px 8px;">🖐️ Explore</button>
                <button class="pill ${state.tool === 'select' ? 'on' : ''}" id="topToolSel" style="font-size: 10px; padding: 3px 8px;">🎯 Select</button>
                <button class="pill ${state.tool === 'place' ? 'on' : ''}" id="topToolPlace" style="font-size: 10px; padding: 3px 8px;">🌲 Place</button>
                <button class="pill ${state.tool === 'erase' ? 'on' : ''}" id="topToolErase" style="font-size: 10px; padding: 3px 8px;">🧹 Demolish</button>
              </div>

              <!-- Snapping -->
              <div style="display: flex; align-items: center; gap: 3px;">
                <span style="font-size: 9px; color: var(--sub); text-transform: uppercase;">Snap</span>
                <button class="pill ${state.snap === 0 ? 'on' : ''}" id="topSnap0" style="font-size: 9.5px; padding: 2px 6px;">Off</button>
                <button class="pill ${state.snap === 1 ? 'on' : ''}" id="topSnap1" style="font-size: 9.5px; padding: 2px 6px;">1m</button>
                <button class="pill ${state.snap === 5 ? 'on' : ''}" id="topSnap5" style="font-size: 9.5px; padding: 2px 6px;">5m</button>
              </div>

              <!-- Procedural & Spatial Systems -->
              <div style="display: flex; align-items: center; gap: 3px;">
                <button class="brush-btn" id="topGenTown" style="font-size: 9.5px; padding: 3px 7px;">🏘️ Town</button>
                <button class="brush-btn" id="topGenCity" style="font-size: 9.5px; padding: 3px 7px;">🏙️ City</button>
                <button class="brush-btn" id="topGenRivers" style="font-size: 9.5px; padding: 3px 7px;">🌊 Rivers</button>
                <button class="brush-btn" id="topGenRoute" style="font-size: 9.5px; padding: 3px 7px;">🛣️ Route</button>
                <button class="brush-btn" id="topGenForest" style="font-size: 9.5px; padding: 3px 7px;">🌲 Forest</button>
              </div>

              <!-- Analytical Overlays -->
              <div style="display: flex; align-items: center; gap: 3px;">
                <button class="pill ${state.overlay === 'suitability' ? 'on' : ''}" id="topOverlaySuit" style="font-size: 9.5px; padding: 2px 6px;">🟢 Suitability</button>
                <button class="pill ${state.overlay === 'flood' ? 'on' : ''}" id="topOverlayFlood" style="font-size: 9.5px; padding: 2px 6px;">💧 Flood</button>
                <button class="pill ${state.overlay === 'slope' ? 'on' : ''}" id="topOverlaySlope" style="font-size: 9.5px; padding: 2px 6px;">📐 Slope</button>
                <button class="pill ${state.overlay === null ? 'on' : ''}" id="topOverlayNone" style="font-size: 9.5px; padding: 2px 6px;">✕</button>
              </div>

              <!-- Persistence & History -->
              <div style="display: flex; align-items: center; gap: 3px;">
                <button class="brush-btn" id="topUndo" style="font-size: 9.5px; padding: 3px 6px;" title="Undo">↩</button>
                <button class="brush-btn" id="topRedo" style="font-size: 9.5px; padding: 3px 6px;" title="Redo">↪</button>
                <button class="brush-btn" id="topSave" style="font-size: 9.5px; padding: 3px 7px; color: #40c080;" title="Save">💾 Save</button>
                <button class="brush-btn" id="topLoad" style="font-size: 9.5px; padding: 3px 7px;" title="Load">📂 Load</button>
              </div>
            </div>

            <!-- ROW 2: CONTEXTUAL SHELF FOR ACTIVE MODE -->
            <div style="display: flex; align-items: center; justify-content: space-between; border-top: 0.5px solid rgba(255,255,255,0.06); padding-top: 5px;">
              ${state.tool === 'place' ? `
                <div style="display: flex; align-items: center; gap: 3px; flex-wrap: wrap;">
                  <span style="font-size: 9px; color: #a09af0; font-weight: 600; margin-right: 4px;">PALETTE:</span>
                  ${kinds.map(k => `
                    <button class="brush-btn ${state.kind === k.id ? 'active' : ''}" data-kind="${k.id}" style="font-size: 10px; padding: 2px 7px;">${k.label}</button>
                  `).join('')}
                </div>
                <span style="font-size: 9px; color: var(--sub); font-style: italic;">Left-Click places · Right-Drag orbits anytime</span>
              ` : state.tool === 'select' ? `
                <div style="display: flex; align-items: center; gap: 4px;">
                  <span style="font-size: 9px; color: #a09af0; font-weight: 600; margin-right: 4px;">GIZMO:</span>
                  <button class="pill ${state.transformMode === 'translate' ? 'on' : ''}" id="topGzTrans" style="font-size: 9.5px; padding: 2px 7px;">✥ Move (G)</button>
                  <button class="pill ${state.transformMode === 'rotate' ? 'on' : ''}" id="topGzRot" style="font-size: 9.5px; padding: 2px 7px;">⟳ Rotate (R)</button>
                  <button class="pill ${state.transformMode === 'scale' ? 'on' : ''}" id="topGzScale" style="font-size: 9.5px; padding: 2px 7px;">⤢ Scale (S)</button>
                  <span style="color: var(--sub);">·</span>
                  <button class="brush-btn" id="topFocusSel" style="font-size: 9.5px; padding: 2px 6px;">⛶ Focus (F)</button>
                  <button class="brush-btn" id="topDelSel" style="font-size: 9.5px; padding: 2px 6px; color: #e06060;">🗑️ Delete</button>
                  <button class="brush-btn" id="topDesel" style="font-size: 9.5px; padding: 2px 6px;">✕ Deselect</button>
                </div>
                <span style="font-size: 9px; color: var(--sub); font-style: italic;">Click object to select · Drag gizmo axes to transform</span>
              ` : state.tool === 'erase' ? `
                <div style="display: flex; align-items: center; gap: 4px;">
                  <span style="font-size: 9px; color: #e06060; font-weight: 600; margin-right: 4px;">RADIUS:</span>
                  ${[2, 4, 8, 16].map(r => `
                    <button class="pill ${eraseRadius === r ? 'on' : ''}" data-radius="${r}" style="font-size: 9.5px; padding: 2px 6px;">${r}m</button>
                  `).join('')}
                  <span style="color: var(--sub);">·</span>
                  <button class="brush-btn" id="topClearAll" style="font-size: 9.5px; padding: 2px 7px; color: #e06060;">🗑️ Clear All</button>
                </div>
                <span style="font-size: 9px; color: var(--sub); font-style: italic;">Click or drag to demolish objects</span>
              ` : `
                <div style="display: flex; align-items: center; gap: 4px;">
                  <span style="font-size: 9px; color: #a09af0; font-weight: 600; margin-right: 4px;">VIEW:</span>
                  <button class="pill" id="topCamOrbit" style="font-size: 9.5px; padding: 2px 6px;">Orbit</button>
                  <button class="pill" id="topCamTop" style="font-size: 9.5px; padding: 2px 6px;">Top</button>
                  <button class="pill" id="topCamFront" style="font-size: 9.5px; padding: 2px 6px;">Front</button>
                  <button class="pill" id="topCamIso" style="font-size: 9.5px; padding: 2px 6px;">Iso</button>
                  <button class="brush-btn" id="topCamReset" style="font-size: 9.5px; padding: 2px 6px;">⛶ Center</button>
                  <span style="color: var(--sub);">·</span>
                  <button class="pill" id="topCamFly" style="font-size: 9.5px; padding: 2px 6px;">Fly Walk</button>
                </div>
                <span style="font-size: 9px; color: var(--sub); font-style: italic;">Left-Drag: Orbit · Mid / Space+Drag: Pan · Wheel: Zoom · WASD: Move</span>
              `}
            </div>
          </div>
        `
      } else {
        // ── RENDERING FOR VERTICAL TOOLBAR (LEFT, RIGHT, OR FLOATING) ───────────
        container.innerHTML = `
          <div style="pointer-events: auto; width: 100%; max-height: calc(100vh - 120px); overflow-y: auto; background: rgba(13, 15, 26, 0.95); backdrop-filter: blur(14px); border: 1px solid rgba(124, 111, 205, 0.35); border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.65); padding: 10px; display: flex; flex-direction: column; gap: 8px;">
            ${headerHTML}

            <!-- Category Tabs -->
            <div style="display: flex; gap: 2px; border-bottom: 0.5px solid rgba(255,255,255,0.06); padding-bottom: 4px;">
              <button class="cstep ${activeTab === 'objects' ? 'active' : ''}" id="vTabObj" style="flex:1; padding: 3px 2px; font-size: 9px;">Objects</button>
              <button class="cstep ${activeTab === 'camera' ? 'active' : ''}" id="vTabCam" style="flex:1; padding: 3px 2px; font-size: 9px;">Camera</button>
              <button class="cstep ${activeTab === 'analysis' ? 'active' : ''}" id="vTabGen" style="flex:1; padding: 3px 2px; font-size: 9px;">Generate</button>
              <button class="cstep ${activeTab === 'persist' ? 'active' : ''}" id="vTabPersist" style="flex:1; padding: 3px 2px; font-size: 9px;">Save</button>
              <button class="cstep ${activeTab === 'display' ? 'active' : ''}" id="vTabDisp" style="flex:1; padding: 3px 2px; font-size: 9px;">Display</button>
            </div>

            <!-- Tab Content -->
            ${activeTab === 'objects' ? `
              <div>
                <div style="font-size: 9.5px; color: var(--sub); margin-bottom: 4px; text-transform: uppercase;">Build Tool Mode</div>
                <div class="pill-row">
                  <button class="pill ${state.tool === 'navigate' ? 'on' : ''}" id="vToolNav">🖐️ Explore</button>
                  <button class="pill ${state.tool === 'select' ? 'on' : ''}" id="vToolSel">🎯 Select</button>
                  <button class="pill ${state.tool === 'place' ? 'on' : ''}" id="vToolPlace">🌲 Place</button>
                  <button class="pill ${state.tool === 'erase' ? 'on' : ''}" id="vToolErase">🧹 Erase</button>
                </div>

                <div style="font-size: 9.5px; color: var(--sub); margin: 6px 0 4px; text-transform: uppercase;">Object Palette</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px;">
                  ${kinds.map(k => `
                    <button class="brush-btn ${state.kind === k.id && state.tool === 'place' ? 'active' : ''}" data-kind="${k.id}">${k.label}</button>
                  `).join('')}
                </div>

                <div style="font-size: 9.5px; color: var(--sub); margin: 6px 0 4px; text-transform: uppercase;">Transform Gizmo</div>
                <div class="pill-row">
                  <button class="pill ${state.transformMode === 'translate' ? 'on' : ''}" id="vGzTrans">✥ Move (G)</button>
                  <button class="pill ${state.transformMode === 'rotate' ? 'on' : ''}" id="vGzRot">⟳ Rotate (R)</button>
                  <button class="pill ${state.transformMode === 'scale' ? 'on' : ''}" id="vGzScale">⤢ Scale (S)</button>
                </div>
                <div style="display: flex; gap: 4px; margin-top: 4px;">
                  <button class="brush-btn" style="flex:1" id="vFocusSel">⛶ Focus</button>
                  <button class="brush-btn" style="flex:1; color:#e06060" id="vDelSel">🗑️ Delete</button>
                  <button class="brush-btn" style="flex:1" id="vDesel">✕ Desel</button>
                </div>

                <div style="font-size: 9.5px; color: var(--sub); margin: 8px 0 4px; text-transform: uppercase;">Grid Snapping</div>
                <div class="pill-row">
                  <button class="pill ${state.snap === 0 ? 'on' : ''}" id="vSnap0">Off</button>
                  <button class="pill ${state.snap === 1 ? 'on' : ''}" id="vSnap1">1m Grid</button>
                  <button class="pill ${state.snap === 5 ? 'on' : ''}" id="vSnap5">5m Grid</button>
                </div>
              </div>
            ` : activeTab === 'camera' ? `
              <div>
                <div style="font-size: 9.5px; color: var(--sub); margin-bottom: 4px; text-transform: uppercase;">Camera Preset</div>
                <div class="pill-row">
                  <button class="pill on" id="vCamOrbit">Orbit</button>
                  <button class="pill" id="vCamTop">Top</button>
                  <button class="pill" id="vCamFront">Front</button>
                  <button class="pill" id="vCamIso">Iso</button>
                </div>
                <div style="display: flex; gap: 4px; margin-bottom: 8px;">
                  <button class="brush-btn" style="flex:1" id="vCamReset">⛶ Center View</button>
                  <button class="brush-btn" style="flex:1" id="vCamFly">✈️ Fly Walk</button>
                </div>

                <div style="font-size: 9.5px; color: var(--sub); margin-bottom: 4px; text-transform: uppercase;">Turn Around (Orbit)</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px;">
                  <button class="brush-btn" id="vTurnL">↺ Turn Left (Q)</button>
                  <button class="brush-btn" id="vTurnR">↻ Turn Right (E)</button>
                  <button class="brush-btn" id="vTiltUp">∧ Tilt Up</button>
                  <button class="brush-btn" id="vTiltDn">∨ Tilt Down</button>
                </div>

                <div style="font-size: 9.5px; color: var(--sub); margin-bottom: 4px; text-transform: uppercase;">Move Across Terrain</div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; margin-bottom: 4px;">
                  <div></div>
                  <button class="brush-btn" id="vPanFwd">↑ Fwd</button>
                  <div></div>
                  <button class="brush-btn" id="vPanL">← Left</button>
                  <button class="brush-btn" id="vPanCenter" style="color:#a09af0">⛶</button>
                  <button class="brush-btn" id="vPanR">→</button>
                  <div></div>
                  <button class="brush-btn" id="vPanBack">↓ Back</button>
                  <div></div>
                </div>
                <div style="display: flex; gap: 4px;">
                  <button class="brush-btn" style="flex:1" id="vZoomIn">+ Zoom In</button>
                  <button class="brush-btn" style="flex:1" id="vZoomOut">− Zoom Out</button>
                </div>
              </div>
            ` : activeTab === 'analysis' ? `
              <div>
                <div style="font-size: 9.5px; color: var(--sub); margin-bottom: 4px; text-transform: uppercase;">Procedural Systems</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px;">
                  <button class="brush-btn" id="vGenTown">🏘️ Settlement</button>
                  <button class="brush-btn" id="vGenTownV2">🏘️ Settlement V2</button>
                  <button class="brush-btn" id="vGenCity">🏙️ City Plan</button>
                  <button class="brush-btn" id="vGenRivers">🌊 River Network</button>
                  <button class="brush-btn" id="vGenRoute">🛣️ Smart Route</button>
                  <button class="brush-btn" id="vGenForest">🌲 Forest Scatter</button>
                  <button class="brush-btn" id="vGenRocks">🪨 Rock Scatter</button>
                  <button class="brush-btn" id="vGenCrystals">💎 Crystal Scatter</button>
                </div>

                <div style="font-size: 9.5px; color: var(--sub); margin: 6px 0 4px; text-transform: uppercase;">Analytical Overlays</div>
                <div class="pill-row">
                  <button class="pill ${state.overlay === 'suitability' ? 'on' : ''}" id="vOverlaySuit">🟢 Suitability</button>
                  <button class="pill ${state.overlay === 'flood' ? 'on' : ''}" id="vOverlayFlood">💧 Flood Risk</button>
                  <button class="pill ${state.overlay === 'slope' ? 'on' : ''}" id="vOverlaySlope">📐 Slope Map</button>
                  <button class="pill ${state.overlay === null ? 'on' : ''}" id="vOverlayNone">✕ Clear</button>
                </div>
              </div>
            ` : activeTab === 'persist' ? `
              <div>
                <div style="font-size: 9.5px; color: var(--sub); margin-bottom: 4px; text-transform: uppercase;">History & Storage</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px;">
                  <button class="brush-btn" id="vUndo">↩ Undo</button>
                  <button class="brush-btn" id="vRedo">↪ Redo</button>
                  <button class="brush-btn" id="vSave" style="color:#40c080">💾 Save World</button>
                  <button class="brush-btn" id="vLoad">📂 Load World</button>
                </div>
                <button class="brush-btn" style="width:100%; color:#e06060; border-color:#502020; margin-top: 6px;" id="vClearAll">🗑️ Clear All Placed Objects</button>
              </div>
            ` : `
              <div>
                <div style="font-size: 9.5px; color: var(--sub); margin-bottom: 4px; text-transform: uppercase;">Terrain Shading</div>
                <div class="pill-row">
                  <button class="pill on" id="vMatField">Field Colors</button>
                  <button class="pill" id="vMatPbr">PBR Shading</button>
                  <button class="pill" id="vMatHeight">Height Map</button>
                </div>

                <div style="font-size: 9.5px; color: var(--sub); margin: 6px 0 4px; text-transform: uppercase;">Time of Day</div>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 6px;">
                  <button class="brush-btn" id="vTodDawn">🌅 6h</button>
                  <button class="brush-btn" id="vTodDay">☀️ 12h</button>
                  <button class="brush-btn" id="vTodDusk">🌇 18h</button>
                  <button class="brush-btn" id="vTodNight">🌙 0h</button>
                </div>

                <div style="font-size: 9.5px; color: var(--sub); margin: 6px 0 4px; text-transform: uppercase;">Atmosphere Fog</div>
                <div style="display: flex; gap: 4px;">
                  <button class="brush-btn" style="flex:1" id="vFogPlus">🌫️ Foggy (+)</button>
                  <button class="brush-btn" style="flex:1" id="vFogMinus">☀️ Clear (−)</button>
                </div>
              </div>
            `}
          </div>
        `
      }

      // ── BIND DRAG-AND-DROP HANDLER ──────────────────────────────────────────
      const handle = document.getElementById('infinityDragHandle')
      if (handle) {
        let isDragging = false
        let startX = 0, startY = 0
        let initLeft = 0, initTop = 0

        handle.addEventListener('pointerdown', (e: PointerEvent) => {
          if ((e.target as HTMLElement).tagName === 'BUTTON') return
          isDragging = true
          handle.style.cursor = 'grabbing'
          startX = e.clientX
          startY = e.clientY
          const rect = container.getBoundingClientRect()
          const wrapRect = wrap.getBoundingClientRect()
          initLeft = rect.left - wrapRect.left
          initTop = rect.top - wrapRect.top
          handle.setPointerCapture(e.pointerId)
          e.preventDefault()
        })

        handle.addEventListener('pointermove', (e: PointerEvent) => {
          if (!isDragging) return
          const dx = e.clientX - startX
          const dy = e.clientY - startY
          const wrapRect = wrap.getBoundingClientRect()
          const curX = e.clientX - wrapRect.left
          const curY = e.clientY - wrapRect.top

          // Detect drop zone and show ghost preview
          if (curY < 85) {
            showGhostZone('top')
          } else if (curX < 140) {
            showGhostZone('left')
          } else if (curX > wrapRect.width - 140) {
            showGhostZone('right')
          } else {
            showGhostZone(null)
          }

          // Move container
          floatLeft = Math.max(10, Math.min(wrapRect.width - 320, initLeft + dx))
          floatTop = Math.max(10, Math.min(wrapRect.height - 120, initTop + dy))
          container.style.transition = 'none'
          container.style.left = `${floatLeft}px`
          container.style.top = `${floatTop}px`
          container.style.right = 'auto'
          container.style.bottom = 'auto'
          container.style.width = '310px'
          container.style.transform = 'none'
        })

        const onDragEnd = (e: PointerEvent) => {
          if (!isDragging) return
          isDragging = false
          handle.style.cursor = 'grab'
          showGhostZone(null)
          const wrapRect = wrap.getBoundingClientRect()
          const curX = e.clientX - wrapRect.left
          const curY = e.clientY - wrapRect.top

          if (curY < 85) {
            setPosition('top')
          } else if (curX < 140) {
            setPosition('left')
          } else if (curX > wrapRect.width - 140) {
            setPosition('right')
          } else {
            dockPos = 'float'
            localStorage.setItem('infinity_dock_pos', 'float')
            localStorage.setItem('infinity_dock_float_x', String(floatLeft))
            localStorage.setItem('infinity_dock_float_y', String(floatTop))
            render()
          }
        }
        handle.addEventListener('pointerup', onDragEnd)
        handle.addEventListener('pointercancel', onDragEnd)
      }

      // ── DOCK SWITCHER & COLLAPSE ───────────────────────────────────────────
      document.getElementById('posLeft')?.addEventListener('click', () => setPosition('left'))
      document.getElementById('posTop')?.addEventListener('click', () => setPosition('top'))
      document.getElementById('posRight')?.addEventListener('click', () => setPosition('right'))
      document.getElementById('posFloat')?.addEventListener('click', () => setPosition('float'))
      document.getElementById('dockCloseBtn')?.addEventListener('click', () => setOpen(false))

      // Tab switcher in vertical dock
      document.getElementById('vTabObj')?.addEventListener('click', () => { activeTab = 'objects'; render(); })
      document.getElementById('vTabCam')?.addEventListener('click', () => { activeTab = 'camera'; render(); })
      document.getElementById('vTabGen')?.addEventListener('click', () => { activeTab = 'analysis'; render(); })
      document.getElementById('vTabPersist')?.addEventListener('click', () => { activeTab = 'persist'; render(); })
      document.getElementById('vTabDisp')?.addEventListener('click', () => { activeTab = 'display'; render(); })

      // Tool switches
      document.getElementById('topToolNav')?.addEventListener('click', () => (window as any).builderSetTool('navigate'))
      document.getElementById('topToolSel')?.addEventListener('click', () => (window as any).builderSetTool('select'))
      document.getElementById('topToolPlace')?.addEventListener('click', () => (window as any).builderSetTool('place'))
      document.getElementById('topToolErase')?.addEventListener('click', () => (window as any).builderSetTool('erase'))

      document.getElementById('vToolNav')?.addEventListener('click', () => (window as any).builderSetTool('navigate'))
      document.getElementById('vToolSel')?.addEventListener('click', () => (window as any).builderSetTool('select'))
      document.getElementById('vToolPlace')?.addEventListener('click', () => (window as any).builderSetTool('place'))
      document.getElementById('vToolErase')?.addEventListener('click', () => (window as any).builderSetTool('erase'))

      // Object kind chips
      container.querySelectorAll('button[data-kind]').forEach(b => {
        b.addEventListener('click', () => {
          const k = b.getAttribute('data-kind') as WorldObjectKind
          if (k) (window as any).builderSetKind(k)
        })
      })

      // Snapping
      document.getElementById('topSnap0')?.addEventListener('click', () => (window as any).builderSetSnap(0))
      document.getElementById('topSnap1')?.addEventListener('click', () => (window as any).builderSetSnap(1))
      document.getElementById('topSnap5')?.addEventListener('click', () => (window as any).builderSetSnap(5))
      document.getElementById('vSnap0')?.addEventListener('click', () => (window as any).builderSetSnap(0))
      document.getElementById('vSnap1')?.addEventListener('click', () => (window as any).builderSetSnap(1))
      document.getElementById('vSnap5')?.addEventListener('click', () => (window as any).builderSetSnap(5))

      // Gizmo
      document.getElementById('topGzTrans')?.addEventListener('click', () => (window as any).builderSetTransform('translate'))
      document.getElementById('topGzRot')?.addEventListener('click', () => (window as any).builderSetTransform('rotate'))
      document.getElementById('topGzScale')?.addEventListener('click', () => (window as any).builderSetTransform('scale'))
      document.getElementById('vGzTrans')?.addEventListener('click', () => (window as any).builderSetTransform('translate'))
      document.getElementById('vGzRot')?.addEventListener('click', () => (window as any).builderSetTransform('rotate'))
      document.getElementById('vGzScale')?.addEventListener('click', () => (window as any).builderSetTransform('scale'))

      document.getElementById('topFocusSel')?.addEventListener('click', () => (window as any).builderFocus())
      document.getElementById('topDelSel')?.addEventListener('click', () => (window as any).builderDeleteSelected())
      document.getElementById('topDesel')?.addEventListener('click', () => (window as any).builderDeselect())
      document.getElementById('vFocusSel')?.addEventListener('click', () => (window as any).builderFocus())
      document.getElementById('vDelSel')?.addEventListener('click', () => (window as any).builderDeleteSelected())
      document.getElementById('vDesel')?.addEventListener('click', () => (window as any).builderDeselect())

      // Erase Radius
      container.querySelectorAll('button[data-radius]').forEach(b => {
        b.addEventListener('click', () => {
          eraseRadius = Number(b.getAttribute('data-radius')) || 4
          render()
        })
      })

      // Procedural Generation
      document.getElementById('topGenTown')?.addEventListener('click', () => (window as any).builderGenerateSettlement())
      document.getElementById('topGenCity')?.addEventListener('click', () => (window as any).builderGenerateCityPlan())
      document.getElementById('topGenRivers')?.addEventListener('click', () => (window as any).builderGenerateRivers())
      document.getElementById('topGenRoute')?.addEventListener('click', () => (window as any).builderSmartRoute())
      document.getElementById('topGenForest')?.addEventListener('click', () => (window as any).builderScatter('tree', 0.14))

      document.getElementById('vGenTown')?.addEventListener('click', () => world.generateSettlement(world.worldCoordinates.x, world.worldCoordinates.z, 70, 10))
      document.getElementById('vGenTownV2')?.addEventListener('click', () => (window as any).builderGenerateSettlement())
      document.getElementById('vGenCity')?.addEventListener('click', () => (window as any).builderGenerateCityPlan())
      document.getElementById('vGenRivers')?.addEventListener('click', () => (window as any).builderGenerateRivers())
      document.getElementById('vGenRoute')?.addEventListener('click', () => (window as any).builderSmartRoute())
      document.getElementById('vGenForest')?.addEventListener('click', () => (window as any).builderScatter('tree', 0.14))
      document.getElementById('vGenRocks')?.addEventListener('click', () => (window as any).builderScatter('rock', 0.10))
      document.getElementById('vGenCrystals')?.addEventListener('click', () => (window as any).builderScatter('crystal', 0.05))

      // Overlays
      document.getElementById('topOverlaySuit')?.addEventListener('click', () => (window as any).builderSetOverlay('suitability'))
      document.getElementById('topOverlayFlood')?.addEventListener('click', () => (window as any).builderSetOverlay('flood'))
      document.getElementById('topOverlaySlope')?.addEventListener('click', () => (window as any).builderSetOverlay('slope'))
      document.getElementById('topOverlayNone')?.addEventListener('click', () => (window as any).builderSetOverlay(null))
      document.getElementById('vOverlaySuit')?.addEventListener('click', () => (window as any).builderSetOverlay('suitability'))
      document.getElementById('vOverlayFlood')?.addEventListener('click', () => (window as any).builderSetOverlay('flood'))
      document.getElementById('vOverlaySlope')?.addEventListener('click', () => (window as any).builderSetOverlay('slope'))
      document.getElementById('vOverlayNone')?.addEventListener('click', () => (window as any).builderSetOverlay(null))

      // Persistence
      document.getElementById('topUndo')?.addEventListener('click', () => (window as any).builderUndo())
      document.getElementById('topRedo')?.addEventListener('click', () => (window as any).builderRedo())
      document.getElementById('topSave')?.addEventListener('click', () => (window as any).builderSave())
      document.getElementById('topLoad')?.addEventListener('click', () => world.loadWorld())
      document.getElementById('topClearAll')?.addEventListener('click', () => {
        if (confirm('Clear all placed objects in this reality?')) (window as any).builderClear()
      })

      document.getElementById('vUndo')?.addEventListener('click', () => (window as any).builderUndo())
      document.getElementById('vRedo')?.addEventListener('click', () => (window as any).builderRedo())
      document.getElementById('vSave')?.addEventListener('click', () => (window as any).builderSave())
      document.getElementById('vLoad')?.addEventListener('click', () => world.loadWorld())
      document.getElementById('vClearAll')?.addEventListener('click', () => {
        if (confirm('Clear all placed objects in this reality?')) (window as any).builderClear()
      })

      // Camera
      document.getElementById('topCamOrbit')?.addEventListener('click', () => world.setCameraPreset('orbit'))
      document.getElementById('topCamTop')?.addEventListener('click', () => world.setCameraPreset('top'))
      document.getElementById('topCamFront')?.addEventListener('click', () => world.setCameraPreset('front'))
      document.getElementById('topCamIso')?.addEventListener('click', () => world.setCameraPreset('iso'))
      document.getElementById('topCamReset')?.addEventListener('click', () => world.resetCameraView())
      document.getElementById('topCamFly')?.addEventListener('click', () => world.setFlyMode(true))

      document.getElementById('vCamOrbit')?.addEventListener('click', () => world.setCameraPreset('orbit'))
      document.getElementById('vCamTop')?.addEventListener('click', () => world.setCameraPreset('top'))
      document.getElementById('vCamFront')?.addEventListener('click', () => world.setCameraPreset('front'))
      document.getElementById('vCamIso')?.addEventListener('click', () => world.setCameraPreset('iso'))
      document.getElementById('vCamReset')?.addEventListener('click', () => world.resetCameraView())
      document.getElementById('vCamFly')?.addEventListener('click', () => world.setFlyMode(true))

      document.getElementById('vTurnL')?.addEventListener('click', () => world.turnAround(0.35, 0))
      document.getElementById('vTurnR')?.addEventListener('click', () => world.turnAround(-0.35, 0))
      document.getElementById('vTiltUp')?.addEventListener('click', () => world.turnAround(0, -0.2))
      document.getElementById('vTiltDn')?.addEventListener('click', () => world.turnAround(0, 0.2))

      document.getElementById('vPanFwd')?.addEventListener('click', () => world.pan(0, 20))
      document.getElementById('vPanBack')?.addEventListener('click', () => world.pan(0, -20))
      document.getElementById('vPanL')?.addEventListener('click', () => world.pan(-20, 0))
      document.getElementById('vPanR')?.addEventListener('click', () => world.pan(20, 0))
      document.getElementById('vPanCenter')?.addEventListener('click', () => world.resetCameraView())

      document.getElementById('vZoomIn')?.addEventListener('click', () => world.zoom(1))
      document.getElementById('vZoomOut')?.addEventListener('click', () => world.zoom(-1))

      // Display & Environment
      document.getElementById('vMatField')?.addEventListener('click', () => { world.setMaterialMode('field'); syncWorldUI(12, 0.012, 'field'); })
      document.getElementById('vMatPbr')?.addEventListener('click', () => { world.setMaterialMode('material'); syncWorldUI(12, 0.012, 'material'); })
      document.getElementById('vMatHeight')?.addEventListener('click', () => { world.setMaterialMode('height'); syncWorldUI(12, 0.012, 'height'); })

      document.getElementById('vTodDawn')?.addEventListener('click', () => { world.setTimeOfDay(6); syncWorldUI(6, 0.012, 'field'); })
      document.getElementById('vTodDay')?.addEventListener('click', () => { world.setTimeOfDay(12); syncWorldUI(12, 0.012, 'field'); })
      document.getElementById('vTodDusk')?.addEventListener('click', () => { world.setTimeOfDay(18); syncWorldUI(18, 0.018, 'field'); })
      document.getElementById('vTodNight')?.addEventListener('click', () => { world.setTimeOfDay(0); syncWorldUI(0, 0.005, 'material'); })

      document.getElementById('vFogPlus')?.addEventListener('click', () => { world.setFogDensity(0.035); syncWorldUI(12, 0.035, 'field'); })
      document.getElementById('vFogMinus')?.addEventListener('click', () => { world.setFogDensity(0.006); syncWorldUI(12, 0.006, 'field'); })
    }

    render()

    // Re-render dock whenever tool/object state changes
    document.addEventListener('builderUpdated', () => render())
  }

  // ── Window Resize ──────────────────────────────────────────────────────────
  const resize = () => {
    const parent = canvas.parentElement
    if (!parent) return
    world.resize(Math.max(1, parent.clientWidth), Math.max(1, parent.clientHeight))
  }

  window.addEventListener('resize', resize)
  resize()

  // ── Continuous Animation Loop ──────────────────────────────────────────────
  let last = performance.now()
  const loop = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    world.render(dt)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  console.log('[Reality Engine] Infinite World renderer initialized.')
  ;(window as any).bootstrapInfiniteWorld = bootstrapInfiniteWorld
  return world
}

// ── Auto-bootstrap on load ───────────────────────────────────────────────────
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bootstrapInfiniteWorld())
  } else {
    bootstrapInfiniteWorld()
  }
}
