import {
  validateAgentGridWorldTransform,
  type AgentGridWorldTransform,
} from '../../simulation/AgentGridWorldTransform'
import {
  validateAgentVisualProfile,
  type AgentVisualProfile,
} from './AgentVisualProfile'

export type AgentVisualConfiguration = {
  schemaVersion: 'agent-visual-configuration-v1'
  /** Runtime asset ID selected by the user; binary URLs are deliberately not stored. */
  sourceAssetId: string
  profile: AgentVisualProfile
  transform: AgentGridWorldTransform
}

export type AgentVisualConfigurationValidation = {
  valid: boolean
  errors: string[]
  configuration: AgentVisualConfiguration | null
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const AGENT_VISUAL_CONFIGURATION_STORAGE_KEY =
  'reality-engine:agent-visual-configuration:v1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512
}

/** Validate and detach the user-selected visual binding without resolving external URLs. */
export function validateAgentVisualConfiguration(
  value: unknown,
): AgentVisualConfigurationValidation {
  const errors: string[] = []
  if (!isRecord(value)) {
    return { valid: false, errors: ['Agent visual configuration must be an object'], configuration: null }
  }
  if (value.schemaVersion !== 'agent-visual-configuration-v1') {
    errors.push('Unsupported agent visual configuration schemaVersion')
  }
  if (!isNonEmptyString(value.sourceAssetId)) {
    errors.push('Agent visual configuration requires a sourceAssetId')
  }

  const profileValidation = validateAgentVisualProfile(value.profile)
  const transformValidation = validateAgentGridWorldTransform(value.transform)
  errors.push(...profileValidation.errors)
  errors.push(...transformValidation.errors)
  if (errors.length > 0 || !profileValidation.profile || !transformValidation.transform) {
    return { valid: false, errors, configuration: null }
  }

  return {
    valid: true,
    errors: [],
    configuration: {
      schemaVersion: 'agent-visual-configuration-v1',
      sourceAssetId: value.sourceAssetId as string,
      profile: profileValidation.profile,
      transform: transformValidation.transform,
    },
  }
}

function getBrowserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/**
 * Browser-local preferences for the opt-in agent visualization binding.
 *
 * This configuration is intentionally separate from world snapshots: it stores
 * no GLTF binaries, URLs, simulation state or agent instances. Restoring it never
 * downloads a model; the user must explicitly import the exact sourceAssetId.
 */
export class AgentVisualConfigurationStore {
  constructor(private readonly storage: StorageLike | null = getBrowserStorage()) {}

  save(value: unknown): boolean {
    const validation = validateAgentVisualConfiguration(value)
    if (!validation.valid || !validation.configuration || !this.storage) return false
    try {
      this.storage.setItem(
        AGENT_VISUAL_CONFIGURATION_STORAGE_KEY,
        JSON.stringify(validation.configuration),
      )
      return true
    } catch {
      return false
    }
  }

  load(): AgentVisualConfiguration | null {
    if (!this.storage) return null
    let raw: string | null
    try {
      raw = this.storage.getItem(AGENT_VISUAL_CONFIGURATION_STORAGE_KEY)
    } catch {
      return null
    }
    if (raw === null) return null

    try {
      const validation = validateAgentVisualConfiguration(JSON.parse(raw))
      if (validation.valid && validation.configuration) return validation.configuration
    } catch {
      // Malformed JSON is handled by the same invalid-payload cleanup below.
    }

    try {
      this.storage.removeItem(AGENT_VISUAL_CONFIGURATION_STORAGE_KEY)
    } catch {
      // Storage may become unavailable between read and cleanup.
    }
    return null
  }

  clear(): boolean {
    if (!this.storage) return false
    try {
      this.storage.removeItem(AGENT_VISUAL_CONFIGURATION_STORAGE_KEY)
      return true
    } catch {
      return false
    }
  }
}
