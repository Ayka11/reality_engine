import type { AgentState } from './AgentSystem'

export const AGENT_VISUAL_STATES: readonly AgentState[] = [
  'idle',
  'seek_energy',
  'seek_info',
  'flee_entropy',
  'reproduce',
  'explore',
  'rest',
] as const

export type AgentVisualProfile = {
  schemaVersion: 'agent-visual-profile-v1'
  /** Semantic entry assigned to every agent represented by this profile. */
  semanticEntryId: string
  /** Uniform model scale; defaults to 1. */
  scale?: number
  /** Crossfade duration when an agent changes state. */
  fadeDuration?: number
  /** Explicit state-to-clip mapping. Clip names must match the imported GLTF exactly. */
  clips?: Partial<Record<AgentState, string>>
  /** Optional exact-name fallback when a state has no mapped/available clip. */
  fallbackClip?: string
}

export type AgentVisualProfileValidation = {
  valid: boolean
  errors: string[]
  profile: AgentVisualProfile | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512
}

/** Validate profile structure and, when supplied, exact names from the loaded GLTF. */
export function validateAgentVisualProfile(
  value: unknown,
  availableClipNames?: readonly string[],
): AgentVisualProfileValidation {
  const errors: string[] = []
  if (!isRecord(value)) {
    return { valid: false, errors: ['Agent visual profile must be an object'], profile: null }
  }
  if (value.schemaVersion !== 'agent-visual-profile-v1') {
    errors.push('Unsupported agent visual profile schemaVersion')
  }
  if (!nonEmpty(value.semanticEntryId)) {
    errors.push('Agent visual profile requires a semanticEntryId')
  }
  if (value.scale !== undefined &&
      (typeof value.scale !== 'number' || !Number.isFinite(value.scale) ||
       value.scale <= 0 || value.scale > 1_000_000)) {
    errors.push('Agent visual profile scale must be finite and positive')
  }
  if (value.fadeDuration !== undefined &&
      (typeof value.fadeDuration !== 'number' || !Number.isFinite(value.fadeDuration) ||
       value.fadeDuration < 0 || value.fadeDuration > 10)) {
    errors.push('Agent visual profile fadeDuration must be between 0 and 10 seconds')
  }

  let clips: Partial<Record<AgentState, string>> | undefined
  if (value.clips !== undefined) {
    if (!isRecord(value.clips)) {
      errors.push('Agent visual profile clips must be an object')
    } else {
      clips = {}
      for (const [state, clipName] of Object.entries(value.clips)) {
        if (!AGENT_VISUAL_STATES.includes(state as AgentState)) {
          errors.push(`Agent visual profile contains an unsupported state: ${state}`)
          continue
        }
        if (!nonEmpty(clipName)) {
          errors.push(`Agent visual profile clip for ${state} must be a non-empty exact name`)
          continue
        }
        clips[state as AgentState] = clipName
      }
    }
  }

  if (value.fallbackClip !== undefined && !nonEmpty(value.fallbackClip)) {
    errors.push('Agent visual profile fallbackClip must be a non-empty exact name')
  }

  if (availableClipNames !== undefined) {
    if (!Array.isArray(availableClipNames) ||
        !availableClipNames.every(name => typeof name === 'string')) {
      errors.push('Available GLTF clip names must be a string array')
    } else {
      const available = new Set(availableClipNames)
      for (const [state, clipName] of Object.entries(clips ?? {})) {
        if (!available.has(clipName)) {
          errors.push(`Agent visual profile references missing GLTF clip "${clipName}" for state ${state}`)
        }
      }
      if (nonEmpty(value.fallbackClip) && !available.has(value.fallbackClip)) {
        errors.push(`Agent visual profile references missing fallback GLTF clip "${value.fallbackClip}"`)
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors, profile: null }

  const profile: AgentVisualProfile = {
    schemaVersion: 'agent-visual-profile-v1',
    semanticEntryId: value.semanticEntryId as string,
  }
  if (value.scale !== undefined) profile.scale = value.scale as number
  if (value.fadeDuration !== undefined) profile.fadeDuration = value.fadeDuration as number
  if (clips && Object.keys(clips).length > 0) profile.clips = { ...clips }
  if (value.fallbackClip !== undefined) profile.fallbackClip = value.fallbackClip as string

  return { valid: true, errors: [], profile }
}

export type ResolvedAgentVisualAnimation = {
  clipName: string | null
  source: 'state' | 'fallback' | 'none'
}

/**
 * Resolve only exact, imported clip names. There is deliberately no substring,
 * fuzzy, or state-name guessing when the profile has no matching animation.
 */
export function resolveAgentVisualAnimation(
  profile: AgentVisualProfile,
  state: AgentState,
  availableClipNames: readonly string[],
): ResolvedAgentVisualAnimation {
  const available = new Set(availableClipNames)
  const stateClip = profile.clips?.[state]
  if (stateClip && available.has(stateClip)) {
    return { clipName: stateClip, source: 'state' }
  }
  if (profile.fallbackClip && available.has(profile.fallbackClip)) {
    return { clipName: profile.fallbackClip, source: 'fallback' }
  }
  return { clipName: null, source: 'none' }
}
