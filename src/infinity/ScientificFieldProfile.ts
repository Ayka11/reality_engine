export type ScientificFieldProfileFalloff = 'linear' | 'smooth' | 'sphere' | 'sharp'

export type ScientificFieldProfile = {
  schemaVersion: 'scientific-field-profile-v1'
  kind: 'radial'
  falloff: ScientificFieldProfileFalloff
  radius: number
  parameters?: Record<string, number>
  seed?: number
}

export function evaluateScientificFieldProfile(
  profile: ScientificFieldProfile,
  distance: number,
): number {
  const radius = Math.max(0, profile.radius)
  if (radius === 0) return distance === 0 ? 1 : 0

  const t = Math.max(0, Math.min(1, 1 - distance / radius))
  if (distance > radius) return 0

  switch (profile.falloff) {
    case 'linear':
      return t
    case 'smooth':
      return t * t * (3 - 2 * t)
    case 'sphere':
      return Math.sqrt(t)
    case 'sharp':
      return t > 0 ? 1 : 0
    default:
      return 0
  }
}

export function assertScientificFieldProfile(profile: ScientificFieldProfile): void {
  if (profile.schemaVersion !== 'scientific-field-profile-v1') {
    throw new Error('Unsupported scientific field profile schema')
  }
  if (profile.kind !== 'radial') {
    throw new Error('Unsupported scientific field profile kind')
  }
  if (!Number.isFinite(profile.radius) || profile.radius < 0) {
    throw new Error('Scientific field profile radius must be finite and non-negative')
  }
  if (!['linear', 'smooth', 'sphere', 'sharp'].includes(profile.falloff)) {
    throw new Error('Unsupported scientific field profile falloff')
  }
  if (profile.seed !== undefined && !Number.isFinite(profile.seed)) {
    throw new Error('Scientific field profile seed must be finite')
  }
}
