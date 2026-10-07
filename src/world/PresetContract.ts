export type PresetName =
  | 'burst' | 'wave' | 'life' | 'vortex' | 'entropy_storm' | 'ecosystem' | 'clear'
  | 'plasma_universe' | 'frozen_world' | 'high_gravity' | 'low_entropy_vacuum'
  | 'fungal_ecosystem' | 'ocean_biosphere' | 'toxic_ecosystem'
  | 'nebula' | 'proto_planet' | 'star_formation'
  | 'abandoned_megacity' | 'machine_ecology' | 'energy_economy'
  | 'self_replicating_field' | 'causality_collapse';

export type PresetExecutionTarget = 'worker' | 'voxel';

export interface PresetDefinition {
  readonly name: PresetName;
  readonly target: PresetExecutionTarget;
  readonly clearsBeforeApply: true;
}

const WORKER_PRESETS = ['burst', 'wave', 'storm', 'ruins', 'clear', 'life', 'proto', 'town'] as const;
export type WorkerPresetName = typeof WORKER_PRESETS[number];

const WORKER_TO_CANONICAL: Record<WorkerPresetName, PresetName> = {
  burst: 'burst', wave: 'wave', storm: 'entropy_storm', ruins: 'abandoned_megacity',
  clear: 'clear', life: 'life', proto: 'proto_planet', town: 'abandoned_megacity',
};

export function isWorkerPreset(name: string): name is WorkerPresetName {
  return (WORKER_PRESETS as readonly string[]).includes(name);
}

export function workerPresetCanonicalName(name: WorkerPresetName): PresetName {
  return WORKER_TO_CANONICAL[name];
}

export function presetDefinition(name: PresetName): PresetDefinition {
  return {
    name,
    target: isWorkerPreset(name) ? 'worker' : 'voxel',
    clearsBeforeApply: true,
  };
}

export function normalizePresetName(value: string): PresetName | null {
  const names = new Set<PresetName>([
    'burst','wave','life','vortex','entropy_storm','ecosystem','clear',
    'plasma_universe','frozen_world','high_gravity','low_entropy_vacuum',
    'fungal_ecosystem','ocean_biosphere','toxic_ecosystem','nebula','proto_planet',
    'star_formation','abandoned_megacity','machine_ecology','energy_economy',
    'self_replicating_field','causality_collapse',
  ]);
  return names.has(value as PresetName) ? value as PresetName : null;
}
