/**
 * Semantic Control Mapper
 * High-level user controls → Low-level physics parameters
 * Bridges intuitive UI with complex simulation tuning
 */

export type WorldMood = 'frozen' | 'volatile' | 'fertile' | 'hostile' | 'chaotic' | 'balanced';
export type DominantForce = 'matter' | 'energy' | 'information' | 'biology' | 'civilization';
export type TargetOutcome = 'emergent_life' | 'stable_ecosystem' | 'civilization_rise' | 'info_singularity' | 'entropy_art';

export interface SemanticControls {
  worldMood: WorldMood;
  stability: number;           // 0.0 (Fragile) → 1.0 (Self-Repairing)
  evolutionSpeed: number;      // 0.0 (Slow) → 1.0 (Explosive)
  dominantForce: DominantForce;
  targetOutcome: TargetOutcome;
  chaosLevel: number;          // 0–1
}

export interface PhysicsParameters {
  temperatureBias: number;
  entropyBias: number;
  bioBias: number;
  informationBias: number;
  diffusionRate: number;
  lawMutationRate: number;
  lawCompetitionStrength: number;
  entropyDecayRate: number;
  selfRepairFactor: number;
  globalMutationRate: number;
  reproductionRate: number;
  complexityReward: number;
  informationDecayRate: number;
  [key: string]: number;
}

// Default semantic preset
export const DEFAULT_SEMANTIC_CONTROLS: SemanticControls = {
  worldMood: 'balanced',
  stability: 0.5,
  evolutionSpeed: 0.5,
  dominantForce: 'matter',
  targetOutcome: 'emergent_life',
  chaosLevel: 0.3,
};

// Mood presets: high-level starting configs
const MOOD_PRESETS: Record<WorldMood, Partial<PhysicsParameters>> = {
  frozen: {
    temperatureBias: 0.1,
    entropyBias: 0.2,
    bioBias: 0.3,
    diffusionRate: 0.4,
    reproductionRate: 0.2,
    globalMutationRate: 0.3,
  },
  volatile: {
    temperatureBias: 0.9,
    entropyBias: 0.75,
    diffusionRate: 1.4,
    lawMutationRate: 1.2,
    complexityReward: 0.3,
  },
  fertile: {
    temperatureBias: 0.65,
    bioBias: 0.9,
    entropyBias: 0.45,
    informationBias: 0.6,
    reproductionRate: 1.1,
    globalMutationRate: 0.8,
  },
  hostile: {
    entropyBias: 0.85,
    bioBias: 0.2,
    temperatureBias: 0.95,
    diffusionRate: 1.3,
    lawMutationRate: 1.4,
    complexityReward: 0.1,
  },
  chaotic: {
    entropyBias: 0.95,
    lawMutationRate: 1.6,
    diffusionRate: 1.5,
    globalMutationRate: 1.3,
    complexityReward: 0.2,
  },
  balanced: {
    temperatureBias: 0.5,
    entropyBias: 0.4,
    bioBias: 0.5,
    informationBias: 0.5,
    diffusionRate: 0.8,
    lawMutationRate: 0.8,
    globalMutationRate: 0.6,
    complexityReward: 0.7,
  },
};

// Dominant force amplification
const FORCE_AMPLIFIERS: Record<DominantForce, Partial<PhysicsParameters>> = {
  matter: {
    bioBias: -0.2,
    informationBias: -0.1,
    diffusionRate: 1.2,
  },
  energy: {
    temperatureBias: 1.3,
    diffusionRate: 1.4,
    informationBias: 0.3,
  },
  information: {
    informationBias: 1.5,
    bioBias: 0.4,
    lawMutationRate: 1.4,
    complexityReward: 1.5,
  },
  biology: {
    bioBias: 1.4,
    informationBias: 0.7,
    reproductionRate: 1.3,
  },
  civilization: {
    informationBias: 1.2,
    bioBias: 0.8,
    complexityReward: 1.8,
    lawMutationRate: 1.1,
  },
};

// Outcome-specific tweaks
const OUTCOME_CONFIGS: Record<TargetOutcome, Partial<PhysicsParameters>> = {
  emergent_life: {
    bioBias: 1.0,
    reproductionRate: 1.2,
    complexityReward: 1.1,
    entropyDecayRate: 0.15,
  },
  stable_ecosystem: {
    bioBias: 0.9,
    entropyBias: 0.35,
    lawCompetitionStrength: 0.7,
    globalMutationRate: 0.4,
  },
  civilization_rise: {
    informationBias: 1.2,
    complexityReward: 1.5,
    globalMutationRate: 0.9,
  },
  info_singularity: {
    informationBias: 1.8,
    informationDecayRate: 0.05,
    complexityReward: 2.0,
    lawMutationRate: 1.3,
  },
  entropy_art: {
    entropyBias: 1.0,
    chaosLevel: 1.0,
    diffusionRate: 1.5,
    complexityReward: 0.5,
  },
};

