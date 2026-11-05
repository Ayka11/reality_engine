import type { WorldAssetRuntime } from '../../worldLibrary/WorldAssetRuntime'
import type { Agent } from './AgentSystem'
import {
  validateAgentGridWorldTransform,
  type AgentGridCoordinates,
  type AgentGridWorldTransform,
} from '../../simulation/AgentGridWorldTransform'
import {
  resolveAgentVisualAnimation,
  validateAgentVisualProfile,
  type AgentVisualProfile,
} from './AgentVisualProfile'

export type AgentVisualWorldPositionResolver = (
  position: AgentGridCoordinates,
  agent: Agent,
) => AgentGridCoordinates

export type AgentVisualSyncDiagnostics = {
  configured: boolean
  agents: number
  instances: number
  created: number
  updated: number
  animated: number
  stopped: number
  removed: number
  awaitingAsset: number
  missingClip: number
}

type TrackedAgentVisual = {
  instanceId: string
  clipName: string | null
}

function emptyDiagnostics(configured: boolean): AgentVisualSyncDiagnostics {
  return {
    configured,
    agents: 0,
    instances: 0,
    created: 0,
    updated: 0,
    animated: 0,
    stopped: 0,
    removed: 0,
    awaitingAsset: 0,
    missingClip: 0,
  }
}

/**
 * Bridges the booted 2D AgentSystem to explicitly imported semantic GLTF assets.
 *
 * Instances are transient simulation projections. Their positions and animation
 * state are regenerated from AgentSystem and are intentionally excluded from
 * persistent world snapshots. The grid/world affine transform is always supplied
 * by the caller; this class never guesses a relation between two coordinate spaces.
 */
export class AgentVisualRuntime {
  private profile: AgentVisualProfile | null = null
  private readonly tracked = new Map<number, TrackedAgentVisual>()
  private diagnostics = emptyDiagnostics(false)
  private readonly transform: AgentGridWorldTransform

  constructor(
    private readonly assets: WorldAssetRuntime,
    transform: AgentGridWorldTransform,
    private readonly resolveWorldPosition: AgentVisualWorldPositionResolver = position => position,
    private readonly sourceAssetId?: string,
  ) {
    const validation = validateAgentGridWorldTransform(transform)
    if (!validation.valid || !validation.transform) {
      throw new TypeError(`Invalid agent visual grid/world transform: ${validation.errors.join('; ')}`)
    }
    if (sourceAssetId !== undefined &&
        (typeof sourceAssetId !== 'string' || !sourceAssetId.trim() || sourceAssetId.length > 512)) {
      throw new TypeError('Agent visual sourceAssetId must be a non-empty string')
    }
    // Store a validated detached copy so caller mutation cannot alter live projection.
    this.transform = validation.transform
  }

  private mapGridPosition(grid: AgentGridCoordinates): AgentGridCoordinates {
    const { width, height, depth } = this.transform.gridDimensions
    if (![grid.x, grid.y, grid.z].every(Number.isFinite) ||
        grid.x < 0 || grid.x > width - 1 ||
        grid.y < 0 || grid.y > height - 1 ||
        grid.z < 0 || grid.z > depth - 1) {
      throw new RangeError('Agent grid position is outside the configured visualization grid')
    }
    const { x, y, z } = this.transform.gridBasis
    const origin = this.transform.worldOrigin
    return {
      x: origin.x + x.x * grid.x + y.x * grid.y + z.x * grid.z,
      y: origin.y + x.y * grid.x + y.y * grid.y + z.y * grid.z,
      z: origin.z + x.z * grid.x + y.z * grid.y + z.z * grid.z,
    }
  }

  setProfile(value: unknown): AgentVisualProfile {
    const validation = validateAgentVisualProfile(value)
    if (!validation.valid || !validation.profile) {
      throw new TypeError(`Invalid agent visual profile: ${validation.errors.join('; ')}`)
    }
    this.disposeInstances()
    this.profile = validation.profile
    this.diagnostics = emptyDiagnostics(true)
    return { ...validation.profile, clips: validation.profile.clips ? { ...validation.profile.clips } : undefined }
  }

  getProfile(): AgentVisualProfile | null {
    if (!this.profile) return null
    return {
      ...this.profile,
      clips: this.profile.clips ? { ...this.profile.clips } : undefined,
    }
  }

