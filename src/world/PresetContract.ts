export type PresetName =
  | 'burst' | 'wave' | 'life' | 'vortex' | 'entropy_storm' | 'ecosystem' | 'clear'
  | 'plasma_universe' | 'frozen_world' | 'high_gravity' | 'low_entropy_vacuum'
  | 'fungal_ecosystem' | 'ocean_biosphere' | 'toxic_ecosystem'
  | 'nebula' | 'proto_planet' | 'star_formation'
  | 'abandoned_megacity' | 'machine_ecology' | 'energy_economy'
  | 'self_replicating_field' | 'causality_collapse';

export type PresetCommandName = PresetName | WorkerPresetName;
export type PresetExecutionTarget = 'worker' | 'voxel';

export interface PresetDefinition {
  readonly name: PresetCommandName;
  readonly target: PresetExecutionTarget;
  readonly clearsBeforeApply: true;
}

const WORKER_PRESETS = ['burst', 'wave', 'storm', 'ruins', 'clear', 'life', 'proto', 'town'] as const;
export type WorkerPresetName = typeof WORKER_PRESETS[number];

export function isWorkerPreset(name: string): name is WorkerPresetName {
  return (WORKER_PRESETS as readonly string[]).includes(name);
}

export function presetDefinition(name: PresetCommandName): PresetDefinition {
  return {
    name,
    target: isWorkerPreset(name) ? 'worker' : 'voxel',
    clearsBeforeApply: true,
  };
}

export function normalizePresetName(value: string): PresetCommandName | null {
  const names = new Set<PresetName>([
    'burst','wave','life','vortex','entropy_storm','ecosystem','clear',
    'plasma_universe','frozen_world','high_gravity','low_entropy_vacuum',
    'fungal_ecosystem','ocean_biosphere','toxic_ecosystem','nebula','proto_planet',
    'star_formation','abandoned_megacity','machine_ecology','energy_economy',
    'self_replicating_field','causality_collapse',
  ]);
  if (names.has(value as PresetName) || isWorkerPreset(value)) return value as PresetCommandName;
  return null;
}