/**
 * Main semantic control application function
 * Translates high-level user intent into physics parameters
 */
export function applySemanticControls(controls: SemanticControls): PhysicsParameters {
  const params: PhysicsParameters = {
    temperatureBias: 0.5,
    entropyBias: 0.4,
    bioBias: 0.5,
    informationBias: 0.5,
    diffusionRate: 0.8,
    lawMutationRate: 0.8,
    lawCompetitionStrength: 0.8,
    entropyDecayRate: 0.2,
    selfRepairFactor: 0.5,
    globalMutationRate: 0.6,
    reproductionRate: 0.8,
    complexityReward: 0.7,
    informationDecayRate: 0.3,
  };

  // Apply mood preset as base
  const moodParams = MOOD_PRESETS[controls.worldMood];
  Object.assign(params, moodParams);

  // Stability modulation
  params.lawCompetitionStrength = controls.stability * 1.2 + 0.2;
  params.entropyDecayRate = (1 - controls.stability) * 0.5 + 0.1;
  params.selfRepairFactor = controls.stability * 0.8;
  params.lawMutationRate *= 1.0 - (controls.stability * 0.4);

  // Evolution speed
  params.globalMutationRate = 0.3 + controls.evolutionSpeed * 1.2;
  params.reproductionRate = 0.5 + controls.evolutionSpeed * 1.0;
  params.diffusionRate = 0.6 + controls.evolutionSpeed * 0.8;

  // Dominant force
  const forceAmplifier = FORCE_AMPLIFIERS[controls.dominantForce];
  Object.entries(forceAmplifier).forEach(([key, value]) => {
    if (key in params) {
      params[key as keyof PhysicsParameters] =
        (params[key as keyof PhysicsParameters] as number) * value;
    }
  });

  // Target outcome
  const outcomeConfig = OUTCOME_CONFIGS[controls.targetOutcome];
  Object.assign(params, outcomeConfig);

  // Chaos level bleed
  params.diffusionRate *= 1.0 + controls.chaosLevel * 0.3;
  params.globalMutationRate *= 1.0 + controls.chaosLevel * 0.4;
  params.lawMutationRate *= 1.0 + controls.chaosLevel * 0.5;

  // Clamp all values to reasonable ranges
  Object.keys(params).forEach((key) => {
    const val = params[key as keyof PhysicsParameters];
    if (typeof val === 'number') {
      params[key as keyof PhysicsParameters] = Math.max(0.05, Math.min(2.0, val));
    }
  });

  return params;
}

/**
 * Get a human-readable description of the current semantic configuration
 */
export function describeSemanticConfig(controls: SemanticControls): string {
  const lines = [
    `🌍 Mood: ${controls.worldMood.toUpperCase()}`,
    `⚖️ Stability: ${Math.round(controls.stability * 100)}%`,
    `⚡ Evolution Speed: ${Math.round(controls.evolutionSpeed * 100)}%`,
    `💫 Dominant Force: ${controls.dominantForce}`,
    `🎯 Target Outcome: ${controls.targetOutcome}`,
    `🌀 Chaos: ${Math.round(controls.chaosLevel * 100)}%`,
  ];
  return lines.join('\n');
}

/**
 * Get suggested controls for a particular genre/use case
 */
export function getPreset(preset: 'demo' | 'research' | 'artwork' | 'game'): SemanticControls {
  const presets: Record<string, SemanticControls> = {
    demo: {
      worldMood: 'fertile',
      stability: 0.6,
      evolutionSpeed: 0.7,
      dominantForce: 'biology',
      targetOutcome: 'emergent_life',
      chaosLevel: 0.2,
    },
    research: {
      worldMood: 'balanced',
      stability: 0.7,
      evolutionSpeed: 0.4,
      dominantForce: 'energy',
      targetOutcome: 'stable_ecosystem',
      chaosLevel: 0.1,
    },
    artwork: {
      worldMood: 'chaotic',
      stability: 0.3,
      evolutionSpeed: 0.8,
      dominantForce: 'information',
      targetOutcome: 'entropy_art',
      chaosLevel: 0.9,
    },
    game: {
      worldMood: 'volatile',
      stability: 0.5,
      evolutionSpeed: 0.9,
      dominantForce: 'civilization',
      targetOutcome: 'civilization_rise',
      chaosLevel: 0.5,
    },
  };
  return presets[preset] || presets['demo'];
}