  sync(agents: readonly Agent[]): AgentVisualSyncDiagnostics {
    const profile = this.profile
    if (!profile) {
      this.diagnostics = emptyDiagnostics(false)
      return { ...this.diagnostics }
    }

    const current = emptyDiagnostics(true)
    current.agents = agents.length
    const aliveIds = new Set<number>()
    const semanticSource = this.assets.getSemanticSource(profile.semanticEntryId)
    const source = semanticSource &&
      (this.sourceAssetId === undefined || semanticSource.id === this.sourceAssetId)
      ? semanticSource
      : undefined

    if (!source) {
      current.awaitingAsset = agents.length
      // A missing or replaced source is not a valid substitute, even when it
      // shares the same semantic entry. Remove old projections until the exact
      // user-selected sourceAssetId is explicitly loaded again.
      for (const tracked of this.tracked.values()) {
        if (this.assets.removeInstance(tracked.instanceId)) current.removed += 1
      }
      this.tracked.clear()
      current.instances = 0
      this.diagnostics = current
      return { ...current }
    }

    const clipNames = source.animations.map(clip => clip.name)
    const fadeDuration = profile.fadeDuration ?? 0.2
    const scale = profile.scale ?? 1

    for (const agent of agents) {
      if (!Number.isSafeInteger(agent.id) || agent.id < 0) continue
      aliveIds.add(agent.id)
      const instanceId = `agent-visual:${agent.id}`
      const gridPosition: AgentGridCoordinates = { x: agent.x, y: agent.y, z: 0 }
      const mappedPosition = this.mapGridPosition(gridPosition)
      const worldPosition = this.resolveWorldPosition(mappedPosition, agent)
      if (![worldPosition.x, worldPosition.y, worldPosition.z].every(Number.isFinite)) {
        throw new TypeError(`Agent ${agent.id} resolved to a non-finite world position`)
      }

      let tracked = this.tracked.get(agent.id)
      if (!this.assets.hasInstance(instanceId)) {
        const placed = this.assets.placeInstance(instanceId, profile.semanticEntryId, {
          x: worldPosition.x,
          y: worldPosition.y,
          z: worldPosition.z,
          scale,
          persistence: 'transient',
        })
        if (!placed) {
          current.awaitingAsset += 1
          this.tracked.delete(agent.id)
          continue
        }
        tracked = { instanceId, clipName: null }
        this.tracked.set(agent.id, tracked)
        current.created += 1
      } else {
        if (!tracked || tracked.instanceId !== instanceId) {
          tracked = { instanceId, clipName: null }
          this.tracked.set(agent.id, tracked)
        }
        this.assets.setInstanceWorldTransform(instanceId, {
          position: worldPosition,
          scale,
        })
        current.updated += 1
      }

      const resolved = resolveAgentVisualAnimation(profile, agent.state, clipNames)
      if (resolved.clipName) {
        if (tracked.clipName !== resolved.clipName) {
          if (this.assets.playInstanceAnimation(instanceId, resolved.clipName, { fadeDuration })) {
            tracked.clipName = resolved.clipName
            current.animated += 1
          } else {
            tracked.clipName = null
            current.missingClip += 1
          }
        }
      } else {
        current.missingClip += 1
        if (tracked.clipName !== null) {
          if (this.assets.stopInstanceAnimation(instanceId)) current.stopped += 1
          tracked.clipName = null
        }
      }
    }

    for (const [agentId, tracked] of [...this.tracked]) {
      if (aliveIds.has(agentId)) continue
      if (this.assets.removeInstance(tracked.instanceId)) current.removed += 1
      this.tracked.delete(agentId)
    }

    current.instances = this.tracked.size
    this.diagnostics = current
    return { ...current }
  }

  diagnosticsSnapshot(): AgentVisualSyncDiagnostics {
    return { ...this.diagnostics, instances: this.tracked.size }
  }

  dispose(): void {
    this.disposeInstances()
    this.profile = null
    this.diagnostics = emptyDiagnostics(false)
  }

  private disposeInstances(): void {
    for (const tracked of this.tracked.values()) {
      this.assets.removeInstance(tracked.instanceId)
    }
    this.tracked.clear()
  }
}
