// Grid dimensions only — physics constants live in laws/MetaLaw.ts DEFAULT_PARAMS
export const WORLD = {
  W: 64, H: 64, D: 32,

  CAUSALITY_THRESHOLD: 80,
  CAUSALITY_MAX_LOG:   600,

  ENERGY_MAX: 9999,
} as const;
